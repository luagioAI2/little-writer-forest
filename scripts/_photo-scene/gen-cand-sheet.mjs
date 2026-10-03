/* 候选联系表：看 `cand/` 里的图，格子还是 4:3 + cover（= 上屏的裁法）。 */
import puppeteer from 'puppeteer-core'
import { readFileSync, readdirSync } from 'node:fs'

const DIR = process.argv[2] || 'scripts/_photo-scene/cand'
const OUT = process.argv[3] || 'scripts/_photo-scene/cand-sheet.png'
const files = readdirSync(DIR).filter((f) => f.endsWith('.jpg')).sort()

const COLS = 3
const CW = 400
const CH = 300

const cells = files
  .map((f) => {
    const b64 = readFileSync(`${DIR}/${f}`).toString('base64')
    return `<div class="cell"><img src="data:image/jpeg;base64,${b64}"><div class="l">${f.replace('.jpg', '')}</div></div>`
  })
  .join('')

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox'],
  protocolTimeout: 600_000,
})
const page = await browser.newPage()
await page.setContent(
  `<html><meta charset="utf-8"><style>
    body{margin:0;background:#fff;font:14px "Microsoft YaHei",system-ui,sans-serif}
    .grid{display:grid;grid-template-columns:repeat(${COLS},${CW}px);gap:10px;padding:10px}
    .cell img{width:${CW}px;height:${CH}px;object-fit:cover;display:block;border:1px solid #bbb}
    .l{font-weight:700;padding:3px 0}
  </style></head><body><div class="grid">${cells}</div></body></html>`,
  { waitUntil: 'load' },
)
await page.screenshot({ path: OUT, fullPage: true })
console.log('→', OUT, files.length, '张')
await browser.close()
