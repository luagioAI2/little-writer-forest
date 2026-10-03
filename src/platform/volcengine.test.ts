/* ============================================================
   火山流式协议 —— 单测
   ============================================================

   为什么这些必须钉住：这条链路**在电脑上跑不起来**（浏览器设不了
   WebSocket 请求头，socket 只能走原生插件）。也就是说，
   真机上如果帧拼错了一个字节，我这边**看不到任何报错** ——
   表现只是"连上了、也发了、就是没结果"，和网络问题的症状一模一样。

   所以把「协议」和「socket」拆开（volcengine.ts 不碰 socket），
   然后用这里的断言把帧格式钉死。格式一旦对不上，这里先红。
   ============================================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VOLC_ENDPOINTS,
  buildFrame,
  dropWarmVolcStream,
  extractText,
  isFinalFrame,
  openVolcStream,
  parseFrame,
  resolveEndpoint,
  warmVolcStream,
  type VolcStreamResult,
} from './volcengine'
import { createPcmCapture, downsampleTo, floatToInt16Bytes } from './pcm-capture'
import { connectWs, type WsHandlers } from './ws-transport'

/* 把诊断日志静音：跑起会话之后 voiceDiag 会往 console 打一堆，
   把测试输出冲得没法看。协议行为不受影响。 */
vi.mock('./voice-log', () => ({
  voiceDiag: () => {},
  clip: (t: string) => t,
}))

/* 假传输 —— 这条链路在电脑上连不了真服务，只能把 socket 换掉。
   ⚠️ 关键是复刻**原生的真实时序**：插件是在 onOpen 回调里才
   resolve connect 的，而 `open` 事件是紧接着另外发的一条消息。
   两条消息到 JS 侧的先后顺序没有保证 —— 所以「连接已算成功、
   opened 还是 false」这一段是真实存在的，不是臆想的边界。 */
vi.mock('./ws-transport', () => ({ connectWs: vi.fn() }))

const FLAG_NONE = 0b0000
const FLAG_LAST = 0b0010

/* 预热槽（warmSlot）是**模块级状态** —— 每个用例前后都清干净，免得互相串。
   （漏了它会出现"单独跑绿、一起跑红"那种最难查的假红。） */
beforeEach(() => {
  dropWarmVolcStream()
})
afterEach(() => {
  dropWarmVolcStream()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('帧格式（大端，和服务端约定死了）', () => {
  it('full client request：0x11 / 0x10 / 0x10 / 0x00 + 长度 + JSON', () => {
    const payload = new TextEncoder().encode('{"a":1}')
    const frame = buildFrame({ messageType: 1, serialization: 1, payload })

    // header[0]=版本1<<4|头长1、header[1]=消息类型<<4|标志、
    // header[2]=序列化<<4|压缩、header[3]=保留
    expect(Array.from(frame.subarray(0, 4))).toEqual([0x11, 0x10, 0x10, 0x00])
    const view = new DataView(frame.buffer)
    expect(view.getUint32(4)).toBe(payload.length) // 长度是**大端**
    expect(new TextDecoder().decode(frame.subarray(8))).toBe('{"a":1}')
  })

  it('audio only：0x20；最后一包是 0x22（0b0010 就是结束信号）', () => {
    const audio = new Uint8Array([1, 2, 3, 4])

    const normal = buildFrame({ messageType: 2, flags: FLAG_NONE, payload: audio })
    expect(normal[1]).toBe(0x20)

    const last = buildFrame({ messageType: 2, flags: FLAG_LAST, payload: audio })
    expect(last[1]).toBe(0x22)
  })

  it('没有序号标志时**不能**多插 4 个字节', () => {
    // 无条件插序号会让整体错位，服务端读到错位的长度字段，
    // 报的错完全指不到这里 —— 所以这里把长度位置钉死
    const audio = new Uint8Array([9, 9])
    const frame = buildFrame({ messageType: 2, payload: audio })
    expect(new DataView(frame.buffer).getUint32(4)).toBe(2)
    expect(frame.length).toBe(4 + 4 + 2)
  })

  it('带序号时才插 4 个字节，且能原样读回来', () => {
    const audio = new Uint8Array([7])
    const frame = buildFrame({ messageType: 2, flags: 0b0001, sequence: 42, payload: audio })
    expect(frame.length).toBe(4 + 4 + 4 + 1)

    const parsed = parseFrame(frame)
    expect(parsed?.sequence).toBe(42)
    expect(Array.from(parsed?.payload ?? [])).toEqual([7])
  })

  it('自己拼的帧自己能读回来（往返）', () => {
    const payload = new Uint8Array([0, 255, 128, 1])
    const frame = buildFrame({ messageType: 2, flags: FLAG_LAST, payload })
    const parsed = parseFrame(frame)
    expect(parsed?.messageType).toBe(2)
    expect(parsed?.flags).toBe(FLAG_LAST)
    expect(Array.from(parsed?.payload ?? [])).toEqual([0, 255, 128, 1])
  })
})

describe('error 帧的布局和普通帧不一样', () => {
  it('要按「错误码 + 长度 + 文本」解析，不能当成普通 payload', () => {
    // 服务端拒绝格式时下发：header | 错误码(4B) | 长度(4B) | 错误文本
    const text = new TextEncoder().encode('unsupported format webm')
    const buf = new Uint8Array(4 + 4 + 4 + text.length)
    const view = new DataView(buf.buffer)
    buf[0] = 0x11
    buf[1] = 0xf0 // messageType 15 = error
    buf[2] = 0x10
    view.setUint32(4, 45000151)
    view.setUint32(8, text.length)
    buf.set(text, 12)

    const parsed = parseFrame(buf)
    expect(parsed?.messageType).toBe(15)
    expect(parsed?.errorCode).toBe(45000151)
    expect(parsed?.errorText).toBe('unsupported format webm')
  })

  it('太短的帧返回 null，不抛异常', () => {
    expect(parseFrame(new Uint8Array([0x11]))).toBeNull()
  })
})

describe('取文本：文档和线上不一致，两种都要认', () => {
  it('线上真实报文（没有 payload_msg 这层信封）', () => {
    // 这是实测抓到的真实结构。只按文档写会永远拿到空字符串。
    expect(extractText({ audio_info: { duration: 5436 }, result: { text: '我家有一只小猫。' } })).toBe(
      '我家有一只小猫。',
    )
  })

  it('官方示例里的 payload_msg 信封', () => {
    expect(extractText({ payload_msg: { result: { text: '您好' } } })).toBe('您好')
  })

  it('result 是数组时取第一项', () => {
    expect(extractText({ result: [{ text: '第一句' }] })).toBe('第一句')
  })

  it('空文本 / 缺字段都返回空串，不抛', () => {
    expect(extractText({ result: { text: '' } })).toBe('')
    expect(extractText({})).toBe('')
    expect(extractText(null)).toBe('')
  })
})

describe('终稿判定', () => {
  const frameOf = (flags: number) => ({
    messageType: 9,
    flags,
    sequence: null,
    payload: new Uint8Array(0),
  })

  it('标志位带 0b0010 就是终稿（单向流式只有这个信号）', () => {
    expect(isFinalFrame(frameOf(FLAG_LAST), null)).toBe(true)
    expect(isFinalFrame(frameOf(0b0011), null)).toBe(true)
  })

  it('中间包不是终稿', () => {
    expect(isFinalFrame(frameOf(0b0001), null)).toBe(false)
  })

  it('显式 is_last_package 也算', () => {
    expect(isFinalFrame(frameOf(0b0001), { is_last_package: true })).toBe(true)
  })
})

describe('端点选择', () => {
  it('三个端点都有地址，且都是 wss', () => {
    for (const key of Object.keys(VOLC_ENDPOINTS) as (keyof typeof VOLC_ENDPOINTS)[]) {
      expect(VOLC_ENDPOINTS[key].url.startsWith('wss://')).toBe(true)
    }
  })

  it('认不出来就回落到 duplex（唯一真正省时间的那个）', () => {
    expect(resolveEndpoint('bigmodel')).toBe('duplex')
    expect(resolveEndpoint(undefined)).toBe('duplex')
    expect(resolveEndpoint('nostream')).toBe('nostream')
    expect(resolveEndpoint('async')).toBe('async')
  })
})

describe('PCM 编码', () => {
  it('降采样按比例缩样本数（48k → 16k 正好三分之一）', () => {
    const input = new Float32Array(4800)
    expect(downsampleTo(input, 48000, 16000).length).toBe(1600)
  })

  it('采样率相同就原样返回，不做无谓的插值', () => {
    const input = new Float32Array([1, 2, 3])
    expect(downsampleTo(input, 16000, 16000)).toBe(input)
  })

  it('16-bit 转换不溢出：+1 是 32767、−1 是 −32768', () => {
    // 都用 32768 会让 +1.0 溢出成负数，听感上是刺耳的爆音
    const bytes = floatToInt16Bytes(new Float32Array([1, -1, 0]))
    const view = new DataView(bytes.buffer)
    expect(view.getInt16(0, true)).toBe(32767)
    expect(view.getInt16(2, true)).toBe(-32768)
    expect(view.getInt16(4, true)).toBe(0)
  })

  it('超出范围的值会被夹住，而不是回绕', () => {
    const bytes = floatToInt16Bytes(new Float32Array([2, -2]))
    const view = new DataView(bytes.buffer)
    expect(view.getInt16(0, true)).toBe(32767)
    expect(view.getInt16(2, true)).toBe(-32768)
  })

  it('小端字节序 —— 服务端按小端读，写反了就是一片噪声', () => {
    const bytes = floatToInt16Bytes(new Float32Array([1]))
    expect(Array.from(bytes)).toEqual([0xff, 0x7f])
  })
})

/* ============================================================
   会话时序 —— 两个只在真机上才会暴露的 bug
   ============================================================

   这两个都属于"不报错、只是结果不对"那一类，在电脑上永远看不到，
   所以必须用桩把时序摆出来钉住。
   ============================================================ */

interface FakeSocket {
  sent: Uint8Array[]
  /** 手动触发 open 事件 —— 用来复刻"connect 已 resolve、open 还没到" */
  fireOpen: () => void
}

/**
 * @param openInsideConnect true = 复刻**最坏时序**：onOpen 比 transport 赋值更早到。
 *   这不是臆想的边界 —— 插件里是先 `c.resolve()` 再 `emit("open")`，
 *   两条各自独立的桥消息，先后没有保证。
 */
function fakeConnect(opts: { openInsideConnect?: boolean } = {}): FakeSocket {
  const sent: Uint8Array[] = []
  let handlers: WsHandlers | null = null

  vi.mocked(connectWs).mockImplementation(async (_url, _headers, h) => {
    handlers = h
    if (opts.openInsideConnect) h.onOpen()
    return { send: (b) => sent.push(b), close: () => {} }
  })

  return {
    sent,
    fireOpen: () => handlers?.onOpen(),
  }
}

/** 数一数发出去几包「结束信号」 */
function lastPackets(sent: Uint8Array[]): number {
  return sent.filter((f) => ((parseFrame(f)?.flags ?? 0) & FLAG_LAST) !== 0).length
}

describe('open 早于 transport 赋值：配置帧不能丢', () => {
  it('onOpen 抢跑时，配置帧要先攒住、等 transport 到位再补发', async () => {
    const sock = fakeConnect({ openInsideConnect: true })
    await openVolcStream({ apiKey: 'k' }, {})

    // 配置帧里写着音频格式（pcm / 16k / 单声道）。丢了它，
    // 服务端不知道我们发的是什么 —— 而报错完全指不到这里。
    expect(sock.sent).toHaveLength(1)
    const cfg = parseFrame(sock.sent[0])
    expect(cfg?.messageType).toBe(1)
    const body = JSON.parse(new TextDecoder().decode(cfg?.payload))
    expect(body.audio).toMatchObject({ format: 'pcm', rate: 16000, bits: 16, channel: 1 })
  })
})

describe('松手早于 open 事件（真实存在的窄窗口）', () => {
  it('open 之前 finish()：攒下的音频和最后一包都要在 onOpen 之后补发', async () => {
    const sock = fakeConnect()
    const stream = await openVolcStream({ apiKey: 'k' }, {})

    stream.pushAudio(new Uint8Array([1, 2, 3, 4]))
    void stream.finish()

    // 还没 open，一帧都发不出去 —— 但意图要记住
    expect(sock.sent).toHaveLength(0)

    sock.fireOpen()

    // ① 配置帧 ② 攒下的音频 ③ 最后一包
    expect(sock.sent).toHaveLength(3)
    expect(parseFrame(sock.sent[0])?.messageType).toBe(1)
    expect(parseFrame(sock.sent[1])?.payload).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(parseFrame(sock.sent[2])?.messageType).toBe(2)
    expect(lastPackets(sock.sent)).toBe(1)

    stream.cancel()
  })

  it('正常时序（先 open 再松手）：音频立刻走，结束信号只发一包', async () => {
    const sock = fakeConnect()
    const stream = await openVolcStream({ apiKey: 'k' }, {})
    sock.fireOpen()

    stream.pushAudio(new Uint8Array([9, 9]))
    void stream.finish()

    // 配置帧 + 音频 + 最后一包
    expect(sock.sent).toHaveLength(3)
    expect(parseFrame(sock.sent[1])?.payload).toEqual(new Uint8Array([9, 9]))
    expect(lastPackets(sock.sent)).toBe(1)

    stream.cancel()
  })

  it('finish() 被调两次（松手 + 组件卸载）也只发一包结束信号', async () => {
    const sock = fakeConnect()
    const stream = await openVolcStream({ apiKey: 'k' }, {})
    sock.fireOpen()

    void stream.finish()
    void stream.finish()

    // 重复的结束信号服务端会当成协议错，所以要挡在客户端
    expect(lastPackets(sock.sent)).toBe(1)

    stream.cancel()
  })
})

/* ============================================================
   收尾：**已经识别出来的字，一个字都不许丢**
   ============================================================

   家长 2026-10-02 报的原话：
     「写作文 录音时候，录音文字已经识别，但是如果松开过快，就不会处理。」

   症状是**上槽已经长出字了，正文却一个字没变**。
   成因：中间结果（`onInterim`）到了，终稿那一条消息却可能压根不来
   —— 服务端只给中间结果、或者收尾时连接被关掉 / 报错。
   修复前这一轮直接回一句"没听清"，孩子刚说的话就白说了。

   ★ 唯一**不许**兜底的情况：`cancelled` —— 那是孩子自己放弃的
     （手指滑出按钮 / 离开页面）。把他不要的东西写进作文更糟。
     这就是 `'cancelled'` 必须从 `'empty'` 里分出来的原因。
   ============================================================ */

interface FakeConn {
  sent: Uint8Array[]
  closed: boolean
  fireOpen: () => void
  fireMessage: (bytes: Uint8Array) => void
  fireError: (message: string) => void
  fireClose: () => void
}

/**
 * 记下**每一条**连接。
 *
 * ⚠️ 不能用上面那个 `fakeConnect`：它只留最后一份 handlers，
 *    而"预热 + 现连"会各建一条，两条要能分别操作。
 */
function fakeConnectAll(): { conns: FakeConn[] } {
  const conns: FakeConn[] = []
  vi.mocked(connectWs).mockImplementation(async (_url, _headers, h) => {
    const conn: FakeConn = {
      sent: [],
      closed: false,
      fireOpen: () => h.onOpen(),
      fireMessage: (b) => h.onMessage(b),
      fireError: (m) => h.onError(m),
      fireClose: () => h.onClose(),
    }
    conns.push(conn)
    return {
      send: (b) => conn.sent.push(b),
      close: () => {
        conn.closed = true
      },
    }
  })
  return { conns }
}

/** 服务端下发的一帧（messageType 9 = 识别结果） */
function serverFrame(text: string, final = false): Uint8Array {
  return buildFrame({
    messageType: 9,
    serialization: 1,
    flags: final ? FLAG_LAST : FLAG_NONE,
    payload: new TextEncoder().encode(JSON.stringify({ result: { text } })),
  })
}

describe('收尾 · 已经有中间结果就不许丢', () => {
  it('中间结果先到、终稿后到 → 用终稿（终稿只要来了就一定赢）', async () => {
    const { conns } = fakeConnectAll()
    const stream = await openVolcStream({ apiKey: 'k' }, {})
    conns[0].fireOpen()
    conns[0].fireMessage(serverFrame('我家有一只小猫'))
    conns[0].fireMessage(serverFrame('我家有一只小猫，它很喜欢晒太阳。', true))

    const r = await stream.finish()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toBe('我家有一只小猫，它很喜欢晒太阳。')
  })

  it('★ 只有中间结果、终稿一直不来 → 2.5 秒就收手用中间结果（不是等满 20 秒）', async () => {
    /* ⚠️ 必须能区分「2.5 秒兜底」和「20 秒超时」——
       两条分支最后都拿 `lastText` 返回，光断言 `r.text` 的话
       把 `FINAL_GRACE_MS` 整段删掉测试**照样绿**（只是让孩子多等 17.5 秒）。
       所以这里断言的是**什么时候结算的**，不是结算出什么。 */
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const { conns } = fakeConnectAll()
    const stream = await openVolcStream({ apiKey: 'k' }, {})
    conns[0].fireOpen()
    conns[0].fireMessage(serverFrame('小河边的柳树发芽了'))

    let settled: VolcStreamResult | null = null
    const p = stream.finish()
    void p.then((r) => {
      settled = r
    })

    // 还没到 2.5 秒：不该提前收手（终稿可能马上就来）
    await vi.advanceTimersByTimeAsync(2_000)
    expect(settled, '2 秒就收手属于误伤 —— 终稿可能还在路上').toBeNull()

    // 越过 2.5 秒 → 立刻用中间结果兜底
    await vi.advanceTimersByTimeAsync(600)
    expect(settled, '2.5 秒就该收手了，不许让孩子盯到 20 秒').not.toBeNull()

    const r = await p
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toBe('小河边的柳树发芽了')
  })

  it('★ 收尾时连接被关掉、但已经有中间结果 → 用中间结果，不许报"没听清"', async () => {
    const { conns } = fakeConnectAll()
    const stream = await openVolcStream({ apiKey: 'k' }, {})
    conns[0].fireOpen()
    conns[0].fireMessage(serverFrame('小河边的柳树发芽了'))

    const p = stream.finish()
    conns[0].fireClose()

    const r = await p
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toBe('小河边的柳树发芽了')
  })

  it('★ 孩子自己放弃（cancel）→ reason 是 `cancelled`，不是 `empty`', async () => {
    /* 这一条是上面那条兜底的**前提**：两种失败必须长得不一样，
       否则"给没听清加兜底"就必然误伤"孩子主动放弃"。 */
    const { conns } = fakeConnectAll()
    const stream = await openVolcStream({ apiKey: 'k' }, {})
    conns[0].fireOpen()
    conns[0].fireMessage(serverFrame('这句话孩子不要了'))
    stream.cancel()

    const r = await stream.finish()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('cancelled')
  })

  it('一句都没听清（服务端回话了但文本是空的）→ `empty`，不是 `cancelled`', async () => {
    const { conns } = fakeConnectAll()
    const stream = await openVolcStream({ apiKey: 'k' }, {})
    conns[0].fireOpen()
    const p = stream.finish()
    conns[0].fireMessage(serverFrame('', true))

    const r = await p
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('empty')
  })
})

/* ============================================================
   预热连接 —— 进写作页就握好，按下时复用
   ============================================================

   家长 2026-10-02 要的：「能否进入写作页面就是有录音的，就建立好链接
   （因为现在 开始的时候录音反应有些慢，猜测预链接可能会好一些）。」

   ★ 预热**只负责更快，不负责能用** —— 取不到就现连，也就是今天的行为。
     所以下面每一条失败路径都必须"退回现连"，而不是"这一轮废了"。
   ============================================================ */

describe('预热连接 · 复用与失效', () => {
  it('★ 预热过就直接复用 —— 按下时不再建第二条连接', async () => {
    const { conns } = fakeConnectAll()
    warmVolcStream({ apiKey: 'k' })
    expect(conns, '预热会先建一条').toHaveLength(1)

    const stream = await openVolcStream({ apiKey: 'k' }, {})
    expect(conns, '按下时不该再建第二条').toHaveLength(1)

    // 复用的那条照样要发配置帧（音频格式全靠它）
    conns[0].fireOpen()
    expect(parseFrame(conns[0].sent[0])?.messageType).toBe(1)
    stream.cancel()
  })

  it('★ 预热复用时，open 事件在会话出生之前就到过 → 配置帧也不许丢', async () => {
    /* 预热那条连接是**进页面**时握的，open 事件早就打完了，
       而"会话"要到按下那一刻才出生。事件比会话早是常态，不是边界。 */
    const { conns } = fakeConnectAll()
    warmVolcStream({ apiKey: 'k' })
    conns[0].fireOpen() // 会话还不存在 → 事件被攒住
    expect(conns[0].sent).toHaveLength(0)

    const stream = await openVolcStream({ apiKey: 'k' }, {})
    // 会话接管后把"已经 open 过"补上 → 配置帧这才发出去
    expect(conns[0].sent).toHaveLength(1)
    expect(parseFrame(conns[0].sent[0])?.messageType).toBe(1)
    stream.cancel()
  })

  it('换密钥 → 不复用（旧连接是拿旧密钥握的）', async () => {
    const { conns } = fakeConnectAll()
    warmVolcStream({ apiKey: 'k1' })
    await openVolcStream({ apiKey: 'k2' }, {})
    expect(conns).toHaveLength(2)
  })

  it('★ 预热的连接已经死了（error / close）→ 不复用，退回现连', async () => {
    const { conns } = fakeConnectAll()
    warmVolcStream({ apiKey: 'k' })
    conns[0].fireError('boom')
    await openVolcStream({ apiKey: 'k' }, {})
    expect(conns, '死掉的连接不能用 —— 用它孩子会白说一遍').toHaveLength(2)
  })

  it('预热超过 60 秒就作废（拿不准宁可现连）', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const { conns } = fakeConnectAll()
    warmVolcStream({ apiKey: 'k' })
    vi.advanceTimersByTime(61_000)
    await openVolcStream({ apiKey: 'k' }, {})
    expect(conns).toHaveLength(2)
  })

  it('没密钥就完全不预热（别在没密钥时打无谓的连接）', () => {
    const { conns } = fakeConnectAll()
    warmVolcStream({ apiKey: '   ' })
    expect(conns).toHaveLength(0)
  })

  it('★ 预热本身失败（连不上）不许影响按下 —— 现连照常', async () => {
    let calls = 0
    vi.mocked(connectWs).mockImplementation(async () => {
      calls += 1
      if (calls === 1) throw new Error('预热时网络正好不通')
      return { send: () => {}, close: () => {} }
    })
    warmVolcStream({ apiKey: 'k' })
    const stream = await openVolcStream({ apiKey: 'k' }, {})
    expect(calls, '第一次是预热（失败），第二次是现连').toBe(2)
    // 拿到的是一条能用的会话，不是空壳
    stream.cancel()
  })
})

/* ============================================================
   PCM 采集：开麦前就被收掉 → 不许再把音频图建起来
   ============================================================

   这一条原来守在**整包上传**那条路上（MediaRecorder 迟到的 resolve
   会把录音器建起来，而再没人停它 → 麦克风指示灯一直亮到退出页面）。
   那条路已删，但守卫本身必须留着 —— 采集换成了 PCM，问题一模一样：
   `stop()` 是同步的，而 `getUserMedia` 要等几十到几百毫秒，
   所以"松手抢在开麦前面"是常态。
   ============================================================ */

describe('PCM 采集 · 开麦前被收掉就不许建音频图', () => {
  it('★ stop() 抢在 getUserMedia 前面 → 迟到的 resolve 只把轨道关掉', async () => {
    const stoppedTracks: string[] = []
    /** 由测试决定"麦克风什么时候才打开" —— 复刻 getUserMedia 的耗时 */
    let release!: (stream: unknown) => void
    const micOpening = new Promise<unknown>((res) => {
      release = res
    })

    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: () => micOpening },
    })
    // 建音频图就会走到这里 —— 走到了说明守卫没了
    vi.stubGlobal(
      'AudioContext',
      function AudioContextStub() {
        throw new Error('开麦前就被收掉了，不该再建 AudioContext')
      },
    )

    const cap = createPcmCapture({ onChunk: () => {} })
    const p = cap.start()
    cap.stop() // 松手是同步的，抢在开麦前面
    release({ getTracks: () => [{ stop: () => stoppedTracks.push('t') }] })

    await p // 不许抛
    expect(stoppedTracks, '麦克风必须被关掉，不许留着').toHaveLength(1)
  })
})
