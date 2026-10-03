/* ============================================================
   地图投影：经纬度 → SVG 坐标（中国 / 世界两档共用）
   ------------------------------------------------------------
   为什么单独一个文件、而不是留在 `MapPage.tsx` 里：

     ★★ 这里全是**纯函数**，而"坐标算到画布外面去了"是**不会报错**的
        那一类 bug（巴黎 lng=2.29 用中国的 bbox 投影 → 负 X →
        画在画布外，界面上什么都没有，控制台也一声不吭）。
        留在组件文件里就只能靠肉眼看截图发现；拆出来就能直接
        用单元测试把**每一个地标**都投影一遍，逐个断言"落在画布内"。
        ➜ 这是 `mapProjection.test.ts` 存在的原因。

   用等距圆柱投影（equirectangular）就够了：简单线性映射在这个尺寸下
   肉眼看不出形变，而且可以离线算完。

   纬度需要翻转 —— 经纬度是"北为正"，SVG 是"下为正"。

   ★★ 2026-09-24：原来这里写死了 `CHINA_BBOX`，于是世界景点的坐标
      投影出来是**负 X**（巴黎 lng=2.29 < 中国最西 73.48）——
      画到画布外面去，界面上什么都看不见，也**不报错**。
      现在改成按 scope 取一份 `MapView`。

   ⚠️ 中国档的参数**一个都没动**（画布 720×560、padX 18、padY 22、
      纵向拉伸 1.16）—— 改前改后中国那张图**逐像素一致**。
   ============================================================ */

import { CHINA_BBOX, type MapRegion } from '../../assets/china-map'
import { WORLD_BBOX, WORLD_LAND } from '../../assets/world-map'

/** 地图能看哪一片。★ 两个档共用一套投影代码，只是窗口不同 */
export type MapScope = '中国' | '世界'

export interface MapView {
  w: number
  h: number
  padX: number
  padY: number
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number }
  /** 纵向拉伸系数：只为了让形状在竖屏里更饱满，不改变"上下左右"的语义 */
  latStretch: number
}

/** 中国档 —— 沿用原来的画布与拉伸 */
const CN_VIEW: MapView = {
  w: 720,
  h: 560,
  padX: 18,
  padY: 22,
  bbox: CHINA_BBOX,
  latStretch: 1.16,
}

/**
 * 世界档 —— 画布按 `WORLD_BBOX` 的宽高比算，**不拉伸**。
 *
 * ⚠️ 不拉伸是有意的：中国档那个 1.16 是为了让雄鸡在竖屏里更饱满，
 *    而世界图一旦纵向拉伸，"哪儿在哪儿"就不好认了 ——
 *    世界图上最重要的是**位置关系**，不是饱满。
 * ➜ 360:135 ≈ 2.67:1，出来是一条横带。手机上是满宽的一条，
 *    欧洲那一带会挤（这是世界尺度上必然的），但大洲一眼能认出来。
 */
const WORLD_VIEW: MapView = (() => {
  const w = 720
  const padX = 10
  const padY = 12
  const lngSpan = WORLD_BBOX.maxLng - WORLD_BBOX.minLng
  const latSpan = WORLD_BBOX.maxLat - WORLD_BBOX.minLat
  const h = Math.round(((w - padX * 2) * latSpan) / lngSpan) + padY * 2
  return { w, h, padX, padY, bbox: WORLD_BBOX, latStretch: 1 }
})()

export const VIEWS: Record<MapScope, MapView> = { 中国: CN_VIEW, 世界: WORLD_VIEW }

export interface Proj {
  view: MapView
  x: (lng: number) => number
  y: (lat: number) => number
}

export function makeProj(view: MapView): Proj {
  const lngSpan = view.bbox.maxLng - view.bbox.minLng
  const latSpan = view.bbox.maxLat - view.bbox.minLat
  return {
    view,
    x: (lng) => view.padX + ((lng - view.bbox.minLng) / lngSpan) * (view.w - view.padX * 2),
    y: (lat) =>
      view.padY + ((view.bbox.maxLat - lat) / latSpan) * (view.h - view.padY * 2) * view.latStretch,
  }
}

/**
 * ★★ 一个地标该画在哪一档上。
 *
 * ⚠️ 判据是 `country`，**不是** `id.startsWith('world-')` ——
 *    库里有中国的**手工**景点（`badaling` 这种，id 不带 `world-`）
 *    也有世界景点（`world-日本-富士山`），而 `country` 字段是
 *    数据本来就有的、两种都覆盖。
 * ⚠️ **不按坐标过滤**（"经度 > 135 就算国外"那种）：中国最西到 73°、
 *    最东到 135°，而日本在 139° —— 按坐标切会把新疆的点和日本的点
 *    混在一起判，看着还挺合理。
 * ⚠️ 也不按 `id.startsWith('world-')` 判：手工那 35 条是中国的，
 *    但世界库里将来若手工补一条中国的，它就不带 `world-` 前缀了 ——
 *    这种"少画一个点"同样不报错。
 *
 * ★ 中国档 = `country === '中国'`；世界档 = 其余全部。
 */
export function landmarkInScope(country: string, scope: MapScope): boolean {
  return scope === '中国' ? country === '中国' : country !== '中国'
}

/** 环 → SVG path 的 d 属性（`[lng,lat][]` 通用） */
function ringPath(rings: [number, number][][], p: Proj): string {
  const parts: string[] = []
  for (const ring of rings) {
    if (ring.length < 3) continue
    let d = ''
    for (let i = 0; i < ring.length; i += 1) {
      const [lng, lat] = ring[i]
      d +=
        i === 0
          ? `M${p.x(lng).toFixed(1)} ${p.y(lat).toFixed(1)}`
          : `L${p.x(lng).toFixed(1)} ${p.y(lat).toFixed(1)}`
    }
    parts.push(`${d}Z`)
  }
  return parts.join(' ')
}

/** 一个省的全部外环转成 SVG path 的 d 属性 */
export function regionPath(region: MapRegion, p: Proj): string {
  return ringPath(region.r, p)
}

/**
 * 世界陆地轮廓 → 一条 path。
 *
 * ⚠️ 这份数据**只有陆地、没有国界**（合规要求，详见 `assets/world-map.ts` 抬头）。
 *    所以这里也就没有"按国家上色"这一步 —— **别加**。
 */
export function landPath(p: Proj): string {
  return ringPath(WORLD_LAND, p)
}
