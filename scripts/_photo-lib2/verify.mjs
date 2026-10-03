import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const DIR = 'scripts/_photo-lib2'
const OUT = `${DIR}/img`
mkdirSync(OUT, { recursive: true })

/* 本次要补的 50 条 id（权威名单来自工作清单，不是子代理的自述） */
const worklist = JSON.parse(readFileSync(`${DIR}/worklist-50.json`, 'utf8'))
const wanted = new Set(worklist.map((w) => w.id))

const merged = []
for (const f of ['out-01.json', 'out-02.json', 'out-03.json', 'out-04.json']) {
  const p = `${DIR}/${f}`
  if (!existsSync(p)) {
    console.log(`!! 缺文件 ${p}`)
    continue
  }
  const j = JSON.parse(readFileSync(p, 'utf8'))
  for (const it of j.items) merged.push({ ...it, from: f })
}

console.log('sourced items:', merged.length)

/* ---- 静态一致性：id 在名单里 / 没重复 / 出处编号 == 地址编号 ---- */
const seen = new Set()
let staticBad = 0
for (const it of merged) {
  if (!wanted.has(it.id)) { console.log(`!! 不在待补名单里: ${it.id}`); staticBad += 1 }
  if (seen.has(it.id)) { console.log(`!! 重复: ${it.id}`); staticBad += 1 }
  seen.add(it.id)
  const urlId = (it.mediaUrl ?? '').match(/photos\/(\d+)\//)?.[1]
  const linkId = (it.credit?.link ?? '').replace(/\/+$/, '').split('-').pop()
  if (!urlId) { console.log(`!! 地址抠不出编号: ${it.id}`); staticBad += 1 }
  else if (urlId !== linkId) { console.log(`!! 张冠李戴 ${it.id}: 地址 ${urlId} vs 出处 ${linkId}`); staticBad += 1 }
  if (it.verdict !== 'ok') console.log(`-- 子代理标 fail: ${it.id} (${it.note ?? ''})`)
}
console.log('static problems:', staticBad)
console.log('missing from sourcing:', [...wanted].filter((id) => !seen.has(id)))

/* ---- 独立复验：自己重新下载、量字节、验 content-type、量 ar ---- */
function probe(url) {
  try {
    const out = execFileSync('curl', ['-sL', '-o', '-', '-w', '\n@@%{http_code} %{content_type}', url], {
      maxBuffer: 64 * 1024 * 1024,
    })
    const s = out.toString('latin1')
    const at = s.lastIndexOf('\n@@')
    const body = out.subarray(0, at)
    const [code, type] = s.slice(at + 3).trim().split(' ')
    return { bytes: body.length, code, type, buf: body }
  } catch (e) {
    return { bytes: 0, code: 'ERR', type: String(e).slice(0, 60), buf: Buffer.alloc(0) }
  }
}

function aspect(buf) {
  let i = 2
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i += 1; continue }
    const m = buf[i + 1]
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      const h = buf.readUInt16BE(i + 5)
      const w = buf.readUInt16BE(i + 7)
      return w / h
    }
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return 0
}

const ok = []
const bad = []
for (const it of merged) {
  if (it.verdict !== 'ok' || !it.mediaUrl) { bad.push({ ...it, why: '子代理标 fail' }); continue }
  const r = probe(it.mediaUrl)
  const ar = r.buf.length ? Number(aspect(r.buf).toFixed(3)) : 0
  const good = r.code === '200' && /^image\//.test(r.type) && r.bytes > 10000 && ar >= 1.15
  const rec = { id: it.id, title: it.title, mediaUrl: it.mediaUrl, pexelsId: it.pexelsId, credit: it.credit, note: it.note, http: r.code, type: r.type, bytes: r.bytes, ar, wasAr: it.ar }
  if (good) ok.push(rec)
  else bad.push({ ...rec, why: `http=${r.code} type=${r.type} bytes=${r.bytes} ar=${ar}` })
  writeFileSync(`${OUT}/${it.id}.jpg`, r.buf)
}

console.log('\n=== 复验通过:', ok.length, ' 不通过:', bad.length, '===')
for (const b of bad) console.log(`✗ ${b.id} ${b.title ?? ''} — ${b.why}`)

const arBad = ok.filter((r) => r.ar < 1.33)
console.log('\nar 在 1.15–1.33 之间（可接受但要人眼确认）:', arBad.map((r) => `${r.id}(${r.ar})`).join(' ') || '无')

writeFileSync(`${DIR}/sourced.json`, JSON.stringify({ items: ok, failed: bad }, null, 1) + '\n')
console.log('\n落盘: scripts/_photo-lib2/sourced.json')
