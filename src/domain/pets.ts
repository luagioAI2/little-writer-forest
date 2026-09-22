/* ============================================================
   宠物 —— 小鸟
   ============================================================

   玩法：段位每上一个台阶，就有一只新鸟愿意来树上住。
   孩子把鸟"放出去"旅行，鸟回来时带着照片、种子和偶尔的一封信。

   为什么小鸟要跟段位绑定：
     鸟是"坚持写作"的奖励，也是成长树长大的副产品。
     这样孩子心里只有一条主线 —— 好好写，树会长高，鸟会变多。
     而不是"既要写作又要养鸟"两套互不相干的负担。

   亲密度（bond）只涨不跌：它是陪伴的纪念，不该因为"玩得少"被扣。
   时间一律由外部传入（now），模块内不调用 Date.now()。
   ============================================================ */

import type {
  Bird,
  BirdSpecies,
  BirdSpeciesId,
  CardDrop,
  OwnedCard,
  TravelContent,
  TravelSouvenir,
} from './types'
import { landmarkById, makePhoto } from './travel'
import { resolveDistanceKm, storyFor, type GeoPoint } from './travelStories'
import { rollDrops } from './cards'
import { distanceToContent, contentById } from './travelContents'

/* ============================================================
   一、鸟的种类
   ============================================================ */

/**
 * 8 只鸟，按段位下标逐步解锁。
 * unlockLevel 与 LEVELS 的下标一一对应：
 *   0 麻雀 / 2 燕子 / 4 黄鹂 / 6 鸽子 / 7 喜鹊 / 9 蓝鸟 / 10 仙鹤 / 11 凤凰
 * 越晚来的鸟越稀有、越快、越会拍照 —— 让"再写一点就能解锁下一只"
 * 成为一条看得见的胡萝卜。
 */
export const BIRD_SPECIES: BirdSpecies[] = [
  {
    id: 'sparrow',
    name: '麻雀',
    unlockLevel: 0,
    rarity: 'common',
    persona: '话很多，什么都想告诉你',
    color: '#a9875b',
    color2: '#e5c073',
    speed: 1.0,
    photoBonus: 0,
    desc: '住在屋檐下的小家伙，虽然普通，却是第一个来陪你的。',
  },
  {
    id: 'swallow',
    name: '燕子',
    unlockLevel: 2,
    rarity: 'fine',
    persona: '飞得最快，喜欢在屋檐下说悄悄话',
    color: '#42779a',
    color2: '#deecf5',
    speed: 1.35,
    photoBonus: 0.05,
    desc: '春天一来就能看见它，剪刀一样的尾巴，飞起来特别利索。',
  },
  {
    id: 'oriole',
    name: '黄鹂',
    unlockLevel: 4,
    rarity: 'fine',
    persona: '嗓子最好，一路唱着歌去旅行',
    color: '#d6a344',
    color2: '#f9eed6',
    speed: 1.5,
    photoBonus: 0.08,
    desc: '金黄色的羽毛，叫声清脆，古人写诗都爱提到它。',
  },
  {
    id: 'dove',
    name: '鸽子',
    unlockLevel: 6,
    rarity: 'rare',
    persona: '认路最准，从来不会迷路',
    color: '#9aa5a0',
    color2: '#f2f4f1',
    speed: 1.7,
    photoBonus: 0.1,
    desc: '不管飞多远都能找到回家的路，是最可靠的信使。',
  },
  {
    id: 'magpie',
    name: '喜鹊',
    unlockLevel: 7,
    rarity: 'rare',
    persona: '报喜鸟，回来总带着好消息',
    color: '#345f7c',
    color2: '#f2f4f1',
    speed: 1.85,
    photoBonus: 0.12,
    desc: '黑白的羽毛在阳光下会泛出蓝绿色，传说它一叫就有喜事。',
  },
  {
    id: 'bluebird',
    name: '蓝鸟',
    unlockLevel: 9,
    rarity: 'epic',
    persona: '很安静，眼睛里却装着一整片天空',
    color: '#6195b7',
    color2: '#bdd8e9',
    speed: 2.0,
    photoBonus: 0.15,
    desc: '很少出声，但每次回来带的东西都让人眼前一亮。',
  },
  {
    id: 'crane',
    name: '仙鹤',
    unlockLevel: 10,
    rarity: 'epic',
    persona: '很老很老，去过很多很多地方',
    color: '#f2f4f1',
    color2: '#c5636f',
    speed: 2.1,
    photoBonus: 0.18,
    desc: '细长的腿，雪白的翅膀，飞起来像一朵会动的云。',
  },
  {
    id: 'phoenix',
    name: '凤凰',
    unlockLevel: 11,
    rarity: 'legend',
    persona: '传说中的鸟，只在最会写故事的孩子树上落脚',
    color: '#c98a2e',
    color2: '#db8693',
    speed: 2.2,
    photoBonus: 0.25,
    desc: '据说它一百年才现身一次，羽毛像燃烧的金子。',
  },
]

export function speciesById(id: BirdSpeciesId): BirdSpecies {
  return BIRD_SPECIES.find((s) => s.id === id) ?? BIRD_SPECIES[0]
}

/** 当前段位已经解锁的鸟 */
export function unlockedSpecies(levelIndex: number): BirdSpecies[] {
  return BIRD_SPECIES.filter((s) => s.unlockLevel <= levelIndex)
}

/** 下一只将要解锁的鸟（全解锁后为 undefined） */
export function nextSpeciesToUnlock(levelIndex: number): BirdSpecies | undefined {
  return BIRD_SPECIES.find((s) => s.unlockLevel > levelIndex)
}

/* ============================================================
   二、领养与状态
   ============================================================ */

export function initialBird(species: BirdSpecies, now: number): Bird {
  return {
    species: species.id,
    nickname: species.name,
    status: 'home',
    trips: 0,
    photos: 0,
    bond: 0,
    adoptedAt: now,
    hasLetter: false,
  }
}

/** 领养一只鸟；已经有同种鸟则原样返回，不重复添加 */
export function adoptBird(birds: Bird[], species: BirdSpecies, now: number): Bird[] {
  if (birds.some((b) => b.species === species.id)) return birds
  return [...birds, initialBird(species, now)]
}

export function petCount(birds: Bird[]): number {
  return birds.length
}

/** 在家的鸟（'returned' 也算在家，只是还没被孩子看到） */
export function homeBirds(birds: Bird[]): Bird[] {
  return birds.filter((b) => b.status !== 'away')
}

/** 还在外面飞的鸟 */
export function awayBirds(birds: Bird[]): Bird[] {
  return birds.filter((b) => b.status === 'away')
}

/* ============================================================
   三、出行
   ============================================================ */

/**
 * 派一只鸟出门（v6 —— 飞向内容包）。
 *
 * 飞行时间基于距离计算，带 ±10% 浮动。
 */
export function sendBird(
  bird: Bird,
  content: TravelContent,
  distanceKm: number,
  now: number,
  rng: () => number,
): Bird {
  const sp = speciesById(bird.species)
  // 每 500 公里约 5 分钟，tier 越高的地方飞得越远
  const base = Math.max(30_000, Math.round((distanceKm / 500) * 300_000 / sp.speed))
  const jitter = 0.9 + rng() * 0.2
  return {
    ...bird,
    status: 'away',
    departedAt: now,
    returnsAt: now + Math.round(base * jitter),
    destinationId: content.landmarkId,
    contentId: content.id,
  }
}

/** 鸟是否已经飞回来、可以结算了 */
export function birdReady(bird: Bird, now: number): boolean {
  return bird.status === 'away' && bird.returnsAt !== undefined && now >= bird.returnsAt
}

export interface ReturnResult {
  bird: Bird
  /** v6：带回的纪念品（阅后即毁） */
  souvenir?: TravelSouvenir
  /** v6：这次到过的地标（用于点亮地图） */
  visitedLandmarkId?: string
  drops: CardDrop[]
  coins: number
  /** 是否带回一颗可以种在地图上的种子（v6 概率降低） */
  seed: boolean
}

/** 保留一条纪念品的金币花费 */
export const KEEP_SOUVENIR_COST = 50

/**
 * 结算一次归巢（v6）。
 *
 * 规律：
 *   · 亲密度每次 +3，只涨不跌
 *   · 必定带回一条内容（内容包写好的东西不会白写）
 *   · 种子概率降低到 50%（v6：防止地图点得太快）
 *   · 有概率额外掉一张卡（source: 'travel'）
 */
export function resolveReturn(
  bird: Bird,
  now: number,
  opts: { rng: () => number; owned: OwnedCard[]; home?: GeoPoint },
): ReturnResult {
  if (!birdReady(bird, now)) {
    return { bird, drops: [], coins: 0, seed: false }
  }

  const { rng, owned, home } = opts
  const sp = speciesById(bird.species)

  // v6：从 contentId 找内容包
  const content = bird.contentId ? contentById(bird.contentId) : undefined
  const dest = bird.destinationId ? landmarkById(bird.destinationId) : undefined

  const hasLetter = rng() < 0.35

  // v6：生成纪念品（阅后即毁）
  let souvenir: TravelSouvenir | undefined
  if (content) {
    const distanceKm = distanceToContent(content, home)
    souvenir = {
      id: `${bird.species}-${now}`,
      contentId: content.id,
      type: content.type,
      title: content.title,
      place: content.place,
      mediaUrl: content.mediaUrl,
      textContent: content.textContent,
      credit: content.credit,
      essay: content.essay,
      distanceKm,
      birdSpecies: sp.id,
      at: now,
      expiresAt: now + 24 * 60 * 60 * 1000, // 24 小时后过期
      kept: false,
      keepCost: KEEP_SOUVENIR_COST,
    }
  }

  // v6：如果没有内容包，退回老逻辑生成照片（兼容老存档）
  if (!souvenir && dest) {
    const story = storyFor(dest.id)
    if (story) {
      const photo = makePhoto({
        landmark: dest,
        birdSpecies: sp.id,
        birdName: bird.nickname,
        at: now,
        rng,
        story,
        distanceKm: resolveDistanceKm(story, home),
      })
      // 把老照片转成纪念品格式
      souvenir = {
        id: photo.id,
        contentId: '',
        type: 'photo',
        title: photo.place ?? dest.name,
        place: photo.place ?? dest.name,
        mediaUrl: photo.photoUrl,
        credit: photo.credit,
        essay: photo.essay,
        distanceKm: photo.distanceKm ?? 0,
        birdSpecies: sp.id,
        at: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
        kept: false,
        keepCost: KEEP_SOUVENIR_COST,
      }
    }
  }

  // 没有内容包也没有 story：按旧概率生成程序化照片
  if (!souvenir && dest) {
    const chance = Math.min(0.9, 0.55 + sp.photoBonus)
    if (rng() < chance) {
      const photo = makePhoto({
        landmark: dest,
        birdSpecies: sp.id,
        birdName: bird.nickname,
        at: now,
        rng,
      })
      souvenir = {
        id: photo.id,
        contentId: '',
        type: 'photo',
        title: photo.place ?? dest.name,
        place: photo.place ?? dest.name,
        mediaUrl: photo.photoUrl,
        credit: photo.credit,
        essay: photo.essay,
        distanceKm: photo.distanceKm ?? 0,
        birdSpecies: sp.id,
        at: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
        kept: false,
        keepCost: KEEP_SOUVENIR_COST,
      }
    }
  }

  const drops = rng() < 0.25 ? rollDrops({ source: 'travel', count: 1, owned }) : []
  const coins = 6 + Math.round(rng() * 8)

  // v6：种子只有树上有，归巢不带种子
  const seed = false

  const next: Bird = {
    ...bird,
    status: 'home',
    trips: bird.trips + 1,
    bond: Math.min(100, bird.bond + 3),
    hasLetter,
    photos: souvenir ? bird.photos + 1 : bird.photos,
    contentId: undefined,
    departedAt: undefined,
    returnsAt: undefined,
  }

  return {
    bird: next,
    souvenir,
    visitedLandmarkId: dest?.id,
    drops,
    coins,
    seed,
  }
}

/* ============================================================
   四、亲密度与昵称
   ============================================================ */

/** 亲密度的孩子话说法 */
export function bondLabel(bond: number): string {
  if (bond < 30) return '刚认识'
  if (bond < 70) return '好朋友'
  return '形影不离'
}

/** 给鸟改名字；改成空的就退回种类名 */
export function renameBird(bird: Bird, nickname: string): Bird {
  const name = nickname.trim()
  return { ...bird, nickname: name || speciesById(bird.species).name }
}
