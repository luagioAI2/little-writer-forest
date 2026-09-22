/* ============================================================
   成长树 —— 树上结什么、多久结一颗
   ============================================================

   产品意图（照需求原文落实）：
     「成长树的数值设定好，而且树每隔一段时间有产出掉落
       （激励 多写 多提高水平）」
     「树越多，掉落事件增幅越多」

   ★ 树上**不掉金币**（这一版改的）。
     金币只能靠写出来（见 economy.ts 的说明）：孩子挂着不管也有钱进账，
     那就没有理由动笔了。树负责的是别的事 ——
       · 结**树种**：种到地图上，森林一点点亮起来（长期的成长线）
       · 结**信**：小鸟叼来的，情感线
       · 偶尔结一张**文心卡**：惊喜，但稀少

   于是核心循环是：树按时间**结出**东西，挂在树上等孩子来收。
   它奖励的是「常常回来看一眼」，而不是「挂着不管」——
   证据有两个，缺一不可：
     ① 挂载有上限（pendingCap）：挂满了就不再结，
        离线一个月回来不会变成几百件，孩子不会被淹没。
     ② 离线收益封顶 8 小时：睡一觉起来刚好，缺课一周不会白送一整套卡。

   为什么这样设计（而不是"离线越久给越多"）：
     如果产出随离线时长线性膨胀，那"每天来一次"和"一个月来一次"
     收益几乎一样，孩子就没有理由天天来。把上限压低、把单次产出的
     品质做高，才是真正的"回来就有惊喜"。

   时间一律由外部传入（now: number），模块内不调用 Date.now()，
   这样离线结算、单元测试、时钟回拨都能被稳稳地验证。
   ============================================================ */

import type { CardDrop, OwnedCard, TreeState, TreeYield, YieldKind } from './types'
import { levelAt } from './levels'
import { rollDrops } from './cards'

/* ============================================================
   一、常量与随机
   ============================================================ */

/** 产出结算的最小评估间隔：一分钟看一次就够了，不必每帧算 */
export const TICK_MS = 60_000

/** 离线收益封顶 —— 8 小时。睡一觉刚好满，缺课一周也不至于白送 */
export const OFFLINE_CAP_MS = 8 * 3600_000

/** 0 段时的基础产出间隔：20 分钟结一颗 */
const BASE_INTERVAL_MS = 20 * 60_000

/** 每升一段，间隔乘这个系数（越来越快） */
const LEVEL_INTERVAL_FACTOR = 0.88

/** 间隔下限：再快也不低于 6 分钟，给孩子留出"回来还看得见"的余地 */
const FLOOR_INTERVAL_MS = 6 * 60_000

/** 每棵发芽的树带来的产出提速 */
const SPROUT_BONUS_PER_TREE = 0.04

/** 树的提速加成上限：+60%。封顶的理由见下方 yieldIntervalMs 注释 */
const SPROUT_BONUS_CAP = 0.6

/** 0 段时树上最多挂几件 */
const PENDING_CAP_BASE = 6

/** 挂载上限的硬顶 */
const PENDING_CAP_MAX = 18

/**
 * 树上**开始结果子**的最低段位。
 *
 * 第 3 段「琼华树」是树冠第一次成形的地方（见 TreeArt）。
 * 在那之前，灵芽 / 青华 / 扶摇还太矮小，本来就结不出东西 ——
 * 硬要它掉点什么，孩子会觉得"这棵树在骗我"。
 *
 * 所以第 0/1/2 段：树上不产出任何东西。
 * 这正好把「才气是养料」讲清楚：**不写，树就不长；树不长，就没有果子。**
 * 界面要明说这件事（LevelPage），不然孩子会以为功能坏了。
 *
 * 注意：地图进度不靠这条规则 —— 小鸟旅行带回的种子走的是
 * 另一条路（见 travel.sproutAt），任何时候都照常发芽。
 */
export const TREE_FRUIT_MIN_LEVEL = 0

/** FNV-1a 字符串散列 —— 把任意字符串压成一个稳定的 32 位种子 */
export function hashSeed(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/**
 * mulberry32 种子伪随机。
 *
 * 为什么需要它：tickTree 的产出必须"看起来随机"但**可复现**——
 * 否则同一份存档在两次渲染 / 两次结算里会给出不同的结果，
 * 测试也没法断言。与 CharacterArt.tsx 用的是同一套算法。
 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 时钟回拨保护：lastTickAt 落在未来时，把它拉回现在 */
function clampTick(lastTickAt: number, now: number): number {
  return Math.min(lastTickAt, now)
}

/* ============================================================
   二、节奏：多久结一颗、最多挂几件
   ============================================================ */

/**
 * 两次产出之间的间隔（毫秒）。
 *
 * 结构 = 段位决定的基础节奏 × 森林规模带来的提速。
 *
 * 为什么树多要提速，但加成要封顶？
 *   需求要求「树越多，掉落事件增幅越多」，所以发芽的树直接加速产出。
 *   但加成一旦不封顶，后期几十棵树会让间隔趋近于 0，
 *   单次掉落就变得毫无意义（通胀）。封在 +60%，
 *   让"多种树"始终有用、又不会让数值失去意义。
 */
export function yieldIntervalMs(levelIndex: number, sproutCount: number): number {
  const lv = Math.max(0, Math.floor(levelIndex))
  const raw = Math.max(
    FLOOR_INTERVAL_MS,
    BASE_INTERVAL_MS * Math.pow(LEVEL_INTERVAL_FACTOR, lv),
  )
  const bonus = 1 + Math.min(SPROUT_BONUS_CAP, Math.max(0, sproutCount) * SPROUT_BONUS_PER_TREE)
  return Math.round(raw / bonus)
}

/**
 * 树上同时最多能挂多少件产出。
 *
 * 为什么要上限：没有它，孩子离开一个月回来会面对几百件掉落，
 * 既淹没了他，也彻底摧毁了「常回来」的动机 —— 反正来一次就够。
 * 上限让"树快满了"本身变成回家的理由。
 */
export function pendingCap(levelIndex: number): number {
  return Math.min(PENDING_CAP_MAX, PENDING_CAP_BASE + Math.max(0, Math.floor(levelIndex)))
}

/** 树苗形态（0-11），直接复用段位表里的 treeStage */
export function treeStage(levelIndex: number): number {
  return levelAt(levelIndex).treeStage
}

/* ============================================================
   三、产出内容
   ============================================================ */

/**
 * 决定这一颗结出来的是什么。
 *
 * 权重：树种 80% / 卡片 15% / 信 5%。
 *
 * **这里没有金币，永远不会有。** 金币只能靠写出来（见 economy.ts）。
 * 树结的是"能再长出东西的东西"：
 *   · 树种 —— 种到地图上，森林一点点亮起来（35 个地标 × 3 级，够种很久）
 *   · 卡片 —— 惊喜，但稀少；开卡包才是集卡的主路
 *   · 信   —— 只有养了小鸟才会出现
 *
 * 「信」只有养了小鸟才会出现；没养鸟时它的 5% 全部并入卡片，
 * 这样总权重仍是 100%，只是把不存在的玩法让给了卡片。
 * 另外：树上已经挂着一封信时，也不再结第二封 ——
 * 免得信封堆成一座山，把"收到信"的仪式感磨掉。
 */
export function rollYieldKind(state: TreeState, hasPets: boolean, rng: () => number): YieldKind {
  const letterPending = state.pending.some((y) => y.kind === 'letter')
  const letterW = hasPets && !letterPending ? 5 : 0
  // v6：card 权重从 15 提升到 45，补偿种子降低的部分
  const cardW = 45 + (5 - letterW)

  // v6：种子概率降低（80→50），防止地图点得太快
  const table: { kind: YieldKind; w: number }[] = [
    { kind: 'seed', w: 50 },
    { kind: 'card', w: cardW },
    { kind: 'letter', w: letterW },
  ]
  const total = table.reduce((a, b) => a + b.w, 0)
  let roll = rng() * total
  for (const it of table) {
    roll -= it.w
    if (roll <= 0) return it.kind
  }
  return 'seed'
}

/* ============================================================
   四、核心结算
   ============================================================ */

export interface TickOpts {
  now: number
  levelIndex: number
  sproutCount: number
  owned: OwnedCard[]
  hasPets: boolean
  /** 注入随机源；不传则用由 state 派生的稳定种子 */
  rng?: () => number
}

export interface TickResult {
  state: TreeState
  grown: TreeYield[]
}

/**
 * 时间结算：把「从上次结算到现在」这段时间兑换成树上挂着的产出。
 *
 * 幂等保证：产出的槽位数由 floor(elapsed / interval) 决定，
 * 结算后 lastTickAt 会前进到已兑换的位置。因此用同一个 now
 * 连续调用两次，第二次的 elapsed 为 0、槽位为 0，不会重复产出。
 *
 * 离线封顶：elapsed 先被 OFFLINE_CAP_MS 夹住再算槽位；
 * 一旦真的触发了封顶，lastTickAt 直接推到 now（超出的部分作废）。
 *
 * ★ 结果子有段位门槛（TREE_FRUIT_MIN_LEVEL）：
 *   第 0/1/2 段的树太小，这段时间**什么也不结**，槽位照样消耗掉
 *   （不会攒着，等树长大了再一次性倒出来 —— 那会变成一个漏洞）。
 */
export function tickTree(state: TreeState, opts: TickOpts): TickResult {
  const { now, levelIndex, sproutCount, owned, hasPets } = opts
  const rng =
    opts.rng ?? seededRng(hashSeed(`${state.lastTickAt}|${now}|${state.pending.length}`))

  const rawElapsed = Math.max(0, now - state.lastTickAt)
  const elapsed = Math.min(rawElapsed, OFFLINE_CAP_MS)
  const interval = yieldIntervalMs(levelIndex, sproutCount)
  const slots = Math.floor(elapsed / interval)

  const room = Math.max(0, pendingCap(levelIndex) - state.pending.length)
  // 树上挂满了，后面的槽位就浪费掉 —— 这正是"常回来"的激励所在
  // 树还太小（没到 TREE_FRUIT_MIN_LEVEL）也一样：槽位作废，不结东西
  const produce =
    levelIndex >= TREE_FRUIT_MIN_LEVEL ? Math.min(slots, room) : 0

  // 被离线封顶时，产出时间落在"最近 8 小时"这个窗口里，而不是遥远的过去
  const windowStart = now - elapsed
  const grown: TreeYield[] = []
  for (let i = 0; i < produce; i++) {
    const at = windowStart + (i + 1) * interval
    grown.push(makeYield(state, hasPets, owned, rng, at))
  }

  let lastTickAt = state.lastTickAt
  if (rawElapsed > OFFLINE_CAP_MS) {
    lastTickAt = now
  } else if (slots > 0) {
    lastTickAt = state.lastTickAt + slots * interval
  }

  const next: TreeState = { ...state, lastTickAt, pending: [...state.pending, ...grown] }
  return { state: next, grown }
}

/** 结出一件具体产出 */
function makeYield(
  state: TreeState,
  hasPets: boolean,
  owned: OwnedCard[],
  rng: () => number,
  at: number,
): TreeYield {
  const kind = rollYieldKind(state, hasPets, rng)
  const base: TreeYield = { id: `ty-${at}-${kind}`, kind, at }

  if (kind === 'card') {
    // 卡片交给 cards.ts 的掉落引擎，它会优先给还没拥有的卡
    const drop = rollDrops({ source: 'tree', count: 1, owned })[0]
    if (drop) {
      return { ...base, defId: drop.defId, rarity: drop.rarity, isNew: drop.isNew }
    }
    // 卡池异常时退化成树种：绝不让树上挂着一件没有内容的奖励
    return { ...base, kind: 'seed' }
  }
  return base
}

/* ============================================================
   五、收获
   ============================================================ */

export interface CollectResult {
  state: TreeState
  coins: number
  drops: CardDrop[]
  seeds: number
  letters: number
}

/** 把树上挂着的东西一次收完 */
export function collectAll(state: TreeState, now: number): CollectResult {
  /* 注意：`coins` 是**历史遗留**。
     这一版之后树上不再结金币，但老存档的 pending 里可能还挂着几颗 ——
     照收不误，免得孩子的东西凭空消失。新存档永远不会走到这个分支。 */
  const coins = state.pending.reduce(
    (a, y) => a + (y.kind === 'coin' ? y.amount ?? 0 : 0),
    0,
  )
  const drops: CardDrop[] = state.pending
    .filter((y) => y.kind === 'card' && y.defId)
    .map((y) => ({
      defId: y.defId as string,
      rarity: y.rarity ?? 'common',
      isNew: y.isNew ?? false,
      source: 'tree',
    }))
  const seeds = state.pending.filter((y) => y.kind === 'seed').length
  const letters = state.pending.filter((y) => y.kind === 'letter').length
  const harvested = state.pending.length > 0

  const next: TreeState = {
    ...state,
    lastTickAt: clampTick(state.lastTickAt, now),
    pending: [],
    harvests: state.harvests + (harvested ? 1 : 0),
    totalCoins: state.totalCoins + coins,
    totalCards: state.totalCards + drops.length,
  }
  return { state: next, coins, drops, seeds, letters }
}

export interface CollectOneResult {
  state: TreeState
  collected: TreeYield | null
  coins: number
  drops: CardDrop[]
  seeds: number
  letters: number
}

/** 只收走树上指定的一件 —— 对应"点一下飘着的那颗果子"的交互 */
export function collectOne(state: TreeState, yieldId: string, now: number): CollectOneResult {
  const idx = state.pending.findIndex((y) => y.id === yieldId)
  if (idx < 0) {
    return {
      state: { ...state, lastTickAt: clampTick(state.lastTickAt, now) },
      collected: null,
      coins: 0,
      drops: [],
      seeds: 0,
      letters: 0,
    }
  }

  const y = state.pending[idx]
  const pending = state.pending.slice(0, idx).concat(state.pending.slice(idx + 1))
  // coins 同样是历史遗留，见 collectAll 的注释
  const coins = y.kind === 'coin' ? y.amount ?? 0 : 0
  const drops: CardDrop[] =
    y.kind === 'card' && y.defId
      ? [{ defId: y.defId, rarity: y.rarity ?? 'common', isNew: y.isNew ?? false, source: 'tree' }]
      : []
  const seeds = y.kind === 'seed' ? 1 : 0
  const letters = y.kind === 'letter' ? 1 : 0

  const next: TreeState = {
    ...state,
    lastTickAt: clampTick(state.lastTickAt, now),
    pending,
    harvests: state.harvests + 1,
    totalCoins: state.totalCoins + coins,
    totalCards: state.totalCards + drops.length,
  }
  return { state: next, collected: y, coins, drops, seeds, letters }
}

/* ============================================================
   六、给界面看的信息
   ============================================================ */

export interface ProductionSummary {
  perHour: number
  label: string
  nextInMs: number
}

/**
 * 面向孩子的产出说明，例如「每小时大约结 3 颗」。
 * 孩子不需要知道毫秒，只需要知道"我的树现在有多勤快"。
 */
export function productionSummary(levelIndex: number, sproutCount: number): ProductionSummary {
  const interval = yieldIntervalMs(levelIndex, sproutCount)
  const perHour = Math.round((3_600_000 / interval) * 10) / 10
  const label =
    perHour >= 1
      ? `每小时大约结 ${Math.round(perHour)} 颗`
      : `大约每 ${Math.max(1, Math.round(interval / 60_000))} 分钟结一颗`
  return { perHour, label, nextInMs: interval }
}

/* ============================================================
   七、初始状态
   ============================================================ */

export function initialTreeState(now: number): TreeState {
  return {
    lastTickAt: now,
    pending: [],
    harvests: 0,
    totalCoins: 0,
    totalCards: 0,
    hollowUnlocked: false,
    hollowDiaries: [],
  }
}
