/*
 * 界面走查：地图上的「飞行路线」虚线到底长什么样。
 *
 * 为什么单独跑一遍（而不是只看 `_probe-map-bird.mjs`）：
 *   那只麻雀第一趟落在**观澜湖，22 公里**，投影到画布上只有 **3px** ——
 *   路线确实画出来了、样式也对，但**看不出来**。
 *   （"每只鸟第一趟都落在最近那一档"是已知的选点特性，不是这里的 bug。）
 *
 * ➜ 这里预置三只已经在飞的鸟，落点分别是 805 / 1398 / 4063 公里，
 *   在画布上是 108 / 206 / 502 px —— 才能看出虚线的形状、拱度和走马灯。
 *   ⚠️ 落点由脚本直接钉死（不是 `chooseDestination` 挑的）——
 *      这是**视觉夹具**，不是真实可达状态；鸟的种类只用来区分三条线。
 *
 * 用法：先起 dev server，然后 `node scripts/_probe-map-route.mjs`
 */
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.env.E2E_URL || 'http://localhost:5192/'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** 三趟距离差得很开的飞行（id 来自真实地标库，见 memory 2026-10-03） */
const TRIPS = [
  { species: 'dove', nickname: '鸽子', destinationId: 'cn-贵州-梵净山旅游区' }, // 805km / 108px
  { species: 'magpie', nickname: '喜鹊', destinationId: 'cn-陕西-大明宫旅游景区' }, // 1398km / 206px
  { species: 'bluebird', nickname: '蓝鸟', destinationId: 'cn-新疆-帕米尔旅游区' }, // 4063km / 502px
]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
})

const problems = []

/** 在一个视口宽度下：预置状态 → 进地图 → 量路线 → 截图 */
async function shoot(width, height, shot) {
  const page = await browser.newPage()
  await page.setViewport({ width, height })
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[${width}] console.error: ${m.text().slice(0, 300)}`)
  })
  page.on('pageerror', (e) => problems.push(`[${width}] pageerror: ${String(e).slice(0, 300)}`))

  await page.goto(URL, { waitUntil: 'networkidle2' })
  await wait(3500) // 等 db 建好

  await page.evaluate(async (trips) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('little-writer-forest')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    if (!db.objectStoreNames.contains('meta')) throw new Error('meta 表不存在 —— 应用还没 boot 完')
    const tx = db.transaction('meta', 'readwrite')
    const st = tx.objectStore('meta')
    const now = Date.now()
    st.put({
      key: 'settings',
      value: {
        onboarded: true,
        guideDone: true,
        nickname: '小笔苗',
        grade: 3,
        homePoint: { name: '深圳', lng: 114.0579, lat: 22.5431, source: 'manual' },
      },
    })
    st.put({
      key: 'birds',
      value: trips.map((t, i) => ({
        species: t.species,
        nickname: t.nickname,
        status: 'away',
        destinationId: t.destinationId,
        departedAt: now - 60_000,
        returnsAt: now + 3_600_000 * (i + 1),
        trips: 1,
        photos: 0,
        bond: 20,
        adoptedAt: now - 86_400_000,
        hasLetter: false,
      })),
    })
    st.put({ key: 'wallet', value: { coins: 500, totalEarned: 500 } })
    await new Promise((res) => {
      tx.oncomplete = res
    })
    db.close()
  }, TRIPS)

  await page.reload({ waitUntil: 'networkidle2' })
  await wait(3000)

  const click = (text, scope = 'button', exact = false) =>
    page.evaluate(
      (t, sc, ex) => {
        const b = [...document.querySelectorAll(sc)].find((x) => {
          const s = (x.textContent || '').trim()
          return ex ? s === t : s.includes(t)
        })
        if (!b) return false
        b.click()
        return true
      },
      text,
      scope,
      exact,
    )

  const wentMap = await click('旅行图', 'nav button')
  await wait(1200)
  // 旅行图里默认就是「地图」子页，但显式点一次，免得默认值将来变了
  const wentTab = await click('地图', 'button', true)
  await wait(1800)

  const measured = await page.evaluate(() => {
    const routes = [...document.querySelectorAll('path.anim-dash-route')].map((p) => {
      const cs = getComputedStyle(p)
      let bbox
      try {
        const b = p.getBBox()
        bbox = { w: Math.round(b.width), h: Math.round(b.height) }
      } catch {
        bbox = null
      }
      return {
        d: p.getAttribute('d') || '',
        strokeDasharray: cs.strokeDasharray,
        animationName: cs.animationName,
        animationDuration: cs.animationDuration,
        strokeWidth: cs.strokeWidth,
        stroke: cs.stroke,
        bbox,
      }
    })
    return {
      mapLabel: document.querySelector('svg[role="img"]')?.getAttribute('aria-label') ?? null,
      svgWidthCss: document.querySelector('svg[role="img"]')?.getBoundingClientRect().width ?? null,
      routes,
      birdTriangles: document.querySelectorAll('.anim-dangle').length,
      body: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 500),
    }
  })

  await page.screenshot({ path: shot, fullPage: false }).catch(() => {})
  await page.close()
  return { wentMap, wentTab, ...measured }
}

const mobile = await shoot(480, 1180, 'shots-route-mobile.png')
const tablet = await shoot(900, 1300, 'shots-route-wide.png')

console.log(JSON.stringify({ url: URL, mobile, tablet, problems }, null, 1))

await browser.close()
