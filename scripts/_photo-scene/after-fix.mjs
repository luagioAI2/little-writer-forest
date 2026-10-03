/* 修完之后，**从真实模块**取出这 4 道题的 images[0]，按 App 的 4:3 卡片裁法渲染出来。
   这样证明的不是"文件里有这个地址"，而是"卡片上真的会显示这张"。
   用法：node scripts/_photo-scene/after-fix.mjs */
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://localhost:5190/'
const OUT = 'scripts/_photo-scene/after-fix.png'

const IDS = [
  ['builtin-family-5', '奶奶织毛衣'],
  ['builtin-community-helper-3', '图书管理员'],
  ['builtin-community-helper-4', '公交司机'],
  ['builtin-stranger-2', '雨天的快递员'],
  ['builtin-plant-4', '我的仙人掌'],
  ['builtin-weather-2', '雨后的彩虹'],
]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  protocolTimeout: 600_000,
})
const page = await browser.newPage()
await page.goto(BASE, { waitUntil: 'domcontentloaded' })

const items = await page.evaluate(async (ids) => {
  const m = await import('/src/domain/builtinLibrary.ts')
  const lib = m.buildBuiltinLibrary()
  return ids.map(([id, label]) => {
    const it = lib.find((x) => x.id === id)
    if (!it) return { id, label, missing: true }
    return {
      id,
      label,
      title: it.title,
      lead: it.lead,
      images: it.images.map((i) => ({ sceneKey: i.sceneKey, caption: i.caption, url: i.imageUrl })),
    }
  })
}, IDS)

for (const it of items) {
  if (it.missing) throw new Error('找不到 ' + it.id)
  console.log(`\n${it.id}  ${it.title}`)
  it.images.forEach((im, k) => {
    console.log(`   第${k}张 sceneKey=${im.sceneKey} ${im.caption ?? ''}  ${im.url ?? '(无外链)'}`)
  })
  if (!it.images[0]?.url) throw new Error(it.id + ' 第 0 张没有外链图')
}

// 卡片缩略图取 images[0] —— 按 App 的 4:3 + object-cover 渲染
const cards = items.map((it) => `
  <figure>
    <div class="card"><img src="${it.images[0].url}"></div>
    <figcaption><b>${it.title}</b><br><span>${it.label} · 卡片取第 0 张</span></figcaption>
  </figure>`).join('')

await page.setContent(`<!doctype html><meta charset="utf-8"><style>
  body{margin:0;padding:22px;background:#fff;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#222}
  h1{font-size:17px;margin:0 0 16px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
  .card{aspect-ratio:4/3;overflow:hidden;border-radius:12px;background:#eee}
  .card img{width:100%;height:100%;object-fit:cover;display:block}
  figcaption{margin-top:8px;font-size:13px}
  figcaption span{color:#777;font-size:12px}
</style>
<h1>修完之后 —— 卡片（images[0]）按 App 的 4:3 裁法</h1>
<div class="grid">${cards}</div>`, { waitUntil: 'networkidle0' })

await page.screenshot({ path: OUT, fullPage: true })
await browser.close()
console.log('\n写出 ' + OUT)
