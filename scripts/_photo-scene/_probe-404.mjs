/* 只读：把那个 404 找出来（大概率是 favicon） */
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
const fails = []
page.on('response', (r) => {
  if (r.status() >= 400) fails.push(`${r.status()}  ${r.url()}`)
})
await page.goto('http://localhost:5190/library-browse.html', {
  waitUntil: 'networkidle2',
  timeout: 60_000,
})
console.log('失败请求：')
for (const f of fails) console.log('  ', f)
console.log(fails.length ? '' : '  （无）')
await browser.close()
