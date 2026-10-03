/* 拼联系表：格子就是上屏的 4:3 裁法（data URI —— setContent 下 file:// 会被挡） */
import puppeteer from 'puppeteer-core'
import { existsSync, readFileSync } from 'node:fs'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DIR = 'scripts/_photo-lib2'
const { items } = JSON.parse(readFileSync(`${DIR}/sourced.json`, 'utf8'))

const rows = items
  .filter((r) => existsSync(`${DIR}/img/${r.id}.jpg`))
  .map((r) => ({ ...r, data: readFileSync(`${DIR}/img/${r.id}.jpg`).toString('base64') }))

console.log('格子数:', rows.length)

const PER = 24
const sheets = []
for (let i = 0; i < rows.length; i += PER) sheets.push(rows.slice(i, i + PER))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1260, height: 900 })
  for (let s = 0; s < sheets.length; s += 1) {
    const html = `<html><body style="margin:0;background:#fff;font:12px system-ui,'Microsoft YaHei'">
    <div style="display:grid;grid-template-columns:repeat(4,300px);gap:8px;padding:8px">
    ${sheets[s]
      .map(
        (it, k) => `<div>
      <img src="data:image/jpeg;base64,${it.data}" style="width:300px;height:225px;object-fit:cover;display:block;border:1px solid #ccc">
      <div style="padding:2px 0"><b>${s * PER + k + 1}. ${it.title}</b><br><span style="color:#888">${it.id} · ar ${it.ar}</span></div>
    </div>`,
      )
      .join('')}
    </div></body></html>`
    await page.setContent(html, { waitUntil: 'load' })
    await new Promise((r) => setTimeout(r, 500))
    await page.screenshot({ path: `_lib2-sheet-${s + 1}.png`, fullPage: true })
    console.log(`_lib2-sheet-${s + 1}.png  (${sheets[s].length} 格)`)
  }
} finally {
  await browser.close()
}
