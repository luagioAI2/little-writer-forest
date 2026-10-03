/* 界面走查：搜"台灯"→ 截图；再搜"值日"看留空的那张长什么样 */
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })
  await page.goto('http://localhost:5190/library-browse.html', { waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 1000))

  for (const [q, file] of [['台灯', '_lib2-ui-1.png'], ['值日', '_lib2-ui-2.png']]) {
    await page.evaluate((v) => {
      const el = document.getElementById('q')
      el.value = v
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, q)
    await new Promise((r) => setTimeout(r, 4000))
    await page.screenshot({ path: file, fullPage: false })
    const n = await page.evaluate(() => document.querySelectorAll('.item').length)
    console.log(`${file}  搜「${q}」→ ${n} 张卡片`)
  }
} finally {
  await browser.close()
}
