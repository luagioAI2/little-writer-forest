/* ============================================================
   地图上的飞行路线 —— 「注释里写了」≠「代码里画了」
   ------------------------------------------------------------
   ★★ 这个文件存在的唯一理由：

   2026-10-03 之前，`MapPage.tsx` 的层次注释写着
     「正在飞的小鸟（一个会摆动的小三角 + 虚线轨迹）」
   而 `flyingBirds.map(...)` 里**只画了**落点上一个圆环 + 一个三角，
   一条线都没有。紧跟在那段下面的注释还写着「从地标点向外画一条虚线」。

   这类「注释说已经做了、代码里没做」**不报错、不崩、测试全绿** ——
   同一天在这个项目里栽了**第二次**：上一次是 `travelRange.ts`
   整套距离分档写好了却零运行时调用者，而两处注释都写着
   「改成按距离分档之后……」。

   ➜ 所以这条守卫**必须真的把组件渲染出来**，去 DOM 里数那条 path。
      只测 `flightPath` 是不够的：那个函数一直都会是对的，
      问题从来不是「算错了」，而是「没人调它」。

   ⚠️ `fake-indexeddb/auto` 必须第一个 import —— `MapPage` 会连带拉进
      `db.ts`，它在模块顶层就 `new LittleWriterDb()`（和
      `SouvenirCard.test.tsx` 一个原因）。
   ============================================================ */

import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { TravelMap } from './MapPage'
import { LANDMARKS } from '../../domain/travel'
import { VIEWS, inView, makeProj } from './mapProjection'
import { DEFAULT_HOME_POINT } from '../../domain/geo'
import type { Bird, HomePoint } from '../../domain/types'

/** 一只正在飞的鸟 */
function flying(species: Bird['species'], destinationId: string): Bird {
  return {
    species,
    nickname: '小麻',
    status: 'away',
    destinationId,
    trips: 1,
    photos: 0,
    bond: 10,
    adoptedAt: 0,
    hasLetter: false,
  }
}

function draw(birds: Bird[], scope: '中国' | '世界', homePoint?: HomePoint) {
  return render(
    <TravelMap
      scope={scope}
      sprouts={[]}
      flyingBirds={birds}
      homePoint={homePoint ?? DEFAULT_HOME_POINT}
      activeLandmarkId={null}
      onPickLandmark={() => {}}
      revealed={false}
      visitedIds={new Set()}
    />,
  )
}

/** 画出来的路线（`anim-dash-route` 是虚线那一层专用的类名） */
const routes = (c: HTMLElement) => Array.from(c.querySelectorAll('path.anim-dash-route'))

/** path 里的数字，按出现顺序 */
const nums = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)

const cnProj = makeProj(VIEWS['中国'])

/** 落点在**中国档**、而且投影之后真的落在画布内的一个地标 */
const CN_DEST = LANDMARKS.find((l) => l.country === '中国' && inView(cnProj, l.lng, l.lat))
/** 一个**世界**地标（中国档里不该画它的路线） */
const WORLD_DEST = LANDMARKS.find((l) => l.country !== '中国')

describe('旅行图 · 飞行路线', () => {
  it('★★ 有一只鸟在飞，就要有一条虚线路线（这条红了 = 注释又在撒谎）', () => {
    expect(CN_DEST, '中国档里找不到一个画得出来的地标 —— 判据写错了').toBeDefined()
    const { container } = draw([flying('sparrow', CN_DEST!.id)], '中国')
    expect(
      routes(container).length,
      '小鸟在飞，但地图上一条路线都没画 —— 层次注释里写的"虚线轨迹"是假的',
    ).toBe(1)
  })

  it('★★ 路线的两端是「家」和落点 —— 起点不许画成上一个落点或别的什么地方', () => {
    const { container } = draw([flying('sparrow', CN_DEST!.id)], '中国')
    const n = nums(routes(container)[0].getAttribute('d') ?? '')
    expect(n.length, '路线 path 里的数字个数不对').toBeGreaterThanOrEqual(4)
    expect(n[0]).toBe(Number(cnProj.x(DEFAULT_HOME_POINT.lng).toFixed(1)))
    expect(n[1]).toBe(Number(cnProj.y(DEFAULT_HOME_POINT.lat).toFixed(1)))
    expect(n[n.length - 2]).toBe(Number(cnProj.x(CN_DEST!.lng).toFixed(1)))
    expect(n[n.length - 1]).toBe(Number(cnProj.y(CN_DEST!.lat).toFixed(1)))
  })

  it('★★ 落点在**另一档**的鸟，路线跟着它一起不画（否则图上多一条飞向看不见的鸟的线）', () => {
    expect(WORLD_DEST, '库里一条世界地标都没有').toBeDefined()
    const { container } = draw([flying('sparrow', WORLD_DEST!.id)], '中国')
    expect(
      routes(container).length,
      '中国档画了一条飞向世界地标的路线，而那只鸟本身是不画的',
    ).toBe(0)
  })

  it('★★ 「家」在画布外时也不画 —— 否则会是一条从地图边上插进来的线', () => {
    const paris: HomePoint = { name: '巴黎', lng: 2.3522, lat: 48.8566, source: 'manual' }
    const cn = draw([flying('sparrow', CN_DEST!.id)], '中国', paris)
    expect(routes(cn.container).length, '「家」投影到画布外了，路线不该画').toBe(0)
    // 但换到世界档，同一个"家"就在画布里了 → 路线要回来
    const world = draw([flying('sparrow', WORLD_DEST!.id)], '世界', paris)
    expect(
      routes(world.container).length,
      '世界档里巴黎是在画布内的，路线应该画出来（别把两个档的判据写成同一个）',
    ).toBe(1)
  })

  it('★ 两只鸟在飞 → 两条路线（别写成只画最后一只）', () => {
    const second = LANDMARKS.filter(
      (l) => l.country === '中国' && inView(cnProj, l.lng, l.lat) && l.id !== CN_DEST!.id,
    )[0]
    expect(second, '中国档里画得出来的地标不足两个').toBeDefined()
    const { container } = draw(
      [flying('sparrow', CN_DEST!.id), flying('dove', second!.id)],
      '中国',
    )
    expect(routes(container).length).toBe(2)
  })

  it('★ 没有鸟在飞 → 一条路线都没有（闲着的鸟不该在地图上留一条线）', () => {
    const { container } = draw([], '中国')
    expect(routes(container).length).toBe(0)
  })
})
