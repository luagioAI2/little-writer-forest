import { describe, expect, it } from 'vitest'
import {
  LANDMARKS,
  landmarkById,
  mapProgress,
  pickDestination,
  plantSeeds,
  sproutAt,
  sproutCount,
  sproutedIds,
} from './travel'
import { seededRng } from './tree'
import type { Sprout } from './types'

/** 造一个"整张地图都发过芽"的状态 */
function allSprouted(stage: number): Sprout[] {
  return LANDMARKS.map((l) => ({ landmarkId: l.id, at: 0, stage }))
}

describe('树种落地（树上掉的树种）', () => {
  it('每颗树种都落到一个地标上，且三颗落在三个不同的地方', () => {
    const { sprouts, planted } = plantSeeds([], 3, 1000, seededRng(2026))

    expect(planted).toHaveLength(3)
    expect(sprouts).toHaveLength(3)
    expect(new Set(planted.map((p) => p.landmarkId)).size).toBe(3)

    // 每一处都真的发芽了，而且名字和地标表对得上（界面要念给孩子听）
    for (const p of planted) {
      expect(sprouts.find((s) => s.landmarkId === p.landmarkId)?.stage).toBe(1)
      expect(landmarkById(p.landmarkId)?.name).toBe(p.name)
    }
  })

  it('优先挑还没发过芽的地方', () => {
    const used: Sprout[] = LANDMARKS.slice(0, LANDMARKS.length - 1).map((l) => ({
      landmarkId: l.id,
      at: 0,
      stage: 3,
    }))
    const { planted } = plantSeeds(used, 1, 1000, seededRng(5))
    // 只剩最后一个地方没发过芽，树种必须落在那儿
    expect(planted[0].landmarkId).toBe(LANDMARKS[LANDMARKS.length - 1].id)
  })

  it('地图全点亮后，树种让最矮的地方往上长一级，不会两颗砸在同一处', () => {
    const { sprouts, planted } = plantSeeds(allSprouted(1), 2, 2000, seededRng(7))

    expect(planted).toHaveLength(2)
    // 没有新增地标，但有两处被种高了 —— 两颗树种都算数
    expect(sproutCount(sprouts)).toBe(LANDMARKS.length)
    expect(sprouts.filter((s) => s.stage > 1)).toHaveLength(2)
    expect(new Set(planted.map((p) => p.landmarkId)).size).toBe(2)
  })

  it('地图已经长满 3 级时，树种不会把数据写坏', () => {
    const full = allSprouted(3)
    const { sprouts, planted } = plantSeeds(full, 2, 3000, seededRng(9))

    expect(planted).toHaveLength(2)
    expect(sprouts).toHaveLength(LANDMARKS.length)
    expect(sprouts.every((s) => s.stage === 3)).toBe(true)
    // 满级不再改动时间戳
    expect(sprouts.every((s) => s.at === 0)).toBe(true)
  })

  it('0 颗树种时原样返回（收树大多只是收金币，不该多写一次库）', () => {
    const before: Sprout[] = [{ landmarkId: 'xihu', at: 1, stage: 2 }]
    const { sprouts, planted } = plantSeeds(before, 0, 4000, seededRng(1))

    expect(planted).toEqual([])
    expect(sprouts).toBe(before)
  })
})

describe('发芽与地图进度', () => {
  it('同一处反复发芽会升级，最高 3 级', () => {
    let s = sproutAt([], 'xihu', 1, 0)
    expect(s[0].stage).toBe(1)

    s = sproutAt(s, 'xihu', 2, 0)
    expect(s[0].stage).toBe(2)

    s = sproutAt(s, 'xihu', 3, 0)
    expect(s[0].stage).toBe(3)
    expect(s[0].at).toBe(3)

    // 满级后再种不动数据
    const capped = sproutAt(s, 'xihu', 4, 0)
    expect(capped[0].stage).toBe(3)
    expect(capped[0].at).toBe(3)
  })

  it('森林够大（≥8 棵）时一次连跳两级', () => {
    const first = sproutAt([], 'xihu', 1, 8)
    expect(first[0].stage).toBe(1)

    const second = sproutAt(first, 'xihu', 2, 8)
    expect(second[0].stage).toBe(3)
  })

  it('树上掉的树种没有 byBird', () => {
    const s = sproutAt([], 'xihu', 1, 0)
    expect(s[0].byBird).toBeUndefined()
    // 小鸟带回来的才有
    const fromBird = sproutAt([], 'taishan', 1, 0, 'swallow')
    expect(fromBird[0].byBird).toBe('swallow')
  })

  it('sproutCount 去重计数，mapProgress 按去重后的数算', () => {
    const s: Sprout[] = [
      { landmarkId: 'xihu', at: 1, stage: 1 },
      { landmarkId: 'xihu', at: 2, stage: 2 },
      { landmarkId: 'taishan', at: 3, stage: 1 },
    ]
    expect(sproutedIds(s)).toEqual(['xihu', 'taishan'])
    expect(sproutCount(s)).toBe(2)

    const p = mapProgress(s)
    expect(p.lit).toBe(2)
    expect(p.total).toBe(LANDMARKS.length)
    expect(p.percent).toBe(Math.round((2 / LANDMARKS.length) * 100))
  })
})

describe('挑旅行目的地', () => {
  it('不会去已经去过的，也不会原地不动', () => {
    const rng = seededRng(3)
    const exclude = LANDMARKS.slice(0, 20).map((l) => l.id)
    const from = LANDMARKS[20].id

    for (let i = 0; i < 50; i++) {
      const dest = pickDestination({ from, exclude, rng })
      expect(exclude).not.toContain(dest.id)
      expect(dest.id).not.toBe(from)
    }
  })

  it('所有地方都去过之后，仍然能挑出一个目的地（不会卡死）', () => {
    const dest = pickDestination({
      exclude: LANDMARKS.map((l) => l.id),
      rng: seededRng(11),
    })
    expect(LANDMARKS.some((l) => l.id === dest.id)).toBe(true)
  })
})
