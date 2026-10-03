/* 逐屏走完新手引导，每屏打印按钮文案，直到出现题库 */
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

  const snap = () =>
    page.evaluate(() => ({
      buttons: [...document.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter(Boolean),
      tabs: [...document.querySelectorAll('nav button')].map((b) => b.textContent?.trim()).filter(Boolean),
      h: (document.querySelector('h1,h2')?.textContent ?? '').trim().slice(0, 40),
    }))

  for (let step = 0; step < 12; step++) {
    const s = await snap()
    console.log(`#${step} 标题=${JSON.stringify(s.h)} tabs=${JSON.stringify(s.tabs)} 按钮=${JSON.stringify(s.buttons.slice(0, 8))}`)
    if (s.tabs.length > 0) { console.log('→ 已进入主界面'); break }
    // 优先点「跳过」，否则点「继续」
    const picked = await page.evaluate(() => {
      const bs = [...document.querySelectorAll('button')]
      const pick = (l) => bs.find((b) => b.textContent?.trim() === l)
      const b = pick('跳过') ?? pick('继续')
      if (b) { b.click(); return b.textContent.trim() }
      return null
    })
    if (!picked) {
      // 可能是「你上几年级？」那种需要选一个的屏
      const opt = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /年级/.test(x.textContent ?? ''))
        if (b) { b.click(); return b.textContent.trim() }
        return null
      })
      console.log('   没有跳过/继续，试年级按钮:', opt)
      if (!opt) break
    } else {
      console.log('   点了:', picked)
    }
    await sleep(900)
  }
  await page.screenshot({ path: '_app-walk.png' })
  console.log('pageerror:', errs.slice(0, 3))
} finally {
  await browser.close()
}
