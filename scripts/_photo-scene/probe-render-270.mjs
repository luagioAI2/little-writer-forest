/* 只读探针：证明「一图一题」真的到了界面上。

   家长报的现象是「只能看到照片题」。数据层已经证明 270 条了，
   但数据对 ≠ 界面会读 —— 所以这里真的开一次页面、真的点一道插画题、
   真的看 #art-0 里有没有 <svg>。

   ⚠️ 全程只读：不点「保存」，不碰 /__save-library-items。
   用完即删。
*/
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.env.E2E_URL ?? 'http://localhost:5190/library-browse.html'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  protocolTimeout: 600_000,
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 1000 })

const bad = []
page.on('response', (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`)
})
page.on('console', (m) => {
  if (m.type() === 'error') bad.push('console: ' + m.text())
})
// 保险：万一哪里真去写盘，直接掐掉
await page.setRequestInterception(true)
page.on('request', (req) => {
  if (/__save-library-items/.test(req.url())) return req.abort()
  req.continue()
})

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 })

const stats = await page.evaluate(async () => {
  const mod = await import('/src/domain/builtinLibrary.ts')
  const items = mod.buildBuiltinLibrary()
  return {
    total: items.length,
    illusOnly: items.filter((i) => i.images.every((x) => x.sceneKey)).map((i) => i.id),
    photoOnly: items.filter((i) => i.images.every((x) => x.imageUrl)).map((i) => i.id),
    noSrc: items.filter((i) => i.images.some((x) => !x.sceneKey && !x.imageUrl)).map((i) => i.id),
  }
})

console.log(`buildBuiltinLibrary(): ${stats.total} 条`)
console.log(`  纯插画题 ${stats.illusOnly.length} / 纯照片题 ${stats.photoOnly.length} / 无图可画 ${stats.noSrc.length}`)

// ---- ① 列表里真的列出来了吗 ----
const list = await page.evaluate(() => ({
  rows: document.querySelectorAll('#items .item').length,
  nShow: document.getElementById('n-show')?.textContent,
  photoBadge: document.querySelectorAll('#items .item .tag.photo').length,
  withScene: [...document.querySelectorAll('#items .item .thumb')].filter(
    (t) => t.dataset.scene,
  ).length,
}))
console.log(`\n列表：#items 里 ${list.rows} 行（n-show=${list.nShow}）`)
console.log(`  带「外链图」角标 ${list.photoBadge} 行 / 缩略图带 sceneKey ${list.withScene} 行`)

// ---- ② 点一道插画题，看 #art-0 里有没有 SVG ----
const target = stats.illusOnly[0]
await page.evaluate((id) => {
  const el = document.querySelector(`#items .item[data-id="${id}"]`)
  el?.scrollIntoView({ block: 'center' })
  el?.click()
}, target)
await new Promise((r) => setTimeout(r, 1200))

const illus = await page.evaluate(() => {
  const root = document.getElementById('art-0')
  return {
    slotName: document.querySelector('.slot-name')?.textContent?.replace(/\s+/g, ' ').trim(),
    hasSvg: !!root?.querySelector('svg'),
    hasImg: !!root?.querySelector('img'),
    h2: document.querySelector('#panel h2')?.textContent,
  }
})
console.log(`\n点开插画题 ${target}：《${illus.h2}》`)
console.log(`  图位标签：${illus.slotName}`)
console.log(`  #art-0 里 SVG=${illus.hasSvg}  img=${illus.hasImg}`)

// ---- ③ 再点一道纯照片题，看标签是不是「纯照片位」 ----
const photoTarget = stats.photoOnly[0]
await page.evaluate((id) => {
  const el = document.querySelector(`#items .item[data-id="${id}"]`)
  el?.scrollIntoView({ block: 'center' })
  el?.click()
}, photoTarget)
await new Promise((r) => setTimeout(r, 1200))

const photo = await page.evaluate(() => ({
  slotName: document.querySelector('.slot-name')?.textContent?.replace(/\s+/g, ' ').trim(),
  hasImg: !!document.getElementById('art-0')?.querySelector('img'),
  h2: document.querySelector('#panel h2')?.textContent,
  hint: document.querySelector('#panel .field .hint:last-of-type')?.textContent?.replace(/\s+/g, ' ').trim(),
}))
console.log(`\n点开照片题 ${photoTarget}：《${photo.h2}》`)
console.log(`  图位标签：${photo.slotName}`)
console.log(`  #art-0 里 img=${photo.hasImg}`)

const unexpected = bad.filter((b) => !b.includes('favicon') && !b.includes('ERR_FAILED'))
if (unexpected.length) {
  console.log('\n⚠️ 页面上的报错：')
  for (const b of unexpected.slice(0, 10)) console.log('  ', b)
} else {
  console.log('\n✓ 页面无报错')
}

const pass =
  list.rows === stats.total &&
  list.photoBadge === stats.photoOnly.length &&
  list.withScene === stats.illusOnly.length &&
  illus.hasSvg &&
  photo.hasImg
console.log(`\n结论：${pass ? '通过 —— 插画题真的在界面上了' : '不通过，见上'}`)
await browser.close()
process.exit(pass ? 0 : 1)
