/* ============================================================
   语音 —— 识别 + 录音
   ============================================================

   两条独立的能力，按场景组合使用：

     SpeechRecognizer —— 语音转文字（孩子口述作文 / 口述修改指令）
     AudioRecorder    —— 录下音频（背诵存档，以后能回放）

   为什么两套都要？
     背诵环节既要**比对文本**（打分），又要**留下声音**（档案回放），
     所以必须同时跑。而口述作文只需要文本。

   兼容性兜底：
     安卓 WebView 里 **没有** Web Speech API 的识别能力 ——
     window.webkitSpeechRecognition 这个对象可能存在，但底层没有识别服务，
     一 start() 就会把 WebView 拖崩（真实故障：写作文页点麦克风直接崩）。

     所以这里分两条路：
       · 浏览器（Web / 手机浏览器）→ 用 webkitSpeechRecognition
       · 原生 App（APK）→ 走原生插件 LittleSpeech
         （Android 的 SpeechRecognizer，见
          android/app/src/main/java/.../LittleSpeechPlugin.java）

     两条路对外是**同一套接口**（start / stop / abort + 回调），
     上层 VoiceComposer 不需要知道自己在哪一边。

     两个能力都做了 canUse 检测，不可用时界面会退化成
     手动输入 / 自我勾选，功能闭环不会断。
   ============================================================ */

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { isNativePlatform } from './native'
import { voiceDiag } from './voice-log'

/* ============================================================
   一、能力检测
   ============================================================ */

interface SpeechRecognitionAlternativeLike {
  transcript: string
  confidence: number
}

interface SpeechRecognitionResultLike {
  isFinal: boolean
  length: number
  [index: number]: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: {
    length: number
    [index: number]: SpeechRecognitionResultLike
  }
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getSpeechCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  // ★ 原生 App 里绝对不碰 webkitSpeechRecognition：
  //   它是"有壳没芯"的，start() 会让 WebView 崩掉。
  //   识别交给下面的 LittleSpeech 原生插件。
  if (isNativePlatform()) return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isSpeechRecognitionSupported(): boolean {
  // 原生环境先乐观放行，真正的可用性由 probeSpeechSupport() 异步问出来
  if (isNativePlatform()) return true
  return getSpeechCtor() !== null
}

/**
 * 异步探一次"这台设备到底能不能识别"。
 *
 * 浏览器里就是看有没有 SpeechRecognition 对象；
 * 原生里要问系统 SpeechRecognizer（有些设备/ROM 没有识别服务，
 * 比如没装 Google 服务的国行机 —— 这时候要老实退回键盘输入）。
 */
export async function probeSpeechSupport(): Promise<boolean> {
  const plugin = getNativePlugin()
  if (plugin) {
    try {
      const r = await plugin.available()
      return Boolean(r?.available)
    } catch {
      return false
    }
  }
  return getSpeechCtor() !== null
}

/** 当前是否走原生识别（原生时不能再自己开 getUserMedia，会和系统识别抢麦） */
export function usesNativeSpeech(): boolean {
  return getNativePlugin() !== null
}

export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof window !== 'undefined' &&
    'MediaRecorder' in window
  )
}

/* ============================================================
   一·B、原生识别插件
   ------------------------------------------------------------
   名字必须和 @CapacitorPlugin(name = "LittleSpeech") 一致。
   ============================================================ */

interface LittleSpeechPlugin {
  available(): Promise<{ available: boolean; permission: string }>
  start(options: { lang?: string; continuous?: boolean }): Promise<void>
  stop(): Promise<void>
  cancel(): Promise<void>
  addListener(
    eventName: 'start' | 'ready' | 'speechStart' | 'speechEnd' | 'partial' | 'result' | 'error' | 'end' | 'level',
    listenerFunc: (data: Record<string, unknown>) => void,
  ): Promise<PluginListenerHandle>
}

let nativePlugin: LittleSpeechPlugin | null = null
let nativePluginResolved = false

function getNativePlugin(): LittleSpeechPlugin | null {
  if (!isNativePlatform()) return null
  if (!nativePluginResolved) {
    nativePluginResolved = true
    try {
      nativePlugin = registerPlugin<LittleSpeechPlugin>('LittleSpeech')
    } catch {
      nativePlugin = null
    }
  }
  return nativePlugin
}

/* ============================================================
   二、语音识别
   ============================================================ */

export interface RecognizerCallbacks {
  /** 实时中间结果（用于界面滚动显示） */
  onInterim?: (text: string) => void
  /** 一句说完的最终结果 */
  onFinal: (text: string) => void
  onError?: (err: string) => void
  onStart?: () => void
  onEnd?: () => void
  /** 实时音量 0-1（原生识别时由系统 RMS 换算；浏览器里没有） */
  onLevel?: (level: number) => void
}

export interface Recognizer {
  start: () => void
  stop: () => void
  abort: () => void
  /** 当前是否在听 */
  isListening: () => boolean
  /**
   * 按停之后，等系统把最后一句吐完再 resolve。
   *
   * 为什么要有这个，而不是让界面自己 `sleep(320)`：
   *   · 系统吐最后一句的延迟是**不确定**的（真机几十到几百毫秒，
   *     最坏接近 grace 窗口），写死任何一个数都会在慢设备上丢最后一句；
   *   · 丢掉的是孩子刚说的那一句，最看不出来也最伤 —— 表现为
   *     "录音明明录上了，文字却是空的"，非常难查。
   *
   * 所以：要么等到真结果（onFinal 到达会提前 resolve），要么等满 grace 窗口。
   * abort()（用户主动放弃）时立即 resolve —— 那种情况本来就不要结果。
   */
  settled: () => Promise<void>
}

/**
 * 创建一个持续识别的会话。
 *
 * 注意：浏览器会在静默一段时间后自动结束识别，
 * 所以 onend 里如果用户还没按停，我们就自动重启 ——
 * 否则孩子说到一半突然"断了"会很挫败。
 */
export function createRecognizer(cb: RecognizerCallbacks, lang = 'zh-CN'): Recognizer {
  // 原生 App：交给系统 SpeechRecognizer（见 LittleSpeechPlugin.java）
  const native = getNativePlugin()
  if (native) return createNativeRecognizer(native, cb, lang)

  const Ctor = getSpeechCtor()
  if (!Ctor) {
    return {
      start: () => cb.onError?.('这台设备不支持语音识别，请用下面的键盘输入'),
      stop: () => {},
      abort: () => {},
      isListening: () => false,
      settled: () => Promise.resolve(),
    }
  }

  const rec = new Ctor()
  rec.lang = lang
  rec.continuous = true
  rec.interimResults = true
  rec.maxAlternatives = 1

  let listening = false
  /** 用户主动停止 —— 与"浏览器自动结束"区分开 */
  let userStopped = false
  let restartTimer: number | null = null
  /** 等最后一句落地用的定时器 + resolve */
  let graceTimer: number | null = null
  let graceResolve: (() => void) | null = null

  const settleGrace = () => {
    if (graceTimer !== null) {
      window.clearTimeout(graceTimer)
      graceTimer = null
    }
    graceResolve?.()
    graceResolve = null
  }

  rec.onstart = () => {
    listening = true
    cb.onStart?.()
  }

  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      const text = r[0]?.transcript ?? ''
      if (r.isFinal) {
        const clean = text.trim()
        if (clean) cb.onFinal(clean)
      } else {
        interim += text
      }
    }
    if (interim) cb.onInterim?.(interim.trim())
    else cb.onInterim?.('')
    // 有最终结果落地了，界面就不用再干等宽限期
    if (userStopped) settleGrace()
  }

  rec.onerror = (e) => {
    // no-speech / aborted 是常态，不算错误，不打扰孩子
    if (e.error === 'no-speech' || e.error === 'aborted') return
    /* ★ `network` 这一条**不许**只说"请检查网络"。
       国内网络下 Chrome 自带的识别要连 Google 的服务器，连不上时报的就是
       `network` —— 家长于是去查路由器，而问题根本不在这儿。
       所以两种可能都要说出来。（火山流式不走这条：它只在原生侧连，
       见 ws-transport.ts。） */
    const msg =
      e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? '没有麦克风权限，请在浏览器设置里允许使用麦克风'
        : e.error === 'network'
          ? '语音识别连不上：可能是断网，也可能是浏览器自带的识别服务在当前网络下用不了'
          : `语音识别出错了（${e.error}）`
    cb.onError?.(msg)
  }

  rec.onend = () => {
    listening = false
    // 用户没喊停，但浏览器自己结束了 → 自动续上
    if (!userStopped) {
      restartTimer = window.setTimeout(() => {
        try {
          rec.start()
        } catch {
          /* 已经在跑了就忽略 */
        }
      }, 220)
    } else {
      cb.onEnd?.()
    }
  }

  return {
    start: () => {
      userStopped = false
      try {
        rec.start()
      } catch {
        /* 重复 start 会抛错，忽略即可 */
      }
    },
    stop: () => {
      userStopped = true
      if (restartTimer !== null) {
        window.clearTimeout(restartTimer)
        restartTimer = null
      }
      try {
        rec.stop()
      } catch {
        /* 忽略 */
      }
      listening = false
      cb.onEnd?.()
      // 浏览器这边 onresult 通常紧接着 onend 就到，给一小段宽限即可
      graceTimer = window.setTimeout(() => graceResolve?.(), WEB_RESULT_GRACE_MS)
    },
    abort: () => {
      userStopped = true
      if (restartTimer !== null) {
        window.clearTimeout(restartTimer)
        restartTimer = null
      }
      try {
        rec.abort()
      } catch {
        /* 忽略 */
      }
      listening = false
      // 主动放弃：不要等结果
      settleGrace()
    },
    isListening: () => listening,
    settled: () =>
      new Promise<void>((resolve) => {
        if (graceTimer === null && graceResolve === null) {
          // 还没按停，或已经结算过
          resolve()
          return
        }
        graceResolve = resolve
      }),
  }
}

/* ============================================================
   二·B、原生识别会话
   ------------------------------------------------------------
   原生插件是单例：事件是全局广播的，没有"会话 id"。
   所以监听只在模块级挂一次，再把事件派发给**当前**那个会话 ——
   否则上一轮的监听会继续收到下一句的结果，文字被重复写进正文。
   ============================================================ */

let nativeWired = false
let currentNativeSession: { token: number; cb: RecognizerCallbacks } | null = null
let nativeTokenSeq = 0

function dispatchNative(fn: (cb: RecognizerCallbacks) => void): void {
  const session = currentNativeSession
  if (!session) return
  try {
    fn(session.cb)
  } catch {
    /* 界面回调出错不该反过来打断识别 */
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

async function ensureNativeWired(plugin: LittleSpeechPlugin): Promise<void> {
  if (nativeWired) return
  nativeWired = true

  await plugin.addListener('start', () => dispatchNative((cb) => cb.onStart?.()))
  await plugin.addListener('ready', () => dispatchNative((cb) => cb.onStart?.()))
  await plugin.addListener('partial', (d) => dispatchNative((cb) => cb.onInterim?.(asText(d.text))))
  await plugin.addListener('result', (d) =>
    dispatchNative((cb) => {
      const text = asText(d.text).trim()
      cb.onInterim?.('')
      if (text) cb.onFinal(text)
    }),
  )
  await plugin.addListener('error', (d) =>
    dispatchNative((cb) => cb.onError?.(asText(d.message) || '语音识别出错了')),
  )
  await plugin.addListener('level', (d) => {
    const rms = Number(d.rms)
    if (!Number.isFinite(rms)) return
    // 系统给的是 dB（说话时大致 -2 ~ 10），换算成 0-1 画波形
    dispatchNative((cb) => cb.onLevel?.(clamp01((rms + 2) / 12)))
  })
  await plugin.addListener('end', () => dispatchNative((cb) => cb.onEnd?.()))
}

function nativeStartErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (raw.includes('permission-denied')) {
    return '没有麦克风权限，请在系统设置里允许「小笔苗」使用麦克风'
  }
  if (raw.includes('device-unsupported')) {
    return '这台手机没有可用的语音识别服务，先用下面的键盘输入吧'
  }
  return '语音识别没能启动，用下面的键盘输入也一样可以写'
}

/**
 * 按停之后，识别会话还会继续接收结果的时长（毫秒）。
 *
 * 为什么需要这个窗口：系统 SpeechRecognizer 的 onResults
 * **不是在 stopListening() 时同步回来的** —— 它要等识别服务把已经
 * 收进去的音频处理完，真机上几十到几百毫秒很常见，慢的时候更久。
 * 所以按停之后不能立刻把这个会话丢掉，否则**最后一句就丢了**。
 *
 * ★ 界面如果要在按停后去读"攒下来的文本"，必须等够这么久 ——
 *   请用 recognizer.settled()，不要自己写死一个 sleep。
 *   （以前的故障：背诵流程只等 320ms 就去读，最后一句永远拿不到。）
 */
export const NATIVE_RESULT_GRACE_MS = 1600

/** 浏览器那边 onresult 紧跟着 onend 就来，宽限可以短很多 */
export const WEB_RESULT_GRACE_MS = 600

function createNativeRecognizer(
  plugin: LittleSpeechPlugin,
  cb: RecognizerCallbacks,
  lang: string,
): Recognizer {
  const token = ++nativeTokenSeq
  let listening = false
  let stopped = false
  /** 等最后一句落地 */
  let graceTimer: number | null = null
  let graceResolve: (() => void) | null = null

  const settleGrace = () => {
    if (graceTimer !== null) {
      window.clearTimeout(graceTimer)
      graceTimer = null
    }
    graceResolve?.()
    graceResolve = null
  }

  const release = () => {
    if (currentNativeSession?.token === token) currentNativeSession = null
  }

  /* 启动那一串异步准备（available → addListener → plugin.start）什么时候结算完。
     stop() 要等它 —— 否则可能在识别器还没建出来时就按停，一个字都听不到。
     成功和失败都要 resolve：失败时 stop() 什么都不用做，但绝不能永远挂着。 */
  let markReady: () => void = () => {}
  const ready = new Promise<void>((resolve) => {
    markReady = resolve
  })

  // 这一轮的 onFinal 到了就说明最后一句已经落地，界面不用继续等
  const cbWithSettle: RecognizerCallbacks = {
    ...cb,
    onFinal: (text) => {
      cb.onFinal(text)
      if (stopped) settleGrace()
    },
  }

  return {
    start: () => {
      stopped = false
      settleGrace()

      /* ★ 会话必须在**第一个 await 之前**就登记好。
         这一条是"录音能录、文字不显示"的最后一个病根，教训很贵：

         start() 里要做三件异步的事（available → addListener → plugin.start），
         每一步都是跨进程的 pluginCall，全部加起来几十到几百毫秒。
         而 currentNativeSession 原本是在这些 await **之后**才赋值的，
         于是这段时间里到达的任何事件 —— 尤其是 available() 就已经等了
         一瞬、用户手快在 ready 之前就按了停止（recorder 拿麦克风更慢，
         完全来得及）—— 都会被 dispatchNative 的 `if (!session) return`
         直接丢掉。

         更糟的是丢掉的 "end" 事件：上层 ReciteView 收到 onEnd 会把
         recRef 置空并 setListening(false)，然后去读一个**还没写过**的
         transcript，结果就是"录了、但正文空空的"。

         所以顺序改成：**先登记会话，再去做那些异步的准备**。
         早到的事件因此有人接，晚到的事件更不用说。
         代价是 available() 失败时也要把登记撤掉（下面 catch 里的 release()）。 */
      currentNativeSession = { token, cb: cbWithSettle }

      void (async () => {
        try {
          // 先问一句"你在不在、设备支不支持"。
          // 为什么必须先问：插件没挂上时，Capacitor 的 addListener 会
          // **既不 resolve 也不 reject**（它的实现里没接 reject 分支），
          // 直接挂在那儿 —— 表现就是"点了麦克风，一直显示在听，什么都不会发生"。
          // available() 是普通 promise，缺插件会老老实实 reject。
          const info = await plugin.available()
          if (!info?.available) throw new Error('device-unsupported')

          await ensureNativeWired(plugin)
          await plugin.start({ lang, continuous: true })
          listening = true
          markReady()
          cb.onStart?.()
        } catch (err) {
          listening = false
          release()
          markReady()
          cb.onError?.(nativeStartErrorMessage(err))
          cb.onEnd?.()
        }
      })()
    },

    stop: () => {
      stopped = true
      listening = false

      /* ★ 如果启动那串 await 还没走完，就**不能立刻**调插件的 stop()。
         plugin.start() 是一次跨进程调用，而 begin() 里真正执行
         `recognizer.startListening()` 又在 MainActivity 的 UI 线程队列里。
         用户完全可能在识别器还没建出来之前就按了停止 ——
         那时 stop() 打进去，系统那边 `recognizer == null`，
         stopListening() 被 try/catch 静默跳过，接着 restartSoon() 看到
         userStopped 直接收尾 —— 于是一句话都没听、一个字都没有。

         正确做法：等 start 那一串结算完（成功或失败都算），再按停。 */
      void ready.then(() => {
        try {
          plugin.stop().catch(() => {})
        } catch {
          /* 已经收掉了也无所谓 */
        }
      })

      cb.onEnd?.()
      // 让系统把最后半句吐完（onResults 在 stopListening 之后才回来），
      // 再把这个会话交出去，免得它继续吃下一轮的事件。
      graceTimer = window.setTimeout(() => {
        if (stopped) release()
        settleGrace()
      }, NATIVE_RESULT_GRACE_MS)
    },

    abort: () => {
      stopped = true
      listening = false
      void plugin.cancel().catch(() => {})
      release()
      // 主动放弃：不要等结果
      settleGrace()
    },

    isListening: () => listening,

    settled: () =>
      new Promise<void>((resolve) => {
        if (graceTimer === null && graceResolve === null) {
          resolve()
          return
        }
        graceResolve = resolve
      }),
  }
}

/* ============================================================
   三、录音
   ============================================================ */

export interface RecordingResult {
  /** dataURL，可直接塞进 <audio src> 回放 */
  dataUrl: string
  /** 时长（毫秒） */
  durationMs: number
  /** MIME 类型 */
  mime: string
}

export interface Recorder {
  start: () => Promise<void>
  stop: () => Promise<RecordingResult | null>
  cancel: () => void
  isRecording: () => boolean
  /** 实时音量 0-1，用于画波形 */
  getLevel: () => number
}

/**
 * 录音器。
 *
 * 刻意压低码率（16 kbps opus）—— 孩子的背诵录音要存进 IndexedDB，
 * 一篇 1 分钟的录音大约只有 120 KB，几十篇也不会撑爆。
 */
export function createRecorder(): Recorder {
  let mediaRecorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let chunks: Blob[] = []
  let startedAt = 0
  let cancelled = false
  /**
   * 这一轮**还没 start 完就被收掉了**（stop / cancel 抢在 getUserMedia 前面）。
   *
   * 为什么需要它：松手是同步的，而 `getUserMedia` 要等几十到几百毫秒 ——
   * 孩子按一下立刻松手，`stop()` 就抢在 start 结算之前了。
   * 那一刻 `mediaRecorder` 还是 null，`stop()` 只能返回 null；
   * 但如果就这么算了，`start()` 之后照样会把 `MediaRecorder` 建起来并开始录，
   * 而**再没有人会停它** —— 麦克风一直开着，指示灯亮到页面卸载。
   *
   * 所以 start 在 await 之后要回头看这个标志：被收掉了就不再建。
   * （`cleanup()` 里置位，`start()` 开头复位。）
   */
  let abandoned = false
  let analyser: AnalyserNode | null = null
  let audioCtx: AudioContext | null = null
  let levelData: Uint8Array | null = null

  const cleanup = () => {
    abandoned = true
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    if (audioCtx) {
      void audioCtx.close().catch(() => {})
      audioCtx = null
    }
    analyser = null
    levelData = null
    mediaRecorder = null
  }

  return {
    isRecording: () => mediaRecorder?.state === 'recording',

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

    start: async () => {
      if (!isRecordingSupported()) {
        throw new Error('这台设备不支持录音')
      }
      cancelled = false
      abandoned = false
      chunks = []
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      /* ★ 开麦之前就被收掉了 —— 别再把录音器建起来。
         建了也没人停它：`stop()` 早就跑过了（那时它只能返回 null），
         于是麦克风会一直开着（状态栏图标不灭）。见 `abandoned` 的说明。 */
      if (abandoned) {
        stream.getTracks().forEach((t) => t.stop())
        stream = null
        voiceDiag('录音器：开麦前就已被收掉，不再建录音器', {})
        return
      }

      /* 走到这里说明麦克风权限已经拿到、轨道也建起来了。
         真机上"按住没反应"如果连这一行都没有，那就不是录音的问题，
         是按钮压根没触发 beginHold（或者 getUserMedia 抛了）。 */
      const track = stream.getAudioTracks()[0]
      const settings = track?.getSettings?.() ?? {}
      voiceDiag('麦克风已打开', {
        轨道数: stream.getAudioTracks().length,
        sampleRate: settings.sampleRate,
        channels: settings.channelCount,
      })

      // 顺带接一个分析器画波形
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (Ctor) {
          audioCtx = new Ctor()
          const src = audioCtx.createMediaStreamSource(stream)
          analyser = audioCtx.createAnalyser()
          analyser.fftSize = 512
          levelData = new Uint8Array(analyser.fftSize)
          src.connect(analyser)
        }
      } catch {
        /* 画不了波形不影响录音 */
      }

      const mime = pickMime()
      mediaRecorder = mime
        ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 16_000 })
        : new MediaRecorder(stream)
      voiceDiag('开始录制', { 请求格式: mime || '(浏览器默认)', 码率: mime ? 16_000 : undefined })

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      startedAt = Date.now()
      mediaRecorder.start(250)
    },

    stop: async () => {
      const rec = mediaRecorder
      if (!rec || rec.state === 'inactive') {
        voiceDiag('录音器没在跑', { state: rec?.state ?? '(没有实例)' })
        cleanup()
        return null
      }

      const durationMs = Date.now() - startedAt

      const blob = await new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))
        }
        rec.stop()
      })

      const mime = blob.type || 'audio/webm'
      cleanup()

      if (cancelled || blob.size === 0) {
        /* ★ 真机上最值得看的一行。
           "按住说了半天，一个字没出来"十有八九就停在这里：
           麦克风开了、录制也启动了，但一个数据块都没收到。
           分得清它和"上传失败"，排查方向完全不同。 */
        voiceDiag('录音结束但没有音频', {
          数据块: chunks.length,
          bytes: blob.size,
          主动取消: cancelled,
          时长ms: durationMs,
        })
        return null
      }

      voiceDiag('录音结束', {
        数据块: chunks.length,
        bytes: blob.size,
        时长ms: durationMs,
        实际格式: mime,
      })

      const dataUrl = await blobToDataUrl(blob)
      return { dataUrl, durationMs, mime }
    },

    cancel: () => {
      cancelled = true
      try {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop()
      } catch {
        /* 忽略 */
      }
      cleanup()
    },
  }
}

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported?.(m)) return m
  }
  return ''
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('音频转换失败'))
    reader.readAsDataURL(blob)
  })
}

/* ============================================================
   四、语音合成（朗读范文）
   ============================================================ */

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/**
 * 朗读一段文字。
 *
 * 用途：孩子不认识字的时候可以听范文；背诵前听一遍。
 * 这不是"帮写"，只是把已有的文字念出来。
 */
export function speak(
  text: string,
  opts: { rate?: number; onEnd?: () => void } = {},
): void {
  if (!isSpeechSynthesisSupported()) {
    opts.onEnd?.()
    return
  }
  const synth = window.speechSynthesis
  synth.cancel()

  // 中文语音优先
  const voices = synth.getVoices()
  const zh = voices.find((v) => v.lang?.toLowerCase().startsWith('zh'))

  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'zh-CN'
  if (zh) u.voice = zh
  // 稍慢一点，方便孩子跟读
  u.rate = opts.rate ?? 0.92
  u.pitch = 1.05
  if (opts.onEnd) u.onend = () => opts.onEnd?.()

  synth.speak(u)
}

export function stopSpeaking(): void {
  if (isSpeechSynthesisSupported()) window.speechSynthesis.cancel()
}
