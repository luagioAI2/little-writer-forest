/* ============================================================
   语音平台层 —— 回归测试
   ------------------------------------------------------------
   这里守的是「写作文页点麦克风直接崩」那条故障线。

   根因回顾：安卓 WebView 里 webkitSpeechRecognition 是"有壳没芯"的 ——
   对象存在，底层没有识别服务，一 start() 就把 WebView 拖崩。
   所以在原生 App 里必须走原生插件（LittleSpeech），
   **一行都不许碰 webkitSpeechRecognition**。

   这个文件就是在钉住这条规矩，顺便把「原生事件 → 界面回调」这条
   接线也测了（接线错了会表现为"点了没反应"，比崩溃更难查）。
   ============================================================ */

import { afterEach, describe, expect, it, vi } from 'vitest'

/** 假的原生识别对象：只要被 new 出来，计数器就会动 */
let webSpeechInstances = 0
/** 最近一次建出来的替身的"打错"入口 —— 测试用它把 onerror 喂进去。
    ⚠️ 写成**闭包**而不是直接存 `this`：存 `this` 会触发 no-this-alias。 */
let fireWebSpeechError: (err: string) => void = () => {}

class FakeWebSpeechRecognition {
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  onresult: unknown = null
  onerror: unknown = null
  onend: unknown = null
  onstart: unknown = null
  constructor() {
    webSpeechInstances += 1
  }
  start() {
    fireWebSpeechError = (err) => {
      const handler = this.onerror as ((e: { error: string }) => void) | null
      handler?.({ error: err })
    }
  }
  stop() {}
  abort() {}
}

type FakeWindow = Window & {
  Capacitor?: Record<string, unknown>
  webkitSpeechRecognition?: unknown
  SpeechRecognition?: unknown
}

/** 原生插件的方法表（Capacitor 靠它决定把方法名转发到原生） */
const PLUGIN_HEADERS = [
  {
    name: 'LittleSpeech',
    methods: [
      { name: 'available', rtype: 'promise' },
      { name: 'start', rtype: 'promise' },
      { name: 'stop', rtype: 'promise' },
      { name: 'cancel', rtype: 'promise' },
      { name: 'addListener', rtype: 'callback' },
      { name: 'removeListener', rtype: 'callback' },
    ],
  },
]

/** 记下原生插件被调了什么、事件回调存在哪 */
interface NativeSpy {
  calls: { method: string; options?: unknown }[]
  listeners: Map<string, (data: unknown) => void>
  available: boolean
}

/**
 * 装一个假的 Capacitor 运行时。
 *
 * ⚠️ 两个坑，都踩过：
 *  1. @capacitor/core 在**首次被 import 时**会往 window.Capacitor 上写
 *     自己的实现（isNativePlatform / nativePromise…），所以注入要等
 *     import 之后再补一次，否则会被它覆盖。
 *  2. 那个 Capacitor 全局对象只创建一次（core 模块被缓存），
 *     所以**不能删掉重建** —— 必须就地改同一个对象，
 *     否则 registerPlugin 拿到的还是老对象。
 */
async function loadSpeech(opts: {
  native: boolean
  withWebSpeech?: boolean
  /** 原生插件是否响应（false = 模拟插件没挂上） */
  pluginResponds?: boolean
}) {
  vi.resetModules()
  webSpeechInstances = 0
  fireWebSpeechError = () => {}

  // @capacitor/core 的插件注册表是模块级的，跨 resetModules 保留，
  // 所以第二轮注册会打一行 "already registered" —— 预期之内，静音掉。
  vi.spyOn(console, 'warn').mockImplementation(() => {})

  const w = window as FakeWindow
  delete w.webkitSpeechRecognition
  delete w.SpeechRecognition
  if (opts.withWebSpeech) w.webkitSpeechRecognition = FakeWebSpeechRecognition

  const mod = await import('./speech')

  const responds = opts.pluginResponds !== false
  const spy: NativeSpy = { calls: [], listeners: new Map(), available: true }
  const cap = (w.Capacitor ?? (w.Capacitor = {})) as Record<string, unknown>

  cap.isNativePlatform = () => opts.native
  cap.PluginHeaders = PLUGIN_HEADERS
  cap.nativePromise = (_name: string, method: string, options: unknown) => {
    spy.calls.push({ method, options })
    if (!responds) {
      return Promise.reject(new Error('"LittleSpeech" plugin is not implemented on android'))
    }
    if (method === 'available') {
      return Promise.resolve({ available: spy.available, permission: 'granted' })
    }
    return Promise.resolve({})
  }
  cap.nativeCallback = (_name: string, _method: string, options: unknown, callback: unknown) => {
    if (!responds) {
      return Promise.reject(new Error('"LittleSpeech" plugin is not implemented on android'))
    }
    const eventName = String((options as { eventName?: string })?.eventName ?? '')
    spy.listeners.set(eventName, callback as (data: unknown) => void)
    return Promise.resolve('callback-1')
  }

  return { speech: mod, spy }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  const w = window as FakeWindow
  delete w.webkitSpeechRecognition
  delete w.SpeechRecognition
})

describe('原生环境（APK）', () => {
  it('绝不使用 webkitSpeechRecognition —— 它是崩溃的元凶', async () => {
    const { speech, spy } = await loadSpeech({ native: true, withWebSpeech: true, pluginResponds: true })

    expect(speech.usesNativeSpeech()).toBe(true)

    const rec = speech.createRecognizer({ onFinal: () => {} })
    rec.start()
    await flush()

    // 关键断言：那个会崩的浏览器对象一次都没被碰过
    expect(webSpeechInstances).toBe(0)
    // 走的是原生插件
    expect(spy.calls.map((c) => c.method)).toContain('start')
  })

  it('原生事件能一路走到界面回调（result → onFinal）', async () => {
    const { speech, spy } = await loadSpeech({ native: true, pluginResponds: true })

    const finals: string[] = []
    const interims: string[] = []
    const rec = speech.createRecognizer({
      onFinal: (t) => finals.push(t),
      onInterim: (t) => interims.push(t),
    })
    rec.start()
    await flush()

    spy.listeners.get('partial')?.({ text: '春天来' })
    spy.listeners.get('result')?.({ text: '春天来了', isFinal: true })

    expect(interims).toContain('春天来')
    expect(finals).toEqual(['春天来了'])
  })

  it('插件不可用时：probe 返回 false，start 只报错、不抛异常', async () => {
    const { speech } = await loadSpeech({ native: true, pluginResponds: false })

    await expect(speech.probeSpeechSupport()).resolves.toBe(false)

    const errors: string[] = []
    const rec = speech.createRecognizer({
      onFinal: () => {},
      onError: (m) => errors.push(m),
    })

    // 这一句不能抛 —— 抛出去就是"点一下麦克风页面就崩"
    expect(() => rec.start()).not.toThrow()
    await flush()

    expect(errors.length).toBe(1)
    expect(errors[0]).toContain('键盘输入')
    expect(rec.isListening()).toBe(false)
    expect(webSpeechInstances).toBe(0)
  })

  it('插件说设备没有识别服务时，probe 老实返回 false', async () => {
    const { speech, spy } = await loadSpeech({ native: true, pluginResponds: true })
    spy.available = false

    await expect(speech.probeSpeechSupport()).resolves.toBe(false)
  })

  /* ------------------------------------------------------------------
     启动窗口内的竞态 —— "录音能录、文字不显示"的最后一个病根。

     start() 内部要依次 await 三件跨进程的事：
       available() → addListener() → plugin.start()
     全部加起来几十到几百毫秒。而 recorder 拿麦克风更慢，
     所以**用户完全可能在识别器就绪之前就按了停止**。

     以前的代码在这串 await **之后**才登记 currentNativeSession，
     于是这段时间里到达的事件全被 dispatchNative 的
     `if (!session) return` 丢掉 —— 包括那条致命的 "end"，
     它会让界面把 recRef 置空、然后去读一个还没写过的 transcript。
     ------------------------------------------------------------------ */

  it('会话在第一个 await 之前就登记好 —— 早到的事件不许因为"还没登记"被丢掉', async () => {
    /* 这一条测的是**模块级会话登记的顺序**，所以必须走真实的派发路径
       （dispatchNative 会读 currentNativeSession），
       不能像其他用例那样直接调 spy.listeners 里存的回调 ——
       那等于绕过了被测的那一层，改坏了也测不出来。

       手法：把 available() 卡住，让 start() 停在第一个 await 上，
       此时**监听器已经挂好**（第一轮 start 已经 wire 过，
       ensureNativeWired 是模块级只跑一次的），但会话还没登记。
       这时派一个 result 进来 ——
         · 修好了：会话已登记 → onFinal 收到
         · 改回去：会话还是 null → 被 `if (!session) return` 丢掉
       两者结果不同，这条测试才有意义。 */
    const { speech, spy } = await loadSpeech({ native: true, pluginResponds: true })

    const finals: string[] = []
    const rec1 = speech.createRecognizer({ onFinal: (t) => finals.push(t) })
    rec1.start()
    await flush() // 第一轮：把监听器挂上（nativeWired = true）
    rec1.abort()

    // 第二轮：available() 卡住
    let releaseAvailable: (v: unknown) => void = () => {}
    const stuck = new Promise((resolve) => {
      releaseAvailable = resolve
    })
    const cap = (window as FakeWindow).Capacitor as Record<string, unknown>
    const origNativePromise = cap.nativePromise as (n: string, m: string, o: unknown) => unknown
    cap.nativePromise = (n: string, m: string, o: unknown) =>
      m === 'available' ? stuck : origNativePromise(n, m, o)

    const rec2 = speech.createRecognizer({ onFinal: (t) => finals.push(t) })
    rec2.start() // 停在第一个 await（available 没结算）

    // 走真实派发路径：spy.listeners 里存的是 speech.ts 挂的那个回调
    spy.listeners.get('result')?.({ text: '启动还没完成就到的第一句', isFinal: true })

    expect(finals).toEqual(['启动还没完成就到的第一句'])

    releaseAvailable({ available: true, permission: 'granted' })
    await flush()
  })

  it('识别器还没建出来就按停：停止指令要等在途的启动完成再发出去', async () => {
    const { speech, spy } = await loadSpeech({ native: true, pluginResponds: true })

    const rec = speech.createRecognizer({ onFinal: () => {} })
    rec.start()
    // 不 flush —— 模拟用户手快，在 ready 之前就按了停止
    rec.stop()

    await flush()

    /* 以前 stop() 立刻调插件，而原生那边 recognizer 还是 null，
       stopListening() 被静默跳过 → 一个字都没听。
       现在改成等 ready 之后再转发，所以顺序必须是 start 在前、stop 在后。 */
    const methods = spy.calls.map((c) => c.method)
    expect(methods).toContain('start')
    expect(methods).toContain('stop')
    expect(methods.indexOf('start')).toBeLessThan(methods.indexOf('stop'))
  })

  it('启动窗口内按停，之后到达的最后一句仍然要收下', async () => {
    const { speech, spy } = await loadSpeech({ native: true, pluginResponds: true })

    const finals: string[] = []
    const rec = speech.createRecognizer({ onFinal: (t) => finals.push(t) })
    rec.start()
    rec.stop() // 还没 ready 就按停

    await flush()

    // 系统把最后半句吐回来 —— 这是孩子真正说的内容，不能丢
    spy.listeners.get('result')?.({ text: '我在河边捡到一块圆石头', isFinal: true })

    expect(finals).toEqual(['我在河边捡到一块圆石头'])
  })

  /* ------------------------------------------------------------------
     真机时序：孩子说完 → 按停 → 系统才把最后一句吐出来。

     系统 SpeechRecognizer 的 onResults **不是在 stopListening() 时同步
     回来的**，它要等识别服务把音频处理完（几十到几百毫秒）。
     App 里按停之后等 1.6s 才把这个会话交出去，就是为了兜住这段延迟。
     ------------------------------------------------------------------ */

  it('按停之后姗姗来迟的那一句，仍然要写进正文', async () => {
    const { speech, spy } = await loadSpeech({ native: true, pluginResponds: true })

    const finals: string[] = []
    const rec = speech.createRecognizer({ onFinal: (t) => finals.push(t) })
    rec.start()
    await flush()

    // 孩子按了停止 —— 界面上"正在听"的圈已经灭了
    rec.stop()

    // 系统这才把最后半句吐出来
    spy.listeners.get('result')?.({ text: '小河边的柳树发芽了', isFinal: true })

    expect(finals).toEqual(['小河边的柳树发芽了'])
  })

  it('按停那一刻的中间结果，不能把已经定稿的句子再吐一遍', async () => {
    const { speech, spy } = await loadSpeech({ native: true, pluginResponds: true })

    const finals: string[] = []
    const rec = speech.createRecognizer({ onFinal: (t) => finals.push(t) })
    rec.start()
    await flush()

    spy.listeners.get('result')?.({ text: '第一句', isFinal: true })
    rec.stop()
    // 系统在收尾阶段可能再补一条 partial（没有新内容）
    spy.listeners.get('partial')?.({ text: '第一句' })
    spy.listeners.get('result')?.({ text: '第二句', isFinal: true })

    expect(finals).toEqual(['第一句', '第二句'])
  })

  it('abort（用户放弃）之后，迟到的结果不许再写进来', async () => {
    const { speech, spy } = await loadSpeech({ native: true, pluginResponds: true })

    const finals: string[] = []
    const rec = speech.createRecognizer({ onFinal: (t) => finals.push(t) })
    rec.start()
    await flush()

    rec.abort()
    spy.listeners.get('result')?.({ text: '这句不该出现', isFinal: true })

    expect(finals).toEqual([])
  })

  /* ------------------------------------------------------------------
     超时契约：按停之后，这个会话还能吃多久的迟到结果？

     界面上的「背诵」流程会在这段时间之后去读它攒下的文本。
     如果界面等的时间比这里短，**最后一句就会丢** ——
     表现是"录音明明录上了，文字却是空的/少一句"。
     ------------------------------------------------------------------ */

  it('按停之后至少还能吃 1.5 秒内到达的结果（界面依赖这个窗口）', async () => {
    vi.useFakeTimers()
    try {
      const { speech, spy } = await loadSpeech({ native: true, pluginResponds: true })

      const finals: string[] = []
      const rec = speech.createRecognizer({ onFinal: (t) => finals.push(t) })
      rec.start()
      await vi.advanceTimersByTimeAsync(0)

      rec.stop()

      // 系统在按停 1.4 秒之后才把最后一句吐出来
      await vi.advanceTimersByTimeAsync(1400)
      spy.listeners.get('result')?.({ text: '最后一句', isFinal: true })

      expect(finals).toEqual(['最后一句'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('交还会话之后（>1.6 秒）不再接收结果，免得写进下一轮', async () => {
    vi.useFakeTimers()
    try {
      const { speech, spy } = await loadSpeech({ native: true, pluginResponds: true })

      const finals: string[] = []
      const rec = speech.createRecognizer({ onFinal: (t) => finals.push(t) })
      rec.start()
      await vi.advanceTimersByTimeAsync(0)

      rec.stop()
      await vi.advanceTimersByTimeAsync(2000) // 过了 grace 期

      spy.listeners.get('result')?.({ text: '迟到太久', isFinal: true })

      expect(finals).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  /* ------------------------------------------------------------------
     settled()：界面按停后"该等到什么时候"的公开约定。

     背诵流程靠它决定何时去读攒下的文本。它必须做到两件事：
       · 有最终结果就**提前**返回（不要让用户白等）；
       · 一直没结果也要在 grace 窗口后返回（不能永远挂着）。
     ------------------------------------------------------------------ */

  it('settled()：最后一句到了就提前返回，不用干等满窗口', async () => {
    vi.useFakeTimers()
    try {
      const { speech, spy } = await loadSpeech({ native: true, pluginResponds: true })

      const rec = speech.createRecognizer({ onFinal: () => {} })
      rec.start()
      await vi.advanceTimersByTimeAsync(0)

      rec.stop()

      let settled = false
      const p = rec.settled().then(() => {
        settled = true
      })

      // 结果很快回来
      await vi.advanceTimersByTimeAsync(200)
      spy.listeners.get('result')?.({ text: '最后一句', isFinal: true })
      await vi.advanceTimersByTimeAsync(0)

      expect(settled).toBe(true)
      await p
    } finally {
      vi.useRealTimers()
    }
  })

  it('settled()：一句都没听清也要返回，不能永远挂着', async () => {
    vi.useFakeTimers()
    try {
      const { speech } = await loadSpeech({ native: true, pluginResponds: true })

      const rec = speech.createRecognizer({ onFinal: () => {} })
      rec.start()
      await vi.advanceTimersByTimeAsync(0)

      rec.stop()

      let settled = false
      const p = rec.settled().then(() => {
        settled = true
      })

      // 什么都没来 —— 等满窗口后必须自己放行
      await vi.advanceTimersByTimeAsync(2000)
      expect(settled).toBe(true)
      await p
    } finally {
      vi.useRealTimers()
    }
  })

  it('settled()：没按停就调用，立刻返回（不阻塞开始说话）', async () => {
    const { speech } = await loadSpeech({ native: true, pluginResponds: true })
    const rec = speech.createRecognizer({ onFinal: () => {} })
    await expect(rec.settled()).resolves.toBeUndefined()
  })
})

describe('浏览器环境', () => {
  it('有 SpeechRecognition 时就走浏览器那条路', async () => {
    const { speech } = await loadSpeech({ native: false, withWebSpeech: true })

    expect(speech.usesNativeSpeech()).toBe(false)
    expect(speech.isSpeechRecognitionSupported()).toBe(true)

    const rec = speech.createRecognizer({ onFinal: () => {} })
    rec.start()

    expect(webSpeechInstances).toBe(1)
    rec.abort()
  })

  it('没有 SpeechRecognition 时：能力检测为 false，start 给出人话提示', async () => {
    const { speech } = await loadSpeech({ native: false })

    expect(speech.isSpeechRecognitionSupported()).toBe(false)
    await expect(speech.probeSpeechSupport()).resolves.toBe(false)

    const errors: string[] = []
    speech.createRecognizer({ onFinal: () => {}, onError: (m) => errors.push(m) }).start()

    expect(errors.length).toBe(1)
    expect(errors[0]).toContain('不支持语音识别')
  })

  /* ★ 下面两条守的是 onerror 那个映射表（2026-10-03 改过 network 那条文案）。
     它们是**故意不报错**的那一类故障：文案说错了照样跑，只是把家长引偏。 */

  it('报 network 时不许甩锅给"你的网络不好"', async () => {
    const { speech } = await loadSpeech({ native: false, withWebSpeech: true })

    const errors: string[] = []
    speech.createRecognizer({ onFinal: () => {}, onError: (m) => errors.push(m) }).start()

    fireWebSpeechError('network')

    expect(errors.length).toBe(1)
    /* 国内网络下 Chrome 自带的识别连不上 Google，报的就是 `network`。
       只说"请检查网络"会让家长去查路由器 —— 必须把"服务用不了"这层说出来。 */
    expect(errors[0]).toContain('浏览器自带的识别服务')
    expect(errors[0]).toContain('断网')
  })

  it('no-speech / aborted 是常态：一个字都不报，不打扰孩子', async () => {
    const { speech } = await loadSpeech({ native: false, withWebSpeech: true })

    const errors: string[] = []
    speech.createRecognizer({ onFinal: () => {}, onError: (m) => errors.push(m) }).start()

    fireWebSpeechError('no-speech')
    fireWebSpeechError('aborted')

    expect(errors).toEqual([])
  })
})
