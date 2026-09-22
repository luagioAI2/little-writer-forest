/**
 * 临时：灌一份「刚装好、什么都还没写」的存档，把空状态逼出来截图。
 * 用完即删。（capture.mjs 灌的是「玩了一阵子」的档，看不到空状态。）
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ROOT = fileURLToPath(new URL('../dist/', import.meta.url))
const OUT = fileURLToPath(new URL('../shots-empty/', import.meta.url))
mkdirSync(OUT, { recursive: true })

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
}

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
const base = `http://127.0.0.1:${server.address().port}/`

/** 空档：onboarded 但什么都还没写 */
const EMPTY_ROWS = {
  meta: [
    {
      key: 'settings',
      value: {
        childName: '朵朵',
        grade: 3,
        avatar: '🦊',
        dailyGoal: 1,
        soundOn: false,
        hapticsOn: false,
        diaryPin: null,
        ai: null,
        onboarded: true,
      },
    },
    { key: 'level', value: { levelIndex: 1, points: 0, updatedAt: Date.now() } },
    { key: 'wallet', value: { coins: 0, totalEarned: 0 } },
    { key: 'streak', value: { days: 0, lastDay: '', best: 0 } },
    {
      key: 'stats',
      value: { works: 0, diaries: 0, words: 0, scored: 0, best: 0, totalCoins: 0, recitations: 0 },
    },
    {
      key: 'tree',
      value: {
        lastTickAt: Date.now(),
        pending: [],
        harvests: 0,
        totalCoins: 0,
        totalCards: 0,
        hollowUnlocked: false,
        hollowDiaries: [],
      },
    },
    { key: 'birds', value: [] },
    { key: 'sprouts', value: [] },
    { key: 'photos', value: [] },
  ],
  cards: [],
  works: [],
  diary: [],
  library: [],
}

const SHOTS = [
  { name: 'e1-compose', tab: '写作文' },
  { name: 'e2-diary', tab: '日记本', sub: '先不设密码，直接看日记' },
  { name: 'e3-tree', tab: '成长树' },
  { name: 'e4-cards', tab: '文心卡' },
  { name: 'e5-map', tab: '旅行图' },
  { name: 'e6-map-birds', tab: '旅行图', sub: '小鸟' },
  { name: 'e7-map-album', tab: '旅行图', sub: '相册' },
]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })

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
      for (const s of ['meta', 'cards', 'works', 'diary', 'library']) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : s === 'cards' ? 'defId' : 'id' })
        }
      }
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
}, EMPTY_ROWS)

for (const shot of SHOTS) {
  try {
    await page.goto(base, { waitUntil: 'load' })
    await new Promise((r) => setTimeout(r, 2800))
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
    if (shot.sub) {
      const hit2 = await page.evaluate((label) => {
        const nodes = [...document.querySelectorAll('button')]
        const hit = nodes.find((n) => (n.textContent ?? '').trim() === label)
        if (hit) {
          hit.click()
          return true
        }
        return false
      }, shot.sub)
      if (!hit2) console.warn(`  ! 找不到子 tab「${shot.sub}」`)
      await new Promise((r) => setTimeout(r, 700))
    }
    await page.screenshot({ path: join(OUT, `${shot.name}.png`), fullPage: true })
    console.log('ok ->', `${shot.name}.png`)
  } catch (e) {
    console.error('fail ->', shot.name, e.message)
  }
}

await browser.close()
server.close()
