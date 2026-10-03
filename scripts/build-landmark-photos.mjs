/* ============================================================
   生成 `src/data/landmark-photos.json` —— 「默认图片」
   ============================================================
   输入：`scripts/photo-sourced.json`（一条条搜出来、验过、看过的）
   产物：`src/data/landmark-photos.json`（带抬头，给 App 读）

   ⚠️⚠️ **别手改产物**。抬头（授权 / 署名 / 口径）是这里写的，
      手改一次、下次重跑就没了 —— 跟 `landmarks-cn.json` 同一个道理。

   跑法：node scripts/build-landmark-photos.mjs
   ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = resolve(process.cwd(), 'scripts/photo-sourced.json')
const OUT = resolve(process.cwd(), 'src/data/landmark-photos.json')

/** ★ CDN 直链的拼法 —— 只在这里写一份，产物里也留一份给复核的人看 */
const cdnUrl = (id) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=640`

const raw = JSON.parse(readFileSync(SRC, 'utf8'))
const items = raw.items ?? raw

const norm = items.map((it) => ({
  landmarkId: it.landmarkId,
  match: it.match,
  mediaUrl: it.mediaUrl,
  title: it.title,
  credit: it.credit,
  ...(it.note ? { note: it.note } : {}),
}))

/* ------------------------------------------------------------
   生成侧校验 —— 挡的是"不报错但会静默出错"的那几类
   ------------------------------------------------------------ */
const issues = []
const seen = new Set()
norm.forEach((it, i) => {
  const push = (why) => issues.push(`#${i} ${it.landmarkId ?? '(无 id)'}：${why}`)
  if (!it.landmarkId) push('缺 landmarkId')
  else if (seen.has(it.landmarkId)) push('landmarkId 重复（后者会被前者盖掉）')
  else seen.add(it.landmarkId)

  if (it.match !== 'place' && it.match !== 'scene') {
    push(`match 不认识：${JSON.stringify(it.match)}（只认 place / scene）`)
  }
  if (!/^https:\/\//.test(it.mediaUrl ?? '')) push(`mediaUrl 不是 https：${it.mediaUrl}`)
  /* ★★ 说"这真是那个地方"就必须给得出出处 —— 没有 credit.link 的 place 是空口无凭 */
  if (it.match === 'place' && !it.credit?.link) {
    push('match=place 但没有 credit.link —— 说「这是真地方」必须给得出详情页')
  }
  if (!it.credit?.source) push('缺 credit.source（署名必须有图库名）')
  if (!it.title) push('缺 title')

  /* ★ 图库里图片编号必须能从 mediaUrl 与 credit.link 两处对上 ——
     对不上说明这两条是从不同照片上抄来的（张冠李戴，界面看不出来） */
  const idFromUrl = (it.mediaUrl ?? '').match(/photos\/(\d+)\//)?.[1]
  if (idFromUrl && it.credit?.link && !it.credit.link.includes(idFromUrl)) {
    push(`credit.link 里没有 mediaUrl 的编号 ${idFromUrl} —— 出处与图片对不上`)
  }
})

if (issues.length > 0) {
  console.error(`✗ 来源清单有问题（共 ${issues.length} 条）：`)
  for (const s of issues.slice(0, 30)) console.error('   ' + s)
  if (issues.length > 30) console.error(`   …还有 ${issues.length - 30} 条`)
  process.exit(1)
}

const byMatch = { place: 0, scene: 0 }
for (const it of norm) byMatch[it.match] += 1

/* ★ 全库规模由来源清单给出（85 + 558 = 643）；缺了就退回"就这么多"，
   绝不写死一个数字 —— 写死的话下次再铺开，抬头就会开始说谎。 */
const libraryTotal = typeof raw.libraryTotal === 'number' ? raw.libraryTotal : norm.length

/* ★★ 命中率**从来源清单算**，不许写死。
   写死的数字是"当时的快照"：这次就因为写死了 31.3%（真值 31.1%）而说错话，
   而且下次铺开一定会过期。
   ⚠️ 两类**必须分开算**：世界地标 ~99%、中文 5A ~31%，混在一起看会把排期估错 3 倍。 */
const pool = raw.searchPool ?? {}
const poolWorld = pool.world ?? { total: 0, place: 0 }
const poolCn = pool.china5a ?? { total: 0, place: 0 }
const pct = (x) => (x.total ? ((x.place / x.total) * 100).toFixed(1) : '—')

/* ⚠️ Pexels 上原始资源是 PNG 的那几条，地址结尾是 `.png`；
   同一个编号换成 `.jpeg` 会 404。抬头必须点出来，不然复核的人会以为地址拼错了。 */
const pngIds = norm
  .filter((it) => /\.png\?/.test(it.mediaUrl ?? ''))
  .map((it) => (it.mediaUrl.match(/photos\/(\d+)\//) ?? [])[1])
  .filter(Boolean)

/* ★★ 抬头里必须写清楚"这份数据**只覆盖了一部分**" ——
   不然下一个人会以为 643 条都有图，然后去查"为什么某条没图"查到天亮。 */
const out = {
  whyThisFileExists:
    '每条地标配一张**默认图片** —— 小鸟抽到「拍照」事件、而这个景点家长还没配内容时，' +
    '用它顶上，不必退回程序化插画。\n' +
    '★ 它**不替代**内容包（`travel-contents.json`）：内容包是家长一张张挑的、有散文和等级；' +
    '这里只是"至少有张真照片"的兜底。优先级见 `travelContents.ts` 的 `pickPhotoForLandmark()`。',
  source: 'Pexels',
  license: 'Pexels License —— 免费商用、无需署名（我们仍然把作者与出处存下来）',
  licenseUrl: 'https://www.pexels.com/license/',
  attribution: '照片来自 Pexels（https://www.pexels.com/）；每条的摄影师见 credit.author',
  cdnPattern: cdnUrl('{编号}'),
  cdnNote:
    '拼直链**不需要 key、不走任何图片 API**。⚠️ 取图时 curl 必须带 -L（不带只会拿到 160 字节的空壳）。' +
    (pngIds.length
      ? `\n⚠️ 上面 cdnPattern 写的是 jpeg 的形状，但有 ${pngIds.length} 条的原始资源是 PNG ——` +
        ` 它们的地址结尾是 \`.png\`（编号 ${pngIds.join(' / ')}）。` +
        '同一个编号换成 `.jpeg` 会 **404**，实测过。'
      : ''),
  howItWasMade:
    '家长 2026-09-25 给的土办法，一步不省：\n' +
    '  ① 搜网页（Pexels 搜索页，**不是**图片 API）\n' +
    '  ② 从详情页链接里抠出图片编号（形如 /photo/<slug>-<编号>/）\n' +
    '  ③ 用编号拼 CDN 直链（见 cdnPattern）\n' +
    '  ④ 下载后**用视觉模型真看一遍**\n' +
    '⚠️ 第④步不能省：只看标题会挑到「另一座山的同款照片」——实测发生过（泰山挑成了老君山）。\n' +
    '分两轮攒：第一轮「世界知名」85 条（人逐张复核）；' +
    `第二轮把库里剩下 ${poolWorld.total + poolCn.total} 条拆成 28 批并行搜。` +
    '\n★★ **两类的命中率差 3 倍** —— 这是第二轮最值钱的数字，也是"为什么不全铺满"的依据：\n' +
    `  · 世界地标：${poolWorld.place}/${poolWorld.total} = ${pct(poolWorld)}%（有公认英文名，通常一次就中）\n` +
    `  · 中文 5A：${poolCn.place}/${poolCn.total} = ${pct(poolCn)}%（地方性景区；搜出来的"真图"多半是 iStock 付费广告位，编号拼不出 CDN，用不了）`,
  matchNote:
    '★ `match` 说的是**这张图跟那个地方的关系**，是给复核的人看的：\n' +
    '  · `place` —— 真的搜到了这个地方的照片\n' +
    '  · `scene` —— 搜不到，用了一张同地带的照片顶上（**说真话，不硬凑**）\n' +
    '⚠️ 别把它当成"图片质量"：`scene` 不代表图难看，只代表"这不是它本人的样子"。',
  asOf: raw.asOf ?? '2026-09-26',
  count: norm.length,
  byMatch,
  scope:
    `覆盖 ${norm.length} / ${libraryTotal} 条地标。` +
    `★ 「世界知名」那一档**每条都有**；「全国知名」那 ${poolCn.total} 条只收下了"真的搜到本体"的那部分（${poolCn.place} 条）。\n` +
    '⚠️ 其余**故意没有默认图** —— 它们在 Pexels 上搜不到本体。' +
    '宁可不配、照旧退回程序化插画，也不拿一张"不是那个地方"的照片冒充。' +
    '（**没配 ≠ 坏了**：界面会退回程序化插画。）\n' +
    '★ 为什么不全铺满：真照片会被当成纪实，一张"不是那个地方"的图比一张插画更容易骗到孩子。' +
    '来龙去脉见 `scripts/photo-sourced.json` 的 `scopeNote`。',
  generatedBy: 'scripts/build-landmark-photos.mjs（输入 scripts/photo-sourced.json）',
  items: norm,
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
console.log(`✓ ${OUT}`)
console.log(`  ${norm.length} 条  place=${byMatch.place}  scene=${byMatch.scene}`)
