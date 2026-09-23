import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertLandmarks,
  checkLandmarks,
  GD_LICENSE,
  LANDMARK_SEEDS,
  toLandmark,
  type LandmarkSeed,
} from './landmarks'
import { LANDMARKS } from '../domain/travel'

/** 造一条合法数据，用来做"只改一个字段"的对照 */
function seed(over: Partial<LandmarkSeed> = {}): LandmarkSeed {
  return {
    id: 'x',
    name: '某地',
    province: '广东',
    lng: 113.5,
    lat: 23.1,
    blurb: '一句话。',
    scene: 'city',
    ...over,
  }
}

describe('旅游库校验', () => {
  it('★ 真实数据必须一条问题都没有', () => {
    // 这条是「构建时校验」的单元测试版本：数据写坏了这里立刻红，
    // 而不是等孩子在地图上看到一片空白
    expect(checkLandmarks(LANDMARK_SEEDS)).toEqual([])
    expect(() => assertLandmarks()).not.toThrow()
  })

  it('id 重复要拦住（后者会盖掉前者，内容悄悄少一条）', () => {
    const issues = checkLandmarks([seed({ id: 'a' }), seed({ id: 'a' })])
    expect(issues.some((i) => i.why.includes('重复'))).toBe(true)
  })

  it('★ (0,0) 要拦住 —— 定位失败的产物会让距离算出天文数字', () => {
    const issues = checkLandmarks([seed({ lng: 0, lat: 0 })])
    expect(issues.some((i) => i.why.includes('(0,0)'))).toBe(true)
  })

  it('经纬度越界要拦住', () => {
    expect(checkLandmarks([seed({ lng: 200 })]).length).toBeGreaterThan(0)
    expect(checkLandmarks([seed({ lat: 100 })]).length).toBeGreaterThan(0)
  })

  it('scene 拼错要拦住（palette 取不到，插画会变黑）', () => {
    const bad = { ...seed(), scene: 'montain' as LandmarkSeed['scene'] }
    expect(checkLandmarks([bad]).some((i) => i.why.includes('scene'))).toBe(true)
  })

  it('名字或介绍空着要拦住（界面上会渲染成空白）', () => {
    expect(checkLandmarks([seed({ name: '' })]).length).toBeGreaterThan(0)
    expect(checkLandmarks([seed({ blurb: '' })]).length).toBeGreaterThan(0)
  })

  it('一次报出全部问题，而不是修一个跑一次', () => {
    const issues = checkLandmarks([
      seed({ id: 'a', name: '' }),
      seed({ id: 'a', lng: 0, lat: 0 }),
    ])
    expect(issues.length).toBeGreaterThanOrEqual(3)
  })
})

describe('数据 → Landmark', () => {
  it('country 缺省是「中国」', () => {
    expect(toLandmark(seed()).country).toBe('中国')
    expect(toLandmark(seed({ country: '法国' })).country).toBe('法国')
  })

  it('tier 缺省是 1（新条目不用再纠结给几档）', () => {
    expect(toLandmark(seed()).tier).toBe(1)
    expect(toLandmark(seed({ tier: 3 })).tier).toBe(3)
  })

  it('★ 加载出来的地标与数据条数一致，id 不重不漏', () => {
    expect(LANDMARKS).toHaveLength(LANDMARK_SEEDS.length)
    const seedIds = new Set(LANDMARK_SEEDS.map((s) => s.id))
    expect(new Set(LANDMARKS.map((l) => l.id)).size).toBe(seedIds.size)
    for (const l of LANDMARKS) expect(seedIds.has(l.id)).toBe(true)
  })

  it('★ palette 由 scene 推出来（不是数据里各写一份）', () => {
    // 同一个 scene 的地标，配色必须完全一样 —— 否则就是有人在数据里
    // 偷偷手写了 palette，那正是这次要消灭的重复
    const byScene = new Map<string, string[]>()
    for (const l of LANDMARKS) {
      const key = l.scene
      const got = byScene.get(key) ?? []
      got.push(l.palette.join(','))
      byScene.set(key, got)
    }
    for (const [scene, palettes] of byScene) {
      expect(new Set(palettes).size, `scene=${scene} 出现了多种配色`).toBe(1)
    }
  })

  it('★★ 每条地标都带得出经纬度和一句给孩子看的话', () => {
    for (const l of LANDMARKS) {
      expect(Number.isFinite(l.lng)).toBe(true)
      expect(Number.isFinite(l.lat)).toBe(true)
      expect(l.blurb.length).toBeGreaterThan(0)
      expect(l.name.length).toBeGreaterThan(0)
      expect(l.province.length).toBeGreaterThan(0)
    }
  })
})

/* ============================================================
   生成侧（OSM / ODbL）
   ============================================================ */

describe('广东生成数据（ODbL）', () => {
  it('★★ ODbL 抬头必须还在 —— 数据被复制走时许可要跟着走', () => {
    // 抬头丢了 = 我们分发了一份**没有许可声明的**衍生数据库。
    // 有人重跑 `scripts/fetch-landmarks.mjs` 时把抬头写掉，这条会红。
    expect(GD_LICENSE.license).toBe('ODbL-1.0')
    expect(GD_LICENSE.attribution).toContain('OpenStreetMap')
    expect(GD_LICENSE.source).toContain('openstreetmap.org')
    expect(GD_LICENSE.count).toBe(GD_LICENSE.items.length)
  })

  it('★ 生成侧条目：id 带 gd- 前缀、填了市、省是广东', () => {
    const gd = LANDMARK_SEEDS.filter((s) => s.id.startsWith('gd-'))
    expect(gd.length).toBeGreaterThan(0)
    for (const s of gd) {
      expect(s.province).toBe('广东')
      expect(s.city, `${s.name} 缺 city`).toBeTruthy()
    }
  })

  it('★★ 生成侧坐标必须落在广东范围内', () => {
    // 挡的是「整批数据跑到别的省去了」这类错误 ——
    // 比如查询写错、或者经纬度顺序写反（lng/lat 互换会让广东
    // 整个掉到印度洋里）。逐条看是看不出来的，只有卡框才看得见。
    // 框按广东实际范围放宽了一点（徐闻 ~20.2°N，饶平 ~117.0°E）。
    const gd = LANDMARK_SEEDS.filter((s) => s.id.startsWith('gd-'))
    for (const s of gd) {
      expect(s.lng, `${s.name} lng 出框`).toBeGreaterThan(109.5)
      expect(s.lng, `${s.name} lng 出框`).toBeLessThan(117.5)
      expect(s.lat, `${s.name} lat 出框`).toBeGreaterThan(20.0)
      expect(s.lat, `${s.name} lat 出框`).toBeLessThan(25.6)
    }
  })

  it('★ 生成侧不许出现简繁混录（OSM 里捞到过 `吉坳灣沙灘`、`神秘島樂園`）', () => {
    // ⚠️ 这里刻意**重写一份**正则，而不是从脚本 import：
    //    脚本是 .mjs 且 import 即执行，没法引。而且测试断言的是
    //    **"库里没有繁体"这个结果**，不是"用了哪个正则" —— 两回事。
    const TRAD = /[島樂園樓廟觀館橋區縣廣東門車馬鳥魚龍鳳陽雲電話遊覽點號樹灣灘嶼鴨鏡]/
    const gd = LANDMARK_SEEDS.filter((s) => s.id.startsWith('gd-'))
    for (const s of gd) {
      expect(TRAD.test(s.name), `${s.name} 里有繁体字`).toBe(false)
    }
  })

  it('★ 生成侧不许出现光秃秃的通用名（`动物园`、`主体建筑`）', () => {
    // 「小鸟从动物园带回来一张照片」看不出是哪儿 —— 等于没名字
    const GENERIC = new Set([
      '动物园', '植物园', '公园', '博物馆', '科技馆', '美术馆', '游乐园',
      '主题公园', '水上乐园', '海洋馆', '水族馆', '儿童乐园', '游乐场',
      '广场', '古城', '古镇', '主体建筑', '游客中心', '服务中心', '景区',
      '风景区', '度假区', '文化中心',
    ])
    const gd = LANDMARK_SEEDS.filter((s) => s.id.startsWith('gd-'))
    for (const s of gd) {
      expect(GENERIC.has(s.name), `${s.name} 是个通用名`).toBe(false)
    }
  })

  it('★ 生成侧名字不许被写了两遍（OSM 录入事故）', () => {
    const gd = LANDMARK_SEEDS.filter((s) => s.id.startsWith('gd-'))
    for (const s of gd) {
      const n = s.name.length
      if (n % 2 === 0) {
        expect(s.name.slice(0, n / 2), `${s.name} 像是被写了两遍`).not.toBe(s.name.slice(n / 2))
      }
    }
  })

  it('★ 每城上限：一线 / 新一线 ≤10、二线 ≤5（家长 09-23 定）', () => {
    // ⚠️ 这里刻意**重写一份**分档表：脚本是 .mjs 且 import 即执行，引不进来。
    //    测的是「结果没超上限」这个事实，不是"用了哪张表"。
    const CAP: Record<string, number> = {
      广州: 10, 深圳: 10, 佛山: 10, 东莞: 10,
      惠州: 5, 珠海: 5, 中山: 5, 汕头: 5,
    }
    const count = new Map<string, number>()
    for (const s of LANDMARK_SEEDS) {
      if (s.city) count.set(s.city, (count.get(s.city) ?? 0) + 1)
    }
    for (const [city, cap] of Object.entries(CAP)) {
      expect(count.get(city) ?? 0, `${city} 超过上限 ${cap}`).toBeLessThanOrEqual(cap)
    }
  })

  it('★ 评级只能是 5A / 4A，且必须有条目真的评上了', () => {
    // 挡两类：① 值写错（`5a` / `AAAAA` / `一级`）；
    //         ② 名单压根没加载上（生成时静默少一个字段，界面上一片空白）。
    const gd = LANDMARK_SEEDS.filter((s) => s.id.startsWith('gd-'))
    const rated = gd.filter((s) => s.rating)
    expect(rated.length, '一条评级都没有 —— 官方名单八成没加载上').toBeGreaterThan(0)
    for (const s of rated) {
      expect(['5A', '4A'], `${s.name} 的 rating 非法：${s.rating}`).toContain(s.rating)
    }
    expect(gd.some((s) => s.rating === '5A'), '一条 5A 都没有').toBe(true)
  })

  it('★★ 「白云山」必须是 5A —— 它是靠这份官方名单才没被误杀的', () => {
    // 白云山在 OSM 里是 `natural=peak` 且**没有 wikidata** ——
    // 只按标签闸门会被当成"一座不出名的山"删掉，而它是广州 5A 景区、羊城八景之一。
    // ➜ 这条同时守住两件事：① 名单被读进来了 ② 名单**真的参与了闸门**（不只是打了个标签）。
    //   把 `isFamous` 里那句 `ratingOf(name)` 删掉，这条立刻红。
    const baiyun = LANDMARK_SEEDS.find((s) => s.name.includes('白云山'))
    expect(baiyun, '白云山不在库里').toBeTruthy()
    expect(baiyun?.rating).toBe('5A')
  })

  /* ⚠️ 下面两条刻意**重写一份** `coreName`/后缀表，而不是从脚本 import：
     脚本是 .mjs 且 import 即执行，引不进来。测的是**结果**，不是"用了哪段代码"。 */
  const TAIL_RE = /旅游度假区|风景名胜区|文化旅游区|旅游景区|旅游区|风景区|度假区|景区|旅游|文化|国际|国家/g
  const coreOf = (s: string) =>
    s
      .replace(/[（(].*?[）)]/g, '')
      .replace(/^[\u4e00-\u9fa5]{2,3}[市省]/, '')
      .replace(TAIL_RE, '')
      .replace(/\s+/g, '')

  it('★★ 评级不许张冠李戴：同一个核心词最多一条带评级（4A 也要走守卫）', () => {
    // 家长 09-23 定的「同名不同地」守卫，**4A 那条路以前没有** ——
    // `莲花山旅游区` 在番禺（广州），而东莞/惠州/江门/汕头/深圳/揭阳/清远
    // 各有一座「莲花山」，于是全省 9 个元素都继承了番禺那个 4A。
    // ⚠️ 距离守卫挡不住它们（最近的离广州市区只有 64 km）—— 分得开的是**城市**。
    // ➜ 判据：同一个核心词下面，带评级的**最多一条**。
    const byCore = new Map<string, typeof LANDMARK_SEEDS>()
    for (const s of LANDMARK_SEEDS) {
      const c = coreOf(s.name)
      byCore.set(c, [...(byCore.get(c) ?? []), s])
    }
    for (const [c, list] of byCore) {
      const rated = list.filter((s) => s.rating)
      expect(
        rated.length,
        `「${c}」下有 ${rated.length} 条带评级：${rated.map((s) => `${s.city}·${s.name}`).join('、')}`,
      ).toBeLessThanOrEqual(1)
    }
  })

  it('★ 同一个景区在同一市里不许有重影（`白云山` / `白云山风景名胜区`）', () => {
    // 家长 09-23 定：同一个景区只留一条。
    // ⚠️ 判据必须**紧**：只认「一个核心词 + 一个景区后缀」。
    //    放宽成"任意景区套话"会把 `长隆欢乐世界` / `长隆飞鸟乐园` 也并掉 ——
    //    那是**四个不同的园**（各自的票、各自的一天），不是重影。
    const SUF =
      /^(旅游区|旅游景区|风景区|风景名胜区|旅游度假区|文化旅游区|景区|公园|森林公园|国家森林公园|地质公园|世界地质公园|水库|温泉|旅游风景区|生态旅游区)$/
    for (let i = 0; i < LANDMARK_SEEDS.length; i += 1) {
      for (let j = i + 1; j < LANDMARK_SEEDS.length; j += 1) {
        const a = LANDMARK_SEEDS[i]
        const b = LANDMARK_SEEDS[j]
        if (a.city !== b.city) continue
        const ca = coreOf(a.name)
        const cb = coreOf(b.name)
        const [long, short] = ca.length >= cb.length ? [ca, cb] : [cb, ca]
        const dup = short.length >= 3 && long.startsWith(short) && SUF.test(long.slice(short.length))
        expect(dup, `${a.city} 里「${a.name}」与「${b.name}」是同一个景区`).toBe(false)
      }
    }
  })

  it('★ 开平碉楼与村落整片只留 1 条', () => {
    // 江门那 41 条里 19 条是它拆出来的单体（铭石楼 / 瑞石楼 / 各类居庐…）。
    // 孩子飞过去看到「铭石楼」，不知道那是什么；而它们本来就同属一个世界遗产。
    const SUB = [
      '铭石楼', '瑞石楼', '升峰楼', '居安楼', '龙胜楼', '振安楼', '锦江楼', '云幻楼',
      '安庐', '官生居庐', '澜生居庐', '球安居庐', '叶生居庐', '逸农庐',
      '养闲别墅', '耀光别墅', '自力村', '马降龙古村落', '汀江圩华侨近代建筑群',
    ]
    for (const n of SUB) {
      expect(LANDMARK_SEEDS.some((s) => s.name === n), `「${n}」是开平碉楼的子楼，不该单独成条`).toBe(false)
    }
    expect(LANDMARK_SEEDS.some((s) => s.name.includes('开平碉楼')), '开平碉楼本身没了').toBe(true)
  })

  it('★ 官方 4A 名单每条都要带 city —— 没 city 就评不上级', () => {
    // 「同名不同地」守卫靠 `city`。名单里 5A 一直带 city，**4A 以前是纯字符串**
    // → 形状不一致 → 4A 那条路没有守卫（就是上面那条测试抓的病根）。
    // ➜ 这条守住「两边同形」，也守住「不许悄悄退化回纯字符串」。
    // ⚠️ 路径用 `process.cwd()`（vitest 的工作目录 = 项目根），
    //    **不要**用 `import.meta.url` —— vitest 下它不是 file: 协议，
    //    `new URL(...)` / `fileURLToPath` 会报 `The URL must be of scheme file`。
    const p = join(process.cwd(), 'scripts', 'gd-a-level.json')
    const file = JSON.parse(readFileSync(p, 'utf8')) as {
      byProvince: { 广东: { '4A': { name: string; city?: string }[] } }
    }
    const a4 = file.byProvince['广东']['4A']
    const noCity = a4.filter((x) => !x.city)
    // 查不准城市的可以留空（宁可没评级，也不要写个猜的市名 —— 猜错会张冠李戴，
    // 而且不报错），但必须**是少数**；突然多起来说明有人图省事没填。
    expect(
      noCity.length,
      `没填 city 的 4A 变多了：${noCity.map((x) => x.name).join('、')}`,
    ).toBeLessThanOrEqual(10)
    expect(a4.length - noCity.length).toBeGreaterThanOrEqual(160)
  })
})
