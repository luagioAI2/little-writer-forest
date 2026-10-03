/* 联系表：把 30 张新图拼成 3 张 PNG，**格子就是上屏的裁法**（4:3 + cover）。

   为什么非要这一步：前三步（能下载 / 能解码 / ar 达标）全都只证明"图是好的"，
   证明不了"这张图对不对"。而且 320x240 的格子容易把主体认错 —— 所以要放大看。

   用 data URI 而不是 file://：setContent() 的页面源是 about:blank，file:// 会被挡。
*/
import puppeteer from 'puppeteer-core'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const DIR = 'scripts/_photo-scene/verify'
const OUT = 'scripts/_photo-scene'
const merged = JSON.parse(readFileSync('scripts/_photo-scene/replace-merged.json', 'utf8'))
const wl = JSON.parse(readFileSync('scripts/_photo-scene/replace-worklist.json', 'utf8'))

const files = readdirSync(DIR).filter((f) => f.endsWith('.jpg')).sort()
const mustOf = {}
for (const w of wl) mustOf[`${w.id}|${w.slot}`] = w

const cells = files.map((f) => {
  const m = f.match(/^\d+_(.+)_(\d+)\.jpg$/)
  const id = m[1]
  const slot = Number(m[2])
  const it = merged.find((x) => x.id === id && x.slot === slot)
  const w = mustOf[`${id}|${slot}`] || {}
  return {
    file: f,
    b64: readFileSync(`${DIR}/${f}`).toString('base64'),
    label: `${id.replace('builtin-', '')} · 第${slot + 1}张`,
    title: w.title || '',
    subject: (w.must || '').replace(/^★\s*/, ''),
    note: it?.note || '',
    ar: it?.ar,
  }
})

const PER = 10
const COLS = 2
const CW = 420
const CH = 315
const H = 96

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox'],
  protocolTimeout: 600_000,
})
const page = await browser.newPage()

for (let s = 0; s * PER < cells.length; s++) {
  const chunk = cells.slice(s * PER, (s + 1) * PER)
  const rows = chunk
    .map(
      (c) => `
    <div class="cell">
      <img src="data:image/jpeg;base64,${c.b64}">
      <div class="lab">
        <div class="l1">${c.label} 《${c.title}》 <span class="ar">ar=${c.ar}</span></div>
        <div class="l2">要：${c.subject}</div>
        <div class="l3">是：${c.note}</div>
      </div>
    </div>`,
    )
    .join('')

  await page.setContent(
    `<html><meta charset="utf-8"><style>
      body{margin:0;background:#fff;font:13px/1.45 "Microsoft YaHei",system-ui,sans-serif;color:#111}
      h1{font-size:16px;margin:10px 12px 6px}
      .grid{display:grid;grid-template-columns:repeat(${COLS},${CW}px);gap:12px;padding:0 12px 12px}
      .cell{width:${CW}px}
      .cell img{width:${CW}px;height:${CH}px;object-fit:cover;display:block;border:1px solid #bbb}
      .lab{height:${H}px;padding:4px 2px}
      .l1{font-weight:700}
      .ar{font-weight:400;color:#777;font-size:11px}
      .l2{color:#b00;font-size:12px}
      .l3{color:#333;font-size:12px}
    </style></head><body>
      <h1>换图复核 · 第 ${s + 1} / ${Math.ceil(cells.length / PER)} 张（格子 = 上屏的 4:3 裁法）</h1>
      <div class="grid">${rows}</div>
    </body></html>`,
    { waitUntil: 'load' },
  )
  const p = `${OUT}/replace-sheet-${s + 1}.png`
  await page.screenshot({ path: p, fullPage: true })
  console.log('→', p)
}

await browser.close()
