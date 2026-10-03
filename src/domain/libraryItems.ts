/* ============================================================
   内置题库的「覆盖层」—— 家长在编辑页改过的那几笔
   ============================================================

   数据在 `src/data/library-items.json`，形状是**扁平的 `id → 改了什么`**：

     {
       "builtin-season-1": {
         "baseTitle": "春天的公园",
         "baseLead": "春天来了，公园里全变了样。你看到了什么？",
         "lead": "春天来了，公园里全变了样。你看到了什么？先说给同桌听。",
         "imageUrls": ["https://images.pexels.com/photos/…/pexels-photo-….jpeg"]
       }
     }

   ------------------------------------------------------------
   ★★ 为什么要有一份覆盖层，而不是直接改 `prompts.ts`

     `prompts.ts` 里的 `PROMPT_TEMPLATES` 是**代码**，136 道题由
     `buildBuiltinLibrary()` 每次启动现算。家长想改一句话，得动源码、还得重装 ——
     而旅游点那边之所以能做编辑页，就是因为它有一份 JSON 当"源"。

     ➜ 给内置题补上同一层：**代码仍是底稿，覆盖层只记"改过的"**。
       · 覆盖层里没有的题 → 一个字都不变（所以空文件 = 跟今天完全一样）
       · 覆盖层里有的题 → 只换掉它写了的字段

   ------------------------------------------------------------
   ★★ 为什么每一条都要存 `baseTitle` / `baseLead`（这两个是**防串位**的，别删）

     内置题的 id 是**按序号拼出来的**：`builtin-<标签>-<第几条>`，
     序号来自 `PROMPT_TEMPLATES[tag].forEach((tpl, i) => … i + 1)`。

     ⚠️⚠️ 于是有一个**不报错、不崩、界面上完全看不出来**的坑：
       哪天往某个标签的数组**最前面**插一条模板，后面每一条的序号都会 +1，
       于是 `builtin-season-1` 指的就**不再是「春天的公园」**了。
       这时候覆盖层里那条 `lead` 会**安安静静地盖到另一道题上** ——
       家长只会看到"我改的那句话跑到别处去了"。

     ➜ 存下改的时候的原文，`checkLibraryOverrides()` 每次都对一遍：
       对不上就**报出来**（而不是照盖）。这是"宁可红，不要悄悄错"。

   ------------------------------------------------------------
   ★ 覆盖层**不能**做的事（刻意的，别顺手加）

     · **不能改 id** —— id 是对账（`reconcileBuiltinLibrary`）、
       判重、导出的锚点，id 一变，孩子的使用痕迹就丢了。
     · **不能改 `category` / `tagId`** —— 一道题属于哪个标签是**结构**，
       不是内容。要挪标签就改 `prompts.ts`。
     · **不能加题 / 删题** —— 加删走导入导出那条路（见 `docs/library-inbox.md`）。
     · **不能去掉 `sceneKey`** —— 配图是"**加一层外链**"，不是"换掉插画"。
       `SceneArt` 的优先级是 `题目 imageUrl` → 注册表 → **SVG**，
       外链挂了还能退回插画；把 sceneKey 抹了，图一挂就只剩占位画。
       （`docs/library-data-guide.md`：「重要的题建议两个都填」。）

   ------------------------------------------------------------
   ⚠️ 覆盖层**只管题库条目**，管不到「本地引擎随机出题」

     `prompts.ts` 的 `generateLocalPrompt()`（没配 API 时的兜底）也从
     `PROMPT_TEMPLATES` 里抽模板，但它产出的是**一道新题**（id 是 `p-…`），
     不是内置题库里那 136 条。所以这里改的标题/引导语**不会**跟着过去。

     ★ 这是**故意留着**的边界，不是漏接线：家长改的是"题库里那道题"，
       本地引擎那条路是"临时出一道新的"。要不要让编辑也影响它，
       得家长先点头 —— 别顺手接上（接了会让"我改的题"和"AI 出的题"
       变成同一条，两个概念就混了）。
   ============================================================ */

import type { LibraryItem } from './library'
import { libraryItemShapeProblems } from './libraryItemRules'
import raw from '../data/library-items.json'

/**
 * 一道内置题上"被改过的那几笔"。
 *
 * ⚠️ 只写**真的改了的**字段：没改的字段不出现。
 *    这就是为什么空文件 = 跟今天完全一样，也是"存两次逐字节一样"的前提。
 */
export interface LibraryItemOverride {
  /** 改的时候，这道题原本的标题 —— 防 id 串位，**必填** */
  baseTitle: string
  /** 改的时候，这道题原本的引导语 —— 防 id 串位，**必填** */
  baseLead: string
  /** 新标题；跟 `baseTitle` 一样就别写（写了也会被判"跟原文一样"） */
  title?: string
  /** 新引导语；跟 `baseLead` 一样就别写 */
  lead?: string
  /**
   * 外链配图，**按下标补位**：第 0 个换这题的第 1 张，第 1 个换第 2 张……
   *
   * ⚠️ 只能**从第一张起、连着**换，不能跳着换（「只换第 3 张」做不到）。
   *    136 道里 123 道是单图，13 道连环图（2~3 张）——
   *    连环图要么整组换，要么别动，只换一半会变成"一张照片配两张画"。
   * ⚠️ 长度不能超过这题的张数（`checkLibraryOverrides` 会报）。
   * ⚠️ 换掉的只是 `imageUrl`，`sceneKey` **原样留着**当兜底（见文件头）。
   */
  imageUrls?: string[]
}

/** 盘上那份覆盖层。空对象 = 一道题都没改过。 */
export const LIBRARY_ITEM_OVERRIDES: Record<string, LibraryItemOverride> = raw as Record<
  string,
  LibraryItemOverride
>

/** 改过几道题 —— 给界面文案用，别在 UI 里写死数字 */
export function libraryOverrideCount(): number {
  return Object.keys(LIBRARY_ITEM_OVERRIDES).length
}

/* ------------------------------------------------------------
   把覆盖盖到一道内置题上
   ------------------------------------------------------------
   纯函数：不改传进来的 `item`，返回新对象。
   ⚠️ 只覆盖 `title` / `lead` / `images[k].imageUrl` 这三处，
      id、category、tagId、sceneKey、wordRange、minGrade 一律不动（见文件头）。
*/
export function applyLibraryOverride(item: LibraryItem, ov: LibraryItemOverride): LibraryItem {
  const next: LibraryItem = { ...item }

  if (ov.title) next.title = ov.title
  if (ov.lead) next.lead = ov.lead

  const urls = ov.imageUrls
  if (urls && urls.length > 0) {
    next.images = item.images.map((img, k) => {
      const url = urls[k]
      // ⚠️ 只改 imageUrl，sceneKey / caption 原样留着 —— 外链挂了还能退回插画
      return url ? { ...img, imageUrl: url } : img
    })
  }

  return next
}

/* ------------------------------------------------------------
   体检：盘上那份覆盖层有没有"会静默失效"的错
   ------------------------------------------------------------
   ★ 分两层，别把两层的判定抄来抄去：
     ① `libraryItemShapeProblems()`（在 `libraryItemRules.ts`）——
        **不要底稿**就能判的：类型、空值、首尾空白、字数、地址形态、不认识的字段。
        落盘端点（`vite.config.ts`）用的是**同一个函数**。
     ② 下面这半 —— **必须拿着底稿**才能判的：id 存不存在、baseTitle/baseLead
        对不对得上（防串位）、是不是"跟原文一样"的白写、配图有没有给多。
        端点故意不做这几条：它不去加载 136 条内置题（见 `validateIntros` 的同一取舍）。

   ★ 返回**全部**问题（不是遇到第一个就返回）—— 一次看全，别修一个跑一次。
   ★ `base` 必须传**没盖过覆盖的**底稿（`builtinBaseItems()`）。
     ⚠️ 传 `buildBuiltinLibrary()` 会变成自己跟自己比，永远看不出串位。
*/
export function checkLibraryOverrides(
  overrides: Readonly<Record<string, LibraryItemOverride>> = LIBRARY_ITEM_OVERRIDES,
  base: readonly LibraryItem[],
): string[] {
  // ① 形态问题（跟落盘端点共用同一份判定）
  const out = libraryItemShapeProblems(overrides)

  // ② 只有拿着底稿才能判的
  const byId = new Map(base.map((i) => [i.id, i]))

  for (const [id, ov] of Object.entries(overrides)) {
    const item = byId.get(id)
    if (!item) {
      out.push(`${id}：挂在不存在的内置题上（id 打错一个字，这一笔就永远不生效）`)
      continue
    }

    /* ★★ 防串位：底稿的标题/引导语跟覆盖层记的对不上 = 序号被挪过了 */
    if (ov.baseTitle !== item.title) {
      out.push(
        `${id}：底稿标题是「${item.title}」，覆盖层记的是「${ov.baseTitle}」—— ` +
          `id 可能被挪位了（往数组前面插过模板？），这一笔会盖错题`,
      )
    }
    if (ov.baseLead !== item.lead) {
      out.push(
        `${id}：底稿引导语是「${item.lead}」，覆盖层记的是「${ov.baseLead}」—— ` +
          `id 可能被挪位了（往数组前面插过模板？），这一笔会盖错题`,
      )
    }

    /* "跟原文一样" = 白写一条，已经由 `libraryItemShapeProblems()` 报过（比的是
       `baseTitle`/`baseLead`），这里**不再重复报** —— 两处都报会让同一条错出现两次。 */

    /* 配图不能比这题的张数多（只能从第一张起连着换，不能加图） */
    if (Array.isArray(ov.imageUrls) && ov.imageUrls.length > item.images.length) {
      out.push(
        `${id}：给了 ${ov.imageUrls.length} 张配图，但这题只有 ${item.images.length} 张` +
          `（只能从第一张起连着换，不能加图）`,
      )
    }
  }

  return out
}
