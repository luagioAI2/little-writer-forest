/* ============================================================
   验收：我手写的这份题库数据文件，导进去到底对不对
   ============================================================

   跟 `_verify-library-import.mjs` 的分工：
     · 那个是**回归测试**，跑内置的样例数据，验的是导入/渲染的代码逻辑；
     · 这个是**验收你自己的文件**，把你写的 json 真导进 App，
       看每一道题的图有没有真的画出来。

   用法（从临时目录跑，脚本里的 screenshots/ 是相对路径）：

     mkdir -p /c/Users/admin/AppData/Local/Temp/lwf-lib
     cd /c/Users/admin/AppData/Local/Temp/lwf-lib
     LIB_FILE="E:/plan/test25/little-writer-forest/我的题库-测试.json" \
       E2E_URL=http://localhost:5190/ \
       node E:/plan/test25/little-writer-forest/scripts/_verify-library-file.mjs

   会做的事：
     1. 全新存档 → 走完引导 → 打开题库
     2. 用文件选择器把 LIB_FILE 导进去，报出「新增/跳过/坏数据」
     3. 逐道题打开预览，断言每张图 naturalWidth > 0
        （真的解码了，不是只查 DOM —— 图挂了会退回 SVG，DOM 里照样有元素）
     4. 挑第一道题点「就用这题写」，确认写作台上图也在
     5. 截图落在 ./screenshots/
   ============================================================ */

import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'

const URL = process.env.E2E_URL ?? 'http://localhost:5190/'
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const FILE = process.env.LIB_FILE
if (!FILE) {
  console.error('缺少 LIB_FILE —— 例如 LIB_FILE="E:/…/我的题库.json" node scripts/_verify-library-file.mjs')
  process.exit(2)
}
mkdirSync('screenshots', { recursive: true })

/* 先从文件本身读一遍题目标题，用来决定"要点开哪几道题"。
   解析不了就直接把原文抛出去，比在浏览器里瞎点强。 */
let titles = []
try {
  const parsed = JSON.parse(readFileSync(FILE, 'utf8'))
  const items = Array.isArray(parsed) ? parsed : parsed.items
  titles = (items ?? [])
    .map((it) => (typeof it?.title === 'string' ? it.title.trim() : ''))
    .filter(Boolean)
} catch (err) {
  console.error(`LIB_FILE 不是合法 JSON：${err.message}`)
  process.exit(2)
}
if (titles.length === 0) {
  console.error('LIB_FILE 里一道带 title 的题都没有')
  process.exit(2)
}

let pass = 0
let fail = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) {
    pass += 1
    console.log(`  ✅ ${name}`)
  } else {
    fail += 1
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const waitText = async (page, text, timeout = 12000) => {
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

const clickText = (page, text) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll('button, a, [role="button"]')].find((x) =>
      (x.innerText || '').includes(t),
    )
    if (!el) return false
    el.scrollIntoView({ block: 'center' })
    el.click()
    return true
  }, text)

const clickLabel = (page, label) =>
  page.evaluate((l) => {
    const el = document.querySelector(`[aria-label="${l}"]`)
    if (!el) return false
    el.click()
    return true
  }, label)

/* 卡片是 div（onClick 在 div 上），不是 button */
const clickCard = (page, title) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll('div.cursor-pointer')].find((x) =>
      (x.innerText || '').includes(t),
    )
    if (!el) return false
    el.scrollIntoView({ block: 'center' })
    el.click()
    return true
  }, title)

/** 抽屉里所有 <img> 的真实解码尺寸 */
const readImages = (page) =>
  page.evaluate(async () => {
    const list = [...document.querySelectorAll('img')]
    await Promise.all(
      list.map((im) => {
        if (im.complete) return null
        return new Promise((r) => {
          const t = setTimeout(r, 9000)
          im.onload = im.onerror = () => {
            clearTimeout(t)
            r()
          }
        })
      }),
    )
    return list.map((im) => {
      let host = '?'
      try {
        host = new URL(im.src).host
      } catch {
        host = '(相对路径)'
      }
      return { src: im.src.slice(0, 70), w: im.naturalWidth, h: im.naturalHeight, host }
    })
  })

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

console.log(`\n🌐 ${URL}`)
console.log(`📄 ${basename(FILE)}（${titles.length} 道题）\n`)

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })
await sleep(3400)

/* ---------- 引导 ---------- */
if (await page.evaluate(() => /种下我的树|我该怎么叫你|先种一棵树/.test(document.body.innerText))) {
  await clickText(page, '继续')
  await sleep(500)
  await clickText(page, '继续')
  await sleep(500)
  await clickText(page, '种下我的树')
  await sleep(900)
}
check('进入主界面', await waitText(page, '写作文', 8000))

/* ---------- 导入 ---------- */
console.log('\n【导入】')
check('打开题库', await clickLabel(page, '我的作文题库'))
await sleep(700)

const [chooser] = await Promise.all([
  page.waitForFileChooser({ timeout: 6000 }),
  clickText(page, '导入题库'),
])
await chooser.accept([FILE])

const imported = await waitText(page, '导入成功', 8000)
const failedImport = !imported && (await waitText(page, '导入失败', 1500))
check('导入成功（没有报「导入失败」）', imported && !failedImport)

const toastText = await page.evaluate(() => document.body.innerText)
const badLine = toastText.match(/第 \d+ 条：[^\n]+/)
check('没有坏数据被跳过', !badLine, badLine?.[0])
if (badLine) console.log(`     ↳ ${badLine[0]}`)

await sleep(600)
const total = await page.evaluate(() => {
  const lab = [...document.querySelectorAll('div')].find(
    (n) => (n.innerText || '').trim() === '题目总数',
  )
  return lab ? Number((lab.parentElement.innerText || '').split('\n')[0].trim()) : -1
})
check(`题库里是 ${titles.length} 道题`, total === titles.length, `实际 ${total}`)

/* ---------- 逐题看图 ---------- */
console.log('\n【逐题看图】')
for (const title of titles) {
  const opened = await clickCard(page, title)
  await sleep(1100)
  const imgs = await readImages(page)
  const allDecoded = imgs.length > 0 && imgs.every((i) => i.w > 0)
  check(
    `《${title}》的 ${imgs.length} 张图都解码了`,
    opened && allDecoded,
    opened ? JSON.stringify(imgs.map((i) => `${i.host} ${i.w}x${i.h}`)) : '没找到这张卡',
  )
  await page.screenshot({
    path: `screenshots/file-${String(titles.indexOf(title) + 1).padStart(2, '0')}.png`,
  })
  await clickLabel(page, '关闭')
  await sleep(350)
}

/* ---------- 写作台 ---------- */
console.log('\n【写作台】')
await clickCard(page, titles[0])
await sleep(500)
check('抽屉里有「就用这题写」', await clickText(page, '就用这题写'))
await sleep(1800)
check('进了写作台', await waitText(page, '写好了，让树看看', 5000))
const stage = await readImages(page)
check(
  '写作台上图也在（常驻，不藏在抽屉里）',
  stage.some((i) => i.w > 0),
  JSON.stringify(stage.map((i) => `${i.host} ${i.w}x${i.h}`)),
)
await page.screenshot({ path: 'screenshots/file-writing.png' })

/* ---------- 控制台 ---------- */
console.log('\n【控制台】')
/* 图床（Unsplash 等）会对带 referrer 的请求限流，偶尔冒一条连接被掐的报错，
   隔几秒重跑就好 —— 那不算这个文件的毛病。 */
const EXPECTED = /favicon|ERR_CONNECTION_CLOSED|ERR_NAME_NOT_RESOLVED|__missing|404/i
const real = consoleErrors.filter((e) => !EXPECTED.test(e))
check('没有控制台报错', real.length === 0, real.slice(0, 3).join(' | '))

await browser.close()
console.log(`\n${'='.repeat(52)}`)
console.log(`  通过 ${pass} 项，失败 ${fail} 项`)
if (failures.length > 0) {
  console.log('\n  失败清单：')
  for (const f of failures) console.log(`    · ${f}`)
}
console.log(`${'='.repeat(52)}\n`)
process.exit(fail === 0 ? 0 : 1)
