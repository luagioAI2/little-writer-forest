/* 渲染链路探针：数据里有 ≠ 界面会读。直接调真代码 + 数 DOM 里的 <img> */
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto('http://localhost:5190/library-browse.html', { waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 1200))

  const stats = await page.evaluate(async () => {
    const mod = await import('/src/domain/builtinLibrary.ts')
    const items = mod.buildBuiltinLibrary()
    const withImg = items.filter((it) => it.images.some((im) => im.imageUrl))
    const pexels = withImg.filter((it) => it.images.some((im) => /images\.pexels\.com/.test(im.imageUrl ?? '')))
    return {
      total: items.length,
      withImg: withImg.length,
      pexels: pexels.length,
      domPhotoTags: document.querySelectorAll('.item .tag.photo').length,
      domItems: document.querySelectorAll('.item').length,
      domImgTags: document.querySelectorAll('.item img').length,
      sPhoto: document.getElementById('s-photo')?.textContent,
      sTotal: document.getElementById('s-total')?.textContent,
      sEdited: document.getElementById('s-edited')?.textContent,
    }
  })

  console.log('真代码 buildBuiltinLibrary():')
  console.log('  总条数            :', stats.total)
  console.log('  有外链图          :', stats.withImg)
  console.log('  其中 pexels 外链  :', stats.pexels)
  console.log('界面（DOM）:')
  console.log('  卡片数            :', stats.domItems)
  console.log('  带「外链图」标记  :', stats.domPhotoTags)
  console.log('  卡片里的 <img>    :', stats.domImgTags)
  console.log('  统计条：配了外链图', stats.sPhoto, '/ 内置题', stats.sTotal, '/ 已改过', stats.sEdited)
  console.log('console error:', errs.length ? errs.slice(0, 3) : '无')
} finally {
  await browser.close()
}
