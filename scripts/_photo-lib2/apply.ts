import { readFileSync, writeFileSync } from 'node:fs'
import { libraryItemShapeProblems } from '../../src/domain/libraryItemRules'

const DIR = 'scripts/_photo-lib2'

/* ---- 1. 权威名单：本次要补的 50 条（来自 buildBuiltinLibrary 的底稿，不是子代理自述） ---- */
const worklist = JSON.parse(readFileSync(`${DIR}/worklist-50.json`, 'utf8')) as {
  id: string
  title: string
  lead: string
}[]
const base = new Map(worklist.map((w) => [w.id, w]))

/* ---- 2. 搜到的图（复验通过的）+ 两条人工重做 ---- */
const { items } = JSON.parse(readFileSync(`${DIR}/sourced.json`, 'utf8')) as {
  items: { id: string; mediaUrl: string }[]
}
const media = new Map(items.map((i) => [i.id, i.mediaUrl]))

/* 人工重做：电饭煲换掉（原图主体被前景虚化的花抢走） */
media.set(
  'builtin-life-goods-27',
  'https://images.pexels.com/photos/11770362/pexels-photo-11770362.jpeg?auto=compress&cs=tinysrgb&w=640',
)
/* 人工补：越写越短的铅笔（用旧了的笔尖特写 —— 免费图库里没有"只剩一小截"的实物照） */
media.set(
  'builtin-stationery-6',
  'https://images.pexels.com/photos/6555379/pexels-photo-6555379.jpeg?auto=compress&cs=tinysrgb&w=640',
)
/* 一起值日：Pexels 免费位没有"孩子在教室里劳动"的横图（全是 iStock 赞助位）→ 故意留空 */

/* 人工补：手电筒的光 —— 暗图 JPEG 只有 9959 字节，被复验脚本的 10KB 阈值挡下，
   人眼看过（暗夜里一道蓝色光柱 + 剪影）没问题，这里补进来 */
media.set(
  'builtin-life-goods-16',
  'https://images.pexels.com/photos/5543899/pexels-photo-5543899.jpeg?auto=compress&cs=tinysrgb&w=640',
)

/* ---- 3. 合并进覆盖层（只写 imageUrls；title/lead 一个字不动） ---- */
const raw = readFileSync('src/data/library-items.json', 'utf8')
const cur = JSON.parse(raw) as Record<string, any>
const before = Object.keys(cur).length

let added = 0
for (const [id, url] of media) {
  const b = base.get(id)
  if (!b) { console.log(`!! ${id} 不在本次 50 条名单里，跳过`); continue }
  const entry = cur[id] ?? { baseTitle: b.title, baseLead: b.lead }
  entry.imageUrls = [url]
  cur[id] = entry
  added += 1
}

/* ---- 4. 用**落盘端点同一个**校验函数体检 ---- */
const problems = libraryItemShapeProblems(cur)
if (problems.length) {
  console.log('✗ 体检不通过，**没有写盘**：')
  for (const p of problems) console.log('  ', p)
  process.exit(1)
}

/* ---- 5. 跟端点同构地序列化 + 写盘 ---- */
function normalize(parsed: Record<string, any>) {
  const out: Record<string, any> = {}
  for (const id of Object.keys(parsed).sort()) {
    const v = parsed[id]
    if (v === null || typeof v !== 'object' || Array.isArray(v)) continue
    const entry: Record<string, any> = { baseTitle: v.baseTitle, baseLead: v.baseLead }
    const title = typeof v.title === 'string' ? v.title.trim() : ''
    if (title && title !== v.baseTitle) entry.title = title
    const lead = typeof v.lead === 'string' ? v.lead.trim() : ''
    if (lead && lead !== v.baseLead) entry.lead = lead
    if (Array.isArray(v.imageUrls) && v.imageUrls.length > 0) {
      entry.imageUrls = v.imageUrls.map((u: unknown) => String(u).trim())
    }
    if (entry.title === undefined && entry.lead === undefined && entry.imageUrls === undefined) continue
    out[id] = entry
  }
  return out
}

const text = `${JSON.stringify(normalize(cur), null, 2)}\n`
writeFileSync('src/data/library-items.json', text, 'utf8')

/* ---- 6. 幂等：再跑一遍必须逐字节一样 ---- */
const again = `${JSON.stringify(normalize(JSON.parse(text)), null, 2)}\n`
console.log('新增覆盖:', added, '  覆盖层:', before, '→', Object.keys(cur).length)
console.log('体检:', problems.length, '个问题')
console.log('幂等（再序列化逐字节一样）:', again === text)
console.log('留空未配:', worklist.filter((w) => !media.has(w.id)).map((w) => `${w.id} ${w.title}`).join(' / ') || '无')
