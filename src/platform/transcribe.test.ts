/* ============================================================
   语音转写（云端）—— 回归测试
   ============================================================

   背景：国行机（华为等）上系统 SpeechRecognizer 可能一条结果都不回，
   设备侧的墙代码翻不过去，于是加了「录音 → 云端 → 文字」这条路。

   ⛔ 2026-10-02 家长定「去掉硅基流动的东西，只使用火山」之后，
      这个文件**从 844 行缩到几十行** —— 原来那几百行测的是
      「整包上传」（OpenAI Whisper 形状，硅基流动那类）那条路：
      请求形状、multipart 的 Content-Type、文件名扩展名、
      401/429/5xx 翻人话、太短/太大/空的本地防呆、重试策略、预热连接……
      那条路连代码一起删了，那些用例守的东西**已经不存在**，
      留着只会让人以为还有第二条路可退。

   现在这里只剩两件事：
     1. `isTranscribeConfigured` —— 配置齐了没（火山**只需要密钥**）
     2. `defaultTranscribeConfig` —— 默认值是不是那套内置的火山配置

   ⚠️ 「能不能按住说话」不在这个文件里 —— 它要 mock 掉 ws-transport，
      塞进来会污染这里的用例，所以单独放 canHoldToTalk.test.ts。
   ⚠️ 流式协议本身（分帧、终稿、收尾、预热复用）在 volcengine.test.ts。
   ============================================================ */

import { describe, expect, it } from 'vitest'
import {
  VOLC_TEST_API_KEY,
  defaultTranscribeConfig,
  isTranscribeConfigured,
  type TranscribeConfig,
} from './transcribe'

const CFG: TranscribeConfig = {
  apiKey: 'uuid-key',
  model: 'bigmodel',
  resourceId: 'volc.seedasr.sauc.duration',
}

describe('语音转写 · 配置校验', () => {
  it('火山这条路**只需要密钥** —— 地址和资源 ID 都内置了', () => {
    expect(isTranscribeConfigured(CFG)).toBe(true)
    // 只给密钥也算配好（这正是"装好就能用"的前提）
    expect(isTranscribeConfigured({ apiKey: 'k', model: 'bigmodel' })).toBe(true)
  })

  it('没有密钥就是没配好 —— 不能因为"别的字段是内置的"就放行', () => {
    expect(isTranscribeConfigured({ ...CFG, apiKey: '' })).toBe(false)
    // 全是空白也不等于填了（复制粘贴很容易带进来）
    expect(isTranscribeConfigured({ ...CFG, apiKey: '   ' })).toBe(false)
  })

  it('整个缺省（老存档 / 没读过设置）→ false，且不许抛', () => {
    expect(isTranscribeConfigured(null)).toBe(false)
    expect(isTranscribeConfigured(undefined)).toBe(false)
  })
})

describe('语音转写 · 默认配置', () => {
  it('默认就是火山流式，且密钥已经内置（家长什么都不用填就能用）', () => {
    const d = defaultTranscribeConfig()
    /* 默认从「硅基流动整包上传」换成了「火山流式边说边传」。
       理由是实测：同一段 5.44 秒人声 ——
         整包上传（硅基流动）      松手→出字  419ms，说完才出字
         火山 双向流式 duplex      松手→出字 −4371ms，说话时字就上屏了
       不是模型更快，是**把上传和识别都挪出了关键路径**。 */
    expect(d.resourceId).toBe('volc.seedasr.sauc.duration')
    // 密钥内置是这次改动的重点：装好 App 不用配任何东西
    expect(d.apiKey).toBeTruthy()
    expect(d.apiKey.startsWith('sk-')).toBe(false) // 火山不是 sk- 开头，别照抄硅基那套
    // 配好了才能走「按住说话」
    expect(isTranscribeConfigured(d)).toBe(true)
  })

  it('★ 密钥是**构建期注入**的，不许硬编码在仓库里', () => {
    /* 密钥写死在源码里 = 打进 APK 就等于公开（`strings` 一下就能抠出来），
       而火山是按音频时长计费的，被拿去刷就是直接烧钱。
       所以它从 `VITE_VOLC_API_KEY` 读 —— 仓库里只留 .env.example 的占位。
       ⚠️ 打包前必须有 .env.local，否则**装上去录不了音，而构建成功、
          包内校验全绿**（这个坑踩过一次，见 MEMORY §十四）。 */
    expect(VOLC_TEST_API_KEY).toBe(import.meta.env.VITE_VOLC_API_KEY ?? '')
  })

  it('默认配置是**自洽**的 —— 每个字段都符合火山那套语义', () => {
    /* ★ 为什么单独钉这一条：两条路曾经共用同一份 TranscribeConfig，
       而它们的字段语义**互相冲突**（整包上传要 baseUrl + `sk-` 密钥，
       火山**不能有** baseUrl + UUID 密钥）。混着填的结果是
       「engine 说火山、密钥却是硅基的 → 握手 401 → 一个字都出不来」。
       现在只剩一条路，这份默认值就必须**处处自洽**，不能留半条旧路的字段。 */
    const d = defaultTranscribeConfig() as unknown as Record<string, unknown>
    expect(Object.keys(d).sort()).toEqual(['apiKey', 'model', 'resourceId'])
    expect(d.baseUrl).toBeUndefined()
    expect(d.engine).toBeUndefined()
  })
})
