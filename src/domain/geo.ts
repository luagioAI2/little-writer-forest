/* ============================================================
   地理基础设施：基准点 + 距离
   ------------------------------------------------------------
   ★ 2026-09-24 从 `travelStories.ts` 搬过来的。

   为什么单独一个文件：那里面原来混了**两件不同的事** ——

     ① 内容数据（`TRAVEL_STORIES`：一篇篇散文、一张张图）
     ② 地理基础设施（家在哪、两点多远）

   ③ 把内容数据换成 JSON 之后，① 整块消失了，但 ② 还被
   `travelRange` / `travelContents` / `SettingsPage` 用着 ——
   如果继续挂在 `travelStories.ts` 里，就会出现「一个叫 travelStories 的文件
   里一条 story 都没有」。所以拆出来。

   时间一律由外部传入（now），模块内不调用 Date.now()。
   ============================================================ */

import type { HomePoint } from './types'

export interface GeoPoint {
  lng: number
  lat: number
}

/**
 * 默认基准点 —— 拿不到真实位置时就用它：**深圳**。
 *
 * 三层优先级（见 `resolveHomePoint`）：
 *   ① 设置里存着的 homePoint（以后由 GPS 或家长手选写入）
 *   ② 就是这里
 *
 * 为什么默认是深圳而不是「不显示距离」：
 * 距离是这个玩法里最有分量的那个数字 —— 「小鸟替我飞了 1900 公里」。
 * 基准点偏一点（比如孩子其实在广州），误差也就一两百公里，
 * 对孩子的感受没有影响；但没有这个数字，整趟旅行就少了一半。
 *
 * 坐标取深圳市民中心附近，GCJ-02，和地标表同一套坐标系。
 */
export const DEFAULT_HOME_POINT: HomePoint = {
  name: '深圳',
  lng: 114.0579,
  lat: 22.5431,
  source: 'default',
}

/**
 * 这个坐标能不能用。
 *
 * 为什么要校验、而不是「传进来就信」：这个值以后可能来自 GPS
 * 或家长手填，而 **(0, 0) 是定位失败的经典产物**（几内亚湾，
 * 没有任何人住在那儿）。不校验的话孩子会看到「飞了 12000 公里」，
 * 而且这种错从界面上完全看不出是错的。
 */
export function isUsablePoint(p: GeoPoint): boolean {
  if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) return false
  if (p.lng < -180 || p.lng > 180) return false
  if (p.lat < -90 || p.lat > 90) return false
  if (Math.abs(p.lng) < 0.5 && Math.abs(p.lat) < 0.5) return false
  return true
}

/**
 * 定出「家」在哪儿：设置里有就用设置的，没有（或值不合法）就用深圳。
 *
 * 这个函数是**唯一**决定基准点的地方 —— 想换默认城市，
 * 改 `DEFAULT_HOME_POINT` 一处，全 App 的距离一起重算。
 */
export function resolveHomePoint(home?: HomePoint | null): HomePoint {
  if (home && isUsablePoint(home)) return home
  return DEFAULT_HOME_POINT
}

/** 这个基准点是默认值，还是真的读到/设置过？界面据此决定要不要提示 */
export function isDefaultHome(home?: HomePoint | null): boolean {
  return resolveHomePoint(home).source === 'default'
}

const EARTH_R_KM = 6371

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * 两点间的大圆距离（公里，四舍五入到整数）。
 *
 * 用 haversine 而不是「经纬度差乘个系数」：中国跨了 60 多个纬度，
 * 简单线性估算在南北两端会差出几百公里，孩子看到「飞了 200 公里」
 * 其实飞了 500 公里，这种数不值得错。
 */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)))
  return Math.round(EARTH_R_KM * c)
}
