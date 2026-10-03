/* 官网走查：控制台报错 / 图片是否真解码 / 内链是否存在 / JSON-LD 能不能解析 /
   h1 数量 / meta 长度，并出桌面 + 手机两张全页图。 */
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.SITE_URL ?? 'http://127.0.0.1:5199'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })

try {
  const page = await browser.newPage()
  const errs = []
  const failed = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
  page.on('requestfailed', (r) => failed.push(r.url() + ' :: ' + (r.failure()?.errorText ?? '')))

  await page.setViewport({ width: 1440, height: 950, deviceScaleFactor: 1 })
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
  // 让所有懒加载图都进来。
  // ⚠️ 只上下滚是不够的：截图带是**横向**滚动容器，屏幕右侧那些图永远不 intersect
  //    → 会被误判成"坏图"。所以逐张 scrollIntoView（inline:'center' 会带着横向滚）
  //    并把 loading 改成 eager。
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    for (const im of [...document.images]) {
      im.loading = 'eager'
      im.scrollIntoView({ block: 'center', inline: 'center' })
      await sleep(70)
    }
    window.scrollTo(0, 0)
    await sleep(200)
  })
  // 等到全部 decode 完（或超时）
  await page.evaluate(async () => {
    const all = [...document.images]
    await Promise.race([
      Promise.all(all.map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r })))),
      new Promise((r) => setTimeout(r, 8000)),
    ])
  })
  await new Promise((r) => setTimeout(r, 1200))

  // 诊断：滚动一遍之后还有多少 .rv 没被点亮（正常应该是 0）
  const notRevealed = await page.evaluate(
    () => document.querySelectorAll('.rv:not(.in)').length,
  )
  console.log('未点亮的 .rv  ', notRevealed, '/ 总数', await page.evaluate(() => document.querySelectorAll('.rv').length))

  // 截图前强制全部点亮 —— fullPage 截图会临时把视口拉高，
  // 那时才进视野的元素只拿到 .in、0.7s 过渡还没跑完，会被拍成"空白"。
  await page.evaluate(() => {
    document.querySelectorAll('.rv').forEach((el) => el.classList.add('in'))
  })
  await new Promise((r) => setTimeout(r, 900))

  const report = await page.evaluate(async () => {
    const imgs = [...document.images].map((im) => ({
      src: im.getAttribute('src'),
      ok: im.naturalWidth > 0,
      alt: im.getAttribute('alt') ?? '',
    }))
    const links = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
      try { JSON.parse(s.textContent); return 'ok' } catch (e) { return 'PARSE ERROR: ' + e.message }
    })
    // 内链锚点是否都存在
    const badAnchors = links
      .filter((h) => h.startsWith('#') && h.length > 1)
      .filter((h) => !document.querySelector(h))
    return {
      title: document.title,
      titleLen: document.title.length,
      desc: document.querySelector('meta[name="description"]')?.content ?? '',
      descLen: (document.querySelector('meta[name="description"]')?.content ?? '').length,
      h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
      h2count: document.querySelectorAll('h2').length,
      canonical: document.querySelector('link[rel=canonical]')?.href,
      ogImage: document.querySelector('meta[property="og:image"]')?.content,
      imgs,
      imgTotal: imgs.length,
      imgBroken: imgs.filter((i) => !i.ok).map((i) => i.src),
      imgNoAlt: imgs.filter((i) => !i.alt).map((i) => i.src),
      linkTotal: links.length,
      badAnchors,
      jsonLd: ld,
      docHeight: document.body.scrollHeight,
    }
  })

  console.log('标题        ', JSON.stringify(report.title), `(${report.titleLen} 字)`)
  console.log('描述长度    ', report.descLen, '字')
  console.log('canonical   ', report.canonical)
  console.log('og:image    ', report.ogImage)
  console.log('h1          ', JSON.stringify(report.h1), '| h2 数量', report.h2count)
  console.log('图片        ', report.imgTotal, '张 / 坏', report.imgBroken.length, '/ 缺 alt', report.imgNoAlt.length)
  if (report.imgBroken.length) console.log('   坏图:', report.imgBroken)
  if (report.imgNoAlt.length) console.log('   缺 alt:', report.imgNoAlt)
  console.log('链接        ', report.linkTotal, '条 / 死锚点', report.badAnchors.length, report.badAnchors.slice(0, 5))
  console.log('JSON-LD     ', JSON.stringify(report.jsonLd))
  console.log('页面高度    ', report.docHeight, 'px')
  console.log('页面错误    ', errs.slice(0, 5))
  console.log('请求失败    ', failed.slice(0, 5))

  await page.screenshot({ path: '_site-full.png', fullPage: true })

  // 手机版
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.reload({ waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 2000))
  // ⚠️ reload 之后 .rv 又变回隐藏状态了 —— 不重新点亮，截出来就是一片空白。
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    for (const im of [...document.images]) { im.loading = 'eager'; im.scrollIntoView({ block: 'center' }); await sleep(50) }
    document.querySelectorAll('.rv').forEach((el) => el.classList.add('in'))
    const g = document.querySelector('.gallery')
    if (g) g.scrollLeft = 0 // 让截图从第一张开始，别停在中途
    window.scrollTo(0, 0)
    await sleep(300)
  })
  await new Promise((r) => setTimeout(r, 1200))
  await page.screenshot({ path: '_site-mobile.png', fullPage: true })
  const m = await page.evaluate(() => ({
    h: document.body.scrollHeight,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }))
  console.log('手机版高度  ', m.h, 'px / 横向溢出:', m.overflowX, `(scrollW ${m.scrollW} vs ${m.innerW})`)

  // 禁用 JS 再渲染一遍：正文必须完全可见（爬虫 / 禁 JS 场景），
  // 这是滚动入场动画最容易踩的坑 —— .rv 默认 opacity:0 会让整页正文消失。
  await page.setJavaScriptEnabled(false)
  await page.setViewport({ width: 1440, height: 950, deviceScaleFactor: 1 })
  await page.reload({ waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 1200))
  const noJs = await page.evaluate(() => {
    const vis = (el) => {
      if (!el) return false
      const s = getComputedStyle(el)
      return s.opacity !== '0' && s.visibility !== 'hidden' && el.getBoundingClientRect().height > 0
    }
    const rv = [...document.querySelectorAll('.rv')]
    return {
      h1: document.querySelector('h1')?.textContent?.trim(),
      h1Visible: vis(document.querySelector('h1')),
      rvTotal: rv.length,
      rvHidden: rv.filter((el) => !vis(el)).length,
      textLen: document.body.innerText.replace(/\s+/g, '').length,
    }
  })
  console.log('禁 JS 渲染    ', `h1 可见=${noJs.h1Visible} / .rv 隐藏 ${noJs.rvHidden}/${noJs.rvTotal} / 正文 ${noJs.textLen} 字`)
  await page.screenshot({ path: '_site-nojs.png', fullPage: true })
  await page.setJavaScriptEnabled(true)
} finally {
  await browser.close()
}
