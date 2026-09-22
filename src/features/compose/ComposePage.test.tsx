/* ============================================================
   题库 → 写作页 的交接（回归测试）
   ============================================================

   真实事故：
     题库页点「就用这题」，页面确实跳到了「写作文」，
     但那一页仍停在第一步「今天写什么」，一道题都没选中 ——
     孩子看到的就是「点了没反应」。

   根因有两层：
     1. `LibraryPage.choosePrompt` 只 dispatch 了一次跳转 + 弹了个 toast，
        题目本身谁也没拿到（题目只活在题库页的局部 state 里）。
     2. 打开题库页时 App 会把整棵页面树换掉
        （`showLibrary ? <LibraryPage/> : <>{page}</>`），
        写作页会被**卸载重建**，页面内的 useState 一律归零 ——
        所以「选中哪道题」必须放在 store 里，不能放在页面 state 里。

   所以这个文件盯的就是那条 store 通道：
     题库页写 → 写作页取 → 立刻清空。

   ⚠️ fake-indexeddb/auto 必须第一个 import：db.ts 在模块顶层就
   `new LittleWriterDb()`，它构造时要能拿到全局 indexedDB。
   ============================================================ */

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useApp } from '../../store/useApp'
import type { CompositionPrompt } from '../../domain/types'
import type { LibraryItem } from '../../domain/library'
import ComposePage from './ComposePage'
import LibraryPage from '../library/LibraryPage'

function makePrompt(over: Partial<CompositionPrompt> = {}): CompositionPrompt {
  return {
    id: 'p-lib-1',
    category: 'scene',
    tagId: '',
    title: '雨后的校园',
    lead: '下雨之后，校园里有什么不一样了？',
    images: [{ sceneKey: 'rain-window' }],
    wordRange: [100, 300],
    minGrade: 3,
    maxGrade: 6,
    focus: ['observation'],
    ...over,
  }
}

function makeLibraryItem(over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    ...makePrompt(),
    addedAt: 1,
    source: 'imported',
    timesUsed: 0,
    aiGenerated: false,
    ...over,
  }
}

beforeEach(() => {
  useApp.setState({
    pendingPrompt: null,
    works: [],
    library: [],
    settings: {
      ...useApp.getState().settings,
      grade: 3,
      onboarded: true,
      /* ★ AI 配置也要归零。store 是模块级单例，**跨用例不清空** ——
         不显式重置的话，前一个用例把 AI 配成远程，
         后一个用例就会莫名其妙地走远程分支（真实网络请求 + 兜底），
         症状是"这条用例单独跑是绿的、一起跑就红"。 */
      ai: { ...useApp.getState().settings.ai, mode: 'local', apiKey: '' },
    },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('题库页把题目交出去', () => {
  it('点「就用这题」会把题目写进 pendingPrompt（回归：以前题目根本没交出去）', async () => {
    const item = makeLibraryItem({ id: 'lib-1', title: '雨后的校园' })
    useApp.setState({ library: [item] })

    render(<LibraryPage />)

    // 列表里那张卡的「就用这题」
    const use = await screen.findByRole('button', { name: '就用这题' })
    act(() => use.click())

    await waitFor(() => {
      expect(useApp.getState().pendingPrompt?.id).toBe('lib-1')
    })
  })

  it('「随机抽一题」抽到的题也能交出去', async () => {
    const item = makeLibraryItem({ id: 'lib-random', title: '抽到的那道题' })
    useApp.setState({ library: [item] })

    render(<LibraryPage />)

    const roll = await screen.findByRole('button', { name: /随机抽一题/ })
    act(() => roll.click())
    // 抽出来先开预览抽屉，抽屉里的「就用这题写」才是真正的入口
    const useInSheet = await screen.findByRole('button', { name: '就用这题写' })
    act(() => useInSheet.click())

    await waitFor(() => {
      expect(useApp.getState().pendingPrompt?.id).toBe('lib-random')
    })
  })
})

describe('写作页把题目接过来', () => {
  it('挂载时发现有待接的题，直接进写作步（回归：以前停在出题页什么都不发生）', async () => {
    const prompt = makePrompt({ id: 'p-hand-1', title: '雨后的校园' })
    useApp.setState({ pendingPrompt: prompt })

    render(<ComposePage />)

    // 1) 取走了就清空 —— 不然下次再进写作页又会自动开同一道题
    await waitFor(() => {
      expect(useApp.getState().pendingPrompt).toBeNull()
    })

    // 2) 真的开了一篇稿，而且挂的是这道题
    await waitFor(() => {
      const works = useApp.getState().works
      expect(works).toHaveLength(1)
      expect(works[0].promptId).toBe('p-hand-1')
    })

    // 3) 界面上已经进到写作台（沉浸模式），不再是「今天写什么」
    expect(await screen.findByText('写好了，让树看看')).toBeInTheDocument()
    expect(screen.queryByText('今天写什么')).toBeNull()
  })

  it('没有待接的题时安静地停在出题页，不会自己开一篇稿', async () => {
    render(<ComposePage />)

    expect(await screen.findByText('今天写什么')).toBeInTheDocument()
    expect(useApp.getState().works).toHaveLength(0)
  })

  it('待接的题只消费一次，不会重复开稿', async () => {
    useApp.setState({ pendingPrompt: makePrompt({ id: 'p-once' }) })
    const { rerender } = render(<ComposePage />)

    await waitFor(() => expect(useApp.getState().works).toHaveLength(1))
    rerender(<ComposePage />)

    // 给 effect 留一轮时间，确认没有第二次开稿
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(useApp.getState().works).toHaveLength(1)
    expect(useApp.getState().pendingPrompt).toBeNull()
  })

  it('接着写的时候会把这道题记一次「用过」', async () => {
    const item = makeLibraryItem({ id: 'p-used', title: '记一次使用' })
    useApp.setState({ library: [item], pendingPrompt: item })

    render(<ComposePage />)

    await waitFor(() => {
      const used = useApp.getState().library.find((i) => i.id === 'p-used')
      expect(used?.timesUsed).toBe(1)
      expect(used?.lastUsedAt).toBeTypeOf('number')
    })
  })
})

/* ============================================================
   细标签的显示 —— ★ 界面上不许出现英文 id
   ============================================================

   真实观感问题：标签在数据里存的是英文 id（`weather`），
   而这里以前直接把 id 打出来，孩子看到的是「🌧️ weather」。

   注意这个 bug 不会让任何东西报错，只是"看着不对劲"，
   所以四层验证里只有这一层（界面）能抓到它。
   ============================================================ */

describe('细标签 · 显示中文', () => {
  it('★ 标签显示中文名，不是英文 id（回归：以前是「🌧️ weather」）', async () => {
    const item = makeLibraryItem({ id: 'lib-tag', category: 'scene', tagId: 'weather' })
    useApp.setState({ library: [item] })

    render(<ComposePage />)

    // 细标签在选了「写景」之后才出现
    const sceneChip = await screen.findByRole('button', { name: /写景/ })
    act(() => sceneChip.click())

    // 中文名出来了
    expect(await screen.findByRole('button', { name: /天气/ })).toBeInTheDocument()
    // 英文 id 不许露到界面上
    expect(screen.queryByRole('button', { name: /weather/ })).toBeNull()
  })

  it('认不出的自定义标签原样显示，不会变成空白', async () => {
    const item = makeLibraryItem({ id: 'lib-custom', category: 'scene', tagId: '我的私房题' })
    useApp.setState({ library: [item] })

    render(<ComposePage />)

    const sceneChip = await screen.findByRole('button', { name: /写景/ })
    act(() => sceneChip.click())

    expect(await screen.findByRole('button', { name: /我的私房题/ })).toBeInTheDocument()
  })
})

/* ============================================================
   ★「我改了设置，怎么没变化？」—— 写法是存起来的，不会自己重算
   ============================================================

   真实反馈：「好像显示的还是之前的，改动未生效」。

   成因：`handleEssay` 里 `if (w?.modelEssay) { setStep('essay'); return }` ——
   已经有存好的那份就直接端出来，**永远不重算**。
   家长把 AI 配好之后点进去，看到的还是旧引擎写的那份，
   于是合理地认为"我改了设置但没生效"。

   修法：存着的那份和当前配置对不上时，明说 + 给一键重新生成。
   ============================================================ */

/** 走到「写法」那一步：写点正文 → 提交 → 点「看看更好的写法」 */
async function goToEssayStep() {
  // 正文不能是空的，否则提交会被挡下来。用键盘兜底那条路塞一句进去。
  const openKb = await screen.findByText('不方便说话？用键盘输入')
  await act(async () => {
    openKb.click()
  })
  const input = await screen.findByPlaceholderText('今天……')
  await act(async () => {
    fireEvent.change(input, {
      target: { value: '下雨了，我和小明在操场上玩。雨停了以后，天上有一条彩虹。' },
    })
  })
  await act(async () => {
    screen.getByRole('button', { name: '确定' }).click()
  })

  const submit = await screen.findByText('写好了，让树看看')
  await act(async () => {
    submit.click()
  })
  // 提交后进点评页
  const look = await screen.findByRole('button', { name: /看看更好的写法/ }, { timeout: 5000 })
  await act(async () => {
    look.click()
  })
}

describe('更好的写法 · 存着的那份会不会过期', () => {
  it('★ 存的是本地引擎写的、现在配好了 AI → 要提示可以重新生成', async () => {
    const item = makeLibraryItem({ id: 'p-stale', title: '雨后的校园' })
    /* 先不配 AI 提交 —— 这样生成出来的写法 engine 是 local */
    useApp.setState({
      library: [item],
      pendingPrompt: item,
      settings: { ...useApp.getState().settings, grade: 3, onboarded: true },
    })

    render(<ComposePage />)
    await goToEssayStep()

    // 两边都是本地，对得上 → 不该出现"这份是本地引擎写的"
    expect(screen.queryByText(/这份是本地引擎写的/)).toBeNull()

    /* 现在家长把 AI 配好了（远程 + 密钥）—— 存着的那份就变成"旧的"了 */
    await act(async () => {
      useApp.setState({
        settings: {
          ...useApp.getState().settings,
          ai: { ...useApp.getState().settings.ai, mode: 'remote', apiKey: 'sk-test' },
        },
      })
    })

    expect(await screen.findByText(/这份是本地引擎写的/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /用 AI 重新生成/ })).toBeInTheDocument()
  })

  it('没配 AI 时不提示"这份是旧的"（两边一致，没什么可提示的）', async () => {
    const item = makeLibraryItem({ id: 'p-fresh', title: '雨后的校园' })
    useApp.setState({
      library: [item],
      pendingPrompt: item,
      settings: { ...useApp.getState().settings, grade: 3, onboarded: true },
    })

    render(<ComposePage />)
    await goToEssayStep()

    expect(screen.queryByText(/这份是本地引擎写的/)).toBeNull()
    // 但"换一版"的入口应该在 —— 孩子可能就是想再要一版
    expect(screen.getByRole('button', { name: /换一版/ })).toBeInTheDocument()
  })
})

/* ============================================================
   ★ 题材记住上次选的（写景 = 首次默认）
   ============================================================ */

describe('题材选择 · 记住上次选的', () => {
  it('★ 写作页默认选中「写景」，「随机出题」可以直接点', async () => {
    useApp.setState({ settings: { ...useApp.getState().settings, lastCategory: 'scene' } })

    render(<ComposePage />)

    // 描述语出来了（说明「写景」已选）
    expect(await screen.findByText(/春夏秋冬/)).toBeInTheDocument()

    // 随机出题按钮不是灰的
    const roll = screen.getByRole('button', { name: /随机出题/ })
    expect(roll).not.toBeDisabled()
  })

  it('上次选了「写人」，下次进来直接是写人', async () => {
    useApp.setState({ settings: { ...useApp.getState().settings, lastCategory: 'person' } })

    render(<ComposePage />)

    // 写人的描述语
    expect(await screen.findByText(/爸爸妈妈/)).toBeInTheDocument()
  })

  it('点选题材会把选择写进 settings.lastCategory', async () => {
    useApp.setState({ settings: { ...useApp.getState().settings, lastCategory: 'scene' } })

    render(<ComposePage />)

    const person = await screen.findByRole('button', { name: /写人/ })
    act(() => person.click())

    await waitFor(() => {
      expect(useApp.getState().settings.lastCategory).toBe('person')
    })
  })

  it('旧存档没有 lastCategory 时，mergeSettings 兜底成写景，页面也默认写景', async () => {
    // 模拟老存档：直接写进 store，不走 mergeSettings
    const s = useApp.getState().settings
    const oldSave = { ...s } as Record<string, unknown>
    delete oldSave.lastCategory
    useApp.setState({ settings: oldSave as unknown as typeof s })

    render(<ComposePage />)

    // 页面渲染时 useState 会读 settings.lastCategory；
    // 如果 store 里缺这个字段，组件初始化后 category 是 undefined，
    // 但 TypeScript 类型说是 CompositionCategory，所以这里要守的是
    // "即使存档里没有，也绝不能崩"——也就是别抛 TypeError。
    // 真实行为：旧存档在应用启动时会被 mergeSettings 补上，
    // 这个用例防的是"还没 merge 之前"（比如测试环境直接写了旧存档）。
    expect(await screen.findByText(/春夏秋冬/)).toBeInTheDocument()
  })
})
