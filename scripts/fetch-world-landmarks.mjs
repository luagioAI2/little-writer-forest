/* ============================================================
   世界景点 —— 抓取坐标与图片（两趟）
   ============================================================
   输入：`scripts/world-landmarks-seed.mjs`（人挑的清单）
   输出：`scripts/world-landmarks.json`

   ------------------------------------------------------------
   第一趟：DBpedia SPARQL —— 拿坐标、中文名、中文简介、开放图片、wikidata QID
   第二趟：Overpass（OSM）—— 只给**第一趟没坐标**的补坐标，用 QID 精确匹配

   为什么要两趟：
     DBpedia 的坐标**覆盖不全**（实测 `Colosseum` / `Tower_Bridge` /
     `Golden_Gate_Bridge` / `Great_Barrier_Reef` 都只有标签、三种坐标属性全空）。
     而 OSM 里这些都有。所以 DBpedia 拿不到的，交给 OSM。

   ⚠️⚠️ 第二趟**必须用 wikidata QID 查，不能用名字查**：
     按 `["name"="Tower Bridge"]` 查会命中**爱尔兰**的同名桥，
     `["name"="Sagrada Familia"]` 命中**阿根廷**的 —— 而且**不报错、看着像对的**。
     QID 是唯一标识，不会张冠李戴。

   ⚠️ Overpass 会返回 **504（服务器过载）**，不是封禁 —— 退避重试即可。
     一次用正则并集批量查（`["wikidata"~"^(Q1|Q2)$"]`），比一条一条快得多。

   ⚠️ 不要改用 `/data/<名>.json`：那个端点返回**整个图**（`Mount_Fuji` 有 940 个顶层键，
     含所有被链接的实体）。按「第一个 resource/ 开头的键」取会取到邻居实体
     （如 `Tokyo`），表现是**字段全 null 但 HTTP 200、不报错**。

   ⚠️ 许可：DBpedia CC BY-SA；图片来自 Wikimedia Commons；坐标可能来自 © OpenStreetMap 贡献者（ODbL）。
   ============================================================ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { WORLD_SEED } from './world-landmarks-seed.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, '.world-landmarks-cache.json')
const OUT = join(HERE, 'world-landmarks.json')

const UA = 'little-writer-forest/1.0 (landmark data build; local dev)'
const REFRESH = process.argv.includes('--refresh')
const BATCH = 40
const RES = 'http://dbpedia.org/resource/'
const WD = 'http://www.wikidata.org/entity/'

/* 繁 → 简。opencc-js 装在隔离的 node 工作区里（不污染项目依赖）。 */
const NODE_WORKSPACE = 'C:/Users/admin/.workbuddy-ai/binaries/node/workspace/node_modules'
let toSimplified = (s) => s
try {
  const req = createRequire(join(NODE_WORKSPACE, 'noop.js'))
  toSimplified = req('opencc-js').Converter({ from: 'tw', to: 'cn' })
} catch (e) {
  console.warn('⚠️ opencc-js 没装上，中文不转换：', e.message)
}

/* ★★ IRI 里**一个字符都不要编码** —— 用原始名字。
   踩过的坑：先写成 `RES + encodeURI(w)`，于是 `Sagrada_Família` 变成
   `Sagrada_Fam%C3%ADlia`。而 SPARQL 的 `<...>` 是 **IRI 字面量，不做百分号解码**，
   所以它去找一个名叫 `Sagrada_Fam%C3%ADlia` 的资源 → 找不到 →
   **整批里凡是带重音/变音符号的条目全部失败**（Família / Belém / Schönbrunn /
   Galápagos / Château / Park_Güell / Český / Zócalo / Copán / Gorée …）。
   ⚠️ 表现是「HTTP 200、不报错、就是取不到」—— 最容易当成数据源不全。
   传输层的编码由外面的 `encodeURIComponent(query)` 负责，这里不该管。 */
const iri = (w) => RES + w

const sleep = (ms) => new Promise((s) => setTimeout(s, ms))

async function post(url, opts, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const c = new AbortController()
      const to = setTimeout(() => c.abort(), 120000)
      const r = await fetch(url, { ...opts, signal: c.signal })
      clearTimeout(to)
      const t = await r.text()
      return { status: r.status, text: t }
    } catch (e) {
      if (i === tries - 1) throw e
      await sleep(1500 * (i + 1))
    }
  }
}

/* ---------------- 第一趟：DBpedia ---------------- */
const P = 'PREFIX dbo: <http://dbpedia.org/ontology/> ' +
  'PREFIX geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> ' +
  'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> ' +
  'PREFIX owl: <http://www.w3.org/2002/07/owl#> '

async function dbpediaBatch(names) {
  const q = P + 'SELECT ?x ?lat ?long ?zhLabel ?enLabel ?zhDesc ?thumb ?qid WHERE {\n' +
    '  VALUES ?x { ' + names.map((n) => '<' + iri(n) + '>').join(' ') + ' }\n' +
    '  OPTIONAL { ?x geo:lat ?lat } OPTIONAL { ?x geo:long ?long }\n' +
    "  OPTIONAL { ?x rdfs:label ?zhLabel . FILTER(lang(?zhLabel)='zh') }\n" +
    "  OPTIONAL { ?x rdfs:label ?enLabel . FILTER(lang(?enLabel)='en') }\n" +
    "  OPTIONAL { ?x dbo:description ?zhDesc . FILTER(lang(?zhDesc)='zh') }\n" +
    '  OPTIONAL { ?x dbo:thumbnail ?thumb }\n' +
    '  OPTIONAL { ?x owl:sameAs ?qid . FILTER(STRSTARTS(STR(?qid), "' + WD + '")) }\n}'
  const r = await post('https://dbpedia.org/sparql?format=json&query=' + encodeURIComponent(q), {
    headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
  })
  if (r.status !== 200) throw new Error('HTTP ' + r.status)
  return JSON.parse(r.text).results?.bindings || []
}

/* 一个实体可能因 OPTIONAL 多值产生多行 —— 按 ?x 归并，每字段取第一个非空 */
function mergeRows(rows) {
  const m = new Map()
  for (const r of rows) {
    const uri = r.x?.value
    if (!uri) continue
    const cur = m.get(uri) || {}
    const put = (k, v) => { if (v != null && cur[k] == null) cur[k] = v }
    put('lat', r.lat?.value != null ? Number(r.lat.value) : null)
    put('long', r.long?.value != null ? Number(r.long.value) : null)
    put('zhLabel', r.zhLabel?.value ?? null)
    put('enLabel', r.enLabel?.value ?? null)
    put('zhDesc', r.zhDesc?.value ?? null)
    put('thumb', r.thumb?.value ?? null)
    put('qid', r.qid?.value ? r.qid.value.slice(WD.length) : null)
    m.set(uri, cur)
  }
  return m
}

const keyOf = (uri) => { try { return decodeURIComponent(uri.slice(RES.length)) } catch { return uri.slice(RES.length) } }

/* ---------------- 第二趟：Overpass ---------------- */
async function overpassByQids(qids) {
  const re = '^(' + qids.join('|') + ')$'
  const query = '[out:json][timeout:120];nwr["wikidata"~"' + re + '"];out center;'
  const r = await post('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  })
  if (r.text.trimStart().startsWith('<')) {
    // 504 / 过载 → 抛出去让调用方退避重试
    const m = r.text.match(/Error<\/strong>:\s*([^<]+)/)
    throw new Error('Overpass ' + r.status + ' ' + (m ? m[1].slice(0, 50) : 'XML 响应'))
  }
  return JSON.parse(r.text).elements || []
}

/* ---------------- 主流程 ---------------- */
function loadCache() {
  if (REFRESH || !existsSync(CACHE)) return {}
  try { return JSON.parse(readFileSync(CACHE, 'utf8')) } catch { return {} }
}

async function main() {
  const cache = loadCache()

  /* --- 第一趟 --- */
  const need = WORLD_SEED.filter((s) => !cache[s.w])
  console.log('清单', WORLD_SEED.length, '条；第一趟（DBpedia）要查', need.length, '条')
  for (let i = 0; i < need.length; i += BATCH) {
    const chunk = need.slice(i, i + BATCH)
    process.stdout.write('  DBpedia ' + (i + 1) + '~' + (i + chunk.length) + ' … ')
    try {
      const m = mergeRows(await dbpediaBatch(chunk.map((s) => s.w)))
      let n = 0
      for (const [uri, rec] of m) { cache[keyOf(uri)] = rec; n++ }
      console.log('返回 ' + n + ' 个实体')
    } catch (e) {
      console.log('✖ ' + (e.name + ': ' + e.message).slice(0, 60))
    }
    await sleep(400)
  }
  writeFileSync(CACHE, JSON.stringify(cache, null, 1))

  /* --- 第二趟：DBpedia 没坐标、但有 QID 的 --- */
  const noCoord = WORLD_SEED.filter((s) => cache[s.w] && cache[s.w].lat == null && cache[s.w].qid)
  console.log('')
  console.log('第二趟（Overpass 补坐标）：', noCoord.length, '条')
  const QBATCH = 20
  for (let i = 0; i < noCoord.length; i += QBATCH) {
    const chunk = noCoord.slice(i, i + QBATCH)
    const qids = chunk.map((s) => cache[s.w].qid)
    process.stdout.write('  Overpass ' + (i + 1) + '~' + (i + chunk.length) + ' … ')
    let els = null
    for (let attempt = 0; attempt < 5 && els === null; attempt++) {
      try {
        els = await overpassByQids(qids)
      } catch (e) {
        if (attempt === 4) { console.log('✖ ' + e.message.slice(0, 60)); els = [] }
        else await sleep(3000 * (attempt + 1))
      }
    }
    if (!els) continue
    // 一个 QID 可能命中多个元素（node + relation）—— 取第一个有坐标的
    const byQ = new Map()
    for (const e of els) {
      const q = e.tags?.wikidata
      if (!q || byQ.has(q)) continue
      const lat = e.lat ?? e.center?.lat
      const lon = e.lon ?? e.center?.lon
      if (lat != null && lon != null) byQ.set(q, { lat, long: lon })
    }
    for (const s of chunk) {
      const hit = byQ.get(cache[s.w].qid)
      if (hit) {
        cache[s.w].lat = hit.lat
        cache[s.w].long = hit.long
        cache[s.w].coordFrom = 'OSM/Overpass'
      }
    }
    console.log('补上 ' + byQ.size + ' 个')
    await sleep(1200)
  }
  writeFileSync(CACHE, JSON.stringify(cache, null, 1))

  /* --- 组装 --- */
  const out = []
  const fails = []
  for (const s of WORLD_SEED) {
    const rec = cache[s.w]
    if (!rec) { fails.push({ zh: s.zh, w: s.w, why: 'DBpedia 里没有这个条目（资源名写错？）' }); continue }
    if (rec.lat == null || rec.long == null) {
      fails.push({ zh: s.zh, w: s.w, why: rec.qid ? '两趟都没拿到坐标' : '没有坐标、也没有 wikidata QID' })
      continue
    }
    out.push({
      id: 'world-' + s.c + '-' + s.zh,
      name: s.zh,
      country: s.c,
      province: s.c,
      lng: Number(rec.long.toFixed(5)),
      lat: Number(rec.lat.toFixed(5)),
      blurb: s.b,
      scene: s.s,
      tier: 1,
      /* ↓ 溯源字段：给自己复核用，不进 App 数据 */
      _wiki: s.w,
      _qid: rec.qid || null,
      _coordFrom: rec.coordFrom || 'DBpedia',
      _wikiZh: rec.zhLabel ? toSimplified(rec.zhLabel) : null,
      _wikiEn: rec.enLabel || null,
      _wikiDesc: rec.zhDesc ? toSimplified(rec.zhDesc) : null,
      _photo: rec.thumb || null,
      _photoSource: rec.thumb ? 'Wikimedia Commons' : null,
    })
  }

  writeFileSync(OUT, JSON.stringify({
    source: 'DBpedia SPARQL（坐标/中文名/简介/图片）+ OpenStreetMap Overpass（补 DBpedia 缺的坐标）',
    license: 'DBpedia: CC BY-SA 3.0；图片: Wikimedia Commons（各自授权）；坐标含 © OpenStreetMap 贡献者（ODbL）',
    attribution: 'DBpedia contributors / Wikimedia Commons contributors / © OpenStreetMap contributors',
    whyThisFileExists:
      '世界景点的坐标与图片由机器补齐；「哪些算知名」由人挑（world-landmarks-seed.mjs）。' +
      'DBpedia 有 1,074 个世界遗产全带坐标，但没有可信的知名度字段 —— ' +
      '按「标签语言数」排序区分不出来（全挤在 21-22，还混着 Pannonhalma Archabbey 这种）。' +
      'DBpedia 的坐标覆盖不全（Colosseum/Tower_Bridge/Golden_Gate_Bridge 都没有），' +
      '所以缺的那批用 wikidata QID 去 OSM 补 —— ⚠️ 必须用 QID，按名字查会张冠李戴。',
    fetchedAt: new Date().toISOString().slice(0, 10),
    seedCount: WORLD_SEED.length,
    count: out.length,
    items: out,
  }, null, 1))

  const fromOsm = out.filter((x) => x._coordFrom === 'OSM/Overpass').length
  console.log('')
  console.log('清单条数 :', WORLD_SEED.length)
  console.log('成功     :', out.length, '（其中 OSM 补坐标', fromOsm, '条）')
  console.log('失败     :', fails.length)
  console.log('带图片   :', out.filter((x) => x._photo).length)
  console.log('有中文名 :', out.filter((x) => x._wikiZh).length)
  console.log('有中文介 :', out.filter((x) => x._wikiDesc).length)
  if (fails.length) {
    console.log('')
    console.log('=== 失败清单 ===')
    fails.forEach((f) => console.log('  ✗', f.zh.padEnd(16), f.w.padEnd(36), f.why))
  }
  console.log('')
  console.log('写出：', OUT)
}

main()
