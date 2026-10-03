/* 最终 50 道新题的配图审查表 —— 5 列 × 4:3 格，格下写「id · 题目」。
   用途：家长一眼过完这 50 张，确认「图对不对」。
   ⚠️ 用 data URI 内嵌（setContent 下 file:// 会被拦）；图要先等到 naturalWidth>0 再截。 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const items = JSON.parse(readFileSync('scripts/_new50/final50.json', 'utf8'))
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const COLS = 5
const CELL = 320

const cells = items
  .map(
    (it) => `<figure><img src="${it.url}"><figcaption>${it.id.replace('builtin-', '')}<br><b>${it.title}</b></figcaption></figure>`,
  )
  .join('')

const html = `<!doctype html><meta charset="utf-8"><style>
 body{margin:0;background:#f6f7f9;font:13px/1.45 "Microsoft YaHei",sans-serif;color:#111}
 .grid{display:grid;grid-template-columns:repeat(${COLS},${CELL}px);gap:14px;padding:14px}
 figure{margin:0;background:#fff;border:1px solid #dfe3e8;border-radius:8px;overflow:hidden}
 img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#eee}
 figcaption{padding:6px 8px;font-size:11.5px;line-height:1.35}
 b{font-size:13px}
</style><div class="grid">${cells}</div>`

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: COLS * CELL + 60, height: 1200, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'networkidle2' })
  // 等所有图真的解码完（否则截到灰框）
  await page.waitForFunction(
    (n) => [...document.images].filter((i) => i.naturalWidth > 0).length >= n,
    { timeout: 90000 },
    items.length,
  )
  const decoded = await page.evaluate(() => document.images.length)
  await page.screenshot({ path: '_new50-final-sheet.png', fullPage: true })
  console.log('内嵌图数', decoded, '/', items.length)
  console.log('写出 _new50-final-sheet.png')
} finally {
  await browser.close()
}
