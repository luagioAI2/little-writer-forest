/* ============================================================
   验证「旅游点名录浏览 → 点卡片就出现编辑」这条链路
   ------------------------------------------------------------
   跑法：node scripts/_verify-browse-edit.mjs
   ⚠️ 需要 dev server 在 5190 —— 两个页面都要读 TS 模块、都要 fetch JSON，
      file:// 打不开。

   守的是**两个页面之间的那一层**：
     · browse 页认不认识内容包（卡片标记 / 统计 / 筛选）
     · 点卡片能不能把编辑器拉出来、并定位到**那一个**景点
     · 关抽屉会不会**一声不响地丢掉**刚写的散文
   编辑器**自己**的行为由 `_verify-travel-editor.mjs` 负责，这里不重复测。
   ============================================================ */

import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = process.env.E2E_URL ?? 'http://localhost:5190'
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SHOT_DIR = process.env.SHOT_DIR ?? '.'
mkdirSync(SHOT_DIR, { recursive: true })

/* 期望值从数据里现算，不写死数字 —— 内容包以后会变多 */
const contents = JSON.parse(readFileSync(resolve(process.cwd(), 'src/data/travel-contents.json'), 'utf8'))
const HAS_IDS = new Set(contents.filter((c) => c.landmarkId).map((c) => c.landmarkId))

/* ------------------------------------------------------------
   ★★ 运行时地标数**从数据里算**，不写死（跟 `_verify-travel-editor.mjs` 同一套）。

   09-25 主库按「只留 5A / 全国知名 / 世界知名」收窄之后，写死的绝对数
   必然要改 —— 而「把数字改小让它变绿」会把守卫调哑。

   运行时库 = 四个来源 − 被官方名录取代的（`supersedes`） − 被移出的（`landmarks-4a.json`）
   ⚠️ 这里**不重算"哪条算知名"** —— 那个判定只有 `fameOf()` 一份；
      移出的结果已经落在 `landmarks-4a.json` 的 `count` 里，直接读。
   ------------------------------------------------------------ */
const DATA = (f) => JSON.parse(readFileSync(resolve(process.cwd(), 'src/data', f), 'utf8'))
const CN_HDR = DATA('landmarks-cn.json')
const PARKED_HDR = DATA('landmarks-4a.json')
const SOURCE_TOTAL =
  DATA('landmarks.json').length +
  DATA('landmarks-gd.json').items.length +
  CN_HDR.items.length +
  DATA('landmarks-world.json').items.length -
  CN_HDR.supersedes.length
const RUNTIME_LM_COUNT = SOURCE_TOTAL - PARKED_HDR.count

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

async function main() {
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
   * ⚠️⚠️ 原生弹窗**只能有一个** `page.on('dialog')` 处理器。
   *    注册第二个的话，两个都会去 accept，第二个就会抛
   *    `Cannot accept dialog which is already handled!` —— 脚本直接崩。
   *    ➜ 一个处理器同时干两件事：记下文案 + accept。
   *      （headless 里不 accept 就会**静默挂死**，跑满超时被 SIGTERM。）
   *
   * ★★ 而且必须**全都记下来**，不能只记最后一条 ——
   *    一次「关闭」会连着弹两个（抽屉自己的 confirm + iframe 的 beforeunload），
   *    只留最后一条的话，断言看到的是那个空的 beforeunload，
   *    就会误判成"没弹确认"，然后去修一个根本没坏的地方。
   */
  const dialogs = []
  page.on('dialog', (d) => {
    dialogs.push({ type: d.type(), message: d.message() })
    d.accept()
  })

  // 控制台那条 404 不带 URL —— 单独收集响应才查得出是哪个资源
  const badRequests = []
  page.on('response', (r) => {
    if (r.status() >= 400) badRequests.push(`${r.status()} ${r.url()}`)
  })

  const URL = `${BASE}/landmarks-browse.html`
  console.log(`\n🌐 ${URL}\n`)

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })

  /* ---------- 1. browse 页认不认识内容包 ---------- */
  console.log('【1】browse 页认识内容包了吗')
  const loaded = await page
    .waitForFunction(() => /已配内容的景点/.test(document.getElementById('stats')?.innerText || ''), {
      timeout: 20000,
      polling: 200,
    })
    .then(() => true)
    .catch(() => false)
  check('★ 统计条里出现了「已配内容的景点」（原来这一页完全不读内容包）', loaded)

  const stats = await page.evaluate(() => document.getElementById('stats').innerText.replace(/\n/g, ' '))
  check(
    `★ 已配内容数 == 内容包里的地标数（${HAS_IDS.size}）`,
    stats.includes(`${HAS_IDS.size} / `),
    stats,
  )

  const total = Number((stats.match(/(\d+)\s*总条数/) || [])[1]) || 0
  const parkedShown = Number((stats.match(/(\d+)\s*已移出主库/) || [])[1]) || 0
  /* ★★ 守的是**这一页跟 App 读了同一份移出名单**（`landmarks-4a.json`）。
     这一页原来是直接 fetch 那四个 JSON 的 —— 只改加载器的话，
     它会显示 1808、而 App 里是 643，**两边都不报错**、只是口径悄悄分叉。
     ➜ 判据 = 总条数 + 已移出 = 四个来源去重后的总量。 */
  check(
    `★★ 总条数 ${total} + 已移出 ${parkedShown} = 来源总量 ${SOURCE_TOTAL}（两边读同一份名单）`,
    total === RUNTIME_LM_COUNT &&
      parkedShown === PARKED_HDR.count &&
      total + parkedShown === SOURCE_TOTAL,
    `实际 ${total} + ${parkedShown}，应为 ${RUNTIME_LM_COUNT} + ${PARKED_HDR.count}`,
  )

  const badgeInfo = await page.evaluate(() => ({
    badges: document.querySelectorAll('#result .item .c-badge').length,
    dots: document.querySelectorAll('#result .item .c-badge .dots i').length,
    sample: document.querySelector('#result .item .c-badge')?.innerText.trim() || '',
    dotColors: [...document.querySelectorAll('#result .item .c-badge .dots i')]
      .slice(0, 5)
      .map((i) => i.style.background),
  }))
  check('★ 配过内容的卡片挂上了「内容 N」标记', badgeInfo.badges > 0, `${badgeInfo.badges} 张`)
  check('标记里有等级色点（颜色来自 TRAVEL_GRADES）', badgeInfo.dots > 0 && badgeInfo.dotColors.every(Boolean), JSON.stringify(badgeInfo.dotColors))

  /* ---------- 2. 筛选：只看还没配内容的 ---------- */
  console.log('\n【2】内容状态筛选')
  await page.select('#fContent', 'has')
  await sleep(400)
  const hasView = await page.evaluate(() => ({
    cards: document.querySelectorAll('#result .item').length,
    crumb: document.getElementById('cntRow').innerText.replace(/\n/g, ' '),
  }))
  check(
    `★ 「只看已配内容的」只列出那 ${HAS_IDS.size} 个景点（不是 ${contents.length} 条内容）`,
    hasView.cards === HAS_IDS.size,
    `实际 ${hasView.cards} 张`,
  )
  check('面包屑说清了当前在看什么', /已配内容/.test(hasView.crumb), hasView.crumb)

  await page.select('#fContent', 'gap')
  await sleep(400)
  const gapCount = await page.evaluate(() => document.querySelectorAll('#result .item').length)
  // ⚠️ 别用 `/\d+$/` 去抓总数 —— 统计条最后一个是「已配内容的景点」那张卡，
  //    末位数字是"已配数"不是全库数（第一版就是这么写的，抓出个 0）。
  //    `total` 在上面已经解析过了（顺便验了「总条数 + 已移出 = 来源总量」）。
  /*
   * ⚠️ 别写死绝对数 —— 这里原来是 `gapCount > 1000`，09-25 主库按
   *    「只留 5A / 全国知名 / 世界知名」收到 643 条之后它必然要改，
   *    而「把 1000 改成 600」正是把守卫调哑的那种修法（下次真坏还是绿的）。
   * ★ 真正要守的是**两半加起来等于整体**：缺口 = 全库 − 已配。
   *   外加 `total > 0` 兜住"页面压根没加载出来"。
   */
  const expectedGap = total - hasView.cards
  check(
    '★ 「只看还没配内容的」= 全库 − 已配（两者加起来必须等于全库）',
    total > 0 && gapCount === expectedGap && gapCount + hasView.cards === total,
    `${gapCount} + ${hasView.cards} vs 全库 ${total}（应有缺口 ${expectedGap}）`,
  )
  await page.screenshot({ path: `${SHOT_DIR}/_browse-1-gaps.png` })

  /* ---------- 3. 点一张**有内容**的卡片 ---------- */
  console.log('\n【3】点卡片 → 抽屉里出现编辑')
  await page.select('#fContent', 'has')
  await sleep(400)
  const firstId = await page.evaluate(() => document.querySelector('#result .item')?.dataset.id)
  await page.click('#result .item')
  await sleep(600)

  const drawer = await page.evaluate(() => ({
    open: !document.getElementById('drawer').hidden,
    scrim: !document.getElementById('scrim').hidden,
    name: document.getElementById('dwName').innerText.trim(),
    sub: document.getElementById('dwSub').innerText.trim(),
    src: document.getElementById('dwFrame').getAttribute('src') || '',
    openHref: document.getElementById('dwOpen').getAttribute('href') || '',
  }))
  check('点卡片抽屉滑出来了', drawer.open && drawer.scrim)
  check('抽屉标题是那个景点的名字', !!drawer.name && drawer.name !== '—', drawer.name)
  check(
    '★ 内嵌的是**真的编辑器**（不是抄一份进来）',
    drawer.src.includes('travel-editor.html') && drawer.src.includes('embed=1'),
    drawer.src,
  )
  check('★ 带上了被点那个景点的 id（id 要 encode）', drawer.src.includes(encodeURIComponent(firstId)), `${firstId} vs ${drawer.src}`)
  check(
    '★「单独打开」给的是**不带 embed** 的完整编辑器（单开时还是想要那份地标列表的）',
    drawer.openHref.includes('travel-editor.html') &&
      drawer.openHref.includes(encodeURIComponent(firstId)) &&
      !drawer.openHref.includes('embed=1'),
    drawer.openHref,
  )

  // 等 iframe 里的编辑器 boot 完（要动态 import 两个 TS 模块）
  const frame = await page.waitForFrame(
    (f) => f.url().includes('travel-editor.html'),
    { timeout: 20000 },
  )
  await frame.waitForSelector('[data-k="title"]', { timeout: 20000 })
  await sleep(400)

  const inner = await frame.evaluate(() => ({
    embed: document.body.classList.contains('embed'),
    leftHidden: getComputedStyle(document.querySelector('.left')).display === 'none',
    title: document.querySelector('[data-k="title"]')?.value || '',
    /*
     * ⚠️ 2026-09-25：`[data-k="landmarkId"]` 那个输入框已经删了 ——
     *    地标由"从哪个景点点进来"决定，不给手改（图片是挂在地标上的附件）。
     *    改成读只读信息条里的 `data-lm="landmarkId"`。
     */
    lm: document.querySelector('.lminfo [data-lm="landmarkId"]')?.innerText.trim() || '',
    /*
     * ★★ 「这个景点」信息条的位置（09-25 家长两次要求「放到顶上去」→
     *    「这个 东西 往 上放，这个是**旅游点公共的**」）。
     *
     *    抽屉里它挂在 `#lmslot`，排在「这个景点的图」条带**之上**。
     *    ⚠️ 所以**不能再断言"它是 `.grid` 的第一格"** —— 它现在在 `.grid` 外面。
     *       真正要守的是这两条（跟放在哪儿无关）：
     *         ① 它排在**可改字段之前**（"往上放"的字面含义）；
     *         ② 页面上**只有一个** `.lminfo`（两份都渲染 = 内容互相打架）。
     *    ⚠️ 也别用像素坐标比先后 —— 换个视口就飘。用 DOM 顺序。
     */
    lmCount: document.querySelectorAll('.lminfo').length,
    lmBeforeId: (() => {
      const info = document.querySelector('.lminfo')
      const idf = document.querySelector('#editor [data-k="id"]')
      if (!info || !idf) return false
      return !!(info.compareDocumentPosition(idf) & Node.DOCUMENT_POSITION_FOLLOWING)
    })(),
    lmBeforeStrip: (() => {
      const info = document.querySelector('.lminfo')
      const st = document.getElementById('strip')
      if (!info || !st) return false
      return !!(info.compareDocumentPosition(st) & Node.DOCUMENT_POSITION_FOLLOWING)
    })(),
    lmSlotShown: !document.getElementById('lmslot')?.hidden,
    lmInGrid: !!document.querySelector('#editor .grid > .lminfo'),
    /*
     * ★★ 景点公共简介（09-26）—— 抽屉是家长**真正会走**的那条路。
     *    ⚠️ 光断言"有这个框"不够：框空着跟"没读到文件"长得一模一样，
     *       而没读到文件的话，**下一次保存就会把盘上的简介抹掉**。
     *       所以下面那条比的是**框里跟文件里是不是同一个值**。
     */
    introValue: document.querySelector('.lminfo [data-lm="intro"]')?.value ?? null,
    introCount: document.querySelector('.lminfo [data-lm="intro-count"]')?.textContent?.trim() ?? null,
    cap2: (document.querySelector('#editor .grid .cap2')?.innerText || '').replace(/\s+/g, ' ').trim(),
    /* `.cap2` 必须排在 `[data-k="id"]` **前面** —— 用 DOM 顺序比，不靠像素坐标 */
    cap2BeforeId: (() => {
      const cap = document.querySelector('#editor .grid .cap2')
      const idf = document.querySelector('#editor .grid [data-k="id"]')
      if (!cap || !idf) return false
      return !!(cap.compareDocumentPosition(idf) & Node.DOCUMENT_POSITION_FOLLOWING)
    })(),
    dirty: !document.getElementById('dirty').hidden,
    rows: document.querySelectorAll('#list .row').length,
  }))
  check('★ 嵌进来之后左边那份地标列表被藏掉了（抽屉已经知道是哪个景点）', inner.embed && inner.leftHidden)
  check('★ 编辑器**定位到了被点的那个景点**', inner.lm === firstId, `${inner.lm} vs ${firstId}`)
  check('表单里是这个景点的内容（不是空的）', inner.title.length > 0, inner.title)
  check('★ 打开动作本身**不算改动**（没动过就不该报"未保存"）', inner.dirty === false)
  check(
    '★★ 「这个景点」信息条排在**可改字段之前**（家长 09-25：「往 上放」）',
    inner.lmBeforeId,
  )
  check(
    '★★ 而且排在「这个景点的图」条带**之上** —— 这是"旅游点公共的"该待的位置',
    inner.lmBeforeStrip,
  )
  check(
    '★★ 页面上**只有一个** `.lminfo`（两份都渲染 = 同一个景点两套说法）',
    inner.lmCount === 1,
    `${inner.lmCount} 个`,
  )
  check(
    '★ 抽屉里走 `#lmslot`（表单里不再重复渲染那一份）',
    inner.lmSlotShown && !inner.lmInGrid,
    `slot=${inner.lmSlotShown} inGrid=${inner.lmInGrid}`,
  )
  /*
   * ★★ 景点公共简介（09-26 家长：「旅游景点 没有公共简介，字数不超过300」）。
   *
   *    ⚠️ 断言名字里**带上当前是哪种情况** —— 这一条被挑中的景点可能本来就没写简介，
   *       那时候"两边都是空的"就是**该有的**结果；但必须让它在输出里看得见，
   *       否则一个空过的守卫跟真守卫长得一模一样（L§三十七.2）。
   *    ⚠️ 详细的字数 / 端点行为在 `_verify-travel-editor.mjs` 的 11c 里，
   *       这里只管**真实入口这一条路**上它有没有出现、值对不对。
   */
  const BROWSE_INTROS = DATA('landmark-intros.json')
  const firstIntro = BROWSE_INTROS[firstId] ?? ''
  check(
    '★★ 抽屉里能看到「景点公共简介」，框里跟文件**一致**' +
      (firstIntro ? '（这一条有简介，比的是真文案）' : '（这一条没简介，两边都该是空的）'),
    typeof inner.introValue === 'string' &&
      inner.introValue === firstIntro &&
      (inner.introCount || '').startsWith(`${firstIntro.length} / `),
    `框里 ${JSON.stringify((inner.introValue || '').slice(0, 16))} ` +
      `期望 ${JSON.stringify(firstIntro.slice(0, 16))} count=${JSON.stringify(inner.introCount)}`,
  )
  check('★ 下面有「这张图」小标题，把"这一张自己的"字段圈起来', /^这张图/.test(inner.cap2), inner.cap2)
  check(
    '★★ 「这张图」小标题排在 id 字段**前面**（顺序反了没人会报错）',
    inner.cap2BeforeId,
  )

  await page.screenshot({ path: `${SHOT_DIR}/_browse-2-drawer.png` })

  /* ---------- 4. 关闭：没改动就直接关 ---------- */
  console.log('\n【4】关闭抽屉')
  await page.click('#dwClose')
  await sleep(400)
  const closed = await page.evaluate(() => ({
    drawer: document.getElementById('drawer').hidden,
    scrim: document.getElementById('scrim').hidden,
    src: document.getElementById('dwFrame').getAttribute('src') || '',
  }))
  check('点「关闭」抽屉收起来了', closed.drawer && closed.scrim)
  check('★ 关的时候把 iframe 卸了（不然下次点开还是上一份旧状态）', closed.src === 'about:blank', closed.src)

  /* ---------- 4b. ★★ 抽屉里的「这一组的图」条带 ----------
     一个景点会有**多张图**，每张各有自己的等级和散文。
     而抽屉里左边那份列表被藏掉了 —— 所以"这个景点一共几张、
     我在改哪一张、怎么再加一张"全靠这条条带。

     ⚠️ 为什么守在这一份里、不守 `_verify-travel-editor.mjs`：
        条带**只在 embed 下渲染**（`renderStrip` 第一句 `if (!EMBED) return`），
        单独打开编辑器时它根本不存在。它的上下文是"抽屉"，属于这一层。 */
  console.log('\n【4b】★★ 抽屉里的「这一组的图」条带')
  const multiId = [...HAS_IDS].find(
    (id) => contents.filter((c) => c.landmarkId === id).length >= 2,
  )
  const stripId = multiId || firstId
  const wantN = contents.filter((c) => c.landmarkId === stripId).length

  await page.click(`#result .item[data-id="${stripId}"]`)
  await sleep(600)
  const f3 = await page.waitForFrame((f) => f.url().includes('travel-editor.html'), { timeout: 20000 })
  await f3.waitForSelector('#strip .tile', { timeout: 20000 })
  await sleep(400)

  const strip = await f3.evaluate(() => {
    const box = document.getElementById('strip')
    const tiles = [...box.querySelectorAll('.tile')]
    const content = tiles.filter((t) => t.dataset.i !== undefined && t.dataset.i !== '')
    const h = (el) => Math.round(el.getBoundingClientRect().height)
    return {
      shown: getComputedStyle(box).display !== 'none',
      cap: (box.querySelector('.scap')?.innerText || '').replace(/\s+/g, ' ').trim(),
      n: content.length,
      hasAdd: !!box.querySelector('#stripAdd'),
      onIdx: content.findIndex((t) => t.classList.contains('on')),
      // ★★ 每个缩略图的高度必须**完全一致**
      thHeights: [...new Set(tiles.map((t) => h(t.querySelector('.th'))))],
      onTitle: content.find((t) => t.classList.contains('on'))?.querySelector('.t1')?.innerText || '',
      formTitle: document.querySelector('[data-k="title"]')?.value || '',
      grades: content.map((t) => t.querySelector('.t2')?.innerText || ''),
      /*
       * ★★ 绿线守卫（09-25 家长报「界面好像中间多了一条 绿线」）。
       *
       *    根因：等级色条 `.gbar` 是 `.tile` 的**兄弟节点**，而 `.tile` 是
       *    `position:static` —— 于是 `bottom:0` 找不到定位祖先，一路升到
       *    **初始包含块**，在抽屉里画成一条横贯整个 iframe 的 4px 条
       *    （实测 rect `[0,835,879,4]`，offsetParent 是 `body`）。
       *
       *    ⚠️ 所以这里**不能只断言"有条色条"**——它一直在，只是画错了地方。
       *       要断言的是它的**几何**：每个色条都必须待在**自己那张缩略图**里。
       *    ⚠️ 只看 `content`（带 `data-i` 的那几张），别把「＋ 新建一张」算进来
       *       —— 那个方块本来就没有等级，也没有色条。
       */
      bars: content.map((t) => {
        const bar = t.querySelector('.gbar')
        if (!bar) return { inside: false, within: false, w: 0, thW: 0 }
        const th = t.querySelector('.th')
        const r = bar.getBoundingClientRect()
        const tr = th.getBoundingClientRect()
        return {
          // ① 结构：色条的父节点必须就是 `.th`
          inside: bar.parentElement === th,
          // ② 几何：色条不许比自己那张图宽（逃出去的话它会横贯整页）
          w: Math.round(r.width),
          thW: Math.round(tr.width),
          within: r.width <= tr.width + 1,
        }
      }),
    }
  })

  check('★ 抽屉里出现了「这一组的图」条带（单独打开时没有）', strip.shown)
  check(`★ 条带上的数字 == 内容包里这个地标的条数（${wantN}）`, strip.n === wantN, `条带 ${strip.n} vs 内容包 ${wantN}`)
  check('说明行说清了"这个景点的图 · N 张"', /这个景点的图\s*·\s*\d+\s*张/.test(strip.cap), strip.cap)
  check('★★ 每个缩略图**等高**（`.th` 是 span，漏了 display:block 就会参差）', strip.thHeights.length === 1, JSON.stringify(strip.thHeights))
  check('★ 恰好一张是"正在编辑的"', strip.onIdx >= 0, `onIdx=${strip.onIdx}`)
  check(
    '★ 选中的那张 == 表单正在编的那条（不是随机挑的）',
    strip.onTitle === strip.formTitle,
    `${strip.onTitle} vs ${strip.formTitle}`,
  )
  check(
    '每张都带自己的等级 + 有没有散文',
    strip.grades.every((g) => /·/.test(g)),
    JSON.stringify(strip.grades),
  )
  check('★ 有「＋ 新建一张」（这是"一个景点多张图"的入口）', strip.hasAdd)
  check(
    '★★ 等级色条长在**自己的缩略图里**（跑出去 = 横贯抽屉的那条绿线）',
    strip.bars.length > 0 && strip.bars.every((b) => b.inside),
    JSON.stringify(strip.bars),
  )
  check(
    '★★ 色条宽度 ≤ 自己那张缩略图（几何上没跑出去）',
    strip.bars.every((b) => b.within),
    JSON.stringify(strip.bars),
  )

  // 点「＋ 新建一张」：条带多一张、光标落到媒体地址、抽屉标题的条数当场跟着变
  const subBefore = await page.evaluate(() => document.getElementById('dwSub').textContent.trim())
  await f3.evaluate(() => document.getElementById('stripAdd').click())
  await sleep(400)
  const added = await f3.evaluate(() => {
    const content = [...document.querySelectorAll('#strip .tile[data-i]')]
    return {
      n: content.length,
      onIdx: content.findIndex((t) => t.classList.contains('on')),
      focusK: document.activeElement?.dataset?.k || '',
      title: document.querySelector('[data-k="title"]')?.value || '',
      dirty: !document.getElementById('dirty').hidden,
    }
  })
  check('★ 点「＋ 新建一张」条带当场多一张', added.n === strip.n + 1, `${strip.n} → ${added.n}`)
  check('新加的那张自动成为"正在编辑的"', added.onIdx === added.n - 1, `onIdx=${added.onIdx}`)
  check('★ 光标直接落到「媒体地址」（加完第一件事就是贴图）', added.focusK === 'mediaUrl', added.focusK)
  check(
    '★ 第 2 张起**不预填标题**（否则一排一模一样的标题分不出谁是谁）',
    added.title === '',
    added.title,
  )
  check('★ 加了一张 = 有改动（保存是家长的事）', added.dirty === true)

  const subAfter = await page.evaluate(() => document.getElementById('dwSub').textContent.trim())
  check(
    '★★ 抽屉标题的「已有 N 条内容」**当场**跟着变，不等保存',
    subAfter.includes(String(added.n)) && subAfter !== subBefore,
    `${subBefore} → ${subAfter}`,
  )
  check('★ 同时说清这个数"还没存"（不然会以为已经落盘了）', /还没存/.test(subAfter), subAfter)

  // 点回第 0 张：选中要跟着走、表单要跟着换
  await f3.evaluate(() => document.querySelectorAll('#strip .tile[data-i]')[0].click())
  await sleep(300)
  const back = await f3.evaluate(() => ({
    onIdx: [...document.querySelectorAll('#strip .tile[data-i]')].findIndex((t) =>
      t.classList.contains('on'),
    ),
    title: document.querySelector('[data-k="title"]')?.value || '',
    firstTileTitle: document.querySelector('#strip .tile[data-i] .t1')?.innerText || '',
  }))
  check('点另一张能切过去（改动都还在内存里，不会丢）', back.onIdx === 0, `onIdx=${back.onIdx}`)
  check('切过去之后表单换成那一条', back.title === back.firstTileTitle, `${back.title} vs ${back.firstTileTitle}`)

  // 收尾：这一步动过内容，关抽屉会弹确认（全局处理器会 accept），状态交还给【5】
  await page.click('#dwClose')
  await sleep(500)
  const closed2 = await page.evaluate(() => document.getElementById('drawer').hidden)
  check('（收尾）动过之后关抽屉照样关得掉', closed2 === true)

  /* ---------- 5. ★★ 有未保存改动时，关抽屉必须先问 ---------- */
  console.log('\n【5】★★ 不许一声不响地丢掉改动')
  dialogs.length = 0
  await page.click('#result .item')
  await sleep(1500)
  const frame2 = page.frames().find((f) => f.url().includes('travel-editor.html'))
  await frame2.waitForSelector('[data-k="summary"]', { timeout: 20000 })
  // 改一个字 → 编辑器应当把「有未保存的改动」报给外面那一页
  await frame2.evaluate(() => {
    const el = document.querySelector('[data-k="summary"]')
    el.value = el.value + '（改一下）'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(500)
  const told = await page.evaluate(() => !document.getElementById('dwDirty').hidden)
  check('★ 编辑器把「有未保存的改动」报给了外面那一页', told)
  await page.click('#dwClose')
  await sleep(700)
  const confirms = dialogs.filter((d) => d.type === 'confirm' && /未保存/.test(d.message))
  check(
    '★★ 关抽屉前弹了确认（不弹 = 家长刚写的散文会静默消失）',
    confirms.length === 1,
    JSON.stringify(dialogs),
  )
  check(
    '★★ 而且**只弹一次**（抽屉的 confirm + iframe 自己的 beforeunload 会连问两遍）',
    dialogs.filter((d) => d.type === 'beforeunload').length === 0,
    JSON.stringify(dialogs),
  )
  const stillOpen = await page.evaluate(() => !document.getElementById('drawer').hidden)
  check('确认之后才真的关掉', !stillOpen)
  dialogs.length = 0

  /* ---------- 6. 点一张**没内容**的卡片 ---------- */
  console.log('\n【6】点还没配内容的景点')
  await page.select('#fContent', 'gap')
  await sleep(400)
  /*
   * ★★ 09-26：**不能点第一张就假设它是空的**。
   *
   *    `boot()` 现在会拿"机器搜的那张图"**直接起第一条并填好信息**
   *    （家长：「默认图就是第一张图。不需要默认图啊……帮我填好信息」）。
   *    所以"点开是一条**空白**条目、体检提示缺摘要"这条路，
   *    只对**没有默认图**的那些景点成立（366/643 有图，剩 277 条没有）。
   *
   *    ⚠️ 挑法必须**从数据算**：写"第一张"会随机红 ——
   *       红不红取决于哪条排在最前，而不是取决于行为变没变。
   *    ⚠️ 机器图**有图时**那条路（起第一条 + 填好信息 + 体检通过）
   *       由 `_verify-travel-editor.mjs` 的第【11】节负责，**这里不重复测**
   *       （见本文件抬头："编辑器自己的行为由那个脚本负责"）。
   */
  const PHOTO_IDS = DATA('landmark-photos.json').items.map((p) => p.landmarkId)
  const gapId = await page.evaluate((noPhoto) => {
    const set = new Set(noPhoto)
    const hit = [...document.querySelectorAll('#result .item')].find((el) => set.has(el.dataset.id) === false)
    if (!hit) return null
    hit.scrollIntoView({ block: 'center' })
    hit.click()
    return hit.dataset.id
  }, PHOTO_IDS)
  await sleep(1600)
  check('找得到一个"既没内容、也没默认图"的景点', !!gapId, String(gapId))
  const frame3 = page.frames().find((f) => f.url().includes('travel-editor.html'))
  await frame3.waitForSelector('[data-k="title"]', { timeout: 20000 })
  await sleep(400)
  const blank = await frame3.evaluate(() => {
    const info = document.querySelector('.lminfo')
    const lm = (k) => document.querySelector(`.lminfo [data-lm="${k}"]`)?.innerText.trim() || ''
    return {
      lm: lm('landmarkId'),
      title: document.querySelector('[data-k="title"]')?.value || '',
      /*
       * ⚠️ 2026-09-25：地名 / 经纬度**不再是输入框**了 ——
       *    它们从地标派生，只读信息条里显示。
       *    ⚠️ 顺带：地标 id / 地名 / 坐标现在都不给手改，所以
       *       "新建条目忘了填地标"这种错**结构上不可能**再出现。
       */
      place: lm('name'),
      lnglat: lm('lnglat'),
      fame: lm('fame'),
      infoBad: !!info?.classList.contains('bad'),
      grade: document.querySelector('#grades button.on')?.innerText.trim() || '',
      dirty: !document.getElementById('dirty').hidden,
      report: document.getElementById('report')?.innerText.trim() || '',
    }
  })
  check('定位到了那个没内容的景点', blank.lm === gapId, `${blank.lm} vs ${gapId}`)
  check(
    '★ 直接给了一张**已经填好名字**的空白条目（地名 / 坐标 / 知名度从地标派生，信息条里看得见）',
    !!blank.title && !!blank.place && /\d/.test(blank.lnglat) && !!blank.fame && !blank.infoBad,
    `${blank.title} / ${blank.place} / ${blank.lnglat} / ${blank.fame}`,
  )
  check('默认等级是「顺路」', blank.grade === '顺路', blank.grade)
  check('★★ 这张空白是**我们造的、不算改动**（否则点开看一眼就会被问"有未保存的改动"）', blank.dirty === false)
  check('体检面板直接告诉他还缺什么', /缺摘要/.test(blank.report), blank.report.slice(0, 60))
  await page.screenshot({ path: `${SHOT_DIR}/_browse-3-blank.png` })

  // Esc 关闭（焦点刚被 openDrawer 放到了「关闭」上，所以是在父页里按的）
  await page.keyboard.press('Escape')
  await sleep(400)
  check('Esc 也能关掉抽屉', await page.evaluate(() => document.getElementById('drawer').hidden))

  /* ---------- 7. ★★ 在抽屉里存一条 → 外面那一页要**当场**变 ----------
     ★ 这一节会**真的写那个文件**（保存端点就是干这个的）。
        所以先读原始字节，跑完对不上就立刻还原 + 报红。
     ★ 守的是 postMessage 那条回执链：编辑器存完 → 父页重读内容包 →
        卡片标记 / 统计 / 筛选结果全部跟着走。
        少了它，家长存完回来一看数字没变，会以为**根本没存上**。 */
  console.log('\n【7】★★ 在抽屉里存一条，外面立刻变')

  const dataPath = resolve(process.cwd(), 'src/data/travel-contents.json')
  const fileBefore = readFileSync(dataPath)
  let fileAfter = fileBefore
  try {
    await page.select('#fContent', 'gap')
    await sleep(400)
    await page.click('#result .item')
    await sleep(1600)
    const fr = page.frames().find((f) => f.url().includes('travel-editor.html'))
    await fr.waitForSelector('[data-k="summary"]', { timeout: 20000 })
    await sleep(400)

    /* ⚠️ 地标 id 从只读信息条读（那个输入框 2026-09-25 删了） */
    const newId = await fr.evaluate(
      () => document.querySelector('.lminfo [data-lm="landmarkId"]')?.innerText.trim() || '',
    )
    const before = await page.evaluate(() => document.getElementById('stats').innerText.replace(/\n/g, ' '))

    // 只补它缺的那一项（标题 addFor 已经填好了；地名 / 坐标是从地标派生的）
    await fr.evaluate(() => {
      const el = document.querySelector('[data-k="summary"]')
      el.value = 'E2E 临时写的一条'
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(300)
    await fr.click('#save')
    await sleep(1800)

    fileAfter = readFileSync(dataPath)
    const after = await page.evaluate(() => document.getElementById('stats').innerText.replace(/\n/g, ' '))

    check('保存真的写进文件了（内容包多了一条）', JSON.parse(fileAfter.toString()).length === JSON.parse(fileBefore.toString()).length + 1, `${JSON.parse(fileBefore.toString()).length} → ${JSON.parse(fileAfter.toString()).length}`)
    check(
      '★★ 外面那一页的「已配内容的景点」当场 +1（靠 postMessage 回执，不是刷新页面）',
      after.includes(`${HAS_IDS.size + 1} / `) && !after.includes(`${HAS_IDS.size} / `),
      `${before.match(/\d+ \/ \d+/)?.[0]} → ${after.match(/\d+ \/ \d+/)?.[0]}`,
    )

    // 刚配好的那个景点，现在应该从「还没配内容」里消失、出现在「已配内容」里
    await page.select('#fContent', 'has')
    await sleep(500)
    const nowHas = await page.evaluate(() => [...document.querySelectorAll('#result .item')].map((x) => x.dataset.id))
    check('★ 刚配好的那个景点**移出了**缺口列表、并挂上了标记', nowHas.includes(newId) && nowHas.length === HAS_IDS.size + 1, `${nowHas.length} 张 · ${newId}`)
  } finally {
    if (!fileAfter.equals(fileBefore)) writeFileSync(dataPath, fileBefore)
  }

  /* ---------- 8. 控制台 ---------- */
  console.log('\n【8】控制台')
  const faviconOnly = badRequests.length > 0 && badRequests.every((u) => /favicon/i.test(u))
  const real = errors.filter(
    (e) => !/DevTools/i.test(e) && !(faviconOnly && /Failed to load resource/.test(e)),
  )
  check('没有控制台报错（favicon 那条除外）', real.length === 0, real.slice(0, 3).join(' | '))
  const bad2 = badRequests.filter((u) => !/favicon/i.test(u))
  check('没有 favicon 以外的 4xx/5xx 请求', bad2.length === 0, bad2.slice(0, 3).join(' | '))

  console.log(`\n${'='.repeat(46)}`)
  console.log(`  通过 ${pass} / 失败 ${fail}`)
  if (failures.length) console.log(`  ❌ ${failures.join('\n  ❌ ')}`)
  console.log(`${'='.repeat(46)}\n`)

  await browser.close()
  process.exit(fail > 0 ? 1 : 0)
}

await main()
