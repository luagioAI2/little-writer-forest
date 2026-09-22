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
  Landmark,
  PhotoScene,
  Sprout,
  TravelPhoto,
  TravelStory,
} from './types'

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

export const LANDMARKS: Landmark[] = [
  /* ---- tier 1：最容易去、最出名 ---- */
  {
    id: 'tiananmen',
    name: '天安门广场',
    province: '北京',
    lng: 116.3975,
    lat: 39.9087,
    blurb: '世界上最大的城市广场之一，每天清晨都有很多人来看升旗。',
    tier: 1,
    palette: PALETTE.city,
    scene: 'city',
  },
  {
    id: 'gugong',
    name: '故宫博物院',
    province: '北京',
    lng: 116.3972,
    lat: 39.9163,
    blurb: '红墙黄瓦的大宫殿，以前是皇帝住的地方，现在谁都可以进去看。',
    tier: 1,
    palette: PALETTE.temple,
    scene: 'temple',
  },
  {
    id: 'badaling',
    name: '八达岭长城',
    province: '北京',
    lng: 116.0167,
    lat: 40.3563,
    blurb: '长城像一条巨龙趴在山上，一眼望不到头。',
    tier: 1,
    palette: PALETTE.mountain,
    scene: 'mountain',
  },
  {
    id: 'xihu',
    name: '西湖',
    province: '浙江',
    lng: 120.145,
    lat: 30.245,
    blurb: '晴天好看，下雨也好看，古人为它写了数不清的诗。',
    tier: 1,
    palette: PALETTE.water,
    scene: 'water',
  },
  {
    id: 'huangshan',
    name: '黄山',
    province: '安徽',
    lng: 118.1667,
    lat: 30.1333,
    blurb: '奇形怪状的松树长在石头缝里，云在脚下滚来滚去。',
    tier: 1,
    palette: PALETTE.mountain,
    scene: 'mountain',
  },
  {
    id: 'guilin',
    name: '桂林山水',
    province: '广西',
    lng: 110.29,
    lat: 25.27,
    blurb: '一座座小山从江边冒出来，倒影在水里像画。',
    tier: 1,
    palette: PALETTE.water,
    scene: 'water',
  },
  {
    id: 'taishan',
    name: '泰山',
    province: '山东',
    lng: 117.1,
    lat: 36.25,
    blurb: '古人说"登泰山而小天下"，爬上去真的会觉得世界变小了。',
    tier: 1,
    palette: PALETTE.mountain,
    scene: 'mountain',
  },
  {
    id: 'bingmayong',
    name: '秦始皇兵马俑',
    province: '陕西',
    lng: 109.27,
    lat: 34.38,
    blurb: '地下站着一支石头做的军队，每个人的脸都不一样。',
    tier: 1,
    palette: PALETTE.temple,
    scene: 'temple',
  },
  {
    id: 'zhuozhengyuan',
    name: '拙政园',
    province: '江苏',
    lng: 120.63,
    lat: 31.32,
    blurb: '江南园林的代表，走一步换一个景，走廊都拐得很讲究。',
    tier: 1,
    palette: PALETTE.city,
    scene: 'city',
  },
  {
    id: 'waitan',
    name: '上海外滩',
    province: '上海',
    lng: 121.49,
    lat: 31.24,
    blurb: '一边是旧时候的洋楼，一边是亮闪闪的高楼，隔江对望。',
    tier: 1,
    palette: PALETTE.city,
    scene: 'city',
  },

  /* ---- tier 2：要飞得远一点 ---- */
  {
    id: 'zhangjiajie',
    name: '张家界',
    province: '湖南',
    lng: 110.4791,
    lat: 29.1171,
    blurb: '一根根石柱直直地立着，雾一飘上来就像仙境。',
    tier: 2,
    palette: PALETTE.mountain,
    scene: 'mountain',
  },
  {
    id: 'emeishan',
    name: '峨眉山',
    province: '四川',
    lng: 103.33,
    lat: 29.52,
    blurb: '山很高，山顶有金色的佛像，云海像铺开的棉花。',
    tier: 2,
    palette: PALETTE.mountain,
    scene: 'mountain',
  },
  {
    id: 'tianyahaijiao',
    name: '天涯海角',
    province: '海南',
    lng: 109.5,
    lat: 18.25,
    blurb: '海边立着两块大石头，古人觉得这里就是世界的尽头。',
    tier: 2,
    palette: PALETTE.coast,
    scene: 'coast',
  },
  {
    id: 'lijiang',
    name: '丽江古城',
    province: '云南',
    lng: 100.23,
    lat: 26.87,
    blurb: '小桥流水绕着一座座老房子，石板路被踩得亮亮的。',
    tier: 2,
    palette: PALETTE.city,
    scene: 'city',
  },
  {
    id: 'hulunbuir',
    name: '呼伦贝尔草原',
    province: '内蒙古',
    lng: 119.76,
    lat: 49.21,
    blurb: '草一直长到天边，牛羊像撒在绿毯子上的小点。',
    tier: 2,
    palette: PALETTE.grass,
    scene: 'grass',
  },
  {
    id: 'pingyao',
    name: '平遥古城',
    province: '山西',
    lng: 112.17,
    lat: 37.2,
    blurb: '整座城都是老样子，城墙、票号、灯笼，像走进了从前。',
    tier: 2,
    palette: PALETTE.city,
    scene: 'city',
  },
  {
    id: 'gulangyu',
    name: '鼓浪屿',
    province: '福建',
    lng: 118.07,
    lat: 24.44,
    blurb: '小岛上没有汽车，只有琴声、老别墅和拐来拐去的小路。',
    tier: 2,
    palette: PALETTE.coast,
    scene: 'coast',
  },
  {
    id: 'qinghaihu',
    name: '青海湖',
    province: '青海',
    lng: 100.15,
    lat: 36.89,
    blurb: '湖水蓝得不像话，夏天岸边会开满黄色的油菜花。',
    tier: 2,
    palette: PALETTE.water,
    scene: 'water',
  },
  {
    id: 'hukou',
    name: '壶口瀑布',
    province: '山西',
    lng: 110.47,
    lat: 36.15,
    blurb: '黄河的水一下子挤进窄口，轰隆隆地吼，水花溅得老高。',
    tier: 2,
    palette: PALETTE.water,
    scene: 'water',
  },
  {
    id: 'riyuetan',
    name: '日月潭',
    province: '中国台湾',
    lng: 120.91,
    lat: 23.86,
    blurb: '湖水一半圆圆的像太阳，一半弯弯的像月亮，中间有小岛。',
    tier: 2,
    palette: PALETTE.water,
    scene: 'water',
  },
  {
    id: 'weiduoliya',
    name: '维多利亚港',
    province: '中国香港',
    lng: 114.1694,
    lat: 22.2793,
    blurb: '晚上两岸的灯一起亮起来，把海面照成了彩色。',
    tier: 2,
    palette: PALETTE.city,
    scene: 'city',
  },
  {
    id: 'dasanba',
    name: '大三巴牌坊',
    province: '中国澳门',
    lng: 113.54,
    lat: 22.197,
    blurb: '一座教堂只留下了一面前壁，站在台阶上能望到很远。',
    tier: 2,
    palette: PALETTE.city,
    scene: 'city',
  },
  {
    id: 'huangguoshu',
    name: '黄果树瀑布',
    province: '贵州',
    lng: 105.67,
    lat: 25.99,
    blurb: '大水从高处铺下来，像挂了一幅会响的白布。',
    tier: 2,
    palette: PALETTE.water,
    scene: 'water',
  },

  /* ---- tier 3：很远、很少能去 ---- */
  {
    id: 'jiuzhaigou',
    name: '九寨沟',
    province: '四川',
    lng: 103.918,
    lat: 33.26,
    blurb: '水是彩色的，蓝的绿的都有，落叶沉到湖底都看得见。',
    tier: 3,
    palette: PALETTE.water,
    scene: 'water',
  },
  {
    id: 'mingshashan',
    name: '敦煌鸣沙山',
    province: '甘肃',
    lng: 94.67,
    lat: 40.08,
    blurb: '金黄的沙丘围着一眼月牙形的泉，沙子被风一吹会嗡嗡响。',
    tier: 3,
    palette: PALETTE.desert,
    scene: 'desert',
  },
  {
    id: 'mogao',
    name: '莫高窟',
    province: '甘肃',
    lng: 94.8,
    lat: 40.04,
    blurb: '山崖上凿了很多洞，洞里画满了会飞的仙女。',
    tier: 3,
    palette: PALETTE.cave,
    scene: 'cave',
  },
  {
    id: 'budala',
    name: '布达拉宫',
    province: '西藏',
    lng: 91.117,
    lat: 29.6577,
    blurb: '红白相间的大宫殿建在山坡上，天蓝得像洗过一样。',
    tier: 3,
    palette: PALETTE.temple,
    scene: 'temple',
  },
  {
    id: 'daxinganling',
    name: '大兴安岭',
    province: '黑龙江',
    lng: 124.1,
    lat: 52.3,
    blurb: '一眼望不到边的林海，秋天会变成金黄和火红。',
    tier: 3,
    palette: PALETTE.forest,
    scene: 'forest',
  },
  {
    id: 'changbaishan',
    name: '长白山天池',
    province: '吉林',
    lng: 128.06,
    lat: 42.0,
    blurb: '火山口里积了一汪深蓝的湖水，山顶常年盖着雪。',
    tier: 3,
    palette: PALETTE.snow,
    scene: 'snow',
  },
  {
    id: 'daocheng',
    name: '稻城亚丁',
    province: '四川',
    lng: 100.33,
    lat: 28.43,
    blurb: '三座神山围着草甸和牛奶海，空气干净得能看很远。',
    tier: 3,
    palette: PALETTE.mountain,
    scene: 'mountain',
  },
  {
    id: 'xishuangbanna',
    name: '西双版纳',
    province: '云南',
    lng: 100.79,
    lat: 22.0,
    blurb: '热带雨林里树高得遮天，大象慢悠悠地穿过林子。',
    tier: 3,
    palette: PALETTE.forest,
    scene: 'forest',
  },
  {
    id: 'kanasi',
    name: '喀纳斯湖',
    province: '新疆',
    lng: 87.02,
    lat: 48.7,
    blurb: '湖水会随着季节变色，两岸是白桦林和雪山的影子。',
    tier: 3,
    palette: PALETTE.water,
    scene: 'water',
  },
  {
    id: 'tianshan',
    name: '天山天池',
    province: '新疆',
    lng: 88.12,
    lat: 43.88,
    blurb: '雪峰脚下卧着一潭碧水，倒映着松树和蓝天。',
    tier: 3,
    palette: PALETTE.mountain,
    scene: 'mountain',
  },
  {
    id: 'shennongjia',
    name: '神农架',
    province: '湖北',
    lng: 110.67,
    lat: 31.74,
    blurb: '原始森林里藏着很多没见过的动植物，雾一起来像童话。',
    tier: 3,
    palette: PALETTE.forest,
    scene: 'forest',
  },
  {
    id: 'mohe',
    name: '漠河北极村',
    province: '黑龙江',
    lng: 122.36,
    lat: 53.47,
    blurb: '中国最北的村子，冬天能看到极光和漫天的星星。',
    tier: 3,
    palette: PALETTE.snow,
    scene: 'snow',
  },
]

/** 按 id 查地标 */
export function landmarkById(id: string): Landmark | undefined {
  return LANDMARKS.find((l) => l.id === id)
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
  /**
   * 内容包（可选）。
   *
   * 有内容包，这张照片就带上真实图片、散文和距离；
   * 没有，就退回程序化插画 + 一句话配文。
   * **两条路都必须走得通** —— 内容包是靠人一条条填的，
   * 地图上大部分地标在很长一段时间里都会是空的。
   */
  story?: TravelStory
  /** 内容包没手填距离时，由调用方算好的公里数 */
  distanceKm?: number
}

export function makePhoto(opts: MakePhotoOpts): TravelPhoto {
  const { landmark, birdSpecies, birdName, at, rng, story, distanceKm } = opts

  const base: TravelPhoto = {
    id: `ph-${landmark.id}-${at}-${Math.floor(rng() * 1_000_000)}`,
    landmarkId: landmark.id,
    birdSpecies,
    at,
    // 有内容包就用它那句摘要 —— 比程序化生成的配文具体得多
    caption: story
      ? `${birdName}从${story.place}带回来一张照片：${story.summary}`
      : photoCaption(landmark, birdName, rng),
  }

  if (!story) return base

  const km = distanceKm ?? story.distanceKm
  return {
    ...base,
    photoUrl: story.photoUrl,
    credit: story.credit,
    place: story.place,
    essay: story.essay,
    ...(km !== undefined ? { distanceKm: km } : {}),
  }
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
