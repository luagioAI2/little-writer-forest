/* ============================================================
   语音写作台 · **松手比就绪更快** 的那一格
   ============================================================

   家长 2026-09-30 反馈的原话：
     「现在话筒 录音 文字也显示出来了，但如果 松开太快。似乎就不生效了。」

   根因：按下要等两件异步的事（`getUserMedia` 拿到麦克风、流式还要等
   WebSocket 握手），而**松手是同步的**。所以"松手跑在就绪前面"是常态。
   那一刻 `endHold` 手里什么都没有，于是：

     流式：`volcRef.current` 还是 null → 报「网络有点慢，再试一次」

   这个提示在甩锅。而且更糟的两点（这个文件主要守的就是它们）：

     ★ 流式那一轮**本来救得回来** —— 音频已经在 `earlyChunksRef` 里、
       连接也已经在路上，却被 `session.cancel()` 整段扔掉。
       （修复前的探针日志原话：`流式没连上就松手了 { 按住ms: 12, 有音频: true }`
         —— `有音频: true` 就是"音频其实已经拿到了"的铁证。）
     ★ 采集那条路会**把麦克风一直开着**：`stop()` 抢在 `getUserMedia` 前面，
       等它回来代码继续往下走，把音频图又建了起来，而这时已经没人收它了。

   ⚠️ 为什么这些守卫不在 `VoiceComposer.test.tsx` 里：
     那个文件里 `holdAndRelease()` 每次都先 `await Promise.resolve()`
     把 `await recorder.start()` 结算掉**再松手** —— 它守的是别的格子。
     而这里要 mock `volcengine` / `ws-transport` / `pcm-capture` 三个模块，
     塞进那个文件会改变它现有用例的运行环境。
     所以单开一份，**只守"松手比就绪快"**。

   ⚠️ fake-indexeddb/auto 必须第一个 import（db.ts 顶层就 new 了库）。
   ============================================================ */

import 'fake-indexeddb/auto'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { EditOperation } from '../domain/types'
import type { Recognizer, RecognizerCallbacks } from '../platform/speech'
import { VoiceComposer } from './VoiceComposer'

/* ---------------- 假识别器 / 假录音器 ----------------
   ⚠️ 这个文件只跑**按住说话**那条路，所以这两个替身不会真的被用到 ——
   它们只是为了让模块导入成功、并且万一路径跑偏时不会炸。
   「录音器迟到的 resolve 不许把麦克风建起来」那条守卫原来在这里，
   但它守的是**整包上传**那条路（MediaRecorder）—— 那条路已删，
   同样的守卫现在住在 `pcm-capture.ts` 里（PCM 采集的 `stopped` 检查），
   由 `volcengine.test.ts` 的「PCM 采集」一组钉住。 */

vi.mock('../platform/speech', async () => {
  const actual = await vi.importActual<typeof import('../platform/speech')>('../platform/speech')
  return {
    ...actual,
    isSpeechRecognitionSupported: () => true,
    probeSpeechSupport: async () => true,
    usesNativeSpeech: () => true,
    isRecordingSupported: () => true,
    createRecognizer: (cb: RecognizerCallbacks): Recognizer => {
      return {
        start: () => cb.onStart?.(),
        stop: () => cb.onEnd?.(),
        abort: () => {},
        isListening: () => true,
        settled: () => Promise.resolve(),
      }
    },
    createRecorder: () => ({
      start: async () => {},
      stop: async () => null,
      cancel: () => {},
      isRecording: () => false,
      getLevel: () => 0,
    }),
  }
})

/* ---------------- 假流式：openVolcStream 由测试决定什么时候连上 ---------------- */

let connectSettle: ((s: unknown) => void) | null = null
let volcFinishCalls = 0
let volcCancelCalls = 0
let volcPushed: number[] = []

vi.mock('../platform/ws-transport', () => ({
  isStreamingSupported: () => true,
}))

/** 假 PCM 采集：start 由测试结算，onChunk 也交给测试来喂（模拟"孩子已经说话了"） */
let pcmStartSettle: (() => void) | null = null
let pcmChunk: ((b: Uint8Array) => void) | null = null

vi.mock('../platform/pcm-capture', () => ({
  // 进写作页时会预热麦克风（prewarm）—— 这里给个空实现
  warmUpMicrophone: async () => {},
  createPcmCapture: (opts: { onChunk: (b: Uint8Array) => void }) => {
    pcmChunk = opts.onChunk
    return {
      start: () =>
        new Promise<void>((resolve) => {
          pcmStartSettle = resolve
        }),
      stop: () => true,
      cancel: () => {},
      getLevel: () => 0,
      getDurationMs: () => 120,
    }
  },
}))

vi.mock('../platform/volcengine', () => ({
  resolveEndpoint: () => 'duplex',
  openVolcStream: () =>
    new Promise((resolve) => {
      connectSettle = resolve
    }),
  // 预热那两下：进写作页就会调，这里只要不炸就行
  warmVolcStream: () => {},
  dropWarmVolcStream: () => {},
}))

/** 造一个流式会话替身 —— 记"补发了几包 / 有没有被 finish / cancel" */
function fakeSession() {
  return {
    pushAudio: () => {
      volcPushed.push(1)
    },
    finish: async () => {
      volcFinishCalls += 1
      return { ok: true, text: '流式听出来的话', ms: 150 }
    },
    cancel: () => {
      volcCancelCalls += 1
    },
  }
}

/* ---------------- 夹具 ---------------- */

/**
 * 转写配置 —— ⚠️ 只有火山这一条路了（2026-10-02 起），
 * 所以这里没有 `engine` / `baseUrl` 那两个字段：
 * 它们已经被删掉，留着只会让类型和运行时不一致。
 */
const VOLC_CFG = {
  apiKey: 'uuid-key',
  model: 'bigmodel',
  resourceId: 'volc.seedasr.sauc.duration',
}

function mount() {
  const holder: { text: string; edits: EditOperation[] } = { text: '', edits: [] }
  function Host() {
    const [text, setText] = useState('')
    return (
      <VoiceComposer
        text={text}
        utterances={[]}
        edits={[]}
        transcribe={VOLC_CFG}
        onChange={(next: { text: string; edits: EditOperation[] }) => {
          holder.text = next.text
          holder.edits = next.edits
          setText(next.text)
        }}
        ink
      />
    )
  }
  render(<Host />)
  return holder
}

async function pointer(type: 'pointerdown' | 'pointerup', label: string | RegExp) {
  const mic = screen.getByLabelText(label)
  await act(async () => {
    mic.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, cancelable: true }))
  })
}

/** 把挂起的微任务/宏任务都放一遍（收尾是串了好几层的 async） */
async function flush(times = 3) {
  await act(async () => {
    for (let i = 0; i < times; i++) await Promise.resolve()
  })
}

afterEach(() => {
  cleanup()
  connectSettle = null
  volcFinishCalls = 0
  volcCancelCalls = 0
  volcPushed = []
  pcmStartSettle = null
  pcmChunk = null
})

/* ============================================================ */

describe('松手比握手更快（流式 · App 默认那条路）', () => {
  it('★ 连接就绪后必须补收尾：音频补发出去、取终稿、文字进正文', async () => {
    const holder = mount()
    expect(screen.getByLabelText('按住说话')).toBeTruthy()

    await pointer('pointerdown', '按住说话')
    // 开麦成功（孩子能说话了），但 socket 还没连上
    await act(async () => {
      pcmStartSettle?.()
      await Promise.resolve()
    })
    // 孩子已经说了话：建连期间采到的包会攒在 earlyChunksRef 里
    await act(async () => {
      pcmChunk?.(new Uint8Array([1, 2, 3]))
    })

    // ★ 松手 —— 比握手快
    await pointer('pointerup', /松手结束说话|按住说话/)

    // 这一轮**没有**被放弃：没有 cancel，也还没到收尾（在等连接）
    expect(volcCancelCalls, '不许把这一轮 cancel 掉').toBe(0)
    expect(volcFinishCalls).toBe(0)

    // 连接就绪 → beginHold 的尾巴接管：补发音频 → 取终稿
    await act(async () => {
      connectSettle?.(fakeSession())
    })
    await flush()

    expect(volcCancelCalls, '连接已经握上手了，不许丢掉').toBe(0)
    expect(volcPushed.length, '建连期间攒下的音频必须补发出去').toBeGreaterThan(0)
    expect(volcFinishCalls, '必须去取终稿').toBe(1)
    // ★ 文字真的进了正文
    expect(holder.text).toContain('流式听出来的话')
  })

  it('★ 松手时一个包都没采到 → 也不许 cancel（连接仍然要收尾，让服务端说了算）', async () => {
    /* 边界：开麦比握手慢、或者孩子没出声。
       修复前这里报的是「网络有点慢，再试一次」—— 把"松太快"说成了网络问题。 */
    mount()

    await pointer('pointerdown', '按住说话')
    await act(async () => {
      pcmStartSettle?.()
      await Promise.resolve()
    })
    await pointer('pointerup', /松手结束说话|按住说话/)

    expect(volcCancelCalls).toBe(0)
    await act(async () => {
      connectSettle?.(fakeSession())
    })
    await flush()

    expect(volcCancelCalls).toBe(0)
    expect(volcFinishCalls).toBe(1)
  })

  it('对照组：先等握手再松手 → 走的还是老路（别把常见路径改坏）', async () => {
    const holder = mount()

    await pointer('pointerdown', '按住说话')
    await act(async () => {
      pcmStartSettle?.()
      await Promise.resolve()
    })
    // ★ 这次先让连接就绪
    await act(async () => {
      connectSettle?.(fakeSession())
    })
    await flush()
    await pointer('pointerup', /松手结束说话|按住说话/)
    await flush()

    expect(volcFinishCalls).toBe(1)
    expect(volcCancelCalls).toBe(0)
    expect(holder.text).toContain('流式听出来的话')
  })

  it('★ 松手后又按了一次（上一轮的连接还没就绪）→ 上一轮只收掉自己，不许搅乱新一轮', async () => {
    /* 窗口很窄但真的够得着：松手 → 连接就绪之间通常有 100~400ms，
       而"松开太快"的孩子本来就在反复点。那两条尾巴会同时活着，
       共用 `earlyChunksRef` / `volcRef` / `volcConnectRef` ——
       过期的那条一旦接着往下写，新一轮的音频和会话就乱了。 */
    const holder = mount()

    // ── 第一轮：按下 → 开麦 → 松手（连接还在路上）
    await pointer('pointerdown', '按住说话')
    await act(async () => {
      pcmStartSettle?.()
      await Promise.resolve()
    })
    const settleA = connectSettle
    await pointer('pointerup', /松手结束说话|按住说话/)

    // ── 孩子又按了一次：这是**新一轮**
    const mic = screen.getByLabelText(/按住说话/)
    await act(async () => {
      mic.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 }))
    })
    await act(async () => {
      pcmStartSettle?.()
      await Promise.resolve()
    })
    const settleB = connectSettle
    expect(settleB, '第二轮应该建了它自己的连接').not.toBe(settleA)

    // 新一轮里孩子说了话 —— 这一包属于**第二轮**
    await act(async () => {
      pcmChunk?.(new Uint8Array([9]))
    })

    // ── 第一轮的连接现在才就绪，但它已经过期了
    await act(async () => {
      settleA?.(fakeSession())
    })
    await flush()
    expect(volcCancelCalls, '过期那一轮只收掉自己的连接').toBe(1)
    expect(volcPushed, '过期那一轮不许把新一轮的音频发出去').toHaveLength(0)

    // ── 第二轮正常收尾
    await act(async () => {
      settleB?.(fakeSession())
    })
    await flush()
    await pointer('pointerup', /松手结束说话|按住说话/)
    await flush()

    expect(volcPushed, '第二轮攒下的音频要发出去').toHaveLength(1)
    expect(volcCancelCalls, '第二轮不该被 cancel').toBe(1)
    expect(volcFinishCalls).toBe(1)
    expect(holder.text).toContain('流式听出来的话')
  })

  it('★ 真·放弃（失焦 / 手指滑出）→ 仍然要 cancel，不能顺手把它收尾了', async () => {
    /* 守住三个 ref 的分支没搞错：
         holdActive=false + released=true  → 收尾
         holdActive=false + released=false → 放弃（cancel）
       这一条盯的就是后面那一支。 */
    mount()
    // ⚠️ 先抓住按钮 —— 在听的时候 aria-label 会变成「松手结束说话」，
    //    之后再按 '按住说话' 找就找不到了。
    const mic = screen.getByLabelText('按住说话')

    await act(async () => {
      mic.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
    })
    await act(async () => {
      pcmStartSettle?.()
      await Promise.resolve()
    })
    // 焦点真的离开了 → cancelHold（真·放弃）
    await act(async () => {
      fireEvent.blur(mic)
    })
    await act(async () => {
      connectSettle?.(fakeSession())
    })
    await flush()

    expect(volcCancelCalls, '主动放弃就该 cancel').toBe(1)
    expect(volcFinishCalls, '放弃的轮次不该去取终稿').toBe(0)
  })
})
