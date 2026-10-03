/* 全库审图联系表：162 张 → 7 张 PNG（5 列 × 5 行，格子 = 上屏的 4:3 裁法）。
   用途：找「画面里有非亚洲人 / 明显不是中国的东西」的那些。 */
import puppeteer from 'puppeteer-core'
import { readFileSync, readdirSync } from 'node:fs'

const DIR = 'scripts/_photo-scene/all'
const rows = JSON.parse(readFileSync('scripts/_photo-scene/all-162.json', 'utf8'))
const files = readdirSync(DIR).filter((f) => f.endsWith('.jpg')).sort()

const byKey = {}
for (const r of rows) byKey[`${r.id}|${r.slot}`] = r

const cells = files.map((f) => {
  const m = f.match(/^(\d+)_(.+)_(\d+)\.jpg$/)
  const r = byKey[`${m[2]}|${m[3]}`] || {}
  return {
    n: m[1],
    b64: readFileSync(`${DIR}/${f}`).toString('base64'),
    label: `${m[1]} ${r.title || ''}`,
  }
})

const PER = 25
const COLS = 5
const CW = 300
const CH = 225
const H = 30

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox'],
  protocolTimeout: 600_000,
})
const page = await browser.newPage()

for (let s = 0; s * PER < cells.length; s++) {
  const chunk = cells.slice(s * PER, (s + 1) * PER)
  const html = chunk
    .map(
      (c) => `<div class="cell"><img src="data:image/jpeg;base64,${c.b64}"><div class="l">${c.label}</div></div>`,
    )
    .join('')
  await page.setContent(
    `<html><meta charset="utf-8"><style>
      body{margin:0;background:#fff;font:13px "Microsoft YaHei",system-ui,sans-serif}
      .grid{display:grid;grid-template-columns:repeat(${COLS},${CW}px);gap:6px;padding:6px}
      .cell img{width:${CW}px;height:${CH}px;object-fit:cover;display:block;border:1px solid #ccc}
      .l{height:${H}px;font-size:12px;padding:2px 0;overflow:hidden}
    </style></head><body><div class="grid">${html}</div></body></html>`,
    { waitUntil: 'load' },
  )
  const p = `scripts/_photo-scene/audit-${String(s + 1).padStart(2, '0')}.png`
  await page.screenshot({ path: p, fullPage: true })
  console.log('→', p)
}
await browser.close()
