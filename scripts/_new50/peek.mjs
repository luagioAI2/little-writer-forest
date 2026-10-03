/* 临时看图：node scripts/_new50/peek.mjs 123 456 789
   直接在浏览器里加载 CDN 图，量完 naturalWidth 再截图 */
import puppeteer from 'puppeteer-core'

const ids = process.argv.slice(2)
if (!ids.length) throw new Error('给几个 pexels id')
const urls = ids.map(
  (id) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=640`,
)

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1000, height: 800 })
  await page.setContent(
    `<html><body style="margin:0;background:#fff;font:13px system-ui,'Microsoft YaHei'">
    <div style="display:grid;grid-template-columns:repeat(3,320px);gap:10px;padding:10px">
    ${urls
      .map(
        (u, i) => `<div><img id="im${i}" src="${u}" style="width:320px;height:240px;object-fit:cover;display:block;border:1px solid #ccc">
        <div style="padding:3px 0"><b>${ids[i]}</b></div></div>`,
      )
      .join('')}
    </div></body></html>`,
    { waitUntil: 'load' },
  )
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
    await new Promise((r) => setTimeout(r, 600))
    return imgs.map((im) => ({ w: im.naturalWidth, h: im.naturalHeight }))
  })
  sizes.forEach((s, i) => {
    const ar = s.w && s.h ? (s.w / s.h).toFixed(3) : 'FAIL'
    console.log(`${ids[i]}  ${s.w}x${s.h}  ar ${ar}${!s.w ? '  ❌ 没加载' : Number(ar) < 1.33 ? '  ⚠️ 竖/方' : ''}`)
  })
  await page.screenshot({ path: '_new50-peek.png', fullPage: true })
  console.log('_new50-peek.png')
} finally {
  await browser.close()
}
