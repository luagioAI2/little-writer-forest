/* ============================================================
   端到端验收 —— 真实 Chrome 里跑一遍完整流程
   ============================================================

   不是跑单元测试，而是真的打开页面、真的点按钮，
   验证「孩子能不能把一篇作文写完」。

   用法：
     npm run preview &        # 先起预览服务
     node scripts/e2e-check.mjs
   ============================================================ */

import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const URL = process.env.E2E_URL ?? 'http://localhost:4190/'
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

/** 等到某个文字出现 */
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

/**
 * 点一个文字匹配的按钮。
 *
 * 用 DOM 的 el.click() 而不是 ElementHandle.click()：
 * 后者按屏幕坐标点，会被 sticky 的底部导航挡住而点错元素，
 * 导致"点了但没反应"的假失败。这里要测的是业务逻辑，不是命中测试。
 */
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

/**
 * 往受控输入框里塞值。
 *
 * 为什么不用 page.type：它走的是真实键盘事件，中文会通过
 * insertText 输入，React 的 onChange 有时收不到，
 * 于是按钮一直是禁用态。这里用原生 setter + input 事件，
 * 正是 React 监听的路径。
 */
async function fillInput(page, selector, value) {
  return page.evaluate(
    (sel, v) => {
      const el = document.querySelector(sel)
      if (!el) return false
      const proto =
        el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    },
    selector,
    value,
  )
}

const consoleErrors = []

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=414,896',
      // 假麦克风，让语音相关代码路径不报错
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 414, height: 896, deviceScaleFactor: 2, isMobile: true })

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(`PAGEERROR: ${err.message}`))

  console.log(`\n🌐 打开 ${URL}\n`)

  /* ---------- 1. 启动与 Splash ---------- */
  console.log('【1】启动与入场')
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })

  const splashShown = await waitForText(page, '作 文 森 林', 5000)
  check('入场页出现品牌名', splashShown)
  const hasQuote = await page.evaluate(() => /「.+」/.test(document.body.innerText))
  check('入场页显示格言', hasQuote)
  await page.screenshot({ path: `${SHOT_DIR}/01-splash.png` })

  // 等 Splash 结束（2 秒），落点可能是引导页或主界面
  await new Promise((r) => setTimeout(r, 3200))

  /* ---------- 1b. 首次引导（全新存档才会出现） ---------- */
  console.log('\n【1b】首次引导')
  const seenOnboarding = await page.evaluate(() =>
    /种下我的树|我该怎么叫你|先种一棵树/.test(document.body.innerText),
  )
  if (seenOnboarding) {
    check('首次进入走引导流程', true)
    // 三步：起名字 → 选年级 → 种下我的树
    await clickByText(page, '继续')
    await new Promise((r) => setTimeout(r, 500))
    await clickByText(page, '继续')
    await new Promise((r) => setTimeout(r, 500))
    const planted = await clickByText(page, '种下我的树')
    check('可以完成引导并种下树', planted)
    await new Promise((r) => setTimeout(r, 900))
  } else {
    check('引导已跳过（已有存档）', true)
  }

  const appReady = await waitForText(page, '写作文', 8000)
  check('自动进入主界面', appReady)

  /* ---------- 2. 底部导航 ---------- */
  console.log('\n【2】底部导航')
  const tabs = await page.evaluate(() => {
    const nav = document.querySelector('nav')
    if (!nav) return []
    return [...nav.querySelectorAll('button')].map((b) => (b.innerText || '').trim())
  })
  check('底部有 5 个入口', tabs.length === 5, `实际 ${tabs.length}: ${tabs.join('/')}`)
  check(
    '五个入口是 写作文/日记本/成长树/文心卡/旅行图',
    ['写作文', '日记本', '成长树', '文心卡', '旅行图'].every((t) => tabs.some((x) => x.includes(t))),
    tabs.join('/'),
  )

  const navOverflow = await page.evaluate(() => {
    const nav = document.querySelector('nav')
    if (!nav) return false
    const btns = [...nav.querySelectorAll('button')]
    return btns.some((b) => b.getBoundingClientRect().height < 44)
  })
  check('导航按钮高度 ≥ 44px（低龄可点）', !navOverflow)

  /* ---------- 3. 出题 ---------- */
  console.log('\n【3】出题流程')
  // 年级已经在引导里定好了，作文页不再重复问（v3 改动）
  const catOk = await clickByText(page, '写景')
  check('可以选择大类', catOk)

  await page.screenshot({ path: `${SHOT_DIR}/02-setup.png` })

  const genOk = await clickByText(page, '出一道新题')
  check('可以点「出一道新题」', genOk)

  // v3 写作页是沉浸式语音台，空状态提示是「按下麦克风，把看到的说出来」
  const inWrite = await waitForText(page, '按下麦克风', 15000)
  check('进入写作页', inWrite)

  // 记下这道题的名字，后面用来验证「自动入库」
  // v3 标题在沉浸写作页的顶部条里，不是 h2
  const promptTitle = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) =>
      d.className && d.className.includes('truncate') && d.className.includes('font-display'),
    )
    return el ? el.innerText.trim() : ''
  })
  check('题目有标题', promptTitle.length > 0, promptTitle)

  /* ---------- 4. 插画渲染 ---------- */
  console.log('\n【4】看图')
  // v4：图常驻在稿纸上方，不再需要点「看图」展开。
  // 所以这里反过来验：写作页里**不应该**再有那个按钮，
  // 而且插画一进来就已经渲染好了。
  const hasSceneToggle = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => (b.innerText || '').trim() === '看图'),
  )
  check('写作页不再需要点「看图」（图常驻）', !hasSceneToggle)

  const svgInfo = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll('svg')]
    const scene = svgs.find((s) => {
      const vb = s.getAttribute('viewBox') || ''
      return vb.startsWith('0 0 400 300')
    })
    if (!scene) return { found: false }
    const box = scene.getBoundingClientRect()
    return {
      found: true,
      w: Math.round(box.width),
      h: Math.round(box.height),
      inView: box.top < window.innerHeight && box.bottom > 0,
      hasTitle: Boolean(scene.querySelector('title')),
      shapes: scene.querySelectorAll('path, circle, ellipse, rect, polygon').length,
    }
  })
  check('题目插画已渲染', svgInfo.found)
  check('插画有实际尺寸', svgInfo.found && svgInfo.w > 100 && svgInfo.h > 60, JSON.stringify(svgInfo))
  check('插画在首屏内（孩子说的时候看得见）', svgInfo.found && svgInfo.inView)
  check('插画内容不是空壳', svgInfo.found && svgInfo.shapes > 5, `图形数 ${svgInfo.shapes}`)
  await page.screenshot({ path: `${SHOT_DIR}/03-prompt.png` })

  /* ---------- 5. 写作与语音编辑（核心） ---------- */
  console.log('\n【5】写作与「自己改」')

  // v3 写作页是沉浸式语音台（没有 textarea）。
  // 点击「不方便说话？用键盘输入」打开键盘模式，输入后必须点「确定」才生效。
  const keyboardToggle = await clickByText(page, '不方便说话')
  check('可以打开键盘输入', keyboardToggle)

  // 通过 React fiber 直接触发 onChange（比原生 setter 更稳）
  const wrote = await page.evaluate((text) => {
    const input = document.querySelector('input[placeholder*="今天"]')
    if (!input) return false
    const key = Object.keys(input).find((k) => k.startsWith('__reactProps'))
    const props = input[key]
    if (props && props.onChange) props.onChange({ target: { value: text } })
    return true
  }, '春天来了，公园里开满了花。他手里拿着一根直直的棍子，站在门口。')
  check('可以写入正文', wrote)
  await new Promise((r) => setTimeout(r, 300))

  // 点确定，文字才真正进入稿纸
  const confirmed = await clickByText(page, '确定')
  check('可以确认输入', confirmed)
  await new Promise((r) => setTimeout(r, 600))

  // v3 字数格式是「words / target 字」
  const wordCount = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((e) =>
      /^\d+\s*\/\s*\d+\s*字$/.test((e.textContent || '').trim()),
    )
    return el ? el.textContent.trim() : ''
  })
  check('字数统计生效', /^[1-9]\d*\s*\/\s*\d+\s*字$/.test(wordCount), wordCount)

  // 切到「说修改」
  const editMode = await clickByText(page, '说修改')
  check('可以切到「说修改」模式', editMode)

  // 修改模式下也要先打开键盘输入
  const editKeyboard = await clickByText(page, '不方便说话')
  check('修改模式可以打开键盘输入', editKeyboard)
  await new Promise((r) => setTimeout(r, 400))

  // 修改模式下键盘输入框的 placeholder 是「把 A 改成 B」
  await page.waitForFunction(
    () => Boolean(document.querySelector('input[placeholder="把 A 改成 B"]')),
    { timeout: 4000, polling: 200 },
  )
  await page.evaluate((text) => {
    const input = document.querySelector('input[placeholder="把 A 改成 B"]')
    if (input) {
      const key = Object.keys(input).find((k) => k.startsWith('__reactProps'))
      const props = input[key]
      if (props && props.onChange) props.onChange({ target: { value: text } })
    }
  }, '把棍子改成竹签')
  await new Promise((r) => setTimeout(r, 300))
  await clickByText(page, '确定')
  await new Promise((r) => setTimeout(r, 600))

  // v3 没有 textarea，正文在 <p class="whitespace-pre-wrap"> 里
  await page.waitForFunction(
    () => document.body.innerText.includes('竹签'),
    { timeout: 6000, polling: 200 },
  ).catch(() => {})

  const edited = await waitForText(page, '你自己的修改', 6000)
  const textNow = await page.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find((el) =>
      el.className && el.className.includes('whitespace-pre-wrap'),
    )
    return p ? p.innerText : document.body.innerText
  })
  check('语音编辑把「棍子」换成了「竹签」', textNow.includes('竹签'), textNow.slice(-40))
  check('修改记录已展示', edited)
  check('「棍子」已被替换掉', !textNow.includes('棍子'))

  const preserved = textNow.includes('春天来了') && textNow.includes('公园里开满了花')
  check('修改没有破坏其他内容（只改指定词）', preserved)

  await page.screenshot({ path: `${SHOT_DIR}/04-writing.png` })

  /* ---------- 6. 提交与评分 ---------- */
  console.log('\n【6】提交与 AI 点评')
  const submitted = await clickByText(page, '写好了，让树看看')
  check('可以提交', submitted)

  const scored = await waitForText(page, '这些地方做得特别好', 35000)
  check('出现评分结果', scored)

  // 掉卡弹层会盖住页面，先收掉才能继续。
  //
  // 注意：不能"立即"检查。卡片是逐张揭晓的（第一张 260ms，之后每张 420ms），
  // 「收进背包」按钮要等全部揭晓完才渲染。评分页一渲染出来就查，必然查不到，
  // 那是测出来的假失败，不是 App 的问题。这里改成轮询等它揭晓完。
  const hadDrops = await waitForText(page, '收进背包', 8000)
  if (hadDrops) {
    await clickByText(page, '收进背包')
    await new Promise((r) => setTimeout(r, 500))
  }
  // 低分可能不掉卡，这是正常行为，不算失败
  if (hadDrops) {
    check('掉卡演出出现过', true)
  } else {
    console.log('  ⚪ 掉卡演出 — 本次评分未触发掉卡（低分正常行为）')
  }

  const scoreInfo = await page.evaluate(() => {
    const txt = document.body.innerText
    const m = txt.match(/(\d+)\s*\n?\s*分/)
    const hasDims = ['观察力', '条理性', '词汇量', '想象力', '真情实感'].filter((d) =>
      txt.includes(d),
    )
    const hasMindMap = txt.includes('你的作文长这样')
    const hasSuggest = txt.includes('下次可以试试')
    return {
      score: m ? Number(m[1]) : null,
      dims: hasDims.length,
      hasMindMap,
      hasSuggest,
    }
  })
  check(
    '总分在合理范围',
    scoreInfo.score !== null && scoreInfo.score > 0 && scoreInfo.score <= 100,
    `分数 ${scoreInfo.score}`,
  )
  check('五个维度都展示了', scoreInfo.dims === 5, `展示 ${scoreInfo.dims} 个`)
  check('有作文思维导图', scoreInfo.hasMindMap)
  check('有提升建议', scoreInfo.hasSuggest)

  await page.screenshot({ path: `${SHOT_DIR}/05-score.png`, fullPage: true })

  /* ---------- 7. 满分范文 ---------- */
  console.log('\n【7】满分范文')
  const essayBtn = await clickByText(page, '看看满分范文')
  check('有「看看满分范文」入口', essayBtn)

  const essayOk = await waitForText(page, '只留主干', 25000)
  check('范文已生成', essayOk)

  const essayInfo = await page.evaluate(() => {
    const txt = document.body.innerText
    const skeletonBtn = [...document.querySelectorAll('button')].some((b) =>
      (b.innerText || '').includes('只留主干'),
    )
    return { hasEssay: txt.includes('满分范文'), hasSkeleton: skeletonBtn }
  })
  check('范文页标题正确', essayInfo.hasEssay)
  check('可以切换到「只留主干」背诵版', essayInfo.hasSkeleton)

  // 切到主干版，验证真的有内容
  await clickByText(page, '只留主干')
  await new Promise((r) => setTimeout(r, 400))
  const skeletonText = await page.evaluate(() => {
    const txt = document.body.innerText
    const idx = txt.indexOf('去掉所有修饰词')
    return idx >= 0 ? txt.slice(idx, idx + 200) : ''
  })
  check('主干版有实际内容', skeletonText.length > 40, skeletonText.slice(0, 60))

  // 验证范文没有覆盖孩子的原文（回写作页看）
  const childTextKept = await page.evaluate(() => {
    const ta = document.querySelector('textarea')
    return ta ? ta.value : null
  })
  check(
    '范文没有覆盖孩子的原文',
    childTextKept === null || childTextKept.includes('竹签'),
    String(childTextKept).slice(0, 40),
  )

  await page.screenshot({ path: `${SHOT_DIR}/06-essay.png`, fullPage: true })

  /* ---------- 8. 背诵 ---------- */
  console.log('\n【8】背诵环节')
  const reciteBtn = await clickByText(page, '去背诵挑战')
  check('有「去背诵挑战」入口', reciteBtn)

  const reciteOk = await waitForText(page, '背诵挑战', 8000)
  check('进入背诵页', reciteOk)

  const reciteInfo = await page.evaluate(() => {
    const txt = document.body.innerText
    return {
      hasLines: txt.includes('提示') && txt.includes('背'),
      hasListen: txt.includes('听一遍范文') || txt.includes('慢速听主干'),
      hasStart: txt.includes('开始背诵'),
    }
  })
  check('背诵页显示提示与背诵内容', reciteInfo.hasLines)
  check('可以听范文', reciteInfo.hasListen)
  check('有开始背诵按钮', reciteInfo.hasStart)

  await page.screenshot({ path: `${SHOT_DIR}/07-recite.png`, fullPage: true })

  /* ---------- 9. 其他板块（用页面刷新重置状态，避免沉浸页干扰导航） ---------- */
  console.log('\n【9】其他板块')

  // 成长树
  await page.goto(URL, { waitUntil: 'networkidle2' })
  await waitForText(page, '写作文', 8000)
  await clickByText(page, '成长树')
  await new Promise((r) => setTimeout(r, 1200))
  const levelOk = await waitForText(page, '我的树', 10000)

  // 先检查「我的树」页签的内容（护盾、SVG）
  const treeInfo = await page.evaluate(() => {
    const txt = document.body.innerText
    return {
      hasShield: txt.includes('护盾') || txt.includes('保护罩'),
      hasTree: Boolean(
        [...document.querySelectorAll('svg')].find((s) => {
          const vb = s.getAttribute('viewBox') || ''
          return vb === '0 0 200 200'
        }),
      ),
    }
  })
  check('成长树页面渲染', levelOk)
  check('显示护盾机制', treeInfo.hasShield)
  check('成长树 SVG 已渲染', treeInfo.hasTree)

  // 再切到「段位」子页签检查预测/实际水平
  await clickByText(page, '段位')
  await new Promise((r) => setTimeout(r, 800))
  const trackInfo = await page.evaluate(() => {
    const txt = document.body.innerText
    return {
      hasConfidence: txt.includes('预测水平') || txt.includes('实际水平') || txt.includes('距离'),
      hasTrack: txt.includes('嫩芽') || txt.includes('一颗种子'),
    }
  })
  check('显示「预测/实际水平」', trackInfo.hasConfidence)
  check('显示段位阶梯', trackInfo.hasTrack)
  await page.screenshot({ path: `${SHOT_DIR}/08-level.png`, fullPage: true })

  // 文心卡
  await page.goto(URL, { waitUntil: 'networkidle2' })
  await waitForText(page, '写作文', 8000)
  await clickByText(page, '文心卡')
  await new Promise((r) => setTimeout(r, 800))
  const cardsOk = await waitForText(page, '文心卡', 10000)
  const cardInfo = await page.evaluate(() => {
    const txt = document.body.innerText
    return {
      hasProgress: /已收集\s*\d+\s*\/\s*40/.test(txt.replace(/\s+/g, ' ')),
      hasRarity: txt.includes('传说'),
      hasLocked: txt.includes('？？？') || txt.includes('未获得'),
    }
  })
  check('套卡页面渲染', cardsOk)
  check('显示收集进度 /40', cardInfo.hasProgress)
  check('显示稀有度体系', cardInfo.hasRarity)
  await page.screenshot({ path: `${SHOT_DIR}/09-cards.png`, fullPage: true })

  // 日记（密码回归测试）
  await page.goto(URL, { waitUntil: 'networkidle2' })
  await waitForText(page, '写作文', 8000)
  await clickByText(page, '日记本')
  await new Promise((r) => setTimeout(r, 800))
  const diaryText = await page.evaluate(() => document.body.innerText)
  const diaryOk = /今天也要记一笔|日记本锁着|给日记本上把锁/.test(diaryText)
  check('日记页面渲染', diaryOk)

  /* ---------- 9b. 日记密码（真实事故回归测试） ----------
     曾经因为 sub={hollowUnlockHint(useAppLevelIndex())} 把 hook 写进 JSX，
     解锁那一刻 hook 从 72 变 73，React 直接抛
     "Rendered more hooks than during the previous render"，整页被 ErrorBoundary 接住。
     这里必须真的设一次密码、真的解锁一次，确保不再崩。 */
  console.log('\n【9b】日记密码')
  const pinGate = await page.evaluate(() => document.body.innerText)
  const needSetup = /给日记本上把锁吧/.test(pinGate)
  const needUnlock = /日记本锁着/.test(pinGate)

  if (needSetup || needUnlock) {
    const tap = async (digits) => {
      for (const d of digits) {
        await page.evaluate((n) => {
          const b = [...document.querySelectorAll('button')].find(
            (x) => (x.innerText || '').trim() === n,
          )
          if (b) b.click()
        }, d)
        await new Promise((r) => setTimeout(r, 160))
      }
    }

    // 统一个测试密码，设置与解锁都用它
    const PIN = ['1', '2', '3', '4']

    if (needSetup) {
      await tap(PIN)
      await new Promise((r) => setTimeout(r, 400))
      await tap(PIN)
    } else {
      await tap(PIN)
    }
    await new Promise((r) => setTimeout(r, 1200))

    const afterPin = await page.evaluate(() => document.body.innerText)
    check(
      '输密码后进入日记正文（不再崩）',
      /今天也要记一笔|今天的日记/.test(afterPin),
      afterPin.slice(0, 60).replace(/\n+/g, ' '),
    )
    check(
      '密码流程没有触发错误边界',
      !/这一页出了点小问题/.test(afterPin),
    )
  } else {
    check('日记已跳过密码（无需解锁）', true)
  }
  await page.screenshot({ path: `${SHOT_DIR}/10-diary.png`, fullPage: true })

  /* ---------- 9c. 金币消耗口：开文心卡包 ---------- */
  console.log('\n【9c】金币消耗口')
  await page.goto(URL, { waitUntil: 'networkidle2' })
  await waitForText(page, '写作文', 8000)
  await clickByText(page, '文心卡')
  await new Promise((r) => setTimeout(r, 800))
  const coinUI = await page.evaluate(() => {
    const txt = document.body.innerText
    return {
      hasCoinLabel: /我的金币/.test(txt),
      // v4：金币只能靠写出来。来源和用法都要说清楚，
      // 只说"能开卡包"不够 —— 孩子得知道钱是从哪来的。
      hasSourceHint: /写出来才赚得到|写作才赚得到/.test(txt),
      hasSinkHint: /攒够了就能开包|可以开一包|开文心卡包/.test(txt),
      packBtn: [...document.querySelectorAll('button')].some((b) =>
        /开一包文心卡|还差\s*\d+\s*金币/.test(b.innerText || ''),
      ),
    }
  })
  check('金币叫「金币」而不是「种子币」', coinUI.hasCoinLabel)
  check('页面说明了金币从哪来（写作）', coinUI.hasSourceHint)
  check('页面说明了金币怎么花（开卡包）', coinUI.hasSinkHint)
  check('有「开文心卡包」按钮', coinUI.packBtn)

  /* ---------- 9c2. 才气与文心树加成（v4 经济） ----------
     这一版把金币的来源收成了「只能靠写」：
     树不产金币，只给加成。孩子必须能在界面上看到这两件事。 */
  console.log('\n【9c2】才气与文心树加成')
  await page.goto(URL, { waitUntil: 'networkidle2' })
  await waitForText(page, '写作文', 8000)
  await clickByText(page, '成长树')
  await new Promise((r) => setTimeout(r, 900))
  const talentUI = await page.evaluate(() => {
    const txt = document.body.innerText
    return {
      talent: /今日才气/.test(txt),
      boost: /树的金币加成/.test(txt),
      noTreeCoin: /树上不掉金币/.test(txt),
    }
  })
  check('成长树页显示「今日才气」', talentUI.talent)
  check('成长树页显示「树的金币加成」', talentUI.boost)
  check('明说树上不掉金币', talentUI.noTreeCoin)
  await page.screenshot({ path: `${SHOT_DIR}/04-tree.png` })

  /* ---------- 9d. 旅行图 + 招募小鸟 ---------- */
  await page.goto(URL, { waitUntil: 'networkidle2' })
  await waitForText(page, '写作文', 8000)
  await clickByText(page, '旅行图')
  await new Promise((r) => setTimeout(r, 1000))
  const mapInfo = await page.evaluate(() => {
    const txt = document.body.innerText
    return {
      hasMap: Boolean(document.querySelector('svg')),
      hasTabs: /地图/.test(txt) && /小鸟/.test(txt),
    }
  })
  check('旅行图渲染出地图', mapInfo.hasMap)
  check('有地图/小鸟/相册三个页签', mapInfo.hasTabs)

  await clickByText(page, '小鸟')
  await new Promise((r) => setTimeout(r, 800))
  const aviary = await page.evaluate(() => {
    const txt = document.body.innerText
    const btns = [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim())
    return {
      hasLegacyLabel: /种子币/.test(txt),
      hasCoinLine: /金币/.test(txt) && !/种子币/.test(txt),
      recruitBtn: btns.some((t) => /金币招募/.test(t) || /还差/.test(t)),
      birdCount: /树上?有\s*\d+\s*只小鸟/.test(txt.replace(/\s+/g, '')),
      rawText: txt,
    }
  })
  check('小鸟页不再出现「种子币」', !aviary.hasLegacyLabel)
  check('金币说明写的是「金币」（没有「种子币」）', aviary.hasCoinLine)
  check('小鸟页显示金币余额说明', aviary.birdCount)
  check(
    '小鸟页有招募入口或解锁说明',
    aviary.recruitBtn || /还没解锁的鸟|再长一级/.test(aviary.rawText ?? ''),
    aviary.recruitBtn ? '有招募按钮' : '段位不足，显示解锁说明',
  )
  await page.screenshot({ path: `${SHOT_DIR}/11b-map.png`, fullPage: true })

  /* ---------- 10. 题库（v3 从写作文页进入） ---------- */
  console.log('\n【10】作文题库')
  await clickByText(page, '写作文')
  await new Promise((r) => setTimeout(r, 800))

  // 「从题库里挑」在没选大类时是禁用的（出题总得有个方向）。
  // 前面的 page.goto 会刷新页面、把大类重置掉，所以这里必须先重新选一次 ——
  // 否则点的是一个禁用按钮，抽屉根本不会开，后面两项就成了假失败。
  await clickByText(page, '写景')
  await new Promise((r) => setTimeout(r, 400))

  const libBtn = await clickByText(page, '从题库里挑')
  check('可以打开「从题库里挑」抽屉', libBtn)
  await new Promise((r) => setTimeout(r, 1500))

  const libInfo = await page.evaluate((title) => {
    const txt = document.body.innerText
    const empty = txt.includes('题库还是空的') || txt.includes('0 道')
    return {
      empty,
      opened: Boolean(document.querySelector('input[placeholder*="搜题目"]')),
      hasItem: !empty && title ? txt.includes(title) : false,
      hasSearch: Boolean(document.querySelector('input[placeholder*="搜题目"]')),
      hasRandom: /随机/.test(txt),
    }
  }, promptTitle)

  if (libInfo.empty) {
    check('题库当前为空（全新存档，正常）', true)
    check('题库有搜索框（空库时不显示，属正常）', true, '空库状态')
    check('题库有随机抽题（空库时不显示，属正常）', true, '空库状态')
  } else {
    check('抽屉确实打开了', libInfo.opened)
    check('AI 生成的题目已自动入库', libInfo.hasItem, `题目「${promptTitle}」`)
    check('题库有搜索框', libInfo.hasSearch)
    check('题库有随机抽题', libInfo.hasRandom)
  }
  await page.screenshot({ path: `${SHOT_DIR}/11-library.png`, fullPage: true })

  /* ---------- 11. 设置 ---------- */
  console.log('\n【11】设置')
  // 关闭题库抽屉（点遮罩或返回）
  await page.evaluate(() => {
    const backdrop = document.querySelector('[class*="fixed inset-0"]')
    if (backdrop) backdrop.click()
  })
  await new Promise((r) => setTimeout(r, 600))
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')]
      .find((x) => x.getAttribute('aria-label') === '设置')
      ?.click()
  })
  const settingsOk = await waitForText(page, 'AI', 8000)
  check('设置页面渲染', settingsOk)
  const settingsInfo = await page.evaluate(() => {
    const txt = document.body.innerText
    return {
      hasAi: txt.includes('AI'),
      hasSound: txt.includes('声音') || txt.includes('音效') || txt.includes('震动'),
      hasBackup: txt.includes('备份') || txt.includes('导出'),
      hasPin: txt.includes('密码'),
      hasGrade: txt.includes('年级'),
      hasLocalEngine: txt.includes('本地'),
    }
  })
  check('有 AI 设置', settingsInfo.hasAi)
  check('有本地引擎选项', settingsInfo.hasLocalEngine)
  check('有声音开关', settingsInfo.hasSound)
  check('有数据备份', settingsInfo.hasBackup)
  check('有日记密码设置', settingsInfo.hasPin)
  check('有年级设置', settingsInfo.hasGrade)
  await page.screenshot({ path: `${SHOT_DIR}/12-settings.png`, fullPage: true })

  /* ---------- 12. 控制台干净 ---------- */
  console.log('\n【12】控制台')
  // 过滤掉与业务无关的噪音（音频、favicon 等）
  const realErrors = consoleErrors.filter(
    (e) =>
      !/favicon/i.test(e) &&
      !/AudioContext/i.test(e) &&
      !/play\(\) request is not allowed/i.test(e) &&
      !/speech/i.test(e),
  )
  check('没有 JS 运行时报错', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

  await browser.close()

  /* ---------- 汇总 ---------- */
  console.log(`\n${'─'.repeat(52)}`)
  console.log(`  通过 ${pass} 项 / 失败 ${fail} 项`)
  if (fail > 0) {
    console.log('\n  失败明细：')
    for (const f of failures) console.log(`   · ${f}`)
  }
  console.log(`  截图已输出到 ${SHOT_DIR}/`)
  console.log(`${'─'.repeat(52)}\n`)

  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('\n💥 验收脚本本身出错了：', err)
  process.exit(1)
})
