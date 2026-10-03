/* 一次性脚本：列出「世界知名」那 85 条，附英文检索词。
   ⚠️ 这是探针/脚手架，不是产物 —— 用完可删（前缀 `_` 跟其它探针一致）。
   跑法：npx vite-node scripts/_pilot-list.ts            （打屏）
         npx vite-node scripts/_pilot-list.ts --write    （写 scripts/_pilot-list.json） */
import { writeFileSync } from 'node:fs'
import { LANDMARK_SEEDS } from '../src/data/landmarks'
import { fameOf } from '../src/data/landmarkFame'
import worldRaw from './world-landmarks.json'

const worldItems = (worldRaw as { items: Record<string, unknown>[] }).items
const enById = new Map<string, string>()
for (const it of worldItems) {
  const id = it.id as string
  const en = (it._wikiEn ?? it._wiki) as string | undefined
  if (en) enById.set(id, String(en).replace(/_/g, ' '))
}

/* 手工精选 / 全国名录那 13 条没有 `_wikiEn`，手工给英文检索词。
   ⚠️ 给的是**通用英文名**（Pexels 是英文站，中文名搜不到东西）。 */
const MANUAL_EN: Record<string, string> = {
  badaling: 'Great Wall of China Badaling',
  tiananmen: 'Tiananmen Square',
  bingmayong: 'Terracotta Army Xian',
  mogao: 'Mogao Caves Dunhuang',
  zhangjiajie: 'Zhangjiajie China mountains',
  xihu: 'West Lake Hangzhou',
  guilin: 'Guilin Li River karst',
  weiduoliya: 'Victoria Harbour Hong Kong skyline',
  'cn-北京-故宫博物院': 'Forbidden City Beijing',
  'cn-安徽-黄山风景区': 'Huangshan Yellow Mountain China',
  'cn-山东-泰山景区': 'Mount Tai Shandong',
  'cn-四川-九寨沟景区': 'Jiuzhaigou valley China',
  'cn-西藏-布达拉宫景区': 'Potala Palace Lhasa',
}

const famous = LANDMARK_SEEDS.filter((s) => fameOf(s) === '世界知名')

const missing = famous.filter((s) => !enById.has(s.id) && !MANUAL_EN[s.id])
if (missing.length) {
  console.error('⚠️ 这些世界知名条目没有英文检索词：', missing.map((s) => s.id).join(', '))
  process.exit(1)
}

const out = famous.map((s) => ({
  id: s.id,
  name: s.name,
  province: s.province,
  country: s.country ?? '中国',
  scene: s.scene,
  en: MANUAL_EN[s.id] ?? enById.get(s.id)!,
  hasEnFromWiki: !MANUAL_EN[s.id],
}))

console.log(`世界知名：${out.length} 条`)
console.log(`  来自 world-*（有英文维基名）：${out.filter((o) => o.hasEnFromWiki).length}`)
console.log(`  手工给英文检索词：${out.filter((o) => !o.hasEnFromWiki).length}`)
for (const o of out) console.log(`  ${o.id}\t${o.en}`)

if (process.argv.includes('--write')) {
  writeFileSync('scripts/_pilot-list.json', JSON.stringify(out, null, 2) + '\n')
  console.log('\n→ scripts/_pilot-list.json')
}
