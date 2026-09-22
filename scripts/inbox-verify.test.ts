/* ============================================================
   收件箱闸门 —— library-inbox/ 里的题，到底导得进去吗？
   ============================================================

   背景：AI 会话里「贴图 → 出题 → 确认添加」这条路，最后一步是把一个
   JSON 文件放进 `library-inbox/`，再由人在 App 的「📥 导入题库」里导进去。
   中间没有人把关 —— 而这道题最恶心的地方在于**一半的错是静默的**：

     · `sceneKey` 写错        → 不报错，那张图永远用不上
     · `focus` 写了不认识的值  → 不报错，被默默过滤掉，评分权重悄悄变了
     · `wordRange` 写错形状    → 不报错，默默变成默认的 [60, 200]
     · `minGrade` 写成字符串   → 不报错，默默变成 1 年级
     · 图片条目两个字段都没给   → 不报错，被默默丢掉，连环图少一张

   人眼是查不出这些的（导进去看着「成功」，其实是错的）。所以这里用
   **App 自己的 `importLibrary()`** 来跑一遍 —— 不另写一份校验，
   免得两边规则漂移、同一个 bug 修两遍。

   跑法：

     npm run inbox:check        # 只跑这道闸门
     npm test                   # 也跟着跑

   约定：

     library-inbox/*.json        → 待导入的题，**必须全部合格**
     library-inbox/*.draft.json  → 还没定稿的草稿，跳过不检

   判据分三层，从「导得进去」到「导进去是对的」：
     ① 导得进去     —— importLibrary 不报错、不丢条
     ② 导进去是对的 —— sceneKey 真实存在、图片路径真实存在、没有静默降级
     ③ 导进去讲得通 —— 年级/字数区间自洽（这些字段错了 App 会兜底，但兜底后不是你要的题）
   ============================================================ */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sceneMeta } from '../src/assets/scenes'
import { importLibrary } from '../src/domain/library'

/* 用 cwd 而不是 import.meta.url —— vitest 里 import.meta.url 是
   http:// 开头的假地址，fileURLToPath 会直接抛「URL must be of scheme file」。
   脚本约定从项目根跑（npm run inbox:check / npm test 都是）。 */
const ROOT = resolve(process.cwd())
const INBOX = join(ROOT, 'library-inbox')
const PUBLIC_DIR = join(ROOT, 'public')

/** 评分维度 —— 和 types.ts 的 ScoreDimension 对齐（写错会被静默过滤） */
const FOCUS_OK = ['observation', 'structure', 'vocabulary', 'imagination', 'emotion']

/** 类别 —— 和 library.ts 的 CATEGORY_ALIAS 对齐（写错整条会被丢掉） */
const CATEGORY_OK = ['scene', 'person', 'event', 'object', 'imagine', '写景', '写人', '写事', '状物', '想象']

type Obj = Record<string, unknown>

interface InboxFile {
  name: string
  raw: string
  items: Obj[]
}

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 一个条目里所有配图（不是对象的条目也算进来，好把「写了个字符串」这种错报出来） */
function imagesOf(item: Obj): unknown[] {
  return Array.isArray(item.images) ? item.images : []
}

/** 配图地址：imageUrl 是正名，url / src / path 是别名（App 也认） */
function imageUrlOf(im: unknown): string {
  if (typeof im === 'string') return im.trim()
  if (!isObj(im)) return ''
  for (const k of ['imageUrl', 'url', 'src', 'path']) {
    const v = im[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function sceneKeyOf(im: unknown): string {
  if (!isObj(im)) return ''
  const v = im.sceneKey
  return typeof v === 'string' ? v.trim() : ''
}

function titleOf(item: Obj): string {
  const t = item.title
  return typeof t === 'string' && t.trim() ? t.trim() : '(没有标题)'
}

function loadInbox(): InboxFile[] {
  if (!existsSync(INBOX)) return []
  return readdirSync(INBOX)
    // *.draft.json 是还没定稿的草稿，故意不检 —— 收件箱里允许有半成品
    .filter((f) => f.endsWith('.json') && !f.endsWith('.draft.json'))
    .sort()
    .map((name) => {
      const raw = readFileSync(join(INBOX, name), 'utf8')
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return { name, raw, items: [] }
      }
      const items = Array.isArray(parsed)
        ? parsed
        : isObj(parsed) && Array.isArray(parsed.items)
          ? parsed.items
          : []
      return { name, raw, items: items.filter(isObj) }
    })
}

const files = loadInbox()

describe('library-inbox 收件箱闸门', () => {
  it('收件箱目录存在', () => {
    expect(existsSync(INBOX)).toBe(true)
  })

  if (files.length === 0) {
    it('收件箱是空的（没有待导入的题）', () => {
      // 空收件箱是正常状态，不是失败 —— 新克隆的仓库就是这样
      expect(files.length).toBe(0)
    })
    return
  }

  for (const file of files) {
    describe(`📄 ${file.name}`, () => {
      it('是合法 JSON，且至少有一条题', () => {
        expect(() => JSON.parse(file.raw)).not.toThrow()
        expect(file.items.length).toBeGreaterThan(0)
      })

      it('能整体导进题库：不报错、不丢条、没有坏数据', () => {
        const r = importLibrary([], file.raw)
        expect(r.error ?? '').toBe('')
        expect(r.problems).toEqual([])
        expect(r.invalid).toBe(0)
        expect(r.added).toBe(file.items.length)
      })

      it('图片一条都没被静默丢掉（空图会被 App 默默扔掉）', () => {
        const r = importLibrary([], file.raw)
        const want = file.items.reduce((n, it) => n + imagesOf(it).length, 0)
        const got = r.items.reduce((n, it) => n + it.images.length, 0)
        expect(got).toBe(want)
      })

      it('每张图的 sceneKey 都是真实存在的插画（写错是静默失败）', () => {
        const bad: string[] = []
        for (const it of file.items) {
          for (const im of imagesOf(it)) {
            const key = sceneKeyOf(im)
            if (key && !sceneMeta(key)) {
              bad.push(`「${titleOf(it)}」的 sceneKey "${key}" 在 scenes.tsx 里不存在`)
            }
          }
        }
        expect(bad).toEqual([])
      })

      it('相对图片路径在 public/ 下真的存在，且没有 http:// 外链', () => {
        const bad: string[] = []
        for (const it of file.items) {
          for (const im of imagesOf(it)) {
            const url = imageUrlOf(im)
            if (!url) continue
            if (url.startsWith('http://')) {
              // 混合内容会被浏览器挡掉，图必然挂 —— 只能用 https 或相对路径
              bad.push(`「${titleOf(it)}」用了 http:// 地址（会被挡掉）：${url}`)
              continue
            }
            if (url.startsWith('/') && !/^https?:/i.test(url)) {
              const disk = join(PUBLIC_DIR, url.replace(/^\/+/, ''))
              if (!existsSync(disk)) bad.push(`「${titleOf(it)}」的图片不在 public/ 下：${url}`)
            }
          }
        }
        expect(bad).toEqual([])
      })

      it('category 是那 5 个之一（写错整条会被丢掉）', () => {
        const bad = file.items
          .filter((it) => !CATEGORY_OK.includes(String(it.category ?? '').trim()))
          .map((it) => `「${titleOf(it)}」的 category = ${JSON.stringify(it.category)}`)
        expect(bad).toEqual([])
      })

      it('focus 都是认得的维度（写错会被静默过滤，评分权重就变了）', () => {
        const bad: string[] = []
        for (const it of file.items) {
          if (it.focus === undefined) continue
          if (!Array.isArray(it.focus)) {
            bad.push(`「${titleOf(it)}」的 focus 不是数组：${JSON.stringify(it.focus)}`)
            continue
          }
          for (const f of it.focus) {
            if (!FOCUS_OK.includes(String(f))) {
              bad.push(`「${titleOf(it)}」的 focus 里有不认识的值：${JSON.stringify(f)}`)
            }
          }
        }
        expect(bad).toEqual([])
      })

      it('wordRange / 年级是自洽的（写错会被静默兜底成默认值）', () => {
        const bad: string[] = []
        for (const it of file.items) {
          const t = titleOf(it)

          if (it.wordRange !== undefined) {
            const wr = it.wordRange
            if (
              !Array.isArray(wr) ||
              wr.length !== 2 ||
              typeof wr[0] !== 'number' ||
              typeof wr[1] !== 'number'
            ) {
              bad.push(`「${t}」的 wordRange 应该是 [下限, 上限] 两个数字：${JSON.stringify(wr)}`)
            } else if (wr[0] <= 0 || wr[1] <= wr[0]) {
              bad.push(`「${t}」的 wordRange 不合理：${wr[0]}-${wr[1]} 字`)
            }
          }

          for (const g of ['minGrade', 'maxGrade'] as const) {
            const v = it[g]
            if (v === undefined) continue
            if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 9) {
              bad.push(`「${t}」的 ${g} 应该是 1-9 的整数：${JSON.stringify(v)}`)
            }
          }

          if (typeof it.minGrade === 'number' && typeof it.maxGrade === 'number' && it.minGrade > it.maxGrade) {
            bad.push(`「${t}」的年级区间反了：${it.minGrade}-${it.maxGrade}`)
          }
        }
        expect(bad).toEqual([])
      })

      it('没有 id 撞车（同一个文件里 id 重复会各自留一条，多半是复制粘贴没改）', () => {
        const seen = new Map<string, number>()
        for (const it of file.items) {
          const id = typeof it.id === 'string' ? it.id : ''
          if (id) seen.set(id, (seen.get(id) ?? 0) + 1)
        }
        const dup = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id)
        expect(dup).toEqual([])
      })
    })
  }
})
