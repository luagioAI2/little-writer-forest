/* ============================================================
   旅行 / 地图 —— 地标、照片、发芽
   ============================================================

   玩法：小鸟飞出去旅行，带回来一张照片和一颗种子；
   种子落在地标上发芽，一点一点点亮整张中国地图。

   设计原则（和抽卡同源）：
     · 优先去**还没去过**的地方 —— 总去同一个地标会让人泄气，
       集齐地图的乐趣在于"下一个总是新的"。
     · 越远越稀有的地方（tier 越高）越难被抽到，但奖励也更特别。

   地图合规说明：
     这里收录的全是公众熟知的风景 / 人文地标，
     不含任何军事设施、限制区域或敏感地点；坐标只取公开的
     景区位置，且采用 GCJ-02（与腾讯地图一致）以免地图页偏移。

   时间一律由外部传入（now），模块内不调用 Date.now()。
   ============================================================ */

import type {
  BirdSpeciesId,
  HomePoint,
  Landmark,
  PhotoScene,
  Sprout,
  TravelPhoto,
} from './types'
import { LANDMARK_SEEDS, toLandmark } from '../data/landmarks'
import { haversineKm, resolveHomePoint } from './geo'

/* ============================================================
   一、地标表
   ============================================================ */

/** 照片配色 [天, 地]，取自 theme.css 的扁平色板 */
const PALETTE: Record<PhotoScene, [string, string]> = {
  city: ['#deecf5', '#d5dad5'],
  temple: ['#f9eed6', '#eebf9c'],
  mountain: ['#deecf5', '#b6bdb7'],
  water: ['#bdd8e9', '#90b9d4'],
  coast: ['#bdd8e9', '#f7dfca'],
  grass: ['#deecf5', '#93c0a6'],
  desert: ['#f1dba9', '#eebf9c'],
  forest: ['#deecf5', '#609f7d'],
  snow: ['#deecf5', '#e7eae6'],
  cave: ['#d5dad5', '#7b837d'],
}

/**
 * 全部地标。
 *
 * ★ 数据在 `src/data/landmarks.json` —— 这个文件只负责**补上 palette**。
 *   为什么 palette 不写进数据：它属于「画面怎么画」，跟上面的 `PALETTE`
 *   表是同一件事；一两千条数据里各写一份配色，改一次配色要改一千处，
 *   而且迟早漂移（MEMORY §四：同一个判定只许有一个来源）。
 */
export const LANDMARKS: Landmark[] = LANDMARK_SEEDS.map((seed) => ({
  ...toLandmark(seed),
  palette: PALETTE[seed.scene],
}))

/** 按 id 查地标 */
export function landmarkById(id: string): Landmark | undefined {
  return LANDMARKS.find((l) => l.id === id)
}

/**
 * 从家到某个地标的距离（公里）。
 *
 * ★★ 2026-09-25 新加的：鸟现在飞向**地标**，不是飞向某条内容
 *    （见 `travelEvents.ts` 开头）。距离是这个地点的属性，不用等鸟回来。
 *
 * ⚠️ 「家」的判定**不在这里** —— 一律走 `resolveHomePoint()`。
 *    那是唯一决定基准点的地方（没设置 / 值不合法 → 深圳），
 *    在别处再写一遍 `home && isUsablePoint(home) ? ... : ...`
 *    就是第二个实现，迟早跟它分叉。
 *
 * ★★ 为什么这两道守卫缺一不可（原来写在 `distanceToContent` 上，搬过来的）：
 *
 *    ① **没传 home 时退回深圳**，不是返回 0。
 *       `Settings.homePoint` 是**可选**的 —— 全新装好的 App 上它就是
 *       `undefined`。丢了这道守卫，孩子每一次派鸟都会看到
 *       「飞了 **0** 公里」，而且界面上完全看不出这是错的。
 *
 *    ② **坏 home 要被挡住**。调用方塞进来的是**存档里的值**，
 *       可能来自以后某个版本的 GPS，而 **(0, 0) 是定位失败的经典产物**
 *       （几内亚湾）。不挡的话孩子会看到「飞了 12179 公里」。
 *
 *    设置页显示一次、这里算的时候再挡一次 ——
 *    因为存档里的值可以绕过入口。
 */
export function distanceToLandmark(landmark: Landmark, home?: HomePoint | null): number {
  return haversineKm(resolveHomePoint(home), landmark)
}

/** 取某一档的全部地标 */
export function landmarksByTier(tier: 1 | 2 | 3): Landmark[] {
  return LANDMARKS.filter((l) => l.tier === tier)
}

/* ============================================================
   二、目的地选择
   ============================================================ */

/** 各档的基础权重：越远越稀有 */
const TIER_WEIGHT: Record<1 | 2 | 3, number> = { 1: 6, 2: 3, 3: 1.5 }

export interface PickDestinationOpts {
  /** 出发地（上一次的目的地），不会再被选中 */
  from?: string
  /** 已经去过的地标，优先避开 */
  exclude?: string[]
  /** >1 时更倾向去远处，<1 时更倾向近处 */
  tierBias?: number
  rng: () => number
}

/**
 * 挑一个旅行目的地。
 *
 * 优先挑**还没去过**的地方 —— 和抽卡同一个哲学：
 * 努力之后总是撞见同一个地方，是最让人泄气的事。
 * 只有当所有地方都去过之后，才允许重复。
 */
export function pickDestination(opts: PickDestinationOpts): Landmark {
  const { from, exclude = [], tierBias = 1, rng } = opts
  const banned = new Set(exclude)
  if (from) banned.add(from)

  let pool = LANDMARKS.filter((l) => !banned.has(l.id))
  if (pool.length === 0) pool = LANDMARKS

  const bias = Math.max(0.1, tierBias)
  const weighted = pool.map((l) => ({
    l,
    w: TIER_WEIGHT[l.tier] * Math.pow(bias, l.tier - 1),
  }))
  const total = weighted.reduce((a, b) => a + b.w, 0)
  let roll = rng() * total
  for (const it of weighted) {
    roll -= it.w
    if (roll <= 0) return it.l
  }
  return weighted[weighted.length - 1].l
}

/* ============================================================
   三、飞行时间与照片
   ============================================================ */

/** 飞行时长：档位决定基础时间，小鸟速度越快越早回来 */
export function travelDurationMs(landmark: Landmark, birdSpeed: number): number {
  const baseMin = landmark.tier === 1 ? 25 : landmark.tier === 2 ? 55 : 110
  const speed = birdSpeed > 0 ? birdSpeed : 1
  return Math.round((baseMin * 60_000) / speed)
}

/** 每种画面配几句给孩子看的描述 */
const SCENE_LINES: Record<PhotoScene, string[]> = {
  mountain: [
    '山尖上还挂着一小片没化的云',
    '石头一层一层，像谁叠起来的大书',
    '爬到半山腰，风就凉下来了',
  ],
  water: [
    '水面像一面没睡醒的镜子',
    '水是绿的，绿得像含了一颗糖',
    '有只小船划过，把倒影轻轻推开了',
  ],
  city: [
    '楼房的灯一盏一盏亮起来，像撒了一把星星',
    '街上的人走来走去，谁也没发现我',
    '屋顶挨着屋顶，一直排到天边',
  ],
  desert: [
    '沙子被风吹出一道一道的波纹，像大海',
    '太阳把沙丘晒成了金色',
    '远远的地方，沙和天连在了一起',
  ],
  forest: [
    '树太高了，抬头只看见一小块天空',
    '林子里静得能听见自己的心跳',
    '阳光从叶子缝里漏下来，落成一地碎金',
  ],
  snow: [
    '白茫茫一片，安静得像世界盖上了棉被',
    '雪把所有的声音都吸走了',
    '树上结着霜，像开了一树的白花',
  ],
  temple: [
    '屋顶的角翘起来，像要飞走一样',
    '钟声慢慢散开，把整个下午都敲软了',
    '墙上的颜色旧了，可是很好看',
  ],
  coast: [
    '海浪一遍一遍地跑上岸，又退回去',
    '沙滩上有一串脚印，不知道是谁的',
    '海风吹过来，咸咸的',
  ],
  grass: [
    '草一直长到天边，风一吹就起了浪',
    '有一群羊，像落在绿毯子上的棉花',
    '躺在草地上，天空大得吓人',
  ],
  cave: [
    '洞里凉凉的，说话会有回音',
    '灯光照在石壁上，像照进了另一个世界',
    '头顶垂下来的石头，一千年才长一点点',
  ],
}

/** 一句温暖的、孩子看得懂的照片配文 */
export function photoCaption(landmark: Landmark, birdName: string, rng: () => number): string {
  const lines = SCENE_LINES[landmark.scene]
  const idx = Math.min(lines.length - 1, Math.floor(rng() * lines.length))
  return `${birdName}从${landmark.name}带回来一张照片：${lines[idx]}。`
}

export interface MakePhotoOpts {
  landmark: Landmark
  birdSpecies: BirdSpeciesId
  /** 小鸟的名字，用于配文 */
  birdName: string
  at: number
  rng: () => number
  /** 调用方算好的公里数（可选） */
  distanceKm?: number
}

/**
 * 造一张**程序化**照片：一条配文，没有真实图片。
 *
 * ⚠️ 2026-09-24 起这里**不再接内容包** —— 内容包那条路改走
 *    `TravelContent` → `TravelSouvenir`（见 `pets.ts` 的 `resolveReturn`）。
 *    所以这个函数现在的唯一职责是「**没有内容包时**别让孩子空手而归」：
 *    界面上会画一张程序化插画 + 一句话配文。
 *
 * ★ 这条路**必须留着**：内容包是靠人一条条填的，1800 个地标里
 *   绝大多数在很长一段时间里都会是空的 —— 删了它，小鸟飞一趟
 *   就真的什么都不带回来。
 */
export function makePhoto(opts: MakePhotoOpts): TravelPhoto {
  const { landmark, birdSpecies, birdName, at, rng, distanceKm } = opts

  const base: TravelPhoto = {
    id: `ph-${landmark.id}-${at}-${Math.floor(rng() * 1_000_000)}`,
    landmarkId: landmark.id,
    birdSpecies,
    at,
    caption: photoCaption(landmark, birdName, rng),
  }

  return distanceKm !== undefined ? { ...base, distanceKm } : base
}

/* ============================================================
   四、发芽与地图进度
   ============================================================ */

/**
 * 在地标上种下一颗种子：没有就新建（1 级），有了就升级（最高 3 级）。
 *
 * 「树越多，长得越快」的落实点：森林规模够大时，一次旅行能让
 * 幼苗连跳两级 —— 让已经铺开地图的孩子更快看到整片森林亮起来。
 *
 * byBird 可以省略：树上自己掉下来的树种没有鸟送（见 store.harvestTree），
 * 但发芽这件事和"谁带来的"无关。
 */
export function sproutAt(
  state: Sprout[],
  landmarkId: string,
  now: number,
  treeCount: number,
  byBird?: BirdSpeciesId,
): Sprout[] {
  const step = treeCount >= 8 ? 2 : 1
  const idx = state.findIndex((s) => s.landmarkId === landmarkId)

  if (idx >= 0) {
    const cur = state[idx]
    const stage = Math.min(3, cur.stage + step)
    if (stage === cur.stage) return state // 已满级，不动
    const next = state.slice()
    next[idx] = { ...cur, stage, at: now }
    return next
  }

  return [...state, { landmarkId, at: now, byBird, stage: 1 }]
}

/** 已经发芽的地标 id */
export function sproutedIds(sprouts: Sprout[]): string[] {
  return [...new Set(sprouts.map((s) => s.landmarkId))]
}

/** 发芽的地标数量（去重，防止同一点被重复计入） */
export function sproutCount(sprouts: Sprout[]): number {
  return sproutedIds(sprouts).length
}

/* ---------------- 把树种种下去 ---------------- */

/**
 * 挑一个最该种树种的地方。
 *
 * 两级规则：
 *   ① 优先没发过芽的地标（还带 tier 权重，近处更容易中）——
 *      和抽卡同一个哲学：下一个总是新的才有意思。
 *   ② 整张地图都发过芽了，就挑长得**最矮**的那一批。
 *      为什么不直接随机：同一批树种里两颗砸在同一个地方，
 *      第二颗就白掉了，孩子看不出"我又点亮了一处"。
 */
function seedDestination(sprouts: Sprout[], rng: () => number): Landmark {
  const stageOf = new Map(sprouts.map((s) => [s.landmarkId, s.stage]))
  const fresh = LANDMARKS.some((l) => !stageOf.has(l.id))
  if (fresh) return pickDestination({ exclude: sproutedIds(sprouts), rng })

  let min = Number.POSITIVE_INFINITY
  for (const l of LANDMARKS) min = Math.min(min, stageOf.get(l.id) ?? 0)
  const pool = LANDMARKS.filter((l) => (stageOf.get(l.id) ?? 0) === min)
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
}

export interface PlantResult {
  sprouts: Sprout[]
  /** 种到了哪些地方 —— 界面要告诉孩子，不然树种等于凭空消失 */
  planted: { landmarkId: string; name: string }[]
}

/**
 * 把树上掉下来的树种种到地图上。
 *
 * 为什么单独有这个函数：树种是**树上结出来的**，不是小鸟带回来的
 * （见 store.harvestTree）。以前收下来之后什么都没发生，
 * 树种凭空消失；现在它和「小鸟带回的种子」走同一套发芽逻辑，
 * 区别只是没有 byBird。
 *
 * count 为 0 时原样返回，不产生任何写入 —— 收树这件事大部分时候
 * 是收金币，不能因为"顺手"就多写一次库。
 */
export function plantSeeds(
  state: Sprout[],
  count: number,
  now: number,
  rng: () => number,
): PlantResult {
  const n = Math.max(0, Math.floor(count))
  let sprouts = state
  const planted: { landmarkId: string; name: string }[] = []

  for (let i = 0; i < n; i += 1) {
    const dest = seedDestination(sprouts, rng)
    sprouts = sproutAt(sprouts, dest.id, now, sproutCount(sprouts))
    planted.push({ landmarkId: dest.id, name: dest.name })
  }

  return { sprouts, planted }
}

export interface MapProgress {
  lit: number
  total: number
  percent: number
}

/** 地图点亮进度 */
export function mapProgress(sprouts: Sprout[]): MapProgress {
  const lit = sproutCount(sprouts)
  const total = LANDMARKS.length
  return { lit, total, percent: total === 0 ? 0 : Math.round((lit / total) * 100) }
}

/** 去过的省份（去重、排序） */
export function exploredProvinces(sprouts: Sprout[]): string[] {
  const provinces = new Set<string>()
  for (const s of sprouts) {
    const lm = landmarkById(s.landmarkId)
    if (lm) provinces.add(lm.province)
  }
  return [...provinces].sort()
}
