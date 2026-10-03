import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertLandmarks,
  checkLandmarks,
  CN_SOURCE,
  GD_LICENSE,
  LANDMARK_SEEDS,
  PARKED_SOURCE,
  SUPERSEDED_IDS,
  toLandmark,
  WORLD_SOURCE,
  type LandmarkSeed,
} from './landmarks'
import { fameOf } from './landmarkFame'
import { LANDMARKS } from '../domain/travel'
/* ★★ 「同一个景区」的判据**从 lib 引进来**（不再在测试里重写一份）——
   因为 `scripts/build-landmarks-cn.mjs` 去重用的就是这两个函数。
   两处各写一份 → 生成说没有重影、测试说有，而两边都不报错（MEMORY §四）。 */
import { coreScenicName, sameScenicArea } from '../../scripts/lib/a-level-names.mjs'
/* 手工那份与广东那份的**原始** id —— `supersedes` 必须能在里面找到对应条目。
   ⚠️ 不能拿 `LANDMARK_SEEDS` 去查：被取代的已经被滤掉了，那就成了自己查自己。 */
import handRaw from './landmarks.json'
import gdRaw from './landmarks-gd.json'

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
    // ⚠️ 这里刻意**重写一份**分档表：`fetch-landmarks.mjs` 是 .mjs 且 import 即执行，引不进来。
    //    测的是「结果没超上限」这个事实，不是"用了哪张表"。
    //
    // ★★ 09-24 收窄了作用域：**只查 OSM 广东那批（`gd-`）**。
    //    原因：这个上限是 `fetch-landmarks.mjs` 生成广东那 230 条时的**脚本规则**
    //    （那张 `CITY_CAP` 表还在那个脚本里，仍然生效）。
    //    ⚠️ 而「库里每城最多几条」这条**总口径已于 09-24 作废** ——
    //       全国名录是「5A 全保留 + 4A 按知名度取前 1000」，**不设每城上限**
    //       （广州因此有 37 条：5A + 全国知名的 4A）。
    //       所以这条测试不能再拿 `LANDMARK_SEEDS` 全量去查 —— 那是在查一条已经没了的规矩。
    const CAP: Record<string, number> = {
      广州: 10, 深圳: 10, 佛山: 10, 东莞: 10,
      惠州: 5, 珠海: 5, 中山: 5, 汕头: 5,
    }
    const count = new Map<string, number>()
    for (const s of LANDMARK_SEEDS.filter((x) => x.id.startsWith('gd-'))) {
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

  /* ★★ 下面两条用的 `coreScenicName` / `sameScenicArea` **从 lib 引进来**，不再各写一份。
     ⚠️ 以前是"测试里重写一份正则"（理由是脚本 .mjs 引不进来），
        但 09-24 加了 `scripts/lib/a-level-names.mjs`（纯模块、可 import）——
        而且**生成侧去重用的就是这两个函数**。
        两处各写一份的后果是：生成侧按 A 规则去重、守卫按 B 规则检查
        → "生成说没有重影、测试说有"，而两边**都不报错**（MEMORY §四）。 */

  it('★★ 评级不许张冠李戴：同一个核心词最多一条带评级（4A 也要走守卫）', () => {
    // 家长 09-23 定的「同名不同地」守卫，**4A 那条路以前没有** ——
    // `莲花山旅游区` 在番禺（广州），而东莞/惠州/江门/汕头/深圳/揭阳/清远
    // 各有一座「莲花山」，于是全省 9 个元素都继承了番禺那个 4A。
    // ⚠️ 距离守卫挡不住它们（最近的离广州市区只有 64 km）—— 分得开的是**城市**。
    // ➜ 判据：同一个核心词下面，带评级的**最多一条**。
    //
    // ★★ 09-24 把分组从「全库」收紧到「**省**」：全库会把
    //    `重庆·桃花源旅游景区` 与 `湖南·桃花源旅游区` 判成重影 ——
    //    而那是**两个真实存在的 5A**（酉阳 / 常德，相距约 250 km）。
    //    「同名不同地」只要跨了省就不再可疑；同一省内撞核心名才是要查的。
    const byCore = new Map<string, typeof LANDMARK_SEEDS>()
    for (const s of LANDMARK_SEEDS) {
      const c = `${s.province}\u0000${coreScenicName(s.name)}`
      byCore.set(c, [...(byCore.get(c) ?? []), s])
    }
    for (const [c, list] of byCore) {
      const rated = list.filter((s) => s.rating)
      expect(
        rated.length,
        `「${c.replace('\u0000', ' / ')}」下有 ${rated.length} 条带评级：${rated.map((s) => `${s.city}·${s.name}`).join('、')}`,
      ).toBeLessThanOrEqual(1)
    }
  })

  it('★ 同一个景区在同一市里不许有重影（`白云山` / `白云山风景名胜区`）', () => {
    // 家长 09-23 定：同一个景区只留一条。
    // ⚠️ 判据必须**紧**：只认「一个核心词 + 一个景区后缀」。
    //    放宽成"任意景区套话"会把 `长隆欢乐世界` / `长隆飞鸟乐园` 也并掉 ——
    //    那是**四个不同的园**（各自的票、各自的一天），不是重影。
    // ⚠️ 加 `!==` 短路只是省时间；判据本身在 `sameScenicArea` 里。
    // ⚠️ 作用域：**同市**才算「同一个地方」；缺 `city` 的退到**同省**
    //    （与 `sameScenicArea` 的使用口径一致，见上面那段「跨省就不可疑」）。
    // ★★ 2026-09-24 并进世界景点后暴露的 bug：世界条目的 `city` 全是 `undefined`，
    //    于是 `a.city !== b.city` 两边都是 undefined、判为相等 → **所有世界条目被两两比较**，
    //    土耳其与乌克兰那两座不同的「圣索菲亚大教堂」当场被判成重影。
    //    ⚠️ 这类错误的特点是**报错信息里出现 `undefined 里`** —— 那说明作用域根本没生效。
    const scopeOf = (s: LandmarkSeed) => s.city ?? s.province
    for (let i = 0; i < LANDMARK_SEEDS.length; i += 1) {
      for (let j = i + 1; j < LANDMARK_SEEDS.length; j += 1) {
        const a = LANDMARK_SEEDS[i]
        const b = LANDMARK_SEEDS[j]
        if (scopeOf(a) !== scopeOf(b)) continue
        expect(sameScenicArea(a.name, b.name), `${scopeOf(a)} 里「${a.name}」与「${b.name}」是同一个景区`).toBe(false)
      }
    }
  })

  it('★★ 全国名录记的 `supersedes` 必须**真的**落在手工/GD 那两份文件里', () => {
    // 挡的是**静默失效**：`landmarks-gd.json` 重跑一次，id 可能变
    // （OSM 元素 id 变了、或者那条被删了）。那时 `supersedes` 里对应的 id
    // 就指向空气 —— 过滤照常执行、**不报错**，而被取代的那条又冒出来了
    // （同一个景区两条）。所以这里逐条要求"能对上"。
    const ids = new Set<string>([
      ...(handRaw as LandmarkSeed[]).map((s) => s.id),
      ...(gdRaw as { items: LandmarkSeed[] }).items.map((s) => s.id),
    ])
    for (const id of SUPERSEDED_IDS) {
      expect(ids.has(id), `supersedes 里的「${id}」在手工/GD 两份数据里都不存在 —— 名单过期了，重跑 build-landmarks-cn.mjs`).toBe(true)
    }
    // 反向：被取代的不许还留在库里
    for (const id of SUPERSEDED_IDS) {
      expect(LANDMARK_SEEDS.some((s) => s.id === id), `被取代的「${id}」还在库里`).toBe(false)
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

/* ============================================================
   全国 A 级名录（官方）
   ============================================================ */

describe('全国 A 级名录（官方）', () => {
  /* ★★ 这一屏验的是**来源名录**（抬头 / 规模 / 覆盖省份 / 名字质量），
     不是运行时主库。
     ⚠️ 原来写的是 `LANDMARK_SEEDS.filter(id.startsWith('cn-'))` —— 09-25
        主库按「只留 5A / 全国知名 / 世界知名」收窄之后，那个只剩 381 条，
        于是「5A 全保留、4A ≤1000」「覆盖 31 个省级行政区」这些**关于名录的**
        断言会全部误报。
     ⚠️ 修法不是把数字改小（那等于把守卫调哑），而是**换成它本来该看的对象**：
        `CN_SOURCE.items` —— 目录里那份没被动过的 1,348 条。 */
  const cn = CN_SOURCE.items

  it('★★ 抬头必须还在 —— 交代了出处、坐标精度、生成方式', () => {
    // 抬头丢了 = 一份"不知道哪来的、也不知道坐标准不准"的数据。
    // 有人重跑 `scripts/build-landmarks-cn.mjs` 时把抬头写掉，这条会红。
    expect(CN_SOURCE.source).toContain('文化和旅游部')
    expect(CN_SOURCE.count).toBe(CN_SOURCE.items.length)
    expect(CN_SOURCE.asOf).toBeTruthy()
    // 坐标精度这件事必须写在数据里 —— 21 条是"中心点"凑的，误差可达几十公里
    expect(CN_SOURCE.note).toContain('坐标')
  })

  it('★ 规模与评级：5A 全保留、4A ≤1000，id 带 cn- 前缀', () => {
    expect(cn.length).toBeGreaterThan(1300)
    const a5 = cn.filter((s) => s.rating === '5A')
    const a4 = cn.filter((s) => s.rating === '4A')
    // 5A 是官方名录，**全保留**（家长 09-24 定）
    expect(a5.length).toBe(357)
    // 4A 按知名度取前 1000，去重后略少
    expect(a4.length).toBeLessThanOrEqual(1000)
    expect(a4.length).toBeGreaterThan(950)
    for (const s of cn) expect(['5A', '4A']).toContain(s.rating)
  })

  it('★ 覆盖 31 个省级行政区，且**不含**港澳台（聚合站没有这三地的 A 级名单）', () => {
    const provs = new Set(cn.map((s) => s.province))
    expect(provs.size).toBe(31)
    for (const p of ['中国香港', '中国澳门', '中国台湾']) {
      expect(provs.has(p), `${p} 不该出现在 A 级名录里`).toBe(false)
    }
    // 湖南必须有 12 条 5A —— 家长最初问的就是"为啥湖南只有一个张家界"
    expect(cn.filter((s) => s.province === '湖南' && s.rating === '5A').length).toBe(12)
  })

  it('★ 名字不许带「景区」以外的套话尾巴当主体（不许光秃秃的通用名）', () => {
    const GENERIC = new Set(['景区', '风景区', '旅游区', '公园', '博物馆', '广场'])
    for (const s of cn) expect(GENERIC.has(s.name), `${s.name} 是个通用名`).toBe(false)
  })
})

/* ============================================================
   世界景点（DBpedia CC BY-SA ＋ Wikimedia Commons ＋ 补坐标用的 OSM/ODbL）
   ============================================================ */

describe('世界景点数据（CC BY-SA / Wikimedia / 部分 ODbL）', () => {
  it('★★ 许可抬头必须还在 —— 数据被复制走时许可要跟着走', () => {
    // 跟广东那份同一个道理：抬头丢了 = 我们分发了一份**没有许可声明的**数据。
    // ⚠️ 这份比广东那份更麻烦：它**同时**沾三个来源 ——
    //    DBpedia（CC BY-SA）、Wikimedia Commons（图片，各自授权）、
    //    以及补坐标用的 OSM（ODbL）。少写一个就是少署一个名。
    //    有人重跑 `scripts/fetch-world-landmarks.mjs` 把抬头写掉，这条会红。
    expect(WORLD_SOURCE.license).toContain('CC BY-SA')
    expect(WORLD_SOURCE.attribution).toContain('DBpedia')
    expect(WORLD_SOURCE.attribution).toContain('OpenStreetMap')
    expect(WORLD_SOURCE.attribution).toContain('Wikimedia')
    expect(WORLD_SOURCE.count).toBe(WORLD_SOURCE.items.length)
  })

  it('★ 世界条目：id 带 world- 前缀、省=国家、没有 city', () => {
    // ⚠️ 世界条目**故意没有 `city`** —— 数据源就没有"市"这一层。
    //    `province` 存的是**国家名**（见 types.ts 里 `Landmark.province` 的注释：
    //    「国外条目填国家名」）。所以按 province 分组的代码会把世界条目按国家分组，
    //    这是**对的**，不是 bug。
    //    ⚠️ 但正因为 `city` 是 undefined，任何 `a.city !== b.city` 式的比较
    //       都会两边都 undefined、判为相等 —— 见下面「同一个景区」那条的注释。
    const w = LANDMARK_SEEDS.filter((s) => s.id.startsWith('world-'))
    expect(w.length).toBeGreaterThan(200)
    for (const s of w) {
      expect(s.province, `${s.name} 没填国家`).toBeTruthy()
      expect(s.country, `${s.name} 的 country 与 province 不一致`).toBe(s.province)
      expect(s.city, `${s.name} 不该有 city`).toBeUndefined()
    }
  })

  it('★ 覆盖国家数 ≥100，且不许混进中国', () => {
    // 港澳台已经在手工那份（`landmarks.json`）里了 —— 世界这批**不许**再收一遍
    // （`scripts/world-landmarks-seed.mjs` 抬头里写了这条）。
    const w = LANDMARK_SEEDS.filter((s) => s.id.startsWith('world-'))
    const countries = new Set(w.map((s) => s.province))
    expect(countries.size).toBeGreaterThanOrEqual(100)
    expect(countries.has('中国'), '世界景点里混进了中国').toBe(false)
  })

  it('★★ 世界坐标必须是真数字，且不在地图原点 (0,0)', () => {
    // (0,0) 在几内亚湾 —— 它是"抓取失败留下的默认值"，不是景点。
    // ⚠️ 这类坏数据在**中国地图上根本看不见**（投影后跑到画布外），
    //    所以只有在这里才卡得住。
    const w = LANDMARK_SEEDS.filter((s) => s.id.startsWith('world-'))
    for (const s of w) {
      expect(Number.isFinite(s.lng), `${s.name} lng 不是数字`).toBe(true)
      expect(Number.isFinite(s.lat), `${s.name} lat 不是数字`).toBe(true)
      expect(s.lng === 0 && s.lat === 0, `${s.name} 坐标是 (0,0)`).toBe(false)
      expect(Math.abs(s.lat), `${s.name} 纬度越界`).toBeLessThanOrEqual(90)
      expect(Math.abs(s.lng), `${s.name} 经度越界`).toBeLessThanOrEqual(180)
    }
  })

  it('★ 世界景点的名字必须是简体（DBpedia 的中文名是繁体，要转）', () => {
    // ⚠️ DBpedia 的 `zh` 标签是**繁体**（艾菲爾鐵塔 / 羅馬鬥獸場）——
    //    `fetch-world-landmarks.mjs` 用 opencc-js 转过一遍。
    //    这条挡的是"哪天有人重跑脚本忘了转"。
    const TRAD = /[鐵羅馬場館觀橋區縣門車鳥魚龍鳳陽雲電話遊覽點號樹灣灘嶼島樂園樓廟]/
    const w = LANDMARK_SEEDS.filter((s) => s.id.startsWith('world-'))
    for (const s of w) {
      expect(TRAD.test(s.name), `${s.name} 里有繁体字`).toBe(false)
    }
  })

  it('★ 每个世界景点都要有一句给孩子看的话（blurb）和合法的 scene', () => {
    // 「小鸟从富士山带回来一张照片」—— 没那句话就只剩个地名。
    const OK = new Set(['mountain', 'water', 'city', 'desert', 'forest', 'snow', 'temple', 'coast', 'grass', 'cave'])
    const w = LANDMARK_SEEDS.filter((s) => s.id.startsWith('world-'))
    for (const s of w) {
      expect(s.blurb.length, `${s.name} 没有简介`).toBeGreaterThan(0)
      expect(OK.has(s.scene), `${s.name} 的 scene 非法：${s.scene}`).toBe(true)
    }
  })

  it('★ 世界景点不许有重名（同名就是同一处，只留一条）', () => {
    const w = LANDMARK_SEEDS.filter((s) => s.id.startsWith('world-'))
    const byName = new Map<string, string[]>()
    for (const s of w) byName.set(s.name, [...(byName.get(s.name) ?? []), s.province])
    const dups = [...byName.entries()].filter(([, v]) => v.length > 1)
    expect(dups.map(([n, v]) => `${n}（${v.join(' / ')}）`)).toEqual([])
  })
})

/* ============================================================
   ★★ 主库口径 —— 只留「5A / 全国知名 / 世界知名」
   ============================================================
   家长 2026-09-25：
     「帮我把 4A 的先单独出来。然后只保留 5A、知名点、世界知名的。」

   判定**只有一份**（`fameOf()`；生成侧 `scripts/park-landmarks.ts`），
   加载器按 `landmarks-4a.json` 机械地滤。这里守四件事：

     · 库里**没有**漏网的地方知名
     · 移出名单里**没有误伤** —— 够格的被移出去 = 景点静默少了
     · 两边不重叠
     · 世界 / 手工那两批**一条不少**

   ⚠️ 第一条和第二条是**一对**，缺一不可：
      只守"库里没有地方知名"的话，生成脚本哪天把保留集和移出集判反了，
      库会变成 1165 条，而第一条**照样绿**（1165 条确实都不是地方知名）。
   ============================================================ */
describe('★★ 主库口径（家长 09-25 定）', () => {
  it('★ 库里每条都必须是 5A 或知名 —— 不许漏进「地方知名」', () => {
    const bad = LANDMARKS.filter((l) => l.rating !== '5A' && l.fame === '地方知名')
    expect(
      bad.map((l) => `${l.id}（${l.rating ?? '无评级'}）`),
      '这些条目不在口径内，却还在主库里',
    ).toEqual([])
  })

  it('★★ 移出名单不许误伤 —— 判反了这条会红（而上面那条照样绿）', () => {
    const wrong = PARKED_SOURCE.items.filter((s) => fameOf(s) !== '地方知名')
    expect(
      wrong.map((s) => `${s.id}（${s.rating ?? '无评级'}）`),
      '这些够格留在主库，却被移出去了',
    ).toEqual([])
  })

  it('★★ 两边不许有交集 —— 有交集说明同一条被两处各管一半', () => {
    const kept = new Set(LANDMARKS.map((l) => l.id))
    const both = PARKED_SOURCE.items.filter((s) => kept.has(s.id))
    expect(both.map((s) => s.id), '既在主库又在移出名单里').toEqual([])
  })

  it('★★ 世界景点一条都不许少 —— 这是「这一刀砍歪了」最直观的探针', () => {
    // 世界 231 条天然 ≥「全国知名」（`fameOf` 里 `world-` 前缀直接放行），
    // 所以收窄口径**不该动它们一条**。少了就说明判据写错了。
    const world = LANDMARKS.filter((l) => l.country !== '中国')
    expect(world.length, `世界景点少了 ${WORLD_SOURCE.count - world.length} 条`)
      .toBe(WORLD_SOURCE.count)
  })

  it('★★ 手工精选也不许少 —— 除了被官方名录取代的那几条', () => {
    // ⚠️ 不能直接断言"35 条都在"：手工那份里有一批已被全国 A 级名录取代，
    //    本来就该被 `supersedes` 滤掉（那是另一条规矩，09-24 定的）。
    //    所以要**减掉被取代的**再比 —— 否则这条会误报成"口径误伤"。
    const sup = new Set(CN_SOURCE.supersedes)
    const shouldBeThere = (handRaw as LandmarkSeed[])
      .filter((s) => !sup.has(s.id))
      .map((s) => s.id)
    const keptIds = new Set(LANDMARKS.map((l) => l.id))
    const missing = shouldBeThere.filter((id) => !keptIds.has(id))
    expect(missing, `手工精选里这些被口径误伤：${missing.join(', ')}`).toEqual([])
  })

  it('★ 移出名单的抬头与条数必须自洽', () => {
    // 抬头是给"把这份数据复制走的人"看的：`count` 跟 `items` 对不上 = 被手改过。
    expect(PARKED_SOURCE.count).toBe(PARKED_SOURCE.items.length)
    expect(PARKED_SOURCE.rule).toContain('地方知名')
    expect(PARKED_SOURCE.composition['4A-地方知名'] + PARKED_SOURCE.composition['无评级'])
      .toBe(PARKED_SOURCE.items.length)
    // 每条都要有"为什么在外面" —— 没有就没法复核
    const noWhy = PARKED_SOURCE.items.filter((s) => !s.parkedWhy)
    expect(noWhy.length, `${noWhy.length} 条没有 parkedWhy`).toBe(0)
  })
})
