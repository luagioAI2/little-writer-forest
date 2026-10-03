/* 过新手引导 → 找题库入口 → 数题库条数（真 App，不是工具页） */
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 430, height: 900 })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto('http://127.0.0.1:5191/', { waitUntil: 'networkidle2' })
  await sleep(2000)

  const btn = async (label) =>
    page.evaluate((l) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === l)
      if (b) { b.click(); return true }
      return false
    }, label)

  // 引导只有「跳过」一个出口
  for (let i = 0; i < 6; i++) {
    if (await btn('跳过')) { console.log('点了「跳过」'); await sleep(1200); break }
    await sleep(400)
  }

  const dump = async (tag) => {
    const d = await page.evaluate(() => ({
      tabs: [...document.querySelectorAll('nav button')].map((b) => b.textContent?.trim()).filter(Boolean),
      buttons: [...document.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 24),
    }))
    console.log(`[${tag}] tabs=${JSON.stringify(d.tabs)}`)
    console.log(`[${tag}] buttons=${JSON.stringify(d.buttons)}`)
  }
  await dump('跳过之后')

  await page.screenshot({ path: '_app-after-guide.png' })
  console.log('pageerror:', errs.slice(0, 3))
} finally {
  await browser.close()
}
