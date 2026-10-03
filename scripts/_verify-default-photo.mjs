/* ============================================================
   验证「默认图片」在**真实浏览器**里真的能用
   ------------------------------------------------------------
   跑法：node scripts/_verify-default-photo.mjs
   ⚠️ 需要 dev server 在 5190。

   为什么不去点地图派鸟（那是 `_verify-travel-photo.mjs` 的做法）：
     那个脚本已经**过时**了 —— 它按"地图上画出全部地标"来点第 3 个 `g.cursor-pointer`，
     而现在地图**只画点亮过的地标**（`if (!isLit && !active) return null`），
     新档一个都没点亮 → 一个都点不到。它跟这次改动无关，是另一笔账。

   ➜ 这里换一条更直接、更不容易过期的路：
     在浏览器里 `import()` 真实的 TS 模块（vite 会转译），
     调**真的** `pickPhotoForLandmark()`，再把拿到的地址喂给 `<img>`，
     看 `naturalWidth > 0` —— 也就是"照片真的解码出来了"，
     而不是"DOM 里有个 img 标签"。

   ★ 顺带把**每一条**都在浏览器里过一遍 —— 这是"看效果"最硬的证据。
   ============================================================ */

import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = process.env.E2E_URL ?? 'http://localhost:5190'
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

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

const photos = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/data/landmark-photos.json'), 'utf8'),
)
const contentIds = new Set(
  JSON.parse(readFileSync(resolve(process.cwd(), 'src/data/travel-contents.json'), 'utf8')).map(
    (c) => c.landmarkId,
  ),
)

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    /*
     * ★★ 必须显式抬高，否则【5】那一步会假红。
     *
     * puppeteer 的 `protocolTimeout` 默认 **180s**，而它是**整条
     * `Runtime.callFunctionOn` 的墙钟** —— 【5】把 N 张图全塞进**一次**
     * `page.evaluate()` 里解码，N 从 85 涨到 366 之后，
     * 两路并发 + 每批 250ms 间隔跑不完 180s，于是抛
     * `ProtocolError: Runtime.callFunctionOn timed out`。
     *
     * ⚠️ 这跟数据无关：同一批地址直接下载是 **366/366 全 200**。
     *    看到这个报错别去改数据，先看这里。
     */
    protocolTimeout: 600_000,
  })
  const page = await browser.newPage()
  const consoleErrors = []
  const badResponses = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`))
  page.on('response', (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`)
  })

  /*
    ★ 给 favicon 直接回一个空的 204。
    ⚠️ 为什么不靠过滤字符串：控制台那条 `Failed to load resource: ... 404`
      **不带 URL**，所以 `!e.includes('favicon')` 永远滤不掉它 ——
      于是"页面有没有报错"这件事就永远查不清（这次就卡在这）。
    ⚠️ 也别用 `req.abort()`：那会在控制台留下 `net::ERR_FAILED`，一样是红的。
      ➜ 只能**回一个成功的空响应**，控制台才真的干净。
  */
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.url().endsWith('/favicon.ico')) req.respond({ status: 204, body: '' })
    else req.continue()
  })

  console.log(`\n🌐 ${BASE}\n`)
  // 随便打开一个同源页面，好让 `import()` 走 vite 的模块图
  await page.goto(`${BASE}/landmarks-browse.html`, { waitUntil: 'networkidle2', timeout: 30000 })

  /* ---------- 1. 模块图 ---------- */
  console.log('【1】真实模块图（浏览器里 import 真代码）')
  const mod = await page.evaluate(async () => {
    try {
      const m = await import('/src/domain/travelContents.ts')
      return {
        ok: true,
        hasPick: typeof m.pickPhotoForLandmark === 'function',
        hasDefault: typeof m.defaultContentForLandmark === 'function',
        prefix: m.DEFAULT_CONTENT_ID_PREFIX,
      }
    } catch (e) {
      return { ok: false, err: String(e && e.message) }
    }
  })
  check('能 import 到 travelContents.ts', mod.ok, mod.err ?? '')
  check('★ pickPhotoForLandmark 真的导出在（不是只在测试里）', mod.hasPick === true)
  check('★ contentId 前缀是 default:', mod.prefix === 'default:')

  /* ---------- 2. 内容包优先 ---------- */
  console.log('\n【2】内容包优先（配过图的景点不许被默认图顶替）')
  const packFirst = await page.evaluate(async () => {
    const m = await import('/src/domain/travelContents.ts')
    const out = {}
    for (const id of ['badaling', 'xihu']) {
      const c = m.pickPhotoForLandmark(id, { rng: () => 0.5 })
      out[id] = c ? { id: c.id, isDefault: c.id.startsWith('default:') } : null
    }
    return out
  })
  for (const id of ['badaling', 'xihu']) {
    const got = packFirst[id]
    check(`${id} 拿到内容包里的图（不是默认图）`, got && !got.isDefault, JSON.stringify(got))
  }

  /* ---------- 3. 默认图兜底 + match 抄下来 ---------- */
  console.log('\n【3】没配内容的景点用默认图兜底')
  const noPack = photos.items.filter((p) => !contentIds.has(p.landmarkId))
  const sample = noPack[0]
  const fallback = await page.evaluate(async (id) => {
    const m = await import('/src/domain/travelContents.ts')
    const c = m.pickPhotoForLandmark(id, { rng: () => 0.5 })
    return c
      ? {
          id: c.id,
          mediaUrl: c.mediaUrl,
          match: c.match,
          place: c.place,
          lng: c.lng,
          lat: c.lat,
          grade: c.grade ?? null,
          essay: c.essay ?? null,
          creditSource: c.credit?.source,
        }
      : null
  }, sample.landmarkId)
  check(`★ ${sample.landmarkId} 兜底成功`, fallback !== null)
  check('★ contentId 带 default: 前缀', fallback?.id === `default:${sample.landmarkId}`, fallback?.id)
  check('★★ match 从默认图**抄下来了**（不抄 = 顶替图会被当成真地方）', fallback?.match === sample.match, `${fallback?.match} vs ${sample.match}`)
  check('★ 署名跟默认图一致', fallback?.creditSource === 'Pexels', fallback?.creditSource)
  check('★ 不许替家长编等级和散文', fallback?.grade === null && fallback?.essay === null)

  /* ---------- 4. 两样都没有 → undefined ---------- */
  console.log('\n【4】两样都没有 → 老实留空')
  const bare = await page.evaluate(async () => {
    const [tc, lp] = await Promise.all([
      import('/src/domain/travelContents.ts'),
      import('/src/data/landmarkPhotos.ts'),
    ])
    const lm = (await import('/src/domain/travel.ts')).LANDMARKS
    const hit = lm.find(
      (l) => tc.contentsByLandmark(l.id).length === 0 && !lp.defaultPhotoFor(l.id),
    )
    if (!hit) return { found: false }
    return { found: true, id: hit.id, got: tc.pickPhotoForLandmark(hit.id, { rng: () => 0.5 }) ?? null }
  })
  check('库里还有"没内容包也没默认图"的地标', bare.found)
  check('★ 它返回 undefined（由 pets.ts 退回程序化插画）', bare.found && bare.got === null, JSON.stringify(bare.got))

  /* ---------- 5. 全部图片在浏览器里解码 ---------- */
  console.log(`\n【5】${photos.items.length} 张图在浏览器里**真的解码**（naturalWidth > 0）`)
  /*
    ⚠️⚠️ 并发别开大。Pexels CDN 前面是 Cloudflare，8 路并发会被限流，
       返回 **522**，在浏览器里表现成 `onerror` / 超时 ——
       看着像"这 11 张图是坏的"，其实**数据没问题**，是探针太急。
       （同一批地址用 curl 单线程带 0.5s 间隔跑，全部 200。）
    ➜ 两路并发 + 每批间隔，失败的再单独重试一轮。
  */
  const decoded = await page.evaluate(async (urls) => {
    const load = (src) =>
      new Promise((res) => {
        const img = new Image()
        const t = setTimeout(() => res({ src, ok: false, why: 'timeout' }), 25000)
        img.onload = () => {
          clearTimeout(t)
          res({ src, ok: img.naturalWidth > 0, w: img.naturalWidth, h: img.naturalHeight })
        }
        img.onerror = () => {
          clearTimeout(t)
          res({ src, ok: false, why: 'onerror' })
        }
        img.src = src
      })
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

    let out = []
    for (let i = 0; i < urls.length; i += 2) {
      out.push(...(await Promise.all(urls.slice(i, i + 2).map(load))))
      await sleep(250)
    }
    // 重试一轮：限流是暂时的
    const failed = out.filter((d) => !d.ok)
    if (failed.length) {
      await sleep(3000)
      const retried = []
      for (const d of failed) {
        retried.push(await load(d.src))
        await sleep(700)
      }
      const bySrc = new Map(retried.map((r) => [r.src, r]))
      out = out.map((d) => (bySrc.get(d.src)?.ok ? bySrc.get(d.src) : d))
    }
    return out
  }, photos.items.map((p) => p.mediaUrl))

  const bad = decoded.filter((d) => !d.ok)
  check(
    `★★ ${decoded.length} 张全部解码成功（失败 ${bad.length} 张）`,
    decoded.length === photos.items.length && bad.length === 0,
    bad.map((b) => `${b.src} (${b.why ?? 'unknown'})`).slice(0, 5).join(' | '),
  )
  const sizes = decoded.filter((d) => d.ok).map((d) => d.w)
  check(
    '★ 解码出来的宽度都 ≥ 320px（太小的多半是占位图）',
    sizes.every((w) => w >= 320),
    `最小 ${Math.min(...sizes)}`,
  )

  /* ---------- 6. 控制台 ---------- */
  console.log('\n【6】控制台')
  /* ⚠️ 图床的 5xx 是限流，不算页面出错（见【5】的说明）；
     真正要盯的是**页面自己**的报错和同源 4xx。 */
  const real = consoleErrors.filter((e) => !/522|502|503/.test(e))
  check('没有控制台报错（图床限流的 5xx 不算）', real.length === 0, real.slice(0, 3).join(' | '))
  const pageErrors = badResponses.filter(
    (b) => !b.includes('images.pexels.com') && !b.includes('favicon'),
  )
  check('页面自己没发出 4xx/5xx 请求', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '))

  await browser.close()

  console.log('\n==============================================')
  console.log(`  通过 ${pass} / 失败 ${fail}`)
  console.log('==============================================')
  if (failures.length) {
    console.log('失败项：')
    for (const f of failures) console.log('  - ' + f)
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
