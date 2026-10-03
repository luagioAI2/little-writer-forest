/* 把一批 jpg 拼成一张联系表 PNG —— 一眼看完，而且**看到的就是裁完之后的样子**。

   用法：
     node scripts/_photo-scene/sheet.mjs <目录> [输出前缀] [--cols 4] [--title "提示文字"]

   关键设计：每格固定 320x240 + object-fit: cover —— 这跟 App 里
   `aspect-ratio: 4/3` + `object-cover` 的裁法是**同一个**，
   所以联系表本身就是「上屏之后长什么样」的预览。竖图一眼就能看出被切掉了头或脚。

   ⚠️ 图片必须内联成 data URI：`setContent()` 的页面源是 `about:blank`，
      `file://` 的图片会被挡掉。
*/
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const argv = process.argv.slice(2)
const positional = argv.filter((a) => !a.startsWith('--'))
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : dflt
}

const dir = positional[0]
if (!dir) {
  console.error('用法: node scripts/_photo-scene/sheet.mjs <目录> [输出前缀] [--cols 4] [--title "..."]')
  process.exit(1)
}
const prefix = positional[1] ?? path.join(dir, '_sheet')
const cols = Number(flag('cols', 4))
const title = flag('title', dir)

const files = fs
  .readdirSync(dir)
  .filter((f) => /\.(jpe?g)$/i.test(f))
  .sort()

if (files.length === 0) {
  console.error('目录里没有 jpg:', dir)
  process.exit(1)
}

const cells = files.map((f) => {
  const b64 = fs.readFileSync(path.join(dir, f)).toString('base64')
  const bytes = fs.statSync(path.join(dir, f)).size
  return `<figure>
    <div class="box"><img src="data:image/jpeg;base64,${b64}" alt=""></div>
    <figcaption><b>${f}</b><span>${Math.round(bytes / 1024)}KB</span><span class="dim"></span></figcaption>
  </figure>`
})

const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin:0; padding:14px; background:#fff; font:12px/1.45 system-ui,"Microsoft YaHei",sans-serif; color:#111; }
  h1 { font-size:15px; margin:0 0 10px; }
  .grid { display:grid; grid-template-columns:repeat(${cols},320px); gap:12px; }
  figure { margin:0; }
  .box { width:320px; height:240px; overflow:hidden; background:#eee; border:1px solid #ddd; border-radius:6px; }
  img { width:100%; height:100%; object-fit:cover; display:block; }
  figcaption { padding-top:3px; display:flex; gap:6px; flex-wrap:wrap; align-items:baseline; }
  figcaption span { color:#666; }
  .dim { color:#0a7 !important; font-weight:600; }
</style><h1>${title}（共 ${files.length} 张，每格 320x240 = 上屏的 4:3 裁法）</h1>
<div class="grid">${cells.join('')}</div>`

const browser = await puppeteer.launch({
  executablePath: CHROME,
  protocolTimeout: 600_000,
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.setViewport({ width: cols * 332 + 28, height: 900, deviceScaleFactor: 1 })
await page.setContent(html, { waitUntil: 'load' })

// 等所有图加载完，再把真实像素尺寸和宽高比写进标签
await page.evaluate(async () => {
  const imgs = [...document.images]
  await Promise.all(
    imgs.map((im) =>
      im.complete
        ? Promise.resolve()
        : new Promise((r) => {
            im.onload = r
            im.onerror = r
          }),
    ),
  )
  document.querySelectorAll('figure').forEach((fig) => {
    const im = fig.querySelector('img')
    const el = fig.querySelector('.dim')
    if (!im.naturalWidth) {
      el.textContent = '解码失败'
      el.style.color = '#c00'
      return
    }
    const ar = im.naturalWidth / im.naturalHeight
    el.textContent = `${im.naturalWidth}x${im.naturalHeight} ar=${ar.toFixed(2)}${ar < 1.15 ? ' 竖图!' : ar < 1.33 ? ' 偏窄' : ''}`
    if (ar < 1.15) el.style.color = '#c00'
    else if (ar < 1.33) el.style.color = '#d80'
  })
})

await page.screenshot({ path: `${prefix}.png`, fullPage: true })
await browser.close()
console.log('写出', `${prefix}.png`, `（${files.length} 张）`)
