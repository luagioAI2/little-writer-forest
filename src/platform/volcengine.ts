/* ============================================================
   火山引擎 · 流式语音识别（WebSocket v3 二进制协议）
   ============================================================

   和 platform/transcribe.ts 那条路的关系：

     transcribe.ts   **整包上传** —— 录完 → 传整段 → 等结果。
                     松手之后音频才开始往服务端走。
     本文件          **边说边传** —— 孩子还在说，音频已经一段段过去了。
                     松手时服务端手里已经有全部音频，只剩收尾。

   实测（同一段 5.44 秒人声，scripts/_probe-volcengine-stream.mjs）：
     整包上传（硅基流动）        松手→出字  419ms
     整包上传（火山录音文件识别） 松手→出字 2078ms   ← 更慢，别用
     火山单向流式 nostream      松手→出字  348ms
     火山双向流式 duplex        松手→出字 −4371ms  ← 首字在开口 1.1 秒时就上屏
   所以这里默认用 **duplex**：只有它是质变，其余只是把上传挪走而已。

   ------------------------------------------------------------
   帧格式（v3，整数一律**大端**）
   ------------------------------------------------------------
     [4字节 header] [4字节 payload 长度] [payload]
       （带 sequence 标志时，长度字段前面还插 4 字节序号 —— 这里不用序号）

     header[0] = (版本 1 << 4) | 1        → 0x11
     header[1] = (消息类型 << 4) | 类型标志
     header[2] = (序列化 << 4) | 压缩      → JSON 请求用 0x10
     header[3] = 0

     ★ 会话结束靠**类型标志位**（0b0010），不是某个 finish 事件。
       忘了设，服务端会一直等你发音频 —— 表现成
       「连上了、也发了、就是没结果」，很容易误判成服务不可用。

   ★ 鉴权走 HTTP 握手头，浏览器设不了 → socket 交给原生插件
     （见 ws-transport.ts 顶部说明）。
   ============================================================ */

import { connectWs, type WsTransport } from './ws-transport'
import { voiceDiag, clip } from './voice-log'

/* ---------------- 端点 ---------------- */

export type VolcEndpoint = 'duplex' | 'nostream' | 'async'

export const VOLC_ENDPOINTS: Record<VolcEndpoint, { url: string; label: string; note: string }> = {
  duplex: {
    url: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
    label: '双向流式（边说边出字）',
    note: '推荐：文字在孩子说话时就上屏，松手几乎不用等',
  },
  nostream: {
    url: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream',
    label: '单向流式（整句返回）',
    note: '准确率略高，但说完才出字，快得有限',
  },
  async: {
    url: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
    label: '双向流式·优化版',
    note: '仅在结果变化时下发，包更少',
  },
}

/** 流式识别和录音文件识别是**两套资源**，ID 不能混用 */
export const VOLC_DEFAULT_RESOURCE = 'volc.seedasr.sauc.duration'

/**
 * 生成一个随机 UUID（给 X-Api-Request-Id / X-Api-Connect-Id 用）。
 *
 * ⚠️ 不能直接用 `crypto.randomUUID()`：它要 Chrome 92+，
 *    而且只在**安全上下文**里才有。国行机（尤其没装 Google 服务的华为）
 *    WebView 版本可能很旧 —— 那时候 randomUUID 是 undefined，
 *    直接调用会在按下麦克风的瞬间抛异常，表现成"按住没反应"。
 *    服务端只要求这个值随机且唯一，不校验 UUID 版本，所以退回手工拼一个就行。
 */
function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      /* 非安全上下文会抛，落到下面的手工实现 */
    }
  }
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // 版本 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * 配置里的 model 字段在流式这条路上被复用成「选哪个端点」。
 *
 * 为什么复用：设置页已经有一个 model 输入框，再单独加一个"端点"下拉
 * 对家长是纯粹的认知负担 —— 而这三个值本来也就是三种模型形态。
 * 认不出来就回落到 duplex（唯一一个真正省时间的）。
 */
export function resolveEndpoint(model: string | undefined): VolcEndpoint {
  return model === 'nostream' || model === 'async' || model === 'duplex' ? model : 'duplex'
}

/* ---------------- 帧常量 ---------------- */

const MSG_FULL_REQUEST = 1
const MSG_AUDIO_ONLY = 2
// 9 = full server response（识别结果）、15 = error。响应侧只按 payload 处理，
// 所以只有 error 需要单独认 —— 它的帧布局和普通帧不一样。
const MSG_ERROR = 15

const FLAG_NONE = 0b0000
const FLAG_POS_SEQ = 0b0001
/** 最后一包 —— 会话的结束信号 */
const FLAG_LAST = 0b0010

export interface ParsedFrame {
  messageType: number
  flags: number
  sequence: number | null
  payload: Uint8Array
  /** 仅 error 帧有 */
  errorCode?: number
  errorText?: string
}

/**
 * 组装一帧。
 *
 * 只在需要序号时才插那 4 个字节 —— 无条件插会**整体错位**，
 * 服务端读到的是错位的长度字段，报的错完全指不到这里。
 */
export function buildFrame(opts: {
  messageType: number
  flags?: number
  serialization?: number
  payload?: Uint8Array
  sequence?: number | null
}): Uint8Array {
  const { messageType, flags = FLAG_NONE, serialization = 0, payload = new Uint8Array(0), sequence = null } = opts
  const hasSeq = (flags & FLAG_POS_SEQ) !== 0
  const head = 4 + (hasSeq ? 4 : 0) + 4
  const out = new Uint8Array(head + payload.length)
  const view = new DataView(out.buffer)

  out[0] = (1 << 4) | 1 // 版本 1，header 长度 1×4 = 4 字节
  out[1] = ((messageType << 4) | flags) & 0xff
  out[2] = ((serialization << 4) | 0) & 0xff
  out[3] = 0

  let pos = 4
  if (hasSeq) {
    view.setInt32(pos, sequence ?? 0)
    pos += 4
  }
  view.setUint32(pos, payload.length)
  pos += 4
  out.set(payload, pos)
  return out
}

/** 解析一帧。error 帧的布局和普通帧**不一样**，要分开处理 */
export function parseFrame(buf: Uint8Array): ParsedFrame | null {
  if (buf.length < 4) return null
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const headerSize = (buf[0] & 0x0f) * 4
  const messageType = buf[1] >> 4
  const flags = buf[1] & 0x0f
  let pos = headerSize

  if (messageType === MSG_ERROR) {
    if (buf.length < pos + 8) return null
    const errorCode = view.getUint32(pos)
    const size = view.getUint32(pos + 4)
    const text = buf.subarray(pos + 8, Math.min(pos + 8 + size, buf.length))
    return {
      messageType,
      flags,
      sequence: null,
      payload: new Uint8Array(0),
      errorCode,
      errorText: new TextDecoder().decode(text),
    }
  }

  let sequence: number | null = null
  if (flags & FLAG_POS_SEQ) {
    if (buf.length < pos + 4) return null
    sequence = view.getInt32(pos)
    pos += 4
  }
  if (buf.length < pos + 4) return null
  const size = view.getUint32(pos)
  pos += 4
  return { messageType, flags, sequence, payload: buf.subarray(pos, Math.min(pos + size, buf.length)) }
}

/**
 * 从响应体里取识别文本。
 *
 * ★ 文档和线上报文**不一致**，所以两种都认。
 *   官方示例写的是 `{ payload_msg: { result: { text } } }`，
 *   但线上真实报文**没有 payload_msg 这层信封**：
 *     { audio_info: {...}, result: { additions: {...}, text: "..." } }
 *   只按文档写，会静默拿到空字符串 —— 表现是"帧都收到了、就是没文本"，
 *   特别容易误判成服务不可用。（第一次跑探针就踩了，见探针注释。）
 *   另外 result 在不同端点上可能是 object 也可能是 list，一并兼容。
 */
export function extractText(body: unknown): string {
  const outer = body as { payload_msg?: unknown; result?: unknown } | null
  if (!outer) return ''
  // 线上报文没有这层信封，但文档里有 —— 两种都认
  const inner = (outer.payload_msg ?? outer) as { result?: unknown } | null
  const r = inner?.result
  if (r && typeof r === 'object') {
    const one = r as { text?: unknown }
    if (typeof one.text === 'string') return one.text
    if (Array.isArray(r) && r.length > 0) {
      const first = r[0] as { text?: unknown } | undefined
      if (typeof first?.text === 'string') return first.text
    }
  }
  return ''
}

/** 这一帧是不是终稿 */
export function isFinalFrame(frame: ParsedFrame, msg: { is_last_package?: unknown } | null): boolean {
  if (msg?.is_last_package === true) return true
  return (frame.flags & FLAG_LAST) !== 0
}

/* ---------------- 会话 ---------------- */

export interface VolcStreamConfig {
  apiKey: string
  resourceId?: string
  endpoint?: VolcEndpoint
  /** 采样率，默认 16000 */
  rate?: number
}

export interface VolcHandlers {
  /** 中间结果（边说边出字）。单向流式不会有 */
  onInterim?: (text: string) => void
  /** 已经连上、可以开始喂音频 */
  onOpen?: () => void
}

export interface VolcStream {
  /** 喂一段 PCM（16-bit 小端单声道）。socket 还没开就先攒着 */
  pushAudio: (bytes: Uint8Array) => void
  /** 结束：发最后一包，等终稿 */
  finish: () => Promise<VolcStreamResult>
  /** 主动放弃，不要结果 */
  cancel: () => void
}

export type VolcStreamResult =
  | { ok: true; text: string; ms: number }
  | {
      ok: false
      /**
       * ★ `'cancelled'` 是**故意**从 `'empty'` 里分出来的。
       *
       *   `'empty'`    = 服务端听了、就是没听清 → 上层可以拿"已经识别出来的
       *                  中间结果"兜底落进正文（总比一个字都没有强）。
       *   `'cancelled'` = **孩子自己放弃的**（手指滑出按钮 / 离开页面）→
       *                  上层**一个字都不许落**，落了就是把他不要的东西
       *                  写进他的作文。
       *
       *   以前这两种共用一个 `'empty'`，于是"放弃"和"没听清"在上层长得
       *   一模一样 —— 想给后者加兜底就必然误伤前者。这就是把它拆开的原因。
       */
      reason: 'auth' | 'network' | 'empty' | 'server' | 'not-configured' | 'cancelled'
      message: string
    }

/** 终稿最多等多久。音频已经发完了，这里只等收尾，给足 20 秒就够 */
const FINISH_TIMEOUT_MS = 20_000

/**
 * 已经有中间结果之后，最多再等终稿多久。
 *
 * ★ 为什么需要第二个、更短的上限：`FINISH_TIMEOUT_MS` 是给"一句话都没出"
 *   那种情况的兜底（20 秒），但**孩子已经看见字了**的时候不能让他再盯 20 秒。
 *   音频早就发完了，收尾实测中位 150ms；2.5 秒还没等到终稿，就说明
 *   服务端这一轮多半不会给终稿了 —— 这时候**拿已经识别出来的中间结果
 *   落进正文**，比让孩子干等、最后一无所获好得多。
 *   ⚠️ 中间结果没有终稿的标点和数字规整，所以它只是**兜底**，不是首选：
 *      终稿只要来了就一定是它赢。
 */
const FINAL_GRACE_MS = 2_500

/**
 * 设置页的「测试连接」—— 流式版。
 *
 * 只做**握手**，不发音频，因为：
 *   · 密钥对不对，在 HTTP 升级那一步就决定了（错的密钥直接 403，实测过）；
 *   · 发音频需要真实的麦克风流，设置页拿不到，也没必要。
 *
 * 所以这个测试回答的正是家长唯一关心的那个问题：
 * 「地址 / 密钥 / 资源开通了没有」。而不是识别准不准。
 */
export async function testVolcConnection(
  cfg: VolcStreamConfig,
): Promise<{ ok: boolean; message: string; ms?: number }> {
  if (!cfg.apiKey?.trim()) {
    return { ok: false, message: '请先填入密钥' }
  }
  const endpoint = cfg.endpoint ?? 'duplex'
  const resourceId = cfg.resourceId?.trim() || VOLC_DEFAULT_RESOURCE
  const t0 = Date.now()

  try {
    const transport = await connectWs(
      VOLC_ENDPOINTS[endpoint].url,
      headersFor(cfg, resourceId),
      { onOpen: () => {}, onMessage: () => {}, onError: () => {}, onClose: () => {} },
    )
    const ms = Date.now() - t0
    transport.close()
    voiceDiag('流式测试连接成功', { endpoint, resourceId, ms })
    return { ok: true, message: '连接成功，语音服务可用', ms }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    voiceDiag('流式测试连接失败', { message })
    if (/40[13]|unauthor|forbidden|denied/i.test(message)) {
      return {
        ok: false,
        message: '密钥不对，或者这个账号没开通「流式语音识别」服务',
      }
    }
    return { ok: false, message: `连不上：${message.slice(0, 120)}` }
  }
}

/* ---------------- 事件出口 ---------------- */

/**
 * 连接事件的出口。
 *
 * ★ 为什么要有这一层间接：事件**可能比会话更早**到。
 *   两条路都会踩到：
 *     · 现连 —— 插件里是先 `resolve()` 再单独 `emit("open")`，两条桥消息的
 *       先后**没有保证**，所以存在"连接已算成功、open 还没到"的窄窗口；
 *     · 预热复用 —— open 事件在"会话"出生之前就打完了，会话根本没见过它。
 *   两条路各写一份时序处理，迟早会漂移，而漂移的表现恰好是
 *   「有时候有字、有时候没有」——最难查的那种。
 *   所以两条路都把事件打到这里，由**同一份**会话逻辑处理。
 */
interface EventSink {
  open: () => void
  message: (bytes: Uint8Array) => void
  error: (message: string) => void
  close: () => void
}

/**
 * 造一个会**攒着**的出口。
 *
 * ★ 会话出生之前到达的事件全部按原顺序攒起来，会话接管（`install`）时
 *   一次性补放。**一个事件都不丢** —— 这正是老代码里那段
 *   「onOpen 有可能比 connect 的 resolve 更早」要解决的问题，
 *   只是现在两条路共用同一份解法。
 */
function createSink(): { sink: EventSink; install: (target: EventSink) => void } {
  let target: EventSink | null = null
  const backlog: Array<(t: EventSink) => void> = []
  const route = (fn: (t: EventSink) => void) => {
    if (target) fn(target)
    else backlog.push(fn)
  }
  return {
    sink: {
      open: () => route((t) => t.open()),
      message: (b) => route((t) => t.message(b)),
      error: (m) => route((t) => t.error(m)),
      close: () => route((t) => t.close()),
    },
    install: (t) => {
      target = t
      // 补放 —— 连接可能在会话出生之前就 open / 报错 / 关掉了
      for (const fn of backlog) fn(t)
      backlog.length = 0
    },
  }
}

/* ---------------- 预热连接 ---------------- */

/**
 * 预热槽 —— 进写作页时先把连接握好，孩子按下时直接复用。
 *
 * ★ 为什么值得做：按下到出字之间原本有两段固定开销 ——
 *   `getUserMedia`（开麦）和 WebSocket 握手（实测约 160ms，占冷连接
 *   总耗时的四成多）。孩子对"按下去多久有反应"极其敏感，
 *   而这两段**本来可以挪到进页面的时候**去做。
 *
 * ⚠️ 预热失败、或者这条连接后来被服务端收掉了，都**不是错误**：
 *   按下时会退回现连，也就是今天的行为。预热只负责"更快"，不负责"能用"。
 */
interface WarmSlot {
  key: string
  at: number
  promise: Promise<WsTransport>
  sink: EventSink
  install: (target: EventSink) => void
  state: { dead: boolean; opened: boolean }
}

let warmSlot: WarmSlot | null = null

/**
 * 预热连接最多留多久。
 *
 * 超过就当成"可能已经被服务端收掉了"，按下时现连。
 * ⚠️ 这个数字是**保守估计**，不是精确的服务端超时 —— 拿不准就宁可现连：
 *   现连只是慢一点，而用一条已经死掉的连接会让孩子白说一遍。
 */
const WARM_TTL_MS = 60_000

/** 同一份配置才复用：换密钥 / 换端点之后，旧连接必须丢掉 */
function warmKey(cfg: VolcStreamConfig): string {
  const endpoint = cfg.endpoint ?? 'duplex'
  return `${VOLC_ENDPOINTS[endpoint].url}|${cfg.apiKey.trim()}|${cfg.resourceId?.trim() || VOLC_DEFAULT_RESOURCE}`
}

function headersFor(cfg: VolcStreamConfig, resourceId: string): Record<string, string> {
  return {
    'X-Api-Key': cfg.apiKey.trim(),
    'X-Api-Resource-Id': resourceId,
    'X-Api-Request-Id': uuid(),
    'X-Api-Connect-Id': uuid(),
  }
}

/**
 * 提前把流式连接握好。**fire-and-forget**：不 await、不上报、不重试。
 *
 * 预热是"锦上添花"，任何情况下都不该影响录音能不能开、字能不能转出来 ——
 * 和 `warmUpTranscribe` 当年的约定一致。
 */
export function warmVolcStream(cfg: VolcStreamConfig): void {
  if (!cfg.apiKey?.trim()) return
  const key = warmKey(cfg)
  // 已经有一条同配置、还活着的，就别再开第二条（白占服务端资源）
  if (warmSlot && warmSlot.key === key && !warmSlot.state.dead) return
  dropWarmSlot()

  const endpoint = cfg.endpoint ?? 'duplex'
  const resourceId = cfg.resourceId?.trim() || VOLC_DEFAULT_RESOURCE
  const t0 = Date.now()
  const { sink, install } = createSink()
  const state = { dead: false, opened: false }

  warmSlot = {
    key,
    at: t0,
    sink,
    install,
    state,
    promise: connectWs(VOLC_ENDPOINTS[endpoint].url, headersFor(cfg, resourceId), {
      onOpen: () => {
        state.opened = true
        sink.open()
      },
      onMessage: (b) => sink.message(b),
      onError: (m) => {
        state.dead = true
        sink.error(m)
      },
      onClose: () => {
        state.dead = true
        sink.close()
      },
    }),
  }

  const slot = warmSlot
  slot.promise
    .then(() => voiceDiag('流式连接已预热', { endpoint, ms: Date.now() - t0 }))
    .catch((err) => {
      state.dead = true
      voiceDiag('预热失败（不影响录音，按下时会现连）', {
        message: err instanceof Error ? err.message : String(err),
      })
    })
}

function dropWarmSlot(): void {
  const s = warmSlot
  warmSlot = null
  if (!s) return
  void s.promise.then((t) => t.close()).catch(() => {})
}

/**
 * 主动把预热的那条连接收掉 —— **离开写作页时调**。
 *
 * 不收的话它会一直挂到 `WARM_TTL_MS` 过期，白占一条 socket 和服务端资源。
 * 刻意做成"随时可调、可重复调"：没有预热连接时就是空操作。
 */
export function dropWarmVolcStream(): void {
  dropWarmSlot()
}

/** 取走预热好的连接。没有 / 过期 / 已经死了 → 返回 null，调用方现连 */
function takeWarmSlot(cfg: VolcStreamConfig): WarmSlot | null {
  const s = warmSlot
  if (!s) return null
  if (s.key !== warmKey(cfg) || s.state.dead || Date.now() - s.at > WARM_TTL_MS) {
    dropWarmSlot()
    return null
  }
  warmSlot = null
  return s
}

/* ---------------- 会话 ---------------- */

/**
 * 把一条**已经握好手**的连接包成一个可用的会话。
 *
 * 刻意和 `openVolcStream` 分开：连接怎么来的（预热复用 / 现连）和
 * 会话怎么跑（分帧、事件、取文本）是两件事，混在一起就又要写两份时序。
 */
function createVolcSession(args: {
  install: (target: EventSink) => void
  handlers: VolcHandlers
  endpoint: VolcEndpoint
  resourceId: string
  rate: number
  t0: number
}): { stream: VolcStream; attach: (transport: WsTransport, alreadyOpen: boolean) => void } {
  const { install, handlers, endpoint, resourceId, rate, t0 } = args

  let transport: WsTransport | null = null
  let opened = false
  let finished = false
  let cancelled = false
  let lastText = ''
  let firstTextAt: number | null = null
  /**
   * 松手时 socket 还没 open 的情况。
   *
   * ★ 这是个**真实的窄窗口**，不是理论问题：原生插件是在 onOpen 里才
   *   resolve connect 的，而 `open` 事件是紧接着**另外发**的一条消息。
   *   两条消息到 JS 侧的先后顺序没有保证 —— 所以存在"连接已算成功、
   *   但 opened 还是 false"的一小段。
   *   这段里松手的话，finish() 当时没东西可发，只能记下这个意图，
   *   等 onOpen 时补发最后一包。不补的话服务端会一直等音频，
   *   表现成**用户白等满 20 秒然后报超时**（音频其实早就到了）。
   */
  let finishRequested = false
  /** 最后一包只能发一次 —— finish() 可能被调两遍（松手 + 卸载） */
  let lastPacketSent = false

  /** socket 还没开时先攒着 —— 孩子可能按下的瞬间就说话，比连接还早 */
  const pending: Uint8Array[] = []
  /** 出站缓冲 —— transport 还没赋值时先接住（onOpen 可能比 attach 更早） */
  const outbox: Uint8Array[] = []

  let settle: ((r: VolcStreamResult) => void) | null = null
  const result = new Promise<VolcStreamResult>((resolve) => {
    settle = resolve
  })
  let timer: ReturnType<typeof setTimeout> | null = null
  /** 已经有中间结果时的第二个、更短的上限（见 FINAL_GRACE_MS） */
  let graceTimer: ReturnType<typeof setTimeout> | null = null
  let configSent = false

  const clearTimers = () => {
    if (timer) clearTimeout(timer)
    if (graceTimer) clearTimeout(graceTimer)
    timer = null
    graceTimer = null
  }

  const done = (r: VolcStreamResult) => {
    if (finished) return
    finished = true
    clearTimers()
    try {
      transport?.close()
    } catch {
      /* 已经断了 */
    }
    settle?.(r)
  }

  const sendFrame = (bytes: Uint8Array) => {
    // transport 还没赋值就先攒着 —— 见 outbox 的说明
    if (!transport) {
      outbox.push(bytes)
      return
    }
    transport.send(bytes)
  }

  const sendConfig = () => {
    if (configSent) return
    configSent = true
    const config = {
      user: { uid: 'little-writer-forest' },
      audio: { format: 'pcm', codec: 'raw', rate, bits: 16, channel: 1 },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
        enable_ddc: false,
        show_utterances: false,
      },
    }
    sendFrame(
      buildFrame({
        messageType: MSG_FULL_REQUEST,
        serialization: 1, // JSON
        payload: new TextEncoder().encode(JSON.stringify(config)),
      }),
    )
  }

  const flushPending = () => {
    while (pending.length > 0) {
      const chunk = pending.shift()
      if (chunk) sendFrame(buildFrame({ messageType: MSG_AUDIO_ONLY, payload: chunk }))
    }
  }

  /**
   * 收尾：把攒下的音频发完，再发最后一包。
   *
   * ★ 最后一包：flags 置 0b0010。忘了设服务端会一直等音频，
   *   表现成"连上了、也发了、就是没结果"。
   *
   * 用 lastPacketSent 兜住重复调用：finish() 有可能被调两次
   * （松手 + 组件卸载），发两包结束信号服务端会当成协议错。
   */
  const sendLastPacket = () => {
    if (lastPacketSent) return
    lastPacketSent = true
    flushPending()
    sendFrame(buildFrame({ messageType: MSG_AUDIO_ONLY, flags: FLAG_LAST, payload: new Uint8Array(0) }))
    voiceDiag('流式已发最后一包', { ms: Date.now() - t0 })
  }

  const onOpen = () => {
    opened = true
    voiceDiag('流式已连上', { endpoint, resourceId, ms: Date.now() - t0 })
    sendConfig()
    flushPending()
    // 松手比这个事件还早的窄窗口 —— 见 finishRequested 的说明。
    // 不补这一下，服务端会一直等音频，用户白等满 20 秒超时。
    if (finishRequested) sendLastPacket()
    handlers.onOpen?.()
  }

  const onMessage = (bytes: Uint8Array) => {
    const frame = parseFrame(bytes)
    if (!frame) return

    if (frame.messageType === MSG_ERROR) {
      voiceDiag('流式服务端错误帧', { code: frame.errorCode, text: frame.errorText?.slice(0, 160) })
      done({
        ok: false,
        reason: 'server',
        message: `语音服务拒绝了这次连接（${frame.errorCode ?? '?'}）${frame.errorText ? `：${frame.errorText.slice(0, 80)}` : ''}`,
      })
      return
    }

    let msg: { code?: number; message?: string; is_last_package?: unknown } | null = null
    try {
      msg = JSON.parse(new TextDecoder().decode(frame.payload))
    } catch {
      return // 空包 / 非 JSON，正常
    }
    if (!msg) return

    if (msg.code && msg.code !== 0) {
      voiceDiag('流式服务端返回错误码', { code: msg.code, message: msg.message })
      done({ ok: false, reason: 'server', message: msg.message || `语音服务出错了（${msg.code}）` })
      return
    }

    // 文档与线上不一致，两种信封 extractText 都认 —— 见它的说明
    const text = extractText(msg)
    if (text.length > 0 && text !== lastText) {
      if (firstTextAt === null) firstTextAt = Date.now()
      lastText = text
      handlers.onInterim?.(text)
      /* ★ 已经有字了 —— 把"等终稿"的上限从 20 秒收紧到 FINAL_GRACE_MS。
         孩子已经看见字了，不该再让他盯着「正在转成文字…」干等 20 秒。
         终稿只要来了就一定赢（下面那支会 done），这里只是兜底。 */
      if (!graceTimer && !finished) {
        graceTimer = setTimeout(() => {
          voiceDiag('终稿没等到，用已经识别出来的中间结果兜底', {
            graceMs: FINAL_GRACE_MS,
            字数: lastText.length,
          })
          done({ ok: true, text: lastText, ms: Date.now() - t0 })
        }, FINAL_GRACE_MS)
      }
    }

    if (isFinalFrame(frame, msg)) {
      const ms = Date.now() - t0
      voiceDiag('流式终稿', {
        ms,
        首字ms: firstTextAt === null ? undefined : firstTextAt - t0,
        字数: text.length,
        文本: clip(text || lastText),
      })
      const finalText = text || lastText
      if (!finalText) {
        done({ ok: false, reason: 'empty', message: '没听清，再说一遍试试' })
        return
      }
      done({ ok: true, text: finalText, ms })
    }
  }

  const onError = (message: string) => {
    voiceDiag('流式连接出错', { message })
    const auth = /40[13]|unauthor|forbidden|denied/i.test(message)
    done({
      ok: false,
      reason: auth ? 'auth' : 'network',
      message: auth
        ? '语音服务的密钥不对或没开通，去家长管理里检查一下'
        : '网络不太顺，检查下网络再试',
    })
  }

  const onClose = () => {
    // 正常收尾是我们自己 close 的；没拿到终稿就被关掉才算异常
    if (finished) return
    voiceDiag('流式被关闭但没拿到终稿', { ms: Date.now() - t0, 最后文本: clip(lastText) })
    done(
      lastText
        ? { ok: true, text: lastText, ms: Date.now() - t0 }
        : { ok: false, reason: 'network', message: '语音服务断开连接了，再试一次' },
    )
  }

  /* ★ 接管事件出口 —— **同步**做完。
     之后调用方读 `state.opened` / 再 attach 时，才不会漏掉任何一个事件：
     先到的那些已经被 createSink 攒着，在这里一次性补放。 */
  install({ open: onOpen, message: onMessage, error: onError, close: onClose })

  const stream: VolcStream = {
    pushAudio: (bytes) => {
      if (finished || cancelled) return
      if (!opened) {
        pending.push(bytes)
        return
      }
      sendFrame(buildFrame({ messageType: MSG_AUDIO_ONLY, payload: bytes }))
    },

    finish: () => {
      if (cancelled) {
        return Promise.resolve<VolcStreamResult>({
          ok: false,
          reason: 'cancelled',
          message: '这次不算，再说一次吧',
        })
      }
      if (finished) return result
      finishRequested = true

      // ★ 最后一包：flags 置 0b0010。忘了设服务端会一直等音频，
      //   表现成"连上了、也发了、就是没结果"。
      //   还没 open 就先不发 —— onOpen 里会补上（见 finishRequested）。
      if (opened) sendLastPacket()

      timer = setTimeout(() => {
        voiceDiag('流式终稿超时', { timeoutMs: FINISH_TIMEOUT_MS, 最后文本: clip(lastText) })
        done(
          lastText
            ? { ok: true, text: lastText, ms: Date.now() - t0 }
            : { ok: false, reason: 'network', message: '转写超时了，检查下网络' },
        )
      }, FINISH_TIMEOUT_MS)

      return result
    },

    cancel: () => {
      cancelled = true
      clearTimers()
      try {
        transport?.close()
      } catch {
        /* 已经断了 */
      }
    },
  }

  /**
   * 把连接交给会话。
   *
   * ⚠️ `alreadyOpen` 由调用方在**会话建好之后、同一个同步块里**读出来 ——
   *    中间不能有 await，否则 `open` 事件可能正好挤进那条缝里，
   *    结果两边都以为自己没处理（字就没了）。
   */
  const attach = (t: WsTransport, alreadyOpen: boolean) => {
    transport = t
    /* transport 到位了：把 onOpen 抢跑时攒下的帧按**原顺序**补发。
       （onOpen 有可能比 attach 更早，那一刻 sendConfig 无 transport 可用。） */
    for (const f of outbox) t.send(f)
    outbox.length = 0
    // 预热复用的那条连接，open 事件早就打完了 —— 这里补一次
    if (alreadyOpen && !opened) onOpen()
  }

  return { stream, attach }
}

export async function openVolcStream(
  cfg: VolcStreamConfig,
  handlers: VolcHandlers = {},
): Promise<VolcStream> {
  const endpoint = cfg.endpoint ?? 'duplex'
  const resourceId = cfg.resourceId?.trim() || VOLC_DEFAULT_RESOURCE
  const rate = cfg.rate ?? 16_000
  const t0 = Date.now()

  /* ★ 先看有没有预热好的连接。取到就复用（连在途的那条也一起等），
     取不到就现连 —— 现连那条路和以前逐字节一样，预热只负责"更快"。 */
  const warm = takeWarmSlot(cfg)
  let transport: WsTransport | null = null
  let sink: EventSink
  let install: (target: EventSink) => void

  if (warm) {
    sink = warm.sink
    install = warm.install
    try {
      transport = await warm.promise
    } catch {
      transport = null
    }
    if (transport && warm.state.dead) {
      // 握上手之后又断了：这条不能用，退回现连
      try {
        transport.close()
      } catch {
        /* 已经断了 */
      }
      transport = null
    }
    voiceDiag(transport ? '复用预热的连接' : '预热连接不可用，改现连', {
      endpoint,
      预热ms: Date.now() - warm.at,
    })
  } else {
    const made = createSink()
    sink = made.sink
    install = made.install
  }

  if (!transport) {
    try {
      transport = await connectWs(VOLC_ENDPOINTS[endpoint].url, headersFor(cfg, resourceId), {
        onOpen: () => sink.open(),
        onMessage: (b) => sink.message(b),
        onError: (m) => sink.error(m),
        onClose: () => sink.close(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      voiceDiag('流式连不上', { message })
      const auth = /40[13]|unauthor|forbidden|denied/i.test(message)
      return {
        pushAudio: () => {},
        cancel: () => {},
        finish: async () => ({
          ok: false,
          reason: auth ? 'auth' : 'network',
          message: auth
            ? '语音服务的密钥不对或没开通，去家长管理里检查一下'
            : '连不上语音服务，检查下网络再试',
        }),
      }
    }
  }

  /* ⚠️ 顺序：先建会话（它**同步**接管 sink 并补放攒下的事件），
     再读 `warm.state.opened`，最后 attach。中间不能有 await ——
     否则 open 事件可能挤进缝里，两边都以为自己没处理。 */
  const session = createVolcSession({ install, handlers, endpoint, resourceId, rate, t0 })
  session.attach(transport, warm ? warm.state.opened : false)
  return session.stream
}
