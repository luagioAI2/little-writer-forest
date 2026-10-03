/* ============================================================
   默认图片 —— 每个地标一张，小鸟抽到「拍照」时的兜底
   ============================================================
   ★ 数据在 `src/data/landmark-photos.json`（**生成物，别手改**）。
     来源清单是 `scripts/photo-sourced.json`，生成脚本是
     `scripts/build-landmark-photos.mjs`。**这个文件只负责读它。**

   ------------------------------------------------------------
   ★★ 它跟内容包（`travel-contents.json`）是**两层**，不是一个东西

     · **内容包** —— 家长一张张挑的，有标题 / 等级 / 散文，一个景点可以好几张。
                      「这个景点长什么样」的**正式答案**。
     · **默认图** —— 机器搜来的，一个地标一张，只有图片地址和署名。
                      家长还没配内容时的**兜底**，让小鸟至少能带张真照片回来。

   ➜ 优先级在 `travelContents.ts` 的 `pickPhotoForLandmark()`：
        内容包 → 默认图 → `undefined`（由 `pets.ts` 退回程序化插画）
     ⚠️ **不许**把默认图塞进 `TRAVEL_CONTENTS` —— 那会让相册里冒出几百张
        没有散文、没有等级的"内容"，而家长以为自己没配过。

   ------------------------------------------------------------
   ⚠️⚠️ 为什么这里也要数「丢掉的条数」

     跟 `travelContents.ts` 的 `DROPPED_CONTENT_COUNT` 同一个理由：
     `landmarkId` 打错一个字，这条默认图就**永远轮不到** ——
     而界面上看起来只是"这个地方还没配图"，**不报错**。
     所以 `DROPPED_PHOTO_COUNT` 必须永远是 0，守卫在 `landmarkPhotos.test.ts`。

   ⚠️ 这里判"id 存不存在"用的是 `LANDMARK_SEEDS`（跟加载器同一份名单）。
     别改用别的数组 —— 那会跟运行时库分叉（`domain/travel.ts` 的 `LANDMARKS`
     就是 `LANDMARK_SEEDS.map(toLandmark)`，id 集合完全一样）。
   ============================================================ */

import type { PhotoCredit, PhotoMatch } from '../domain/types'
import rawPhotos from './landmark-photos.json'
import { LANDMARK_SEEDS } from './landmarks'

/** JSON 里一条默认图长什么样 */
export interface LandmarkPhotoSeed {
  /** ★ 必填。查不到这个地标 → 这条会被丢掉（有测试守着） */
  landmarkId: string
  /** ★ 这张图跟那个地方的关系 —— 见 `PhotoMatch`。**必填**，不许含糊 */
  match: PhotoMatch
  /** https 外链。⚠️ 只存地址，不下载、不打包（理由见 `travelContents.ts` 约定 2） */
  mediaUrl: string
  /** 这张图的名字（图库给的，不是我们编的） */
  title: string
  credit: PhotoCredit
  /** 复核时留下的说明（可选）。比如"这张是同地带的顶替图，原因是……" */
  note?: string
}

/**
 * ★ 生成物的抬头。跟 `landmarks-cn.json` / `landmarks-world.json` 一样，
 *   抬头里是**授权与署名** —— 数据被复制走时许可要跟着走。
 */
export const PHOTO_SOURCE = rawPhotos as {
  whyThisFileExists: string
  source: string
  license: string
  licenseUrl: string
  attribution: string
  cdnPattern: string
  cdnNote: string
  howItWasMade: string
  matchNote: string
  asOf: string
  count: number
  byMatch: Record<PhotoMatch, number>
  scope: string
  generatedBy: string
  items: LandmarkPhotoSeed[]
}

/** 全部默认图（**没滤过的**，跟 JSON 里一模一样） */
export const LANDMARK_PHOTOS: LandmarkPhotoSeed[] = PHOTO_SOURCE.items

/** 运行时地标库里全部合法的 id —— 判"这条默认图有没有主" */
const VALID_LANDMARK_IDS: ReadonlySet<string> = new Set(LANDMARK_SEEDS.map((s) => s.id))

/**
 * `landmarkId` → 默认图。
 *
 * ⚠️ 用 `Map` 而不是每次 `.find()`：相册/事件每次结算都要查，
 *    而这里会有几百条（铺开后 643 条）。
 * ⚠️ 重复的 `landmarkId` **只留第一条**，并且会被 `DROPPED_PHOTO_COUNT`
 *    之外的守卫抓住（`landmarkPhotos.test.ts` 有一条"不许重复"）。
 */
const BY_LANDMARK: ReadonlyMap<string, LandmarkPhotoSeed> = (() => {
  const m = new Map<string, LandmarkPhotoSeed>()
  for (const p of LANDMARK_PHOTOS) {
    if (!VALID_LANDMARK_IDS.has(p.landmarkId)) continue
    if (m.has(p.landmarkId)) continue
    m.set(p.landmarkId, p)
  }
  return m
})()

/**
 * ★★ 因为 `landmarkId` 查不到而被丢掉的条数 —— **必须永远是 0**。
 * ⚠️ 数的是"去重之后剩下的"与"原始条数"的差，所以**重复的 id 也算丢掉** ——
 *    两种毛病都是"这条默认图永远轮不到"，都该有人知道。
 */
export const DROPPED_PHOTO_COUNT = LANDMARK_PHOTOS.length - BY_LANDMARK.size

/** 某个地标的默认图。没有就返回 `undefined`（调用方退回程序化插画） */
export function defaultPhotoFor(landmarkId: string): LandmarkPhotoSeed | undefined {
  return BY_LANDMARK.get(landmarkId)
}

/** 有多少地标配了默认图 */
export function photoCount(): number {
  return BY_LANDMARK.size
}

/** 配了默认图的地标 id（守卫 / 复核页用） */
export function photoLandmarkIds(): string[] {
  return [...BY_LANDMARK.keys()]
}

/* ============================================================
   校验 —— 跟 `checkLandmarks()` 一样，返回清单而不是直接抛
   ============================================================ */

export interface PhotoIssue {
  index: number
  landmarkId: string
  why: string
}

/**
 * 挡的是「不报错但会静默出错」的那几类：
 *   · landmarkId 查不到 → 这条永远轮不到（界面只显示成"还没配图"）
 *   · landmarkId 重复   → 后者被前者盖掉
 *   · match 拼错        → 消费端拿到一个不认识的字符串，判断全落空
 *   · 不是 https 外链   → 打包进 APK 或混合内容被浏览器拦掉
 *   · place 却没有出处  → **空口说"这就是那个地方"**，复核时无从追溯
 *   · 出处链接与图片编号对不上 → 这两条是从不同照片上抄来的（张冠李戴）
 */
export function checkLandmarkPhotos(
  list: readonly LandmarkPhotoSeed[] = LANDMARK_PHOTOS,
  validIds: ReadonlySet<string> = VALID_LANDMARK_IDS,
): PhotoIssue[] {
  const issues: PhotoIssue[] = []
  const seen = new Set<string>()

  list.forEach((p, index) => {
    const push = (why: string) => issues.push({ index, landmarkId: p.landmarkId ?? '(无 id)', why })

    if (!p.landmarkId) push('缺 landmarkId')
    else if (!validIds.has(p.landmarkId)) push('landmarkId 在地标库里找不到 —— 这条永远轮不到')
    else if (seen.has(p.landmarkId)) push(`landmarkId 重复：${p.landmarkId}`)
    else seen.add(p.landmarkId)

    if (p.match !== 'place' && p.match !== 'scene') {
      push(`match 不认识：${JSON.stringify(p.match)}（只认 place / scene）`)
    }
    if (!p.mediaUrl) push('缺 mediaUrl')
    else if (!p.mediaUrl.startsWith('https://')) push(`mediaUrl 不是 https：${p.mediaUrl}`)

    if (!p.credit?.source) push('缺 credit.source')
    if (!p.credit?.link) push('缺 credit.link（出处，复核时要靠它）')
    if (p.match === 'place' && !p.credit?.link) {
      push('match=place 却没有 credit.link —— 说「这是真地方」必须给得出详情页')
    }

    const idInUrl = (p.mediaUrl ?? '').match(/photos\/(\d+)\//)?.[1]
    if (idInUrl && p.credit?.link && !p.credit.link.includes(idInUrl)) {
      push(`credit.link 里没有 mediaUrl 的编号 ${idInUrl} —— 出处与图片对不上`)
    }
  })

  return issues
}
