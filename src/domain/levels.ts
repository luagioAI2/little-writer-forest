/* ============================================================
   段位系统 —— 「成长树」的十二段位骨架
   ============================================================

   设计目标（按需求逐条落实）：

   1. 看得见成长 —— 每个段位对应树苗的一个形态，
      从一颗种子长成参天大树，孩子一眼看到自己到哪了。
   2. 升级要有台阶感 —— 每升一段有明显仪式感。
   3. 降级要极难 —— 上了台阶就是孩子的成就，不能轻易剥夺。
      机制：站稳后获得「护盾」，下滑先扣盾，盾用完还要连续
      多次明显下滑才真正掉段。
   4. 预测 → 实际 —— 刚开始是预测水平（波动大），
      积累足够作品后转为实际水平（稳定）。
   5. 只要坚持就涨 —— 即使分数没提高，持续练习也有 XP 保底。
   ============================================================ */

import type { LevelConfidence, LevelMeta, LevelState, WorkScore } from './types'

/* ---------------- 段位表 ---------------- */

export const LEVELS: LevelMeta[] = [
  {
    index: 0,
    name: '灵芽树',
    title: '萌芽',
    emoji: '🌱',
    minXp: 0,
    treeStage: 0,
    color: '#15803d',
    ability: '能写出简单句子，表达基本意思。',
    story: '相传王羲之小时候练字，并没有一开始就写出传世名帖。他从最简单的横、竖、撇、捺开始，一遍又一遍地练习。作文也是一样，最初的每一句话，就像泥土里刚刚冒出的嫩芽——也许还很小，但它代表着真正的开始。',
    growth: '敢写下第一句话，就是作文之树第一次发芽。',
  },
  {
    index: 1,
    name: '青华树',
    title: '幼苗',
    emoji: '🌿',
    minXp: 120,
    treeStage: 1,
    color: '#16a34a',
    ability: '能写出完整段落，语句通顺，能够把一件事情说清楚。',
    story: '司马光小时候砸缸的故事，流传了千百年。故事其实并不复杂：孩子掉进缸里，司马光想到办法，砸破水缸，救出了伙伴。一件小事，只要按照事情的发展说清楚，就能成为一个完整的故事。',
    growth: '从一句话，到一段完整的话，你开始拥有了自己的故事。',
  },
  {
    index: 2,
    name: '扶摇树',
    title: '小树',
    emoji: '🌳',
    minXp: 300,
    treeStage: 2,
    color: '#22c55e',
    ability: '能围绕主题写作，内容具体，文章有基本的结构。',
    story: '庄子写《逍遥游》，开篇便讲鲲鹏从北海飞向南冥。看似是在写一只巨大的鸟，其实一直围绕着「自由与眼界」展开。一篇作文也是如此，不能想到哪里写到哪里，而要像鲲鹏一样，始终朝着自己的方向飞。',
    growth: '有了主题，文章才知道自己要飞向哪里。',
  },
  {
    index: 3,
    name: '琼华树',
    title: '花成',
    emoji: '🌸',
    minXp: 560,
    treeStage: 3,
    color: '#fb7185',
    ability: '能运用多种描写，让人物、景物和事情更加生动，文章开始有画面感。',
    story: '王维写山水，不只是告诉别人「这里很美」，而是用声音、颜色和光影，让读者仿佛真的走进山林。同样是一场雨，有的作文只写「下雨了」，而好的作文会让人看见雨丝、听见雨声、感受到空气里的清凉。',
    growth: '当文字开始有颜色、有声音、有温度，作文便开出了第一朵花。',
  },
  {
    index: 4,
    name: '苍梧树',
    title: '稳成',
    emoji: '🌲',
    minXp: 900,
    treeStage: 4,
    color: '#f97316',
    ability: '结构清晰，条理分明，能够合理安排内容，表达更加有逻辑。',
    story: '曾国藩做事很重视章法。他认为很多事情不能只靠一时的聪明，而要一步一步把基础做好。写作文也一样，开头写什么，中间写什么，最后怎样收束，都需要提前想清楚。树只有根扎得稳，才能经得住风雨。',
    growth: '好文章不是想到哪写到哪，而是每一步都有自己的位置。',
  },
  {
    index: 5,
    name: '紫宸树',
    title: '细成',
    emoji: '🍃',
    minXp: 1350,
    treeStage: 5,
    color: '#f59e0b',
    ability: '善于描写人物和情感，能够抓住细节，让文章更加真实、生动、有感染力。',
    story: '杜甫写人，很少只说一句「他很悲伤」。他会写一个动作、一句话、一个神态，让人物自己走进读者心里。真正打动人的，往往不是「大道理」，而是一个小小的细节。',
    growth: '细节是一颗种子，种进文章里，情感才会真正生根。',
  },
  {
    index: 6,
    name: '赤霄树',
    title: '深成',
    emoji: '✨',
    minXp: 1900,
    treeStage: 6,
    color: '#a855f7',
    ability: '能够表达自己的独特观点，对事情有一定的思考和理解，文章开始有深度。',
    story: '苏轼经历过人生的大起大落，却没有让自己的文字停留在「抱怨命运」。面对风雨，他写下「一蓑烟雨任平生」，把一次风雨写成了自己对人生的理解。作文真正的成长，也是在「发生了一件事」之后，开始问自己：这件事让我明白了什么？',
    growth: '从「我看到了什么」，走向「我想到了什么」。',
  },
  {
    index: 7,
    name: '玉衡树',
    title: '成熟',
    emoji: '☁️',
    minXp: 2600,
    treeStage: 7,
    color: '#0ea5e9',
    ability: '语言优美，结构多变，能够灵活运用修辞，让文章更有文采。',
    story: '李白的文字有时像山，有时像江河，有时又像一阵突然吹来的风。同样是写月亮，他可以写得豪迈，也可以写得浪漫。真正成熟的作者，不只是会用好词，而是能够根据内容选择最合适的表达方式。',
    growth: '真正的文采，不是堆砌华丽的词，而是让文字听从你的心意。',
  },
  {
    index: 8,
    name: '沧溟树',
    title: '卓越',
    emoji: '⭐',
    minXp: 3500,
    treeStage: 8,
    color: '#8b5cf6',
    ability: '能够写出有深度的主题，展现独特的观察和思考，文章具有鲜明的个人视角。',
    story: '「横看成岭侧成峰，远近高低各不同。」同一座庐山，从不同的位置看，会得到完全不同的样子。优秀的作文也是如此。同一件事情，每个人都可以写，但真正厉害的人，会找到属于自己的那个角度。',
    growth: '当别人看到一座山，你开始看到山后的世界。',
  },
  {
    index: 9,
    name: '星辰树',
    title: '才成',
    emoji: '🌙',
    minXp: 4700,
    treeStage: 9,
    color: '#6366f1',
    ability: '语言富有诗意，能够灵活运用比喻、拟人等表达方式，文章具有创造力和独特风格。',
    story: '李贺喜欢把现实中的事物写出奇异的色彩。他的诗里有天上的云、月中的桂树，也有各种令人惊叹的想象。作文到了这个阶段，不再只是「把事情写好」，而是开始创造属于自己的表达方式。',
    growth: '当文字不再只是记录世界，而开始创造一个新的世界，星辰便亮了起来。',
  },
  {
    index: 10,
    name: '玄极树',
    title: '大师',
    emoji: '☀️',
    minXp: 6300,
    treeStage: 10,
    color: '#f43f5e',
    ability: '能够从多个角度思考问题，深入理解人生与社会，文字有思想、有力量。',
    story: '司马迁遭受人生巨大的苦难，却没有让自己的生命停留在痛苦之中。他选择继续完成《史记》，把个人的经历化成了对历史、人物和时代的记录。真正有力量的文字，不只是写得漂亮，而是能够承载一个人的思考，甚至留下一个时代的声音。',
    growth: '文字越深，能够承载的东西就越多。',
  },
  {
    index: 11,
    name: '通天神树',
    title: '巅峰',
    emoji: '🌈',
    minXp: 8500,
    treeStage: 11,
    color: '#e11d48',
    ability: '文思泉涌，风格独特，能够自由驾驭文字，写出真正属于自己的作品，并用文字打动和影响他人。',
    story: '曹雪芹把人物、故事、情感、时代和人生的思考，都融进了一部《红楼梦》。到了真正的高峰，作文已经不再只是「完成一篇文章」，而是在用文字表达一个人的眼睛、心灵和思想。这时候，每一棵树上的果实，都不再是别人教给你的答案，而是你自己长出来的东西。',
    growth: '树高千丈，根仍在泥土；文章登峰，笔仍在自己手中。',
  },
]

export function levelAt(index: number): LevelMeta {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index))]
}

/** 按累计 XP 反查段位 */
export function levelForXp(xp: number): number {
  let idx = 0
  for (let i = 0; i < LEVELS.length; i++) {
    if (xp >= LEVELS[i].minXp) idx = i
    else break
  }
  return idx
}

/* ---------------- 常量 ---------------- */

/** 判定为「实际水平」所需的已评分作品数 */
export const ESTABLISHED_THRESHOLD = 8

/** 转为「趋于稳定」所需的篇数 */
export const SETTLING_THRESHOLD = 4

/** 滑动平均窗口 */
export const RECENT_WINDOW = 6

/** 站上一个新台阶后获得的护盾数 */
export const SHIELDS_ON_LEVEL_UP = 2

/** 护盾上限 */
export const MAX_SHIELDS = 4

/** 判定为「明显下滑」的分数差值 */
export const DECLINE_DELTA = 10

/** 连续明显下滑多少次才真正降段 */
export const DECLINE_STREAK_TO_DROP = 4

/**
 * 每次提交的 XP 保底。
 *
 * 这是需求里「即便没啥进步，一直刷也要所有增加」的落实点：
 * 只要交了一篇，不管分数多低，都有底分。
 * 分数越高，XP 越多（非线性，让高分有爽感）。
 */
export function xpForScore(score: number, streakBonus = 0): number {
  const base = 22 // 保底：交了就有
  // 分数贡献：60 分是分水岭，60 以下给基础增长，60 以上加速
  const normalized = Math.max(0, Math.min(100, score))
  const scoreXp = Math.round(Math.pow(normalized / 100, 1.6) * 90)
  return base + scoreXp + streakBonus
}

/* ---------------- 初始状态 ---------------- */

export function initialLevelState(): LevelState {
  return {
    levelIndex: 0,
    progress: 0,
    xp: 0,
    confidence: 'predicted',
    scoredCount: 0,
    recentScores: [],
    bestScore: 0,
    shields: 0,
    declineStreak: 0,
  }
}

/** 段位内的进度百分比 0-100 */
export function progressPercent(state: LevelState): number {
  const cur = levelAt(state.levelIndex)
  const next = LEVELS[state.levelIndex + 1]
  if (!next) return 100
  const span = next.minXp - cur.minXp
  if (span <= 0) return 100
  return Math.max(0, Math.min(100, Math.round(((state.xp - cur.minXp) / span) * 100)))
}

/** 距离下一段还差多少 XP */
export function xpToNext(state: LevelState): { need: number; next?: LevelMeta } {
  const next = LEVELS[state.levelIndex + 1]
  if (!next) return { need: 0 }
  return { need: Math.max(0, next.minXp - state.xp), next }
}

/* ---------------- 判级核心 ---------------- */

export interface LevelUpdateResult {
  next: LevelState
  leveledUp: boolean
  leveledDown: boolean
  /** 升级时新获得的护盾 */
  shieldsGained: number
  /** 本次实际获得的 XP */
  xpGained: number
  /** 置信度是否刚刚提升 */
  confidenceChanged: boolean
  /** 给孩子的提示文案 */
  message?: string
}

/**
 * 把一次评分结果喂进等级系统。
 *
 * 这是整个 App 最需要小心的地方 —— 规则必须做到
 * 「上去容易下来难」，否则孩子会不敢写。
 *
 * ★ 核心机制：段位由 XP 决定，而 XP 可以**被扣**。
 *
 *   为什么要这样设计？
 *     因为需求同时要求两件看起来矛盾的事：
 *       ① 「即便没啥进步，一直刷也要增加」→ XP 必须只涨不跌
 *       ② 「非常多次水平降低才会降级」    → 段位必须能降
 *
 *     如果段位 = f(XP) 且 XP 单调，那降级分支永远走不到（死代码）。
 *     所以我们的解法是：XP 平时只涨，只有在「实际水平已建立 +
 *     护盾耗尽 + 连续多次明显下滑」三个条件同时满足时，才扣掉
 *     当前段位跨度的一半。
 *
 *   这个扣法天然实现了「越站稳越难掉」：
 *     刚升上来时 XP 刚过门槛，扣一次掉半段、扣两次就掉一段；
 *     而在段位里积累越深，XP 离门槛越远，同样的一扣就不够了。
 */
export function applyScore(state: LevelState, score: WorkScore): LevelUpdateResult {
  const total = Math.round(score.total)
  const deck = [...state.recentScores, total].slice(-RECENT_WINDOW)
  const scoredCount = state.scoredCount + 1

  /* ---- 1. 置信度推进 ---- */
  let confidence: LevelConfidence = state.confidence
  if (scoredCount >= ESTABLISHED_THRESHOLD) confidence = 'established'
  else if (scoredCount >= SETTLING_THRESHOLD) confidence = 'settling'
  const confidenceChanged = confidence !== state.confidence

  /* ---- 2. 先记 XP ----
     保底 + 分数贡献 + 连续上升奖励，让"越写越好"有正反馈 */
  const rising = deck.length >= 3 && isRising(deck)
  const xpGained = xpForScore(total, rising ? 18 : 0)
  let xp = state.xp + xpGained

  /* ---- 3. 下滑判定（三重保护） ---- */
  let shields = state.shields
  let declineStreak = state.declineStreak
  let penaltyApplied = 0
  let message: string | undefined

  // ① 只有「实际水平」建立后才可能降级
  const eligible = confidence === 'established'
  const avgRecent = mean(deck.slice(-3))
  const clearlyDeclining = deck.length >= 3 && avgRecent < state.bestScore - DECLINE_DELTA

  if (eligible && clearlyDeclining) declineStreak += 1
  else declineStreak = 0

  // ② ③ 连续明显下滑够多次，才动手；先扣护盾，再扣 XP
  if (eligible && declineStreak >= DECLINE_STREAK_TO_DROP) {
    if (shields > 0) {
      shields -= 1
      declineStreak = 0
      message = `有点点退步哦，不过你有 ${shields} 个护盾帮你挡住了，继续加油！`
    } else {
      penaltyApplied = Math.round(spanOf(state.levelIndex) * 0.5)
      xp = Math.max(0, xp - penaltyApplied)
      declineStreak = 0
    }
  }

  /* ---- 4. 由 XP 反推段位 ---- */
  const levelIndex = levelForXp(xp)
  const leveledUp = levelIndex > state.levelIndex
  const leveledDown = levelIndex < state.levelIndex
  let shieldsGained = 0

  if (leveledUp) {
    shieldsGained = Math.min(
      MAX_SHIELDS - shields,
      SHIELDS_ON_LEVEL_UP * (levelIndex - state.levelIndex),
    )
    shields = Math.min(MAX_SHIELDS, shields + shieldsGained)
    declineStreak = 0
    message = `太厉害了！你的成长树长成了「${levelAt(levelIndex).name}」${levelAt(levelIndex).emoji}`
  } else if (leveledDown) {
    message = '最近有点累了吧？先退一小步，咱们歇歇再往上爬。'
  } else if (penaltyApplied > 0) {
    message = '最近状态有点下滑哦，不过你的底子还在，稳稳写几篇就回来了 💪'
  }

  const bestScore = Math.max(state.bestScore, total)

  const next: LevelState = {
    levelIndex,
    progress: 0,
    xp,
    confidence,
    scoredCount,
    recentScores: deck,
    bestScore,
    shields,
    declineStreak,
  }
  next.progress = progressPercent(next)

  return {
    next,
    leveledUp,
    leveledDown,
    shieldsGained,
    xpGained,
    confidenceChanged,
    message,
  }
}

/** 当前段位的 XP 跨度（到下一段还差多少） */
function spanOf(index: number): number {
  const cur = LEVELS[index]
  const next = LEVELS[index + 1]
  if (!cur || !next) return 600
  return Math.max(1, next.minXp - cur.minXp)
}

/**
 * 背诵、写日记等也贡献 XP，但比作文少。
 * 这些是「坚持分」，不参与段位升降判定（不改变 scoredCount）。
 */
export function applyBonusXp(state: LevelState, xpGain: number): LevelUpdateResult {
  const xp = state.xp + xpGain
  const levelIndex = levelForXp(xp)
  const leveledUp = levelIndex > state.levelIndex
  let shields = state.shields
  let shieldsGained = 0

  if (leveledUp) {
    shieldsGained = Math.min(MAX_SHIELDS - shields, SHIELDS_ON_LEVEL_UP)
    shields = Math.min(MAX_SHIELDS, shields + shieldsGained)
  }

  const next: LevelState = { ...state, xp, levelIndex, shields }
  next.progress = progressPercent(next)

  return {
    next,
    leveledUp,
    leveledDown: false,
    shieldsGained,
    xpGained: xpGain,
    confidenceChanged: false,
    message: leveledUp
      ? `你的成长树又长高啦！现在是「${levelAt(levelIndex).name}」${levelAt(levelIndex).emoji}`
      : undefined,
  }
}

/* ---------------- 辅助 ---------------- */

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

/** 判断最近成绩是否在稳步上升 */
function isRising(scores: number[]): boolean {
  if (scores.length < 3) return false
  const half = Math.floor(scores.length / 2)
  const firstHalf = mean(scores.slice(0, half))
  const secondHalf = mean(scores.slice(half))
  return secondHalf - firstHalf >= 5
}

/** 当前水平的文字描述 */
export function confidenceLabel(c: LevelConfidence): string {
  switch (c) {
    case 'predicted':
      return '预测水平'
    case 'settling':
      return '观察中'
    case 'established':
      return '实际水平'
  }
}

/** 给孩子看的置信度说明 */
export function confidenceHint(c: LevelConfidence, count: number): string {
  switch (c) {
    case 'predicted':
      return `这是猜的哦，再多写 ${ESTABLISHED_THRESHOLD - count} 篇就能算准啦`
    case 'settling':
      return `正在观察你的水平，再写 ${ESTABLISHED_THRESHOLD - count} 篇就稳定了`
    case 'established':
      return '这是你真实的水平，稳稳的'
  }
}

/** 最近平均分 */
export function recentAverage(state: LevelState): number {
  return Math.round(mean(state.recentScores))
}
