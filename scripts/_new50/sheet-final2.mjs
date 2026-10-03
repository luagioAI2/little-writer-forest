/* 审查表分两半出（每半 25 张），格子放大到 380px，保证肉眼能看清「图对不对」 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const items = JSON.parse(readFileSync('scripts/_new50/final50.json', 'utf8'))
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const COLS = 5
const CELL = 380

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  for (const [name, slice] of [['a', items.slice(0, 25)], ['b', items.slice(25)]]) {
    const cells = slice
      .map(
        (it) =>
          `<figure><img src="${it.url}"><figcaption>${it.id.replace('builtin-', '')} · <b>${it.title}</b></figcaption></figure>`,
      )
      .join('')
    const html = `<!doctype html><meta charset="utf-8"><style>
     body{margin:0;background:#f6f7f9;font:13px/1.45 "Microsoft YaHei",sans-serif;color:#111}
     .grid{display:grid;grid-template-columns:repeat(${COLS},${CELL}px);gap:16px;padding:16px}
     figure{margin:0;background:#fff;border:1px solid #dfe3e8;border-radius:8px;overflow:hidden}
     img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#eee}
     figcaption{padding:7px 9px;font-size:12px;line-height:1.35}
     b{font-size:14px}
    </style><div class="grid">${cells}</div>`
    const page = await browser.newPage()
    await page.setViewport({ width: COLS * CELL + 64, height: 1200, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'networkidle2' })
    await page.waitForFunction(
      (n) => [...document.images].filter((i) => i.naturalWidth > 0).length >= n,
      { timeout: 90000 },
      slice.length,
    )
    await page.screenshot({ path: `_new50-final-${name}.png`, fullPage: true })
    console.log(`_new50-final-${name}.png  图 ${slice.length} 张`)
    await page.close()
  }
} finally {
  await browser.close()
}
