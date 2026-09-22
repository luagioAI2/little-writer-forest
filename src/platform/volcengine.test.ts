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

import { describe, expect, it, vi } from 'vitest'
import {
  VOLC_ENDPOINTS,
  buildFrame,
  extractText,
  isFinalFrame,
  openVolcStream,
  parseFrame,
  resolveEndpoint,
} from './volcengine'
import { downsampleTo, floatToInt16Bytes } from './pcm-capture'
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
