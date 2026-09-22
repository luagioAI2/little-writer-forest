/* ============================================================
   经济 —— 才气、树加成、定价
   ============================================================
   这一层守的是「产品的目的」而不是「代码的行为」：

     · 金币只能靠写出来 —— 树上永远不产金币（树的用例在 tree.test.ts）
     · 每天前 3 篇才有奖励 —— 防止刷金币
     · 树越大写出来的东西越值钱 —— 才气是养料的正反馈
     · 定价必须锚在产出上 —— 一包卡值几篇作文，要能算得出来

   最后一条尤其重要：定价写死一个数字很容易，但过两个月就没人知道
   它是怎么来的了。这里用「体检」的方式把它钉住。
   ============================================================ */

import { describe, expect, it } from 'vitest'
import {
  DAILY_COMPOSITION_LIMIT,
  DAILY_GOAL_MAX,
  PACK_PRICE,
  TREE_COIN_BOOST_PER_LEVEL,
  clampDailyGoal,
  compositionsScoredToday,
  compositionBaseCoins,
  hasTalentToday,
  newlyCompletedSets,
  recruitCost,
  setRewardCoins,
  talentLeftToday,
  treeCoinBoost,
  treeCoinBoostLabel,
} from './economy'
import { CARD_SETS, cardsInSet } from './cards'
import { BIRD_SPECIES } from './pets'
import { dayKey } from './time'
import type { OwnedCard } from './types'

/** 造一个轻量的"已评分作文" —— 计数只用 createdAt / scoredAt / score */
function scored(createdAt: number, scoredAt?: number) {
  return { createdAt, scoredAt, score: { total: 70 } }
}
/** 还没评分的草稿 */
function draft(createdAt: number) {
  return { createdAt }
}

describe('每日才气', () => {
  const today = Date.now()
  const yesterday = today - 30 * 3600_000

  it('只数"已经评过分"的作文，草稿不算', () => {
    expect(compositionsScoredToday([scored(today), draft(today), draft(today)], today)).toBe(1)
  })

  it('按评分时间算，不按开稿时间 —— 昨晚开的稿今天交，算今天', () => {
    // 昨晚开的稿（createdAt 是昨天），今天交的（scoredAt 是今天）
    const w = scored(yesterday, today)
    expect(compositionsScoredToday([w], today)).toBe(1)
    expect(compositionsScoredToday([w], yesterday)).toBe(0)
  })

  it('老存档没有 scoredAt 时退回 createdAt', () => {
    expect(compositionsScoredToday([scored(today)], today)).toBe(1)
    expect(compositionsScoredToday([scored(yesterday)], today)).toBe(0)
  })

  it('才气每天重置：昨天写满 3 篇，今天照样是满的', () => {
    const done = [1, 2, 3].map(() => scored(yesterday, yesterday))
    expect(compositionsScoredToday(done, yesterday)).toBe(3)
    expect(talentLeftToday(done, yesterday)).toBe(0)
    expect(hasTalentToday(done, yesterday)).toBe(false)

    expect(compositionsScoredToday(done, today)).toBe(0)
    expect(talentLeftToday(done, today)).toBe(DAILY_COMPOSITION_LIMIT)
    expect(hasTalentToday(done, today)).toBe(true)
  })

  it('写超了也不会变成负数', () => {
    const many = [1, 2, 3, 4, 5, 6].map(() => scored(today))
    expect(compositionsScoredToday(many, today)).toBe(6)
    expect(talentLeftToday(many, today)).toBe(0)
  })

  it('跨过一天的分界线就重新充满（分界线由 dayKey 决定）', () => {
    const now = Date.now()
    // 同一天里稍早一点的时刻 —— 仍然算今天
    const earlier = now - 60_000
    if (dayKey(earlier) === dayKey(now)) {
      expect(compositionsScoredToday([scored(earlier)], now)).toBe(1)
    }
    // 整整 24 小时之前一定落在上一个 dayKey 里
    expect(dayKey(now - 24 * 3600_000)).not.toBe(dayKey(now))
    expect(compositionsScoredToday([scored(now - 24 * 3600_000)], now)).toBe(0)
  })

  it('上限是 3 篇', () => {
    expect(DAILY_COMPOSITION_LIMIT).toBe(3)
  })
})

describe('文心树的金币加成', () => {
  it('0 段没有加成，随段位单调上涨', () => {
    expect(treeCoinBoost(0)).toBe(1)
    for (let lv = 1; lv < 12; lv++) {
      expect(treeCoinBoost(lv)).toBeGreaterThan(treeCoinBoost(lv - 1))
    }
  })

  it('每段正好加 12%，11 段是 ×2.32', () => {
    expect(TREE_COIN_BOOST_PER_LEVEL).toBe(0.12)
    expect(treeCoinBoost(3)).toBe(1.36)
    expect(treeCoinBoost(11)).toBe(2.32)
  })

  it('越界要夹住，不能算出离谱的数', () => {
    expect(treeCoinBoost(99)).toBe(treeCoinBoost(11))
    expect(treeCoinBoost(-5)).toBe(treeCoinBoost(0))
    expect(treeCoinBoost(3.9)).toBe(treeCoinBoost(3))
  })

  it('给孩子的说法：0 段是"还没有加成"，之后是百分比', () => {
    expect(treeCoinBoostLabel(0)).toBe('还没有加成')
    expect(treeCoinBoostLabel(3)).toBe('+36%')
    expect(treeCoinBoostLabel(11)).toBe('+132%')
  })
})

describe('每日目标', () => {
  it('和奖励上限绑在一起，不能设得比上限还大', () => {
    expect(DAILY_GOAL_MAX).toBe(DAILY_COMPOSITION_LIMIT)
  })

  it('老存档里存着的 5 篇会被夹回 3 篇', () => {
    expect(clampDailyGoal(5)).toBe(3)
    expect(clampDailyGoal(0)).toBe(1)
    expect(clampDailyGoal(-2)).toBe(1)
    expect(clampDailyGoal(Number.NaN)).toBe(1)
    expect(clampDailyGoal(2)).toBe(2)
  })
})

/* ============================================================
   集齐卡组的一次性奖励
   ============================================================
   卡片页一直写着「再集 N 张就能拿奖励：300 金币」，
   但那笔钱以前从来没真的发过（只在界面上显示）。
   这两条用例守住「说到的要发」。
   ============================================================ */

describe('集齐卡组的一次性奖励', () => {
  const first = CARD_SETS[0]
  const defs = cardsInSet(first.id)

  /** 拥有前 n 张 */
  function own(n: number): OwnedCard[] {
    return defs.slice(0, n).map((d, i) => ({ defId: d.id, count: 1, firstAt: i, starred: false }))
  }

  it('最后一张到手的那一刻才算集齐', () => {
    expect(newlyCompletedSets(own(defs.length - 1), own(defs.length))).toEqual([first])
  })

  it('已经集齐的卡组不会重复发奖', () => {
    expect(newlyCompletedSets(own(defs.length), own(defs.length))).toEqual([])
  })

  it('没集齐就不发', () => {
    expect(newlyCompletedSets([], own(defs.length - 1))).toEqual([])
  })

  it('引用没变时直接短路（不白算一遍）', () => {
    const cards = own(defs.length)
    expect(newlyCompletedSets(cards, cards)).toEqual([])
  })

  it('奖励金币按卡组累加', () => {
    expect(setRewardCoins([first])).toBe(first.reward.coins)
    expect(setRewardCoins([CARD_SETS[0], CARD_SETS[1]])).toBe(
      CARD_SETS[0].reward.coins + CARD_SETS[1].reward.coins,
    )
    expect(setRewardCoins([])).toBe(0)
  })
})

/* ============================================================
   定价体检
   ============================================================
   不是"断言某个具体数字"，而是断言**数字之间的关系**：
   产出变了、加成变了，如果定价没跟着调，这里就会红。
   ============================================================ */

describe('定价体检', () => {
  /** 一篇中等作文的基础产出（分数 75、三星） */
  const typicalBase = compositionBaseCoins(75, 3)

  it('中段位：一包卡大约等于 1-2 篇作文的产出', () => {
    // 6 段（×1.72）+ 连续 4 天的签到加成（×1.25）
    const mid = typicalBase * treeCoinBoost(6) * 1.25
    const essaysPerPack = PACK_PRICE / mid
    expect(essaysPerPack).toBeGreaterThan(0.8)
    expect(essaysPerPack).toBeLessThan(2.5)
  })

  it('新手：一天的才气（3 篇）至少要能开得起一包', () => {
    const beginner = typicalBase * treeCoinBoost(0) // 0 段、还没连续加成
    const packsPerDay = (beginner * DAILY_COMPOSITION_LIMIT) / PACK_PRICE
    expect(packsPerDay).toBeGreaterThanOrEqual(1)
  })

  it('写作仍然比开包划算 —— 否则孩子会去刷包而不是写作', () => {
    // 同样写 3 篇，光靠作文掉卡 + 金币换卡，期望收益要高于纯开包
    const mid = typicalBase * treeCoinBoost(6) * 1.25
    const coinsPerDay = mid * DAILY_COMPOSITION_LIMIT
    // 一天的金币最多换来这么多包
    expect(coinsPerDay / PACK_PRICE).toBeLessThan(4)
  })

  it('招募价格随稀有度递进，且第一只鸟永远免费', () => {
    const costs = BIRD_SPECIES.map((s) => recruitCost(s.id))
    expect(costs[0]).toBe(0)
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i]).toBeGreaterThanOrEqual(costs[i - 1])
    }
  })

  it('最贵的鸟不至于遥不可及 —— 两周的产出之内', () => {
    const mid = typicalBase * treeCoinBoost(6) * 1.25
    const daysToPhoenix = recruitCost('phoenix') / (mid * DAILY_COMPOSITION_LIMIT)
    expect(daysToPhoenix).toBeLessThan(14)
  })
})
