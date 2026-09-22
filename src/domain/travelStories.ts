/* ============================================================
   旅行内容包 —— 小鸟飞出去，带回来一张照片和一篇散文
   ============================================================
   ★ 这就是那个「放很多数据」的存储文件。以后往里加条目就行。 ★

   ------------------------------------------------------------
   一条数据长什么样

     {
       landmarkId: 'badaling',        // 必须能在 travel.ts 的 LANDMARKS 里找到
       place: '中国长城',              // 给孩子看的地名
       photoUrl: 'https://…',         // 开源图片地址
       credit: { source, link, author? },  // 署名（开源也要留名）
       lng: 116.0167, lat: 40.3563,   // 地图落点：不填就用地标的坐标
       distanceKm: 70,                // 飞了多远；留空会自动按经纬度算
       summary: '一句话',              // 列表 / toast 里显示
       essay: '散文正文…',             // 用 \n\n 分段
     }

   ★ 地图落点不用你操心。 ★
     小鸟落在哪儿，是拿经纬度算出来的（见 MapPage 的 projectX / projectY），
     而经纬度**地标表里已经有了**。所以只要 landmarkId 填对，
     小鸟的落点就自动出现在地图上，不用另外给什么"地图图片"。

     只有一种情况要手填 lng/lat：想把点钉得比地标中心更准
     （比如钉在八达岭那个具体的烽火台上）。而且要**两个一起填**，
     只填一个会被当成没填 —— 见 mapPointFor 的注释。

   ------------------------------------------------------------
   四条约定（都是踩过坑才写的）

   1. **图片只存开源地址，不下载、不打包。**
      APK 体积有限，把几百张照片塞进包里不现实；而且开源图库的授权
      本来就是「给地址 + 署名」，不是「搬走」。所以 `photoUrl` 一律是
      https 外链，界面加载失败时必须能退回程序化插画（MapPage 里做了）。

   2. **`landmarkId` 必须是真实存在的地标。**
      写错一个字母，这条内容就永远没机会被小鸟带回来 —— 而且不会报错，
      只是安静地不出现。所以 travelStories.test.ts 会把每条都对着
      LANDMARKS 核一遍，宁可测试红，也不要内容悄悄失踪。

   3. **一个地标一条。** 同一个地标写两条，后面的会被前面的盖掉。
      测试也会拦重复。

   4. **散文按空行分段**，不写 Markdown、不写 HTML —— 渲染端只按
      `\n\n` 切段。这样以后要换排版（比如做成朗读稿）不用改数据。

   ------------------------------------------------------------
   距离怎么算

     口径是「从家飞了多远」。

     优先级：
       ① 设置里的 `Settings.homePoint`（以后由 GPS 或家长手选写入）
       ② 拿不到就用 `DEFAULT_HOME_POINT` —— **深圳**

     也就是说，**没设位置、没读到 GPS 的时候，就以深圳为基准点**。
     这是刻意的：距离是这趟旅行最有分量的那个数字，
     基准点偏一两百公里对孩子毫无影响，但没有这个数字就少了一半。

     单条内容也能手填 `distanceKm` 覆盖 —— 比如想用真实公路里程。
     要换默认城市，只改 `DEFAULT_HOME_POINT` 一处，全 App 一起重算。

   时间一律由外部传入（now），模块内不调用 Date.now()。
   ============================================================ */

import type { HomePoint, TravelStory } from './types'
import { landmarkById } from './travel'

/* ============================================================
   一、距离
   ============================================================ */

export interface GeoPoint {
  lng: number
  lat: number
}

/**
 * 默认基准点 —— 拿不到真实位置时就用它：**深圳**。
 *
 * 三层优先级（见 `resolveHomePoint`）：
 *   ① 设置里存着的 homePoint（以后由 GPS 或家长手选写入）
 *   ② 就是这里
 *
 * 为什么默认是深圳而不是「不显示距离」：
 * 距离是这个玩法里最有分量的那个数字 —— 「小鸟替我飞了 1900 公里」。
 * 基准点偏一点（比如孩子其实在广州），误差也就一两百公里，
 * 对孩子的感受没有影响；但没有这个数字，整趟旅行就少了一半。
 *
 * 坐标取深圳市民中心附近，GCJ-02，和地标表同一套坐标系。
 */
export const DEFAULT_HOME_POINT: HomePoint = {
  name: '深圳',
  lng: 114.0579,
  lat: 22.5431,
  source: 'default',
}

/**
 * 这个坐标能不能用。
 *
 * 为什么要校验、而不是「传进来就信」：这个值以后可能来自 GPS
 * 或家长手填，而 **(0, 0) 是定位失败的经典产物**（几内亚湾，
 * 没有任何人住在那儿）。不校验的话孩子会看到「飞了 12000 公里」，
 * 而且这种错从界面上完全看不出是错的。
 */
function isUsablePoint(p: GeoPoint): boolean {
  if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) return false
  if (p.lng < -180 || p.lng > 180) return false
  if (p.lat < -90 || p.lat > 90) return false
  if (Math.abs(p.lng) < 0.5 && Math.abs(p.lat) < 0.5) return false
  return true
}

/**
 * 定出「家」在哪儿：设置里有就用设置的，没有（或值不合法）就用深圳。
 *
 * 这个函数是**唯一**决定基准点的地方 —— 想换默认城市，
 * 改 `DEFAULT_HOME_POINT` 一处，全 App 的距离一起重算。
 */
export function resolveHomePoint(home?: HomePoint | null): HomePoint {
  if (home && isUsablePoint(home)) return home
  return DEFAULT_HOME_POINT
}

/** 这个基准点是默认值，还是真的读到/设置过？界面据此决定要不要提示 */
export function isDefaultHome(home?: HomePoint | null): boolean {
  return resolveHomePoint(home).source === 'default'
}

const EARTH_R_KM = 6371

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * 两点间的大圆距离（公里，四舍五入到整数）。
 *
 * 用 haversine 而不是「经纬度差乘个系数」：中国跨了 60 多个纬度，
 * 简单线性估算在南北两端会差出几百公里，孩子看到「飞了 200 公里」
 * 其实飞了 500 公里，这种数不值得错。
 */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)))
  return Math.round(EARTH_R_KM * c)
}

/**
 * 某个地标离家多远。地标不存在时返回 undefined。
 *
 * 不传 home 就用默认基准点（深圳）—— 绝大多数调用都是这样。
 */
export function distanceKmFromHome(
  landmarkId: string,
  home: GeoPoint = DEFAULT_HOME_POINT,
): number | undefined {
  const lm = landmarkById(landmarkId)
  if (!lm) return undefined
  return haversineKm(home, { lng: lm.lng, lat: lm.lat })
}

/* ============================================================
   二、内容包
   ============================================================ */

/**
 * 全部旅行内容。
 *
 * 加新条目：复制一段，改 landmarkId / place / photoUrl / credit /
 * summary / essay 即可；distanceKm 不填就自动算。
 */
export const TRAVEL_STORIES: TravelStory[] = [
  {
    landmarkId: 'badaling',
    place: '中国长城',
    photoUrl:
      'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    credit: {
      // ⚠️ 作者待补：Unsplash 页面被反爬挡了，没能核实到摄影师是谁。
      //    不编名字 —— 你打开图片详情页复制一下填进来即可。
      source: 'Unsplash',
      link: 'https://unsplash.com/s/photos/great-wall-of-china',
    },
    /*
      ⚠️ 这里原本手填了 distanceKm: 70（八达岭到北京市区的公路里程）。
      基准点换成深圳之后那个数是错的 —— 深圳到八达岭直线约 1990 公里。
      所以删掉手填值，让它按经纬度自动算。

      教训：手填距离和基准点是**绑死**的。基准点一改，
      所有手填值都要跟着复核，否则会静默地错下去（界面上照样显示一个数，
      只是那个数不对）。现在只有一条数据，趁早发现。
    */
    summary: '一条趴在山上的龙，一半亮一半暗，一直伸到天边去。',
    essay: `我是一只小小的鸟。风最大的那天，我顺着北边的山脊一直飞，飞过一片又一片红透的林子，最后落在一条很长很长的墙上。

它不是墙。它是一条趴在山上的龙，背上铺着方方正正的砖，一级一级，从这座山头爬到那座山头，爬到我看不见的地方去。

我在城砖上走了很久。砖被好多好多人的脚磨得发亮，摸上去是温的，像谁刚刚才走过。风从垛口的缺口里钻进来，呜呜地响，好像在跟我说话。我听不懂它说什么，可是我不想走。

山上的树都黄了。枫树是红的，银杏是金的，还有些我叫不出名字的树，把整面山坡染成一大块暖洋洋的颜色。太阳斜斜地照过来，龙的身子一半亮一半暗，一直伸到天边去。

我站在最高的那座烽火台上往下看。底下的人小得像蚂蚁，慢慢地往上爬。有个小孩落在最后，走得满头大汗，还是不肯停下。我想告诉他：再走一段，你就能看见我看到的这些了。

天快黑的时候我才往回飞。回头看了一眼，长城还在那里，安安静静地趴着，好像已经趴了很多很多年，还要再趴很多很多年。

我把它拍了下来。你看，这就是我那天看见的。`,
  },
]

/* ============================================================
   三、查询
   ============================================================ */

/** 某个地标有没有内容包 */
export function storyFor(landmarkId: string): TravelStory | undefined {
  return TRAVEL_STORIES.find((s) => s.landmarkId === landmarkId)
}

export function hasStory(landmarkId: string): boolean {
  return storyFor(landmarkId) !== undefined
}

/** 一共有几条内容 —— 界面拿它算「还有多少地方没写过」 */
export function storyCount(): number {
  return TRAVEL_STORIES.length
}

/** 内容包里覆盖到的地标 id */
export function coveredLandmarkIds(): string[] {
  return TRAVEL_STORIES.map((s) => s.landmarkId)
}

/**
 * 一条内容在地图上的落点。
 *
 * 三级回退，任何一级拿到就返回：
 *   ① 内容包自己给的 lng/lat（两个都给才算数 —— 只给一个画不出点）
 *   ② LANDMARKS 里该地标的经纬度
 *   ③ 都没有 → undefined，界面就别画这个点
 *
 * 为什么第 ① 级要"两个都给才算"：只给了 lng 的话，拿它配地标的 lat
 * 会算出一个**看似合理但其实错得离谱**的位置（纬度还是原地标的，
 * 经度却跑到别处），这种错误在地图上完全看不出来。宁可退回地标坐标。
 */
export function mapPointFor(
  landmarkId: string,
  story: TravelStory | undefined = storyFor(landmarkId),
): GeoPoint | undefined {
  if (story && typeof story.lng === 'number' && typeof story.lat === 'number') {
    return { lng: story.lng, lat: story.lat }
  }
  const lm = landmarkById(landmarkId)
  return lm ? { lng: lm.lng, lat: lm.lat } : undefined
}

/** 一条内容用的是不是自己钉的坐标（界面可以据此提示「已微调位置」） */
export function hasOwnMapPoint(
  landmarkId: string,
  story: TravelStory | undefined = storyFor(landmarkId),
): boolean {
  return story !== undefined && typeof story.lng === 'number' && typeof story.lat === 'number'
}

/** 有照片内容的地标 → 它们在地图上的落点。地图拿它画「有照片」的标记 */
export function photoPoints(): Map<string, GeoPoint> {
  const m = new Map<string, GeoPoint>()
  for (const s of TRAVEL_STORIES) {
    const p = mapPointFor(s.landmarkId)
    if (p) m.set(s.landmarkId, p)
  }
  return m
}

/**
 * 一条内容的实际距离：手填优先，没填就按经纬度算。
 * 两样都没有（地标不存在）时返回 undefined。
 *
 * 注意距离要用**地标坐标**算，不能用 mapPointFor 的覆盖坐标 ——
 * 覆盖坐标是「钉得更准的观景台」，拿它算「离家多远」会把口径搞乱。
 *
 * `home` 传设置里的 homePoint；不传就用默认基准点（深圳）。
 */
export function resolveDistanceKm(
  story: TravelStory,
  home?: GeoPoint,
): number | undefined {
  if (typeof story.distanceKm === 'number') return story.distanceKm
  /*
    ⚠️ 这里必须再校验一次，不能直接 `home ?? DEFAULT_HOME_POINT`。
    因为调用方（store）塞进来的是 `settings.homePoint` —— 那是**存档里的值**，
    可能来自以后某个版本的 GPS，而 (0, 0) 这种定位失败的产物一旦漏进来，
    孩子就会看到「飞了 12000 公里」，而且从界面上完全看不出是错的。
    resolveHomePoint 和这里是同一条规则的两次落地：入口挡一次，用的时候再挡一次。
  */
  const point = home && isUsablePoint(home) ? home : DEFAULT_HOME_POINT
  return distanceKmFromHome(story.landmarkId, point)
}
