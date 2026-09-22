/* ============================================================
   转写延迟拆解 + 预热连接到底值不值得做
   ============================================================

   回答的问题：要把「按住说话 → 出字」变快，该往哪儿使劲？

   量三档，都用同一段音频、同一个模型：

     ① 冷 POST    每次单独发一条 curl → 每次都重新握手
     ② 热 POST    一条 curl 里连发多个 → 复用同一条连接
     ③ 预热 POST  先 GET /v1/models（很轻，不消耗转写配额）再 POST

   ③ 就是「孩子按下按钮时先预热连接」这个优化的等价实验：
   如果 ③ 明显快于 ①，那这个优化就是真的。

   ⚠️ 两个坑（都踩过）：
     · 不能用字面量 '/dev/null' —— 直接 execFileSync 传给 Windows 的 curl
       时不经过 MSYS 路径转换，curl 会当成 E:\dev\null 去写 → exit 23。
       要用 node:os 的 devNull。
     · -o 是**按位置**匹配 URL 的：N 个 URL 就要 N 个 -o，
       否则第 2 个开始响应体会直接打到 stdout，把耗时行搅乱。
     · -w 的格式串里**别加方括号**之类非数字字符 —— 解析时要么放宽正则，
       要么就只输出空格分隔的数字。这里选后者。

   跑法：
     TRANSCRIBE_API_KEY=sk-xxxx node scripts/_probe-latency.mjs
     N=8 TRANSCRIBE_API_KEY=sk-xxxx node scripts/_probe-latency.mjs
   ============================================================ */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { devNull } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const KEY = (process.env.TRANSCRIBE_API_KEY ?? '').trim()
const BASE = (process.env.TRANSCRIBE_BASE_URL ?? 'https://api.siliconflow.cn/v1').replace(/\/+$/, '')
const FILE = join(ROOT, 'speech_probe.webm')
const MODEL = process.env.TRANSCRIBE_MODEL ?? 'Qwen/Qwen3-ASR-1.7B'
const N = Number(process.env.N ?? 6)

if (!KEY) {
  console.error('\n✖ 需要 TRANSCRIBE_API_KEY\n')
  process.exit(2)
}

/** 输出四段耗时：DNS / TCP / TLS / 总计（毫秒）
 *  ⚠️ 结尾的 \n 不能少：一次 curl 带多个 URL 时，-w 会为**每个** transfer
 *     输出一次；没有 \n 的话它们会首尾相连挤在同一行，
 *     于是「N 次」看起来只有 1 行（踩过，很隐蔽）。 */
const FMT = '%{time_namelookup} %{time_connect} %{time_appconnect} %{time_total}\n'

const auth = ['-H', `Authorization: Bearer ${KEY}`]
const transcribeArgs = [
  '-s',
  '-X',
  'POST',
  '-w',
  FMT,
  ...auth,
  '-F',
  `file=@${FILE};filename=audio.webm;type=audio/webm`,
  '-F',
  `model=${MODEL}`,
]
const modelsArgs = ['-s', '-w', FMT, ...auth]

const POST_URL = `${BASE}/audio/transcriptions`
const MODELS_URL = `${BASE}/models`

function run(args) {
  const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 8 << 20 })
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[\d.\s]+$/.test(l))
    .map((l) => {
      const [dns, tcp, tls, total] = l.split(/\s+/).map(Number)
      return {
        dns: Math.round(dns * 1000),
        tcp: Math.round((tcp - dns) * 1000),
        tls: Math.round((tls - tcp) * 1000),
        handshake: Math.round(tls * 1000),
        total: Math.round(total * 1000),
      }
    })
}

const median = (a) => {
  const b = [...a].sort((x, y) => x - y)
  const m = b.length >> 1
  return b.length % 2 ? b[m] : Math.round((b[m - 1] + b[m]) / 2)
}

const size = readFileSync(FILE).length
console.log(`\n  素材 speech_probe.webm · ${(size / 1024).toFixed(1)} KB`)
console.log(`  模型 ${MODEL} · 每档 ${N} 次 · ${BASE}`)

/* ---------------- ① 冷 POST ---------------- */
console.log('\n  ① 冷 POST（每次新建连接）\n')
console.log('    次序     DNS      TCP      TLS    总计')
console.log('    ----  -------  -------  -------  --------')
const cold = []
for (let i = 0; i < N; i += 1) {
  const r = run([...transcribeArgs, '-o', devNull, POST_URL])[0]
  if (!r) continue
  cold.push(r.total)
  console.log(`    ${String(i + 1).padStart(4)}  ${String(r.dns).padStart(6)}ms ${String(r.tcp).padStart(6)}ms ${String(r.tls).padStart(6)}ms ${String(r.total).padStart(7)}ms`)
}

/* ---------------- ② 热 POST（复用连接） ---------------- */
const warmRows = run([
  ...transcribeArgs,
  ...Array.from({ length: N }, () => ['-o', devNull]).flat(),
  ...Array.from({ length: N }, () => POST_URL),
])
console.log('\n  ② 热 POST（一条连接连发，从第 2 次起复用）\n')
console.log('    次序     DNS      TCP      TLS    总计')
console.log('    ----  -------  -------  -------  --------')
warmRows.forEach((r, i) => {
  console.log(`    ${String(i + 1).padStart(4)}  ${String(r.dns).padStart(6)}ms ${String(r.tcp).padStart(6)}ms ${String(r.tls).padStart(6)}ms ${String(r.total).padStart(7)}ms`)
})

/* ---------------- ③ 预热：先 GET /models 再 POST ---------------- */
console.log('\n  ③ 先 GET /v1/models 预热，再 POST（= 按下按钮时预热连接）\n')
console.log('    次序    预热耗时   POST握手    POST总计')
console.log('    ----  ---------  ---------  ----------')
const pre = []
for (let i = 0; i < N; i += 1) {
  const rows = run([...modelsArgs, '-o', devNull, MODELS_URL, ...transcribeArgs, '-o', devNull, POST_URL])
  if (rows.length < 2) continue
  pre.push({ warm: rows[0].total, postHandshake: rows[1].handshake, post: rows[1].total })
  console.log(
    `    ${String(i + 1).padStart(4)}  ${String(rows[0].total).padStart(7)}ms  ${String(rows[1].handshake).padStart(7)}ms  ${String(rows[1].total).padStart(8)}ms`,
  )
}

/* ---------------- 结论 ---------------- */
const coldMed = median(cold)
const warmMed = median(warmRows.slice(1).map((r) => r.total))
const preMed = median(pre.map((p) => p.post))
const warmupMed = median(pre.map((p) => p.warm))
const handshakeMed = median(cold.map((_, i) => warmRows[i]?.handshake ?? 0).filter(Boolean))
const coldHandshake = median(
  run([...transcribeArgs, '-o', devNull, POST_URL]).map((r) => r.handshake),
)

console.log('\n  ───────────────────────────────────────────────────────')
console.log(`  ① 冷 POST 中位        ${coldMed}ms`)
console.log(`  ② 热 POST 中位        ${warmMed}ms   →  复用连接省 ${coldMed - warmMed}ms`)
console.log(`  ③ 预热后 POST 中位    ${preMed}ms   →  预热省 ${coldMed - preMed}ms（${Math.round(((coldMed - preMed) / coldMed) * 100)}%）`)
console.log('')
console.log(`  其中「握手（DNS+TCP+TLS）」冷连接时约 ${coldHandshake}ms，`)
console.log(`  GET /v1/models 预热自身只要 ${warmupMed}ms，且不消耗转写配额。`)
console.log('')
console.log('  剩下的部分是服务端处理 —— 它只跟「音频多长」和「服务商负载」有关，')
console.log('  客户端改不动。要再快只能换协议（流式）、换服务商、或挪到本地/端上。')
console.log('')
