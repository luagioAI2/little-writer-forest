/* ============================================================
   平板体检 —— 量，不要看
   ============================================================

   为什么要量：肉眼看截图，「内容列只占 31%」看起来只是「有点空」，
   「横向溢出 6px」看起来只是「右边少了一点」。量出来才是确定的数字。

   量五项（判据见 skill）：
     1. 内容列宽 + 占视口比例   —— 手机 ≈100%；平板 <60% 就是在浪费
     2. 横向溢出                —— 必须为 0
     3. 底栏高度占视口比例      —— 横屏时会明显变大
     4. 最小点击区              —— <44 不达标（宽而扁的行除外）
     5. 顶栏 / 外壳宽度         —— 看是不是「中间悬着一条横条」

   用法：
     npm run dev &
     node scripts/_probe-tablet.mjs
     # 换地址：E2E_URL=http://localhost:4190/ node scripts/_probe-tablet.mjs
   ============================================================ */

import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const URL = process.env.E2E_URL ?? 'http://localhost:5192/'
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SHOT_DIR = process.env.SHOT_DIR ?? 'shots-tablet'

/* 竖屏 + 横屏 + 两代尺寸。★ 横屏是最容易漏的一档。
   ⚠️ 手机两档是**对照组**：平板适配必须做到「手机观感一个像素都不变」。 */
const VIEWPORTS = [
  [390, 844, '手机 390'],
  [414, 896, '手机 414'],
  [768, 1024, '平板竖 768'],
  [1024, 768, '平板横 1024'],
  [834, 1194, 'iPad Air 竖'],
  [1024, 1366, 'iPad Pro 竖'],
  [1366, 1024, 'iPad Pro 横'],
  [800, 1280, '安卓平板竖'],
  [1280, 800, '安卓平板横'],
]

const TABS = ['写作文', '日记本', '成长树', '文心卡', '旅行图']

/* 只量某一个宽度，用来做快速 A/B（例如验证「手机档零变化」）：
     E2E_ONLY=390 node scripts/_probe-tablet.mjs */
const ONLY = process.env.E2E_ONLY
const VPS = ONLY ? VIEWPORTS.filter(([w]) => String(w) === ONLY) : VIEWPORTS

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync(SHOT_DIR, { recursive: true })

async function clickByText(page, text) {
  return page.evaluate((t) => {
    const els = [...document.querySelectorAll('button, a, [role="button"]')]
    const el = els.find((x) => (x.innerText || x.textContent || '').trim().includes(t))
    if (!el) return false
    el.click()
    return true
  }, text)
}

/** 走完入场 + 引导，直到主界面（有 nav）出现 */
async function passOnboarding(page) {
  for (let i = 0; i < 10; i++) {
    const ready = await page.evaluate(() => !!document.querySelector('nav'))
    if (ready) return true
    for (const t of ['继续', '种下我的树', '跳过']) {
      if (await clickByText(page, t)) break
    }
    await sleep(600)
  }
  return await page.evaluate(() => !!document.querySelector('nav'))
}

/** 页面里量一次 */
function measure() {
  const de = document.documentElement
  const vw = window.innerWidth
  const vh = window.innerHeight
  const root = document.getElementById('root')
  const appRoot = root?.firstElementChild ?? null
  const nav = document.querySelector('nav')
  const header = document.querySelector('header')
  const main = document.querySelector('main')

  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  }

  /* 内容列：main 里最宽的那个有高度的块。
     ⚠️ 不重算 app 的宽度公式 —— 要量的是**观察到的几何**。 */
  let widest = null
  if (main) {
    for (const el of main.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.height < 8) continue
      if (!widest || r.width > widest.w) {
        widest = { w: Math.round(r.width), cls: String(el.className || '').slice(0, 64) }
      }
    }
  }

  /* 点击区。★ 宽而扁的行（如 143×17 的文字链接）其实没问题 —— 用 min() 会把它们
     误报成「太小」。所以分开统计：
       · tiny：宽和高**都** < 44 → 真的不好点
       · flat：只有一边 < 44   → 多半是整行文字链接，热区其实很大 */
  const tiny = []
  const flat = []
  for (const el of document.querySelectorAll('button, a, [role="button"]')) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const info = `${Math.round(r.width)}x${Math.round(r.height)} ${el.tagName}`
    if (r.width < 44 && r.height < 44) tiny.push(info)
    else if (r.width < 44 || r.height < 44) flat.push(info)
  }

  /* 溢出时把越界的元素点出来 —— 光知道「溢出 8px」没用，得知道是谁 */
  const overflow = de.scrollWidth - de.clientWidth
  let offenders = []
  if (overflow > 0) {
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width < 1) continue
      if (r.right > vw + 1 || r.left < -1) {
        offenders.push(
          `${el.tagName}.${String(el.className || '').slice(0, 46)} [${Math.round(r.left)}..${Math.round(r.right)}]`,
        )
      }
    }
    offenders = offenders.slice(0, 5)
  }

  return {
    vw,
    vh,
    overflow,
    offenders,
    appRoot: box(appRoot),
    main: box(main),
    nav: box(nav),
    header: box(header),
    widest,
    tiny,
    flat,
  }
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`))

  await page.setViewport({ width: 414, height: 896, deviceScaleFactor: 1, isMobile: true })
  console.log(`\n🌐 打开 ${URL}\n`)
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })
  await sleep(3600)
  const ok = await passOnboarding(page)
  console.log(ok ? '✅ 已进入主界面\n' : '⚠️ 没能进入主界面（下面数字可能不准）\n')

  const rows = []
  for (const [w, h, label] of VPS) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: false })
    await sleep(700)
    for (const tab of TABS) {
      await clickByText(page, tab)
      await sleep(450)
      const m = await page.evaluate(measure)
      rows.push({ label, vp: `${w}×${h}`, tab, ...m })
      // 每个 tab 都截一张：走查要看的是「卡片有没有被拉长 / 格子有没有被吹大」
      await page.screenshot({ path: `${SHOT_DIR}/${w}x${h}-${tab}.png` })
    }
  }

  /* ---------------- 打表 ---------------- */
  console.log('视口            页面     外壳宽 占比   内容列 占比   溢出  底栏  占比  小控件')
  console.log('─'.repeat(96))
  for (const r of rows) {
    const appW = r.appRoot?.w ?? 0
    const cw = r.widest?.w ?? 0
    const navH = r.nav?.h ?? 0
    console.log(
      `${r.vp.padEnd(11)} ${r.tab.padEnd(7)} ${String(appW).padStart(5)} ${String(pct(appW, r.vw)).padStart(4)}% ` +
        `${String(cw).padStart(6)} ${String(pct(cw, r.vw)).padStart(4)}% ` +
        `${String(r.overflow).padStart(5)} ${String(navH).padStart(5)} ${String(pct(navH, r.vh)).padStart(4)}% ` +
        `${String(r.tiny.length).padStart(6)}  ${r.tiny.slice(0, 2).join(', ')}`,
    )
  }

  /* ---------------- 汇总判据 ---------------- */
  const bad = {
    溢出: rows.filter((r) => r.overflow > 0),
    窄列: rows.filter((r) => r.widest && pct(r.widest.w, r.vw) < 60),
  }
  const tinySet = [...new Set(rows.flatMap((r) => r.tiny))]
  console.log('\n─── 判据 ───')
  console.log(`横向溢出 >0        : ${bad.溢出.length} 处${bad.溢出.length ? ' ← ' + bad.溢出.map((r) => r.vp + '/' + r.tab).join(', ') : ' ✅'}`)
  for (const r of bad.溢出) {
    console.log(`   ↳ ${r.vp} / ${r.tab} 溢出 ${r.overflow}px，越界元素：`)
    for (const o of r.offenders) console.log(`        ${o}`)
  }
  console.log(`内容列占比 <60%    : ${bad.窄列.length} 处${bad.窄列.length ? ' ← ' + [...new Set(bad.窄列.map((r) => r.vp))].join(', ') : ' ✅'}`)
  console.log(`真·小控件(两边<44)  : ${tinySet.length} 种${tinySet.length ? ' ← ' + tinySet.slice(0, 12).join(', ') : ' ✅'}`)
  console.log(`页面报错           : ${errors.length} 条${errors.length ? ' ← ' + errors.slice(0, 5).join(' | ') : ' ✅'}`)

  const widestCls = [...new Set(rows.map((r) => r.widest?.cls).filter(Boolean))]
  console.log('\n内容列候选类名（各视口取最宽块）：')
  for (const c of widestCls.slice(0, 10)) console.log('  · ' + c)

  console.log(`\n📸 截图 → ${SHOT_DIR}/\n`)
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
