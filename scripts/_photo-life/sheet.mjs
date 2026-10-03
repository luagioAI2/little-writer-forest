/* 拼联系表：格子 = 上屏的 4:3 裁法（data URI，setContent 下 file:// 会被挡） */
import puppeteer from 'puppeteer-core'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DIR = 'scripts/_photo-life/all'
const rows = JSON.parse(readFileSync('scripts/_photo-life/verify.json', 'utf8'))
const byId = new Map(rows.map((r) => [r.id, r]))

const files = readdirSync(DIR).filter((f) => f.endsWith('.jpg')).sort()
const items = files.map((f) => {
  const id = f.replace(/\.jpg$/, '')
  const meta = byId.get(id)
  return { id, title: meta ? meta.title : id, ar: meta ? meta.ar : null, data: readFileSync(join(DIR, f)).toString('base64') }
})

const PER = 24
const sheets = []
for (let i = 0; i < items.length; i += PER) sheets.push(items.slice(i, i + PER))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1240, height: 900 })
  for (let s = 0; s < sheets.length; s += 1) {
    const html = `<html><body style="margin:0;background:#fff;font:12px system-ui,'Microsoft YaHei'">
    <div style="display:grid;grid-template-columns:repeat(4,300px);gap:8px;padding:8px">
    ${sheets[s].map((it, k) => `<div>
      <img src="data:image/jpeg;base64,${it.data}" style="width:300px;height:225px;object-fit:cover;display:block;border:1px solid #ccc">
      <div style="padding:2px 0"><b>${s * PER + k + 1}. ${it.title}</b><br><span style="color:#888">${it.id} · ar ${it.ar}</span></div>
    </div>`).join('')}
    </div></body></html>`
    await page.setContent(html, { waitUntil: 'load' })
    await new Promise((r) => setTimeout(r, 400))
    await page.screenshot({ path: `_life-sheet-${s + 1}.png`, fullPage: true })
    console.log(`_life-sheet-${s + 1}.png  (${sheets[s].length} 格)`)
  }
} finally {
  await browser.close()
}
