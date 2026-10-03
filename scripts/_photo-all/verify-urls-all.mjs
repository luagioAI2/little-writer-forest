/* ============================================================
   把 src/data/landmark-photos.json 里**每一条** mediaUrl 真下载一遍
   ============================================================
   为什么要有这个：搜索当时的"验过"是子代理自己报的，
   隔一轮再看，唯一能信的是**现在重新拉一遍**。

   判据（跟 README 一致）：HTTP 200 + 字节数 > 10000。
   ⚠️ 不许用 `curl -o /dev/null -w '%{size_download}'` 量大小 ——
      这台机器上它恒报 ~161 字节，会把全部成功误判成失败。
   ⚠️ 这里用 fetch 而不是 curl，是为了能控并发 + 重试；
      图床对密集请求会 502/522，所以并发压到 3、每条之间歇一下、失败退避重试。

   产物：
     scripts/_photo-all/verify/<序号>.jpg   —— 落盘的图（给联系表用）
     scripts/_photo-all/verify-report.json  —— 序号 → landmarkId 的对应 + 失败清单
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = process.cwd()
const photos = JSON.parse(readFileSync(resolve(root, 'src/data/landmark-photos.json'), 'utf8'))
const OUT = resolve(root, 'scripts/_photo-all/verify')
mkdirSync(OUT, { recursive: true })

const CONC = 3
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const items = photos.items
const results = new Array(items.length)
let cursor = 0
let done = 0

async function fetchOne(it, i) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(it.mediaUrl, { redirect: 'follow' })
      if (res.status !== 200) {
        if (attempt < 3) { await sleep(2000 * attempt); continue }
        return { i, landmarkId: it.landmarkId, match: it.match, http: res.status, bytes: 0, ok: false }
      }
      const buf = Buffer.from(await res.arrayBuffer())
      const type = res.headers.get('content-type') ?? ''
      const file = join(OUT, String(i).padStart(3, '0') + '.jpg')
      writeFileSync(file, buf)
      return {
        i, landmarkId: it.landmarkId, match: it.match, file: 'verify/' + String(i).padStart(3, '0') + '.jpg',
        http: 200, type, bytes: buf.length, ok: buf.length > 10000,
      }
    } catch (e) {
      if (attempt < 3) { await sleep(2000 * attempt); continue }
      return { i, landmarkId: it.landmarkId, match: it.match, http: null, bytes: 0, ok: false, err: String(e).slice(0, 120) }
    }
  }
}

async function worker() {
  while (cursor < items.length) {
    const i = cursor++
    results[i] = await fetchOne(items[i], i)
    done += 1
    if (done % 30 === 0) console.log(`  … ${done}/${items.length}`)
    await sleep(120)
  }
}

console.log(`开始重新拉取 ${items.length} 条 mediaUrl（并发 ${CONC}）…`)
await Promise.all(Array.from({ length: CONC }, worker))

const bad = results.filter((r) => !r.ok)
const types = {}
for (const r of results) types[r.type ?? '(none)'] = (types[r.type ?? '(none)'] ?? 0) + 1

writeFileSync(
  resolve(root, 'scripts/_photo-all/verify-report.json'),
  JSON.stringify({ total: results.length, ok: results.length - bad.length, badCount: bad.length, types, bad, all: results }, null, 2) + '\n',
)

console.log(`\n✓ 成功 ${results.length - bad.length} / ${results.length}   失败 ${bad.length}`)
console.log('  content-type 分布：', JSON.stringify(types))
for (const b of bad) console.log('  ✗', b.landmarkId, b.http ?? b.err, b.bytes)
