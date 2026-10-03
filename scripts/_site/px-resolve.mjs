/* 解析某个 pexels 照片页的真实 CDN 直链（有些 id 不走 pexels-photo-<id>.jpeg 这条规整路径）
   用法: node scripts/_site/px-resolve.mjs <id> [id...] */
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ids = process.argv.slice(2)
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  for (const id of ids) {
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    await page.setUserAgent(UA)
    try {
      await page.goto(`https://www.pexels.com/photo/${id}/`, { waitUntil: 'domcontentloaded', timeout: 40000 })
      await new Promise((r) => setTimeout(r, 2500))
      const info = await page.evaluate(() => {
        const og = document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? ''
        const title = document.title
        const imgs = [...document.querySelectorAll('img')]
          .map((i) => i.currentSrc || i.src)
          .filter((s) => s && s.includes('images.pexels.com'))
        return { og, title, imgs }
      })
      console.log('ID', id)
      console.log('  title:', info.title.slice(0, 130))
      console.log('  og   :', info.og.slice(0, 220))
      for (const s of info.imgs.slice(0, 4)) console.log('  img  :', s.slice(0, 220))
    } catch (e) {
      console.log('ID', id, 'ERR', String(e).slice(0, 130))
    } finally {
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}
