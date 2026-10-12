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

   ⚠️ 中国档的画布参数（720×560、padX 18、padY 22）**没动** ——
      改前改后中国那张图的横向逐像素一致。
      ★ 纵向拉伸在 2026-10-10 从 1.16 改成了 1.0（原因见 `CN_VIEW`：
        1.16 会把海南整片推出画布），所以纵向**不再**逐像素一致。
   ============================================================ */

import { CHINA_BBOX, type MapRegion } from '../../assets/china-map'
import { WORLD_BBOX, WORLD_LAND } from '../../assets/world-map'
import type { GeoPoint } from '../../domain/geo'

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

/**
 * 中国档 —— 画布 720×560、padX 18、padY 22 都不动，**只把纵向拉伸改成 1.0**。
 *
 * ★★ 2026-10-10：`latStretch` 1.16 → 1.0。
 *
 *   原来的 1.16 是**以顶边为锚**往下撑的：
 *
 *       y(maxLat) = padY = 22
 *       y(minLat) = padY + (h − 2·padY) × 1.16 = 22 + 516 × 1.16 = 620.6
 *
 *   而画布只有 560 高 → **南边那一截永远在画布外**。
 *   溢出的量恒等于 `(h − 2·padY) × (latStretch − 1)` —— **和画布多大无关**，
 *   换个尺寸也照样溢，所以这不是"画布没留够"。
 *
 *   实测后果：`y` 在 lat ≈ 21.70 就到底边，**海南整座岛（最北 20.26）
 *   都不在画布内**，连带 `inView` 把飞往海南的路线一起抑制掉 ——
 *   界面上"什么都没有"，而控制台一声不吭。
 *
 *   ➜ 改成 1.0 之后：y 从 22（北缘）到 538（南缘），上下各留 22px ——
 *      正好就是 `padY` 本来的意思。**这不是"少拉伸一点"，是把拉伸去掉**。
 *
 *   ⚠️ 代价：整张图在纵向上比原来**小 16%**（画布 720×560 不变，
 *      只是内容从 598px 缩到 516px）。换来的是海南、湛江、北海全部看得见。
 *
 *   ★ 顺带一提，1.0 其实**更接近真实形状**：中国 bbox 是 61.61°×35.46°，
 *      35°N 附近一个经度要乘 cos(35°)≈0.82，真实宽高比约 1.42；
 *      内容区在 1.0 时是 684/516 = 1.33，在 1.16 时是 684/598.6 = 1.14。
 *      也就是说原来的 1.16 把雄鸡**拉高了 25%**，1.0 只高 7%。
 *
 *   ⚠️ 别把它改回去。`mapProjection.test.ts` 里有一条
 *      「中国档：纵向一个都不许越界」盯着这件事。
 */
const CN_VIEW: MapView = {
  w: 720,
  h: 560,
  padX: 18,
  padY: 22,
  bbox: CHINA_BBOX,
  latStretch: 1,
}

/**
 * 世界档 —— 画布按 `WORLD_BBOX` 的宽高比算，**不拉伸**。
 *
 * ⚠️ 不拉伸是有意的：世界图上最重要的是**位置关系**，不是饱满 ——
 *    纵向拉伸会把"哪儿在哪儿"搞乱。
 *    ★ 中国档原来那个 1.16 也是同一个理由（让雄鸡在竖屏里更饱满），
 *      但 2026-10-10 发现它会把海南整片推出画布，已经改回 1.0
 *      （见 `CN_VIEW`）—— 现在两个档都是 1.0。
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

/**
 * 一次飞行（家 → 落点）在地图上画成的那条曲线。
 *
 * ★★ 为什么是曲线、不是直线：
 *    直线读起来像尺子画的；稍微拱起来一点才像"飞过去的"。
 *    拱起量取弦长的 12%、封顶 14px —— 长途是一道明显的弧，
 *    而 22 公里那种近程（画布上约 2px）几乎就是一条线，
 *    不会在落点旁边多出一个莫名其妙的怪圈。
 *
 * ★ 控制点取**弦的中垂线**方向（`-dy/len, dx/len`），所以拱向只由
 *   起终点决定 —— 同一次飞行画多少遍都是同一条曲线（纯函数，可断言）。
 *
 * ⚠️ 不要拿它去"画了看看端点在外面会怎样"：`<svg>` 默认
 *    `overflow: hidden`，画到画布外的部分**被裁掉、不报错、控制台一声不吭**
 *    （本文件抬头说的就是这一类）。调用方先过 `inView()`。
 */
export function flightPath(from: GeoPoint, to: GeoPoint, p: Proj): string {
  const x1 = p.x(from.lng)
  const y1 = p.y(from.lat)
  const x2 = p.x(to.lng)
  const y2 = p.y(to.lat)
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  /* 起终点几乎重合 → 退回直线。也顺带挡住 len=0 时 `dy/len` 的 NaN */
  if (len < 1) return `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`
  const bow = Math.min(len * 0.12, 14)
  const mx = (x1 + x2) / 2 - (dy / len) * bow
  const my = (y1 + y2) / 2 + (dx / len) * bow
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
}

/**
 * 这个经纬度投影之后落不落在画布内。
 *
 * ★★ 为什么需要它：`<svg>` 默认 `overflow: hidden`，画到画布外的元素
 *    **直接被裁掉、不报错、控制台一声不吭**。
 *    世界档 bbox 覆盖全地球（-180…180 / -60…75），什么都进得来；
 *    但**中国档**只覆盖中国那一片 —— 家长把"家"设到国外，
 *    端点就会跑到画布外面。
 *
 * ★★ 2026-10-10：中国档的**纵向**越界已经不存在了（`latStretch` 1.16 → 1.0，
 *    见 `CN_VIEW`）。在那之前，南缘那 60 个地标（海南 32、广东 19、广西 9）
 *    是画不出来的，这条判断会连着把飞往它们的路线一起抑制掉。
 *    ➜ 现在它**只在横向**还会命中（家 / 落点在国外）。
 *      `mapProjection.test.ts` 里有一条「中国档：纵向一个都不许越界」
 *      盯着纵向 —— 哪天它红了，说明拉伸又被调回去了。
 */
export function inView(p: Proj, lng: number, lat: number): boolean {
  const x = p.x(lng)
  const y = p.y(lat)
  return x >= 0 && x <= p.view.w && y >= 0 && y <= p.view.h
}
