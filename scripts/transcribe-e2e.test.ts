// @vitest-environment node
/* ============================================================
   云端转写 · 真服务端到端（打真接口，不是 mock）
   ============================================================

   为什么单独一个文件、为什么不放进 `npm test` 的常规路径：
   它**要联网、要密钥、要花钱时间**，属于验收，不属于回归。
   所以它默认**跳过**，只有给了密钥才跑。

   跑法：

     TRANSCRIBE_API_KEY=sk-xxxx npm run transcribe:e2e
     # 想换模型对比就再加：
     TRANSCRIBE_API_KEY=sk-xxxx TRANSCRIBE_MODEL=FunAudioLLM/SenseVoiceSmall npm run transcribe:e2e

   密钥从环境变量读，**不写进任何文件、不进仓库**。
   （家长在 App 里填的那份存在手机自己的 IndexedDB 里，这里够不着，
     所以验收要单独给一次。）

   素材：项目根的 `speech_probe.wav` —— 一段真实人声，
   内容是「我家有一只小猫，它很喜欢在阳台上晒太阳。」

   为什么要写这个文件（而不是留在 `_probe-transcribe.ts`）：
   那个探针要用 `npx tsx` 跑，而 `tsx` **不在依赖里** ——
   意味着「随时能验一下」这件事实际做不到，探针写完就躺在那儿。
   改用项目已有的 vitest 跑，不引入任何新依赖。

   ⚠️ 必须跑在 node 环境（文件第一行的 `@vitest-environment node`），
      不能用项目默认的 jsdom。踩过：jsdom 环境下 `FormData`/`Blob` 是
      jsdom 自己的实现，喂给 Node 的 `fetch` 不会正常序列化，
      结果是**请求挂到超时**（同一份音频、同一个坏密钥，
      curl 只要 0.5 秒就回 401）。看着像"服务不通"，
      其实是测试跑错了环境 —— 这种假红最费时间。

   ⚠️ 注意 `dataUrlToBlob` 是从 `src/platform/audio.ts` **import** 进来的，
      不是抄一份。抄的那份会和线上跑的那份漂移，
      于是「测过了」和「真跑的」不是同一段代码。
   ============================================================ */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { dataUrlToBlob } from '../src/platform/audio'
import {
  defaultTranscribeConfig,
  testTranscribeConnection,
  transcribeWithRetry,
  type TranscribeConfig,
} from '../src/platform/transcribe'

const KEY = (process.env.TRANSCRIBE_API_KEY ?? '').trim()
const MODEL = (process.env.TRANSCRIBE_MODEL ?? '').trim()
const ROOT = resolve(process.cwd())
const FIXTURE = join(ROOT, 'speech_probe.wav')
const EXPECTED = '我家有一只小猫，它很喜欢在阳台上晒太阳。'

function cfg(): TranscribeConfig {
  const base = defaultTranscribeConfig()
  return { ...base, apiKey: KEY, ...(MODEL ? { model: MODEL } : {}) }
}

function fixtureBlob(): Blob {
  return dataUrlToBlob(`data:audio/wav;base64,${readFileSync(FIXTURE).toString('base64')}`)
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)

/* ---------------- 超时：必须显式给，不能吃默认值 ----------------
   vitest 默认 5 秒。而这里每一步都是**真网络请求**：
   一次往返实测就能超过 5 秒，于是**配置完全正确也会红** ——
   这是最糟的假红，会让人去查一个根本没问题的东西。
   所以按「最坏情况」给足：单次请求上限 60 秒 × 次数。
   （不是拍脑袋：`transcribeAudio` 的 DEFAULT_TIMEOUT_MS 就是 60_000。） */
const T_ONE_CALL = 60_000
const T_CONNECT_3 = T_ONE_CALL + 30_000
const T_SPEECH_5 = T_ONE_CALL * 3

describe.skipIf(!KEY)('云端转写 · 真服务端到端', () => {
  it('验收素材在（speech_probe.wav）', () => {
    expect(existsSync(FIXTURE), `缺素材：${FIXTURE}`).toBe(true)
    expect(fixtureBlob().size).toBeGreaterThan(1000)
  })

  it('设置页的「测试连接」连打 3 次都通，且每次都带回耗时', async () => {
    const c = cfg()
    const bad: string[] = []
    const lat: number[] = []
    for (let i = 1; i <= 3; i += 1) {
      const t = await testTranscribeConnection(c)
      console.log(`  #${i} ok=${t.ok} | ${t.message}${t.ms != null ? ` | ${t.ms}ms` : ' | ⚠ 没带耗时'}`)
      if (!t.ok) bad.push(`第 ${i} 次：${t.message}`)
      if (t.ms == null) {
        // 设置页写的是 `${r.message}（${r.ms}ms）`，ms 丢了那个数字就永远空着。
        // 而「200 + 空文本」是这条路线的常态（探测音频是正弦波，不是人话），
        // 所以这不是边角情况 —— 实测第一次跑就 3 次全丢。
        bad.push(`第 ${i} 次：通了但没带耗时 —— 设置页那个「（xxx ms）」会永远空着`)
      } else lat.push(t.ms)
    }
    expect(bad, '测试按钮必须每次都通、且都带回耗时').toEqual([])
    console.log(`  => 3/3 通，平均 ${avg(lat)}ms`)
  }, T_CONNECT_3)

  it('真实人声走完整 transcribeWithRetry，5 次都能转出预期内容', async () => {
    const c = cfg()
    const blob = fixtureBlob()
    console.log(`  模型 ${c.model} · 素材 ${blob.size} B`)

    const fails: string[] = []
    const wrong: string[] = []
    const lat: number[] = []
    let exact = 0

    for (let i = 1; i <= 5; i += 1) {
      const r = await transcribeWithRetry(blob, c, { durationMs: 6000 })
      if (!r.ok) {
        fails.push(`第 ${i} 次 ${r.reason}: ${r.message}`)
        console.log(`  #${i} ❌ ${r.reason}: ${r.message}`)
        continue
      }
      lat.push(r.ms)
      const isExact = r.text === EXPECTED
      if (isExact) exact += 1
      // 判据：关键内容必须认出来。不做全等断言 —— ASR 的标点/语气词会飘，
      // 全等会把「识别对了但多了个逗号」判成失败，那是假红。
      if (!r.text.includes('小猫') || !r.text.includes('阳台')) {
        wrong.push(`第 ${i} 次：${JSON.stringify(r.text)}`)
      }
      console.log(`  #${i} ✅ ${r.ms}ms ${JSON.stringify(r.text)} 全等=${isExact}`)
    }

    console.log(`  => 成功 ${lat.length}/5 · 完全一致 ${exact}/5 · 平均 ${avg(lat)}ms`)
    expect(fails, '不能有失败（挂住/超时是最伤体验的失败方式）').toEqual([])
    expect(wrong, '关键内容「小猫」「阳台」必须都认出来').toEqual([])
  }, T_SPEECH_5)

  it('本地守卫不发网络请求', async () => {
    const c = cfg()
    const blob = fixtureBlob()

    const short = await transcribeWithRetry(blob, c, { durationMs: 200 })
    expect(short.ok).toBe(false)
    expect(short.ok === false && short.reason).toBe('too-short')

    const empty = await transcribeWithRetry(new Blob([], { type: 'audio/wav' }), c, { durationMs: 3000 })
    expect(empty.ok).toBe(false)
    expect(empty.ok === false && empty.reason).toBe('empty')

    const nocfg = await transcribeWithRetry(blob, { baseUrl: '', apiKey: '', model: '' }, { durationMs: 6000 })
    expect(nocfg.ok).toBe(false)
    expect(nocfg.ok === false && nocfg.reason).toBe('not-configured')

    console.log('  => 太短 / 空音频 / 没配置 都在本地拦住了')
  }, T_ONE_CALL)

  it('错误密钥归为 auth，且不重试（要立刻报，不能让孩子干等）', async () => {
    const t0 = Date.now()
    const r = await transcribeWithRetry(fixtureBlob(), { ...cfg(), apiKey: 'sk-invalid-000' }, { durationMs: 6000 })
    const ms = Date.now() - t0
    console.log(`  ${r.ok ? '(竟成功)' : `${r.reason} | ${r.message}`} | ${ms}ms`)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('auth')
    // 一次超时是 60 秒。auth 不重试，所以必须远快于它
    expect(ms, 'auth 不该重试').toBeLessThan(30_000)
  }, T_ONE_CALL)
})

describe.skipIf(KEY)('云端转写 · 端到端（没给密钥，跳过）', () => {
  it('跳过说明', () => {
    console.log(
      '\n  跳过真服务端到端：没有 TRANSCRIBE_API_KEY。\n' +
        '  想跑：TRANSCRIBE_API_KEY=sk-xxxx npm run transcribe:e2e\n' +
        '  （密钥只从环境变量读，不会写进任何文件）\n',
    )
    expect(KEY).toBe('')
  })
})
