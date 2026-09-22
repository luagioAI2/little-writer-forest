/* ============================================================
   验证旅行系统 v6 —— 小鸟随便飞 + 阅后即毁
   ------------------------------------------------------------
   真的打开页面、点地图、派鸟、收鸟、开背包，
   确认纪念品显示正常，地图区分到过/没到过。
   ============================================================ */

import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const URL = process.env.E2E_URL ?? 'http://localhost:5190/'
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SHOT_DIR = process.env.SHOT_DIR ?? '.'

mkdirSync(SHOT_DIR, { recursive: true })

let pass = 0
let fail = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    pass += 1
    console.log(`  ✅ ${name}`)
  } else {
    fail += 1
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function waitForText(page, text, timeout = 12000) {
  try {
    await page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      { timeout, polling: 250 },
      text,
    )
    return true
  } catch {
    return false
  }
}

async function clickByText(page, text, { exact = false } = {}) {
  return page.evaluate(
    (txt, ex) => {
      const el = [...document.querySelectorAll('button, a, [role="button"]')].find((b) => {
        const t = (b.innerText || b.textContent || '').trim()
        return ex ? t === txt : t.includes(txt)
      })
      if (el) { el.click(); return true }
      return false
    },
    text,
    exact,
  )
}

async function fastForwardBirds(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('little-writer-forest')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('meta', 'readwrite')
          const store = tx.objectStore('meta')
          const g = store.get('birds')
          g.onerror = () => reject(g.error)
          g.onsuccess = () => {
            const rec = g.result
            if (!rec) {
              resolve({ n: 0, dests: [] })
              return
            }
            const birds = rec.value
            let n = 0
            for (const b of birds) {
              if (b.status === 'away') {
                b.returnsAt = Date.now() - 1000
                n += 1
              }
            }
            store.put({ key: 'birds', value: birds })
            resolve({
              n,
              dests: birds.map((b) => `${b.species}:${b.status}:${b.destinationId ?? '-'}`),
            })
          }
        }
      }),
  )
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=414,896'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 414, height: 896, deviceScaleFactor: 2, isMobile: true })

  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`))

  console.log(`\n🌐 ${URL}\n`)

  /* ---------- 0. 进场 ---------- */
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 3300))

  const seenOnboarding = await page.evaluate(() =>
    /种下我的树|我该怎么叫你/.test(document.body.innerText),
  )
  if (seenOnboarding) {
    await clickByText(page, '继续')
    await new Promise((r) => setTimeout(r, 600))
    await clickByText(page, '继续')
    await new Promise((r) => setTimeout(r, 600))
    await clickByText(page, '种下我的树')
    await new Promise((r) => setTimeout(r, 1400))
  }
  check('进入主界面', await waitForText(page, '写作文', 8000))

  /* ---------- 1. 在地图上点八达岭长城 ---------- */
  console.log('\n【1】地图上选目的地')
  await clickByText(page, '旅行图')
  await new Promise((r) => setTimeout(r, 1200))

  const mapState = await page.evaluate(() => ({
    landmarks: document.querySelectorAll('svg g.cursor-pointer').length,
    hasBird: /树上?有\s*\d+\s*只小鸟/.test(document.body.innerText.replace(/\s+/g, '')),
  }))
  check('地图上画出了全部地标', mapState.landmarks > 30, `实际 ${mapState.landmarks}`)

  // LANDMARKS 顺序：天安门(0) 故宫(1) 八达岭(2)
  const opened = await page.evaluate(() => {
    const gs = [...document.querySelectorAll('svg g.cursor-pointer')]
    if (gs.length < 3) return false
    gs[2].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  })
  check('点得中地图上的地标', opened)
  await new Promise((r) => setTimeout(r, 900))

  const sheet = await page.evaluate(() => document.body.innerText)
  check('抽屉打开的是八达岭长城', sheet.includes('八达岭长城'))

  // v6：没派过鸟的抽屉不显示照片了，显示的是 LandmarkSheet 的内容
  check('抽屉里有派鸟按钮', sheet.includes('派一只小鸟去这里'))
  await page.screenshot({ path: `${SHOT_DIR}/01-landmark.png` })

  const sent = await clickByText(page, '派一只小鸟去这里')
  check('可以派鸟出发', sent)
  await new Promise((r) => setTimeout(r, 1400))

  /* ---------- 2. 确认鸟真的在飞 ---------- */
  console.log('\n【2】小鸟真的在飞')
  const away = await page.evaluate(() => {
    const txt = document.body.innerText
    return {
      awayLine: /只小鸟正在路上/.test(txt),
      destLine: /八达岭长城|中国长城/.test(txt),
    }
  })
  check('页面上显示有鸟在路上', away.awayLine)
  check('显示的目的地', away.destLine)

  /* ---------- 3. 把返程时间拨到过去，收鸟 ---------- */
  console.log('\n【3】收鸟')
  const ff = await fastForwardBirds(page)
  check('库里有一只在外飞的鸟', ff.n > 0, ff.dests.join(' | '))

  await page.goto(URL, { waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 3300))
  await waitForText(page, '写作文', 8000)

  await clickByText(page, '旅行图')
  await new Promise((r) => setTimeout(r, 1000))
  await clickByText(page, '小鸟')
  await new Promise((r) => setTimeout(r, 900))

  const collectible = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => (b.innerText || '').trim().includes('收鸟')),
  )
  check('归巢后出现「收鸟」按钮', collectible)

  const collected = await clickByText(page, '收鸟')
  check('可以收鸟', collected)
  await new Promise((r) => setTimeout(r, 1800))

  const toast = await page.evaluate(() => document.body.innerText)
  check('收鸟提示里说到纪念品', /带回了|长城之秋|西湖晨雾|笑话|格言|故事|音乐|视频/.test(toast))
  await page.screenshot({ path: `${SHOT_DIR}/02-collect.png` })

  /* ---------- 4. 背包里看纪念品 ---------- */
  console.log('\n【4】背包')
  await clickByText(page, '相册')
  await new Promise((r) => setTimeout(r, 1500))

  const backpack = await page.evaluate(() => {
    const txt = document.body.innerText
    return {
      hasContent: /长城|西湖|故宫|黄山/.test(txt),
      hasTypeBadge: /照片|音乐|视频|笑话|格言|故事/.test(txt),
      hasCountdown: /小时后消失|分钟后消失|已过期/.test(txt),
      hasKeepButton: /金币永久保留|金币不够/.test(txt),
    }
  })
  check('背包显示地名', backpack.hasContent)
  check('背包显示类型标签', backpack.hasTypeBadge)
  check('背包显示倒计时', backpack.hasCountdown)
  check('背包有保留/金币不够按钮', backpack.hasKeepButton)

  // 检查是否有媒体元素（照片/音乐/视频）或文本内容（笑话/格言/故事）
  await page.evaluate(() => window.scrollTo(0, 500))
  await new Promise((r) => setTimeout(r, 2000))
  const media = await page.evaluate(() => ({
    hasImg: Boolean(document.querySelector('img[src*="unsplash"], img[src*="images"]')),
    hasAudio: Boolean(document.querySelector('audio')),
    hasVideo: Boolean(document.querySelector('video')),
    hasText: Boolean(document.querySelector('.font-prose')),
  }))
  check(
    '背包有媒体或文本内容',
    media.hasImg || media.hasAudio || media.hasVideo || media.hasText,
    JSON.stringify(media),
  )

  await page.screenshot({ path: `${SHOT_DIR}/03-backpack.png`, fullPage: true })

  /* ---------- 5. 地图上的标记 ---------- */
  console.log('\n【5】地图标记')
  await clickByText(page, '地图')
  await new Promise((r) => setTimeout(r, 1200))

  const legend = await page.evaluate(() => document.body.innerText)
  check('图例里有「到过的地方」', legend.includes('到过的地方'))

  // 到过的地标应该有金环（stroke=#d4a648）
  const ring = await page.evaluate(() => {
    const svg = document.querySelector('svg[role="img"]')
    if (!svg) return 0
    return [...svg.querySelectorAll('circle')].filter(
      (c) => c.getAttribute('stroke') === '#d4a648' && c.getAttribute('fill') === 'none',
    ).length
  })
  check('到过的地标画出了金环', ring > 0, `金环数 ${ring}`)

  // 检查有灰色圆点（没到过的地方）
  const greyDots = await page.evaluate(() => {
    const svg = document.querySelector('svg[role="img"]')
    if (!svg) return 0
    return [...svg.querySelectorAll('circle')].filter(
      (c) => c.getAttribute('fill') === '#9ca3af',
    ).length
  })
  check('没到过的地方显示灰色圆点', greyDots > 0, `灰点数 ${greyDots}`)

  await page.screenshot({ path: `${SHOT_DIR}/04-map-markers.png` })

  /* ---------- 6. 设置里的距离基准点 ---------- */
  console.log('\n【6】设置里的距离基准点')
  await clickByText(page, '写作文')
  await new Promise((r) => setTimeout(r, 800))
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')]
      .find((x) => x.getAttribute('aria-label') === '设置')
      ?.click()
  })
  await waitForText(page, '距离基准点', 8000)

  const homeInfo = await page.evaluate(() => {
    const txt = document.body.innerText
    return {
      hasSection: txt.includes('距离基准点'),
      shenzhen: txt.includes('深圳'),
      isDefault: txt.includes('默认'),
      explains: txt.includes('没设过位置'),
    }
  })
  check('设置里有「距离基准点」', homeInfo.hasSection)
  check('基准点显示为深圳', homeInfo.shenzhen)
  check('标明这是默认值', homeInfo.isDefault)
  check('说明了「没设过位置就用它」', homeInfo.explains)
  await page.screenshot({ path: `${SHOT_DIR}/05-home-point.png`, fullPage: true })

  /* ---------- 7. 控制台报错检查 ---------- */
  const realErrors = consoleErrors.filter((e) => !/Failed to load resource|net::ERR_FAILED/.test(e))
  console.log(`\n控制台错误：${consoleErrors.length}（其中算数的 ${realErrors.length}）`)
  if (realErrors.length) realErrors.slice(0, 5).forEach((e) => console.log(`  ⚠️ ${e}`))
  check('没有控制台报错', realErrors.length === 0, realErrors.slice(0, 3).join(' / '))

  await browser.close()

  console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
  if (failures.length) {
    console.log('失败项：')
    failures.forEach((f) => console.log(`  - ${f}`))
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('脚本崩了：', e)
  process.exit(1)
})
