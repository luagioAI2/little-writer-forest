/* 拼联系表：格子用 300x225 = 4:3，跟 SceneArt 上屏的裁法一致（data URI —— setContent 下 file:// 会被挡）
   用法：node scripts/_new50/sheet.mjs p    → 首选图
         node scripts/_new50/sheet.mjs f    → 备选图 */
import puppeteer from 'puppeteer-core'
import { existsSync, readFileSync } from 'node:fs'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DIR = 'scripts/_new50'
const which = process.argv[2] === 'f' ? 'f' : 'p'
const verify = JSON.parse(readFileSync(`${DIR}/verify.json`, 'utf8'))

const rows = verify
  .map((r) => {
    const c = r[which === 'p' ? 'primary' : 'fallback']
    const file = `${DIR}/img/${String(r.n).padStart(2, '0')}-${which}.jpg`
    return c && existsSync(file)
      ? { n: r.n, title: r.title, tag: r.tag, id: c.id, ar: c.ar, data: readFileSync(file).toString('base64') }
      : null
  })
  .filter(Boolean)

console.log('格子数:', rows.length)

const PER = 20
const sheets = []
for (let i = 0; i < rows.length; i += PER) sheets.push(rows.slice(i, i + PER))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1300, height: 900 })
  for (let s = 0; s < sheets.length; s += 1) {
    const html = `<html><body style="margin:0;background:#fff;font:13px system-ui,'Microsoft YaHei'">
    <div style="display:grid;grid-template-columns:repeat(4,310px);gap:10px;padding:10px">
    ${sheets[s]
      .map(
        (it) => `<div>
      <img src="data:image/jpeg;base64,${it.data}" style="width:310px;height:232px;object-fit:cover;display:block;border:1px solid #ccc">
      <div style="padding:3px 0"><b>${it.n}. ${it.title}</b><br><span style="color:#888">${it.tag} · ${it.id} · ar ${it.ar}</span></div>
    </div>`,
      )
      .join('')}
    </div></body></html>`
    await page.setContent(html, { waitUntil: 'load' })
    await new Promise((r) => setTimeout(r, 400))
    const out = `_new50-sheet-${which}-${s + 1}.png`
    await page.screenshot({ path: out, fullPage: true })
    console.log(`${out}  (${sheets[s].length} 格)`)
  }
} finally {
  await browser.close()
}
