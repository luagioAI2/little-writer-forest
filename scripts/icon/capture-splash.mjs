/**
 * 临时：把 build 出来的 App 打开，在开场画面还挂着的时候截一张，
 * 用来确认新的圆形图标放在墨夜底上好不好看。
 * 用法：node scripts/icon/capture-splash.mjs
 */
import puppeteer from 'puppeteer-core'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ROOT = fileURLToPath(new URL('../../dist/', import.meta.url))
const OUT = fileURLToPath(new URL('../../assets/icon/', import.meta.url))
mkdirSync(OUT, { recursive: true })

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
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

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })

const shots = []
for (const delay of [0, 300]) {
  const p = await browser.newPage()
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  // 截图本身要几百毫秒，等 520ms 的开场早就切走了。
  // 这里只把开场那一句 setTimeout(…, 520) 拉长，别的定时器不动，
  // 纯粹是为了能拍到这一帧（只影响截图，不影响 App 行为）。
  await p.evaluateOnNewDocument(() => {
    const orig = window.setTimeout
    window.setTimeout = function (fn, ms, ...rest) {
      if (ms === 520) return orig(fn, 60000, ...rest)
      return orig(fn, ms, ...rest)
    }
  })
  await p.goto(base, { waitUntil: 'load' })
  await new Promise((r) => setTimeout(r, delay))
  const name = `splash-${delay}ms.png`
  await p.screenshot({ path: join(OUT, name) })
  shots.push(name)
  console.log(`  ${name}`)
  await p.close()
}

await browser.close()
server.close()
console.log('done ->', shots.map((s) => s.name).join(', '))
