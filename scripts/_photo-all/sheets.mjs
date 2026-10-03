/* ============================================================
   把「重新拉过一遍」的 366 张图拼成联系表（PNG）—— 给人肉眼扫的
   ============================================================
   跑法：node scripts/_photo-all/sheets.mjs

   为什么用浏览器截图而不是 PIL：
     这台机器**没装 PIL**，但 Chrome + puppeteer-core 是现成的
     （`_verify-default-photo.mjs` 一直在用）。少装一个依赖。

   输入：scripts/_photo-all/verify-report.json（verify-urls-all.mjs 写的）
        + scripts/_photo-all/verify/<NNN>.jpg
   产物：scripts/_photo-all/sheet-01.png … （每张 60 格，5 列）
   ============================================================ */
import puppeteer from 'puppeteer-core'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const root = process.cwd()
const REPORT = resolve(root, 'scripts/_photo-all/verify-report.json')
const VERIFY = resolve(root, 'scripts/_photo-all/verify')

const PER_SHEET = 60
const COLS = 5

const report = JSON.parse(readFileSync(REPORT, 'utf8'))
const rows = [...report.all].sort((a, b) => a.i - b.i)

const mimeOf = (t) => (t === 'image/png' ? 'image/png' : 'image/jpeg')

const cells = rows.map((r) => {
  const file = resolve(VERIFY, String(r.i).padStart(3, '0') + '.jpg')
  const ok = existsSync(file)
  const dataUri = ok
    ? `data:${mimeOf(r.type)};base64,${readFileSync(file).toString('base64')}`
    : ''
  const badge = r.match === 'scene' ? '<span class="b scene">scene</span>' : '<span class="b place">place</span>'
  const pilot = r.i < 85 ? '<span class="b pilot">试水</span>' : ''
  return `<figure>
    <div class="art">${ok ? `<img src="${dataUri}" alt="">` : '<div class="miss">缺图</div>'}</div>
    <figcaption><b>#${r.i}</b> ${badge}${pilot}<br><span class="id">${r.landmarkId}</span></figcaption>
  </figure>`
})

const sheets = []
for (let i = 0; i < cells.length; i += PER_SHEET) sheets.push(cells.slice(i, i + PER_SHEET))

const pageHtml = (body, n, total) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:14px;background:#fbf9f4;font:11px/1.35 system-ui,sans-serif;color:#3d443f}
  h1{font-size:14px;margin:0 0 10px}
  .grid{display:grid;grid-template-columns:repeat(${COLS},1fr);gap:10px}
  figure{margin:0}
  .art{aspect-ratio:1/1;border-radius:10px;overflow:hidden;background:#eceae4;display:flex;align-items:center;justify-content:center}
  .art img{width:100%;height:100%;object-fit:cover;display:block}
  .miss{color:#a33;font-size:12px}
  figcaption{text-align:center;padding-top:3px}
  .id{color:#5b655e;font-size:10px;word-break:break-all}
  .b{display:inline-block;border-radius:4px;padding:0 3px;font-size:9px;margin-right:2px;color:#fff}
  .place{background:#3f8f63}
  .scene{background:#b98a2e}
  .pilot{background:#8a8f9a}
</style></head><body>
<h1>默认图复核 · 第 ${n}/${total} 张联系表 · 共 ${rows.length} 条（绿=place 真地方 / 黄=scene 同类顶替）</h1>
<div class="grid">${body}</div>
</body></html>`

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  protocolTimeout: 600_000,
})
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 1400, deviceScaleFactor: 1 })

for (let i = 0; i < sheets.length; i++) {
  const n = i + 1
  await page.setContent(pageHtml(sheets[i].join(''), n, sheets.length), { waitUntil: 'load' })
  // 等所有 <img> 解码完（data URI，不需要联网）
  await page.evaluate(() =>
    Promise.all(
      [...document.images].map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r }))),
    ),
  )
  const out = resolve(root, `scripts/_photo-all/sheet-${String(n).padStart(2, '0')}.png`)
  await page.screenshot({ path: out, fullPage: true })
  const kb = Math.round(readFileSync(out).length / 1024)
  console.log(`✓ sheet-${String(n).padStart(2, '0')}.png  ${sheets[i].length} 格  ${kb} KB`)
}

await browser.close()
console.log(`\n共 ${sheets.length} 张联系表，覆盖 ${rows.length} 条。`)
