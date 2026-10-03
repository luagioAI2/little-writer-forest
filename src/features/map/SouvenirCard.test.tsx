/* ============================================================
   相册里的「示意图」角标 —— 界面**有没有在撒谎**
   ------------------------------------------------------------
   2026-09-26 家长定：默认图里标了 `scene` 的（"搜不到本体、拿同地带的
   照片顶上"）要在界面上**明说**，不许当成实景照片给孩子看。

   ★★ 为什么要**真的渲染**，而不是只断言 `souvenir.match`：
       `pets.test.ts` 那条已经证明了"数据抄到位"，
       但那证明不了**界面会去读它**。
       "JSON 里多了个字段"和"孩子能看见角标"长得一模一样 ——
       中间少一行 JSX，测试照样全绿。

   ★ 三种情况**各自的结果都不一样**，所以三条都要钉：
     · `'scene'`   → 显示「示意图」
     · `'place'`   → **不**显示（它是真的那个地方）
     · `undefined` → **不**显示（家长手挑的图没声称过，
                     把"没写"显示成"顶替图"就是替他声称）

   ⚠️ `fake-indexeddb/auto` 必须第一个 import —— MapPage 会连带拉进
      `db.ts`，它在模块顶层就 `new LittleWriterDb()`。
   ============================================================ */

import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SouvenirCard } from './MapPage'
import type { TravelSouvenir } from '../../domain/types'

/** 一张"拍照"纪念品。`match` 由调用方给 —— 这正是被测的东西 */
function photoSouvenir(match?: TravelSouvenir['match']): TravelSouvenir {
  return {
    id: 'sparrow-1',
    contentId: 'default:world-丹麦-小美人鱼',
    type: 'photo',
    title: 'Cliff, sea and clear sky landscape',
    place: '小美人鱼',
    mediaUrl: 'https://example.invalid/x.jpg',
    distanceKm: 8000,
    birdSpecies: 'sparrow',
    at: 0,
    expiresAt: 24 * 60 * 60 * 1000,
    kept: true, // 已保留 → 不渲染倒计时和保留按钮，断言更干净
    keepCost: 10,
    match,
  }
}

const BADGE = '示意图'

describe('相册 · 示意图角标', () => {
  it('★ `scene` → 显示「示意图」（默认图里那条顶替图）', () => {
    render(<SouvenirCard souvenir={photoSouvenir('scene')} coins={0} onKeep={() => {}} />)
    expect(
      screen.queryByText(BADGE),
      '`scene` 的图没被标出来 → 界面会把"不是那个地方"的照片当实景给孩子看',
    ).not.toBeNull()
  })

  it('★ `place` → **不**显示（它是真的那个地方，标了就成假警报）', () => {
    render(<SouvenirCard souvenir={photoSouvenir('place')} coins={0} onKeep={() => {}} />)
    expect(
      screen.queryByText(BADGE),
      '真地方的照片被标成「示意图」→ 界面在对孩子说假话',
    ).toBeNull()
  })

  it('★★ `undefined` → **不**显示（家长手挑的图"没声称过"）', () => {
    /*
      ⚠️⚠️ 这条最容易被"顺手兜个底"毁掉：把 `undefined` 也当成 `scene`。
        家长手挑的图**不写** `match`，意思是"没声称过" ——
        界面替他显示"这是顶替图"，就是**替他声称了一件他从没说过的事**。
    */
    render(<SouvenirCard souvenir={photoSouvenir(undefined)} coins={0} onKeep={() => {}} />)
    expect(
      screen.queryByText(BADGE),
      '`undefined`（家长手挑的图）被显示成「示意图」→ 替家长声称了他没说过的事',
    ).toBeNull()
  })
})
