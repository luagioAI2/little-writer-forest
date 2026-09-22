/* ============================================================
   造一份「和 App 发出去的一模一样」的音频素材
   ============================================================

   为什么需要它：

   基准测试（transcribe-bench.test.ts）用的是 `speech_probe.wav` ——
   22050Hz 未压缩 WAV。但 App 里 `createRecorder()` 录出来的是
   **webm/opus，16 kbps**（见 platform/speech.ts 的 audioBitsPerSecond）。

   两者差别巨大：
     WAV  5.4s → 234 KB
     opus 5.4s →  11 KB      （小 20 倍）

   于是「我测的」和「用户跑的」不是同一条路：
     · 上传体积差 20 倍 —— 如果慢在网络，真实情况反而更快；
     · 但如果服务端要先 ffmpeg 解码 opus 才能识别 —— 真实情况**更慢**，
       而这一项在 WAV 上根本量不出来。

   这个脚本就是把 WAV 喂给真实 Chrome 的 MediaRecorder，
   用**和 App 完全相同的参数**录出一份 webm/opus，
   这样基准测试量的才是用户真正在走的那条路。

   跑法：
     node scripts/mk-speech-fixture.mjs
     node scripts/mk-speech-fixture.mjs --in speech_probe.wav --out speech_probe.webm
   ============================================================ */

import { existsSync } from 'node:fs'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, extname, basename } from 'node:path'

import puppeteer from 'puppeteer-core'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
].filter(Boolean)

const ROOT = resolve(process.cwd())

function fail(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(2)
}

function parseArgs(argv) {
  const opts = { in: join(ROOT, 'speech_probe.wav'), out: '', bps: 16_000 }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--in') opts.in = resolve(argv[++i] ?? '')
    else if (a === '--out') opts.out = resolve(argv[++i] ?? '')
    else if (a === '--bps') opts.bps = Number(argv[++i])
    else if (a === '-h' || a === '--help') {
      console.log('用法: node scripts/mk-speech-fixture.mjs [--in x.wav] [--out y.webm] [--bps 16000]')
      process.exit(0)
    } else fail(`不认识的参数：${a}`)
  }
  if (!opts.out) opts.out = join(ROOT, basename(opts.in, extname(opts.in)) + '.webm')
  return opts
}

const opts = parseArgs(process.argv.slice(2))

if (!existsSync(opts.in)) fail(`找不到输入文件：${opts.in}`)

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chrome) fail('找不到 Chrome。设 CHROME_PATH 环境变量指过去。')

const srcB64 = readFileSync(opts.in).toString('base64')

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    // 无头 Chrome 里 AudioContext 默认是 suspended，不给这个参数会永远不出声
    '--autoplay-policy=no-user-gesture-required',
  ],
})

try {
  const page = await browser.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('  [chrome]', m.text())
  })

  const result = await page.evaluate(
    async (b64, bps) => {
      /* ① 解码 WAV */
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)

      const ctx = new AudioContext()
      if (ctx.state === 'suspended') await ctx.resume()
      const buffer = await ctx.decodeAudioData(bytes.buffer)

      /* ② 用一个「虚拟输出」当麦克风：
            真实录音是 getUserMedia 拿到 MediaStream；
            这里用 createMediaStreamDestination() 拿到同样形状的东西，
            于是 MediaRecorder 走的是**和 App 同一条编码路径**。
            不需要麦克风权限，无头环境里也稳。 */
      const dest = ctx.createMediaStreamDestination()
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(dest)
      // 同时接扬声器会让无头 Chrome 去找音频设备，没必要
      // src.connect(ctx.destination)

      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(
        (m) => MediaRecorder.isTypeSupported?.(m),
      )
      if (!mime) return { error: '这个 Chrome 不支持任何可用的录音编码' }

      const rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: bps })
      const chunks = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      const done = new Promise((r) => {
        rec.onstop = r
      })

      // 和 App 一样按 250ms 切块（见 speech.ts 的 mediaRecorder.start(250)）
      rec.start(250)
      src.start()

      // 播完 + 一点尾巴，保证最后一帧也吐出来
      await new Promise((r) => {
        src.onended = r
      })
      await new Promise((r) => setTimeout(r, 300))
      rec.stop()
      await done

      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
      const buf = await blob.arrayBuffer()
      return {
        mime: rec.mimeType,
        size: blob.size,
        seconds: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        b64: btoa(String.fromCharCode(...new Uint8Array(buf))),
      }
    },
    srcB64,
    opts.bps,
  )

  if (result.error) fail(result.error)

  writeFileSync(opts.out, Buffer.from(result.b64, 'base64'))

  const inSize = readFileSync(opts.in).length
  console.log(`\n  源文件   ${opts.in}`)
  console.log(`           ${result.seconds.toFixed(2)}s · ${result.sampleRate}Hz ${result.channels}ch · ${(inSize / 1024).toFixed(1)} KB`)
  console.log(`\n  产出     ${opts.out}`)
  console.log(`           ${result.mime} · ${(result.size / 1024).toFixed(1)} KB · 码率 ${Math.round((result.size * 8) / result.seconds / 1000)} kbps`)
  console.log(`\n  体积变化 ${(inSize / 1024).toFixed(1)} KB → ${(result.size / 1024).toFixed(1)} KB  （缩小 ${(inSize / result.size).toFixed(1)}×）\n`)
} finally {
  await browser.close()
}
