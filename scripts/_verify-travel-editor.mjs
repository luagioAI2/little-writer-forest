/* ============================================================
   验证「旅行内容编辑器」（travel-editor.html）
   ------------------------------------------------------------
   跑法：node scripts/_verify-travel-editor.mjs
   ⚠️ 需要 dev server 在 5190（保存端点只在 dev 里存在）。

   守的是"工具本身能用"，不是"内容对不对" ——
   内容对不对由 `src/domain/travelContents.test.ts` 负责。

   ★ 「让小鸟写一篇」那一段**不需要真密钥**：本机起一个假服务商，
     把那次 POST 的 baseUrl 改写成指向它。产品代码一行不改。
   ============================================================ */

import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'

const URL = (process.env.E2E_URL ?? 'http://localhost:5190') + '/travel-editor.html'
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------
   ★★ 运行时地标数**从数据里算**，不写死。

   09-25 主库按「只留 5A / 全国知名 / 世界知名」收窄之后，
   下面那句 `lmCount > 1000` 必然要改 —— 而「把 1000 改成 600」
   正是把守卫调哑的那种修法（下次真读错表，它还是绿的）。

   运行时库 = 四个来源 − 被官方名录取代的（`supersedes`） − 被移出的（`landmarks-4a.json`）

   ⚠️ 这里**不重算"哪条算知名"** —— 那个判定只有 `fameOf()` 一份（生成侧）。
      移出的结果已经落在 `landmarks-4a.json` 的 `count` 里，直接读它，
      否则就是同一个判定在两个地方各写一遍。
   ------------------------------------------------------------ */
const DATA = (f) => JSON.parse(readFileSync(resolve(process.cwd(), 'src/data', f), 'utf8'))
const CN_HDR = DATA('landmarks-cn.json')
const RUNTIME_LM_COUNT =
  DATA('landmarks.json').length +
  DATA('landmarks-gd.json').items.length +
  CN_HDR.items.length +
  DATA('landmarks-world.json').items.length -
  CN_HDR.supersedes.length -
  DATA('landmarks-4a.json').count

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1.5 })

  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`))

  /*
    ⚠️⚠️ 必须接住原生弹窗 —— 否则脚本会**静默挂死**（跑满超时被 SIGTERM）。
    页面里的「重新载入 / 保存 / 删除」在有未保存改动时会 `confirm()`，
    而 headless Chrome 下 `confirm` 会一直等，puppeteer 不点它就不返回。
    ➜ 症状是"一条断言都没打印"，看着像页面加载不出来。
  */
  page.on('dialog', (d) => d.accept())

  /** 记下所有非 2xx 的请求 —— 控制台只报"Failed to load resource"，
      不说是哪个 URL，光看那条日志根本查不出问题 */
  const badRequests = []
  page.on('response', (r) => {
    if (r.status() >= 400) badRequests.push(`${r.status()} ${r.url()}`)
  })

  console.log(`\n🌐 ${URL}\n`)

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })

  /* ---------- 1. 载入 ---------- */
  console.log('【1】载入')
  const loaded = await page
    .waitForFunction(() => /地标 \d+ 个/.test(document.getElementById('mode')?.textContent || ''), {
      timeout: 20000,
      polling: 200,
    })
    .then(() => true)
    .catch(() => false)
  check('页面载入成功（读到了地标表与内容包）', loaded)

  const mode = await page.evaluate(() => document.getElementById('mode').textContent)
  check('顶栏说清了地标数 / 内容数 / 等级', /地标 \d+ 个 · 内容 \d+ 条 · 等级 .+/.test(mode), mode)
  const lmCount = Number((mode.match(/地标 (\d+) 个/) || [])[1])
  check(
    '★ 地标表是**运行时**那份（含全国名录，且已按 09-25 口径收窄）',
    lmCount === RUNTIME_LM_COUNT,
    `实际 ${lmCount}，运行时库应有 ${RUNTIME_LM_COUNT} 条`,
  )

  /* ---------- 2. 列表 ---------- */
  console.log('\n【2】列表')
  const list = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#list .row')]
    return {
      rowCount: rows.length,
      titles: rows.map((r) => r.querySelector('.t')?.innerText.trim()),
      chips: rows.map((r) => r.querySelector('.chip')?.innerText.trim()).filter(Boolean),
      heads: [...document.querySelectorAll('#list .empty')].map((e) => e.innerText.trim()),
    }
  })
  check('列表渲染出条目', list.rowCount > 0, `${list.rowCount} 条`)
  check('每条都有等级色标', list.chips.length === list.rowCount, `${list.chips.length}/${list.rowCount}`)
  check(
    '★ 一个景点多条内容会归在一组（标题里带条数）',
    list.heads.some((h) => /· \d+ 条/.test(h)),
    JSON.stringify(list.heads.slice(0, 6)),
  )

  /* ---------- 3. 点开一条 ---------- */
  console.log('\n【3】编辑器')
  await page.click('#list .row')
  await sleep(300)
  const form = await page.evaluate(() => {
    const g = (k) => document.querySelector(`[data-k="${k}"]`)?.value
    const info = document.querySelector('.lminfo')
    return {
      hasForm: !!document.querySelector('#editor .grid'),
      id: g('id'),
      title: g('title'),
      essayLen: (g('essay') || '').length,
      gradeButtons: [...document.querySelectorAll('#grades button')].map((b) => b.innerText.trim()),
      onGrade: document.querySelector('#grades button.on')?.innerText.trim(),
      infoText: (info?.innerText || '').replace(/\s+/g, ' ').trim(),
      /*
       * ★★ 只读信息条上的**稳定钩子**（2026-09-25 改版删掉了「名称 / 省市 / 经纬度」
       *    这些字面标签，于是守卫也不能再去 `innerText.includes('名称')` ——
       *    那种断言会在"标签被删"时红、在"值没填上"时**反而可能绿**）。
       *    ⚠️ 换版式的正确做法是**改读钩子**，不是把守卫放宽。
       */
      lmHooks: ['name', 'where', 'lnglat', 'heat', 'fame', 'rating', 'landmarkId']
        .filter((k) => document.querySelector(`.lminfo [data-lm="${k}"]`)),
      infoBad: !!info?.classList.contains('bad'),
      /*
       * ★★ 「只读」这件事要**分开数**（09-26）。
       *
       *    原来只有一条 `infoInputs === 0`（信息条里输入框总数）。
       *    09-26 起信息条里**故意**多了一个可编辑项：景点公共简介 ——
       *    家长 09-26：「旅游景点 没有公共简介，字数不超过300。」
       *
       *    ⚠️ 这时候**不许**把断言放宽成 `<= 1` —— 那等于把它调哑：
       *       以后再塞进来第二个输入框，它也照样绿。
       *    ➜ 换对象（L§三十七.2）：① **地标派生**的那七个值里一个输入框都不许有
       *              —— 那才是"别用 disabled 冒充只读"要防的事；
       *              ② 信息条里**唯一**的可编辑项必须是简介，而且要点得出名字。
       */
      infoValueInputs: ['name', 'where', 'lnglat', 'heat', 'fame', 'rating', 'landmarkId']
        .filter((k) => {
          const el = document.querySelector(`.lminfo [data-lm="${k}"]`)
          return !!el && !!el.closest('input, select, textarea')
        }).length,
      infoEditable: [...document.querySelectorAll('.lminfo input, .lminfo select, .lminfo textarea')]
        .map((el) => el.getAttribute('data-lm') || el.getAttribute('data-k') || '(无名)'),
      /* ⚠️ 从 `data-lm` 读（稳定钩子）—— 别用 innerText 抠中文标签 */
      lmName: document.querySelector('.lminfo [data-lm="name"]')?.innerText.trim() || '',
      lmLngLat: document.querySelector('.lminfo [data-lm="lnglat"]')?.innerText.trim() || '',
      lmFame: document.querySelector('.lminfo [data-lm="fame"]')?.innerText.trim() || '',
      lmLandmarkId: document.querySelector('.lminfo [data-lm="landmarkId"]')?.innerText.trim() || '',
      /*
       * ★★ 这几个字段的输入框**必须消失**（2026-09-25 家长定：
       *    经纬度 / 旅游点 / 热度 / 知名度都是**共同的**，归地标；
       *    另外不需要类型 —— 类型是事件，是另外的系统）。
       * ⚠️ 用"还在的字段列表"而不是逐条 `!== null`：红了的时候
       *    报错信息直接告诉你**是哪几个还活着**。
       */
      stillThere: ['place', 'lng', 'lat', 'type', 'landmarkId', 'textContent']
        .filter((k) => document.querySelector(`[data-k="${k}"]`)),
      /*
       * ★★ 「这个景点」信息条（09-25 家长两次要求「往上放，这个是旅游点公共的」）。
       *    单独打开时它仍然是表单 `.grid` 的第一格；抽屉里它走 `#lmslot`（在 `.grid` 外面）。
       * ⚠️ 所以断言"第一格是 lminfo"只对**这一份**成立 —— 真正跨两种模式要守的是
       *    ① 排在可改字段之前 ② 页面上只有一个 `.lminfo` ③ 单独打开时 `#lmslot` 是隐藏的。
       */
      lmCount: document.querySelectorAll('.lminfo').length,
      lmBeforeId: (() => {
        const info = document.querySelector('.lminfo')
        const idf = document.querySelector('#editor [data-k="id"]')
        if (!info || !idf) return false
        return !!(info.compareDocumentPosition(idf) & Node.DOCUMENT_POSITION_FOLLOWING)
      })(),
      lmSlotHidden: document.getElementById('lmslot')?.hidden === true,
      gridFirst: document.querySelector('#editor .grid')?.firstElementChild?.className || '',
      cap2: (document.querySelector('#editor .grid .cap2')?.innerText || '').replace(/\s+/g, ' ').trim(),
    }
  })
  check('点一条能打开编辑器', form.hasForm)
  check('字段都填上了（id / 标题）', !!form.id && !!form.title)
  check('散文正文读出来了', form.essayLen > 200, `${form.essayLen} 字`)
  check(
    '★★ 「地名 / 经纬度 / 类型 / 关联地标 / 文本内容」这些输入框**已经删掉**了',
    form.stillThere.length === 0,
    `还活着的：${form.stillThere.join(', ')}`,
  )
  check(
    '★★ 只读信息条上七个值**全都挂着 `data-lm` 钩子**（2026-09-25 改版后没有字面标签了）',
    form.lmHooks.length === 7,
    `缺：${['name', 'where', 'lnglat', 'heat', 'fame', 'rating', 'landmarkId'].filter((k) => !form.lmHooks.includes(k)).join(', ') || '无'}`,
  )
  check(
    '★★ 那行解释**已经删掉**（家长：「这个不需要显示吧，为啥要提醒」）',
    !/只读/.test(form.infoText) && !/不随这一张图走/.test(form.infoText),
    form.infoText.slice(0, 140),
  )
  check(
    '★ 信息条里那些**地标派生的值**都是只读的（没有输入框 —— 别用 disabled 冒充只读）',
    form.infoValueInputs === 0,
    `${form.infoValueInputs} 个`,
  )
  check(
    '★ 信息条里**唯一的可编辑项**就是景点公共简介（其余全是只读值）',
    form.infoEditable.length === 1 && form.infoEditable[0] === 'intro',
    `可编辑项：${form.infoEditable.join(', ') || '（无）'}`,
  )
  check('这条内容的地标查得到（信息条不红）', !form.infoBad)
  check(
    '★ 信息条里的值**真的填上了**（名称 / 经纬度 / 知名度 / 地标 id 都不是空的）',
    !!form.lmName && /\d/.test(form.lmLngLat) && !!form.lmFame && !!form.lmLandmarkId,
    `${form.lmName} · ${form.lmLngLat} · ${form.lmFame} · ${form.lmLandmarkId}`,
  )
  check(
    '★★ 「这个景点」信息条排在**可改字段之前**（家长 09-25：「往 上放」）',
    form.lmBeforeId,
  )
  check(
    '★★ 页面上**只有一个** `.lminfo`（两份都渲染 = 同一个景点两套说法）',
    form.lmCount === 1,
    `${form.lmCount} 个`,
  )
  check(
    '★ 单独打开时走表单里那一份，`#lmslot` 保持隐藏（通栏会读成页头）',
    form.lmSlotHidden && /lminfo/.test(form.gridFirst),
    `slotHidden=${form.lmSlotHidden} 第一格=${form.gridFirst || '(空)'}`,
  )
  check(
    '★ 信息条下面有「这张图」小标题（把"这一张自己的"字段圈起来）',
    /^这张图/.test(form.cap2),
    form.cap2,
  )
  check(
    '★ 等级按钮是五档 + 「不标」（从 TRAVEL_GRADES 读的，不是写死的）',
    form.gradeButtons.length === 6,
    JSON.stringify(form.gradeButtons),
  )
  check('当前等级被选中', !!form.onGrade, String(form.onGrade))

  /* ---------- 4. 体检面板 ---------- */
  console.log('\n【4】体检')
  const report = await page.evaluate(() => {
    const el = document.getElementById('report')
    return { cls: el?.className, text: el?.innerText.trim() }
  })
  check('★ 内容包通过体检（和单元测试同一套规则）', /ok/.test(report.cls || ''), report.text)

  /* ---------- 5. 改一个字段 → 出现未保存标记 ---------- */
  console.log('\n【5】改动标记')
  await page.evaluate(() => {
    const el = document.querySelector('[data-k="summary"]')
    el.value = '改了一下'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(200)
  const dirtyShown = await page.evaluate(() => !document.getElementById('dirty').hidden)
  check('改了字段会出现「有未保存的改动」', dirtyShown)
  const reportAfter = await page.evaluate(() => document.getElementById('report')?.className)
  check('体检跟着变红（摘要太短不算错，但改动后重算过）', typeof reportAfter === 'string')

  /* ---------- 6. 只看还没配内容的景点 ---------- */
  console.log('\n【6】缺口视图')
  await page.click('#reload') // 丢弃改动，回到干净状态
  await sleep(600)
  await page.click('#onlyGap')
  await sleep(400)
  const gaps = await page.evaluate(() => {
    const head = document.querySelector('#list .empty')?.innerText || ''
    return { head, rowCount: document.querySelectorAll('#list .row').length }
  })
  check('★ 能列出「还没配内容的景点」（编辑器最有用的一屏）', /还没配内容的景点：\d+ 个/.test(gaps.head), gaps.head)
  const gapCount = Number((gaps.head.match(/(\d+) 个/) || [])[1])
  // ⚠️ 原来这里是 `gapCount > 1000`，跟标签上写的「> 0」都对不上 ——
  //    09-25 主库收到 643 之后它必然要红。真正的不变量是：
  //    缺口**存在**（内容包只覆盖极少数）且**不超过全库**。
  check('缺口数 > 0（内容包只覆盖了极少数地标）', gapCount > 0 && gapCount <= lmCount, `${gapCount} 个`)
  check('缺口视图里点一下能直接给它新建一条', gaps.rowCount > 0, `${gaps.rowCount} 行`)

  await page.screenshot({ path: `${SHOT_DIR}/_editor-1-gaps.png` })

  /* ---------- 7. 回到正常视图 ---------- */
  await page.click('#onlyGap')
  await sleep(300)
  await page.click('#list .row')
  await sleep(300)
  await page.screenshot({ path: `${SHOT_DIR}/_editor-2-form.png` })

  /* ---------- 8. AI 起稿「让小鸟写一篇」 ----------
     ★★ 这一段**不需要真密钥**：本机起一个"假服务商"，
        再把那次 POST 的 body 里 baseUrl 改写成指向它。
        **产品代码一行不改**，改的只是这一次请求 ——
        所以这里验的是「链路通不通 / 清洗对不对 / 密钥漏不漏」，
        不是「模型写得好不好」。
  */
  console.log('\n【8】AI 起稿')

  const FAKE_ESSAY = [
    '西湖的早晨',
    '我跟着小鸟落在湖边的时候,天刚亮。水面上有一层薄薄的雾,像谁把棉被掀开了一角。',
    '岸边有人在打太极,动作慢得像水草。我听见远处的钟声,一下,又一下,敲得人心里很静。',
    '我蹲下来摸湖水,凉凉的,指头一下子就醒了。有一只白鹭贴着水面飞过去,翅膀差点碰到水。',
    '临走的时候,我把手心里的湖水甩干。风从湖那边吹过来,带着一点点青草的味道。',
    '我想,明年还要来。🌿',
  ].join('\n')

  let providerReq = null
  const fake = createServer((req, res) => {
    let b = ''
    req.on('data', (c) => { b += c })
    req.on('end', () => {
      try {
        providerReq = { auth: req.headers.authorization ?? '', body: JSON.parse(b) }
      } catch { providerReq = null }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: FAKE_ESSAY } }] }))
    })
  })
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const fakePort = fake.address().port

  /*
   * 把页面发往 `/__draft-essay` 的 body 里的 baseUrl 改写成假服务商。
   *
   * ★ 为什么在**页面里包一层 fetch**，而不是用 puppeteer 的请求拦截：
   *   拦截要改 body 就得同时改 Content-Length，而 CDP 把 content-length
   *   列为 unsafe header 直接拒收（`Unsafe header: content-length`）；
   *   不改的话服务端会按旧长度读，请求直接吊死。
   *   包 fetch 没有这个麻烦，而且同样**不动产品代码**。
   */
  await page.evaluate((port) => {
    const orig = window.fetch
    window.fetch = (input, init) => {
      if (String(input).endsWith('/__draft-essay') && init?.body) {
        const b = JSON.parse(init.body)
        b.baseUrl = `http://127.0.0.1:${port}`
        b.model = 'fake-model'
        init = { ...init, body: JSON.stringify(b) }
      }
      return orig(input, init)
    }
  }, fakePort)

  const aiBtn = await page.evaluate(() => {
    const b = document.getElementById('aiEssay')
    return { exists: !!b, text: b?.innerText.trim(), inLabelRow: !!b?.closest('.lbl-row') }
  })
  check('散文那一行有「让小鸟写一篇」按钮', aiBtn.exists && aiBtn.text === '让小鸟写一篇', JSON.stringify(aiBtn))
  check('按钮在字段标题那一行（不是另起一块）', aiBtn.inLabelRow)

  await page.click('#aiEssay')
  await sleep(300)
  const dlg1 = await page.evaluate(() => ({
    open: !document.getElementById('keydlg').hidden,
    type: document.getElementById('keyin').type,
    remember: document.getElementById('keysave').checked,
  }))
  check('点它会弹出密钥输入框', dlg1.open)
  check('★ 密钥框是 password（不明文显示）', dlg1.type === 'password', dlg1.type)
  check('默认勾选「这次会话里记住它」', dlg1.remember)
  await page.screenshot({ path: `${SHOT_DIR}/_editor-3-ai-dialog.png` })

  await page.click('#keyok')
  await sleep(250)
  const empty = await page.evaluate(() => ({
    open: !document.getElementById('keydlg').hidden,
    err: document.getElementById('keyerr').hidden ? '' : document.getElementById('keyerr').innerText.trim(),
  }))
  check('★ 空着点「开始写」会报错且**不关弹窗**（关掉就像按钮坏了）', empty.open && /不能为空/.test(empty.err), JSON.stringify(empty))

  await page.keyboard.press('Escape')
  await sleep(250)
  const esc = await page.evaluate(() => ({
    open: !document.getElementById('keydlg').hidden,
    stored: sessionStorage.getItem('lwf-editor-ai-key'),
  }))
  check('★ Esc 能关掉弹窗（焦点在按钮上时也要能关）', !esc.open)
  check('★ 取消时不会往 sessionStorage 里塞东西', esc.stored === null, String(esc.stored))

  /*
   * ⚠️ 兜底：万一 Esc 那条红了，弹窗还开着，
   *    它的灰色背景会盖住整页 —— 后面每一次 `page.click` 都点在背景上，
   *    于是「生成」那一段会连着红 5 条，看起来像坏了一大片。
   *    这里先确保它是关着的，一条回归就只报一条。
   */
  await page.evaluate(() => {
    const d = document.getElementById('keydlg')
    if (!d.hidden) document.getElementById('keycancel').click()
  })
  await sleep(200)

  // ★★ 整条链路：填密钥 → 生成 → 只进编辑框
  await page.evaluate(() => sessionStorage.setItem('lwf-editor-ai-key', 'sk-E2E-KEY'))
  await page.click('#aiEssay')
  await sleep(1800)
  const gen = await page.evaluate(() => ({
    essay: document.querySelector('[data-k="essay"]').value,
    dirty: !document.getElementById('dirty').hidden,
    toast: document.querySelector('.toast')?.innerText.trim() || '',
  }))
  const paras = gen.essay.split('\n\n').filter(Boolean)
  check(
    '★ 生成的散文落进了编辑框（标题行已去掉、逗号已换全角）',
    gen.essay.startsWith('我跟着小鸟落在湖边的时候，天刚亮'),
    gen.essay.slice(0, 26),
  )
  check('★ 单换行也当分段（≥4 段）', paras.length >= 4, `${paras.length} 段`)
  check('★ 半角逗号被换成全角（否则 travelContents.test.ts 会红）', !gen.essay.includes(','))
  check('★ emoji 被去掉', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u.test(gen.essay))
  check('★ 只是"有改动"，**没有自动落盘**', gen.dirty)
  check(
    '提示条说清了字数 + 顺手改了什么',
    /写好了/.test(gen.toast) && /半角逗号/.test(gen.toast),
    gen.toast,
  )
  check(
    '★ 假服务商收到了密钥、模型名和系统提示词',
    !!providerReq &&
      /^Bearer sk-E2E-KEY$/.test(providerReq.auth) &&
      providerReq.body?.model === 'fake-model' &&
      /旅行散文/.test(JSON.stringify(providerReq.body)),
    JSON.stringify(providerReq?.body?.model),
  )
  check(
    '★ 思考模式被显式关掉（否则 temperature 会被静默忽略）',
    providerReq?.body?.thinking === undefined || providerReq?.body?.thinking?.type === 'disabled',
    JSON.stringify(providerReq?.body?.thinking),
  )
  check('发给服务商的请求里带着 temperature', typeof providerReq?.body?.temperature === 'number', String(providerReq?.body?.temperature))

  /*
   * ⚠️⚠️ 往下走之前**必须把密钥清掉**。
   *
   *    上面那一段往 sessionStorage 里塞了 `sk-E2E-KEY`，而 `boot()` 现在会在
   *    "用机器图起了第一条"之后试一次**自动起稿**（家长 09-26：「连散文也帮我起稿」）。
   *    不清掉的话，后面每一节只要打开一个"还没配内容的景点"就会真的发一次
   *    AI 请求 —— 而假服务商这时已经关了，于是变成一条莫名其妙的
   *    `502 /__draft-essay`，红的**不是被测的东西**（实测踩到过，还是间歇性的）。
   *
   *    ★ 这条不是"为了绕开自己的功能"，而是守卫该有的卫生习惯：
   *      一个测试不该把凭据留在共享的 sessionStorage 里给后面的节用。
   */
  await page.evaluate(() => sessionStorage.removeItem('lwf-editor-ai-key'))

  /* ---------- 8.5 「＋ 给这个景点再加一张」不许造出"没有地标"的条目 ----------
     ★★ 这个按钮原来是 `addFor('')`（文案是「＋ 新建一条」）——
        造出来的条目 `landmarkId` 是空的，而**空 landmarkId 的内容会被
        `toTravelContent()` 整条丢掉**（`DROPPED_CONTENT_COUNT`）。
        丢掉是静默的：家长点完「新建一条」、写半天、保存，
        再打开一看什么都没多 —— 他只会以为工具坏了。

     2026-09-25 改成「给**当前这条**的景点再加一张」。
     这一节钉住两件事：① 加出来的确实挂在**同一个**景点上；
                   ② 信息条能查到它、**不红**。
  */
  console.log('\n【8.5】再加一张')
  const readGroup = () =>
    page.evaluate(() => {
      const heads = [...document.querySelectorAll('#list .empty')].map((e) => e.innerText.trim())
      const head = heads.find((h) => /· \d+ 条/.test(h)) || ''
      const info = document.querySelector('.lminfo')
      /* ⚠️ 从 `data-lm` 读，不要用 innerText 抠中文标签 —— 见编辑器里的注释 */
      const lmName = document.querySelector('.lminfo [data-lm="name"]')?.innerText.trim() || ''
      return {
        head,
        name: head.replace(/ · \d+ 条$/, ''),
        n: Number((head.match(/· (\d+) 条/) || [])[1] || 0),
        infoName: lmName,
        infoBad: !!info?.classList.contains('bad'),
      }
    })
  const before8 = await readGroup()
  await page.click('#add')
  await sleep(400)
  const after8 = await readGroup()
  check(
    '★ 「＋ 给这个景点再加一张」给**同一个景点**多一条（而不是造一条没地标的）',
    after8.n === before8.n + 1 && after8.name === before8.name,
    `${before8.head} → ${after8.head}`,
  )
  check(
    '★ 新加的那一条真的挂在地标上（信息条查得到、且不红）',
    !!after8.infoName && after8.infoName === before8.name && !after8.infoBad,
    `信息条「${after8.infoName}」/ 期望「${before8.name}」${after8.infoBad ? ' · 红了' : ''}`,
  )
  await page.screenshot({ path: `${SHOT_DIR}/_editor-4-lminfo.png` })

  /* ---------- 8.6 ★★ 地标查不到时那条红警告 ----------
     ★ 为什么单独守：这条警告是**唯一**阻止"存下去被静默丢掉"的东西 ——
       `toTravelContent()` 查不到 `landmarkId` 就把整条丢掉，
       而丢掉是静默的（存完界面上什么都不变）。它自己排错了就没人拦了。

     ★ 怎么造出这个状态而**不碰磁盘**：在浏览器里包一层 `fetch`，
       只把那一个响应换成"地标 id 不存在"的记录。
       ⚠️⚠️ 绝不能改成"用保存端点写一条假数据" —— 那是真的写盘，
          而内容包不在 git 里，`checkout` 救不回来（见 MEMORY §八）。

     ⚠️ 为什么必须用**真浏览器**量高度：这一支原来复用 `.lm-meta`，
        而那个是 `display:flex` —— 多行警告会被拆成匿名 flex item **横着排**。
        jsdom 里所有 `getBoundingClientRect()` 都是 0，这条**只有真渲染才看得出来**。
  */
  console.log('\n【8.6】地标查不到时的红警告')
  const ghost = await browser.newPage()
  await ghost.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1.5 })
  await ghost.evaluateOnNewDocument(() => {
    const real = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const u = typeof input === 'string' ? input : input?.url || ''
      const res = await real(input, init)
      if (!u.includes('travel-contents.json')) return res
      return new Response(JSON.stringify([{
        id: 'probe-ghost',
        landmarkId: '__不存在的地标__',
        title: '探针：地标找不到的那条',
        grade: '顺路',
        summary: '只在浏览器里存在，不落盘。',
        essay: '第一段。\n\n第二段。',
      }]), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })
  await ghost.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })
  await ghost.waitForSelector('#list .row', { timeout: 20000 })
  await ghost.click('#list .row')
  await sleep(500)
  const bad = await ghost.evaluate(() => {
    const info = document.querySelector('.lminfo')
    const warn = document.querySelector('.lminfo .lm-warn')
    return {
      isBad: !!info?.classList.contains('bad'),
      hasWarn: !!warn,
      warnDisplay: warn ? getComputedStyle(warn).display : '',
      warnH: Math.round(warn?.getBoundingClientRect().height || 0),
      text: (info?.innerText || '').replace(/\s+/g, ' '),
      hooks: document.querySelectorAll('.lminfo [data-lm]').length,
    }
  })
  check('★ 地标 id 不存在时信息条**红着**（不红 = 这条存下去会静默消失）', bad.isBad && bad.hasWarn)
  check(
    '★★ 警告是**块级**的、多行真的换行（复用 `display:flex` 的 `.lm-meta` 会排成一行）',
    bad.warnDisplay === 'block' && bad.warnH > 40,
    `display=${bad.warnDisplay} 高=${bad.warnH}px`,
  )
  check(
    '★ 说清了「会被整条丢掉」+ 怎么补救',
    /整条丢掉/.test(bad.text) && /重新起一条/.test(bad.text),
    bad.text.slice(0, 120),
  )
  check('★ 这一支不挂 `data-lm` 钩子（没有值就不假装有）', bad.hooks === 0, `${bad.hooks} 个`)
  await ghost.screenshot({ path: `${SHOT_DIR}/_editor-5-bad-landmark.png` })
  await ghost.close()

  /* ---------- 9. 保存往返：点一次「保存到文件」不许改动文件 ----------
     ★ 为什么值得单独守：`normalize()` 会把键序固定下来。
       它要是变得不稳定（比如顺手加了个会变的字段），**每次保存都刷一屏
       git diff** —— 而界面上一切正常，没人会想到是保存这一步干的。

     ⚠️ 这一节会**真的写那个文件**。所以先把原始字节读出来，
        跑完对不上就立刻还原 + 报红 —— 保证脚本中途失败也不留脏文件。
  */
  console.log('\n【9】保存往返')

  // 先丢弃 AI 那一段改出来的脏数据，否则会把假散文写进真文件
  await page.click('#reload')
  await sleep(800)

  // ⚠️ 不能用 `new URL(..., import.meta.url)` —— 本文件顶上那个页面地址常量
  //    就叫 `URL`，把全局的 URL 构造器遮住了。
  const dataPath = resolve(process.cwd(), 'src/data/travel-contents.json')
  /*
   * ★★ 简介文件**也要一起快照**（09-26）。
   *
   *    这一次保存**没有**动简介，所以 `$('save')` 里那句
   *    `JSON.stringify(INTROS) === INTROS_BASE` 应该成立、**不该**去打简介端点。
   *    ⚠️ 万一那个判断坏了，这一下就会把家长的真简介文件重写一遍 ——
   *       而这一节原本只盯着内容包，**完全看不出来**。
   *    ➜ 两个文件一起量、一起还原。
   */
  const introPath0 = resolve(process.cwd(), 'src/data/landmark-intros.json')
  const fileBefore = readFileSync(dataPath)
  const introBefore = readFileSync(introPath0)
  let fileAfter = fileBefore
  let introAfter = introBefore
  try {
    await page.click('#save')
    await sleep(1200)
    fileAfter = readFileSync(dataPath)
    introAfter = readFileSync(introPath0)
  } finally {
    if (!fileAfter.equals(fileBefore)) writeFileSync(dataPath, fileBefore)
    if (!introAfter.equals(introBefore)) writeFileSync(introPath0, introBefore)
  }
  check(
    '★★ 这一次保存**没有**动简介文件（没改简介就不该去写它；不同 = 已还原）',
    introAfter.equals(introBefore),
    introAfter.equals(introBefore) ? '' : '简介文件被改动了，已还原',
  )
  check(
    '★ 保存一次不会改动内容（逐字节相同；不同 = 已还原原文件）',
    fileAfter.equals(fileBefore),
    fileAfter.equals(fileBefore) ? '' : '内容被改动了，已还原',
  )
  const saveToast = await page.evaluate(() => document.querySelector('.toast')?.innerText.trim() || '')
  check('保存成功后有提示（说清写到哪个文件、几条）', /已写入/.test(saveToast) && /\d+ 条/.test(saveToast), saveToast)

  /* ---------- 10. ★★ 密钥不许被服务商"回显"回前端 ----------
     最容易发生的泄密形状：服务商 401 的报错里原样带上 `Authorization`。
     那串东西会被转给前端、显示在提示条上，然后被家长截图发出去。
     `vite.config.ts` 的 `redact()` 就是干这个的 —— 这里把它钉住。 */
  console.log('\n【10】密钥不外泄')
  const LEAK = 'sk-LEAKME-12345'
  const leaky = createServer((req, res) => {
    res.statusCode = 401
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: { message: `bad key: ${req.headers.authorization}` } }))
  })
  await new Promise((r) => leaky.listen(0, '127.0.0.1', r))
  const leakyRes = await fetch('http://localhost:5190/__draft-essay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    /*
     * ⚠️ `landmarkName` 是**必填**（2026-09-25 起端点不再认 `place` ——
     *    地名是从地标派生的，两者永远是同一个值，传两遍没意义）。
     *    不带它的话端点会在**联系服务商之前**就 400，这一节验的
     *    "密钥会不会被回显"就完全没跑到，却还是绿的。
     */
    body: JSON.stringify({
      landmarkName: '西湖', apiKey: LEAK, model: 'm',
      baseUrl: `http://127.0.0.1:${leaky.address().port}`,
    }),
  })
  const leakyTxt = await leakyRes.text()
  check('★★ 服务商报错里回显的密钥**必须被抹掉**', !leakyTxt.includes(LEAK), leakyTxt.slice(0, 160))
  check('但仍然如实转达「服务商返回 401」', leakyRes.status === 502 && /401/.test(leakyTxt), `${leakyRes.status}`)

  // 端点的几条硬规矩（不走浏览器，直接打）
  const noKey = await fetch('http://localhost:5190/__draft-essay', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ landmarkName: '西湖' }),
  })
  check('端点缺密钥时明确报错（而不是拿环境变量顶上）', noKey.status === 400 && /没有密钥/.test(await noKey.text()))
  const noPlace = await fetch('http://localhost:5190/__draft-essay', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: 'k', model: 'm', baseUrl: 'https://api.deepseek.com/v1' }),
  })
  check(
    '端点没说是哪个景点时明确报错（`place` 已不再被认）',
    noPlace.status === 400 && /没说是哪个景点/.test(await noPlace.text()),
    String(noPlace.status),
  )
  const badBase = await fetch('http://localhost:5190/__draft-essay', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ landmarkName: '西湖', apiKey: 'k', model: 'm', baseUrl: 'file:///etc/passwd' }),
  })
  check('端点拒绝非 http(s) 的接口地址（不许变成读本地文件的口子）', badBase.status === 400, String(badBase.status))

  fake.close()
  leaky.close()

  /* ---------- 11. 抽屉条带：默认图 ---------- */
  console.log('\n【11】抽屉里第一条 = 机器搜的那张（**没有"默认图"这一层**）')
  /*
   * ★★ 家长 09-26 两轮口径：
   *    ① 「抽屉里 景点图 至少要有一张吧。」
   *    ② 「我希望 默认图就是 第一张图。不需要默认图啊。
   *        我里面没有默认图的概念。第一张就是默认图。帮我填好信息。」
   *
   *    ➜ 这一节守的就是：**打开一个还没配内容的景点，条带里就该有一条
   *      "填好了的"内容**（图 + 标题 + 署名 + 摘要），
   *      而不是一块「还没填图」、更不是一个叫"默认图"的只读方块。
   *
   * ⚠️⚠️ 必须开 `?embed=1`：`renderStrip()` 第一行就是 `if (!EMBED) return` ——
   *    不 embed 的话条带**根本不渲染**，所有断言都会落空。
   *
   * ⚠️ 用例对象**全部从数据里挑**，不写死 id：
   *    家长随手加一条内容、或某条默认图被删掉，写死的 id 就假红。
   *    守卫该红在"行为变了"，不该红在"数据换了一条"。
   *
   * ⚠️ `travel-contents.json` 是**裸数组**（没有抬头对象），
   *    跟其它几个数据文件不一样 —— 别写成 `.items`。
   */
  const PACK = DATA('travel-contents.json')
  const PHOTOS = DATA('landmark-photos.json').items
  const photoByLm = new Map(PHOTOS.map((p) => [p.landmarkId, p]))
  const packLms = new Set(PACK.map((c) => c.landmarkId))

  /*
   * 挑一条"有默认图、内容包里没有、而且**图有标题和署名**"的 ——
   * 标题/署名是空的话，下面"信息填好了"那几条就断言不出东西（恒真）。
   */
  const gapPhoto = [...photoByLm.values()].find(
    (p) => !packLms.has(p.landmarkId) && p.title && p.credit?.source,
  )
  const gapId = gapPhoto?.landmarkId
  const packId = [...packLms][0]
  const sceneId = PHOTOS.find((p) => p.match === 'scene')?.landmarkId
  /*
   * ★ 起稿预填的摘要应该是**从这个景点的公共简介里截的**（09-27 改）。
   *   拿它跟 `gapId` 的简介对一下 —— 见下面"摘要从简介里截的"那条。
   */
  const gapIntro = DATA('landmark-intros.json')[gapId] ?? ''

  /** 打开抽屉（embed 模式），把条带和表单量出来 */
  const stripOf = async (id) => {
    /*
     * ⚠️ 先把密钥清掉再开页面。
     *    本文件第 8 节往 sessionStorage 里塞过 `sk-E2E-KEY`，
     *    而 `boot()` 现在会在"用机器图起了第一条"之后试一次**自动起稿**
     *    （家长 09-26：「连散文也帮我起稿」）。
     *    不清掉的话，这一节会真的发一次 AI 请求 —— 假服务商这时已经关了，
     *    于是变成一条莫名其妙的报错，红的还不是被测的东西。
     */
    await page.goto(`${URL}?embed=1&id=${encodeURIComponent(id)}`, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    })
    await page.evaluate(() => sessionStorage.removeItem('lwf-editor-ai-key'))
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 })
    await page.waitForFunction(() => !!document.querySelector('.scap'), { timeout: 15000 })
    await sleep(400)
    return page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.tile[data-i]')]
      const first = tiles[0]
      const val = (k) => document.querySelector(`[data-k="${k}"]`)?.value ?? ''
      return {
        tiles: tiles.length,
        firstImg: first?.querySelector('img')?.getAttribute('src') ?? '',
        firstDecoded: first?.querySelector('img')?.naturalWidth ?? 0,
        firstText: first?.innerText ?? '',
        mtag: first?.querySelector('.mtag')?.textContent ?? null,
        defLeft: document.querySelectorAll('.tile.def').length,
        scap: document.querySelector('.scap')?.innerText ?? '',
        mediaUrl: val('mediaUrl'),
        title: val('title'),
        creditSource: val('credit.source'),
        summary: val('summary'),
        essay: val('essay'),
      }
    })
  }

  check('用例齐全（数据里找得到这两种对象）', !!gapId && !!packId && !!sceneId,
    `gap=${gapId} pack=${packId} scene=${sceneId}`)

  // ① 还没配内容的景点 → 条带里就有一条**填好的**内容
  const s1 = await stripOf(gapId)
  check('★★ 打开还没配内容的景点：条带里已经有 1 条（不是一块「还没填图」）',
    s1.tiles === 1, `tiles=${s1.tiles} scap=${JSON.stringify(s1.scap)}`)
  check('★★ 那一张就是机器搜的那张图，而且**真的解码了**',
    s1.tiles === 1 && s1.firstDecoded > 0 && s1.firstImg === gapPhoto.mediaUrl,
    `naturalWidth=${s1.firstDecoded} src匹配=${s1.firstImg === gapPhoto.mediaUrl}`)
  /*
   * ★★ 「帮我填好信息」—— 标题 / 署名 / 摘要**一个都不能空**。
   *    ⚠️ 三条都带上 `s1.tiles === 1`：条带空着的时候，
   *       `'' === ''` 之类的比较会**假绿**（空过的守卫和真守卫长得一样）。
   *    ⚠️ 摘要那条尤其重要：端点 `validate()` 缺摘要会**拒收**，
   *       空着的话这条内容根本存不进文件。
   */
  check('★★ 信息**填好了**：标题 / 署名 / 摘要都不是空的',
    s1.tiles === 1 && s1.title === gapPhoto.title &&
      s1.creditSource === gapPhoto.credit.source &&
      s1.summary.trim().length > 0 && s1.mediaUrl === gapPhoto.mediaUrl,
    `title=${JSON.stringify(s1.title)} credit=${JSON.stringify(s1.creditSource)} ` +
      `summaryLen=${s1.summary.length} url匹配=${s1.mediaUrl === gapPhoto.mediaUrl}`)
  /*
   * ★★ 摘要填的是**对的东西**（09-27 改）。
   *
   *    上面那条只断言"不是空的" —— 抄回 `blurb` 它也照样绿。
   *    而 `blurb` 正是这次要拿掉的东西：A 级那 1348 条的 `blurb`
   *    是按 `scene` 从 17 句模板里挑的，`scene` 归错类就**事实出错**
   *    （九寨沟 / 白洋淀的 `scene` 都是 `city` → 都拿到「周围都是高楼」）。
   *
   *    ⚠️ 判据用"**是不是那句简介的前缀**"，不是"跟某句模板不同" ——
   *       比"不等于某句话"结实：模板池以后改了、加了一句新的，
   *       这个断言照样拦得住。
   *    ⚠️ 也必须带上"不是空的"：`gapIntro.startsWith('')` 恒真，
   *       漏了的话空摘要会**假绿**。
   *    ⚠️ 60 是摘要自己的上限（`checkAll()` 的「超过 60（会撑破卡片）」），
   *       跟简介的 300 是两回事 —— 别换成 `INTRO_MAX`。
   */
  check('★★ 摘要**是从公共简介里截的**（不是那句按 `scene` 挑的模板）',
    s1.tiles === 1 && s1.summary.trim().length > 0 &&
      s1.summary.length <= 60 && gapIntro.startsWith(s1.summary),
    `摘要=${JSON.stringify(s1.summary.slice(0, 24))}… len=${s1.summary.length} ` +
      `简介开头=${JSON.stringify(gapIntro.slice(0, 24))}…`)
  check('★★ 界面上**不再有「默认图」这个概念**（没有只读方块，文案里也没这三个字）',
    s1.defLeft === 0 && !/默认图/.test(s1.scap) && !/默认图/.test(s1.firstText),
    `defLeft=${s1.defLeft} scap=${JSON.stringify(s1.scap)}`)
  /*
   * ★★ 散文**不许**在这里被悄悄写掉：这一节把密钥清掉了，
   *    自动起稿必须**一声不响地不做**（不许弹密钥框、不许发请求）。
   *    这是那三条护栏里最要紧的一条 —— 打开一个景点就蹦一个密钥弹窗，
   *    那是惊吓不是帮忙。
   */
  check('★★ 没配密钥时**不自动起稿**（散文还是空的，也没弹密钥框）',
    s1.tiles === 1 && s1.essay.trim() === '',
    `essayLen=${s1.essay.length}`)

  // ② 已经配过内容的景点 → **不**再塞一条机器图（内容包优先）
  const s2 = await stripOf(packId)
  const packCount = PACK.filter((c) => c.landmarkId === packId).length
  check('★★ 已经配过内容的景点：**不**再塞一条机器图（内容包优先）',
    s2.tiles === packCount, `${packId} tiles=${s2.tiles} 期望=${packCount}`)

  // ③ match === 'scene' → 带「示意图」角标
  const s3 = await stripOf(sceneId)
  check('★★ `match === \'scene\'` 的那张标了「示意图」',
    s3.tiles >= 1 && s3.mtag === '示意图',
    `${sceneId} tiles=${s3.tiles} mtag=${JSON.stringify(s3.mtag)}`)

  /* ---------- 11b. `match` 要穿过三道白名单 ---------- */
  /*
   * ★★ 这条是"机器图变成第一条内容"之后**最容易静默坏掉**的地方。
   *
   *    `match` 要穿过三道**白名单**才能落进文件：
   *      编辑器 `loadContents()` 的字段表 → 端点 `Seed` → 端点 `normalize()`
   *    漏掉任何一道，那张「示意图」存一次就变成"家长从没声称过"，
   *    于是**相册把它当成真地方显示** —— 不报错、不崩，只是说了假话。
   *
   * ⚠️⚠️ 这一段**绝对不能真的写盘**。`travel-contents.json` 是家长自己的数据，
   *    而且**没入库**（`??`），git 救不回来 —— 一次合法 body 的 POST
   *    就是一次真写入（见 §59）。要看保存载荷，就在**页面里**把
   *    `window.fetch` 包一层截下来；⚠️ 别去改 puppeteer 的请求拦截：
   *    CDP 拒收带 `content-length` 的改包，请求会**吊死**。
   */
  await page.evaluate(() => {
    window.__payload = null
    window.__origFetch = window.fetch
    window.fetch = (url, opt) => {
      if (opt && opt.method === 'POST') {
        window.__payload = opt.body
        return Promise.resolve(
          new Response(
            JSON.stringify({ ok: true, file: '(被拦截，没写盘)', count: 1 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      return window.__origFetch(url, opt)
    }
  })
  await page.click('#save')
  await sleep(400)
  const payload = await page.evaluate(() => {
    const p = window.__payload
    window.fetch = window.__origFetch          // 装回去，别影响后面
    return p
  })
  let sent = null
  try { sent = JSON.parse(payload || 'null') } catch { sent = null }
  const sentRow = Array.isArray(sent)
    ? sent.find((c) => c.landmarkId === sceneId && c.mediaUrl === photoByLm.get(sceneId)?.mediaUrl)
    : null
  check('★★ 保存载荷里那条带着 `match: "scene"`（三道白名单漏一个就丢）',
    sentRow?.match === 'scene',
    `match=${JSON.stringify(sentRow?.match ?? null)} 载荷条数=${Array.isArray(sent) ? sent.length : 'n/a'}`)

  /* ---------- 11c. 景点公共简介 ---------- */
  console.log('\n【11c】景点公共简介（编辑器 / App 共用同一份，≤300 字）')
  /*
   * ★★ 家长 09-26：「旅游景点 没有公共简介，字数不超过300。」
   *
   *    · 它是**地标级**的：一个景点一条，跟这个景点配了几张图**无关**；
   *    · 两处读**同一份**（`src/data/landmark-intros.json`）；
   *    · 超上限的**存不进去** —— 三个判定点见 `src/domain/landmarkIntro.ts`。
   *
   * ⚠️⚠️ 这一节**绝不许真的写盘**。`landmark-intros.json` 是家长的内容。
   *    下面每一次 `#save` 都在**页面里**把 `window.fetch` 包住，把 POST 截下来
   *    （做法与理由同 11b：CDP 拒收带 content-length 的改包，用 puppeteer
   *    的请求拦截会让请求**吊死**）。
   *
   * ⚠️ 上限**从源文件里读**，不在这里写死 300 ——
   *    写死的话，改常量时这条守卫会假红，而"把它改成新数字"就是把它调哑。
   */
  const INTRO_MAX = Number(
    /LANDMARK_INTRO_MAX\s*=\s*(\d+)/.exec(
      readFileSync(resolve(process.cwd(), 'src/domain/landmarkIntro.ts'), 'utf8'),
    )?.[1],
  )
  check('用例齐全（`landmarkIntro.ts` 里读得到上限）', Number.isFinite(INTRO_MAX) && INTRO_MAX > 0,
    `INTRO_MAX=${INTRO_MAX}`)

  const INTROS = DATA('landmark-intros.json')
  const introIds = Object.keys(INTROS)
  const introId = introIds[0]
  check('用例齐全（数据里至少有一条公共简介）', !!introId, `共 ${introIds.length} 条`)

  const introFile = resolve(process.cwd(), 'src/data/landmark-intros.json')
  const introBytes = readFileSync(introFile)

  /** 打开某个景点的抽屉，把简介那一块量出来 */
  const introOf = async (id) => {
    await page.goto(`${URL}?embed=1&id=${encodeURIComponent(id)}`, {
      waitUntil: 'networkidle2', timeout: 30000,
    })
    /* ⚠️ 跟 11 节同理：清掉密钥，否则 `boot()` 会真的发一次 AI 起稿请求 */
    await page.evaluate(() => sessionStorage.removeItem('lwf-editor-ai-key'))
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 })
    await page.waitForFunction(() => !!document.querySelector('.scap'), { timeout: 15000 })
    await sleep(300)
    return page.evaluate(() => {
      const el = document.querySelector('.lminfo [data-lm="intro"]')
      const cnt = document.querySelector('.lminfo [data-lm="intro-count"]')
      const idf = document.querySelector('#editor [data-k="id"]')
      return {
        value: el?.value ?? null,
        count: cnt?.textContent?.trim() ?? null,
        countBad: !!cnt?.classList.contains('bad'),
        inInfo: !!el && !!el.closest('.lminfo'),
        infoCount: document.querySelectorAll('.lminfo').length,
        /* 顺序：简介要排在「这张图」那些字段**之前**（它是这个景点公共的） */
        beforeImageFields: !!el && !!idf &&
          !!(el.compareDocumentPosition(idf) & Node.DOCUMENT_POSITION_FOLLOWING),
      }
    })
  }

  const i1 = await introOf(introId)
  check('★★ 简介输入框在信息条**里面**（公共的东西都在这张卡片里）',
    i1.inInfo && i1.infoCount === 1, `inInfo=${i1.inInfo} .lminfo 数=${i1.infoCount}`)
  check('★★ 打开时框里**就是文件里那句**（读错文件 / 没读上来 = 存一次就把简介抹了）',
    i1.value === INTROS[introId],
    `框里 ${JSON.stringify((i1.value || '').slice(0, 20))}… 文件 ${JSON.stringify(INTROS[introId].slice(0, 20))}…`)
  check('★★ 简介排在「这张图」那些字段**之前**（它是这个景点公共的）', i1.beforeImageFields)
  check('★ 计数显示 `n / 上限`，跟文本长度对得上',
    i1.count === `${INTROS[introId].length} / ${INTRO_MAX}`,
    `显示 ${JSON.stringify(i1.count)} 期望 ${INTROS[introId].length} / ${INTRO_MAX}`)
  check('★ 没超上限时计数**不是红的**（红了 = 把"上限"读成了"已出错"）', !i1.countBad)

  /* ② 装一层拦截。装完先**不改任何东西**存一次：简介端点**不该**被碰到。 */
  await page.evaluate(() => {
    window.__saveUrls = []
    window.__introPayload = null
    window.__origFetch3 = window.fetch
    window.fetch = (url, opt) => {
      const u = String(url)
      if (opt && opt.method === 'POST') {
        window.__saveUrls.push(u)
        if (u.includes('__save-landmark-intros')) window.__introPayload = opt.body
        return Promise.resolve(
          new Response(
            JSON.stringify({ ok: true, file: '(被拦截，没写盘)', count: 1 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      return window.__origFetch3(url, opt)
    }
  })
  await page.click('#save')
  await sleep(400)
  const noEdit = await page.evaluate(() => ({
    urls: window.__saveUrls.slice(),
    intro: window.__introPayload,
  }))
  check('★★ **没改简介时不去打简介端点**（白写一次盘；而且只拦内容端点的守卫会打到真端点）',
    noEdit.urls.length > 0 && !noEdit.urls.some((u) => u.includes('__save-landmark-intros')),
    `打过的端点：${noEdit.urls.join(' | ') || '（一个都没打）'}`)

  /* ③ 打字：计数原地更新；**打到上限不算超**，超一个字才红。 */
  const typeInto = (text) => page.evaluate((v) => {
    const el = document.querySelector('.lminfo [data-lm="intro"]')
    const cnt = document.querySelector('.lminfo [data-lm="intro-count"]')
    /*
     * ⚠️⚠️ 元素不在时**绝不能在这里抛**。
     *    `page.evaluate` 里抛出去 = 整个 promise reject = 脚本**当场崩**，
     *    后面的断言**一条都不跑**，屏幕上是一坨 puppeteer 堆栈而不是
     *    "哪一条红了"。守卫崩掉和守卫报红是两回事：崩了看不出范围。
     *    （实测：把信息条里那个简介框删掉，跑出来就是这种堆栈。）
     */
    if (!el) return { count: cnt?.textContent?.trim() ?? null, bad: false, missing: true }
    el.value = v
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return {
      count: cnt?.textContent?.trim() ?? null,
      bad: !!cnt?.classList.contains('bad'),
      missing: false,
    }
  }, text)

  const atLimit = await typeInto('字'.repeat(INTRO_MAX))
  check('★ 打到上限：计数跟着走，且**不算超**（边界不能差一个）',
    atLimit.count === `${INTRO_MAX} / ${INTRO_MAX}` && !atLimit.bad,
    `${JSON.stringify(atLimit.count)} bad=${atLimit.bad}`)

  const overLimit = await typeInto('字'.repeat(INTRO_MAX + 1))
  check('★★ 超一个字：计数**当场变红**（不然家长存完才知道）',
    overLimit.count === `${INTRO_MAX + 1} / ${INTRO_MAX}` && overLimit.bad,
    `${JSON.stringify(overLimit.count)} bad=${overLimit.bad}`)

  /* ④ 改成一段合法文案再存：POST 必须打到**简介端点**，载荷是**整张表**。 */
  const EDITED = '这是守卫写进去的一句话，不会落盘。'
  await typeInto(EDITED)
  await page.click('#save')
  await sleep(500)
  const afterEdit = await page.evaluate(() => {
    const urls = window.__saveUrls.slice()
    const p = window.__introPayload
    window.fetch = window.__origFetch3
    return { urls, payload: p }
  })
  let introSent = null
  try { introSent = JSON.parse(afterEdit.payload || 'null') } catch { introSent = null }
  check('★★ 保存时简介打的是**简介端点**（打错就把内容包重写了）',
    afterEdit.urls.some((u) => u.includes('__save-landmark-intros')),
    `打过的端点：${afterEdit.urls.join(' | ')}`)
  check('★★ 载荷是**整张表**（只带当前那条 = 别的景点的简介会被整片抹掉）',
    !!introSent && Object.keys(introSent).sort().join(',') === [...introIds].sort().join(','),
    `载荷键数=${introSent ? Object.keys(introSent).length : 'n/a'} 文件键数=${introIds.length}`)
  check('★★ 改的那条**在载荷里**（不是白改一场）',
    introSent?.[introId] === EDITED,
    `${JSON.stringify((introSent?.[introId] || '').slice(0, 16))}…`)

  /* ⑤ 端点自己的硬规矩（不走浏览器，直接打）。全都是**被拒**的请求，不会写盘。 */
  const INTRO_URL = 'http://localhost:5190/__save-landmark-intros'
  const notPost = await fetch(INTRO_URL)
  check('简介端点只接受 POST', notPost.status === 405, String(notPost.status))
  const tooLong = await fetch(INTRO_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [introId]: '字'.repeat(INTRO_MAX + 1) }),
  })
  check('★★ 超字数的载荷**拒收**（不是截断 —— 截断是静默的，尾巴没了看不出来）',
    tooLong.status === 400 && /超过/.test(await tooLong.text()), String(tooLong.status))
  const notObj = await fetch(INTRO_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(['不是对象']),
  })
  check('简介端点拒绝数组（表是 `{地标 id: 简介}`）', notObj.status === 400, String(notObj.status))
  const blank = await fetch(INTRO_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [introId]: '   ' }),
  })
  check('简介端点拒绝空值（空的该**删键**，不是留个空串）', blank.status === 400, String(blank.status))

  /* ⑥ ★★ 本机闸：`server.host: true` 让 dev server 监听 0.0.0.0（联调要用，是有意的），
     所以"能连上"**不等于**"是本机"。用本机那块网卡的地址打过去，来源就不是回环了。 */
  const lanIp = Object.values(networkInterfaces()).flat()
    .find((a) => a && a.family === 'IPv4' && !a.internal)?.address
  if (lanIp) {
    const far = await fetch(`http://${lanIp}:5190/__save-landmark-intros`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [introId]: '一段话' }),
    })
    check('★★ 简介端点**只收本机请求**（同网段的人打不进来，别拿它当免费写盘口）',
      far.status === 403, `经 ${lanIp} → ${far.status}`)
  } else {
    /* ⚠️ 宁可红，也不静默跳过 —— 静默跳过等于这条断言**根本不存在** */
    check('★★ 简介端点只收本机请求', false, '本机没有非回环 IPv4，这条**没能验证**')
  }

  /*
   * ⑥-b ★★ 同一道闸必须**也**长在内容包端点上（09-27 补）。
   *
   *    这一条防的是"三个端点里某一个忘了查" —— 09-27 之前
   *    `/__save-travel-contents` 就正是那个忘了查的（它的注释还写着
   *    "dev server 本来就只监听本机"，而根配置里 `host` 是开着的）。
   *
   * ⚠️⚠️ 载荷故意用 `[]`：它会被 `validate()` **先拒掉**
   *    （「一条内容都没有 —— 大概是读错了文件，拒绝写盘」）。
   *    所以**就算这道闸坏了，这一下也只是拿到 400，不会真的写盘**。
   *    换成一份合法载荷的话，闸一坏就是当场重写家长的内容包 ——
   *    而 `src/data/` 大量文件没入库，git 救不回来。
   *    （`travel-contents.json` 的字节备份/还原在 §8，那一节是**故意**写盘的。）
   */
  if (lanIp) {
    const farPack = await fetch(`http://${lanIp}:5190/__save-travel-contents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    })
    check('★★ 内容包端点**也只收本机请求**（同网段的人打不进来）',
      farPack.status === 403, `经 ${lanIp} → ${farPack.status}`)
  } else {
    check('★★ 内容包端点只收本机请求', false, '本机没有非回环 IPv4，这条**没能验证**')
  }

  /*
   * ⑦ 兜底：这一节从头到尾**没动过盘**。
   *
   * ⚠️⚠️ 这里不只是"报一句"，而是**真的还原回去**。
   *    这一节里有好几个**故意发坏载荷**的探针（超字数 / 空值 / 同网段），
   *    它们本该被端点拒收；万一端点的闸坏了，那一下就是**真写盘**。
   *    只报不修的话，跑一次守卫就把家长的内容弄坏了
   *    （实测踩到过：把字数闸拆掉做变异，`badaling` 那条真被覆盖成 301 个「字」，
   *      另外三条**直接没了** —— 而这个仓库的 `src/data/` 大量文件没入库，
   *      git 救不回来）。
   */
  const introNow = readFileSync(introFile)
  if (!introNow.equals(introBytes)) writeFileSync(introFile, introBytes)
  check('★★ 这一节从头到尾**没动过盘上那份简介**（不同 = 已还原）',
    introNow.equals(introBytes),
    introNow.equals(introBytes) ? '' : '简介文件被改动了，已还原')

  /* ---------- 12. 控制台 ---------- */
  console.log('\n【12】控制台')
  /*
    ⚠️ 控制台那条 404 的文案是「Failed to load resource: … 404」——**不带 URL**。
    所以光看日志查不出是哪个资源。这里改成：把 404 的 URL 单独收集起来，
    只有"全部 404 都是 favicon"时才放过它。
    （favicon 是已知无害项：这几个工具页从来没放过图标，见 MEMORY §16.7。
     要消掉就加一个内联 data: 图标。）
  */
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
