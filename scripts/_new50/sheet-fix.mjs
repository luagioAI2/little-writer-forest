/* 补搜的 18 张候选：直接在浏览器里加载远程图 → 量 naturalWidth/Height + 拼联系表
   （不下载：puppeteer 自己能取图；量完再截图，避免"灰框"误判） */
import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DIR = 'scripts/_new50'
const fixes = JSON.parse(readFileSync(`${DIR}/out-fix.json`, 'utf8'))

const cells = []
for (const f of fixes) {
  for (const [k, c] of (f.cands ?? []).entries()) {
    cells.push({ n: f.n, title: f.title, k: k + 1, ...c })
  }
}
console.log('候选数:', cells.length)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1000, height: 800 })
  const html = `<html><body style="margin:0;background:#fff;font:13px system-ui,'Microsoft YaHei'">
  <div style="display:grid;grid-template-columns:repeat(3,320px);gap:10px;padding:10px">
  ${cells
    .map(
      (c, i) => `<div>
    <img id="im${i}" src="${c.url}" style="width:320px;height:240px;object-fit:cover;display:block;border:1px solid #ccc">
    <div style="padding:3px 0"><b>n${c.n}. ${c.title} · 候选${c.k}</b><br><span style="color:#888">${c.id} · ar ${c.ar ?? '?'}</span></div>
  </div>`,
    )
    .join('')}
  </div></body></html>`

  await page.setContent(html, { waitUntil: 'load' })
  // 等所有图真的解码完（懒挂/外链下载都可能还没好）
  const sizes = await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('img')]
    await Promise.all(
      imgs.map((im) =>
        im.complete && im.naturalWidth
          ? Promise.resolve()
          : new Promise((r) => {
              im.onload = r
              im.onerror = r
            }),
      ),
    )
    await new Promise((r) => setTimeout(r, 800))
    return imgs.map((im) => ({ w: im.naturalWidth, h: im.naturalHeight }))
  })

  cells.forEach((c, i) => {
    const s = sizes[i]
    const ar = s.w && s.h ? (s.w / s.h).toFixed(3) : 'FAIL'
    const flag = !s.w ? '  ❌ 没加载出来' : Number(ar) < 1.33 ? '  ⚠️ 竖/方图' : ''
    console.log(`n${String(c.n).padStart(2)} 候选${c.k}  ${c.id}  ${s.w}x${s.h}  ar ${ar}${flag}`)
  })

  await page.screenshot({ path: '_new50-fix.png', fullPage: true })
  console.log('\n_new50-fix.png')
} finally {
  await browser.close()
}
