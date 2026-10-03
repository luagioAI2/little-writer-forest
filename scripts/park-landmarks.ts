/* ============================================================
   把「不在口径内」的地标从主库里**移出去**，单独存一份
   ============================================================
   ★ 家长 2026-09-25 定的口径：
       「帮我把 4A 的先单独出来。然后只保留 5A、知名点、世界知名的。」

   ➜ 保留 = `fameOf(seed) !== '地方知名'`
        （三档是 世界知名 / 全国知名 / 地方知名，见 `landmarkFame.ts`）
        ⚠️ 不用另外写 `|| rating === '5A'` —— `fameOf()` 里
           `rating === '5A'` 已经必然返回「全国知名」，写了是**第二份判据**。
        ⚠️ 「世界知名」那 85 条和「世界景点」231 条都 ≥ 全国知名，天然全留。

   ➜ 移出 = 其余全部。实测 1165 条，两类：
        · `4A-地方知名` 1006 条 —— 评上了 4A，但只在本地方有名
        · `无评级`      159 条 —— 广东 OSM 那批没评级的（不是 4A）

   ------------------------------------------------------------
   ★★ 为什么是「移出」而不是「删掉」

     跟 `supersedes` 同一个道理（见 `src/data/landmarks.ts`）：
     那四个数据文件是**来源给的**，这个脚本不该改它们。
     被移出的条目完整存进 `landmarks-4a.json`，加载器按 id 滤掉。
     ⚠️ 想反悔：删掉 `landmarks-4a.json` 就回到 1808 条 —— 不用重跑抓取。

   ------------------------------------------------------------
   ⚠️ 跑法（必须用 vite-node：要 import `fameOf`，它是 TS）

       npx vite-node scripts/park-landmarks.ts

     ⚠️ 别把 `fameOf` 在脚本里再抄一份 —— 那样「哪条算知名」就有了两个答案，
        改一处必分叉（MEMORY §四）。
   ============================================================ */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { fameOf } from '../src/data/landmarkFame'
import type { LandmarkSeed } from '../src/data/landmarks'
import rawHand from '../src/data/landmarks.json'
import rawGd from '../src/data/landmarks-gd.json'
import rawCn from '../src/data/landmarks-cn.json'
import rawWorld from '../src/data/landmarks-world.json'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'src', 'data', 'landmarks-4a.json')

type Seed = LandmarkSeed & { country?: string }
type Hdr<T> = { items: T[]; supersedes?: string[] }

const hand = rawHand as unknown as Seed[]
const gd = rawGd as unknown as Hdr<Seed>
const cn = rawCn as unknown as Hdr<Seed>
const world = rawWorld as unknown as Hdr<Seed>

/*
 * ★ 先按 `supersedes` 滤一遍 —— 跟加载器**同一套**顺序。
 *   不滤的话，那 36 条「已被官方名录取代」的会出现在移出名单里，
 *   但它们其实早就不在库中了（列进去 = 名单和库对不上）。
 */
const superseded = new Set(cn.supersedes ?? [])
const universe: Seed[] = [
  ...hand.filter((s) => !superseded.has(s.id)),
  ...gd.items.filter((s) => !superseded.has(s.id)),
  ...cn.items,
  ...world.items,
]

const whyOf = (s: Seed): string => (s.rating === '4A' ? '4A-地方知名' : '无评级')

const kept = universe.filter((s) => fameOf(s) !== '地方知名')
const parked = universe.filter((s) => fameOf(s) === '地方知名')

const items = parked.map((s) => ({ ...s, parkedWhy: whyOf(s) }))
const composition = items.reduce<Record<string, number>>((m, s) => {
  m[s.parkedWhy] = (m[s.parkedWhy] ?? 0) + 1
  return m
}, {})

const out = {
  whyThisFileExists:
    '主库收窄到「5A / 全国知名 / 世界知名」之后，被移出来的地标（家长 2026-09-25 定）。' +
    '它们不参与运行时（地图、选点、距离分档都读不到），但**完整留着** —— 想反悔就把这个文件删掉。' +
    '⚠️ 文件名沿用了家长的说法「4A 的」，但里面**不全是 4A**：159 条是广东 OSM 那批没评级的，看 `parkedWhy`。',
  rule: "fameOf(seed) === '地方知名'",
  ruleNote:
    '判定在 `src/data/landmarkFame.ts` 的 `fameOf()`（**唯一一份**）。' +
    '「5A」不用另外写 —— fameOf 里 5A 必然返回「全国知名」，写了就是第二份判据。',
  asOf: '2026-09-25',
  count: items.length,
  composition,
  sourceNote:
    '条目是从四个来源文件里挑出来的，字段与来源一致（没加 fame / 没改 rating）。' +
    '`parkedWhy` 是本脚本加的，只为让人一眼看出"为什么这条在外面"。',
  generatedBy: 'scripts/park-landmarks.ts（npx vite-node scripts/park-landmarks.ts）',
  items,
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8')

const bySrc = (arr: Seed[]) =>
  arr.reduce<Record<string, number>>((m, s) => {
    const k = s.id.startsWith('cn-')
      ? '全国名录'
      : s.id.startsWith('gd-')
        ? '广东OSM'
        : s.id.startsWith('world-')
          ? '世界'
          : '手工'
    m[k] = (m[k] ?? 0) + 1
    return m
  }, {})

console.log('全库      ', universe.length)
console.log('★ 保留    ', kept.length, bySrc(kept))
console.log('★ 移出    ', items.length, bySrc(parked), composition)
console.log('→ 写入     src/data/landmarks-4a.json')
