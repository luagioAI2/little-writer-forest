/* ============================================================
   旅行内容包 —— 一个景点的一张张**图片附件**
   ============================================================
   ★ 数据在 `src/data/travel-contents.json`，**这个文件只负责读它**。★

   改内容用 `travel-editor.html`（网页编辑工具，能保存回 JSON），
   或者直接改那个 JSON 也行。

   ------------------------------------------------------------
   ★★ 2026-09-25 家长重新定的口径（这一版就是照这个改的）

     「图片是附件的。会有很多图。但是经纬度 / 旅游点 / 热度 / 知名度等
      都是**共同的**。另外不需要类型 —— 类型是事件，是另外的系统。」

   ➜ 于是这个文件里**只留"这一张图自己的东西"**：

     {
       id: 'badaling-autumn',          // 唯一标识，别重复
       landmarkId: 'badaling',         // ★ **必填** —— 图片是挂在地标上的附件
       title: '长城之秋',              // 这一张自己的名字
       grade: '绝景',                  // ★ 等级：顺路 · 驻足 · 奇遇 · 绝景 · 传世
       mediaUrl: 'https://…',          // 图片地址（https 外链）
       credit: { source, link, author? },
       summary: '一句话摘要',
       essay: '散文正文…',             // 用 \n\n 分段
     }

   ★ 下面这些**不再逐张存**，改成从 `landmarkId` 查地标派生：
       地名（place）、经纬度（lng / lat）
     ⚠️ 以前是逐条手写的，于是**同一个景点写了两套坐标**：
        八达岭两条写了 116.0167/40.3563 和 116.02/40.35，西湖两条也各一套。
        改成派生之后，这类漂移**结构上不可能**再出现。
   ★ `type` 彻底搬走了 —— 它属于**事件系统**（见 `travelEvents.ts`）。
   ★ 笑话 / 格言 / 故事 / 音乐 / 视频也不在这个包里了，
     它们各有自己的池子，见 `src/data/travel-event-contents.json`。

   ------------------------------------------------------------
   约定（都是踩过坑才写的）

   1. **同一个地标可以配多条**（一个景点多张图）。
      ⚠️ `id` 必须唯一：两条同 id 的话，`contentById` 只会拿到第一条。

   2. **图片只存开源地址，不下载、不打包。**
      APK 体积有限，把几百张照片塞进包里不现实；而且开源图库的授权
      本来就是「给地址 + 署名」，不是「搬走」。所以一律 https 外链，
      界面加载失败时必须能退回程序化插画。

   3. **坐标来自地标**（见上）。填错 `landmarkId` 不会报错，
      只会让这条内容**整条被丢掉** —— 所以有一条测试守着"丢掉数必须是 0"。

   4. **文本按空行分段**，不写 Markdown、不写 HTML ——
      渲染端只按 `\n\n` 切段。

   ------------------------------------------------------------
   ★★ 关于「等级」（`grade`）

   家长 2026-09-24 明确：**等级只做标注，不影响掉落**。
   所以抽图的时候**等概率** —— **别给它加权重**。
   五档的定义与配色在 `domain/types.ts` 的 `TravelGrade` / `TRAVEL_GRADES`。

   ⚠️ 等级走的是"归一化在生成侧"那条路（见 MEMORY §二十八.6）：
      `gradeOf()` 只放行白名单里的值，放不进来就是 `undefined`。
      于是"这个字段有值 ⇒ 值一定合法"是个**不变量**，
      消费端（相册、编辑器）不用每次都判。
      代价是打错一个字会**静默降级成「顺路」** —— 所以
      `travelContents.test.ts` 里有一条"每个 grade 都必须在表里"守着。

   时间一律由外部传入（now），模块内不调用 Date.now()。
   ============================================================ */

import type { HomePoint, PhotoMatch, TravelContent, TravelGrade } from './types'
import { TRAVEL_GRADES } from './types'
import { landmarkById } from './travel'
import { haversineKm, resolveHomePoint } from './geo'
import { defaultPhotoFor } from '../data/landmarkPhotos'
import rawContents from '../data/travel-contents.json'

/* ============================================================
   一、读 JSON 并归一
   ============================================================ */

/**
 * JSON 里一条数据长什么样。
 *
 * ⚠️ 刻意和 `TravelContent` **分开声明**：JSON 是"人手/工具写的"，
 *    可能缺字段、可能写错枚举值；`TravelContent` 是"进到代码里之后"的形状。
 *    两者之间隔一个 `toTravelContent()` —— 归一化只在那里做一次。
 */
export interface TravelContentSeed {
  id: string
  /** ★ 必填。查不到这个地标 → 这条内容会被丢掉（有测试守着） */
  landmarkId: string
  title: string
  mediaUrl?: string
  credit?: { source: string; link: string; author?: string }
  summary: string
  essay?: string
  /** 等级。写错/没写都会被 `gradeOf()` 挡掉，不会流进来 */
  grade?: string
  /** ★ 图与地方的关系。写错/没写都会被 `matchOf()` 挡掉（见 `PhotoMatch`） */
  match?: string
}

/**
 * 把 JSON 里的等级字符串归一成合法的 `TravelGrade`。
 *
 * ★★ **只放行白名单里的值**，其余一律 `undefined`。
 *    为什么不直接 `as TravelGrade`：那样"传世"打成一个错别字之后，
 *    这个非法值会一路流到界面上，而 `gradeMeta()` 的兜底会把它显示成
 *    「顺路」—— 于是**标了传世、显示成顺路，两边都不报错**。
 *    在这里挡掉，至少能保证"进到代码里的 grade 一定是合法的"。
 *    （真正"打错了要有人知道"由测试负责，见文件末尾的守卫。）
 */
export function gradeOf(raw: unknown): TravelGrade | undefined {
  if (typeof raw !== 'string') return undefined
  return TRAVEL_GRADES.find((g) => g.key === raw)?.key
}

/**
 * 把 JSON 里的 `match` 归一成合法的 `PhotoMatch`。
 *
 * ★★ 跟 `gradeOf()` 一模一样的道理、一模一样的写法：**只放行白名单里的值**。
 *    为什么不直接 `as PhotoMatch`：那样 `'place '`（多一个空格）或者
 *    `'Place'`（大写）会一路流到消费端，而消费端的判断全是
 *    `=== 'scene'` 这种比较 —— 于是**它会被静默当成 `place`**，
 *    也就是"顶替图被当成真地方"，正是这个字段要防的事。
 *    在这里挡掉，至少保证"进到代码里的 match 一定是合法的"。
 *    （"写错了要有人知道"由 `landmarkPhotos.test.ts` 守着。）
 */
export function matchOf(raw: unknown): PhotoMatch | undefined {
  return raw === 'place' || raw === 'scene' ? raw : undefined
}

/**
 * 归一一条。**地标查不到就返回 `undefined`**（这条会被丢掉）。
 *
 * ★ 为什么宁可丢掉也不兜底：兜底只能编一个坐标出来，而编出来的坐标
 *   会让小鸟落到海里/几内亚湾 —— 那比"这条内容不存在"难查得多。
 *   丢掉是**可见的**：`DROPPED_CONTENT_COUNT` 会 > 0，测试立刻红。
 */
function toTravelContent(seed: TravelContentSeed): TravelContent | undefined {
  const lm = landmarkById(seed.landmarkId)
  if (!lm) return undefined
  return {
    id: seed.id,
    landmarkId: seed.landmarkId,
    title: seed.title,
    mediaUrl: seed.mediaUrl,
    credit: seed.credit,
    summary: seed.summary,
    essay: seed.essay,
    grade: gradeOf(seed.grade),
    match: matchOf(seed.match),
    // ↓ 派生字段：地标说是什么就是什么，JSON 里不存
    place: lm.name,
    lng: lm.lng,
    lat: lm.lat,
  }
}

const SEEDS: TravelContentSeed[] = rawContents as TravelContentSeed[]

/** 原始 JSON（没归一的）—— 编辑器与守卫用，看得到"作者到底写了什么" */
export const RAW_CONTENTS: TravelContentSeed[] = SEEDS

/** 全部内容。★ 数据在 `src/data/travel-contents.json` */
export const TRAVEL_CONTENTS: TravelContent[] = SEEDS.map(toTravelContent).filter(
  (c): c is TravelContent => c !== undefined,
)

/**
 * ★★ 因为 `landmarkId` 查不到而被丢掉的条数 —— **必须永远是 0**。
 *
 * ⚠️ 这个数存在的唯一理由：让"地标 id 打错一个字"这件事**有人知道**。
 *    不数它的话，那条内容会安安静静地从列表里消失，
 *    而编辑器里看起来就像"我明明存过"。
 *    守卫在 `travelContents.test.ts`。
 */
export const DROPPED_CONTENT_COUNT = SEEDS.length - TRAVEL_CONTENTS.length

/* ============================================================
   二、查询
   ============================================================ */

/** 全部内容 */
export function allContents(): TravelContent[] {
  return TRAVEL_CONTENTS
}

/** 某条内容 */
export function contentById(id: string): TravelContent | undefined {
  return TRAVEL_CONTENTS.find((c) => c.id === id)
}

/**
 * 某个地标关联的图片 —— **可能多张**（一个景点多张图）。
 * ⚠️ 界面上别用 `[0]` 当"就是它"，那会把其余几张静默藏起来。
 */
export function contentsByLandmark(landmarkId: string): TravelContent[] {
  return TRAVEL_CONTENTS.filter((c) => c.landmarkId === landmarkId)
}

/** 内容总数 */
export function contentCount(): number {
  return TRAVEL_CONTENTS.length
}

/** 某个地标有几张图 —— 编辑器拿它显示「这个景点有几张」 */
export function contentCountByLandmark(landmarkId: string): number {
  return contentsByLandmark(landmarkId).length
}

/** 某一档等级的全部内容 */
export function contentsByGrade(grade: TravelGrade): TravelContent[] {
  return TRAVEL_CONTENTS.filter((c) => c.grade === grade)
}

/** 五档各有几条 —— 编辑器与守卫用 */
export function gradeCounts(): Record<TravelGrade, number> {
  const out = {} as Record<TravelGrade, number>
  for (const g of TRAVEL_GRADES) out[g.key] = 0
  for (const c of TRAVEL_CONTENTS) {
    if (c.grade) out[c.grade] += 1
  }
  return out
}

/* ============================================================
   三、挑图（拍照事件的落点）
   ============================================================ */

/**
 * 从**某一个地标**的图里随机挑一张。
 *
 * ★★ **等概率** —— 这里**不读 `grade`**。
 *    家长 09-24 明确「等级只需要标注」，所以别在这里加权重。
 *    真要做「传世很难拿到」是另一件事，要单独确认。
 *
 * ★ 优先挑还没见过的（`exclude` 传已收藏过的 contentId）；
 *   都见过了就允许重复 —— 和抽卡一个哲学：
 *   努力之后总是撞见同一张，是最让人泄气的事。
 *
 * ⚠️ 范围是**这一个地标**，不是全库。全库挑是旧版 `pickContent()` 的做法，
 *    它让"小鸟飞到哪"和"这个景点有什么图"绑死了 —— 目的地应该由
 *    `pickDestination()` 从**地标表**里挑（见 `travelEvents.ts` 的说明）。
 */
export function pickContentForLandmark(
  landmarkId: string,
  opts: { exclude?: string[]; rng: () => number },
): TravelContent | undefined {
  const { exclude = [], rng } = opts
  const mine = contentsByLandmark(landmarkId)
  if (mine.length === 0) return undefined
  const unvisited = mine.filter((c) => !exclude.includes(c.id))
  const pool = unvisited.length > 0 ? unvisited : mine
  return pool[Math.floor(rng() * pool.length)]
}

/** 默认图的 contentId 前缀 —— 一眼能看出"这条不是家长配的" */
export const DEFAULT_CONTENT_ID_PREFIX = 'default:'

/**
 * 把某个地标的**默认图**包装成一条 `TravelContent`。
 *
 * ★★ 为什么要包装而不是让消费端认两种类型：
 *    消费端（`pets.ts` 的 `resolveReturn`）只认 `TravelContent` ——
 *    它要抄 `id / title / mediaUrl / credit / essay / grade` 进纪念品。
 *    这里包一层，`pets.ts` **一行都不用改**，也就不会出现
 *    "默认图走了另一条分支、忘了抄 grade"这种静默降级。
 *
 * ★ `summary` 用**地标自己的一句话介绍**（`blurb`）—— 不另编文案。
 *   ⚠️ 默认图**没有散文、没有等级**：那是家长挑图时才有的东西，
 *      编一份出来就等于替他声称了（见 `TravelContent.match` 的注释）。
 * ★ 派生的 `place / lng / lat` 走 `toTravelContent()` —— 跟内容包**同一条路**，
 *   所以两边的坐标不可能分叉。
 */
function defaultContentForLandmark(landmarkId: string): TravelContent | undefined {
  const photo = defaultPhotoFor(landmarkId)
  const lm = landmarkById(landmarkId)
  if (!photo || !lm) return undefined
  return toTravelContent({
    id: `${DEFAULT_CONTENT_ID_PREFIX}${photo.landmarkId}`,
    landmarkId: photo.landmarkId,
    title: photo.title,
    mediaUrl: photo.mediaUrl,
    credit: photo.credit,
    summary: lm.blurb,
    match: photo.match,
  })
}

/**
 * ★★ 拍照事件真正用的那个 —— **内容包优先，默认图兜底**。
 *
 *   ① 家长给这个景点配过图 → 用内容包里的（等概率挑一张，见上）
 *   ② 没配过、但有默认图   → 用默认图（`match` 会标着它是真地方还是顶替图）
 *   ③ 都没有               → `undefined`，调用方退回程序化插画
 *
 * ⚠️⚠️ 这是**唯一**的出口。以前 `travelEvents.ts` 里有两处各写了一遍
 *    `pickContentForLandmark(...)`（"抽中拍照"和"池子落空退回拍照"）——
 *    加兜底时只改一处，另一处就悄悄还是旧行为，**不报错**。
 *    所以两处现在都调这个函数，别再把 `pickContentForLandmark` 直接搬回去。
 */
export function pickPhotoForLandmark(
  landmarkId: string,
  opts: { exclude?: string[]; rng: () => number },
): TravelContent | undefined {
  return pickContentForLandmark(landmarkId, opts) ?? defaultContentForLandmark(landmarkId)
}

/**
 * 计算从家到某条内容的距离（公里）。
 *
 * ⚠️ 2026-09-25：**只是 `distanceToLandmark` 的一层薄壳**，留着是因为
 *    调用方手上常常只有一条 `TravelContent`（没有 `Landmark`）。
 *    内容的坐标就是从地标派生的（见文件开头），所以两者算出来必然一样。
 *
 * ★★ 「家」的判定**不在这里**，也不许在这里 —— 一律走 `resolveHomePoint()`
 *    （`domain/geo.ts`）：设置里有就用设置的，没有或值不合法就退回深圳。
 *    ⚠️ 这里原来自己写了一遍 `home && isUsablePoint(home) ? home : DEFAULT_HOME_POINT`
 *       —— 那就是**同一个规则的第二个实现**，改一处就会分叉。
 */
export function distanceToContent(content: TravelContent, home?: HomePoint | null): number {
  return haversineKm(resolveHomePoint(home), { lng: content.lng, lat: content.lat })
}

/** 查找坐标附近最近的地标（用于标记到访） */
export function nearestLandmarkId(
  lng: number,
  lat: number,
  landmarks: Array<{ id: string; lng: number; lat: number }>,
  maxKm: number = 50,
): string | undefined {
  let bestId: string | undefined
  let bestKm = Infinity
  for (const lm of landmarks) {
    const d = haversineKm({ lng, lat }, { lng: lm.lng, lat: lm.lat })
    if (d < bestKm) {
      bestKm = d
      bestId = lm.id
    }
  }
  if (bestKm <= maxKm) return bestId
  return undefined
}
