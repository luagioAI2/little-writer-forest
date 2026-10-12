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
import { haversineKm, type GeoPoint } from './geo'

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
 *
 * ★★ 2026-10-03 在顶上补了 6000 / 12000 两格。
 *
 *   起因（家长：「直接把最低级的小鸟距离拉大就行了」）：实测发现
 *   **库比设计时以为的稀疏得多** —— 麻雀原来的 50 公里极限下，
 *   **海口可达 0 个点**、哈尔滨 1 个、拉萨 / 兰州 / 乌鲁木齐各 2 个。
 *   这些城市的孩子拿到第一只鸟就**一次都飞不出去**，主循环当场死掉。
 *   所以麻雀的极限从 50 提到 200 公里（`MAX_RUNG` 里 1 → 3）。
 *
 *   ⚠️ 顶上补格是**被迫的**：`MAX_RUNG` 存的是下标，麻雀一上移，
 *      上面那七只就必须整体上移一格，而阶梯末尾又必须是 `Infinity`
 *      —— 只能再加两格。「每只鸟恰好是上一只的两倍」这条性质因此保住了。
 *   ⚠️ 代价：青鸟 / 仙鹤的极限也跟着变大（1500→6000、3000→12000）。
 *      这是同一个下标表的连带效果，不是单独给它们加的距离。
 *
 * ★★ 2026-10-10：第 3 格 200 → 250（家长：「有海南就行了」）。
 *
 *   实测（家 = 海口）：200 公里时海南 9 个点只够得着 3 个
 *   （分界洲岛 163 / 呀诺达 186 / 槟榔谷 191），另外 6 个是 203–223 公里
 *   —— **只差 3～23 公里**。提到 250 之后海南全岛可达。
 *
 *   ⚠️ 只动第 3 格，所以**只影响 `MAX_RUNG === 3` 的麻雀**。
 *
 *   ★ 一个反直觉的实测结论（别凭"先近后远"去猜）：
 *     海口 25 / 50 / 100 三档**全是空的** —— 最近的点（涠洲岛）在 157 公里外。
 *     所以 `pickByRange` 第一趟就直接落到 250 这一档，
 *     从**全部 12 个**里均匀随机，而不是"先飞近的、再飞远的"。
 *     "先近后远"只在近档有点的城市成立（深圳第一趟落在 25 档的观澜湖）。
 *     ➜ 250 公里内实测 12 个：海南 9 个（163–223，全岛）、
 *       广西涠洲岛 157、广东海陵岛 241 ×2。
 */
export const RADIUS_LADDER_KM: readonly number[] = [25, 50, 100, 250, 400, 800, 1500, 3000, 6000, 12000, Infinity]

/** 阶梯最远一格（Infinity）的孩子话说法 */
export const BEYOND_ALL_KM = '无远弗届'

/**
 * 一次「旅行」至少要飞这么远（公里）。
 *
 * ★★ 为什么需要这个下界（2026-10-03 写测试时抓出来的）：
 *   孩子家**可能就挨着一个景点** —— 深圳世界之窗离市民中心才 10 公里，
 *   比这更近的也有。`chooseDestination` 一开始只写了「距离 ≤ 极限」，
 *   于是会挑中离家 0.2 公里的那个点：界面说「飞了 0 公里」，
 *   孩子看不出这是一趟旅行。
 *
 * ⚠️ `geo.ts` 里那条「不许出现 0 公里」的守卫挡的是**基准点本身**
 *     （(0,0) 那种定位失败），管不到"家和景点几乎重合"这一种。
 */
export const MIN_TRIP_KM = 1

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
  sparrow: 3, // 25 / 50 / 100 / 250   ← 10-03 从 1（50km）提上来；10-10 这一格 200→250
  swallow: 4, // …400
  oriole: 5, // …800
  dove: 6, // …1500
  magpie: 7, // …3000
  bluebird: 8, // …6000
  crane: 9, // …12000
  phoenix: 10, // 全世界
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
 * 这个距离，这只鸟够不够得着。
 *
 * ★★ 为什么要有个单独的名字，而不是到处写 `km <= flightMaxKm(species)`：
 *    「孩子在地图上点了一个地标」和「store 里真的派鸟」是两条路，
 *    两边必须用**同一个判据**。写成同一个函数，才不容易只改一处。
 *
 * ⚠️ 这里**不含** `MIN_TRIP_KM` 那条下界：下界管的是"这算不算一趟旅行"
 *    （家和景点几乎重合时别自动挑中 0.2 公里的点）。
 *    孩子**自己点的**那个点，再近也让他去 —— 那是他的选择。
 */
export function canReach(species: BirdSpeciesId, km: number): boolean {
  return km <= flightMaxKm(species)
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
  if (km <= 250) return '省内' // ★ 与阶梯第 3 格同步（10-10 从 200 提上来）
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
    // ★ 下界要和 `chooseDestination` 用同一个 `MIN_TRIP_KM` ——
    //   否则会出现「这里说还有新地方，派鸟时却空手而归」的自相矛盾。
    const km = haversineKm(home, { lng: p.lng, lat: p.lat })
    if (km >= MIN_TRIP_KM && km <= maxKm) return false
  }
  return true
}
