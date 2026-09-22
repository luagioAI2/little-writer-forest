// @vitest-environment node
/* ============================================================
   云端转写 · 速度基准（模型横评 + 时长阶梯）
   ============================================================

   回答两个问题：
     ① 「有没有更快的模型」—— 同一段音频，把可选的 ASR 模型都打一遍
     ② 「为什么慢」—— 同一个模型，音频越长耗时怎么涨
        斜率（ms / 音频秒）就是"推理本身有多慢"，
        截距就是"固定开销"（连接 + 上传 + 回包）

   跑法：

     TRANSCRIBE_API_KEY=sk-xxxx npm run transcribe:bench

   ⚠️ 这里用 `transcribeAudio`（单次、不重试）而不是 `transcribeWithRetry` ——
      重试会把耗时算成两倍，量出来的就不是"一次要多久"了。
      代价是偶发抖动会记成失败，所以每个组合跑 2 次取**较快那次**
      （取较快而不是平均：抖动只会让它变慢，不会让它变快，
        所以最小值才是"这条路真实能有多快"）。

   ⚠️ 时长阶梯是用 `speech_probe.wav` 的 data 段**重复拼接**出来的，
      不是合成语音。目的是量"耗时随时长怎么涨"，不是量识别质量。
      所以阶梯那部分不校验文本内容，只看耗时。
   ============================================================ */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { transcribeAudio, type TranscribeConfig } from '../src/platform/transcribe'

const KEY = (process.env.TRANSCRIBE_API_KEY ?? '').trim()
const ROOT = resolve(process.cwd())
const FIXTURE = join(ROOT, 'speech_probe.wav')

/** 全部候选 ASR 模型（从 /v1/models 里筛出来的，CosyVoice 是 TTS 不算） */
const MODELS = [
  'Qwen/Qwen3-ASR-1.7B',
  'XingChenAGI/XingChenASR-V3.2',
  'XingChenAGI/XingChenASR-V3.2-Ultra',
  'XingChenAGI/XingChenASR-Diarize-V3.0',
  'FunAudioLLM/SenseVoiceSmall',
]

/** 阶梯：以基础片段为 1 份，测 1 / 2 / 4 / 6 份 */
const LADDER = [1, 2, 4, 6]

const T_CALL = 60_000

/* ---------------- WAV 工具 ---------------- */

interface Wav {
  buf: Buffer
  /** data 段起始偏移（**不是**固定 44 —— 这个文件的 fmt chunk 是 18 字节，所以是 46） */
  dataOffset: number
  dataBytes: number
  sampleRate: number
  channels: number
}

function readWav(path: string): Wav {
  const buf = readFileSync(path)
  const at = buf.indexOf('data', 12)
  if (at < 0) throw new Error(`不是 WAV（找不到 data chunk）：${path}`)
  return {
    buf,
    dataOffset: at + 8,
    dataBytes: buf.readUInt32LE(at + 4),
    sampleRate: buf.readUInt32LE(24),
    channels: buf.readUInt16LE(22),
  }
}

const secondsOf = (w: Wav, times = 1) => (w.dataBytes * times) / (w.sampleRate * w.channels * 2)

/** 把 data 段重复 times 遍，并修好两个长度字段 */
function repeatWav(w: Wav, times: number): Blob {
  const head = w.buf.subarray(0, w.dataOffset)
  const data = w.buf.subarray(w.dataOffset, w.dataOffset + w.dataBytes)
  const out = Buffer.alloc(w.dataOffset + w.dataBytes * times)
  head.copy(out, 0)
  for (let i = 0; i < times; i += 1) data.copy(out, w.dataOffset + i * w.dataBytes)
  out.writeUInt32LE(out.length - 8, 4) // RIFF size
  out.writeUInt32LE(w.dataBytes * times, w.dataOffset - 4) // data size
  return new Blob([out], { type: 'audio/wav' })
}

/* ---------------- 跑一次，取较快值 ---------------- */

const cfgFor = (model: string): TranscribeConfig => ({
  baseUrl: 'https://api.siliconflow.cn/v1',
  apiKey: KEY,
  model,
})

async function timeOnce(blob: Blob, model: string, durationMs: number, fileName = 'probe.wav') {
  const r = await transcribeAudio(blob, cfgFor(model), { durationMs, fileName })
  return r.ok
    ? { ok: true as const, ms: r.ms, text: r.text }
    : { ok: false as const, reason: r.reason, message: r.message }
}

/** 跑 2 次取较快那次；两次都挂就如实报挂 */
async function fastest(blob: Blob, model: string, durationMs: number, fileName = 'probe.wav') {
  const runs = [
    await timeOnce(blob, model, durationMs, fileName),
    await timeOnce(blob, model, durationMs, fileName),
  ]
  const okRuns = runs.filter((r) => r.ok)
  if (okRuns.length === 0) return { ok: false as const, runs }
  const best = okRuns.reduce((a, b) => (b.ms < a.ms ? b : a))
  return { ok: true as const, ms: best.ms, text: best.text, failures: runs.length - okRuns.length }
}

describe.skipIf(!KEY)('云端转写 · 速度基准', () => {
  it('素材就位', () => {
    expect(existsSync(FIXTURE), `缺素材：${FIXTURE}`).toBe(true)
  })

  it('① 模型横评：同一段人声，谁最快', async () => {
    const w = readWav(FIXTURE)
    const blob = repeatWav(w, 1)
    const dur = Math.round(secondsOf(w) * 1000)
    console.log(`\n  素材 ${secondsOf(w).toFixed(2)}s · ${blob.size} B（${w.sampleRate}Hz ${w.channels}ch）\n`)
    console.log('  模型                                      最快耗时   文本   备注')
    console.log('  ----------------------------------------  --------  -----  --------------')

    const rows: { model: string; ms: number }[] = []
    for (const m of MODELS) {
      const r = await fastest(blob, m, dur)
      if (r.ok) {
        const hit = r.text.includes('小猫') && r.text.includes('阳台')
        rows.push({ model: m, ms: r.ms })
        console.log(
          `  ${m.padEnd(40)}  ${String(`${r.ms}ms`).padStart(8)}  ${hit ? '✅' : '⚠️'}     ${r.failures ? `${r.failures}/2 次失败` : ''}`,
        )
      } else {
        const why = r.runs.map((x) => (x.ok ? '' : x.reason)).join('/')
        console.log(`  ${m.padEnd(40)}  ${'—'.padStart(8)}  ❌     ${why}`)
      }
    }

    rows.sort((a, b) => a.ms - b.ms)
    if (rows.length > 0) {
      console.log(`\n  => 最快：${rows[0].model}  ${rows[0].ms}ms`)
      console.log(`     最慢：${rows[rows.length - 1].model}  ${rows[rows.length - 1].ms}ms`)
      const ratio = rows[rows.length - 1].ms / rows[0].ms
      console.log(`     差距 ${ratio.toFixed(1)}×`)
    }
    expect(rows.length, '至少要有一个模型能跑通').toBeGreaterThan(0)
  }, T_CALL * MODELS.length * 2 + 30_000)

  it('② 时长阶梯：说得越久，慢多少', async () => {
    const w = readWav(FIXTURE)
    const model = MODELS[0]
    console.log(`\n  模型 ${model}\n`)
    console.log('  音频时长   文件大小     耗时     ms/音频秒')
    console.log('  ---------  ----------  --------  ----------')

    const pts: { sec: number; ms: number }[] = []
    for (const times of LADDER) {
      const blob = repeatWav(w, times)
      const sec = secondsOf(w, times)
      const r = await fastest(blob, model, Math.round(sec * 1000))
      if (!r.ok) {
        console.log(`  ${`${sec.toFixed(1)}s`.padStart(9)}  ${`${(blob.size / 1024).toFixed(0)} KB`.padStart(10)}  ${'挂'.padStart(8)}`)
        continue
      }
      pts.push({ sec, ms: r.ms })
      console.log(
        `  ${`${sec.toFixed(1)}s`.padStart(9)}  ${`${(blob.size / 1024).toFixed(0)} KB`.padStart(10)}  ${`${r.ms}ms`.padStart(8)}  ${(r.ms / sec).toFixed(0).padStart(10)}`,
      )
    }

    // 最小二乘拟合：ms = k * 音频秒 + b
    if (pts.length >= 2) {
      const n = pts.length
      const sx = pts.reduce((a, p) => a + p.sec, 0)
      const sy = pts.reduce((a, p) => a + p.ms, 0)
      const sxx = pts.reduce((a, p) => a + p.sec * p.sec, 0)
      const sxy = pts.reduce((a, p) => a + p.sec * p.ms, 0)
      const k = (n * sxy - sx * sy) / (n * sxx - sx * sx)
      const b = (sy - k * sx) / n
      console.log(`\n  => 拟合：耗时 ≈ ${k.toFixed(0)} ms × 音频秒 + ${b.toFixed(0)} ms`)
      console.log(`     斜率 ${k.toFixed(0)} ms/秒 = 推理本身的成本（跟说多久成正比）`)
      console.log(`     截距 ${b.toFixed(0)} ms   = 固定开销（连接 + 上传 + 回包）`)
      console.log(`     说 10 秒 ≈ ${(k * 10 + b).toFixed(0)}ms；说 30 秒 ≈ ${(k * 30 + b).toFixed(0)}ms`)
    }
    expect(pts.length).toBeGreaterThan(1)
  }, T_CALL * LADDER.length * 2 + 30_000)
})

describe.skipIf(!KEY)('云端转写 · 速度基准 · 格式', () => {
  /**
   * ③ 格式对比：**App 真正发出去的是 webm/opus**，基准前面两节用的是 WAV。
   *
   * 这是「我测的」和「用户跑的」之间唯一没对齐的变量，所以必须量。
   * 两种可能的结论，方向完全相反：
   *   · webm 明显更慢 → 服务端要先 ffmpeg 解码 opus，这是**真实存在**的额外开销，
   *     而它在 WAV 上永远量不出来（前面两节的数字都偏乐观）；
   *   · webm 差不多或更快 → 上传体积小 20 倍反而占了便宜，
   *     说明慢跟格式无关，别在这上面花力气。
   *
   * ⚠️ 这里必须**给对文件名**（所以 `fastest` 多了一个 fileName 参数）。
   *    第一版忘了给，webm 的二进制顶着 `probe.wav` 这个名字发出去，
   *    服务端**直接 500**（复现过，见下）—— 于是这一节假红。
   *    实测（curl 打真接口，同一段 webm 内容）：
   *      webm 内容 + 名字 .wav  → **HTTP 500**
   *      webm 内容 + 名字 .webm → 200 ✅
   *      wav  内容 + 名字 .webm → 200 ✅（这种它能自己嗅探出来）
   *    => 服务端**会信扩展名**，至少 `.wav` 是信的：名字说是 WAV 就按 WAV 解，
   *       解不开就 500。所以 App 里 `guessFileName()` 不是"更稳的做法"，
   *       而是**必须对**——名字和内容不一致就会整条路失败。
   */
  const WEBM = join(ROOT, 'speech_probe.webm')

  it('素材就位（webm 由 scripts/mk-speech-fixture.mjs 生成）', () => {
    if (!existsSync(WEBM)) {
      console.log(`\n  跳过格式对比：缺 ${WEBM}\n  先生成：node scripts/mk-speech-fixture.mjs\n`)
    }
    expect(existsSync(FIXTURE)).toBe(true)
  })

  it('③ 格式对比：WAV vs webm/opus（同一段人声、同一个模型）', async () => {
    if (!existsSync(WEBM)) return
    const model = MODELS[0]
    const w = readWav(FIXTURE)
    const dur = Math.round(secondsOf(w) * 1000)

    const cases: { label: string; blob: Blob; name: string }[] = [
      { label: 'WAV 22050Hz（前面两节用的）', blob: repeatWav(w, 1), name: 'probe.wav' },
      { label: 'webm/opus 16kbps（App 真发的）', blob: new Blob([readFileSync(WEBM)], { type: 'audio/webm' }), name: 'audio.webm' },
    ]

    console.log(`\n  模型 ${model} · 素材 ${secondsOf(w).toFixed(2)}s\n`)
    console.log('  格式                                    文件大小    最快耗时   识别')
    console.log('  --------------------------------------  ----------  --------  ----')

    const got: { label: string; ms: number; size: number }[] = []
    for (const c of cases) {
      // 用 fastest（跑 2 次取快）而不是单次：格式差异只有几百毫秒，
      // 一次抖动就能把它淹没，取较快值才能看出真实差别
      const r = await fastest(c.blob, model, dur, c.name)
      if (!r.ok) {
        const why = r.runs.map((x) => (x.ok ? '' : x.reason)).join('/')
        console.log(`  ${c.label.padEnd(40)}  ${`${(c.blob.size / 1024).toFixed(1)} KB`.padStart(10)}  ${'挂'.padStart(8)}  ❌ ${why}`)
        continue
      }
      const hit = r.text.includes('小猫') && r.text.includes('阳台')
      got.push({ label: c.label, ms: r.ms, size: c.blob.size })
      console.log(
        `  ${c.label.padEnd(40)}  ${`${(c.blob.size / 1024).toFixed(1)} KB`.padStart(10)}  ${`${r.ms}ms`.padStart(8)}  ${hit ? '✅' : '⚠️'}`,
      )
    }

    if (got.length === 2) {
      const [wav, webm] = got
      const delta = webm.ms - wav.ms
      console.log(`\n  => webm 比 WAV ${delta >= 0 ? '慢' : '快'} ${Math.abs(delta)}ms`)
      console.log(`     体积 ${(wav.size / 1024).toFixed(1)} KB → ${(webm.size / 1024).toFixed(1)} KB`)
      if (Math.abs(delta) < 300) {
        console.log('     结论：两种格式基本同速 —— 服务端解码 opus 的开销可忽略，')
        console.log('           慢与格式无关，别在编码格式上花力气。')
      } else if (delta > 0) {
        console.log('     结论：webm 确实更慢 —— 服务端要多一步解码，这是真实开销。')
      } else {
        console.log('     结论：webm 反而更快 —— 上传小 20 倍占了便宜。')
      }
    }
    expect(got.length).toBeGreaterThan(0)
  }, T_CALL * 2 * 2 + 30_000)
})

describe.skipIf(KEY)('云端转写 · 速度基准（没给密钥，跳过）', () => {
  it('跳过说明', () => {
    console.log('\n  跳过基准：没有 TRANSCRIBE_API_KEY。')
    console.log('  想跑：TRANSCRIBE_API_KEY=sk-xxxx npm run transcribe:bench\n')
    expect(KEY).toBe('')
  })
})
