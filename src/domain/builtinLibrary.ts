/* ============================================================
   内置题库 —— 136 条，随 App 一起来
   ============================================================

   为什么会有这个文件：

   136 道「一个配图一个题」的模板本来就写死在 `prompts.ts` 的
   `PROMPT_TEMPLATES` 里，只是以前只被本地引擎当成**运行时随机池**用
   （抽一条 → 生成一道题 → 题再存进题库），所以新装的 App 里题库是空的，
   孩子点「从题库里挑」看到的是「0 道」。

   现在把这 136 条**直接当成题库条目**摆出来。好处是三件事一起解决：

     · 题库永远不为空 —— 不联网、没配 API 也有 136 道题可挑
     · 出题不再依赖远程 AI（AI 出题的增量本来就只是「同一批题换个说法」）
     · 「一个配图一个题」这个心智模型，孩子和家长一眼就懂

   ⚠️ 两条容易踩的坑：

   ① **内置题不写死进数据库**。
      每次启动用 `reconcileBuiltinLibrary()` 拿代码里的最新模板去对账 ——
      模板改了 / 加了 / 删了，老用户也能跟着更新；
      直接写进 DB 的话，老安装永远是老模板，而且 `清空题库` 会连它们一起清掉。

   ② **内置题不带 `focus`（留空数组）**。
      `focus` 决定评分权重，而权重主要看**年级**（低年级看观察、高年级看结构情感），
      不看题材。这里不知道孩子是几年级，硬填一个「按标签最低年级算的 focus」，
      会让六年级的孩子写「四季」时被按一年级的权重打分。
      留空 → `focusOf()` 自动按「年级 + 题材」推，这才是对的。
   ============================================================ */

import type { LibraryItem } from './library'
import {
  LIBRARY_ITEM_OVERRIDES,
  applyLibraryOverride,
  type LibraryItemOverride,
} from './libraryItems'
import { PROMPT_TEMPLATES, TOPIC_TAGS, wordRangeFor } from './prompts'
import { resolveGenre } from './types'

/** 内置题的 id 前缀 —— 对账时靠它区分「代码里的」和「用户自己的」 */
export const BUILTIN_ID_PREFIX = 'builtin-'

/**
 * 内置题的入库时间。
 *
 * 刻意用 0：题库默认按「最近用过」排序，`addedAt: 0` 会让内置题沉到底部，
 * 孩子自己导入的、AI 出的题浮在上面 —— 这才是我们想要的默认顺序。
 */
export const BUILTIN_ADDED_AT = 0

/**
 * 从模板表生成内置题库 —— **没盖过覆盖层的底稿**。
 *
 * 每条模板 → 一个题库条目，id 形如 `builtin-season-1`：
 * **由标签和序号拼出来，稳定可复现**，所以对账、判重、导出都能靠它。
 *
 * ⚠️ 序号来自 `forEach` 的下标 —— 往数组**最前面**插一条模板，
 *    后面每一条的 id 都会平移。覆盖层靠 `baseTitle`/`baseLead` 认这件事，
 *    见 `libraryItems.ts` 的文件头。
 *
 * ★ 一般别直接用它 —— 用 `buildBuiltinLibrary()`（它会把家长改的那几笔盖上）。
 *   它单独导出的唯一用途是给 `checkLibraryOverrides()` 当"底稿"比对，
 *   以及给"空覆盖层 = 跟今天一模一样"这条测试当基准。
 */
export function builtinBaseItems(): LibraryItem[] {
  const out: LibraryItem[] = []

  for (const tag of TOPIC_TAGS) {
    const templates = PROMPT_TEMPLATES[tag.id]
    if (!templates) continue

    templates.forEach((tpl, i) => {
      out.push({
        id: `${BUILTIN_ID_PREFIX}${tag.id}-${i + 1}`,
        category: tag.category,
        // ★ 这里写**解析后**的值（不是 `tag.requiredGenre`）：内置题一律带上
        //   真实值，下游拿到的题永远不用再判缺省 —— 缺省判定只留在
        //   `resolveGenre()` 一处。
        //   ⚠️ 它是「题目**自带**的格式要求」，不是「这道题是什么文体」——
        //     材料题/话题题不带，走缺省（见 types.ts 文件头）。
        requiredGenre: resolveGenre(tag.requiredGenre),
        // ★ 命题方式：它决定题目能不能自带格式要求，所以必须跟着题目走。
        promptMode: tag.promptMode,
        tagId: tag.id,
        title: tpl.title,
        lead: tpl.lead,
        images: tpl.scenes.map((key, k) => ({
          // ★ `key || undefined` 不能简写成 `key`：`scenes` 里的 `PHOTO_SLOT`（空串）
          //   表示「这一格是纯照片位、没有插画」。空串必须落成 `undefined`，
          //   否则下游会拿 `''` 去查 `sceneMeta`、去拼 `alt`，一路静默。
          //   真实的 sceneKey 永远不会是空串，所以这个转换是单射的。
          sceneKey: key || undefined,
          // 连环图才标「第 N 幅」；单图标了反而啰嗦
          caption: tpl.scenes.length > 1 ? `第 ${k + 1} 幅` : undefined,
        })),
        // 只用于展示（评分不看它，评分按孩子实际写了多少字自适应 —— 见 store 的 wordRangeOf）
        wordRange: wordRangeFor(tag.minGrade),
        // 这个标签从几年级起能写，就一直能写到六年级 —— 所以上界统一给 9
        minGrade: tag.minGrade,
        maxGrade: 9,
        // 见文件头 ②：留空，交给 focusOf 按年级推
        focus: [],
        addedAt: BUILTIN_ADDED_AT,
        source: 'builtin',
        timesUsed: 0,
        aiGenerated: false,
      })
    })
  }

  return out
}

/**
 * 内置题库 —— 底稿 + 家长在编辑页改过的那几笔（`data/library-items.json`）。
 *
 * ★★ 这是**唯一**该被外部调用的入口。覆盖层是"叠加"，不是"替换"：
 *    没改过的题走原样，所以覆盖层是空文件时，输出跟加这个功能之前**逐字节一样**。
 *
 * ⚠️ `overrides` 参数**只有一个用途**：测试里塞一份假的覆盖进去，
 *    证明"合并真的发生了"。日常调用一律不传，走盘上那份。
 *    ★ 为什么非要有这个口子：盘上那份现在是**空的**，
 *      而"空覆盖 ⇒ 输出不变"这条测试**不管合并有没有接线都通过** ——
 *      也就是说，哪天有人把 `applyLibraryOverride` 那一行删了，
 *      整个测试套件依然全绿。这个参数就是用来堵这个盲区的。
 */
export function buildBuiltinLibrary(
  overrides: Readonly<Record<string, LibraryItemOverride>> = LIBRARY_ITEM_OVERRIDES,
): LibraryItem[] {
  return builtinBaseItems().map((item) => {
    const ov = overrides[item.id]
    return ov ? applyLibraryOverride(item, ov) : item
  })
}

/**
 * 对账：拿代码里的最新内置题，去修正数据库里存的那份。
 *
 * 规则：
 *   · 内置题 → **以代码为准**（模板改了内容就跟着变），
 *     但把孩子的**使用痕迹带过来**（用过几次、收藏没收藏、上次什么时候用的）
 *   · 代码里已经没有的内置题（模板被删了）→ 丢掉
 *   · 用户自己的题（AI / 本地 / 导入）→ **原样保留，一条不动**
 *
 * 纯函数，不碰数据库 —— 落盘由调用方决定。
 */
export function reconcileBuiltinLibrary(stored: LibraryItem[]): LibraryItem[] {
  const fresh = buildBuiltinLibrary()
  const oldById = new Map(stored.filter((i) => i.source === 'builtin').map((i) => [i.id, i]))

  const builtins = fresh.map((item) => {
    const old = oldById.get(item.id)
    if (!old) return item
    return {
      ...item,
      timesUsed: old.timesUsed,
      lastUsedAt: old.lastUsedAt,
      favorite: old.favorite,
    }
  })

  // 用户自己的题放在前面，保持它们原本的顺序
  const mine = stored.filter((i) => i.source !== 'builtin')
  return [...mine, ...builtins]
}

/**
 * 判断两个题库是不是「同一批题」—— 只比 id 序列，够用了。
 *
 * 用途：启动对账后决定要不要写数据库。
 * 内容变了不用管：内存里已经是新的，DB 只是缓存，下次对账照样以代码为准。
 */
export function sameLibraryIds(a: LibraryItem[], b: LibraryItem[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id) return false
  }
  return true
}

/** 内置题有多少道 —— 给界面文案用，别在 UI 里写死 136 */
export function builtinCount(): number {
  return buildBuiltinLibrary().length
}
