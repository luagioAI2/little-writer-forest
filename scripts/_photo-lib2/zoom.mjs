/* 放大版联系表：给少数几张"不放心"的图，一格 560px（≈ 上屏 4:3 裁法的 1.87 倍） */
import puppeteer from 'puppeteer-core'
import { existsSync, readFileSync } from 'node:fs'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DIR = 'scripts/_photo-lib2'
const IDS = process.argv.slice(2)
const { items } = JSON.parse(readFileSync(`${DIR}/sourced.json`, 'utf8'))
const byId = new Map(items.map((i) => [i.id, i]))

const rows = IDS.filter((id) => existsSync(`${DIR}/img/${id}.jpg`)).map((id) => ({
  id,
  title: byId.get(id)?.title ?? id,
  note: byId.get(id)?.note ?? '',
  ar: byId.get(id)?.ar,
  data: readFileSync(`${DIR}/img/${id}.jpg`).toString('base64'),
}))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 900 })
  const html = `<html><body style="margin:0;background:#fff;font:13px system-ui,'Microsoft YaHei'">
  <div style="display:grid;grid-template-columns:repeat(2,560px);gap:12px;padding:12px">
  ${rows
    .map(
      (it) => `<div>
    <img src="data:image/jpeg;base64,${it.data}" style="width:560px;height:420px;object-fit:cover;display:block;border:1px solid #999">
    <div style="padding:4px 0"><b>${it.title}</b> · <span style="color:#888">${it.id} · ar ${it.ar}</span><br><span style="color:#666">${it.note}</span></div>
  </div>`,
    )
    .join('')}
  </div></body></html>`
  await page.setContent(html, { waitUntil: 'load' })
  await new Promise((r) => setTimeout(r, 500))
  await page.screenshot({ path: '_lib2-zoom.png', fullPage: true })
  console.log('_lib2-zoom.png', rows.length, '格')
} finally {
  await browser.close()
}
