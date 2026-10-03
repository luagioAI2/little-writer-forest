/* ============================================================
   验证「作文库浏览 / 编辑页」（library-browse.html）
   ------------------------------------------------------------
   跑法：node scripts/_verify-library-editor.mjs
   ⚠️ 需要 dev server 在 5190（保存端点只在 dev 里存在）。

   守的是"这个工具本身能用"，不是"题出得好不好" ——
   覆盖层的数据规则由 `src/domain/libraryItems.test.ts` 负责。

   ★★★ 这个脚本会**真的写盘**（`src/data/library-items.json`）。
       `src/data/` 大量文件没入库，git 救不回来 ——
       所以开工前先把原始字节存下来，`finally` 里**一定**还原。
       ⚠️ 而且"还原"要断言过：末尾会再读一次比对。
   ============================================================ */

import puppeteer from 'puppeteer-core'
import { readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'

const BASE_URL = process.env.E2E_URL ?? 'http://localhost:5191'
const URL = `${BASE_URL}/library-browse.html`
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DATA_FILE = resolve(process.cwd(), 'src/data/library-items.json')

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
const readData = () => readFileSync(DATA_FILE, 'utf8')

/**
 * 往一个输入框里**整段替换**文字。
 * ⚠️ 别用 `click(sel, { clickCount: 3 })` —— 实测它选不中已有内容，
 *    于是新文字**接在后面**（"春天的公园春天的小公园"），
 *    后面每一条断言都跟着错，而且症状看起来像"功能坏了"。
 */
async function setInput(page, sel, text) {
  await page.click(sel)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  if (text) await page.type(sel, text)
  await sleep(200)
}

/** 本机在局域网里的地址 —— 用来证明端点**只收本机请求** */
function lanIp() {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address
    }
  }
  return ''
}

const PEXELS = 'https://images.pexels.com/photos/1108099/pexels-photo-1108099.jpeg?auto=compress&cs=tinysrgb&w=1200'

async function main() {
  /* ★★★ 开工前先把原始字节存下来 —— 这个脚本会真写盘 */
  const original = readData()

  /*
   * ★★ 盘上那份覆盖层**一开始不一定是空的** —— 家长会自己往里加配图
   *    （09-27：「帮我添加一个外链作文库的 …… 比如写人 清洁工」，
   *     于是 `builtin-stranger-1` 那条一直在盘上）。
   *
   * ➜ 下面所有"改过几道 / 盘上有几条"的断言一律**从这份基线算**，
   *   绝不许写死 0 / 1 / `{}`。写死的后果不是报错，而是
   *   **数据一多，守卫就假红**；而假红最容易被"把数字改大让它变绿"糊过去，
   *   改着改着守卫就哑了。
   */
  const BASE_JSON = JSON.parse(original)
  const BASE_COUNT = Object.keys(BASE_JSON).length
  const BASE_PHOTOS = Object.values(BASE_JSON)
    .filter((o) => o && Array.isArray(o.imageUrls) && o.imageUrls.length > 0).length

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 940, deviceScaleFactor: 1 })

  const errors = []
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    /*
     * ⚠️ 有两类"error"是**预期的**，不能算账：
     *   ① favicon 的 404 —— 这页没挂 favicon，浏览器自己去要的
     *   ② 打到保存端点的 400 —— 第 ⑪ 段**故意**发坏值去验"拒收"，
     *      浏览器照样记一条 console error。那几条的成败由 ⑪ 自己断言。
     *   ★ 判据用**请求地址**（`m.location().url`），别用消息文本 ——
     *     文本里只有 "Failed to load resource…"，看不出是哪一个请求。
     */
    const url = m.location()?.url ?? ''
    if (/favicon/.test(url)) return
    if (/__save-library-items/.test(url)) return
    errors.push(`${m.text()} @ ${url}`)
  })
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`))
  // ⚠️ 原生弹窗必须接住，否则脚本会**静默挂死**（跑满超时被 SIGTERM）
  page.on('dialog', (d) => d.accept())

  try {
    /* ---------- ① 打开 ---------- */
    console.log('\n① 打开页面')
    await page.goto(URL, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      () => document.getElementById('n-show')?.textContent !== '…',
      { timeout: 30000 },
    )
    await sleep(900)

    const boot = await page.evaluate(() => ({
      cards: document.querySelectorAll('.item').length,
      show: document.getElementById('n-show')?.textContent,
      total: document.getElementById('s-total')?.textContent,
      first: document.querySelector('.item .nm')?.textContent,
      svgs: document.querySelectorAll('.thumb svg').length,
      panelEmpty: !!document.querySelector('.panel .empty'),
    }))

    // ⚠️ 期望值**从数据算**，别写死数字 —— 家长会往题库里加题，
    //    写死的那一刻起，这个守卫就从"守行为"变成了"守一个过期数字"。
    const expected = await page.evaluate(async () => {
      const m = await import('/src/domain/builtinLibrary.ts')
      return m.builtinCount()
    })
    check(`内置题都列出来了（${expected} 道）`,
      boot.cards === expected && boot.show === String(expected), JSON.stringify(boot))
    check('统计里的总数跟列表一致（不是界面写死的）', boot.total === String(expected), boot.total)
    check('第一道就是底稿的第一条（春天的公园）', boot.first === '春天的公园', boot.first)
    check('卡片上的插画真的渲染出来了（不是空方块）', boot.svgs > 0, `svgs=${boot.svgs}`)
    check('还没选中的时候，右栏是"点一道题"的空态', boot.panelEmpty)

    /* ---------- ② 点一道题 ---------- */
    console.log('\n② 点一道题，右栏出编辑面板')
    await page.click('.item')
    await sleep(400)
    const opened = await page.evaluate(() => {
      const id = document.querySelector('.item.sel')?.dataset.id
      return {
        id,
        title: document.getElementById('f-title')?.value,
        lead: document.getElementById('f-lead')?.value,
        slots: document.querySelectorAll('.slot').length,
        slotArt: document.querySelectorAll('.slot-art svg').length,
        infoId: document.querySelector('.info .v.mono')?.textContent,
        hasSave: !!document.getElementById('save'),
        saveDisabled: document.getElementById('save')?.disabled,
      }
    })
    check('选中的是第一道（builtin-season-1）', opened.id === 'builtin-season-1', opened.id)
    check('面板里带出了底稿的标题和引导语',
      opened.title === '春天的公园' && opened.lead.includes('春天来了'), JSON.stringify(opened))
    check('信息条显示的是这道题的 id', opened.infoId === 'builtin-season-1', opened.infoId)
    check('这题一张图 → 一个配图槽位', opened.slots === 1, `slots=${opened.slots}`)
    check('槽位里显示的是**内置插画**（当前没配外链）', opened.slotArt === 1, `slotArt=${opened.slotArt}`)
    check('★ 没有任何改动时，「保存」是禁用的', opened.saveDisabled === true)

    /* ---------- ③ 改标题 ---------- */
    console.log('\n③ 改标题')
    await setInput(page, '#f-title', '春天的小公园')
    const afterTitle = await page.evaluate(() => ({
      cardTitle: document.querySelector('.item.sel .nm')?.textContent,
      editedTag: !!document.querySelector('.item.sel .tag.edited'),
      editedStat: document.getElementById('s-edited')?.textContent,
      unsaved: document.getElementById('s-unsaved')?.textContent,
      saveDisabled: document.getElementById('save')?.disabled,
      nTitle: document.getElementById('n-title')?.textContent,
    }))
    check('卡片上的标题跟着变了（没重建整页也变了）',
      afterTitle.cardTitle === '春天的小公园', afterTitle.cardTitle)
    check('卡片上出现「已改」标记', afterTitle.editedTag)
    check(`统计里"已改过"还是开工前那个数（${BASE_COUNT}）—— 数的是**已保存**的，不含还没存的`,
      afterTitle.editedStat === String(BASE_COUNT), `${afterTitle.editedStat} vs ${BASE_COUNT}`)
    check('统计里"未保存的改动"= 1', afterTitle.unsaved === '1', afterTitle.unsaved)
    check('★★ 有改动了，「保存」当场变成可点（不是还灰着）',
      afterTitle.saveDisabled === false, `disabled=${afterTitle.saveDisabled}`)
    check('标题计数跟着走', /6 \/ \d+/.test(afterTitle.nTitle ?? ''), afterTitle.nTitle)

    /* ---------- ④ 粘一个 https 外链图 ---------- */
    console.log('\n④ 粘一个 https 外链图')
    await setInput(page, '.slot-body input', PEXELS)
    await page.evaluate(() => {
      document.querySelector('.slot-body input').dispatchEvent(new Event('change', { bubbles: true }))
    })
    await sleep(800)
    const afterImg = await page.evaluate(() => ({
      slotImg: document.querySelectorAll('.slot-art img').length,
      slotSvg: document.querySelectorAll('.slot-art svg').length,
      bad: !!document.querySelector('.slot-body input.bad'),
      probs: document.querySelector('.probs')?.textContent ?? '',
      okBox: !!document.querySelector('.probs.ok'),
      unsaved: document.getElementById('s-unsaved')?.textContent,
    }))
    check('★ 槽位里的图从「内置插画」换成了外链图（<img>）',
      afterImg.slotImg === 1 && afterImg.slotSvg === 0, JSON.stringify(afterImg))
    check('地址没被判红', afterImg.bad === false)
    check('体检说"这道题没问题"', afterImg.okBox === true, afterImg.probs.slice(0, 120))

    /* ---------- ⑤ http:// 必须当场判红 ---------- */
    console.log('\n⑤ http:// 地址当场判红（装进 APK 会被当混合内容拦掉）')
    await setInput(page, '.slot-body input', 'http://images.pexels.com/x.jpeg')
    const afterHttp = await page.evaluate(() => ({
      value: document.querySelector('.slot-body input')?.value,
      bad: !!document.querySelector('.slot-body input.bad'),
      probs: document.querySelector('.probs')?.textContent ?? '',
      okBox: !!document.querySelector('.probs.ok'),
      saveDisabled: document.getElementById('save')?.disabled,
    }))
    check('（前提）输入框里确实是那个 http 地址', afterHttp.value === 'http://images.pexels.com/x.jpeg',
      afterHttp.value)
    check('★ 输入框当场变红', afterHttp.bad === true)
    check('★ 体检当场说清"混合内容"这件事（不是等失焦）',
      afterHttp.okBox === false && /http:\/\/|混合内容/.test(afterHttp.probs),
      afterHttp.probs.slice(0, 200))
    check('★ 有非法值的时候，「保存」是禁用的（不让它写出去）',
      afterHttp.saveDisabled === true, `disabled=${afterHttp.saveDisabled}`)

    // 改回合法地址
    await setInput(page, '.slot-body input', PEXELS)
    await page.evaluate(() => {
      document.querySelector('.slot-body input').dispatchEvent(new Event('change', { bubbles: true }))
    })
    await sleep(500)

    /* ---------- ⑥ 保存 ---------- */
    console.log('\n⑥ 保存（会真的写盘）')
    check('（前提）保存按钮可点', await page.evaluate(() => !document.getElementById('save').disabled))
    await page.click('#save')
    await page.waitForFunction(
      () => document.getElementById('s-unsaved')?.textContent === '0',
      { timeout: 15000 },
    ).catch(() => {})
    await sleep(500)

    const savedText = readData()
    const savedJson = JSON.parse(savedText)
    const savedKeys = Object.keys(savedJson)
    const entry = savedJson['builtin-season-1'] ?? {}
    check('★ 盘上出现了这一笔', savedKeys.includes('builtin-season-1'), savedKeys.join(','))
    check(`★ 盘上只**多了**改过的那一道（别的题不出现）—— ${BASE_COUNT} → ${BASE_COUNT + 1}`,
      savedKeys.length === BASE_COUNT + 1, savedKeys.join(','))
    check('★ 原来盘上那几条**原样留着**（没被这一次保存冲掉）',
      Object.keys(BASE_JSON).every((id) => savedKeys.includes(id)),
      `原有 ${Object.keys(BASE_JSON).join(',')} → 现在 ${savedKeys.join(',')}`)
    check('带上了防串位的锚 baseTitle / baseLead',
      entry.baseTitle === '春天的公园' && typeof entry.baseLead === 'string',
      JSON.stringify(entry).slice(0, 200))
    check('标题写进去了', entry.title === '春天的小公园', entry.title)
    check('★ 配图**只写了 imageUrl**，没有把内置插画顶掉',
      Array.isArray(entry.imageUrls) && entry.imageUrls[0] === PEXELS,
      JSON.stringify(entry.imageUrls))
    check('★ 键的顺序是规范的 baseTitle → baseLead → title → imageUrls',
      JSON.stringify(Object.keys(entry)) ===
        JSON.stringify(['baseTitle', 'baseLead', 'title', 'imageUrls']),
      Object.keys(entry).join(','))
    check('文件结尾有换行（跟别的数据文件一致）', savedText.endsWith('\n'))
    check('保存后界面变成"已保存"、未保存归零',
      (await page.evaluate(() => document.getElementById('s-unsaved')?.textContent)) === '0')

    /* ---------- ⑦ 存两次逐字节一样（幂等） ---------- */
    console.log('\n⑦ 幂等：把盘上那份原样再存一次，字节必须一样')
    const again = await page.evaluate(async (payload) => {
      const res = await fetch('/__save-library-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      })
      return { status: res.status, body: await res.json() }
    }, savedText)
    check('第二次保存也成功', again.status === 200 && again.body.ok === true,
      JSON.stringify(again).slice(0, 200))
    check('★★ 两次保存出来的文件**逐字节一样**', readData() === savedText,
      '不一样 → 保存一次就会让整个文件 diff 飘红')

    /* ---------- ⑧ 刷新后这一笔还在（真的落盘了） ---------- */
    console.log('\n⑧ 刷新页面，改过的还在')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      () => document.getElementById('n-show')?.textContent !== '…',
      { timeout: 30000 },
    )
    await sleep(600)
    const reloaded = await page.evaluate(() => ({
      first: document.querySelector('.item .nm')?.textContent,
      editedStat: document.getElementById('s-edited')?.textContent,
      photoStat: document.getElementById('s-photo')?.textContent,
      editedTag: !!document.querySelector('.item .tag.edited'),
    }))
    check('★ 刷新后第一道题的标题是改过的那个', reloaded.first === '春天的小公园', reloaded.first)
    check(`统计里"已改过"= ${BASE_COUNT + 1}（开工前 ${BASE_COUNT} + 刚存的这一道）`,
      reloaded.editedStat === String(BASE_COUNT + 1), reloaded.editedStat)
    check(`统计里"配了外链图"= ${BASE_PHOTOS + 1}（开工前 ${BASE_PHOTOS} + 刚配的这张）`,
      reloaded.photoStat === String(BASE_PHOTOS + 1), reloaded.photoStat)
    check('卡片上带「已改」标记', reloaded.editedTag)

    /* ---------- ⑨ 恢复这道题的原文 ---------- */
    console.log('\n⑨ 恢复这道题的原文')
    await page.click('.item')
    await sleep(300)
    await page.click('#revert')
    await sleep(300)
    const afterRevert = await page.evaluate(() => ({
      unsaved: document.getElementById('s-unsaved')?.textContent,
      title: document.getElementById('f-title')?.value,
      editedTag: !!document.querySelector('.item.sel .tag.edited'),
    }))
    check('未保存计数变成 1（撤回了刚保存的那笔）', afterRevert.unsaved === '1', afterRevert.unsaved)
    check('面板里的标题回到原文', afterRevert.title === '春天的公园', afterRevert.title)
    check('卡片上的「已改」标记也去掉了', afterRevert.editedTag === false)

    // 撤回后保存 → 盘上应该变成空表
    await page.click('#save')
    await page.waitForFunction(
      () => document.getElementById('s-unsaved')?.textContent === '0',
      { timeout: 15000 },
    ).catch(() => {})
    await sleep(400)
    const emptied = readData()
    check('★★ 撤回后再保存，盘上**回到开工前那份**（没有留下孤儿条目）',
      emptied === original, emptied.slice(0, 160))

    /* ---------- ⑩ 端点只收本机请求 ---------- */
    console.log('\n⑩ 保存端点只收本机请求')
    const ip = lanIp()
    if (!ip) {
      check('（跳过）本机没有局域网地址', true, '')
    } else {
      const far = await fetch(`http://${ip}:${new globalThis.URL(BASE_URL).port}/__save-library-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ⚠️ 故意发一个**会被形态校验拒掉**的空表：闸坏了最多 400，绝不会写脏数据
        body: JSON.stringify({ 'builtin-season-1': { baseTitle: 'x', baseLead: 'y' } }),
      })
      check('★★ 同网段的请求被 403 挡掉（这道闸不是摆设）', far.status === 403,
        `经 ${ip} → ${far.status}`)
    }

    /* ---------- ⑪ 端点会拒收坏值（拒收，不截断） ---------- */
    console.log('\n⑪ 端点拒收坏值（不是悄悄截断）')
    // ⚠️ 记下"打这一串坏载荷之前"盘上是什么样 —— 断言比的是"没被动过"，不是"是空表"
    const beforeRejects = readData()
    const rejects = await page.evaluate(async () => {
      const post = async (payload) => {
        const res = await fetch('/__save-library-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        return { status: res.status, body: await res.json() }
      }
      const anchor = { baseTitle: '春天的公园', baseLead: '春天来了，公园里全变了样。你看到了什么？' }
      return {
        httpImg: await post({ 'builtin-season-1': { ...anchor, imageUrls: ['http://a/b.jpeg'] } }),
        tooLong: await post({ 'builtin-season-1': { ...anchor, title: '字'.repeat(40) } }),
        noop: await post({ 'builtin-season-1': { ...anchor, title: '春天的公园' } }),
        noAnchor: await post({ 'builtin-season-1': { title: '没有锚' } }),
        unknownKey: await post({ 'builtin-season-1': { ...anchor, title: '新标题', oops: 1 } }),
      }
    })
    check('http:// 图片 → 400 拒收', rejects.httpImg.status === 400 &&
      rejects.httpImg.body.errors.some((e) => e.includes('http://')), JSON.stringify(rejects.httpImg).slice(0, 200))
    check('标题超字数 → 400 拒收', rejects.tooLong.status === 400 &&
      rejects.tooLong.body.errors.some((e) => e.includes('超过')), JSON.stringify(rejects.tooLong).slice(0, 200))
    check('跟原文一样（白写）→ 400 拒收', rejects.noop.status === 400, JSON.stringify(rejects.noop).slice(0, 200))
    check('缺 baseTitle/baseLead（防串位的锚）→ 400 拒收', rejects.noAnchor.status === 400,
      JSON.stringify(rejects.noAnchor).slice(0, 200))
    check('不认识的字段 → 400 拒收', rejects.unknownKey.status === 400,
      JSON.stringify(rejects.unknownKey).slice(0, 200))
    check('★ 上面这一串被拒之后，盘上**一个字节都没动**（拒收 ≠ 写了一半）',
      readData() === beforeRejects, readData().slice(0, 160))

    /* ---------- ⑫ 幽灵记录：挂在不存在的 id 上 ---------- */
    console.log('\n⑫ 幽灵记录（覆盖层挂着一个不存在的内置题 id）')
    /*
     * ★★ 为什么必须专门守这一条：幽灵记录在左边的列表里**永远不会出现**
     *    （列表是从 136 道底稿生成的），但它会让体检非空 → 「保存」永久禁用。
     *    界面上如果连"为什么"都看不到，那就成了一个**死胡同**。
     */
    writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          /*
           * ★★ 把开工前那几条**一起写进去**（原来只写幽灵一条）。
           *    这样"删幽灵"要是顺手把**真条目**也删了，下面那条断言就会红 ——
           *    原来盘上本来就只有幽灵、本来就该变空，**查不出来**。
           *    ⚠️ 家长会自己往里加配图（09-27 起盘上就有 `builtin-stranger-1`），
           *       所以这一条现在真的会护住东西。
           */
          ...BASE_JSON,
          'builtin-ghost-999': { baseTitle: '不存在', baseLead: '不存在', title: '幽灵' },
        },
        null, 2,
      ) + '\n',
      'utf8',
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      () => document.getElementById('n-show')?.textContent !== '…',
      { timeout: 30000 },
    )
    await sleep(700)

    const ghost = await page.evaluate(() => ({
      cards: document.querySelectorAll('.item').length,
      show: document.getElementById('n-show')?.textContent,
      bannerHidden: document.getElementById('global')?.hidden,
      banner: document.getElementById('global')?.textContent ?? '',
      hasDrop: !!document.getElementById('drop-ghosts'),
      saveDisabled: document.getElementById('save')?.disabled,
      editedStat: document.getElementById('s-edited')?.textContent,
    }))
    check(`（前提）列表里只有 ${expected} 道 —— 幽灵记录不会出现在这里`,
      ghost.cards === expected && ghost.show === String(expected), JSON.stringify(ghost).slice(0, 120))
    check('★★ 但整份体检横幅把它报出来了（不然家长看不到原因）',
      ghost.bannerHidden === false && ghost.banner.includes('幽灵'), ghost.banner.slice(0, 160))
    check('★★ 而且给了一个"删掉"的出口（否则就是死胡同）', ghost.hasDrop)
    check('★ 有幽灵的时候，「保存」是禁用的', ghost.saveDisabled === true)

    await page.click('#drop-ghosts')
    await sleep(400)
    const afterDrop = await page.evaluate(() => ({
      banner: document.getElementById('global')?.textContent ?? '',
      saveDisabled: document.getElementById('save')?.disabled,
      unsaved: document.getElementById('s-unsaved')?.textContent,
    }))
    check('★★ 删完变"未保存"、且「保存」可点（★ 只删草稿，不删 saved —— 两边都删就永远存不下去）',
      afterDrop.unsaved === '1' && afterDrop.saveDisabled === false,
      JSON.stringify(afterDrop).slice(0, 160))
    check('★ 横幅改口说"盘上还有 1 条…按保存落盘"（不是直接消失）',
      afterDrop.banner.includes('盘上还有'), afterDrop.banner.slice(0, 160))

    await page.click('#save')
    await page.waitForFunction(
      () => document.getElementById('s-unsaved')?.textContent === '0',
      { timeout: 15000 },
    ).catch(() => {})
    await sleep(500)
    check('★★ 保存后盘上**回到开工前那份**（幽灵没了、真条目一条不少）',
      readData() === original, readData().slice(0, 160))
    check('★ 横幅也跟着消失了',
      (await page.evaluate(() => document.getElementById('global')?.hidden)) === true)

    /* ---------- ⑬ 没有 console 报错 ---------- */
    console.log('\n⑬ 全程没有 console 报错')
    check('没有 console error / pageerror', errors.length === 0, errors.slice(0, 3).join(' | '))
  } finally {
    await browser.close()
    /* ★★★ 一定要还原 —— 这个脚本真的改过盘上的数据文件 */
    writeFileSync(DATA_FILE, original, 'utf8')
    check('★ 收尾：数据文件已还原成开工前的字节', readData() === original)
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
