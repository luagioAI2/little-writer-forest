/* ============================================================
   PCM 采集 —— 给流式转写喂「边说边传」的裸数据
   ============================================================

   为什么不能复用 platform/speech.ts 的 createRecorder()：

     MediaRecorder 出的是 **webm/opus**，而火山的流式接口不收 webm ——
     实测直接回 `45000151 unsupported format webm`（"webm" 不在它的
     格式表里：wav/mp3/ogg/pcm/spx/amr/aac/m4a）。
     它倒是收 `ogg` + `codec: opus`，但安卓上能不能录出 ogg 容器完全看
     厂商实现，靠不住。而 `pcm` 是**一定**能录、也**一定**被接受的，
     所以走 Web Audio 自己采。

   采到的数据要自己降采样到 16k：
     设备常见的 AudioContext 采样率是 44100 / 48000，
     而语音识别要的是 16k（官方默认值）。顺带体积也小 3 倍。

   ⚠️ 用 ScriptProcessorNode 而不是 AudioWorklet：
     它确实已标记废弃，但在安卓 WebView 里一定存在、且不需要加载
     额外的 worklet 模块（AudioWorklet 要 addModule，多一个
     加载失败/被 CSP 拦的面）。先把链路跑通；要升级时换掉这一个节点即可，
     对外的 createPcmCapture 接口不用动。
   ============================================================ */

import { voiceDiag } from './voice-log'

export interface PcmCapture {
  start: () => Promise<void>
  /** 正常结束（返回最后是否拿到了音频） */
  stop: () => boolean
  /** 中途放弃 */
  cancel: () => void
  /** 实时音量 0-1，用于画波形 */
  getLevel: () => number
  /** 已经采到的音频时长（毫秒） */
  getDurationMs: () => number
}

/** 每包音频时长。官方推荐 100~200ms；实测 100ms 只是让包数翻倍、并不更快 */
const CHUNK_MS = 200

/** 线性插值降采样。语音场景够用，而且不引入任何依赖 */
export function downsampleTo(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || to <= 0) return input
  const ratio = from / to
  const outLen = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

/** Float32（-1~1）→ 16-bit 小端字节。服务端要的就是这个 */
export function floatToInt16Bytes(input: Float32Array): Uint8Array {
  const out = new Uint8Array(input.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    // 负数用 0x8000、正数用 0x7fff —— 都用 32768 会让 +1.0 溢出成负数
    view.setInt16(i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true)
  }
  return out
}

/**
 * 采集用的约束。
 *
 * ★ 预热和真采集**必须用同一份** —— 约束不一样的话，浏览器可能
 *   重新协商一遍设备，预热就白做了。
 */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
}

/**
 * 提前把麦克风"开一次再立刻关掉"。
 *
 * ★ 为什么有用：`getUserMedia` 的耗时几乎全在**第一次** ——
 *   要弹权限（首次）、要打开音频设备、要初始化采集链路。实测首次可以
 *   到几百毫秒甚至更久，之后同一页面内就快得多。
 *   而孩子按下麦克风的那一刻才去开麦，这段就**全算在他的等待里**；
 *   更糟的是：**松手比开麦快**的时候，采集还没来得及建图就被停掉了，
 *   这一轮**一个字节都没采到** —— 表现成"说了话，什么都没出来"。
 *
 * ★ 所以进写作页就开一次、立刻关掉：
 *     · 权限框（如果需要）在这一刻弹出来，而不是在孩子按下麦克风的时候；
 *     · 设备 / 链路被打开过一次，按下时那一次快得多。
 *
 * ⚠️ 会把麦克风**真的打开一瞬间**（系统状态栏的麦克风图标会闪一下）。
 *    这是刻意的取舍：不真开一次，预热就没有意义。
 * ⚠️ 失败**不报错**：没权限 / 没麦克风的设备，按下时会自己说原因 ——
 *    预热只负责"更快"，不负责"能用"。
 */
export async function warmUpMicrophone(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
    stream.getTracks().forEach((t) => t.stop())
    voiceDiag('麦克风已预热', {})
  } catch {
    voiceDiag('麦克风预热失败（按下时会再试一次并说明原因）', {})
  }
}

export function createPcmCapture(opts: {
  onChunk: (bytes: Uint8Array) => void
  targetRate?: number
}): PcmCapture {
  const targetRate = opts.targetRate ?? 16_000
  const chunkBytes = Math.round((targetRate * 2 * CHUNK_MS) / 1000)

  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let processor: ScriptProcessorNode | null = null
  let analyser: AnalyserNode | null = null
  let levelData: Uint8Array | null = null

  let buffer = new Uint8Array(chunkBytes * 2)
  let filled = 0
  let samples = 0
  let stopped = false

  const flush = (force: boolean) => {
    if (filled === 0) return
    if (!force && filled < chunkBytes) return
    opts.onChunk(buffer.slice(0, filled))
    filled = 0
  }

  const cleanup = () => {
    try {
      processor?.disconnect()
      source?.disconnect()
      analyser?.disconnect()
    } catch {
      /* 已经断开了 */
    }
    processor = null
    source = null
    analyser = null
    levelData = null
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    if (ctx) {
      void ctx.close().catch(() => {})
      ctx = null
    }
  }

  return {
    getLevel: () => {
      if (!analyser || !levelData) return 0
      analyser.getByteTimeDomainData(levelData as Uint8Array<ArrayBuffer>)
      let sum = 0
      for (let i = 0; i < levelData.length; i++) {
        const v = (levelData[i] - 128) / 128
        sum += v * v
      }
      return Math.min(1, Math.sqrt(sum / levelData.length) * 3.2)
    },

    getDurationMs: () => Math.round((samples / targetRate) * 1000),

    start: async () => {
      stopped = false
      filled = 0
      samples = 0

      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)

      /* ★ 开麦之前就被 stop()/cancel() 收掉了 —— 那就**别再把音频图建起来**。
         为什么这是常态而不是异常：松手是同步的，而 `getUserMedia` 要等
         几十到几百毫秒。孩子按一下立刻松手，stop() 就抢在这前面了。
         ⚠️ 不挡这一下的话：下面的 graph 照样建好并接到 destination，
         而这之后**再没有人持有它** —— `stream.getTracks()` 没人 stop，
         麦克风指示灯会一直亮到页面卸载。
         （表现是"按一下之后，手机状态栏的麦克风图标再也不灭了"。） */
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop())
        stream = null
        voiceDiag('PCM 采集：开麦前就已被停掉，不再建音频图', {})
        return
      }

      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) throw new Error('这台设备不支持音频采集')

      ctx = new Ctor()
      // 在 pointerdown 里创建通常已经是 running，但安卓上偶发 suspended，
      // 不 resume 的话 onaudioprocess 一次都不触发 —— 表现成"录了但一个包都没发"
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume()
        } catch {
          /* 起不来就继续，下面的日志会说明 */
        }
      }

      const inRate = ctx.sampleRate
      source = ctx.createMediaStreamSource(stream)

      analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      levelData = new Uint8Array(analyser.fftSize)
      // 注意：这里**先不接** source → analyser。
      // 音频图的连线统一放在下面一处（见"静音增益节点"那段说明）——
      // 在这里接一次、下面又接一次，会把信号叠加两遍。

      processor = ctx.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (e) => {
        if (stopped) return
        const input = e.inputBuffer.getChannelData(0)
        const resampled = downsampleTo(input, inRate, targetRate)
        const bytes = floatToInt16Bytes(resampled)
        samples += resampled.length

        // 攒够一包就发。缓冲区不够时扩容 —— 设备块长不一定是 4096，
        // 按 4096 写死会在一块比预期大的时候越界。
        if (filled + bytes.length > buffer.length) {
          const grown = new Uint8Array(Math.max(buffer.length * 2, filled + bytes.length))
          grown.set(buffer.subarray(0, filled))
          buffer = grown
        }
        buffer.set(bytes, filled)
        filled += bytes.length
        flush(false)
      }

      // ScriptProcessor 必须有出口才会被驱动 —— 不接 destination 就不触发回调。
      // 但**不能接进 destination**：那样麦克风的声音会被原样放出来（啸叫）。
      // 用一个静音增益节点把它引到 destination，既被驱动又没声音。
      //
      // 分析器也要接进这条通路：Web Audio 的图是**从 destination 往回拉**的，
      // 挂在旁边不接出去的分支可能整个不被处理，getByteTimeDomainData
      // 就会一直读到初始值 —— 表现成"波形永远是一条直线"。
      const mute = ctx.createGain()
      mute.gain.value = 0
      source.connect(analyser)
      analyser.connect(mute)
      source.connect(processor)
      processor.connect(mute)
      mute.connect(ctx.destination)

      voiceDiag('PCM 采集已启动', {
        设备采样率: inRate,
        目标采样率: targetRate,
        每包字节: chunkBytes,
      })
    },

    stop: () => {
      stopped = true
      flush(true) // 尾巴也要发出去，否则最后一个字可能被截掉
      const ok = samples > 0
      cleanup()
      voiceDiag('PCM 采集结束', { 采样点: samples, 时长ms: Math.round((samples / targetRate) * 1000) })
      return ok
    },

    cancel: () => {
      stopped = true
      filled = 0
      cleanup()
    },
  }
}
