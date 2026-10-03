/* 一次性脚本：列出「还没配默认图」的地标，附能拿到的英文检索词。
   ⚠️ 脚手架，不是产物。
   跑法：npx vite-node scripts/_photo-list.ts --write */
import { writeFileSync } from 'node:fs'
import { LANDMARK_SEEDS } from '../src/data/landmarks'
import { defaultPhotoFor } from '../src/data/landmarkPhotos'
import worldRaw from './world-landmarks.json'

const worldItems = (worldRaw as { items: Record<string, unknown>[] }).items
const enById = new Map<string, string>()
for (const it of worldItems) {
  const id = it.id as string
  const en = (it._wikiEn ?? it._wiki) as string | undefined
  if (en) enById.set(id, String(en).replace(/_/g, ' '))
}

const missing = LANDMARK_SEEDS.filter((s) => !defaultPhotoFor(s.id))

const out = missing.map((s) => ({
  id: s.id,
  name: s.name,
  province: s.province,
  country: s.country ?? '中国',
  city: s.city,
  rating: s.rating,
  scene: s.scene,
  /** 有就给（世界那批有维基英文名）；没有的话子代理自己组英文检索词 */
  en: enById.get(s.id) ?? '',
}))

const withEn = out.filter((o) => o.en).length
console.log(`还没配图的地标：${out.length} 条`)
console.log(`  已带英文检索词（世界那批）：${withEn}`)
console.log(`  需要自己组英文词的：${out.length - withEn}`)
const byKind: Record<string, number> = {}
for (const o of out) {
  const k = o.id.startsWith('world-') ? 'world' : o.rating === '5A' ? '5A' : o.rating === '4A' ? '4A' : '无评级'
  byKind[k] = (byKind[k] ?? 0) + 1
}
console.log('  构成：', JSON.stringify(byKind))

if (process.argv.includes('--write')) {
  writeFileSync('scripts/_photo-list.json', JSON.stringify(out, null, 2) + '\n')
  console.log('\n→ scripts/_photo-list.json')
}
