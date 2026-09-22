/* ============================================================
   验证「第一张旅行照片」端到端能不能跑通
   ------------------------------------------------------------
   真的打开页面、真的点地图、真的派鸟、真的收鸟、真的开相册，
   最后确认那张 Unsplash 照片**在浏览器里真的加载出来了**
   （naturalWidth > 0），而不是只查了 DOM 里有没有 <img> 标签。

   临时脚本，验证完删掉。
   ============================================================ */

import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const URL = process.env.E2E_URL ?? 'http://localhost:5190/'
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
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
    (t, ex) => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')]
      const el = els.find((x) => {
        const s = (x.innerText || x.textContent || '').trim()
        return ex ? s === t : s.includes(t)
      })
      if (!el) return false
      el.scrollIntoView({ block: 'center' })
      el.click()
      return true
    },
    text,
    exact,
  )
}

/** 把出门在外的鸟的返程时间改到过去 —— 不然要等 25 分钟 */
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
            // 不 await：同一个 task 里完成 put，事务才不会提前关掉
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

  /*
    OFFLINE=1：把图床整个掐掉，验证「照片加载不出来」时界面会不会崩。
    这不是假想的场景 —— App 是要打包成 APK 离线用的，
    而照片地址全是外链，断网就是常态。
  */
  const OFFLINE = process.env.OFFLINE === '1'
  if (OFFLINE) {
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (req.url().includes('images.unsplash.com')) req.abort()
      else req.continue()
    })
  }

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

  // 关键： fresh profile，没派过鸟，照片就应该直接显示在抽屉里
  const prePhoto = await page.evaluate(() => {
    const img = document.querySelector('img[src*="unsplash"]')
    return { found: Boolean(img), w: img?.naturalWidth ?? 0 }
  })
  check(
    '抽屉里直接显示照片（没派鸟就能看到）',
    prePhoto.found && prePhoto.w > 0,
    `found=${prePhoto.found} naturalWidth=${prePhoto.w}`,
  )

  await page.screenshot({ path: `${SHOT_DIR}/01-landmark.png` })

  const sent = await clickByText(page, '派一只小鸟去这里')
  check('可以派鸟出发', sent)
  await new Promise((r) => setTimeout(r, 1400))

  /* ---------- 2. 确认鸟真的在飞往 badaling ---------- */
  console.log('\n【2】小鸟真的在飞')
  const away = await page.evaluate(() => {
    const txt = document.body.innerText
    return {
      awayLine: /只小鸟正在路上/.test(txt),
      destLine: /八达岭长城/.test(txt),
    }
  })
  check('页面上显示有鸟在路上', away.awayLine)
  check('显示的目的地是八达岭长城', away.destLine)

  /* ---------- 3. 把返程时间拨到过去，收鸟 ---------- */
  console.log('\n【3】收鸟')
  const ff = await fastForwardBirds(page)
  check('库里有一只在外飞往 badaling 的鸟', ff.dests.some((d) => d.endsWith('badaling')), ff.dests.join(' | '))

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
  check('收鸟提示里说到「一张照片」', /一张照片/.test(toast))
  await page.screenshot({ path: `${SHOT_DIR}/02-collect.png` })

  /* ---------- 4. 相册里看照片 ---------- */
  console.log('\n【4】相册')
  await clickByText(page, '相册')
  await new Promise((r) => setTimeout(r, 1500))

  const album = await page.evaluate(() => {
    const txt = document.body.innerText
    return {
      place: txt.includes('中国长城'),
      distance: /飞了\s*1989\s*公里/.test(txt.replace(/\s+/g, ' ')),
      essayHead: txt.includes('我是一只小小的鸟'),
      essayTail: txt.includes('这就是我那天看见的'),
      credit: /照片：.*Unsplash/.test(txt.replace(/\s+/g, ' ')),
      paragraphs: [...document.querySelectorAll('p')].filter((p) =>
        (p.textContent || '').includes('长城'),
      ).length,
    }
  })
  check('相册显示地名「中国长城」', album.place)
  check('相册显示「飞了 1989 公里」（深圳基准）', album.distance)
  check('相册显示散文开头', album.essayHead)
  check('相册显示散文结尾', album.essayTail)
  check('相册标出了图片出处', album.credit)

  /* ---------- 5. 关键：照片在浏览器里真的加载出来了 ---------- */
  console.log('\n【5】照片真的加载出来了吗')
  const img = await page.evaluate(async () => {
    const el = document.querySelector('img[src*="unsplash"]')
    if (!el) return { found: false }
    if (!el.complete || el.naturalWidth === 0) {
      await new Promise((res) => {
        el.addEventListener('load', res, { once: true })
        el.addEventListener('error', res, { once: true })
        setTimeout(res, 15000)
      })
    }
    return {
      found: true,
      w: el.naturalWidth,
      h: el.naturalHeight,
      src: el.getAttribute('src')?.slice(0, 60),
    }
  })
  if (OFFLINE) {
    // 图床被掐掉：应该干净地退回程序化插画，而不是破图标 / 白框
    const fb = await page.evaluate(() => ({
      broken: document.querySelector('img[src*="unsplash"]')?.naturalWidth === 0,
      hasFallbackArt: Boolean(document.querySelector('svg[viewBox="0 0 300 140"]')),
      essay: document.body.innerText.includes('我是一只小小的鸟'),
    }))
    check('离线时不留破图', !fb.broken)
    check('离线时退回程序化插画', fb.hasFallbackArt)
    check('离线时散文照常能读', fb.essay)
    await page.screenshot({ path: `${SHOT_DIR}/04-offline.png`, fullPage: true })
  } else {
    check('相册里有这张照片的 <img>', img.found, JSON.stringify(img))
    check(
      '照片真的解码出来了（naturalWidth > 0）',
      img.found && img.w > 0 && img.h > 0,
      `naturalWidth=${img.w} naturalHeight=${img.h}`,
    )
  }

  await page.screenshot({ path: `${SHOT_DIR}/03-album.png`, fullPage: true })

  /* ---------- 6. 地图上的落点 ---------- */
  console.log('\n【6】地图上的落点')
  await clickByText(page, '地图')
  await new Promise((r) => setTimeout(r, 1200))

  const legend = await page.evaluate(() => document.body.innerText)
  check('图例里有「带回过照片」', legend.includes('带回过照片'))

  // 有照片的落点应该套了金环
  const ring = await page.evaluate(() => {
    const svg = document.querySelector('svg[role="img"]')
    if (!svg) return 0
    return [...svg.querySelectorAll('circle')].filter(
      (c) => c.getAttribute('stroke') === '#d4a648' && c.getAttribute('fill') === 'none',
    ).length
  })
  check('有照片的落点画出了金环', ring > 0, `金环数 ${ring}`)
  await page.screenshot({ path: `${SHOT_DIR}/05a-map-marker.png` })

  // 点开那个落点，抽屉里应该能看到照片和「小鸟在这里带回过照片」
  await page.evaluate(() => {
    const gs = [...document.querySelectorAll('svg g.cursor-pointer')]
    if (gs[2]) gs[2].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await new Promise((r) => setTimeout(r, 1200))

  const landingSheet = await page.evaluate(() => {
    const txt = document.body.innerText.replace(/\s+/g, ' ')
    return {
      hint: txt.includes('小鸟在这里带回过照片'),
      distance: /飞了\s*1989\s*公里/.test(txt),
      hasImg: Boolean(document.querySelector('img[src*="unsplash"]')),
      hasFallbackArt: Boolean(document.querySelector('svg[viewBox="0 0 300 140"]')),
    }
  })
  check('落点抽屉里说明「小鸟在这里带回过照片」', landingSheet.hint)
  check('落点抽屉里显示距离', landingSheet.distance)
  if (OFFLINE) {
    // 图床掐掉：抽屉里也必须是插画，不能是破图
    check('落点抽屉离线时退回插画', landingSheet.hasFallbackArt)
  } else {
    check('落点抽屉里显示真实照片', landingSheet.hasImg)
  }
  await page.screenshot({ path: `${SHOT_DIR}/05-landing.png`, fullPage: true })

  /* ---------- 7. 设置里的距离基准点 ---------- */
  console.log('\n【7】设置里的距离基准点')
  // 先离开旅行图（切页会卸载 MapPage，抽屉自然关掉），再进设置
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
  await page.screenshot({ path: `${SHOT_DIR}/06-home-point.png`, fullPage: true })

  // 离线模式下，被 abort 的图片请求本身会留下一条 net::ERR_FAILED，
  // 那是我们主动掐的，不算 App 的错。
  const realErrors = OFFLINE
    ? consoleErrors.filter((e) => !/Failed to load resource|net::ERR_FAILED/.test(e))
    : consoleErrors

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
