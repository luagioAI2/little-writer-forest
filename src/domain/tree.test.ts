import { describe, expect, it } from 'vitest'
import {
  OFFLINE_CAP_MS,
  TREE_FRUIT_MIN_LEVEL,
  collectAll,
  collectOne,
  initialTreeState,
  pendingCap,
  productionSummary,
  rollYieldKind,
  seededRng,
  tickTree,
  yieldIntervalMs,
} from './tree'
import type { TreeState, TreeYield } from './types'

/** 造一个树上挂着指定产出的状态 */
function stateWith(pending: TreeYield[], lastTickAt: number): TreeState {
  return { ...initialTreeState(lastTickAt), pending }
}

describe('产出节奏', () => {
  it('0 段基础间隔 20 分钟，随段位缩短但不低于 6 分钟', () => {
    expect(yieldIntervalMs(0, 0)).toBe(20 * 60_000)
    expect(yieldIntervalMs(1, 0)).toBeLessThan(yieldIntervalMs(0, 0))
    // 高段位触底：再快也不低于 6 分钟
    expect(yieldIntervalMs(11, 0)).toBeGreaterThanOrEqual(6 * 60_000)
    expect(yieldIntervalMs(99, 0)).toBe(yieldIntervalMs(11, 0))
  })

  it('树越多产出越快，但加成封顶（15 棵即 +60%）', () => {
    const base = yieldIntervalMs(0, 0)
    expect(yieldIntervalMs(0, 15)).toBeLessThan(base)
    expect(yieldIntervalMs(0, 15)).toBe(Math.round(base / 1.6))
    // 超过 15 棵不再加速：避免后期产出快到失去意义
    expect(yieldIntervalMs(0, 40)).toBe(yieldIntervalMs(0, 15))
  })

  it('挂载上限随段位增长并封顶 18', () => {
    expect(pendingCap(0)).toBe(6)
    expect(pendingCap(5)).toBe(11)
    expect(pendingCap(11)).toBe(17)
    expect(pendingCap(99)).toBe(18)
  })
})

describe('时间结算', () => {
  it('同一个 now 连续结算两次，第二次不再产出', () => {
    const now = 1_000_000_000
    const start = initialTreeState(now - 60 * 60_000) // 一小时前
    // 用 5 段：够大，会结果子（所有段位都会结果子，见下面的门槛测试）
    const opts = { now, levelIndex: 5, sproutCount: 0, owned: [], hasPets: false }

    const r1 = tickTree(start, { ...opts, rng: seededRng(1) })
    expect(r1.grown.length).toBe(Math.floor((60 * 60_000) / yieldIntervalMs(5, 0)))

    const r2 = tickTree(r1.state, { ...opts, rng: seededRng(2) })
    expect(r2.grown).toEqual([])
    expect(r2.state.pending).toEqual(r1.state.pending)
  })

  it('所有段位都结果子，树还小也不攒着槽位', () => {
    const now = 20_000_000_000
    const start = initialTreeState(now - 3 * 3600_000) // 三个小时

    // TREE_FRUIT_MIN_LEVEL = 0：从第 0 段（灵芽树）起就会结果子
    expect(TREE_FRUIT_MIN_LEVEL).toBe(0)

    for (const lv of [0, 1, 2, 3]) {
      const r = tickTree(start, {
        now,
        levelIndex: lv,
        sproutCount: 0,
        owned: [],
        hasPets: false,
        rng: seededRng(9),
      })
      // 所有段位都会结果子
      expect(r.grown.length).toBeGreaterThan(0)
      expect(r.state.pending.length).toBeGreaterThan(0)
      // 时间照样往前走
      expect(r.state.lastTickAt).toBeGreaterThan(start.lastTickAt)
    }
  })

  it('离线收益封顶 8 小时', () => {
    const now = 10_000_000_000
    // 离开 100 小时，只按 8 小时结算
    const start = initialTreeState(now - 100 * 3600_000)
    const r = tickTree(start, {
      now,
      levelIndex: 11,
      sproutCount: 0,
      owned: [],
      hasPets: false,
      rng: seededRng(3),
    })
    // 8 小时 / 6 分钟 = 80 个槽位，远超上限，于是只挂到上限
    expect(r.grown.length).toBe(pendingCap(11))
    expect(r.state.pending.length).toBeLessThanOrEqual(pendingCap(11))
    expect(r.state.lastTickAt).toBe(now) // 触发封顶后时间直接推到 now
    expect(OFFLINE_CAP_MS).toBe(8 * 3600_000)
  })

  it('树挂满之后不再产出', () => {
    const now = 5_000_000_000
    const full: TreeYield[] = Array.from({ length: pendingCap(5) }, (_, i) => ({
      id: `x${i}`,
      kind: 'seed' as const,
      at: now,
    }))
    const start = stateWith(full, now - 10 * 3600_000)
    const r = tickTree(start, {
      now,
      levelIndex: 5,
      sproutCount: 0,
      owned: [],
      hasPets: false,
      rng: seededRng(4),
    })
    expect(r.grown).toEqual([])
    expect(r.state.pending.length).toBe(pendingCap(5))
  })

  it('同样一段时间里，树越多结得越多', () => {
    const now = 7_000_000_000
    const start = now - 60 * 60_000
    const base = { now, levelIndex: 5, owned: [], hasPets: false }
    const slow = tickTree(initialTreeState(start), { ...base, sproutCount: 0, rng: seededRng(5) })
    const fast = tickTree(initialTreeState(start), { ...base, sproutCount: 15, rng: seededRng(6) })
    expect(fast.grown.length).toBeGreaterThan(slow.grown.length)
  })
})

describe('产出内容', () => {
  it('树上永远不会结金币 —— 金币只能靠写出来', () => {
    const s = initialTreeState(0)
    const rng = seededRng(11)
    for (let i = 0; i < 2000; i++) {
      expect(rollYieldKind(s, i % 2 === 0, rng)).not.toBe('coin')
    }
  })

  it('没有小鸟时永远不会结出信', () => {
    const s = initialTreeState(0)
    const rng = seededRng(42)
    for (let i = 0; i < 500; i++) {
      expect(rollYieldKind(s, false, rng)).not.toBe('letter')
    }
  })

  it('有小鸟时信会偶尔出现（但不泛滥）', () => {
    const s = initialTreeState(0)
    const rng = seededRng(7)
    let letters = 0
    for (let i = 0; i < 500; i++) {
      if (rollYieldKind(s, true, rng) === 'letter') letters += 1
    }
    expect(letters).toBeGreaterThan(0)
    expect(letters).toBeLessThan(500 / 10) // 信是惊喜，不能常见
  })

  it('树上已经挂着一封信时，不再结第二封', () => {
    const s = stateWith([{ id: 'l', kind: 'letter', at: 0 }], 0)
    const rng = seededRng(5)
    for (let i = 0; i < 500; i++) {
      expect(rollYieldKind(s, true, rng)).not.toBe('letter')
    }
  })

  it('树种是大头，卡片稀少 —— 集卡的主路是开卡包', () => {
    const s = initialTreeState(0)
    const rng = seededRng(13)
    const N = 4000
    let seeds = 0
    let cards = 0
    for (let i = 0; i < N; i++) {
      const k = rollYieldKind(s, false, rng)
      if (k === 'seed') seeds += 1
      if (k === 'card') cards += 1
    }
    // v6：种子概率从 80% 降到 50%，防止地图点得太快
    expect(seeds / N).toBeGreaterThan(0.45)
    expect(cards / N).toBeLessThan(0.55)
    expect(cards).toBeGreaterThan(0)
  })
})

describe('收获', () => {
  /* 注意：下面两条里塞了 kind:'coin' 的产出 —— 那是**老存档**才会有的东西。
     新版本树上不再结金币，但历史 pending 必须还能正常收走，
     不然升级过的孩子会发现自己树上挂着的东西收不动了。 */
  it('collectAll 正确归类、清空 pending 并累计（含老存档的金币）', () => {
    const now = 1
    const pending: TreeYield[] = [
      { id: 'a', kind: 'coin', at: 1, amount: 5 },
      { id: 'b', kind: 'coin', at: 1, amount: 3 },
      { id: 'c', kind: 'seed', at: 1 },
      { id: 'd', kind: 'letter', at: 1 },
      { id: 'e', kind: 'card', at: 1, defId: 'card-x', rarity: 'rare', isNew: true },
    ]
    const r = collectAll(stateWith(pending, now), now)

    expect(r.coins).toBe(8)
    expect(r.seeds).toBe(1)
    expect(r.letters).toBe(1)
    expect(r.drops).toHaveLength(1)
    expect(r.drops[0].source).toBe('tree')
    expect(r.drops[0].defId).toBe('card-x')
    expect(r.state.pending).toEqual([])
    expect(r.state.harvests).toBe(1)
    expect(r.state.totalCoins).toBe(8)
    expect(r.state.totalCards).toBe(1)
  })

  it('空树收获不增加次数', () => {
    const r = collectAll(initialTreeState(0), 10)
    expect(r.coins).toBe(0)
    expect(r.state.harvests).toBe(0)
    expect(r.state.pending).toEqual([])
  })

  it('collectOne 只收走指定的一件', () => {
    const pending: TreeYield[] = [
      { id: 'a', kind: 'coin', at: 1, amount: 7 },
      { id: 'b', kind: 'seed', at: 1 },
    ]
    const r = collectOne(stateWith(pending, 0), 'a', 5)
    expect(r.collected?.id).toBe('a')
    expect(r.coins).toBe(7)
    expect(r.state.pending.map((y) => y.id)).toEqual(['b'])
    expect(r.state.totalCoins).toBe(7)
    expect(r.state.harvests).toBe(1)
  })

  it('collectOne 找不到目标时原样返回', () => {
    const pending: TreeYield[] = [{ id: 'a', kind: 'seed', at: 1 }]
    const r = collectOne(stateWith(pending, 0), 'missing', 5)
    expect(r.collected).toBeNull()
    expect(r.state.pending).toEqual(pending)
  })
})

describe('产出说明', () => {
  it('productionSummary 给出孩子看得懂的说明', () => {
    const s = productionSummary(0, 0)
    expect(s.perHour).toBe(3) // 每小时 3 颗
    expect(s.label).toContain('每小时')
    expect(s.nextInMs).toBe(yieldIntervalMs(0, 0))

    // 树多了，每小时结得更多
    expect(productionSummary(0, 15).perHour).toBeGreaterThan(s.perHour)
  })
})
