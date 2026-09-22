/** 临时：给任意本地 HTML 拍张图。用完即删。 */
import puppeteer from 'puppeteer-core'

const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const file = process.argv[2]
const out = process.argv[3] ?? 'shot.png'
const width = Number(process.argv[4] ?? 1100)
const full = process.argv[5] !== 'viewport'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=2'],
})
const page = await browser.newPage()
await page.setViewport({ width, height: 900, deviceScaleFactor: 2 })
await page.goto(`file:///${file.replace(/\\/g, '/')}`, { waitUntil: 'load' })
await new Promise((r) => setTimeout(r, 400))
await page.screenshot({ path: out, fullPage: full })
await browser.close()
console.log('ok ->', out)
