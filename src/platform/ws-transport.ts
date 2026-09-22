/* ============================================================
   WebSocket 传输层 —— 把「socket 在哪」和「协议是什么」拆开
   ============================================================

   为什么要拆：

     火山的流式接口**只能在原生侧连**（浏览器不能给 WebSocket 设请求头，
     查询串/子协议两条绕行路都被服务端拒了 —— 实测见
     scripts/_probe-ws-auth.mjs）。所以 socket 得交给
     android/.../VolcWebSocketPlugin.java（OkHttp）。

     但「协议」不该跟着进原生 —— 进了 Java 就再也测不了了。
     于是这里定义一个**只搬字节**的接口，上面那层
     （volcengine.ts 的分帧 / 事件 / 取文本）完全不知道字节从哪来，
     因此可以在 vitest 里用假传输跑完。

   ⚠️ 浏览器兜底那条路**连不上火山**（设不了请求头，必然 401/403）。
     留着它的唯一理由：桌面开发时不该因为缺插件就崩，
     而且要能给出"这条路只在手机上能用"这种明确报错。
   ============================================================ */

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { isNativePlatform } from './native'

/** 传输层只认这两件事：发字节、关连接 */
export interface WsTransport {
  send: (bytes: Uint8Array) => void
  close: () => void
}

export interface WsHandlers {
  onOpen: () => void
  onMessage: (bytes: Uint8Array) => void
  onError: (message: string) => void
  onClose: () => void
}

/* ---------------- base64（过 Capacitor 桥只能传字符串） ---------------- */

/*
 * 不用 `String.fromCharCode(...bytes)` 一次性转：
 * 一段 200ms 的 16k 单声道 PCM 是 6400 字节，看着不大，
 * 但展开成参数会直接顶爆调用栈上限（几万参数就崩），
 * 而且是**偶发**的 —— 音频越长越容易炸。所以分块。
 */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/* ---------------- 原生插件 ---------------- */

interface VolcWsPlugin {
  connect(o: { url: string; headers: Record<string, string> }): Promise<{ status: number }>
  send(o: { data: string }): Promise<void>
  close(): Promise<void>
  addListener(
    eventName: 'open' | 'message' | 'error' | 'close',
    cb: (data: Record<string, unknown>) => void,
  ): Promise<PluginListenerHandle>
}

let plugin: VolcWsPlugin | null = null
let pluginResolved = false

function getPlugin(): VolcWsPlugin | null {
  if (!isNativePlatform()) return null
  if (!pluginResolved) {
    pluginResolved = true
    try {
      plugin = registerPlugin<VolcWsPlugin>('VolcWs')
    } catch {
      plugin = null
    }
  }
  return plugin
}

/** 这台设备能不能走流式（要原生插件） */
export function isStreamingSupported(): boolean {
  return getPlugin() !== null
}

/**
 * 握手最多等多久。
 *
 * 这个超时是**必需的**，不是保险：插件没注册成功时，Capacitor 的
 * `addListener` 会既不 resolve 也不 reject，直接挂住（见下面 connectWs 的说明）。
 */
const CONNECT_TIMEOUT_MS = 8_000

/* ---------------- 连接 ---------------- */

/**
 * 开一条 WebSocket。headers 只有原生那条路能真正带上。
 *
 * 刻意把「连接成功」和「握手被拒」分得清楚：403/400 是**配置/权限**问题
 * （密钥、资源没开通），而超时是网络问题 —— 家长看到的提示完全不同。
 */
export async function connectWs(
  url: string,
  headers: Record<string, string>,
  handlers: WsHandlers,
): Promise<WsTransport> {
  const p = getPlugin()

  if (!p) {
    /* 浏览器：只能开一条不带头的 socket。
       对火山来说这必然是失败的，但失败得很晚（握手后才被拒），
       所以这里直接说清楚，省得排查时往"网络"方向查。 */
    return new Promise<WsTransport>((resolve, reject) => {
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => {
        handlers.onOpen()
        resolve({
          // 这个 cast 是本项目里既有的写法（见 speech.ts 的 getByteTimeDomainData）：
          // TS 5.7 起 Uint8Array 带上 ArrayBufferLike 泛型，
          // 而 WebSocket.send 只收 ArrayBuffer 支撑的视图
          send: (b) => ws.send(b as Uint8Array<ArrayBuffer>),
          close: () => {
            try {
              ws.close()
            } catch {
              /* 已经关了 */
            }
          },
        })
      }
      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) handlers.onMessage(new Uint8Array(e.data))
        else if (typeof e.data === 'string') handlers.onMessage(new TextEncoder().encode(e.data))
      }
      ws.onerror = () => {
        // 浏览器不给任何细节，只能说这么多
        handlers.onError('连接失败（浏览器里无法给 WebSocket 设置请求头，流式转写只在手机上可用）')
        reject(new Error('websocket error'))
      }
      ws.onclose = () => handlers.onClose()
    })
  }

  // 事件要在 connect() 之前挂好，否则 open 可能早于监听器注册
  const handles: PluginListenerHandle[] = []
  const track = async (ev: 'open' | 'message' | 'error' | 'close', fn: (d: Record<string, unknown>) => void) => {
    handles.push(await p.addListener(ev, fn))
  }
  const dispose = () => {
    for (const h of handles) {
      try {
        void h.remove()
      } catch {
        /* 已经没了 */
      }
    }
    handles.length = 0
  }

  /* ★ 整段握手必须有超时兜底。
   *
   * 为什么：**插件没挂上时，Capacitor 的 addListener 既不 resolve 也不 reject**
   * （它的实现里没接 reject 分支），就那么挂着。而 registerPlugin 永远返回一个
   * 代理对象 —— 所以 `isStreamingSupported()` 在原生侧**永远返回 true**，
   * 哪怕插件压根没注册成功。
   *
   * 两者一叠加就是：按下麦克风 → beginHold 卡在 await 上 →
   * 界面永远停在"我在听……"，一个字都不出来，而且**不报错**。
   * 本项目在 LittleSpeechPlugin 上已经踩过同一个坑（那边靠先调 available() 破的），
   * 这里用超时兜住。
   */
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    await Promise.race([
      (async () => {
        // 事件要在 connect() 之前挂好，否则 open 可能早于监听器注册
        await track('open', () => handlers.onOpen())
        await track('message', (d) => {
          if (typeof d.data === 'string') {
            try {
              handlers.onMessage(base64ToBytes(d.data))
            } catch {
              /* 坏包直接丢，不该把整条链路带崩 */
            }
          }
        })
        await track('error', (d) => {
          const status = typeof d.status === 'number' ? ` HTTP ${d.status}` : ''
          const body = typeof d.body === 'string' && d.body ? ` ${d.body.slice(0, 140)}` : ''
          handlers.onError(`${String(d.message ?? '连接出错')}${status}${body}`)
        })
        await track('close', () => handlers.onClose())
        await p.connect({ url, headers })
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('原生 WebSocket 插件没有响应（可能没注册成功）')),
          CONNECT_TIMEOUT_MS,
        )
      }),
    ])
  } catch (err) {
    dispose()
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    if (timer !== null) clearTimeout(timer)
  }

  return {
    send: (bytes) => {
      // 不 await：音频是连续推的，等每一包回执会把节奏拖垮。
      // 失败由 error/close 事件统一上报，这里只吞掉 promise。
      void p.send({ data: bytesToBase64(bytes) }).catch(() => {})
    },
    close: () => {
      dispose()
      void p.close().catch(() => {})
    },
  }
}
