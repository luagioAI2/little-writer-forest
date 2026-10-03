/* ============================================================
   世界景点 —— 生成 App 用的数据文件
   ============================================================
   输入：`scripts/world-landmarks.json`（DBpedia 补过坐标/图片的）
   输出：`src/data/landmarks-world.json`（**只有 LandmarkSeed 的字段**）

   ★ 为什么要把「溯源字段」剥掉：
     `_wiki` / `_wikiZh` / `_photo` 是给我复核用的，不是 App 要的。
     留着会让人以为 App 会用到 —— 而且 `LandmarkSeed` 里没这些字段，
     写进去过不了 `assertLandmarks` 那道类型关（TS 会报多余属性）。

   ★ 图片不在这里进 App 数据：
     `Landmark` 类型里**没有图片字段** —— 图片属于「内容包」
     （`TravelStory` / 将来的多图结构）。这里只把 `_photo` 留在
     `scripts/world-landmarks.json` 里，等做图片工具时直接用。
   ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'world-landmarks.json')
const OUT = join(HERE, '..', 'src', 'data', 'landmarks-world.json')

const raw = JSON.parse(readFileSync(SRC, 'utf8'))

const items = raw.items.map((x) => ({
  id: x.id,
  name: x.name,
  province: x.province,
  country: x.country,
  lng: x.lng,
  lat: x.lat,
  blurb: x.blurb,
  scene: x.scene,
  /* ⚠️ **不写 `tier`** —— 它是旧玩法的稀有度、`LandmarkSeed` 里可省略，
     `landmarks.ts` 读到缺省会自己填 1（`seed.tier ?? 1`）。
     世界这批没有稀有度之分，写 231 个一模一样的 `tier: 1` 只会让人
     以为这个字段是有意义的。 */
}))

/* 自查：id 不能重复（跟国内那三份共用一套 id 空间，撞了会被 checkLandmarks 挡下） */
const seen = new Set()
const dup = []
for (const it of items) {
  if (seen.has(it.id)) dup.push(it.id)
  seen.add(it.id)
}
if (dup.length) {
  console.error('✖ id 重复：', dup.join(', '))
  process.exit(1)
}

/* 自查：坐标必须是真实数字，且不在 (0,0) */
const bad = items.filter(
  (x) => !Number.isFinite(x.lng) || !Number.isFinite(x.lat) || (x.lng === 0 && x.lat === 0),
)
if (bad.length) {
  console.error('✖ 坐标可疑：', bad.map((x) => x.name).join(', '))
  process.exit(1)
}

writeFileSync(OUT, JSON.stringify({
  source: raw.source,
  license: raw.license,
  attribution: raw.attribution,
  whyThisFileExists: raw.whyThisFileExists,
  fetchedAt: raw.fetchedAt,
  count: items.length,
  items,
}, null, 1))

const byCountry = {}
for (const it of items) byCountry[it.country] = (byCountry[it.country] || 0) + 1
const countries = Object.keys(byCountry).length
const withBlurb = items.filter((x) => x.blurb).length

console.log('')
console.log('写出      :', OUT)
console.log('条数      :', items.length)
console.log('国家/地区 :', countries)
console.log('带简介    :', withBlurb)
console.log('id 重复   : 0')
console.log('坐标可疑  : 0')
console.log('')
console.log('条数最多的国家：')
Object.entries(byCountry)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .forEach(([c, n]) => console.log('   ', c.padEnd(10), n))
