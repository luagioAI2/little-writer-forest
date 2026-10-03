/* 缩略图到底渲染了没：等图真的解码完，再逐格量 naturalWidth */
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })
  const failed = []
  page.on('requestfailed', (r) => { if (/pexels/.test(r.url())) failed.push(`${r.url().slice(0, 80)} ${r.failure()?.errorText}`) })
  await page.goto('http://localhost:5190/library-browse.html', { waitUntil: 'networkidle2' })
  await page.evaluate(() => {
    const el = document.getElementById('q')
    el.value = '台灯'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await new Promise((r) => setTimeout(r, 4000))

  const rows = await page.evaluate(async () => {
    // 给所有 <img> 一个解码完成的机会
    const imgs = [...document.querySelectorAll('.item .thumb img')]
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((res) => { i.onload = res; i.onerror = res }))))
    return [...document.querySelectorAll('.item')].map((card) => {
      const thumb = card.querySelector('.thumb')
      const img = thumb?.querySelector('img')
      const svg = thumb?.querySelector('svg')
      return {
        title: card.querySelector('.nm')?.textContent,
        dataUrl: (thumb?.dataset.url ?? '').slice(-24),
        dataScene: thumb?.dataset.scene ?? '',
        hasImg: !!img,
        naturalW: img?.naturalWidth ?? 0,
        src: (img?.currentSrc ?? '').slice(0, 60),
        hasSvg: !!svg,
      }
    })
  })
  console.table(rows)
  console.log('pexels 请求失败:', failed.length ? failed : '无')
} finally {
  await browser.close()
}
