import { describe, expect, it } from 'vitest'
import { LANDMARKS } from '../../domain/travel'
import { CHINA_REGIONS } from '../../assets/china-map'
import { WORLD_LAND } from '../../assets/world-map'
import { DEFAULT_HOME_POINT } from '../../domain/geo'
import { VIEWS, flightPath, inView, landPath, landmarkInScope, makeProj, regionPath } from './mapProjection'

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
  it('★ 中国档的画布参数必须还是那组数（改了中国那张图会整体缩放）', () => {
    // 哪天有人"顺手统一一下参数"，中国那张图会整体缩放/拉伸，
    // 而**没有任何测试会因此变红** —— 这条就是拦它的。
    // ★ 2026-10-10：`latStretch` 从 1.16 改成 1.0，那一次是**故意**的
    //   （1.16 会把海南整片推出画布，见下面那条「纵向一个都不许越界」）。
    //   这里跟着改，是为了让"下一次"再有人动它时**能红**。
    const v = VIEWS['中国']
    expect(v.w).toBe(720)
    expect(v.h).toBe(560)
    expect(v.padX).toBe(18)
    expect(v.padY).toBe(22)
    expect(v.latStretch).toBe(1)
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

  it('★★ 中国档：纵向一个都不许越界（2026-10-10 修掉的那条既有 bug）', () => {
    /* ------------------------------------------------------------
       ★★ 这条守卫的来历（读之前先看 `mapProjection.ts` 的 `CN_VIEW`）：

       原来中国档 `latStretch = 1.16` 是**以顶边为锚**往下撑的，于是
       `y` 在 lat ≈ 21.70 就到底边，再往南全在画布外 —— 而 `<svg>`
       默认 `overflow: hidden`，**直接被裁掉、不报错、控制台一声不吭**。

       2026-09-24 实测：**60 个地标**看不见 —— 海南 32、广东 19、广西 9。
       海南岛**整座岛**都在 21.70 以南 → 中国图上**连岛都没有**。
       当时这里写的是 `expect(provinces).toEqual(['广东','广西','海南'])`
       —— 一条「已知问题守卫」，钉住"越界的只有这几个省，没扩散"。

       2026-10-10 修掉（`latStretch` → 1.0）之后，这条升级成
       **正确行为守卫**：纵向一个都不许越界。

       ⚠️ 别把它退回成"只断言越界的省份"。那样写的话，只要越界的还是
          广东/广西/海南，**哪怕越界的地标从 60 个涨到 600 个**，
          这条照样绿 —— 它守不住任何东西。
       ------------------------------------------------------------ */
    const proj = makeProj(VIEWS['中国'])
    const { h } = proj.view
    const outside = LANDMARKS.filter((l) => landmarkInScope(l.country, '中国')).filter(
      (l) => proj.y(l.lat) > h,
    )
    expect(
      outside.map((l) => `${l.name}(${l.province}) y=${proj.y(l.lat).toFixed(0)} > ${h}`),
      `这些中国地标会被画到画布下缘之外（画布高 ${h}），界面上静默消失`,
    ).toEqual([])
    // 反向确认这条断言不是空跑：库里的确有海南的地标（就是这次修它的原因）
    expect(
      LANDMARKS.filter((l) => l.province === '海南').length,
      '库里一条海南地标都没有 —— 上面那条断言"因为集合是空的"而永远为真',
    ).toBeGreaterThan(0)
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

/* ============================================================
   飞行路线 —— 家 → 落点的那条虚线
   ------------------------------------------------------------
   ★★ 为什么值得单独守：

   这一层曾经是**只有注释、没有代码**的。`MapPage.tsx` 的层次注释写着
     「正在飞的小鸟（一个会摆动的小三角 + 虚线轨迹）」
   而 `flyingBirds.map(...)` 里只画了落点上一个圆环 + 一个三角，
   **一条线都没有**；紧跟着那句「从地标点向外画一条虚线」也一样是空的。

   「注释说已经做了」和「真的做了」长得一模一样 ——
   `tsc` 查不出、肉眼看不出、测试全绿。同一天在这个项目里栽过第二次了
   （上一次是 `travelRange.ts` 整套距离分档写好了却零调用者，
     而两处注释都写着"改成按距离分档之后"）。

   ➜ 这个文件守**几何**（端点对不对、有没有 NaN、会不会画到画布外）；
      「那一层到底有没有被渲染出来」由 `TravelMap.route.test.tsx` 守。
      两条都要有 —— 单测 `flightPath` 全绿**不能**证明有人在调它。
   ============================================================ */

describe('飞行路线 · 几何', () => {
  const cn = makeProj(VIEWS['中国'])
  const world = makeProj(VIEWS['世界'])
  const SZ = DEFAULT_HOME_POINT
  /** path 里的数字，按出现顺序（`M x1 y1 Q mx my x2 y2`） */
  const nums = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  const PATH_RE =
    /^M[0-9.-]+ [0-9.-]+ (?:L[0-9.-]+ [0-9.-]+|Q[0-9.-]+ [0-9.-]+ [0-9.-]+ [0-9.-]+)$/
  /** 控制点到弦的垂距 = 拱起量（用 path 里那几个数反算，不依赖实现细节） */
  const bowOf = (d: string) => {
    const [x1, y1, mx, my, x2, y2] = nums(d)
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy)
    return len === 0 ? 0 : Math.abs((mx - x1) * dy - (my - y1) * dx) / len
  }

  it('★★ 起点必须是「家」、终点必须是落点（画反了看不出来，只是路线倒着走）', () => {
    const dest = { lng: 116.4074, lat: 39.9042 } // 北京
    const d = flightPath(SZ, dest, cn)
    expect(d).toMatch(PATH_RE)
    const n = nums(d)
    expect(n.length, '深圳→北京在画布上是几百像素，不该退化成直线').toBe(6)
    // 端点 = 投影后的家 / 落点，四舍五入到 0.1px（和 path 里的 toFixed(1) 对齐）
    expect(n[0]).toBe(Number(cn.x(SZ.lng).toFixed(1)))
    expect(n[1]).toBe(Number(cn.y(SZ.lat).toFixed(1)))
    expect(n[4]).toBe(Number(cn.x(dest.lng).toFixed(1)))
    expect(n[5]).toBe(Number(cn.y(dest.lat).toFixed(1)))
  })

  it('★ 要真的拱起来 —— 控制点不许落在弦上（否则就是条直线，白叫"路线"）', () => {
    // 深圳 → 北京：弦长约 290px，拱起量撞到 14px 的封顶
    const bow = bowOf(flightPath(SZ, { lng: 116.4074, lat: 39.9042 }, cn))
    expect(bow).toBeGreaterThan(1)
    // 封顶 14px —— 不封的话长途会鼓成一个夸张的大圈，盖住半个中国
    expect(bow).toBeLessThanOrEqual(14.05)
  })

  it('★ 近程按比例拱（不是固定 14px）—— 别让广州那种短途也鼓出一个大圈', () => {
    // 深圳 → 广州：画布上约 13px，拱起量应约 13 × 0.12 ≈ 1.6px
    const d = flightPath(SZ, { lng: 113.2644, lat: 23.1291 }, cn)
    const n = nums(d)
    expect(n.length, '深圳→广州退化成了直线，这条断言的前提不成立').toBe(6)
    const len = Math.hypot(n[4] - n[0], n[5] - n[1])
    expect(len).toBeGreaterThan(5)
    // 容差放到 0.5px：path 里每个坐标都 toFixed(1) 过，反算会有取整误差
    expect(bowOf(d)).toBeCloseTo(len * 0.12, 0)
  })

  it('★ 起终点重合 → 退回直线，且不许出现 NaN', () => {
    // len = 0 时 `dy / len` 是 0/0 = NaN → 整条 path 直接不画，**且不报错**
    const d = flightPath(SZ, { lng: SZ.lng, lat: SZ.lat }, cn)
    expect(d).toMatch(/^M[0-9.-]+ [0-9.-]+ L[0-9.-]+ [0-9.-]+$/)
    expect(d).not.toContain('NaN')
  })

  it('★ 纯函数：同一次飞行画两遍必须一模一样（否则每次重渲染虚线都在跳）', () => {
    const dest = { lng: 121.4737, lat: 31.2304 } // 上海
    expect(flightPath(SZ, dest, cn)).toBe(flightPath(SZ, dest, cn))
  })

  it('★★ 全库每个地标当落点、两档各算一遍：不许 NaN、不许生成不合法的 d', () => {
    for (const proj of [cn, world]) {
      for (const l of LANDMARKS) {
        const d = flightPath(SZ, l, proj)
        expect(d, `${l.name}(${l.id}) 的路线算出了 NaN`).not.toContain('NaN')
        expect(d, `${l.name}(${l.id}) 的路线不是合法的 path：${d}`).toMatch(PATH_RE)
      }
    }
  })
})

describe('飞行路线 · 端点在不在画布内', () => {
  const cn = makeProj(VIEWS['中国'])
  const world = makeProj(VIEWS['世界'])

  it('★ 中国档：默认的「家」（深圳）在里面', () => {
    expect(inView(cn, DEFAULT_HOME_POINT.lng, DEFAULT_HOME_POINT.lat)).toBe(true)
  })

  it('★★ 中国档：巴黎在外面 —— 「家」设到国外时，不该画一条从画布外插进来的线', () => {
    // `<svg>` 默认 overflow: hidden，画到外面的部分**被裁掉、不报错**，
    // 界面上就是"一条线从地图边上冒出来"，看不出是算错了。
    expect(inView(cn, 2.3522, 48.8566)).toBe(false)
  })

  it('★ 世界档：同一个巴黎在里面（两档共用一套投影，只是窗口不同）', () => {
    expect(inView(world, 2.3522, 48.8566)).toBe(true)
  })

  it('★★ 中国档：海南那批现在**必须在画布内**（2026-10-10 修掉裁剪之后）', () => {
    /*
      ★ 这条以前是它的反面：原来 `latStretch = 1.16` 以顶边为锚，
        `y` 在 lat ≈ 21.70 就到画布底，海南整座岛都在以南 →
        当时断言的是"至少有若干个海南地标 inView 为 false"。

      ➜ 裁剪修掉之后翻过来：**一个都不许在外面**。
        这也顺带钉住"海南的飞行路线画得出来"这件事 ——
        `MapPage` 的路线层是拿 `inView` 当闸门的，这里为 false 就一条线都不画。
    */
    const hainan = LANDMARKS.filter((l) => l.province === '海南')
    // 先确认这批真的存在，否则下面那条断言会"因为集合是空的"而永远为真
    expect(hainan.length, '库里一条海南的地标都没有 —— 判据写错了').toBeGreaterThan(0)
    const hidden = hainan.filter((l) => !inView(cn, l.lng, l.lat))
    expect(
      hidden.map((l) => `${l.name} → y=${cn.y(l.lat).toFixed(0)}`),
      '海南的地标又掉到画布外了 —— 纵向拉伸是不是被改回 1.16 了？',
    ).toEqual([])
  })
})
