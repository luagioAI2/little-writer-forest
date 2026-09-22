/* ============================================================
   真机诊断分析器 —— 拿"已知答案"的合成日志验它判得对不对
   ============================================================

   为什么需要这个文件：

   `scripts/verify-device.mjs` 是用来"防猜"的 —— 真机语音链路坏了，
   界面上只有一句「按住说了，一个字没出来」，靠它把 logcat 还原成链路、
   指出断点。但如果**它自己判错了**，后果比没有它更糟：
   人会拿着一个错误的结论去查一个不存在的问题，而且它说得很像真的
   （带 ✓、带链路图、带退出码）。

   这不是假设 —— 这个分析器第一版就有两个静默 bug，都是靠"喂已知答案"抓出来的：

     · 判据表里声明了 `not: [...]` 但忘了实现 → 空录音被判成"录到了"
       （因为 `录音结束但没有音频` **含有** `录音结束` 子串，includes() 直接命中）
     · 补充信息用正则抠（/ms:\s*(\d+)/）→ 数字永远不显示，
       因为 Capacitor 把第二个参数 JSON.stringify 过，实际是 `"ms":391`

   两个都不抛异常、不影响退出码，只是结论反了。

   所以这里把**每一种分支**都用合成日志喂一遍，钉住结论和退出码。

   跑法：
     npm test                              # 跟着全量一起跑
     npx vitest run --config vitest.config.ts scripts/verify-device.test.ts

   为什么用「起子进程」而不是「import 分析函数」：
   这样连参数解析、stdout/stderr 的分流、以及退出码都一起验了 ——
   而这几个恰恰是最容易在重构里悄悄坏掉的部分。
   ============================================================ */

// @vitest-environment node
//   ↑ 要起子进程、写临时文件；jsdom 环境没必要，也和真实运行环境不符。

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { noDeviceHint, parseDevices } from './verify-device.mjs'

const SCRIPT = resolve(process.cwd(), 'scripts', 'verify-device.mjs')
const TAG = '[语音转写]'

/**
 * 造一行 Capacitor 转发到 logcat 的 WebView console 输出。
 * 第二个参数用 JSON.stringify 拼上去 —— **和真机上的形态一致**，
 * 不然就验不出"正则抠不出来"那类 bug。
 */
function logLine(msg: string, data?: unknown): string {
  const tail = data === undefined ? '' : ` ${JSON.stringify(data)}`
  return `09-17 17:55:12.345  1234  1234 I Capacitor/Console: File: http://localhost/ - Line 1 - Msg: ${TAG} ${msg}${tail}`
}

/** 跑一次分析器，返回退出码和全部输出（stdout + stderr） */
function run(lines: string[]): { code: number; out: string } {
  const file = join(mkdtempSync(join(tmpdir(), 'vd-test-')), 'capture.log')
  writeFileSync(file, `${lines.join('\n')}\n`)
  try {
    const out = execFileSync(process.execPath, [SCRIPT, '--dump', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/* ---------------- 一段完整链路的各环节 ---------------- */

const micOpen = logLine('麦克风已打开', { 轨道数: 1, sampleRate: 48000, channels: 1 })
const recStart = logLine('开始录制', { 请求格式: 'audio/webm;codecs=opus', 码率: 16000 })
const recDone = logLine('录音结束', { 数据块: 10, bytes: 10412, 时长ms: 2550, 实际格式: 'audio/webm;codecs=opus' })
const toAsr = logLine('开始转写', { 按住ms: 2600, 音频ms: 2550, 格式: 'audio/webm;codecs=opus' })
const upload = logLine('上传', { model: 'Qwen/Qwen3-ASR-1.7B', file: 'rec.webm', bytes: 10412 })

describe('真机语音诊断 · 分析器判得对不对', () => {
  it('通了：退出码 0，报出耗时和识别到的文字', () => {
    const { code, out } = run([
      micOpen,
      recStart,
      recDone,
      toAsr,
      upload,
      logLine('成功', { ms: 391, chars: 8, text: '今天我去公园玩了' }),
    ])
    expect(code).toBe(0)
    expect(out).toContain('✓ 通了')
    expect(out).toContain('391ms')
    expect(out).toContain('今天我去公园玩了')
  })

  it('★ 空录音：必须报「没收到数据块」，且链路断在「录到音频」', () => {
    // 这条是"子串包含"陷阱的守门员：
    // 「录音结束但没有音频」里含有「录音结束」，只要 not 判据没实现，
    // 就会被当成"录到了"，链路一路 ✓ 到「服务端回话」——
    // 于是结论变成"发不出去"，而真正的问题是"根本没录到"。
    const { code, out } = run([
      micOpen,
      recStart,
      logLine('录音结束但没有音频', { 数据块: 0, bytes: 0, 主动取消: false, 时长ms: 1800 }),
    ])
    expect(code).toBe(1)
    expect(out).toContain('一个数据块都没收到')

    // 链路里「录到音频」那一行必须是 ✖，且标出断点
    const recLine = out.split('\n').find((l) => l.includes('录到音频'))
    expect(recLine, '链路里应该有「录到音频」这一步').toBeDefined()
    expect(recLine).toContain('✖')
    expect(recLine).toContain('断在这里')
  })

  it('一条日志都没抓到：给出四种最可能的原因，而不是干巴巴一句"没找到"', () => {
    const { code, out } = run(['09-17 17:55:12.345  1234  1234 I ActivityManager: 和语音无关的一行'])
    expect(code).toBe(1)
    expect(out).toContain('一条语音日志都没抓到')
    expect(out).toContain('release 包') // 装错包是最常见的真实原因
    expect(out).toContain('旧包')
  })

  it('★ 服务端 401：要报出状态码和服务端原话（数字不能被序列化形式骗掉）', () => {
    // 这条守着"正则抠不出来"那个 bug：
    // 日志里是 `"status":401`，正则 /status:\s*(\d+)/ 匹配不到，
    // 表现是「HTTP」后面**没有数字** —— 不报错，只是信息丢了。
    const { code, out } = run([
      micOpen,
      recStart,
      recDone,
      toAsr,
      upload,
      logLine('服务端拒绝', { status: 401, reason: 'auth', body: '{"code":401,"message":"Invalid token"}' }),
    ])
    expect(code).toBe(1)
    expect(out).toContain('HTTP 401')
    expect(out).toContain('Invalid token')
    expect(out).toContain('密钥不对')
  })

  it('超时：要能区分"超时被中断"和"连接就没建起来"', () => {
    const { code, out } = run([
      micOpen,
      recStart,
      recDone,
      toAsr,
      upload,
      logLine('网络失败', { aborted: true, ms: 12007, err: 'AbortError: The user aborted a request.' }),
      logLine('全部尝试都失败', { 共尝试: 2, 总耗时ms: 24019, reason: 'network' }),
    ])
    expect(code).toBe(1)
    expect(out).toContain('超时被中断')
    expect(out).toContain('12007ms')
  })

  it('麦克风权限被拒：要认出 NotAllowedError 并指向系统设置', () => {
    const { code, out } = run([logLine('麦克风打开失败', { err: 'NotAllowedError: Permission denied' })])
    expect(code).toBe(1)
    expect(out).toContain('NotAllowedError')
    expect(out).toContain('系统设置')
  })

  it('手指滑出按钮（用户主动放弃）：不算故障，用退出码 2 和失败区分开', () => {
    const { code, out } = run([micOpen, logLine('中途放弃（手指滑出按钮）', { 按住ms: 800 })])
    expect(code).toBe(2)
    expect(out).toContain('不算故障')
  })
})

/* ============================================================
   流式（边说边传）那条链路
   ============================================================

   默认配置走的就是这条。它的日志名和整包上传**完全不重叠**，
   所以最危险的失败形态是：**分析器拿另一条路的判据去套** ——
   表现是断点被指到一个根本没问题的环节上，把人引去查权限和按钮。
   ============================================================ */

const pcmStart = logLine('PCM 采集已启动', { 设备采样率: 48000, 目标采样率: 16000, 每包字节: 6400 })
const wsOpen = logLine('流式已连上', {
  endpoint: 'duplex',
  resourceId: 'volc.seedasr.sauc.duration',
  ms: 168,
})
const lastPkt = logLine('流式已发最后一包', { ms: 2600 })
const wsFinal = logLine('流式终稿', {
  ms: 2750,
  首字ms: -1800,
  字数: 8,
  文本: '今天我去公园玩了',
})
const wsOk = logLine('流式成功', { ms: 2760, 字数: 8 })

describe('真机语音诊断 · 流式链路', () => {
  it('通了：退出码 0，认出走的是流式，并报出「首字在松手之前」', () => {
    const { code, out } = run([pcmStart, wsOpen, lastPkt, wsFinal, wsOk])
    expect(code).toBe(0)
    expect(out).toContain('✓ 通了')
    // ★ 这一条是核心：链路的身份必须认对
    expect(out).toContain('边说边传（流式）')
    expect(out).toContain('今天我去公园玩了')
    // 首字时间是流式独有的指标，且负数 = 文字在松手之前就上屏了。
    // 只报一个"全程 ms"是看不出这件事的（全程里含孩子说话的时间）。
    expect(out).toContain('1800ms')
    expect(out).toContain('松手之前')
  })

  it('★ 首字在松手之后：报正数，不能也写成"松手之前"', () => {
    const { code, out } = run([
      pcmStart,
      wsOpen,
      lastPkt,
      logLine('流式终稿', { ms: 3100, 首字ms: 420, 字数: 8, 文本: '今天我去公园玩了' }),
      wsOk,
    ])
    expect(code).toBe(0)
    expect(out).toContain('420ms')
    expect(out).toContain('松手之后')
    expect(out).not.toContain('松手之前')
  })

  it('★ 插件没注册上：必须说"不是网络问题"，不能引去查网络', () => {
    const { code, out } = run([
      pcmStart,
      logLine('流式连不上', { message: '原生 WebSocket 插件没有响应（可能没注册成功）' }),
    ])
    expect(code).toBe(1)
    expect(out).toContain('插件没注册上')
    expect(out).toContain('不是')
    expect(out).toContain('网络问题')
  })

  it('密钥被拒（403）：指向密钥 / 资源没开通', () => {
    const { code, out } = run([
      pcmStart,
      logLine('流式连不上', { message: 'websocket failure HTTP 403 {"error":"get resource id empty"}' }),
    ])
    expect(code).toBe(1)
    expect(out).toContain('密钥不对')
    expect(out).toContain('流式语音识别')
  })

  it('★ 连不上时断点必须落在「连上语音服务」，不能推到下一环', () => {
    // 写这一节时自己先踩过：把 `流式连不上` 放进「连上语音服务」的 or 里，
    // 连接失败就被算成"走到了"，断点被推到「边说边传」——
    // 而那一环压根没机会开始。这正是本脚本要消灭的"指错方向"。
    const { code, out } = run([
      pcmStart,
      logLine('流式连不上', { message: 'websocket failure HTTP 403' }),
    ])
    expect(code).toBe(1)

    const connLine = out.split('\n').find((l) => l.includes('连上语音服务'))
    expect(connLine, '必须能看到「连上语音服务」这一环').toBeTruthy()
    expect(connLine).toContain('✖')
    expect(connLine).toContain('断在这里')

    const streamLine = out.split('\n').find((l) => l.includes('边说边传'))
    expect(streamLine, '下一环不该被标成断点').not.toContain('断在这里')
  })

  it('麦克风打不开时，断点落在第一环（而不是被推到"连上语音服务"）', () => {
    const { code, out } = run([
      logLine('麦克风打开失败', { err: 'NotAllowedError: Permission denied' }),
    ])
    expect(code).toBe(1)
    const micLine = out.split('\n').find((l) => l.includes('按下按钮'))
    expect(micLine).toContain('✖')
    expect(micLine).toContain('断在这里')
  })

  it('★ 终稿超时：断点必须落在「拿到终稿」，而不是被推到「写进正文」', () => {
    // `流式终稿超时` 里含有 `流式终稿` 这个子串 —— 不排掉的话，
    // 超时会被当成"拿到了终稿"，真正的病灶（收尾没回来）就标不出来了。
    const { code, out } = run([
      pcmStart,
      wsOpen,
      lastPkt,
      logLine('流式终稿超时', { timeoutMs: 20000, 最后文本: '' }),
    ])
    expect(code).toBe(1)
    const finalLine = out.split('\n').find((l) => l.includes('拿到终稿'))
    expect(finalLine, '必须能看到「拿到终稿」这一环').toBeTruthy()
    expect(finalLine).toContain('✖')
    expect(finalLine).toContain('断在这里')
    expect(out).toContain('收尾')
  })

  it('服务端在协议层拒绝（不支持的音频格式）：报出错误码和服务端原话', () => {
    const { code, out } = run([
      pcmStart,
      wsOpen,
      logLine('流式服务端错误帧', { code: 45000151, text: '[Invalid audio format] unsupported format webm' }),
    ])
    expect(code).toBe(1)
    expect(out).toContain('45000151')
    expect(out).toContain('unsupported format webm')
  })

  it('松手比建连还快：提示按住时间太短，而不是报网络故障', () => {
    const { code, out } = run([
      pcmStart,
      logLine('流式没连上就松手了', { 按住ms: 120, 有音频: false }),
    ])
    expect(code).toBe(1)
    expect(out).toContain('还没连上')
    expect(out).toContain('按住')
  })

  it('★ 采集到 0 个采样点：要报"没收到数据"，而不是当成链路走完了', () => {
    const { code, out } = run([
      pcmStart,
      wsOpen,
      lastPkt,
      logLine('PCM 采集结束', { 采样点: 0, 时长ms: 0 }),
    ])
    expect(code).toBe(1)
    expect(out).toContain('一个采样点都没收到')
  })

  it('★ 只有「麦克风打开失败」这种两边共用的日志时，按默认配置（流式）判', () => {
    // 这条守的是"两条路共用日志"的歧义。
    // 判错的表现：链路显示成整包上传那条，「录制启动 ← 断在这里」——
    // 而"录制启动"在流式那条路上压根不存在，等于把人引到一个假环节。
    const { code, out } = run([logLine('麦克风打开失败', { err: 'NotAllowedError: Permission denied' })])
    expect(code).toBe(1)
    expect(out).toContain('边说边传（流式）')
    expect(out).not.toContain('录制启动')
    // 真正的病因还是要报对
    expect(out).toContain('NotAllowedError')
  })

  it('中途放弃（流式）：也不算故障，退出码 2', () => {
    const { code, out } = run([pcmStart, wsOpen, logLine('中途放弃（手指滑出按钮）', { 按住ms: 900 })])
    expect(code).toBe(2)
    expect(out).toContain('不算故障')
  })
})

describe('真机语音诊断 · 脚本本身的自检', () => {
  it('★ 被 import 时必须是"哑"的 —— 不能一 import 就去找 adb、去读 logcat', async () => {
    // 这条守的是文件末尾那个 `if (isMain) await main()`。
    // 它失灵的表现是"脚本跑了但什么都没输出" —— 又一个静默失败，
    // 而且单测会因为模块被提前加载而受到噪声污染。
    vi.resetModules()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await import('./verify-device.mjs')
    } finally {
      log.mockRestore()
      err.mockRestore()
    }
    expect(log, 'import 这个模块不该有任何输出').not.toHaveBeenCalled()
    expect(err, 'import 这个模块不该有任何输出').not.toHaveBeenCalled()
  })
})

/* ============================================================
   `adb devices` 的解析 —— 要分清「连了但用不了」的三种状态
   ============================================================

   为什么值得单独测：这台机器上没有真机，**设备路径是唯一没法手工验的**。
   而它最容易出的错不是崩溃，是**把状态认错、然后给出指错方向的提示** ——
   手机明明插着、只是授权弹窗没点，却被引去查数据线和开发者选项，
   白白多花十几分钟。所以把状态判定钉住。
   ============================================================ */

const HEADER = 'List of devices attached'
const DAEMON_NOISE = '* daemon not running; starting now at tcp:5037\n* daemon started successfully'

describe('真机语音诊断 · adb devices 解析', () => {
  it('典型输出（含表头和 daemon 噪声）：挑出唯一可用那台', () => {
    const out = `${HEADER}\n${DAEMON_NOISE}\n8TFDU19A24001234\tdevice\n`
    const d = parseDevices(out)
    expect(d.ready).toEqual(['8TFDU19A24001234'])
    expect(d.unauthorized).toEqual([])
    expect(d.offline).toEqual([])
  })

  it('★ 未授权：不能当成"没连手机"，要单独认出来', () => {
    // 这是最常见的真实情况：手机插着、开发者选项也开了，
    // 就差屏幕上那个「允许 USB 调试」的弹窗没点。
    const d = parseDevices(`${HEADER}\n8TFDU19A24001234\tunauthorized\n`)
    expect(d.ready).toEqual([])
    expect(d.unauthorized).toEqual(['8TFDU19A24001234'])
  })

  it('★ offline：也要单独认出来（线接触不良 / 设备重启中）', () => {
    const d = parseDevices(`${HEADER}\nemulator-5554\toffline\n`)
    expect(d.ready).toEqual([])
    expect(d.offline).toEqual(['emulator-5554'])
  })

  it('混合：一台可用 + 一台未授权 → 用可用那台，不报错', () => {
    const d = parseDevices(`${HEADER}\nAAA\tdevice\nBBB\tunauthorized\n`)
    expect(d.ready).toEqual(['AAA'])
    expect(d.unauthorized).toEqual(['BBB'])
  })

  it('CRLF 换行（Windows 上的 adb 会这样）也要认', () => {
    const d = parseDevices(`${HEADER}\r\n8TFDU19A24001234\tdevice\r\n`)
    expect(d.ready).toEqual(['8TFDU19A24001234'])
  })

  it('只有表头 / 空字符串：都返回空，不抛异常', () => {
    expect(parseDevices(`${HEADER}\n`).ready).toEqual([])
    expect(parseDevices('').ready).toEqual([])
  })

  it('认不出来的状态（比如 recovery）不进 ready —— 宁可不认，也不能乱用', () => {
    expect(parseDevices(`${HEADER}\nXYZ\trecovery\n`).ready).toEqual([])
  })

  it('提示按"卡在哪一步"分流：未授权 → 让你看手机屏幕', () => {
    const hint = noDeviceHint({ unauthorized: ['8TFDU19A24001234'] })
    expect(hint).toContain('手机屏幕')
    expect(hint).toContain('允许')
    // 关键：不能把"没授权"引到查线/查开发者选项上去
    expect(hint).not.toContain('仅充电')
  })

  it('提示按"卡在哪一步"分流：offline → 指向线材/接口', () => {
    const hint = noDeviceHint({ offline: ['emulator-5554'] })
    expect(hint).toContain('offline')
    expect(hint).toContain('线')
  })

  it('提示按"卡在哪一步"分流：什么都没连 → 给完整的上手步骤', () => {
    const hint = noDeviceHint({})
    expect(hint).toContain('USB 调试')
    expect(hint).toContain('传输文件')
  })
})
