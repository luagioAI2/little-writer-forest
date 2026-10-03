/* ============================================================
   内置题库「可编辑字段」的规则 —— **字数上限 + 图片地址形态，唯一的家**
   ============================================================

   什么是「可编辑字段」：内置 136 道题里，家长允许在编辑页上改的那几项 ——
   `title`（标题）、`lead`（引导语）、`imageUrls`（配图外链）。
   改出来的值不写回 `prompts.ts`，而是落进 `src/data/library-items.json`
   这份**覆盖层**（见 `domain/libraryItems.ts` 的文件头）。

   ------------------------------------------------------------
   ★★ 为什么这几条规则要单独一个文件（不是"过度拆分"，是躲一个真实的坑）

     和 `landmarkIntro.ts` 一模一样的原因：`vite.config.ts` 的 tsconfig 是
     `moduleResolution: nodenext`，相对导入**必须带扩展名**。从它引
     `domain/libraryItems.ts` 会把 `domain/library.ts` → `domain/prompts.ts`
     → `domain/types.ts` 一路拉进 node 那个 tsconfig，而它们写的是不带扩展名的
     `from './prompts'` / `from './types'` → 直接 TS2835（实测过同一形状）。

     ➜ 把规则挪到一个**自己不 import 任何东西**的小文件里：
       `vite.config.ts` 和 `src/` 两边都能引，而定义**仍然只有一份**。

   ⚠️ 别为了省一个文件把它抄成两份 —— 抄两份就会出现
      "编辑页说没问题、落盘端点却拒收"这种自相矛盾，而**两边都不报错**。

   ------------------------------------------------------------
   ★★ 判定点（少一处 = 那条路能悄悄存进一个坏值）

     ① `src/domain/libraryItems.test.ts`  —— 盘上每条必须合规（数据侧）
     ② `library-browse.html` 的计数与体检  —— 打字时当场变红（界面侧）
     ③ `vite.config.ts` 的 `/__save-library-items` —— 不合规**拒收**（落盘侧）
        ⚠️ 是**拒收**不是截断：截断是静默的，家长以为存进去了、
           尾巴其实被砍掉，界面上看不出任何区别。

   ------------------------------------------------------------
   ★ 两个字数上限是照着**现有 136 道的实际长度**留了余量定的，不是拍脑袋：

       `title` 实际 2~11 字（最长「卖火柴的小女孩来了我家」）→ 上限 20
       `lead`  实际 10~26 字（最长「选一种你了解的东西，把它的外形、功能、用途介绍清楚。」）→ 上限 60

     ⚠️ 这是**排版闸**（别撑破卡片），不是内容规则 —— 别拿它当"引导语该写多长"的标准。
     ⚠️ 计数口径是 `String.length`（**含标点**），跟编辑器里别处的计数一致。
        换成"只数汉字"会让同一个数字在两个地方算出两个结果。
   ============================================================ */

export const LIBRARY_TITLE_MAX = 20
export const LIBRARY_LEAD_MAX = 60

/**
 * 图片地址的形态检查 —— 编辑页、落盘端点、单元测试**共用这一个**。
 *
 * 规则跟 `sceneImages.ts` 的文件头一致，只多放了一条本地路径：
 *
 *   · `https://…`        ✅ 外链（Pexels 等图库都是这个形状）
 *   · `/photos/x.jpg`    ✅ `public/` 下的相对路径（自己塞进仓库的图）
 *   · `http://…`         ❌ **装进 APK 会被当混合内容拦掉**（APK 跑在 `file://`）
 *   · `//evil.com/x`     ❌ 协议相对会跑到外站，不算本地路径
 *   · 别的               ❌
 *
 * ⚠️ 返回 `null` = 没问题；返回字符串 = 哪里不对（直接当报错文案用）。
 */
export function imageUrlProblem(url: string): string | null {
  const u = url.trim()
  if (!u) return '是空的 —— 不想换这一张就别写它'
  if (/^https:\/\//i.test(u)) return null
  if (u.startsWith('/') && !u.startsWith('//')) return null
  if (/^http:\/\//i.test(u)) {
    return '是 http:// —— 装进 APK 后会被当成混合内容拦掉，换成 https://'
  }
  return '既不是 https:// 外链，也不是 / 开头的本地路径'
}

/** 覆盖层里允许出现的字段 —— 别的键写进去也不会生效，所以要报出来 */
const ALLOWED_KEYS = new Set(['baseTitle', 'baseLead', 'title', 'lead', 'imageUrls'])

/**
 * 覆盖层的**形态**体检 —— 只看"这份 JSON 本身合不合规"，
 * **不需要底稿**，所以落盘端点（`vite.config.ts`）和单元测试都能用同一个。
 *
 * ★★ 这一条是为了**不抄两份**：端点只关心"能不能安全落盘"，
 *    而"这个 id 是不是真的内置题 / baseTitle 对不对得上"必须拿着底稿才能判
 *    （端点故意不去加载 136 条内置题，见 `domain/libraryItems.ts` 的
 *    `checkLibraryOverrides()`，那是跑在单元测试里的那一半）。
 *    ➜ 于是按"要不要底稿"切：**不要底稿的都在这里**，要底稿的在那边。
 *      ⚠️ 别把这里的判定再在那边抄一遍 —— 抄两份 = 同一个值两边说法不一样。
 *
 * ⚠️ 返回**全部**问题（不是遇到第一个就返回）—— 一次看全，别修一个跑一次。
 * ⚠️ 入参是 `unknown`：端点拿到的是 `JSON.parse` 的结果，什么都可能有。
 */
export function libraryItemShapeProblems(parsed: unknown): string[] {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return ['覆盖层必须是一个对象：{ "内置题 id": { baseTitle, baseLead, title?, lead?, imageUrls? } }']
  }

  const errs: string[] = []

  for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!id.trim()) {
      errs.push('有一个键是空的 —— 覆盖必须挂在某个内置题 id 上')
      continue
    }
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      errs.push(`${id}：值必须是一个对象`)
      continue
    }
    const o = v as Record<string, unknown>

    /* baseTitle / baseLead 是防串位的锚，必填且不能是空串 */
    for (const key of ['baseTitle', 'baseLead'] as const) {
      const s = o[key]
      if (typeof s !== 'string' || !s.trim()) {
        errs.push(`${id}：${key} 是空的 —— 它是防 id 串位的锚，必填`)
      }
    }

    /* 两个可改文本：写了就必须是干净的字符串、且不超上限 */
    for (const [key, max] of [
      ['title', LIBRARY_TITLE_MAX],
      ['lead', LIBRARY_LEAD_MAX],
    ] as const) {
      const s = o[key]
      if (s === undefined) continue
      if (typeof s !== 'string') {
        errs.push(`${id}：${key} 不是字符串`)
        continue
      }
      if (!s.trim()) {
        errs.push(`${id}：${key} 是空的 —— 不想改就删掉这个键`)
        continue
      }
      if (s !== s.trim()) {
        errs.push(`${id}：${key} 首尾有空白（落盘会 trim，留着只会让 diff 飘红）`)
        continue
      }
      if (s.length > max) {
        errs.push(`${id}：${key} ${s.length} 字，超过 ${max}（会撑破卡片）`)
      }
    }

    /* 配图：非空数组，每张都要是干净的合法地址 */
    const urls = o.imageUrls
    if (urls !== undefined) {
      if (!Array.isArray(urls) || urls.length === 0) {
        errs.push(`${id}：imageUrls 是空的 —— 不想换就删掉这个键`)
      } else {
        urls.forEach((u, k) => {
          if (typeof u !== 'string') {
            errs.push(`${id}：第 ${k + 1} 张配图不是字符串`)
            return
          }
          if (u !== u.trim()) {
            errs.push(`${id}：第 ${k + 1} 张配图首尾有空白`)
            return
          }
          const why = imageUrlProblem(u)
          if (why) errs.push(`${id}：第 ${k + 1} 张配图 ${why}`)
        })
      }
    }

    /* 不认识的字段：写进去也不会生效，属于"静默失效"，必须报 */
    for (const k of Object.keys(o)) {
      if (!ALLOWED_KEYS.has(k)) errs.push(`${id}：不认识的字段「${k}」（写进去也不会生效）`)
    }

    /*
     * "跟原文一样" = 白写一条。
     * ★ 这里比的是 `baseTitle`/`baseLead`（**同一条记录里就带着**），
     *   所以端点不用加载 136 条底稿也能判 —— 这是覆盖层"只记真的改了的"的前提，
     *   也是"存两次逐字节一样"的前提。
     */
    if (typeof o.title === 'string' && typeof o.baseTitle === 'string' && o.title === o.baseTitle) {
      errs.push(`${id}：标题跟原文一样 —— 没改就别写它`)
    }
    if (typeof o.lead === 'string' && typeof o.baseLead === 'string' && o.lead === o.baseLead) {
      errs.push(`${id}：引导语跟原文一样 —— 没改就别写它`)
    }

    /* 三个可改字段一个都没写 = 这一条毫无意义 */
    if (o.title === undefined && o.lead === undefined && o.imageUrls === undefined) {
      errs.push(`${id}：这一条什么都没改 —— 应该整个删掉`)
    }
  }

  return errs
}
