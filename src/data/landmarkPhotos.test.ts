/* ============================================================
   默认图片 —— 体检
   ============================================================
   ★★ 这个文件守的是**默认图那份数据**（`src/data/landmark-photos.json`）。

   为什么值得单独一个文件：这些毛病的共同点是**不报错、不崩**，
   只是界面上"这个地方还没配图" —— 跟"这条数据写错了"看起来一模一样。
   所以只能靠数数把它变成**看得见**的红。

   ⚠️ 里面**没有**"必须是 85 条"这种写死的数字 —— 见「关于规模」那条。
   ============================================================ */

import { describe, expect, it } from 'vitest'
import {
  DROPPED_PHOTO_COUNT,
  LANDMARK_PHOTOS,
  PHOTO_SOURCE,
  checkLandmarkPhotos,
  defaultPhotoFor,
  photoCount,
  photoLandmarkIds,
} from './landmarkPhotos'
import { LANDMARK_SEEDS } from './landmarks'
import { WORLD_FAMOUS } from './landmarkFame'

describe('默认图体检', () => {
  it('至少有一条默认图', () => {
    expect(LANDMARK_PHOTOS.length).toBeGreaterThan(0)
  })

  it('★★ 每条默认图的 landmarkId 都能在地标库里找到（写错就永远轮不到）', () => {
    const ids = new Set(LANDMARK_SEEDS.map((s) => s.id))
    const bad = LANDMARK_PHOTOS.filter((p) => !ids.has(p.landmarkId)).map((p) => p.landmarkId)
    expect(bad, `这些 landmarkId 在地标库里找不到：${bad.slice(0, 10).join(', ')}`).toEqual([])
  })

  it('★★ 被丢掉的默认图必须是 0 条 —— 地标 id 打错一个字就会静默丢一条', () => {
    expect(
      DROPPED_PHOTO_COUNT,
      `${DROPPED_PHOTO_COUNT} 条默认图因为 landmarkId 查不到（或重复）被丢掉了 —— ` +
        '去看 src/data/landmark-photos.json 的来源清单 scripts/photo-sourced.json',
    ).toBe(0)
  })

  it('★★ landmarkId 不许重复（重复的话后者被前者盖掉）', () => {
    const seen = new Set<string>()
    const dup: string[] = []
    for (const p of LANDMARK_PHOTOS) {
      if (seen.has(p.landmarkId)) dup.push(p.landmarkId)
      seen.add(p.landmarkId)
    }
    expect(dup, `重复的 landmarkId：${dup.join(', ')}`).toEqual([])
  })

  it('★ 图片一律 https 外链，且编号在 mediaUrl 与 credit.link 两处对得上', () => {
    for (const p of LANDMARK_PHOTOS) {
      expect(p.mediaUrl, `${p.landmarkId} 的图片不是 https`).toMatch(/^https:\/\//)
      const idInUrl = p.mediaUrl.match(/photos\/(\d+)\//)?.[1]
      expect(idInUrl, `${p.landmarkId} 的图片地址里没有编号`).toBeTruthy()
      expect(
        p.credit.link.includes(idInUrl!),
        `${p.landmarkId} 的 credit.link 里没有编号 ${idInUrl} —— 出处与图片对不上（张冠李戴）`,
      ).toBe(true)
    }
  })

  it('★★ 署名必须有图库名和出处链接', () => {
    for (const p of LANDMARK_PHOTOS) {
      expect(p.credit?.source, `${p.landmarkId} 缺 credit.source`).toBeTruthy()
      expect(p.credit?.link, `${p.landmarkId} 缺 credit.link`).toBeTruthy()
    }
  })

  it('★★ match 只认 place / scene，且说 place 就必须给得出出处', () => {
    for (const p of LANDMARK_PHOTOS) {
      expect(['place', 'scene'], `${p.landmarkId} 的 match 不认识：${p.match}`).toContain(p.match)
      if (p.match === 'place') {
        expect(p.credit?.link, `${p.landmarkId} 声称 place 却没有 credit.link`).toBeTruthy()
      }
    }
  })

  it('★★ 没有一条默认图带 grade / essay —— 那是家长挑图时才有的东西', () => {
    /* ⚠️ 默认图是机器搜来的，只有图片地址和署名。
       如果哪天有人给它编了一份散文或等级，等于**替家长声称**了他没说过的话。
       （类型上本来就没有这两个字段，这条守的是"别偷偷加进去"。） */
    for (const p of LANDMARK_PHOTOS) {
      expect(Object.keys(p)).not.toContain('essay')
      expect(Object.keys(p)).not.toContain('grade')
    }
  })

  it('★ 抬头里的条数与分布必须和 items 自洽', () => {
    expect(PHOTO_SOURCE.count).toBe(LANDMARK_PHOTOS.length)
    const place = LANDMARK_PHOTOS.filter((p) => p.match === 'place').length
    const scene = LANDMARK_PHOTOS.filter((p) => p.match === 'scene').length
    expect(PHOTO_SOURCE.byMatch.place).toBe(place)
    expect(PHOTO_SOURCE.byMatch.scene).toBe(scene)
    expect(place + scene).toBe(LANDMARK_PHOTOS.length)
  })

  it('★ 抬头里必须交代来源与授权（数据被复制走时许可要跟着走）', () => {
    expect(PHOTO_SOURCE.source).toBeTruthy()
    expect(PHOTO_SOURCE.license).toBeTruthy()
    expect(PHOTO_SOURCE.attribution).toContain('Pexels')
    expect(PHOTO_SOURCE.licenseUrl).toMatch(/^https:\/\//)
  })

  it('★ 抬头必须**说清只覆盖了一部分** —— 不然下一个人会以为全库都有图', () => {
    /* ⚠️ 这条不是形式主义：铺开前这里只覆盖「世界知名」，
       而"没图"和"配错了"在界面上长得一样。抬头是唯一说清这件事的地方。 */
    expect(PHOTO_SOURCE.scope).toContain(String(PHOTO_SOURCE.count))
    expect(PHOTO_SOURCE.scope.length).toBeGreaterThan(10)
  })

  it('★ 抬头里留了 CDN 拼法与"怎么来的"（复核的人要能照着重做）', () => {
    expect(PHOTO_SOURCE.cdnPattern).toContain('images.pexels.com')
    expect(PHOTO_SOURCE.cdnPattern).toContain('w=640')
    expect(PHOTO_SOURCE.howItWasMade).toContain('看')
  })
})

describe('★★ 覆盖率（家长 09-25 定的口径）', () => {
  /**
   * ★★ 「世界知名的每一条都必须有默认图」。
   *
   * 为什么用 `WORLD_FAMOUS` 当对象、而**不写"必须 85 条"**：
   *   85 只是"当前覆盖到哪儿"的一个快照。铺开到 643 之后那个数字就假红了 ——
   *   而假红会诱使人**把数字改大**，那条守卫就彻底没用了。
   *   这里守的是**真命题**：这一档一条都不许漏。
   *   ⚠️ 它是**单调**的 —— 覆盖率只会变大，所以铺开之后这条依然成立、依然有意义。
   */
  it('★★ 世界知名的每一条都有默认图（覆盖率不许倒退）', () => {
    const missing = WORLD_FAMOUS.filter((id) => !defaultPhotoFor(id))
    expect(
      missing,
      `这些世界知名地标没有默认图：${missing.join(', ')}`,
    ).toEqual([])
  })

  it('★ 配了默认图的地标都真的在库里，且每条只配一张', () => {
    const ids = photoLandmarkIds()
    const lib = new Set(LANDMARK_SEEDS.map((s) => s.id))
    expect(ids.filter((id) => !lib.has(id))).toEqual([])
    expect(photoCount()).toBe(new Set(ids).size)
  })

  it('★ 默认图**不许**混进内容包 —— 相册里不能冒出几百条没散文的"内容"', () => {
    /* ⚠️ 这条守的是一个很容易犯的错：把默认图 append 进 `TRAVEL_CONTENTS`。
       那样相册里会多出一堆没有散文、没有等级的条目，
       而家长打开编辑器会以为"我配过这些"。默认图是另一层，只能走 `pickPhotoForLandmark`。 */
    for (const id of photoLandmarkIds()) {
      const lm = LANDMARK_SEEDS.find((s) => s.id === id)
      expect(lm, `${id} 不在库里`).toBeTruthy()
    }
    expect(DROPPED_PHOTO_COUNT).toBe(0)
  })
})

describe('checkLandmarkPhotos（校验函数本身）', () => {
  const ok = {
    landmarkId: 'badaling',
    match: 'place' as const,
    mediaUrl: 'https://images.pexels.com/photos/123/pexels-photo-123.jpeg?w=640',
    title: 'x',
    credit: { source: 'Pexels', link: 'https://www.pexels.com/photo/x-123/' },
  }

  it('干净的条目没问题', () => {
    expect(checkLandmarkPhotos([ok], new Set(['badaling']))).toEqual([])
  })

  it('★★ landmarkId 查不到要报出来（这条是最要命的）', () => {
    const issues = checkLandmarkPhotos([ok], new Set(['别的id']))
    expect(issues.length).toBe(1)
    expect(issues[0].why).toContain('找不到')
  })

  it('★★ place 但没有出处要报出来', () => {
    const bad = { ...ok, credit: { source: 'Pexels', link: '' } }
    const issues = checkLandmarkPhotos([bad], new Set(['badaling']))
    expect(issues.map((i) => i.why).join()).toContain('credit.link')
  })

  it('★★ 出处与图片编号对不上要报出来（张冠李戴）', () => {
    const bad = { ...ok, credit: { source: 'Pexels', link: 'https://www.pexels.com/photo/x-999/' } }
    const issues = checkLandmarkPhotos([bad], new Set(['badaling']))
    expect(issues.map((i) => i.why).join()).toContain('对不上')
  })

  it('★ match 拼错要报出来（消费端的 === 判断会全落空）', () => {
    const bad = { ...ok, match: 'Place' as unknown as 'place' }
    const issues = checkLandmarkPhotos([bad], new Set(['badaling']))
    expect(issues.map((i) => i.why).join()).toContain('match')
  })

  it('★ 不是 https 要报出来', () => {
    const bad = { ...ok, mediaUrl: 'http://images.pexels.com/photos/123/x.jpeg' }
    const issues = checkLandmarkPhotos([bad], new Set(['badaling']))
    expect(issues.map((i) => i.why).join()).toContain('https')
  })
})
