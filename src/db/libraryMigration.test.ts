/* ============================================================
   题库记录的**老存档迁移** —— `genre` → `requiredGenre`
   ============================================================

   2026-10-01 把题目的 `genre` 改名成 `requiredGenre`（语义收窄为
   「题目**指定**的文体」，2026-10-02 再收窄为「题目**自带**的格式要求」）。
   改名会改掉**存进去的 key** ——
   老用户库里那批题带的是旧名字。

   ⚠️ 这个失败是**静默**的：题一道不少、界面照常、不报错、计数也对，
      只是格式要求悄悄从「应用文」退回「记叙文」—— 而那正是我们花一整轮
      修掉的那个 bug（《节约用水倡议书》会生成一篇**写景**范文）。

   所以这里不测「某个函数返回什么」，测的是**从库里读出来的东西**：
   老记录写进去 → 走真实的读取路径 → 必须带上新 key。
   ⚠️ 库里读题的路**不止一条**（首屏快照 / 题库页），所以两条都要测 ——
      只测一条，另一条忘了迁移也照样绿。
   ============================================================ */

// ⚠️ 必须第一个 import：db.ts 在模块顶层就 new 了库
import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'
import { db, listLibrary, readBootSnapshot, saveLibraryItems } from './db'
import type { LibraryItem } from '../domain/library'

/** 一条「2026-10-01 之前」存进去的题库记录：格式要求那个字段还叫 `genre` */
type LegacyRow = LibraryItem & { genre?: string }

function legacyRow(over: Partial<LegacyRow> = {}): LegacyRow {
  return {
    id: 'legacy-1',
    category: 'event',
    tagId: 'applied-writing',
    title: '节约用水倡议书',
    lead: '写一份倡议书，号召大家一起节约用水。',
    images: [],
    wordRange: [200, 400],
    minGrade: 4,
    maxGrade: 9,
    focus: [],
    addedAt: 1_700_000_000_000,
    source: 'imported',
    timesUsed: 0,
    aiGenerated: false,
    genre: 'applied', // ← 旧名字
    ...over,
  }
}

beforeEach(async () => {
  await db.library.clear()
})

describe('题库老存档迁移 · genre → requiredGenre', () => {
  it('★★ 题库页那条路（listLibrary）读出来必须带上 requiredGenre', async () => {
    await db.library.bulkPut([legacyRow()])
    const rows = await listLibrary()
    expect(rows).toHaveLength(1)
    expect(rows[0].requiredGenre).toBe('applied')
  })

  it('★★ 首屏快照那条路（readBootSnapshot）也要迁移', async () => {
    await db.library.bulkPut([legacyRow()])
    const snap = await readBootSnapshot()
    const got = snap.library.find((i) => i.id === 'legacy-1')
    expect(got, '快照里找不到那条题').toBeDefined()
    expect(got!.requiredGenre).toBe('applied')
  })

  it('已经有新 key 的记录原样通过（幂等，读多少次都一样）', async () => {
    await saveLibraryItems([{ ...legacyRow(), requiredGenre: 'applied' }])
    expect((await listLibrary())[0].requiredGenre).toBe('applied')
    expect((await listLibrary())[0].requiredGenre).toBe('applied')
  })

  it('★ 老记录本来就没有 genre → 不硬造一个，交给缺省（记叙文）', async () => {
    const row = legacyRow()
    delete (row as unknown as Record<string, unknown>).genre
    await db.library.bulkPut([row])
    expect((await listLibrary())[0].requiredGenre).toBeUndefined()
  })

  it('★ 迁移没顺手改掉别的字段，也没改排序（按 addedAt 倒序）', async () => {
    await db.library.bulkPut([
      legacyRow({ id: 'a', addedAt: 100 }),
      legacyRow({ id: 'b', addedAt: 300 }),
      legacyRow({ id: 'c', addedAt: 200 }),
    ])
    const rows = await listLibrary()
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a'])
    expect(rows.map((r) => r.title)).toEqual([
      '节约用水倡议书',
      '节约用水倡议书',
      '节约用水倡议书',
    ])
  })
})
