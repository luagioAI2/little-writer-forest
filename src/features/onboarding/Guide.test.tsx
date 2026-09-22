/* ============================================================
   新手引导 —— 三屏，把「这 App 是干嘛的」讲一遍
   ============================================================

   为什么值得专门测：
     `Onboarding` 只收集设置，一个字都没教。孩子种完树拿到一个空白首页，
     得自己猜「这 App 是干嘛的、我该按哪儿」。

   这一节钉住三件事：
     ① 三屏能走完、「跳过」随时可用、最后一屏落到"开始写第一篇"；
     ② 文案口径和别处一致（AI 的边界、五个入口的名字、树洞的门槛）；
     ③ ★ 引导**绝不碰麦克风** —— 引导里弹权限框是最糟的时机。

   ★★ 2026-09-22：原来这里还有两组用例（约 11 条）测「② 你不用会打字」
     那一屏的录音演示（按住 / 点一下两套手势、按太短的反馈、字一个个落进正文……）。
     那一屏被家长要求**整屏删掉**了，那些用例跟着删 ——
     理由和代价记在 `Guide.tsx` 的文件头。
     ⚠️ 别把它们"顺手加回来"：它们测的组件已经不存在了。
   ============================================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import Guide, { GUIDE_SCREENS } from './Guide'

/** 走到第 n 屏（0 起） */
function goTo(n: number) {
  for (let i = 0; i < n; i++) {
    fireEvent.click(screen.getByRole('button', { name: /继续/ }))
  }
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

describe('新手引导 · 走完三屏', () => {
  it('三屏都能过，最后一屏落到「开始写第一篇」', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    render(<Guide onDone={onDone} />)

    expect(screen.getByText('我是你的树。')).toBeInTheDocument()
    goTo(GUIDE_SCREENS - 1)
    expect(screen.getByText('森林里还有这些。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /开始写第一篇/ }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('★ 就是 3 屏（09-22 删掉了录音那屏 —— 别再悄悄加回来）', () => {
    // 进度点、`isLast`、「跳过」的判据都读它，所以这个数字是有意义的。
    expect(GUIDE_SCREENS).toBe(3)
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

  it('第二屏可以退回第一屏（返回按钮只在前两屏之后的屏上出现）', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)

    expect(screen.queryByRole('button', { name: '上一步' })).toBeNull()
    // ★ 第二屏现在是「写完了，我给你两样东西」（原来这里是录音那屏）
    goTo(1)
    expect(screen.getByText('写完了，我给你两样东西。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByText('我是你的树。')).toBeInTheDocument()
  })

  it('★ 换屏会重新挂载（进场动画才会重播一次）', () => {
    /*
     * ⚠️ 这条测的是 `key={screen}` 本身 —— 它只负责让外层容器换一个新节点，
     *   从而让 anim-rise-in 重新播一遍。
     *   原来旁边还有一条"演示状态不残留"，测的是**条件渲染**；
     *   录音那屏删掉之后它没有对象了，只留下这条。
     *   变异验证过：去掉 key，这条会红（而原来那条照样绿 —— 判据要能红才算判据）。
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

  it('★ 整个引导里一次都不许碰麦克风', () => {
    // 引导里弹权限框是最糟的时机：孩子还不知道这 App 是干嘛的，
    // 拒绝一次就再也不给了；而 WebView 里没权限时录音会**静默失败**。
    // （录音演示删掉之后，引导里已经没有任何麦克风代码路径 ——
    //   这条现在守的是"别把权限申请加进来"。）
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)
    goTo(GUIDE_SCREENS - 1)

    expect(getUserMedia).not.toHaveBeenCalled()
  })
})

describe('引导文案的口径', () => {
  it('★ AI 的边界必须和设置页、点评页说成同一句话', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)
    // ★ 第三屏是「森林里还有这些」，所以 AI 的边界在**第二屏**
    goTo(1)

    expect(screen.getByText('我帮你看，但不替你写。')).toBeInTheDocument()
    // 旧口径不许回来（它在别处已经被推翻过一次）
    expect(screen.queryByText(/小笔苗不会帮你/)).toBeNull()
  })

  it('★ 最后一屏要把底部五个入口都点到名', () => {
    vi.useFakeTimers()
    render(<Guide onDone={vi.fn()} />)
    goTo(GUIDE_SCREENS - 1)

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
    goTo(GUIDE_SCREENS - 1)

    // HOLLOW_UNLOCK_LEVEL = 3：第 4 段琼华树才打开。
    // 引导说"随时可以去看看"，却把树洞讲成现成的，孩子去日记本只会看到
    // 「树洞还没打开」。
    expect(screen.getByText(/树长大一点它才打开/)).toBeInTheDocument()
  })
})
