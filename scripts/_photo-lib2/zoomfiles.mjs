/* 通用放大复核表：`node zoomfiles.mjs "标签|路径" ...`（一格 560px，就是上屏 4:3 的裁法） */
import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const rows = process.argv.slice(2).map((a) => {
  const i = a.indexOf('|')
  const label = a.slice(0, i)
  const path = a.slice(i + 1)
  const buf = readFileSync(path)
  let ar = 0
  let j = 2
  while (j < buf.length - 9) {
    if (buf[j] !== 0xff) { j += 1; continue }
    const m = buf[j + 1]
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) { ar = buf.readUInt16BE(j + 7) / buf.readUInt16BE(j + 5); break }
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) { j += 2; continue }
    j += 2 + buf.readUInt16BE(j + 2)
  }
  return { label, ar: Number(ar.toFixed(3)), bytes: buf.length, data: buf.toString('base64') }
})

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 900 })
  const html = `<html><body style="margin:0;background:#fff;font:13px system-ui,'Microsoft YaHei'">
  <div style="display:grid;grid-template-columns:repeat(2,560px);gap:12px;padding:12px">
  ${rows
    .map(
      (r) => `<div>
    <img src="data:image/jpeg;base64,${r.data}" style="width:560px;height:420px;object-fit:cover;display:block;border:1px solid #999">
    <div style="padding:4px 0"><b>${r.label}</b><br><span style="color:#888">ar ${r.ar} · ${r.bytes} bytes</span></div>
  </div>`,
    )
    .join('')}
  </div></body></html>`
  await page.setContent(html, { waitUntil: 'load' })
  await new Promise((r) => setTimeout(r, 500))
  await page.screenshot({ path: '_lib2-retry.png', fullPage: true })
  console.log('_lib2-retry.png', rows.length, '格')
} finally {
  await browser.close()
}
