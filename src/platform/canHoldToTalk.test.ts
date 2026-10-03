/* ============================================================
   「按住说话」到底能不能用 —— 这个判定只许有一份
   ============================================================

   为什么单开一个文件：
     它要 mock 掉 `./ws-transport`（流式能力），而 transcribe.test.ts
     整份都在测真实的转写请求，塞进去会污染那一堆用例。

   为什么值得测：
     这个答案同时决定两件事 ——
       · `VoiceComposer` 那个麦克风按钮是「按住说话」还是「点一下开始」；
       · 新手引导第二屏教孩子**哪个手势**。
     两处答案漂移，就会出现"引导教按住、按钮却是点击"：
     孩子按住不动，界面毫无反应，于是认定麦克风坏了。
     那正是新手引导存在的理由，被它自己搞砸最讽刺。
   ============================================================ */

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** 流式（原生 socket 插件）在这台设备上有没有 —— 由每个用例决定 */
const env = vi.hoisted(() => ({ streamingOk: false }))

vi.mock('./ws-transport', () => ({
  isStreamingSupported: () => env.streamingOk,
}))

import { canHoldToTalk, defaultTranscribeConfig } from './transcribe'

beforeEach(() => {
  env.streamingOk = false
})

describe('canHoldToTalk · 判定只有一份', () => {
  it('默认配置 + 原生设备（APK 的默认状态）→ 能按住', () => {
    // 默认是 volcengine 流式 + 内置密钥，手机上有原生插件 —— 开箱即用。
    env.streamingOk = true
    expect(canHoldToTalk(defaultTranscribeConfig())).toBe(true)
  })

  it('★ 流式配置但在网页/桌面上 → 不能按住（这是最容易被忽略的一格）', () => {
    // 浏览器的 WebSocket 设不了请求头，连不上火山（见 ws-transport.ts）。
    // 此时按钮要退回「点一下开始」，引导也必须跟着改口。
    env.streamingOk = false
    expect(canHoldToTalk(defaultTranscribeConfig())).toBe(false)
  })

  it('★ 流式不可用时**没有备选可退** —— 直接判否（那条备选已经删了）', () => {
    /*
     * 2026-10-02 之前这里还有一条「流式不可用 → 退回整包上传（硅基流动）」。
     * 家长定「去掉硅基流动的东西，只使用火山」之后那条路连代码一起删了，
     * 所以现在**没有第二条路** —— 流式不可用就是"这台设备上用不了"。
     *
     * ★ 为什么必须还是 false（而不是"尽力而为"）：
     *   假装能用会让孩子按住等一个注定失败的请求，比老实显示"用不了"更坏
     *   （家长会以为是网络问题，反复重试）。
     */
    env.streamingOk = false
    const cfg = defaultTranscribeConfig()
    expect(canHoldToTalk(cfg)).toBe(false)
  })

  it('密钥是空的 → 不能按住（地址和资源 ID 是内置的，只有密钥可能是空的）', () => {
    env.streamingOk = true
    expect(canHoldToTalk({ ...defaultTranscribeConfig(), apiKey: '   ' })).toBe(false)
    expect(canHoldToTalk({ ...defaultTranscribeConfig(), apiKey: '' })).toBe(false)
  })

  it('配置整个缺省（老存档 / 没读过设置）→ 不能按住，且不许抛', () => {
    expect(canHoldToTalk(undefined)).toBe(false)
    expect(canHoldToTalk(null)).toBe(false)
  })
})
