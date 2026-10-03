import { describe, expect, it } from 'vitest'
import { DEFAULT_HOME_POINT, haversineKm, isDefaultHome, isUsablePoint, resolveHomePoint } from './geo'
import { landmarkById } from './travel'

/* ============================================================
   地理基础设施：距离 + 「家」在哪儿
   ------------------------------------------------------------
   ★ 2026-09-24 从 travelStories.test.ts 搬过来的（那里面内容数据
     换成 JSON 之后整块消失了，但这些规则跟内容无关，得留下来）。

   这一组守住三件事：**默认是深圳**、**坏坐标会被挡住**、**好坐标会用上**。
   ============================================================ */

describe('距离计算', () => {
  it('同一点的距离是 0', () => {
    expect(haversineKm(DEFAULT_HOME_POINT, DEFAULT_HOME_POINT)).toBe(0)
  })

  it('深圳 → 上海外滩约 1215 公里', () => {
    // 外滩 (121.49, 31.24)
    const km = haversineKm(DEFAULT_HOME_POINT, { lng: 121.49, lat: 31.24 })
    expect(km).toBeGreaterThan(1190)
    expect(km).toBeLessThan(1240)
  })

  it('距离是对称的（A 到 B 等于 B 到 A）', () => {
    const a = { lng: 116.3975, lat: 39.9087 }
    const b = { lng: 87.02, lat: 48.7 }
    expect(haversineKm(a, b)).toBe(haversineKm(b, a))
  })

  it('从深圳到八达岭长城约 1989 公里', () => {
    // ⚠️ 这条同时守着一个**跨模块的约定**：地标表的坐标和
    //    DEFAULT_HOME_POINT 必须在同一套坐标系（GCJ-02）里，
    //    不然距离会整体偏掉几百米到几公里 —— 而那看不出来。
    const lm = landmarkById('badaling')
    expect(lm).toBeDefined()
    const km = haversineKm(DEFAULT_HOME_POINT, { lng: lm!.lng, lat: lm!.lat })
    expect(km).toBeGreaterThan(1960)
    expect(km).toBeLessThan(2020)
  })

  it('换一个基准点，算出来的距离跟着变', () => {
    const lm = landmarkById('badaling')!
    const bj = { lng: 116.3975, lat: 39.9087 }
    const fromSZ = haversineKm(DEFAULT_HOME_POINT, lm)
    const fromBJ = haversineKm(bj, lm)
    expect(fromSZ).toBeGreaterThan(1900)
    expect(fromBJ).toBeLessThan(100)
    expect(fromSZ).not.toBe(fromBJ)
  })
})

describe('距离基准点', () => {
  it('默认基准点是深圳', () => {
    expect(DEFAULT_HOME_POINT.name).toBe('深圳')
    expect(DEFAULT_HOME_POINT.source).toBe('default')
  })

  it('没传基准点时用深圳', () => {
    expect(resolveHomePoint()).toEqual(DEFAULT_HOME_POINT)
    expect(resolveHomePoint(null)).toEqual(DEFAULT_HOME_POINT)
    expect(isDefaultHome()).toBe(true)
  })

  it('传了合法基准点就用传的', () => {
    const gz = { name: '广州', lng: 113.2644, lat: 23.1291, source: 'manual' as const }
    expect(resolveHomePoint(gz)).toEqual(gz)
    expect(isDefaultHome(gz)).toBe(false)
  })

  it('(0, 0) 会被挡住 —— 那是定位失败的经典产物，不是真的有人住那儿', () => {
    // 不挡住的话，孩子会看到「飞了 12000 公里」，而且从界面上看不出错
    expect(resolveHomePoint({ name: '?', lng: 0, lat: 0, source: 'gps' })).toEqual(
      DEFAULT_HOME_POINT,
    )
  })

  it('越界 / NaN 的坐标也会被挡住', () => {
    for (const bad of [
      { name: 'x', lng: 200, lat: 30, source: 'gps' as const },
      { name: 'x', lng: 114, lat: 999, source: 'gps' as const },
      { name: 'x', lng: Number.NaN, lat: 22, source: 'gps' as const },
      { name: 'x', lng: 114, lat: Number.POSITIVE_INFINITY, source: 'gps' as const },
    ]) {
      expect(resolveHomePoint(bad)).toEqual(DEFAULT_HOME_POINT)
      expect(isUsablePoint(bad)).toBe(false)
    }
  })

  it('isUsablePoint 认得好坐标', () => {
    expect(isUsablePoint({ lng: 114.0579, lat: 22.5431 })).toBe(true)
    expect(isUsablePoint({ lng: 2.2945, lat: 48.85822 })).toBe(true)
  })
})
