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
import { sceneMeta } from '../assets/scenes'

const builtin = buildBuiltinLibrary()

describe('内置题库 · 生成', () => {
  it('136 条 —— 就是 PROMPT_TEMPLATES 里的模板总数', () => {
    const total = Object.values(PROMPT_TEMPLATES).reduce((n, list) => n + list.length, 0)
    expect(builtin.length).toBe(total)
    expect(builtin.length).toBe(136)
    expect(builtinCount()).toBe(136)
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
   */
  it('每个 sceneKey 都对应一张真实存在的插画', () => {
    for (const it of builtin) {
      for (const img of it.images) {
        expect(img.sceneKey, `${it.id} 的配图没有 sceneKey`).toBeTruthy()
        expect(sceneMeta(img.sceneKey!), `${it.id} 引用了不存在的插画「${img.sceneKey}」`).toBeDefined()
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
    expect(reconcileBuiltinLibrary([])).toHaveLength(136)
  })

  it('用户自己的题一条不动，而且排在前面', () => {
    const mine = [userItem('a'), userItem('b')]
    const out = reconcileBuiltinLibrary(mine)
    expect(out).toHaveLength(138)
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
    expect(out).toHaveLength(136)
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
