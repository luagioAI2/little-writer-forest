// 校验 out-<NN>.json 是不是"完整、对得上、字段合法"。
// 用法：node scripts/_photo-all/verify-out.mjs
//
// 为什么要有这个文件：28 个批次的产物是并行子代理写出来的，
// 「看起来都在」和「真的都对得上」是两件事 —— 这个脚本只回答后者。
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (p) => JSON.parse(readFileSync(resolve(HERE, p), 'utf8'))

const index = read('index.json')
const problems = []
const rows = []
let total = 0
let place = 0
let scene = 0

for (const { tag } of index) {
  const outPath = `out-${tag}.json`
  if (!existsSync(resolve(HERE, outPath))) {
    problems.push(`${outPath} 不存在`)
    continue
  }
  const out = read(outPath)
  const batch = read(`batch-${tag}.json`)

  const want = new Set(batch.map((x) => x.id))
  const got = new Set(out.items.map((x) => x.landmarkId))

  const missing = [...want].filter((id) => !got.has(id))
  const extra = [...got].filter((id) => !want.has(id))
  const dupes = out.items.length - got.size

  const byMatch = {}
  for (const it of out.items) byMatch[it.match] = (byMatch[it.match] ?? 0) + 1

  total += out.items.length
  place += byMatch.place ?? 0
  scene += byMatch.scene ?? 0
  rows.push({ tag, n: out.items.length, place: byMatch.place ?? 0, scene: byMatch.scene ?? 0 })

  if (out.items.length !== batch.length) {
    problems.push(`out-${tag}: 条数 ${out.items.length} ≠ 批次 ${batch.length}`)
  }
  if (missing.length) problems.push(`out-${tag}: 少了 ${missing.length} 条 → ${missing.slice(0, 3).join(' | ')}`)
  if (extra.length) problems.push(`out-${tag}: 多了 ${extra.length} 条 → ${extra.slice(0, 3).join(' | ')}`)
  if (dupes) problems.push(`out-${tag}: landmarkId 重复 ${dupes} 次`)

  for (const it of out.items) {
    if (it.match !== 'place' && it.match !== 'scene') {
      problems.push(`out-${tag}: ${it.landmarkId} 的 match 是 ${JSON.stringify(it.match)}`)
      continue
    }
    if (it.match !== 'place') continue

    const id = (it.mediaUrl ?? '').match(/photos\/(\d+)\//)?.[1]
    if (!/^https:\/\//.test(it.mediaUrl ?? '')) {
      problems.push(`out-${tag}: ${it.landmarkId} 的 mediaUrl 不是 https`)
    } else if (!id) {
      problems.push(`out-${tag}: ${it.landmarkId} 的 mediaUrl 抠不出编号`)
    } else if (!(it.credit?.link ?? '').includes(id)) {
      problems.push(`out-${tag}: ${it.landmarkId} 的 credit.link 里没有编号 ${id}`)
    }
    if (it.verdict !== 'ok' && it.verdict !== 'poor') {
      problems.push(`out-${tag}: ${it.landmarkId} 的 verdict 是 ${JSON.stringify(it.verdict)}`)
    }
  }
}

console.log(`总条目 ${total} · place ${place} · scene ${scene} → place 率 ${((place / total) * 100).toFixed(1)}%`)
console.log('每批 place/scene：')
console.log('  ' + rows.map((r) => `${r.tag}:${r.place}/${r.scene}`).join('  '))

if (problems.length) {
  console.log(`\n✗ 发现 ${problems.length} 个问题：`)
  for (const p of problems) console.log('  ' + p)
  process.exitCode = 1
} else {
  console.log('\n✓ 结构全部通过')
}
