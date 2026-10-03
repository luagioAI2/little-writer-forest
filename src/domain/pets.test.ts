import { describe, expect, it } from 'vitest'
import { initialBird, resolveReturn, speciesById } from './pets'
import { contentById, contentsByLandmark } from './travelContents'
import { EVENT_POOLS } from './travelEvents'
import { defaultPhotoFor } from '../data/landmarkPhotos'
import { LANDMARKS } from './travel'
import { seededRng } from './tree'
import type { Bird, HomePoint } from './types'

/* ============================================================
   鸟归巢时真的带得回来
   ------------------------------------------------------------
   上面那些（travelContents.test.ts / travelEvents.test.ts）只证明
   "数据对"和"函数对"，证明不了 **resolveReturn 有没有真的把它们接上**。
   而"store 忘了调用"正是这个项目踩过的坑（树种凭空消失那次）。

   ★★ 2026-09-25 改的：鸟现在**到了才抽事件**，所以这里的用例也跟着变了 ——
      以前是"鸟身上记着 contentId，结算时把它变成纪念品"，
      现在是"鸟身上只有 destinationId，结算时抽事件 → 决定带回什么"。
      ⚠️ 所以**同一个景点、换不同的随机种子会带回来不同的东西** ——
         这不是不稳定，这正是"一个景点多张图 + 多事件"要的效果。
   ============================================================ */

/** 一只"已经飞回来、可以结算"的鸟 */
function awayBird(landmarkId?: string): Bird {
  return {
    ...initialBird(speciesById('sparrow'), 0),
    status: 'away',
    destinationId: landmarkId,
    departedAt: 0,
    returnsAt: 1000,
  }
}

const SEEDS = Array.from({ length: 40 }, (_, i) => i)

function runAll(landmarkId: string) {
  return SEEDS.map((seed) =>
    resolveReturn(awayBird(landmarkId), 2000, { rng: seededRng(seed), owned: [] }),
  )
}

describe('小鸟归巢带回内容', () => {
  it('★★ 同一个景点换种子会带回来**不同的东西**（这就是多图/多事件的意义）', () => {
    /*
      如果这条红了，多半是"事件抽取"被写成了恒定值 ——
      那孩子每次去同一个地方都拿到同一张图，多配的图等于白配。
    */
    const ids = new Set(runAll('badaling').map((r) => r.souvenir?.contentId))
    expect(ids.size).toBeGreaterThan(1)
  })

  it('★ 有图有池子的景点，40 个种子**每一次**都带得回来', () => {
    /*
      badaling 有一张图（badaling-autumn）也有一条笑话（badaling-joke），
      而音乐 / 格言这个地标没有 → 会退回拍照 → 又落回那张图。
      ➜ 所以任何种子都应该带回点什么。
    */
    const res = runAll('badaling')
    for (const [i, r] of res.entries()) {
      expect(r.souvenir, `seed=${SEEDS[i]} 没带回纪念品`).toBeDefined()
    }
  })

  it('★★ 等级要从**来源**抄进纪念品（不抄就会静默降级成「顺路」）', () => {
    /*
      ⚠️⚠️ 这条守的是一个很容易漏、而且**完全不报错**的地方：

      相册渲染的是 `TravelSouvenir`，不是内容包 / 池子里的那条。
      来源里标着「绝景」，但如果 `resolveReturn` 忘了把 `grade`
      抄过去，纪念品上的 `grade` 就是 `undefined` ——
      而 `gradeMeta(undefined)` 会兜底成最低档「顺路」。

      于是：**来源里写着绝景，界面上显示绿色「顺路」**，
      不报错、不崩、其余测试全绿。
      ➜ 判据：凡是"数据里的字段要在界面上显示"，就必须有一条
        「它真的被抄到运行时对象上了吗」的断言。
        （同类坑见 MEMORY §二十八「注释说有、代码没实现」。）

      ★ 照片和笑话**两条路都要查** —— 它们分别从内容包和事件池来，
        只查一条的话，另一条漏抄照样是绿的。
    */
    expect(contentById('badaling-autumn')?.grade, '内容包本身没等级，这条断言就没意义了').toBe('绝景')

    const got = runAll('badaling').map((r) => r.souvenir)
    const photo = got.find((s) => s?.contentId === 'badaling-autumn')
    const joke = got.find((s) => s?.contentId === 'badaling-joke')

    expect(photo, '40 个种子里一次都没抽到那张照片，测不到等级').toBeDefined()
    expect(photo?.grade, '照片的等级没抄进纪念品 → 相册会按「顺路」上色').toBe('绝景')
    expect(photo?.type).toBe('photo')

    expect(joke, '40 个种子里一次都没抽到那条笑话，测不到等级').toBeDefined()
    expect(joke?.grade, '笑话的等级没抄进纪念品').toBe('顺路')
    expect(joke?.type).toBe('joke')
    expect(joke?.textContent, '笑话的正文没抄进纪念品').toBeTruthy()
  })

  it('★★ `match` 也要从来源抄进纪念品（不抄 → 相册把顶替图当实景）', () => {
    /*
      ⚠️⚠️ 跟上面那条 `grade` 是同一个坑，但**后果更重**：
        `grade` 漏抄只是颜色错了；`match` 漏抄是**界面在撒谎** ——
        一张"不是那个地方"的图，会被当成实景照片给孩子看。

      ★ 三种情况**都要查**，因为它们的正确结果各不相同：
        · 默认图标了 `scene` → 纪念品上还是 `scene`（界面标「示意图」）
        · 默认图标了 `place` → 纪念品上是 `place`（界面**不**标）
        · 内容包（家长手挑）**不写** `match` → 纪念品上是 `undefined`
          ⚠️ 这一条最危险：顺手把 `undefined` 兜成 `'scene'`，
             就等于替家长声称了一件他从没说过的事（见 `TravelContent.match`）。
    */

    // ① scene —— 这条地标没内容包、事件池里也没它 → 每个种子都落到默认图
    const sceneId = 'world-丹麦-小美人鱼'
    expect(defaultPhotoFor(sceneId)?.match, '库里这条不再是 scene 了 → 这条用例得换对象').toBe(
      'scene',
    )
    const scenePhoto = runAll(sceneId)
      .map((r) => r.souvenir)
      .find((s) => s?.contentId === `default:${sceneId}`)
    expect(scenePhoto, '一个种子都没落到默认图上，测不到 match').toBeDefined()
    expect(scenePhoto?.match, '`match` 没抄进纪念品 → 相册会把顶替图当实景显示').toBe('scene')

    // ② place —— 抄是抄了，但**别抄错**：标成 scene 会让界面对真照片说"这是示意图"
    const placeId = 'tiananmen'
    expect(defaultPhotoFor(placeId)?.match, '库里这条不再是 place 了 → 这条用例得换对象').toBe(
      'place',
    )
    const placePhoto = runAll(placeId)
      .map((r) => r.souvenir)
      .find((s) => s?.contentId === `default:${placeId}`)
    expect(placePhoto, '一个种子都没落到默认图上，测不到 match').toBeDefined()
    expect(placePhoto?.match, '真地方的照片被标成 scene → 界面会对它说"示意图"').toBe('place')

    // ③ 内容包 —— 家长手挑的图**没声称过**，不许替他兜成 scene
    const packPhoto = runAll('badaling')
      .map((r) => r.souvenir)
      .find((s) => s?.contentId === 'badaling-autumn')
    expect(packPhoto, '40 个种子里一次都没抽到那张照片，测不到 match').toBeDefined()
    expect(
      packPhoto?.match,
      '内容包的图被兜成了 match → 界面会替家长声称"这是顶替图"',
    ).toBeUndefined()
  })

  it('★ 传了 home 就按 home 算距离', () => {
    const gz = { name: '广州', lng: 113.2644, lat: 23.1291, source: 'manual' as const }
    const res = resolveReturn(awayBird('badaling'), 2000, {
      rng: seededRng(1),
      owned: [],
      home: gz,
    })
    // 广州比深圳离北京近一点点，但依然是两千公里级别
    expect(res.souvenir?.distanceKm).toBeGreaterThan(1900)
    expect(res.souvenir?.distanceKm).not.toBe(1989)
  })

  it('没传 home → 退回默认基准点（深圳），不是 0 公里', () => {
    const res = resolveReturn(awayBird('badaling'), 2000, { rng: seededRng(1), owned: [] })
    expect(res.souvenir?.distanceKm).toBe(1989)
  })

  it('存档里塞了个坏基准点（0,0）也不会算出荒唐的距离', () => {
    // 用变量而不是内联字面量：模拟 settings.homePoint 那种「从存档读出来的对象」，
    // 也让 TS 把它当 HomePoint 而不是触发多余属性检查
    const bogusHome: HomePoint = { name: '?', lng: 0, lat: 0, source: 'gps' }
    const res = resolveReturn(awayBird('badaling'), 2000, {
      rng: seededRng(1),
      owned: [],
      home: bogusHome,
    })
    expect(res.souvenir?.distanceKm).toBe(1989)
  })

  it('★ 没配图的景点走程序化插画，会真的出现「这次没带回」', () => {
    /*
      ★ 这条路径**必须还在** —— 铺开默认图之前，库里 643 个地标配了图的只有 85 个，
        剩下 558 条抽到拍照仍然没有图。删了插画这条路，小鸟飞一趟就真的什么都不带回来。

      ⚠️ 2026-09-25 改了挑谁：以前写死 `tiananmen`，理由是"它没图"。
         现在天安门**有默认图了**（试水那 85 条之一）→ 每个种子都会带回图，
         这条用例就假红了。
      ➜ 改成**按条件现找**一条：没内容包、没默认图、
        而且笑话/音乐/格言三个池子里都没有它（否则会带回别的类型，验不到插画那条路）。
         这样铺开到 643 之后它依然找得到对象，**不用再改一次**。
    */
    const bare = LANDMARKS.find(
      (l) =>
        contentsByLandmark(l.id).length === 0 &&
        !defaultPhotoFor(l.id) &&
        !['joke', 'music', 'quote'].some((k) =>
          (EVENT_POOLS[k] ?? []).some((i) => i.landmarkId === l.id),
        ),
    )
    expect(bare, '找不到"没内容包、没默认图、也没池子"的地标 —— 数据变了？').toBeDefined()

    const shots = runAll(bare!.id)
    expect(shots.some((r) => r.souvenir)).toBe(true)
    expect(shots.some((r) => !r.souvenir)).toBe(true)
    // 程序化插画那条路 contentId 是空的（不是从任何池子来的）
    const some = shots.find((r) => r.souvenir)?.souvenir
    expect(some?.contentId).toBe('')
    expect(some?.type).toBe('photo')
  })

  it('★★ 有默认图的景点**不再**出现「这次没带回」', () => {
    /* 家长 09-25 要「默认的图片链接」的**目的**就是这条：
       抽到拍照就一定有张真照片，而不是一半概率空手。
       ⚠️ 这条跟上面那条是一对：上面守"插画那条路还在"，这条守"有图就必带回"。 */
    const withPhoto = LANDMARKS.find(
      (l) =>
        l.fame === '世界知名' &&
        contentsByLandmark(l.id).length === 0 &&
        !!defaultPhotoFor(l.id),
    )
    expect(withPhoto, '找不到"有默认图但没内容包"的地标').toBeDefined()

    const shots = runAll(withPhoto!.id)
    const photos = shots.filter((r) => r.souvenir?.type === 'photo')
    expect(photos.length, '40 个种子里一张照片都没带回').toBeGreaterThan(0)
    for (const r of photos) {
      expect(r.souvenir!.mediaUrl, `${withPhoto!.id} 带回的照片没有地址`).toBeTruthy()
      expect(r.souvenir!.credit?.source).toBeTruthy()
    }
  })

  it('★ destinationId 指向不存在的地标时不崩，也不带空纪念品回来', () => {
    // 老存档里可能留着一个已经删掉的地标 id —— 不能因此抛错
    const res = resolveReturn(awayBird('deleted-landmark-id'), 2000, {
      rng: seededRng(1),
      owned: [],
    })
    expect(res.bird.status).toBe('home')
    expect(res.souvenir).toBeUndefined()
    expect(res.visitedLandmarkId).toBeUndefined()
  })

  it('老存档里"没记 destinationId"的鸟照样能结算（只是带不回东西）', () => {
    const res = resolveReturn(awayBird(undefined), 2000, { rng: seededRng(1), owned: [] })
    expect(res.bird.status).toBe('home')
    expect(res.souvenir).toBeUndefined()
  })
})
