/* 走完新手引导 → 写作台 →「题库中选择」→ 搜「值日」→ 看真实 <img> 有没有解码出来
   —— 这是 classmate-7 覆盖层照片在**真 App UI** 里的最后一道验证。 */
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:5191'
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const snap = (page) =>
  page.evaluate(() => ({
    buttons: [...document.querySelectorAll('button')]
      .map((b) => b.textContent?.trim() ?? '')
      .filter(Boolean),
    tabs: [...document.querySelectorAll('nav button')]
      .map((b) => b.textContent?.trim() ?? '')
      .filter(Boolean),
    h: (document.querySelector('h1,h2')?.textContent ?? '').trim().slice(0, 40),
  }))

const clickExact = (page, text) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === t)
    if (!b) return false
    b.click()
    return true
  }, text)

const clickMatch = (page, re) =>
  page.evaluate((src) => {
    const r = new RegExp(src)
    const b = [...document.querySelectorAll('button')].find((x) => r.test((x.textContent ?? '').trim()))
    if (!b) return null
    const t = (b.textContent ?? '').trim()
    b.click()
    return t
  }, re.source)

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 430, height: 900 })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
  await sleep(2000)

  /* ---------- 1. 走完新手引导 ----------
     注意：年级屏点一下只是「选中」，不会前进；必须先选年级、再点「继续」。
     所以年级只点一次（gradePicked 标记），之后走正常出口优先级。 */
  let gradePicked = false
  let lastSig = ''
  let stuck = 0
  for (let step = 0; step < 16; step++) {
    const s = await snap(page)
    const sig = s.h + '|' + s.buttons.join(',')
    console.log(`#${step} 标题=${JSON.stringify(s.h)} tabs=${JSON.stringify(s.tabs)}`)
    console.log(`    全部按钮=${JSON.stringify(s.buttons)}`)
    if (s.tabs.length > 0) { console.log('→ 已进入主界面'); break }
    if (sig === lastSig) {
      stuck++
      if (stuck > 2) { console.log('⚠️ 卡住，放弃'); break }
    } else stuck = 0
    lastSig = sig

    let picked = null
    if (!gradePicked && s.buttons.some((b) => /年级$/.test(b))) {
      picked = await clickMatch(page, /^3 年级$/)
      if (picked) gradePicked = true
    }
    if (!picked) {
      picked =
        (await clickExact(page, '跳过') ? '跳过' : null) ??
        (await clickExact(page, '继续') ? '继续' : null) ??
        (await clickExact(page, '种下我的树') ? '种下我的树' : null) ??
        (await clickMatch(page, /篇\s*\/\s*天/))
    }
    console.log('   点了:', picked)
    if (!picked) break
    await sleep(1000)
  }

  /* ---------- 2. 写作台 → 题库中选择 ---------- */
  const entered = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes('题库中选择'))
    if (!b) return false
    b.click()
    return true
  })
  console.log('找到「题库中选择」:', entered)
  await sleep(1500)

  /* ---------- 3. 数一下选择器里的题 ---------- */
  // 选择器初始会带上写作台当前的大类（只剩 67 行）→ 先点「全部」清掉，才是全量
  const resetCat = await clickExact(page, '全部')
  console.log('点了「全部」清掉大类筛选:', resetCat)
  await sleep(1200)

  const total = await page.evaluate(
    () => [...document.querySelectorAll('button')].filter((b) => b.querySelector('.font-display')).length,
  )
  console.log('选择器里渲染出的题目行数:', total)

  /* ---------- 4. 搜「值日」，看真实图片 ---------- */
  const typed = await page.evaluate(() => {
    const inp = document.querySelector('input[placeholder*="搜题目"]')
    if (!inp) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, '值日')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })
  console.log('往搜索框输入「值日」:', typed)
  await sleep(1200)

  const after = await page.evaluate(
    () => [...document.querySelectorAll('button')].filter((b) => b.querySelector('.font-display')).length,
  )
  console.log('搜索后行数:', after)

  let row = null
  for (let i = 0; i < 12; i++) {
    row = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        (x.querySelector('.font-display')?.textContent ?? '').includes('一起值日'),
      )
      if (!b) return { found: false }
      const img = b.querySelector('img')
      return {
        found: true,
        title: b.querySelector('.font-display')?.textContent?.trim(),
        lead: b.querySelectorAll('span')[1]?.textContent?.trim()?.slice(0, 30),
        src: img?.getAttribute('src') ?? null,
        naturalWidth: img?.naturalWidth ?? 0,
        naturalHeight: img?.naturalHeight ?? 0,
        complete: img?.complete ?? false,
      }
    })
    if (row.found && row.naturalWidth > 0) break
    await sleep(800)
  }
  if (!row.found) {
    const sample = await page.evaluate(() =>
      [...document.querySelectorAll('.font-display')].slice(0, 6).map((s) => s.textContent?.trim()),
    )
    console.log('没找到，当前前 6 行:', JSON.stringify(sample))
  }
  console.log('一起值日 →', JSON.stringify(row, null, 2))

  await page.screenshot({ path: '_app-picker.png' })
  console.log('pageerror:', errs.slice(0, 3))
} finally {
  await browser.close()
}
