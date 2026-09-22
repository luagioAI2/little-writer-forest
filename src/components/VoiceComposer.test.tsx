/* ============================================================
   语音写作台的**诊断提示**（回归测试）
   ============================================================

   背景：真机上「点一下麦克风没反应」有好几种死法，而它们肉眼看起来
   **完全一样**（按钮亮了、也在听、就是没字）。只靠"有没有字"没法区分：
     · 识别服务一条结果都没送回来（权限 / 系统服务 / 启动失败）
     · 结果收到了，但界面没把它写进正文（程序问题）
   所以界面留了两条**只在出问题时才出现**的提示。

   这个文件守的就是这两条提示的**出现时机**。时机错了比不显示更糟：
     · 显示太早 → 孩子还在说话就弹一条"没收到结果"
     · 该撤不撤 → 第一轮失败后提示一直挂着，后面写完了还在看它

   真实踩过的两个错（都在这一轮修掉）：
     1. 用「按过开始」当判据 → 提示永久留存（只有下一次按开始才清零）
     2. 改作文模式下也报"没能写进正文" —— 但改作文时"正文没变"是**正常结果**
        （孩子说「把棍子改成竹签」，原文里没有"棍子"本来就不改），
        报成"程序问题"会让家长去翻一堆无用的截图

   ⚠️ fake-indexeddb/auto 必须第一个 import（db.ts 顶层就 new 了库）。
   ============================================================ */

import 'fake-indexeddb/auto'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { EditOperation } from '../domain/types'
import type { Recognizer, RecognizerCallbacks } from '../platform/speech'
import { VoiceComposer } from './VoiceComposer'

/* ---------------- 假识别器：把回调攒下来，由测试决定什么时候喂 ---------------- */

let lastCb: RecognizerCallbacks | null = null

vi.mock('../platform/speech', async () => {
  const actual = await vi.importActual<typeof import('../platform/speech')>('../platform/speech')
  return {
    ...actual,
    // 原生路径：永远"支持"，并把回调交给测试
    isSpeechRecognitionSupported: () => true,
    probeSpeechSupport: async () => true,
    usesNativeSpeech: () => true,
    isRecordingSupported: () => true,
    createRecognizer: (cb: RecognizerCallbacks): Recognizer => {
      lastCb = cb
      return {
        start: () => cb.onStart?.(),
        stop: () => cb.onEnd?.(),
        abort: () => {},
        isListening: () => true,
        settled: () => Promise.resolve(),
      }
    },
  }
})

/* ---------------- 假录音器 + 假转写（守住"按住说话"这条路） ---------------- */

/** 录音器 start 过几次 —— 用来验证"按下才开始录" */
let recorderStarts = 0
/** 录音器 stop 时报告的时长，用来造"太短=误触"的场景 */
let recorderDurationMs = 2000
/** 录音器是否被 cancel 过 —— 验证"中途放弃"不会留下一个还在录的麦克风 */
let recorderCancels = 0
/** 录音器 stop 过几次 —— 验证"被打断时至少把录音收掉" */
let recorderStops = 0

vi.mock('../platform/speech', async () => {
  const actual = await vi.importActual<typeof import('../platform/speech')>('../platform/speech')
  return {
    ...actual,
    isSpeechRecognitionSupported: () => true,
    probeSpeechSupport: async () => true,
    usesNativeSpeech: () => true,
    isRecordingSupported: () => true,
    createRecognizer: (cb: RecognizerCallbacks): Recognizer => {
      lastCb = cb
      return {
        start: () => cb.onStart?.(),
        stop: () => cb.onEnd?.(),
        abort: () => {},
        isListening: () => true,
        settled: () => Promise.resolve(),
      }
    },
    // 录音器：录到"一段音频"，stop 时按 recorderDurationMs 报告时长
    createRecorder: () => ({
      start: async () => {
        recorderStarts += 1
      },
      stop: async () => {
        recorderStops += 1
        return {
          dataUrl: 'data:audio/webm;base64,AAAA',
          durationMs: recorderDurationMs,
          mime: 'audio/webm',
        }
      },
      cancel: () => {
        recorderCancels += 1
      },
      isRecording: () => true,
      getLevel: () => 0.5,
    }),
  }
})

/** 转写替身：默认成功；测试可改 */
let transcribeImpl: (
  blob: Blob,
) => Promise<
  { ok: true; text: string; ms: number } | { ok: false; reason: string; message: string }
> = async () => ({ ok: true, text: '按住说出来的话', ms: 10 })
/** 转写调用次数 —— 验证"太短的录音不该上传" */
let transcribeCalls = 0

vi.mock('../platform/transcribe', async () => {
  const actual = await vi.importActual<typeof import('../platform/transcribe')>('../platform/transcribe')
  /* 组件走的是 transcribeWithRetry（带重试的那个入口）。
     两个都要替换 —— 只换 transcribeAudio 的话组件调的是真实现，
     测试会静默地变成"真的去发网络请求"，然后断言一个根本没被替换的计数器。 */
  const spy = (blob: Blob) => {
    transcribeCalls += 1
    return transcribeImpl(blob)
  }
  return {
    ...actual,
    transcribeAudio: spy,
    transcribeWithRetry: spy,
  }
})

/* ---------------- 改作文走大模型那条路 ---------------- */

let parseCalls = 0
/**
 * 模型那条路现在返回的是**结构化指令**，不是改好的全文。
 * 所以这里 mock 的也是指令 —— 正文由本地引擎生成。
 * 详见 domain/ai.ts 四·五节。
 */
let parseImpl: (o: unknown) => Promise<{
  ok: boolean
  intent?: unknown
  reason?: string
  message: string
}> = async () => ({
  ok: true,
  intent: { kind: 'replace', from: '小猫', to: '小狗' },
  message: '',
})

vi.mock('../domain/ai', async () => {
  const actual = await vi.importActual<typeof import('../domain/ai')>('../domain/ai')
  /* 只换 parseEditInstruction（会发网络请求的那个）。
     shouldUseRemote 要用**真实现** —— 组件靠它决定走不走大模型，
     换掉它这条测试就等于自己给自己出题。 */
  return {
    ...actual,
    parseEditInstruction: async (o: unknown) => {
      parseCalls += 1
      return parseImpl(o)
    },
  }
})

/** 一份"配好了"的 AI 设置 —— 传了它改作文才会走大模型 */
const AI_CFG = {
  mode: 'remote' as const,
  provider: 'openai-compatible' as const,
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-test',
  // 值本身无所谓（这份夹具只关心"配好了"），但别写已经弃用的旧名 ——
  // 否则以后 grep 旧名做审计时会一直撞到它。
  model: 'deepseek-flash',
  fallbackToLocal: true,
}

/** 一份"配好了"的转写设置 —— 传了它才会走「按住说话」 */
const TRANS_CFG = {
  baseUrl: 'https://api.siliconflow.cn/v1',
  apiKey: 'sk-test',
  model: 'Qwen/Qwen3-ASR-1.7B',
}

/** 点麦克风 → 说一句 → 再点一下停止。注意：**不自己 render**，由调用方先 render */
async function recordRound(
  say: (cb: RecognizerCallbacks) => void,
  opts: { mode?: 'append' | 'edit' } = {},
) {
  if (opts.mode === 'edit') {
    await act(async () => {
      screen.getByText('改作文').click()
    })
  }

  const mic = screen.getByLabelText('开始说话')
  await act(async () => {
    mic.click()
  })

  await act(async () => {
    say(lastCb as RecognizerCallbacks)
  })

  // 停止
  const stop = screen.getByLabelText('停止说话')
  await act(async () => {
    stop.click()
  })
}

/**
 * 挂一个语音写作台，并接上**真实的父级**：onChange 会把 text 写回去。
 *
 * ⚠️ 这一条很关键。第一版测试里 `onChange` 是空函数，
 * 于是正文永远是空的 —— 组件就**正确地**报了"没能写进正文"，
 * 而我误以为它坏了。也就是说：**测试里的父级必须像真的父级一样回流数据**，
 * 否则测出来的全是假象。需要"父级不回填"那种情形时，用 mount({ echo: false })。
 */
function mount(
  initialText = '',
  opts: { echo?: boolean; transcribe?: boolean; ai?: boolean } = {},
) {
  const echo = opts.echo !== false
  const holder: {
    text: string
    set?: (t: string) => void
    /** 回流回来的修改记录 —— 断言"谁动的手"要用 */
    edits: EditOperation[]
  } = { text: initialText, edits: [] }

  function Host() {
    const [text, setText] = useState(initialText)
    const [edits, setEdits] = useState<EditOperation[]>([])
    holder.set = setText
    return (
      <VoiceComposer
        text={echo ? text : initialText}
        utterances={[]}
        edits={echo ? edits : []}
        transcribe={opts.transcribe ? TRANS_CFG : undefined}
        ai={opts.ai ? AI_CFG : undefined}
        onChange={(next) => {
          holder.text = next.text
          holder.edits = next.edits
          if (echo) {
            setText(next.text)
            setEdits(next.edits)
          }
        }}
        ink
      />
    )
  }

  render(<Host />)
  return holder
}

afterEach(() => {
  cleanup()
  lastCb = null
  recorderStarts = 0
  recorderCancels = 0
  recorderStops = 0
  recorderDurationMs = 2000
  transcribeCalls = 0
  transcribeImpl = async () => ({ ok: true, text: '按住说出来的话', ms: 10 })
  parseCalls = 0
  parseImpl = async () => ({
    ok: true,
    intent: { kind: 'replace', from: '小猫', to: '小狗' },
    message: '',
  })
})

/* ---------------- 按住说话：模拟 pointer 事件 ---------------- */

/**
 * 模拟"按住 → 松开"。
 *
 * 用 pointer 事件而不是 click：真机上是手指按下/抬起，
 * 而按钮的交互已经绑在 pointerdown/pointerup 上（这样才能用
 * setPointerCapture 处理"手指滑出按钮"）。用 click 测等于没测。
 */
async function holdAndRelease(ms = 1500, opts: { release?: boolean } = {}) {
  const mic = screen.getByLabelText(/按住说话|开始说话/)
  await act(async () => {
    mic.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, cancelable: true }),
    )
  })
  if (opts.release === false) return

  // 让 beginHold 里的 await recorder.start() 结算
  await act(async () => {
    await Promise.resolve()
  })
  await act(async () => {
    mic.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, cancelable: true }))
  })
  void ms
}

describe('语音写作台 · 按住说话（云端转写）', () => {
  it('配了转写就不再用"点一下"的文案，改成告诉孩子按住', () => {
    mount('', { transcribe: true })
    expect(screen.getByLabelText('按住说话')).toBeTruthy()
    expect(screen.getByText(/按住说话吧/)).toBeTruthy()
  })

  it('没配转写时保持老文案（不该让家长看到"按住"却按不出去）', () => {
    mount()
    expect(screen.getByLabelText('开始说话')).toBeTruthy()
    expect(screen.queryByText(/按住说话吧/)).toBeNull()
  })

  it('★ 按住→松开 → 转写结果写进正文', async () => {
    mount('', { transcribe: true })
    await holdAndRelease()
    expect(transcribeCalls).toBe(1)
    expect(screen.getByText(/按住说出来的话/)).toBeTruthy()
  })

  it('按下才开始录（不是挂载就录）', async () => {
    mount('', { transcribe: true })
    expect(recorderStarts).toBe(0)
    await holdAndRelease()
    expect(recorderStarts).toBe(1)
  })

  it('★ 被打断（pointercancel）→ 录音必须收掉，而且**不能把孩子说的话丢掉**', async () => {
    /* ⚠️ 先纠正一个流传已久的误解：pointercancel **不是**"手指滑出按钮"。
       按钮绑了 setPointerCapture，滑出去再松开收到的是 pointerup
       （组件里的注释写得很清楚），所以那条路走的是正常收尾。

       真正会发 pointercancel 的是**浏览器层面的打断**：
       系统手势、通知栏下拉、来电、以及**布局抖动**。
       这些都不是孩子的错 —— 所以正确做法是**收尾**（把已经说的留下），
       而不是把他刚说的话整段丢掉。

       底线没变：录音必须停掉，不能留一个开着的麦克风。 */
    mount('', { transcribe: true })
    const mic = screen.getByLabelText('按住说话')

    await act(async () => {
      mic.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(recorderStarts).toBe(1)

    await act(async () => {
      mic.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }))
    })
    await act(async () => {
      await Promise.resolve()
    })

    // ① 录音收掉了（麦克风不会一直开着）
    expect(recorderStops).toBe(1)
    // ② ★ 走的是**收尾**不是放弃 —— pointercancel 不是「手指滑出按钮」
    //    （有 setPointerCapture，滑出去再松手是 pointerup），
    //    它是来电 / 通知栏 / 系统手势 / 布局抖动。
    //    孩子确实说了话，丢掉是错的。
    expect(recorderCancels).toBe(0)
    // ③ 已经说的那句被保留 —— 不是凭空消失
    expect(screen.getByText(/按住说出来的话/)).toBeTruthy()
  })

  it('★ 按下麦克风不许改变布局 —— 按钮一移动就会"刚按下去就松开"', async () => {
    /* 真实反馈：「一按，由于要显示'正在听'，话筒按钮就往下移动，
       偶尔会导致按钮直接松开」。

       成因：状态条以前是 `{listening && <div/>}` 放在按钮**上方**，
       按下瞬间凭空长出一条，把按钮整体下推约 60px。
       手指还按在原处、按钮已经跑了 → 浏览器发 pointercancel → 录音被丢。

       ★ 现在按钮**上下各有一个常驻的 48px 槽**（上槽显示识别状态、
         下槽显示提示语）。上下同时常驻 → 总高度恒定 → 按钮一动不动。
         ⚠️ 关键正是"两个都常驻"：只让上面那个按需出现就会退回老 bug。

       jsdom 不做布局，量不了像素，所以这里断言**结构**：
       两个槽在"没在听"和"在听"两种状态下都必须是**同一对 DOM 节点**。
       只要它们一直在，按钮就不可能被顶动。 */
    mount('', { transcribe: true })

    // 固定高度的槽：h-12（48px）。按 DOM 顺序：[0] 在按钮上方，[1] 在下方。
    const findSlots = () => [...document.querySelectorAll('.h-12.w-full.items-center')]

    // 没在听的时候，两个槽就已经都在了
    const before = findSlots()
    expect(before).toHaveLength(2)
    expect(screen.getByText(/按住说话吧/)).toBeTruthy()

    const mic = screen.getByLabelText('按住说话')
    await act(async () => {
      mic.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
    })
    await act(async () => {
      await Promise.resolve()
    })

    // 在听的时候还是**同一对节点**（谁都没被重建，也没有第三个槽长出来）
    const during = findSlots()
    expect(during).toHaveLength(2)
    expect(during[0]).toBe(before[0])
    expect(during[1]).toBe(before[1])
    // 上槽换成了实时状态（内容变了，高度没变）
    expect(screen.getByText(/我在听|已收到/)).toBeTruthy()
    // ★ 而且必须出现在**上槽**里 —— 放到下槽就会被按住说话的手挡掉
    expect(during[0]!.textContent).toMatch(/我在听|已收到/)
    expect(during[1]!.textContent).not.toMatch(/我在听|已收到/)

    // 收尾，别留一个开着的麦克风
    await act(async () => {
      mic.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
    })
  })

  it('★ 识别状态在麦克风**上方**、提示语在**下方**', () => {
    /* 家长两次报的原话：
       · 2026-09-20「听到的内容应该在话筒上面，现在是在话筒下面，被手遮住。」
       · 2026-09-21「按住说话 放在 说话按钮下。现在说话按钮 稍微 下了点。」

       合起来就是：**识别状态在上、提示语在下**。
       按住说话时手是往下盖的，识别状态放下面会被手挡掉；
       而提示语留在下面，按钮离底边的距离才回到改造前的位置。

       jsdom 不做布局，所以断言 **DOM 顺序**：
       Node.DOCUMENT_POSITION_FOLLOWING === 4 = "排在后面"。
       ★ 顺序不是随便排的 —— 按钮**下面**有什么，直接决定按钮离底边多远。 */
    mount('', { transcribe: true })

    const slots = [...document.querySelectorAll('.h-12.w-full.items-center')]
    const mic = screen.getByLabelText('按住说话')
    expect(slots).toHaveLength(2)

    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

    // 上槽在按钮前面（= 在上面）；按钮在下槽前面（= 下槽在按钮下面）
    expect(follows(slots[0]!, mic)).toBe(true)
    expect(follows(mic, slots[1]!)).toBe(true)
    // 反向各查一次，确认这个断言真的在测顺序（否则恒真也看不出来）
    expect(follows(mic, slots[0]!)).toBe(false)
    expect(follows(slots[1]!, mic)).toBe(false)

    // ★ 光有位置还不够 —— 内容也得各就各位。
    //   否则"把提示语放上面、识别状态放下面"也能通过顺序断言，
    //   而那正好是家长抱怨的那个状态（识别内容被手挡住）。
    expect(slots[1]!.textContent).toContain('按住说话吧')
    expect(slots[0]!.textContent).not.toContain('按住说话吧')
  })

  it('★ 转写失败 → 给出原因，且不往正文里塞东西', async () => {
    transcribeImpl = async () => ({ ok: false, reason: 'network', message: '网络不太顺，检查下网络再试' })
    mount('', { transcribe: true })
    await holdAndRelease()

    expect(screen.getByText(/网络不太顺/)).toBeTruthy()
    // 失败时正文必须干净
    expect(screen.queryByText(/按住说出来的话/)).toBeNull()
  })

  it('★ 转写失败后，"没收到结果"的诊断行要出现（能分清是哪一半坏）', async () => {
    transcribeImpl = async () => ({ ok: false, reason: 'auth', message: '语音服务的密钥不对' })
    mount('', { transcribe: true })
    await holdAndRelease()

    expect(screen.getByText(/语音服务的密钥不对/)).toBeTruthy()
    // 这一轮确实一句结果都没拿到 → 诊断行也该出现
    expect(screen.getByText(/没有收到任何识别结果/)).toBeTruthy()
  })

  it('★ 改作文模式：转写回来的文字要**当指令解析**，不是直接追加', async () => {
    /* 这条是两条路径共用 handleFinal 的意义所在。
       如果这里错了（比如直接把文字追加进正文），
       孩子说「把 A 改成 B」就会把这句话本身写进作文里。

       ⚠️ 断言方式：改作文模式下组件**不回显整篇正文**（那是写作页的事），
       它显示的是"改成了什么"的回执。所以要断言回执里认出了这次替换，
       而不是去找"我家有一只小猫" —— 那个字串在这个组件里根本不会出现。
       （第一版就是照写作页的直觉写的，结果测试假红。）

       ★ 2026-09-21：这条以前**不传 ai** 也能过 —— 靠的是本地正则兜底。
       现在改作文只剩大模型一条路（家长：「改作文 必须是 AI 模型 处理。」），
       不传 ai 测到的就变成"没配 AI 时的提示"，而不是"指令有没有被解析"。
       所以要传 ai，并让桩返回这次替换真正需要的那条指令。 */
    transcribeImpl = async () => ({ ok: true, text: '把小狗改成小猫', ms: 10 })
    parseImpl = async () => ({
      ok: true,
      intent: { kind: 'replace', from: '小狗', to: '小猫' },
      message: '',
    })
    const holder = mount('我家有一只小狗。', { transcribe: true, ai: true })

    await act(async () => {
      screen.getByText('改作文').click()
    })
    await holdAndRelease()

    /* 替换被执行了：回执里点名了被换掉和被换上的词。
       ⚠️ 用 getAllBy 而不是 getBy：改动记录面板里**也会**出现这两个词
       （`edits` 从父级回流了 —— 那才是真实情形），
       单数版本会因为"匹配到多个元素"而报错，看起来像测试坏了。 */
    expect(screen.getAllByText(/小狗/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/小猫/).length).toBeGreaterThan(0)

    /* 而且**没有**把指令原文当成正文追加进去。
       ⚠️ 直接看正文，**不要**再用"界面上搜不到这句话"当替身：
       2026-09-21 起「你说」那一栏会**故意**把孩子原话显示出来（家长要的），
       所以"搜不到"已经不是"没追加"的有效证据了 —— 那样写会变成假红。 */
    expect(holder.text).toBe('我家有一只小猫。')
  })
})

describe('语音写作台 · 诊断提示', () => {
  it('初始不给任何诊断提示（别在没听之前就吓人）', () => {
    mount()
    expect(screen.queryByText(/没有收到任何识别结果/)).toBeNull()
    expect(screen.queryByText(/没能写进正文/)).toBeNull()
  })

  it('一轮听下来一条结果都没有 → 提示"没收到结果"，并说清该去查什么', async () => {
    mount()
    await recordRound(() => {
      /* 故意什么都不喂：模拟识别服务没送任何结果 */
    })

    expect(screen.getByText(/没有收到任何识别结果/)).toBeTruthy()
    // 提示要指向真正该做的事，不能只说"出错了"
    expect(screen.getByText(/允许「小笔苗」使用麦克风/)).toBeTruthy()
  })

  it('收到了结果也写进了正文 → 两条提示都不许出现', async () => {
    mount()
    await recordRound((cb) => {
      cb.onFinal('小河边的柳树发芽了')
    })

    expect(screen.queryByText(/没有收到任何识别结果/)).toBeNull()
    expect(screen.queryByText(/没能写进正文/)).toBeNull()
  })

  /* ---- 下面两条守的是「提示该撤就撤」---- */

  it('第一轮失败挂了提示，第二轮成功之后必须撤掉', async () => {
    mount()
    // 第一轮：一条都没有
    await recordRound(() => {})
    expect(screen.getByText(/没有收到任何识别结果/)).toBeTruthy()

    // 第二轮：正常收到（同一个实例，不再重新 render）
    await recordRound((cb) => cb.onFinal('这一次听清了'))
    expect(screen.queryByText(/没有收到任何识别结果/)).toBeNull()
  })

  it('说作文时等结果的那段时间：不能因为"按过开始"就报没收到结果', async () => {
    /* ★ 这一条才是真正守住"提示别显示太早"的用例，也是最容易被写坏的。
       之前那版把标记写成"按下开始就置位"，而它之所以能蒙过去，
       是因为**每次收到结果又会把它清掉** —— 只有靠这条用例
       （按开始 → 还什么都没收到 → 立刻断言）才能把那个顺序暴露出来。

       真实场景：孩子按下麦克风，正在开口的那一两秒。
       这时报"没有收到任何识别结果"是错的 —— 他还没说呢。 */
    mount()
    await act(async () => {
      screen.getByLabelText('开始说话').click()
    })

    expect(screen.queryByText(/没有收到任何识别结果/)).toBeNull()
  })

  it('连续两轮都没收到结果 → 第二轮结束后提示仍然要在（别自己撤了）', async () => {
    mount()
    await recordRound(() => {})
    expect(screen.getByText(/没有收到任何识别结果/)).toBeTruthy()

    // 第二轮又是空的：提示必须还在
    await recordRound(() => {})
    expect(screen.getByText(/没有收到任何识别结果/)).toBeTruthy()
  })

  it('收到结果的那一刻就撤提示，不用等到按停', async () => {
    /* 这条盯的是"显示太晚"的反面：结果已经在进来，
       提示如果还挂着，说明状态是滞后的。 */
    mount()
    await act(async () => {
      screen.getByLabelText('开始说话').click()
    })
    await act(async () => {
      lastCb?.onFinal('第一句就听清了')
    })
    // 还没按停 —— 但已经收到过结果，就不该有"没收到结果"的提示
    expect(screen.queryByText(/没有收到任何识别结果/)).toBeNull()
  })

  /* ---- 改作文模式：正文没变是**正常结果**，不许报成程序问题 ---- */

  it('改作文模式下正文没变，不许报"没能写进正文"', async () => {
    mount()
    await recordRound(
      (cb) => {
        // 一句听不懂的指令：系统本来就不该改正文
        cb.onFinal('把棍子改成竹签')
      },
      { mode: 'edit' },
    )

    expect(screen.queryByText(/没能写进正文/)).toBeNull()
  })

  it('说作文模式下收到了结果却没写进正文 → 这条才报', async () => {
    /* 用 echo:false 造一个"父级没把 text 传回来"的状态：
       识别结果确实收到了，但组件拿到的 text 一直是空串。
       这正是那条提示要抓的情形。 */
    mount('', { echo: false })
    await act(async () => {
      screen.getByLabelText('开始说话').click()
    })
    await act(async () => {
      lastCb?.onFinal('这句话应该进正文')
    })
    await act(async () => {
      screen.getByLabelText('停止说话').click()
    })

    expect(screen.getByText(/没能写进正文/)).toBeTruthy()
  })
})

/* ============================================================
   改作文 · 走大模型那条路
   ============================================================

   改作文**只有大模型那一条路**（家长 2026-09-21：「改作文 必须是 AI 模型 处理。」）。

   ★ 但大模型在这条链路里**只负责听懂，不负责动笔**：
     它返回的是一条结构化指令，正文永远由本地引擎生成。
     理由是家长 2026-09-19 划的边界 ——
     「不许 AI 帮**写**（生产内容），不是不许改写」。
     所以这一节里最要紧的几条是：
       · 模型回的"全文"必须进不来
       · 模型判成"要 AI 代写"时必须拒绝，而且不许退回本地再试
       · 走 AI 改出来的记录必须标成 by: 'ai'

   ★★ 为什么这一节有三条"失败时不许退回本地"的用例：
     退回本地那版代码**不会报错、不会崩**，它只会**成功**——
     「把小猫改成小狗」本地正则恰好也认，于是正文真的被改对了，
     而"AI 根本没跑"这件事被这次成功彻底掩盖。
     家长看到的是"能改，但很多说法改不了"，他只会去改设置、改说法，
     永远查不到"其实一直是本地在干活"。
     ➜ 所以这里断言的不是"改得对不对"，而是**失败时正文一个字都不许动**。

   ★ 为什么必须钉住"走了哪条路"：路由错了**不会报错**，
     只会表现成"改不动"或"改错地方" —— 和功能没实现长得一模一样。
     这一节的存在理由就是那个下午的诊断结论。
   ============================================================ */

describe('改作文 · 大模型那条路（只让模型听懂，不让它动笔）', () => {
  /**
   * 进入改作文模式，再按住说一句。
   *
   * ⚠️ 断言方式（沿用上面那条老测试的教训）：改作文模式下组件**不回显整篇正文**，
   *    它显示的是"改成了什么"的回执。所以不要去 find "我家有一只小猫" ——
   *    那个字串在这个组件里根本不会出现，照写作页的直觉写就是假红。
   *    这里断言的是：**回执**、**修改记录**、以及**走没走大模型**。
   */
  async function sayToEdit(instruction: string) {
    transcribeImpl = async () => ({ ok: true, text: instruction, ms: 10 })
    await act(async () => {
      screen.getByText('改作文').click()
    })
    await holdAndRelease()
  }

  it('★ 配好 AI：编辑模式必须走大模型，不走本地解析器', async () => {
    // 「我觉得小猫改成小狗更好」正是本地解析器的死穴
    // （会抓成「我觉得小猫」→「小狗更好」）。
    // 走没走 AI，是这条测试唯一要回答的问题。
    const holder = mount('我家有一只小猫。', { transcribe: true, ai: true })
    await sayToEdit('我觉得小猫改成小狗更好')

    expect(parseCalls, '配好 AI 就必须走大模型').toBe(1)
    // 回执说的是"改成了什么"（引擎生成），不是模型给的一句总结
    expect(screen.getByText(/已经改成「小狗」/)).toBeTruthy()
    /* 而且指令原文**没有**被当成正文追加进去。
       ⚠️ 直接看正文 —— 2026-09-21 起「你说」那一栏会故意显示孩子原话，
       所以"界面上搜不到这句"不再是"没追加"的证据（那样写会假红）。 */
    expect(holder.text).toBe('我家有一只小狗。')
    // ★ 正文是本地引擎按指令改的：只动了「小猫」两个字，其余逐字保留
    expect(holder.edits[0]?.after).toBe('我家有一只小狗。')
    expect(holder.edits[0]?.from).toBe('小猫')
    expect(holder.edits[0]?.to).toBe('小狗')
  })

  it('★ 模型返回的"全文"进不来 —— 正文只可能由引擎生成', async () => {
    // 这是"不许 AI 帮写"最直接的验收：就算模型回了一整篇润色稿，
    // 接口形状里没有地方放它，孩子看到的正文一个 AI 造的字都不会有。
    parseImpl = async () => ({
      ok: false,
      reason: 'unknown',
      message: '没太听懂你想怎么改，换个说法再试试',
    })
    const holder = mount('我家有一只小猫。', { transcribe: true, ai: true })
    await sayToEdit('帮我润色一下')

    // 模型没给出合法指令 → 一个字都不动（连本地也不许顶上）
    expect(holder.edits).toHaveLength(0)
    expect(holder.text).toBe('我家有一只小猫。')
    expect(screen.queryByText(/润色好了/)).toBeNull()
  })

  it('★ 模型判成"要 AI 代写" → 明确拒绝，而且**不许退回本地再试一次**', async () => {
    // 「加点比喻」这类要求必须走到 refuse 那条路上。
    // 退回本地解析器会让它绕个弯又被执行 —— 那正是要防的事。
    parseImpl = async () => ({ ok: true, intent: { kind: 'refuse', reason: 'content' }, message: '' })
    const holder = mount('我家有一只小猫。', { transcribe: true, ai: true })
    await sayToEdit('给这个句子加点比喻')

    expect(parseCalls).toBe(1)
    expect(holder.edits).toHaveLength(0)
    expect(holder.text).toBe('我家有一只小猫。')
    // 不能只说"没听懂"—— 那会让孩子一遍遍换说法再试
    expect(screen.getByText(/得你自己写/)).toBeTruthy()
    expect(screen.queryByText(/没太听懂/)).toBeNull()
  })

  it('★ 模型没听懂 → 如实说出来，不许偷偷拿"本地能改的那部分"顶上', async () => {
    // 「把小猫改成小狗」是本地正则**恰好也认**的干净说法 ——
    // 所以这一条才最危险：退回本地之后正文真的改对了，
    // 而"AI 没跑"这件事被这次成功完全掩盖。
    parseImpl = async () => ({
      ok: false,
      reason: 'unknown',
      message: '没太听懂你想怎么改，换个说法再试试',
    })
    const holder = mount('我家有一只小猫。', { transcribe: true, ai: true })
    await sayToEdit('把小猫改成小狗')

    expect(parseCalls).toBe(1)
    expect(holder.edits, '不许退回本地改').toHaveLength(0)
    expect(holder.text).toBe('我家有一只小猫。')
    // 模型的原话要原样端出来，不能被本地那句"没太听懂"顶掉
    expect(screen.getByText(/没太听懂你想怎么改，换个说法再试试/)).toBeTruthy()
  })

  it('★ 连不上 AI → 报"连不上"，不许伪装成"孩子说得不好"', async () => {
    // 这两件事在旧代码里长得一模一样，家长分不清该去查网络还是该怪孩子。
    parseImpl = async () => ({ ok: false, reason: 'server', message: '没能听懂：fetch failed' })
    const holder = mount('我家有一只小猫。', { transcribe: true, ai: true })
    await sayToEdit('把小猫改成小狗')

    expect(holder.edits).toHaveLength(0)
    expect(holder.text).toBe('我家有一只小猫。')
    expect(screen.getByText(/fetch failed/)).toBeTruthy()
  })

  it('★ AI 解析抛异常（网络/密钥/超时）→ 指向设置里那个能自查的按钮', async () => {
    // 这一支才是真正接住"连不上"的地方。
    // ⚠️ 上一版只改了 `!r.ok` 那一支、漏了这一支 —— 等于没改。
    parseImpl = async () => {
      throw new Error('Failed to fetch')
    }
    const holder = mount('我家有一只小猫。', { transcribe: true, ai: true })
    await sayToEdit('把小猫改成小狗')

    expect(holder.edits).toHaveLength(0)
    expect(holder.text).toBe('我家有一只小猫。')
    expect(screen.getByText(/AI 没连上/)).toBeTruthy()
    expect(screen.getByText(/测试连接/)).toBeTruthy()
  })

  it('★ 没配 AI：一次都不许调大模型，也不许偷偷用本地顶上', async () => {
    const holder = mount('我家有一只小猫。', { transcribe: true }) // 刻意不给 ai
    await sayToEdit('把小猫改成小狗')

    expect(parseCalls, '没配 AI 就不该发这次请求').toBe(0)
    expect(holder.edits, '没配 AI 也不许本地顶上').toHaveLength(0)
    expect(holder.text).toBe('我家有一只小猫。')
    // 缺什么说什么，家长才知道该去设置里补哪一样
    expect(screen.getByText(/去设置里选「远程 AI」/)).toBeTruthy()
  })

  it('★ AI 改完要标出"谁动的手"，界面不许说成「你自己改的」', async () => {
    // 模型只负责听懂，动笔的是引擎 —— 但"是谁动手改的"这件事得说准。
    // 不标的话，孩子会以为是自己动的手，界面上那句话就成了假话。
    const holder = mount('我家有一只小猫。', { transcribe: true, ai: true })
    await sayToEdit('把小猫改成小狗')

    expect(holder.edits).toHaveLength(1)
    expect(holder.edits[0].by).toBe('ai')
    // 撤销靠 before/after，两个都必须是对的
    expect(holder.edits[0].before).toBe('我家有一只小猫。')
    expect(holder.edits[0].after).toBe('我家有一只小狗。')

    expect(screen.getByText(/AI 按你说的/)).toBeTruthy()
    // ★ 回执里那句"这是你自己改的"必须换掉 —— 模型动的手，不能记在孩子头上
    expect(screen.getByText(/按你说的改的/)).toBeTruthy()
    expect(screen.queryByText(/这是你自己改的/)).toBeNull()
    // 鼓励语和记录标题也不能说成"你自己的"
    expect(screen.queryByText(/你自己改了/)).toBeNull()
    expect(screen.queryByText(/你自己的修改/)).toBeNull()
  })

  it('★ 走 AI 但最终没改动 → 不留半条记录（撤销不会撤到不存在的状态）', async () => {
    // 模型把指令听懂了，但锚点在正文里找不到（比如孩子记错了词）
    parseImpl = async () => ({
      ok: true,
      intent: { kind: 'replace', from: '老虎', to: '狮子' },
      message: '',
    })
    const holder = mount('我家有一只小猫。', { transcribe: true, ai: true })
    await sayToEdit('把老虎改成狮子')

    expect(parseCalls).toBe(1)
    expect(holder.edits).toHaveLength(0)
    expect(holder.text).toBe('我家有一只小猫。')
    expect(screen.getByText(/没有找到「老虎」/)).toBeTruthy()
  })

  it('★ 修改记录要摆出「原文那句 / 改成 / 你说的话」三行', async () => {
    /*
     * 家长 2026-09-21：「我希望是 **表明作文原文**，
     * 修正内容 就是输入的话的内容。」
     *
     * ⚠️ 断言的是**整句**，不是被换掉的那两个词 ——
     *    只给「小猫 → 小狗」，孩子不知道这是在说哪一句。
     */
    const holder = mount('我家有一只小猫。', { transcribe: true, ai: true })
    await sayToEdit('把小猫改成小狗')

    expect(holder.edits).toHaveLength(1)
    expect(screen.getByText('原文')).toBeTruthy()
    expect(screen.getByText('改成')).toBeTruthy()
    expect(screen.getByText('你说')).toBeTruthy()
    expect(screen.getByText('我家有一只小猫。')).toBeTruthy()
    expect(screen.getByText('我家有一只小狗。')).toBeTruthy()
    expect(screen.getByText('把小猫改成小狗')).toBeTruthy()
  })

  it('★ 「你说」那一栏是**逐字原话**，不是模型整理过的说法', async () => {
    // 孩子说得啰嗦（还带语气词），记录里也得是他自己的话 ——
    // 换成模型润过的版本，就是把他没说过的话记在他头上。
    const holder = mount('我家有一只小猫。', { transcribe: true, ai: true })
    await sayToEdit('我觉得小猫改成小狗更好')

    expect(holder.edits[0]?.said).toBe('我觉得小猫改成小狗更好')
    expect(screen.getByText('我觉得小猫改成小狗更好')).toBeTruthy()
  })

  it('★ 模型想写孩子没说过的字 → 原样告诉他"得你自己说"，正文一个字不动', async () => {
    /*
     * 来源闸门（domain/provenance.ts）在 parseEditInstruction 里把关；
     * 这条测的是**它拦下之后界面上发生什么**：
     * 不许偷偷改成别的、不许退回本地，而且不许只说"没太听懂" ——
     * 因为换个说法是没用的，他得把要加的字自己说出来。
     */
    parseImpl = async () => ({
      ok: false,
      reason: 'invented',
      message: '这几个字你没说过 —— 要加什么，你直接说出来，我就给你加上',
    })
    const holder = mount('我家有一只小猫。', { transcribe: true, ai: true })
    await sayToEdit('把小猫那句改好一点')

    expect(holder.edits).toHaveLength(0)
    expect(holder.text).toBe('我家有一只小猫。')
    expect(screen.getByText(/这几个字你没说过/)).toBeTruthy()
    expect(screen.queryByText(/没太听懂/)).toBeNull()
  })

  it('说作文模式不受影响：配了 AI 也还是追加，不是改写', async () => {
    mount('我家有一只小猫。', { transcribe: true, ai: true })
    transcribeImpl = async () => ({ ok: true, text: '它很可爱', ms: 10 })
    await holdAndRelease()

    expect(parseCalls, '说作文不该碰大模型').toBe(0)
    expect(screen.getByText(/它很可爱/)).toBeTruthy()
  })
})
