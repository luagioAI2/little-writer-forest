/* ============================================================
   探针：火山引擎「录音文件识别」的端到端延迟
   ============================================================

   为什么单独写一个：这条接口是**异步两段式**的 ——
     ① POST /api/v3/auc/bigmodel/submit  提交任务（返回体是空的 {}）
     ② POST /api/v3/auc/bigmodel/query   拿结果（要带同一个 X-Api-Request-Id）

   所以「快不快」不能只看 submit 那一下（实测只要 ~0.5s，但它只是收下任务）。
   真正该量的是 **提交 → 拿到文本** 的总时间，而这段必须靠轮询才能测出来。
   只打 submit 就下结论，会得出一个漂亮但没意义的数字。

   ⚠️ 轮询间隔会直接抬高测出来的数字：结果可能在两次轮询之间就绪了。
      所以这里记的是「第一次查到就绪」的时刻，是个**上界**。
      间隔设得越密，上界越紧（但也越费配额）。

   跑法：
     VOLC_API_KEY=xxx node scripts/_probe-volcengine.mjs --file speech_probe.wav
     VOLC_API_KEY=xxx node scripts/_probe-volcengine.mjs --file speech_probe.wav --punc --runs 3
     VOLC_API_KEY=xxx node scripts/_probe-volcengine.mjs --url https://.../x.mp3

   密钥**只从环境变量读** —— 和 scripts/transcribe-e2e.test.ts 一个规矩，
   不写进任何文件、不进仓库。
   ============================================================ */

import { existsSync, readFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'

const KEY = process.env.VOLC_API_KEY?.trim()
if (!KEY) {
  console.error('\n✖ 需要密钥：VOLC_API_KEY=xxx node scripts/_probe-volcengine.mjs --file a.wav\n')
  process.exit(1)
}

const RESOURCE = process.env.VOLC_RESOURCE_ID?.trim() || 'volc.seedasr.auc'
const SUBMIT = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit'
const QUERY = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query'

/**
 * ★ `20000001` 是「还在处理」，是**正常的中间态**，不是错误。
 *
 * 一开始只认 `20000000`，其余全当失败 —— 于是第一次轮询就退出，
 * 报一句"query 失败"，而真相是"再等一会儿就好了"。
 * 这类"把正常态当成错误"的判据会让人误以为服务不可用。
 */
const IN_PROGRESS = '20000001'

const argv = process.argv.slice(2)
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : fallback
}
const FILE = opt('--file')
const URL = opt('--url')
const RUNS = Math.max(1, Number.parseInt(opt('--runs', '1'), 10) || 1)
const PUNC = argv.includes('--punc')
const POLL_MS = Number.parseInt(opt('--poll', '300'), 10) || 300
const TIMEOUT_MS = Number.parseInt(opt('--timeout', '60000'), 10) || 60000

if (!FILE && !URL) {
  console.error('\n✖ 要给一个音频：--file <本地文件> 或 --url <公网地址>\n')
  process.exit(1)
}
if (FILE && !existsSync(resolve(FILE))) {
  console.error(`\n✖ 找不到文件：${resolve(FILE)}\n`)
  process.exit(1)
}

/* ---------------- WAV 头解析 ---------------- */
/*
 * 请求里的 rate/bits/channel 是**声明**，得和文件真实情况对上。
 * 直接写死 16000/16/1 在别的素材上会静默变差或直接失败，所以从文件里读。
 */
function readWavHeader(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return null
  let pos = 12
  let fmt = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(pos + 10),
        rate: buf.readUInt32LE(pos + 12),
        bits: buf.readUInt16LE(pos + 22),
      }
    }
    if (id === 'data') break
    pos += 8 + size + (size % 2)
  }
  return fmt
}

/* ---------------- 请求 ---------------- */

function headers(requestId) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': KEY,
    'X-Api-Resource-Id': RESOURCE,
    'X-Api-Request-Id': requestId,
    'X-Api-Sequence': '-1',
  }
}

async function once({ label, audio }) {
  const requestId = crypto.randomUUID()
  const body = {
    user: { uid: 'little-writer-forest-probe' },
    audio,
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: PUNC,
      enable_ddc: false,
      enable_speaker_info: false,
      enable_channel_split: false,
      show_utterances: false,
      vad_segment: false,
      sensitive_words_filter: '',
    },
  }

  const t0 = Date.now()
  const sub = await fetch(SUBMIT, {
    method: 'POST',
    headers: headers(requestId),
    body: JSON.stringify(body),
  })
  const tSubmit = Date.now() - t0
  const status = sub.headers.get('X-Api-Status-Code')
  const message = sub.headers.get('X-Api-Message')
  if (!sub.ok || status !== '20000000') {
    console.log(`  ✖ submit 被拒：HTTP ${sub.status} status=${status} msg=${message}`)
    console.log(`    ${(await sub.text()).slice(0, 200)}`)
    return null
  }

  // 轮询取结果。submit 只代表「任务收下了」，不代表「识别完了」。
  let polls = 0
  for (;;) {
    polls++
    const q = await fetch(QUERY, { method: 'POST', headers: headers(requestId), body: '{}' })
    const qStatus = q.headers.get('X-Api-Status-Code')
    const raw = await q.text()
    const elapsed = Date.now() - t0

    let json = null
    try {
      json = JSON.parse(raw)
    } catch {
      /* 还没好时可能不是 JSON */
    }
    const text = json?.result?.text
    if (typeof text === 'string' && text.length > 0) {
      const duration = json?.audio_info?.duration
      console.log(
        `  ${label}  submit ${tSubmit}ms  就绪 ${elapsed}ms  轮询 ${polls} 次  ` +
          `音频 ${duration ? `${duration}ms` : '?'}  文本 ${text.length} 字`,
      )
      return { elapsed, tSubmit, text, duration, polls }
    }
    if (qStatus && qStatus !== '20000000' && qStatus !== IN_PROGRESS) {
      console.log(`  ✖ query 失败：status=${qStatus} msg=${q.headers.get('X-Api-Message')} raw=${raw.slice(0, 160)}`)
      return null
    }
    if (elapsed > TIMEOUT_MS) {
      console.log(`  ✖ 超过 ${TIMEOUT_MS}ms 还没结果（轮询 ${polls} 次）`)
      return null
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

/* ---------------- 组装音频参数 ---------------- */

let audio
let desc
if (URL) {
  audio = { url: URL, format: extname(new URL(URL).pathname).slice(1) || 'mp3', codec: 'raw', rate: 16000, bits: 16, channel: 1 }
  desc = URL
} else {
  const path = resolve(FILE)
  const buf = readFileSync(path)
  const ext = extname(path).slice(1).toLowerCase()
  const fmt = ext === 'wav' ? readWavHeader(buf) : null
  audio = {
    data: buf.toString('base64'),
    format: ext,
    codec: 'raw',
    rate: fmt?.rate ?? 16000,
    bits: fmt?.bits ?? 16,
    channel: fmt?.channels ?? 1,
  }
  desc = `${basename(path)}  ${(buf.length / 1024).toFixed(1)} KB` + (fmt ? `  ${fmt.rate}Hz ${fmt.channels}ch ${fmt.bits}bit` : '')
}

/* ---------------- 跑 ---------------- */

console.log('')
console.log(`  素材    ${desc}`)
console.log(`  接口    录音文件识别（submit + query 轮询，间隔 ${POLL_MS}ms）`)
console.log(`  资源    ${RESOURCE}`)
console.log(`  标点    ${PUNC ? '开' : '关'}`)
console.log(`  传输    ${audio.data ? 'base64 内联（audio.data）' : 'audio.url'}`)
console.log('')

const results = []
for (let i = 0; i < RUNS; i++) {
  const r = await once({ label: RUNS > 1 ? `第 ${i + 1}/${RUNS} 次` : '结果  ', audio })
  if (!r) process.exit(1)
  results.push(r)
}

const ready = results.map((r) => r.elapsed).sort((a, b) => a - b)
const median = ready.length % 2 ? ready[(ready.length - 1) / 2] : Math.round((ready[ready.length / 2 - 1] + ready[ready.length / 2]) / 2)

console.log('')
console.log(`  提交 → 就绪   最快 ${ready[0]}ms · 中位 ${median}ms · 最慢 ${ready[ready.length - 1]}ms`)
console.log(`  其中 submit   中位 ${results.map((r) => r.tSubmit).sort((a, b) => a - b)[Math.floor(results.length / 2)]}ms`)
const last = results[results.length - 1]
if (last.duration) {
  console.log(`  音频时长      ${last.duration}ms  →  就绪/时长 ≈ ${(median / last.duration).toFixed(2)}×`)
}
console.log('')
console.log(`  文本  ${last.text}`)
console.log('')
console.log('  ⚠️ 这是**上界**：结果可能在两次轮询之间就好了，实际比这个数小。')
console.log('     想比快慢，请拿同一个素材在两边各跑一遍。')
console.log('')
