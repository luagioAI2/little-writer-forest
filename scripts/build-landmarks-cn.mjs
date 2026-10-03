/* ============================================================
   全国 A 级景区 —— 从 `scripts/cn-a-level.json` 生成 App 要的库
   ============================================================

   产出：`src/data/landmarks-cn.json`（**1,357 条**，形状跟 `landmarks.json` 一样是
   `LandmarkSeed[]`，只是外面包了一层抬头）。

   ★ 口径（家长 09-24 定）：
     · 5A **全保留**（357 条）
     · 4A **≤1000、按知名度**（源站自带的 `heatScore`，取前 1000）
     ➜ 357 + 1000 = **1,357 条**

   ------------------------------------------------------------
   一、为什么要单独一个数据文件，不并进 `landmarks.json`

     `landmarks.json` 是**手工精选**（35 条，每条的名字和介绍都是人写的）。
     把 1357 条机器生成的塞进去，那个文件的性格就没了 ——
     以后想找"人写的那几条"得先筛一遍。

     ⚠️ 跟 `landmarks-gd.json` 分成两个文件**不是**因为授权
     （ODbL 只约束 OSM 那份，见 `landmarks.ts`），而是因为**生成方式不同**：
     这份是"官方名录 + 模板文案"，那份是"OSM + 标签"。混在一起就分不清了。

   ------------------------------------------------------------
   二、★ 合并去重：跟已有的 265 条（手工 35 + 广东 OSM 230）怎么并

     家长 09-24 定：「**并进去，重名以官方为准**」。

     ★★ 判据是「**同省 + 归一后同名**」（`normLandmarkName` 来自 `lib/a-level-names.mjs`）：
       · **同省**是必须的 —— 不加省份限制，手工的 `西湖` 会撞上江苏的 `瘦西湖风景区`。
       · **归一后**同名：`泰山` ↔ `泰山景区`、`白云山` ↔ `白云山景区` 是同一个地方，
         只差一个通用后缀。
       ⚠️⚠️ **不能用"包含关系"去重**（那个判据只适合给 5A 捞坐标）。
         实测它会把这些**不同的地方**并成一条：
           `张家界` ⊂ `张家界大峡谷`、`西双版纳` ⊂ `中科院西双版纳热带植物园`
         —— 两个都错，而且**看着完全合理**。
       所以这里只认**归一后完全相等**，另加省份限制。

     ⚠️ 被并掉的是**手工/GD 那条**（官方赢）。副作用：它原来的 id 消失，
        老存档里对应的小树苗会变成孤儿（界面上兜底显示「远方」，不崩）。

     ⚠️ 剩下的**近似但不等**的（`西湖` ↔ `杭州西湖风景区`、`漠河北极村` ↔ `北极村旅游景区`…）
        脚本**不猜**，只把清单打出来给人看 —— 见下面「残留近似」那段。

   ------------------------------------------------------------
   三、★ `blurb` 用模板，**不用**源站自带的 `desc`

     源站每条带一句 `desc`（`scripts/cn-a-level.json` 里 1109/1357 条有），
     看着"白捡"，但**不能用**：

     · **长度不是一回事**：界面上一句话介绍渲染在卡片里
       （`MapPage.tsx` 的 `<p className="font-prose text-sm leading-loose">`），
       现有 265 条实测 **11~34 字**；而 `desc` 中位数 **105 字**、最长 **992 字**
       —— 直接塞进去会把卡片撑爆。
     · **只取首句也不够**：首句 ≤40 字的只有 **372/1357（27%）**，
       剩下 73% 还是得套模板 ➜ 变成"一部分攻略腔、一部分童谣腔"，比统一模板更差。
       抽到的首句也参差：「"烟花三月下扬州"，春季来扬州，瘦西湖。」（截断）
       「天坛公园是北京十分重要的景点。」（等于没说）。
     · 所以统一用 `blurbForScene`（跟广东那 230 条一个路子），
       句子通用但**不会张冠李戴**（不会给一个公园编历史典故）。
     ➜ `desc` **留在 `cn-a-level.json` 里没删**，将来要做"详情页"可以用。

   ------------------------------------------------------------
   用法：node scripts/build-landmarks-cn.mjs
   ============================================================ */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { containScore, normLandmarkName, sameScenicArea } from './lib/a-level-names.mjs'
import { blurbForScene, inferSceneFromName } from './lib/landmark-text.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IN_FILE = path.join(ROOT, 'scripts', 'cn-a-level.json')
const OUT_FILE = path.join(ROOT, 'src', 'data', 'landmarks-cn.json')
const HAND_FILE = path.join(ROOT, 'src', 'data', 'landmarks.json')
const GD_FILE = path.join(ROOT, 'src', 'data', 'landmarks-gd.json')

/** `Landmark.scene` 的合法取值 —— 跟 `landmarks.ts` 的 `SCENES` 必须一致。
 *  ⚠️ 这里再列一遍是**故意的**：构建脚本是 node 跑的，引不到 `.ts` 的类型；
 *     写错一个字母的表现是 palette 取不到、插画变一片黑，而**构建不报错**。
 *     所以最后有一条自查专门盯这个。 */
const SCENES = [
  'mountain', 'water', 'city', 'desert', 'forest',
  'snow', 'temple', 'coast', 'grass', 'cave',
]

/** 一句话介绍的长度区间 —— 跟现有 265 条（11~34 字）对齐。
 *  ⚠️ 上限 40 是**硬闸门**：超了说明模板被改长了，卡片会被撑爆。 */
const BLURB_MIN = 8
const BLURB_MAX = 40

/* ---------------- 读源数据 ---------------- */

const src = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'))
const hand = JSON.parse(fs.readFileSync(HAND_FILE, 'utf8'))
const gd = JSON.parse(fs.readFileSync(GD_FILE, 'utf8')).items

/** 官方那 1357 条，统一成一种形状。
 *  ⚠️ `byProvince` 的**省名是 key**（`byProvince[省]`），
 *     而 `top4A` 的省在**行上**（`r.province`）—— 两边形状不一样，别抄错。
 *  ★ 5A 的 `heat` 只有 `site-5a` 那批有（聚合站给的）；
 *    4A 的 `heat` 是全国热度榜给的（`top4A` 每条都有）。
 *    两边写法一样（都叫 `heat`），在这里统一带过去。 */
const official = []
for (const [province, g] of Object.entries(src.byProvince)) {
  for (const r of g['5A']) {
    const row = { name: r.name, province, city: r.city, lng: r.lng, lat: r.lat, rating: '5A' }
    if (typeof r.heat === 'number') row.heat = r.heat
    official.push(row)
  }
}
for (const r of src.top4A) {
  const row = { name: r.name, province: r.province, city: r.city, lng: r.lng, lat: r.lat, rating: '4A' }
  if (typeof r.heat === 'number') row.heat = r.heat
  official.push(row)
}

/* ---------------- 去重 ----------------

   ★★ 两个判据**都用**（都来自 `lib/a-level-names.mjs`，跟单元测试那份是同一个）：
     · `sameScenicArea` —— 「核心名相同」或「短核心是长的前缀 + 多出来那截只是景区套话」。
       ⚠️ 这一条**必须**有：`丹霞山世界地质公园`（OSM）与 `丹霞山景区`（官方）
         是同一个地方，只靠"名字完全相等"认不出来。
     · `normLandmarkName` 相等 —— 剥掉通用后缀后一模一样。

   ★★ 作用域：**都有市就比市，否则退到省**。
     ⚠️ 市这一层不能省 —— 名字相同的「莲花山」在广东有好几座（番禺/东莞/惠州/江门/汕头），
        不加市限制会把它们并成一条（那正是 `landmarks.test.ts` 那条守卫要防的）。
     ⚠️ 手工那 35 条**没有 city**，只能退到省 —— 但它们的名字都是全国唯一的
        （泰山/黄山/西湖/九寨沟…），省内不会撞。 */
function sameScope(a, b) {
  if (a.province !== b.province) return false
  if (a.city && b.city) return a.city === b.city
  return true
}
const isSamePlace = (a, b) =>
  sameScope(a, b) && (sameScenicArea(a.name, b.name) || normLandmarkName(a.name) === normLandmarkName(b.name))

const warnings = []

/* ① 官方内部去重：同一个地方在 5A 和 4A 各出现一次（实测 8 组）。
      ➜ 留 **5A**（评级高的那个）。
      ⚠️ 这是官方数据自己的毛病（文旅部 5A 名录与聚合站 4A 榜各算各的），不是我们抽错了。 */
const keptOfficial = []
let officialInternalDup = 0
for (const r of official) {
  const clash = keptOfficial.find((k) => isSamePlace(k, r))
  if (!clash) {
    keptOfficial.push(r)
    continue
  }
  officialInternalDup++
  warnings.push(`官方内部重名：${r.province} ${clash.name}(${clash.rating}) 与 ${r.name}(${r.rating})`)
  // 5A 优先：先到的若是 4A、后到的才是 5A，就把先到的换成 5A
  if (r.rating === '5A' && clash.rating !== '5A') {
    keptOfficial[keptOfficial.indexOf(clash)] = r
  }
}

/* ② 与已有的 265 条（手工 35 + 广东 OSM 230）合并：**官方赢**。
      ➜ 被并掉的那些**记进 `supersedes`**，由 `landmarks.ts` 在加载时滤掉。
      ⚠️⚠️ 为什么不能在生成侧直接删：手工那份是**家长手写的**（不该被脚本改），
         广东那份是**另一个脚本生成的**（改了下次重跑又回来）。
         所以"谁被谁取代"这件事**记在数据里**，由加载器机械执行 —— 判据仍然只有一份。 */
const supersedes = []
const handMergedNames = []
for (const r of [...hand, ...gd]) {
  const clash = keptOfficial.find((k) => isSamePlace(k, r))
  if (clash) {
    supersedes.push(r.id)
    handMergedNames.push(`${r.province} ${r.name}  →  ${clash.name}`)
  }
}

/* ③ 残留近似：官方那批里**没被合并**、但名字"沾边"的既有条目 ——
      **不自动合并**，只打出来给人看。
      ★ 判据用包含关系（`containScore`）**只当"值得看一眼"的筛子**，
        不当合并依据 —— 它会把这些不同的地方也筛出来：
          `张家界` ⊂ `张家界大峡谷`、`西双版纳` ⊂ `中科院西双版纳热带植物园`
        正是**要人来看一眼**的那一类。 */
const supersededSet = new Set(supersedes)
const nearMiss = []
for (const r of [...hand, ...gd]) {
  if (supersededSet.has(r.id)) continue
  const n = normLandmarkName(r.name)
  const hits = keptOfficial.filter(
    (k) => k.province === r.province && containScore(n, normLandmarkName(k.name)) > 0,
  )
  if (hits.length) {
    nearMiss.push(`${r.province} ${r.name}  ⇔  ${hits.map((h) => h.name + '(' + h.rating + ')').join(' / ')}`)
  }
}

/* ---------------- 生成 seed ---------------- */

/** ★★ id 必须**跨重跑稳定** —— 孩子的森林是按 `landmarkId` 存档的
 *  （`sprouts[].landmarkId`），id 一变，树苗就成孤儿。
 *  ⚠️ 所以**不能用下标**（`cn-1`）—— 源站的顺序随时会动。
 *     用「省 + 名字」：只要景区不改名，id 就不变。
 *  ⚠️ 前缀 `cn-` 与手工（`xihu`）、GD（`gd-w123`）都不冲突，`checkLandmarks` 会兜底查重。 */
function toSeed(r) {
  const id = `cn-${r.province}-${r.name}`
  const scene = inferSceneFromName(r.name)
  const seed = { id, name: r.name, province: r.province }
  if (r.city) seed.city = r.city
  seed.lng = r.lng
  seed.lat = r.lat
  seed.blurb = blurbForScene(scene, id)
  seed.scene = scene
  seed.rating = r.rating
  // ★ 热度分（可选）—— 5A 只有 site-5a 那批有，4A 的 top4A 每条都有。
  //   没有就不带这个字段（`Landmark.heat` 是可选的）。
  //   ⚠️⚠️ **`0` 要当成"没有"，不能当"热度是 0"**：
  //      源站用 `heatScore: 0` 表示"没这个数据"（实测只有 1 条：
  //      四川·邓小平故里旅游区），而**有数据的最小值是 3.7** —— 中间没有 0~3.6。
  //      留着 0 的后果：那一条在"按热度排序"里永远沉底，
  //      而"没有热度"和"热度 0"在界面上是两件事（见 types.ts 的注释）。
  if (typeof r.heat === 'number' && r.heat > 0) seed.heat = r.heat
  return seed
}

/* 排序：按 `byProvince` 的省序（= 常规行政区顺序）→ 5A 在前 → 各自保持源顺序。
   ⚠️ 不按名字排序 —— 那样会把同一个省的名胜打散，而且以后源顺序一变就全乱。 */
const provOrder = new Map(Object.keys(src.byProvince).map((p, i) => [p, i]))
const rows = [...keptOfficial].sort((a, b) => {
  const pa = provOrder.get(a.province) ?? 999
  const pb = provOrder.get(b.province) ?? 999
  if (pa !== pb) return pa - pb
  if (a.rating !== b.rating) return a.rating === '5A' ? -1 : 1
  return 0
})
const items = rows.map(toSeed)

/* ---------------- 自查 ---------------- */

const problems = []
const seenIds = new Set()
items.forEach((r, i) => {
  const at = `#${i} ${r.id}`
  if (!r.id) problems.push(`${at} 缺 id`)
  else if (seenIds.has(r.id)) problems.push(`${at} id 重复`)
  else seenIds.add(r.id)
  if (!r.name) problems.push(`${at} 缺 name`)
  if (!Number.isFinite(r.lng) || r.lng < -180 || r.lng > 180) problems.push(`${at} lng 越界 ${r.lng}`)
  if (!Number.isFinite(r.lat) || r.lat < -90 || r.lat > 90) problems.push(`${at} lat 越界 ${r.lat}`)
  if (Math.abs(r.lng) < 0.5 && Math.abs(r.lat) < 0.5) problems.push(`${at} 坐标是 (0,0)`)
  if (!SCENES.includes(r.scene)) problems.push(`${at} scene 不认识 ${r.scene}`)
  if (!r.blurb) problems.push(`${at} 缺 blurb`)
  else if (r.blurb.length < BLURB_MIN || r.blurb.length > BLURB_MAX) {
    problems.push(`${at} blurb 长度 ${r.blurb.length} 超出 ${BLURB_MIN}~${BLURB_MAX}`)
  }
})

/* ---------------- 写文件 ---------------- */

const out = {
  source:
    '国家 A 级旅游景区名录：5A = 文化和旅游部（官方名录，坐标见 note）；' +
    '4A = cnlifes.com 聚合页按「平台综合热度」取前 1000',
  asOf: src.asOf,
  count: items.length,
  whyThisFileExists:
    '这是"全国景点库"那一层：5A 全保留 + 4A 按知名度取前 1000。' +
    '跟 landmarks.json（手工精选 35）和 landmarks-gd.json（OSM 广东 230）分开存，' +
    '因为生成方式不同 —— 混在一起就分不清哪条是"人写的"、哪条是"机器生成的"。',
  note:
    '★ 由 scripts/build-landmarks-cn.mjs 生成，**不要手改**（改了会被下次生成覆盖）。\n' +
    '  · 上游数据：scripts/cn-a-level.json（抓取脚本 scripts/fetch-a-level-cn.mjs）。\n' +
    '  · 5A 的坐标是**后补的**，分四档可信度（`coordSource`，在 cn-a-level.json 里看）。\n' +
    '    实测真坐标 336/357；21 条是"市中心/省中心点"凑的，误差可达几十公里。\n' +
    '  · `blurb` 是**按 scene 套模板**生成的，不是逐条写的 —— 通用但不会张冠李戴。\n' +
    '    源站自带的 `desc`（攻略段落，中位数 105 字）**没用**，原因见脚本头部第三节。\n' +
    '  · 合并去重：与手工/GD 那 265 条按「同市（没市则同省）+ 同一个景区」合并，**官方赢**。\n' +
    '    被取代的条目 id 记在 `supersedes` 里，由 `src/data/landmarks.ts` 在加载时滤掉。\n' +
    '    ⚠️ 之所以"记下来让加载器滤"而不是"从原文件删"：手工那份是家长手写的（脚本不该改），\n' +
    '       广东那份是另一个脚本生成的（删了下次重跑又回来）。',
  supersedes,
  /* ★ 残留近似：跟已有条目名字沾边、但**没被自动合并**的（判据不放心，留给人看）。
     ⚠️ 记进数据里是**故意的** —— 预览页要显示它，而预览页**不许**自己再写一遍
        "像不像同一个地方"的判据（那会跟这里漂移，MEMORY §四）。
        记下来 = 判据只有一份，页面只是把它念出来。 */
  nearMiss,
  items,
}

fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n')

/* ---------------- 报告 ---------------- */

const byRating = { '5A': 0, '4A': 0 }
for (const r of items) byRating[r.rating]++
const byScene = {}
for (const r of items) byScene[r.scene] = (byScene[r.scene] || 0) + 1

console.log('\n=== 全国库 ===')
console.log(`共 ${items.length} 条（5A ${byRating['5A']} + 4A ${byRating['4A']}）`)
console.log('省 / 自治区 / 直辖市：' + new Set(items.map((r) => r.province)).size + ' 个')
console.log('带市名：' + items.filter((r) => r.city).length + ' 条')
console.log('scene 分布：' + Object.entries(byScene).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('  '))

console.log('\n=== 合并去重（跟已有的 265 条）===')
console.log(`官方内部重名并掉 ${officialInternalDup} 条（同一条 5A/4A 各出现一次）`)
console.log(`手工/GD 被官方取代 ${supersedes.length} 条（已记进 supersedes，由加载器滤掉）：`)
for (const x of handMergedNames) console.log('   ' + x)

if (nearMiss.length) {
  console.log(
    `\n⚠️ 残留近似 ${nearMiss.length} 条 —— **没有自动合并**，需要人看一眼：\n` +
      '   （判据只用了"包含关系"当筛子，它分不清"同一处"和"名字里带同一个词"，\n' +
      '     例如 张家界 ⊂ 张家界大峡谷、西双版纳 ⊂ 中科院西双版纳热带植物园 都是**不同**的地方。）',
  )
  for (const x of nearMiss) console.log('   ' + x)
}

if (warnings.length) {
  console.log('\n（官方内部重名明细）')
  for (const w of warnings) console.log('   ' + w)
}

if (problems.length) {
  console.log(`\n⚠️⚠️ ${problems.length} 条有问题：`)
  for (const p of problems.slice(0, 20)) console.log('   ' + p)
  if (problems.length > 20) console.log(`   …还有 ${problems.length - 20} 条`)
  process.exitCode = 1
} else {
  console.log('\n✓ 自查通过（id 唯一 / 坐标在范围内 / scene 合法 / blurb 长度合规）')
}
console.log('\n→', path.relative(ROOT, OUT_FILE))
