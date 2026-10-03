import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
/*
 * ★ 「景点公共简介」的字数上限 —— **从这里引，别在下面再写一个 300**。
 *   这个数字有三个判定点（数据测试 / 编辑器计数 / 本文件的落盘闸），
 *   抄成三份就会出现"界面说没超、端点却拒收"这种自相矛盾。
 *
 * ⚠️ 引的是 `landmarkIntro.ts` 而**不是** `types.ts`：
 *    本文件的 tsconfig 是 `moduleResolution: nodenext`，相对导入要带扩展名；
 *    而引 `types.ts` 会把 `types.ts` 也拉进 node 那个 tsconfig，
 *    它自己那句不带扩展名的 `import type { CharacterSpec } from './character'`
 *    会直接报 TS2835（实测）。那个小文件自己不 import 任何东西，所以两边都能引。
 */
import { LANDMARK_INTRO_MAX } from './src/domain/landmarkIntro.ts'
/*
 * ★ 内置题库覆盖层的**形态校验** —— 端点与单元测试**共用这一个函数**。
 *   理由同上：这个文件只能引"自己不 import 任何东西"的小文件。
 *   ⚠️ 千万别在这里另写一份校验：抄两份 = 编辑页说没问题、端点却拒收，两边都不报错。
 */
import { libraryItemShapeProblems } from './src/domain/libraryItemRules.ts'

/* ============================================================
   旅行内容包的保存端点（**只在 dev 里存在**）
   ------------------------------------------------------------
   `travel-editor.html` 是个纯静态页，浏览器不能直接写仓库里的文件，
   所以给它一个本地端点。

   ★★ 三层保证它**绝不会进生产包**：
     ① `apply: 'serve'` —— 构建时这个插件整个不加载
     ② `configureServer` —— 只有 dev server 才有这个钩子
     ③ 路径写死成 `src/data/travel-contents.json`，不接受客户端指定
        （否则这个端点就成了"往仓库任意位置写文件"的后门）

   ★ 第四层：**只收本机请求**（`isLoopback`，09-27 补）。
     ⚠️ 这一层不是多余的 —— 根配置里 `server.host` 是开着的
        （联调 APK 要用，是有意的），所以 dev server 实际监听 0.0.0.0，
        "能连上"**不等于**"是本机"。少了它，同一网段里任何设备都能
        写这个文件 —— 而 `src/data/` 大量文件没入库，git 救不回来。
     ⚠️ 原来的注释写着"它不做权限校验，因为 dev server 只监听本机"——
        那句话跟根配置自相矛盾，09-27 已按实际行为改成上面这样。
   ============================================================ */

/** 等级白名单 —— ⚠️ 必须和 `domain/types.ts` 的 `TRAVEL_GRADES` 一致 */
const GRADES = ['顺路', '驻足', '奇遇', '绝景', '传世']

/*
 * ★ `match` 白名单 —— ⚠️ 必须和 `domain/travelContents.ts` 的 `matchOf()` 一致。
 *
 *   它跟 `grade` 是同一类东西：**错的值不许写进文件**。
 *   写进去之后 `matchOf()` 会把它静默降级成 `undefined`，
 *   而 `undefined` 的意思是"家长从没声称过" ——
 *   于是那张「示意图」在相册里就变成了**真地方**，两边都不报错。
 */
const MATCHES = ['place', 'scene']
/*
 * ⚠️ 这里原来还有一份 `TYPES`（photo / music / joke / video / quote / story）白名单，
 *    2026-09-25 连同它的校验一起删了。
 *
 *    家长重新定了口径：「图片是附件的……另外不需要类型。类型是事件，是另外的系统。」
 *    ➜ 内容包里**只有图片附件**，`type` 搬去了**事件系统**
 *      （`domain/travelEvents.ts` + `data/travel-event-contents.json`）。
 *
 *    ★ 为什么不"留着但不校验"：留着的话保存端点会**拒收每一条新内容**
 *      （`c.type` 现在是 `undefined`，`!TYPES.includes(undefined)` 恒真），
 *      而报错信息会说"type 不在白名单里"—— 家长根本没地方填 type，
 *      完全看不懂这句话，只会以为工具坏了。
 */

const TARGET = 'src/data/travel-contents.json'

/**
 * JSON 里一条数据长什么样 —— **这里只声明端点需要的键**。
 *
 * ⚠️ `type` / `place` / `lng` / `lat` / `textContent` 都已删掉：
 *    前四个里 `place` / `lng` / `lat` 改成**从地标派生**（见
 *    `domain/travelContents.ts`），所以它们**不该出现在文件里**；
 *    `type` 与 `textContent` 属于事件系统。
 *    ★ 端点收到带这些键的老数据时不会报错 —— `normalize()` 只输出
 *      上面这几个键，于是**存一次就自动把它们清掉了**。
 */
interface Seed {
  id?: unknown
  landmarkId?: unknown
  title?: unknown
  grade?: unknown
  mediaUrl?: unknown
  credit?: { source?: unknown; link?: unknown; author?: unknown }
  summary?: unknown
  essay?: unknown
  /** ★ 图与地方的关系。写错会被 `matchOf()` 静默降级 —— 所以这里要拦（见 `MATCHES`） */
  match?: unknown
}

/**
 * 体检 —— 在**写盘之前**跑。
 *
 * ★★ 为什么端点上还要再校验一遍（前端已经校验过了）：
 *    前端校验是给人看的（红字提示），后端校验是**保数据**的。
 *    这个端点会把内容写进仓库，而写坏一个 JSON 的后果是
 *    **整个内容包加载失败**（`import` 直接抛错，App 白屏）——
 *    比"少一条内容"严重得多。所以宁可在这里多写一遍。
 *
 * ⚠️ 这里**只做"能不能安全落盘"的检查**，不做内容质量检查
 *    （比如"散文至少 4 段"）—— 那些交给 `travelContents.test.ts`，
 *    因为它们需要"改到一半先存下来"的自由，硬拦会让人没法边写边存。
 */
function validate(list: unknown): string[] {
  const errs: string[] = []
  if (!Array.isArray(list)) return ['顶层必须是数组']
  if (list.length === 0) return ['一条内容都没有 —— 大概是读错了文件，拒绝写盘']

  const ids = new Set<string>()
  list.forEach((raw, i) => {
    const c = raw as Seed
    const at = `第 ${i + 1} 条`
    const id = typeof c.id === 'string' ? c.id.trim() : ''
    if (!id) errs.push(`${at}：缺 id`)
    else if (ids.has(id)) errs.push(`${at}：id「${id}」重复 —— 重复的话后面那条永远选不中`)
    else ids.add(id)

    if (typeof c.title !== 'string' || !c.title.trim()) errs.push(`${at}（${id || '?'}）：缺标题`)

    /*
     * ★★ `landmarkId` 是**必填** —— 图片是挂在地标上的附件。
     *
     *    为什么端点上也要拦：查不到地标的条目会被 `toTravelContent()`
     *    **整条丢掉**（`DROPPED_CONTENT_COUNT`），而丢掉是**静默的** ——
     *    家长存完，界面上什么都没变，他只会觉得"没保存上"，然后再存一遍。
     *    宁可在这里拒收并说清楚。
     *
     * ⚠️ 这里只查"有没有填"，**不查它在不在 `LANDMARKS` 里** ——
     *    端点不该为了这件事去加载那 1808 条地标（那是编辑器和单元测试的活，
     *    编辑器里的只读信息条会当场显示"这个 id 不存在"）。
     */
    if (typeof c.landmarkId !== 'string' || !c.landmarkId.trim())
      errs.push(`${at}（${id || '?'}）：缺 landmarkId —— 图片必须挂在某个景点上`)

    if (typeof c.summary !== 'string' || !c.summary.trim())
      errs.push(`${at}（${id || '?'}）：缺摘要`)

    // ⚠️ 等级允许为空（老条目），但**不允许是错的值** ——
    //    错的值会被 gradeOf() 静默降级成「顺路」，那种错没人看得出来。
    if (c.grade !== undefined && c.grade !== '' && !GRADES.includes(String(c.grade)))
      errs.push(`${at}（${id || '?'}）：grade「${String(c.grade)}」不在 ${GRADES.join('/')} 里`)

    // ⚠️ `match` 同理：允许为空，不允许是错的值。
    //    错的值会被 `matchOf()` 降级成 `undefined`（= "家长从没声称过"），
    //    于是「示意图」被当成真地方显示 —— 正是这个字段要防的事。
    if (c.match !== undefined && c.match !== '' && !MATCHES.includes(String(c.match)))
      errs.push(`${at}（${id || '?'}）：match「${String(c.match)}」不在 ${MATCHES.join('/')} 里`)

    if (c.mediaUrl !== undefined && c.mediaUrl !== '' && typeof c.mediaUrl === 'string') {
      if (!c.mediaUrl.startsWith('https://'))
        errs.push(`${at}（${id || '?'}）：媒体地址不是 https 外链`)
    }
  })
  return errs
}

/** 按固定键序输出 —— 让 git diff 只显示"真的改了什么"，而不是键被重排 */
function normalize(list: Seed[]): Record<string, unknown>[] {
  return list.map((c) => {
    const o: Record<string, unknown> = {
      id: c.id,
      landmarkId: c.landmarkId,
      title: c.title,
      grade: c.grade === '' ? undefined : c.grade,
    }
    if (c.mediaUrl) o.mediaUrl = c.mediaUrl
    /*
     * ★★ `match` 也要写回去（09-26 加）。
     *
     *    `normalize()` 是**白名单**：没列出来的键**存一次就没了**。
     *    漏了 `match` 的话，「就用这张」收进来的那张「示意图」，
     *    家长一保存就丢掉这个标记 —— 而相册从此把它当真地方显示，
     *    没有任何地方会报错。
     *
     *    ⚠️ 空值不写 —— 跟 `grade` / `credit` 同一个道理：给每条都补一个
     *       `"match": null` 会让 git diff 整篇飘红，真正的改动藏在那堆噪音里。
     */
    if (c.match) o.match = c.match
    /*
     * ★★ 空的 credit 要**整个丢掉**，不能留 `{"source":"","link":"","author":""}`。
     *
     *    编辑器读文件时会给**每一条**都补一个空 credit（表单要绑 `credit.source`），
     *    原样写回去的话 —— **第一次保存就会给每条都多出一段空 credit**。
     *    文件的内容其实一点没变，git diff 却整篇飘红，
     *    真正的改动就藏在那堆噪音里看不见了。
     *    （`grade` 的空值同理，见上面那行。）
     *
     *    ⚠️ 别改成"只丢整个为空的 credit" —— 三个子键也要各自丢空的，
     *       否则 `{source:"Unsplash", link:"", author:""}` 和
     *       `{source:"Unsplash"}` 会被当成两种不同的写法，来回抖。
     */
    if (c.credit) {
      const cr: Record<string, unknown> = {
        source: c.credit.source,
        link: c.credit.link,
        author: c.credit.author,
      }
      for (const k of Object.keys(cr)) if (!cr[k]) delete cr[k]
      if (Object.keys(cr).length > 0) o.credit = cr
    }
    o.summary = c.summary
    if (c.essay) o.essay = c.essay
    // 去掉 undefined 的键，让 JSON 里不出现 "grade": null
    for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
    return o
  })
}

function travelContentsSaver(): Plugin {
  return {
    name: 'travel-contents-saver',
    /** ★ 只在 dev 里加载 —— 构建时这个插件整个不存在 */
    apply: 'serve',
    configureServer(server) {
      const file = resolve(process.cwd(), TARGET)

      server.middlewares.use('/__save-travel-contents', (req, res) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(body))
        }

        if (req.method !== 'POST') {
          send(405, { ok: false, errors: ['只接受 POST'] })
          return
        }
        /*
         * ★★ **只收本机请求**（09-27 补）。
         *
         *    原来这里没有这道闸，理由是"dev server 本来就只监听本机"——
         *    但那句话跟根配置**自相矛盾**：`server.host` 是开着的
         *    （联调 APK 要用），所以 dev server 实际监听 0.0.0.0，
         *    "能连上"**不等于**"是本机"。
         *
         *    少了这道闸的后果不是"多一条脏数据"，而是：同一网段里
         *    任何设备都能 POST 一份合法 JSON 覆盖掉家长的内容包 ——
         *    而 `src/data/` 大量文件没入库，git 救不回来。
         *
         *    ⚠️ 别因为"本机闸看起来多余"就删掉：根配置里
         *       `host: true` 是有意的，这个端点不能假设它不存在。
         *       （`_verify-travel-editor.mjs` §11⑥ 就是拿本机网卡地址
         *        打过来验证这道闸的，删了它那条守卫会失去前提。）
         */
        if (!isLoopback(req)) {
          send(403, { ok: false, errors: ['这个端点只接受本机请求'] })
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8')
          // 内容包不大（现在 8KB），但别让一个坏请求把内存吃满
          if (body.length > 4_000_000) body = body.slice(0, 4_000_000)
        })
        req.on('end', () => {
          let parsed: unknown
          try {
            parsed = JSON.parse(body)
          } catch (e) {
            send(400, { ok: false, errors: [`请求体不是合法 JSON：${String(e)}`] })
            return
          }

          const errs = validate(parsed)
          if (errs.length > 0) {
            send(400, { ok: false, errors: errs })
            return
          }

          try {
            const list = normalize(parsed as Seed[])
            writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`, 'utf8')
            send(200, { ok: true, count: list.length, file: TARGET })
          } catch (e) {
            send(500, { ok: false, errors: [`写盘失败：${String(e)}`] })
          }
        })
      })
    },
  }
}

/* ============================================================
   景点公共简介落盘端点（**只在 dev 里存在**）
   ------------------------------------------------------------
   编辑器信息条里那块「景点公共简介」走这里。
   请求体是 **`landmarkId → 简介` 的整张表**（不是条目数组）——
   一个景点一条简介，跟"一张图一条"的内容包是两回事。

   ★ 三件跟 `/__save-travel-contents` **不一样**的事（都是有意的）：

     ① **只收本机请求**（`isLoopback`）。
        根配置 `server.host: true` 让 dev server 监听 0.0.0.0
        （联调 APK 要用，是有意的），所以"能连上"**不等于**"是本机"。
        ✅ 隔壁 `/__save-travel-contents` 09-27 也补上了同一道闸 ——
           现在**三个写盘端点口径一致**，别再出现"某一个忘了查"。

     ② 超 `LANDMARK_INTRO_MAX` 的条目**拒收**，不截断。
        ⚠️ 截断是**静默**的：家长以为存进去了，尾巴其实被砍掉，
           界面上看不出任何区别 —— 正是这个仓库最忌讳的那类失败。

     ③ 写盘前按 id 排序、并丢掉空值。
        这样"存两次"出来的文件**逐字节一样**（幂等），
        git diff 里只会出现真的改了什么。

   ⚠️ 这里**不查 landmarkId 存不存在**：端点不该为了这件事去加载 1600 多条地标。
      那是 `checkLandmarkIntros()` 的活，跑在单元测试里。
   ============================================================ */

const INTRO_TARGET = 'src/data/landmark-intros.json'

/**
 * 简介表校验。★ 只管"能不能安全落盘"，不管业务规则。
 * ⚠️ 返回**全部**问题（不是遇到第一个就返回）—— 一次看全，别修一个跑一次。
 */
function validateIntros(parsed: unknown): string[] {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return ['简介表必须是一个对象：{ "地标 id": "简介" }']
  }
  const errs: string[] = []
  for (const [id, text] of Object.entries(parsed as Record<string, unknown>)) {
    if (!id.trim()) {
      errs.push('有一个键是空的 —— 简介必须挂在某个地标 id 上')
      continue
    }
    if (typeof text !== 'string') {
      errs.push(`${id}：简介不是字符串`)
      continue
    }
    if (!text.trim()) {
      errs.push(`${id}：简介是空的 —— 空的应该直接删掉这个键`)
      continue
    }
    if (text.length > LANDMARK_INTRO_MAX) {
      errs.push(`${id}：简介 ${text.length} 字，超过 ${LANDMARK_INTRO_MAX}`)
    }
  }
  return errs
}

/** 按 id 排序 + 丢空值 → "存两次"出来的文件逐字节一样 */
function normalizeIntros(parsed: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of Object.keys(parsed).sort()) {
    const text = parsed[id]
    if (typeof text !== 'string' || !text.trim()) continue
    out[id] = text.trim()
  }
  return out
}

function landmarkIntrosSaver(): Plugin {
  return {
    name: 'landmark-intros-saver',
    apply: 'serve',
    configureServer(server) {
      const file = resolve(process.cwd(), INTRO_TARGET)

      server.middlewares.use('/__save-landmark-intros', (req, res) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(body))
        }

        if (req.method !== 'POST') {
          send(405, { ok: false, errors: ['只接受 POST'] })
          return
        }
        if (!isLoopback(req)) {
          send(403, { ok: false, errors: ['这个端点只接受本机请求'] })
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8')
          // 简介表很小，但别让一个坏请求把内存吃满
          if (body.length > 2_000_000) body = body.slice(0, 2_000_000)
        })
        req.on('end', () => {
          let parsed: unknown
          try {
            parsed = JSON.parse(body)
          } catch (e) {
            send(400, { ok: false, errors: [`请求体不是合法 JSON：${String(e)}`] })
            return
          }

          const errs = validateIntros(parsed)
          if (errs.length > 0) {
            send(400, { ok: false, errors: errs })
            return
          }

          try {
            const clean = normalizeIntros(parsed as Record<string, unknown>)
            writeFileSync(file, `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
            send(200, { ok: true, count: Object.keys(clean).length, file: INTRO_TARGET })
          } catch (e) {
            send(500, { ok: false, errors: [`写盘失败：${String(e)}`] })
          }
        })
      })
    },
  }
}

/* ============================================================
   内置题库覆盖层的保存端点（**只在 dev 里存在**）
   ------------------------------------------------------------
   `library-browse.html` 是个纯静态页，浏览器不能直接写仓库里的文件，
   所以给它一个本地端点。形状照抄上面的 `/__save-landmark-intros`。

   ★★ 三层保证它**绝不会进生产包**：
     ① `apply: 'serve'` —— 构建时这个插件整个不加载
     ② `configureServer` —— 只有 dev server 才有这个钩子
     ③ 路径写死成 `src/data/library-items.json`，不接受客户端指定
        （否则这个端点就成了"往仓库任意位置写文件"的后门）
   ★ 第四层：**只收本机请求**（`isLoopback`）——
     根配置里 `server.host` 是开着的（联调 APK 要用，是有意的），
     所以 dev server 实际监听 0.0.0.0，"能连上"**不等于**"是本机"。
     ⚠️ `src/data/` 大量文件没入库，git 救不回来 —— 这道闸不是摆设。

   ★★ 校验**只做"能不能安全落盘"那一半**，而且用的是
      `libraryItemShapeProblems()` —— 跟单元测试**同一个函数**（见文件头的 import）。
      ⚠️ "这个 id 是不是真的内置题 / baseTitle 对不对得上"必须拿着 136 条底稿才能判，
         那是 `checkLibraryOverrides()` 的活，跑在单元测试里。
         跟 `validateIntros` 不去查地标存不存在，是同一个取舍。

   ⚠️ 写盘格式必须跟**编辑页发过来的**形状同构（键序、缩进、结尾换行），
      否则第一次保存会让整个文件 diff 飘红 —— 见下面的 `normalizeLibraryItems`。
   ============================================================ */

const LIBRARY_ITEMS_TARGET = 'src/data/library-items.json'

/**
 * 按 id 排序 + 丢掉空值/白写的字段 → "存两次"出来的文件逐字节一样（幂等）。
 *
 * ⚠️ 字段顺序固定成 `baseTitle, baseLead, title, lead, imageUrls` ——
 *    编辑页发过来的顺序必须跟这里一致，不然保存一次整个文件重排。
 * ⚠️ `title === baseTitle`（或 lead 同理）是**白写**，丢掉；三个字段都空就整条丢掉。
 *    这几条 `libraryItemShapeProblems()` 已经报过错了，这里只是"就算报错也存干净"的兜底。
 */
function normalizeLibraryItems(parsed: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const id of Object.keys(parsed).sort()) {
    const v = parsed[id]
    if (v === null || typeof v !== 'object' || Array.isArray(v)) continue
    const src = v as Record<string, unknown>

    const entry: Record<string, unknown> = {
      baseTitle: src.baseTitle,
      baseLead: src.baseLead,
    }

    const title = typeof src.title === 'string' ? src.title.trim() : ''
    if (title && title !== src.baseTitle) entry.title = title

    const lead = typeof src.lead === 'string' ? src.lead.trim() : ''
    if (lead && lead !== src.baseLead) entry.lead = lead

    if (Array.isArray(src.imageUrls) && src.imageUrls.length > 0) {
      entry.imageUrls = src.imageUrls.map((u) => String(u).trim())
    }

    // 三个可改字段一个都没落下 = 这一条毫无意义，整条丢掉
    if (entry.title === undefined && entry.lead === undefined && entry.imageUrls === undefined) {
      continue
    }
    out[id] = entry
  }

  return out
}

function libraryItemsSaver(): Plugin {
  return {
    name: 'library-items-saver',
    apply: 'serve',
    configureServer(server) {
      const file = resolve(process.cwd(), LIBRARY_ITEMS_TARGET)

      server.middlewares.use('/__save-library-items', (req, res) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(body))
        }

        if (req.method !== 'POST') {
          send(405, { ok: false, errors: ['只接受 POST'] })
          return
        }
        if (!isLoopback(req)) {
          send(403, { ok: false, errors: ['这个端点只接受本机请求'] })
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8')
          // 覆盖层很小，但别让一个坏请求把内存吃满
          if (body.length > 2_000_000) body = body.slice(0, 2_000_000)
        })
        req.on('end', () => {
          let parsed: unknown
          try {
            parsed = JSON.parse(body)
          } catch (e) {
            send(400, { ok: false, errors: [`请求体不是合法 JSON：${String(e)}`] })
            return
          }

          const errs = libraryItemShapeProblems(parsed)
          if (errs.length > 0) {
            send(400, { ok: false, errors: errs })
            return
          }

          try {
            const clean = normalizeLibraryItems(parsed as Record<string, unknown>)
            writeFileSync(file, `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
            send(200, {
              ok: true,
              count: Object.keys(clean).length,
              file: LIBRARY_ITEMS_TARGET,
            })
          } catch (e) {
            send(500, { ok: false, errors: [`写盘失败：${String(e)}`] })
          }
        })
      })
    },
  }
}

/* ============================================================
   散文起稿端点「让小鸟写一篇」（**只在 dev 里存在**）
   ------------------------------------------------------------
   编辑器里那个按钮走这里。

   ★★ 为什么不让浏览器直接调服务商：
     ① 密钥会出现在网页里 —— 家长一按 F12 就看见，截图分享也会带出去；
     ② `api.deepseek.com` 不一定给浏览器发 CORS 头，直连多半被拦；
     ③ 密钥得存 localStorage 才能在刷新后复用 —— 而**这个页面不该存密钥**。
     ➜ 密钥只走「浏览器 → 本机 dev server → 服务商」这一条路。
        服务端**用完即弃**：不写文件、不回显、不打日志、不读环境变量。

   ★★ 三件安全上必须守住的事（动这个函数前先读）：
     ① `apply: 'serve'` —— 构建产物里根本没有这个端点；
     ② **只收本机请求**（下面 `isLoopback`）——
        根配置里 `server.host: true` 让 dev server 监听 0.0.0.0
        （联调 APK 要用，是有意的），所以"能连上"**不等于**"是本机"。
        不加这道闸，同一网段的人就能拿它当免费代理，烧家长自己的额度。
     ③ **不读 `process.env`** —— 这个端点只花"调用方自己递上来的"那把密钥。
        一旦去读环境变量，上面那道本机闸就成了唯一防线，
        漏一次就是替别人付钱。所以这里**故意**没有 env 兜底。

   ⚠️ 密钥**不许**写进任何 `send()` 的返回值 —— 见下面 `redact()`。
   ============================================================ */

/** 生成一篇要等挺久（长文），给足时间；超时返回明确的错误而不是吊死 */
const ESSAY_TIMEOUT_MS = 120_000

interface DraftBody {
  landmarkName?: unknown
  province?: unknown
  summary?: unknown
  baseUrl?: unknown
  model?: unknown
  apiKey?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * 把字符串里出现过的密钥抹掉。
 *
 * ★ 为什么必须有：服务商的报错**偶尔会把请求头或整段请求回显出来**
 *   （"invalid api key: sk-xxx" 就是最常见的形状）。那串东西会被
 *   原样转给前端、显示在提示条上、然后被家长截图发到群里。
 */
function redact(s: string, key: string): string {
  return key ? s.split(key).join('***') : s
}

/**
 * 只认本机请求。
 * ⚠️ `server.host: true` → 监听 0.0.0.0，所以必须自己看一眼来源地址。
 */
function isLoopback(req: IncomingMessage): boolean {
  const ip = req.socket.remoteAddress ?? ''
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

const ESSAY_SYSTEM = `你是一位中国儿童文学作家，为小学生写「旅行散文」。
这些散文会出现在一本给 8-12 岁孩子看的旅行故事集里。

写作要求（违反任何一条都算失败）：
1. 用第一人称「我」写，语气温柔，像孩子自己在讲。
2. 分 4～5 个自然段。
3. 全文 280～420 字。
4. 只写汉字和标点。标点一律用全角（，。！？、：；「」），
   绝对不许出现半角逗号。
5. 不写标题，不写小标题，不用 Markdown 记号（# * - > 等），
   不用 emoji，不写英文单词。
6. 要有具体的画面：看到的样子、听到的声音、闻到的味道、手上的触感、
   当时的心情 —— 至少写到三种感官。
7. 段落之间要有推进：怎么到的、看到了什么、遇到什么、离开时想什么。
   不要四段都在说同一件事。
8. 结尾不要喊口号（「我爱祖国的大好河山」这类），
   落在一个小动作、一个小发现或一句心里话上。
9. 不要说教，不要写「我们要保护环境」「我们要好好学习」这类句子。

★ 关于事实 —— 这一条最重要：
   你只知道下面给你的那几行信息。凡是你不确定的事实
   （年份、门票价格、开放时间、历史细节、人物姓名、数字），
   一律不要写。宁可写得模糊（「很多年前」「一位老匠人」），
   也不许编一个具体的数字或名字。

只输出散文正文，不要输出任何解释、前言或结尾语。`

function buildEssayUserMessage(b: DraftBody): string {
  const name = str(b.landmarkName)
  const lines = [`景点：${name}`]

  const prov = str(b.province)
  if (prov) lines.push(`所在地：${prov}`)

  const summary = str(b.summary)
  if (summary) lines.push(`已有的一句话摘要（**别照抄这句**，它另有用途）：${summary}`)

  /*
   * ⚠️ 2026-09-25：这里原来还有「内容里用的地名」和「原文（格言 / 笑话 / 故事的正文）」
   *    两行。两个输入都删了：
   *      · `place` 现在是**从地标派生**的（等于 `landmarkName`），
   *        再传一遍就是同一个值走两条路 —— 上面那句 `place !== name` 恒假，
   *        整段成了死代码。
   *      · `textContent` 属于**事件系统**（笑话 / 格言 / 故事各有自己的池子），
   *        内容包里只剩图片附件，没有"正文"可给。
   *    ➜ 提示词因此只剩"景点 + 所在地 + 摘要"三行，这是对的：
   *      散文本来就该只依据**地标本身**来写。
   */
  return `请为下面这个景点写一篇散文。\n\n${lines.join('\n')}\n\n直接给正文。`
}

/**
 * 把模型吐出来的东西收拾成能直接落进 JSON 的正文。
 *
 * ★ 为什么要在服务端收拾（而不是把原文塞进编辑框让家长自己删）：
 *   下面这几样**每一样都会让 `travelContents.test.ts` 变红**
 *   （半角逗号 / emoji / 段落数不够），而家长的直觉是"看着挺好的呀"。
 *   与其让他保存完才发现测试红，不如在这里顺手改掉**并如实报出来**。
 *
 * ⚠️ 只做"形状"上的收拾，**一个字都不替它改** ——
 *    不换词、不删句、不润色。散文的质量由家长自己把关。
 */
function cleanEssay(raw: string): { text: string; notes: string[] } {
  const notes: string[] = []
  let s = raw.trim()

  // 模型偶尔还是会把正文包在 ``` 里
  const fence = s.match(/^```[a-z]*\s*([\s\S]*?)```$/i)
  if (fence?.[1]) {
    s = fence[1].trim()
    notes.push('去掉了代码块包裹')
  }

  /*
   * 拆段：**任何换行都当分段**，空的丢掉。
   * 中文散文不会把一段拆成好几行，所以这个拆法对
   * "空行分段"和"单换行分段"两种模型习惯都成立 ——
   * 而后者会让 `split('\n\n')` 数出 1 段，测试直接红。
   */
  let paras = s
    .split(/\r?\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

  // 第一行像标题就丢掉（提示词说了不写标题，但它有时还是写）
  if (paras.length > 1 && paras[0].length <= 16 && !/[。！？，]/.test(paras[0])) {
    notes.push(`去掉了开头像标题的一行：「${paras[0]}」`)
    paras = paras.slice(1)
  }

  // 行首的 markdown 记号
  paras = paras.map((p) => p.replace(/^\s*(?:#{1,6}|[-*+>])\s+/, ''))

  let text = paras.join('\n\n')

  if (text.includes(',')) {
    const n = (text.match(/,/g) ?? []).length
    text = text.replace(/,/g, '，')
    notes.push(`把 ${n} 个半角逗号换成了全角`)
  }

  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/gu
  const hit = text.match(EMOJI)
  if (hit) {
    text = text.replace(EMOJI, '')
    notes.push(`去掉了 ${hit.length} 个 emoji`)
  }

  return { text: text.trim(), notes }
}

function travelEssayDrafter(): Plugin {
  return {
    name: 'travel-essay-drafter',
    /** ★ 只在 dev 里加载 —— 构建时这个插件整个不存在 */
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__draft-essay', (req, res) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(body))
        }

        if (req.method !== 'POST') {
          send(405, { ok: false, errors: ['只接受 POST'] })
          return
        }
        if (!isLoopback(req)) {
          send(403, { ok: false, errors: ['这个端点只接受本机请求'] })
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8')
          if (body.length > 200_000) body = body.slice(0, 200_000)
        })
        req.on('end', () => {
          let parsed: DraftBody
          try {
            parsed = JSON.parse(body) as DraftBody
          } catch (e) {
            send(400, { ok: false, errors: [`请求体不是合法 JSON：${String(e)}`] })
            return
          }

          const apiKey = str(parsed.apiKey)
          const baseUrl = str(parsed.baseUrl).replace(/\/+$/, '')
          const model = str(parsed.model)

          const errs: string[] = []
          if (!str(parsed.landmarkName)) {
            errs.push('没说是哪个景点 —— 这条内容没关联到地标，小鸟不知道写哪儿')
          }
          if (!apiKey) errs.push('没有密钥')
          if (!model) errs.push('没有模型名（页面上没能从 domain/ai.ts 读到默认配置）')
          if (!/^https?:\/\//.test(baseUrl)) errs.push(`接口地址不合法：${baseUrl || '(空)'}`)
          if (errs.length > 0) {
            send(400, { ok: false, errors: errs })
            return
          }

          const t0 = Date.now()
          /*
           * ⚠️ 只读 `content`，**不读 `reasoning_content`** ——
           *    那是思维链，不是文章（和 `domain/ai.ts` 的 callChat 同一个口径）。
           */
          const thinking = /deepseek/i.test(baseUrl) || /^deepseek/i.test(model)
          void (async () => {
            try {
              const upstream = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                  model,
                  messages: [
                    { role: 'system', content: ESSAY_SYSTEM },
                    { role: 'user', content: buildEssayUserMessage(parsed) },
                  ],
                  /*
                   * ★ 思考模式**关掉** —— 和 `parseEditInstruction` 同一个理由：
                   *   思考模式下 `temperature` 会被**静默忽略**（官方文档原话：
                   *   "设置参数不会报错，但也不会生效"），而我们写散文正需要它。
                   * ⚠️ 只有 DeepSeek 认这个扩展字段，别家收到会 400。
                   */
                  ...(thinking ? { thinking: { type: 'disabled' } } : {}),
                  temperature: 0.9,
                }),
                signal: AbortSignal.timeout(ESSAY_TIMEOUT_MS),
              })

              if (!upstream.ok) {
                const txt = await upstream.text().catch(() => '')
                send(502, {
                  ok: false,
                  errors: [`服务商返回 ${upstream.status}：${redact(txt, apiKey).slice(0, 300)}`],
                })
                return
              }

              const json = (await upstream.json()) as {
                choices?: { message?: { content?: string } }[]
              }
              const raw = json.choices?.[0]?.message?.content
              if (typeof raw !== 'string' || !raw.trim()) {
                send(502, { ok: false, errors: ['服务商没有返回内容'] })
                return
              }

              const { text, notes } = cleanEssay(raw)
              if (!text) {
                send(502, { ok: false, errors: ['收拾完之后一个字都不剩了'] })
                return
              }

              send(200, { ok: true, essay: text, notes, model, ms: Date.now() - t0 })
            } catch (e) {
              // ⚠️ 错误信息也要过 redact —— 见上面那个函数的注释
              send(502, { ok: false, errors: [`调服务商失败：${redact(String(e), apiKey)}`] })
            }
          })()
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    travelContentsSaver(),
    landmarkIntrosSaver(),
    libraryItemsSaver(),
    travelEssayDrafter(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // 相对路径：让 APK (file://) 与子目录部署都能正常工作
  base: './',
  server: {
    host: true,
    port: 5190,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
})
