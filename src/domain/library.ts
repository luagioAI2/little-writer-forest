/* ============================================================
   我的作文题库 —— 可搜索 / 随机 / 导出
   ============================================================

   按需求：
     · 题库一开始是**空的**
     · 题目先由 AI 生成
     · 生成过的题自动入库，之后可以搜索、随机抽
     · 题库可以导出（也支持导回）

   所以这是一个纯函数式的集合管理模块，
   真正的持久化交给 db 层。
   ============================================================ */

import type {
  CompositionCategory,
  CompositionGenre,
  CompositionPrompt,
  GradeLevel,
  PromptImage,
  PromptMode,
} from './types'
import { GENRES, PROMPT_MODES, resolveGenre } from './types'
/* prompts.ts 只依赖 types.ts，不会成环 */
import { resolveTagId, tagById } from './prompts'

/** 题库里的一条记录 = 题目 + 使用情况 */
export interface LibraryItem extends CompositionPrompt {
  /** 入库时间 */
  addedAt: number
  /**
   * 出题来源。
   *
   * · `builtin`  —— App 自带的内置题库（136 条，从 `prompts.PROMPT_TEMPLATES` 派生）。
   *                 随 App 一起来，删不掉、也不用联网，是题库永远不为空的原因。
   * · `ai`       —— 远程 AI 现场出的题
   * · `local`    —— 没配 API 时本地引擎抽的题
   * · `imported` —— 从 JSON 文件导进来的题
   */
  source: 'builtin' | 'ai' | 'local' | 'imported'
  /** 被用过几次（每次开始练习 +1） */
  timesUsed: number
  /** 最近一次使用时间 */
  lastUsedAt?: number
  /** 孩子标记的收藏 */
  favorite?: boolean
  /** 是否由 AI 生成（用于筛选） */
  aiGenerated: boolean
}

export type LibrarySort = 'recent' | 'used' | 'grade' | 'title'

export interface LibraryQuery {
  /** 关键词：匹配标题、引导语、标签名 */
  keyword?: string
  category?: CompositionCategory
  grade?: GradeLevel
  tagId?: string
  /** 只要收藏的 */
  favoriteOnly?: boolean
  /** 只要 AI 生成的 */
  aiOnly?: boolean
  sort?: LibrarySort
}

/* ============================================================
   一、增删改
   ============================================================ */

/** 入库 —— 已存在同 id 时替换 */
export function upsertItem(
  items: LibraryItem[],
  prompt: CompositionPrompt,
  opts: { source: LibraryItem['source']; aiGenerated: boolean; now?: number },
): LibraryItem[] {
  const now = opts.now ?? Date.now()
  const existing = items.find((i) => i.id === prompt.id)
  if (existing) {
    return items.map((i) =>
      i.id === prompt.id ? { ...i, ...prompt, aiGenerated: opts.aiGenerated } : i,
    )
  }
  const item: LibraryItem = {
    ...prompt,
    addedAt: now,
    source: opts.source,
    timesUsed: 0,
    aiGenerated: opts.aiGenerated,
  }
  return [item, ...items]
}

export function removeItem(items: LibraryItem[], id: string): LibraryItem[] {
  return items.filter((i) => i.id !== id)
}

export function toggleFavorite(items: LibraryItem[], id: string): LibraryItem[] {
  return items.map((i) => (i.id === id ? { ...i, favorite: !i.favorite } : i))
}

/** 记录一次使用 */
export function markUsed(items: LibraryItem[], id: string, now = Date.now()): LibraryItem[] {
  return items.map((i) =>
    i.id === id ? { ...i, timesUsed: i.timesUsed + 1, lastUsedAt: now } : i,
  )
}

/* ============================================================
   二、查询
   ============================================================ */

export function searchLibrary(items: LibraryItem[], q: LibraryQuery): LibraryItem[] {
  const kw = q.keyword?.trim().toLowerCase() ?? ''

  let out = items.filter((it) => {
    if (q.category && it.category !== q.category) return false
    if (q.tagId && it.tagId !== q.tagId) return false
    if (q.favoriteOnly && !it.favorite) return false
    if (q.aiOnly && !it.aiGenerated) return false
    if (q.grade && (q.grade < it.minGrade || q.grade > it.maxGrade)) return false
    if (kw) {
      const hay = `${it.title} ${it.lead} ${it.tagId} ${it.category}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })

  out = sortLibrary(out, q.sort ?? 'recent')
  return out
}

export function sortLibrary(items: LibraryItem[], sort: LibrarySort): LibraryItem[] {
  const copy = [...items]
  switch (sort) {
    case 'recent':
      return copy.sort((a, b) => (b.lastUsedAt ?? b.addedAt) - (a.lastUsedAt ?? a.addedAt))
    case 'used':
      return copy.sort((a, b) => b.timesUsed - a.timesUsed)
    case 'grade':
      return copy.sort((a, b) => a.minGrade - b.minGrade || a.title.localeCompare(b.title, 'zh'))
    case 'title':
      return copy.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  }
}

/**
 * 随机抽一题。
 *
 * 优先抽「没做过的」和「收藏的」——
 * 前者避免重复，后者尊重孩子的偏好。
 */
export function randomFromLibrary(
  items: LibraryItem[],
  opts: {
    grade?: GradeLevel
    category?: CompositionCategory
    /** 细分标签，如 'campus' / 'season' */
    tagId?: string
    /** 已经做过的题目 id，尽量避开 */
    excludeIds?: string[]
  } = {},
): LibraryItem | undefined {
  let pool = items
  if (opts.grade) {
    pool = pool.filter((i) => opts.grade! >= i.minGrade && opts.grade! <= i.maxGrade)
  }
  if (opts.category) pool = pool.filter((i) => i.category === opts.category)
  if (opts.tagId) pool = pool.filter((i) => i.tagId === opts.tagId)
  // 筛完没结果就逐层放宽：先放宽 tag → 再放宽 category → 最后全库
  if (pool.length === 0 && opts.tagId) {
    pool = items
    if (opts.grade) pool = pool.filter((i) => opts.grade! >= i.minGrade && opts.grade! <= i.maxGrade)
    if (opts.category) pool = pool.filter((i) => i.category === opts.category)
  }
  if (pool.length === 0 && opts.category) {
    pool = items
    if (opts.grade) pool = pool.filter((i) => opts.grade! >= i.minGrade && opts.grade! <= i.maxGrade)
  }
  if (pool.length === 0) pool = items
  if (pool.length === 0) return undefined

  const ex = new Set(opts.excludeIds ?? [])
  const fresh = pool.filter((i) => !ex.has(i.id))
  const finalPool = fresh.length > 0 ? fresh : pool

  // 收藏的题目权重翻倍
  const weighted: LibraryItem[] = []
  for (const it of finalPool) {
    weighted.push(it)
    if (it.favorite) weighted.push(it)
  }
  return weighted[Math.floor(Math.random() * weighted.length)]
}

/* ============================================================
   三、统计
   ============================================================ */

export interface LibraryStats {
  total: number
  byCategory: Record<CompositionCategory, number>
  bySource: { builtin: number; ai: number; local: number; imported: number }
  favorites: number
  totalUses: number
  /** 最常做的题目 */
  mostUsed?: LibraryItem
}

export function libraryStats(items: LibraryItem[]): LibraryStats {
  const byCategory = { scene: 0, person: 0, event: 0, object: 0, imagine: 0 } as Record<
    CompositionCategory,
    number
  >
  const bySource = { builtin: 0, ai: 0, local: 0, imported: 0 }
  let favorites = 0
  let totalUses = 0
  let mostUsed: LibraryItem | undefined

  for (const it of items) {
    byCategory[it.category] += 1
    bySource[it.source] += 1
    if (it.favorite) favorites += 1
    totalUses += it.timesUsed
    if (!mostUsed || it.timesUsed > mostUsed.timesUsed) mostUsed = it
  }

  return {
    total: items.length,
    byCategory,
    bySource,
    favorites,
    totalUses,
    mostUsed: mostUsed && mostUsed.timesUsed > 0 ? mostUsed : undefined,
  }
}

/* ============================================================
   四、导入导出
   ============================================================ */

export const LIBRARY_FORMAT = 'little-writer-forest.library'

export interface LibraryExport {
  format: typeof LIBRARY_FORMAT
  /** v2 起 items[].images 可以带 imageUrl（外链图片路径） */
  version: 2
  exportedAt: number
  count: number
  items: LibraryItem[]
}

export function exportLibrary(items: LibraryItem[], now = Date.now()): LibraryExport {
  return {
    format: LIBRARY_FORMAT,
    version: 2,
    exportedAt: now,
    count: items.length,
    items,
  }
}

export function exportLibraryJson(items: LibraryItem[], now = Date.now()): string {
  return JSON.stringify(exportLibrary(items, now), null, 2)
}

/** 导出的 Markdown —— 方便家长打印出来给孩子看 */
export function exportLibraryMarkdown(items: LibraryItem[]): string {
  const lines: string[] = ['# 我的作文题库', '', `共 ${items.length} 道题`, '']
  const catLabel: Record<CompositionCategory, string> = {
    scene: '写景',
    person: '写人',
    event: '写事',
    object: '状物',
    imagine: '想象',
  }
  const byCat = new Map<CompositionCategory, LibraryItem[]>()
  for (const it of items) {
    const arr = byCat.get(it.category) ?? []
    arr.push(it)
    byCat.set(it.category, arr)
  }
  for (const [cat, arr] of byCat) {
    lines.push(`## ${catLabel[cat]}`, '')
    for (const it of arr) {
      const star = it.favorite ? ' ⭐' : ''
      lines.push(
        `- **${it.title}**${star}　_${it.minGrade}-${it.maxGrade} 年级_　${it.wordRange[0]}-${it.wordRange[1]} 字`,
      )
      lines.push(`  > ${it.lead}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

export interface ImportResult {
  ok: boolean
  items: LibraryItem[]
  /** 新增了几条 */
  added: number
  /** 库里已经有完全一样的题，跳过几条 */
  skipped: number
  /** 文件里有几条数据不合格，被丢掉了 */
  invalid: number
  /** 坏数据的原因（最多留前 5 条，够用户定位就行） */
  problems: string[]
  error?: string
}

/**
 * 导入题库 —— **只加不覆盖**。
 *
 * 两条规则，按顺序判：
 *
 *   ① 和库里某条**完全一样**（标题 + 类别 + 引导语 + 配图都相同）
 *      → 跳过。这样同一份文件导两次不会变成两倍。
 *   ② 其余
 *      → **追加到最前面**。id 和库里撞了也不会覆盖，
 *        而是自动换一个新 id（`dup` → `dup-2`），两份都留着。
 *
 * ⚠️ 任何情况下都**不会删掉或改掉库里已有的题**，导入失败也不会清空题库。
 *    这就是「累加」的全部含义。
 *
 *    为什么不做「同 id 就更新」：那是最容易造成**静默丢数据**的写法。
 *    手写的数据文件常常从 1 开始编号，第二个文件的 `1` 会神不知鬼不觉
 *    盖掉第一个文件的 `1` —— 用户只会觉得「我明明导了两个文件」。
 *    要改一道题，在题库里删掉它再导入；宁可多一条、不要少一条。
 *
 * 接受的输入有三种，都能用：
 *
 *   A. App 导出的完整格式：{ "format": "little-writer-forest.library", "items": [...] }
 *   B. 只要一个数组：       [ {...}, {...} ]
 *   C. 带 items 的对象：    { "items": [...] }
 *
 * 每条题目长这样（除了 images，其余字段和 App 自己出的题完全一样）：
 *
 *   {
 *     "id": "lib-spring-01",           // 可选。填了就能被「更新」；不填就每次都是新题
 *     "category": "scene",             // 必填：scene / person / event / object / imagine
 *                                      //（也认中文：写景 / 写人 / 写事 / 状物 / 想象）
 *     "title": "雨后的校园",            // 必填
 *     "lead": "下雨之后，校园里有什么不一样了？",   // 一句话引导，给孩子看的
 *     "tagId": "天气",                  // 可选，细分标签
 *                                      //（和 category 一样也认中文；写 "weather"
 *                                      //  和写「天气」等价，入库时统一归一化）
 *                                      // 可选值见 prompts.ts 的 TOPIC_TAGS
 *     "wordRange": [100, 300],         // 可选，建议字数，默认 [60, 200]
 *     "minGrade": 3, "maxGrade": 6,    // 可选，默认 1 / 1
 *     "focus": ["observation", "emotion"],        // 可选，评分侧重
 *     "images": [ ... ]                // 可选，见下
 *   }
 *
 * images 有两种写法，可以混用：
 *
 *   // ① 直接给图片地址 —— 多张就是连环图，按顺序排
 *   "images": [
 *     "https://example.com/1.png",
 *     "https://example.com/2.png"
 *   ]
 *
 *   // ② 给对象，可以带说明文字；也能同时给 sceneKey 做兜底
 *   "images": [
 *     { "imageUrl": "https://example.com/1.png", "caption": "下雨了" },
 *     { "imageUrl": "/photos/2.png", "sceneKey": "rainbow" }
 *   ]
 *
 *   · imageUrl 可以是 https 外链，也可以是放在 public/ 下的相对路径
 *     （如 "/photos/2.png"）。**加载失败会退回 sceneKey 的 SVG 插画**，
 *     两个都没给就只剩占位画。
 *   · sceneKey 必须是 assets/scenes.tsx 里真实存在的 key ——
 *     写错不报错，只是永远用不上（跟 sceneImages.ts 的坑一样）。
 *   · 没有配图就写 "images": [] 或者干脆不写。
 */
export function importLibrary(
  existing: LibraryItem[],
  raw: string,
  now = Date.now(),
): ImportResult {
  const fail = (error: string, extra: Partial<ImportResult> = {}): ImportResult => ({
    ok: false,
    items: existing,
    added: 0,
    skipped: 0,
    invalid: 0,
    problems: [],
    error,
    ...extra,
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail('文件不是合法的 JSON')
  }

  const extracted = extractItems(parsed)
  if ('error' in extracted) return fail(extracted.error)

  const valid: LibraryItem[] = []
  const problems: string[] = []
  let invalid = 0

  extracted.items.forEach((it, i) => {
    const r = validateItem(it, now)
    if ('item' in r) {
      valid.push(r.item)
    } else {
      invalid += 1
      if (problems.length < 5) problems.push(`第 ${i + 1} 条：${r.reason}`)
    }
  })

  if (valid.length === 0) {
    return fail('没有可用的题目', { invalid, problems })
  }

  let items = [...existing]
  let added = 0
  let skipped = 0

  for (const v of valid) {
    // ① 库里已经有一条一模一样的 → 跳过，免得同一份文件导两次变成两倍
    if (items.some((i) => fingerprint(i) === fingerprint(v))) {
      skipped += 1
      continue
    }
    // ② 新题。id 和库里撞了也不覆盖，换一个新 id 两份都留着
    const id = items.some((i) => i.id === v.id) ? uniqueId(v.id, items) : v.id
    items = [{ ...v, id }, ...items]
    added += 1
  }

  return { ok: true, items, added, skipped, invalid, problems }
}

/** 从三种可接受的输入形状里把题目数组掏出来 */
function extractItems(parsed: unknown): { items: unknown[] } | { error: string } {
  if (Array.isArray(parsed)) return { items: parsed }
  if (typeof parsed !== 'object' || parsed === null) return { error: '文件内容不是题库格式' }

  const o = parsed as Record<string, unknown>
  // 文件里标了 format 就得对得上 —— 免得把「整机备份」当成题库导进来
  if (typeof o.format === 'string' && o.format !== LIBRARY_FORMAT) {
    return { error: '这不是小笔苗的题库文件' }
  }
  if (!Array.isArray(o.items)) return { error: '题库文件里没有题目' }
  return { items: o.items }
}

/**
 * 判重指纹：标题 + 类别 + 引导语 + 配图。
 * 不含 timesUsed / favorite 这些"使用痕迹" —— 用过几次不该算成另一道题。
 */
function fingerprint(it: Pick<LibraryItem, 'title' | 'category' | 'lead' | 'images'>): string {
  const imgs = it.images
    .map((i) => `${i.sceneKey ?? ''}|${i.imageUrl ?? ''}|${i.caption ?? ''}`)
    .join('>')
  return `${it.category}\u0000${it.title}\u0000${it.lead}\u0000${imgs}`
}

/** 给撞车的 id 找一个没用过的：lib-x → lib-x-2 → lib-x-3 … */
function uniqueId(base: string, items: LibraryItem[]): string {
  const taken = new Set(items.map((i) => i.id))
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

const CATEGORY_ALIAS: Record<string, CompositionCategory> = {
  scene: 'scene',
  person: 'person',
  event: 'event',
  object: 'object',
  imagine: 'imagine',
  // 手写数据文件时图省事直接写中文也认
  写景: 'scene',
  写人: 'person',
  写事: 'event',
  状物: 'object',
  想象: 'imagine',
}

/**
 * 逐条校验。坏数据丢掉，但**把原因说出来** ——
 * 手写的数据文件里一个字段写错就整条消失，不报原因等于让人瞎猜。
 */
function validateItem(
  raw: unknown,
  now: number,
): { item: LibraryItem } | { reason: string } {
  if (typeof raw !== 'object' || raw === null) return { reason: '不是一条题目（应该是个对象）' }
  const o = raw as Record<string, unknown>

  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (!title) return { reason: '缺少 title（题目名字）' }

  const categoryKey = typeof o.category === 'string' ? o.category.trim() : ''
  const category = CATEGORY_ALIAS[categoryKey]
  if (!category) {
    return {
      reason: `category「${categoryKey || '空'}」不认识，只能是 scene / person / event / object / imagine`,
    }
  }

  const images = parseImages(o.images)

  const wr = Array.isArray(o.wordRange) ? (o.wordRange as unknown[]) : []
  const wordRange: [number, number] =
    wr.length === 2 && typeof wr[0] === 'number' && typeof wr[1] === 'number'
      ? [wr[0], wr[1]]
      : [60, 200]

  const focus = Array.isArray(o.focus)
    ? (o.focus as unknown[]).filter(
        (f): f is CompositionPrompt['focus'][number] =>
          f === 'observation' ||
          f === 'structure' ||
          f === 'vocabulary' ||
          f === 'imagination' ||
          f === 'emotion',
      )
    : []

  /* 中文标签也认 —— 跟 tagId 同一条规矩：家长手写数据时写「应用文」
     和写 "applied" 等价。不归一化的话，写中文会静默落回记叙文。 */
  const tagId = typeof o.tagId === 'string' ? resolveTagId(o.tagId) : ''

  return {
    item: {
      id: typeof o.id === 'string' && o.id ? o.id : `imported-${now}-${Math.random().toString(36).slice(2, 8)}`,
      category,
      /* 中文标签也认 —— 家长手写数据时写「天气」和写 "weather" 等价。
         不归一化的话，写中文会静默匹配不上（筛不到题、也不出 emoji）。 */
      tagId,
      /* ★ 格式要求：① 显式写了合法值就用它；② 没写/不认识 → **从标签推**
         （标签自己知道「题目自带了什么格式要求」）；③ 标签也查不到 → 退回记叙文。
         这样导进来的题跟内置题口径一致，不会出现「同一道题两种判定」。

         ⚠️ 认两个 key：`requiredGenre`（2026-10-01 起的名字）和
            `genre`（之前导出的文件里就是这个）—— 老导出文件导回来时，
            少了这一行就会**静默**退回记叙文，一道应用文题悄悄变成记叙文题。
            `parseGenre` 认不出来返回 `undefined`，所以两个 key 可以安全串联。 */
      requiredGenre:
        parseGenre(o.requiredGenre) ??
        parseGenre(o.genre) ??
        resolveGenre(tagById(tagId)?.requiredGenre),
      /* ★ 命题方式：显式写了就用，否则从标签推（`undefined` = 命题作文）。
         ⚠️ 没有「旧名字」可认 —— 2026-10-01 之前的导出里根本没有这个字段，
            所以老文件一律走「从标签推」，那条路是通的。 */
      promptMode: parsePromptMode(o.promptMode) ?? tagById(tagId)?.promptMode,
      title,
      lead: typeof o.lead === 'string' ? o.lead : '',
      images,
      wordRange,
      minGrade: clampGrade(o.minGrade),
      maxGrade: clampGrade(o.maxGrade),
      focus,
      addedAt: typeof o.addedAt === 'number' ? o.addedAt : now,
      source: parseSource(o.source),
      timesUsed: typeof o.timesUsed === 'number' ? o.timesUsed : 0,
      lastUsedAt: typeof o.lastUsedAt === 'number' ? o.lastUsedAt : undefined,
      favorite: o.favorite === true,
      aiGenerated: o.aiGenerated === true,
    },
  }
}

/**
 * 解析配图。
 *
 * 认两种写法：
 *   · 字符串      → 当成图片地址        "images": ["https://a.png", "https://b.png"]
 *   · 对象        → sceneKey / imageUrl / caption
 *
 * 一个都认不出来的条目直接丢掉（不留半条空图）——
 * 空图会让写作台上出现一个「暂无插图」的白框，比没有图更难看。
 */
function parseImages(raw: unknown): PromptImage[] {
  if (!Array.isArray(raw)) return []
  const out: PromptImage[] = []
  for (const im of raw) {
    // 写法一：直接给地址字符串
    if (typeof im === 'string') {
      const url = im.trim()
      if (url) out.push({ imageUrl: url })
      continue
    }
    if (typeof im !== 'object' || im === null) continue
    const m = im as Record<string, unknown>

    const img: PromptImage = {}
    if (typeof m.sceneKey === 'string' && m.sceneKey.trim()) img.sceneKey = m.sceneKey.trim()

    // imageUrl 是正名；url / src / path 是手写文件时最容易顺手写出来的别名，一并认下
    const url = [m.imageUrl, m.url, m.src, m.path].find(
      (v): v is string => typeof v === 'string' && v.trim().length > 0,
    )
    if (url) img.imageUrl = url.trim()

    if (typeof m.caption === 'string' && m.caption) img.caption = m.caption

    if (img.sceneKey || img.imageUrl) out.push(img)
  }
  return out
}

function clampGrade(v: unknown): GradeLevel {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 1
  return Math.max(1, Math.min(9, n)) as GradeLevel
}

/**
 * 认出「题目自带的格式要求」。
 *
 * 和 `parseSource` 一样是**只认白名单**的解析器：认不出来一律返回 `undefined`，
 * 交给调用方去「从标签推」或「退回记叙文」。
 *
 * ⚠️ 这里**必须**返回 `undefined` 而不是 `'narrative'`：
 * 调用方写的是 `parseGenre(x) ?? resolveGenre(tagById(tagId)?.requiredGenre)`，
 * 如果这里把「不认识」硬翻成记叙文，`??` 就永远拿不到右边的值 ——
 * 一道标了 `requiredGenre:'applied'` 的应用文题，只要文件里写了个错别字，
 * 就会被**静默**改成记叙文，而且不报错、不崩、计数还是对的。
 *
 * 中英文都认（`'applied'` 与 `'应用文'` 等价），跟 `tagId` 同一条规矩：
 * 家长手写 JSON 时写中文不应该静默失效。
 */
function parseGenre(v: unknown): CompositionGenre | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (!s) return undefined
  const hit = GENRES.find((g) => g.key === s || g.label === s)
  return hit?.key
}

/**
 * 认出「命题方式」（轴 2）。
 *
 * 和 `parseGenre` 同一条规矩：只认白名单，认不出来一律 `undefined`
 * （交给调用方「从标签推」）。⚠️ 同样**不许**硬翻成 `'assigned'` —— 理由
 * 跟 `parseGenre` 一模一样，`??` 右边还有一层可用的信息。
 *
 * 中英文都认（`'material'` 与 `'材料作文'` 等价）。
 */
function parsePromptMode(v: unknown): PromptMode | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (!s) return undefined
  const hit = PROMPT_MODES.find((m) => m.key === s || m.label === s)
  return hit?.key
}

/**
 * 认出来源。
 *
 * 导出的文件里带着 `source`，导回来时保留 —— 所以「内置题库」导出再导回，
 * 依然会被认成 builtin，然后被指纹判重挡掉，不会变成两倍。
 * 认不出来的（老文件、手写的）一律算 `imported`。
 */
function parseSource(v: unknown): LibraryItem['source'] {
  return v === 'builtin' || v === 'ai' || v === 'local' || v === 'imported' ? v : 'imported'
}

/* ============================================================
   五、去重辅助
   ============================================================ */

/** 判断题库里是否已有同名题目 —— 出题时用来避免重复 */
export function hasTitle(items: LibraryItem[], title: string): boolean {
  return items.some((i) => i.title === title)
}

export function existingTitles(items: LibraryItem[]): string[] {
  return items.map((i) => i.title)
}

/* ============================================================
   六、老存档迁移
   ============================================================ */

/** 2026-10-01 之前存进去的题库记录 —— 文体那个字段还叫 `genre`。 */
type LegacyStoredItem = LibraryItem & { genre?: CompositionGenre }

/**
 * ★★ 把**存在库里的老记录**补齐成当前形状。
 *
 * 2026-10-01：题目的 `genre` 改名成 `requiredGenre`（语义收窄为
 * 「题目**自带**的格式要求」）。改名会改掉**存进去的 key** —— 老用户库里
 * 那批题带的是旧名字，直接读会**全部变成记叙文题**（包括那 8 道应用文题，
 * 以及家长自己导入过的题）。
 *
 * ⚠️ 这个失败是**静默**的：不报错、不崩、题一道不少、界面照常，
 *    只是格式要求悄悄退回缺省了。所以「从库里读题」的路必须全部走它 ——
 *    见 `db.ts` 的 `readLibraryRows()`。
 *
 * ★ 只做一件事：把旧 key 搬到新 key。**不改值、不猜** ——
 *   认不出来就该走缺省（那是 `resolveGenre` 的活，不是这里的）。
 * ★ 已经有新 key 的原样返回（幂等，读多少次都一样）。
 */
export function migrateStoredItem(row: LibraryItem): LibraryItem {
  const legacy = row as LegacyStoredItem
  if (legacy.requiredGenre || !legacy.genre) return row
  return { ...legacy, requiredGenre: legacy.genre }
}
