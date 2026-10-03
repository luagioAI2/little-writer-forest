/* 找出页面里那个 404 到底是什么资源 */
import puppeteer from 'puppeteer-core'

const PORT = process.env.PORT ?? '5191'
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  const bad = []
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`) })
  page.on('requestfailed', (r) => bad.push(`FAILED ${r.failure()?.errorText} ${r.url()}`))
  await page.goto(`http://127.0.0.1:${PORT}/library-browse.html`, { waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 2500))
  console.log('非 200 资源：', bad.length)
  for (const b of bad) console.log('  ', b)
} finally {
  await browser.close()
}
