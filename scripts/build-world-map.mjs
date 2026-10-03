/* ============================================================
   世界地图轮廓 —— 生成 `src/assets/world-map.ts`
   ============================================================
   输入：`ne_110m_land.geojson`（Natural Earth 1:110m **陆地**数据，公有领域）
   输出：`src/assets/world-map.ts`（内置几何，跟 `china-map.ts` 同一套用法）

   ⚠️⚠️⚠️ **为什么用 `ne_110m_land` 而不是 `ne_110m_admin_0_countries`**
   ------------------------------------------------------------
   这是**合规决定，不是随手选的**：

   `ne_110m_land` 只有**陆地轮廓**（海岸线），属性里只有
   `featurecla / scalerank / min_zoom` —— **没有任何国家、国界、主权归属信息**。
   而 `admin_0_countries` 是**按国家切分**的，它自带一套外国的划界口径
   （台湾被当成独立国家实体、藏南划给印度、南海诸岛不成体系）——
   直接拿来画就是**把国界画错**，属于明令禁止的事。

   本文件产出的地图**不画任何国界、不标任何国名** ——
   既然一条国界都不画，就不存在"国界画错"的可能。
   中国那部分的主权呈现由 `china-map.ts` 负责（34 个省级行政区含台港澳 +
   南海诸岛附图），那一份是**单独维护、单独核对**的。

   ⚠️ 所以：**别"顺手"给这张世界图加上国界或国名。**
      要加的话，必须换成符合国家标准的底图数据，而不是这个陆地数据集。

   ⚠️ 这张图只用于「孩子看看自己去过的地方在地球哪一边」的示意，
      不作为测绘成果，不用于导航。

   ------------------------------------------------------------
   为什么要抽稀 + 裁剪
     · 原始 127 个要素 / 128 个环 / **5143 个点** —— 比 china-map（2509 点）还多，
       而 APK 是要打包的，得压。
     · 纬度窗口取 -60~75：再往南就是南极，**孩子一个景点都没有**，
       留着只会让南半球占掉一半画布（还多半是空白海域）。
       ➜ 所以要**按窗口裁剪多边形**，不是只改投影（只改投影的话南极
         会画到画布外面去，或者被拉成一条怪边）。

   裁剪用 Sutherland–Hodgman：经纬度矩形是**凸**的，正好适用。
   ============================================================ */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/* ★ 源数据入库（138 KB）—— 跟 `cn-a-level.json` 一样，留一份源，
   这样脚本可复现，别人不用去猜"当初抓的是哪一版"。 */
const SRC = process.argv[2] || path.join(ROOT, 'scripts', 'ne-110m-land.geojson')
const OUT = path.join(ROOT, 'src', 'assets', 'world-map.ts')

/* 可见窗口。★ 定这个窗口的依据是**库里世界景点的实际范围**：
   lng -171.44 ~ 177.08 / lat -51 ~ 66.54（最南百内国家公园，最北圣诞老人村）。
   留一点余量即可，不要为了"完整"把南极圈进来。 */
const BBOX = { minLng: -180, maxLng: 180, minLat: -60, maxLat: 75 }

/** Douglas–Peucker 抽稀（度为单位，0.35° ≈ 赤道 39km，肉眼已看不出） */
const TOL = 0.35

function perpDist(p, a, b) {
  const [px, py] = p
  const [ax, ay] = a
  const [bx, by] = b
  const dx = bx - ax
  const dy = by - ay
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay)
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  const cx = ax + Math.max(0, Math.min(1, t)) * dx
  const cy = ay + Math.max(0, Math.min(1, t)) * dy
  return Math.hypot(px - cx, py - cy)
}

function simplify(points, tol) {
  if (points.length < 3) return points
  let maxD = 0
  let idx = 0
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpDist(points[i], points[0], points[points.length - 1])
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD <= tol) return [points[0], points[points.length - 1]]
  const left = simplify(points.slice(0, idx + 1), tol)
  const right = simplify(points.slice(idx), tol)
  return [...left.slice(0, -1), ...right]
}

/* ---- Sutherland–Hodgman：把环裁到矩形窗口里 ---- */
const INSIDE = {
  left: (p) => p[0] >= BBOX.minLng,
  right: (p) => p[0] <= BBOX.maxLng,
  bottom: (p) => p[1] >= BBOX.minLat,
  top: (p) => p[1] <= BBOX.maxLat,
}
function intersect(p, q, edge) {
  const [px, py] = p
  const [qx, qy] = q
  if (edge === 'left' || edge === 'right') {
    const x = edge === 'left' ? BBOX.minLng : BBOX.maxLng
    return [x, py + ((qy - py) * (x - px)) / (qx - px)]
  }
  const y = edge === 'bottom' ? BBOX.minLat : BBOX.maxLat
  return [px + ((qx - px) * (y - py)) / (qy - py), y]
}
function clipRing(ring, edge) {
  const out = []
  for (let i = 0; i < ring.length; i += 1) {
    const cur = ring[i]
    const prev = ring[(i + ring.length - 1) % ring.length]
    const curIn = INSIDE[edge](cur)
    const prevIn = INSIDE[edge](prev)
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur, edge))
      out.push(cur)
    } else if (prevIn) {
      out.push(intersect(prev, cur, edge))
    }
  }
  return out
}
function clipToWindow(ring) {
  let r = ring
  for (const edge of ['left', 'right', 'bottom', 'top']) {
    if (r.length < 3) return []
    r = clipRing(r, edge)
  }
  return r
}

/** 环的经纬度包围盒面积 —— 用来丢掉裁剩下的碎片 */
function bboxArea(ring) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const [x, y] of ring) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return (x1 - x0) * (y1 - y0)
}

/* ============================================================ */
const geo = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const rings = []

for (const f of geo.features) {
  const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]
  for (const poly of polys) {
    for (const raw of poly) {
      const simplified = simplify(raw, TOL)
      if (simplified.length < 3) continue
      const clipped = clipToWindow(simplified)
      if (clipped.length < 3) continue
      // 丢掉裁剩下的针尖/碎屑（0.3 平方度以下）
      if (bboxArea(clipped) < 0.3) continue
      rings.push(clipped)
    }
  }
}

// 点坐标压到 2 位小数 —— 世界尺度上 0.01° ≈ 1km，肉眼绝对看不出来
const packed = rings.map((r) => r.map(([x, y]) => [Number(x.toFixed(2)), Number(y.toFixed(2))]))
const totalPts = packed.reduce((s, r) => s + r.length, 0)

const ts = `/* ============================================================
   世界地图轮廓 —— 内置几何数据（无网络 / 无瓦片 / 无 key）
   ============================================================

   ⚠️⚠️⚠️ 这张图**只有陆地，没有任何国界、也没有任何国名**。
   ------------------------------------------------------------
   这是**合规要求**，不是省事：

   · 数据来自 Natural Earth 1:110m 的 **\`ne_110m_land\`**（陆地数据集，
     公有领域）。它的属性里只有 \`featurecla / scalerank / min_zoom\` ——
     **不含国家、国界、主权归属**。
   · 为什么不用按国家切分的那份（\`admin_0_countries\`）：它自带一套
     外国的划界口径（台湾被当成独立国家实体、藏南划给印度、南海诸岛
     不成体系），**直接拿来画就是把国界画错**。
   · 本图**一条国界都不画、一个国名都不标** —— 不画就不会画错。
   · 中国部分的主权呈现由 **\`china-map.ts\`** 单独负责
     （34 个省级行政区含台港澳 + 南海诸岛附图），那一份单独维护、单独核对。

   ★★ 所以：**别"顺手"给这张图加国界或国名。**
      真要加，必须换成符合国家标准的底图数据，而不是这个陆地数据集。

   ★ 用途：给孩子看「自己去过的地方在地球哪一边」的**示意图**，
     不作为测绘成果，不用于导航。

   ------------------------------------------------------------
   窗口：lng ${BBOX.minLng}~${BBOX.maxLng} / lat ${BBOX.minLat}~${BBOX.maxLat}
     · 纬度上界 ${BBOX.maxLat} —— 库里最北的景点是「圣诞老人村」(66.54)
     · 纬度下界 ${BBOX.minLat} —— 最南是「百内国家公园」(-51)，再往南是南极，
       孩子一个景点都没有，留着只会让南半球白占一半画布。
     ➜ 几何已**按这个窗口裁过**（不是只改投影），所以窗口外没有点。

   抽稀：Douglas–Peucker，容差 ${TOL}°（赤道约 ${Math.round(TOL * 111)} km），
         ${totalPts} 个点（原始 5143）。

   由 \`scripts/build-world-map.mjs\` 生成，**别手改**。
   ============================================================ */

/** 经纬度包围盒 —— 用来算投影 */
export const WORLD_BBOX = {
  minLng: ${BBOX.minLng},
  maxLng: ${BBOX.maxLng},
  minLat: ${BBOX.minLat},
  maxLat: ${BBOX.maxLat},
} as const

/**
 * 陆地轮廓环。**每个环是一串 [lng, lat]，没有名字** ——
 * 因为这份数据本来就不区分国家，也就没有名字可起。
 */
export const WORLD_LAND: [number, number][][] = ${JSON.stringify(packed)}
`

fs.writeFileSync(OUT, ts)

console.log('写出    :', OUT)
console.log('环数    :', packed.length, '（原始 128）')
console.log('点数    :', totalPts, '（原始 5143）')
console.log('文件大小:', (ts.length / 1024).toFixed(1), 'KB')
