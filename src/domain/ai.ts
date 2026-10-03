/* ============================================================
   AI 层 —— 出题 / 评分 / 范文 / 日记点评
   ============================================================

   两条通道，产出同一种结构，调用方不需要关心用的是哪条：

     remote —— 调用用户自己配置的 OpenAI 兼容接口（设置页填 Key）
     local  —— 内置规则引擎，无需联网，永远可用

   出题顺序（按需求）：
     先 AI 生成 → 存进「我的作文题库」→ 以后可以搜索 / 随机抽 / 导出

   ★ 关于「能不能改写孩子的作文」—— 这条需求改过，先读这里：

     原始需求：任何通道都**不得改写孩子自己的作文**。
               评分只描述和引导；范文是另起一篇的示范，不覆盖原文。

     现在（家长 2026-09-17 明确要求改的）：
       · 评分（点评）**仍然**只描述和引导，绝不给可抄的句子 —— 这条没变；
       · 但「更好的写法」那一份，**就是要改写孩子的稿子**：
         保留他的思路和故事，只提升描写与结构，改到接近满分。
         孩子看到的是「我这一篇可以长成的样子」，不是别人的范文。
       · 界面文案也据此改过 —— 不再叫「满分范文」，
         因为那既高估了它（不是满分），也误导了它是什么（其实是改写）。

     为什么要把这段留在文件头：上面两条读起来是自相矛盾的，
     后来的人只看函数名 `scoreAndRewrite` 会以为是 bug 而去"修"掉它。

   ★ 2026-09-19 家长第二次报「要结合 图 和 用户写的」之后，
     「改写」这一半多了一道**跑偏守卫**（见下面「一张清单，两处用」那一节）：

       算一份「必须留住」的清单  ──┬──►  写进提示词（点名要求）
                                   └──►  回来后照单核对（一条没留住 = 跑偏）
                                          │
                                          ├─ 跑偏 → 带原话补问一次
                                          └─ 还跑偏 → 写法退回本地并如实标注

     为什么非要有这道关：上一轮只往提示词里加了配图，可**光把图发给模型，
     不等于它会照着写** —— 实测它能把「写雪」改写成「春天的公园」，
     而当时照收不误，界面上还写着「更好的写法」。
   ============================================================ */

import { SCENES } from '../assets/scenes'
import { imageHintText, imageWords } from './imageHints'
import {
  APPLIED_FORM_LABELS,
  appliedShapeOf,
  extractChildMaterial,
  extractConcrete,
  resolveKind,
  unfulfilledDemands,
} from './modelEssay'
import type {
  AiConfig,
  CompositionCategory,
  CompositionGenre,
  CompositionPrompt,
  DiaryReview,
  GradeLevel,
  MindMapNode,
  ModelEssay,
  PromptImage,
  SkeletonLine,
  ScoreDimension,
  StrengthPoint,
  Suggestion,
  WorkScore,
} from './types'
import { CATEGORIES, DIMENSIONS, categoryMeta, resolveGenre } from './types'
import {
  analyzeText,
  buildModelEssay,
  extractSkeleton,
  reviewDiary,
  scoreComposition,
  splitSentences,
  starsForScore,
  type TextAnalysis,
} from './scoring'
import { focusFor, generateLocalPrompt, tagById, tagsFor, wordRangeFor } from './prompts'
// ★ 来源闸门：模型想写"孩子没说过的字"时把它拦下来（见文件顶部注释）
import { checkProvenance } from './provenance'
/*
 * ★ 指位字段（near / side / pick）**只声明一次**，在 voiceEdit.ts 里。
 *   `ParsedEditInstruction` 和执行层的 `EditIntent` 必须是同一套形状 ——
 *   两边各写一遍迟早漂移（§四/§九 那个"同一件事声明两遍"的老毛病）。
 */
import type { OccurrenceHint } from './voiceEdit'

/* ============================================================
   一、通用远程调用
   ============================================================ */

export interface AiCallResult<T> {
  ok: boolean
  data?: T
  /** 实际生效的通道 */
  engine: 'local' | 'remote'
  error?: string
}

const DEFAULT_TIMEOUT = 45_000

/**
 * 这个服务商认不认 `thinking` 这个扩展字段。
 *
 * ★ DeepSeek 的思考模式是**它自己的扩展**（官方文档《思考模式》）。
 *   别的 OpenAI 兼容服务（通义 / Ollama / 各种网关）收到不认识的字段，
 *   有的会忽略、有的直接 400 —— 所以**只对 DeepSeek 发**。
 */
function supportsThinkingParam(cfg: AiConfig): boolean {
  return /deepseek/i.test(cfg.baseUrl) || /^deepseek/i.test(cfg.model)
}

/**
 * 调用 OpenAI 兼容的 chat/completions 接口。
 *
 * 只依赖最通用的那一层协议，所以 OpenAI / DeepSeek / 通义 / 本地
 * Ollama 之类的兼容网关都能直接用。
 */
async function callChat(
  cfg: AiConfig,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts: {
    json?: boolean
    timeoutMs?: number
    signal?: AbortSignal
    /**
     * 显式开关思考模式。
     * 不传 = 不给这个字段，由服务端默认值决定（DeepSeek 那边默认是**开**）。
     *
     * ★ 2026-09-21 加的：以前这里压根没有这个概念，于是"用不用思维链"
     *   完全由服务端默认值说了算，代码里看不出来 —— 而 DeepSeek 的默认是
     *   **enabled + effort=high**。对"把一句话翻成 JSON"这种任务，
     *   思维链只是让孩子白等一场。
     */
    thinking?: boolean
  } = {},
): Promise<string> {
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    throw new Error('AI 还没配置好（需要接口地址、密钥和模型名）')
  }

  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT)

  // 外部传进来的 signal 也要能中断
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  /*
   * 思考模式的字段拼装。官方文档《思考模式》要点：
   *   · 默认**打开**，effort 默认 `high`；
   *   · 开关 `{"thinking": {"type": "enabled" | "disabled"}}`；
   *   · 思考模式下**不支持 `temperature`** —— 传了不报错，但**也不生效**；
   *   · 思维链走 `reasoning_content`，与 `content` 同级。
   * 我们**不传 `tools`**，所以 `reasoning_content` 不需要回传
   * （"必须回传"只针对带 tools 的请求，不回传会 400）。
   */
  const thinkingField =
    opts.thinking !== undefined && supportsThinkingParam(cfg)
      ? { thinking: { type: opts.thinking ? 'enabled' : 'disabled' } }
      : {}

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        ...thinkingField,
        temperature: 0.7,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`接口返回 ${res.status}${body ? `：${body.slice(0, 200)}` : ''}`)
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string; reasoning_content?: string } }[]
    }
    /*
     * ⚠️ 只读 `content`，**故意不读 `reasoning_content`** ——
     *    那是思维链，不是答案；把它当答案会让孩子看到模型的自言自语。
     *    （类型里写上它只是为了说明"我们知道有这个字段、并且有意不用"。）
     */
    const content = json.choices?.[0]?.message?.content
    if (!content) throw new Error('接口没有返回内容')
    return content
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 从模型回复里抠出 JSON。
 *
 * 真实模型经常把 JSON 包在 ```json 里，或者前后加一段客套话，
 * 所以这里做一层容错，而不是直接 JSON.parse 然后崩掉。
 */
export function extractJson<T>(raw: string): T | null {
  const text = raw.trim()

  // 1. 直接就是 JSON
  try {
    return JSON.parse(text) as T
  } catch {
    /* 继续尝试 */
  }

  // 2. 去掉 ```json ... ``` 包裹
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim()) as T
    } catch {
      /* 继续尝试 */
    }
  }

  // 3. 取第一个 { 到最后一个 } 之间的内容
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as T
    } catch {
      /* 放弃 */
    }
  }

  return null
}

/** 判断是否该走远程 */
export function shouldUseRemote(cfg: AiConfig): boolean {
  if (cfg.mode !== 'remote') return false
  return Boolean(cfg.baseUrl && cfg.apiKey && cfg.model)
}

/**
 * 远程模式但配置不全时，告诉调用方缺什么。
 * 只在 mode === 'remote' 时才检查 —— local 模式不需要这些。
 */
export function remoteMissingFields(cfg: AiConfig): string[] {
  if (cfg.mode !== 'remote') return []
  const missing: string[] = []
  if (!cfg.baseUrl) missing.push('接口地址')
  if (!cfg.apiKey) missing.push('密钥')
  if (!cfg.model) missing.push('模型名')
  return missing
}

/* ============================================================
   二、出题
   ============================================================ */

export interface GeneratePromptOptions {
  grade: GradeLevel
  category: CompositionCategory
  /** 指定细分标签；不指定则由 AI / 引擎自己挑 */
  tagId?: string
  /** 已有的题目，避免重复 */
  excludeTitles?: string[]
  cfg: AiConfig
  signal?: AbortSignal
}

export interface GeneratePromptResult {
  prompt: CompositionPrompt
  engine: 'local' | 'remote'
  /** 远程失败时的原因，便于在设置页提示 */
  warning?: string
}

/** 给 AI 的插画清单 —— 只列出合法 key，避免它编出不存在的画面 */
function sceneCatalogForPrompt(category: CompositionCategory): string {
  const list = SCENES.filter((s) => s.fits.includes(category))
  const pool = list.length > 0 ? list : SCENES
  return pool
    .slice(0, 40)
    .map((s) => `${s.key}｜${s.label}｜${s.hint}`)
    .join('\n')
}

const PROMPT_SYSTEM = `你是一位中国小学语文老师，负责给小学生出「看图作文」题目。
你的题目必须：贴近孩子生活、画面感强、难度匹配年级、能让孩子有话可写。
你必须严格输出 JSON，不要输出任何解释文字。`

function buildPromptUserMessage(opts: GeneratePromptOptions): string {
  const tag = opts.tagId ? tagById(opts.tagId) : undefined
  const cat = categoryMeta(opts.category)
  const [lo, hi] = wordRangeFor(opts.grade)
  const avoid = (opts.excludeTitles ?? []).slice(-15)

  return `请为【${opts.grade} 年级】学生出一道「${cat.label}」类看图作文题。

${tag ? `必须围绕细分标签「${tag.label}」（${tag.hint}）。` : `请从这些细分标签里选一个最合适的：${tagsFor(opts.category, opts.grade).map((t) => `${t.id}(${t.label})`).join('、')}。`}

建议字数：${lo}-${hi} 字。
${avoid.length > 0 ? `以下题目已经出过了，请换一个不同的：${avoid.join('、')}` : ''}

可选插画（sceneKey｜名称｜画面内容），你必须从中挑选，不要自己编造 sceneKey：
${sceneCatalogForPrompt(opts.category)}

输出 JSON，字段如下：
{
  "title": "题目，6-12 字，具体有画面感",
  "lead": "一句引导语，用对孩子说话的口吻，15-30 字，不要剧透答案",
  "tagId": "细分标签 id",
  "scenes": ["sceneKey"],        // 1 张单图，或 2-4 张连环图（多图时按事情发展排序）
  "focus": ["observation","structure","vocabulary","imagination","emotion"]  // 挑 2-3 个重点考察维度
}`
}

/**
 * 出题主入口。
 *
 * 先试远程 AI；失败或没配置时自动落到本地引擎，
 * 并带上 warning，让设置页可以提示家长。
 */
export async function generatePrompt(
  opts: GeneratePromptOptions,
): Promise<GeneratePromptResult> {
  const missing = remoteMissingFields(opts.cfg)
  if (missing.length > 0) {
    return {
      prompt: generateLocalPrompt({
        grade: opts.grade,
        category: opts.category,
        tagId: opts.tagId,
        excludeTitles: opts.excludeTitles,
      }),
      engine: 'local',
      warning: `AI 设置里还缺${missing.join('、')}，先用了本地引擎。去设置页补全试试。`,
    }
  }

  try {
    const raw = await callChat(
      opts.cfg,
      [
        { role: 'system', content: PROMPT_SYSTEM },
        { role: 'user', content: buildPromptUserMessage(opts) },
      ],
      { json: true, signal: opts.signal },
    )

    const parsed = extractJson<{
      title?: string
      lead?: string
      tagId?: string
      scenes?: string[]
      focus?: string[]
    }>(raw)

    if (!parsed?.title) throw new Error('AI 返回的题目格式不对')

    const prompt = normalizeGeneratedPrompt(parsed, opts)
    return { prompt, engine: 'remote' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (opts.cfg.fallbackToLocal) {
      return {
        prompt: generateLocalPrompt({
          grade: opts.grade,
          category: opts.category,
          tagId: opts.tagId,
          excludeTitles: opts.excludeTitles,
        }),
        engine: 'local',
        warning: `AI 出题失败，已用本地引擎顶上：${msg}`,
      }
    }
    throw err
  }
}

const VALID_KEYS = new Set(SCENES.map((s) => s.key))

/** 把 AI 返回的松散结构收拾成合法的 CompositionPrompt */
function normalizeGeneratedPrompt(
  parsed: { title?: string; lead?: string; tagId?: string; scenes?: string[]; focus?: string[] },
  opts: GeneratePromptOptions,
): CompositionPrompt {
  const tags = tagsFor(opts.category, opts.grade)
  const tagId =
    parsed.tagId && tags.some((t) => t.id === parsed.tagId)
      ? parsed.tagId
      : (opts.tagId ?? tags[0]?.id ?? '')

  // 只保留真实存在的插画；一个都没有就退回模板里的画面
  let scenes = (parsed.scenes ?? []).filter((s) => VALID_KEYS.has(s))
  if (scenes.length === 0) {
    scenes = [SCENES.find((s) => s.fits.includes(opts.category))?.key ?? 'spring-park']
  }
  scenes = scenes.slice(0, 4)

  const focus = (parsed.focus ?? []).filter((f): f is ScoreDimension =>
    DIMENSIONS.some((d) => d.key === f),
  )

  const now = Date.now()
  const tag = tagById(tagId)
  /*
   * ★ 格式要求先算出来再放进对象 —— 下面的 `focus` 也要用它。
   *   写进对象字面量里就没法被同一字面量的别的字段读到，
   *   到时候又会有人「顺手再算一遍」→ 两份判定（§四）。
   * ⚠️ 判据是标签的 `requiredGenre`（题目**自带**的格式要求，目前只有应用文）。
   */
  const genre = resolveGenre(tag?.requiredGenre)
  return {
    id: `p-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    category: opts.category,
    // ★ 跟内置题、本地题同一条规矩：远程题也带上**解析后**的值。
    //   它由标签决定 —— 模型返回的 tagId 已经过校验，查不到就退回记叙文。
    requiredGenre: genre,
    // ★ 命题方式同样由标签决定（材料题/话题题 → 不带格式要求）。
    promptMode: tag?.promptMode,
    tagId,
    title: (parsed.title ?? '看图作文').trim().slice(0, 24),
    lead: (parsed.lead ?? '看看这张图，你想说些什么？').trim().slice(0, 60),
    images: scenes.map((key, i) => ({
      sceneKey: key,
      caption: scenes.length > 1 ? `第 ${i + 1} 幅` : undefined,
    })),
    wordRange: wordRangeFor(opts.grade),
    minGrade: Math.max(1, opts.grade - 2) as GradeLevel,
    maxGrade: Math.min(9, opts.grade + 2) as GradeLevel,
    focus: focus.length > 0 ? focus : focusFor(opts.grade, opts.category, genre),
  }
}

/* ============================================================
   三、评分
   ============================================================ */

export interface ScoreOptions {
  text: string
  grade: GradeLevel
  category: CompositionCategory
  /** ★ 题目自带的格式要求（2026-09-30）。缺省 = 记叙文。要一路传到范文引擎。 */
  genre?: CompositionGenre
  title: string
  wordRange: [number, number]
  focus: ScoreDimension[]
  images: PromptImage[]
  cfg: AiConfig
  signal?: AbortSignal
}

export interface ScoreResult {
  score: WorkScore
  engine: 'local' | 'remote'
  warning?: string
}

const SCORE_SYSTEM = `你是一位温柔又专业的中国小学语文老师，正在批改学生的看图作文。
你的评语要：以鼓励为主、具体指出好在哪、给可操作的建议。
【绝对禁止】改写、续写、润色学生的原文。你只能描述和引导，不能替学生写任何一句话。
必须严格输出 JSON，不要输出解释文字。`

function buildScoreUserMessage(opts: ScoreOptions, a: TextAnalysis): string {
  return `请批改这篇【${opts.grade} 年级】看图作文。

题目：《${opts.title}》
正文：
"""
${opts.text}
"""

系统已经做了基础统计，供你参考（不要直接复述这些数字，要化成孩子能懂的话）：
- 字数：${a.wordCount}
- 句子数：${a.sentenceCount}
- 发现的好词：${a.goodWords.join('、') || '无'}
- 使用的修辞：${a.rhetoric.map((r) => r.name).join('、') || '无'}
- 动用的感官：${a.senses.join('、') || '无'}
- 关联词：${a.connectors.join('、') || '无'}

输出 JSON：
{
  "dimensions": {
    "observation": 0-100, "structure": 0-100, "vocabulary": 0-100,
    "imagination": 0-100, "emotion": 0-100
  },
  "total": 0-100,
  "summary": "总评，60-100 字，先肯定再建议，语气亲切",
  "strengths": [{ "title": "好在哪(8字内)", "evidence": "引用学生原文里的具体词句作为证据", "emoji": "一个表情" }],
  "suggestions": [{ "title": "建议(10字内)", "how": "具体怎么做，只指方向，绝对不要给出可直接抄的句子", "emoji": "一个表情" }],
  "mindMap": {
    "label": "中心词",
    "emoji": "🌳",
    "children": [
      { "label": "开头", "emoji": "🚪", "children": [{ "label": "内容概括", "emoji": "✏️" }] },
      { "label": "中间", "emoji": "🌊", "children": [{ "label": "要点", "emoji": "👀" }] },
      { "label": "结尾", "emoji": "🎯", "children": [{ "label": "内容概括", "emoji": "💗" }] }
    ]
  }
}
strengths 给 2-4 条，suggestions 给 1-3 条。`
}

/**
 * 只评分、不改写。
 *
 * ⚠️ **App 里没人调它**（提交作文走的是 `scoreAndRewrite`），
 *    它只剩测试在用。留着是为了保留"评分"这个可单独测的单元。
 *
 * ⚠️⚠️ 但要注意：**它还是旧的"静默降级"写法** ——
 *    模型少给 summary/strengths/suggestions/mindMap 时，会拿本地模板顶上。
 *    这正是家长报的「评价里的东西不是 AI 分析的」。
 *    `scoreAndRewrite` 已经改成"缺项补问 + 补不齐整份退回本地"了（见那一节的说明）。
 *    哪天要把这个函数接回界面，**必须先照那套改一遍**，否则那个 bug 会原样回来。
 */
export async function scoreWork(opts: ScoreOptions): Promise<ScoreResult> {
  const analysis = analyzeText(opts.text)

  const localScore = (): WorkScore =>
    scoreComposition({
      text: opts.text,
      analysis,
      focus: opts.focus,
      grade: opts.grade,
      wordRange: opts.wordRange,
      images: opts.images,
    })

  if (!shouldUseRemote(opts.cfg)) {
    const missing = remoteMissingFields(opts.cfg)
    return {
      score: localScore(),
      engine: 'local',
      ...(missing.length > 0
        ? { warning: `AI 设置里还缺${missing.join('、')}，先用了本地引擎。去设置页补全试试。` }
        : {}),
    }
  }

  try {
    const raw = await callChat(
      opts.cfg,
      [
        { role: 'system', content: systemFor(SCORE_SYSTEM, opts.genre) },
        { role: 'user', content: buildScoreUserMessage(opts, analysis) },
      ],
      { json: true, signal: opts.signal },
    )

    const parsed = extractJson<Partial<WorkScore>>(raw)
    if (!parsed?.dimensions) throw new Error('AI 返回的评分格式不对')

    // 把远程结果和本地结果合并：远程缺什么就用本地补，
    // 保证界面永远拿得到完整数据
    const fallback = localScore()
    const score: WorkScore = {
      at: Date.now(),
      total: clampNum(parsed.total, fallback.total, 0, 100),
      dimensions: {
        observation: clampNum(parsed.dimensions.observation, fallback.dimensions.observation, 0, 100),
        structure: clampNum(parsed.dimensions.structure, fallback.dimensions.structure, 0, 100),
        vocabulary: clampNum(parsed.dimensions.vocabulary, fallback.dimensions.vocabulary, 0, 100),
        imagination: clampNum(parsed.dimensions.imagination, fallback.dimensions.imagination, 0, 100),
        emotion: clampNum(parsed.dimensions.emotion, fallback.dimensions.emotion, 0, 100),
      },
      summary: nonEmpty(parsed.summary, fallback.summary),
      strengths: sanitizeStrengths(parsed.strengths, fallback.strengths),
      suggestions: sanitizeSuggestions(parsed.suggestions, fallback.suggestions),
      mindMap: sanitizeMindMap(parsed.mindMap, fallback.mindMap),
      stars: 0,
      engine: 'remote',
    }
    score.stars = starsForScore(score.total)
    return { score, engine: 'remote' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (opts.cfg.fallbackToLocal) {
      return {
        score: localScore(),
        engine: 'local',
        warning: `AI 评分失败，已用本地引擎顶上：${msg}`,
      }
    }
    throw err
  }
}

function clampNum(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.round(Math.max(lo, Math.min(hi, n)))
}

function nonEmpty(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback
}

function sanitizeStrengths(v: unknown, fallback: StrengthPoint[]): StrengthPoint[] {
  if (!Array.isArray(v)) return fallback
  const out = v
    .map((s) => {
      if (typeof s !== 'object' || s === null) return null
      const o = s as Record<string, unknown>
      if (typeof o.title !== 'string' || !o.title.trim()) return null
      return {
        title: o.title.trim().slice(0, 20),
        evidence: typeof o.evidence === 'string' ? o.evidence.trim().slice(0, 80) : '',
        emoji: typeof o.emoji === 'string' && o.emoji ? o.emoji : '✨',
      }
    })
    .filter((x): x is StrengthPoint => x !== null)
  return out.length > 0 ? out.slice(0, 5) : fallback
}

function sanitizeSuggestions(v: unknown, fallback: Suggestion[]): Suggestion[] {
  if (!Array.isArray(v)) return fallback
  const out = v
    .map((s) => {
      if (typeof s !== 'object' || s === null) return null
      const o = s as Record<string, unknown>
      if (typeof o.title !== 'string' || !o.title.trim()) return null
      return {
        title: o.title.trim().slice(0, 24),
        how: typeof o.how === 'string' ? o.how.trim().slice(0, 200) : '',
        emoji: typeof o.emoji === 'string' && o.emoji ? o.emoji : '💡',
      }
    })
    .filter((x): x is Suggestion => x !== null)
  return out.length > 0 ? out.slice(0, 4) : fallback
}

function sanitizeMindMap(v: unknown, fallback: MindMapNode): MindMapNode {
  const node = sanitizeNode(v, 0)
  return node ?? fallback
}

function sanitizeNode(v: unknown, depth: number): MindMapNode | null {
  if (depth > 3) return null
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.label !== 'string' || !o.label.trim()) return null
  const children = Array.isArray(o.children)
    ? o.children
        .map((c) => sanitizeNode(c, depth + 1))
        .filter((c): c is MindMapNode => c !== null)
        .slice(0, 8)
    : undefined
  return {
    label: o.label.trim().slice(0, 40),
    emoji: typeof o.emoji === 'string' && o.emoji ? o.emoji : undefined,
    children: children && children.length > 0 ? children : undefined,
  }
}

/* ============================================================
   四、更好的写法（单独生成的那条路）
   ============================================================

   ⚠️ 这条路和下面四·五的 `scoreAndRewrite` 是**同一个东西的两个入口**：

     · 提交作文时 —— `scoreAndRewrite` 一次调用同时出评分和写法
     · 提交时没生成出来（比如那会儿还没配 AI）——
       孩子点「看看更好的写法」时走这里补一次

   所以两边的口径**必须一致**：都是改写孩子的稿子，都要带配图和
   家长的附加要求。以前这里写的是「另写一篇标杆范文，不是改学生的作文」，
   和上面那条**正好相反** —— 补生成出来的东西会跟前一次不是一回事，
   孩子看到的是两种东西。
   ============================================================ */

export interface ModelEssayOptions {
  childText: string
  title: string
  grade: GradeLevel
  category: CompositionCategory
  /**
   * ★ 题目自带的格式要求（2026-09-30 加的）。缺省 = 记叙文 → 老调用方行为不变。
   * ⚠️ 只加字段不往下传，等于没加（本项目栽过「两个上限只补一个」）——
   *    这个值必须一路传到 `resolveKind` 和提示词里的「类型：」那一行。
   */
  genre?: CompositionGenre
  wordRange: [number, number]
  images: PromptImage[]
  cfg: AiConfig
  signal?: AbortSignal
}

export interface ModelEssayResult {
  essay: ModelEssay
  engine: 'local' | 'remote'
  warning?: string
}

/* ============================================================
   ★★ 「改写必须结合图和用户写的东西」—— 一张清单，两处用
   ============================================================

   家长 2026-09-19 报的（第二次报同一件事）：

     「还有更好的写法 也还是有问题。 要结合 图 和 用户写的」

   上一轮（2026-09-18）已经往提示词里补了配图，为什么还是不行？
   因为**光把图发给模型，不等于它会照着写**：

     · 提示词里说了「保留孩子的思路和故事」——
       但「思路和故事」是个抽象要求，模型完全可以写一篇
       「文笔更好、但跟孩子写的没关系」的文章交差；
     · 实测（mock 一次跑题回复）：孩子写雪，模型回
       「推开窗，一片《春天的公园》扑面而来。清晨的阳光洒在操场上……」
       —— 一个字都对不上，可当时**照收不误**，界面上写着「更好的写法」。

   所以这一节做两件事，**用同一份清单**：

     1. 提示词里**点名**列出「孩子写到的、必须留住」和
        「图上有的、要补进去」——不再是抽象要求，是可核对的清单；
     2. 模型回来后**照清单核对**。孩子的清单一条都没留住 → 判定跑偏，
        带原话补问一次；补问还跑偏 → 整份退回本地并如实标注。

   ★ 为什么清单只能算一次（而不是提示词里手写一遍、校验里再手写一遍）：
     同一份事实声明两遍，一定会走散 —— 改了一处忘了另一处，
     于是"要求保留的"和"校验的"不是同一批词，跑偏判定就永远不成立。
     这里 `buildKeepList` 是唯一来源，提示词和校验都从它取。
   ============================================================ */

interface KeepList {
  /**
   * 这篇作文里**必须留住**的东西（人物/地点/物件/事件 + 具体名物）。
   *
   * ⚠️ 标题也算在内 —— `extractChildMaterial` 会把题目一起扫。
   *    题目是这次的题眼（《雨后的校园》），改写跑离题目同样是跑偏。
   *    所以下面提示词的措辞是「这篇作文里的」，不是「孩子写到的」。
   */
  fromChild: string[]
  /** 图上有的、改写里**要补进去**的东西（孩子没写的才算） */
  fromImage: string[]
}

function buildKeepList(opts: {
  childText: string
  title: string
  images: PromptImage[]
}): KeepList {
  const m = extractChildMaterial(opts.childText, opts.title)
  const fromChild = [
    ...new Set([
      ...[m.person, m.place, m.thing, m.event].filter(Boolean) as string[],
      ...m.concrete,
    ]),
  ]
  const already = new Set(fromChild)
  const fromImage = [
    ...new Set(
      imageWords(opts.images)
        .flatMap((h) => extractConcrete(h, 6, true))
        .filter((w) => !already.has(w)),
    ),
  ]
  return { fromChild, fromImage }
}

/**
 * 改写跑偏了没有。
 *
 * 判据（刻意**宽松**，宁可漏判也不误判）：
 *   · 孩子写了具体东西 → 至少留住一条；
 *   · 孩子什么都没写具体（低年级常见的「妈妈很好。她对我很好。」）
 *     → 图里至少写进一条。
 *
 * 为什么不要求"全留住"：改写本来就会换词，
 * 要求逐条命中会把好文章误判成跑偏，然后被本地引擎顶掉 —— 得不偿失。
 * 「一条都没留住」是**没有争议**的跑偏，只有这种才拦。
 *
 * @returns 一条都没留住时返回该清单（给补问用），没跑偏返回 []
 */
function offTopicWords(essayText: string, keep: KeepList): string[] {
  if (keep.fromChild.length > 0) {
    return keep.fromChild.some((w) => essayText.includes(w)) ? [] : keep.fromChild
  }
  if (keep.fromImage.length > 0) {
    return keep.fromImage.some((w) => essayText.includes(w)) ? [] : keep.fromImage
  }
  return []
}

/** 提示词里那两段清单 —— 有内容才出，没内容不要写一个空标题 */
function keepListSection(keep: KeepList): string {
  const parts: string[] = []
  if (keep.fromChild.length > 0) {
    parts.push(
      `【这篇作文里的东西 —— 改写必须留住】\n${keep.fromChild.join('、')}\n` +
        `（这是他这篇的记号。一条都不留，就等于换了一篇文章写，` +
        `那就不是「他本可以写成的样子」了。）`,
    )
  }
  if (keep.fromImage.length > 0) {
    parts.push(
      `【图上有的 —— 要补进正文】\n${keep.fromImage.join('、')}\n` +
        `（孩子漏掉的画面，顺着他的句子补，不要另起一段专门讲图。）`,
    )
  }
  return parts.length > 0 ? `\n\n${parts.join('\n\n')}` : ''
}

/** 模型那次「只写范文」回复的形状（`generateModelEssay` 用） */
interface EssayReply {
  text?: string
  highlights?: string[]
  skeletonLines?: Array<{ core?: string; modifiers?: string[]; full?: string }>
}

/**
 * 本地引擎兜底时的警告：**把降级原因和"做不到的家长要求"一起说清**。
 *
 * ★ 为什么要专门说家长要求这一条（2026-09-19）：
 *   家长在设置里点了「多用排比」，而这次走的是本地引擎（模板拼的）——
 *   我们做不到。**装作做到了比做不到更坏**：
 *   他会一直以为设置生效了、只是孩子写得不够好，
 *   于是反复改设置、反复重算，永远找不到原因。
 *
 * ⚠️ 本地引擎**做得到**的那几样（比喻/拟人/通感/叠词）不在这里说 ——
 *    它是真的落实了（见 modelEssay.ts 的 `demandSentences`）。
 */
function withUnfulfilledNote(reason: string, cfg: AiConfig): string {
  const bad = unfulfilledDemands(cfg.extraPrompt)
  if (bad.length === 0) return reason
  return (
    reason +
    `本地引擎做不到你在设置里要求的${bad.join('、')}（那得按内容现写，模板拼不出来）。配好 AI 就会落实。`
  )
}

/**
 * 提示词里「类型：」那一行该写什么。
 *
 * ⚠️ **不许直接用 `opts.category`。**
 *    题库里「看图作文」的 category 是 `event`（写事），
 *    可孩子要写的是画面。直接写「类型：写事」，
 *    就是在提示词里告诉模型「编一段剧情出来」——
 *    本地引擎踩的正是这个坑（见 modelEssay.ts 的 resolveKind），
 *    模型这条路会踩得一模一样。
 *
 *    所以这里用**和本地引擎同一个 `resolveKind`**，
 *    两条路对「这道题走哪一支」的判断才是同一个。
 *    两者不一致时，把原标签也说出来 —— 别让模型以为我们搞错了题。
 */
function kindLabelFor(opts: {
  childText: string
  title: string
  category: CompositionCategory
  genre?: CompositionGenre
  images: PromptImage[]
}): string {
  const raw = categoryMeta(opts.category).label
  const m = extractChildMaterial(opts.childText, opts.title)
  const kind = resolveKind(opts.category, m, {
    pictureFirst: opts.images.length > 0,
    genre: opts.genre,
  })

  /*
   * ★★ 应用文单独一条路，**不能**掉进下面那句 `categoryMeta(kind)`。
   *
   *   `categoryMeta` 只认那 5 个记叙文对象值；传 'applied' 进去
   *   查不到，它会**静默退回第一个**（写景）—— 于是提示词里会写着
   *   「类型：写景」，而题目是《节约用水倡议书》。不报错、不崩，
   *   只是让模型把应用文写成记叙文。
   */
  if (kind === 'applied') {
    const shape = appliedShapeOf(opts.title)
    return (
      `应用文（${APPLIED_FORM_LABELS[shape.form]}）` +
      `（题库给这道题标的类型是「${raw}」，但这是应用文、不是记叙文，按应用文的格式写）`
    )
  }

  /*
   * ★★ 这一支以前还有说明文 / 议论文（2026-10-01 加的）——
   *   2026-10-02 删掉了：家长定的「APP 不需要区分文体」，孩子写记叙、
   *   说明、议论由他自己决定，所以 `resolveKind` 不会再返回那两个值。
   *   ⚠️ 万一哪天真的加回来，**必须**在这里再开一条分支：`categoryMeta`
   *      只认那 5 个记叙文对象值，传文体值进去查不到，它会**静默退回
   *      第一个**（写景）—— 于是提示词里写着「类型：写景」而题目是
   *      《我家的绿萝》。不报错、不崩，只是让模型写错。
   */
  if (kind === opts.category) return raw
  const resolved = categoryMeta(kind).label
  return `${resolved}（题库给这道题标的类型是「${raw}」，但孩子写的是画面、不是一件事，按「${resolved}」改）`
}

/**
 * 批改提示词第一行的「这是篇什么」。
 *
 * ★★ 这一行是模型**读到的第一句**，而它会先信这一句 ——
 *    所以格式写错，等于下面再怎么写「类型：应用文」都白搭。
 *    09-30 修应用文时踩过一次：那一句原本写死「看图作文」，
 *    第一行说「看图作文」、第十行说「这是应用文」，自相矛盾。
 *
 * ⚠️ 记叙文**仍然返回「看图作文」** —— 老提示词逐字节不变。
 *    严格说，材料/命题作文哪怕写成记叙文也没有图可看，
 *    但那是「命题方式（轴 2）」的账，不在这里动（见遗留清单）。
 */
function kindWordFor(opts: { title: string; genre?: CompositionGenre }): string {
  const genre = resolveGenre(opts.genre)
  if (genre === 'applied') {
    return `应用文（${APPLIED_FORM_LABELS[appliedShapeOf(opts.title).form]}）`
  }
  return '看图作文'
}

/** 跑偏的补问 —— 要把"你丢了什么"点名说清，不然它还会再丢一次 */
function buildOffTopicNote(offTopic: string[]): string {
  return `你改写的那一篇**跑偏了** —— 这篇作文里的这几样，
在你的改写里一个都找不到：${offTopic.join('、')}。

那不是他的作文，是另一篇。请**重新改写**：
顺着他的稿子写，把上面这些东西原样留住（他的用词习惯、他讲事情的顺序也留着），
只提升描写和修辞。仍然严格输出 JSON，不要输出解释文字。`
}

const ESSAY_SYSTEM = `你是一位温柔又专业的中国小学语文老师，正在把学生自己的作文改写成「更好的写法」。

不是写一篇新作文，而是**改孩子的作文**：保留他的思路、角度和故事，
只在描写、修辞、结构上提升，改到**接近满分**的水平。
要让孩子觉得「这是我写的，只是变好了」，而不是「这是别人写的」。

改写时必须做到：
1. **把配图里孩子漏掉的关键画面补进去** —— 顺着他已有的句子补，
   不要另起一段专门讲图。
2. **家长在附加要求里点名要的东西，优先落实**。
3. 保持孩子的视角和口吻，不要写成成人腔；他的用词习惯、他讲事情的顺序都要留着。
4. 结尾落到真情实感上。

必须严格输出 JSON，不要输出解释文字。`

/**
 * 非记叙文要额外告诉模型的「骨架要求」。
 *
 * ★★ 为什么必须单独成块、逐条列出来：
 *   模型的默认倾向是**把一切都写成记叙文** —— 哪怕提示词里写着
 *   「类型：应用文」，它也会交一篇有情节的小故事。而应用文最要命的
 *   恰恰是格式分（称呼、落款、分点），所以这里把骨架列死，
 *   要求它照骨架写、只替换内容。
 *
 * ⚠️ 记叙文返回**空串** —— 老路径的提示词一个字都不变。
 * ⚠️ 骨架与硬要求来自 `modelEssay.ts` 的 `appliedShapeOf`，跟本地引擎
 *    是**同一份**。别在这儿再抄一遍步骤说明 —— 两条路会走散，
 *    而且两边都不报错。
 *
 * ★ 2026-10-02：这一支以前还管说明文 / 议论文，现在只管应用文 ——
 *   家长定的「APP 不需要区分文体」，孩子写记叙、说明、议论由他自己决定。
 */
function appliedSectionFor(opts: { title: string; genre?: CompositionGenre }): string {
  if (resolveGenre(opts.genre) !== 'applied') return ''

  const shape = appliedShapeOf(opts.title)
  const label = APPLIED_FORM_LABELS[shape.form]

  const lines = [
    `\n\n【这是一篇${label} —— 必须按应用文的格式写，不是记叙文】`,
    '骨架（照这个顺序，每一部分单独成行/成段）：',
  ]
  if (shape.salutation) {
    lines.push(`1. 第一行是称呼，顶格、独占一行：「${shape.salutation}」`)
  } else {
    lines.push('1. 这篇没有称呼，第一行直接进入正文。')
  }
  lines.push(
    '2. 正文：说清「为什么提这件事」和「具体怎么做」——该分点的就分点' +
      '（第一、第二、第三），不要编情节。',
  )
  if (shape.signature) {
    lines.push(
      `3. 结尾先写号召，然后落款：落款和日期**各占一行**，「${shape.signature}」+ 一行日期。`,
    )
  } else {
    lines.push(`3. 结尾用这句话收住：「${shape.call}」`)
  }
  lines.push(
    '【硬要求】不要写景物、不要写感官（应用文没有画面可观察）；不要编故事；' +
      '孩子原文里说到的具体东西（人名、物件、事情）要保留下来。',
  )
  return lines.join('\n')
}

/**
 * 应用文的 system 提示补丁。
 *
 * ⚠️ 为什么**追加**而不是改 `SCORE_SYSTEM` / `ESSAY_SYSTEM` 本身：
 *    那两个常量是所有调用**共用**的，改了会连记叙文的行为一起变。
 *    这里只在应用文时补一段，记叙文一个字不动。
 * ⚠️ `SCORE_SYSTEM` 里写着「正在批改学生的**看图作文**」——
 *    对应用文是错的，所以这段补丁必须**明确纠正**它，
 *    不能只加一句「注意格式」（模型会听第一句）。
 */
const APPLIED_SYSTEM_NOTE = `
【重要】这一篇是**应用文**，不是看图作文、也不是记叙文。
上面说的"看图""写画面"都不适用 —— 应用文没有画面可观察。
请按「称呼 → 正文（说清为什么提这件事、具体怎么做，该分点就分点）→ 号召 → 落款」的格式来，
不要编故事情节，不要写景物和感官。`

function systemFor(base: string, genre?: CompositionGenre): string {
  return resolveGenre(genre) === 'applied' ? base + APPLIED_SYSTEM_NOTE : base
}

function buildEssayUserMessage(
  opts: ModelEssayOptions,
  a: TextAnalysis,
  keep: KeepList,
): string {
  const [lo, hi] = opts.wordRange
  const extra = opts.cfg.extraPrompt?.trim()
  const extraSection = extra
    ? `\n\n【家长附加要求 —— 必须落实】\n${extra}\n` +
      `（**逐条**落实，别只落实其中一半。「多用比喻」这类要求，` +
      `判据是改写后的正文里**真的找得到**比喻，不是"写得比较生动"就行。` +
      `如果这条要求和上面的默认标准冲突，以家长这条为准。）`
    : ''

  const imageSection = imageHintText(opts.images)
  const imageBlock = imageSection
    ? `\n这道题的配图（孩子应该照着这些画面写）：\n${imageSection}\n`
    : ''

  // ★ 应用文才有内容；记叙文是空串（老提示词一字不变）
  const appliedSection = appliedSectionFor(opts)

  return `请把下面这篇学生作文改写成「更好的写法」。

题目：《${opts.title}》
年级：${opts.grade} 年级
类型：${kindLabelFor(opts)}${appliedSection}
建议字数：${lo}-${hi} 字${extraSection}
${imageBlock}${keepListSection(keep)}
学生原文（**改写它** —— 保留他的思路和故事，别写成另一篇）：
"""
${opts.childText}
"""

学生已经用上的好词（改写时保留它们，让孩子有亲切感）：${a.goodWords.slice(0, 5).join('、') || '无'}

输出 JSON：
{
  "text": "改写后的正文，分段用 \\n\\n 分隔",
  "highlights": ["这份写法值得学的 3-5 个点，每条 10-20 字"],
  "skeletonLines": [
    { "core": "主干句(去掉所有修饰词，只留主谓宾)", "modifiers": ["被剥离的修饰成分"], "full": "对应的完整句子" }
  ]
}
skeletonLines 要覆盖全文每一个句子，顺序与正文一致。`
}

export async function generateModelEssay(
  opts: ModelEssayOptions,
): Promise<ModelEssayResult> {
  const analysis = analyzeText(opts.childText)
  // ★ 这份清单同时进提示词和进校验（见本节顶部），只算一次
  const keep = buildKeepList(opts)

  const localEssay = (): ModelEssay =>
    buildModelEssay({
      childText: opts.childText,
      analysis,
      title: opts.title,
      images: opts.images,
      grade: opts.grade,
      category: opts.category,
      // ★ 格式要求 —— 少了它，应用文会被当写事题改写
      genre: opts.genre,
      wordRange: opts.wordRange,
      // ★ 家长设置里的附加提示词 —— 本地引擎也要落实（见 modelEssay.ts 三·五）
      extraPrompt: opts.cfg.extraPrompt,
    })

  if (!shouldUseRemote(opts.cfg)) {
    const missing = remoteMissingFields(opts.cfg)
    const reason =
      missing.length > 0
        ? `AI 设置里还缺${missing.join('、')}，先用了本地引擎。去设置页补全试试。`
        : ''
    const warning = withUnfulfilledNote(reason, opts.cfg)
    return { essay: localEssay(), engine: 'local', ...(warning ? { warning } : {}) }
  }

  try {
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemFor(ESSAY_SYSTEM, opts.genre) },
      { role: 'user', content: buildEssayUserMessage(opts, analysis, keep) },
    ]

    const raw = await callChat(opts.cfg, messages, { json: true, signal: opts.signal })
    let parsed = extractJson<EssayReply>(raw)
    if (!parsed?.text?.trim()) throw new Error('AI 返回的范文为空')

    /*
     * 正文单独放一个变量：`parsed` 后面可能被补问那次整个换掉，
     * 类型收窄会跟着丢，正文却始终是"当前采纳的那一份"。
     */
    let text = parsed.text.trim()

    /*
     * ★ 跑偏就补问一次。
     *   带上模型上一次的原话 + 点名它丢了哪些东西 ——
     *   它能看到自己刚写的，改起来比重新问一遍准。
     */
    const offFirst = offTopicWords(text, keep)
    if (offFirst.length > 0) {
      try {
        const retryRaw = await callChat(
          opts.cfg,
          [
            ...messages,
            { role: 'assistant', content: raw },
            { role: 'user', content: buildOffTopicNote(offFirst) },
          ],
          { json: true, signal: opts.signal },
        )
        const retried = extractJson<EssayReply>(retryRaw)
        // 只在**真的不跑偏**时才换
        if (retried?.text?.trim() && offTopicWords(retried.text.trim(), keep).length === 0) {
          parsed = retried
          text = retried.text.trim()
        }
      } catch {
        // 补问失败就按"仍然跑偏"处理，走下面的退回
      }
    }

    const finalText = text

    /*
     * ★ 补问还跑偏 → **退回本地**，并如实说明。
     *   宁可给孩子一份本地的（界面会标"本地引擎"），
     *   也不能把一篇跟他的稿子无关的文章标成「更好的写法」。
     */
    if (offTopicWords(finalText, keep).length > 0) {
      if (opts.cfg.fallbackToLocal) {
        return {
          essay: localEssay(),
          engine: 'local',
          warning: withUnfulfilledNote(
            `AI 这次写跑偏了 —— 没留住孩子写到的「${offFirst.join('、')}」。已改用本地引擎顺着他的内容改写。`,
            opts.cfg,
          ),
        }
      }
      throw new Error(`AI 改写跑偏：没留住${offFirst.join('、')}`)
    }

    const modelLines = sanitizeSkeletonLines(parsed.skeletonLines)

    return {
      essay: {
        at: Date.now(),
        text: finalText,
        /*
         * ⚠️ 拿不到就用**空数组**，不许借本地那篇范文的亮点 ——
         *    本地范文和模型写的正文是两篇文章，
         *    借来的亮点会写「加了比喻和拟人」，而正文里根本没有。
         *    （和 scoreAndRewrite 同一个坑，见那边的注释。）
         */
        highlights: Array.isArray(parsed.highlights)
          ? parsed.highlights.filter((h): h is string => typeof h === 'string').slice(0, 6)
          : [],
        // 骨架同理：从**模型自己那篇正文**推
        skeleton: (modelLines.length > 0 ? modelLines : skeletonFromEssay(finalText))
          .map((l) => l.core)
          .join(' '),
        skeletonLines:
          modelLines.length > 0 ? modelLines : skeletonFromEssay(finalText),
        engine: 'remote',
      },
      engine: 'remote',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (opts.cfg.fallbackToLocal) {
      return {
        essay: localEssay(),
        engine: 'local',
        warning: withUnfulfilledNote(`AI 写范文失败，已用本地引擎顶上：${msg}`, opts.cfg),
      }
    }
    throw err
  }
}

/* ============================================================
   四·五、评分 + 改范文（一次 AI 调用）
   ============================================================

   用户要求：提交后 AI 同时做两件事——
     1. 给评分（维度分 + 总评 + 建议 + 思维导图）
     2. 把孩子的作文改写成「满分范文」（保留孩子的思路和故事，只提升描写和结构）

   这样孩子点「看看满分范文」时，范文已经准备好了，不用等第二次 AI 调用。
   ============================================================ */

const SCORE_AND_REWRITE_SYSTEM = `你是一位温柔又专业的中国小学语文老师，正在批改学生的看图作文。
你的任务有两部分：

【第一部分：评分】
以鼓励为主、具体指出好在哪、给可操作的建议。
必须结合配图来评：孩子有没有写出图里最关键的东西，这是看图作文的评分重点。
【绝对禁止】替学生写任何一句话。你只能描述和引导。

【第二部分：把孩子的作文改写成「更好的写法」】
不是写一篇新作文，而是**改孩子的作文**——保留他的思路、角度和故事，
只在描写、修辞、结构上提升，改到**接近满分**的水平。
要让孩子觉得「这是我写的，只是变好了」，而不是「这是别人写的」。

改写时必须做到：
1. **把配图里孩子漏掉的关键画面补进去** —— 顺着他已有的句子补，
   不要另起一段专门讲图。看图作文最常丢的分就是"图上有、文里没有"。
2. **家长在附加要求里点名要的东西，优先落实**（修辞、字数、结构都算）。
3. 不要写成"别人家孩子的作文"：他的用词习惯、他讲事情的顺序、他的语气都要留着。

必须严格输出 JSON，不要输出解释文字。`

function buildScoreAndRewriteUserMessage(
  opts: ScoreOptions & { childText: string },
  a: TextAnalysis,
  keep: KeepList,
): string {
  const [lo, hi] = opts.wordRange
  const extra = opts.cfg.extraPrompt?.trim()
  /* 附加要求单独成块、并明说「必须落实」——
     以前它只是跟在「类型：」后面的一句话，模型很容易当背景噪音忽略掉。 */
  const extraSection = extra
    ? `\n\n【家长附加要求 —— 必须落实】
${extra}
（**逐条**落实，别只落实其中一半。「多用比喻」这类要求，
判据是改写后的正文里**真的找得到**比喻，不是"写得比较生动"就行。
如果这条要求和上面的默认标准冲突，以家长这条为准。）`
    : ''

  const imageSection = imageHintText(opts.images)
  const imageBlock = imageSection
    ? `\n这道题的配图（孩子应该照着这些画面写）：\n${imageSection}\n`
    : ''

  // ★ 应用文才有内容；记叙文是空串（老提示词一字不变）
  const appliedSection = appliedSectionFor(opts)

  return `请批改这篇【${opts.grade} 年级】${kindWordFor(opts)}，并把它改写成「更好的写法」。

题目：《${opts.title}》
年级：${opts.grade} 年级
建议字数：${lo}-${hi} 字
类型：${kindLabelFor(opts)}${extraSection}${appliedSection}
${imageBlock}${keepListSection(keep)}
学生原文：
"""
${opts.childText}
"""

基础统计（供参考，不要直接复述数字）：
- 字数：${a.wordCount}
- 句子数：${a.sentenceCount}
- 好词：${a.goodWords.join('、') || '无'}
- 修辞：${a.rhetoric.map((r) => r.name).join('、') || '无'}
- 感官：${a.senses.join('、') || '无'}
- 关联词：${a.connectors.join('、') || '无'}

输出 JSON：
{
  "dimensions": {
    "observation": 0-100, "structure": 0-100, "vocabulary": 0-100,
    "imagination": 0-100, "emotion": 0-100
  },
  "total": 0-100,
  "summary": "总评，60-100 字，先肯定再建议，语气亲切",
  "strengths": [{ "title": "好在哪(8字内)", "evidence": "引用学生原文里的具体词句", "emoji": "一个表情" }],
  "suggestions": [{ "title": "建议(10字内)", "how": "具体怎么做，只指方向，不要给可抄的句子", "emoji": "一个表情" }],
  "mindMap": {
    "label": "中心词", "emoji": "🌳",
    "children": [
      { "label": "开头", "emoji": "🚪", "children": [{ "label": "内容概括", "emoji": "✏️" }] },
      { "label": "中间", "emoji": "🌊", "children": [{ "label": "要点", "emoji": "👀" }] },
      { "label": "结尾", "emoji": "🎯", "children": [{ "label": "内容概括", "emoji": "💗" }] }
    ]
  },
  "essayText": "改写后的正文，分段用 \\n\\n 分隔。保留孩子的思路和故事，补上他漏掉的画面，提升描写和结构。",
  "essayHighlights": ["这份写法值得学的 3-5 个点，每条 10-20 字"],
  "skeletonLines": [
    { "core": "主干句(去掉修饰词，只留主谓宾)", "modifiers": ["被剥离的修饰成分"], "full": "对应的完整句子" }
  ]
}
strengths 给 2-4 条，suggestions 给 1-3 条。
skeletonLines 要覆盖正文每一个句子，顺序与正文一致。`
}

export interface ScoreAndRewriteResult {
  score: WorkScore
  essay: ModelEssay
  engine: 'local' | 'remote'
  warning?: string
}

/* ============================================================
   ★★ 「评价里的东西必须真的是 AI 分析的」
   ============================================================
   家长 2026-09-19 报的：

     「似乎 作文的结构 并不是AI分析的。评价里的东西 都需要 AI 分析。」

   查下来是真的。旧实现里，模型**少给了哪一项，就静默拿本地模板顶上**：

     summary       ← 本地模板（还会写「你做到了 61 分」，而总分是模型给的 85）
     strengths     ← 本地模板
     suggestions   ← 本地模板
     mindMap       ← 本地模板（「我的作文 · 真情实感最强」+「感官描写：视觉」）
     highlights    ← 本地模板（甚至会写「加了比喻和拟人」，而正文里根本没有）
     skeletonLines ← **本地那篇范文的骨架**，跟模型写的正文不是同一篇

   而界面上写着「本次由远程 AI 评分」—— 孩子看到的结构图，
   其实一个字的 AI 分析都没有。

   ★ 两条纪律（都写在这里，别再退回去）：

   1. **一次调用里少给了东西，就补问一次**，而不是拿模板顶上。
      模型漏字段大多不是"不会"，是长 JSON 写漏了；
      明确告诉它「你漏了 X，重发一份完整的」基本都能补齐。

   2. **补问还不行，就整份退回本地**，并如实标成 local。
      评价是**一个整体**，不能一半 AI 一半模板 ——
      本地那句总评会带上本地算的分，和模型给的总分互相打架
      （实测：本地总评写「你做到了 61 分」，而模型给的总分是 85）。
      宁可整份用本地的（界面会说"本地引擎"），也不要混着还说自己是 AI。

   骨架（skeletonLines）是另一回事：它是**从正文推出来的**，
   模型没给就用模型自己那篇正文现推（`skeletonFromEssay`），
   绝不许借本地范文的那一份 —— 那是两篇不同的文章，
   背诵挑战会把孩子背的和看到的对不上。
   ============================================================ */

/** 模型那次回复的形状（评分 + 改写共用一次调用） */
interface ScoreReply {
  dimensions?: Partial<Record<ScoreDimension, number>>
  total?: number
  summary?: string
  strengths?: Array<{ title?: string; evidence?: string; emoji?: string }>
  suggestions?: Array<{ title?: string; how?: string; emoji?: string }>
  mindMap?: MindMapNode
  essayText?: string
  essayHighlights?: string[]
  skeletonLines?: Array<{ core?: string; modifiers?: string[]; full?: string }>
}

/**
 * 「一份完整的评价」缺了哪些项。
 *
 * 这几项只要缺一个，界面上就会出现"看着像 AI、其实是本地模板"的内容，
 * 所以它们全都要在。
 */
function missingScoreFields(p: ScoreReply | null | undefined): string[] {
  if (!p) return ['整份 JSON']
  const missing: string[] = []
  if (!p.summary?.trim()) missing.push('summary（总评）')
  if (!Array.isArray(p.strengths) || p.strengths.length === 0) missing.push('strengths（好在哪）')
  if (!Array.isArray(p.suggestions) || p.suggestions.length === 0) {
    missing.push('suggestions（建议）')
  }
  // 结构图至少要两条一级分支才叫"结构"，只有一条等于没分析
  if (!Array.isArray(p.mindMap?.children) || p.mindMap.children.length < 2) {
    missing.push('mindMap（作文结构图）')
  }
  return missing
}

/** 「更好的写法」缺了哪些项（骨架不算 —— 它能从正文推出来） */
function missingEssayFields(p: ScoreReply | null | undefined): string[] {
  if (!p) return ['整份 JSON']
  const missing: string[] = []
  if (!p.essayText?.trim()) missing.push('essayText（改写后的正文）')
  if (!Array.isArray(p.essayHighlights) || p.essayHighlights.length === 0) {
    missing.push('essayHighlights（值得学的点）')
  }
  return missing
}

/**
 * 补问时追加的那句话 —— 要把漏了什么点名说清，不然它还会再漏一次。
 *
 * ★ 2026-09-19：加上了「跑偏」那一半。
 *   缺字段和跑偏是**两种毛病**，得分开说：
 *   前者是"少写了几项"，后者是"写成了另一篇"。
 *   混成一句话说，模型只会照着补字段，跑偏还是跑偏。
 */
function buildRetryNote(missing: string[], offTopic: string[] = []): string {
  const parts: string[] = []
  if (missing.length > 0) {
    parts.push(`你上一次的输出**漏掉了这几项**：${missing.join('、')}。`)
  }
  if (offTopic.length > 0) {
    parts.push(
      `另外，你改写的那篇**跑偏了** —— 这篇作文里的这几样，` +
        `在你的改写里一个都找不到：${offTopic.join('、')}。` +
        `那不是他的作文，是另一篇。`,
    )
  }
  return `${parts.join('\n\n')}

请把**完整的 JSON 重新输出一遍** —— 包括上一次已经给过的部分，
上面列出的每一项都必须有，一项都不能少；
改写的正文要顺着孩子的稿子写，把他的东西留住。
不要输出解释文字。`
}

/**
 * 从一篇正文里现推背诵骨架。
 *
 * 用在「模型给了正文、但没给骨架」的时候。
 * ⚠️ 绝不能拿本地那篇范文的骨架来顶 —— 那是**另一篇文章**的句子。
 */
function skeletonFromEssay(essayText: string): SkeletonLine[] {
  return splitSentences(essayText)
    .map((s) => {
      const { core, modifiers } = extractSkeleton(s)
      return { core, modifiers, full: s }
    })
    .filter((l) => l.core && l.full)
}

/** 把模型给的骨架行清洗一遍（缺 core/full 的丢掉） */
function sanitizeSkeletonLines(v: ScoreReply['skeletonLines']): SkeletonLine[] {
  if (!Array.isArray(v)) return []
  return v
    .map((l) => ({
      core: typeof l.core === 'string' ? l.core.trim() : '',
      modifiers: Array.isArray(l.modifiers)
        ? l.modifiers.filter((m): m is string => typeof m === 'string')
        : [],
      full: typeof l.full === 'string' ? l.full.trim() : '',
    }))
    .filter((l) => l.core && l.full)
}

export async function scoreAndRewrite(
  opts: ScoreOptions & { childText: string },
): Promise<ScoreAndRewriteResult> {
  const analysis = analyzeText(opts.childText)

  // 本地兜底：分别用本地评分 + 本地范文
  const localResult = (): ScoreAndRewriteResult => {
    const score = scoreComposition({
      text: opts.childText,
      analysis,
      focus: opts.focus,
      grade: opts.grade,
      wordRange: opts.wordRange,
      images: opts.images,
    })
    const essay = buildModelEssay({
      childText: opts.childText,
      analysis,
      title: opts.title,
      images: opts.images,
      grade: opts.grade,
      category: opts.category,
      // ★ 格式要求 —— 少了它，应用文会被当写事题改写
      genre: opts.genre,
      wordRange: opts.wordRange,
      // ★ 家长设置里的附加提示词 —— 本地引擎也要落实（见 modelEssay.ts 三·五）
      extraPrompt: opts.cfg.extraPrompt,
    })
    return { score, essay, engine: 'local' }
  }

  if (!shouldUseRemote(opts.cfg)) {
    const missing = remoteMissingFields(opts.cfg)
    const reason =
      missing.length > 0
        ? `AI 设置里还缺${missing.join('、')}，先用了本地引擎。去设置页补全试试。`
        : ''
    const warning = withUnfulfilledNote(reason, opts.cfg)
    return { ...localResult(), ...(warning ? { warning } : {}) }
  }

  try {
    // ★ 这份清单同时进提示词和进校验（见本节顶部），只算一次
    const keep = buildKeepList(opts)

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemFor(SCORE_AND_REWRITE_SYSTEM, opts.genre) },
      { role: 'user', content: buildScoreAndRewriteUserMessage(opts, analysis, keep) },
    ]

    const firstRaw = await callChat(opts.cfg, messages, { json: true, signal: opts.signal })
    let parsed = extractJson<ScoreReply>(firstRaw)

    /*
     * ★ 缺项 **或** 跑偏，就补问一次（见本节顶部纪律 1 + 文件里
     *   「改写必须结合图和用户写的东西」那一节）。
     *   带上模型上一次的原话 + 点名说清毛病，比把问题重发一遍有效得多 ——
     *   它能看到自己刚写的，只补缺口就行。
     */
    const missingFirst = [...missingScoreFields(parsed), ...missingEssayFields(parsed)]
    const offTopicFirst = parsed?.essayText?.trim()
      ? offTopicWords(parsed.essayText.trim(), keep)
      : []

    if (parsed && (missingFirst.length > 0 || offTopicFirst.length > 0)) {
      try {
        const retryRaw = await callChat(
          opts.cfg,
          [
            ...messages,
            { role: 'assistant', content: firstRaw },
            { role: 'user', content: buildRetryNote(missingFirst, offTopicFirst) },
          ],
          { json: true, signal: opts.signal },
        )
        const retried = extractJson<ScoreReply>(retryRaw)
        /*
         * 只在**确实更好**的时候才换 —— 别把一份好的换差了。
         * 两种毛病分开算，各占一档权重：
         * 缺字段是"少写了几项"，跑偏是"写成了另一篇"，后者更严重。
         */
        if (retried) {
          const badness = (p: ScoreReply) =>
            (missingScoreFields(p).length + missingEssayFields(p).length) * 10 +
            (p.essayText?.trim() && offTopicWords(p.essayText.trim(), keep).length > 0 ? 1 : 0)
          if (badness(retried) < badness(parsed)) parsed = retried
        }
      } catch {
        // 补问失败就用第一次那份，走下面的降级逻辑 —— 别让孩子白等一场
      }
    }

    if (!parsed?.dimensions) throw new Error('AI 返回的评分格式不对')
    if (!parsed?.essayText?.trim()) throw new Error('AI 返回的范文为空')

    const fallback = localResult()
    const now = Date.now()

    /*
     * ★ 评价**整份**都要是模型给的，否则整份退回本地。
     *   理由见本节顶部纪律 2 —— 混着用会出现
     *   「本地总评写着 61 分、模型给的总分是 85」这种自相矛盾。
     */
    const scoreMissing = missingScoreFields(parsed)
    const scoreFromModel = scoreMissing.length === 0

    let score: WorkScore
    if (scoreFromModel) {
      score = {
        at: now,
        total: clampNum(parsed.total, fallback.score.total, 0, 100),
        dimensions: {
          observation: clampNum(parsed.dimensions.observation, fallback.score.dimensions.observation, 0, 100),
          structure: clampNum(parsed.dimensions.structure, fallback.score.dimensions.structure, 0, 100),
          vocabulary: clampNum(parsed.dimensions.vocabulary, fallback.score.dimensions.vocabulary, 0, 100),
          imagination: clampNum(parsed.dimensions.imagination, fallback.score.dimensions.imagination, 0, 100),
          emotion: clampNum(parsed.dimensions.emotion, fallback.score.dimensions.emotion, 0, 100),
        },
        summary: parsed.summary!.trim(),
        strengths: sanitizeStrengths(parsed.strengths, fallback.score.strengths),
        suggestions: sanitizeSuggestions(parsed.suggestions, fallback.score.suggestions),
        mindMap: sanitizeMindMap(parsed.mindMap, fallback.score.mindMap),
        stars: 0,
        engine: 'remote',
      }
      score.stars = starsForScore(score.total)
    } else {
      // 整份退回本地 —— 界面上的「本次由本地引擎评分」才是真话
      score = { ...fallback.score, at: now, engine: 'local' }
    }

    /*
     * ★ 「更好的写法」也要过跑偏这一关。
     *
     *   评价（score）和写法（essay）是**两件事**，各自独立降级：
     *     · 评价是就孩子的原文做的分析 —— 跟改写跑没跑偏无关；
     *     · 写法是给孩子的示范 —— 跑偏了就必须换成本地的，
     *       因为「更好的写法」这四个字意味着「这是你这一篇的样子」。
     *   所以这里不许"跑偏了就连评价一起扔"，也不许"评价好就留着跑偏的写法"。
     */
    const offTopicFinal = offTopicWords(parsed.essayText.trim(), keep)

    /*
     * 骨架：模型给了就用模型的；没给就从**正文**现推。
     * ⚠️ 以前这里是 `fallback.essay.skeletonLines` —— 本地范文的骨架，
     *    和正文不是一篇。跑偏退回本地时用 `fallback.essay`，那份才是配套的。
     */
    let essay: ModelEssay
    if (offTopicFinal.length > 0) {
      essay = fallback.essay
    } else {
      const modelLines = sanitizeSkeletonLines(parsed.skeletonLines)
      const lines =
        modelLines.length > 0 ? modelLines : skeletonFromEssay(parsed.essayText.trim())
      essay = {
        at: now,
        text: parsed.essayText.trim(),
        highlights: Array.isArray(parsed.essayHighlights)
          ? parsed.essayHighlights.filter((h): h is string => typeof h === 'string').slice(0, 6)
          : [],
        skeleton: lines.map((l) => l.core).join(' '),
        skeletonLines: lines,
        engine: 'remote',
      }
    }

    // 两份警告可能同时成立（评价缺项 + 写法跑偏），都如实说出来
    const warnings: string[] = []
    if (scoreMissing.length > 0) {
      warnings.push(`AI 这次少给了${scoreMissing.join('、')}，评价已整份改用本地引擎。`)
    }
    if (offTopicFinal.length > 0) {
      warnings.push(
        withUnfulfilledNote(
          `AI 改写的范文跑偏了（没留住孩子写到的「${offTopicFinal.join('、')}」），写法已改用本地引擎顺着他的内容改写。`,
          opts.cfg,
        ),
      )
    }

    return {
      score,
      essay,
      engine: scoreFromModel ? 'remote' : 'local',
      ...(warnings.length > 0 ? { warning: warnings.join('') } : {}),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (opts.cfg.fallbackToLocal) {
      return {
        ...localResult(),
        warning: withUnfulfilledNote(`AI 评分改范文失败，已用本地引擎顶上：${msg}`, opts.cfg),
      }
    }
    throw err
  }
}

/* ============================================================
   四·五、按孩子的指令改作文 —— **大模型只当翻译官**
   ============================================================

   ★ 这一节 2026-09-19 重写过一次，改的是**大模型在这条链路里的角色**。
     家长的原话把边界讲得很清楚：

       「不许 AI 帮改写。是**不许 AI 帮写**，不是不允许改写。
         比如小明正在吃饭，把正在后面的去掉，都是可以的。
         小明后面加小红都可以。把小明改成大明都可以。
         但不允许 AI 自己生产内容 —— 类似『给这个句子加点比喻』都不行。」

     也就是：
       ✔ 改作文（换词 / 删词 / 挪位置）—— **完全可以**，
         只要那些字是**孩子自己说的**
       ✘ 生产内容（加点比喻 / 润色 / 扩写 / 加个结尾）—— **不行**

   ⚠️ 旧实现踩了两个坑，都记在这里：

     坑一：把「不许替孩子写」**扩大解释**成了「不许 AI 参与」，
           于是连"听懂指令"都只能用固定正则。结果「在 X 后面加 Y」
           这一整类说法根本没有对应分支（已在 voiceEdit.ts 补上 insert）。

     坑二：另一条 AI 路径 `reviseEssay` 把「原文 + 指令」丢给模型、
           **拿回改好的全文** —— 那正是"AI 帮写"。它已经删掉了。
           （提示词里写了"最小改动"，但模型照样在产出正文。）

   ★ 现在的形状 —— 只做一件事：

       孩子说一句口语  ──►  大模型**只翻译成结构化指令**
                            { kind, anchor, position, text }
                                     │
                                     ▼
                            确定性引擎执行（voiceEdit.applyEdit）

     模型返回的 JSON 里**根本没有"改好的作文"这个字段**，
     它想产出正文都没有地方放。**这才是"不许帮写"在代码上的落地**：
     不靠提示词求它别写，靠**接口形状让它写不了**。

     以后若有人觉得"直接让模型返回全文更省事" —— 那是在悄悄改需求。
   ============================================================ */

/**
 * 模型能返回的**全部**指令形状。
 *
 * ⚠️ 这里没有「改好的全文」这种字段，是**故意的**：
 *    模型只描述"改哪里、怎么改"，正文永远由确定性引擎生成。
 *    加字段之前先回去读上面那段注释。
 */
export type ParsedEditInstruction =
  /*
   * ★★ 2026-09-21：`replace` / `delete` / `replace-punct` 都补上了
   *    `OccurrenceHint`（near / side / pick）。
   *
   *    家长 09-20 报的「很多都理解有问题，没法改」，**结构性的根因就在这里**：
   *    只有 `replace-punct` 有 `near`，另外两个没有 —— 孩子说
   *    「把玩篮球**后面的那个字**去掉」时，**模型没有字段可以表达"哪儿"**，
   *    只能瞎猜一个字面量、或者按铁律返回 unknown。
   *
   *    ⚠️ 而执行层其实早就有这套机器（`applyEdit` 的 replace-punct 分支），
   *       缺的只是"把它推广过来"。现在三支共用 `locateOccurrence`。
   */
  | ({ kind: 'replace'; from: string; to: string } & OccurrenceHint)
  | { kind: 'insert'; anchor: string; text: string; position: 'after' | 'before' }
  | ({ kind: 'delete'; target: string } & OccurrenceHint)
  /**
   * 改标点。
   *
   * `from` / `to` 是**真符号**（。 / ！），不是"句号""叹号"这两个名字 ——
   * 模型负责把名字翻成符号，执行层只管找符号。
   * `near` 是参照物（「玩篮球后面的句号」里的「玩篮球」），可以不给。
   */
  | ({ kind: 'replace-punct'; from: string; to: string } & OccurrenceHint)
  | { kind: 'append'; text: string }
  | { kind: 'undo' }
  | { kind: 'refuse'; reason: 'content' }

export interface ParseInstructionOptions {
  cfg: AiConfig
  /** 孩子现在写好的全文（**只读**：给模型看上下文，它不许改它） */
  text: string
  /** 孩子说的那句指令（语音转文字之后的） */
  instruction: string
  signal?: AbortSignal
}

export interface ParseInstructionResult {
  ok: boolean
  /** 解析出来的指令。ok 为 true 时一定有 */
  intent?: ParsedEditInstruction
  /**
   * ⚠️ `'invented'` 是 2026-09-21 新加的：模型想写**孩子没说过的字**，
   *    被来源闸门（`domain/provenance.ts`）拦下了。
   *
   *    ★ 它**必须单独一类，不能并进 `unknown`** —— 同 §一 那条
   *      「`refuse` 不许混进 `unknown`」的道理：两者的正确反应完全不同。
   *      · `unknown` = 没听懂他这句话 → 换个说法**有用**
   *      · `invented` = 听懂了，但那些字不是他说的 → 换个说法**没用**，
   *        他得**把要加的字自己说出来**
   */
  reason?: 'not-configured' | 'empty' | 'unknown' | 'invented' | 'network' | 'server'
  message: string
}

const PARSE_SYSTEM = `你是「指令翻译官」。孩子对着自己写好的作文，说了一句修改要求。
你要把这句话翻译成一条**结构化指令**，交给程序去执行。

你不写作文。你不产出任何正文。你只说「改哪里、怎么改」。

可以翻译的指令：

1. 换 —— 把某个词/句换成另一段字
   { "kind": "replace", "from": "原文里的字", "to": "换成这个" }

2. 插 —— 在某个词/句的前面或后面，插进一段字
   { "kind": "insert", "anchor": "插在谁旁边", "position": "after", "text": "要插进去的字" }
   （"after" = 后面 / 后边 / 之后；"before" = 前面 / 前边 / 之前）

3. 删 —— 删掉某个词/句
   { "kind": "delete", "target": "要删掉的字" }

★ 1 和 3 都可以再带**指位**信息（可选，见下面第 8 条）：
   "near"   —— 参照物
   "side"   —— "after"（默认）/ "before"
   "pick"   —— "last" / "first"

4. 补 —— 在整篇的最后再补一句
   { "kind": "append", "text": "补在最后的话" }

5. 撤 —— 撤销刚才那一次修改
   { "kind": "undo" }

6. 改标点 —— 把某个标点换成另一个标点
   { "kind": "replace-punct", "from": "要换掉的那个标点本身", "to": "换成这个标点", "near": "参照物（可省略）" }

   ⚠️ 标点一律写**符号本身**（。，！？、；：……），不许写"句号""叹号"这些名字。
      「把玩篮球后面的句号改成叹号」
        → { "kind": "replace-punct", "from": "。", "to": "！", "near": "玩篮球" }
      「把最后的句号改成叹号」
        → { "kind": "replace-punct", "from": "。", "to": "！", "pick": "last" }
      「把句号改成叹号」（没说在哪儿）
        → { "kind": "replace-punct", "from": "。", "to": "！" }
      near 必须是**原文里一字不差出现过的字**（和 from/target/anchor 同一条铁律）。
      说了"最后的/末尾的"就带 "pick": "last"；说了"第一个/最前面的"就带 "pick": "first"。

7. 拒 —— 孩子在让你**替他造内容**，而不是在指挥他自己写的字
   { "kind": "refuse", "reason": "content" }

8. ★ 指位 —— 孩子**没有说出那个字、只说了它在哪儿**时，用它
   "near" / "side" / "pick" 三个字段，可以加在 1（replace）、3（delete）、6（replace-punct）上。

   ★★ 你**看得见原文**（下面会给你）。所以先自己往下读一眼，
      把"他指的那一处"落成**原文里真实存在的字**，再放进 from / target。

   「把玩篮球后面的那个字去掉」
     原文是「…在操场上玩篮球。」—— 玩篮球后面是「。」
     → { "kind": "delete", "target": "。", "near": "玩篮球" }
   「把玩篮球后面那个字改成地」
     → { "kind": "replace", "from": "。", "to": "地", "near": "玩篮球" }
   「把操场上后面的玩篮球去掉」
     → { "kind": "delete", "target": "玩篮球", "near": "操场上" }
   「把第一个小去掉」
     → { "kind": "delete", "target": "小", "pick": "first" }
   「把最后那个句号改成叹号」
     → { "kind": "replace-punct", "from": "。", "to": "！", "pick": "last" }

   ⚠️ 只在**下面两种情况**才用 "near" / "pick"：
     ① 那个字在原文里**出现了不止一次**，不指位就不知道是哪一个；
     ② 孩子**没说那个字**，只说了它相对于谁。
   其余情况**不要加**，让程序自己找唯一的那个。

铁律（违反任何一条都算失败）：

· "from" / "target" / "anchor" / "near" 必须是**原文里一字不差出现过的字**。
  原文里找不到，就不要编 —— 返回 unknown。
  ⚠️ 注意"孩子说了"和"原文里有"是两回事：他说「把玩篮球后面的那个字去掉」时，
     "target" 要填**原文里那个真实的字**（上面例子里的「。」），
     不是填「那个字」三个字 —— 填了他说的原话，程序在原文里当然找不到。
· "to" / "text" 必须是**孩子自己在这句话里说出来的字**，一个都不许你添。
  不许润色，不许换同义词，不许补修饰，不许扩写。
  他说「把正在改成在」，to 就是「在」；写成「正」就是错的。
  （标点例外：他说"叹号"，to 就写「！」—— 那是把名字翻成符号，不是替他造内容。）
· 判断第 7 条看**意图**，不看用词。
  他要是让你「加点比喻」「润色一下」「扩写」「加个好词好句」
  「帮我想个结尾」「写得生动一点」—— 这些都是 refuse。
  反过来，「把优美改成漂亮」「在小明后面加小红」是他在自己指挥，
  虽然也带"改""加"两个字，但那是 1/2 条，不是 7 条。
· 听不懂，或者那句话根本不是修改要求（闲聊、提问）→ { "kind": "unknown" }

只输出 JSON，不要解释文字，不要 markdown 代码块。`

function buildParseUserMessage(opts: ParseInstructionOptions): string {
  /*
   * 只给两样东西：正文（当参照物，用来核对 from/target 是否真实存在）
   * 和孩子的原话。
   *
   * ⚠️ 曾经这里还塞了「题目 / 年级 / 家长附加要求」—— 那是给"生成正文"
   *    用的素材，现在模型只做翻译，给了反而是在暗示它可以发挥。
   */
  return `孩子现在写好的作文：
"""
${opts.text}
"""

孩子刚说的那句话：
"""
${opts.instruction}
"""

把它翻译成一条结构化指令。`
}

/**
 * 把模型吐出来的 JSON 收敛成合法指令。
 *
 * ★ 这是"不许帮写"最硬的一道闸门：模型无论返回什么花哨东西，
 *   只要不落在这六种形状里，一律当没听懂。
 *   它想返回"改好的全文"，这里**没有那个出口**。
 */
function toInstruction(raw: unknown): ParsedEditInstruction | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

  /*
   * 指位字段的收敛（replace / delete / replace-punct 共用）。
   *
   * ⚠️ 只认白名单里的值，别的一律丢掉 —— 模型偶尔会写
   *    "side": "middle" 这种词，放任它传下去，执行层会拿着一个
   *    没意义的值去算位置。宁可当作"他没指位"，退回"唯一就改、多个就问"。
   */
  const hint = (): OccurrenceHint => {
    const near = str(o.near)
    const side = o.side === 'before' ? 'before' : o.side === 'after' ? 'after' : undefined
    const pick = o.pick === 'last' ? 'last' : o.pick === 'first' ? 'first' : undefined
    return { near: near || undefined, side, pick }
  }

  switch (str(o.kind)) {
    case 'replace': {
      const from = str(o.from)
      const to = str(o.to)
      if (!from || !to) return null
      return { kind: 'replace', from, to, ...hint() }
    }
    case 'insert': {
      const anchor = str(o.anchor)
      const text = str(o.text)
      if (!anchor || !text) return null
      return {
        kind: 'insert',
        anchor,
        text,
        position: o.position === 'before' ? 'before' : 'after',
      }
    }
    case 'delete': {
      const target = str(o.target)
      if (!target) return null
      return { kind: 'delete', target, ...hint() }
    }
    case 'append': {
      const text = str(o.text)
      if (!text) return null
      return { kind: 'append', text }
    }
    case 'replace-punct': {
      const from = str(o.from)
      const to = str(o.to)
      if (!from || !to) return null
      /*
       * ⚠️ 只收**真标点符号**，长度也卡住（省略号是 2 个字符）。
       *    模型要是把「句号」两个字塞进 from，这里直接判非法 ——
       *    否则执行层会去正文里找"句号"这俩字，又回到家长报的那个 bug。
       */
      const isPunct = (s: string) => /^(?:……|[。，！？、；：])$/.test(s)
      if (!isPunct(from) || !isPunct(to)) return null
      return { kind: 'replace-punct', from, to, ...hint() }
    }
    case 'undo':
      return { kind: 'undo' }
    case 'refuse':
      return { kind: 'refuse', reason: 'content' }
    default:
      return null
  }
}

/**
 * 把孩子的一句话翻译成结构化指令。
 *
 * ★ **它不返回正文。永远不会。**
 *   调用方的用法是固定两步：拿 `intent` → 交给 `voiceEdit.applyEdit` 执行。
 *   正文只可能由那个确定性引擎产生，模型碰不到 —— 这就是"不许帮写"
 *   在代码上的落地方式。想加"直接返回改好的全文"之前，回去读本节顶部的注释。
 */
export async function parseEditInstruction(
  opts: ParseInstructionOptions,
): Promise<ParseInstructionResult> {
  if (!shouldUseRemote(opts.cfg)) {
    const missing = remoteMissingFields(opts.cfg)
    return {
      ok: false,
      reason: 'not-configured',
      message: `AI 还没配好，还缺${missing.join('、')}`,
    }
  }
  if (!opts.text.trim()) {
    return { ok: false, reason: 'empty', message: '还没有正文可以改' }
  }
  if (!opts.instruction.trim()) {
    return { ok: false, reason: 'empty', message: '没听清你要改什么' }
  }

  try {
    const raw = await callChat(
      opts.cfg,
      [
        { role: 'system', content: PARSE_SYSTEM },
        { role: 'user', content: buildParseUserMessage(opts) },
      ],
      /*
       * ★ `thinking: false` —— 2026-09-21 家长说「现在的思考好像有点问题」，
       *   查官方文档后确认：思考模式**默认开着**（effort 默认 high），
       *   而这一件事只是"把一句话翻成一条 JSON 指令"，不是推理题。
       *   开着它 = 孩子每次说完都要多等一段思维链，还多花钱；
       *   而且思考模式下 `temperature` 会被**静默忽略**（官方文档原话：
       *   "设置参数不会报错，但也不会生效"），我们传的 0.7 等于白传。
       *
       * ⚠️ 只关这一条（改作文的翻译）。点评 / 写法那几条**保持默认**——
       *    那些是真的要"想"，思维链对质量有帮助，别顺手一起关掉。
       */
      { json: true, thinking: false, signal: opts.signal },
    )

    const parsed = extractJson<Record<string, unknown>>(raw)
    /*
     * 抠不出 JSON，或者形状不对（包括"模型不听话、回了一篇散文"）
     * —— 都归到 unknown，不归 network。
     *
     * 这条分类是有用的：unknown 表示"这次没听懂"；报成 network 会让诊断日志
     * 把"模型乱回"记成"网络问题"，下次查起来就被带偏了。
     * （⚠️ 以前这里还写着"调用方会退回本地解析器再试一次" ——
     *  2026-09-21 家长定了「改作文必须是 AI 模型处理」之后**不再退回了**，见 VoiceComposer。）
     */
    const intent = parsed ? toInstruction(parsed) : null
    if (!intent) {
      return {
        ok: false,
        reason: 'unknown',
        message: '没太听懂你想怎么改，换个说法再试试',
      }
    }

    /*
     * ★★ 来源闸门 —— 「AI 不能自创内容」在代码上的落点。
     *
     * 走到这里，形状已经合法了（模型交不出整篇正文），但 `to` / `text`
     * 还是自由字符串：它完全可以在这里塞自己造的字。
     * 闸门把"来源"也卡死：要写进去的每一个字，必须是**孩子那句话里的**。
     * 详见 domain/provenance.ts。
     *
     * ⚠️ 判据必须用**孩子说的那句**（`opts.instruction`），不是模型改写过的
     *    任何东西 —— 拿模型自己的输出去校验模型自己的输出，等于没校验。
     */
    const verdict = checkProvenance(intent, opts.instruction)
    if (!verdict.ok) {
      return { ok: false, reason: 'invented', message: verdict.message }
    }

    return { ok: true, intent, message: '' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 接口明确回了错（4xx/5xx）和连不上要分开说 —— 家长的动作不一样
    const isServer = /接口返回 \d/.test(msg)
    return {
      ok: false,
      reason: isServer ? 'server' : 'network',
      message: isServer ? `AI 拒绝了这次请求：${msg}` : `没能听懂：${msg}`,
    }
  }
}

/* ============================================================
   五、日记点评
   ============================================================ */

export interface DiaryReviewOptions {
  text: string
  grade: GradeLevel
  cfg: AiConfig
  signal?: AbortSignal
}

export interface DiaryReviewResult {
  review: DiaryReview
  engine: 'local' | 'remote'
  warning?: string
}

const DIARY_SYSTEM = `你是一位温柔的中国小学语文老师，正在看学生的日记。
日记重在「愿意写」，所以评语要格外温柔、多肯定、少挑刺。
同时给出一版「优化后的日记」，帮孩子把话说顺，但必须保留孩子的语气和真实想法，不要改成作文腔。
必须严格输出 JSON，不要输出解释文字。`

function buildDiaryUserMessage(opts: DiaryReviewOptions, a: TextAnalysis): string {
  return `请点评这篇【${opts.grade} 年级】学生的日记。

日记内容：
"""
${opts.text}
"""

基础统计：字数 ${a.wordCount}，句子 ${a.sentenceCount}，好词：${a.goodWords.join('、') || '无'}，感官：${a.senses.join('、') || '无'}

输出 JSON：
{
  "summary": "点评，50-90 字，温柔鼓励为主",
  "strengths": [{ "title": "好在哪(8字内)", "evidence": "引用日记里的具体内容", "emoji": "表情" }],
  "polished": "优化后的日记，保留孩子语气，只是把句子理顺、补上连接词和感受",
  "mindMap": { "label": "中心词", "emoji": "📔", "children": [ { "label": "今天的事", "emoji": "🌤️", "children": [{ "label": "要点", "emoji": "✏️" }] }, { "label": "我的心情", "emoji": "💗", "children": [{ "label": "要点", "emoji": "✨" }] } ] }
}`
}

export async function reviewDiaryWithAi(
  opts: DiaryReviewOptions,
): Promise<DiaryReviewResult> {
  const analysis = analyzeText(opts.text)

  const localReview = (): DiaryReview => {
    const r = reviewDiary({ text: opts.text, analysis, grade: opts.grade })
    return {
      at: Date.now(),
      summary: r.summary,
      strengths: r.strengths,
      mindMap: r.mindMap,
      polished: r.polished,
      stars: r.stars,
      engine: 'local',
    }
  }

  if (!shouldUseRemote(opts.cfg)) {
    const missing = remoteMissingFields(opts.cfg)
    return {
      review: localReview(),
      engine: 'local',
      ...(missing.length > 0
        ? { warning: `AI 设置里还缺${missing.join('、')}，先用了本地引擎。去设置页补全试试。` }
        : {}),
    }
  }

  try {
    const raw = await callChat(
      opts.cfg,
      [
        { role: 'system', content: DIARY_SYSTEM },
        { role: 'user', content: buildDiaryUserMessage(opts, analysis) },
      ],
      { json: true, signal: opts.signal },
    )

    const parsed = extractJson<Partial<DiaryReview>>(raw)
    if (!parsed?.summary) throw new Error('AI 返回的点评格式不对')

    const fallback = localReview()
    return {
      review: {
        at: Date.now(),
        summary: nonEmpty(parsed.summary, fallback.summary),
        strengths: sanitizeStrengths(parsed.strengths, fallback.strengths),
        mindMap: sanitizeMindMap(parsed.mindMap, fallback.mindMap),
        polished: nonEmpty(parsed.polished, fallback.polished),
        stars: typeof parsed.stars === 'number' ? parsed.stars : fallback.stars,
        engine: 'remote',
      },
      engine: 'remote',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (opts.cfg.fallbackToLocal) {
      return {
        review: localReview(),
        engine: 'local',
        warning: `AI 点评失败，已用本地引擎顶上：${msg}`,
      }
    }
    throw err
  }
}

/* ============================================================
   六、连通性测试
   ============================================================ */

export interface TestResult {
  ok: boolean
  message: string
  /** 往返耗时 */
  ms?: number
}

/** 设置页的「测试连接」按钮 */
export async function testAiConnection(cfg: AiConfig): Promise<TestResult> {
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    return { ok: false, message: '请先填完接口地址、密钥和模型名' }
  }
  const t0 = Date.now()
  try {
    const content = await callChat(
      cfg,
      [
        { role: 'system', content: '你是一个测试助手。' },
        { role: 'user', content: '只回复两个字：正常' },
      ],
      { timeoutMs: 15_000 },
    )
    return {
      ok: true,
      message: `连接成功：${content.trim().slice(0, 30)}`,
      ms: Date.now() - t0,
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    }
  }
}

/* ============================================================
   七、给设置页用的默认配置
   ============================================================ */

/* ------------------------------------------------------------
   内置密钥 —— ⚠️ 读这段再改
   ------------------------------------------------------------
   和 `src/platform/transcribe.ts` 里的 `VOLC_TEST_API_KEY` 是同一套做法：
   把 key 填在这一行，App 装好就是配好的，家长不用进设置页。

   **只填这一行就够了。** `mode` 是从它推出来的 —— 见下面
   `defaultAiConfig()`。这是故意的：光有 key 而没有把 mode 切成
   'remote'，`shouldUseRemote()` 会直接返回 false，整条大模型链路
   一声不响地关着。这正是「改作文好像没实现」的真正原因。

   ⚠️ 代价（和火山那把一样）：
     · 密钥打进 APK 就等于**公开**。任何人拿到包 `strings` 一下就能抠出来。
     · DeepSeek 是按 token 计费的，被人拿去刷就是直接烧钱。
     · 所以只用于自用测试。要对外发，就挪到构建期注入
       （`.env` + `VITE_` 前缀），让仓库里不留明文。

   留空 = 走本地规则（点评/改作文都用本地启发式，不联网）。
   ============================================================ */
export const AI_TEST_API_KEY = ''

/**
 * DeepSeek 当前的正式模型名。
 *
 * ★ 只许在这一行改。它同时被三处读：默认配置、服务商预设、老存档迁移。
 *   以前这个字符串在三处各写了一遍 —— 改一处忘两处，就会出现
 *   "新装的用新模型、老装的还钉在旧模型上"这种最难查的漂移。
 */
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash'

/**
 * 已经被官方弃用、只会被**临时兼容路由**的旧名。
 *
 * 2026-09-10 V4.1 Flash 上线后，`deepseek-chat` 和 `deepseek-v4-flash`
 * 都还能用，但官方说明是"临时路由到 V4.1 Flash，建议尽快迁移到正式名"。
 * 留着这份名单是为了把老存档里的死名字换成正式名 ——
 * 见 `db.ts` 的 `migrateRetiredDeepSeekModel`。
 */
export const RETIRED_DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-v4-flash']

/** DeepSeek 官方的 base_url —— 迁移时用它判断"这条配置是不是我们预置的那份" */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'

export function defaultAiConfig(): AiConfig {
  return {
    // ★ 不写死 'local'：填了 key 就自动走远程。
    //   少一步「切远程」的手工操作，也就少一个"以为配好了其实没开"的坑。
    mode: AI_TEST_API_KEY ? 'remote' : 'local',
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: AI_TEST_API_KEY,
    // ★ 2026-09-20 换的：`deepseek-chat` → `deepseek-flash`。
    //   V4.1 Flash（官方调用名 `deepseek-flash`）2026-09-10 正式上线，
    //   官方口径是"全面超越 V4 Pro"，旧的 `deepseek-chat` / `deepseek-v4-flash`
    //   只是**临时**兼容路由到它 —— 生产配置建议尽快统一成正式名，
    //   免得哪天兼容策略变了，我们这边一声不响地降级。
    //   base_url 没变，所以这是一处纯改名。
    model: DEFAULT_DEEPSEEK_MODEL,
    fallbackToLocal: true,
    extraPrompt: '',
  }
}

/**
 * 存着的那份「更好的写法」是不是**跟当前配置对不上**了。
 *
 * 为什么需要这个判断：写法是**存进作品里**的（`work.modelEssay`），
 * 点进去默认直接展示，不再重算 —— 这是为了省一次 AI 调用。
 * 但家长改完 AI 配置、或者第一次把密钥填上之后，
 * 存着的那份还是**旧引擎**写的。不给提示的话，他点进去看到的还是旧的，
 * 只会得出「我改了设置，怎么一点变化都没有 / 改动没生效」这个结论 ——
 * 而代码其实是生效的，只是**没有人去重算**。
 *
 * 返回 true 时界面应该：说清这份是谁写的 + 给一个「重新生成」的按钮。
 *
 * ⚠️ 老数据里没有 `engine` 字段（这个字段是后加的）——
 *    那种情况下**不判断**，否则会给一堆历史作品误报"这是旧的"。
 */
export function isEssayStale(
  essay: { engine?: 'local' | 'remote' } | undefined,
  cfg: AiConfig,
): boolean {
  if (!essay?.engine) return false
  const wanted = shouldUseRemote(cfg) ? 'remote' : 'local'
  return essay.engine !== wanted
}

/** 常见服务商的预设，方便家长一键填 */
export const AI_PRESETS: { label: string; baseUrl: string; model: string; note: string }[] = [
  {
    label: 'DeepSeek',
    baseUrl: DEEPSEEK_BASE_URL,
    model: DEFAULT_DEEPSEEK_MODEL,
    note: '国内可直连，性价比高（V4.1 Flash）',
  },
  {
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    note: '阿里云，兼容模式',
  },
  {
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    note: '有免费额度',
  },
  {
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    note: '长文本强',
  },
  {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    note: '需要海外网络',
  },
  {
    label: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    note: '完全离线，密钥随便填',
  },
]

export { CATEGORIES }
