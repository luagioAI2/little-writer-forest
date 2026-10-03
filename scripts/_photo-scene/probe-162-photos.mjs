/* 只读探针：162 个照片地址在**真浏览器**里能不能解码（不是"DOM 里有 img"）。

   ★ 张数多 → 必须显式抬高 protocolTimeout（puppeteer 默认 180s）。
     把 162 张塞进一次 evaluate 会抛 ProtocolError，**症状长得像"图全坏了"**。
   ★ 分块跑（20 张一块），顺带把每块的宽高比也量出来。
   ★ 全程只读，不点保存。
*/
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox'],
  protocolTimeout: 600_000,
})
const page = await browser.newPage()

const bad = []
page.on('response', (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`)
})
await page.setRequestInterception(true)
page.on('request', (req) => {
  if (/__save-library-items/.test(req.url())) return req.abort()
  req.continue()
})

await page.goto('http://localhost:5190/library-browse.html', {
  waitUntil: 'networkidle2',
  timeout: 60_000,
})

const info = await page.evaluate(async () => {
  const mod = await import('/src/domain/builtinLibrary.ts')
  const items = mod.buildBuiltinLibrary()
  const urls = []
  for (const it of items) {
    for (const im of it.images) if (im.imageUrl) urls.push({ id: it.id, u: im.imageUrl })
  }
  return { total: items.length, urls }
})

console.log(`库 ${info.total} 条，照片槽位 ${info.urls.length} 个`)

const uniq = new Set(info.urls.map((x) => x.u))
console.log(`不同地址 ${uniq.size} 个 → ${uniq.size === info.urls.length ? '★ 没有一张重复 ✓' : '✗ 还有重复'}`)

const CHUNK = 20
const results = []
for (let i = 0; i < info.urls.length; i += CHUNK) {
  const part = await page.evaluate(async (list) => {
    const load = (o) =>
      new Promise((res) => {
        const img = new Image()
        img.referrerPolicy = 'no-referrer'
        img.onload = () => res({ ...o, ok: img.naturalWidth > 0, w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = () => res({ ...o, ok: false, w: 0, h: 0 })
        img.src = o.u
      })
    const out = []
    for (let k = 0; k < list.length; k += 4) {
      out.push(...(await Promise.all(list.slice(k, k + 4).map(load))))
    }
    return out
  }, info.urls.slice(i, i + CHUNK))
  results.push(...part)
  process.stdout.write(`  ${Math.min(i + CHUNK, info.urls.length)}/${info.urls.length}\r`)
}
console.log('')

const failed = results.filter((r) => !r.ok)
console.log(`✓ ${results.length - failed.length}/${results.length} 张解码成功`)
for (const f of failed) console.log('  ✗', f.id, f.u)

const ars = results.filter((r) => r.ok).map((r) => r.w / r.h)
const narrow = results.filter((r) => r.ok && r.w / r.h < 1.15)
console.log(`宽高比：最小 ${Math.min(...ars).toFixed(2)} / 最大 ${Math.max(...ars).toFixed(2)}`)
if (narrow.length) {
  console.log(`⚠️ 竖图（ar<1.15）${narrow.length} 张：`)
  for (const n of narrow) console.log('  ', n.id, n.u, (n.w / n.h).toFixed(2))
}

const unexpected = bad.filter((b) => !b.includes('favicon'))
console.log(unexpected.length ? '⚠️ 报错：' + unexpected.slice(0, 5).join(' | ') : '✓ 无 favicon 以外的报错')

const pass = failed.length === 0 && narrow.length === 0 && uniq.size === info.urls.length
console.log(`\n结论：${pass ? '通过 —— 162 张照片全部能在界面上解码，且没有重复' : '不通过，见上'}`)
await browser.close()
process.exit(pass ? 0 : 1)
