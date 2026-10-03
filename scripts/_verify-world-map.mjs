/* ============================================================
   验证「旅行图」的中国 / 世界两档
   ------------------------------------------------------------
   真的开页面、真的点切换，确认：

     1. 两个档都在（中国档的省界 + 南海诸岛附图；世界档的陆地轮廓）
     2. 世界档**没有**国界、**没有**国名文字（合规）
     3. 世界档**不画**南海诸岛附图（那是中国图的职责，画到世界图上就是错标）
     4. 两档的画布尺寸各自正确（世界档是一条横带）
     5. 世界景点真的画上去了，而且**全都在画布内**
     6. 没有控制台报错

   跑法：node scripts/_verify-world-map.mjs
   ============================================================ */

import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync } from 'node:fs'

const URL = process.env.E2E_URL ?? 'http://localhost:5190/'
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SHOT_DIR = process.env.SHOT_DIR ?? '.'

mkdirSync(SHOT_DIR, { recursive: true })

/* ------------------------------------------------------------
   种一批"去过的地方"进去。
   ⚠️ 不种的话，全新存档上**两档都一个点都不画**
      （地图只画点亮过的地标）—— 那样"世界景点画上去了吗"
      这条断言是**空过**的：看着绿，其实什么都没验。
   ------------------------------------------------------------ */
function pickIds() {
  const arr = (v) => (Array.isArray(v) ? v : (v.landmarks ?? v.items ?? []))
  const world = arr(JSON.parse(readFileSync('src/data/landmarks-world.json', 'utf8'))).map((l) => l.id)
  const handArr = arr(JSON.parse(readFileSync('src/data/landmarks.json', 'utf8')))
  const cnArr = arr(JSON.parse(readFileSync('src/data/landmarks-cn.json', 'utf8')))
  const cnIds = [...handArr, ...cnArr].map((l) => l.id).filter(Boolean)
  // 世界：从不同大洲各挑几个（挑前 12 + 每隔 18 个取一个，撒得开一点）
  const worldPick = [...new Set([...world.slice(0, 12), ...world.filter((_, i) => i % 18 === 0)])]
  return { worldPick, cnPick: cnIds.slice(0, 12) }
}

/** 往 Dexie 的 meta 表里写 `visited`，再刷新页面 */
async function seedVisited(page, ids) {
  await page.evaluate((list) => {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('little-writer-forest')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const d = open.result
        const tx = d.transaction('meta', 'readwrite')
        const store = tx.objectStore('meta')
        store.put({
          key: 'visited',
          value: list.map((id) => ({ landmarkId: id, firstAt: Date.now(), visitCount: 1 })),
        })
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => reject(tx.error)
      }
    })
  }, ids)
}

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
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 250 }, text)
    return true
  } catch {
    return false
  }
}

async function clickByText(page, text) {
  return page.evaluate((txt) => {
    const el = [...document.querySelectorAll('button, a, [role="button"]')].find((b) =>
      (b.innerText || b.textContent || '').trim().includes(txt),
    )
    if (el) {
      el.click()
      return true
    }
    return false
  }, text)
}

/**
 * 关掉"新手引导"那层浮层。
 *
 * ⚠️⚠️ 引导浮层盖在整个界面上，而它**只有「跳过」一个出口**
 *    （「继续」那是 onboarding，见 MEMORY §六）。
 *    不关掉的话，底下的底部导航点不着 ——
 *    于是脚本会"进入主界面成功、点旅行图失败"，
 *    后面每一条断言全红，看起来像地图坏了。
 */
async function dismissGuide(page) {
  for (let i = 0; i < 4; i += 1) {
    const hit = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button, a, [role="button"]')].find(
        (b) => (b.innerText || '').trim() === '跳过',
      )
      if (el) {
        el.click()
        return true
      }
      return false
    })
    if (!hit) return
    await new Promise((r) => setTimeout(r, 700))
  }
}
async function switchScope(page, label) {
  return page.evaluate((txt) => {
    const btns = [...document.querySelectorAll('button[aria-pressed]')]
    const el = btns.find((b) => (b.innerText || '').trim() === txt)
    if (!el) return false
    el.click()
    return true
  }, label)
}

/**
 * 走完新手引导 + 引导（两套是分开的开关，见 MEMORY §六）。
 *
 * ⚠️ 别照抄旧脚本那种"点两次继续再点种下我的树"的写法 ——
 *    中间**还有一屏「你上几年级？」**，那一屏上「继续」是灰的/不存在，
 *    于是脚本会卡在那里，而后面所有断言全红、看起来像"功能坏了"。
 * ➜ 这里改成**看当前屏幕上有什么再决定点什么**。
 */
async function onboard(page) {
  const clickFirst = (texts) =>
    page.evaluate((list) => {
      for (const t of list) {
        const el = [...document.querySelectorAll('button, a, [role="button"]')].find(
          (b) => (b.innerText || '').trim() === t,
        )
        if (el) {
          el.click()
          return t
        }
      }
      return null
    }, texts)

  for (let i = 0; i < 12; i += 1) {
    const has = await page.evaluate(() => /写作文/.test(document.body.innerText))
    if (has) return true
    // 年级那屏：先选一个年级，再点继续
    const picked = await clickFirst(['3 年级', '小学中年级'])
    if (picked) {
      await new Promise((r) => setTimeout(r, 400))
      await clickFirst(['继续'])
      await new Promise((r) => setTimeout(r, 900))
      continue
    }
    const hit = await clickFirst(['继续', '种下我的树', '跳过', '开始吧'])
    if (!hit) return false
    await new Promise((r) => setTimeout(r, 1100))
  }
  return page.evaluate(() => /写作文/.test(document.body.innerText))
}

/** 把当前这张地图的信息抓出来 */
async function mapInfo(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label$="旅行地图"]')
    if (!svg) return null
    const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number)
    const paths = [...svg.querySelectorAll('path')]
    const dots = [...svg.querySelectorAll('g.cursor-pointer')]
    // 地标点：g.cursor-pointer 里那个实心绿圆
    const dotXY = dots.map((g) => {
      const c = [...g.querySelectorAll('circle')].find((x) => x.getAttribute('fill') === '#29ce89')
      return c ? { x: +c.getAttribute('cx'), y: +c.getAttribute('cy') } : null
    })
    return {
      label: svg.getAttribute('aria-label'),
      viewBox: vb,
      pathCount: paths.length,
      maxPathLen: Math.max(0, ...paths.map((p) => (p.getAttribute('d') || '').length)),
      textCount: svg.querySelectorAll('text').length,
      texts: [...svg.querySelectorAll('text')].map((t) => t.textContent),
      dotCount: dotXY.filter(Boolean).length,
      dotXY: dotXY.filter(Boolean),
      hasNanhai: /南海诸岛/.test(svg.textContent || ''),
    }
  })
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=414,896'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 414, height: 896, deviceScaleFactor: 2, isMobile: true })

  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`))

  console.log(`\n🌐 ${URL}\n`)

  /* ---------- 0. 进场 ---------- */
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 3300))

  const seenOnboarding = await page.evaluate(() => /种下我的树|我该怎么叫你/.test(document.body.innerText))
  if (seenOnboarding) {
    const ok = await onboard(page)
    check('走完新手引导', ok)
  } else {
    check('走完新手引导', true, '（已有存档，跳过）')
  }
  check('进入主界面', await waitForText(page, '写作文', 8000))
  await dismissGuide(page)

  /* ---------- 0.5 种一批"去过的地方" ---------- */
  const { worldPick, cnPick } = pickIds()
  await seedVisited(page, [...cnPick, ...worldPick])
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 3300))
  await dismissGuide(page)
  console.log(`\n  （种进去：中国 ${cnPick.length} 个 / 世界 ${worldPick.length} 个）`)
  check('重新进场后还在主界面', await waitForText(page, '写作文', 8000))
  await clickByText(page, '旅行图')
  await new Promise((r) => setTimeout(r, 1400))

  /* ---------- 1. 切换器在不在 ---------- */
  console.log('\n【1】中国 / 世界 切换器')
  const switches = await page.evaluate(() =>
    [...document.querySelectorAll('button[aria-pressed]')].map((b) => (b.innerText || '').trim()),
  )
  check('地图页有两个档的切换按钮', switches.length === 2, `实际 ${JSON.stringify(switches)}`)
  check('就是「中国」「世界」', switches[0] === '中国' && switches[1] === '世界', JSON.stringify(switches))

  /* ---------- 2. 中国档 ---------- */
  console.log('\n【2】中国档')
  const cn = await mapInfo(page)
  check('中国档画的是中国地图', cn?.label === '中国旅行地图', String(cn?.label))
  check('中国档画布 720×560', cn && cn.viewBox[2] === 720 && cn.viewBox[3] === 560, JSON.stringify(cn?.viewBox))
  check('中国档有南海诸岛附图', cn?.hasNanhai === true)
  check('中国档有省级行政区文字/图形', cn && cn.pathCount >= 34, `path 数 ${cn?.pathCount}`)
  await page.screenshot({ path: `${SHOT_DIR}/_world-1-china.png` })

  /* ---------- 3. 切到世界档 ---------- */
  console.log('\n【3】切到世界档')
  const clicked = await switchScope(page, '世界')
  check('点得中「世界」', clicked)
  await new Promise((r) => setTimeout(r, 1200))

  const wd = await mapInfo(page)
  check('世界档画的是世界地图', wd?.label === '世界旅行地图', String(wd?.label))
  check('世界档画布 720×287（横带，不拉伸）', wd && wd.viewBox[2] === 720 && wd.viewBox[3] === 287, JSON.stringify(wd?.viewBox))

  /* 合规：只有陆地轮廓 */
  console.log('\n【4】合规：没有国界、没有国名')
  check('世界档一条国界都没画（只有陆地轮廓 path）', wd && wd.pathCount <= 4, `path 数 ${wd?.pathCount}`)
  check('陆地轮廓是一条很长的 path（不是空白）', wd && wd.maxPathLen > 5000, `最长 d 长度 ${wd?.maxPathLen}`)
  check('★★ 世界档里没有任何地名文字', wd?.textCount === 0, `实际 ${wd?.textCount} 个：${JSON.stringify(wd?.texts)}`)
  check('★★ 世界档不画南海诸岛附图', wd?.hasNanhai === false)

  /* ---------- 5. 世界景点画上去了吗 ---------- */
  console.log('\n【5】世界景点')
  const outOfBox = (wd?.dotXY ?? []).filter(
    (d) => d.x < 0 || d.x > wd.viewBox[2] || d.y < 0 || d.y > wd.viewBox[3],
  )
  check('★★ 世界档真的画出了地标点（不是空过）', (wd?.dotCount ?? 0) > 0, `画了 ${wd?.dotCount ?? 0} 个`)
  check(
    '★★ 画出来的世界景点全都在画布内',
    outOfBox.length === 0,
    outOfBox.map((d) => `${d.x},${d.y}`).join(' | '),
  )
  check(
    '★ 画出来的点数 = 种进去的世界景点数（不多不少）',
    wd?.dotCount === worldPick.length,
    `画了 ${wd?.dotCount}，种了 ${worldPick.length}`,
  )
  // 撒得开：经度方向要跨过 0°（欧洲/非洲），不能全挤在东亚
  const xs = (wd?.dotXY ?? []).map((d) => d.x)
  check('★ 世界景点在经度上撒得开（跨过本初子午线）', xs.length > 1 && Math.min(...xs) < 360, `x 范围 ${Math.min(...xs)}–${Math.max(...xs)}`)

  await page.screenshot({ path: `${SHOT_DIR}/_world-2-world.png` })

  /* ---------- 5b. 中国档也画得出来 ---------- */
  console.log('\n【5b】中国档的地标点')
  await switchScope(page, '中国')
  await new Promise((r) => setTimeout(r, 1000))
  const cn2 = await mapInfo(page)
  check('★ 中国档也画出了地标点', (cn2?.dotCount ?? 0) > 0, `画了 ${cn2?.dotCount ?? 0} 个`)
  const cnOut = (cn2?.dotXY ?? []).filter(
    (d) => d.x < 0 || d.x > cn2.viewBox[2] || d.y < 0 || d.y > cn2.viewBox[3],
  )
  // ⚠️ 这条**暂时**允许纵向越界（既有裁剪 bug，见 mapProjection.test.ts）——
  //    种进去的那 12 个都在南岭以北，所以这里应当为 0；等 bug 修好再看。
  check('★ 中国档画出来的点在画布内', cnOut.length === 0, cnOut.map((d) => `${d.x},${d.y}`).join(' | '))
  await page.screenshot({ path: `${SHOT_DIR}/_world-3-china-dots.png` })

  await switchScope(page, '世界')
  await new Promise((r) => setTimeout(r, 800))

  /* ---------- 6. 切回来 ---------- */
  console.log('\n【6】切回中国档')
  await switchScope(page, '中国')
  await new Promise((r) => setTimeout(r, 1000))
  const back = await mapInfo(page)
  check('切回中国档正常', back?.label === '中国旅行地图' && back?.hasNanhai === true, String(back?.label))

  /* ---------- 7. 控制台 ---------- */
  console.log('\n【7】控制台')
  const real = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e))
  check('没有控制台报错', real.length === 0, real.slice(0, 3).join(' | '))

  console.log(`\n${'='.repeat(46)}`)
  console.log(`  通过 ${pass} / 失败 ${fail}`)
  if (failures.length) console.log(`  ❌ ${failures.join('\n  ❌ ')}`)
  console.log(`${'='.repeat(46)}\n`)

  await browser.close()
  process.exit(fail > 0 ? 1 : 0)
}

await main()
