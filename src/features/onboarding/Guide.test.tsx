/* ============================================================
   新手引导 —— ★ 第一目标不是"介绍功能"，是"让他把手势做一遍"
   ============================================================

   为什么值得专门测：
     `Onboarding` 只收集设置，一个字都没教。孩子种完树拿到一个空白首页，
     得自己猜「这 App 是干嘛的、我该按哪儿」。而核心手势只有一个 ——
     **按住说话** —— 偏偏它最不容易被发现：孩子会去**点**那个麦克风，
     配好转写时点一下什么都不会发生（真实行为就是这样），于是以为坏了。

   这一节钉住五件事：
     ① 手势真的能做成（按太短要有反馈、按够了要出字）；
     ② 演示**绝不碰麦克风** —— 引导里弹权限框是最糟的时机；
     ③ 四屏能走完、「跳过」随时可用、最后一屏落到"开始写第一篇"；
     ④ 文案口径和别处一致（AI 的边界、五个入口的名字）；
     ⑤ ★ **手势跟着设备走**：转写没配好时教的是「点一下」，不是「按住」。
        教错手势等于把孩子送回"以为坏了"的老路。
   ============================================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import Guide, { DEMO_SENTENCE, GUIDE_SCREENS, HOLD_OK_MS } from './Guide'

/** 走到第 n 屏（0 起） */
function goTo(n: number) {
  for (let i = 0; i < n; i++) {
    fireEvent.click(screen.getByRole('button', { name: /继续/ }))
  }
}

/** 按住麦克风演示按钮 ms 毫秒再松手 */
function holdFor(ms: number) {
  const mic = screen.getByRole('button', { name: '按住说话（试一下）' })
  fireEvent.pointerDown(mic)
  act(() => {
    vi.advanceTimersByTime(ms)
  })
  fireEvent.pointerUp(mic)
}

/** 麦克风调用的探针 —— 整个引导里它一次都不该被调用 */
const getUserMedia = vi.fn()

beforeEach(() => {
  getUserMedia.mockClear()
  // jsdom 里没有 mediaDevices，自己放一个探针进去
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('新手引导 · 走完四屏', () => {
  it('四屏都能过，最后一屏落到「开始写第一篇」', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    render(<Guide onDone={onDone} />)

    expect(screen.getByText('我是你的树。')).toBeInTheDocument()
    goTo(GUIDE_SCREENS - 1)
    expect(screen.getByText('森林里还有这些。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /开始写第一篇/ }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('中途没有「开始写第一篇」—— 不许提前结束', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /开始写第一篇/ })).toBeNull()
  })

  it('★「跳过」随时可用，点了立刻结束', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    render(<Guide onDone={onDone} />)

    fireEvent.click(screen.getByRole('button', { name: '跳过' }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('第二屏可以退回第一屏（返回按钮只在前三屏之后的屏上出现）', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)

    expect(screen.queryByRole('button', { name: '上一步' })).toBeNull()
    goTo(1)
    expect(screen.getByText('你不用会打字。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByText('我是你的树。')).toBeInTheDocument()
  })
})

describe('★ 按住说话 —— 这一屏必须真的能按', () => {
  it('按得太短：给提示，且正文里一个字都不许有', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)
    goTo(1)

    // 比阈值少一点点 —— 和真实录音那条路同一句文案
    holdFor(HOLD_OK_MS - 100)

    expect(screen.getByText('按住多说几个字试试')).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(DEMO_SENTENCE.slice(0, 6)))).toBeNull()
  })

  it('★ 按住够久再松手：字一个一个落进正文', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)
    goTo(1)

    holdFor(HOLD_OK_MS + 100)

    // 松手之后才**开始**落字 —— 刚松手时正文还是空的
    expect(screen.queryByText(new RegExp(DEMO_SENTENCE.slice(0, 2)))).toBeNull()

    // 过一小会儿只有前几个字：「一个字一个字长出来」是看得见的
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(screen.getByText(new RegExp(DEMO_SENTENCE.slice(0, 2)))).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(DEMO_SENTENCE))).toBeNull()

    // 走完定时器，整句都在
    act(() => {
      vi.advanceTimersByTime(DEMO_SENTENCE.length * 50 + 200)
    })
    expect(screen.getByText(new RegExp(DEMO_SENTENCE))).toBeInTheDocument()
  })

  it('★ 落完字之后，顺带把「语音改作文」也教了', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)
    goTo(1)

    expect(screen.queryByText(/我就只改那两个字/)).toBeNull()
    holdFor(HOLD_OK_MS + 100)
    act(() => {
      vi.advanceTimersByTime(DEMO_SENTENCE.length * 50 + 200)
    })
    expect(screen.getByText(/我就只改那两个字/)).toBeInTheDocument()
  })

  it('★ 整个引导里一次都不许碰麦克风', () => {
    // 引导里弹权限框是最糟的时机：孩子还不知道这 App 是干嘛的，
    // 拒绝一次就再也不给了；而 WebView 里没权限时录音会**静默失败**。
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)
    goTo(1)

    holdFor(HOLD_OK_MS + 100)
    act(() => {
      vi.advanceTimersByTime(DEMO_SENTENCE.length * 50 + 200)
    })

    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('★ 翻页之后演示状态不残留（第二屏试到一半就翻页，回来是干净的）', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)
    goTo(1)

    holdFor(HOLD_OK_MS + 100)
    act(() => {
      vi.advanceTimersByTime(DEMO_SENTENCE.length * 50 + 200)
    })
    expect(screen.getByText(new RegExp(DEMO_SENTENCE))).toBeInTheDocument()

    // 前进再退回来
    fireEvent.click(screen.getByRole('button', { name: /继续/ }))
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))

    expect(screen.getByText('你说的字，会一个一个出现在这里。')).toBeInTheDocument()
  })

  it('★ 换屏会重新挂载（进场动画才会重播一次）', () => {
    /*
     * ⚠️ 这条和上一条是两回事，别合并：
     *   · 上一条测的是"演示状态不残留" —— 那是**条件渲染**做到的
     *     （screen 一变组件就卸载了，和 key 无关）；
     *   · 这条测的是 `key={screen}` 本身 —— 它只负责让外层容器换一个新节点，
     *     从而让 anim-rise-in 重新播一遍。
     *   我一开始把两件事写成一条注释，变异验证时（去掉 key）才发现：
     *   上一条照样绿。判据要能红才算判据。
     */
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)

    const box = () => screen.getByText('我是你的树。').closest('.anim-rise-in')
    const first = box()
    expect(first).not.toBeNull()

    goTo(1)
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))

    // 回到第一屏，但外层容器必须是一个**新**节点
    expect(box()).not.toBe(first)
  })
})

describe('引导文案的口径', () => {
  it('★ AI 的边界必须和设置页、点评页说成同一句话', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)
    goTo(2)

    expect(screen.getByText('我帮你看，但不替你写。')).toBeInTheDocument()
    // 旧口径不许回来（它在别处已经被推翻过一次）
    expect(screen.queryByText(/小笔苗不会帮你/)).toBeNull()
  })

  it('★ 最后一屏要把底部五个入口都点到名', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)
    goTo(3)

    for (const name of ['写作文', '日记本', '成长树', '文心卡', '旅行图']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })

  it('第一屏用的是真实的成长树，不是自己另画一套', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)

    // TreeArt 给每棵树带 aria-label「成长树第 N 阶段」
    expect(screen.getByLabelText('成长树第 1 阶段')).toBeInTheDocument()
    // ★ 最后一格必须是**真正的最后一段**（第 12 段通天神树），不是随手挑一棵大的：
    //   箭头是递进的，最后一格会被读成"长到头的样子"，而底下那行字写的是
    //   "一直长到通天神树" —— 两处对不上就是这一屏在说谎。
    //   最初写的是第 10 段星辰树（名字对、段位错），截图走查时才发现。
    expect(screen.getByLabelText('成长树第 12 阶段')).toBeInTheDocument()
    expect(screen.getByText('通天神树')).toBeInTheDocument()
  })

  it('★ 树洞有段位门槛，引导里必须说出来（不然孩子当天就扑空）', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)
    goTo(3)

    // HOLLOW_UNLOCK_LEVEL = 3：第 4 段琼华树才打开。
    // 引导说"随时可以去看看"，却把树洞讲成现成的，孩子去日记本只会看到
    // 「树洞还没打开」。
    expect(screen.getByText(/树长大一点它才打开/)).toBeInTheDocument()
  })
})

describe('★ 手势必须跟着设备走（按住 / 点一下，两套都要教对）', () => {
  it('配好了转写：教「按住」，按钮的 aria-label 也是按住', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} canHold />)
    goTo(1)

    expect(screen.getByText(/按住下面的按钮/)).toBeInTheDocument()
    expect(screen.getByText('按住说话吧')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '按住说话（试一下）' })).toBeInTheDocument()
  })

  it('★ 转写没配好：改教「点一下」，绝不出现「按住」', () => {
    // 这一条防的是：引导教按住、写作页那个按钮却是点击 ——
    // 孩子按住不动，界面毫无反应，于是认定麦克风坏了。
    // 那正是这个引导存在的理由，自己把它搞砸最讽刺。
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} canHold={false} />)
    goTo(1)

    expect(screen.getByText(/点一下下面的按钮开始说/)).toBeInTheDocument()
    expect(screen.getByText('点一下，开始说')).toBeInTheDocument()
    expect(screen.queryByText(/按住下面的按钮/)).toBeNull()
    expect(screen.queryByText('按住说话吧')).toBeNull()
    expect(screen.getByRole('button', { name: '点一下开始说（试一下）' })).toBeInTheDocument()
  })

  it('★ 点一下那套：两下点击能把整句落进正文', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} canHold={false} />)
    goTo(1)

    const mic = screen.getByRole('button', { name: '点一下开始说（试一下）' })

    fireEvent.click(mic)
    expect(screen.getByText('我在听……')).toBeInTheDocument()

    fireEvent.click(mic)
    act(() => {
      vi.advanceTimersByTime(DEMO_SENTENCE.length * 50 + 200)
    })
    expect(screen.getByText(new RegExp(DEMO_SENTENCE))).toBeInTheDocument()
  })

  it('★ 点一下那套不受"按太短"的时长门槛约束', () => {
    // 时长门槛是给"按住"防误触的。点击是明确的两下，没有误触可言，
    // 拿时长去挡孩子只会让他莫名其妙被拒。
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} canHold={false} />)
    goTo(1)

    const mic = screen.getByRole('button', { name: '点一下开始说（试一下）' })
    fireEvent.click(mic)
    fireEvent.click(mic) // 中间不推进任何时间

    act(() => {
      vi.advanceTimersByTime(DEMO_SENTENCE.length * 50 + 200)
    })
    expect(screen.queryByText('按住多说几个字试试')).toBeNull()
    expect(screen.getByText(new RegExp(DEMO_SENTENCE))).toBeInTheDocument()
  })

  it('点一下那套一样不许碰麦克风', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} canHold={false} />)
    goTo(1)

    const mic = screen.getByRole('button', { name: '点一下开始说（试一下）' })
    fireEvent.click(mic)
    fireEvent.click(mic)
    act(() => {
      vi.advanceTimersByTime(DEMO_SENTENCE.length * 50 + 200)
    })

    expect(getUserMedia).not.toHaveBeenCalled()
  })
})
