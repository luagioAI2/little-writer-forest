/* 渲染链路探针：数据里有 ≠ 界面会读。直接调真代码 + 数 DOM 里的 <img>。
   用法: E2E_URL=http://localhost:5191 node scripts/_site/render-check.mjs  */
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.E2E_URL ?? 'http://localhost:5191'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(`${BASE}/library-browse.html`, { waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 2500))

  const stats = await page.evaluate(async () => {
    const mod = await import('/src/domain/builtinLibrary.ts')
    const items = mod.buildBuiltinLibrary()
    const withImg = items.filter((it) => it.images.some((im) => im.imageUrl))
    const newTags = ['growth', 'reading', 'tradition', 'society', 'gratitude']
    return {
      total: items.length,
      withImg: withImg.length,
      newTagItems: items.filter((it) => newTags.includes(it.tagId)).length,
      newTagWithImg: items.filter((it) => newTags.includes(it.tagId) && it.images.some((im) => im.imageUrl)).length,
      domItems: document.querySelectorAll('.item').length,
      domPhotoTags: document.querySelectorAll('.item .tag.photo').length,
      domImgTags: document.querySelectorAll('.item img').length,
      sPhoto: document.getElementById('s-photo')?.textContent,
      sTotal: document.getElementById('s-total')?.textContent,
      sEdited: document.getElementById('s-edited')?.textContent,
    }
  })

  // 逐格量缩略图：懒挂 + 外链下载 → 要等够
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await new Promise((r) => setTimeout(r, 5000))
  const thumbs = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.item img')]
    let decoded = 0, zero = 0
    const bad = []
    for (const im of imgs) {
      if (im.naturalWidth > 0) decoded += 1
      else { zero += 1; bad.push(im.getAttribute('src')?.slice(-60) ?? '?') }
    }
    return { total: imgs.length, decoded, zero, bad: bad.slice(0, 5) }
  })

  console.log('真代码 buildBuiltinLibrary():')
  console.log('  总条数            :', stats.total)
  console.log('  有外链图          :', stats.withImg)
  console.log('  新标签题数        :', stats.newTagItems, '｜其中配了图:', stats.newTagWithImg)
  console.log('界面（DOM）:')
  console.log('  卡片数            :', stats.domItems)
  console.log('  带「外链图」标记  :', stats.domPhotoTags)
  console.log('  卡片里的 <img>    :', stats.domImgTags)
  console.log('  缩略图解码        :', thumbs.decoded, '/', thumbs.total, '（0 宽:', thumbs.zero, '）')
  if (thumbs.bad.length) console.log('   未解码样例:', thumbs.bad)
  console.log('  统计条：配了外链图', stats.sPhoto, '/ 内置题', stats.sTotal, '/ 已改过', stats.sEdited)
  console.log('  pageerror:', errs.length ? errs.slice(0, 5) : '[]')
} finally {
  await browser.close()
}
