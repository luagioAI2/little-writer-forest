/**
 * 真机尺寸截图：把 build 出来的 App 跑在 390x844（iPhone 竖屏）里，
 * 逐个页面截图，用来肉眼验收 UI。
 *
 * 用法：
 *   node scripts/capture.mjs            # 截全部
 *   node scripts/capture.mjs tree       # 只截某个
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ROOT = fileURLToPath(new URL('../dist/', import.meta.url))
const OUT = fileURLToPath(new URL('../shots/', import.meta.url))
mkdirSync(OUT, { recursive: true })

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

/* ---------------- 静态服务器 ---------------- */
const server = createServer((req, res) => {
  if (!req.url) return res.writeHead(404).end()
  const clean = decodeURIComponent(req.url.split('?')[0] ?? '/')
  let file = join(ROOT, normalize(clean).replace(/^(\.\.[/\\])+/, ''))
  if (clean === '/' || !existsSync(file)) file = join(ROOT, 'index.html')
  if (!existsSync(file)) return res.writeHead(404).end('not found')
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const base = `http://127.0.0.1:${port}/`

/* ---------------- 页面清单 ---------------- */
/** 点哪个底部 tab，以及截什么名字 */
const SHOTS = [
  { name: '01-onboarding', fresh: true },
  /* 新手引导四屏。`guide: n` = 灌一份「种完树、还没看过引导」的存档，
     然后点 n 次「继续」。第 2 屏会**真的按住**那个麦克风按钮再松手 ——
     这一屏的核心就是那个手势，不真按一次等于没验。 */
  { name: '01b-guide-1', guide: 0 },
  { name: '01b-guide-2', guide: 1, holdMic: true },
  /* ★ 同一屏的**另一套手势**。转写没配好 / 在网页上跑时，写作页那个按钮是
     「点一下开始、再点一下停」，引导必须跟着改口（见 canHoldToTalk）。
     这是一套新的界面状态，所以也要有一张图 —— 不然它只存在于单元测试里。 */
  { name: '01b-guide-2b-tap', guide: 1, holdMic: true, tapMode: true },
  { name: '01b-guide-3', guide: 2 },
  { name: '01b-guide-4', guide: 3 },
  { name: '02-compose', tab: '写作文' },
  { name: '03-diary', tab: '日记本' },
  { name: '04-tree', tab: '成长树' },
  { name: '05-cards', tab: '文心卡' },
  { name: '06-map', tab: '旅行图' },
]

const only = process.argv[2]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })

/**
 * 灌一份"已经玩了一阵子"的 Dexie 存档，这样每个页面都有东西可看。
 * 直接写 IndexedDB —— 数据库名与 db.ts 里一致。
 */
export const SEED_ROWS = {
  meta: [
    {
      key: 'settings',
      value: {
        childName: '朵朵',
        grade: 3,
        avatar: '🦊',
        dailyGoal: 1,
        soundOn: true,
        hapticsOn: true,
        diaryPin: null,
        ai: null,
        onboarded: true,
        /* ★ 必须显式给 true。settings 是**整份覆盖**写进去的（不是 merge），
           漏了这个字段就等于"还没看过新手引导" ——
           于是 02~06 每一张截图都会变成引导的第 1 屏，
           而且不会报任何错。加字段时一定要回来看这里。 */
        guideDone: true,
        /*
         * ★ 转写配置**必须显式给**，否则走 defaultTranscribeConfig()（火山流式），
         *   而流式只在原生 App 里能用（浏览器的 WebSocket 设不了请求头）——
         *   于是 `canHoldToTalk()` 在桌面 Chrome 上是 false，
         *   写作页和**新手引导第二屏**都会变成「点一下开始说」那一套。
         *   可我们发出去的是 **APK**，那上面是「按住说话」。
         *   截图走查的全部价值就在于它代表真实产物，所以这里给一份
         *   **"整包上传 + 配好了"** 的配置 —— 它同样满足 canHoldToTalk，
         *   于是截出来的手势和 APK 一致。
         *   （`canHoldToTalk` 是唯一的判定，见 platform/transcribe.ts。）
         */
        transcribe: {
          engine: 'openai',
          baseUrl: 'https://api.siliconflow.cn/v1',
          apiKey: 'sk-capture-dummy',
          model: 'Qwen/Qwen3-ASR-1.7B',
          resourceId: '',
        },
      },
    },
    {
      key: 'level',
      value: { levelIndex: 5, points: 268, updatedAt: Date.now() },
    },
    {
      key: 'wallet',
      value: { coins: 342, totalEarned: 918 },
    },
    {
      key: 'streak',
      value: { days: 6, lastDay: new Date().toISOString().slice(0, 10), best: 6 },
    },
    {
      key: 'stats',
      value: {
        works: 14,
        diaries: 9,
        words: 4820,
        scored: 12,
        best: 91,
        totalCoins: 918,
        recitations: 5,
      },
    },
    {
      key: 'tree',
      value: {
        lastTickAt: Date.now() - 1000 * 60 * 37,
        pending: [],
        harvests: 23,
        totalCoins: 431,
        totalCards: 17,
        hollowUnlocked: true,
        hollowAt: Date.now() - 86400000 * 3,
        hollowDiaries: [],
      },
    },
    {
      key: 'birds',
      value: [
        { species: 'sparrow', nickname: '啾啾', status: 'home', bond: 62, trips: 7, photos: 6, hasLetter: false, adoptedAt: Date.now() - 86400000 * 12 },
        { species: 'swallow', nickname: '小剪', status: 'away', bond: 44, trips: 4, photos: 3, hasLetter: true, adoptedAt: Date.now() - 86400000 * 9, destinationId: 'lhasa-potala', departedAt: Date.now() - 3600000, returnsAt: Date.now() + 3600000 * 3 },
        { species: 'magpie', nickname: '喜喜', status: 'home', bond: 78, trips: 11, photos: 10, hasLetter: false, adoptedAt: Date.now() - 86400000 * 20 },
      ],
    },
    {
      key: 'sprouts',
      value: [
        { id: 'sp1', landmarkId: 'beijing-forbidden', species: 'sparrow', stage: 3, at: Date.now() - 86400000 * 10 },
        { id: 'sp2', landmarkId: 'xian-terracotta', species: 'magpie', stage: 2, at: Date.now() - 86400000 * 6 },
        { id: 'sp3', landmarkId: 'hangzhou-westlake', species: 'swallow', stage: 1, at: Date.now() - 86400000 * 2 },
        { id: 'sp4', landmarkId: 'guilin-lijiang', species: 'sparrow', stage: 1, at: Date.now() - 86400000 * 1 },
      ],
    },
    {
      key: 'photos',
      value: [
        { id: 'ph1', landmarkId: 'beijing-forbidden', caption: '啾啾在故宫的红墙下站了很久，说这里的砖比它的窝还老。', at: Date.now() - 86400000 * 10 },
        { id: 'ph2', landmarkId: 'xian-terracotta', caption: '喜喜数了数兵马俑，数到第 40 个就放弃了。', at: Date.now() - 86400000 * 6 },
      ],
    },
  ],
  /** 卡组单独一张表（cards 的 keyPath 是 defId） */
  cards: [
    'forest-1', 'forest-2', 'forest-3', 'forest-5',
    'star-1', 'star-2', 'star-4',
    'scroll-1', 'scroll-3',
    'sweets-2',
  ].map((defId, i) => ({
    defId,
    count: 1 + (i % 3),
    firstAt: Date.now() - 86400000 * (20 - i),
    starred: i < 2,
  })),
}

async function seed(rows = SEED_ROWS) {
  await page.goto(base, { waitUntil: 'load' })
  await page.evaluate(async (rows) => {
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('little-writer-forest')
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })
    await new Promise((resolve) => {
      const open = indexedDB.open('little-writer-forest')
      open.onupgradeneeded = () => {
        const db = open.result
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
        if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'defId' })
        if (!db.objectStoreNames.contains('works')) db.createObjectStore('works', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('diary')) db.createObjectStore('diary', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('library'))
          db.createObjectStore('library', { keyPath: 'id' })
      }
      open.onsuccess = () => {
        const db = open.result
        const names = [...db.objectStoreNames]
        const tx = db.transaction(names, 'readwrite')
        for (const [store, list] of Object.entries(rows)) {
          if (!db.objectStoreNames.contains(store)) continue
          for (const row of list) tx.objectStore(store).put(row)
        }
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => resolve()
      }
      open.onerror = () => resolve()
    })
  }, rows)
}

/**
 * 一份「刚种完树、还没看过新手引导」的存档。
 * 和 SEED_ROWS 只差一个 guideDone —— 用展开复制而不是手写第二份，
 * 免得两边慢慢走散（新增 seed 字段时只改一处）。
 */
const GUIDE_SEED = {
  ...SEED_ROWS,
  meta: SEED_ROWS.meta.map((r) =>
    r.key === 'settings' ? { ...r, value: { ...r.value, guideDone: false } } : r,
  ),
}

/**
 * 同上，但转写**没配好** —— 用来截「点一下开始说」那套手势。
 * 把 transcribe 整个去掉，`mergeSettings` 会补上默认值（火山流式），
 * 而流式在浏览器里用不了 → `canHoldToTalk()` 返回 false。
 */
const GUIDE_TAP_SEED = {
  ...GUIDE_SEED,
  meta: GUIDE_SEED.meta.map((r) => {
    if (r.key !== 'settings') return r
    const { transcribe: _drop, ...rest } = r.value
    return { ...r, value: rest }
  }),
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 点一个按文字找到的按钮（引导里那些「继续 / 跳过」都不是 tab） */
async function clickByText(label) {
  return page.evaluate((text) => {
    const nodes = [...document.querySelectorAll('button')]
    const hit = nodes.find((n) => (n.textContent ?? '').trim().includes(text))
    if (!hit) return false
    hit.click()
    return true
  }, label)
}

/**
 * ★ 真的按住那个麦克风按钮再松手。
 *
 * 这一屏的核心就是"按住"这个手势 —— jsdom 里只能证明 state 机对，
 * 证明不了 pointerdown/up 在真浏览器里能接上（setPointerCapture、
 * 触摸下的 pointercancel……）。所以这里用真鼠标按一次。
 */
async function holdMic(ms = 1200) {
  // 假装成原生之后应该是「按住说话」；万一没生效就是「点一下开始说」。
  // ★ 两种都认 —— 只认一种的话，环境一变脚本就静默不按了（上面那句 warn 会漏掉）。
  const spot = await page.evaluate(() => {
    for (const [label, mode] of [
      ['按住说话（试一下）', 'hold'],
      ['点一下开始说（试一下）', 'tap'],
    ]) {
      const el = document.querySelector(`button[aria-label="${label}"]`)
      if (el) {
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, mode }
      }
    }
    return null
  })
  if (!spot) return console.warn('  ! 引导第二屏找不到麦克风演示按钮')

  await page.mouse.move(spot.x, spot.y)
  if (spot.mode === 'hold') {
    await page.mouse.down()
    await sleep(ms)
    await page.mouse.up()
  } else {
    // 点一下那套：两下点击。走到这里说明转写没配好（canHoldToTalk = false），
    // 对 `01b-guide-2b-tap` 是预期结果；出现在 `01b-guide-2` 上就要看一眼。
    console.warn('  ! 这一屏走的是「点一下」那套')
    await page.mouse.down()
    await page.mouse.up()
    await sleep(400)
    await page.mouse.down()
    await page.mouse.up()
  }
  // 等字一个个落完
  await sleep(2200)
}

if (!process.env.SEED_ONLY) for (const shot of SHOTS) {
  if (only && !shot.name.includes(only)) continue
  try {
    if (shot.fresh) {
      await page.goto(base, { waitUntil: 'load' })
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          const req = indexedDB.deleteDatabase('little-writer-forest')
          req.onsuccess = req.onerror = req.onblocked = () => resolve()
        })
        localStorage.clear()
      })
      await page.goto(base, { waitUntil: 'load' })
      // 跳过 splash
      await new Promise((r) => setTimeout(r, 2600))
    } else if (shot.guide !== undefined) {
      await seed(shot.tapMode ? GUIDE_TAP_SEED : GUIDE_SEED)
      await page.goto(base, { waitUntil: 'load' })
      await new Promise((r) => setTimeout(r, 2800))
      for (let i = 0; i < shot.guide; i++) {
        if (!(await clickByText('继续'))) console.warn('  ! 找不到「继续」')
        await sleep(700)
      }
      if (shot.holdMic) await holdMic()
    } else {
      await seed()
      await page.goto(base, { waitUntil: 'load' })
      await new Promise((r) => setTimeout(r, 2800))
      if (shot.tab) {
        const clicked = await page.evaluate((label) => {
          const nodes = [...document.querySelectorAll('nav button')]
          const hit = nodes.find((n) => (n.textContent ?? '').includes(label))
          if (hit) {
            hit.click()
            return true
          }
          return false
        }, shot.tab)
        if (!clicked) console.warn(`  ! 找不到 tab「${shot.tab}」`)
        await new Promise((r) => setTimeout(r, 900))
      }
    }

    await page.screenshot({ path: join(OUT, `${shot.name}.png`), fullPage: true })
    console.log('ok ->', `${shot.name}.png`)
  } catch (e) {
    console.error('fail ->', shot.name, e.message)
  }
}

await browser.close()
server.close()
