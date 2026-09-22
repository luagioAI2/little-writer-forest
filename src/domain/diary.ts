/* ============================================================
   日记 —— 连续签到、Buff、掉落
   ============================================================
   ============================================================ */

import type { CardDrop, DiaryEntry, DiaryStreak, OwnedCard } from './types'
import { buffForStreak, nextBuffInfo, pickBlessing, rollDrops } from './cards'
import { dayKey, daysBetween, recentDayKeys } from './time'

/* ============================================================
   一、签到与 Buff
   ============================================================ */

export function initialStreak(): DiaryStreak {
  const b = buffForStreak(0)
  return {
    days: 0,
    best: 0,
    lastDayKey: undefined,
    buffTier: b.tier,
    buffLabel: b.label,
    rarityBoost: b.rarityBoost,
    coinBoost: b.coinBoost,
  }
}

export interface StreakUpdate {
  next: DiaryStreak
  /** 今天是不是第一次打卡 */
  isNewDay: boolean
  /** 连续天数是否增加了 */
  extended: boolean
  /** 断签了 */
  broken: boolean
  /** 是否刚好跨到新的 Buff 档位 */
  buffUpgraded: boolean
  message?: string
}

/**
 * 打卡。
 *
 * 规则：
   · 同一天重复写日记只算一次签到（天数不加）
   · 昨天写过 → 连续 +1
   · 中间断了 → 从 1 重新开始，但历史最长保留
 */
export function checkInStreak(
  streak: DiaryStreak,
  now: number = Date.now(),
): StreakUpdate {
  const today = dayKey(now)
  const last = streak.lastDayKey

  if (last === today) {
    return {
      next: streak,
      isNewDay: false,
      extended: false,
      broken: false,
      buffUpgraded: false,
    }
  }

  const gap = last ? daysBetween(last, today) : null
  const extended = gap === 1
  const broken = gap !== null && gap > 1
  const days = extended ? streak.days + 1 : 1

  const before = buffForStreak(streak.days)
  const after = buffForStreak(days)
  const buffUpgraded = after.tier > before.tier

  const next: DiaryStreak = {
    days,
    best: Math.max(streak.best, days),
    lastDayKey: today,
    buffTier: after.tier,
    buffLabel: after.label,
    rarityBoost: after.rarityBoost,
    coinBoost: after.coinBoost,
  }

  let message: string | undefined
  if (buffUpgraded) {
    message = `连续 ${days} 天！Buff 升级：${after.label} ✨`
  } else if (extended && days > 1) {
    message = `连续第 ${days} 天啦，保持住 🔥`
  } else if (broken) {
    message = '重新开始也没关系，今天又来了就是最棒的 🌱'
  }

  return { next, isNewDay: true, extended, broken, buffUpgraded, message }
}

/** 打卡日历：最近 n 天的完成情况 */
export interface StreakCalendarDay {
  key: string
  done: boolean
  isToday: boolean
}

export function streakCalendar(
  entries: { dayKey: string }[],
  days = 14,
  now: number = Date.now(),
): StreakCalendarDay[] {
  const done = new Set(entries.map((e) => e.dayKey))
  const today = dayKey(now)
  return recentDayKeys(days, now).map((key) => ({
    key,
    done: done.has(key),
    isToday: key === today,
  }))
}

/** 距离下一档 Buff 还差几天（给界面做进度提示） */
export function streakNextGoal(streak: DiaryStreak) {
  return nextBuffInfo(streak.days)
}

/* ============================================================
   二、日记奖励
   ============================================================ */

export interface DiaryReward {
  coins: number
  xp: number
  cards: CardDrop[]
  blessing: string
  /** 本次用的 Buff */
  buffLabel: string
}

/**
 * 日记完成后的结算。
 *
 * 与作文的区别：日记奖励更看重"坚持"，所以连续天数本身
 * 就是一个独立加成项，而不只是看写得好不好。
 *
 * ★ 奖励每天只算一次（isNewDay）。
 *   同一天把日记改一改再提交，只给新的点评，不再给金币 / 经验 / 卡片 ——
 *   否则「反复提交同一篇日记」就是一条刷奖励的路子。
 *   金币也不吃「树加成」之外的东西：加成由 store 统一乘（见 economy.ts）。
 */
export function computeDiaryReward(opts: {
  stars: number
  wordCount: number
  streak: DiaryStreak
  isNewDay: boolean
  owned: OwnedCard[]
}): DiaryReward {
  const { stars, wordCount, streak, isNewDay } = opts

  const blessing =
    streak.days >= 3
      ? pickBlessing('streak')
      : stars >= 4
        ? pickBlessing('diary')
        : pickBlessing('low')

  // 今天已经记过了：只给点评，不再给奖励
  if (!isNewDay) {
    return { coins: 0, xp: 0, cards: [], blessing, buffLabel: streak.buffLabel }
  }

  // 基础金币：写得多一点、星多一颗，都给更多
  const base = 15 + Math.min(Math.floor(wordCount / 20), 8) * 3 + stars * 8

  // 连续加成：天数越高越爽，但封顶避免通胀
  const streakBonus = Math.min(streak.days, 14) * 3

  const coins = Math.round((base + streakBonus) * streak.coinBoost)
  const xp = Math.round((12 + stars * 6 + Math.min(streak.days, 14) * 2) * 1)

  // 只有新的一天打卡才掉卡，避免一天刷多次
  const cards = rollDrops({
    source: 'diary',
    score: stars * 20,
    rarityBoost: streak.rarityBoost,
    owned: opts.owned,
  })

  // 连续 3 天以上额外掉一张
  if (streak.days > 0 && streak.days % 3 === 0) {
    cards.push(
      ...rollDrops({
        source: 'streak',
        rarityBoost: streak.rarityBoost * 1.3,
        count: 1,
        owned: opts.owned,
      }),
    )
  }

  return { coins, xp, cards, blessing, buffLabel: streak.buffLabel }
}

/* ============================================================
   三、日记条目工具
   ============================================================ */

/** 今天的日记（没有则 undefined） */
export function todayEntry(entries: DiaryEntry[], now: number = Date.now()): DiaryEntry | undefined {
  const key = dayKey(now)
  return entries.find((e) => e.dayKey === key)
}

/** 按日期倒序排列 */
export function sortEntriesDesc(entries: DiaryEntry[]): DiaryEntry[] {
  return [...entries].sort((a, b) => b.dayKey.localeCompare(a.dayKey))
}

export interface DiaryStats {
  total: number
  totalWords: number
  /** 写日记的总天数 */
  activeDays: number
  /** 平均每篇字数 */
  avgWords: number
  /** 最喜欢用的心情 */
  topMood?: { mood: string; count: number }
  firstDay?: string
}

export function diaryStats(entries: DiaryEntry[]): DiaryStats {
  const total = entries.length
  const totalWords = entries.reduce((a, e) => a + e.wordCount, 0)

  const moodCount = new Map<string, number>()
  for (const e of entries) {
    if (!e.mood) continue
    moodCount.set(e.mood, (moodCount.get(e.mood) ?? 0) + 1)
  }
  let topMood: { mood: string; count: number } | undefined
  for (const [mood, count] of moodCount) {
    if (!topMood || count > topMood.count) topMood = { mood, count }
  }

  const days = [...new Set(entries.map((e) => e.dayKey))].sort()

  return {
    total,
    totalWords,
    activeDays: days.length,
    avgWords: total === 0 ? 0 : Math.round(totalWords / total),
    topMood,
    firstDay: days[0],
  }
}

/* ============================================================
   四、日记写作提示
   ============================================================ */

/** 心情选项 */
export const MOODS = [
  { emoji: '😄', label: '超开心' },
  { emoji: '🙂', label: '还不错' },
  { emoji: '😐', label: '一般般' },
  { emoji: '😢', label: '有点难过' },
  { emoji: '😤', label: '有点生气' },
  { emoji: '🤔', label: '在想事情' },
  { emoji: '😴', label: '好累呀' },
  { emoji: '🤩', label: '特别兴奋' },
]

/** 天气选项 */
export const WEATHERS = [
  { emoji: '☀️', label: '晴' },
  { emoji: '⛅', label: '多云' },
  { emoji: '☁️', label: '阴' },
  { emoji: '🌧️', label: '雨' },
  { emoji: '⛈️', label: '雷雨' },
  { emoji: '❄️', label: '雪' },
  { emoji: '🌫️', label: '雾' },
  { emoji: '🌬️', label: '风' },
]

/** 写日记的引导问题 —— 不知道写什么的时候点一下 */
export const DIARY_PROMPTS = [
  '今天最开心的一件事是什么？',
  '今天有没有让你生气或者难过的事？',
  '今天你学会了什么新东西？',
  '今天有没有帮助别人，或者被别人帮助？',
  '今天吃的哪顿饭最好吃？什么味道？',
  '今天有没有让你觉得"哇"的一瞬间？',
  '今天和谁说了最多的话？都说了些什么？',
  '如果今天可以重来一次，你想改变什么？',
  '今天有没有一件事，是你一开始不想做、后来做完了的？',
  '今天你看到的最好看的东西是什么？',
]

export function randomDiaryPrompt(): string {
  return DIARY_PROMPTS[Math.floor(Math.random() * DIARY_PROMPTS.length)]
}

/** 日记字数对应的鼓励 */
export function diaryLengthPraise(words: number): string {
  if (words >= 300) return '写了这么多！今天的你一定有很多话说 💬'
  if (words >= 150) return '篇幅很足，看得出你认真想了 ✍️'
  if (words >= 60) return '写得刚刚好，把今天记下来了 📔'
  if (words > 0) return '短一点也没关系，重要的是你写了 🌱'
  return ''
}
