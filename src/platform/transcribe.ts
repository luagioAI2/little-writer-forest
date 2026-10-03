/* ============================================================
   语音转写（录音 → 文字）—— 只剩**火山流式**这一条路
   ============================================================

   为什么需要它：
   安卓上原本用系统 SpeechRecognizer 做识别，但**国行机（华为等）上
   系统可能根本没有可用的识别服务** —— isRecognitionAvailable() 返回 true
   也照样一条结果都不回。表现就是"录音在跑、文字一个字都没有"。
   这是设备侧的墙，改代码翻不过去。

   所以再加一条**不依赖手机系统**的通路：
     录下音频 → 送到云端识别 → 拿回文字

   ------------------------------------------------------------
   ⛔ 2026-10-02 家长定：「去掉硅基流动的东西，只使用火山。」
      于是这里原来那条**整包上传**（OpenAI Whisper 形状，硅基流动那类）
      连代码带设置页一起删了，只剩火山流式（边说边传）。

   删它不只是"少一个选项"。两条路**共用同一份 `TranscribeConfig`**，
   而它们的字段语义是**互相冲突**的：

     整包上传   需要 baseUrl、用 `sk-` 开头的密钥、model 是模型名
     火山流式   **不能有** baseUrl、用 UUID 密钥、model 被复用成端点选择

   留着它，那条「engine 说火山、密钥却是硅基流动的 → 握手 401 →
   一个字都出不来」的老故障就一直有复发面（`db.ts` 的迁移就是在补它）。
   一条路 + 一份自洽的字段，这个面直接消失。

   ⚠️ **代价，必须说清楚**（以后别当成 bug 查）：
      火山流式**只在手机 App 里能用** —— 浏览器的 WebSocket 设不了请求头，
      而火山的密钥必须放在请求头里（查询串 / 子协议两条绕行路都被服务端
      拒了，实测 HTTP 403 / 400，见 ws-transport.ts）。
      ➜ 所以**桌面 / 网页上现在完全没有云端转写**，会退回系统识别或键盘输入。
        这是取舍，不是坏掉。
   ============================================================ */

/** 语音转写的配置 —— 与聊天用的 AiConfig 分开，因为可以指向不同的服务商。
 *  类型定义在 domain/types.ts（设置要存进数据库，那边才是单一来源）。 */
import type { TranscribeConfig } from '../domain/types'
// 流式能力判定住在 ws-transport（那里才知道原生 socket 插件在不在）。
// 依赖方向是 transcribe → ws-transport，单向，不构成环。
import { isStreamingSupported } from './ws-transport'

export type { TranscribeConfig }

/** 配置齐了没 —— 火山这条路**只需要密钥**：地址和资源 ID 都内置了 */
export function isTranscribeConfigured(cfg: TranscribeConfig | undefined | null): boolean {
  return Boolean(cfg?.apiKey?.trim())
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
 * ⚠️ 流式（火山）只在**原生 App** 里能用：浏览器的 WebSocket 设不了请求头
 *    （见 ws-transport.ts）。所以桌面 / 网页上这里一定是 false ——
 *    界面老老实实显示"点一下"那套，比假装能用诚实。
 *
 * ⚠️ 这里**没有**「流式不可用就退回整包上传」这一支了（那条路已删）。
 *    退回的前提是"另一条路配好了"，而现在根本没有另一条路。
 */
export function canHoldToTalk(cfg: TranscribeConfig | undefined | null): boolean {
  return isTranscribeConfigured(cfg) && isStreamingSupported()
}

/* ============================================================
   内置密钥 —— ⚠️ 读这段再改
   ------------------------------------------------------------
   密钥**不在仓库里**了：构建时从环境变量读（`.env.local` 的
   `VITE_VOLC_API_KEY`），仓库里只留 `.env.example` 的占位。

   为什么改成这样：明文写在这行 = 密钥**打进 APK 就等于公开**。
   任何人拿到包 `strings` 一下就能抠出来，而火山是按音频时长计费的
   （¥66 / 30 小时），被人拿去刷就是直接烧钱。
   （同一套做法见 `domain/ai.ts` 的 `AI_TEST_API_KEY`。）

   ★ 空值语义（**和 `AI_TEST_API_KEY` 保持一致，别改成报错**）：
     没配 → 就是空串 → `isTranscribeConfigured()` 返回 false
     → 界面退回系统识别（`canHoldToTalk` 也是 false，会教"点一下"）。
     **降级，不崩、不报错** —— 和「留空 = 走本地规则」是同一条约定。

   ⚠️ 打包前必须有 `.env.local`，否则**装上去录不了音，而构建成功、
      包内校验全绿** —— 这个坑踩过一次（见 MEMORY §十四）。
   ============================================================ */
export const VOLC_TEST_API_KEY: string = import.meta.env.VITE_VOLC_API_KEY ?? ''

/**
 * 默认配置 —— 火山流式（边说边传），密钥已内置。
 *
 * 为什么是它：实测同一段 5.44 秒人声（scripts/_probe-volcengine-stream.mjs）——
 *   整包上传（硅基流动）        松手→出字  419ms，说完才出字
 *   整包上传（火山录音文件识别） 松手→出字 2078ms   ← 更慢，别用
 *   火山单向流式 nostream       松手→出字  348ms
 *   火山双向流式 duplex         松手→出字 −4371ms  ← 首字在开口 1.1 秒时就上屏
 * 不是"模型更快"，是**把上传和识别都挪出了关键路径**。
 *
 * 代价：按量计费（约 ¥2.2 / 小时音频）。
 */
export function defaultTranscribeConfig(): TranscribeConfig {
  return {
    apiKey: VOLC_TEST_API_KEY,
    /**
     * ⚠️ 这个字段在流式这条路上**不是模型名**，是「选哪个端点」——
     *    见 `volcengine.ts` 的 `resolveEndpoint()`。
     *    取值只有 `'duplex' | 'nostream' | 'async'`，认不出来一律回落到
     *    `'duplex'`（唯一一个真正省时间的）。
     *    这里写 `'bigmodel'` 是历史遗留：它认不出来，所以等价于 duplex。
     *    请求体里真正的 `model_name` 由 `volcengine.ts` 写死成 `'bigmodel'`。
     */
    model: 'bigmodel',
    resourceId: 'volc.seedasr.sauc.duration',
  }
}
