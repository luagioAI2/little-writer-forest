/* 一次性脚本：合并 + 校验 7 个批次的产出。
   ⚠️ 脚手架，不是产物。
   跑法：node scripts/_photo-pilot/consolidate.mjs */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const DIR = 'scripts/_photo-pilot'
const pilot = JSON.parse(readFileSync('scripts/_pilot-list.json', 'utf8'))
const byId = new Map(pilot.map((p) => [p.id, p]))

const URL_RE = /^https:\/\/images\.pexels\.com\/photos\/(\d+)\/pexels-photo-\1\.jpeg\?auto=compress&cs=tinysrgb&w=640$/

let all = []
for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
  const f = `${DIR}/out-${n}.json`
  if (!existsSync(f)) {
    console.log(`MISSING ${f}`)
    continue
  }
  const o = JSON.parse(readFileSync(f, 'utf8'))
  console.log(`${n}: batch=${o.batch} items=${o.items.length}`)
  all = all.concat(o.items.map((it) => ({ ...it, batch: n })))
}

console.log(`\n--- 合计 ${all.length} / 应为 ${pilot.length}`)

const got = new Set(all.map((x) => x.landmarkId))
const missing = pilot.filter((p) => !got.has(p.id))
console.log('缺的 id：', missing.map((m) => m.id).join(', ') || '(无)')

const unknown = all.filter((x) => !byId.has(x.landmarkId))
console.log('多出来的 id：', unknown.map((m) => m.landmarkId).join(', ') || '(无)')

const dup = all.map((x) => x.landmarkId).filter((v, i, a) => a.indexOf(v) !== i)
console.log('重复 id：', dup.join(', ') || '(无)')

const badUrl = all.filter((x) => !URL_RE.test(x.mediaUrl || ''))
console.log(`URL 不符合约定的：${badUrl.length}`)
for (const x of badUrl) console.log('   ', x.landmarkId, x.mediaUrl)

const cnt = (k) => all.reduce((a, x) => ((a[x[k]] = (a[x[k]] || 0) + 1), a), {})
console.log('match：', JSON.stringify(cnt('match')))
console.log('verdict：', JSON.stringify(cnt('verdict')))

const mismatched = all.filter((x) => {
  const m = (x.mediaUrl || '').match(/photos\/(\d+)\//)
  return m && x.credit?.link && !x.credit.link.includes(m[1])
})
console.log(`credit.link 与 mediaUrl 编号对不上的：${mismatched.length}`)
for (const x of mismatched) console.log('   ', x.landmarkId, '|', x.credit.link)

const noCredit = all.filter((x) => !x.credit?.link || !x.credit?.source)
console.log(`缺 credit 的：${noCredit.length}`)

writeFileSync(`${DIR}/all.json`, JSON.stringify(all, null, 2) + '\n')
console.log(`\n→ ${DIR}/all.json`)
