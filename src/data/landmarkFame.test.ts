import { describe, expect, it } from 'vitest'
import { LANDMARKS } from '../domain/travel'
import { CN_SOURCE, FAME_ORDER, GD_LICENSE, LANDMARK_SEEDS, PARKED_SOURCE } from './landmarks'
import { NATIONAL_HEAT, NATIONAL_EXTRA, WORLD_FAMOUS, fameOf } from './landmarkFame'

/* ============================================================
   知名度 + 热度 的守卫
   ============================================================ */

describe('知名度（fame）', () => {
  it('★★ 名单里每个 id 都必须真的存在 —— 这条抓的是「静默降级」', () => {
    // ⚠️⚠️ 为什么这条是本文件最重要的一条：
    //    我第一版把 WORLD_FAMOUS 写成了 `gugong` / `huangshan` / `taishan` /
    //    `jiuzhaigou` / `budala` —— 而这 5 条**已被全国 A 级名录取代**
    //    （在 `landmarks-cn.json` 的 `supersedes` 里），根本不在 `LANDMARKS` 里。
    //    后果：**故宫 / 黄山 / 泰山 / 九寨沟 / 布达拉宫 静默降级成「全国知名」**，
    //    不报错、不崩、总数不变、别的测试全绿。
    //    ➜ 名单里的 id 打错一个字，就是**一条地标悄悄掉档**。
    //    ★ 这类「按 id 查表」的名单，全都要配一条「id 必须存在」的守卫。
    const ids = new Set(LANDMARKS.map((l) => l.id))
    const missW = WORLD_FAMOUS.filter((i) => !ids.has(i))
    const missN = NATIONAL_EXTRA.filter((i) => !ids.has(i))
    expect(missW, `WORLD_FAMOUS 里这些 id 在库里不存在：${missW.join(', ')}`).toEqual([])
    expect(missN, `NATIONAL_EXTRA 里这些 id 在库里不存在：${missN.join(', ')}`).toEqual([])
  })

  it('★ 名单里不许有重复 id（重复 = 有人复制粘贴时忘了改）', () => {
    expect(WORLD_FAMOUS.length).toBe(new Set(WORLD_FAMOUS).size)
    expect(NATIONAL_EXTRA.length).toBe(new Set(NATIONAL_EXTRA).size)
    // 两档之间也不许重叠 —— 重叠时 fameOf 先判世界知名，另一条就成了死代码
    const both = WORLD_FAMOUS.filter((i) => NATIONAL_EXTRA.includes(i))
    expect(both, `同时出现在两档里：${both.join(', ')}`).toEqual([])
  })

  it('★★ 全库每一条都有知名度，且只能是那三个值', () => {
    // 兜底档是「地方知名」—— 不许出现 undefined（界面上会渲染成空白）
    for (const l of LANDMARKS) {
      expect(FAME_ORDER, `${l.name} 的 fame 非法：${l.fame}`).toContain(l.fame)
    }
  })

  it('★ 三档都要有人 —— 某一档空了说明规则写死了', () => {
    // 例如把 fameOf 的兜底从「地方知名」改成「全国知名」，最后一条就会红
    // ⚠️ 作用域是**全量来源**（主库 + 移出名单），不是运行时主库：
    //    09-25 之后主库只留「5A / 全国知名 / 世界知名」，所以**「地方知名」
    //    在主库里必然是 0 条** —— 拿主库跑这条会永远红，而那不是 bug、是口径。
    //    这条要验的是「`fameOf` 还分得出三档」，必须用全量才验得到。
    const universe = [...LANDMARK_SEEDS, ...PARKED_SOURCE.items]
    for (const f of FAME_ORDER) {
      const n = universe.filter((s) => fameOf(s) === f).length
      expect(n, `「${f}」一档都没有`).toBeGreaterThan(0)
    }
    // 但世界知名必须是**少数** —— 它要是占了大半，就说明判据失效了
    const world = universe.filter((s) => fameOf(s) === '世界知名').length
    expect(world).toBeLessThan(universe.length * 0.15)
  })

  it('★★ 知名度与官方评级**必须真的分开** —— 不然这个字段就没存在意义', () => {
    // 家长要它，正是因为「知名景点」里有**评不上 A 级**的
    // （天安门广场 / 上海外滩 / 桂林山水 / 呼伦贝尔草原…）。
    // ➜ 如果「全国知名」里一条没评级的都没有，说明 fame 退化成了 rating 的别名。
    const national = LANDMARKS.filter((l) => l.fame === '全国知名')
    const unrated = national.filter((l) => !l.rating)
    expect(unrated.length, '「全国知名」里一条没评级的都没有 —— fame 退化成了 rating 的别名')
      .toBeGreaterThan(10)
    // 反过来也要有：评了 5A 却只算「地方知名」的**不该有**（5A 就是全国知名）
    expect(LANDMARKS.filter((l) => l.rating === '5A' && l.fame === '地方知名')).toEqual([])
  })

  it('★ 世界知名里必须中外都有（这是个"世界"档）', () => {
    const world = LANDMARKS.filter((l) => l.fame === '世界知名')
    expect(world.some((l) => l.country === '中国'), '世界知名里没有中国景点').toBe(true)
    expect(world.filter((l) => l.country !== '中国').length).toBeGreaterThan(20)
  })

  it('★ fameOf 是纯函数：同样输入永远同样输出，且数据里的 fame 优先', () => {
    expect(fameOf({ id: 'x' })).toBe('地方知名')
    expect(fameOf({ id: 'x', rating: '5A' })).toBe('全国知名')
    expect(fameOf({ id: 'world-日本-富士山' })).toBe('世界知名')
    expect(fameOf({ id: 'x', heat: NATIONAL_HEAT })).toBe('全国知名')
    // ⚠️ 刚好差一点不算 —— 边界不能差一个
    expect(fameOf({ id: 'x', heat: NATIONAL_HEAT - 0.1 })).toBe('地方知名')
  })
})

describe('热度（heat）—— 2026-09-24 修的那个「死字段」', () => {
  it('★★ heat 必须真的进了运行时数据（不是只躺在 JSON 里）', () => {
    // ⚠️⚠️ 这条守的是**双重 bug**：
    //    ① `toLandmark()` 压根没抄 `heat` → 就算 JSON 里有，`LANDMARKS` 也拿不到；
    //    ② `landmarks-cn.json` 生成早于代码（13:39 vs 17:10）→ 盘上那份是旧的。
    //    两个加起来的结果是：`types.ts` 声明了 `heat`、注释写着"335/357 有"，
    //    而**全库 0 条有值、全 App 0 处读它**。
    //    ➜ 只断言"数据文件里有 heat"是不够的，必须断言**运行时对象**上有。
    //
    // ★★ 判据**不许写死绝对数**：09-25 主库从 1808 收到 643 之后，
    //    原来那个 `> 1000` 必然要改 —— 而"把数字改小让它变绿"正是最坏的修法
    //    （守卫被调哑了，下次真漏抄还是绿的）。
    //    真正的不变量是：**源里带 heat 的、且留在主库里的，运行时对象上必须有。**
    //    这条与库的规模无关 —— 以后再怎么收窄都照样守得住。
    const sourceHeat = new Set(
      [...LANDMARK_SEEDS, ...PARKED_SOURCE.items]
        .filter((s) => typeof s.heat === 'number')
        .map((s) => s.id),
    )
    const should = LANDMARKS.filter((l) => sourceHeat.has(l.id))
    expect(should.length, '源里带 heat 的条目一条都没进主库 —— 主库口径八成错了')
      .toBeGreaterThan(100)
    const missing = should.filter((l) => typeof l.heat !== 'number')
    expect(missing.length, `${missing.length} 条源里有 heat 但运行时没有，例如 ${missing[0]?.name}`)
      .toBe(0)
  })

  it('★ 官方 4A 的热度必须齐全（源站全国热度榜每条都带）', () => {
    // ⚠️ **作用域必须限定在 `cn-`** —— 我第一版写成"所有 4A 都要有热度"，
    //    结果红了 39 条，全是 `gd-`（广东 OSM）那批：
    //    它们也有 `rating: '4A'`（来自 `gd-a-level.json` 人工核对过的名单），
    //    但**不是从聚合站来的**，所以压根没有 `heatScore` 这个字段。
    //    ➜ 「有评级」和「有热度」是两件事，别把整个 4A 当成一个来源。
    //
    // ★ 看的是**来源名录**，不是运行时主库：主库里只剩 24 条知名 4A 了，
    //   而这条要验的是"聚合站那 1,030 条 4A 的热度抄全了没" —— 那是源数据的事。
    const a4 = CN_SOURCE.items.filter((s) => s.rating === '4A')
    expect(a4.length).toBeGreaterThan(900)
    const missing = a4.filter((s) => typeof s.heat !== 'number')
    expect(missing.length, `${missing.length} 条官方 4A 没热度，例如 ${missing[0]?.name}`).toBe(0)
  })

  it('★ 广东 OSM 那批**不该**有热度 —— 它们不是从聚合站来的', () => {
    // 反向守卫：如果哪天有人"顺手"给 gd- 也填了 heat，说明来源被搞混了
    // ★ 同样看**来源文件**（230 条）：主库里只剩 11 条 gd- 了，拿主库跑等于没验。
    const gd = GD_LICENSE.items
    expect(gd.length).toBeGreaterThan(100)
    expect(gd.filter((s) => typeof s.heat === 'number')).toEqual([])
  })

  it('★ 5A 的热度覆盖率要如实 —— 缺是正常的（源里就只有那些），但不许掉到 0', () => {
    // 聚合站的 5A 页只有 `site-5a` 那一档带热度（实测 310/357）；
    // `site-4a` / 市中心点 / 省中心点那三档**源里就没有**，不是丢了。
    const a5 = LANDMARKS.filter((l) => l.rating === '5A')
    const withHeat = a5.filter((l) => typeof l.heat === 'number')
    expect(withHeat.length).toBeGreaterThan(280)
    expect(withHeat.length).toBeLessThan(a5.length) // 全覆盖反而说明判断错了
  })

  it('★ 热度必须落在合理区间，且不许是 0（0 会被当成"冷门"）', () => {
    for (const l of LANDMARKS.filter((x) => typeof x.heat === 'number')) {
      expect(l.heat, `${l.name} 的热度越界`).toBeGreaterThan(0)
      expect(l.heat, `${l.name} 的热度越界`).toBeLessThanOrEqual(10)
    }
  })

  it('★ 没有热度 ≠ 热度是 0 —— 缺的必须是 undefined，不是 0', () => {
    // `toLandmark` 若写成 `heat: seed.heat ?? 0`，这条会红。
    // 那 507 条没有热度的会全变成"热度 0"，排序时沉底，看着像"没人去过"。
    const noHeat = LANDMARKS.filter((l) => l.heat === 0)
    expect(noHeat, `有 ${noHeat.length} 条热度被写成了 0`).toEqual([])
  })
})
