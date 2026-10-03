/* 给官网拍真实 App 截图 —— 390×844 @2x，走完引导后逐屏截 */
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:5191'
const OUT = 'website/assets'
fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const clickExact = (page, text) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === t)
    if (!b) return false
    b.click()
    return true
  }, text)

const clickMatch = (page, src) =>
  page.evaluate((s) => {
    const r = new RegExp(s)
    const b = [...document.querySelectorAll('button')].find((x) => r.test((x.textContent ?? '').trim()))
    if (!b) return null
    const t = (b.textContent ?? '').trim()
    b.click()
    return t
  }, src)

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, name) })
  const size = fs.statSync(path.join(OUT, name)).size
  console.log(`  ✔ ${name} (${(size / 1024).toFixed(0)} KB)`)
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
  await sleep(2200)

  /* ---- 走完引导（4 屏）---- */
  let gradePicked = false
  for (let step = 0; step < 14; step++) {
    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll('nav button')].map((b) => (b.textContent ?? '').trim()).filter(Boolean),
    )
    if (tabs.length > 0) break
    const btns = await page.evaluate(() =>
      [...document.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()).filter(Boolean),
    )
    let picked = null
    if (!gradePicked && btns.some((b) => /年级$/.test(b))) {
      picked = await clickMatch(page, '^3 年级$')
      if (picked) gradePicked = true
    }
    if (!picked) {
      picked =
        ((await clickExact(page, '跳过')) && '跳过') ||
        ((await clickExact(page, '继续')) && '继续') ||
        ((await clickExact(page, '种下我的树')) && '种下我的树') ||
        (await clickMatch(page, '篇\\s*/\\s*天'))
    }
    if (!picked) break
    await sleep(900)
  }
  await sleep(800)
  console.log('已进入主界面，开始截图')

  /* ---- 1. 写作台首页 ---- */
  await shot(page, 'shot-home.png')

  /* ---- 2. 选「写人」大类，露出细标签 ---- */
  await clickExact(page, '写人')
  await sleep(700)
  await shot(page, 'shot-category.png')
  await clickExact(page, '写景')
  await sleep(500)

  /* ---- 3. 题库选择器 ---- */
  await clickExact(page, '题库中选择')
  await sleep(1400)
  await clickExact(page, '全部')
  await sleep(1200)
  await shot(page, 'shot-library.png')

  /* ---- 4. 关掉抽屉，先拍其余四个 Tab ----
     注意：选中题目后写作台会进「沉浸模式」、底部导航整个消失，
     所以必须**先拍 Tab、最后再选题**。 */
  const closed = await page.evaluate(() => {
    const b = document.querySelector('[aria-label="关闭"]')
    if (!b) return false
    b.click()
    return true
  })
  console.log('  关掉抽屉:', closed)
  await sleep(900)

  for (const [tab, file] of [
    ['日记本', 'shot-diary.png'],
    ['成长树', 'shot-level.png'],
    ['文心卡', 'shot-cards.png'],
    ['旅行图', 'shot-map.png'],
  ]) {
    const ok = await clickExact(page, tab)
    await sleep(1800)
    console.log(`  切到「${tab}」:`, ok)
    if (tab === '日记本') {
      // 日记本首次进入是「设密码」屏，拍它没意义 → 走「先不设密码，直接看日记」
      const skip = await clickExact(page, '先不设密码，直接看日记')
      console.log('  跳过日记锁:', skip)
      await sleep(1500)
    }
    await shot(page, file)
  }

  /* ---- 5. 回写作台，挑「一起值日」→ 带图的写作台 ---- */
  await clickExact(page, '写作文')
  await sleep(1200)
  await clickExact(page, '题库中选择')
  await sleep(1400)
  await clickExact(page, '全部')
  await sleep(1200)
  const picked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      (x.querySelector('.font-display')?.textContent ?? '').includes('一起值日'),
    )
    if (!b) return false
    b.click()
    return true
  })
  console.log('  挑中「一起值日」:', picked)
  await sleep(2500)
  await shot(page, 'shot-topic.png')

  console.log('pageerror:', errs.slice(0, 3))
} finally {
  await browser.close()
}
