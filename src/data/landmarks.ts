/* ============================================================
   旅游库 —— 加载器
   ============================================================

   数据本身在 `landmarks.json`（**只有数据，没有逻辑**）。
   这个文件负责三件事：类型、校验、把数据拼成 `Landmark`。

   ------------------------------------------------------------
   为什么数据要独立成 JSON

     · 家长要一个「编辑入库」的网页工具 —— 改完导出 JSON 贴回来，
       这条路要求数据是**纯数据**，不能混着 `PALETTE[scene]` 这种代码。
     · 库的规模是**一两千条**。写在 .ts 里，`travel.ts` 会变成
       上万行，没人看得下去，diff 也没法看。
     · JSON 能在构建时校验（见下面的 `assertLandmarks`），
       写错一个字母不会静默消失 —— 这一点是跟题库那条通道学的
       （`travelStories.ts` 里那条教训：landmarkId 写错，
       内容永远没机会被带回来，而且**不报错**）。

   ------------------------------------------------------------
   `scene` 与 `palette` 的关系（重要）

     旧写法是每条地标手写一份 `palette: ['#deecf5', '#d5dad5']`。
     35 条能手调，一两千条不可能。

     所以：**数据里只写 `scene`（一个词），palette 由它推出来**。
     `PALETTE` 表留在 `travel.ts`，一处定义，全库共用。

   ------------------------------------------------------------
   `tier` 说明

     `tier` 是**旧玩法**的产物 —— 当时靠它加权随机挑目的地。
     改成按距离分档之后（见 `travelRange.ts`），**它不再影响选点**，
     只剩「树上掉的树种往哪儿落」还在用（`seedDestination`）。

     所以它在数据里是**可选**的，缺省按 1 处理。
     新加条目不用再纠结该给几档。
   ============================================================ */

import type { Landmark, PhotoScene } from '../domain/types'
import raw from './landmarks.json'
import rawGd from './landmarks-gd.json'

/** JSON 里一条数据长什么样 —— 刻意比 `Landmark` 少一个 `palette` */
export interface LandmarkSeed {
  id: string
  name: string
  /** 省 / 自治区 / 直辖市 / 特别行政区。国外条目填国家名 */
  province: string
  /** 国家。中国条目可省略（默认「中国」） */
  country?: string
  /** 地级市（只有广东那批生成数据有）。用来分组显示、也方便网页工具筛 */
  city?: string
  /** GCJ-02 经纬度（国内与腾讯地图一致；国外为 WGS-84，差异可忽略） */
  lng: number
  lat: number
  /** 一句话介绍，孩子看得懂 */
  blurb: string
  /** 画面类型 —— palette 由它推出 */
  scene: PhotoScene
  /**
   * ★ 「评级」= 国家 A 级旅游景区等级（5A / 4A）。
   *
   * ⚠️ **只有评到级的条目才有这个字段** —— 景区评级是发给"景区"的，
   * 而库里还有山峰、海滩、步行街、古村这些**本来就不是景区**的地方。
   * 所以缺这个字段**不等于**"数据不全"，别在界面上显示成「暂无评级」。
   *
   * ⚠️ 来源是官方名录（`scripts/gd-a-level.json`，5A 16 家 / 4A 172 家），
   * 不是 OSM —— OSM 里只有 7/819 条带 `tourism:level:CN`，靠它一条都评不全。
   *
   * ⚠️ 跟下面的 `tier` **不是一回事**：`tier` 是旧玩法的稀有度（可省略、默认 1），
   * `rating` 是官方称号。两个都别拿去当对方用。
   */
  rating?: '5A' | '4A'
  /** 旧玩法的稀有度，只影响树种落点权重。可省略，默认 1 */
  tier?: 1 | 2 | 3
}

/* ============================================================
   ★★ 两个数据文件，**故意不合并**（授权不同）
   ============================================================

   `landmarks.json`     —— 手工精选（全国名胜；将来的「世界知名」也放这儿）
   `landmarks-gd.json`  —— **由 OSM 生成**，见 `scripts/fetch-landmarks.mjs`

   ⚠️⚠️ 为什么必须分文件：后者是 OSM 的**衍生数据库**，受 **ODbL** 约束
   （要求署名「© OpenStreetMap 贡献者」，见设置页「关于」）；
   前者是我们自己整理的，不受它约束。
   混进同一个文件之后，**就再也说不清哪些条目受 ODbL 管了**。

   ⚠️ 两个文件共用一套 `id` 空间，所以生成侧的 id 一律带 `gd-` 前缀
   （`gd-w123456`）—— 撞 id 会被 `checkLandmarks` 挡下。
   ============================================================ */
const HAND_PICKED: LandmarkSeed[] = raw as LandmarkSeed[]

/**
 * ★ 生成侧是**带抬头的对象**（不是裸数组），抬头里是 ODbL 的许可与署名。
 *   这样数据被复制走时许可跟着走 —— 见 `scripts/fetch-landmarks.mjs`。
 *   `landmarks.test.ts` 会检查抬头还在。
 */
export const GD_LICENSE = rawGd as {
  license: string
  source: string
  attribution: string
  count: number
  items: LandmarkSeed[]
}
const GENERATED_GD: LandmarkSeed[] = GD_LICENSE.items

/** 全部地标数据（手工在前，生成的在后） */
export const LANDMARK_SEEDS: LandmarkSeed[] = [...HAND_PICKED, ...GENERATED_GD]

/** 全部合法的画面类型 —— 用来在校验里挡住拼错的 scene */
const SCENES: readonly PhotoScene[] = [
  'mountain',
  'water',
  'city',
  'desert',
  'forest',
  'snow',
  'temple',
  'coast',
  'grass',
  'cave',
]

export interface LandmarkIssue {
  /** 第几条（从 0 数） */
  index: number
  id: string
  why: string
}

/**
 * 校验旅游库。
 *
 * ★ 返回问题清单而不是直接 throw —— 因为要能同时报出**全部**问题，
 *   而不是修一个跑一次。构建脚本和单元测试都读这个返回值。
 *
 * 挡的是「会静默出错的」那几类，不是吹毛求疵：
 *   · id 重复      → 后者会被前者盖掉，内容悄悄少一条
 *   · 经纬度越界   → 地图上画到框外，或者距离算出天文数字
 *   · (0,0)        → 定位失败的经典产物，孩子会看到「飞了 12000 公里」
 *   · scene 拼错   → palette 取不到，插画变一片黑
 *   · 名字/介绍空  → 界面上渲染成空白
 */
export function checkLandmarks(list: readonly LandmarkSeed[]): LandmarkIssue[] {
  const issues: LandmarkIssue[] = []
  const seen = new Set<string>()

  list.forEach((l, index) => {
    const push = (why: string) => issues.push({ index, id: l.id ?? '(无 id)', why })

    if (!l.id) push('缺 id')
    else if (seen.has(l.id)) push(`id 重复：${l.id}`)
    else seen.add(l.id)

    if (!l.name) push('缺 name')
    if (!l.blurb) push('缺 blurb')

    if (!Number.isFinite(l.lng) || l.lng < -180 || l.lng > 180) push(`lng 越界：${l.lng}`)
    if (!Number.isFinite(l.lat) || l.lat < -90 || l.lat > 90) push(`lat 越界：${l.lat}`)
    if (Math.abs(l.lng) < 0.5 && Math.abs(l.lat) < 0.5) {
      push('坐标是 (0,0) —— 定位失败的产物，会让距离算出天文数字')
    }

    if (!SCENES.includes(l.scene)) push(`scene 不认识：${l.scene}`)
  })

  return issues
}

/** 校验并抛错 —— 给测试和构建脚本用的严格版本 */
export function assertLandmarks(list: readonly LandmarkSeed[] = LANDMARK_SEEDS): void {
  const issues = checkLandmarks(list)
  if (issues.length === 0) return
  const lines = issues.slice(0, 20).map((i) => `  #${i.index} ${i.id}：${i.why}`)
  const more = issues.length > 20 ? `\n  …还有 ${issues.length - 20} 条` : ''
  throw new Error(`旅游库有问题（共 ${issues.length} 条）：\n${lines.join('\n')}${more}`)
}

/**
 * 数据 → `Landmark`。
 *
 * ★ `palette` 不在这里推 —— 它属于「画面怎么画」，跟 `travel.ts`
 *   的 `PALETTE` 表是一件事，放那边避免两处各写一遍配色。
 *   这里只做**补默认值**这一件事。
 */
export function toLandmark(seed: LandmarkSeed): Omit<Landmark, 'palette'> {
  return {
    id: seed.id,
    name: seed.name,
    province: seed.province,
    country: seed.country ?? '中国',
    city: seed.city,
    lng: seed.lng,
    lat: seed.lat,
    blurb: seed.blurb,
    tier: seed.tier ?? 1,
    rating: seed.rating,
    scene: seed.scene,
  }
}
