/* 手机版分块截图 —— ⚠️ 为什么不用 fullPage：
   12506 CSS px 的页面在 dsf=2 下是 25012px 高，Chrome 的拼接式 fullPage 截图
   在这个尺寸上会**重复/截断**（实测：整页只有一条深色带、页脚整个不见，
   按颜色扫描才发现）。所以改成逐屏滚动、每屏截一张，再自己拼。 */
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.SITE_URL ?? 'http://127.0.0.1:5199'
const OUT = '_mv'
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
  await sleep(1500)

  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    for (const im of [...document.images]) { im.loading = 'eager'; im.scrollIntoView({ block: 'center' }); await sleep(50) }
    document.querySelectorAll('.rv').forEach((el) => el.classList.add('in'))
    const g = document.querySelector('.gallery')
    if (g) g.scrollLeft = 0
    window.scrollTo(0, 0)
    await sleep(300)
  })
  await sleep(1000)

  const H = await page.evaluate(() => document.body.scrollHeight)
  const VH = 844
  const n = Math.ceil(H / VH)
  console.log('页面高度', H, 'px → 分', n, '屏')

  for (let i = 0; i < n; i++) {
    const y = Math.min(i * VH, H - VH)
    await page.evaluate((yy) => window.scrollTo(0, yy), y)
    // 第 2 屏起把固定顶栏藏掉，否则每屏都糊一条
    await page.evaluate((first) => {
      const h = document.getElementById('hdr')
      if (h) h.style.display = first ? '' : 'none'
    }, i === 0)
    await sleep(420)
    await page.screenshot({ path: `${OUT}/${String(i).padStart(2, '0')}.png` })
  }
  console.log('已输出', n, '屏 →', OUT + '/')
} finally {
  await browser.close()
}
