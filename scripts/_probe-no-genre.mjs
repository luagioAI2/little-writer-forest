/* 真机探针（用完即删）：在**真页面**里 import 真代码，验证「删掉文体层」之后
   应用文还在、记叙文一个字没变。 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.env.E2E_URL ?? 'http://localhost:5195/'

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
const title = await page.title()

const info = await page.evaluate(async () => {
  const types = await import('/src/domain/types.ts')
  const prompts = await import('/src/domain/prompts.ts')
  const bl = await import('/src/domain/builtinLibrary.ts')
  const me = await import('/src/domain/modelEssay.ts')
  const scoring = await import('/src/domain/scoring.ts')

  const tags = prompts.TOPIC_TAGS
  const items = bl.builtinBaseItems()
  const byGenre = {}
  let mismatch = 0
  for (const i of items) {
    const g = types.resolveGenre(i.requiredGenre)
    byGenre[g] = (byGenre[g] ?? 0) + 1
    const tag = tags.find((t) => t.id === i.tagId)
    if (types.resolveGenre(i.requiredGenre) !== types.resolveGenre(tag?.requiredGenre)) mismatch++
  }

  const applied = items.filter((i) => i.requiredGenre === 'applied')
  const badFormat = []
  for (const it of applied) {
    const shape = me.appliedShapeOf(it.title)
    const e = me.composeModelEssay({
      childText: '我们要节约用水。我家的水龙头有时候会滴水。',
      title: it.title,
      category: it.category,
      genre: it.requiredGenre,
      grade: 4,
      targetLen: 400,
      extract: scoring.extractSkeleton,
    })
    const first = e.text.split('\n').filter((x) => x.trim())[0]
    if (shape.salutation && first !== shape.salutation) badFormat.push(`${it.title}|first=${first}`)
    if (e.text.includes('我最先注意到的是')) badFormat.push(`${it.title}|画面句`)
  }

  // 记叙文样本：一个都不许被当成应用文
  const leaked = items
    .filter((i) => types.resolveGenre(i.requiredGenre) === 'narrative')
    .filter((i) => {
      const m = me.explainMaterial('今天我和小明在公园玩。', i.title)
      return me.resolveKind(i.category, m, { genre: i.requiredGenre }) === 'applied'
    })

  return {
    GENRES: types.GENRES.map((g) => g.key),
    TAGS: tags.length,
    ITEMS: items.length,
    BYGENRE: byGenre,
    MISMATCH: mismatch,
    BAD_FORMAT: badFormat,
    LEAKED: leaked.length,
    FOCUS: {
      applied: prompts.focusForGenre('applied'),
      narrative: prompts.focusForGenre('narrative') ?? null,
      none: prompts.focusForGenre(undefined) ?? null,
    },
    // 老存档兼容：库里有没有还带旧 key `genre` 的行
    LEGACY_KEY_ROWS: items.filter((i) => 'genre' in i).length,
  }
})

// 真·首屏快照（走 IndexedDB 那条路）
const snap = await page.evaluate(async () => {
  const db = await import('/src/db/db.ts')
  const s = await db.readBootSnapshot()
  const lib = s.library ?? []
  const byGenre = {}
  for (const i of lib) {
    const g = i.requiredGenre ?? 'narrative'
    byGenre[g] = (byGenre[g] ?? 0) + 1
  }
  return { LIB_COUNT: lib.length, BYGENRE: byGenre }
})

console.log(
  'APP_PROBE_START\n' +
    JSON.stringify({ TITLE: title, ...info, SNAP: snap, ERRS: bad.slice(0, 8) }, null, 1) +
    '\nAPP_PROBE_END',
)

await browser.close()
