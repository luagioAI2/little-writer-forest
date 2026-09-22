/* ============================================================
   背诵比对引擎 —— 背完整范文，骨架当提示
   ============================================================

   设计意图（v2 按用户反馈调整过）：

   v1 的写法是「只背主干」：
     范文被剥成「阳光照草地」，孩子背这个。
     问题：孩子记住的是电报体，永远背不出满分作文的语感。
     用户原话：「背诵尽可能要跟满分作文一样的。」

   v2 改成「背完整范文，骨架作提示」：
     · 比对目标是**完整范文句子**（SkeletonLine.full）
     · 骨架（core）和修饰词（modifiers）退到「提示卡」的位置 ——
       孩子卡壳时可以点开，看到首字、字数、以及被隐藏的修饰词，
       从而想起整句，而不是直接抄答案
     · 匹配**宽容**：长句漏一两个修饰词仍然算过

   为什么匹配要宽容：
     语音识别本来就会错字、漏字，孩子紧张也会卡壳。
     我们用「包含 + 相似度 + 片段覆盖」三重判定，宁可宽松也不打击孩子。
   ============================================================ */

import type { RecitationReward, SkeletonLine } from './types'
import { pickBlessing } from './cards'

/* ============================================================
   一、文本归一化
   ============================================================ */

/** 去掉标点、空格，只留汉字和字母数字 */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[\s，。！？、；：""''「」『』（）()《》【】…—～~·,.;:!?"'`-]/g, '')
    .toLowerCase()
}

/**
 * 常见同音/近音混淆对。
 *
 * 语音识别对中文的声调和小学生口齿不清特别容易出错，
 * 所以做一层宽松映射 —— 目的是鼓励，不是考听力。
 */
const HOMOPHONE_MAP: [RegExp, string][] = [
  [/的|得|地/g, '的'],
  [/像|向|象/g, '像'],
  [/在|再/g, '在'],
  [/做|作/g, '做'],
  [/那|哪/g, '那'],
  [/他|她|它/g, '他'],
  [/飘|漂/g, '飘'],
  [/座|坐/g, '坐'],
  [/蓝|篮/g, '蓝'],
  [/圆|园/g, '圆'],
  [/已|以/g, '已'],
]

function soften(text: string): string {
  let out = normalizeForMatch(text)
  for (const [re, to] of HOMOPHONE_MAP) out = out.replace(re, to)
  return out
}

/* ============================================================
   二、相似度
   ============================================================ */

/**
 * 编辑距离 —— 用滚动数组，避免长文本爆内存。
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = new Array<number>(b.length + 1)
  let cur = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    const tmp = prev
    prev = cur
    cur = tmp
  }
  return prev[b.length]
}

/** 相似度 0-1 */
export function similarity(a: string, b: string): number {
  const x = soften(a)
  const y = soften(b)
  if (!x && !y) return 1
  if (!x || !y) return 0
  const maxLen = Math.max(x.length, y.length)
  return 1 - levenshtein(x, y) / maxLen
}

/**
 * 判断一句主干有没有背出来。
 *
 * 判定顺序：
 *   1. 完全包含 → 满分
 *   2. 相似度够高 → 按相似度给分
 *   3. 长句允许"覆盖大部分内容"也算过（孩子可能跳字）
 */
/**
 * 判断一句完整范文句子有没有背出来。
 *
 * v2 的难点：目标是十几个字的完整句子，而孩子是用**整段流式**的
 * 语音识别文本送进来的（没有可靠的停顿边界）。所以判定要分三层：
 *
 *   1. 直接包含           → 100
 *   2. 对识别文本做滑窗，找和目标最像的那一段 → 取最佳局部相似度
 *      （这一步是关键：不能拿整段 300 字去跟一句 20 字的比，
 *        那样分母太大，孩子明明背对了也会被噪声拖成低分）
 *   3. 片段覆盖度          → 兜底，孩子跳字时也能过
 */
export function matchLine(
  heard: string,
  core: string,
): { score: number; matched: boolean } {
  const h = soften(heard)
  const c = soften(core)
  if (!c) return { score: 100, matched: true }
  if (!h) return { score: 0, matched: false }

  // 1. 直接包含
  if (h.includes(c)) return { score: 100, matched: true }

  // 2. 最佳局部相似度：在识别文本上开一个和目标等长的窗口滑动，
  //    取相似度最高的那一段。这样"分母"始终是目标句长度，
  //    不会被无关的上下文稀释。
  const bestLocal = bestWindowSimilarity(h, c)

  // 3. 片段覆盖度
  const chunkHit = chunkCoverage(h, c)

  const score = Math.round(Math.max(bestLocal, chunkHit * 0.95) * 100)

  // 完整句子较长（>=12 字），漏一两个修饰词很正常 —— 放宽到 58 分
  const passLine = c.length >= 12 ? 58 : c.length >= 8 ? 62 : 66
  return { score, matched: score >= passLine }
}

/**
 * 滑窗取最佳局部相似度。
 *
 * 窗口长度 = 目标长度 ±20%，步长按目标长度的 1/4 取，
 * 兼顾精度和性能（孩子的录音一般也就几十到几百字）。
 */
function bestWindowSimilarity(h: string, c: string): number {
  const target = c.length
  if (target === 0) return 1
  if (h.length < target * 0.6) return similarity(h, c)

  const minWin = Math.max(2, Math.floor(target * 0.8))
  const maxWin = Math.ceil(target * 1.2)
  const step = Math.max(1, Math.floor(target / 4))

  let best = 0
  for (let win = minWin; win <= maxWin; win += Math.max(1, Math.floor(step / 2))) {
    for (let i = 0; i + win <= h.length; i += step) {
      const seg = h.slice(i, i + win)
      const s = similarity(seg, c)
      if (s > best) best = s
      if (best === 1) return 1
    }
  }
  return best
}

/** 主干被覆盖了多少（按 2 字滑窗命中率） */
function chunkCoverage(heard: string, core: string): number {
  if (core.length < 2) return heard.includes(core) ? 1 : 0
  const size = core.length <= 6 ? 2 : 3
  let hit = 0
  let total = 0
  for (let i = 0; i + size <= core.length; i++) {
    total += 1
    const chunk = core.slice(i, i + size)
    if (heard.includes(chunk)) hit += 1
  }
  return total === 0 ? 0 : hit / total
}

/* ============================================================
   三、整篇比对
   ============================================================ */

export interface LineMatchResult {
  core: string
  matched: boolean
  heard?: string
  score: number
}

export interface RecitationResult {
  /** 总匹配度 0-100 */
  matchScore: number
  /** 逐句结果 */
  lineMatches: LineMatchResult[]
  /** 背出来的句数 */
  hitCount: number
  /** 总句数 */
  totalCount: number
  /** 星级 1-3 */
  stars: 1 | 2 | 3
  /** 给孩子的反馈 */
  feedback: string
}

/**
 * 把孩子的整段录音和骨架逐句比对。
 *
 * 做法：不要求孩子按顺序一句一句停顿，而是把整段识别文本
 * 拿去找每一句主干 —— 因为孩子背的时候经常连读。
 */
export function compareRecitation(
  transcript: string,
  lines: SkeletonLine[],
): RecitationResult {
  // v2：比对的是**完整范文句子**（l.full），骨架只作提示。
  // 原因：用户明确要求「背诵尽可能要跟满分作文一样的」——
  // 只背主干的话，孩子记住的是一句电报体，而不是范文的语感。
  // 这里对 full 做宽容匹配：修饰词漏一两个不影响判定。
  const cores = lines.map((l) => l.full || l.core).filter(Boolean)
  if (cores.length === 0) {
    return {
      matchScore: 0,
      lineMatches: [],
      hitCount: 0,
      totalCount: 0,
      stars: 1,
      feedback: '这篇范文还没有骨架，先去写一篇作文吧',
    }
  }

  const full = soften(transcript)
  const sentences = splitHeard(transcript)

  const lineMatches: LineMatchResult[] = cores.map((core) => {
    // 先跟整段比
    const whole = matchLine(full, core)
    // 再逐句比，取最好的一次
    let best = whole
    let bestHeard: string | undefined
    for (const s of sentences) {
      const m = matchLine(s, core)
      if (m.score > best.score) {
        best = m
        bestHeard = s
      }
    }
    return { core, matched: best.matched, heard: bestHeard, score: best.score }
  })

  const hitCount = lineMatches.filter((l) => l.matched).length
  const totalCount = lineMatches.length
  // 总分：命中率为主，平均句分为辅 —— 避免"背对一半但每句都差一点"拿高分
  const hitRate = hitCount / totalCount
  const avgScore = lineMatches.reduce((a, b) => a + b.score, 0) / totalCount
  const matchScore = Math.round(hitRate * 70 + avgScore * 0.3)

  const stars: 1 | 2 | 3 = matchScore >= 88 ? 3 : matchScore >= 65 ? 2 : 1

  return {
    matchScore,
    lineMatches,
    hitCount,
    totalCount,
    stars,
    feedback: recitationFeedback(matchScore, hitCount, totalCount),
  }
}

/** 把识别文本切成句子 */
function splitHeard(text: string): string[] {
  return text
    .split(/[。！？!?；;，,、\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function recitationFeedback(score: number, hit: number, total: number): string {
  if (score >= 88) return `一字不差！${total} 句全背下来了，这个记性不得了 🧠✨`
  if (score >= 75) return `背得很顺，${total} 句里对了 ${hit} 句，就差一点点 🎤`
  if (score >= 65) return `大部分都记住了！再念两遍就全对了 💪`
  if (score >= 40) return `已经记住 ${hit} 句啦，剩下的再听一遍试试 👂`
  return '没关系，第一遍都这样。先看一遍骨架，再来一次 😊'
}

/* ============================================================
   四、奖励结算
   ============================================================ */

export interface RecitationRewardInput {
  matchScore: number
  stars: 1 | 2 | 3
  /** 日记签到 Buff 带来的金币加成 */
  coinBoost?: number
  /** 这篇是不是第一次背（重复背诵奖励递减，但不为零） */
  repeat?: number
}

/**
 * 背诵奖励。
 *
 * 注意：即使背得不好也有奖励 —— 开口本身就是值得鼓励的事。
 * 但背得好明显更多，形成正反馈。
 */
export function computeRecitationReward(
  input: RecitationRewardInput,
): { coins: number; xp: number; blessing: string } {
  const { matchScore, stars } = input
  const coinBoost = Math.max(1, input.coinBoost ?? 1)
  // 重复背诵：第 1 次全价，之后每次打 7 折，最低 3 折
  const repeatFactor = Math.max(0.3, Math.pow(0.7, input.repeat ?? 0))

  const baseCoins = 12 + Math.round(matchScore * 0.55)
  const starBonus = (stars - 1) * 12
  const coins = Math.max(6, Math.round((baseCoins + starBonus) * coinBoost * repeatFactor))

  const baseXp = 10 + Math.round(matchScore * 0.22)
  const xp = Math.max(6, Math.round((baseXp + starBonus) * repeatFactor))

  const blessing =
    stars === 3
      ? pickBlessing('recitation')
      : stars === 2
        ? pickBlessing('mid')
        : pickBlessing('low')

  return { coins, xp, blessing }
}

/** 组装完整的背诵奖励对象 */
export function buildRecitationReward(
  result: RecitationResult,
  opts: { coinBoost?: number; repeat?: number; cards?: RecitationReward['cards'] } = {},
): RecitationReward {
  const { coins, xp, blessing } = computeRecitationReward({
    matchScore: result.matchScore,
    stars: result.stars,
    coinBoost: opts.coinBoost,
    repeat: opts.repeat,
  })
  return { coins, xp, cards: opts.cards ?? [], blessing }
}

/* ============================================================
   五、提示：下一句是什么
   ============================================================ */

/**
 * 孩子卡壳时，给一个提示。
 *
 * v2 的提示对象变了：现在背的是完整范文句子，所以提示要帮孩子
 * **想起被隐藏的修饰**，而不只是告诉他句子的长度。
 *
 * 分三级递进，绝不直接把整句念出来 —— 那样就变成抄答案了：
 *   1 级：第一个字 + 字数
 *   2 级：前两个字 + 这一句里的修饰词（这是回想起整句的关键）
 *   3 级：前三个字 + 全部修饰词
 *
 * @param target 要背的完整句子（不再只是主干）
 * @param modifiers 这一句被剥离出来的修饰成分，用来做 2/3 级提示
 */
export function hintForLine(target: string, level: 1 | 2 | 3, modifiers: string[] = []): string {
  if (!target) return ''
  const len = target.replace(/[，。！？、；：\s]/g, '').length
  const mods = modifiers.filter(Boolean)

  if (level === 1) {
    return `这句有 ${len} 个字，第一个字是「${target[0]}」`
  }

  if (level === 2) {
    const modHint = mods.length > 0 ? `这一句里有：${mods.slice(0, 3).join('、')}` : ''
    return `开头是「${target.slice(0, 2)}」，一共 ${len} 个字${modHint ? `。${modHint}` : ''}`
  }

  const modHint = mods.length > 0 ? `别忘了这些词：${mods.join('、')}` : ''
  return `「${target.slice(0, 3)}……」（还剩 ${Math.max(0, len - 3)} 个字）${modHint ? `。${modHint}` : ''}`
}

/** 背诵进度文案 */
export function recitationProgress(hit: number, total: number): string {
  if (total === 0) return ''
  const pct = Math.round((hit / total) * 100)
  if (pct >= 100) return '全部拿下！🎉'
  if (pct >= 70) return `已经 ${hit}/${total} 句，快好了 🚀`
  if (pct >= 40) return `${hit}/${total} 句，过半了 💪`
  return `${hit}/${total} 句，继续加油 🌱`
}
