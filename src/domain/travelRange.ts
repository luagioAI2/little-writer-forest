/* ============================================================
   旅行距离分档 —— 「这只鸟能飞多远」
   ============================================================

   家长 2026-09-17 的设计意图（原话全文见 LESSONS §二十）：

     小鸟 出发 从起始点(设置里有出发，并且有经纬度)。
     小鸟根据解锁等级飞行距离不一样。距离从小到大。
     旅行库 中，去看距离范围内的旅游点。收集旅游点作为待选池，
     如果旅游点的个数大于1 随机一个作为目标点。
     如果距离范围没有旅游点，或者旅游点已经去过，则扩大距离，
     不能超过小鸟极限距离。继续之前的选取操作。
     如果 X距离内所有的旅游点都已经去过，则标记 X距离 不再访问
     （如果更新旅游库，比如X距离又增加旅游点了，则 访问距离又回到
     这个距离，但是已经访问的点不再访问）。增加距离，去选择。

   ------------------------------------------------------------
   ★★ 为什么「X 距离已去完」不需要存任何东西

   家长那条规则听起来要一个「已耗尽」标记，但它**是可以算出来的**：

       某个半径 r 已经去完  ⟺  r 公里内的每个旅游点都在「已到访」集合里

   这一条与家长的描述**完全等价**，而且严格更好：

     · 库新增一个点 → 它不在已到访集合里 → 该半径**自动复活**
       —— 这正是家长要的「更新旅游库后又回到这个距离」
     · 老点仍然不在待选池里 → 不会被重复选中
       —— 这正是家长要的「但是已经访问的点不再访问」
     · **零新增存档字段、零迁移**，避开「老存档缺字段时拼出来的
       东西自不自洽」那类坑（MEMORY §七）

   反过来，如果真去存一个布尔标记，就必须再存「这个标记是拿哪一版
   旅游库打的」，否则库更新了也判断不出来 —— 那反而多出一堆
   可能对不上的状态。**能从既有数据推出来的，就不要存。**

   ------------------------------------------------------------
   时间一律由外部传入（now），模块内不调用 Date.now()。
   ============================================================ */

import type { BirdSpeciesId } from './types'
import { haversineKm, type GeoPoint } from './travelStories'

/* ============================================================
   一、半径阶梯 —— 从家往外，一格一格推
   ============================================================ */

/**
 * 半径阶梯（公里）。
 *
 * 为什么是「倍增」而不是「等距加 20 公里」：
 *   一两千个旅游点摊到全国，平均每 6400 平方公里才有一个，
 *   最近邻普遍在 40–80 公里外。若按 20 公里一档，**绝大多数档位
 *   是空的**，机制会一路空转到极限距离 —— 孩子什么也看不到。
 *
 *   而半径每翻一倍，**圆的面积翻四倍**，所以每档的候选点数
 *   大致相当。这才是「每一档都可能有东西」的分法。
 *
 * 为什么最小是 25 而不是 50：
 *   要留住「就在家门口」那一档。深圳世界之窗离市民中心约 10 公里，
 *   孩子第一趟旅行应该能落到这种地方，而不是一上来就飞 50 公里。
 */
export const RADIUS_LADDER_KM: readonly number[] = [25, 50, 100, 200, 400, 800, 1500, 3000, Infinity]

/** 阶梯最远一格（Infinity）的孩子话说法 */
export const BEYOND_ALL_KM = '无远弗届'

/* ============================================================
   二、每只鸟能爬到第几格
   ============================================================ */

/**
 * 鸟 → 能用的最大阶梯下标。
 *
 * ★ 与 `BIRD_SPECIES` 的解锁顺序**一一对应**（麻雀 0 级、凤凰 11 级），
 *   所以「想飞远就得用好鸟」本身是一条看得见的胡萝卜。
 *
 * ★ 这里**故意不 import `BIRD_SPECIES`** —— `pets.ts` 已经依赖
 *   `travel.ts` / `travelStories.ts` / `travelContents.ts`，
 *   这里再反向依赖 `pets.ts` 会绕成循环。顺序在两边各写一次，
 *   但由 `travelRange.test.ts` 盯着「顺序与 BIRD_SPECIES 一致」。
 */
const MAX_RUNG: Record<BirdSpeciesId, number> = {
  sparrow: 1, // 25 / 50
  swallow: 2, // …100
  oriole: 3, // …200
  dove: 4, // …400
  magpie: 5, // …800
  bluebird: 6, // …1500
  crane: 7, // …3000
  phoenix: 8, // 全世界
}

/**
 * 这只鸟能飞多远（公里）。
 *
 * `Infinity` 表示「没有上限」—— 凤凰那一档就是全世界。
 */
export function flightMaxKm(species: BirdSpeciesId): number {
  return RADIUS_LADDER_KM[MAX_RUNG[species] ?? 0]
}

/**
 * 这只鸟的半径阶梯（从近到远，已按它的极限截断）。
 *
 * 界面拿它显示「麻雀：家门口 → 50 公里」这种话。
 */
export function rangeLadder(species: BirdSpeciesId): number[] {
  return RADIUS_LADDER_KM.slice(0, (MAX_RUNG[species] ?? 0) + 1)
}

/** 半径 → 孩子看得懂的说法 */
export function radiusLabel(km: number): string {
  if (!Number.isFinite(km)) return BEYOND_ALL_KM
  if (km <= 25) return '就在家门口'
  if (km <= 50) return '附近'
  if (km <= 100) return '本市和邻市'
  if (km <= 200) return '省内'
  if (km <= 400) return '邻省'
  if (km <= 800) return '半个中国'
  if (km <= 1500) return '大半个中国'
  if (km <= 3000) return '全国'
  return BEYOND_ALL_KM
}

/* ============================================================
   三、按距离挑一个目标点
   ============================================================ */

/** 能被选作目标的最小信息 —— 只要 id 和坐标 */
export interface RangePoint {
  id: string
  lng: number
  lat: number
}

export interface PickByRangeOpts {
  /** 全部旅游点（旅游库） */
  points: readonly RangePoint[]
  /** 出发地（家）。经纬度由 `resolveHomePoint` 定 */
  home: GeoPoint
  /** 派出去的是哪只鸟 —— 决定极限距离 */
  species: BirdSpeciesId
  /**
   * 已经到访过的旅游点 id。
   *
   * ★ 它同时承担两件事：① 不要把已经去过的再选一次
   *   ② 判断某一档是不是「已经去完」（见文件头那段）
   */
  visited: readonly string[]
  rng: () => number
}

export type PickByRangeResult =
  | {
      kind: 'ok'
      point: RangePoint
      /** 选中的这一档的半径（公里） */
      radiusKm: number
      /** 这一档在阶梯上的下标 —— 界面可以用它说「这次飞到第几档」 */
      rung: number
      /** 离家多远（公里） */
      distanceKm: number
      /** 这一档本来有几个候选（用来判断是不是"扩大距离才找到的"） */
      candidateCount: number
    }
  | {
      /**
       * 极限距离之内**全都去过了**（或者一个点都没有）。
       *
       * ★ 刻意做成一个独立的返回值，而不是「退回去随便挑一个」：
       *   家长要的是「去过的不再访问」，那就不能偷偷重复。
       *   界面拿这个说「这只鸟能到的地方你都去过了，换一只飞得更远的吧」
       *   —— 这正好是推孩子去解锁下一只鸟的那句话。
       */
      kind: 'exhausted'
      /** 这只鸟的极限距离，界面要报出来 */
      maxKm: number
    }

/**
 * 按距离挑一个目标点。
 *
 * 从最近的一格开始往外推：
 *   这一格里有点、且没去过 → 随机挑一个（家长要的「大于 1 个就随机」）
 *   这一格空着、或者全去过了 → 换下一格
 *   推到这只鸟的极限还不行 → `exhausted`
 *
 * ★ 家长的三条规则在这里就是那个 for 循环本身：
 *   ① 没有点 → 下一格   ② 都去过 → 下一格   ③ 不许超过极限 → 循环边界
 */
export function pickByRange(opts: PickByRangeOpts): PickByRangeResult {
  const { points, home, species, visited, rng } = opts
  const seen = new Set(visited)
  const ladder = rangeLadder(species)

  // 每个点到家的距离只算一次 —— 阶梯最多 9 格、点数可能上千，
  // 每格重算一遍是 9×N 次 haversine，没必要。
  const withDist = points.map((p) => ({ p, km: haversineKm(home, { lng: p.lng, lat: p.lat }) }))

  for (let rung = 0; rung < ladder.length; rung += 1) {
    const radiusKm = ladder[rung]
    const pool = withDist.filter((it) => it.km <= radiusKm && !seen.has(it.p.id))
    if (pool.length === 0) continue

    const hit = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
    return {
      kind: 'ok',
      point: hit.p,
      radiusKm,
      rung,
      distanceKm: hit.km,
      candidateCount: pool.length,
    }
  }

  return { kind: 'exhausted', maxKm: flightMaxKm(species) }
}

/**
 * 这一档是不是「已经去完了」。
 *
 * ★ 单独暴露出来是给界面用的：地图上要能显示「50 公里以内都去过了」，
 *   而这件事**不读任何存档字段**，纯算（见文件头）。
 *
 * 注意半径 `Infinity` 时是「全世界都去过了」，实际永远为 false。
 */
export function isRadiusExhausted(
  points: readonly RangePoint[],
  home: GeoPoint,
  radiusKm: number,
  visited: readonly string[],
): boolean {
  const seen = new Set(visited)
  let any = false
  for (const p of points) {
    if (haversineKm(home, { lng: p.lng, lat: p.lat }) > radiusKm) continue
    any = true
    if (!seen.has(p.id)) return false
  }
  // ★ 一个点都没有时返回 false（不是 true）：
  //   「这一档没有旅游点」和「这一档的点都去过了」是两件不同的事，
  //   界面要说的话也不一样（「附近还没有地方可去」vs「附近你都去过了」）。
  return any
}

/** 这只鸟的极限之内，是不是一个可去的新点都没有了 */
export function isBirdExhausted(
  points: readonly RangePoint[],
  home: GeoPoint,
  species: BirdSpeciesId,
  visited: readonly string[],
): boolean {
  const seen = new Set(visited)
  const maxKm = flightMaxKm(species)
  for (const p of points) {
    if (seen.has(p.id)) continue
    if (haversineKm(home, { lng: p.lng, lat: p.lat }) <= maxKm) return false
  }
  return true
}
