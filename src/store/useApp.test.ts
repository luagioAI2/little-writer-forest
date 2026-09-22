/* ============================================================
   store 层测试 —— 业务动作真的把东西写进了状态和数据库
   ============================================================

   为什么需要这一层：domain 的纯函数测得再全，也测不出
   「算出来了但没 set / 没落库」。

   真实事故：`harvestTree` 把树种算出来了（toast 里还念了
   「N 颗树种」），但那个数字从来没写进任何状态 —— 孩子收下树种，
   树种凭空消失，地图一点没动。domain 测试全绿，问题在编排层。

   ⚠️ fake-indexeddb/auto 必须第一个 import：db.ts 在模块顶层就
   `new LittleWriterDb()`，它构造时要能拿到全局 indexedDB。
   ============================================================ */

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  defaultStats,
  defaultWallet,
  readBirds,
  readSprouts,
  readWallet,
  wipeAll,
} from '../db/db'
import { initialLevelState } from '../domain/levels'
import { PACK_PRICE, PACK_SIZE, DAILY_COMPOSITION_LIMIT, recruitCost, treeCoinBoost } from '../domain/economy'
import { CARD_SETS, cardsInSet } from '../domain/cards'
import { BIRD_SPECIES } from '../domain/pets'
import { initialTreeState } from '../domain/tree'
import { sproutCount } from '../domain/travel'
import type { OwnedCard, Sprout, TreeYield, Work } from '../domain/types'
import { useApp } from './useApp'

const NOW = 1_700_000_000_000

/** 造一个"树上挂着指定产出"的状态 */
function treeWith(pending: TreeYield[]) {
  return { ...initialTreeState(NOW), pending }
}

function swallow() {
  const sp = BIRD_SPECIES.find((s) => s.id === 'swallow')
  if (!sp) throw new Error('找不到燕子')
  return sp
}

/** 造一篇"已经写好正文、还没评分"的作文 */
function draft(id: string): Work {
  const now = Date.now()
  return {
    id,
    kind: 'composition',
    title: `第 ${id} 篇`,
    grade: 3,
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    text:
      '春天来了，公园里开满了花。我手里拿着一根直直的竹签，站在门口等妈妈。' +
      '风一吹，花瓣落了我一身，香香的，我忍不住笑了，心里也跟着亮起来。',
    utterances: [],
    edits: [],
    images: [],
    wordCount: 0,
  }
}

beforeEach(async () => {
  await wipeAll()
  useApp.setState({
    wallet: defaultWallet(),
    stats: defaultStats(),
    level: initialLevelState(),
    tree: initialTreeState(NOW),
    birds: [],
    sprouts: [],
    cards: [],
    photos: [],
    toasts: [],
    busy: null,
  })
})

describe('收成长树', () => {
  it('树种真的落到地图上，并写进库（回归：以前树种会凭空消失）', async () => {
    useApp.setState({
      tree: treeWith([
        { id: 'y1', kind: 'coin', at: NOW, amount: 12 },
        { id: 'y2', kind: 'seed', at: NOW },
        { id: 'y3', kind: 'seed', at: NOW },
      ]),
    })

    const r = await useApp.getState().harvestTree()

    expect(r.coins).toBe(12)
    expect(r.seeds).toBe(2)
    expect(r.planted).toHaveLength(2)

    // 内存里真的发芽了，而且是两个不同的地方
    const sprouts = useApp.getState().sprouts
    expect(sprouts).toHaveLength(2)
    expect(sproutCount(sprouts)).toBe(2)
    expect(new Set(r.planted.map((p) => p.landmarkId)).size).toBe(2)

    // 落库了 —— 刷新页面也不会丢
    const persisted = await readSprouts()
    expect(persisted).toHaveLength(2)
    expect(persisted.map((s) => s.landmarkId).sort()).toEqual(
      sprouts.map((s) => s.landmarkId).sort(),
    )

    // 金币进钱包并落库，树上清空
    expect(useApp.getState().wallet.coins).toBe(12)
    expect((await readWallet()).coins).toBe(12)
    expect(useApp.getState().tree.pending).toEqual([])
  })

  it('只收金币时完全不碰地图，也不多写一次库', async () => {
    const before: Sprout[] = [{ landmarkId: 'xihu', at: 1, stage: 2 }]
    useApp.setState({
      tree: treeWith([{ id: 'c1', kind: 'coin', at: NOW, amount: 7 }]),
      sprouts: before,
    })

    const r = await useApp.getState().harvestTree()

    expect(r.planted).toEqual([])
    // 同一个引用 = 地图状态没有被重建
    expect(useApp.getState().sprouts).toBe(before)
    // 库里没写过
    expect(await readSprouts()).toEqual([])
  })

  it('连收两次不会重复种树，也不会重复给钱', async () => {
    useApp.setState({
      tree: treeWith([{ id: 'c1', kind: 'coin', at: NOW, amount: 5 }, { id: 's1', kind: 'seed', at: NOW }]),
    })

    const first = await useApp.getState().harvestTree()
    const second = await useApp.getState().harvestTree()

    expect(first.coins).toBe(5)
    expect(first.planted).toHaveLength(1)
    // 第二次树上已经空了
    expect(second.coins).toBe(0)
    expect(second.planted).toEqual([])
    expect(useApp.getState().wallet.coins).toBe(5)
    expect(useApp.getState().sprouts).toHaveLength(1)
  })
})

describe('金币出口', () => {
  /* 价格从常量取，不写死数字 —— 调价时这些用例应该继续有效，
     而不是每次都要回来改断言（那样测试就变成了价格的复读机）。 */
  it(`开卡包：扣 ${PACK_PRICE} 金币，拿到最多 ${PACK_SIZE} 张不重复的卡`, async () => {
    const start = PACK_PRICE + 380
    useApp.setState({ wallet: { coins: start, totalEarned: 800 } })

    const drops = await useApp.getState().openCardPack()

    expect(drops).not.toBeNull()
    expect(drops!.length).toBeGreaterThan(0)
    expect(drops!.length).toBeLessThanOrEqual(PACK_SIZE)
    // 同一包里去重，花钱不会买到重复
    expect(new Set(drops!.map((d) => d.defId)).size).toBe(drops!.length)

    expect(useApp.getState().wallet.coins).toBe(380)
    // 花掉金币不该让"一共挣过多少"变小
    expect(useApp.getState().wallet.totalEarned).toBe(800)
    expect(useApp.getState().cards).toHaveLength(drops!.length)
    expect((await readWallet()).coins).toBe(380)
  })

  it('金币不够时开不了包，也不会扣钱', async () => {
    useApp.setState({ wallet: { coins: PACK_PRICE - 1, totalEarned: 100 } })

    expect(await useApp.getState().openCardPack()).toBeNull()
    expect(useApp.getState().wallet.coins).toBe(PACK_PRICE - 1)
    expect(await readWallet()).toEqual(defaultWallet())
  })

  it('招募小鸟：段位不够或金币不够，都招不到，也不会扣钱', async () => {
    const sp = swallow() // 燕子：2 段解锁
    const cost = recruitCost(sp.id)

    // 段位不够
    useApp.setState({ level: initialLevelState(), wallet: { coins: 9999, totalEarned: 9999 } })
    expect(await useApp.getState().recruitBird(sp)).toBeNull()
    expect(useApp.getState().birds).toHaveLength(0)

    // 段位够了但钱不够
    useApp.setState({
      level: { ...initialLevelState(), levelIndex: 2 },
      wallet: { coins: cost - 1, totalEarned: cost - 1 },
    })
    expect(await useApp.getState().recruitBird(sp)).toBeNull()
    expect(useApp.getState().birds).toHaveLength(0)
    expect(useApp.getState().wallet.coins).toBe(cost - 1)
  })

  it('段位和金币都够时，招募扣钱、鸟住到树上并落库', async () => {
    const sp = swallow()
    const cost = recruitCost(sp.id)
    useApp.setState({
      level: { ...initialLevelState(), levelIndex: 2 },
      wallet: { coins: cost + 100, totalEarned: 500 },
    })

    const bird = await useApp.getState().recruitBird(sp)

    expect(bird?.species).toBe('swallow')
    expect(useApp.getState().wallet.coins).toBe(100)
    expect(useApp.getState().wallet.totalEarned).toBe(500)
    expect(useApp.getState().birds).toHaveLength(1)
    expect(await readBirds()).toHaveLength(1)

    // 同一只鸟不能招第二次，也不能重复扣钱
    expect(await useApp.getState().recruitBird(sp)).toBeNull()
    expect(useApp.getState().wallet.coins).toBe(100)
  })
})

describe('集齐卡组：屏幕上写的奖励真的会发', () => {
  it('收下最后一张卡时，奖励金币进钱包、落库、并且有提示', async () => {
    const set = CARD_SETS[0]
    const defs = cardsInSet(set.id)
    const last = defs[defs.length - 1]
    // 只差最后一张
    const nearly: OwnedCard[] = defs
      .slice(0, -1)
      .map((d, i) => ({ defId: d.id, count: 1, firstAt: i, starred: false }))

    useApp.setState({
      cards: nearly,
      wallet: defaultWallet(),
      // 树上挂着一张"必定是最后那张"的卡 —— 比开包随机抽要确定得多
      tree: treeWith([
        { id: 'last', kind: 'card', at: NOW, defId: last.id, rarity: last.rarity, isNew: true },
      ]),
    })

    const r = await useApp.getState().harvestTree()

    expect(r.setBonus).toBe(set.reward.coins)
    expect(useApp.getState().cards).toHaveLength(defs.length)
    expect(useApp.getState().wallet.coins).toBe(set.reward.coins)
    expect((await readWallet()).coins).toBe(set.reward.coins)
    // 孩子得被告知，不然这笔钱来得不明不白
    expect(useApp.getState().toasts.some((t) => t.title.includes(set.name))).toBe(true)
  })

  it('没集齐就不发钱', async () => {
    const set = CARD_SETS[0]
    const defs = cardsInSet(set.id)
    const notLast = defs[0]

    useApp.setState({
      cards: [],
      wallet: defaultWallet(),
      tree: treeWith([
        { id: 'one', kind: 'card', at: NOW, defId: notLast.id, rarity: notLast.rarity, isNew: true },
      ]),
    })

    const r = await useApp.getState().harvestTree()

    expect(r.setBonus).toBe(0)
    expect(useApp.getState().wallet.coins).toBe(0)
  })
})

/* ============================================================
   才气 —— 写作是唯一的金币来源，而且每天有额度
   ============================================================ */

describe('才气：每天前 3 篇作文才有奖励', () => {
  it('第 4 篇起不给金币也不给卡片，但分数和经验照给', async () => {
    const works = [1, 2, 3, 4].map((n) => draft(`w${n}`))
    useApp.setState({ works, wallet: defaultWallet() })

    const results = []
    for (const w of works) results.push(await useApp.getState().submitWork(w.id))
    const [r1, r2, r3, r4] = results

    // 前三篇：有金币、有卡片，不算"才气用完"
    for (const r of [r1, r2, r3]) {
      expect(r.dailyLimitReached).toBe(false)
      expect(r.coins).toBeGreaterThan(0)
      expect(r.drops.length).toBeGreaterThan(0)
    }

    // 第四篇：才气用完 —— 分数和经验还在（坚持就涨），金币和卡片归零
    expect(r4.dailyLimitReached).toBe(true)
    expect(r4.coins).toBe(0)
    expect(r4.drops).toEqual([])
    expect(r4.score.total).toBeGreaterThan(0)
    expect(r4.xp).toBeGreaterThan(0)

    // 钱包里只有前三篇的钱
    expect(useApp.getState().wallet.coins).toBe(r1.coins + r2.coins + r3.coins)
  })

  it('才气剩余量逐篇递减，第三篇之后归零', async () => {
    const works = [1, 2, 3, 4].map((n) => draft(`t${n}`))
    useApp.setState({ works })

    const left: number[] = []
    for (const w of works) left.push((await useApp.getState().submitWork(w.id)).talentLeft)

    expect(left).toEqual([DAILY_COMPOSITION_LIMIT - 1, DAILY_COMPOSITION_LIMIT - 2, 0, 0])
  })
})

/* ============================================================
   文心树加成 —— 树不产金币，但它让你写出来的东西更值钱
   ============================================================ */

describe('文心树加成', () => {
  it('同样的作文，树越大给的金币越多（而且只差在加成上）', async () => {
    const at0 = draft('boost-0')
    useApp.setState({ works: [at0], level: initialLevelState(), wallet: defaultWallet() })
    const base = await useApp.getState().submitWork(at0.id)

    const at6 = draft('boost-6')
    useApp.setState({
      works: [at6],
      level: { ...initialLevelState(), levelIndex: 6 },
      wallet: defaultWallet(),
    })
    const boosted = await useApp.getState().submitWork(at6.id)

    expect(base.treeBoost).toBe(1)
    expect(boosted.treeBoost).toBe(treeCoinBoost(6))
    expect(boosted.treeBoost).toBeGreaterThan(1)

    // 同一段文本 → 同一套评分；金币的差别只可能来自树加成
    expect(boosted.score.total).toBe(base.score.total)
    expect(boosted.coins).toBeGreaterThan(base.coins)
    expect(boosted.coins / base.coins).toBeCloseTo(treeCoinBoost(6), 1)
  })
})
