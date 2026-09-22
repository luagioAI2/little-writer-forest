import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOME_POINT,
  TRAVEL_STORIES,
  coveredLandmarkIds,
  distanceKmFromHome,
  hasOwnMapPoint,
  hasStory,
  haversineKm,
  isDefaultHome,
  mapPointFor,
  photoPoints,
  resolveDistanceKm,
  resolveHomePoint,
  storyCount,
  storyFor,
} from './travelStories'
import { LANDMARKS, landmarkById, makePhoto } from './travel'
import { initialBird, resolveReturn, speciesById } from './pets'
import { seededRng } from './tree'
import type { Bird, HomePoint } from './types'

/* ============================================================
   一、内容包体检 —— 每一条都必须过
   ------------------------------------------------------------
   为什么这批断言值得单独写：
   内容包是**人手工填**的数据，而它出错时是**静默的** ——
   landmarkId 写错一个字母，这条内容就永远没机会被小鸟带回来，
   界面上什么都不会发生，也没有报错。只有测试能拦住这种"内容失踪"。
   ============================================================ */

describe('旅行内容包体检', () => {
  it('至少有一条内容', () => {
    expect(TRAVEL_STORIES.length).toBeGreaterThan(0)
  })

  it('每条内容的 landmarkId 都能在地标表里找到（写错就会永远带不回来）', () => {
    for (const s of TRAVEL_STORIES) {
      expect(landmarkById(s.landmarkId), `landmarkId「${s.landmarkId}」不存在于 LANDMARKS`).toBeDefined()
    }
  })

  it('一个地标只能有一条内容（重复的话后面的会被盖掉）', () => {
    const ids = coveredLandmarkIds()
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('图片只存开源外链，且必须是 https', () => {
    for (const s of TRAVEL_STORIES) {
      expect(s.photoUrl.startsWith('https://'), `${s.landmarkId} 的图片不是 https 外链`).toBe(true)
      // 不能是本地路径 —— 内容包不打包图片，只存地址
      expect(s.photoUrl.startsWith('/')).toBe(false)
    }
  })

  it('署名必须有图库名和出处链接', () => {
    for (const s of TRAVEL_STORIES) {
      expect(s.credit.source.length).toBeGreaterThan(0)
      expect(s.credit.link.startsWith('https://')).toBe(true)
    }
  })

  it('地名和摘要都不能是空的', () => {
    for (const s of TRAVEL_STORIES) {
      expect(s.place.trim().length).toBeGreaterThan(0)
      expect(s.summary.trim().length).toBeGreaterThan(0)
      // 摘要是列表里那一行，太长会撑破卡片
      expect(s.summary.length).toBeLessThanOrEqual(60)
    }
  })

  it('散文至少要 4 段，每段都不是空占位', () => {
    for (const s of TRAVEL_STORIES) {
      const paras = s.essay.split('\n\n')
      expect(paras.length, `${s.landmarkId} 的散文段数太少`).toBeGreaterThanOrEqual(4)
      for (const p of paras) {
        expect(p.trim().length).toBeGreaterThan(4)
      }
      // 全文得有分量 —— 这不是一句配文，是一篇散文
      expect(s.essay.length).toBeGreaterThan(200)
    }
  })

  it('散文和摘要里不出现半角逗号（给孩子看的界面一律全角标点）', () => {
    for (const s of TRAVEL_STORIES) {
      expect(s.essay.includes(','), `${s.landmarkId} 的散文里有半角逗号`).toBe(false)
      expect(s.summary.includes(',')).toBe(false)
    }
  })

  it('散文里不放 emoji（界面图标一律用手绘线性图标，不用 emoji 当 UI）', () => {
    /*
      覆盖常见 emoji 区段：象形符号、杂项符号、装饰符号。
      变体选择符 U+FE0F 用 `|` 单独写，不塞进字符类 ——
      它和前一个字符是**组合关系**，放进 `[...]` 会被
      ESLint 的 no-misleading-character-class 判为误导性字符类。
    */
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u
    for (const s of TRAVEL_STORIES) {
      expect(emoji.test(s.essay), `${s.landmarkId} 的散文里有 emoji`).toBe(false)
      expect(emoji.test(s.summary)).toBe(false)
    }
  })

  it('手填的距离必须是合理的公里数', () => {
    for (const s of TRAVEL_STORIES) {
      if (s.distanceKm === undefined) continue
      expect(s.distanceKm).toBeGreaterThan(0)
      expect(s.distanceKm).toBeLessThan(20_000) // 中国境内不会超过这个数
    }
  })
})

/* ============================================================
   二、距离
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
    const km = distanceKmFromHome('badaling')
    expect(km).toBeDefined()
    expect(km!).toBeGreaterThan(1960)
    expect(km!).toBeLessThan(2020)
  })

  it('地标不存在时返回 undefined，而不是抛错', () => {
    expect(distanceKmFromHome('not-a-real-place')).toBeUndefined()
  })

  it('手填的距离优先于自动计算', () => {
    // 现在没有条目手填距离了（基准点换城市后手填值最容易变成错的），
    // 所以造一条来验这条规则本身
    const story = { ...storyFor('badaling')!, distanceKm: 123 }
    expect(resolveDistanceKm(story)).toBe(123)
  })

  it('没手填时用经纬度算出来的值', () => {
    const story = storyFor('badaling')!
    expect(story.distanceKm).toBeUndefined()
    expect(resolveDistanceKm(story)).toBe(distanceKmFromHome('badaling'))
  })

  it('换一个基准点，算出来的距离跟着变', () => {
    const bj = { lng: 116.3975, lat: 39.9087 }
    const story = storyFor('badaling')!
    const fromSZ = resolveDistanceKm(story)!
    const fromBJ = resolveDistanceKm(story, bj)!
    expect(fromSZ).toBeGreaterThan(1900)
    expect(fromBJ).toBeLessThan(100)
    expect(fromSZ).not.toBe(fromBJ)
  })
})

/* ============================================================
   二·B、基准点（「家」在哪儿）
   ------------------------------------------------------------
   没设位置、没读到 GPS 时以**深圳**为基准点。
   这一组守住三件事：默认是深圳、坏坐标会被挡住、好坐标会用上。
   ============================================================ */

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
    }
  })

  it('坏坐标不会污染距离 —— 还是按深圳算', () => {
    const story = storyFor('badaling')!
    const bogus = { lng: 0, lat: 0 }
    // 存档里塞了个 (0,0) 进来，算出来必须还是深圳那个数
    expect(resolveDistanceKm(story, bogus)).toBe(
      resolveDistanceKm(story, DEFAULT_HOME_POINT),
    )
    expect(resolveDistanceKm(story, bogus)).toBeGreaterThan(1900)
  })
})

/* ============================================================
   三、地图落点
   ------------------------------------------------------------
   「小鸟落在哪儿」不是靠额外的地图图片，而是靠经纬度算出来的。
   这一组守住的是：只要 landmarkId 填对，落点就一定画得出来。
   ============================================================ */

describe('地图落点', () => {
  it('没钉坐标时，落点就是地标自己的经纬度', () => {
    const lm = landmarkById('badaling')!
    expect(mapPointFor('badaling')).toEqual({ lng: lm.lng, lat: lm.lat })
    expect(hasOwnMapPoint('badaling')).toBe(false)
  })

  it('钉了坐标就用钉的（能把点挪到更准的地方）', () => {
    const story = { ...storyFor('badaling')!, lng: 116.02, lat: 40.36 }
    expect(mapPointFor('badaling', story)).toEqual({ lng: 116.02, lat: 40.36 })
    expect(hasOwnMapPoint('badaling', story)).toBe(true)
  })

  it('只给一半坐标算没给 —— 否则会画出一个看着合理其实错得离谱的点', () => {
    const half = { ...storyFor('badaling')!, lng: 116.02, lat: undefined }
    const lm = landmarkById('badaling')!
    expect(hasOwnMapPoint('badaling', half)).toBe(false)
    expect(mapPointFor('badaling', half)).toEqual({ lng: lm.lng, lat: lm.lat })
  })

  it('地标不存在、包也没钉坐标时返回 undefined（界面就别画这个点）', () => {
    expect(mapPointFor('not-a-real-place')).toBeUndefined()
  })

  it('每条内容的落点都算得出来 —— 算不出来就意味着地图上画不出这个点', () => {
    for (const s of TRAVEL_STORIES) {
      expect(mapPointFor(s.landmarkId), `${s.landmarkId} 没有落点`).toBeDefined()
    }
  })

  it('落点都在中国大致范围内（填错经纬度会被这条拦下）', () => {
    for (const s of TRAVEL_STORIES) {
      const p = mapPointFor(s.landmarkId)!
      expect(p.lng, `${s.landmarkId} 的经度看着不对`).toBeGreaterThan(70)
      expect(p.lng).toBeLessThan(140)
      expect(p.lat, `${s.landmarkId} 的纬度看着不对`).toBeGreaterThan(3)
      expect(p.lat).toBeLessThan(55)
    }
  })

  it('photoPoints 覆盖全部内容条目', () => {
    const pts = photoPoints()
    expect(pts.size).toBe(TRAVEL_STORIES.length)
    for (const s of TRAVEL_STORIES) expect(pts.has(s.landmarkId)).toBe(true)
  })

  it('钉坐标不会影响距离 —— 距离是「离家多远」，口径不能被微调位置搞乱', () => {
    const story = storyFor('badaling')!
    const pinned = { ...story, lng: 87.02, lat: 48.7 } // 钉到新疆去
    expect(resolveDistanceKm(pinned)).toBe(resolveDistanceKm(story))
  })
})

/* ============================================================
   四、查询
   ============================================================ */

describe('内容包查询', () => {
  it('能按地标 id 查到内容', () => {
    expect(hasStory('badaling')).toBe(true)
    expect(storyFor('badaling')?.place).toBe('中国长城')
  })

  it('没有内容的地标查不到，也不报错', () => {
    expect(hasStory('xihu')).toBe(false)
    expect(storyFor('xihu')).toBeUndefined()
  })

  it('storyCount 和覆盖到的地标数量一致', () => {
    expect(storyCount()).toBe(TRAVEL_STORIES.length)
    expect(coveredLandmarkIds()).toHaveLength(TRAVEL_STORIES.length)
  })

  it('覆盖到的地标都真的存在', () => {
    const all = new Set(LANDMARKS.map((l) => l.id))
    for (const id of coveredLandmarkIds()) expect(all.has(id)).toBe(true)
  })
})

/* ============================================================
   五、接进照片
   ============================================================ */

describe('内容包接进照片', () => {
  it('有内容包时，照片带上图片 / 散文 / 地名 / 距离，配文用摘要', () => {
    const lm = landmarkById('badaling')!
    const story = storyFor('badaling')!
    const photo = makePhoto({
      landmark: lm,
      birdSpecies: 'sparrow',
      birdName: '小麻',
      at: 1000,
      rng: seededRng(1),
      story,
      distanceKm: resolveDistanceKm(story),
    })

    expect(photo.photoUrl).toBe(story.photoUrl)
    expect(photo.essay).toBe(story.essay)
    expect(photo.place).toBe('中国长城')
    // 深圳 → 八达岭，约 1989 公里（内容包没手填距离，是算出来的）
    expect(photo.distanceKm).toBe(1989)
    expect(photo.credit?.source).toBe('Unsplash')
    expect(photo.caption).toContain('中国长城')
    expect(photo.caption).toContain(story.summary)
  })

  it('没有内容包时退回程序化配文，且不带图片字段', () => {
    const lm = landmarkById('xihu')!
    const photo = makePhoto({
      landmark: lm,
      birdSpecies: 'sparrow',
      birdName: '小麻',
      at: 1000,
      rng: seededRng(1),
    })

    expect(photo.photoUrl).toBeUndefined()
    expect(photo.essay).toBeUndefined()
    expect(photo.distanceKm).toBeUndefined()
    expect(photo.caption).toContain('西湖')
    expect(photo.caption).toContain('小麻')
  })

  it('手填距离缺失时用调用方算好的值', () => {
    const lm = landmarkById('badaling')!
    const story = { ...storyFor('badaling')!, distanceKm: undefined }
    const photo = makePhoto({
      landmark: lm,
      birdSpecies: 'sparrow',
      birdName: '小麻',
      at: 1000,
      rng: seededRng(1),
      story,
      distanceKm: 123,
    })
    expect(photo.distanceKm).toBe(123)
  })
})

/* ============================================================
   六、鸟归巢时真的带得回来
   ------------------------------------------------------------
   上面那些只证明"数据对"和"函数对"，证明不了
   **resolveReturn 有没有真的把内容包接上**。
   而"store 忘了调用"正是这个项目踩过的坑（树种凭空消失那次）。
   ============================================================ */

function awayBird(destinationId: string): Bird {
  return {
    ...initialBird(speciesById('sparrow'), 0),
    status: 'away',
    destinationId,
    departedAt: 0,
    returnsAt: 1000,
  }
}

describe('小鸟归巢带回内容包', () => {
  it('有内容包的地标必定带回纪念品 —— 换 20 个随机种子都不会漏', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const res = resolveReturn(awayBird('badaling'), 2000, {
        rng: seededRng(seed),
        owned: [],
      })
      expect(res.souvenir, `seed=${seed} 没带回纪念品`).toBeDefined()
      expect(res.souvenir?.mediaUrl).toBeTruthy()
      expect(res.souvenir?.essay).toBeTruthy()
      // 没传 home → 退回默认基准点深圳
      expect(res.souvenir?.distanceKm).toBe(1989)
    }
  })

  it('传了 home 就按 home 算距离', () => {
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

  it('没有内容包的地标仍然按概率来，会真的出现「这次没带回」', () => {
    const shots = Array.from({ length: 40 }, (_, seed) =>
      resolveReturn(awayBird('xihu'), 2000, { rng: seededRng(seed), owned: [] }),
    )
    expect(shots.some((r) => r.souvenir)).toBe(true)
    expect(shots.some((r) => !r.souvenir)).toBe(true)
  })
})
