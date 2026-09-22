/* ============================================================
   语音转写（云端）—— 回归测试
   ============================================================

   背景：国行机（华为等）上系统 SpeechRecognizer 可能一条结果都不回，
   设备侧的墙代码翻不过去，于是加了"录音 → 上传云端 → 拿回文字"这条路。
   这个文件守的就是这条路。

   最容易写错的几处（都被下面的用例钉住了）：

   1. **Content-Type 不能让调用方自己设。**
      浏览器要在 multipart 后面补 boundary，手写会把 boundary 弄丢，
      服务端只会回一句语焉不详的 400 —— 极难查。
   2. **本地要先拦太短的录音。**
      按住说话误触很常见（手滑点一下），传上去只会拿回一句莫名其妙的
      话，白花一次请求。600ms 以下直接让用户重说。
   3. **错误要翻成人话，而且要能编程判断。**
      401/403 → 密钥问题；429 → 忙；5xx → 服务端问题。
      只给一句"失败了"没法让界面做正确的降级。
   4. **"没听清"不等于配置错误。**
      测试连接发的是正弦波，服务端返回空文本**恰恰说明配置是对的** ——
      鉴权和模型都过了。这条搞反会让家长以为 Key 填错了。
   5. **测试音频不能是静音。**
      实测：纯静音会让服务端**不返回任何响应**，一直挂到超时。
      结果是"配置全对但测试永远报超时"。必须发有波形的音频。
   6. **偶发超时（网络类）要重试，其他错误不重试。**
      云端接口会随机不响应；而密钥错误重试多少次都一样，只会让孩子多等。
   7. **预热连接不能影响正事。**
      按下按钮时顺手把 DNS/TCP/TLS 做掉（实测占冷连接四成多耗时，
      约 160ms），但它是锦上添花 —— 任何失败都不该挡着录音和转写。
   ============================================================ */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_AUDIO_BYTES,
  MIN_AUDIO_MS,
  defaultTranscribeConfig,
  isTranscribeConfigured,
  openAiTranscribeConfig,
  testTranscribeConnection,
  transcribeAudio,
  transcribeWithRetry,
  warmUpTranscribe,
  type TranscribeConfig,
} from './transcribe'

const CFG: TranscribeConfig = {
  baseUrl: 'https://api.siliconflow.cn/v1',
  apiKey: 'sk-test',
  model: 'Qwen/Qwen3-ASR-1.7B',
}

/** 一小段"音频"（内容无所谓，测的是请求形状） */
function audio(size = 1024, type = 'audio/webm;codecs=opus'): Blob {
  return new Blob([new Uint8Array(size)], { type })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('语音转写 · 配置校验', () => {
  it('三项缺一不可', () => {
    expect(isTranscribeConfigured(CFG)).toBe(true)
    expect(isTranscribeConfigured({ ...CFG, apiKey: '' })).toBe(false)
    expect(isTranscribeConfigured({ ...CFG, baseUrl: '  ' })).toBe(false)
    expect(isTranscribeConfigured({ ...CFG, model: '' })).toBe(false)
    expect(isTranscribeConfigured(null)).toBe(false)
    expect(isTranscribeConfigured(undefined)).toBe(false)
  })

  it('没配置就上传的话，给的提示要指向"去哪里配"', async () => {
    const r = await transcribeAudio(audio(), { baseUrl: '', apiKey: '', model: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('not-configured')
      // 不能只说"失败了"，要告诉家长去哪修
      expect(r.message).toContain('家长管理')
    }
  })

  it('默认走火山流式，且密钥已经内置（家长什么都不用填就能用）', () => {
    const d = defaultTranscribeConfig()
    /* 默认从「硅基流动整包上传」换成了「火山流式边说边传」。
       理由是实测：同一段 5.44 秒人声 ——
         硅基流动 整包上传      松手→出字  419ms，说完才出字
         火山 双向流式 duplex   松手→出字 −4371ms，说话时字就上屏了
       不是模型更快，是**把上传和识别都挪出了关键路径**。 */
    expect(d.engine).toBe('volcengine')
    expect(d.resourceId).toBe('volc.seedasr.sauc.duration')
    // 密钥内置是这次改动的重点：装好 App 不用配任何东西
    expect(d.apiKey).toBeTruthy()
    expect(d.apiKey.startsWith('sk-')).toBe(false) // 火山不是 sk- 开头，别照抄硅基那套
  })

  it('流式只需要密钥就算配好了（地址和资源 ID 都内置）', () => {
    expect(isTranscribeConfigured({ engine: 'volcengine', baseUrl: '', apiKey: 'k', model: 'duplex' })).toBe(true)
    // 没密钥就是没配好 —— 不能因为地址是内置的就放行
    expect(isTranscribeConfigured({ engine: 'volcengine', baseUrl: '', apiKey: '', model: 'duplex' })).toBe(false)
  })

  it('整包上传那条路仍然要求地址 + 密钥 + 模型齐全', () => {
    expect(isTranscribeConfigured({ baseUrl: '', apiKey: 'k', model: 'm' })).toBe(false)
    expect(isTranscribeConfigured({ baseUrl: 'u', apiKey: 'k', model: '' })).toBe(false)
    expect(isTranscribeConfigured({ baseUrl: 'u', apiKey: 'k', model: 'm' })).toBe(true)
  })

  it('硅基流动那份预设仍然可用，且指向 Qwen3-ASR（免费那条备选路）', () => {
    const d = openAiTranscribeConfig()
    expect(d.baseUrl).toContain('siliconflow')
    /* ★ 模型是 Qwen3-ASR，**不是** SenseVoice。
       这是实测结论：同一段真实人声、同一个接口，打 8 次 ——
         Qwen/Qwen3-ASR-1.7B        8/8 成功，0.53~0.64 秒
         FunAudioLLM/SenseVoiceSmall **会随机挂住不返回**，25 秒都等不到
       默认给一个会随机吊死的模型，孩子按住说完要干等 20 秒然后失败。
       所以这条断言钉的是"默认必须是那根稳的"，不是审美偏好。 */
    expect(d.model).toBe('Qwen/Qwen3-ASR-1.7B')
    expect(d.model).not.toBe('FunAudioLLM/SenseVoiceSmall')
    expect(d.engine).toBe('openai')
  })

  it('流式那条路不去预热 HTTP 连接（它没有可预热的 HTTP 端点）', () => {
    // 预热是给整包上传那条路省握手的；流式一按下就把 WebSocket 连上了，
    // 在这里发一个不存在的请求纯属浪费
    let called = 0
    vi.stubGlobal('fetch', () => {
      called++
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    warmUpTranscribe({ engine: 'volcengine', baseUrl: '', apiKey: 'k', model: 'duplex' })
    expect(called).toBe(0)
  })
})

describe('语音转写 · 请求形状', () => {
  it('地址、鉴权头、file 与 model 字段都要对', async () => {
    let seenUrl = ''
    let seenInit: RequestInit | undefined
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      seenUrl = url
      seenInit = init
      return Promise.resolve(new Response(JSON.stringify({ text: '小河边的柳树发芽了' }), { status: 200 }))
    })

    const r = await transcribeAudio(audio(), CFG, { durationMs: 2000 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toBe('小河边的柳树发芽了')
      expect(typeof r.ms).toBe('number')
    }

    // 结尾多写斜杠也不该拼出 //audio
    expect(seenUrl).toBe('https://api.siliconflow.cn/v1/audio/transcriptions')

    const headers = seenInit?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test')

    /* ★ 这一条是整组里最重要的。
       手写 Content-Type 会把 multipart 的 boundary 弄丢，
       服务端只回一句语焉不详的 400，查起来极痛苦。
       正确做法是**完全不设**，交给浏览器。 */
    expect(headers['Content-Type']).toBeUndefined()

    const form = seenInit?.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('model')).toBe(CFG.model)
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('baseUrl 末尾多余斜杠不会拼出双斜杠', async () => {
    let seenUrl = ''
    vi.stubGlobal('fetch', (url: string) => {
      seenUrl = url
      return Promise.resolve(new Response(JSON.stringify({ text: '好' }), { status: 200 }))
    })
    await transcribeAudio(audio(), { ...CFG, baseUrl: 'https://api.siliconflow.cn/v1///' }, { durationMs: 2000 })
    expect(seenUrl).toBe('https://api.siliconflow.cn/v1/audio/transcriptions')
  })

  it('文件名要带扩展名（服务端可能靠它判断编码）', async () => {
    let fileName = ''
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      const f = (init.body as FormData).get('file') as File
      fileName = f.name
      return Promise.resolve(new Response(JSON.stringify({ text: '好' }), { status: 200 }))
    })
    await transcribeAudio(audio(512, 'audio/webm'), CFG, { durationMs: 2000 })
    expect(fileName).toMatch(/\.webm$/)
  })
})

describe('语音转写 · 本地防呆（别把注定被拒的东西传上去）', () => {
  it('太短的录音不上传 —— 按住说话误触太常见了', async () => {
    let called = false
    vi.stubGlobal('fetch', () => {
      called = true
      return Promise.resolve(new Response('{}', { status: 200 }))
    })

    const r = await transcribeAudio(audio(), CFG, { durationMs: MIN_AUDIO_MS - 100 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('too-short')
    // ★ 一次请求都不该发出去
    expect(called).toBe(false)
  })

  it('刚好到门槛就该放行（边界别写反）', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ text: '可以了' }), { status: 200 })),
    )
    const r = await transcribeAudio(audio(), CFG, { durationMs: MIN_AUDIO_MS })
    expect(r.ok).toBe(true)
  })

  it('空录音不上传', async () => {
    let called = false
    vi.stubGlobal('fetch', () => {
      called = true
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    const r = await transcribeAudio(new Blob([], { type: 'audio/webm' }), CFG, { durationMs: 3000 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('empty')
    expect(called).toBe(false)
  })

  it('超过体积上限不上传（服务端限 50MB）', async () => {
    let called = false
    vi.stubGlobal('fetch', () => {
      called = true
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    // 不去真分配 50MB，伪造一个大 size 的 blob 壳
    const huge = { size: MAX_AUDIO_BYTES + 1, type: 'audio/webm' } as Blob
    const r = await transcribeAudio(huge, CFG, { durationMs: 3000 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('too-big')
    expect(called).toBe(false)
  })
})

describe('语音转写 · 错误要翻成人话、且能编程判断', () => {
  it('401 / 403 → 指向密钥，让家长知道去哪改', async () => {
    for (const status of [401, 403]) {
      vi.stubGlobal('fetch', () => Promise.resolve(new Response('Invalid token', { status })))
      const r = await transcribeAudio(audio(), CFG, { durationMs: 2000 })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.reason).toBe('auth')
        expect(r.message).toContain('家长管理')
      }
    }
  })

  it('429 → 是"忙"，不是把用户赶去改配置', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('rate limited', { status: 429 })))
    const r = await transcribeAudio(audio(), CFG, { durationMs: 2000 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('quota')
      // 忙是等一会儿的事，不该提"密钥""家长管理"
      expect(r.message).not.toContain('密钥')
    }
  })

  it('5xx → 服务端的问题', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('oops', { status: 503 })))
    const r = await transcribeAudio(audio(), CFG, { durationMs: 2000 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('server')
  })

  it('网络断了 → 提示检查网络，而不是甩英文异常', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    const r = await transcribeAudio(audio(), CFG, { durationMs: 2000 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('network')
      expect(r.message).toContain('网络')
    }
  })

  it('返回了 200 但文本是空的 → 当成"没听清"，让用户再说一遍', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ text: '   ' }), { status: 200 })),
    )
    const r = await transcribeAudio(audio(), CFG, { durationMs: 2000 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('empty')
      expect(r.message).toContain('再说')
    }
  })

  it('返回体不是 JSON 也不会崩（服务端有时回 HTML 错误页）', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('<html>502</html>', { status: 200 })))
    const r = await transcribeAudio(audio(), CFG, { durationMs: 2000 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('empty')
  })
})

describe('语音转写 · 测试连接', () => {
  it('★ 服务端回了空文本 = 配置没问题（最容易搞反的一条）', async () => {
    /* 测试发的是 440Hz 正弦波，不是人话，服务端当然识别不出内容。
       "没听清"说明鉴权和模型名都过了 —— 这恰恰是"配置正确"。
       如果这里判成失败，家长会以为自己 Key 填错了，白折腾。 */
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ text: '' }), { status: 200 })),
    )
    const r = await testTranscribeConnection(CFG)
    expect(r.ok).toBe(true)
    expect(r.message).toContain('成功')
  })

  it('★ 走「空文本」这条路也要带上耗时（设置页要显示这个数字）', async () => {
    /* 上面那条是常态而不是边角：探测音频是正弦波、不是人话，
       所以「200 + 空文本」才是测试按钮**几乎每次**都会走的分支。
       而设置页那行文案是 `${r.message}（${r.ms}ms）` —— ms 丢了，
       括号里的数字就**永远显示不出来**（实测确认过：打真服务 3 次全丢）。
       这条钉住它，别让"成功"分支有 ms、"空文本"分支没有。 */
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ text: '' }), { status: 200 })),
    )
    const r = await testTranscribeConnection(CFG)
    expect(r.ok).toBe(true)
    expect(r.ms, '设置页要显示这个数字，不能丢').toBeTypeOf('number')
    expect(r.ms).toBeGreaterThanOrEqual(0)
  })

  it('密钥错了就该报错', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('Invalid token', { status: 401 })))
    const r = await testTranscribeConnection(CFG)
    expect(r.ok).toBe(false)
  })

  it('配置不全时不去发请求', async () => {
    let called = false
    vi.stubGlobal('fetch', () => {
      called = true
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    const r = await testTranscribeConnection({ baseUrl: '', apiKey: '', model: '' })
    expect(r.ok).toBe(false)
    expect(called).toBe(false)
  })

  /* ★★ 这条是踩坑之后补的，别删。
     最初测试发的是**纯静音**，理由是"静音也能验鉴权"。
     那个假设是错的：实测发现服务端收到纯静音**根本不返回响应**，
     会一直挂到客户端超时。结果就是 —— 配置全对，测试按钮永远报"超时"，
     家长跑去查一个根本没问题的地方。这比没有测试按钮更糟。
     所以测试音频必须**有实际波形**。 */
  it('测试音频必须是有声音的，不能是静音（静音会让服务端挂住）', async () => {
    let blob: Blob | null = null
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => {
      blob = (init.body as FormData).get('file') as unknown as Blob
      return Promise.resolve(new Response(JSON.stringify({ text: '' }), { status: 200 }))
    })
    await testTranscribeConnection(CFG)

    expect(blob).not.toBeNull()
    const buf = await blob!.arrayBuffer()
    const view = new DataView(buf)

    // 合法的 WAV 头
    const ascii = (o: number) => String.fromCharCode(...new Uint8Array(buf.slice(o, o + 4)))
    expect(ascii(0)).toBe('RIFF')
    expect(ascii(8)).toBe('WAVE')

    // ★ 关键：数据区**不能全 0**，必须有真实波形
    const dataBytes = view.getUint32(40, true)
    expect(dataBytes).toBeGreaterThan(0)
    let nonZero = 0
    for (let i = 0; i < dataBytes / 2; i++) {
      if (view.getInt16(44 + i * 2, true) !== 0) nonZero++
    }
    expect(nonZero).toBeGreaterThan(0)
    // 半秒 16kHz 应该有几千个非零采样点，不是个别噪声
    expect(nonZero).toBeGreaterThan(1000)
  })

  it('测试用的文件是 .wav（服务端靠扩展名/头判断格式）', async () => {
    let blobType = ''
    let name = ''
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => {
      const f = (init.body as FormData).get('file') as File
      blobType = f.type
      name = f.name
      return Promise.resolve(new Response(JSON.stringify({ text: '' }), { status: 200 }))
    })
    await testTranscribeConnection(CFG)
    expect(blobType).toBe('audio/wav')
    expect(name).toMatch(/\.wav$/)
  })

  /* 服务端偶发不返回响应（实测真实人声也会随机挂），
     测试按钮必须自己扛过去，否则家长看到的是"超时"然后去改一个没问题的配置 */
  it('偶发超时要自动重试，不能一次抖动就报失败', async () => {
    let calls = 0
    vi.stubGlobal('fetch', () => {
      calls++
      if (calls === 1) {
        // 第一次模拟"服务端不理人"
        const e = new Error('aborted')
        e.name = 'AbortError'
        return Promise.reject(e)
      }
      return Promise.resolve(new Response(JSON.stringify({ text: '' }), { status: 200 }))
    })
    const r = await testTranscribeConnection(CFG)
    expect(calls).toBe(2)
    expect(r.ok).toBe(true)
  })
})

describe('语音转写 · 预热连接（按下按钮时顺手做掉握手）', () => {
  it('会朝 {baseUrl}/models 发一个 GET —— 不是发音频，不消耗转写配额', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(new Response('{"data":[]}', { status: 200 }))
    })

    warmUpTranscribe(CFG)
    await vi.waitFor(() => expect(calls.length).toBe(1))

    expect(calls[0].url).toBe('https://api.siliconflow.cn/v1/models')
    expect(calls[0].init?.method).toBe('GET')
    // 带鉴权头（有些服务商对 /models 也校验），但**不能**带 body
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(calls[0].init?.body).toBeUndefined()
  })

  it('baseUrl 末尾有斜杠也不会拼出 //models', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', (url: string) => {
      urls.push(url)
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    warmUpTranscribe({ ...CFG, baseUrl: 'https://api.siliconflow.cn/v1///' })
    await vi.waitFor(() => expect(urls.length).toBe(1))
    expect(urls[0]).toBe('https://api.siliconflow.cn/v1/models')
  })

  it('★ 预热失败必须静默 —— 不能冒出未处理的 Promise 拒绝', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('网络炸了')))
    // ⚠️ 只断言「不 throw」是不够的：warmUpTranscribe 返回的是 promise，
    //    没有 .catch() 的话它不会同步抛，而是变成**未处理的拒绝** ——
    //    在 Android WebView 里这可能弹错误提示、污染日志。
    //    所以要真的去监听 unhandledRejection。
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    try {
      expect(() => warmUpTranscribe(CFG)).not.toThrow()
      await new Promise((r) => setTimeout(r, 40))
      expect(unhandled, '预热失败不该冒出未处理的拒绝').toHaveLength(0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('没配置就完全不发请求（别在没密钥时打无谓的请求）', () => {
    let calls = 0
    vi.stubGlobal('fetch', () => {
      calls++
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    warmUpTranscribe(undefined)
    warmUpTranscribe(null)
    warmUpTranscribe({ baseUrl: '', apiKey: '', model: '' })
    warmUpTranscribe({ ...CFG, apiKey: '' })
    expect(calls).toBe(0)
  })
})

describe('语音转写 · 偶发超时要重试（实测服务端会随机不响应）', () => {
  const BLOB = new Blob([new Uint8Array(2048)], { type: 'audio/webm' })

  it('网络类失败会重试，第二次成功就算成功', async () => {
    let calls = 0
    vi.stubGlobal('fetch', () => {
      calls++
      if (calls === 1) {
        const e = new Error('aborted')
        e.name = 'AbortError'
        return Promise.reject(e)
      }
      return Promise.resolve(new Response(JSON.stringify({ text: '小猫' }), { status: 200 }))
    })
    const r = await transcribeWithRetry(BLOB, CFG, { durationMs: 3000 })
    expect(calls).toBe(2)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toBe('小猫')
  })

  /* ★ 重试要挑对象。密钥错了重试 3 次 = 让孩子白等 3 个超时，
     而且结果一模一样是失败 —— 纯粹浪费孩子的耐心。 */
  it('密钥错误不重试（重试多少次都一样，只会让孩子多等）', async () => {
    let calls = 0
    vi.stubGlobal('fetch', () => {
      calls++
      return Promise.resolve(new Response('nope', { status: 401 }))
    })
    const r = await transcribeWithRetry(BLOB, CFG, { durationMs: 3000 })
    expect(calls).toBe(1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('auth')
  })

  it('"没听清"（服务端回话了但没内容）不重试', async () => {
    let calls = 0
    vi.stubGlobal('fetch', () => {
      calls++
      return Promise.resolve(new Response(JSON.stringify({ text: '' }), { status: 200 }))
    })
    const r = await transcribeWithRetry(BLOB, CFG, { durationMs: 3000 })
    // 服务端明确回话了，再问一遍也是同样的结果
    expect(calls).toBe(1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('empty')
  })

  it('本地守卫（太短/没配置）不重试，也不发请求', async () => {
    let calls = 0
    vi.stubGlobal('fetch', () => {
      calls++
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    const short = await transcribeWithRetry(BLOB, CFG, { durationMs: 100 })
    const nocfg = await transcribeWithRetry(BLOB, { baseUrl: '', apiKey: '', model: '' }, { durationMs: 3000 })
    expect(calls).toBe(0)
    expect(short.ok).toBe(false)
    expect(nocfg.ok).toBe(false)
    if (!short.ok) expect(short.reason).toBe('too-short')
    if (!nocfg.ok) expect(nocfg.reason).toBe('not-configured')
  })

  it('一直超时就按次数上限收手，不会无限重试', async () => {
    let calls = 0
    vi.stubGlobal('fetch', () => {
      calls++
      const e = new Error('aborted')
      e.name = 'AbortError'
      return Promise.reject(e)
    })
    const r = await transcribeWithRetry(BLOB, CFG, { durationMs: 3000, attempts: 3 })
    expect(calls).toBe(3)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('network')
  })

  /* ★ 第一次等多久，是这条路上最伤体验的一处，所以单独钉住。
     实测：同一段 5.4 秒人声连打 15 次，中位 419ms、最慢 652ms ——
     正常一次只要 0.4 秒。所以"说 5 秒的话却允许服务端沉默 60 秒"
     是最坏情况比最佳情况差 150 倍的唯一原因。 */
  it('★ 说 5 秒的话，第一次挂住最多等 12.5 秒就换下一枪 —— 不是 60 秒', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      // 永不返回，只等被 abort —— 模拟"服务端完全不理人"
      vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
        calls++
        return new Promise((_res, rej) => {
          init.signal?.addEventListener('abort', () => {
            const e = new Error('aborted')
            e.name = 'AbortError'
            rej(e)
          })
        })
      })

      const p = transcribeWithRetry(BLOB, CFG, { durationMs: 5000 })
      await vi.advanceTimersByTimeAsync(0)
      expect(calls, '第一枪应该已经发出去了').toBe(1)

      // 12.5 秒 = 10 秒固定开销 + 5 秒 × 0.5；对 0.4 秒的正常情况已是 30 倍余量
      await vi.advanceTimersByTimeAsync(13_000)
      expect(calls, '第一次超时应该在 12.5 秒内触发，而不是拖到 60 秒').toBe(2)

      // 第二枪也有 12 秒预算，走完就按次数上限收手
      await vi.advanceTimersByTimeAsync(13_000)
      const r = await p
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('network')
      expect(calls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('★ 说得久就多给点时间（长录音不该被自己的超时憋死）', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
        calls++
        return new Promise((_res, rej) => {
          init.signal?.addEventListener('abort', () => {
            const e = new Error('aborted')
            e.name = 'AbortError'
            rej(e)
          })
        })
      })

      // 说 60 秒：预算 10 + 30 = 40 秒。到 30 秒时还不该放弃
      const p = transcribeWithRetry(BLOB, CFG, { durationMs: 60_000 })
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(calls, '说 60 秒的话，30 秒就不等了属于误伤').toBe(1)

      await vi.advanceTimersByTimeAsync(11_000) // 累计 41 秒 > 40 秒预算
      expect(calls).toBe(2)

      await vi.advanceTimersByTimeAsync(13_000)
      await p
    } finally {
      vi.useRealTimers()
    }
  })

  it('重试成功后报的耗时是总耗时（含重试等待），不是最后一次的', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      if (calls === 1) {
        // 第一次慢一点再失败，让"总耗时"和"最后一段耗时"能区分开
        await new Promise((res) => setTimeout(res, 60))
        const e = new Error('aborted')
        e.name = 'AbortError'
        throw e
      }
      return new Response(JSON.stringify({ text: '好' }), { status: 200 })
    })
    const r = await transcribeWithRetry(BLOB, CFG, { durationMs: 3000 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.ms).toBeGreaterThanOrEqual(50)
  })
})
