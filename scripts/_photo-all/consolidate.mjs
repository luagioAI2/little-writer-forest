/* ============================================================
   合并 28 个批次的产出 → `scripts/photo-sourced.json`
   ============================================================
   ⚠️ 脚手架，不是产物。

   跑法：node scripts/_photo-all/consolidate.mjs

   口径（家长 2026-09-25 定）：**只收 `place`**。
   `scene` 的（"搜不到本体、拿同类风景顶上"）**一律丢掉** ——
   对一个教孩子认地理的 App，"一张不是那个地方的照片"比"程序化插画"更糟：
   插画一眼看就是画的，真照片会被当成纪实。

   ★ 所以这个脚本会**故意**把 `scene` 当"正常丢弃"来数，
     而不是当错误。判据是"丢了多少、为什么丢"，不是"丢没丢"。
   ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'))

/** 拼法与生成侧一致 —— 只认这一种形状，别的都当可疑。
 *  ⚠️ 扩展名**不全是 jpeg**：Pexels 上原始资源是 PNG 的那几张，
 *     地址就是 `.png`，把同一个编号换成 `.jpeg` 会 **404**（实测过）。
 *     所以这里两种都收，但**仍然要求 mediaUrl 与 credit.link 的编号对得上**。 */
const CDN_RE =
  /^https:\/\/images\.pexels\.com\/photos\/(\d+)\/pexels-photo-\1\.(?:jpeg|png)\?auto=compress&cs=tinysrgb&w=640$/

const want = new Set(read('scripts/_photo-list.json').map((x) => x.id))
const existing = read('scripts/photo-sourced.json')

const kept = []
const droppedScene = []
const problems = []
const seen = new Set()

for (const item of existing.items) {
  kept.push(item)
  seen.add(item.landmarkId)
}

for (let i = 1; i <= 28; i++) {
  const tag = String(i).padStart(2, '0')
  const out = read(`scripts/_photo-all/out-${tag}.json`)

  for (const it of out.items) {
    if (it.match === 'scene') {
      droppedScene.push(`${tag} ${it.landmarkId}`)
      continue
    }
    if (it.match !== 'place') {
      problems.push(`${tag} ${it.landmarkId}: match=${JSON.stringify(it.match)}`)
      continue
    }
    if (!want.has(it.landmarkId)) {
      problems.push(`${tag} ${it.landmarkId}: 不在那 558 条名单里`)
      continue
    }
    if (seen.has(it.landmarkId)) {
      problems.push(`${tag} ${it.landmarkId}: 重复（会被先来的盖掉）`)
      continue
    }
    const m = (it.mediaUrl ?? '').match(CDN_RE)
    if (!m) {
      problems.push(`${tag} ${it.landmarkId}: mediaUrl 不符合约定 ${it.mediaUrl}`)
      continue
    }
    if (!(it.credit?.link ?? '').includes(m[1])) {
      problems.push(`${tag} ${it.landmarkId}: credit.link 里没有编号 ${m[1]}`)
      continue
    }
    if (it.credit?.source !== 'Pexels') {
      problems.push(`${tag} ${it.landmarkId}: credit.source=${JSON.stringify(it.credit?.source)}`)
      continue
    }
    if (!it.title) {
      problems.push(`${tag} ${it.landmarkId}: 缺 title`)
      continue
    }
    /* ★ 字节数只是"当时下到了东西"的记录，不是硬门槛 ——
       但它 < 10000 时几乎一定是拿到了图床的空壳，值得停下来看一眼 */
    if (typeof it.verified?.bytes === 'number' && it.verified.bytes < 10000) {
      problems.push(`${tag} ${it.landmarkId}: 当时只下到 ${it.verified.bytes} 字节（疑似空壳）`)
      continue
    }

    seen.add(it.landmarkId)
    kept.push({
      landmarkId: it.landmarkId,
      match: 'place',
      mediaUrl: it.mediaUrl,
      title: it.title,
      credit: it.credit,
      ...(it.note ? { note: it.note } : {}),
    })
  }
}

console.log(`收下 ${kept.length} 条（其中原有 ${existing.items.length} 条）`)
console.log(`丢掉 scene ${droppedScene.length} 条`)
console.log(`问题 ${problems.length} 条`)
for (const p of problems.slice(0, 20)) console.log('   ' + p)

if (problems.length) {
  console.error('\n✗ 有硬问题，不写文件。先修来源。')
  process.exit(1)
}

const out = {
  whyThisFileExists: existing.whyThisFileExists,
  howItWasMade: existing.howItWasMade,
  cdnPattern: existing.cdnPattern,
  cdnNote: existing.cdnNote,
  scopeNote:
    '分两轮攒的：第一轮是「世界知名」85 条（试水，人逐张复核过）；' +
    '第二轮把库里剩下的 558 条也过了一遍（28 批并行搜）。\n' +
    '★★ 第二轮**只收 `place`** —— 搜不到本体的那些**没有**拿同类风景顶替，' +
    '直接不收（`scene` 全丢了）。理由：真照片会被当成纪实，' +
    '一张"不是那个地方"的照片比程序化插画更容易骗到孩子。\n' +
    '⚠️ 例外：第一轮那 85 条里有 2 条是 `scene` —— 它们属于「世界知名」名单，' +
    '覆盖率守卫要求这一档**每条都得有图**，所以保留原样（已单独复核过）。',
  asOf: '2026-09-26',
  count: kept.length,
  /* ★ 全库规模：第一轮的 85 条 + 第二轮的 558 条 = 643。
     写进来源清单，生成侧就不用再猜（也不必去依赖临时文件）。 */
  libraryTotal: existing.items.length + want.size,
  items: kept,
}

writeFileSync(resolve(ROOT, 'scripts/photo-sourced.json'), JSON.stringify(out, null, 2) + '\n')
console.log(`\n→ scripts/photo-sourced.json（${kept.length} 条）`)
