import { describe, expect, it } from 'vitest'
import { LANDMARKS } from '../../domain/travel'
import { CHINA_REGIONS } from '../../assets/china-map'
import { WORLD_LAND } from '../../assets/world-map'
import { VIEWS, landPath, landmarkInScope, makeProj, regionPath } from './mapProjection'

/* ============================================================
   地图投影的守卫
   ------------------------------------------------------------
   ★★ 为什么这个文件值得存在：

   「坐标投影到画布外面去了」是**不会报错**的那一类 bug ——
   界面上什么都没有、控制台一声不吭、测试全绿。
   2026-09-24 之前 `projectX/projectY` 写死了中国 bbox，
   于是**每一个**世界景点（巴黎 lng=2.29 < 中国最西 73.48）
   投影出来都是负 X，画在世界图外面。
   ➜ 唯一的防法是**把每一个地标都投影一遍，逐个断言落在画布内**。
   ============================================================ */

describe('投影 · 画布参数', () => {
  it('★ 中国档的画布与拉伸必须还是原来那组数（改了就不是"逐像素一致"了）', () => {
    // 世界图这一版特意不动中国档。哪天有人"顺手统一一下参数"，
    // 中国那张图会整体缩放/拉伸，而**没有任何测试会因此变红** —— 这条就是拦它的。
    const v = VIEWS['中国']
    expect(v.w).toBe(720)
    expect(v.h).toBe(560)
    expect(v.padX).toBe(18)
    expect(v.padY).toBe(22)
    expect(v.latStretch).toBe(1.16)
  })

  it('★ 世界档按 bbox 的宽高比算，且不拉伸', () => {
    const v = VIEWS['世界']
    expect(v.latStretch).toBe(1)
    expect(v.w).toBe(720)
    // h 由 bbox 宽高比推出来：只有陆地那一带（-60…75）而不是整根经线
    const lngSpan = 360
    const latSpan = 75 - -60
    const expectH = Math.round(((720 - 20) * latSpan) / lngSpan) + 24
    expect(v.h).toBe(expectH)
    // 横带：宽明显大于高（否则说明拉伸把比例毁了）
    expect(v.w / v.h).toBeGreaterThan(2.2)
  })
})

describe('投影 · 每一个地标都必须在画布内', () => {
  it('★★ 世界档：231 个世界景点**一个都不许**落到画布外', () => {
    const proj = makeProj(VIEWS['世界'])
    const { w, h } = proj.view
    const mine = LANDMARKS.filter((l) => landmarkInScope(l.country, '世界'))
    expect(mine.length, '世界档一个地标都没有 —— 判据写错了').toBeGreaterThan(0)

    const outside = mine
      .map((l) => ({ l, x: proj.x(l.lng), y: proj.y(l.lat) }))
      .filter(({ x, y }) => !(x >= 0 && x <= w && y >= 0 && y <= h))

    expect(
      outside.map(({ l, x, y }) => `${l.name}(${l.id}) → ${x.toFixed(0)},${y.toFixed(0)}`),
      `这些世界景点会被画到画布外（${w}×${h}），界面上静默消失`,
    ).toEqual([])
  })

  it('★ 中国档：横向一个都不许越界', () => {
    // ⚠️ 纵向单独说 —— 见下一条，那是**既有**的裁剪问题，不是这里引入的。
    const proj = makeProj(VIEWS['中国'])
    const { w } = proj.view
    const outside = LANDMARKS.filter((l) => landmarkInScope(l.country, '中国'))
      .map((l) => ({ l, x: proj.x(l.lng) }))
      .filter(({ x }) => !(x >= 0 && x <= w))
    expect(outside.map(({ l, x }) => `${l.name} → x=${x.toFixed(0)}`)).toEqual([])
  })

  it('★★ 中国档的纵向越界必须**只**发生在南缘（既有 bug，已报告）', () => {
    /* ------------------------------------------------------------
       ⚠️⚠️ 这是一条「已知问题」守卫，不是「正确行为」守卫。

       事实：中国档 `latStretch = 1.16` 是**以顶边为锚**往下撑的，
             于是 `y` 在 `lat = 21.67` 处就已经到 560（画布底边），
             再往南全部落在画布外 —— 而 `<svg>` 默认 `overflow: hidden`，
             **直接被裁掉，不报错、控制台一声不吭**。

       影响（2026-09-24 实测）：**60 个地标**看不见
             —— 海南 32、广东 19（湛江/徐闻一带）、广西 9（北海/涠洲岛）。
             注意海南岛**整座岛**都在 21.67 以南 → 中国图上**连岛都没有**。
             ⚠️ 原注释写的是「让新疆/黑龙江的北缘与海南的南缘都留出余量」，
                意思对，算法把方向搞反了（顶边固定、底部溢出）。

       ➜ 已报告家长，**等确认再改**（改法 = 把拉伸改成以中线为锚，
          或者按 `h / latStretch` 反推画布高度）。改完这条**会红**，
          那时把这里换成 `expect(outside).toEqual([])` 即可。
       ------------------------------------------------------------ */
    const proj = makeProj(VIEWS['中国'])
    const { h } = proj.view
    const outside = LANDMARKS.filter((l) => landmarkInScope(l.country, '中国')).filter(
      (l) => proj.y(l.lat) > h,
    )
    // 越界的全是南边那几个省 —— 一旦有别的省份冒出来，说明问题扩散了
    // （顺序按 JS 默认的码位排序，不是拼音）
    const provinces = [...new Set(outside.map((l) => l.province))].sort()
    expect(provinces).toEqual(['广东', '广西', '海南'])
    // 且全部在裁剪纬度以南（21.67°N）
    for (const l of outside) expect(l.lat, `${l.name} 不该越界`).toBeLessThan(21.7)
  })

  it('★ 中国档不许画任何世界景点，世界档不许画任何中国景点', () => {
    // 反过来的错法：判据取反了 → 中国图上出现富士山。
    // 这种"多画了"不会报错，只会让家长觉得"这张图乱了"。
    for (const l of LANDMARKS) {
      expect(landmarkInScope(l.country, '中国'), `${l.name} 分档错`).toBe(l.country === '中国')
    }
    const cn = LANDMARKS.filter((l) => landmarkInScope(l.country, '中国'))
    const world = LANDMARKS.filter((l) => landmarkInScope(l.country, '世界'))
    expect(cn.length + world.length).toBe(LANDMARKS.length) // 不重不漏
  })

  it('★★ 全库每一条的 country 都得是真值（缺省会整档空白）', () => {
    // `Landmark.country` 以前声明成可选，而国内条目在数据层是省略的 ——
    // 一旦哪里漏了补默认值，`country === '中国'` 对 1577 条全部为 false，
    // 中国档**一个点都不画**：地图空白、不报错、没有日志。
    const bad = LANDMARKS.filter((l) => !l.country)
    expect(bad.map((l) => l.id)).toEqual([])
  })
})

describe('投影 · 底图几何', () => {
  it('★★ 世界底图只画陆地，路径里不许出现任何国名/地名文字', () => {
    // 合规要求（详见 assets/world-map.ts 抬头）：
    // 世界图**只有陆地轮廓，没有国界、没有国名**。
    // 这条守的是"数据源本身就不带国界"这个前提 —— 换数据源会先红在这里。
    for (const ring of WORLD_LAND) {
      expect(ring.length).toBeGreaterThanOrEqual(3)
      for (const pt of ring) {
        expect(Array.isArray(pt) && pt.length === 2).toBe(true)
        const [lng, lat] = pt
        expect(Number.isFinite(lng) && Number.isFinite(lat)).toBe(true)
      }
    }
  })

  it('★ 世界底图投影后也全部落在画布内（含被裁到窗口边上的那几条）', () => {
    const proj = makeProj(VIEWS['世界'])
    const { w, h } = proj.view
    let pts = 0
    let bad = 0
    for (const ring of WORLD_LAND) {
      for (const [lng, lat] of ring) {
        pts += 1
        const x = proj.x(lng)
        const y = proj.y(lat)
        // 允许 0.5px 的取整余量（path 里 toFixed(1)）
        if (x < -0.5 || x > w + 0.5 || y < -0.5 || y > h + 0.5) bad += 1
      }
    }
    expect(pts).toBeGreaterThan(1000)
    expect(bad, `${bad}/${pts} 个底图点落在画布外`).toBe(0)
  })

  it('★ 中国档：34 个省级行政区一个都不能少（含台港澳）', () => {
    expect(CHINA_REGIONS.length).toBe(34)
    const names = CHINA_REGIONS.map((r) => r.n)
    for (const must of ['台湾', '香港', '澳门']) {
      expect(names.some((n) => n.includes(must)), `省界数据里缺「${must}」`).toBe(true)
    }
  })

  it('底图 path 生成得出来、且不是空串', () => {
    const cn = makeProj(VIEWS['中国'])
    const world = makeProj(VIEWS['世界'])
    expect(regionPath(CHINA_REGIONS[0], cn)).toMatch(/^M[\d.]+ [\d.]+/)
    expect(landPath(world).length).toBeGreaterThan(1000)
    // 环少于 3 个点画不出面 —— 得被跳过，而不是生成一个 "M..Z" 的假面
    expect(regionPath({ n: 'x', c: [0, 0], r: [[[0, 0], [1, 1]]] }, cn)).toBe('')
  })
})
