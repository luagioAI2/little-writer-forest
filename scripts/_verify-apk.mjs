/* ============================================================
   校验 APK 里装的到底是不是「刚构建的那份前端产物」
   ============================================================

   为什么需要它：
   「打包成功」和「包里是新代码」是两件事。下面每一种都会让两者不一致，
   而且**都不会报错**：
     · cap sync 漏跑 / 跑在 build 之前 → 包里是上一版 dist
     · dist 没重新构建 → 包里是旧的
     · 看错了一个旧的 apk 文件 → 校验的对象根本不对
   所以只看 BUILD SUCCESSFUL 是不够的。

   两道校验：
     ① dist/assets/index-<hash>.js 的文件名必须能在 APK 里找到
        （文件名带内容哈希，同名即同一份产物）
     ② 抽几个「今天新加/改动的代码特征」在包里的 bundle 里找一遍
        （反混淆后的特征串，比看版本号可靠）

   跑法：
     node scripts/_verify-apk.mjs [apk路径]
   ============================================================ */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const APK = resolve(process.argv[2] ?? join(ROOT, '小笔苗-debug.apk'))
const DIST = join(ROOT, 'dist', 'assets')

function fail(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

if (!existsSync(APK)) fail(`找不到 APK：${APK}`)

/* ---------------- ① 包内前端产物 vs dist ---------------- */

const distJs = readdirSync(DIST).filter((f) => f.startsWith('index-') && f.endsWith('.js'))
if (distJs.length === 0) fail(`dist/assets 里没有 index-*.js —— 前端还没构建？`)

const list = execFileSync('unzip', ['-l', APK], { encoding: 'utf8', maxBuffer: 64 << 20 })

console.log(`\n  APK   ${basename(APK)}  ${(readFileSync(APK).length / 1024 / 1024).toFixed(2)} MB`)
console.log(`  dist  ${distJs.join(', ')}\n`)

let ok = true
for (const f of distJs) {
  const hit = list.includes(`assets/public/assets/${f}`)
  console.log(`  ① ${hit ? '✓' : '✖'} 包内前端产物与 dist 一致：${f}`)
  if (!hit) ok = false
}

/* ---------------- ② 新代码特征 ---------------- */

/** 解出包里的 bundle */
const dir = mkdtempSync(join(tmpdir(), 'apkchk-'))
execFileSync('unzip', ['-o', '-q', APK, 'assets/public/assets/index-*.js', '-d', dir], { maxBuffer: 64 << 20 })
const jsDir = join(dir, 'assets', 'public', 'assets')
const bundleFile = readdirSync(jsDir).find((f) => f.startsWith('index-') && f.endsWith('.js'))
const src = readFileSync(join(jsDir, bundleFile), 'utf8')

/**
 * 特征用**压缩后的形状**匹配 —— 生产构建会改掉函数名，
 * 所以找的是行为特征（算术式、URL 拼接、常量数组），不是函数名。
 */
const FEATURES = [
  {
    name: '连接预热（按下按钮时 GET /models）',
    test: (s) => s.includes('`/models`') && s.includes('method:`GET`'),
    why: 'warmUpTranscribe：省掉约 160ms 握手',
  },
  {
    name: '自适应首次超时（10s + 0.5s×音频秒）',
    test: (s) => /1e4\+Math\.max\(0,e\)\*\.5/.test(s),
    why: 'firstTimeoutMs：最坏情况从 60s 降到 12.5s',
  },
  {
    name: '旧逻辑已移除（写死的 [60s,12s,12s]）',
    test: (s) => !/\[6e4,12e3,12e3\]/.test(s),
    why: '确认不是「新代码加进去了但旧的还在」',
  },
  {
    name: '语音链路诊断日志（`[语音转写]` 标签）',
    test: (s) => s.includes('[语音转写]'),
    why: 'voiceDiag：真机只能靠 adb logcat 定位断点，没有它就只能靠猜',
  },
  {
    name: '空录音检测（「录音结束但没有音频」）',
    test: (s) => s.includes('录音结束但没有音频'),
    why: '真机上最值得看的一行：区分「没录到」和「没传出去」',
  },
  {
    name: '改写必须留住孩子写的和图上有的（`改写必须留住`）',
    test: (s) => s.includes('改写必须留住'),
    why: '跑偏守卫的清单标题 —— 同一份清单既进提示词、又回来照单核对',
  },
  {
    name: 'ODbL 署名（`OpenStreetMap`）',
    test: (s) => s.includes('OpenStreetMap'),
    why: '法律要求：广东那批旅游点是从 OSM 生成的衍生数据库，署名不许在打包时被丢掉',
  },
  {
    name: '跑偏守卫的补问文案在包里（`跑偏了`）',
    test: (s) => s.includes('跑偏了'),
    why: '缺了说明改写那条路没做「必须留住」的校验，AI 可以整段编',
  },
  {
    name: '亮点照实际产出说（`家长点名的`）',
    test: (s) => s.includes('家长点名的'),
    why: '亮点以前无条件宣称「加了比喻和拟人」—— 这条串只在照实说时才会出现',
  },
  {
    name: '降级时如实交代做不到的家长要求（`本地引擎做不到你在设置里要求的`）',
    test: (s) => s.includes('本地引擎做不到你在设置里要求的'),
    why: 'withUnfulfilledNote：家长点了「排比」而走了本地引擎，必须说清楚而不是装作做到了',
  },
  /* ★ 每加一个功能就往这里补一条 —— 否则它只会验证上一轮的东西，
        "校验通过"变成一句空话。判据用**特征串**，不要用体积。

     ⚠️ 有一类改动**加不进这张表**：纯逻辑修复、没有新的用户可见文案。
       例：2026-09-22「设置里改完昵称再点头像，名字被清空」——
       修的是昵称落盘（边打边存 + 空值兜底），一个新字符串都没有，
       而「小笔苗」这个默认名在包里本来就到处都是，没法当特征。
       这类改动的守卫在**单元测试**里（`SettingsPage.test.tsx`），
       包内只靠上面第 ① 条（bundle 文件名带内容哈希，同名即同一份产物）。
       这不是漏了，是它本来就没有可匹配的字符串 —— 别硬凑一条。 */
  {
    name: '新手引导三屏在包里（`森林里还有这些`）',
    test: (s) => s.includes('森林里还有这些') && s.includes('我是你的树。'),
    why: 'Guide.tsx：种完树之后那几屏',
  },
  {
    /* ★ 2026-09-22：这里原来是一条「引导第二屏的手势跟着设备走
       （`点一下下面的按钮开始说`）」。那一屏（含可交互的录音演示）被家长要求
       **整屏删掉**，那个字符串也就没了 —— 所以那条**必须删掉，不能留着**，
       否则它会永远红（红得还没意义）。
       换成下面这条**否定式**的：确认旧的那屏真的不在了。
       （写法同上面「旧逻辑已移除」——光加新的不够，还要确认旧的没留下。） */
    name: '引导里的录音屏已移除（`你不用会打字` 不在包里）',
    test: (s) => !s.includes('你不用会打字'),
    why: '家长要求去掉：引导跑在配好火山模型之前，而那一屏教哪个手势（按住/点一下）跟着转写配置走 —— 教的和之后遇到的可能不是一套。留着这条是防它被"顺手加回来"',
  },
  {
    name: '改标点那条路在包里（`你想换哪一个`）',
    test: (s) => s.includes('你想换哪一个') && s.includes('不用再加啦'),
    why: 'replace-punct：家长报的「把玩篮球后面的句号改成叹号，始终不行」',
  },
  {
    name: 'DeepSeek 用正式模型名 `deepseek-flash`',
    test: (s) => s.includes('deepseek-flash'),
    why: 'V4.1 Flash 的正式调用名；旧的 deepseek-chat 只是临时兼容路由',
  },
  /* ---- 2026-09-21：改作文 = 必须走 AI + 来源闸门 + 指位 ---- */
  {
    name: '改作文不再静默降级（`改作文要用 AI 才听得懂`）',
    test: (s) => s.includes('改作文要用 AI 才听得懂'),
    why: '家长要求「改作文 必须是 AI 模型处理」—— 没配好时要说明白，不许悄悄退回本地规则顶上',
  },
  {
    name: '来源闸门拦得住模型自创的字（`这几个字你没说过`）',
    test: (s) => s.includes('这几个字你没说过') && s.includes('一次写得太多了'),
    why: 'provenance：禁令的第二道防线 —— 接口形状只挡住了"整篇"，挡不住模型往 to/text 里塞自创的字',
  },
  {
    name: '指位字段进了提示词（`只说了它在哪儿`）',
    test: (s) => s.includes('只说了它在哪儿'),
    why: 'near / side / pick：修「把玩篮球后面的那个字去掉」这类**只说了位置**的说法',
  },
  {
    name: '修改记录标出这一处是 AI 改的（`AI 按你说的`）',
    test: (s) => s.includes('AI 按你说的') && s.includes('按你的话改的'),
    why: 'AI 介入的编辑必须标 by:ai —— 不标就是界面在说假话（孩子会以为是自己动的手）',
  },
  /* ---- 2026-09-21 晚：写作文录音「突然不好使了」那个 401 ---- */
  {
    /*
     * 特征取的是 `sk-` **作为一个完整字符串字面量**（前后都是引号）。
     *
     * 为什么这么绕：`sk-` 在包里本来就有 —— 设置页两个输入框的占位符是
     * `sk-...`（后面跟着三个点）。所以要区分的是「独立的 `sk-`」。
     * 全项目里独立的 `sk-` 字面量**只有一处**：`migrateTranscribeConfig`
     * 里那句 `key.startsWith('sk-')`。旧的（坏的）包里这一条是 0 次，
     * 实测过 —— 所以它能真的把新包和旧包分开，不是一句空话。
     *
     * 引号写成 `['"`]` 是因为压缩器可能把 ' 换成 " —— 别钉死引号。
     */
    name: '语音配置不自洽时整份纠正（`sk-` 前缀判定）',
    test: (s) => /['"`]sk-['"`]/.test(s),
    why: 'migrateTranscribeConfig：老存档没有 engine，会被拼出「火山 + 硅基流动的密钥」→ 拿别家密钥去连火山 → 握手 401 → 一个字都出不来。这条判定就是那个修复',
  },
]

for (const f of FEATURES) {
  const hit = f.test(src)
  console.log(`  ② ${hit ? '✓' : '✖'} ${f.name}`)
  if (!hit) {
    ok = false
    console.log(`       （期望：${f.why}）`)
  }
}

/* ---------------- ③ 内置密钥真的注入了吗 ---------------- */
/*
 * ★ 2026-09-22：内置密钥从源码挪到了构建期注入（`.env.local` 的
 *   `VITE_VOLC_API_KEY`，见 src/platform/transcribe.ts）。
 *   好处是仓库里不留明文；代价是**多了一种静默失败**：
 *     `.env.local` 没建 / 忘了填 → 包里 apiKey 是空串
 *     → 装到手机上「按住说话一个字都出不来」，
 *   而**构建成功、上面 ①② 也全都打勾** —— 不报错、只是没声音。
 *
 *   所以补这一条。期望值从 `.env.local` **现读**，不写进仓库：
 *   只要读到了，就要求它确实在包里。
 *   读不到（CI、别人 clone 下来）就明确跳过并说清后果，不算失败 ——
 *   否则这个脚本在没配密钥的机器上会永远红。
 */
const envLocal = join(ROOT, '.env.local')
let volcKey = ''
if (existsSync(envLocal)) {
  const m = readFileSync(envLocal, 'utf8').match(/^[ \t]*VITE_VOLC_API_KEY[ \t]*=[ \t]*(\S+)[ \t]*$/m)
  volcKey = m ? m[1] : ''
}
if (!volcKey) {
  console.log('  ③ ⚠ 跳过：本机没有 .env.local，或里面的 VITE_VOLC_API_KEY 是空的')
  console.log('       这份包的内置密钥为空 —— 语音转写会退回系统识别（能点、不能按住）。')
  console.log('       要给自己用：补上 .env.local 再重新打包。')
} else {
  const hit = src.includes(volcKey)
  console.log(`  ③ ${hit ? '✓' : '✖'} 内置密钥已注入（期望值取自 .env.local，不入库）`)
  if (!hit) {
    ok = false
    console.log('       （期望：构建期把 VITE_VOLC_API_KEY 注进了 bundle ——')
    console.log('         没注进去 = 装上去录不了音，而构建过程一句错都不会报）')
  }
}

console.log('')
if (!ok) fail('包里的内容和当前代码对不上 —— 别把这份发出去')
console.log('✓ 校验通过：这份 APK 装的就是当前代码\n')
