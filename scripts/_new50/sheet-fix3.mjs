/* 看候选图（本地文件 → data URI），4 列 4:3 */
import { readFileSync, readdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const dir = 'scripts/_new50/imgfix3'
const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()
const cells = files
  .map((f) => {
    const b64 = readFileSync(`${dir}/${f}`).toString('base64')
    return `<figure><img src="data:image/jpeg;base64,${b64}"><figcaption>${f.replace('.jpg', '')}</figcaption></figure>`
  })
  .join('')

const html = `<!doctype html><meta charset="utf-8"><style>
 body{margin:0;background:#f6f7f9;font:14px/1.4 "Microsoft YaHei",sans-serif}
 .grid{display:grid;grid-template-columns:repeat(4,340px);gap:14px;padding:14px}
 figure{margin:0;background:#fff;border:1px solid #dfe3e8;border-radius:8px;overflow:hidden}
 img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#eee}
 figcaption{padding:6px 8px;font-size:13px}
</style><div class="grid">${cells}</div>`

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 4 * 340 + 56, height: 900 })
  await page.setContent(html, { waitUntil: 'networkidle2' })
  await page.screenshot({ path: '_new50-fix3-sheet.png', fullPage: true })
  console.log('图', files.length, '张 → _new50-fix3-sheet.png')
} finally {
  await browser.close()
}
