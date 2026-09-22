/* ============================================================
   探针：火山引擎「流式语音识别」的端到端延迟（WebSocket v3）
   ============================================================

   为什么还要单独量这个 —— 和 _probe-volcengine.mjs（录音文件识别）比：

     录音文件识别：**录完 → 整包上传 → 等结果**。
       孩子松手之后，整个音频才刚开始往服务端走。
       所以「松手 → 出字」= 上传时间 + 识别时间。

     流式识别：**边说边传**。
       孩子还在说的时候，音频已经一段段发过去了。
       等松手时，服务端手里已经有全部（或几乎全部）音频，
       只剩最后那一包的网络往返 + 收尾。
       所以「松手 → 出字」理论上只剩 一个 RTT + 收尾。

   ⚠️ 这就是「换个更快的模型」和「换个交互形态」的区别。
      模型再快也快不过「提前把活干完」。所以要量的是**形态**带来的收益。

   三个端点（同一个 key，不同形态）：
     bigmodel_nostream  单向流式：流式输入，**整句返回**，准确率优于双向。
                        官方点名适用「语音输入法、微信消息语音转写」= 就是我们的场景。
     bigmodel           双向流式：边说边出字，首字最快。
     bigmodel_async     双向优化版：只在结果变化时下发。

   跑法：
     VOLC_API_KEY=xxx node scripts/_probe-volcengine-stream.mjs --file speech_probe.wav
     VOLC_API_KEY=xxx node scripts/_probe-volcengine-stream.mjs --file speech_probe.wav --mode burst
     VOLC_API_KEY=xxx node scripts/_probe-volcengine-stream.mjs --file speech_probe.wav --endpoint bigmodel --runs 3

   密钥**只从环境变量读**，和另外两个探针一个规矩。

   ------------------------------------------------------------
   协议备忘（v3，二进制帧，整数一律**大端**）
   ------------------------------------------------------------
     帧 = [4字节 header] [可选 4字节 sequence] [4字节 payload 长度] [payload]

     header[0] = (版本 << 4) | header长度/4      → 0x11 = v1, 4字节
     header[1] = (消息类型 << 4) | 类型标志
     header[2] = (序列化 << 4) | 压缩
     header[3] = 保留 0x00

     消息类型  1 = full client request（带参数）
               2 = audio only request（带音频）
               9 = full server response（带结果）
              15 = error
     类型标志  0b0000 后面没有 sequence
               0b0001 后面是正数 sequence
               0b0010 最后一包音频（后面没有 sequence）
               0b0011 最后一包音频（后面是负数 sequence）
     序列化    0 = 无   1 = JSON
     压缩      0 = 无   1 = gzip

     ★ 「最后一包」是靠**标志位**表达的，不是靠某个 finish 事件。
       忘了设这个标志，服务端会一直等你发音频，直到超时 ——
       表现为「连上了、也发了、就是没结果」。这是最容易踩的坑。

   鉴权走 HTTP 握手头（不是帧里）：X-Api-Key / X-Api-Resource-Id /
   X-Api-Request-Id / X-Api-Connect-Id。
   ============================================================ */

import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const KEY = process.env.VOLC_API_KEY?.trim()
if (!KEY) {
  console.error('\n✖ 需要密钥：VOLC_API_KEY=xxx node scripts/_probe-volcengine-stream.mjs --file a.wav\n')
  process.exit(1)
}

/* ---------------- 端点 ---------------- */

const ENDPOINTS = {
  nostream: {
    url: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream',
    label: '单向流式（整句返回）',
    note: '官方点名适用语音输入法/语音转写',
  },
  duplex: {
    url: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
    label: '双向流式（边说边出字）',
    note: '首字最快，适合实时字幕',
  },
  async: {
    url: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
    label: '双向流式·优化版',
    note: '仅在结果变化时下发',
  },
}

// 流式识别和录音文件识别是**两套资源**，ID 不能混用。
const RESOURCE = process.env.VOLC_RESOURCE_ID?.trim() || 'volc.seedasr.sauc.duration'

/* ---------------- 参数 ---------------- */

const argv = process.argv.slice(2)
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : fallback
}

const FILE = opt('--file')
const RUNS = Math.max(1, Number.parseInt(opt('--runs', '1'), 10) || 1)
const ENDPOINT = opt('--endpoint', 'nostream')
const CHUNK_MS = Number.parseInt(opt('--chunk', '200'), 10) || 200
const MODE = opt('--mode', 'realtime') // realtime | burst
const TIMEOUT_MS = Number.parseInt(opt('--timeout', '30000'), 10) || 30000
const AS_WAV = argv.includes('--as-wav')
const NO_PUNC = argv.includes('--no-punc')
/** 打印服务端每一帧的原始 JSON —— 用来核对 result 到底是 list 还是 object。 */
const DEBUG = argv.includes('--debug')
/** 非 WAV 素材（webm/ogg/mp3…）必须显式声明容器，且要给 --duration。 */
const FORMAT_OVERRIDE = opt('--format')
const DECLARED_DURATION = Number.parseInt(opt('--duration', '0'), 10) || 0
const RATE = Number.parseInt(opt('--rate', '16000'), 10) || 16000
const BITS = Number.parseInt(opt('--bits', '16'), 10) || 16
const CHANNELS = Number.parseInt(opt('--channel', '1'), 10) || 1
/**
 * ★ 用查询串传鉴权，而不是 HTTP 头。
 *
 * 为什么必须试这个：**浏览器的 WebSocket API 不能自定义请求头**
 * （`new WebSocket(url, protocols)` 没有 headers 参数，这是标准限制）。
 * 而火山 v3 的鉴权恰恰在 `X-Api-Key` 这类头上。
 * 如果服务端不认查询串，那浏览器里就**根本连不上**，
 * 只能靠原生插件或自建代理 —— 整个方案的形态会完全不同。
 * 所以这件事必须先问清楚，再决定怎么写 App。
 */
const AUTH_IN_URL = argv.includes('--auth-in-url')

if (!FILE) {
  console.error('\n✖ 要给一个音频：--file <本地 wav>\n')
  process.exit(1)
}
if (!existsSync(resolve(FILE))) {
  console.error(`\n✖ 找不到文件：${resolve(FILE)}\n`)
  process.exit(1)
}
const ep = ENDPOINTS[ENDPOINT]
if (!ep) {
  console.error(`\n✖ 未知端点：${ENDPOINT}（可选 ${Object.keys(ENDPOINTS).join(' / ')}）\n`)
  process.exit(1)
}
if (!['realtime', 'burst'].includes(MODE)) {
  console.error(`\n✖ 未知模式：${MODE}（realtime = 按真实语速发；burst = 一口气发完）\n`)
  process.exit(1)
}

/* ---------------- WAV 解析 ---------------- */

/**
 * 拆 WAV：拿到格式 + 纯 PCM 数据。
 *
 * 为什么要拆：真实 App 里 MediaRecorder 录出来的是裸 PCM/opus，
 * 不是带 RIFF 头的 wav。声明 `format: 'pcm'` 再发裸数据，才和真机一致。
 * （--as-wav 则原样发整个文件，用来对比两种声明的差别。）
 */
function readWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return null
  let pos = 12
  let fmt = null
  let data = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(pos + 10),
        rate: buf.readUInt32LE(pos + 12),
        bits: buf.readUInt16LE(pos + 22),
      }
    }
    if (id === 'data') {
      data = buf.subarray(pos + 8, Math.min(pos + 8 + size, buf.length))
      break
    }
    pos += 8 + size + (size % 2)
  }
  return fmt && data ? { fmt, data } : null
}

/* ---------------- 二进制帧 ---------------- */

const MSG_FULL_REQUEST = 1
const MSG_AUDIO_ONLY = 2
const MSG_FULL_RESPONSE = 9
const MSG_ERROR = 15

const FLAG_NONE = 0b0000
const FLAG_POS_SEQ = 0b0001
const FLAG_LAST = 0b0010

function buildFrame({ messageType, flags = FLAG_NONE, serialization = 0, compression = 0, sequence = null, payload = Buffer.alloc(0) }) {
  const header = Buffer.alloc(4)
  header[0] = (1 << 4) | 1 // 版本 1，header 长度 1×4 = 4 字节
  header[1] = (messageType << 4) | flags
  header[2] = (serialization << 4) | compression
  header[3] = 0x00

  const parts = [header]
  // sequence 字段只在「标志位带 0b0001」时出现（正数序号，或负数序号=最后一包）
  if (flags & FLAG_POS_SEQ) {
    const b = Buffer.alloc(4)
    b.writeInt32BE(sequence ?? 0)
    parts.push(b)
  }
  const size = Buffer.alloc(4)
  size.writeUInt32BE(payload.length)
  parts.push(size, payload)
  return Buffer.concat(parts)
}

function parseFrame(buf) {
  if (buf.length < 4) return null
  const headerSize = (buf[0] & 0x0f) * 4
  const messageType = buf[1] >> 4
  const flags = buf[1] & 0x0f
  let pos = headerSize

  // error 帧的布局和普通帧**不一样**：header | 错误码(4B) | 长度(4B) | 错误文本
  if (messageType === MSG_ERROR) {
    const code = buf.readUInt32BE(pos)
    const size = buf.readUInt32BE(pos + 4)
    return { messageType, flags, code, errorText: buf.subarray(pos + 8, pos + 8 + size).toString('utf8') }
  }

  let sequence = null
  if (flags & FLAG_POS_SEQ) {
    sequence = buf.readInt32BE(pos)
    pos += 4
  }
  const size = buf.readUInt32BE(pos)
  pos += 4
  const payload = buf.subarray(pos, pos + size)
  return { messageType, flags, sequence, size, payload }
}

/* ---------------- 从响应体里取文本 ---------------- */

/**
 * ★ 文档和真实报文**不一致**，所以这里两种都认。
 *
 * 官方「双向流式」文档给的输出示例是：
 *   { "code": 0, "payload_msg": { "audio_info": {...}, "result": { "text": "..." } } }
 * 但实测线上返回的是（没有 payload_msg 这层信封）：
 *   { "audio_info": {...}, "result": { "additions": {...}, "text": "..." } }
 *
 * 只按文档写，就会静默拿到空字符串 —— 表现是「连上了、帧也收到了、
 * 最后一包也到了，就是没文本」，很容易误判成服务不可用。
 *
 * 另外 result 在不同端点上可能是 object 也可能是 list，一并兼容。
 */
function extractText(body) {
  const r = body?.result
  if (typeof r?.text === 'string') return r.text
  if (Array.isArray(r) && typeof r[0]?.text === 'string') return r[0].text
  return ''
}

/* ---------------- 一次完整会话 ---------------- */

function once({ label, clip }) {
  const WebSocket = require('ws')
  return new Promise((done) => {
    const connectId = randomUUID()
    const requestId = randomUUID()

    const t0 = Date.now()
    // 两种传鉴权的方式，二选一 —— 见 AUTH_IN_URL 的说明
    const url = AUTH_IN_URL
      ? `${ep.url}?api_key=${encodeURIComponent(KEY)}&resource_id=${encodeURIComponent(RESOURCE)}` +
        `&request_id=${requestId}&connect_id=${connectId}`
      : ep.url
    const ws = AUTH_IN_URL
      ? new WebSocket(url)
      : new WebSocket(ep.url, {
          headers: {
            'X-Api-Key': KEY,
            'X-Api-Resource-Id': RESOURCE,
            'X-Api-Request-Id': requestId,
            'X-Api-Connect-Id': connectId,
          },
        })

    let tConnected = null
    let tLastSent = null
    let tFirstText = null
    let tFinal = null
    let finalText = ''
    let lastPartial = ''
    let packets = 0
    let serverFrames = 0
    let settled = false
    const timers = []

    const fail = (why) => {
      if (settled) return
      settled = true
      timers.forEach(clearTimeout)
      try {
        ws.terminate()
      } catch {
        /* 已经断了 */
      }
      console.log(`  ✖ ${label}  ${why}`)
      done(null)
    }

    const timer = setTimeout(() => fail(`超过 ${TIMEOUT_MS}ms 还没拿到终稿（已发 ${packets} 包）`), TIMEOUT_MS)
    timers.push(timer)

    ws.on('error', (e) => {
      // 握手失败（比如资源没开通）会走到这里，带上服务端返回的头
      const res = e?.response ?? ws?._req?.res
      if (res) {
        fail(`握手被拒 HTTP ${res.statusCode}  资源=${RESOURCE}  ${JSON.stringify(res.headers ?? {})}`)
      } else {
        fail(`连接出错：${e?.message ?? e}`)
      }
    })

    ws.on('open', () => {
      tConnected = Date.now()

      // ① full client request：参数（JSON）
      const config = {
        user: { uid: 'little-writer-forest-probe' },
        audio: {
          format: clip.declared,
          codec: 'raw',
          rate: clip.fmt.rate,
          bits: clip.fmt.bits,
          channel: clip.fmt.channels,
        },
        request: {
          model_name: 'bigmodel',
          enable_itn: true,
          enable_punc: !NO_PUNC,
          enable_ddc: false,
          show_utterances: false,
        },
      }
      ws.send(
        buildFrame({
          messageType: MSG_FULL_REQUEST,
          serialization: 1, // JSON
          payload: Buffer.from(JSON.stringify(config), 'utf8'),
        }),
      )

      // ② 音频分片。按真实语速发，就是模拟「孩子边说边传」。
      // 用「总字节 / 总时长」算码率，这样 WAV 和压缩格式（webm/ogg）都能用。
      const bytesPerMs = clip.bytes.length / clip.durationMs
      const chunkBytes = Math.max(2, Math.round(bytesPerMs * CHUNK_MS))
      const chunks = []
      for (let i = 0; i < clip.bytes.length; i += chunkBytes) {
        chunks.push(clip.bytes.subarray(i, Math.min(i + chunkBytes, clip.bytes.length)))
      }

      const sendChunk = (i) => {
        if (settled) return
        const isLast = i === chunks.length - 1
        packets++
        ws.send(
          buildFrame({
            messageType: MSG_AUDIO_ONLY,
            flags: isLast ? FLAG_LAST : FLAG_NONE,
            payload: chunks[i],
          }),
          () => {
            if (isLast) tLastSent = Date.now()
          },
        )
      }

      if (MODE === 'burst') {
        chunks.forEach((_, i) => sendChunk(i))
      } else {
        chunks.forEach((_, i) => {
          timers.push(setTimeout(() => sendChunk(i), i * CHUNK_MS))
        })
      }
    })

    ws.on('message', (data) => {
      const frame = parseFrame(Buffer.from(data))
      if (!frame) return
      serverFrames++

      if (frame.messageType === MSG_ERROR) {
        fail(`服务端错误帧 code=${frame.code} ${frame.errorText}`)
        return
      }

      let msg = null
      try {
        msg = JSON.parse(frame.payload.toString('utf8'))
      } catch {
        return // 空包 / 非 JSON，正常
      }

      if (DEBUG) {
        const t = Date.now() - t0
        console.log(`    [${String(t).padStart(6)}ms] type=${frame.messageType} flags=${frame.flags} seq=${frame.sequence} ${JSON.stringify(msg).slice(0, 400)}`)
      }

      if (msg.code && msg.code !== 0) {
        const hint = msg.code === 45000001 ? '（参数无效 —— 多半是资源 ID 和服务对不上）' : ''
        fail(`服务端返回 code=${msg.code} msg=${msg.message ?? ''} ${hint}`)
        return
      }

      const body = msg?.payload_msg ?? msg
      const text = extractText(body)
      if (text.length > 0) {
        if (tFirstText === null) tFirstText = Date.now()
        lastPartial = text
      }
      // 终稿信号有两个来源：显式 is_last_package，或「最后一包」标志位。
      // 单向流式没有 is_last_package 字段，只能靠标志位。
      const lastByFlag = (frame.flags & FLAG_LAST) !== 0
      if (msg?.is_last_package === true || lastByFlag) {
        tFinal = Date.now()
        finalText = text || lastPartial
      }
    })

    ws.on('close', () => {
      if (settled) return
      if (tFinal === null) {
        fail(`连接被关闭但没拿到终稿（服务端帧数 ${serverFrames}，最后文本「${lastPartial}」）`)
        return
      }
      settled = true
      timers.forEach(clearTimeout)

      const durationMs = clip.durationMs
      console.log(
        `  ${label}  连接 ${tConnected - t0}ms  ` +
          `松手→出字 ${tFirstText ? `${tFirstText - tLastSent}ms` : '—'}  ` +
          `松手→终稿 ${tFinal - tLastSent}ms  ` +
          `包 ${packets} 服务端帧 ${serverFrames}  音频 ${durationMs}ms`,
      )
      done({ durationMs, connect: tConnected - t0, afterRelease: tFinal - tLastSent, firstAfterRelease: tFirstText ? tFirstText - tLastSent : null, text: finalText, packets, serverFrames })
    })
  })
}

/* ---------------- 组装素材 ---------------- */

/*
 * 两种素材：
 *   ① WAV   —— 拆出 RIFF 头，声明 pcm 发裸数据（模拟 AudioWorklet 采到的 PCM）
 *   ② 其它  —— 原样发，但必须用 --format 显式声明容器（webm / ogg / mp3 …）
 *
 * 为什么要支持 ②：App 里 MediaRecorder 出的是 **webm/opus**。
 * 如果流式接口能直接吃 webm，就**不用改采集链路**（省掉 AudioWorklet 那一整套），
 * 所以这件事必须先试 —— 试成了，实现风险直接降一个档次。
 */
const path = resolve(FILE)
const raw = readFileSync(path)
const wav = readWav(raw)

let clip
if (wav) {
  const bytes = AS_WAV ? raw : wav.data
  clip = {
    bytes,
    fmt: wav.fmt,
    declared: FORMAT_OVERRIDE || (AS_WAV ? 'wav' : 'pcm'),
    durationMs: Math.round((bytes.length / (wav.fmt.rate * wav.fmt.channels * (wav.fmt.bits / 8))) * 1000),
    desc: `${basename(path)}  ${(raw.length / 1024).toFixed(1)} KB  ${wav.fmt.rate}Hz ${wav.fmt.channels}ch ${wav.fmt.bits}bit`,
  }
} else if (FORMAT_OVERRIDE) {
  if (!DECLARED_DURATION) {
    console.error(`\n✖ 压缩格式算不出时长，请给 --duration <毫秒>（这段音频实际多长）\n`)
    process.exit(1)
  }
  clip = {
    bytes: raw,
    fmt: { rate: RATE, bits: BITS, channels: CHANNELS },
    declared: FORMAT_OVERRIDE,
    durationMs: DECLARED_DURATION,
    desc: `${basename(path)}  ${(raw.length / 1024).toFixed(1)} KB  原样发（声明 ${FORMAT_OVERRIDE}）`,
  }
} else {
  console.error(`\n✖ 非 WAV 素材必须显式声明容器：--format webm（并配 --duration <毫秒>）\n`)
  process.exit(1)
}

/* ---------------- 跑 ---------------- */

console.log('')
console.log(`  素材    ${clip.desc}`)
console.log(`  端点    ${ep.label}  ${ep.url}`)
console.log(`  资源    ${RESOURCE}`)
console.log(`  发送    ${MODE === 'realtime' ? `按真实语速，每 ${CHUNK_MS}ms 一包` : '一口气发完（burst）'}`)
console.log(`  声明    format=${clip.declared}  ${clip.fmt.rate}Hz ${clip.fmt.channels}ch ${clip.fmt.bits}bit`)
console.log('')

const results = []
for (let i = 0; i < RUNS; i++) {
  const r = await once({ label: RUNS > 1 ? `第 ${i + 1}/${RUNS} 次` : '结果  ', clip })
  if (!r) process.exit(1)
  results.push(r)
}

const after = results.map((r) => r.afterRelease).sort((a, b) => a - b)
const median = after.length % 2 ? after[(after.length - 1) / 2] : Math.round((after[after.length / 2 - 1] + after[after.length / 2]) / 2)

console.log('')
console.log(`  松手 → 终稿   最快 ${after[0]}ms · 中位 ${median}ms · 最慢 ${after[after.length - 1]}ms`)
const firsts = results.map((r) => r.firstAfterRelease).filter((x) => x !== null).sort((a, b) => a - b)
if (firsts.length) console.log(`  松手 → 出字   最快 ${firsts[0]}ms · 最慢 ${firsts[firsts.length - 1]}ms`)
console.log(`  建连          中位 ${results.map((r) => r.connect).sort((a, b) => a - b)[Math.floor(results.length / 2)]}ms`)
console.log(`  音频时长      ${results[0].durationMs}ms`)
console.log('')
console.log(`  文本  ${results[results.length - 1].text}`)
console.log('')
console.log(`  ⚠️ 要和「录音文件识别」（整包上传）和 SiliconFlow（整包上传）比，`)
console.log(`     看的是同一列数字：松手 → 出字。音频时长不同就不能直接比。`)
console.log('')
