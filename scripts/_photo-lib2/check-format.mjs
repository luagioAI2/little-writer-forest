import { readFileSync } from 'node:fs'

/* 跟 vite.config.ts 的 normalizeLibraryItems + 写盘那两行**同构** */
function normalize(parsed) {
  const out = {}
  for (const id of Object.keys(parsed).sort()) {
    const v = parsed[id]
    if (v === null || typeof v !== 'object' || Array.isArray(v)) continue
    const entry = { baseTitle: v.baseTitle, baseLead: v.baseLead }
    const title = typeof v.title === 'string' ? v.title.trim() : ''
    if (title && title !== v.baseTitle) entry.title = title
    const lead = typeof v.lead === 'string' ? v.lead.trim() : ''
    if (lead && lead !== v.baseLead) entry.lead = lead
    if (Array.isArray(v.imageUrls) && v.imageUrls.length > 0) {
      entry.imageUrls = v.imageUrls.map((u) => String(u).trim())
    }
    if (entry.title === undefined && entry.lead === undefined && entry.imageUrls === undefined) continue
    out[id] = entry
  }
  return out
}

const raw = readFileSync('src/data/library-items.json', 'utf8')
const canon = `${JSON.stringify(normalize(JSON.parse(raw)), null, 2)}\n`
console.log('byte-identical:', canon === raw)
console.log('raw bytes :', Buffer.byteLength(raw), ' canon bytes:', Buffer.byteLength(canon))
console.log('keys      :', Object.keys(JSON.parse(raw)).length)
if (canon !== raw) {
  for (let i = 0; i < Math.max(canon.length, raw.length); i += 1) {
    if (canon[i] !== raw[i]) {
      console.log('first diff at char', i)
      console.log('raw  :', JSON.stringify(raw.slice(i - 60, i + 60)))
      console.log('canon:', JSON.stringify(canon.slice(i - 60, i + 60)))
      break
    }
  }
}
