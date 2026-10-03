/* 打开真 App（不是题库工具页），看它落在哪一屏、题库能不能到 */
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 430, height: 900 })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto('http://127.0.0.1:5191/', { waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 2500))
  const info = await page.evaluate(() => ({
    title: document.title,
    // 底部导航有哪些 tab
    tabs: [...document.querySelectorAll('nav button, [role="tab"]')].map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 12),
    // 可见的按钮文案（找「题库」入口）
    buttons: [...document.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 30),
    ls: Object.keys(localStorage),
  }))
  console.log('title:', info.title)
  console.log('tabs:', JSON.stringify(info.tabs))
  console.log('buttons:', JSON.stringify(info.buttons))
  console.log('localStorage keys:', JSON.stringify(info.ls))
  console.log('pageerror:', errs.slice(0, 3))
  await page.screenshot({ path: '_app-boot.png' })
  console.log('→ _app-boot.png')
} finally {
  await browser.close()
}
