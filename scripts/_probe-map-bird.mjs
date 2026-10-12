/*
 * 界面走查：旅行图页「让它自己去一个没去过的地方」这条路真的通吗。
 *
 * 为什么需要它：单测覆盖的是 domain 和 store 两层。
 * 这次改的 `MapPage.tsx`（sendTo 变成可选参数、不再自己选点）
 * 正好落在两层的缝里 —— 类型检查看不出"点了没反应"。
 *
 * 用法：先起 dev server，然后 `node scripts/_probe-map-bird.mjs`
 */
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.env.E2E_URL || 'http://localhost:5192/'
const SHOT = process.env.SHOT_DIR || 'shots-map-bird'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.setViewport({ width: 420, height: 960 })

const problems = []
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 300)}`)
})
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 300)}`))

await page.goto(URL, { waitUntil: 'networkidle2' })
await wait(3500) // 等 db 建好

// ---- 预置状态：跳过引导 + 家里有一只麻雀 + 出发地深圳 ----
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('little-writer-forest')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  if (!db.objectStoreNames.contains('meta')) throw new Error('meta 表不存在 —— 应用还没 boot 完')
  const tx = db.transaction('meta', 'readwrite')
  const st = tx.objectStore('meta')
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
    value: [
      {
        species: 'sparrow',
        nickname: '麻雀',
        status: 'home',
        trips: 0,
        photos: 0,
        bond: 0,
        adoptedAt: Date.now(),
        hasLetter: false,
      },
    ],
  })
  st.put({ key: 'wallet', value: { coins: 500, totalEarned: 500 } })
  await new Promise((res) => {
    tx.oncomplete = res
  })
  db.close()
})

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

const state0 = await page.evaluate(() => ({
  nav: [...document.querySelectorAll('nav button')].map((b) => (b.textContent || '').trim()),
  body: document.body.innerText.slice(0, 160).replace(/\n+/g, ' | '),
}))

const wentMap = await click('旅行图', 'nav button')
await wait(1200)
// 旅行图里有「地图 / 小鸟 / 相册」三个子页 —— 出发按钮在「小鸟」那页
const wentBirds = await click('小鸟', 'button', true)
await wait(1200)

const onMap = await page.evaluate(() => ({
  hasDepart: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '出发'),
  body: document.body.innerText.slice(0, 300).replace(/\n+/g, ' | '),
}))

const departed = onMap.hasDepart ? await click('出发', 'button', true) : false
await wait(1500)

// ★ 出发之后切回「地图」子页 —— 飞行路线画在那张 SVG 上
const wentMapTab = await click('地图', 'button', true)
await wait(1500)

const after = await page.evaluate(() => {
  /*
   * ★★ 为什么这条**必须**在真浏览器里量、单测量不了：
   *    路线那一层的虚线样式全在 Tailwind 的 `@utility anim-dash-route` 里
   *    （`stroke-dasharray: 6 5` + 走动动画）。jsdom **不跑 CSS**，
   *    所以单测只能证明"那个 path 元素在"，证明不了"它看起来是虚线"。
   *    要是 Tailwind 没扫到这个类名、utility 没被生成，
   *    界面上就是一条**实线** —— 而所有单测照样全绿。
   */
  const routes = [...document.querySelectorAll('path.anim-dash-route')].map((p) => {
    const cs = getComputedStyle(p)
    let bbox
    try {
      const b = p.getBBox()
      bbox = { w: Math.round(b.width), h: Math.round(b.height) }
    } catch {
      bbox = 'getBBox 抛了'
    }
    return {
      d: (p.getAttribute('d') || '').slice(0, 90),
      strokeDasharray: cs.strokeDasharray,
      animationName: cs.animationName,
      strokeWidth: cs.strokeWidth,
      bbox,
    }
  })
  return {
    body: document.body.innerText.slice(0, 400).replace(/\n+/g, ' | '),
    toast: [...document.querySelectorAll('[role="status"], .toast, [data-toast]')]
      .map((n) => (n.textContent || '').trim())
      .filter(Boolean)
      .join(' // '),
    mapLabel: document.querySelector('svg[role="img"]')?.getAttribute('aria-label') ?? null,
    routes,
    flyingTriangles: document.querySelectorAll('.anim-dangle').length,
  }
})

await page.screenshot({ path: `${SHOT}.png` }).catch(() => {})

/*
 * 路线的判定 —— 三态，别把「没画」和「画了但是实线」混成一句：
 *   · 没画出来      → 那一层没接上（就是"注释在撒谎"）
 *   · 画了但是实线  → Tailwind 没生成 `anim-dash-route`（单测永远发现不了）
 */
const routeVerdict =
  after.routes.length === 0
    ? '❌ 一条路线都没画出来'
    : after.routes.every((r) => r.strokeDasharray && r.strokeDasharray !== 'none')
      ? `✅ 画了 ${after.routes.length} 条，且真的是虚线（animation=${after.routes[0].animationName}）`
      : '❌ 路线画了，但 stroke-dasharray 是 none → Tailwind 没生成 anim-dash-route，界面上是实线'

console.log(
  JSON.stringify(
    {
      url: URL,
      bootNav: state0.nav,
      bootBody: state0.body,
      clickedMap: wentMap, clickedBirds: wentBirds,
      onMap,
      clickedDepart: departed,
      clickedMapTab: wentMapTab,
      after,
      routeVerdict,
      problems,
    },
    null,
    1,
  ),
)

await browser.close()
