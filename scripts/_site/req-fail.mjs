/* 抓 library-browse.html 上所有失败请求的 URL（确认那个 404 是不是 favicon） */
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.E2E_URL ?? 'http://localhost:5191'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
const bad = []
page.on('response', (r) => {
  const s = r.status()
  if (s >= 400) bad.push(`${s} ${r.url()}`)
})
page.on('requestfailed', (r) => bad.push(`FAILED ${r.url()} ${r.failure()?.errorText ?? ''}`))
try {
  await page.goto(`${BASE}/library-browse.html`, { waitUntil: 'networkidle2', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 2500))
} catch (e) {
  console.log('nav err', String(e).slice(0, 150))
}
console.log('失败请求', bad.length)
for (const b of bad) console.log('  ', b)
await browser.close()
