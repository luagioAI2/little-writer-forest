/* 真 App UI 验证：走完新手引导 → 写作台 →「题库中选择」→ 搜新增题 → 看 <img> 真的解码了。
   用法: E2E_URL=http://127.0.0.1:5191 node scripts/_site/app-probe.mjs  */
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:5191'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const snap = (page) =>
  page.evaluate(() => ({
    buttons: [...document.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '').filter(Boolean),
    tabs: [...document.querySelectorAll('nav button')].map((b) => b.textContent?.trim() ?? '').filter(Boolean),
    h: (document.querySelector('h1,h2')?.textContent ?? '').trim().slice(0, 40),
  }))
const clickExact = (page, t) =>
  page.evaluate((x) => {
    const b = [...document.querySelectorAll('button')].find((n) => (n.textContent ?? '').trim() === x)
    if (!b) return false
    b.click(); return true
  }, t)
const clickMatch = (page, src) =>
  page.evaluate((s) => {
    const r = new RegExp(s)
    const b = [...document.querySelectorAll('button')].find((n) => r.test((n.textContent ?? '').trim()))
    if (!b) return null
    const t = (b.textContent ?? '').trim(); b.click(); return t
  }, src)
const typeSearch = (page, text) =>
  page.evaluate((v) => {
    const inp = document.querySelector('input[placeholder*="搜题目"]')
    if (!inp) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, v)
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }, text)
const probeRow = (page, title) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      (x.querySelector('.font-display')?.textContent ?? '').trim() === t,
    )
    if (!b) return { found: false }
    const img = b.querySelector('img')
    return {
      found: true,
      src: (img?.getAttribute('src') ?? '').slice(-46),
      naturalWidth: img?.naturalWidth ?? 0,
      naturalHeight: img?.naturalHeight ?? 0,
      complete: img?.complete ?? false,
    }
  }, title)

const TARGETS = ['那一刻，我长大了', '老手艺人', '陌生人的善意', '一碗面的温度', '一本好书推荐给你', '给自己点赞', '身边的变化', '我看网红现象', '传统与现代', '书中那句话']

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 430, height: 900 })
  const errs = []
  const notFound = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()) })
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
  await sleep(2000)

  let gradePicked = false, lastSig = '', stuck = 0
  for (let step = 0; step < 16; step++) {
    const s = await snap(page)
    const sig = s.h + '|' + s.buttons.join(',')
    if (s.tabs.length > 0) { console.log('→ 已进入主界面 tabs=', JSON.stringify(s.tabs)); break }
    if (sig === lastSig) { stuck++; if (stuck > 2) { console.log('⚠️ 卡住'); break } } else stuck = 0
    lastSig = sig
    let picked = null
    if (!gradePicked && s.buttons.some((b) => /年级$/.test(b))) {
      picked = await clickMatch(page, '^初一$')
      if (picked) gradePicked = true
    }
    if (!picked) {
      picked = (await clickExact(page, '跳过') ? '跳过' : null) ?? (await clickExact(page, '继续') ? '继续' : null) ??
        (await clickExact(page, '种下我的树') ? '种下我的树' : null) ?? (await clickMatch(page, '篇\\s*/\\s*天'))
    }
    if (!picked) break
    await sleep(900)
  }

  const entered = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes('题库中选择'))
    if (!b) return false
    b.click(); return true
  })
  console.log('找到「题库中选择」:', entered)
  await sleep(1500)
  console.log('点「全部」清掉大类筛选:', await clickExact(page, '全部'))
  await sleep(1200)

  const total = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.querySelector('.font-display')).length)
  console.log('选择器渲染出的题目行数（初一）:', total)

  for (const t of TARGETS) {
    await typeSearch(page, t)
    await sleep(1400)
    let row = { found: false }
    for (let i = 0; i < 8; i++) {
      row = await probeRow(page, t)
      if (row.found && row.naturalWidth > 0) break
      await sleep(700)
    }
    console.log(`  ${t} →`, JSON.stringify(row))
  }
  await page.screenshot({ path: '_exam-app-picker.png' })
  console.log('pageerror:', errs.slice(0, 3))
  console.log('404 资源:', [...new Set(notFound)].slice(0, 6))
} finally {
  await browser.close()
}
