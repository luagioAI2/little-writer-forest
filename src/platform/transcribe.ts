/* ============================================================
   语音转写（录音 → 文字）—— 云端那一半
   ============================================================

   为什么需要它：
   安卓上原本用系统 SpeechRecognizer 做识别，但**国行机（华为等）上
   系统可能根本没有可用的识别服务** —— isRecognitionAvailable() 返回 true
   也照样一条结果都不回。表现就是"录音在跑、文字一个字都没有"。
   这是设备侧的墙，改代码翻不过去。

   所以再加一条**不依赖手机系统**的通路：
     录下音频 → 上传到云端识别 → 拿回文字

   为什么不用聊天大模型做这件事：
     对话模型（DeepSeek 等）没有 /audio/transcriptions 接口、也不收音频，
     它做不了语音识别。转写要用**专门的语音识别模型**
     （SenseVoice / Whisper 这类）。两者是不同的东西。
     大模型继续管它的老本行：出题、评分、写范文。

   接口按 OpenAI Whisper 的标准形状实现，所以这些都能直接用：
     硅基流动  FunAudioLLM/SenseVoiceSmall（免费，中文好，国内直连）
     OpenAI    whisper-1
     本地服务  whisper.cpp / faster-whisper 起的兼容网关
   ——换服务商只要改设置页里的地址和模型名，代码不用动。

   请求形状（multipart/form-data）：
     POST {baseUrl}/audio/transcriptions
     Authorization: Bearer <key>
     file:  <音频二进制>
     model: <模型名>
   响应：{ "text": "转写结果" }
   ============================================================ */

/** 语音转写的配置 —— 与聊天用的 AiConfig 分开，因为可以指向不同的服务商。
 *  类型定义在 domain/types.ts（设置要存进数据库，那边才是单一来源）。 */
import type { TranscribeConfig } from '../domain/types'
import { voiceDiag, clip } from './voice-log'
// 流式能力判定住在 ws-transport（那里才知道原生 socket 插件在不在）。
// 依赖方向是 transcribe → ws-transport，单向，不构成环。
import { isStreamingSupported } from './ws-transport'

export type { TranscribeConfig }

export interface TranscribeOk {
  ok: true
  text: string
  /** 往返耗时（毫秒），用于界面显示"转写用了多久" */
  ms: number
}

export interface TranscribeFail {
  ok: false
  /** 直接可以显示给孩子/家长看的中文原因 */
  message: string
  /** 机器可读的原因，便于上层决定怎么降级 */
  reason: 'not-configured' | 'too-short' | 'too-long' | 'too-big' | 'auth' | 'quota' | 'network' | 'server' | 'empty'
}

export type TranscribeResult = TranscribeOk | TranscribeFail

/* ---------------- 限制（来自服务端约定，超了会被直接拒绝，所以先在本地拦） ---------------- */

/** 单文件最长时长（服务端限 1 小时；孩子口述远达不到，这里收得更紧以便早点提示） */
export const MAX_AUDIO_MS = 10 * 60 * 1000
/** 单文件最大体积（服务端限 50MB） */
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024
/**
 * 太短的录音不必上传。
 * 按住说话时误触很常见（手滑点一下），传上去只会拿回一句莫名其妙的话，
 * 白花一次请求。低于这个时长直接让用户重说。
 */
export const MIN_AUDIO_MS = 600

/** 默认超时：转写比聊天慢，给足时间 */
const DEFAULT_TIMEOUT_MS = 60_000

/** 配置齐了没 */
export function isTranscribeConfigured(cfg: TranscribeConfig | undefined | null): boolean {
  if (!cfg) return false
  // 流式那条路只需要密钥：地址和资源 ID 都内置了，家长不用填
  if (cfg.engine === 'volcengine') return Boolean(cfg.apiKey?.trim())
  return Boolean(cfg.baseUrl?.trim() && cfg.apiKey?.trim() && cfg.model?.trim())
}

/** 这条配置是不是走「边说边传」的流式 */
export function usesStreamingEngine(cfg: TranscribeConfig | undefined | null): boolean {
  return cfg?.engine === 'volcengine'
}

/**
 * 这台设备 + 这份配置，能不能用「按住说话」。
 *
 * ★ **这个判定只许有这一份。** 它同时决定两件事：
 *     · `VoiceComposer` 那个麦克风按钮是「按住说话」还是「点一下开始」；
 *     · 新手引导第二屏教孩子**哪个手势**。
 *   两处各写一遍，就会出现"引导教按住、按钮却是点击"——
 *   孩子按住不动，界面毫无反应，于是认定麦克风坏了。
 *   那正是这个引导存在的理由（见 Guide.tsx 文件头），自己把它搞砸最讽刺。
 *
 * ⚠️ 流式不可用时**不能**盲目退回整包上传：默认配置只填了火山那一份密钥，
 *    硅基流动那边是空的，退过去只会让孩子按住等一个注定失败的请求。
 *    所以只有「配置本来就是整包上传」时才认那条路；其余老实返回 false，
 *    让界面显示点击那套 —— 这比假装能用诚实。
 *
 * 流式（火山）只在**原生 App** 里能用：浏览器的 WebSocket 设不了请求头
 * （见 ws-transport.ts）。所以桌面/网页上这里一定是 false。
 */
export function canHoldToTalk(cfg: TranscribeConfig | undefined | null): boolean {
  if (!isTranscribeConfigured(cfg)) return false
  if (!usesStreamingEngine(cfg)) return true
  return isStreamingSupported()
}

/* ============================================================
   内置密钥 —— ⚠️ 读这段再改
   ------------------------------------------------------------
   密钥**不在仓库里**了：构建时从环境变量读（`.env.local` 的
   `VITE_VOLC_API_KEY`），仓库里只留 `.env.example` 的占位。

   为什么改成这样：明文写在这行 = 密钥**打进 APK 就等于公开**。
   任何人拿到包 `strings` 一下就能抠出来，而火山是按音频时长计费的
   （¥66 / 30 小时），被人拿去刷就是直接烧钱。
   （这段注释原来就写着"要对外发就挪到构建期注入" —— 现在照做了。
     同一套做法见 `domain/ai.ts` 的 `AI_TEST_API_KEY`。）

   ★ 空值语义（**和 `AI_TEST_API_KEY` 保持一致，别改成报错**）：
     没配 → 就是空串 → `isTranscribeConfigured()` 返回 false
     → 界面退回系统识别（`canHoldToTalk` 也是 false，会教"点一下"）。
     **降级，不崩、不报错** —— 和「留空 = 走本地规则」是同一条约定。

   本地开发/打包：把真实密钥放进 `.env.local`（已被 .gitignore 忽略）。
   换密钥改 `.env.local` 那一行，代码不用动。
   设置页里也能随时覆盖（覆盖后以设置为准）。
   ============================================================ */
export const VOLC_TEST_API_KEY: string = import.meta.env.VITE_VOLC_API_KEY ?? ''

/**
 * 默认配置 —— 现在默认走**火山流式（边说边传）**，密钥已内置。
 *
 * 为什么把默认从硅基流动换成火山：
 *   实测同一段 5.44 秒人声（scripts/_probe-volcengine-stream.mjs）——
 *     硅基流动 整包上传        松手→出字  419ms，说完才出字
 *     火山 双向流式 duplex     松手→出字 −4371ms，**说话时字就上屏了**，
 *                              松手后只剩 150ms 收尾
 *   不是"模型更快"，是**把上传和识别都挪出了关键路径**。
 *
 * 代价：从免费变成按量计费（¥2.2 / 小时音频）。
 */
export function defaultTranscribeConfig(): TranscribeConfig {
  return {
    engine: 'volcengine',
    baseUrl: '',
    apiKey: VOLC_TEST_API_KEY,
    model: 'bigmodel',
    resourceId: 'volc.seedasr.sauc.duration',
  }
}

/**
 * 硅基流动那套的默认值（整包上传）。
 *
 * 留着它，是因为流式**只在手机 App 里能用** ——
 * 浏览器的 WebSocket 设不了请求头，连不上火山（见 ws-transport.ts）。
 * 桌面开发、或者想换回免费方案时，用这一份。
 */
export function openAiTranscribeConfig(): TranscribeConfig {
  return {
    engine: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: '',
    model: 'Qwen/Qwen3-ASR-1.7B',
  }
}

/**
 * 把音频 blob 转成文字。
 *
 * 调用方拿到结果后，**不要把文字直接塞进正文** ——
 * 应该交给和系统识别路径**同一个** onFinal 处理函数，
 * 这样"说作文就追加、改作文就解析指令"的规则只有一份，不会两边漂移。
 */
export async function transcribeAudio(
  blob: Blob,
  cfg: TranscribeConfig,
  opts: { durationMs?: number; timeoutMs?: number; signal?: AbortSignal; fileName?: string } = {},
): Promise<TranscribeResult> {
  if (!isTranscribeConfigured(cfg)) {
    return { ok: false, reason: 'not-configured', message: '还没配置语音转写服务，去家长管理里填一下' }
  }

  const duration = opts.durationMs ?? 0
  if (duration > 0 && duration < MIN_AUDIO_MS) {
    return { ok: false, reason: 'too-short', message: '说得太短了，按住多说几个字' }
  }
  if (duration > MAX_AUDIO_MS) {
    return { ok: false, reason: 'too-long', message: '一次说得太久了，分成几段来说吧' }
  }
  if (blob.size === 0) {
    return { ok: false, reason: 'empty', message: '没有录到声音，再试一次' }
  }
  if (blob.size > MAX_AUDIO_BYTES) {
    return { ok: false, reason: 'too-big', message: '这段录音太大了，分成几段来说吧' }
  }

  const url = cfg.baseUrl.replace(/\/+$/, '') + '/audio/transcriptions'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  const t0 = Date.now()
  try {
    const form = new FormData()
    // 文件名要带扩展名：部分服务端靠它判断编码格式
    const fileName = opts.fileName ?? guessFileName(blob.type)
    form.append('file', blob, fileName)
    form.append('model', cfg.model.trim())

    voiceDiag('上传', {
      model: cfg.model.trim(),
      file: fileName,
      bytes: blob.size,
      durationMs: duration || undefined,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey.trim()}` },
      // ★ 千万不要自己设 Content-Type：
      //   浏览器要在 multipart 后面补 boundary，手写会把 boundary 弄丢，
      //   服务端只会回一句语焉不详的 400。
      body: form,
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const err = classifyHttpError(res.status, body)
      voiceDiag('服务端拒绝', { status: res.status, reason: err.reason, body: body.slice(0, 160) })
      return { ok: false, ...err }
    }

    const json = (await res.json().catch(() => null)) as { text?: unknown } | null
    const text = typeof json?.text === 'string' ? json.text.trim() : ''
    if (!text) {
      voiceDiag('服务端回话了但没听出内容（配置本身没问题）', { ms: Date.now() - t0 })
      return { ok: false, reason: 'empty', message: '没听清，再说一遍试试' }
    }
    const ms = Date.now() - t0
    voiceDiag('成功', { ms, chars: text.length, text: clip(text) })
    return { ok: true, text, ms }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    voiceDiag('网络失败', { aborted, ms: Date.now() - t0, err: String(err) })
    return {
      ok: false,
      reason: 'network',
      message: aborted ? '转写超时了，检查下网络' : '网络不太顺，检查下网络再试',
    }
  } finally {
    clearTimeout(timer)
  }
}

/* ---------------- 诊断日志 ---------------- */

/*
 * 转写这条路**唯一无法在电脑上验完**：它依赖真机麦克风、WebView 的录音实现、
 * 以及手机的实时网络。而它一旦坏，界面上只表现为"按住说了，一个字没出来" ——
 * 看不出是没录到、没传出去、还是服务端没回话。
 *
 * 所以这条路上必须留下可读的痕迹，否则真机出问题只能靠猜。
 * 日志本身放在 ./voice-log（录音器和按住说话按钮也要用同一套），这里只是转出去，
 * 让老代码 `import { voiceDiag } from './transcribe'` 继续能用。
 */
export { voiceDiag, clip, VOICE_LOG_TAG } from './voice-log'

/**
 * 第一次尝试该给多久。
 *
 * ⚠️ 这里原来写死 60 秒，是整条路上**最伤体验**的一处，而且不显眼。
 *
 * 实测（真接口、同一段 5.4 秒人声、连打 15 次，webm/opus 也就是 App 真发的格式）：
 *   最快 330ms · 中位 419ms · 最慢 652ms
 * —— 也就是说，**正常一次只要 0.4 秒**。
 *
 * 而服务端**会偶发地完全不理人**（不是配置问题，同一段音频再发一次就好）：
 *   · 基准测试里 XingChenASR-Diarize 两次都超时；
 *   · SenseVoice 同一段音频第一次 8.4 秒、第二次 48.7 秒才回；
 *   · 代码注释里更早还记过一次"第一次挂 25 秒、第二次 0.6 秒就回来"。
 *
 * 于是写死 60 秒的后果是：**碰上一次抖动，就让孩子盯着"正在转成文字…"
 * 等满 60 秒**，然后重试 —— 而重试通常 0.4 秒就回来了。
 * 最坏情况是最佳情况的 150 倍，原因只是"第一枪等得太久"。
 *
 * 所以改成按音频长度给预算：
 *   · 固定 10 秒 —— 覆盖建连 + 上传 + 回包（实测这三项合计 < 0.5 秒，
 *     留 20 倍余量给弱网）；
 *   · 每音频秒再加 0.5 秒 —— 实测推理成本约 0.13 秒/音频秒
 *     （服务器忙时最坏到 0.19 秒/音频秒），0.5 已经是 4 倍余量；
 *   · 下限 12 秒（再短就纯属误伤），上限仍是 60 秒（长录音不会被我憋死）。
 *
 * 效果：说 5 秒 → 12.5 秒；说 10 秒 → 15 秒；说 30 秒 → 25 秒；说 60 秒 → 40 秒。
 */
function firstTimeoutMs(durationMs: number): number {
  const budget = 10_000 + Math.max(0, durationMs) * 0.5
  return Math.min(DEFAULT_TIMEOUT_MS, Math.max(12_000, Math.round(budget)))
}

/* ---------------- 预热连接 ---------------- */

/**
 * 预热连接：把 DNS / TCP / TLS 的握手提前做掉。
 *
 * **为什么值得做（实测，不是想当然）：**
 * 把一次转写拆开量（`scripts/_probe-latency.mjs`，同一段 5.44 秒人声，各 6 次）：
 *
 *   冷连接（每次重新握手）   中位 **375ms**
 *   热连接（复用同一条）     中位 **214ms**   →  省 161ms
 *
 * 也就是说**握手占了四成多**，而且这 161ms 花在"证明我是我"上，
 * 跟识别一点关系都没有。
 *
 * 更关键的是：这 161ms 是**可以完全藏起来**的 ——
 * 孩子按下按钮到松手之间通常有 2~10 秒，这段时间足够把连接建好了。
 * 于是孩子松手时，请求走的是已经热好的连接。
 *
 * **只对"本次会话的第一次"有用**：浏览器（WebView）会 keep-alive，
 * 后续几次本来就是热连接（实测 HTTP/1.1 + keep-alive，复用生效）。
 * 但第一次恰恰是最容易让人失望的那次 —— 孩子刚打开 App 就按下去说话。
 *
 * 用 `GET {baseUrl}/models` 而不是发一段音频去探：
 *   · 它是个正常的 GET 元数据接口，**不消耗转写配额**，也不会留下识别记录；
 *   · 自己只要 ~160ms，但它是**和说话并行**跑的，不占孩子的等待时间；
 *   · 就算这个地址上没有 /models（比如自建的 whisper 网关），
 *     TCP/TLS 握手也已经发生了 —— 该预热的目的照样达到，
 *     所以失败**不需要报错**。
 *
 * 刻意做成 fire-and-forget：预热是"锦上添花"，任何情况下都不该
 * 影响录音能不能开、字能不能转出来。所以不 await、不上报、不重试。
 */
export function warmUpTranscribe(cfg: TranscribeConfig | undefined | null): void {
  if (!isTranscribeConfigured(cfg) || !cfg) return
  // 流式那条路没有 HTTP 端点可预热：它一按下就把 WebSocket 连上了，
  // 握手时间本来就和说话并行。在这里发一个不存在的请求纯属浪费。
  if (usesStreamingEngine(cfg)) return
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/models'
  const t0 = Date.now()
  void fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cfg.apiKey.trim()}` },
  })
    .then(() => voiceDiag('预热完成', { ms: Date.now() - t0 }))
    .catch(() => {
      /* 预热失败无所谓：真正的转写会自己建连接 */
      voiceDiag('预热失败（不影响转写）', { ms: Date.now() - t0 })
    })
}

/* ---------------- 带重试的入口 ---------------- */

/**
 * 转写，失败时自动重试。
 *
 * 为什么需要重试（实测结论，不是防御性编程）：
 *   云端识别接口**会偶发地不返回响应** —— 同一段音频、同一个模型，
 *   第一次挂住 25 秒没动静，第二次 0.6 秒就回来了。
 *   这不是配置错误，是服务端的偶发抖动。
 *
 * 对孩子来说，"等 20 秒然后失败"和"等 0.6 秒拿到字"差别巨大，
 * 而这两者的区别往往只是**再发一次**。
 *
 * 重试策略（刻意保守）：
 *   · 只重试 `network`（超时/连接失败）—— 这是抖动唯一的表现形式；
 *   · 不重试 `auth` / `quota` / `too-*` —— 重试多少次都一样，白白让孩子多等；
 *   · 不重试 `empty` —— 服务端明确回话了，就是没听清，重试也是同样结果；
 *   · 每次超时递减（第一次按音频长度算，之后都是 12 秒），
 *     因为已经知道这个服务可能不理人，没必要让第二枪也押上很久；
 *     第一次到底给多久、为什么不能写死 60 秒，见 firstTimeoutMs 的说明。
 */
export async function transcribeWithRetry(
  blob: Blob,
  cfg: TranscribeConfig,
  opts: { durationMs?: number; signal?: AbortSignal; fileName?: string; attempts?: number } = {},
): Promise<TranscribeResult> {
  const attempts = Math.max(1, opts.attempts ?? 2)
  // 第一次按音频长度给（见 firstTimeoutMs 上面的实测说明）；
  // 后续缩到 12 秒 —— 已经知道这个服务可能不理人，没必要让第二枪也押上很久
  const timeouts = [firstTimeoutMs(opts.durationMs ?? 0), 12_000, 12_000]
  const t0 = Date.now()

  let last: TranscribeResult = { ok: false, reason: 'network', message: '网络不太顺，检查下网络再试' }

  for (let i = 0; i < attempts; i++) {
    // 本地守卫类的原因（太短/太大/没配）重试没有意义，第一次就返回
    const timeoutMs = timeouts[Math.min(i, timeouts.length - 1)]
    if (i > 0) voiceDiag('重试', { 第几次: i + 1, 共: attempts, timeoutMs })

    last = await transcribeAudio(blob, cfg, {
      durationMs: opts.durationMs,
      timeoutMs,
      signal: opts.signal,
      fileName: opts.fileName,
    })
    if (last.ok) {
      // 把总耗时（含重试等待）如实报出来，界面上的"用了多久"才是真的
      return { ...last, ms: Date.now() - t0 }
    }
    if (last.reason !== 'network') return last
  }

  // 走到这里说明每一枪都是网络问题。真机上这几乎只有两种可能：
  // 手机网络本身不通，或者服务端把我们挡了（超时/无响应）。
  // 把总耗时打出来，"是压根没发出去"还是"发出去了但一直等"就分得清了。
  voiceDiag('全部尝试都失败', { 共尝试: attempts, 总耗时ms: Date.now() - t0, reason: last.reason })
  return last
}

/** 按 HTTP 状态码给出人话，并归到一个可编程判断的 reason */
function classifyHttpError(status: number, body: string): { reason: TranscribeFail['reason']; message: string } {
  if (status === 401 || status === 403) {
    return { reason: 'auth', message: '语音服务的密钥不对，去家长管理里检查一下' }
  }
  if (status === 429) {
    return { reason: 'quota', message: '语音服务忙不过来了，等一下再试' }
  }
  if (status >= 500) {
    return { reason: 'server', message: '语音服务暂时出问题了，等一下再试' }
  }
  // 400 通常是我们发的东西不合服务端口味（格式/模型名）
  const hint = body ? `：${body.slice(0, 120)}` : ''
  return { reason: 'server', message: `语音服务拒绝了这段录音${hint}` }
}

/**
 * 按 MIME 猜一个带扩展名的文件名。
 *
 * ⚠️ 这个函数**不是"更稳的做法"，是必须对**。原来的注释写的是
 *   "服务端多半会 sniff 内容而不是只看名字" —— **这个假设是错的**，实测推翻了：
 *
 *   同一段 webm/opus 二进制，只改文件名，打同一个真接口：
 *     名字 audio.webm → 200 ✅
 *     名字 probe.wav  → **HTTP 500**（可稳定复现）
 *     （反向：wav 内容 + 名字 audio.webm → 200 ✅，这种它能自己嗅出来）
 *
 *   也就是说：**服务端会信扩展名**，名字说是 WAV 就按 WAV 去解，
 *   解不开直接 500。所以文件名和内容一旦不一致，整条路就失败，
 *   而且失败得**很像服务端故障**（500），排查时最容易查错方向 ——
 *   这个坑在写基准测试时就真踩了一次（见 transcribe-bench.test.ts 第③节）。
 *
 *   结论：这里的映射要覆盖住 `pickMime()` 可能返回的每一种 MIME，
 *   加新格式时**必须同时**加映射，否则会以一个看起来像服务端崩了的错误失败。
 */
function guessFileName(mime: string): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('webm')) return 'audio.webm'
  if (m.includes('ogg')) return 'audio.ogg'
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'audio.m4a'
  if (m.includes('mpeg') || m.includes('mp3')) return 'audio.mp3'
  if (m.includes('wav')) return 'audio.wav'
  return 'audio.webm'
}

/**
 * 设置页的「测试」按钮：用一小段**有声**的音频探服务通不通。
 *
 * ⚠️ 这里有一个踩过的坑，写下来免得以后又踩：
 *   最初用的是「0.5 秒静音」，想法是"静音也能走完鉴权和模型解析"。
 *   **这个假设是错的。** 实测（curl 直接打接口）：
 *     纯静音 WAV  → 服务端**不返回任何东西**，一直挂到客户端超时；
 *     有声音的 WAV → 200，正常返回。
 *   三个模型（SenseVoice / Qwen3-ASR / XingChenASR）都一样。
 *   结果是：**配置完全正确，测试按钮却永远报"超时"** ——
 *   家长会以为 Key 填错了，然后反复检查一个根本没问题的地方。
 *   这比没有测试按钮更糟。
 *
 *   所以改成发一小段**真的能听见的声音**（440Hz 正弦波）。
 *   它不是人话，所以返回值可能是空文本或莫名其妙的字 ——
 *   **那些都算通过**：我们验的是"地址/密钥/模型名认不认"，
 *   不是识别准确度。只要服务端**回话了**就说明配置是对的。
 */
export async function testTranscribeConnection(cfg: TranscribeConfig): Promise<{ ok: boolean; message: string; ms?: number }> {
  if (!isTranscribeConfigured(cfg)) {
    return { ok: false, message: '请先填完地址、密钥和模型名' }
  }
  // 0.5 秒 440Hz 正弦波：够小够快，而且**不是静音**（静音会让服务端挂住）
  const probe = toneWav(16000, 0.5, 440)
  // 用带重试的入口：测试按钮如果因为一次抖动就报"超时"，
  // 家长会去查一个根本没问题的配置 —— 那比没有测试按钮更糟
  const t0 = Date.now()
  const res = await transcribeWithRetry(probe, cfg, { fileName: 'test.wav', attempts: 3 })
  const ms = Date.now() - t0

  if (res.ok) {
    return { ok: true, message: '连接成功，语音服务可用', ms }
  }
  // 服务端收下了、只是没听出内容 —— 配置本来就是对的。
  //
  // ⚠️ 这一段**几乎总是**走到的，不是边角情况：探测音频是一段正弦波，
  //    本来就不是人话，所以「200 + 空文本」才是测试按钮的常态。
  //    正因为如此，ms 必须在这里也给 —— 否则设置页那行
  //    「连接成功（xxx ms）」里的数字**永远显示不出来**。
  //    （实测确认过：真服务打 3 次全走这条分支，ms 一直是 undefined。）
  if (res.reason === 'empty') {
    return { ok: true, message: '连接成功，语音服务可用', ms }
  }
  return { ok: false, message: res.message }
}

/**
 * 生成一段正弦波 WAV，用于连通性测试。
 *
 * 为什么不是静音：见 testTranscribeConnection 上面那段说明 ——
 * 纯静音会让服务端不返回响应。必须是有实际波形的音频。
 */
function toneWav(sampleRate: number, seconds: number, freq: number): Blob {
  const samples = Math.max(1, Math.round(sampleRate * seconds))
  const dataBytes = samples * 2 // 16-bit 单声道
  const buf = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buf)
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM 头长度
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 单声道
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // 字节率
  view.setUint16(32, 2, true) // 块对齐
  view.setUint16(34, 16, true) // 位深
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)

  // 数据区：0.3 振幅的正弦波（太大会削顶，太小可能被当静音）
  for (let i = 0; i < samples; i++) {
    const v = 0.3 * Math.sin((2 * Math.PI * freq * i) / sampleRate)
    view.setInt16(44 + i * 2, Math.round(v * 32767), true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

/** 设置页的一键预设 */
export const TRANSCRIBE_PRESETS: { label: string; baseUrl: string; model: string; note: string }[] = [
  {
    label: '硅基流动（推荐）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen3-ASR-1.7B',
    note: '国内直连，中文好，免费；实测比 SenseVoice 稳得多',
  },
  {
    label: '星尘 ASR',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'XingChenAGI/XingChenASR-V3.2',
    note: '同一家，免费；实测也稳，稍慢一点',
  },
  {
    label: 'SenseVoice（不太稳）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    note: '免费，但实测经常不返回响应，不推荐',
  },
  {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1',
    note: '需要海外网络',
  },
  {
    label: '本地服务',
    baseUrl: 'http://localhost:8000/v1',
    model: 'whisper-1',
    note: '自己跑的 whisper.cpp / faster-whisper',
  },
]

/**
 * 走硅基流动（整包上传）时，默认模型用 Qwen3-ASR，**不是** SenseVoice。
 *
 * 这是实测出来的结论，不是偏好问题。同一段真实人声、同一个接口：
 *   Qwen/Qwen3-ASR-1.7B        8/8 成功，延迟 0.53~0.64 秒，非常稳
 *   XingChenAGI/XingChenASR    8/8 成功，延迟 1.0~3.1 秒
 *   FunAudioLLM/SenseVoiceSmall **会随机挂住不返回**，有时 25 秒都等不到响应
 *
 * 孩子按住说一句、等了 20 秒没反应 —— 这是最伤体验的失败方式，
 * 所以只要走这条路，默认就必须是那根稳的。
 * （默认值见上面的 openAiTranscribeConfig。）
 */
