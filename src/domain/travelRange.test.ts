import { describe, expect, it } from 'vitest'
import {
  BEYOND_ALL_KM,
  flightMaxKm,
  isBirdExhausted,
  isRadiusExhausted,
  pickByRange,
  RADIUS_LADDER_KM,
  radiusLabel,
  rangeLadder,
  type RangePoint,
} from './travelRange'
import { BIRD_SPECIES } from './pets'
import { seededRng } from './tree'

/** 家：深圳市民中心（与 DEFAULT_HOME_POINT 同一套坐标） */
const HOME = { lng: 114.0579, lat: 22.5431 }

/**
 * 造一个「离家约 km 公里」的点。
 *
 * 沿正北方向放：纬度每 1 度约 111.19 公里（子午线），
 * 所以 km / 111.19 就是纬度偏移。这样距离是**可算的**，
 * 测试里不用去猜 haversine 的结果。
 */
function atKm(id: string, km: number): RangePoint {
  return { id, lng: HOME.lng, lat: HOME.lat + km / 111.19 }
}

/** 按解锁顺序排列的鸟 —— 「距离从小到大」这条要按这个顺序验 */
const BIRDS_IN_ORDER = [...BIRD_SPECIES]
  .sort((a, b) => a.unlockLevel - b.unlockLevel)
  .map((s) => s.id)

describe('半径阶梯', () => {
  it('是倍增的，而且从近到远严格递增', () => {
    const finite = RADIUS_LADDER_KM.filter((k) => Number.isFinite(k))
    for (let i = 1; i < finite.length; i += 1) {
      expect(finite[i]).toBeGreaterThan(finite[i - 1])
    }
    // 最小一格必须够小，才能留住「就在家门口」那一档
    expect(RADIUS_LADDER_KM[0]).toBeLessThanOrEqual(25)
    // 最后一格是「全世界」
    expect(RADIUS_LADDER_KM[RADIUS_LADDER_KM.length - 1]).toBe(Infinity)
  })

  it('★ 鸟的顺序必须与 BIRD_SPECIES 的解锁顺序一致', () => {
    // 这条是防漂移：travelRange.ts 故意不 import pets.ts（会绕成循环），
    // 所以顺序在两边各写了一次 —— 这个断言就是那条"同一份判定只许有一处"
    // 的替代守卫：写歪了这里立刻红。
    expect(BIRDS_IN_ORDER).toEqual([
      'sparrow',
      'swallow',
      'oriole',
      'dove',
      'magpie',
      'bluebird',
      'crane',
      'phoenix',
    ])
  })

  it('★★ 每只鸟的极限距离都比上一只远（距离从小到大）', () => {
    for (let i = 1; i < BIRDS_IN_ORDER.length; i += 1) {
      expect(flightMaxKm(BIRDS_IN_ORDER[i])).toBeGreaterThan(
        flightMaxKm(BIRDS_IN_ORDER[i - 1]),
      )
    }
  })

  it('麻雀只能到 50 公里，凤凰没有上限', () => {
    expect(flightMaxKm('sparrow')).toBe(50)
    expect(rangeLadder('sparrow')).toEqual([25, 50])
    expect(flightMaxKm('phoenix')).toBe(Infinity)
    expect(rangeLadder('phoenix')).toEqual([...RADIUS_LADDER_KM])
  })

  it('半径能说成孩子听得懂的话', () => {
    expect(radiusLabel(25)).toBe('就在家门口')
    expect(radiusLabel(50)).toBe('附近')
    expect(radiusLabel(100)).toBe('本市和邻市')
    expect(radiusLabel(Infinity)).toBe(BEYOND_ALL_KM)
  })
})

describe('按距离挑目标点', () => {
  it('附近有点就挑附近的，不会舍近求远', () => {
    const r = pickByRange({
      points: [atKm('near', 10), atKm('far', 120)],
      home: HOME,
      species: 'sparrow',
      visited: [],
      rng: seededRng(1),
    })

    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.point.id).toBe('near')
    expect(r.rung).toBe(0) // 第一格 25 公里
    expect(r.radiusKm).toBe(25)
    expect(r.distanceKm).toBeLessThanOrEqual(25)
  })

  it('★ 这一档空着就往外扩一格', () => {
    // 麻雀的阶梯是 [25, 50]；只在 40 公里处有点
    const r = pickByRange({
      points: [atKm('mid', 40)],
      home: HOME,
      species: 'sparrow',
      visited: [],
      rng: seededRng(1),
    })

    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.point.id).toBe('mid')
    expect(r.rung).toBe(1)
    expect(r.radiusKm).toBe(50)
  })

  it('★ 这一档全去过了，也往外扩', () => {
    const r = pickByRange({
      points: [atKm('a', 10), atKm('b', 40)],
      home: HOME,
      species: 'sparrow',
      visited: ['a'],
      rng: seededRng(1),
    })

    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.point.id).toBe('b')
    expect(r.radiusKm).toBe(50)
  })

  it('★★ 极限距离之内都去过了 → exhausted，不偷偷重复', () => {
    const r = pickByRange({
      points: [atKm('a', 10), atKm('b', 40)],
      home: HOME,
      species: 'sparrow',
      visited: ['a', 'b'],
      rng: seededRng(1),
    })

    expect(r.kind).toBe('exhausted')
    if (r.kind !== 'exhausted') return
    expect(r.maxKm).toBe(50)
  })

  it('★★ 超过极限距离的点，再近也不给（麻雀够不到 60 公里）', () => {
    const r = pickByRange({
      points: [atKm('out', 60)],
      home: HOME,
      species: 'sparrow',
      visited: [],
      rng: seededRng(1),
    })

    expect(r.kind).toBe('exhausted')
  })

  it('换一只飞得远的鸟，同一个点就够得到了', () => {
    const points = [atKm('out', 60)]
    expect(pickByRange({ points, home: HOME, species: 'sparrow', visited: [], rng: seededRng(1) }).kind).toBe(
      'exhausted',
    )
    const r = pickByRange({ points, home: HOME, species: 'swallow', visited: [], rng: seededRng(1) })
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.point.id).toBe('out')
  })

  it('同一档里超过一个点，就随机挑（家长要的「大于 1 个就随机一个」）', () => {
    const points = [atKm('a', 10), atKm('b', 12), atKm('c', 14)]
    const picked = new Set<string>()
    for (let seed = 0; seed < 40; seed += 1) {
      const r = pickByRange({ points, home: HOME, species: 'sparrow', visited: [], rng: seededRng(seed) })
      if (r.kind === 'ok') picked.add(r.point.id)
    }
    // 三个都出现过 —— 说明不是永远挑第一个
    expect(picked.size).toBe(3)
  })

  it('候选数会报出来（界面要能说"附近有 6 个地方"）', () => {
    const r = pickByRange({
      points: [atKm('a', 5), atKm('b', 10), atKm('c', 300)],
      home: HOME,
      species: 'sparrow',
      visited: [],
      rng: seededRng(3),
    })
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.candidateCount).toBe(2)
  })
})

describe('★★ 「X 距离已去完」是算出来的，不是存的', () => {
  it('这一档的点全去过 → 已去完', () => {
    const points = [atKm('a', 10), atKm('b', 20)]
    expect(isRadiusExhausted(points, HOME, 25, [])).toBe(false)
    expect(isRadiusExhausted(points, HOME, 25, ['a'])).toBe(false)
    expect(isRadiusExhausted(points, HOME, 25, ['a', 'b'])).toBe(true)
  })

  it('★ 只算这一档内的点 —— 档外的去没去过不影响它', () => {
    const points = [atKm('a', 10), atKm('b', 40)]
    // 25 公里内只有 a；a 去过 → 这一档就算去完了，哪怕 b 还没去
    expect(isRadiusExhausted(points, HOME, 25, ['a'])).toBe(true)
    // 50 公里内 a、b 都在 → b 没去 → 没去完
    expect(isRadiusExhausted(points, HOME, 50, ['a'])).toBe(false)
  })

  it('★ 一个点都没有 ≠ 已去完（两件事，界面要说不同的话）', () => {
    expect(isRadiusExhausted([], HOME, 25, [])).toBe(false)
  })

  it('★★ 库里新增一个点，这一档立刻复活，而老点仍然不重复', () => {
    const before = [atKm('a', 10)]
    expect(isRadiusExhausted(before, HOME, 25, ['a'])).toBe(true)
    expect(
      pickByRange({ points: before, home: HOME, species: 'sparrow', visited: ['a'], rng: seededRng(1) })
        .kind,
    ).toBe('exhausted')

    // 旅游库更新：同一个档位里多了一个新点
    const after = [...before, atKm('new', 15)]
    expect(isRadiusExhausted(after, HOME, 25, ['a'])).toBe(false)

    const r = pickByRange({ points: after, home: HOME, species: 'sparrow', visited: ['a'], rng: seededRng(1) })
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    // 只会挑新点，绝不会把去过的 a 再挑一次
    expect(r.point.id).toBe('new')
  })

  it('isBirdExhausted：极限之内有没有新点', () => {
    const points = [atKm('a', 10), atKm('far', 300)]
    // 麻雀够不到 300，a 去过 → 没得去了
    expect(isBirdExhausted(points, HOME, 'sparrow', ['a'])).toBe(true)
    // 换成燕子（100 公里）也一样够不到
    expect(isBirdExhausted(points, HOME, 'swallow', ['a'])).toBe(true)
    // 鸽子（400 公里）够得到
    expect(isBirdExhausted(points, HOME, 'dove', ['a'])).toBe(false)
  })

  it('★★ 全程不写任何存档字段 —— 同样的输入永远得到同样的判定', () => {
    // 这条守的是设计意图：判定只依赖（点集 + 家 + 已到访），
    // 没有第二个来源，也就不可能出现"标记和实际对不上"。
    const points = [atKm('a', 10), atKm('b', 20)]
    const once = isRadiusExhausted(points, HOME, 25, ['a', 'b'])
    const twice = isRadiusExhausted(points, HOME, 25, ['a', 'b'])
    expect(once).toBe(true)
    expect(once).toBe(twice)
    // 传进去的数组没有被改动
    expect(points).toHaveLength(2)
  })
})
