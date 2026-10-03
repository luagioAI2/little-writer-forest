/* ============================================================
   旅行事件 —— 小鸟**到了**旅游点之后，先抽一个事件
   ============================================================
   ★ 数据在 `src/data/travel-event-contents.json`（各事件的池子）。

   ------------------------------------------------------------
   ★★ 为什么要跟"图片附件"分开（2026-09-25 家长定的）

     「到了旅游点 判断会产生什么事件，如果是拍照事件，
       则会从旅游点图里随机一张。笑话，音乐，格言，都有自己的列表库，随机。」

   ➜ 两件事被拆开了：

     · **这个景点长什么样** → `travel-contents.json`（图片附件，一个景点多张）
     · **这次来发生了什么** → 这里（事件类型 + 各类型的池子）

   合在一起的时候，每条图片记录都得重复写坐标和地名，而它们**已经漂了**
   （八达岭两条写了不同的经纬度）。

   ------------------------------------------------------------
   事件的权重（家长 2026-09-25 选的「拍照为主」）

     拍照 60% · 笑话 15% · 音乐 15% · 格言 10%

   ⚠️ 权重表在下面 `TRAVEL_EVENTS`，**只许有一份**。
      别在别处再写一遍"拍照是 60%"。
   ⚠️⚠️ 跟 `TravelGrade` 是两件事：等级**只做标注**、绝不参与概率；
      事件权重**真的**决定抽到什么。别把两者混起来。

   ------------------------------------------------------------
   ★ 池子怎么取（家长选的「按地标优先，缺了退全局」）

     1. 先在这个**地标自己的**条目里找（`landmarkId` 相同）
     2. 找不到 → 退到**全局条目**（`landmarkId` 为空，哪儿都能用）
     3. 还是没有 → 这个事件**落空**

   ★★ 落空怎么办：**退回拍照**（`fellBack` 会标出来）。
      为什么不重抽别的：重抽要循环、还可能连着落空；
      而拍照有程序化插画兜底，**一定能带回点什么** ——
      "这次什么都没带回来"是最糟的结果。
   ============================================================ */

import type {
  PhotoCredit,
  TravelContent,
  TravelContentType,
  TravelEventKind,
  TravelGrade,
} from './types'
import { gradeOf, pickPhotoForLandmark } from './travelContents'
import rawEvents from '../data/travel-event-contents.json'

/* ============================================================
   一、事件表
   ============================================================ */

export interface TravelEventDef {
  kind: TravelEventKind
  /** 给孩子看的名字 */
  label: string
  /** 相对权重（不是百分比，只要加起来是 100 就行） */
  weight: number
}

/**
 * ★★ 事件的权重表 —— **只许有这一份**。
 *
 * 家长 2026-09-25 选的「拍照为主」：拍照 60 / 笑话 15 / 音乐 15 / 格言 10。
 * ⚠️ 顺序无所谓（抽取按权重算），但**别在别处再抄一遍这些数字**。
 */
export const TRAVEL_EVENTS: TravelEventDef[] = [
  { kind: 'photo', label: '拍照', weight: 60 },
  { kind: 'joke', label: '笑话', weight: 15 },
  { kind: 'music', label: '音乐', weight: 15 },
  { kind: 'quote', label: '格言', weight: 10 },
]

/** 某个事件的中文名。查不到就退回 kind 本身（界面永远拿得到一个字符串） */
export function eventLabel(kind: TravelEventKind | string): string {
  return TRAVEL_EVENTS.find((e) => e.kind === kind)?.label ?? String(kind)
}

/**
 * 按权重抽一个事件。
 *
 * ★ 等概率抽是**另一件事**：这里读 `weight`，而且**必须**读。
 * ⚠️ 跟 `pickContentForLandmark`（抽图，等概率、不读 grade）别搞混。
 */
export function rollTravelEvent(rng: () => number): TravelEventDef {
  const total = TRAVEL_EVENTS.reduce((a, e) => a + Math.max(0, e.weight), 0)
  if (total <= 0) return TRAVEL_EVENTS[0]
  let roll = rng() * total
  for (const e of TRAVEL_EVENTS) {
    roll -= Math.max(0, e.weight)
    if (roll <= 0) return e
  }
  return TRAVEL_EVENTS[TRAVEL_EVENTS.length - 1]
}

/* ============================================================
   二、读池子
   ============================================================ */

/** JSON 里一条事件内容长什么样 */
export interface EventContentSeed {
  id: string
  /** ★ 可选：写了就只在这个景点出现；不写就是全局条目（哪儿都能用） */
  landmarkId?: string
  title: string
  grade?: string
  mediaUrl?: string
  textContent?: string
  credit?: { source: string; link: string; author?: string }
  summary?: string
  essay?: string
}

/** 归一之后的一条 */
export interface EventContent {
  id: string
  /** ★ 来自**池子的键**，不是条目里写的 —— 一个池子只放一种 */
  kind: TravelContentType
  landmarkId?: string
  title: string
  grade?: TravelGrade
  mediaUrl?: string
  textContent?: string
  credit?: PhotoCredit
  summary?: string
  essay?: string
}

interface RawEventsFile {
  pools?: Record<string, EventContentSeed[]>
}

const RAW = rawEvents as unknown as RawEventsFile

/**
 * 各池子。键 = 事件类型，值 = 归一后的条目。
 *
 * ⚠️ 键**只认 `TRAVEL_EVENTS` 里的那几个 + story / video**（后者是占位，
 *    还没接事件）。别的键会被丢掉，并且有一条测试守着"池子的键都在白名单里"。
 */
const KNOWN_POOL_KEYS: TravelContentType[] = ['photo', 'music', 'joke', 'video', 'quote', 'story']

export const EVENT_POOLS: Record<string, EventContent[]> = (() => {
  const out: Record<string, EventContent[]> = {}
  for (const [key, list] of Object.entries(RAW.pools ?? {})) {
    if (!KNOWN_POOL_KEYS.includes(key as TravelContentType)) continue
    out[key] = (list ?? []).map((seed) => ({
      id: seed.id,
      kind: key as TravelContentType,
      landmarkId: seed.landmarkId,
      title: seed.title,
      grade: gradeOf(seed.grade),
      mediaUrl: seed.mediaUrl,
      textContent: seed.textContent,
      credit: seed.credit,
      summary: seed.summary,
      essay: seed.essay,
    }))
  }
  return out
})()

/** 某个池子的全部条目（调试 / 编辑器用） */
export function eventPool(kind: string): EventContent[] {
  return EVENT_POOLS[kind] ?? []
}

/** 池子的原始 JSON —— 编辑器与守卫用 */
export const RAW_EVENT_POOLS: Record<string, EventContentSeed[]> = RAW.pools ?? {}

/* ============================================================
   三、取一条
   ============================================================ */

/**
 * 从某个池子里取一条：**按地标优先，缺了退全局**。
 *
 * ★ 优先级：
 *     ① 这个地标自己的（`landmarkId === landmarkId`）
 *     ② 全局条目（`landmarkId` 为空）—— 哪儿都能用
 *     ③ 都没有 → `undefined`（调用方负责退回拍照）
 *
 * ⚠️⚠️ **不会**拿"别的地标的条目"来凑。长城的笑话出现在西湖，
 *      孩子看不出来，家长一眼就看出来了 —— 那比"这次没抽到"糟得多。
 *
 * ★ 同一条优先没出现过的（`exclude` 传见过的 id）；都见过了允许重复。
 */
export function pickEventItem(
  kind: string,
  landmarkId: string,
  opts: { exclude?: string[]; rng: () => number },
): EventContent | undefined {
  const { exclude = [], rng } = opts
  const pool = EVENT_POOLS[kind]
  if (!pool || pool.length === 0) return undefined

  const mine = pool.filter((i) => i.landmarkId === landmarkId)
  const global = pool.filter((i) => !i.landmarkId)
  const scoped = mine.length > 0 ? mine : global
  if (scoped.length === 0) return undefined

  const fresh = scoped.filter((i) => !exclude.includes(i.id))
  const use = fresh.length > 0 ? fresh : scoped
  return use[Math.floor(rng() * use.length)]
}

/* ============================================================
   四、到达：抽事件 → 解析出到底带回了什么
   ============================================================ */

export interface ArrivalEvent {
  /** 最终生效的事件类型（落空时已经退回过拍照） */
  kind: TravelEventKind
  /**
   * 拍照事件：这个地标的一张图。
   *
   * ★★ **内容包优先，默认图兜底**（`pickPhotoForLandmark`，见 `travelContents.ts`）。
   *    只有**两样都没有**时才是 `undefined` → 调用方走程序化插画。
   */
  photo?: TravelContent
  /** 笑话 / 音乐 / 格言：池子里的一条 */
  item?: EventContent
  /** ★ 本来抽中的类型（`fellBack` 为 true 时有意义） */
  rolled: TravelEventKind
  /** ★ 本来抽中的是别的、但这个地标没有那个池子 → 退回了拍照 */
  fellBack: boolean
}

/**
 * 小鸟**到了**之后：抽事件 + 把内容解析出来。
 *
 * ★★ 这是「到达时才定」的落点（家长原话：「到了旅游点 判断会产生什么事件」）。
 *    不在出发时定，是因为池子可能在鸟飞的时候变了，
 *    而且出发时定就得把"这次带什么"写进鸟身上（多一个字段要迁移）。
 *
 * ⚠️ 拍照事件**不在这里**兜底程序化插画 —— 那是 `pets.ts` 的事
 *    （它才知道 `makePhoto` 和鸟的品种）。这里只负责"这个景点有没有图"：
 *    内容包 → 默认图 → 都没有才留空。
 *
 * ⚠️⚠️ 下面**两处**都调 `pickPhotoForLandmark`（不是 `pickContentForLandmark`）——
 *    "抽中拍照"和"池子落空退回拍照"是两条路，但**兜底必须一样**。
 *    只改一处的话，另一处会悄悄退回旧行为，而且**不报错**。
 */
export function rollArrivalEvent(opts: {
  landmarkId: string
  /** 已经见过的 contentId / 事件内容 id —— 优先避开 */
  exclude?: string[]
  rng: () => number
}): ArrivalEvent {
  const { landmarkId, exclude = [], rng } = opts
  const rolled = rollTravelEvent(rng).kind

  if (rolled === 'photo') {
    return {
      kind: 'photo',
      photo: pickPhotoForLandmark(landmarkId, { exclude, rng }),
      rolled,
      fellBack: false,
    }
  }

  const item = pickEventItem(rolled, landmarkId, { exclude, rng })
  if (item) return { kind: rolled, item, rolled, fellBack: false }

  /*
   * ★★ 落空 → 退回拍照。
   *    不重抽别的类型：重抽要循环、还可能连着落空；
   *    而拍照有程序化插画兜底，**一定能带回点什么**。
   *    "这次什么都没带回来"是最糟的结果。
   */
  return {
    kind: 'photo',
    photo: pickPhotoForLandmark(landmarkId, { exclude, rng }),
    rolled,
    fellBack: true,
  }
}
