/* 从 Pexels 搜索结果里抠照片编号 —— 供人工挑图。
   ★ 第一步就加 ?orientation=landscape（默认结果约七成是竖图）
   ★★ 每条 query 用**独立的浏览器上下文**（Pexels 同一会话连搜会被限流 → 第 2 条起全 0 条）
   用法: node scripts/_site/px-search.mjs out.json "<query>" [更多query...]  */
import puppeteer from 'puppeteer-core'
import { writeFileSync } from 'node:fs'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const [outFile, ...queries] = process.argv.slice(2)
if (!outFile || !queries.length) {
  console.error('usage: node px-search.mjs out.json "q1" "q2" ...')
  process.exit(1)
}
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const results = []
try {
  for (const q of queries) {
    const url = `https://www.pexels.com/search/${encodeURIComponent(q)}/?orientation=landscape`
    const out = { query: q, photos: [] }
    for (let attempt = 0; attempt < 3 && out.photos.length === 0; attempt += 1) {
      const ctx = await browser.createBrowserContext()
      try {
        const page = await ctx.newPage()
        await page.setViewport({ width: 1400, height: 1000 })
        await page.setUserAgent(UA)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
        await new Promise((r) => setTimeout(r, 3000 + attempt * 2500))
        out.photos = await page.evaluate(() => {
          const seen = new Map()
          for (const a of document.querySelectorAll('a[href*="/photo/"]')) {
            const m = a.getAttribute('href')?.match(/\/photo\/[^/]*?-(\d+)\/?$/)
            if (!m) continue
            const id = m[1]
            const img = a.querySelector('img')
            const alt = (img?.getAttribute('alt') ?? '')
              .replace(/^Free\s*/, '')
              .replace(/\s*Stock Photo$/, '')
              .trim()
            if (!seen.has(id)) seen.set(id, { id, alt, href: a.getAttribute('href') })
            else if (alt && !seen.get(id).alt) seen.get(id).alt = alt
          }
          return [...seen.values()]
        })
      } catch (e) {
        out.error = String(e).slice(0, 200)
      } finally {
        await ctx.close()
      }
    }
    results.push(out)
    console.error(`  ${String(out.photos.length).padStart(3)}  ${q}`)
    writeFileSync(outFile, JSON.stringify(results, null, 1) + '\n')
    await new Promise((r) => setTimeout(r, 1200))
  }
} finally {
  await browser.close()
}
console.error('wrote', outFile, results.length, 'queries')
