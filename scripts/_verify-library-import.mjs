/* ============================================================
   验收：作文库「导入累加 + 图片路径 + 点题就能写」
   ============================================================

   在真 Chrome 里真点一遍，验三件事：

     1. 从题库点「就用这题」/「随机抽一题」能真的开始写
        （回归：以前跳过去了但停在出题页，什么都做不了）
     2. 导入是累加的：导两个文件，两个文件的内容都在；
        同一份文件导两次不会变成两倍；id 撞车也不覆盖
     3. 手写数据文件里的图片路径（非本地 SVG）能渲染，
        连环图（数组）按顺序排；图挂了要退回兜底、不留破图

   用法（务必从临时目录跑，脚本里的 screenshots/ 是相对路径，
   在项目根跑会覆盖掉那批精修截图）：

     mkdir -p /c/Users/admin/AppData/Local/Temp/lwf-lib
     cd /c/Users/admin/AppData/Local/Temp/lwf-lib
     E2E_URL=http://localhost:5190/ node E:/plan/test25/little-writer-forest/scripts/_verify-library-import.mjs
   ============================================================ */

import puppeteer from 'puppeteer-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL = process.env.E2E_URL ?? 'http://localhost:5190/'
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SHOT_DIR = 'screenshots'
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

async function clickByLabel(page, label) {
  return page.evaluate((l) => {
    const el = document.querySelector(`[aria-label="${l}"]`)
    if (!el) return false
    el.click()
    return true
  }, label)
}

/**
 * 点题库列表里的一张卡。
 * 卡片是个 div（onClick 在 div 上），不是 button —— 所以不能用 clickByText。
 */
async function clickCard(page, title) {
  return page.evaluate((t) => {
    const els = [...document.querySelectorAll('div.cursor-pointer')]
    const el = els.find((x) => (x.innerText || '').includes(t))
    if (!el) return false
    el.scrollIntoView({ block: 'center' })
    el.click()
    return true
  }, title)
}

/**
 * 读统计卡片的数字。
 * StatBox 是「数字在上、标签在下」两行，所以不能拿 innerText 去正着匹配。
 */
async function readStat(page, label) {
  return page.evaluate((l) => {
    const nodes = [...document.querySelectorAll('div')]
    const lab = nodes.find((n) => (n.innerText || '').trim() === l)
    if (!lab) return -1
    const box = lab.parentElement
    const value = box ? (box.innerText || '').split('\n')[0].trim() : ''
    return Number(value)
  }, label)
}

/** 打开某道题的预览抽屉，并返回抽屉里所有 <img> 的状态 */
async function openPreviewAndReadImages(page, title) {
  const opened = await clickCard(page, title)
  if (!opened) return { opened: false, imgs: [] }
  await sleep(900)
  const imgs = await page.evaluate(async () => {
    const list = [...document.querySelectorAll('img')]
    await Promise.all(
      list.map((im) => (im.complete ? null : new Promise((r) => (im.onload = im.onerror = r)))),
    )
    return list.map((im) => ({ src: im.src, w: im.naturalWidth }))
  })
  return { opened: true, imgs }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------- 手写「文库数据」 ---------------- */

/* 图片用 data URL 是为了让「图真的解码了」这条断言稳定 ——
   不依赖任何外部图床，跑几遍也不会撞限流。
   两张颜色不同的 SVG，顺带验「连环图的顺序」。 */
const svgImg = (color) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="${color}"/></svg>`,
  )}`
const IMG_A = svgImg('#d94f4f')
const IMG_B = svgImg('#4f6fd9')

/** 文件 A：纯数组 + 图片路径（连环图 / 单图 / 内置 SVG / 坏地址） */
const FILE_A = [
  {
    id: 'a-1',
    category: '写景', // 故意写中文，验别名
    title: '连环图那道（导入）',
    lead: '三幅画讲的是一件事，按顺序看看发生了什么？',
    wordRange: [100, 300],
    minGrade: 3,
    maxGrade: 6,
    // 连环图 = 数组，两张，顺序就是翻页顺序
    images: [IMG_A, IMG_B],
  },
  {
    id: 'a-2',
    category: 'event',
    title: '能加载出来的图（导入）',
    lead: '这张图里有几个小朋友？他们在做什么？',
    // 对象写法 + sceneKey 兜底
    images: [{ imageUrl: IMG_A, sceneKey: 'rain-window', caption: '第一幅' }],
  },
  {
    id: 'a-3',
    category: 'scene',
    title: '只用内置插画（导入）',
    lead: '看看这张画，远处和近处分别有什么？',
    images: [{ sceneKey: 'spring-park' }],
  },
  {
    id: 'a-4',
    category: 'scene',
    title: '图挂了要退兜底（导入）',
    lead: '这张图的地址是坏的，应该退回内置插画。',
    // 相对路径 + 同源 404：会很快触发 onError，正好验兜底
    images: [{ imageUrl: '/__missing-1.png', sceneKey: 'rainbow' }],
  },
]

/** 文件 B：id 故意和 A 撞车 —— 用来验「撞车也不覆盖」 */
const FILE_B = [
  {
    id: 'a-1',
    category: 'person',
    title: 'B 文件的题（id 和 A 撞了）',
    lead: '写一个你熟悉的人。',
  },
]

const A_COUNT = FILE_A.length

const tmp = join(tmpdir(), 'lwf-lib-data')
mkdirSync(tmp, { recursive: true })
const fileA = join(tmp, 'lib-a.json')
const fileB = join(tmp, 'lib-b.json')
writeFileSync(fileA, JSON.stringify(FILE_A, null, 2), 'utf8')
writeFileSync(fileB, JSON.stringify(FILE_B, null, 2), 'utf8')

/* ---------------- 主流程 ---------------- */

const consoleErrors = []

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=414,896'],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 414, height: 896, deviceScaleFactor: 2, isMobile: true })

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(`PAGEERROR: ${err.message}`))

  console.log(`\n🌐 打开 ${URL}\n`)
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })

  // Splash 2 秒
  await sleep(3400)

  /* ---------- 0. 引导 ---------- */
  const seenOnboarding = await page.evaluate(() =>
    /种下我的树|我该怎么叫你|先种一棵树/.test(document.body.innerText),
  )
  if (seenOnboarding) {
    await clickByText(page, '继续')
    await sleep(500)
    await clickByText(page, '继续')
    await sleep(500)
    await clickByText(page, '种下我的树')
    await sleep(900)
  }
  check('进入主界面', await waitForText(page, '写作文', 8000))

  /* ---------- 1. 打开题库 ---------- */
  console.log('\n【1】打开我的作文题库')
  check('顶栏有题库入口', await clickByLabel(page, '我的作文题库'))
  await sleep(700)
  check('题库页打开了', await waitForText(page, '我的作文题库', 5000))
  check('空题库有提示', await waitForText(page, '题库还是空的', 3000))

  /* ---------- 2. 导入文件 A ---------- */
  console.log(`\n【2】导入手写数据文件 A（${A_COUNT} 道题，含图片路径）`)
  const importOnce = async (path) => {
    const [chooser] = await Promise.all([
      page.waitForFileChooser({ timeout: 6000 }),
      clickByText(page, '导入题库'),
    ])
    await chooser.accept([path])
  }

  await importOnce(fileA)
  check('导入 A 后提示成功', await waitForText(page, '导入成功', 8000))
  await sleep(400)
  const afterA = await readStat(page, '题目总数')
  check(`题库里多了 ${A_COUNT} 道题`, afterA === A_COUNT, `题目总数 = ${afterA}`)

  /* ---------- 3. 再导一次 A：应该全部跳过 ---------- */
  console.log('\n【3】同一份文件再导一次（应该一条都不多）')
  await importOnce(fileA)
  check('提示里出现「跳过」', await waitForText(page, `跳过 ${A_COUNT} 题`, 8000))
  await sleep(400)
  const afterA2 = await readStat(page, '题目总数')
  check(`题库还是 ${A_COUNT} 道（没有翻倍）`, afterA2 === A_COUNT, `题目总数 = ${afterA2}`)

  /* ---------- 4. 导入文件 B（id 和 A 撞车） ---------- */
  console.log('\n【4】导入文件 B（id 故意和 A 撞车）')
  await importOnce(fileB)
  check('导入 B 后提示成功', await waitForText(page, '导入成功', 8000))
  await sleep(400)
  const afterB = await readStat(page, '题目总数')
  check(`题库变成 ${A_COUNT + 1} 道（累加，没有覆盖）`, afterB === A_COUNT + 1, `题目总数 = ${afterB}`)
  const bothPresent = await page.evaluate(() => {
    const t = document.body.innerText
    return t.includes('B 文件的题') && t.includes('连环图那道（导入）')
  })
  check('A、B 两个文件的题都在（撞车的那条没被顶掉）', bothPresent)

  await page.screenshot({ path: `${SHOT_DIR}/lib-01-list.png` })

  /* ---------- 5. 图片路径真的渲染 ---------- */
  console.log('\n【5】配图渲染：连环图顺序 / 图片解码 / 挂了要退兜底')

  // 5a. 连环图：两张都要在，而且顺序和数组一致
  const chain = await openPreviewAndReadImages(page, '连环图那道（导入）')
  check('点开连环图那条', chain.opened)
  check(
    '连环图按数组顺序渲染两张',
    chain.imgs.length === 2 && chain.imgs[0].src === IMG_A && chain.imgs[1].src === IMG_B,
    JSON.stringify(chain.imgs.map((i) => i.src.slice(0, 34))),
  )
  check(
    '两张图都真的解码了（naturalWidth > 0）',
    chain.imgs.length === 2 && chain.imgs.every((i) => i.w > 0),
    JSON.stringify(chain.imgs.map((i) => i.w)),
  )
  await page.screenshot({ path: `${SHOT_DIR}/lib-02-chain.png` })
  await clickByLabel(page, '关闭')
  await sleep(400)

  // 5b. 单图 + caption
  const single = await openPreviewAndReadImages(page, '能加载出来的图（导入）')
  check('单图也解码了', single.imgs.length === 1 && single.imgs[0].w > 0)
  check('图下面的说明文字是文件里写的 caption', await waitForText(page, '第一幅', 3000))
  await page.screenshot({ path: `${SHOT_DIR}/lib-03-photo.png` })
  await clickByLabel(page, '关闭')
  await sleep(400)

  // 5c. 坏地址：应该退回 sceneKey 的 SVG，不留破图标
  await clickCard(page, '图挂了要退兜底（导入）')
  await sleep(1600)
  const fallback = await page.evaluate(() => ({
    brokenImgsLeft: [...document.querySelectorAll('img')].filter((i) => i.src.includes('__missing'))
      .length,
    svgCount: document.querySelectorAll('svg').length,
    hasBrokenIcon: [...document.querySelectorAll('img')].some(
      (i) => i.complete && i.naturalWidth === 0,
    ),
  }))
  check('坏地址的 <img> 被换掉、退回兜底插画', fallback.brokenImgsLeft === 0, JSON.stringify(fallback))
  check('兜底插画画出来了', fallback.svgCount > 0)
  check('页面上没有残留的破图标', !fallback.hasBrokenIcon)
  await page.screenshot({ path: `${SHOT_DIR}/lib-04-fallback.png` })
  await clickByLabel(page, '关闭')
  await sleep(400)

  /* ---------- 6. 核心：点「就用这题」能真的开始写 ---------- */
  console.log('\n【6】点「就用这题」→ 真的进写作台（回归重点）')
  check('点开目标题', await clickCard(page, '只用内置插画（导入）'))
  await sleep(500)
  check('预览抽屉里有「就用这题写」', await clickByText(page, '就用这题写'))
  await sleep(1500)

  const onWriteStage = await page.evaluate(() => document.body.innerText.includes('写好了，让树看看'))
  const stillSetup = await page.evaluate(() => document.body.innerText.includes('今天写什么'))
  check('进到写作台了', onWriteStage)
  check('没有停在出题页（回归：以前会停在这里）', !stillSetup)
  check(
    '写作台上挂的正是选中的那道题',
    await page.evaluate(() => document.body.innerText.includes('只用内置插画（导入）')),
  )
  check(
    '写作台上那道题的内置插画也画出来了',
    await page.evaluate(() => document.querySelectorAll('.scene-ink svg').length > 0),
  )
  await page.screenshot({ path: `${SHOT_DIR}/lib-05-writing.png` })

  /* ---------- 7. 返回题库，随机抽一题 ---------- */
  console.log('\n【7】返回题库，随机抽一题也要能写')
  await clickByText(page, '退出')
  await sleep(1400)
  check('退出后回到出题页', await waitForText(page, '今天写什么', 5000))

  check('顶栏题库入口还在', await clickByLabel(page, '我的作文题库'))
  await sleep(700)
  check('点了「随机抽一题」', await clickByText(page, '随机抽一题'))
  await sleep(700)
  check('抽屉里有「就用这题写」', await clickByText(page, '就用这题写'))
  await sleep(1600)
  check(
    '随机抽的题也能直接进写作台',
    await page.evaluate(() => document.body.innerText.includes('写好了，让树看看')),
  )
  await page.screenshot({ path: `${SHOT_DIR}/lib-06-random.png` })

  /* ---------- 8. 控制台 ---------- */
  console.log('\n【8】控制台')
  /* 文件 A 里那条 /__missing-1.png 是**故意指向不存在的文件**，
     用来验「图挂了要退回兜底插画」。它必然在控制台留下一条 404 ——
     那是被测行为本身，不是缺陷。 */
  const EXPECTED = /favicon|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_CLOSED|404|__missing/i
  const realErrors = consoleErrors.filter((e) => !EXPECTED.test(e))
  check('没有意外的控制台报错', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

  await browser.close()

  console.log(`\n${'='.repeat(52)}`)
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`)
  if (failures.length > 0) {
    console.log('\n  失败清单：')
    for (const f of failures) console.log(`    · ${f}`)
  }
  console.log(`${'='.repeat(52)}\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\n💥 脚本崩了：', err)
  process.exit(1)
})
