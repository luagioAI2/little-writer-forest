/* ============================================================
   真机验收：语音转写这条路到底断在哪一环
   ============================================================

   为什么需要它：

   语音转写是**唯一没法在电脑上验完**的一条路 —— 它依赖真机麦克风、
   安卓 WebView 的录音实现、以及手机的实时网络。

   而它一旦坏，界面上只表现为一句话：「按住说了，一个字没出来」。
   这句话对应至少五种完全不同的病因，排查方向南辕北辙：

     · 按钮没触发 beginHold        → 前端事件问题
     · getUserMedia 被拒/没权限    → 权限问题
     · 麦克风开了但录不到数据      → WebView 录音实现问题
     · 录到了但没发出去            → 网络/请求构造问题
     · 发出去了服务端不回话        → 服务端/超时问题

   所以代码里在这条路的每一环都留了 `[语音转写]` 日志
   （见 src/platform/voice-log.ts），这个脚本负责把它们捞出来、
   按顺序还原成一条链路，然后直接告诉你断点在哪。

   ⚠️ 前提：必须是 **debug 包**。
      Capacitor 的 android.loggingBehavior 默认值是 debug，
      即 loggingEnabled = isDebug —— release 包不会把日志送进 logcat。
      这也是我们想要的（孩子说的话不该进系统日志），所以别去改它。

   跑法：
     npm run verify:device              # 交互式：清日志 → 你对着手机说一句 → 回车 → 出结论
     npm run verify:device -- --dump x.log   # 分析已经抓下来的日志文件
     npm run verify:device -- --no-wait      # 不清日志、不等你，直接分析当前缓冲区
   ============================================================ */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(process.cwd())
const PKG = 'com.littlewriterforest.app'
const APK = join(ROOT, '小笔苗-debug.apk')
const TAG = '[语音转写]'

/**
 * 是不是「被直接当命令跑」，而不是被 import。
 *
 * 加这个判断是为了让分析器能被单测直接调用（scripts/verify-device.test.ts）——
 * 见下面 analyzeEntries 那段。**顶层不能有任何副作用**，否则一 import 就会
 * 去找 adb、去读 logcat。所以 argv 解析和 adb 查找全都挪进了 main()。
 */
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

function fail(msg, hint) {
  console.error(`\n✖ ${msg}`)
  if (hint) console.error(`\n  ${hint}`)
  console.error('')
  process.exit(1)
}

/* ---------------- 找 adb ---------------- */

function findAdb() {
  const candidates = [
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe'),
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    'adb',
  ].filter(Boolean)
  for (const c of candidates) {
    try {
      execFileSync(c, ['version'], { stdio: 'pipe' })
      return c
    } catch {
      /* 试下一个 */
    }
  }
  return null
}

async function main() {
  const argv = process.argv.slice(2)
  const dumpIdx = argv.indexOf('--dump')
  const DUMP = dumpIdx >= 0 ? argv[dumpIdx + 1] : null
  const NO_WAIT = argv.includes('--no-wait')
  const adb = findAdb()

  /* ---------------- 模式一：分析日志文件 ---------------- */

  if (DUMP) {
    if (!existsSync(DUMP)) fail(`找不到日志文件：${DUMP}`)
    analyze(readFileSync(DUMP, 'utf8'), DUMP)
  } else {
    if (!adb) {
      fail(
        '没找到 adb',
        '装 Android SDK Platform-Tools，或把 ANDROID_HOME 指到 SDK 目录。\n' +
          '  典型位置：C:\\Users\\<你>\\AppData\\Local\\Android\\Sdk',
      )
    }

    const devices = parseDevices(execFileSync(adb, ['devices'], { encoding: 'utf8' }))
    if (devices.ready.length === 0) {
      fail('没有可用的手机', noDeviceHint(devices))
    }
    if (devices.ready.length > 1) {
      console.log(`\n  ⚠ 接了 ${devices.ready.length} 台设备，用第一台：${devices.ready[0]}`)
    }
    const serial = devices.ready[0]
    const A = (args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', maxBuffer: 128 << 20 })

    console.log(`\n  设备  ${serial}`)
    checkInstalled(A)

    if (!NO_WAIT) {
      console.log('\n  已清空 logcat 缓冲区。')
      console.log('\n  ┌──────────────────────────────────────────────┐')
      console.log('  │  现在拿起手机：                              │')
      console.log('  │  1. 进「写作文」页（或任意有麦克风的页）      │')
      console.log('  │  2. 按住麦克风按钮，清楚地说一句话，松手      │')
      console.log('  │  3. 等界面出结果（或明确报错）                │')
      console.log('  └──────────────────────────────────────────────┘')
      console.log('')
      A(['logcat', '-c'])
      await waitEnter('  说完之后按回车出结论… ')
      // 给 WebView 一点时间把最后几行刷进 logcat
      await sleep(600)
    }

    const raw = A(['logcat', '-d', '-s', 'Capacitor/Console'])
    analyze(raw, null)
  }
}

/* ---------------- 工具 ---------------- */

/**
 * 解析 `adb devices` 的输出。
 *
 * ★ 关键是**分清三种"连了但用不了"**，不能一律当成"没连手机"：
 *
 *     serial\tunauthorized   ← 手机上还没点"允许 USB 调试"
 *     serial\toffline        ← 线接触不良 / 设备正在重启
 *     serial\tdevice         ← 唯一能用的状态
 *
 * 原来只认最后一种，其余全落到"没有连上手机"那句提示上 ——
 * 于是最常见的情况（手机明明插着、只是弹窗没点）会被引去
 * "检查数据线和 USB 调试开关"，而真正该做的是**看手机屏幕点允许**。
 * 提示指错方向比不提示更费时间。
 *
 * 真实输出还夹着这些噪声，都要排掉：
 *     List of devices attached
 *     * daemon not running; starting now at tcp:5037
 *     * daemon started successfully
 *
 * 抽成纯函数是为了能被单测直接喂各种输出形态（见 verify-device.test.ts）。
 */
export function parseDevices(stdout) {
  const ready = []
  const unauthorized = []
  const offline = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('*') || line.startsWith('List of devices')) continue
    const [serial, state] = line.split(/\s+/)
    if (!serial || !state) continue
    if (state === 'device') ready.push(serial)
    else if (state === 'unauthorized') unauthorized.push(serial)
    else if (state === 'offline') offline.push(serial)
  }
  return { ready, unauthorized, offline }
}

/** 没拿到可用设备时，按"卡在哪一步"给对应的提示 */
export function noDeviceHint({ unauthorized = [], offline = [] } = {}) {
  if (unauthorized.length > 0) {
    return (
      `手机连上了，但还没授权 USB 调试（${unauthorized.join(', ')}）。\n` +
      '  → **看手机屏幕**，应该有个「允许 USB 调试吗？」的弹窗，点「允许」。\n' +
      '    没弹窗就拔插一次数据线；还不行去开发者选项里「撤销 USB 调试授权」再插。'
    )
  }
  if (offline.length > 0) {
    return (
      `手机连着，但处于 offline 状态（${offline.join(', ')}）。\n` +
      '  → 通常是线接触不良、或设备正在重启。换根线 / 换个 USB 口，等它起来再试。'
    )
  }
  return (
    '用数据线连上、手机选「传输文件」而不是「仅充电」，\n' +
    '  然后在手机的开发者选项里打开「USB 调试」，并在弹窗里点允许。\n' +
    '  连好后 `adb devices` 应该能看到设备号。'
  )
}

/**
 * 手机上装的到底是不是本地这份 APK。
 *
 * 这是真机验收里**最容易犯**的错：改了代码、重新打了包，
 * 结果手机上还是上一版 —— 然后盯着一个已经修好的问题查半天。
 * （和 scripts/_verify-apk.mjs 是同一个担心，只是那边查包、这边查机器。）
 */
function checkInstalled(A) {
  const pkgs = A(['shell', 'pm', 'list', 'packages']).split(/\r?\n/)
  if (!pkgs.some((l) => l.includes(PKG))) {
    fail(
      `手机上没装 ${PKG}`,
      `先装一次：adb -s <设备号> install -r "${APK}"`,
    )
  }

  const ver = A(['shell', 'dumpsys', 'package', PKG])
  const versionName = /versionName=(\S+)/.exec(ver)?.[1] ?? '?'
  const lastUpdate = /lastUpdateTime=(\S+)/.exec(ver)?.[1] ?? null

  // 拿手机上那份 APK 的 md5 和本地比 —— 比版本号可靠得多（debug 包版本号不变）
  let same = null
  try {
    const path = /package:(.+)/.exec(A(['shell', 'pm', 'path', PKG]))?.[1]?.trim()
    if (path) {
      const onDevice = /([0-9a-f]{32})/.exec(A(['shell', 'md5sum', path]))?.[1]
      const local = execFileSync('md5sum', [APK], { encoding: 'utf8' }).split(/\s+/)[0]
      if (onDevice) same = onDevice === local
    }
  } catch {
    /* 有些机器没有 md5sum，退回时间戳判断 */
  }

  console.log(`  版本  ${versionName}   ${lastUpdate ? `更新于 ${lastUpdate}` : ''}`)

  if (same === true) {
    console.log(`  包体  ✓ 手机上装的正是本地这份 ${APK.split(/[\\/]/).pop()}\n`)
    return
  }
  if (same === false) {
    fail(
      '手机上装的**不是**本地这份 APK',
      '你大概在测旧包。先重新安装：\n' +
        `    adb -s <设备号> install -r "${APK}"\n` +
        '  （本地这份是 npm run apk 产出的，装完再跑一次本脚本。）',
    )
  }

  // 兜底：比时间
  if (lastUpdate && existsSync(APK)) {
    const t = Number(lastUpdate)
    if (Number.isFinite(t) && t > 0 && statSync(APK).mtimeMs - t > 5 * 60 * 1000) {
      console.log(`  包体  ⚠ 本地 APK 比手机上的新，可能测的是旧包（继续分析，但留意）\n`)
      return
    }
  }
  console.log(`  包体  · 没法比对（这台机器没有 md5sum），跳过\n`)
}

function waitEnter(prompt) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, () => {
      rl.close()
      res()
    })
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------- 分析 ---------------- */

/**
 * 把 logcat 还原成一条链路。
 *
 * 每个环节按**顺序**检查，第一个缺失的环节就是断点。
 * 顺序检查是关键：只看"有没有某条日志"会误判 ——
 * 比如"成功"和"网络失败"都可能出现（第一枪超时、第二枪成功）。
 *
 * 补充信息不是靠正则去抠的：Capacitor 把 console.log 的第二个参数
 * JSON.stringify 之后拼在消息后面，所以这里直接 JSON.parse 回来。
 * （一开始用正则匹配 `ms:` 是错的 —— 序列化之后是 `"ms":`，抠不出来，
 *   而抠不出来的表现是"数字不显示"，不报错。这种假绿正是本脚本要防的。）
 */
function analyze(raw, file) {
  const entries = raw
    .split(/\r?\n/)
    .filter((l) => l.includes(TAG))
    .map((l) => {
      const rest = l.slice(l.indexOf(TAG) + TAG.length).trim()
      const braceAt = rest.indexOf('{')
      const msg = (braceAt >= 0 ? rest.slice(0, braceAt) : rest).trim()
      let data = {}
      if (braceAt >= 0) {
        try {
          data = JSON.parse(rest.slice(braceAt))
        } catch {
          /* 不是 JSON 就算了，msg 本身还有用 */
        }
      }
      return { msg, data, raw: rest }
    })

  console.log(file ? `\n  日志  ${file}` : '\n  日志  adb logcat（Capacitor/Console）')
  console.log(`  命中  ${entries.length} 条 ${TAG}\n`)

  if (entries.length === 0) {
    fail(
      '一条语音日志都没抓到',
      '按可能性排：\n' +
        '  ① 装的是 release 包（release 不往 logcat 送日志）→ 重装 npm run apk 产出的 debug 包\n' +
        '  ② 根本没按到麦克风按钮 → 确认页面上那个按钮是可用的（没配密钥时它是灰的）\n' +
        '  ③ 日志缓冲区被冲掉了 → 重跑一次，先清空再立刻说\n' +
        '  ④ 手机上装的还是旧包（旧包里没有这些日志）→ 重装',
    )
  }

  for (const e of entries) console.log(`    ${e.raw}`)
  console.log('')

  const has = (s) => entries.some((e) => e.msg.includes(s))
  const lastOf = (s) => [...entries].reverse().find((e) => e.msg.includes(s))

  /**
   * 只认「这一条」日志 —— 排掉包含同一子串的其它日志。
   *
   * 为什么需要：`流式终稿超时` 里**含有** `流式终稿` 这个子串。
   * 用 lastOf('流式终稿') 去取终稿，超时那一轮会取到超时那条
   * （它带的是 `最后文本`，不是 `文本`），于是"识别到"那行是空的。
   * 同类坑之前踩过一次：`录音结束但没有音频` 含 `录音结束`。
   */
  const lastOfExact = (s, exclude = []) =>
    [...entries].reverse().find((e) => e.msg.includes(s) && !exclude.some((x) => e.msg.includes(x)))

  /*
   * ★ 先判断这一轮走的是哪条链路。
   *
   * 两条路的日志**完全不同名**：流式打的是 `PCM 采集已启动` / `流式已连上`，
   * 整包上传打的是 `麦克风已打开` / `开始录制`。
   * 拿一条路的判据去套另一条，会把断点指到一个**根本没问题的环节**上 ——
   * 比如默认配置走流式，却去等 `麦克风已打开`，于是报
   * 「按下按钮 / 拿到麦克风 ← 断在这里」，把人引去查权限和按钮。
   * 默认配置现在就是流式，所以这是真机上第一次验收最容易撞上的误判。
   */
  const UPLOAD_MARKS = ['麦克风已打开', '开始录制', '录音结束', '开始转写', '上传']
  const hasStreamMark = entries.some((e) => e.msg.startsWith('流式') || e.msg.includes('PCM 采集'))
  const hasUploadMark = entries.some((e) => UPLOAD_MARKS.some((m) => e.msg.includes(m)))
  /* 只有「麦克风打开失败」这种两边**共用**的日志时，按默认配置（流式）算 ——
     否则会把断点指到整包上传那条链的「录制启动」上。 */
  const isStreaming = hasStreamMark || !hasUploadMark

  /*
   * ★ 判据：**只有这一环真的成功了才算 hit**，失败日志一律不放进 or。
   *
   *   这样「← 断在这里」才会落在**真正出问题的那一环**上。
   *   反面教材（写这节时自己先踩了一次）：把 `流式连不上` 放进
   *   「连上语音服务」的 or 里，于是连接失败被算成"走到了"，
   *   断点被推到下一环「边说边传」—— 而那一环压根没机会开始。
   *   这正是本脚本要消灭的"指错方向"。
   *
   *   （整包上传那条链的最后一环把终止态放进 or 是另一回事：
   *     它的最后一环本来就叫"服务端回话"，回什么都算走到了那一步。）
   */
  const CHAIN_STREAM = [
    { step: '按下按钮 / 拿到麦克风', mark: 'PCM 采集已启动' },
    { step: '连上语音服务', mark: '流式已连上' },
    { step: '边说边传（松手发最后一包）', mark: '流式已发最后一包' },
    {
      step: '拿到终稿',
      mark: '流式终稿',
      /*
       * ⚠️ `流式终稿超时` 里**含有** `流式终稿` 这个子串 —— 必须排掉。
       *    不排的话，超时会被当成"拿到了终稿"，断点被推到下一环（写进正文），
       *    而真正的病灶（收尾没回来）反而没被标出来。
       */
      not: ['流式终稿超时'],
    },
    { step: '写进正文', mark: '流式成功' },
  ]

  const CHAIN_UPLOAD = [
    { step: '按下按钮 / 拿到麦克风', mark: '麦克风已打开', or: ['麦克风打开失败'] },
    { step: '录制启动', mark: '开始录制' },
    // ⚠️ '录音结束但没有音频' 里**含有** '录音结束' 这个子串，
    //    所以必须用 not 排掉，否则空录音会被当成"录到了"。
    { step: '录到音频', mark: '录音结束', not: ['录音结束但没有音频'] },
    { step: '进入转写', mark: '开始转写' },
    { step: '发往服务端', mark: '上传' },
    { step: '服务端回话', mark: '成功', or: ['服务端拒绝', '网络失败', '服务端回话了但没听出内容'] },
  ]

  const CHAIN = isStreaming ? CHAIN_STREAM : CHAIN_UPLOAD

  const done = CHAIN.map((c) => ({
    ...c,
    hit: (has(c.mark) && !(c.not ?? []).some(has)) || (c.or ?? []).some(has),
  }))
  const firstMiss = done.findIndex((c) => !c.hit)

  console.log(`  链路  ${isStreaming ? '边说边传（流式）' : '录完再传（整包上传）'}`)
  done.forEach((c, i) => {
    const mark = c.hit ? '✓' : i === firstMiss ? '✖' : '·'
    console.log(`    ${mark} ${c.step}${!c.hit && i === firstMiss ? '   ← 断在这里' : ''}`)
  })
  console.log('')

  /* ---------------- 结论 ---------------- */

  const ok = lastOfExact('成功', ['流式测试连接成功'])
  if (ok) {
    const ms = ok.data.ms
    console.log(`  ✓ 通了${ms ? ` —— ${isStreaming ? '全程' : '端到端'} ${ms}ms` : ''}`)

    /*
     * 两条路的「成功」日志形状不一样：
     *   · 整包上传：{ ms, chars, text }
     *   · 流式：    { ms, 字数 }，文本在「流式终稿」那条上
     * 而且流式多一个整包上传**没有**的指标 —— 首字时间。
     * 负数表示文字在孩子松手**之前**就上屏了，那正是上流式的全部理由；
     * 只报一个"全程 ms"是看不出这件事的（全程里含孩子说话的时间）。
     */
    const final = lastOfExact('流式终稿', ['流式终稿超时'])
    const shown = final?.data?.文本 ?? ok.data.text ?? ''
    if (shown) console.log(`    识别到：${shown}`)

    const first = final?.data?.首字ms
    if (typeof first === 'number') {
      console.log(
        first < 0
          ? `    首字 ${-first}ms —— **松手之前**就上屏了（流式的收益就在这里）`
          : `    首字 ${first}ms（松手之后才出字）`,
      )
    }

    // clip() 截断时会补一个 `…(N字)`，拿它判断"这条日志里的文本是不全的"。
    // 不要拿 text.length 和 chars 比大小 —— 补上去的后缀会让长度超过 chars，
    // 边界上（刚过 60 字）就漏判了。
    if (shown.includes('…(')) {
      const total = final?.data?.字数 ?? ok.data.chars
      console.log(`    （日志里只留了前 60 字，原话 ${total ?? '?'} 字）`)
    }
    console.log('')
    process.exit(0)
  }

  /* ---------------- 流式（边说边传）那条路的失败特征 ----------------
     放在整包上传那几条**前面**：两条路的日志名不重叠，但先认自己的更清楚，
     也免得以后有人加了一条重叠判据之后两边互相干扰。 */

  /* ★ 连不上 —— 真机第一次验收最可能撞上的就是这条 */
  const connectFail = lastOf('流式连不上')
  if (connectFail) {
    const msg = String(connectFail.data.message ?? '')
    console.log('  ✖ 没能连上语音服务（连接就没建起来，音频一个字节都没发出去）')
    console.log(`    ${msg || connectFail.raw}`)
    if (/原生 WebSocket 插件没有响应/.test(msg)) {
      console.log(
        '\n    插件没注册上 —— 这**不是**网络问题，也不是密钥问题。\n' +
          '    说明这个包里没有 VolcWs 插件（或注册时抛了异常）。\n' +
          '    确认装的是 `npm run apk` 产出的最新 debug 包。',
      )
    } else if (/40[13]|unauthor|forbidden|denied/i.test(msg)) {
      console.log('\n    403/401 → 密钥不对，或者这个账号没开通「流式语音识别」服务。')
      console.log('    注意：流式用的资源 ID 和「录音文件识别」**不是同一个**（见 README）。')
    } else if (/超时|timeout/i.test(msg)) {
      console.log('\n    握手超时 → 手机没网，或者当前网络不让连 wss。')
    } else {
      console.log('\n    多半是网络：手机没网、或当前网络不让连 wss。')
    }
    console.log('')
    process.exit(1)
  }

  /* 服务端在协议层拒绝了（最典型的是音频格式不收） */
  const errFrame = lastOf('流式服务端错误帧')
  if (errFrame) {
    console.log(`  ✖ 服务端在协议层拒了这次连接（错误码 ${errFrame.data.code ?? '?'}）`)
    if (errFrame.data.text) console.log(`    服务端原话：${errFrame.data.text}`)
    console.log('\n    这类错误码指向"我们发的东西它不认" —— 帧格式或音频格式。')
    console.log('    例：45000151 = 不支持的音频格式（webm 就不收，只能用 pcm）。')
    console.log('')
    process.exit(1)
  }

  const errCode = lastOf('流式服务端返回错误码')
  if (errCode) {
    console.log(`  ✖ 服务端回了错误码 ${errCode.data.code ?? '?'}`)
    if (errCode.data.message) console.log(`    ${errCode.data.message}`)
    console.log('')
    process.exit(1)
  }

  const connErr = lastOf('流式连接出错')
  if (connErr) {
    console.log('  ✖ 连接中途出错')
    console.log(`    ${connErr.data.message ?? connErr.raw}`)
    console.log('')
    process.exit(1)
  }

  /* 松手比建连还快 —— 这一轮音频全丢 */
  if (has('流式没连上就松手了')) {
    const e = lastOf('流式没连上就松手了')
    console.log('  ✖ 松手的时候还没连上 —— 这一轮的音频全丢了')
    console.log(`    ${e.raw}`)
    console.log(
      '\n    按住的时间太短（要盖过建连的 150~300ms），或者这一枪握手特别慢。\n' +
        '    让孩子按住多说两个字，别一按就松。',
    )
    console.log('')
    process.exit(1)
  }

  /* ★ 终稿超时 —— 症状是"白等 20 秒"，最容易被误当成网络问题 */
  const finishTimeout = lastOf('流式终稿超时')
  if (finishTimeout) {
    console.log('  ✖ 松手之后一直没等到终稿（等满了超时时间）')
    console.log(`    ${finishTimeout.raw}`)
    console.log(
      '\n    音频早就发过去了，卡住的是**收尾**。常见成因：\n' +
        '      · 最后一包没发出去（会话结束是靠标志位表达的，不是某个 finish 事件）\n' +
        '      · 网络恰好在收尾那一下断了',
    )
    console.log('')
    process.exit(1)
  }

  if (has('流式被关闭但没拿到终稿')) {
    const e = lastOf('流式被关闭但没拿到终稿')
    console.log('  ✖ 连接被关掉了，而且没拿到终稿')
    console.log(`    ${e.raw}`)
    console.log('')
    process.exit(1)
  }

  if (has('流式收尾抛了异常')) {
    const e = lastOf('流式收尾抛了异常')
    console.log('  ✖ 收尾时抛了异常')
    console.log(`    ${e.data.err ?? e.raw}`)
    console.log('')
    process.exit(1)
  }

  /* 采到 0 个采样点 —— 流式版的"空录音" */
  const pcmDone = lastOf('PCM 采集结束')
  if (pcmDone && !(pcmDone.data.采样点 > 0)) {
    console.log('  ✖ 麦克风开了、采集也启动了，但一个采样点都没收到')
    console.log(`    ${pcmDone.raw}`)
    console.log('    这是安卓 WebView 采集最典型的坑：设备给了轨道，却不出数据。')
    console.log('    试试：确认手机没被别的 App 占着麦克风（通话/录音机/微信语音）。')
    console.log('')
    process.exit(1)
  }

  const rejected = lastOf('服务端拒绝')
  if (rejected) {
    const status = rejected.data.status
    console.log(`  ✖ 服务端拒绝了这次请求${status ? `（HTTP ${status}）` : ''}`)
    if (rejected.data.body) console.log(`    服务端原话：${rejected.data.body}`)
    console.log('\n    401/403 → 密钥不对；429 → 被限流；400 → 模型名或音频格式不合口味；5xx → 服务端自己出问题')
    console.log('    对应处理见 README「语音转文字」一节。\n')
    process.exit(1)
  }

  const net = lastOf('网络失败')
  if (net || has('全部尝试都失败')) {
    const e = net ?? lastOf('全部尝试都失败')
    console.log('  ✖ 请求没能走通（网络层）')
    if (e.data.err) console.log(`    ${e.data.err}`)
    console.log(
      e.data.aborted
        ? '\n    是超时被中断的 —— 说明连上了但服务端一直不回话。\n'
        : '\n    不是超时，是连接本身失败（DNS / 被墙 / 手机没网）。\n',
    )
    if (e.data.ms) console.log(`    这一枪花了 ${e.data.ms}ms\n`)
    process.exit(1)
  }

  if (has('录音结束但没有音频')) {
    const e = lastOf('录音结束但没有音频')
    console.log('  ✖ 麦克风开了、录制也启动了，但一个数据块都没收到')
    console.log(`    ${e.raw}`)
    console.log('    这是安卓 WebView 录音最典型的坑：设备给了轨道，却不出数据。')
    console.log('    试试：确认手机没被别的 App 占着麦克风（通话/录音机/微信语音）。\n')
    process.exit(1)
  }

  if (has('麦克风打开失败')) {
    const e = lastOf('麦克风打开失败')
    console.log('  ✖ 麦克风没能打开')
    console.log(`    ${e.data.err ?? e.raw}`)
    console.log('\n    NotAllowedError  → 权限被拒（去系统设置里给「小笔苗」开麦克风权限）')
    console.log('    NotFoundError    → 没有可用的输入设备')
    console.log('    NotReadableError → 被别的 App 占着\n')
    process.exit(1)
  }

  if (has('中途放弃（手指滑出按钮）') && !has('上传')) {
    console.log('  · 这一轮是你自己松手滑出去了，不算故障。再按住说一次。\n')
    process.exit(2)
  }

  if (has('按得太短，没拿到音频')) {
    console.log('  · 按得太短，被当成误触丢掉了（这是设计行为）。按住多说几个字。\n')
    process.exit(2)
  }

  if (has('上传') && !has('服务端拒绝') && !has('网络失败')) {
    console.log('  ✖ 请求发出去了，然后就没了 —— 大概率是超时（那条"网络失败"还没落盘）')
    console.log('    等 15 秒再跑一次 `npm run verify:device -- --no-wait`，看有没有补上。\n')
    process.exit(1)
  }

  console.log('  ✖ 链路没走完，但没有命中任何已知的失败特征。')
  console.log('    把上面那几行原样贴出来。\n')
  process.exit(1)
}

/* ---------------- 入口 ---------------- */

/*
 * ★ 只有被直接当命令跑时才执行 —— 被 import（比如单测）时这个模块必须是"哑"的。
 *   如果哪天这行判断失灵，表现会是"脚本跑了但什么都没输出"，
 *   这种静默失败正是本脚本要防的东西，所以下面那条自检用例专门盯着它。
 */
if (isMain) await main()
