/* ============================================================
   验证「内容配置」这一页（content-config.html）
   ------------------------------------------------------------
   跑法：node scripts/_verify-content-config.mjs
   ⚠️ 需要 dev server 在 5190（两个子页都要读 TS 模块、fetch JSON）。

   守的是**这一层新加的东西**（子页自己的行为由它们各自的脚本负责）：
     · 两个工具能切、**切走不卸载**（没保存的改动不能丢）
     · 子页把"没保存"报上来 → 对应标签亮小圆点（在别的标签上也看得见）
     · 关标签页的守卫由**这一页**挂（iframe 里的 beforeunload 弹不出来）
     · 三层那条路 shell → landmarks-browse → travel-editor 真的通

   ★★ 这个脚本**全程不写盘** —— 只用「改一个字 → 看圆点亮 → 按恢复原文」
      来制造和清掉"脏"状态，一次都不按「保存」。
      （对比 `_verify-library-editor.mjs`：那个要验落盘，所以必须先备份再还原。）
      末尾会断言两个数据文件字节没变，证明上面这句是真的。
   ============================================================ */

import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = process.env.E2E_URL ?? 'http://localhost:5190'
const URL = `${BASE}/content-config.html`
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SHOT_DIR = process.env.SHOT_DIR ?? '.'
mkdirSync(SHOT_DIR, { recursive: true })

const LIB_FILE = resolve(process.cwd(), 'src/data/library-items.json')
const CONTENTS_FILE = resolve(process.cwd(), 'src/data/travel-contents.json')

const DATA = (f) => JSON.parse(readFileSync(resolve(process.cwd(), 'src/data', f), 'utf8'))

/*
 * ★★ 旅游点那一屏的总数**从数据现算**，不写死（跟 `_verify-browse-edit.mjs` 同一套）。
 *    09-25 主库按「只留 5A / 全国知名 / 世界知名」收窄之后，写死的绝对数必然要改 ——
 *    而"把数字改小让它变绿"会把守卫调哑。
 * ⚠️ 这里**不重算"哪条算知名"** —— 那个判定只有 `fameOf()` 一份；
 *    移出的结果已经落在 `landmarks-4a.json` 的 `count` 里，直接读。
 */
const CN_HDR = DATA('landmarks-cn.json')
const PARKED_HDR = DATA('landmarks-4a.json')
const SOURCE_TOTAL =
  DATA('landmarks.json').length +
  DATA('landmarks-gd.json').items.length +
  CN_HDR.items.length +
  DATA('landmarks-world.json').items.length -
  CN_HDR.supersedes.length
const LM_COUNT = SOURCE_TOTAL - PARKED_HDR.count

/* 内置题数 —— ⚠️ **别在这里写死**：家长会往题库里加题。
   期望值改成在页面里 `import('/src/domain/builtinLibrary.ts')` 现算
   （跟 `_verify-library-editor.mjs` 同一个口径）。 */

/* 已经有内容的景点（拿它验三层那条路：抽屉里的编辑器得有字段可改） */
const WITH_CONTENT = DATA('travel-contents.json')
  .filter((c) => c.landmarkId).map((c) => c.landmarkId)

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 外壳上的状态：两个标签的选中/小圆点、地址栏 hash、已建/在显示的 iframe */
const tabState = (page) => page.evaluate(() => {
  const tabs = {}
  for (const b of document.querySelectorAll('.tab')) {
    tabs[b.dataset.tool] = {
      on: b.classList.contains('on'),
      dot: !b.querySelector('.dot').hidden,
    }
  }
  const fs = [...document.querySelectorAll('.stage iframe')]
  return {
    tabs,
    hash: location.hash,
    frames: fs.map((f) => f.dataset.tool),
    visible: fs.filter((f) => getComputedStyle(f).display !== 'none').map((f) => f.dataset.tool),
  }
})

const frameByUrl = (page, part) => page.frames().find((f) => f.url().includes(part))

/**
 * 手动派发一次 `beforeunload`，返回它有没有被 `preventDefault()` 拦住。
 *
 * ★ 为什么不用真关标签页去测：那要么依赖原生对话框（headless 里不好断言），
 *   要么把页面真关掉、后面没法继续测。这里测的是**守卫的判据**：
 *   "有改动 → 拦；没改动 → 不拦"。
 * ⚠️ 事件必须 `cancelable: true`，否则 `preventDefault()` 是空操作，
 *   两种情况下都返回 false —— 一条**永远绿**的假守卫。
 */
const fireBeforeUnload = (target) => target.evaluate(() => {
  const ev = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(ev)
  return ev.defaultPrevented
})

/**
 * 往一个（可能是嵌套的）输入框里**整段替换**文字。
 * ⚠️ 别用 `click(sel, { clickCount: 3 })` —— 实测它选不中已有内容，
 *    于是新文字**接在后面**，后面每一条断言都跟着错（症状看起来像"功能坏了"）。
 */
async function setInputIn(page, frame, sel, text) {
  await frame.click(sel)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  if (text) await frame.type(sel, text)
  await sleep(250)
}

async function main() {
  const before = {
    lib: readFileSync(LIB_FILE, 'utf8'),
    contents: readFileSync(CONTENTS_FILE, 'utf8'),
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })

  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`))

  /*
   * ⚠️⚠️ 原生弹窗**只能有一个** `page.on('dialog')` 处理器 ——
   *    注册第二个的话两个都会去 accept，第二个就抛
   *    `Cannot accept dialog which is already handled!`，脚本直接崩。
   *    而 headless 里不 accept 就会**静默挂死**（跑满超时被 SIGTERM）。
   * ★ 关抽屉时会弹 confirm（"有未保存的改动"），所以这里必须接住。
   */
  const dialogs = []
  page.on('dialog', (d) => {
    dialogs.push({ type: d.type(), message: d.message() })
    d.accept()
  })

  // 控制台那条 404 不带 URL —— 单独收响应才查得出是哪个资源
  const badRequests = []
  page.on('response', (r) => {
    if (r.status() >= 400) badRequests.push(`${r.status()} ${r.url()}`)
  })

  console.log(`\n🌐 ${URL}\n`)

  try {
    /* ---------- ① 打开：默认第一个工具 ---------- */
    console.log('【1】打开：默认就是第一个工具')
    await page.goto(URL, { waitUntil: 'domcontentloaded' })
    await sleep(1200)

    const boot = await tabState(page)
    check('标签栏有两个工具', Object.keys(boot.tabs).length === 2, JSON.stringify(boot.tabs))
    check('默认打开「旅游点配置」',
      boot.tabs.travel.on === true && boot.tabs.library.on === false,
      JSON.stringify(boot.tabs))
    check('★ 地址栏补上了 #travel（刷新 / 收藏都能回到这一屏）', boot.hash === '#travel', boot.hash)
    check('★ 没打开的那个工具**先不建 iframe**（省一次全库加载）',
      boot.frames.join(',') === 'travel', boot.frames.join(','))
    check('同一时刻只显示一个 iframe', boot.visible.join(',') === 'travel', boot.visible.join(','))

    const travel = await page.waitForFrame(
      (f) => f.url().includes('landmarks-browse.html'), { timeout: 25000 })
    await travel.waitForFunction(
      (n) => document.querySelectorAll('#result .item').length >= n, { timeout: 30000 }, LM_COUNT,
    ).catch(() => {})
    await sleep(500)
    const travelBoot = await travel.evaluate(() => ({
      cards: document.querySelectorAll('#result .item').length,
      firstStat: document.querySelector('#stats .stat b')?.textContent,
    }))
    check(`旅游点那一屏真的加载出来了（${LM_COUNT} 条）`,
      travelBoot.cards === LM_COUNT, JSON.stringify(travelBoot))
    check('（前提）统计条上的总数跟卡片数一致',
      String(travelBoot.cards) === String(travelBoot.firstStat),
      `${travelBoot.cards} vs ${travelBoot.firstStat}`)
    check('（前提）现在没有改动 → 关标签页不该被拦',
      (await fireBeforeUnload(page)) === false)

    await page.screenshot({ path: `${SHOT_DIR}/_config-1-travel.png` })

    /* ---------- ② 切到第二个工具 ---------- */
    console.log('\n【2】切到「作文库配置」')
    /*
     * ★ 先在旅游点那一屏留一个记号 —— 用它证明"切走**没卸载**"。
     *   卸载（重设 src / remove iframe）会把整个 JS 环境换掉，记号就没了。
     */
    await travel.evaluate(() => { window.__lwMark = 42 })

    await page.click('.tab[data-tool="library"]')
    await sleep(1300)
    const sw = await tabState(page)
    check('切过去：标签的选中态跟着走',
      sw.tabs.library.on === true && sw.tabs.travel.on === false, JSON.stringify(sw.tabs))
    check('★ 地址栏变成 #library', sw.hash === '#library', sw.hash)
    check('★ 作文库的 iframe 这时候才建出来（惰性）',
      sw.frames.includes('library'), sw.frames.join(','))
    check('现在显示的是作文库那一屏', sw.visible.join(',') === 'library', sw.visible.join(','))
    check('★★ 旅游点那一屏**还在**（藏起来，不是卸载）',
      sw.frames.includes('travel'), sw.frames.join(','))

    const lib = await page.waitForFrame(
      (f) => f.url().includes('library-browse.html'), { timeout: 25000 })
    await lib.waitForFunction(
      () => document.getElementById('n-show')?.textContent !== '…', { timeout: 30000 })
    await sleep(700)
    const libBoot = await lib.evaluate(async () => ({
      cards: document.querySelectorAll('.item').length,
      total: document.getElementById('s-total')?.textContent,
      first: document.querySelector('.item .nm')?.textContent,
      // ⚠️ 期望值**从数据算**，别写死数字
      expected: (await import('/src/domain/builtinLibrary.ts')).builtinCount(),
    }))
    check(`作文库那一屏也真的加载出来了（${libBoot.expected} 道）`,
      libBoot.cards === libBoot.expected, JSON.stringify(libBoot))
    check('（前提）第一道是底稿的第一条（春天的公园）', libBoot.first === '春天的公园', libBoot.first)

    /* ---------- ③ 切回去：状态必须原样还在 ---------- */
    console.log('\n【3】切回「旅游点配置」—— 那一屏的状态必须原样还在')
    await page.click('.tab[data-tool="travel"]')
    await sleep(700)
    const back = await tabState(page)
    check('又回到旅游点那一屏', back.visible.join(',') === 'travel', back.visible.join(','))
    const mark = await travel.evaluate(() => window.__lwMark ?? null).catch(() => 'FRAME_GONE')
    check('★★ 那一屏的 JS 状态还在（记号 = 42）—— 切走时**没有重载**',
      mark === 42, String(mark))
    check('★ 还是同一个 frame 对象（没换一个 iframe 重新加载）',
      frameByUrl(page, 'landmarks-browse.html') === travel)

    /* ---------- ④ 后退能回到上一个工具 ---------- */
    console.log('\n【4】浏览器「后退」回到上一个工具')
    await page.evaluate(() => history.back())
    await sleep(900)
    const nav = await tabState(page)
    check('后退回到作文库那一屏',
      nav.hash === '#library' && nav.visible.join(',') === 'library',
      `${nav.hash} | ${nav.visible.join(',')}`)

    /* ---------- ⑤ 改一个字 → 标签亮小圆点 ---------- */
    console.log('\n【5】★★ 作文库里改一个字 → 对应标签亮小圆点（在别的标签上也看得见）')
    const clean0 = await tabState(page)
    check('（前提）还没动过 → 两个标签都不亮',
      !clean0.tabs.travel.dot && !clean0.tabs.library.dot, JSON.stringify(clean0.tabs))

    await lib.click('.item')
    await sleep(400)
    await setInputIn(page, lib, '#f-title', '春天的公园（内容配置验证）')

    const dirtyLib = await tabState(page)
    check('★★ 作文库改了 → 它的标签亮起小圆点', dirtyLib.tabs.library.dot === true,
      JSON.stringify(dirtyLib.tabs))
    check('（对照）旅游点那个标签没被误点亮', dirtyLib.tabs.travel.dot === false)
    check('（前提）子页自己也认为有未保存的改动',
      (await lib.evaluate(() => document.getElementById('s-unsaved')?.textContent)) === '1')

    // 切走 —— 圆点必须**留在**标签上，这正是它存在的意义
    await page.click('.tab[data-tool="travel"]')
    await sleep(600)
    const away = await tabState(page)
    check('★★ 切到旅游点之后，作文库标签上的小圆点**还在**（不然切走就忘了）',
      away.tabs.library.dot === true, JSON.stringify(away.tabs))
    check('★ 切走**不会**丢改动：子页里还是"有 1 道没保存"',
      (await lib.evaluate(() => document.getElementById('s-unsaved')?.textContent)) === '1')

    /* ---------- ⑥ 关标签页的守卫 ---------- */
    console.log('\n【6】★★ 关标签页的守卫由**这一页**挂')
    check('★★ 有没保存的改动时，父页拦住了关闭',
      (await fireBeforeUnload(page)) === true)
    check('★ 子页自己的守卫在嵌入时是**哑的**（免得连问两遍；父页那份才作数）',
      (await fireBeforeUnload(lib)) === false)
    check('★ 同理旅游点那一屏自己的守卫也是哑的',
      (await fireBeforeUnload(travel)) === false)

    await page.screenshot({ path: `${SHOT_DIR}/_config-2-library-dirty.png` })

    /* ---------- ⑦ 撤回 → 圆点灭、守卫松开 ---------- */
    console.log('\n【7】撤回改动 → 圆点灭、守卫松开')
    await page.click('.tab[data-tool="library"]')
    await sleep(500)
    await lib.click('#revert')
    await sleep(500)
    const reverted = await tabState(page)
    check('★ 撤回后小圆点灭了', reverted.tabs.library.dot === false,
      JSON.stringify(reverted.tabs))
    check('★ 守卫也松开了（没改动就不该拦）', (await fireBeforeUnload(page)) === false)

    /* ---------- ⑧ ★★ 三层：shell → landmarks-browse → travel-editor ---------- */
    console.log('\n【8】★★ 三层那条路：抽屉里改一个字，最外层标签要亮')
    await page.click('.tab[data-tool="travel"]')
    await sleep(600)

    const target = WITH_CONTENT[0]
    const opened = await travel.evaluate((id) => {
      const card = document.querySelector(`#result .item[data-id="${id}"]`)
      if (!card) return false
      card.click()
      return true
    }, target)
    check(`（前提）旅游点那一屏找得到「${target}」这张卡片（它已经配了内容）`,
      opened === true, `内容包里的地标：${WITH_CONTENT.join(', ')}`)

    const ed = await page.waitForFrame(
      (f) => f.url().includes('travel-editor.html'), { timeout: 25000 })
    await ed.waitForSelector('[data-k="summary"]', { timeout: 25000 })
    await sleep(500)
    const preDeep = await tabState(page)
    check('（前提）刚打开抽屉还不算改动 → 旅游点标签不亮',
      preDeep.tabs.travel.dot === false, JSON.stringify(preDeep.tabs))

    await ed.evaluate(() => {
      const el = document.querySelector('[data-k="summary"]')
      el.value = el.value + '（验证）'
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(700)
    const deep = await tabState(page)
    check('★★★ 抽屉里改一个字 → 一路报到**最外层**的标签上（三层都通了）',
      deep.tabs.travel.dot === true, JSON.stringify(deep.tabs))
    check('（对照）作文库那个标签没被误点亮', deep.tabs.library.dot === false)
    check('★ 中间那一层（抽屉标题上那句"有未保存的改动"）也亮了 —— 说明是**穿过**它报上去的，不是绕过它',
      (await travel.evaluate(() => !document.getElementById('dwDirty').hidden)) === true)
    check('★★ 这时关标签页也会被拦（旅游点那边的改动同样不能丢）',
      (await fireBeforeUnload(page)) === true)

    await page.screenshot({ path: `${SHOT_DIR}/_config-3-travel-dirty.png` })

    /* ---------- ⑨ 关抽屉（会弹确认）→ 圆点灭 ---------- */
    console.log('\n【9】关掉抽屉（会弹"有未保存的改动"）→ 圆点灭')
    dialogs.length = 0
    await travel.click('#dwClose')
    await sleep(900)
    const closedDeep = await tabState(page)
    check('关抽屉前弹了确认（全局处理器已 accept）',
      dialogs.some((d) => d.type === 'confirm' && /未保存/.test(d.message)),
      JSON.stringify(dialogs))
    check('关掉之后旅游点标签的小圆点灭了',
      closedDeep.tabs.travel.dot === false, JSON.stringify(closedDeep.tabs))
    check('守卫也松开', (await fireBeforeUnload(page)) === false)

    /* ---------- ⑩ 收尾 ---------- */
    console.log('\n【10】收尾')
    const faviconOnly = badRequests.length > 0 && badRequests.every((u) => /favicon/i.test(u))
    const real = errors.filter(
      (e) => !/DevTools/i.test(e) && !(faviconOnly && /Failed to load resource/.test(e)))
    check('没有控制台报错（favicon 那条除外）', real.length === 0, real.slice(0, 3).join(' | '))
    const bad2 = badRequests.filter((u) => !/favicon/i.test(u))
    check('没有 favicon 以外的 4xx/5xx 请求', bad2.length === 0, bad2.slice(0, 3).join(' | '))
    check('★★ 这个脚本**一个字都没写盘**（library-items.json 字节没变）',
      readFileSync(LIB_FILE, 'utf8') === before.lib)
    check('★★ travel-contents.json 也没变',
      readFileSync(CONTENTS_FILE, 'utf8') === before.contents)
  } finally {
    await browser.close()
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`)
  if (failures.length) {
    console.log('失败项：')
    for (const f of failures) console.log(`  · ${f}`)
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('脚本自己炸了：', e)
  process.exit(1)
})
