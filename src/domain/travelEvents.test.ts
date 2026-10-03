import { describe, expect, it } from 'vitest'
import {
  EVENT_POOLS,
  eventLabel,
  pickEventItem,
  rollArrivalEvent,
  rollTravelEvent,
  TRAVEL_EVENTS,
} from './travelEvents'
import { contentsByLandmark } from './travelContents'
import { defaultPhotoFor } from '../data/landmarkPhotos'
import { LANDMARKS } from './travel'
import { seededRng } from './tree'

/* ============================================================
   旅行事件 —— 到了旅游点，先抽一个事件
   ------------------------------------------------------------
   守的是三件事：
     ① 权重表本身（家长定的「拍照为主」）
     ② **按地标优先、缺了退全局，但绝不拿别的地标的来凑**
     ③ 落空时会**退回拍照**，不出现"这次什么都没带回来"
   ============================================================ */

const SEEDS = Array.from({ length: 400 }, (_, i) => i)

describe('事件权重表', () => {
  it('★ 权重加起来是 100（改的时候别只顾着改一个数）', () => {
    const total = TRAVEL_EVENTS.reduce((a, e) => a + e.weight, 0)
    expect(total).toBe(100)
  })

  it('★★ 拍照是最重的那个 —— 家长 2026-09-25 选的「拍照为主」', () => {
    /*
      ⚠️ 这条守的是一个**设计决定**，不是实现细节。
         哪天有人觉得"笑话应该更多"顺手调了权重，这条会红，
         提醒他这是要**单独跟家长确认**的事。
    */
    const photo = TRAVEL_EVENTS.find((e) => e.kind === 'photo')
    expect(photo).toBeDefined()
    for (const e of TRAVEL_EVENTS) {
      if (e.kind === 'photo') continue
      expect(e.weight, `${e.kind} 不该比拍照重`).toBeLessThan(photo!.weight)
    }
  })

  it('每个事件都有中文名（界面上不能漏出英文 kind）', () => {
    for (const e of TRAVEL_EVENTS) {
      expect(eventLabel(e.kind)).not.toBe(e.kind)
      expect(eventLabel(e.kind).length).toBeGreaterThan(0)
    }
    // 查不到时退回 kind 本身，不崩
    expect(eventLabel('nope')).toBe('nope')
  })

  it('★ 抽出来的分布贴近权重（400 次采样）', () => {
    const counts: Record<string, number> = {}
    const rng = seededRng(20260925)
    for (let i = 0; i < 4000; i += 1) {
      const k = rollTravelEvent(rng).kind
      counts[k] = (counts[k] ?? 0) + 1
    }
    const pct = (k: string) => ((counts[k] ?? 0) / 4000) * 100
    // 允许 ±4 个百分点的采样误差
    expect(Math.abs(pct('photo') - 60)).toBeLessThan(4)
    expect(Math.abs(pct('joke') - 15)).toBeLessThan(4)
    expect(Math.abs(pct('music') - 15)).toBeLessThan(4)
    expect(Math.abs(pct('quote') - 10)).toBeLessThan(4)
  })

  it('rng 恒返回 0 / 接近 1 都不崩', () => {
    expect(rollTravelEvent(() => 0).kind).toBe(TRAVEL_EVENTS[0].kind)
    expect(rollTravelEvent(() => 0.999999).kind).toBe(TRAVEL_EVENTS[TRAVEL_EVENTS.length - 1].kind)
  })
})

describe('池子读取', () => {
  it('★ 池子的键都在白名单里（打错一个字的池子会被静默丢掉）', () => {
    /*
      ⚠️ 这条守的是"打错字"：写成 `"jokes"` 的话，那个池子会被整池丢掉，
         而界面上完全看不出来 —— 只表现为"这个事件老是抽不到"。
    */
    const allowed = ['photo', 'music', 'joke', 'video', 'quote', 'story']
    for (const key of Object.keys(EVENT_POOLS)) {
      expect(allowed, `池子 "${key}" 不是合法的事件类型`).toContain(key)
    }
    // 反过来：接上事件的那几个池子必须有数据
    for (const e of TRAVEL_EVENTS) {
      if (e.kind === 'photo') continue // 图片走内容包，不是池子
      expect(EVENT_POOLS[e.kind], `事件 ${e.kind} 没有池子`).toBeDefined()
    }
  })

  it('★ 每个池子里的条目 kind 跟池子的键一致（别串池）', () => {
    for (const [key, list] of Object.entries(EVENT_POOLS)) {
      for (const item of list) expect(item.kind, `${item.id} 放错池子了`).toBe(key)
    }
  })

  it('★ 池子里写的 landmarkId 必须真的存在（打错一个字 = 这条永远抽不到）', () => {
    /*
      ⚠️ 跟内容包同一个坑：`landmarkId` 打错一个字，
         这条内容不会报错，只是**永远抽不到** ——
         表现是"我明明写了，怎么从来没见过"。
    */
    const ids = new Set(LANDMARKS.map((l) => l.id))
    for (const [key, list] of Object.entries(EVENT_POOLS)) {
      for (const item of list) {
        if (!item.landmarkId) continue // 全局条目，合法
        expect(ids.has(item.landmarkId), `${key}/${item.id} 的 landmarkId「${item.landmarkId}」查不到`).toBe(true)
      }
    }
  })
})

describe('按地标优先，缺了退全局', () => {
  it('这个地标有 → 拿它自己的', () => {
    const item = pickEventItem('joke', 'badaling', { rng: seededRng(1) })
    expect(item?.id).toBe('badaling-joke')
  })

  it('★★ 这个地标没有 → 返回 undefined，**绝不拿别的地标的来凑**', () => {
    /*
      ⚠️⚠️ 这是这套设计里最容易写错、而且**完全看不出来**的一条：
         如果退化成"从整个池子里随便拿一条"，
         关于长城的笑话就会出现在西湖 —— 孩子看不出来，家长一眼就看出来了。
         那比"这次没抽到"糟得多。
    */
    expect(pickEventItem('joke', 'xihu', { rng: seededRng(1) })).toBeUndefined()
    expect(pickEventItem('quote', 'badaling', { rng: seededRng(1) })).toBeUndefined()
    expect(pickEventItem('music', 'xihu', { rng: seededRng(1) })).toBeUndefined()
  })

  it('池子里压根没这个键 → undefined，不崩', () => {
    expect(pickEventItem('not-a-kind', 'badaling', { rng: seededRng(1) })).toBeUndefined()
  })

  it('★ exclude 里的优先避开；全见过了就允许重复', () => {
    const fresh = pickEventItem('joke', 'badaling', { rng: seededRng(1) })
    expect(fresh?.id).toBe('badaling-joke')
    const again = pickEventItem('joke', 'badaling', {
      exclude: ['badaling-joke'],
      rng: seededRng(1),
    })
    expect(again?.id, '都见过了就该允许重复，不能返回空').toBe('badaling-joke')
  })
})

describe('到达时抽事件', () => {
  it('★★ 无论抽到什么，结果都**可落地**：要么有 item，要么是拍照', () => {
    for (const lm of ['badaling', 'xihu', 'tiananmen', 'cn-北京-故宫博物院']) {
      for (const seed of SEEDS) {
        const ev = rollArrivalEvent({ landmarkId: lm, rng: seededRng(seed) })
        expect(ev.kind, `${lm} seed=${seed}`).toBeTruthy()
        if (ev.kind === 'photo') {
          expect(ev.item, '拍照事件不该有池子条目').toBeUndefined()
        } else {
          expect(ev.item, `${lm} seed=${seed} 抽到 ${ev.kind} 却没有条目`).toBeDefined()
          expect(ev.item?.kind).toBe(ev.kind)
        }
      }
    }
  })

  it('★★ 池子落空时**退回拍照**，并且如实标出来', () => {
    /*
      ★ 为什么要退回拍照：不重抽别的类型（重抽要循环、还可能连着落空），
        而拍照有程序化插画兜底，**一定能带回点什么**。
        "这次什么都没带回来"是最糟的结果。

      ⚠️ tiananmen 没有图、接上的池子里也没有它 →
         所以**每一次**非拍照的抽取都必然落空 → 全部 fellBack。
    */
    const all = SEEDS.map((seed) => rollArrivalEvent({ landmarkId: 'tiananmen', rng: seededRng(seed) }))
    const nonPhoto = all.filter((e) => e.rolled !== 'photo')
    expect(nonPhoto.length, '400 次里一次都没抽到非拍照事件？权重表可能坏了').toBeGreaterThan(0)
    for (const ev of nonPhoto) {
      expect(ev.fellBack, `rolled=${ev.rolled} 落空了却没标 fellBack`).toBe(true)
      expect(ev.kind).toBe('photo')
    }
    // 抽到拍照的（本来就没落空）不该被标成 fellBack
    for (const ev of all.filter((e) => e.rolled === 'photo')) {
      expect(ev.fellBack).toBe(false)
    }
  })

  it('★ 拍照事件只会拿到**这个地标**的图', () => {
    /*
      ⚠️ 如果这里退化成"从全库的图里挑"，孩子就会在西湖的卡片上看到长城。

      ★★ 2026-09-25 改了判据：以前断言的是"id 必须在 `contentsByLandmark()` 里"，
         而 `pickPhotoForLandmark` 现在会在内容包之外**用默认图兜底**
         （`id` 形如 `default:badaling`，不在内容包里）—— 那条断言会假红。
         ➜ 改成断言**真正的不变量**：图的 `landmarkId` 必须就是这个地标。
           它同时盖住两种来源，而且比原来更强（原来只查 id 集合，盖不住默认图）。
         ⚠️ 别改回"把默认图也塞进 contentsByLandmark" —— 那是把两层揉成一层。
    */
    for (const seed of SEEDS) {
      const ev = rollArrivalEvent({ landmarkId: 'badaling', rng: seededRng(seed) })
      if (!ev.photo) continue
      expect(ev.photo.landmarkId, `${ev.photo.id} 不是 badaling 的图`).toBe('badaling')
    }
  })

  it('★★ 内容包优先：配过图的景点不许被默认图顶替', () => {
    /* badaling 内容包里有一条 `badaling-autumn`。
       ⚠️ 默认图是**兜底**，不是替代 —— 顶替了的话家长挑的散文和等级就全没了，
          而界面上只会显示成"这张图没配过内容"，看不出来是被顶掉的。 */
    const packIds = new Set(contentsByLandmark('badaling').map((c) => c.id))
    expect(packIds.size).toBeGreaterThan(0)
    for (const seed of SEEDS) {
      const ev = rollArrivalEvent({ landmarkId: 'badaling', rng: seededRng(seed) })
      if (!ev.photo) continue
      expect(packIds.has(ev.photo.id), `拿到了 ${ev.photo.id}，但内容包里有 ${[...packIds].join('/')}`).toBe(true)
    }
  })

  it('★★ 没配内容的景点也有默认图兜底 —— 不再直接掉到程序化插画', () => {
    /* 家长 09-25 要的「默认的图片链接」就是这件事：
       以前只有 badaling / xihu 两个景点有图，其余抽到拍照就只能给插画。
       ➜ 挑一条**不在内容包里、但配了默认图**的世界知名地标来验。 */
    const withDefault = LANDMARKS.find(
      (l) => l.fame === '世界知名' && contentsByLandmark(l.id).length === 0,
    )
    expect(withDefault, '找不到"有默认图但没内容包"的地标 —— 默认图那一层是不是空了？').toBeDefined()

    let got = 0
    for (const seed of SEEDS) {
      const ev = rollArrivalEvent({ landmarkId: withDefault!.id, rng: seededRng(seed) })
      if (ev.kind !== 'photo') continue
      expect(ev.photo, `${withDefault!.id} 抽到拍照却没有图`).toBeDefined()
      expect(ev.photo!.mediaUrl, `${withDefault!.id} 的默认图没有地址`).toBeTruthy()
      expect(ev.photo!.landmarkId).toBe(withDefault!.id)
      got += 1
    }
    expect(got, '400 个种子里一次拍照都没抽到，这条没验到东西').toBeGreaterThan(0)
  })

  it('★ 两样都没有的景点仍然留空 → 由 pets.ts 退回程序化插画', () => {
    /* ⚠️ 这条守的是"别为了不留空而编一张图"。
       铺开前库里还有 558 条没有默认图，它们必须**老实留空**。 */
    const bare = LANDMARKS.find(
      (l) => contentsByLandmark(l.id).length === 0 && !defaultPhotoFor(l.id),
    )
    expect(bare, '库里一条"既没内容包也没默认图"的都没有了 —— 铺开到 643 了？').toBeDefined()
    for (const seed of SEEDS) {
      const ev = rollArrivalEvent({ landmarkId: bare!.id, rng: seededRng(seed) })
      expect(ev.photo).toBeUndefined()
    }
  })

  it('★ 抽到的事件类型一定是权重表里的（不会冒出 story / video）', () => {
    // story / video 的数据还在池子里占位，但**还没接事件系统** —— 抽不到才对
    const kinds = new Set(TRAVEL_EVENTS.map((e) => e.kind))
    for (const seed of SEEDS) {
      const ev = rollArrivalEvent({ landmarkId: 'cn-北京-故宫博物院', rng: seededRng(seed) })
      expect(kinds.has(ev.rolled)).toBe(true)
      expect(kinds.has(ev.kind)).toBe(true)
    }
  })
})
