# 小笔苗 · 环境与验证坑（从 MEMORY.md §八 拆出）
> 这些坑的共同点：**踩了不报错、或报错信息指向别处**。详细原话/实测数字见 `LESSONS.md` §十。

## 一、跑测试 / 判红绿
- ★ **类型检查跑 `npm run lint`**，别敲 `npx tsc --noEmit`（**编译 0 文件却 exit 0**，永远"绿"）。
- ⚠️ 用例数以 **`it(` 静态计数**为准，别按"上次 +N"推（记错过一次：841 vs 842）。
- ★ **判"是不是既有的红"**：把数据**换成开工前那份**复跑，看红的是不是同样那几条。一般化：**「它红了」先问「它红的那个前提今天还成立吗」**。
- ★ 已知根因（09-30）：`_verify-library-editor` 的 8 条红，唯一原因是**脚本假设第一道 `builtin-season-1` 还没有覆盖层条目**（它早就有外链照片了）→ 保存从"新增"变"改写"、计数不动。**是脚本前提过期，不是代码坏了**；要修的是脚本，**改守卫先问家长**。
- ⚠️⚠️ **会写盘的 e2e 必须和「读那个文件的单测」串行跑**。并行 → 单测读到 e2e 中途的脏数据、挂 2 条，**症状像"代码坏了"**。判据：**几条互不相关的用例一起挂 = 先怀疑共享状态**。
- ★★ 改了 `boot()` / 编辑器，要跑**全部**吃它的守卫（踩过：只跑 travel-editor 全绿，browse-edit 红 1 条 —— 它假设"点开是空白条目"）。
- ★ **验证基线（10-02 深夜·转写只剩火山之后）**：`npm run lint` = **0 error / 12 warning**（同时就是类型检查）；`npx vitest run` = **45 files / 928 passed + 0 failed + 0 skipped**。
  - **45 = 47 − 2**：删了 `scripts/transcribe-e2e.test.ts` / `transcribe-bench.test.ts`（只测「整包上传」那条已删的路）。**10 skipped 一起消失** —— 那 10 条就在这两个文件里（各 5 条真服务端用例）。
  - 净变化：915 → 928 通过（+13 新 `volcengine.test.ts`：中间结果兜底 / `'cancelled'` / 预热复用 / PCM 采集守卫；+2 新 `VoiceComposer.test.tsx`：上槽出字必须落正文 + 放弃不许兜底；−2 那两个夹具里本来在跑的 2 条）。
  - e2e：`_verify-travel-editor` **91** / `_verify-browse-edit` **62** / `_verify-default-photo` **16** / `_verify-content-config` **43**；`_verify-library-editor` **37 ✅ / 8 ❌**（那 8 条红见上面那条）。
- ⚠️ **题库的「行数」基线 10-02 深夜变过**（删了 `look-picture` + `comic` 共 11 道）：全量 **420 → 409**、年级 3 的 **372 → 366**、年级 4 的 **412 → 401**；标签 **48 → 46**。`_verify-*.mjs` 和探针里写死的这些数字要跟着改，否则会报「行数对不上」而**看起来像功能坏了**。

## 二、写盘类操作
- ⚠️⚠️ **curl 打"会写盘的 dev 端点"就是真的写盘**（内容包**不在 git 里**）→ 探针要么别打、要么**先备份字节**再 `finally` 还原；**造脏数据用浏览器里包 `fetch`**。
- ⚠️ **故意发坏载荷的探针必须自带还原**（踩过：拆字数闸做变异，探针真把 `landmark-intros.json` 写成 1 条，另 3 条没了）。
- ⚠️⚠️ **变异脚本被 SIGTERM 打断 = `finally` 不跑** → 改动**留在代码里**（踩过：`if (false)` 留在保存函数里）→ 事后必须 `grep -c` 全量对账。

## 三、判改动性质
- ⚠️⚠️ **判"是不是纯追加"只能用自己的开工前备份，不能用 `git diff`** —— `HEAD` 太旧时它会显示几百行增删（实测 `prompts.ts` 报 **408+/136-**，实际是 `inserted 50 / deleted 0`）。
- ⚠️ **dev server 端口会漂**（5190 被别的项目占了、本机同时跑着一堆 4xxx/5xxx）→ **认项目要按 `<title>`，不能只看 200**。
- ★★★ **同一个端口号，`localhost` 和 `127.0.0.1` 可能是两台不同的 App**（实测 09-30 晚）：本机 **IPv4 的 5190 已经被另一个项目「小任务农场 Kid Quest Farm」占着**，我的 vite 只能绑到 **IPv6 `::1`** 上。于是：
  - 我的 vite 在跑时：`http://localhost:5190` → **小笔苗**（走 `::1`），`http://127.0.0.1:5190` → **小任务农场**（走 IPv4）；
  - 我的 vite 一停：**`localhost` 也落到小任务农场**（IPv6 没人应答，回落到 IPv4）。
  ⚠️ 症状极像"我的改动把 App 弄坏了"：探针输出 `找到「题库中选择」: false` / `渲染出的题目行数: 0` / `pageerror: []` / `404: []` —— **不报错、不崩，只是干净地全 0**。`--strictPort` **拦不住**（IPv6 那个端口是空的，照样绑成功），`curl` 也返回 **200**。
  ➜ **判据**：① ★★ **别假设 5190 是自己的** —— 10-01 实测：小笔苗的 vite 一停，`localhost:5190` 直接变成**小任务农场**（`TITLE=小任务农场｜…`，`/src/**` 全部 **404**，`import()` 报 `Failed to fetch dynamically imported module`）。**自己起**：`npx vite --port 5195 --strictPort`（vite 没配端口，5190 是以前手工指定的），再 `curl -s localhost:5195/ | grep -o '<title>[^<]*'` 确认是**小笔苗 · 作文森林**；② **先按 `<title>` 认项目**，别只看 200、也别只看端口号；③ **"干净地全 0"是目标错了的强信号**（真坏是散点）→ 先换 host 复跑，再谈改代码。⚠️ `_site/app-probe.mjs` 文件头注释写的 `127.0.0.1` **在这台机器上是错的**。
- ⚠️ **e2e 脚本的 `cwd` 陷阱**：`_verify-library-editor.mjs` 的 `DATA_FILE` 是**相对 `process.cwd()`** 解析的 → **必须从项目根跑**（否则一开头就 `ENOENT src/data/library-items.json`）；截图用 `SHOT_DIR=<临时目录>` 引开，别在根目录留图。★ 它会**真写盘**（覆盖层）→ 跑前先 `cp` 一份到临时目录，跑完核对 md5。★ 它的 **⑩「保存端点只收本机请求」写死 5190** → 换个端口跑就会 `ECONNREFUSED 172.18.0.1:5190` 崩在那里（①–⑨ 已经跑完，结果有效）。
- ★ **`--strictPort` 之外的坑**：`curl -o /dev/null -w '%{http_code}'` 返回 **200 也不能证明是你的服务**（可能命中的是别人的）。

## 四、工具/环境的静默坑
- ⚠️ **Read 按内容指纹去重、拒绝重看同一张图** → 要看图就**拼放大联系表**（puppeteer + data URI + `screenshot`，一格 560px）。
- ⚠️ **jiti 能跑 TS 但吃不下 JSX**（`scenes.tsx` ParseError → 用正则抠）。
- ⚠️ curl 打 dev server 要 `--noproxy '*'`；**`curl -w` 里别写 `->`**（curl 以 **23** 退出，串在 `&&` 上会把后面命令全跳过）。
- ★★ **起后台 dev server 要用工具的 `run_in_background`，别在命令里写 `&`** —— 命令一返回进程就被收掉：**日志文件是空的、端口不通**，症状像"vite 起不来"。判据是**后台任务自己的 stdout**（vite 会打印 `VITE ready` + `Local: http://localhost:5195/`），不是 curl。
- ★★ **探针脚本要 `import()` 项目模块，就必须写在项目的 `scripts/` 里** —— node 按**脚本所在位置**解析模块，放系统临时目录会 `ERR_MODULE_NOT_FOUND: puppeteer-core`。
- ⚠️ 标签表是 `prompts.ts` 的 **`TOPIC_TAGS`**；**`builtinTags()` 不存在**（题库只有 `builtinBaseItems()`）。
- ⚠️ **bash 的 `/tmp` ≠ node 的 `/tmp`** → 临时文件放仓库里。
- ⚠️ **截图太早会看到灰框**（懒挂 + 外链要下载）→ 先量 `naturalWidth` 再下结论。
- ⚠️ **PowerShell / Python 的 universal newlines 会把 `\r\n` 折成 `\n`**（`io.open(...)` 必须 `newline=''`），否则 `split('\r\n')` 返回一整行、正则匹配 0 处却**不报错**。
- ★★ **行尾是"按文件"的，不是按目录的**（10-02 实测，`src/` 底下三种混着）：
  - **CRLF**：`src/domain/*.ts`（`types.ts` / `ai.ts` / `modelEssay.ts` / `prompts.ts` / `library.ts` / `scoring.ts` / `builtinLibrary.ts`）、`src/domain/*.test.ts` 里的 `prompts.test.ts` / `library.test.ts` / `builtinLibrary.test.ts` / `modelEssay.test.ts` / `ai.test.ts`；
  - **LF**：`src/store/useApp.ts`、`src/store/useApp.test.ts`、`src/db/db.ts`、`src/db/libraryMigration.test.ts`。
  - **语音这条链（10-02 逐字节量过，直接用）** —— **CRLF**：`src/components/VoiceComposer.tsx`、`src/components/VoiceComposer.test.tsx`、`src/platform/volcengine.ts`、`src/domain/types.ts`、`src/features/settings/SettingsPage.tsx`、`README.md`；**LF**：`src/platform/transcribe.ts`、`src/platform/transcribe.test.ts`、`src/platform/volcengine.test.ts`、`src/platform/canHoldToTalk.test.ts`、`src/platform/pcm-capture.ts`、`src/db/db.ts`、`src/db/db.test.ts`、`src/components/VoiceComposer.hold-race.test.tsx`、`scripts/_verify-apk.mjs`、`package.json`。
    ➜ ★ 同一条链上 CRLF / LF 是**混着**的 —— 别按目录猜。改多行的文件**一律**走"读字节 → 定 NL → 把模式和替换串里的 `\n` 都换成 NL → 写字节"，改完再用上面的字节计数复核。
  ➜ 批量改文本**一律**先 `raw = open(p,'rb').read()`，再 `NL = '\r\n' if b'\r\n' in raw else '\n'`，把**模式和替换串里的 `\n` 都换成 NL**；改完**用字节数复核**（`CRLF == LF` 计数说明没被折）。只按目录猜行尾 = 一部分文件命中 0 处而**不报错**。
- ⚠️⚠️ **别信自己拼出来的日志**：我写的那行 `f"...NL={'CRLF' if NL=='\\r\\n' else 'LF'}"`，因为源码里 `'\\r\\n'` 是**4 个字符**（反斜杠 r 反斜杠 n），跟真的 2 字符 CRLF 永不相等 → **7 个文件全印 `NL=LF`，而它们其实是 CRLF**。差一点据此得出"测试文件都是 LF"的反结论。**判行尾只看字节计数**，不看自己打印的标签。
- ⚠️⚠️⚠️ **`grep -cU $'\r' <file>` 也不可信**（10-02 又栽一次）：Git Bash 里 `$'\r'` 一旦被吞成**空模式**，`grep -c ''` 就等于"数所有行" → 一个**纯 LF 文件**也会印出 **`669 / 669`**，看起来像"全 CRLF"，而它 `CRLF=0`。➜ **唯一可信的判据**是字节计数：`raw.count(b'\r\n')` 与 `raw.count(b'\n') - raw.count(b'\r\n')`，两个数**只有一个非零**才算干净（都非零 = MIXED）。★ 复核"改动有没有顺手折了行尾"也一样：`git diff --stat` 里**增删各约等于总行数**才是翻转（否则只是正常改动）。

## 五、git / 文件操作
- ⚠️ 别用 `git checkout --detach <sha>` 逐提交复验（**丢过 46 个文件**）。
- ⚠️ `mv` / `rm` 会报 `cannot stat` 但**其实成功了** → 回头 `ls` 确认。
- ⚠️⚠️⚠️ **同一消息里对同一文件发两个 Edit = 后一个覆盖前一个，而两个都报 `Successfully edited`** → 改多处必须**串行**（每个文件每消息最多一个 Edit）。10-02 又栽一次：`ai.test.ts` 丢的是删 import（被 `TS6133` 逮到），`types.ts` 丢的是**纯注释**（lint **完全不报**，差点蒙混过关）。➜ **改完必须回读那几行**，别信 success 回执。
  ★★ **2026-10-02 又栽了一次，而且这次更难发现**：同一条消息里对 `ai.test.ts` 发了
  两个 Edit（删 import + 改函数签名）、对 `types.ts` 也发了两个 —— **两条消息里各丢了一个**，
  而**两次都报「Successfully edited file」**。是 `npm run lint` 报
  `TS6133: 'scoreWork' is declared but its value is never read` 才露出来的；
  `types.ts` 那个连 lint 都不报（纯注释），差点就这么过去了。
  ➜ **判据**：① 一条消息里**同一个文件只发一个 Edit**；② 真要发多个，
  **改完必须回读那几行**（`sed -n 'a,bp'`），**别信工具的 success**；
  ③ 或者干脆一个 Python 脚本一次改完（还能顺带断言 `count == 1`）。
- ⚠️ 大量文件仍未入库（`??`）→ `checkout` 救不回来。

## 六、已知未做（别当成新 bug 报）
`settings.avatar` 无处显示；`ScoreView.onRecite` 没被传 → 背诵入口永不出现；`speech_probe.wav` **必须入库**。

## 七、驱动真 App 的探针（`scripts/_new50/app-probe4.mjs`）
- **进主界面的引导是 4 屏**：「继续」→「你上几年级？」（**点年级只"选中"、不前进**，屏上另有「继续」）→「每天写几篇？」（出口 **「种下我的树」**）→「我是你的树。」（**唯一「跳过」在这**）。循环里若把"点年级"排在"点继续"前面 → **同一屏死循环**（按钮文案不变、签名不变）。
- ⚠️⚠️ **题库选择器（`LibraryPicker`）初始带着写作台当前的大类筛选** → 打开只渲染 **67** 行；必须点「**全部**」清掉才是全量（09-30 晚现状：年级 3 → **372** 行 / **年级 4 → 412** 行 / **初一 → 420** 行 = 全量）。**不点「全部」就搜不到目标题**，会误判成"图没接上"。★ 行数的账必须能对上：**420 − 48 = 372**（年级 3）、**420 − 8 = 412**（年级 4，只藏 `society`）、**420 − 0 = 420**（初一，所有标签 minGrade ≤ 7 都已解锁）。
- ★★★ **点年级必须用 `gradeLabel()` 的真实文案**：1–6 年级是 `"3 年级"`，**7–9 年级是 `初一` / `初二` / `初三`（不带数字）**。写 `^7 年级$` **永远匹配不到** → 点不中 → **落回默认年级**，跑出来跟上一个年级**一模一样**（实测 372 行 = 年级 3 的数，差点判成"年级筛选坏了"）。
  ➜ 判据：**某次跑出来的数字跟上次完全相同 = 先怀疑"没点中"，别怀疑功能**；反向印证靠"某道题在这个年级该出现/不该出现"（如 `society` minGrade=5：年级 3 搜不到、初一到）。
- ★ 输入框要走 React 的 native setter：`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set` + `dispatchEvent(new Event('input',{bubbles:true}))`，直接改 `value` 不触发 `onChange`。
- ★ 判"图片真渲染了"要量 **`img.naturalWidth > 0`**（`complete` 单看不够）；本项目 `aspect-ratio: 4/3`，**ar ≥ 1.33 安全**。
- ★ `scripts/_site/app-probe.mjs` 现在吃三个环境变量：**`PROBE_GRADE`**（默认 3）、**`PROBE_TARGETS`**（逗号分隔的标题）、**`PROBE_SHOT`**（截图路径）。7–9 年级要额外传 **`PROBE_GRADE_RE`**（如 `'^初一$'`）。验新标签要在**它自己的 minGrade** 上跑，**再跑一次 minGrade−1 确认它确实不出现**（边界测试）—— 实测 `applied-writing` minGrade=4：年级 4 搜得到 8/8 且图全解码，年级 3 三道全 `found:false`。
- ★ 其他可复用的探针：`scripts/_site/render-check.mjs`（`library-browse.html` 的 DOM 卡片数/解码数）、`scripts/_site/req-fail.mjs`（列出页面上所有 4xx/失败请求 —— 用来证明那个 404 **只是 `/favicon.ico`**）。

