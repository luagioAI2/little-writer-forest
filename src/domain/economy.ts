/* ============================================================
   金币经济 —— 才气是养料
   ============================================================

   【这一版的核心设定】

   孩子的**才气**（写出来的东西）是唯一的养料：

     写作文 / 写日记 / 背诵 ──→ 经验 ──→ 文心树长大
                            └─→ 金币 ──→ 开文心卡包

   文心树**不直接产金币**。它只做两件事：
     ① 自己长大 —— 长到「琼华树」之后，树上开始结果子
        （树种 / 信 / 偶尔一张卡），孩子回来收；
     ② 给你写出来的东西**加成金币** —— 树越大，加成越高。

   为什么这样改（这是产品目的，不是数值偏好）：
     旧版树按时间自己掉金币，孩子挂着不管也有钱进账，
     那就没有理由动笔了。而这个 App 存在的唯一理由是「多写」。
     把金币的来源收到写作这一条线上，树就从「提款机」变回
     「你写了多少的证明」；同时它的加成让「写得久」直接变强，
     于是"写 → 树大 → 写更值钱"形成闭环。

   【出口：抽卡】

     金币 → 开文心卡包（PACK_PRICE）。这是第一版就有的心智模型，
     孩子一看就懂：攒钱 → 开包 → 集卡。
     招募小鸟（RECRUIT_COST）是第二个出口，但它是**双闸**：
     段位到了才有资格，钱够了才招得走。段位门槛保证"多写"仍是主线。

   【防刷】

     · 每天**前 DAILY_COMPOSITION_LIMIT 篇**作文才给奖励（金币 + 卡片）。
       第 4 篇起照样评分、照样给经验，只是不掉奖励 ——
       才气是有限的，这正是「养料」这个比喻本来的意思。
     · 日记的奖励每天只算一次（isNewDay）。
     · 背诵有重复递减（见 recitation.computeRecitationReward）。
     · 树上产出有挂载上限与离线封顶（见 tree.ts）。

   【加成只作用于「自己写出来的」那一份】

     作文 / 日记 / 背诵的金币吃文心树加成；
     小鸟旅行带回的零钱（6-14 币）不吃 —— 那是鸟找到的，不是孩子写的。
     规则一句话能讲清：**文心树越大，你写出来的东西越值钱。**
   ============================================================ */

import type { BirdSpecies, BirdSpeciesId, CardSet, OwnedCard, Work } from './types'
import { CARD_SETS, setProgress } from './cards'
import { LEVELS } from './levels'
import { dayKey } from './time'

/* ============================================================
   一、才气：每天的写作额度
   ============================================================ */

/**
 * 每天给奖励的作文篇数上限。
 *
 * 3 篇是"勤快但不过量"的量：一个孩子一天认真写 3 篇已经很多了。
 * 超过之后仍然可以继续写、继续评分、继续拿经验，
 * 只是不再掉金币和卡片 —— 这样既堵住了刷金币的口子，
 * 又不会真的拦着一个想写的孩子。
 */
export const DAILY_COMPOSITION_LIMIT = 3

/**
 * 计数只看这三个字段，所以刻意收窄类型 —— 测试里造一个轻量的
 * 假作品就够了，不必凑齐一整个 Work。
 */
export type ScoredWorkLike = Pick<Work, 'createdAt'> & {
  score?: unknown
  scoredAt?: number
}

/** 今天已经评过分的作文有几篇（按评分时间算，不是按开稿时间） */
export function compositionsScoredToday(
  works: ScoredWorkLike[],
  now: number = Date.now(),
): number {
  const key = dayKey(now)
  return works.filter((w) => w.score && dayKey(w.scoredAt ?? w.createdAt) === key).length
}

/** 今天还剩多少才气（还能拿几次作文奖励） */
export function talentLeftToday(works: ScoredWorkLike[], now: number = Date.now()): number {
  return Math.max(0, DAILY_COMPOSITION_LIMIT - compositionsScoredToday(works, now))
}

/** 今天还有没有才气 */
export function hasTalentToday(works: ScoredWorkLike[], now: number = Date.now()): boolean {
  return talentLeftToday(works, now) > 0
}

/**
 * 每日目标的最大可选值。
 *
 * 刻意和奖励上限绑在一起：如果目标能设成 5 篇，孩子会以为
 * "写 5 篇才有奖励"，或者反过来觉得"设了 5 篇却只有 3 篇算数"是个 bug。
 * 两个数字必须一致，界面上才不会自相矛盾。
 */
export const DAILY_GOAL_MAX = DAILY_COMPOSITION_LIMIT

/** 把存下来的每日目标夹回合法范围（老存档里可能存着 4、5） */
export function clampDailyGoal(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(DAILY_GOAL_MAX, Math.round(n)))
}

/* ============================================================
   二、文心树的加成
   ============================================================ */

/** 每长高一段，写出来的东西多值 12% 的金币 */
export const TREE_COIN_BOOST_PER_LEVEL = 0.12

/**
 * 文心树给写作金币的加成倍率。
 *
 * 0 段 ×1.00 → 11 段 ×2.32。看起来只是"多一倍"，
 * 但段位的经验门槛是指数上涨的（0 → 8500），
 * 所以这 132% 的涨幅其实要用几十篇作文去换 —— 值。
 */
export function treeCoinBoost(levelIndex: number): number {
  const lv = Math.max(0, Math.min(LEVELS.length - 1, Math.floor(levelIndex)))
  return Math.round((1 + lv * TREE_COIN_BOOST_PER_LEVEL) * 100) / 100
}

/** 给孩子看的加成说法，例如「+36%」 */
export function treeCoinBoostLabel(levelIndex: number): string {
  const pct = Math.round((treeCoinBoost(levelIndex) - 1) * 100)
  return pct <= 0 ? '还没有加成' : `+${pct}%`
}

/* ============================================================
   四、集齐卡组的一次性奖励
   ============================================================ */

/**
 * 这次加卡之后，有哪些卡组**刚刚**集齐。
 *
 * 为什么用"前后对比"而不是存一个"已领取"清单：
 * 卡片只增不减，所以「没集齐 → 集齐」这个跃迁天然只会发生一次。
 * 少存一个字段，就少一处存档不一致的可能。
 */
export function newlyCompletedSets(before: OwnedCard[], after: OwnedCard[]): CardSet[] {
  if (after === before) return []
  const wasComplete = new Set(
    CARD_SETS.filter((s) => setProgress(before, s.id).complete).map((s) => s.id),
  )
  return CARD_SETS.filter((s) => !wasComplete.has(s.id) && setProgress(after, s.id).complete)
}

/** 集齐卡组奖励的金币合计 */
export function setRewardCoins(sets: CardSet[]): number {
  return sets.reduce((a, s) => a + s.reward.coins, 0)
}

/* ============================================================
   五、定价
   ============================================================ */

/**
 * 一篇作文给多少金币（**未乘**连续签到 Buff 和文心树加成）。
 *
 * 放在这里而不是 store 里，是因为定价必须拿它当锚：
 * 「一包卡值几篇作文」这句话要能算出来，才谈得上调价。
 * 分数是主力（0.9 的斜率），星级是额外的一脚。
 */
export function compositionBaseCoins(total: number, stars: number): number {
  return 20 + Math.round(total * 0.9) + (stars - 1) * 15
}

/**
 * 开一包文心卡要多少金币。
 *
 * 锚点：**一包卡大约等于 1-2 篇作文的产出**（中段位、带连续加成时）。
 * 太少（半篇就够）会让抽卡变成随手点，孩子不珍惜；
 * 太多（四五篇）会让孩子觉得"攒不到"，反而放弃。
 */
export const PACK_PRICE = 300

/** 一包开几张 */
export const PACK_SIZE = 3

/**
 * 卡包的概率加成。
 *
 * 设计意图：**不能让开包比写作更划算**，否则孩子会放弃写作去刷包。
 * 所以开包只是"另一种获得卡的方式"，稀有卡的期望产出明显低于
 * 写作 + 卡组集齐奖励的组合。
 */
export const PACK_LUCK = 1.15

/**
 * 招募一只鸟要多少金币。
 *
 * 按稀有度递进，而且刻意做成"跳一档"而不是线性 ——
 * 线性会让孩子觉得后面的鸟"性价比更高"，反而不急着攒。
 * 真正的门槛其实是段位（unlockLevel），金币是第二道闸。
 */
const RECRUIT_COST: Record<BirdSpeciesId, number> = {
  sparrow: 0, // 麻雀永远免费：它是第一只鸟，不能有任何门槛
  swallow: 400,
  oriole: 650,
  dove: 1000,
  magpie: 1450,
  bluebird: 2000,
  crane: 2700,
  phoenix: 3600,
}

/** 招募一只鸟的金币价格；免费鸟返回 0 */
export function recruitCost(species: BirdSpeciesId): number {
  return RECRUIT_COST[species] ?? 500
}

/** 招募是否**已解锁**（段位够不够） */
export function canRecruit(levelIndex: number, species: BirdSpecies): boolean {
  return species.unlockLevel <= levelIndex
}
