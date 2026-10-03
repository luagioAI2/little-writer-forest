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

import type { Landmark, LandmarkFame, PhotoScene } from '../domain/types'
import { LANDMARK_INTRO_MAX } from '../domain/types'
import { fameOf } from './landmarkFame'
import raw from './landmarks.json'
import rawGd from './landmarks-gd.json'
import rawCn from './landmarks-cn.json'
import rawWorld from './landmarks-world.json'
import rawParked from './landmarks-4a.json'
import rawIntros from './landmark-intros.json'

/**
 * ★★ 景点公共简介：`landmarkId → 一段话`（≤ `LANDMARK_INTRO_MAX`）。
 *
 * 为什么**单独一个文件**，不并进那五个 `landmarks-*.json`：
 *   ① 那五个是**生成产物**（脚本跑出来的），手改会被下一次生成冲掉；
 *      简介是**人写的**，它的生命周期跟数据源完全不一样。
 *   ② 那五个是**条目列表**（一条地标一行），而简介是**覆盖层** ——
 *      只有少数景点写了，绝大多数没有，那才是正常状态。
 *      ⚠️ 硬塞进条目里，就要给 1600 多条各补一个空 `intro`，
 *         git diff 会整篇飘红，真正的改动藏在那堆噪音里（跟空 `credit` 那次一样）。
 *
 * ⚠️ 键是 **landmarkId**，打错一个字 = 这条简介**永远不显示** ——
 *    不报错、不崩、计数也不变。所以 `checkLandmarkIntros()` 专门查这一条。
 */
const LANDMARK_INTROS: Record<string, string> = rawIntros

/** JSON 里一条数据长什么样 —— 刻意比 `Landmark` 少一个 `palette` */
export interface LandmarkSeed {
  id: string
  name: string
  /** 省 / 自治区 / 直辖市 / 特别行政区。国外条目填国家名 */
  province: string
  /** 国家。中国条目可省略（默认「中国」） */
  country?: string
  /** 地级市（广东 OSM 那批与全国 A 级名录那批都有）。用来分组显示、也方便网页工具筛 */
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
   * ⚠️ 来源是**官方名录**（5A 来自文旅部；4A 来自聚合站），
   * 生成侧写在 `scripts/build-landmarks-cn.mjs` 与 `scripts/fetch-landmarks.mjs`。
   * 不是 OSM —— OSM 里只有 7/819 条带 `tourism:level:CN`，靠它一条都评不全。
   *
   * ⚠️ 跟下面的 `tier` **不是一回事**：`tier` 是旧玩法的稀有度（可省略、默认 1），
   * `rating` 是官方称号。两个都别拿去当对方用。
   */
  rating?: '5A' | '4A'
  /**
   * ★★ 「知名度」—— **我们自己判的**，跟官方 `rating` 分开。
   *
   * 为什么必须分开（家长 09-24 定）：家长原话是「知名景点，都做5A」，
   * 但拿库里手工那 35 条去比官方 357 条 5A 名单，**只有 18 条对得上** ——
   * 剩下的是天安门广场、上海外滩、桂林山水、呼伦贝尔草原这种
   * **本来就不是景区、永远评不上 A 级**，却人人知道的地方。
   * ➜ 硬写 `rating: '5A'` 会让那个字段**撒谎**；知名度是另一件事。
   *
   * 三档（家长选）：
   *   `世界知名` —— 长城 / 故宫 / 兵马俑 / 富士山 / 埃菲尔铁塔
   *   `全国知名` —— 西湖 / 黄山 / 张家界 / 九寨沟（5A 与全国叫得响的）
   *   `地方知名` —— 本地公园、县域景区（**这是兜底档，全库每条都有**）
   *
   * ⚠️ 与 `rating` 的关系是**有交集但不相等**：5A 多半是「全国知名」，
   *    但「全国知名」里有大量没有 A 级称号的（见上）。
   *    所以**别用其中一个推另一个**。
   * ⚠️ 与 `heat` 也不是一回事：`heat` 是**来源站的平台热度**（有人打卡点评），
   *    知名度是我们按"这个地名孩子听没听过"判的。
   */
  fame?: LandmarkFame
  /**
   * ★ 平台综合热度分（来源站自带的 `heatScore`）。
   *
   * ⚠️⚠️ **2026-09-24 之前这个字段是坏的**：`types.ts` 的 `Landmark` 里
   * 声明了它、注释还写着「5A 约 335/357 有、4A 的 top 1000 每条都有」，
   * 但实际 **0/1348 条有值**，而且 `toLandmark()` 压根没抄这个字段、
   * 全 App 也没有一处读它。原因是**数据生成早于代码**：
   * `landmarks-cn.json` 生成于 13:39，而带 heat 的抓取/生成脚本改于 17:10 ——
   * 盘上那份数据从来没跑过新代码。现在已重新生成。
   *
   * 没有就是"源里没有"，**不等于"数据不全"**。
   */
  heat?: number
  /** 旧玩法的稀有度，只影响树种落点权重。可省略，默认 1 */
  tier?: 1 | 2 | 3
}

/**
 * 知名度三档。★ 定义在 `domain/types.ts`（`data/` 已经 import 它，反过来引会成环），
 * 这里**只是转出去**方便 `data/` 侧引用 —— 千万别在这里再写一份，
 * 两处各写一份的枚举迟早会漂移（MEMORY §四）。
 */
export type { LandmarkFame }

/** 知名度三档，从高到低。★ 排序/比较只认这个顺序 */
export const FAME_ORDER: LandmarkFame[] = ['世界知名', '全国知名', '地方知名']

/* ============================================================
   ★★ 四个数据文件，**故意不合并**
   ============================================================

   `landmarks.json`        —— 手工精选（全国名胜，35 条）
   `landmarks-gd.json`  —— **由 OSM 生成**，见 `scripts/fetch-landmarks.mjs`
   `landmarks-cn.json`     —— **由官方 A 级名录生成**，见 `scripts/build-landmarks-cn.mjs`
   `landmarks-world.json`  —— **世界景点**（人挑 + 机器补坐标），见 `scripts/fetch-world-landmarks.mjs`

   ⚠️⚠️ 为什么必须分文件：
     ① **授权**：`landmarks-gd.json` 是 OSM 的**衍生数据库**，受 **ODbL** 约束
        （要求署名「© OpenStreetMap 贡献者」，见设置页「关于」）；
        另外两份是我们自己整理的，不受它约束；
        ⚠️ 但**世界那份的坐标有一部分也来自 OSM**（DBpedia 缺坐标时用 QID 去 OSM 补的），
        所以它也沾 ODbL —— 这是它必须独立成文件、抬头里写明许可的另一个理由。
        混进同一个文件之后，**就再也说不清哪些条目受 ODbL 管了**。
     ② **生成方式**：全国那份是"官方名录 + 模板文案"，广东那份是"OSM + 标签"。
        混在一起就分不清哪条是"人写的"、哪条是"机器生成的"。

   ⚠️ 三个文件共用一套 `id` 空间，所以生成侧的 id 一律带前缀
   （`gd-w123456` / `cn-湖南-岳麓山-橘子洲旅游区`）—— 撞 id 会被 `checkLandmarks` 挡下。

   ⚠️ 合并的**判据**在生成侧（`build-landmarks-cn.mjs`），但**动作在这里** ——
   与官方重名的手工/GD 条目**不能从原文件里删**（理由见下面 `SUPERSEDED_IDS` 那段），
   生成侧只把"谁被谁取代"记进抬头，由这里滤掉。**判据只有一份**。
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

/**
 * ★ 全国 A 级名录（1,348 条）—— 也是**带抬头的对象**。
 *   抬头里没有 ODbL 那种许可（数据来自文旅部官方名录 + 聚合站），
 *   但保留 `source`/`asOf`/`note` 交代出处与已知的坐标精度问题。
 *   ⚠️ 这里刻意**不叫 `_LICENSE`**：它不是许可声明，别让人误以为受某份协议约束。
 */
export const CN_SOURCE = rawCn as {
  source: string
  asOf: string
  count: number
  whyThisFileExists: string
  note: string
  /** ★★ 被全国名录**取代**的手工/GD 条目 id —— 见下面那段说明 */
  supersedes: string[]
  items: LandmarkSeed[]
}
const GENERATED_CN: LandmarkSeed[] = CN_SOURCE.items

/**
 * ★ 世界景点（约 230 条，覆盖 100+ 个国家/地区）—— 也是**带抬头的对象**。
 *
 * 抬头交代两件事，都是**必须跟着数据走**的：
 *   · **许可**：坐标一部分来自 OpenStreetMap（**ODbL**，要署名「© OpenStreetMap 贡献者」）；
 *     中文名/简介来自 DBpedia（**CC BY-SA**）。
 *   · **怎么来的**：「哪些算知名」是**人挑的**（`scripts/world-landmarks-seed.mjs`），
 *     坐标和图片是机器补的 —— 混起来就分不清哪条是"人写的"了。
 *
 * ⚠️ 这里**不叫 `_LICENSE`**（跟 `CN_SOURCE` 同理）：它不是一份协议，是几份来源的交代。
 * ⚠️ 跟国内那三份**共用一套 id 空间**（`world-<国家>-<名字>` 前缀），撞 id 会被 `checkLandmarks` 挡下。
 */
export const WORLD_SOURCE = rawWorld as {
  source: string
  license: string
  attribution: string
  whyThisFileExists: string
  fetchedAt: string
  count: number
  items: LandmarkSeed[]
}
const GENERATED_WORLD: LandmarkSeed[] = WORLD_SOURCE.items

/* ============================================================
   ★★ 「只留知名点」—— 被移出主库的那 1165 条
   ============================================================

   家长 2026-09-25：「帮我把 4A 的先单独出来。然后只保留 5A、知名点、世界知名的。」

   判定在 `landmarkFame.ts` 的 `fameOf()`（**唯一一份**）：
     保留 = `fameOf(seed) !== '地方知名'`；移出 = 其余。
   ⚠️ 这里**不再写一遍** `|| rating === '5A'` —— `fameOf` 里 5A 必然返回
      「全国知名」，再写一遍就是同一个判定的第二份实现（MEMORY §四）。

   ⚠️⚠️ 跟 `supersedes` 同一套机制、同一个理由：**不能从来源文件里删**。
     那四份是"来源给的"，被移出的条目完整存在 `landmarks-4a.json` 里，
     由下面 `PARKED_IDS` 机械地滤掉。
     ⭐ 想反悔：删掉那个文件就回到 1808 条 —— 不用重跑任何抓取。

   ⚠️ 名字叫 `4a` 是沿用家长的说法，但里面**不全是 4A**：
     1165 = 1006 条「4A 但只在本地方有名」+ 159 条广东那批没评级的。
     看每条自己的 `parkedWhy`，别按文件名想当然。
   ============================================================ */
/**
 * 移出名单里的一条 —— 就是普通种子，外加一个「为什么在外面」。
 *
 * ★ `parkedWhy` 是**生成侧加的**（`scripts/park-landmarks.ts`），不是来源给的。
 *   存在的理由：1165 条里其实混着两类（1006 条 4A + 159 条广东没评级的），
 *   只靠文件名分不出来 —— 复核的人得一眼看见"这条为什么被移出去"。
 */
export interface ParkedSeed extends LandmarkSeed {
  /** `4A-地方知名` | `无评级` */
  parkedWhy: string
}

export const PARKED_SOURCE = rawParked as {
  whyThisFileExists: string
  rule: string
  ruleNote: string
  asOf: string
  count: number
  composition: Record<string, number>
  sourceNote: string
  generatedBy: string
  items: ParkedSeed[]
}
const PARKED: ParkedSeed[] = PARKED_SOURCE.items

/** ★ 被移出主库的 id —— 加载器按它滤掉（生成侧：`scripts/park-landmarks.ts`） */
export const PARKED_IDS: ReadonlySet<string> = new Set(PARKED.map((s) => s.id))

/* ============================================================
   ★★ 「重名以官方为准」是怎么落地的
   ============================================================

   家长 09-24 定：「并进去，**重名以官方为准**」。
   判据在**生成侧**（`scripts/build-landmarks-cn.mjs` 用 `lib/a-level-names.mjs`
   的 `sameScenicArea`）—— 「同市（没市则同省）+ 同一个景区」就算重名。

   ⚠️⚠️ 但被取代的那条**不能由生成脚本删掉**：
     · `landmarks.json` 是**家长手写的** —— 脚本不该改它；
     · `landmarks-gd.json` 是**另一个脚本生成的** —— 删了下次重跑又回来。
   所以生成脚本只把「谁被谁取代」**记在 `supersedes` 里**，这里机械地滤掉。
   判据仍然只有一份（生成侧），加载器不做任何判断。

   ⚠️ 代价：被取代的那些 id 从此消失，老存档里对应的小树苗会变成孤儿
     （界面上兜底显示「远方」，不会崩 —— `MapPage.tsx` 有 `?? '远方'`）。
   ============================================================ */
export const SUPERSEDED_IDS: ReadonlySet<string> = new Set(CN_SOURCE.supersedes)

/**
 * 四个来源拼起来 —— **还没滤**。
 *
 * ⚠️ 单独抽出来是为了让下面的过滤**只有一份**：原来是两个 `.filter()`
 *    各写一遍 `SUPERSEDED_IDS`，再加 `PARKED_IDS` 就成四处 ——
 *    漏一处**不报错**，只是那一个来源的条目悄悄留在库里。
 */
const ALL_SEEDS: LandmarkSeed[] = [
  ...HAND_PICKED,
  ...GENERATED_GD,
  ...GENERATED_CN,
  /* 世界景点放最后：它跟国内那三份按 `country` 天然分开，
     但**同属一个数组**（地图、距离分档、随机选点都是按这个数组走的）。 */
  ...GENERATED_WORLD,
]

/**
 * ★★ 运行时真正生效的地标库（**手工在前，生成的在后**）。
 *
 * 两类条目在这里被滤掉，判据**各只有一份**、且都在生成侧：
 *   · `SUPERSEDED_IDS` —— 被官方 A 级名录取代的手工/GD 条目
 *   · `PARKED_IDS`     —— 不在「5A / 全国知名 / 世界知名」口径内的（1165 条）
 *
 * ⚠️ 顺序是**先拼后滤**。分别 filter 四个数组的话，加一个条件要改四处，
 *    漏一处不报错 —— 那批条目会安静地留在库里（这正是上面抽 `ALL_SEEDS` 的理由）。
 */
export const LANDMARK_SEEDS: LandmarkSeed[] = ALL_SEEDS.filter(
  (s) => !SUPERSEDED_IDS.has(s.id) && !PARKED_IDS.has(s.id),
)

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
 * ★★ 公共简介的问题清单 —— 专门查"会**静默**失效"的那一类。
 *
 * 为什么必须有这一条（最要紧的一条）：
 *   简介表的键是 **landmarkId**。打错一个字（`tiananmne`）不会报错、不会崩、
 *   计数也不变 —— 只是**这条简介永远不显示**，界面上看起来跟"还没写"一模一样。
 *   跟 `fameOf()` 那次是同一个形状（`landmarkFame.ts` 按 id 判定，
 *   打错一个字 = 一条地标悄悄掉档）。
 *
 * ⚠️ 空串也拦：空值该**删键**，不是留一个 `""` ——
 *    留着的后果是"看着像有简介"，点进去一片空白。
 * ⚠️ 字数上限读 `LANDMARK_INTRO_MAX`（`types.ts`），**别在这里写 300**：
 *    编辑器计数、本函数、落盘端点三处必须是同一个数字。
 *
 * ★ 单独一个函数、**不并进 `checkLandmarks()`** —— 那个查的是条目列表，
 *   这个查的是覆盖层，两件事。测试里两个都要跑。
 */
export function checkLandmarkIntros(
  intros: Readonly<Record<string, string>> = LANDMARK_INTROS,
  list: readonly LandmarkSeed[] = LANDMARK_SEEDS,
): string[] {
  const known = new Set(list.map((l) => l.id))
  const out: string[] = []
  for (const [id, text] of Object.entries(intros)) {
    if (!known.has(id)) {
      out.push(`简介挂在不存在的地标上：${id} —— 这条永远不会显示`)
      continue
    }
    if (!text || !text.trim()) {
      out.push(`${id}：简介是空的 —— 空的应该直接删掉这个键`)
      continue
    }
    if (text.length > LANDMARK_INTRO_MAX) {
      out.push(`${id}：简介 ${text.length} 字，超过 ${LANDMARK_INTRO_MAX}`)
    }
  }
  return out
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
    /*
     * ★ 公共简介**只从覆盖层来**，不从 `seed` 抄 ——
     *   `landmarks-*.json` 里根本没有这个字段（它们是生成产物）。
     *   两头都认的话就成了"两个家"，改一处、另一处没跟上，界面看不出区别。
     * ⚠️ 没写简介的景点这里是 `undefined`（**正常**，不是数据不全）——
     *   消费端一律 `intro || blurb` 兜底，行为跟加这个字段之前完全一样。
     */
    intro: LANDMARK_INTROS[seed.id],
    tier: seed.tier ?? 1,
    rating: seed.rating,
    /* ⚠️⚠️ `fame` 与 `heat` 以前**没抄**（`heat` 甚至连 `LandmarkSeed` 里都没有），
       于是 `types.ts` 的 `Landmark` 声明了 `heat` 却永远是 `undefined` ——
       类型在、数据在、就是没接上，而且**不报错**。
       ⚠️ `fame` 用 `fameOf()` 判（名单 + 规则，见 `landmarkFame.ts`）——
          数据文件里没有这个字段是**正常的**，它是"我们给的"不是"来源给的"。
          数据里若写了 `fame` 就以它为准（留给将来手工覆盖）。
       ⚠️ `heat` **不给默认值** —— "没有热度"和"热度是 0"是两件事，
          填 0 会被当成"冷门"。 */
    fame: seed.fame ?? fameOf(seed),
    heat: seed.heat,
    scene: seed.scene,
  }
}
