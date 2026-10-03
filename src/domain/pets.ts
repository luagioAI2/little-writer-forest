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
  HomePoint,
  Landmark,
  OwnedCard,
  PhotoCredit,
  PhotoMatch,
  TravelContentType,
  TravelGrade,
  TravelSouvenir,
} from './types'
import { distanceToLandmark, landmarkById, makePhoto } from './travel'
import { rollDrops } from './cards'
import { rollArrivalEvent } from './travelEvents'

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
/**
 * 把鸟放出去。
 *
 * ★★ 2026-09-25 改了：鸟现在飞向一个**地标**，不再飞向"某一条内容"。
 *    家长原话：「到了旅游点 判断会产生什么事件」—— 目的地是**旅游点**，
 *    带回来什么要**到了**才知道。出发时就定死内容的话，
 *    "抽事件"这件事根本没有地方发生。
 *
 * ⚠️ 所以鸟身上**不再记 `contentId`**（`Bird` 上那个字段一起删了）。
 *    老存档里那只已经在飞的鸟身上还留着它 —— 被忽略，无副作用。
 */
export function sendBird(
  bird: Bird,
  landmark: Landmark,
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
    destinationId: landmark.id,
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

/** 纪念品的保质期：24 小时。过了就烂掉（除非花金币保留） */
const SOUVENIR_TTL_MS = 24 * 60 * 60 * 1000

/**
 * 拼一条纪念品。
 *
 * ★★ **只许有这一份** —— 以前"内容包来的"和"程序化插画来的"两处
 *    各拼了一遍这个对象（十来行、字段几乎一样），
 *    于是加字段（比如 `grade`）时极容易只加一处：
 *    表现就是"内容包的照片有等级、插画的照片没有"，而两边都不报错。
 */
function buildSouvenir(args: {
  birdSpecies: BirdSpeciesId
  now: number
  place: string
  distanceKm: number
  contentId: string
  type: TravelContentType
  title: string
  mediaUrl?: string
  textContent?: string
  credit?: PhotoCredit
  essay?: string
  grade?: TravelGrade
  /**
   * ★ 图与地方的关系 —— 只有**默认图**会带（见 `TravelSouvenir.match`）。
   *   必须一路抄到底，否则相册会把顶替图当实景显示。
   */
  match?: PhotoMatch
}): TravelSouvenir {
  return {
    id: `${args.birdSpecies}-${args.now}`,
    contentId: args.contentId,
    type: args.type,
    title: args.title,
    place: args.place,
    mediaUrl: args.mediaUrl,
    textContent: args.textContent,
    credit: args.credit,
    essay: args.essay,
    grade: args.grade,
    match: args.match,
    distanceKm: args.distanceKm,
    birdSpecies: args.birdSpecies,
    at: args.now,
    expiresAt: args.now + SOUVENIR_TTL_MS,
    kept: false,
    keepCost: KEEP_SOUVENIR_COST,
  }
}

/**
 * 结算一次归巢（v6）。
 *
 * 规律：
 *   · 亲密度每次 +3，只涨不跌
 *   · **到了才抽事件**：拍照 → 这个景点的一张图；笑话/音乐/格言 → 各自的池子
 *     ★ 抽不到东西时会**退回拍照**，拍照没图还有程序化插画兜底 ——
 *       总之尽量不出现"这次什么都没带回来"
 *   · 种子概率降低到 50%（v6：防止地图点得太快）
 *   · 有概率额外掉一张卡（source: 'travel'）
 *
 * ⚠️ 老存档里"已经在飞、但身上没记 destinationId"的鸟结算不出纪念品 ——
 *    这是可接受的降级（鸟几小时内就回来了）。**别为此加兜底分支**：
 *    兜底只能编一个地点出来，编出来的坐标会让鸟落到海里。
 */
export function resolveReturn(
  bird: Bird,
  now: number,
  opts: { rng: () => number; owned: OwnedCard[]; home?: HomePoint | null; seen?: string[] },
): ReturnResult {
  if (!birdReady(bird, now)) {
    return { bird, drops: [], coins: 0, seed: false }
  }

  const { rng, owned, home, seen = [] } = opts
  const sp = speciesById(bird.species)

  const dest = bird.destinationId ? landmarkById(bird.destinationId) : undefined

  const hasLetter = rng() < 0.35

  // v6：生成纪念品（阅后即毁）
  let souvenir: TravelSouvenir | undefined
  if (dest) {
    const distanceKm = distanceToLandmark(dest, home)

    /*
     * ★★ 到了才抽事件（家长原话：「到了旅游点 判断会产生什么事件」）。
     *
     *    抽中的类型决定带回什么：
     *      拍照            → 这个景点的一张图（没配图就走下面的程序化插画）
     *      笑话/音乐/格言  → 各自池子里的一条（按地标优先，缺了退全局）
     *
     *    ⚠️ 池子落空时 `rollArrivalEvent` **已经把它退回成拍照**了
     *       （`fellBack` 标着），所以这里不用再兜一遍。
     */
    const ev = rollArrivalEvent({ landmarkId: dest.id, exclude: seen, rng })

    if (ev.item) {
      souvenir = buildSouvenir({
        birdSpecies: sp.id,
        now,
        place: dest.name,
        distanceKm,
        contentId: ev.item.id,
        type: ev.item.kind,
        title: ev.item.title,
        mediaUrl: ev.item.mediaUrl,
        textContent: ev.item.textContent,
        credit: ev.item.credit,
        essay: ev.item.essay,
        // ★ 等级必须从池子**抄下来**：相册显示的是纪念品，
        //   不抄的话池子里标了「传世」、相册按最低档上色（静默降级）。
        grade: ev.item.grade,
      })
    } else if (ev.photo) {
      souvenir = buildSouvenir({
        birdSpecies: sp.id,
        now,
        place: dest.name,
        distanceKm,
        contentId: ev.photo.id,
        type: 'photo',
        title: ev.photo.title,
        mediaUrl: ev.photo.mediaUrl,
        credit: ev.photo.credit,
        essay: ev.photo.essay,
        grade: ev.photo.grade,
        /*
         * ★ 同上，`match` 也要抄 —— 默认图里那条 `scene` 是靠它传到相册的。
         *   ⚠️ 内容包（家长手挑）**不写** `match` → 抄下来是 `undefined`，
         *      界面据此**什么都不显示**（不是显示"示意图"）。
         */
        match: ev.photo.match,
      })
    }
  }

  /*
    ★ 拍照事件、但这个景点**还没配图** → 程序化插画（按鸟的品种给概率）。

    ⚠️ 这条路径**必须留着** —— 全库 1808 个地标，配了图的只有极少数，
       删掉它就会变成"这次什么都没带回来"，那是最糟的结果。
    ★ 它现在的定位变了：以前是"没有内容包时的兜底"，
      现在是"**抽中了拍照但这个地方没图**"的兜底 —— 更常见，所以更重要。
  */
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
      souvenir = buildSouvenir({
        birdSpecies: sp.id,
        now,
        place: photo.place ?? dest.name,
        distanceKm: photo.distanceKm ?? 0,
        contentId: '',
        type: 'photo',
        title: photo.place ?? dest.name,
        mediaUrl: photo.photoUrl,
        credit: photo.credit,
        essay: photo.essay,
      })
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
