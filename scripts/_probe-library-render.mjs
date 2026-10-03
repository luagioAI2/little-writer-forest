/* 渲染链路探针：在同源页面里 import 真代码，证明「数据变大」真的变成了「界面会去读」。

   为什么非要有这一步：数据层测试只证明**数据是好的**，
   证明不了**界面会读它** —— 「JSON 里多了 100 条」和「孩子能看见 100 张图」长得一模一样。
   用完即删。
*/
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.env.E2E_URL ?? 'http://localhost:5190/library-browse.html'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  protocolTimeout: 600_000,
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
const bad = []
page.on('response', (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`)
})
page.on('console', (m) => {
  if (m.type() === 'error') bad.push('console: ' + m.text())
})

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 })

const info = await page.evaluate(async () => {
  const mod = await import('/src/domain/builtinLibrary.ts')
  const items = mod.buildBuiltinLibrary()
  return {
    total: items.length,
    withImg: items.filter((i) => i.images.some((x) => x.imageUrl)).length,
    rows: items.map((i) => ({
      id: i.id,
      sceneKeys: i.images.map((x) => x.sceneKey),
      urls: i.images.map((x) => x.imageUrl ?? ''),
    })),
  }
})

console.log(`buildBuiltinLibrary(): ${info.total} 条，其中带外链图 ${info.withImg} 条`)

// ① 槽位数必须跟插画数一致（覆盖层只能从第一张起连着换）
const mismatched = info.rows.filter(
  (r) => r.urls.some(Boolean) && r.urls.filter(Boolean).length !== r.sceneKeys.length,
)
if (mismatched.length) {
  console.log(`❌ 有 ${mismatched.length} 条的图数量跟槽位数对不上：`)
  for (const r of mismatched.slice(0, 10)) console.log('  ', r.id, r.sceneKeys, r.urls)
} else {
  console.log('✓ 所有带图条目的图数量 = 该题的槽位数（没有半截替换）')
}

// ② 全部地址在真浏览器里解码
const urls = info.rows.flatMap((r) => r.urls.filter(Boolean))
const decoded = await page.evaluate(async (list) => {
  const load = (u) =>
    new Promise((res) => {
      const img = new Image()
      img.referrerPolicy = 'no-referrer'
      img.onload = () => res({ u, ok: img.naturalWidth > 0, w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => res({ u, ok: false, w: 0, h: 0 })
      img.src = u
    })
  const out = []
  for (let i = 0; i < list.length; i += 2) {
    out.push(...(await Promise.all(list.slice(i, i + 2).map(load))))
  }
  return out
}, urls)

const failed = decoded.filter((d) => !d.ok)
const ars = decoded.filter((d) => d.ok).map((d) => d.w / d.h)
const narrow = decoded.filter((d) => d.ok && d.w / d.h < 1.15)

console.log(`✓ ${decoded.length - failed.length}/${decoded.length} 张全部解码成功`)
if (failed.length) {
  console.log('❌ 解码失败：')
  for (const f of failed) console.log('  ', f.u)
}
if (ars.length) {
  console.log(`宽高比：最小 ${Math.min(...ars).toFixed(2)} / 最大 ${Math.max(...ars).toFixed(2)}`)
}
if (narrow.length) {
  console.log(`⚠️ 竖图（ar<1.15）${narrow.length} 张：`)
  for (const n of narrow) console.log('  ', n.u)
}

const unexpected = bad.filter((b) => !b.includes('favicon'))
if (unexpected.length) {
  console.log('⚠️ 页面上的报错：')
  for (const b of unexpected.slice(0, 10)) console.log('  ', b)
}

const pass = !mismatched.length && !failed.length && !narrow.length
console.log(`\n结论：${pass ? '全部通过' : '有问题，见上'}`)
await browser.close()
process.exit(pass ? 0 : 1)
