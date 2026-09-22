/* ============================================================
   离线评分引擎 —— 看图作文分析
   ============================================================

   设计底线（需求明确要求）：
   ★ 关于「能不能改写孩子的作文」—— 这条需求改过，完整说明见 ai.ts 文件头。

   这个本地引擎的职责被限定为：
     1. 观察 —— 数一数孩子用了多少词、什么词、什么结构
     2. 评价 —— 给出分数和维度分析
     3. 引导 —— 指出方向，但不给现成句子
     4. 写法 —— 顺着孩子的稿子给一份「更好的写法」
        （存在 `modelEssay` 里，**不覆盖**孩子的原文；
          孩子随时能对照，但正文永远是他自己写的那份）

   评分方法：纯中文规则 + 词表 + 结构启发式。
   不需要联网，速度快，结果稳定，也方便写测试。
   ============================================================ */

import type {
  DimensionScores,
  MindMapNode,
  ModelEssay,
  PromptImage,
  ScoreDimension,
  SkeletonLine,
  StrengthPoint,
  Suggestion,
  WorkScore,
} from './types'
import { DIMENSIONS } from './types'
import { composeModelEssay } from './modelEssay'
import { imageWords } from './imageHints'

/* ============================================================
   一、中文基础工具
   ============================================================ */

export function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 统计字数 —— 中文按字算，连续的英文/数字按词算。
 * 这比单纯 split('').length 更贴近学校的统计口径。
 */
export function countWords(text: string): number {
  const t = normalize(text)
  if (!t) return 0
  const cjk = t.match(/[\u4e00-\u9fa5]/g) ?? []
  const words = t.match(/[a-zA-Z]+|\d+/g) ?? []
  return cjk.length + words.length
}

/** 按中文标点切句 */
export function splitSentences(text: string): string[] {
  return normalize(text)
    .split(/[。！？!?；;…]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/* ============================================================
   二、词库
   ============================================================ */

/** 常见「好词」—— 出现即加分。按类别分，方便给针对性建议 */
const GOOD_WORDS: Record<string, string[]> = {
  色彩: [
    '金灿灿', '红彤彤', '绿油油', '蓝湛湛', '白茫茫', '黑漆漆', '紫莹莹',
    '五颜六色', '五彩缤纷', '姹紫嫣红', '万紫千红', '碧绿', '火红', '雪白',
  ],
  声音: [
    '叮叮咚咚', '哗啦啦', '轰隆隆', '叽叽喳喳', '沙沙', '咕噜咕噜',
    '滴滴答答', '呼呼', '潺潺', '琅琅', '清脆', '悦耳', '静悄悄',
  ],
  形态: [
    '毛茸茸', '圆滚滚', '胖乎乎', '软绵绵', '亮晶晶', '水灵灵', '沉甸甸',
    '轻飘飘', '光秃秃', '湿漉漉', '弯弯曲曲', '高耸', '挺拔',
  ],
  心情: [
    '高兴', '开心', '兴奋', '激动', '紧张', '害怕', '难过', '委屈',
    '温暖', '幸福', '感动', '自豪', '骄傲', '愧疚', '着急', '期待',
    '心花怒放', '提心吊胆', '依依不舍', '美滋滋', '甜丝丝',
  ],
  动作: [
    '蹑手蹑脚', '连蹦带跳', '飞快', '缓缓', '轻轻', '悄悄', '猛地',
    '端详', '凝视', '端坐', '扑', '蹭', '拽', '捧', '拂',
  ],
  时间: [
    '清晨', '黎明', '傍晚', '黄昏', '深夜', '午后', '刹那间', '顿时',
    '忽然', '转眼间', '一转眼', '渐渐地', '慢慢地', '紧接着',
  ],
}

/** 常见修辞手法的标志词 */
const RHETORIC_MARKERS: { name: string; pattern: RegExp; hint: string }[] = [
  { name: '比喻', pattern: /像|好像|仿佛|似的|如同|好似|宛如/, hint: '你用了「像…一样」这类比喻' },
  { name: '拟人', pattern: /(风|雨|树|花|小草|太阳|月亮|星星|小猫|小狗)(在|儿)?(笑|哭|唱|跳舞|点头|招手|说话|睡着|醒来|探出头)/, hint: '你把小东西写活了' },
  { name: '排比', pattern: /(.{2,6})[，,]\1|有的.{2,10}有的.{2,10}有的/, hint: '你用了排比，节奏很好' },
  { name: '感叹', pattern: /多么|真是一?[个只条片朵]|好一?[个只条片朵]|极了/, hint: '你的感叹很有力量' },
]

/** 感官词 —— 观察力的重要指标 */
const SENSE_WORDS: Record<string, string[]> = {
  视觉: ['看', '望', '瞧', '颜色', '红', '绿', '蓝', '黄', '白', '黑', '亮', '暗', '形状', '圆', '方', '长', '高', '大', '小'],
  听觉: ['听', '声音', '响', '叫', '唱', '喊', '静', '吵', '声'],
  触觉: ['摸', '碰', '冷', '热', '暖', '凉', '软', '硬', '滑', '糙', '疼'],
  嗅觉: ['闻', '香', '臭', '味', '气味'],
  味觉: ['尝', '甜', '酸', '苦', '辣', '咸', '好吃', '美味'],
}

/** 关联词 —— 条理性的强信号 */
const CONNECTORS = [
  '因为', '所以', '虽然', '但是', '可是', '然而', '不但', '而且',
  '如果', '就', '首先', '然后', '接着', '最后', '于是', '突然',
  '后来', '不久', '原来', '原来如此', '一……就',
]

/** 时间顺序词 —— 看图作文特别是多图的关键 */
const TIME_ORDER = [
  '早上', '早晨', '上午', '中午', '下午', '傍晚', '晚上', '夜里',
  '有一天', '这天', '那天', '开始', '起先', '起初', '接着', '随后',
  '过了', '之后', '最后', '终于',
]

/** 情感直抒标志 —— 结尾有没有升华 */
const EMOTION_ENDINGS = [
  '我明白了', '我懂了', '我想', '我觉得', '我发现', '我感受到',
  '真', '太', '多么', '永远', '难忘', '开心', '幸福', '温暖',
]

/* ============================================================
   三、文本分析结果
   ============================================================ */

export interface TextAnalysis {
  wordCount: number
  sentenceCount: number
  /** 平均句长 */
  avgSentenceLen: number
  /** 命中的好词 */
  goodWords: string[]
  /** 命中的修辞 */
  rhetoric: { name: string; hint: string }[]
  /** 用到的感官 */
  senses: string[]
  /** 用到的关联词 */
  connectors: string[]
  /** 用到的时序词 */
  timeWords: string[]
  /** 段落数 */
  paragraphs: number
  /** 是否有明确结尾升华 */
  hasEmotionalEnding: boolean
  /** 标点使用丰富度（种类数） */
  punctuationVariety: number
  /** 首句 */
  firstSentence: string
  /** 末句 */
  lastSentence: string
}

export function analyzeText(raw: string): TextAnalysis {
  const text = normalize(raw)
  const sentences = splitSentences(text)
  const wordCount = countWords(text)
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean).length

  // 好词
  const goodWords: string[] = []
  for (const list of Object.values(GOOD_WORDS)) {
    for (const w of list) {
      if (text.includes(w) && !goodWords.includes(w)) goodWords.push(w)
    }
  }

  // 修辞
  const rhetoric = RHETORIC_MARKERS.filter((r) => r.pattern.test(text)).map((r) => ({
    name: r.name,
    hint: r.hint,
  }))

  // 感官
  const senses = Object.entries(SENSE_WORDS)
    .filter(([, words]) => words.some((w) => text.includes(w)))
    .map(([k]) => k)

  const connectors = CONNECTORS.filter((w) => text.includes(w))
  const timeWords = TIME_ORDER.filter((w) => text.includes(w))
  const hasEmotionalEnding = EMOTION_ENDINGS.some((w) =>
    sentences.length > 0 ? sentences[sentences.length - 1].includes(w) : false,
  )

  const punctSet = new Set((text.match(/[，。！？；：、…—·「」“”]/g) ?? []) as string[])

  return {
    wordCount,
    sentenceCount: sentences.length,
    avgSentenceLen: sentences.length ? Math.round(wordCount / sentences.length) : 0,
    goodWords,
    rhetoric,
    senses,
    connectors,
    timeWords,
    paragraphs,
    hasEmotionalEnding,
    punctuationVariety: punctSet.size,
    firstSentence: sentences[0] ?? '',
    lastSentence: sentences[sentences.length - 1] ?? '',
  }
}

/* ============================================================
   四、五维打分
   ============================================================ */

interface ScoreInput {
  text: string
  analysis: TextAnalysis
  /** 该题目重点考察的维度 */
  focus: ScoreDimension[]
  /** 年级，决定标准高低 */
  grade: number
  /** 建议字数区间 */
  wordRange: [number, number]
  /** 图片，用于判断"图上的元素提到了没有" */
  images: PromptImage[]
  /** 题目关键词，命中说明切题 */
  keywords?: string[]
}

/** 年级难度系数：低年级标准低，高年级标准高 */
function gradeFactor(grade: number): number {
  if (grade <= 2) return 0.72
  if (grade <= 4) return 0.85
  if (grade <= 6) return 1.0
  return 1.12
}

function scoreObservation(inp: ScoreInput): number {
  const { analysis, grade } = inp
  const f = gradeFactor(grade)
  let score = 40

  // 感官覆盖（最多 5 种）
  score += Math.min(analysis.senses.length, 5) * 7 * f
  // 好词（形容词/形态类最能体现观察）
  score += Math.min(analysis.goodWords.length, 8) * 3 * f
  // 修辞
  score += analysis.rhetoric.length * 4 * f
  // 字数达到基本要求
  const [lo] = inp.wordRange
  const lenRatio = Math.min(analysis.wordCount / Math.max(lo, 1), 1.3)
  score += lenRatio * 12 * f
  // 标点丰富度
  score += Math.min(analysis.punctuationVariety, 6) * 1.5

  return clampScore(score)
}

function scoreStructure(inp: ScoreInput): number {
  const { analysis, grade, wordRange } = inp
  const f = gradeFactor(grade)
  let score = 42

  // 句子数量够不够（太少说明没展开）
  score += Math.min(analysis.sentenceCount, 10) * 2.6 * f
  // 关联词
  score += Math.min(analysis.connectors.length, 5) * 5 * f
  // 时序词 —— 多图作文的命脉
  score += Math.min(analysis.timeWords.length, 5) * 5 * f
  // 分段
  if (analysis.paragraphs >= 3) score += 10
  else if (analysis.paragraphs === 2) score += 5
  // 有没有结尾
  if (analysis.hasEmotionalEnding) score += 8 * f
  // 字数达标
  const [lo, hi] = wordRange
  if (analysis.wordCount >= lo) score += 8
  if (analysis.wordCount > hi * 2) score -= 6 // 太啰嗦也扣一点

  // 句长过于整齐/过短说明句式单一
  if (analysis.avgSentenceLen > 0 && analysis.avgSentenceLen < 6) score -= 5

  return clampScore(score)
}

function scoreVocabulary(inp: ScoreInput): number {
  const { analysis, grade } = inp
  const f = gradeFactor(grade)
  let score = 38

  score += Math.min(analysis.goodWords.length, 10) * 4.2 * f
  score += analysis.rhetoric.length * 5 * f
  // 词汇密度：好词占比
  if (analysis.wordCount > 0) {
    const density = analysis.goodWords.length / (analysis.wordCount / 20)
    score += Math.min(density, 3) * 6
  }
  // 标点用得好也是"写得好"的一部分
  score += Math.min(analysis.punctuationVariety, 6) * 2

  return clampScore(score)
}

function scoreImagination(inp: ScoreInput): number {
  const { analysis, grade } = inp
  const f = gradeFactor(grade)
  let score = 45

  // 比喻拟人 = 想象
  const metaphor = analysis.rhetoric.find((r) => r.name === '比喻')
  const personify = analysis.rhetoric.find((r) => r.name === '拟人')
  if (metaphor) score += 14 * f
  if (personify) score += 14 * f
  if (analysis.rhetoric.length >= 2) score += 8
  if (analysis.rhetoric.length >= 3) score += 6

  // 想象类作文天然容易拿这方面的高分，但也看具体表达
  return clampScore(score)
}

function scoreEmotion(inp: ScoreInput): number {
  const { analysis, grade, text } = inp
  const f = gradeFactor(grade)
  let score = 42

  if (analysis.hasEmotionalEnding) score += 16 * f
  // 心情词
  const moodHits = GOOD_WORDS['心情'].filter((w) => text.includes(w)).length
  score += Math.min(moodHits, 5) * 4 * f
  // 第一人称视角（写自己的感受）
  const firstPerson = (text.match(/我/g) ?? []).length
  score += Math.min(firstPerson, 8) * 1.5
  // 感叹号
  const exclaims = (text.match(/[！!]/g) ?? []).length
  score += Math.min(exclaims, 3) * 3

  return clampScore(score)
}

function clampScore(n: number): number {
  return Math.round(Math.max(8, Math.min(98, n)))
}

/* ============================================================
   五、生成完整评分
   ============================================================ */

export function scoreComposition(input: ScoreInput): WorkScore {
  const { analysis, focus } = input

  const dimensions: DimensionScores = {
    observation: scoreObservation(input),
    structure: scoreStructure(input),
    vocabulary: scoreVocabulary(input),
    imagination: scoreImagination(input),
    emotion: scoreEmotion(input),
  }

  // 加权总分，题目重点维度权重上浮
  let totalWeight = 0
  let weighted = 0
  for (const d of DIMENSIONS) {
    const isFocus = focus.includes(d.key)
    const w = d.weight * (isFocus ? 1.6 : 1)
    totalWeight += w
    weighted += dimensions[d.key] * w
  }
  const rawTotal = totalWeight > 0 ? weighted / totalWeight : 60

  // 字数严重不足时给个上限，避免"写两句就高分"
  const [lo] = input.wordRange
  const lengthPenalty =
    analysis.wordCount < lo * 0.4 ? 0.78 : analysis.wordCount < lo * 0.7 ? 0.9 : 1

  const total = clampScore(Math.round(rawTotal * lengthPenalty))

  return {
    at: Date.now(),
    total,
    dimensions,
    summary: buildSummary(total, dimensions, analysis),
    strengths: buildStrengths(analysis, dimensions),
    suggestions: buildSuggestions(analysis, dimensions, input),
    mindMap: buildMindMap(analysis, dimensions),
    stars: starsForScore(total),
    engine: 'local',
  }
}

export function starsForScore(total: number): number {
  if (total >= 92) return 5
  if (total >= 80) return 4
  if (total >= 65) return 3
  if (total >= 48) return 2
  return 1
}

/* ---------------- 评语 ---------------- */

function buildSummary(total: number, d: DimensionScores, a: TextAnalysis): string {
  // 找出最强的和最弱的维度
  const entries = DIMENSIONS.map((m) => ({ ...m, v: d[m.key] })).sort((x, y) => y.v - x.v)
  const best = entries[0]
  const worst = entries[entries.length - 1]

  const opener =
    total >= 90
      ? '这篇真的很出彩，小笔苗要给你鼓个掌 👏'
      : total >= 78
        ? '写得很好，已经是一篇完整又生动的小作文了 🌟'
        : total >= 62
          ? '这一篇稳稳的，基本功看得见 👍'
          : total >= 45
            ? '有想法了，再把话说开一点就更好了 🌿'
            : '你已经迈出第一步，这最重要 🌰'

  const bestLine = `最亮的是你的「${best.label}」——${best.kidDesc}，你做到了 ${best.v} 分。`

  const worstLine =
    worst.v >= 70
      ? `其他方面也都很均衡，没有明显短板。`
      : `「${worst.label}」还有空间，${worstHint(worst.key, a)}`

  const lengthLine =
    a.wordCount < 60
      ? '下次可以多写几句，把你看到的都倒出来。'
      : a.wordCount > 300
        ? '写得很充实，注意别让好句子被淹没了。'
        : ''

  return [opener, bestLine, worstLine, lengthLine].filter(Boolean).join('')
}

function worstHint(key: ScoreDimension, a: TextAnalysis): string {
  switch (key) {
    case 'observation':
      return a.senses.length < 3
        ? '下次闭上眼睛想想：除了看到的，还有听到的吗？闻到的吗？'
        : '再仔细看看图上还有什么小细节没被写进去。'
    case 'structure':
      return '试试先说「一开始怎样」，再说「后来怎样」，最后说「我心里怎样」。'
    case 'vocabulary':
      return a.goodWords.length < 3
        ? '把「很漂亮」换成「金灿灿的」，感觉就不一样了。'
        : '再多用一两个新鲜的词，句子会更有味道。'
    case 'imagination':
      return '图上是静止的，但你可以想：它心里在想什么？它接下来会做什么？'
    case 'emotion':
      return '结尾加一句你自己的感受，比如「那一刻我……」，文章就立起来了。'
  }
}

/* ---------------- 亮点 ---------------- */

function buildStrengths(a: TextAnalysis, d: DimensionScores): StrengthPoint[] {
  const out: StrengthPoint[] = []

  if (a.goodWords.length > 0) {
    out.push({
      title: `用上了 ${a.goodWords.length} 个好词`,
      evidence: a.goodWords.slice(0, 4).join('、'),
      emoji: '📚',
    })
  }

  for (const r of a.rhetoric.slice(0, 2)) {
    out.push({
      title: `会用${r.name}了`,
      evidence: r.hint,
      emoji: r.name === '比喻' ? '🎈' : r.name === '拟人' ? '🧚' : '🎵',
    })
  }

  if (a.senses.length >= 3) {
    out.push({
      title: `一次动用了 ${a.senses.length} 种感官`,
      evidence: a.senses.join(' + '),
      emoji: '👂',
    })
  }

  if (a.connectors.length >= 2) {
    out.push({
      title: '句子之间有连接词，读起来顺',
      evidence: a.connectors.slice(0, 3).join('、'),
      emoji: '🔗',
    })
  }

  if (a.timeWords.length >= 2) {
    out.push({
      title: '按照时间顺序写，条理很清楚',
      evidence: a.timeWords.slice(0, 4).join(' → '),
      emoji: '🕐',
    })
  }

  if (a.hasEmotionalEnding) {
    out.push({
      title: '结尾有自己的感受，很打动人',
      evidence: a.lastSentence.slice(0, 30),
      emoji: '💗',
    })
  }

  if (a.sentenceCount >= 6) {
    out.push({
      title: `写了 ${a.sentenceCount} 句话，内容很充实`,
      evidence: `一共 ${a.wordCount} 个字`,
      emoji: '📝',
    })
  }

  // 最突出的维度 —— 用分数说话，让孩子清楚自己的强项在哪
  const best = DIMENSIONS.map((m) => ({ ...m, v: d[m.key] })).sort((x, y) => y.v - x.v)[0]
  if (best && best.v >= 72) {
    out.push({
      title: `「${best.label}」特别棒 · ${best.v} 分`,
      evidence: best.kidDesc,
      emoji: best.emoji,
    })
  }

  // 如果实在没什么亮点，也给一条真诚的
  if (out.length === 0) {
    out.push({
      title: '你动手写了，这本身就是最难的',
      evidence: `已经写了 ${a.wordCount} 个字，比空白强太多了`,
      emoji: '🌱',
    })
  }

  // 按维度得分高的优先展示
  return out.slice(0, 5)
}

/* ---------------- 建议 ---------------- */

function buildSuggestions(
  a: TextAnalysis,
  d: DimensionScores,
  inp: ScoreInput,
): Suggestion[] {
  const out: Suggestion[] = []

  // 按得分从低到高给建议，先解决最弱项
  const weak = DIMENSIONS.map((m) => ({ ...m, v: d[m.key] }))
    .filter((m) => m.v < 75)
    .sort((x, y) => x.v - y.v)

  for (const m of weak) {
    const s = suggestionFor(m.key, a)
    if (s) out.push(s)
    if (out.length >= 3) break
  }

  // 字数问题
  const [lo] = inp.wordRange
  if (a.wordCount < lo * 0.7 && out.length < 3) {
    out.push({
      title: '可以再写长一点',
      how: `这篇写了 ${a.wordCount} 字，试试写到 ${lo} 字左右。想象你在给没看过这张图的人讲，你会多说点什么？`,
      emoji: '📏',
    })
  }

  if (out.length === 0) {
    out.push({
      title: '已经很棒了，来点小小的挑战',
      how: '下次试试换一个开头方式——比如用一句声音开头：「叮铃铃——」这样读者一下子就进来了。',
      emoji: '🚀',
    })
  }

  return out
}

function suggestionFor(key: ScoreDimension, a: TextAnalysis): Suggestion | null {
  switch (key) {
    case 'observation':
      return {
        title: '再仔细看看图',
        how:
          a.senses.length < 3
            ? '图上除了你看到的，还有声音吗？有味道吗？试着写一句「我好像听见了……」。'
            : '图里角落还有没有小东西？往往细节最能打动人。',
        emoji: '🔍',
      }
    case 'structure':
      return {
        title: '给文章理个顺序',
        how: '先说图上最先发生的事，再说接着发生的事，最后说你心里的感受。就像放电影一样一幕一幕来。',
        emoji: '🧩',
      }
    case 'vocabulary':
      return {
        title: '把普通的词换掉',
        how: a.goodWords.length < 3
          ? '找找文中的「很」「非常」「好看」这些词，试着各换成一个更有画面的词。换哪个由你决定。'
          : '再挑一句你觉得最普通的句子，用上一个新学的词试试。',
        emoji: '🖌️',
      }
    case 'imagination':
      return {
        title: '让想象飞一会儿',
        how: '图是静止的，但故事在动。想一想：画里的人接下来会做什么？他此刻在想什么？',
        emoji: '✨',
      }
    case 'emotion':
      return {
        title: '把心里话说出来',
        how: '在结尾加一句「那一刻，我心里……」。写你真实的感受，不用写得漂亮，写真就行。',
        emoji: '💌',
      }
  }
}

/* ---------------- 思维导图 ---------------- */

function buildMindMap(a: TextAnalysis, d: DimensionScores): MindMapNode {
  const children: MindMapNode[] = []

  // 开头
  children.push({
    label: '开头',
    emoji: '🚪',
    children: [
      {
        label: a.firstSentence ? a.firstSentence.slice(0, 18) : '还没有开头',
        emoji: '✏️',
      },
    ],
  })

  // 中间：按内容类型归类
  const middle: MindMapNode[] = []
  if (a.senses.length > 0) {
    middle.push({ label: `感官描写：${a.senses.join('、')}`, emoji: '👀' })
  }
  if (a.goodWords.length > 0) {
    middle.push({
      label: `好词：${a.goodWords.slice(0, 5).join('、')}`,
      emoji: '📚',
    })
  }
  if (a.rhetoric.length > 0) {
    middle.push({
      label: `修辞：${a.rhetoric.map((r) => r.name).join('、')}`,
      emoji: '🎨',
    })
  }
  if (a.timeWords.length > 0) {
    middle.push({ label: `顺序：${a.timeWords.join(' → ')}`, emoji: '🕐' })
  }
  if (middle.length === 0) {
    middle.push({ label: '中间部分还可以更充实', emoji: '🌫️' })
  }
  children.push({ label: '中间', emoji: '🌊', children: middle.slice(0, 5) })

  // 结尾
  children.push({
    label: '结尾',
    emoji: '🎯',
    children: [
      {
        label: a.hasEmotionalEnding
          ? a.lastSentence.slice(0, 18)
          : '结尾还没有自己的感受',
        emoji: a.hasEmotionalEnding ? '💗' : '🌫️',
      },
    ],
  })

  // 用最强的维度命名中心
  const best = DIMENSIONS.map((m) => ({ ...m, v: d[m.key] })).sort((x, y) => y.v - x.v)[0]

  return {
    label: `我的作文 · ${best.label}最强`,
    emoji: '🌳',
    children,
  }
}

/* ============================================================
   六、满分范文生成
   ------------------------------------------------------------
   实现已搬到 `modelEssay.ts`（v2 引擎）。
   这里只保留一个薄薄的适配层，原因是：
     · 老的调用方（ai.ts / 测试）用的是 buildModelEssay(ModelEssayInput) 这个签名
     · 把签名留着，就不用改一堆调用点，将来也方便对比新旧两版

   为什么搬走：旧版正文完全由 SCENE_BANK 硬编码模板拼成，
   孩子原文只贡献 4 个好词，结果「写妈妈的范文」会变成
   「推开窗，一片《我的妈妈》扑面而来」。v2 从孩子的稿子里
   抽真实素材（人物/地点/时间/物件/事件），再顺着往下拔高。
   ============================================================ */

export interface ModelEssayInput {
  /** 孩子的原文 */
  childText: string
  analysis: TextAnalysis
  /** 题目 */
  title: string
  /** 图片 */
  images: PromptImage[]
  grade: number
  category: string
  /** 建议字数 */
  wordRange: [number, number]
  /**
   * ★ 家长在设置里写的附加提示词（`AiConfig.extraPrompt`）。
   *
   * 2026-09-19 补的这一行：以前它只进 AI 提示词，
   * 本地引擎完全读不到 —— 家长配了「多用比喻」，
   * AI 一旦没配好或降级到本地，这条要求就被静默丢弃，
   * 而设置页上明明写着「改范文时会参考这些要求」。
   * 别把这一行删掉。
   */
  extraPrompt?: string
}

/**
 * 生成「更好的写法」（本地引擎）。
 *
 * ★ 唯一不变的底线：它**不覆盖**孩子的稿子 ——
 *   孩子的原文永远原样保留在作品里，这份只是给他对照用的。
 *
 * ⚠️ 「它是不是改写」这个问题改过一次，别照旧注释理解：
 *   旧说法是「范文是满分示范，不是孩子原文的改写」，
 *   但 v2 起它**就是**顺着孩子的内容改写的（「他本可以写成的样子」），
 *   2026-09-17 家长也明确要求走改写。见 ai.ts 文件头。
 *
 * ★ 2026-09-18：`imageHints` 这一行是补的。
 *   以前 `inp.images` 收下了却**从来没往下传**，
 *   所以本地引擎写出来的「看图作文」跟图毫无关系 ——
 *   家长报的「没有结合图片」就是这里。别把这一行删掉。
 */
export function buildModelEssay(inp: ModelEssayInput): ModelEssay {
  return composeModelEssay({
    childText: inp.childText,
    title: inp.title,
    category: inp.category,
    grade: inp.grade,
    targetLen: inp.wordRange[1],
    imageHints: imageWords(inp.images),
    extraPrompt: inp.extraPrompt,
    extract: extractSkeleton,
  })
}

/* ============================================================
   七、骨架提取（背诵用）
   ============================================================ */

/**
 * 叠字**名词** —— 它们是句子成分（主语/宾语），不是修饰语。
 *
 * 为什么要这张表：下面的叠词正则 `(.)\1` 分不清「蓝蓝」和「妈妈」，
 * 而「妈妈给我买了一条围巾」里的「妈妈」是**主语**。
 * 把它收进修饰词，提示卡上就会写着
 * 「可以自己加的修饰：妈妈」—— 这是把句子成分讲错了。
 *
 * ⚠️ 用**精确表**，不用 `includes`/`startsWith` 之类的模糊匹配：
 *    这类判断一旦模糊，语义就会悄悄反过来，而且不报错。
 */
const REDUP_NOUNS = new Set([
  // 称谓
  '妈妈', '爸爸', '爷爷', '奶奶', '姥姥', '姥爷', '公公', '婆婆', '太太',
  '哥哥', '姐姐', '弟弟', '妹妹', '宝宝', '娃娃', '叔叔', '舅舅', '姑姑', '伯伯',
  // 名物
  '星星', '猩猩',
  // 名词性重叠 —— 当主语/宾语用，不是修饰
  // （刻意不收「天天/年年/处处」：那几个是状语，本来就是修饰语）
  '人人', '家家', '个个',
])

/**
 * 把句子拆成「主干 + 修饰」。
 *
 * 例：「金灿灿的阳光暖暖地照着碧绿的草地」
 *   → 主干：阳光照着草地
 *   → 修饰：金灿灿的、暖暖地、碧绿的
 *
 * 用途（v2 调整过）：
 *   背诵时**背的是完整范文**，骨架退到「卡壳时的提示」这个位置。
 *   所以这里抛出来的修饰词，会原样出现在提示卡里 ——
 *   孩子看到「可以自己加的修饰：金灿灿的、暖暖地、碧绿的」，
 *   就能想起整句该怎么说。
 *
 *   因此这一步宁可多留一点修饰，也不要把句子剥得太干：
 *   剥成「阳光照草地」这种电报体，既不美，也提示不了什么。
 */
export function extractSkeleton(sentence: string): {
  core: string
  modifiers: string[]
} {
  const modifiers: string[] = []
  let core = sentence

  // 1. 「XX的/地/得」结构 —— 中文修饰的主力，也是**最容易切错**的一步。
  //
  //    ⚠️ 关键原则：只能拿掉**定语/状语**，不能拿掉**中心语**。
  //    「湿漉漉的地方」→ 去掉「湿漉漉的」，留下「地方」（地方是中心语）
  //    「妈妈的样子」  → 整个是主语，一个都不能去
  //    「我最忘不掉的是妈妈的手」→ 去掉「的」，但「妈妈的手」要完整留着
  //
  //    判定启发式：拿掉的必须是「形容词性」的，即
  //      · 长度 2-4 个汉字 + 的/地/得
  //      · 并且不能以人称代词开头（「我的」「他的」单独处理）
  //
  //    只拿形容词，是这一版最重要的修正 —— 早先的贪婪正则会
  //    把「湿漉漉的地方」切成「心地方」，主干直接变成病句。
  const deSegments: string[] = []
  core = core.replace(/[\u4e00-\u9fa5]{2,4}[的地得]/g, (seg, offset: number) => {
    const body = seg.slice(0, -1)

    // (a) 句首的「XX的」通常是主语本身（「妈妈的样子」「我的小狗」），不动
    if (offset === 0) return seg

    // (b) 含人称代词的（我的 / 他的 / 别人的）—— 单独拆：
    //     「我最忘不掉的是妈妈的手」里的「是妈妈的」不是形容词修饰，保留
    if (/^[我你他她它谁]/.test(body)) {
      // 「我的」这种纯领属，可以拿（它修饰后面的中心语）
      if (body.length === 1) {
        deSegments.push(seg)
        return ''
      }
      return seg
    }

    // (c) 以「在/是/有/没有/像」开头的不是形容词（「在中国的」不成立，
    //     但「是在厨房里的」这种整体是状语从句，不拆）
    if (/^[在是有像和跟对把被让给]/.test(body)) return seg

    // (d) 形容词特征：重叠式（湿漉漉/亮晶晶）、"AB" 式叠词、
    //     或以常见形容词后缀结尾。命中才拿掉。
    const isAdj =
      /(.)\1/.test(body) ||                                    // 叠字：湿漉漉、亮晶晶
      /(金灿灿|红彤彤|绿油油|白茫茫|黑漆漆|暖融融|软绵绵|沉甸甸|毛茸茸|圆滚滚|胖乎乎|轻飘飘|水灵灵|笑眯眯|静悄悄)$/.test(body) ||
      /(灿烂|明亮|温暖|美丽|好看|漂亮|干净|清爽|热闹|安静|熟悉|陌生|普通|特别|温柔|认真|仔细|慢慢|轻轻|悄悄|紧紧|悄悄)$/.test(body) ||
      /^[小大高矮胖瘦长短粗细黑白红黄蓝绿紫灰金银]+$/.test(body)  // 单音节颜色/形状

    if (isAdj) {
      deSegments.push(seg)
      return ''
    }
    return seg
  })
  for (const m of deSegments) {
    if (m.length <= 8) modifiers.push(m)
  }

  // 2. 程度副词
  const advPattern = /(非常|特别|十分|格外|尤其|极其|有点儿|稍微)/g
  const advMatches = sentence.match(advPattern) ?? []
  modifiers.push(...advMatches)
  core = core.replace(advPattern, '')

  // 3. 比喻尾巴「像……一样 / 似的」—— 满分作文的核心修辞，必须收进提示
  const simPattern = /(像|好像|仿佛|如同|好似|宛如).{1,14}?(一样|似的|一般)/g
  const simMatches = sentence.match(simPattern) ?? []
  modifiers.push(...simMatches)
  core = core.replace(simPattern, '')

  // 4. 引号内的内容（对话 / 象声词）
  const quotePattern = /[「“"].{1,20}?[」”"]/g
  const quoteMatches = sentence.match(quotePattern) ?? []
  modifiers.push(...quoteMatches)
  core = core.replace(quotePattern, '')

  // 5. 叠词 —— 低年级最出彩的地方，单独收
  //
  //    ⚠️ 两道筛，都是 2026-09-19 踩出来的：
  //
  //    ① **已经被收走的叠词，别再单独收一遍。**
  //       「小草安安静静地站着」第 1 步收的是「安安静静地」，
  //       这一步的 `(.)\1` 又把 AABB 切成「安安」「静静」——
  //       提示卡上于是并排出现三个几乎一样的词，孩子看得一头雾水。
  //
  //    ② **叠字名词不是修饰语**（见 REDUP_NOUNS）。
  //       「妈妈给我买了一条围巾」里的「妈妈」是主语，
  //       收进修饰词就等于告诉孩子「妈妈是修饰」。
  const redupPattern = /([\u4e00-\u9fa5])\1/g
  const redupMatches = (sentence.match(redupPattern) ?? []).filter(
    (r) => !REDUP_NOUNS.has(r) && !modifiers.some((m) => m.includes(r)),
  )
  modifiers.push(...redupMatches)

  // 6. 五感动词短语 —— 「摸上去凉丝丝的」这种，是画面感的来源
  const sensePattern = /(看|望|瞧|听|闻|摸|碰|尝)(上去|起来|了|着)?[\u4e00-\u9fa50-9]{0,4}/g
  // 只在句尾出现时收，避免把谓语主干也吃掉
  const tail = sensePattern.exec(sentence.replace(/[。！？]+$/, ''))
  if (tail && tail.index >= sentence.length - 12) modifiers.push(tail[0])

  // 7. 清理标点，保留句末语气
  core = core
    .replace(/[，、；：]/g, '')
    .replace(/^[的地得]+/, '')
    .replace(/\s+/g, '')
    .trim()

  // 剥得太狠（剩不到 4 个字）说明原句本来就很简洁，或者这是个
  // 短句 —— 那就保留原句，修饰也清空，免得出现「核心比原文还长」的怪状
  if (countWords(core) < 4) {
    return { core: sentence.replace(/[，、；：]/g, '').trim(), modifiers: [] }
  }

  // 主干里不允许留下孤零零的「的/地/得」（切分残留）
  core = core.replace(/(^|[^\u4e00-\u9fa5])[的地得](?=$|[^\u4e00-\u9fa5])/g, '$1')

  return { core, modifiers: [...new Set(modifiers)].filter(Boolean).slice(0, 6) }
}

/** 从整篇范文提取骨架版本 */
export function buildSkeletonText(lines: SkeletonLine[]): string {
  return lines.map((l) => l.core).join('。') + '。'
}

/* ============================================================
   八、日记点评
   ============================================================ */

export interface DiaryReviewInput {
  text: string
  analysis: TextAnalysis
  grade: number
}

export interface DiaryReviewResult {
  summary: string
  strengths: StrengthPoint[]
  mindMap: MindMapNode
  polished: string
  stars: number
}

/**
 * 日记点评比作文宽松得多：
 * 日记重在「愿意写」，不是应付考试，所以分数和评语都要温柔。
 */
export function reviewDiary(inp: DiaryReviewInput): DiaryReviewResult {
  const { analysis, grade } = inp
  const f = gradeFactor(grade)

  // 日记分数整体比作文高一档
  let score = 55
  score += Math.min(analysis.sentenceCount, 12) * 2.4 * f
  score += Math.min(analysis.goodWords.length, 6) * 4 * f
  score += analysis.rhetoric.length * 4 * f
  score += Math.min(analysis.senses.length, 4) * 4 * f
  if (analysis.hasEmotionalEnding) score += 10 * f
  score += Math.min(Math.floor(analysis.wordCount / 40), 3) * 5
  const total = clampScore(Math.round(score))

  const strengths = buildStrengths(analysis, {
    observation: scoreObservation({
      text: inp.text,
      analysis,
      focus: [],
      grade,
      wordRange: [60, 300],
      images: [],
    }),
    structure: 70,
    vocabulary: 70,
    imagination: 70,
    emotion: 75,
  }).slice(0, 4)

  return {
    summary: diarySummary(total, analysis),
    strengths,
    mindMap: buildMindMap(analysis, {
      observation: 70,
      structure: 70,
      vocabulary: 70,
      imagination: 70,
      emotion: 75,
    }),
    polished: polishDiary(inp.text, analysis, grade),
    stars: starsForScore(total),
  }
}

function diarySummary(total: number, a: TextAnalysis): string {
  const opener =
    total >= 80
      ? '今天这篇日记写得真好，我读完还想再读一遍 😊'
      : total >= 62
        ? '把今天记下来了，真好 👍'
        : '你来写日记了，这就很了不起 🌱'

  const detail =
    a.goodWords.length > 0
      ? `特别是「${a.goodWords.slice(0, 3).join('、')}」这几个词，很有画面感。`
      : '下次可以试试把当时的样子说得再细一点。'

  const emo = a.hasEmotionalEnding
    ? '而且你写了自己的心情，这才是日记最珍贵的地方。'
    : '下次可以加一句当时的心情，以后翻出来会更有味道。'

  return `${opener}${detail}${emo}`
}

/**
 * 日记优化版。
 *
 * 这是需求里明确允许「直接给出 AI 优化」的地方（与作文不同），
 * 因为日记目的是帮孩子把话说顺，不是训练写作技巧。
 * 但我们仍然保持孩子的语气，不改成"作文腔"。
 */
function polishDiary(text: string, analysis: TextAnalysis, grade: number): string {
  let out = normalize(text)

  // 1. 句子之间补上连接词，让流水账变得连贯
  const sentences = splitSentences(out)
  if (sentences.length >= 3 && analysis.connectors.length === 0) {
    const connected: string[] = [sentences[0] + '。']
    for (let i = 1; i < sentences.length; i++) {
      const s = sentences[i]
      // 结尾句更容易是感受，用"后来"
      connected.push(s + '。')
    }
    out = connected.join('')
  }

  // 2. 补一个感受结尾（如果完全没有）
  if (!analysis.hasEmotionalEnding && grade >= 3) {
    out = out.replace(/[。！!]?$/, '。现在想起来，我心里还有点说不上来的感觉。')
  }

  // 3. 如果太短，明确提示而不是硬凑
  if (countWords(out) < 40) {
    out += '\n\n（小提示：可以再多说两句今天最好玩的地方，日记就越写越有意思啦。）'
  }

  return out
}
