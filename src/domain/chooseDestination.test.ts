import { describe, expect, it } from 'vitest'
import { chooseDestination, LANDMARKS, pickByVisitCount } from './travel'
import { flightMaxKm, MIN_TRIP_KM } from './travelRange'
import { haversineKm } from './geo'
import { seededRng } from './tree'
import type { HomePoint, Landmark } from './types'

/** 深圳市民中心（与 DEFAULT_HOME_POINT 同一套坐标） */
const SZ: HomePoint = { name: '深圳', lng: 114.0579, lat: 22.5431, source: 'default' }

function within(home: HomePoint, km: number): Landmark[] {
  return LANDMARKS.filter((l) => haversineKm(home, l) <= km)
}

function asHome(l: Landmark): HomePoint {
  return { name: l.name, lng: l.lng, lat: l.lat, source: 'manual' }
}

/**
 * 找一个「麻雀极限之内一个邻居都没有」的地标。
 *
 * ★ 不写死某个地名：库一旦变密，这条守卫要能自己发现"这个分支不再可测"。
 */
function findLonely(): Landmark | undefined {
  const max = flightMaxKm('sparrow')
  return LANDMARKS.find(
    (h) =>
      !LANDMARKS.some((l) => {
        const km = haversineKm(h, l)
        return km >= MIN_TRIP_KM && km <= max
      }),
  )
}

describe('派鸟选点：距离分档已接线（2026-10-03）', () => {
  it('★ 极限之内有新地方 → near，且绝不会飞出这只鸟的极限', () => {
    const c = chooseDestination({ species: 'sparrow', home: SZ, visited: [], rng: seededRng(1) })
    expect(c.reason).toBe('near')
    expect(c.maxKm).toBe(flightMaxKm('sparrow'))
    expect(c.distanceKm).toBeLessThanOrEqual(c.maxKm)
    // 选中的必须是极限之内的点 —— 这是"按能飞多远选"的核心
    expect(within(SZ, c.maxKm).some((l) => l.id === c.dest.id)).toBe(true)
  })

  it('★★ 鸟种真的生效：同一个家，麻雀够不到的点燕子够得到', () => {
    const maxSparrow = flightMaxKm('sparrow')
    const beyond = within(SZ, flightMaxKm('swallow')).filter(
      (l) => haversineKm(SZ, l) > maxSparrow,
    )
    expect(beyond.length).toBeGreaterThan(0)

    const s = chooseDestination({ species: 'sparrow', home: SZ, visited: [], rng: seededRng(7) })
    expect(s.distanceKm).toBeLessThanOrEqual(maxSparrow)
  })

  it('★★ 极限之内的点都去过了 → repeat，不再直接判死（家长 10-03 的新规则）', () => {
    const visited = within(SZ, flightMaxKm('sparrow')).map((l) => ({
      landmarkId: l.id,
      firstAt: 0,
      visitCount: 1,
    }))
    expect(visited.length).toBeGreaterThan(0)

    const c = chooseDestination({ species: 'sparrow', home: SZ, visited, rng: seededRng(1) })
    expect(c.reason).toBe('repeat')
    expect(c.visitCount).toBeGreaterThanOrEqual(1)
    // 重复也只会在极限之内重复 —— 不许偷偷跑去更远
    expect(c.distanceKm).toBeLessThanOrEqual(c.maxKm)
  })

  it('★★ 极限之内一个点都没有 → fallback（保证主循环不会空手而归）', () => {
    // 2026-10-03 实测：643 个地标里有 119 个「麻雀 200 公里内没有邻居」
    // （可可托海、五大连池、阿尔山、扎什伦布寺…）。少了 fallback，
    // 住在那里的孩子拿到第一只鸟就一次都飞不出去。
    const lonely = findLonely()
    expect(lonely, '库里应当存在"200 公里内没有邻居"的地标，否则这条守卫失效了').toBeTruthy()
    if (!lonely) return

    const c = chooseDestination({ species: 'sparrow', home: asHome(lonely), visited: [], rng: seededRng(1) })
    expect(c.reason).toBe('fallback')
    expect(c.dest.id).toBeTruthy()
  })

  it('★ 家没设置 / 不合法时退回深圳，不会算出 0 公里', () => {
    const c = chooseDestination({ species: 'sparrow', home: null, visited: [], rng: seededRng(1) })
    expect(c.reason).toBe('near')
    expect(c.distanceKm).toBeGreaterThan(0)
  })
})

describe('去过的地方 → 降权（不是排除）', () => {
  it('★★ 去过越多，越难再被挑中', () => {
    const items = [{ id: 'fresh' }, { id: 'stale' }]
    const counts: Record<string, number> = { fresh: 0, stale: 9 }
    let fresh = 0
    for (let seed = 0; seed < 200; seed += 1) {
      const got = pickByVisitCount(items, (id) => counts[id] ?? 0, seededRng(seed))
      if (got?.id === 'fresh') fresh += 1
    }
    // 权重 1 : 1/10 → 期望约 182/200。留足余量，只要求"明显偏向没去过的"
    expect(fresh).toBeGreaterThan(150)
  })

  it('★ 没去过的权重最大（次数缺省按 0 算）', () => {
    const items = [{ id: 'a' }, { id: 'b' }]
    let a = 0
    for (let seed = 0; seed < 200; seed += 1) {
      const got = pickByVisitCount(items, () => 0, seededRng(seed))
      if (got?.id === 'a') a += 1
    }
    // 完全没去过 → 两者等权 → 大致各一半
    expect(a).toBeGreaterThan(60)
    expect(a).toBeLessThan(140)
  })

  it('★ 空列表返回 undefined，不抛', () => {
    expect(pickByVisitCount([], () => 0, seededRng(1))).toBeUndefined()
  })
})
/* ============================================================
   ★★ 家长定的距离要求 —— 用**真实地标库**钉住
   ============================================================ */

describe('海口够不够得到海南（10-10 家长定）', () => {
  it('★★ 「有海南就行了」—— 海口孩子必须够得到海南的地标', () => {
    /*
      家长 2026-10-10：「不需要海口的呀。有海南就行了。
                        把最小鸟路径拉远 不就可以到海南其他地方？」

      背景：海口自己那 5 个地标全被入库口径筛进 parked（`4A-地方知名`），
      库里海南剩 9 个、全在岛的南半部（三亚 / 陵水 / 保亭）。
      极限 200 公里时只够得着 3 个（163 / 186 / 191），
      另外 6 个是 203–223 公里 —— 只差 3～23 公里。
      阶梯第 3 格提到 250 之后 9 个全部可达。

      ⚠️ 这条读的是**真实库**，所以它同时是"数据变了"的哨兵：
        哪天有人往海南加一个离海口很远的地标（比如三沙），它会红。
        那时先分辨是**数据变了**还是**极限被改小了** —— 别直接改数字。
    */
    const HAIKOU: HomePoint = { name: '海口', lng: 110.1999, lat: 20.0444, source: 'manual' }
    const max = flightMaxKm('sparrow')
    const hainan = LANDMARKS.filter((l) => l.province === '海南')
    expect(hainan.length, '库里一个海南地标都没有 —— 判据写错了').toBeGreaterThan(0)

    const missing = hainan.filter((l) => haversineKm(HAIKOU, l) > max)
    expect(
      missing.map((l) => `${l.name} ${haversineKm(HAIKOU, l)}km`),
      `海口够不到这些海南地标（麻雀极限 ${max}km）—— ` +
        '要么极限被改小了，要么库里新加了离海口很远的地标',
    ).toEqual([])
  })
})
