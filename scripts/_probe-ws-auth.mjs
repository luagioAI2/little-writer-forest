/* ============================================================
   探针：浏览器到底能不能连火山流式接口？
   ============================================================

   背景 —— 这是决定整个方案形态的问题，必须先问清楚：

     **浏览器的 WebSocket API 不能自定义请求头。**
     `new WebSocket(url, protocols)` 没有 headers 参数，这是标准限制，
     不是实现缺陷。而火山 v3 的鉴权恰恰在 `X-Api-Key` 这类头上。

   所以能走的只有三条路，挨个试：
     ① 把凭据塞进查询串          —— 服务端认不认？
     ② 用子协议 Sec-WebSocket-Protocol 传 —— 服务端会不会回显？
     ③ 都不行 → 只能写原生插件（OkHttp 能带头）或自建代理。

   跑法：VOLC_API_KEY=xxx node scripts/_probe-ws-auth.mjs
   ============================================================ */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const require = createRequire(resolve(fileURLToPath(import.meta.url), '../../package.json'))
const WebSocket = require('ws')

const KEY = process.env.VOLC_API_KEY?.trim()
if (!KEY) {
  console.error('\n✖ 需要密钥：VOLC_API_KEY=xxx node scripts/_probe-ws-auth.mjs\n')
  process.exit(1)
}
const RES = process.env.VOLC_RESOURCE_ID?.trim() || 'volc.seedasr.sauc.duration'
const BASE = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel'

const variants = [
  ['① 查询串 · api_key/resource_id', `${BASE}?api_key=${KEY}&resource_id=${RES}`, null],
  ['① 查询串 · 头名原样 X-Api-Key', `${BASE}?X-Api-Key=${KEY}&X-Api-Resource-Id=${RES}`, null],
  ['① 查询串 · apiKey/resourceId', `${BASE}?apiKey=${KEY}&resourceId=${RES}`, null],
  ['① 查询串 · api_key 只带 key', `${BASE}?api_key=${KEY}`, null],
  ['② 子协议传 key', BASE, [KEY]],
]

function probe(label, url, protocols) {
  return new Promise((done) => {
    let ws
    const finish = (msg) => {
      clearTimeout(timer)
      try {
        ws?.terminate()
      } catch {
        /* 已经断了 */
      }
      done(`${label}  →  ${msg}`)
    }
    const timer = setTimeout(() => finish('超时（无响应）'), 9000)

    try {
      ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url)
    } catch (err) {
      clearTimeout(timer)
      done(`${label}  →  ✖ 构造就失败：${err.message}`)
      return
    }

    ws.on('open', () => finish('✅ 握手成功'))
    ws.on('error', (e) => finish(`✖ ${e?.message ?? String(e)}`))
    ws.on('unexpected-response', (_req, res) => {
      const body = []
      res.on('data', (c) => body.push(c))
      res.on('end', () => finish(`✖ HTTP ${res.statusCode}  ${Buffer.concat(body).toString().slice(0, 120)}`))
    })
  })
}

console.log('')
console.log('  问题：浏览器（WebSocket API 不能设请求头）能连上火山流式接口吗？')
console.log('')
for (const [label, url, protocols] of variants) {
  console.log(`  ${await probe(label, url, protocols)}`)
}
console.log('')
console.log('  对照：走请求头是能连上的（scripts/_probe-volcengine-stream.mjs 已实测）。')
console.log('')
