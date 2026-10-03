/* 改名对照表 → PNG（给家长看结果） */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const rows = JSON.parse(readFileSync('scripts/_new50/renames.json', 'utf8'))
// 拿被改那条的引导语（说明"为什么这么改"）
const raw = readFileSync('src/domain/prompts.ts', 'utf8')
const leads = {}
{
  const lines = raw.split(/\r?\n/)
  const TAG = /^  '?([A-Za-z-]+)'?: \[$/
  const ONE = /^    \{ title: '([^']*)', lead: '([^']*)'/
  const ML = /^      lead: '([^']*)',$/
  let cur = null, idx = 0
  for (const line of lines) {
    const m = TAG.exec(line)
    if (m) { cur = m[1]; idx = 0; continue }
    if (!cur) continue
    const o = ONE.exec(line)
    if (o) { idx++; leads[`builtin-${cur}-${idx}`] = o[2]; continue }
    const l = ML.exec(line)
    if (l) { leads[`builtin-${cur}-${idx}`] = l[1] }
    if (/^      title:/.test(line)) idx++
  }
}

const tr = rows
  .map(
    (r) => `<tr>
      <td class="tag">${r.tag}</td>
      <td class="old">${r.old}</td>
      <td class="arrow">→</td>
      <td class="new">${r.new}</td>
      <td class="lead">${(leads[r.id] ?? '').slice(0, 44)}</td>
    </tr>`,
  )
  .join('')

const html = `<!doctype html><meta charset="utf-8"><style>
 body{margin:0;background:#f6f7f9;font:13px/1.5 "Microsoft YaHei",sans-serif;color:#111}
 h1{font-size:17px;margin:16px 18px 4px}
 p.sub{margin:0 18px 12px;color:#555;font-size:12.5px}
 table{border-collapse:collapse;background:#fff;margin:0 18px 18px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
 th,td{padding:6px 10px;border-bottom:1px solid #eceff3;text-align:left;vertical-align:top}
 th{background:#f0f3f7;font-size:12px;color:#333;position:sticky;top:0}
 td.tag{color:#7a8699;font-size:12px;white-space:nowrap}
 td.old{color:#a0453a;text-decoration:line-through;white-space:nowrap}
 td.arrow{color:#98a2b3}
 td.new{color:#1f7a3f;font-weight:600;white-space:nowrap}
 td.lead{color:#667085;font-size:12px;max-width:430px}
</style>
<h1>作文库 · 重复标题改名对照表（共 ${rows.length} 条）</h1>
<p class="sub">规则：两个同名的，改<b>引导语在描述画面</b>的那条（插画题），让照片题保留熟悉的标题。「题面+引导语逐字一样」的 2 组改跟本标签更不贴的那条。只动 title，引导语一个字没改，也没删任何条目。</p>
<table><thead><tr><th>标签</th><th>原题面</th><th></th><th>新题面</th><th>这条的引导语（没改）</th></tr></thead><tbody>${tr}</tbody></table>`

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1180, height: 1200 })
  await page.setContent(html, { waitUntil: 'networkidle2' })
  await page.screenshot({ path: '_new50-rename-table.png', fullPage: true })
  console.log('写出 _new50-rename-table.png（' + rows.length + ' 行）')
} finally {
  await browser.close()
}
