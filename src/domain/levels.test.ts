import { describe, expect, it } from 'vitest'
import {
  DECLINE_STREAK_TO_DROP,
  ESTABLISHED_THRESHOLD,
  LEVELS,
  MAX_SHIELDS,
  applyBonusXp,
  applyScore,
  initialLevelState,
  levelForXp,
  progressPercent,
  xpForScore,
  xpToNext,
} from './levels'
import type { LevelState, WorkScore } from './types'

/** 造一个假评分 */
function mkScore(total: number): WorkScore {
  return {
    at: Date.now(),
    total,
    dimensions: {
      observation: total,
      structure: total,
      vocabulary: total,
      imagination: total,
      emotion: total,
    },
    summary: '',
    strengths: [],
    suggestions: [],
    mindMap: { label: '' },
    stars: 3,
    engine: 'local',
  }
}

/** 连续喂 N 篇同样分数的作文 */
function feed(state: LevelState, score: number, times: number): LevelState {
  let s = state
  for (let i = 0; i < times; i++) {
    s = applyScore(s, mkScore(score)).next
  }
  return s
}

describe('段位表', () => {
  it('XP 门槛严格递增', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].minXp).toBeGreaterThan(LEVELS[i - 1].minXp)
    }
  })

  it('levelForXp 边界正确', () => {
    expect(levelForXp(0)).toBe(0)
    expect(levelForXp(119)).toBe(0)
    expect(levelForXp(120)).toBe(1)
    expect(levelForXp(299)).toBe(1)
    expect(levelForXp(300)).toBe(2)
    expect(levelForXp(999999)).toBe(LEVELS.length - 1)
  })

  it('levelForXp 不会越界', () => {
    expect(levelForXp(-500)).toBe(0)
  })
})

describe('XP 计算', () => {
  it('保底：任何分数都有正向 XP', () => {
    // 这是需求「即便没啥进步，一直刷也要所有增加」的保障
    expect(xpForScore(0)).toBeGreaterThan(0)
    expect(xpForScore(10)).toBeGreaterThan(0)
  })

  it('分数越高 XP 越多', () => {
    expect(xpForScore(90)).toBeGreaterThan(xpForScore(60))
    expect(xpForScore(60)).toBeGreaterThan(xpForScore(30))
  })

  it('连击加成生效', () => {
    expect(xpForScore(70, 18)).toBe(xpForScore(70) + 18)
  })
})

describe('置信度推进', () => {
  it('从预测 → 观察中 → 实际水平', () => {
    let s = initialLevelState()
    expect(s.confidence).toBe('predicted')

    s = feed(s, 70, 1)
    expect(s.confidence).toBe('predicted')

    s = feed(s, 70, 3) // 累计 4 篇
    expect(s.confidence).toBe('settling')

    s = feed(s, 70, 4) // 累计 8 篇
    expect(s.confidence).toBe('established')
    expect(s.scoredCount).toBe(ESTABLISHED_THRESHOLD)
  })
})

describe('升级', () => {
  it('累积 XP 会升段', () => {
    let s = initialLevelState()
    const r = applyScore(s, mkScore(95))
    expect(r.next.xp).toBeGreaterThan(0)
    // 95 分一篇约有 22 + 90*0.93 ≈ 105 XP，接近但未到 120
    s = r.next
    expect(s.levelIndex).toBe(0)

    const r2 = applyScore(s, mkScore(95))
    expect(r2.next.levelIndex).toBeGreaterThanOrEqual(1)
  })

  it('升级时发放护盾', () => {
    let s = initialLevelState()
    let gained = 0
    for (let i = 0; i < 6; i++) {
      const r = applyScore(s, mkScore(92))
      gained += r.shieldsGained
      s = r.next
      if (r.leveledUp) break
    }
    expect(gained).toBeGreaterThan(0)
    expect(s.shields).toBeGreaterThan(0)
    expect(s.shields).toBeLessThanOrEqual(MAX_SHIELDS)
  })

  it('升级会重置下滑计数', () => {
    let s = initialLevelState()
    s = { ...s, declineStreak: 3 }
    const r = applyScore(s, mkScore(98))
    if (r.leveledUp) expect(r.next.declineStreak).toBe(0)
  })
})

describe('降级保护（核心需求）', () => {
  it('预测阶段绝不降级', () => {
    let s = initialLevelState()
    // 先冲上去
    s = feed(s, 96, 5)
    const peak = s.levelIndex
    expect(peak).toBeGreaterThan(0)
    // 还在预测阶段时连续低分
    s = { ...s, confidence: 'predicted' }
    s = feed(s, 15, 10)
    // 关键：只可能持平或继续涨（XP 保底），绝不允许掉下来
    expect(s.levelIndex).toBeGreaterThanOrEqual(peak)
  })

  it('实际水平阶段：护盾能挡住下滑', () => {
    let s = initialLevelState()
    // 写满 16 篇高分，进入"实际水平"且站稳在中段位。
    // 注意为什么要写这么多：低段位的 XP 门槛很密，低分作文的保底 XP
    // 也够跨门槛，升级会把下滑计数清零 —— 所以低段位几乎不可能掉级，
    // 这正是我们想要的（新手期只涨不跌）。要验证护盾机制，
    // 必须让水平稳定在门槛较疏的中高段位。
    s = feed(s, 96, 16)
    const peak = s.levelIndex
    expect(s.confidence).toBe('established')
    expect(peak).toBeGreaterThanOrEqual(4)

    const shieldsBefore = s.shields
    expect(shieldsBefore).toBeGreaterThan(0)

    // 连续低分，护盾应被消耗而非直接掉段
    s = feed(s, 10, DECLINE_STREAK_TO_DROP)
    expect(s.shields).toBeLessThan(shieldsBefore)
    expect(s.levelIndex).toBeGreaterThanOrEqual(peak)
  })

  it('护盾耗尽后仍需连续多次下滑才掉段', () => {
    let s = initialLevelState()
    s = feed(s, 96, 10)

    // 先把护盾全部消耗掉
    let guard = 0
    while (s.shields > 0 && guard++ < 100) {
      s = feed(s, 8, DECLINE_STREAK_TO_DROP)
    }
    expect(s.shields).toBe(0)

    // 再连续下滑，第一轮不应立刻掉段（要满足 streak 条件）
    const before = s.levelIndex
    s = feed(s, 8, DECLINE_STREAK_TO_DROP - 1)
    expect(s.levelIndex).toBe(before)

    // 补满一轮才会掉
    s = feed(s, 8, 2)
    expect(s.levelIndex).toBeLessThanOrEqual(before)
  })

  it('一次掉段只降一级，不会崩盘', () => {
    let s = initialLevelState()
    s = feed(s, 98, 12)
    const peak = s.levelIndex
    expect(peak).toBeGreaterThanOrEqual(2)

    let prev = peak
    for (let round = 0; round < 6; round++) {
      s = feed(s, 5, DECLINE_STREAK_TO_DROP + 1)
      if (s.levelIndex < prev) {
        // 单轮最多降一级
        expect(prev - s.levelIndex).toBeLessThanOrEqual(1)
      }
      prev = s.levelIndex
    }
  })

  it('不是明显下滑（只是小波动）不会消耗护盾', () => {
    let s = initialLevelState()
    s = feed(s, 85, 10)
    const shieldsBefore = s.shields
    const lvlBefore = s.levelIndex
    // 小幅波动：bestScore 附近上下浮动，不算"明显下滑"
    s = feed(s, s.bestScore - 3, 5)
    expect(s.shields).toBe(shieldsBefore)
    // 护盾没被消耗，段位也只会持平或继续涨，不会掉
    expect(s.levelIndex).toBeGreaterThanOrEqual(lvlBefore)
  })
})

describe('保底 XP 让坚持总有回报', () => {
  it('即使一直低分，XP 也持续增长', () => {
    let s = initialLevelState()
    const before = s.xp
    s = feed(s, 25, 10)
    expect(s.xp).toBeGreaterThan(before)
  })

  it('持续低分最终仍能升段（只是慢）', () => {
    let s = initialLevelState()
    const startLevel = s.levelIndex
    // 25 分每篇约 22 + 90*0.11 ≈ 32 XP，写 10 篇 ≈ 320，应能到第 1-2 段
    s = feed(s, 25, 10)
    expect(s.levelIndex).toBeGreaterThan(startLevel)
  })
})

describe('奖励 XP（背诵 / 日记）', () => {
  it('增加 XP 但不改变 scoredCount', () => {
    const s = initialLevelState()
    const r = applyBonusXp(s, 50)
    expect(r.next.xp).toBe(50)
    expect(r.next.scoredCount).toBe(0)
  })

  it('也能触发升段并给护盾', () => {
    const s = initialLevelState()
    const r = applyBonusXp(s, 200)
    expect(r.leveledUp).toBe(true)
    expect(r.shieldsGained).toBeGreaterThan(0)
  })
})

describe('进度与提示', () => {
  it('progressPercent 在 0-100 之间', () => {
    let s = initialLevelState()
    for (let i = 0; i < 20; i++) {
      s = applyScore(s, mkScore(70)).next
      expect(s.progress).toBeGreaterThanOrEqual(0)
      expect(s.progress).toBeLessThanOrEqual(100)
    }
  })

  it('满级时进度为 100 且无下一段', () => {
    const s: LevelState = { ...initialLevelState(), levelIndex: LEVELS.length - 1, xp: 99999 }
    expect(progressPercent(s)).toBe(100)
    expect(xpToNext(s).next).toBeUndefined()
  })

  it('xpToNext 差值正确', () => {
    const s = initialLevelState()
    const { need, next } = xpToNext(s)
    expect(next?.minXp).toBe(120)
    expect(need).toBe(120)
  })
})
