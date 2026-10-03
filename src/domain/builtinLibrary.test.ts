import { describe, expect, it } from 'vitest'

import {
  BUILTIN_ADDED_AT,
  BUILTIN_ID_PREFIX,
  buildBuiltinLibrary,
  builtinCount,
  reconcileBuiltinLibrary,
  sameLibraryIds,
} from './builtinLibrary'
import { PROMPT_TEMPLATES, TOPIC_TAGS } from './prompts'
import type { LibraryItem } from './library'
import { resolveGenre } from './types'
import { sceneMeta } from '../assets/scenes'

const builtin = buildBuiltinLibrary()

describe('内置题库 · 生成', () => {
  it('条数 —— 就是 PROMPT_TEMPLATES 里的模板总数', () => {
    // ⚠️ 期望值**从数据算**，别写死数字：家长会往题库里加题，
    //    写死的那一刻起，这个测试就从"守行为"变成了"守一个过期数字"。
    const total = Object.values(PROMPT_TEMPLATES).reduce((n, list) => n + list.length, 0)
    expect(total).toBeGreaterThan(0)
    expect(builtin.length).toBe(total)
    expect(builtinCount()).toBe(total)
  })

  it('id 唯一、带前缀、可复现', () => {
    const ids = builtin.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith(BUILTIN_ID_PREFIX))).toBe(true)
    // 同一个函数调两次结果必须一样（对账 / 判重全靠这个）
    expect(buildBuiltinLibrary().map((i) => i.id)).toEqual(ids)
  })

  it('每条都是 builtin 来源、没用过、不叫 AI 生成', () => {
    for (const it of builtin) {
      expect(it.source).toBe('builtin')
      expect(it.timesUsed).toBe(0)
      expect(it.lastUsedAt).toBeUndefined()
      expect(it.aiGenerated).toBe(false)
      expect(it.addedAt).toBe(BUILTIN_ADDED_AT)
    }
  })

  it('模板表的每个 key 都是真实标签，每个标签都有模板', () => {
    const tagIds = new Set(TOPIC_TAGS.map((t) => t.id))
    for (const key of Object.keys(PROMPT_TEMPLATES)) {
      expect(tagIds.has(key), `模板表里的「${key}」不是标签`).toBe(true)
    }
    for (const tag of TOPIC_TAGS) {
      expect(PROMPT_TEMPLATES[tag.id], `标签「${tag.id}」没有模板`).toBeDefined()
    }
  })

  it('category / tagId 跟着标签走', () => {
    const byTag = new Map(TOPIC_TAGS.map((t) => [t.id, t]))
    for (const it of builtin) {
      const tag = byTag.get(it.tagId)
      expect(tag, `找不到标签 ${it.tagId}`).toBeDefined()
      expect(it.category).toBe(tag!.category)
    }
  })

  it('minGrade 用标签的年级，maxGrade 统一 9（高年级也能写）', () => {
    const byTag = new Map(TOPIC_TAGS.map((t) => [t.id, t]))
    for (const it of builtin) {
      expect(it.minGrade).toBe(byTag.get(it.tagId)!.minGrade)
      expect(it.maxGrade).toBe(9)
    }
  })

  it('focus 留空 —— 交给 focusOf 按年级推，不能按标签最低年级硬填', () => {
    for (const it of builtin) {
      expect(it.focus).toEqual([])
    }
  })
})

describe('内置题库 · 内容质量', () => {
  it('标题和引导语都不为空', () => {
    for (const it of builtin) {
      expect(it.title.trim(), `${it.id} 没有标题`).not.toBe('')
      expect(it.lead.trim(), `${it.id} 没有引导语`).not.toBe('')
    }
  })

  it('每道题都有配图 —— 「一个配图一个题」', () => {
    for (const it of builtin) {
      expect(it.images.length, `${it.id} 没有配图`).toBeGreaterThan(0)
    }
  })

  /**
   * 这条是防「静默失败」的：sceneKey 写错不报错，
   * 只是永远渲染成占位画 —— 界面看不出错，孩子看到的是空白。
   *
   * ⚠️ `sceneKey` 现在是**可选**的：`scenes` 里写 `PHOTO_SLOT`（空串）表示
   *    「这一格是纯照片位」，它本来就没有插画可查。所以这里只要求
   *    「**写了的** sceneKey 必须查得到」，而不是「每个图位都得有 sceneKey」。
   *    「图位不许空着」这个意图由下面那条守着 —— 判据跟着模型走，意图不变。
   */
  it('写了的 sceneKey 都对应一张真实存在的插画', () => {
    for (const it of builtin) {
      for (const img of it.images) {
        if (!img.sceneKey) continue
        expect(sceneMeta(img.sceneKey), `${it.id} 引用了不存在的插画「${img.sceneKey}」`).toBeDefined()
      }
    }
  })

  /**
   * 上一版这条写的是「每个图位都必须有 sceneKey」，现在不成立了 ——
   * 纯照片题的图来自覆盖层（`library-items.json`），代码里本来就没有 sceneKey。
   *
   * 但「不许出现空白图位」这个**意图**没变，只是判据要跟着模型走：
   * 一个图位至少要有一个来源 —— 插画（`sceneKey`）或照片（`imageUrl`）。
   * 两个都没有 → `SceneArt` 会渲染成「暂无插图」占位框，而**界面不会报错**。
   */
  it('每个图位都有图可画 —— 插画或照片，至少有一个', () => {
    for (const it of builtin) {
      for (const img of it.images) {
        expect(
          Boolean(img.sceneKey || img.imageUrl),
          `${it.id} 的图位既没有插画也没有照片 —— 会静默渲染成「暂无插图」`,
        ).toBe(true)
      }
    }
  })

  it('连环图（多张）才带「第 N 幅」说明，单图不带', () => {
    for (const it of builtin) {
      if (it.images.length > 1) {
        it.images.forEach((img, i) => {
          expect(img.caption).toBe(`第 ${i + 1} 幅`)
        })
      } else {
        expect(it.images[0].caption).toBeUndefined()
      }
    }
  })

  it('文案里没有半角逗号（项目约定用全角）', () => {
    for (const it of builtin) {
      expect(it.title.includes(','), `${it.id} 标题里有半角逗号`).toBe(false)
      expect(it.lead.includes(','), `${it.id} 引导语里有半角逗号`).toBe(false)
    }
  })
})

describe('内置题库 · 对账', () => {
  const userItem = (id: string): LibraryItem => ({
    id,
    category: 'event',
    tagId: '',
    title: `孩子导入的题 ${id}`,
    lead: '随便写写',
    images: [],
    wordRange: [60, 200],
    minGrade: 1,
    maxGrade: 9,
    focus: [],
    addedAt: 111,
    source: 'imported',
    timesUsed: 3,
    favorite: true,
    aiGenerated: false,
  })

  it('空库 → 长出全部内置题', () => {
    expect(reconcileBuiltinLibrary([])).toHaveLength(builtin.length)
  })

  it('用户自己的题一条不动，而且排在前面', () => {
    const mine = [userItem('a'), userItem('b')]
    const out = reconcileBuiltinLibrary(mine)
    expect(out).toHaveLength(builtin.length + mine.length)
    expect(out.slice(0, 2).map((i) => i.id)).toEqual(['a', 'b'])
    // 连使用痕迹一起原样保留
    expect(out[0]).toEqual(mine[0])
  })

  it('把使用痕迹从旧的内置题带到新的内置题上', () => {
    const stored = reconcileBuiltinLibrary([]).map((i) =>
      i.id === 'builtin-season-1' ? { ...i, timesUsed: 7, favorite: true, lastUsedAt: 999 } : i,
    )
    const out = reconcileBuiltinLibrary(stored)
    const it = out.find((i) => i.id === 'builtin-season-1')!
    expect(it.timesUsed).toBe(7)
    expect(it.favorite).toBe(true)
    expect(it.lastUsedAt).toBe(999)
  })

  it('代码里删掉的模板 → 库里跟着消失（不能留下孤儿）', () => {
    const stored = reconcileBuiltinLibrary([])
    stored.push({ ...stored[0], id: 'builtin-season-99' })
    const out = reconcileBuiltinLibrary(stored)
    expect(out.find((i) => i.id === 'builtin-season-99')).toBeUndefined()
    expect(out).toHaveLength(builtin.length)
  })

  it('模板内容改了 → 以代码为准，但痕迹留着', () => {
    const stored = reconcileBuiltinLibrary([]).map((i) =>
      i.id === 'builtin-season-1' ? { ...i, title: '被改坏的旧标题', timesUsed: 2 } : i,
    )
    const out = reconcileBuiltinLibrary(stored)
    const it = out.find((i) => i.id === 'builtin-season-1')!
    expect(it.title).toBe('春天的公园')
    expect(it.timesUsed).toBe(2)
  })

  it('对账是幂等的 —— 跑两次结果一样', () => {
    const once = reconcileBuiltinLibrary([])
    const twice = reconcileBuiltinLibrary(once)
    expect(sameLibraryIds(once, twice)).toBe(true)
    expect(twice.map((i) => i.title)).toEqual(once.map((i) => i.title))
  })

  it('sameLibraryIds 认得出 id 顺序/数量的变化', () => {
    const a = reconcileBuiltinLibrary([])
    expect(sameLibraryIds(a, reconcileBuiltinLibrary([]))).toBe(true)
    expect(sameLibraryIds(a, a.slice(1))).toBe(false)
    expect(sameLibraryIds(a, [...a].reverse())).toBe(false)
  })
})

/* ============================================================
   内置题 · 格式要求与命题方式（2026-10-01）
   ------------------------------------------------------------
   内置题是「从标签派生」的，所以这两条守卫其实在守一件事：
   **格式要求/命题方式只有一个来源（标签），派生这一层不许自己再判一次。**
   两处判定 = 改一处漏一处，而且两边都不报错。
   ============================================================ */

describe('内置题库 · 格式要求与命题方式', () => {
  it('★ 每条题的 requiredGenre 都等于它标签解析出来的值', () => {
    for (const it of builtin) {
      const tag = TOPIC_TAGS.find((t) => t.id === it.tagId)
      expect(tag, `题 ${it.id} 的标签「${it.tagId}」不在标签表里`).toBeDefined()
      expect(it.requiredGenre, `题 ${it.id}（${it.title}）`).toBe(resolveGenre(tag!.requiredGenre))
    }
  })

  it('★ 命题方式同样只从标签来', () => {
    for (const it of builtin) {
      const tag = TOPIC_TAGS.find((t) => t.id === it.tagId)!
      expect(it.promptMode, `题 ${it.id}（${it.title}）`).toBe(tag.promptMode)
    }
  })

  /* ⛔ 2026-10-02：原本这里有一条「看图作文 / 漫画的题：命题方式是材料
     作文」的守卫 —— 那两条标签连同它们的 11 道题已经按家长决定删掉了
     （家长：「整个应用就是看图作文」），所以这条守卫**没有对象了**。
     ⚠️ 别改成 `expect(material.length).toBe(0)`：那是把「当前状态」写成
        规格 —— 将来真加了材料题，它会误报。标签还在不在，由
        `prompts.test.ts` 那条「不许加回来」的守卫盯着。
     ★ 「题目挂的标签必须真实存在」这条不变量仍然有人守 ——
       就是上面那条「每条题的 requiredGenre 都等于它标签解析出来的值」。 */

  it('★ 应用文的题：格式要求是题目自带的（不是靠 category 表达）', () => {
    const applied = builtin.filter((i) => i.requiredGenre === 'applied')
    expect(applied.length).toBeGreaterThan(0)
    expect(new Set(applied.map((i) => i.tagId))).toEqual(new Set(['applied-writing']))
  })
})
