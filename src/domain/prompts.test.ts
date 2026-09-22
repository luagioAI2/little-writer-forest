/* ============================================================
   标签体系 —— 显示与解析
   ============================================================

   这一节守的是「**界面上不能出现英文标签 id**」这件事。

   背景：标签 id 是英文的（`weather`），而孩子和家长看到的应该是中文。
   以前 ComposePage 直接把 id 打出来，孩子看到的是「🌧️ weather」。

   同时家长手写题库数据时会自然写中文（`"tagId": "天气"`），
   所以解析要两头都认：id 和中文 label 都指向同一个标签。

   为什么值得写测试：`resolveTagId` 认错一个标签**不会报错** ——
   只会安静地筛不到题、或者筛到错的题。
   ============================================================ */

import { describe, expect, it } from 'vitest'
import { TOPIC_TAGS, resolveTagId, tagById, tagLabel } from './prompts'

describe('tagLabel · 界面上永远显示中文', () => {
  it('认识 id 就翻成中文', () => {
    expect(tagLabel('weather')).toBe('天气')
    expect(tagLabel('season')).toBe('四季')
  })

  it('★ 所有内置标签的显示名都必须是中文（不许漏一个英文 id）', () => {
    const notChinese = TOPIC_TAGS.filter((t) => !/[\u4e00-\u9fa5]/.test(t.label))
    expect(notChinese.map((t) => t.id)).toEqual([])
  })

  it('认不出的标签原样返回，总比显示空白强', () => {
    expect(tagLabel('我的私房题')).toBe('我的私房题')
  })
})

describe('resolveTagId · 写中文也认', () => {
  it('写中文 label 能解析回 id', () => {
    expect(resolveTagId('天气')).toBe('weather')
    expect(resolveTagId('四季')).toBe('season')
  })

  it('写 id 原样通过', () => {
    expect(resolveTagId('weather')).toBe('weather')
  })

  it('前后空格不算数', () => {
    expect(resolveTagId('  天气  ')).toBe('weather')
  })

  it('家长自定义的标签不该被改写', () => {
    expect(resolveTagId('我的私房题')).toBe('我的私房题')
  })

  it('空字符串返回空，不炸', () => {
    expect(resolveTagId('')).toBe('')
    expect(resolveTagId('   ')).toBe('')
  })

  it('★ 中文写法和英文写法必须落到同一个 id（否则筛选会漏）', () => {
    for (const t of TOPIC_TAGS) {
      expect(resolveTagId(t.label), `标签「${t.label}」的中文没解析回 ${t.id}`).toBe(t.id)
      expect(resolveTagId(t.id)).toBe(t.id)
    }
  })
})

describe('★ 标签表本身的约束', () => {
  it('id 不重复', () => {
    const ids = TOPIC_TAGS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('★ 中文名不重复 —— 重名会让「按中文解析」出现歧义，静默选错一个', () => {
    const labels = TOPIC_TAGS.map((t) => t.label)
    const dup = labels.filter((l, i) => labels.indexOf(l) !== i)
    expect(dup).toEqual([])
  })

  it('tagById 和 tagLabel 对同一份表是一致的', () => {
    for (const t of TOPIC_TAGS) {
      expect(tagById(t.id)).toBe(t)
      expect(tagLabel(t.id)).toBe(t.label)
    }
  })
})
