/* ============================================================
   广东省景点库 —— 抓取与生成
   ============================================================

   数据来源：OpenStreetMap（Overpass API）
   产出：`src/data/landmarks-gd.json`

   ★★ 授权：OSM 数据是 **ODbL**。所以
     ① 这个脚本产出的文件是「衍生数据库」，跟手工那份 `landmarks.json`
        **分开存**，授权边界才清楚；
     ② App 里必须有署名「© OpenStreetMap 贡献者」（家长已同意）。

   ------------------------------------------------------------
   为什么要有这个脚本，而不是手工敲

     一两千个点，手工敲坐标一定会编。而「编出来的坐标」在这个玩法里
     不是小错 —— 距离分档全靠它：错 300 米无所谓，错 30 公里
     就会让一个点从「麻雀能去」跳到「燕子才能去」。

   ------------------------------------------------------------
   ★ 两个不做就会错的地方（都实测过）

   1. **坐标系**：OSM 是 **WGS-84**，而 `landmarks.json` 里写的是
      **GCJ-02**（跟腾讯地图一致）。国内两者差 300~600 米。
      不转就会让整个库**系统性偏移**，而且偏移量随经纬度变化，
      不是"整体平移"，改不回来。所以这里显式转。
      ⚠️ 国外坐标不转（`outOfChina` 直接原样返回）——
      这也是为什么将来世界景点可以放心混进同一个库。

   2. **园内小件**：世界之窗里面在 OSM 里有二十来个
      `tourism=attraction`（`尼亚加拉大瀑布微缩模型`、`长城模型`、
      `猴园`…）。照单全收的话，孩子会「去世界之窗二十次」。
      所以要先拿到主题乐园的**多边形**，把小件**按点在多边形内**剔掉。

   ------------------------------------------------------------
   用法

     node scripts/fetch-landmarks.mjs --all          # 21 个地级市
     node scripts/fetch-landmarks.mjs --city=深圳市   # 单个城市
     node scripts/fetch-landmarks.mjs --all --dry     # 只统计不写文件
     node scripts/fetch-landmarks.mjs --all --refresh # 忽略缓存重新拉

   缓存放在 `node_modules/.cache/overpass/`（本来就被 gitignore，
   不会污染仓库）。Overpass 经常 504，缓存能省掉大量重试。
   ============================================================ */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'overpass')
const OUT_FILE = path.join(ROOT, 'src', 'data', 'landmarks-gd.json')

/* ★★ 多个 Overpass 实例轮着试。
 *
 * 为什么必须轮：主站（`overpass-api.de`）在忙的时候会**连续 504**
 * （实测广州市连试 5 次全挂），而**换一台机器立刻就通**。
 * 只盯着一台主机，等于把整个抓取押在别人的负载上。
 *
 * ⚠️ 备用实例的**数据比主站旧**（实测 private.coffee 停在 2026-05，
 *    主站是当天）。所以顺序是「主站优先」，备用只在主站失败时用；
 *    抓到的结果都会落缓存，重跑不会因为换了实例而抖。
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

/** 单次请求的客户端超时。见 `overpass()` 里的说明 —— 备用实例会挂住。
 *  60 秒：主站正常时几秒就回，60 秒还没回说明这台机器不行了。 */
const CLIENT_TIMEOUT_MS = 60_000

/* 广东省 21 个地级市。★ 不含中国香港 / 中国澳门 —— 它们是特别行政区，
   不属于广东省；查询时按市名圈范围，本来也圈不到。 */
const CITIES = [
  '广州市', '深圳市', '珠海市', '汕头市', '佛山市', '韶关市', '湛江市',
  '肇庆市', '江门市', '茂名市', '惠州市', '梅州市', '汕尾市', '河源市',
  '阳江市', '清远市', '东莞市', '中山市', '潮州市', '揭阳市', '云浮市',
]

/* ============================================================
   〇、城市分档与「评级」名单（家长 09-23 定）
   ============================================================ */

/* ★★ 每城上限。判据（家长 09-23 定）：
 *     一线（广深）+ 新一线（佛莞）→ **≤10**
 *     二线（惠州 / 珠海 / 中山 / 汕头）→ **≤5**
 *     三线及以下 → **不设上限**，只按「全国知名」闸门收
 *
 * ⚠️ 这是**上限**，不是配额 —— 不够知名就收不满。
 *    宁可空着，也不拿长尾凑数（家长原话：「最知名的」）。
 * ⚠️ 名单里没有的市 = 不设上限。要改分档就改这张表，
 *    **不要**在别处再写一遍城市名单（同一份名单两处各写一遍 = 迟早漂移）。 */
const CITY_CAP = {
  广州市: 10,
  深圳市: 10,
  佛山市: 10, // 新一线
  东莞市: 10, // 新一线
  惠州市: 5,
  珠海市: 5,
  中山市: 5,
  汕头市: 5,
}

/* ★★ 市政府所在地（近似坐标，误差几百米无所谓）。
 *
 * 用途只有一个：**给"整省按名字抓"的结果定城市归属**。
 * 那条查询只给坐标、不给市名，而按名字抓回来的正是**没有 wikidata 的
 * 5A/4A**（白云山、丹霞山、万绿湖、罗浮山…）—— 分错市会直接导致
 * ① 地图上画到隔壁市 ② 吃错那个市的**每城上限**名额。
 *
 * ⚠️ 第一版是**用各市自己的点算质心**，实测分错了：
 *     · `万绿湖` → 广州（河源的标签结果只有 3 条，质心偏了，河源直接收不到东西）
 *     · `罗浮山风景名胜区` → 东莞（博罗离东莞市区比离惠州市区"看起来"近）
 *   换成**固定市seat**之后就对了：万绿湖离河源市区 10 km、离广州 160 km；
 *   罗浮山离惠州市区 33 km、离东莞市区 48 km。
 * ⚠️ 用质心的另一个隐患：**某市标签结果为空 → 质心算不出来 → 那个市
 *    永远收不到按名字抓的结果**（河源就是这样变成 0 条的）。
 */
const CITY_SEAT = {
  广州市: [113.2644, 23.1291],
  深圳市: [114.0579, 22.5431],
  珠海市: [113.5767, 22.2707],
  汕头市: [116.7081, 23.371],
  佛山市: [113.122, 23.0288],
  韶关市: [113.5915, 24.8014],
  湛江市: [110.3594, 21.2707],
  肇庆市: [112.4725, 23.0515],
  江门市: [113.0819, 22.5787],
  茂名市: [110.9254, 21.6627],
  惠州市: [114.4161, 23.1115],
  梅州市: [116.1222, 24.2886],
  汕尾市: [115.3752, 22.7862],
  河源市: [114.7004, 23.744],
  阳江市: [111.9822, 21.8579],
  清远市: [113.056, 23.6817],
  东莞市: [113.7518, 23.0207],
  中山市: [113.3926, 22.517],
  潮州市: [116.6226, 23.6567],
  揭阳市: [116.3726, 23.5497],
  云浮市: [112.0444, 22.9298],
}

/** 某个市的 seat 坐标。⚠️ 表里没有的市返回 (0,0) —— 调用方只用它比**远近**，
 *  而 (0,0) 离谁都远，效果就是"不偏向任何一方"，安全。 */
function seatOf(city) {
  const s = CITY_SEAT[city]
  return s ? { lng: s[0], lat: s[1] } : { lng: 0, lat: 0 }
}

/** 离这个坐标最近的地级市（按市政府所在地算）。 */
function nearestCity(lng, lat) {
  let best = null
  let bestD = Infinity
  for (const [city, seat] of Object.entries(CITY_SEAT)) {
    const d = haversineKm({ lng: seat[0], lat: seat[1] }, { lng, lat })
    if (d < bestD) {
      bestD = d
      best = city
    }
  }
  return best
}

/* ★★ 「评级」= 国家 A 级旅游景区等级（5A / 4A）。
 *
 * 为什么必须外挂一份名单：OSM 里只有 `tourism:level:CN` 带等级，
 * 而广东 819 条里**只有 7 条**有 —— 靠它一条都评不全。
 * 名单见 `scripts/gd-a-level.json`（5A 16 家完整；4A 172 家）。
 *
 * ⚠️ 这份名单同时干两件事：
 *   ① 给条目打 `rating`（家长要的「评级」）；
 *   ② 当「全国知名」闸门的第三条判据 —— 实测它救回了 **`白云山`**
 *      （`natural=peak`、**没有 wikidata**，光靠标签闸门会被误杀，
 *        而它是广州 5A 景区、羊城八景之一）。 */
const A_LEVEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'gd-a-level.json'), 'utf8'))
const A_LEVEL_GD = A_LEVEL.byProvince['广东']

/* 归一化：剥掉「市」前缀与通用后缀，留下**核心词**。
 *   「广州市白云山风景区」→「白云山」
 *   「佛山市西樵山景区」  →「西樵山」
 * 官方写法与 OSM 写法对不上（`西樵山风景名胜区` vs `佛山市西樵山景区`），
 * 所以两边都归一化到核心词再比。
 * ⚠️ 刻意**不剥** `公园`/`博物馆`/`纪念馆`/`旧址` ——
 *    `越秀公园` 剥完会只剩 `越秀`，那个词会匹配到一大片（越秀区、越秀山…）。 */
const SCENIC_TAIL =
  /旅游度假区|风景名胜区|文化旅游区|旅游景区|旅游区|风景区|度假区|景区|旅游|文化|国际|国家/g

function coreName(s) {
  return s
    .replace(/[（(].*?[）)]/g, '')
    .replace(/^[\u4e00-\u9fa5]{2,3}[市省]/, '')
    .replace(SCENIC_TAIL, '')
    .replace(/\s+/g, '')
}

/* ★ 别名表：**官方是一个片区、OSM 里拆成好几个园**的那种。
 *   光靠核心词相等/包含都匹配不上（`广州长隆` ↔ `长隆欢乐世界` 互不包含），
 *   所以只能明确列出来。
 * ⚠️ 别名**不要收单个常用词**（曾经想收 `西湖`）——
 *   那会让**潮州西湖**继承惠州西湖的 5A。宁可不匹配，也不要张冠李戴。 */
const SCENIC_ALIAS = {
  // 长隆（广州）：官方 5A 是「广州长隆旅游度假区」，OSM 里是里面几个园
  长隆欢乐世界: '广州长隆旅游度假区',
  长隆野生动物世界: '广州长隆旅游度假区',
  长隆水上乐园: '广州长隆旅游度假区',
  长隆国际大马戏: '广州长隆旅游度假区',
  长隆飞鸟乐园: '广州长隆旅游度假区',
  // 华侨城（深圳）：5A 是一个片区
  世界之窗: '深圳华侨城旅游度假区',
  锦绣中华: '深圳华侨城旅游度假区',
  锦绣中华民俗村: '深圳华侨城旅游度假区',
  中国民俗文化村: '深圳华侨城旅游度假区',
  欢乐谷: '深圳华侨城旅游度假区',
  欢乐海岸: '深圳华侨城旅游度假区',
  // 星湖（肇庆）：5A 是「星湖旅游景区」，OSM 里是七星岩 / 鼎湖山
  七星岩: '肇庆星湖旅游景区',
  七星岩景区: '肇庆星湖旅游景区',
  鼎湖山: '肇庆星湖旅游景区',
  // 大角湾（阳江）
  大角湾: '海陵岛大角湾海上丝路旅游区',
  海陵岛: '海陵岛大角湾海上丝路旅游区',
  // 观澜湖（深圳）
  观澜湖: '深圳观澜湖旅游度假区',
  // 开平碉楼（江门）—— 世界遗产，OSM 用全称
  开平碉楼与村落: '开平碉楼文化旅游区',
  // 长鹿（佛山）
  长鹿旅游休博园: '佛山市长鹿旅游休博园景区',
  // 孙中山故里（中山）
  孙中山故居: '中山市孙中山故里旅游区',
  // 雁南飞（梅州）
  雁南飞茶田: '梅州市雁南飞茶田景区',
  // 连州地下河（清远）
  连州地下河: '清远市连州地下河旅游景区',
}

/* ★★ 官方等级名单（5A + 4A）合成**一张表**，**顺序即优先级：5A 在前**，同名以 5A 为准。
 *
 * ⚠️ 09-23 之前这里是两张形状不同的东西：5A 是对象数组（**带 city**），
 *    4A 是纯字符串（**不带**）。形状不一致 → 能装的守卫也不一致 →
 *    5A 有「同名不同地」的距离守卫，**4A 是裸查表**。
 *    代价实测：`莲花山旅游区` 在番禺（广州），而东莞 / 惠州 / 江门 / 汕头 /
 *    深圳 / 揭阳 / 清远各有一座「莲花山」—— 全省 **9 个**元素都继承了番禺那个 4A。
 *    ➜ 现在两边同形，4A 也带 city，走同一个守卫。 */
const RATED_AREAS = [
  ...A_LEVEL_GD['5A'].map((x) => ({
    name: x.name,
    core: coreName(x.name),
    city: `${x.city}市`,
    level: '5A',
  })),
  /* ⚠️ 4A 里有 9 条**查不准城市**（`蓝月湾温泉`、`奇石河`…），名单里故意没写 city。
     它们**评不上级** —— 这是刻意的：宁可没评级，也不要写个猜的市名，
     猜错会把评级张冠李戴，而且**不报错**。 */
  ...A_LEVEL_GD['4A']
    .filter((x) => x.city)
    .map((x) => ({
      name: x.name,
      core: coreName(x.name),
      city: `${x.city}市`,
      level: '4A',
    })),
]

/* 官方名与 OSM 名之间，多出来的那部分**只可能是这些"景区套话"**。
 *
 * ★★ 这是防张冠李戴的关键。实测反例（第一版用"任意子串包含"匹配时全中招）：
 *     · `广州白云山制药厂王老吉足球场` —— 里面那个"白云山"是**厂名/路名**，
 *       多出来的是"制药厂王老吉足球场"，不是套话 ➜ **不认**
 *     · `小罗浮山`（广州的一座小丘）—— 多出来的是个"小"字 ➜ **不认**
 *     · `西樵山体育公园` —— 多出来的是"体育" ➜ **不认**
 *     · `金沙湾休闲会所` —— 多出来的是"会所" ➜ **不认**
 *   而该认的照样认：
 *     · `西樵山风景名胜区` → 多出"风景名胜区" ➜ 认
 *     · `丹霞山世界地质公园` → 多出"世界地质公园" ➜ 认
 *     · `南昆山森林公园` ↔ `南昆山` → 多出"森林" ➜ 认
 */
const SCENIC_FILLER =
  /旅游|文化|风景|名胜|度假|景区|景点|公园|园区|森林|湿地|乐园|博览|展示|博物|纪念|旧址|故里|世界|地质|国家|自然|保护|生态|休闲|观光|体验|中心|广场|温泉|村落|古村|海岸|海岛|海洋|水库|与|区|园/g

/** 两个归一化核心词是不是**同一个地方**。
 *
 *  ★ 判据比"子串包含"严得多：短的那个必须**整块**出现在长的里面，
 *    而且**剩下的部分剥掉景区套话之后必须是空的**。
 *  ⚠️ 就是这一步挡掉了 `白云山制药厂王老吉足球场` 这类误伤 ——
 *    放宽到任意子串，评级会张冠李戴，而且**不报错**。 */
function scenicMatch(a, b) {
  if (a === b) return true
  const [long, short] = a.length >= b.length ? [a, b] : [b, a]
  if (short.length < 3 || !long.includes(short)) return false
  return long.replace(short, '').replace(SCENIC_FILLER, '') === ''
}

/** 「同一个景区不可能离自己的市这么远」——**远距离**张冠李戴的判据。
 *  ⚠️ 它挡不住珠三角的近距离同名（`莲花山` 离名单那座只有 64 km），
 *    那一类只能靠**城市**比对（见 `ratingOf`）。 */
const MAX_OFFICIAL_KM = 150

/** 评级被守卫拦下来的次数。
 *  ★ 必须报出来 —— 否则「守卫没生效」和「本来就没有同名」长得一模一样
 *    （见 MEMORY §三：改完必须看那条计数从 0 变成非 0）。 */
const ratingRejected = { far: 0, city: 0 }

/** 这个名字对应哪条官方记录（先过别名表）。查不到返回 `null`。
 *  ⚠️ 别名（`长隆欢乐世界` → `广州长隆旅游度假区`）也必须走这里 ——
 *    否则别名那条路会**绕过守卫**。 */
function ratedAreaFor(name) {
  const c = coreName(name)
  const viaAlias = SCENIC_ALIAS[c]
  const probe = viaAlias ? coreName(viaAlias) : c
  return RATED_AREAS.find((x) => scenicMatch(probe, x.core)) ?? null
}

/** 元素名对官方名的**覆盖度** —— 官方名有多少字被元素名原样用上。
 *
 *  ★ 必须用**原始名**算，不能用核心词：`莲花山` 与 `莲花山旅游区` 的核心词
 *    都是 `莲花山`，但前者只覆盖官方名的 3/7，后者 7/7 ——
 *    差的正是「到底是不是这一个」。
 *  ➜ 只有覆盖度 = 1 才允许**用官方城市纠正归属**（见 `fullyCovers`）。 */
function nameCoverage(official, element) {
  const o = official.replace(/\s+/g, '')
  const e = element.replace(/\s+/g, '')
  if (!o) return 0
  if (e.includes(o)) return 1
  let best = 0
  for (let i = 0; i < o.length; i += 1) {
    for (let j = i + 1; j <= o.length; j += 1) {
      const sub = o.slice(i, j)
      if (sub.length > best && e.includes(sub)) best = sub.length
    }
  }
  return best / o.length
}

/** 名字**完整覆盖**了某条官方记录吗？是就返回那条记录，否则 `null`。
 *
 *  ★ 用途：整省「按名字抓」下来的元素没有行政归属，只能按 seat 猜 ——
 *    而 seat 在珠三角**必错**（`白水寨` 在增城（广州），离东莞市区 63 km、
 *    离广州市区 72 km，按"最近"会分到东莞）。
 *  ➜ 名字完整覆盖官方名时，**官方城市说了算**。
 *  ⚠️ 只在覆盖度 = 1 时返回：`白水寨风景名胜区`（1.0）归广州，
 *    而 `莲花山`（3/7）不归 —— 否则东莞那座山会被一起搬进广州。 */
function fullyCovers(name) {
  const hit = ratedAreaFor(name)
  if (!hit) return null
  return nameCoverage(hit.name, name) === 1 ? hit : null
}

/** 查一个名字的官方等级。查不到 / 归属对不上 → `undefined`
 *  （**不是**"没等级"，是"这个元素不算那一个景区"）。
 *
 *  ★★ 为什么光有名字不够：**同名不同地**在 OSM 里很常见。
 *     ① 广州有一个 `natural=water` 的**湖**就叫 `万绿湖`
 *        （113.31, 23.10 —— 离河源那个 160 公里）；
 *     ② 珠三角更密：`莲花山` 在 6 个市都有，离名单那座最近只有 64 公里。
 *  ★ 所以守卫有两道：**距离**挡远距离张冠李戴，**城市**挡近距离的。
 *    ⚠️ 09-23 之前**只有 5A 装了这两道**，4A 是裸查表 ——
 *       于是全省 9 个「莲花山」都继承了番禺那个 4A。 */
function ratingOf(name, lng, lat, city) {
  const hit = ratedAreaFor(name)
  if (!hit) return undefined
  const seat = CITY_SEAT[hit.city]
  if (seat && haversineKm({ lng: seat[0], lat: seat[1] }, { lng, lat }) > MAX_OFFICIAL_KM) {
    ratingRejected.far += 1
    return undefined
  }
  /* ★★ 近距离的同名不同地，距离挡不住 —— 只能比**城市**。
     名单说 `莲花山旅游区` 在广州（番禺），那只有归属广州的那个元素才算数。
     ⚠️ 判"没等级"时**绝不能掉下去再按别的记录匹配一遍**
        （第一版就是这么把广州那个湖套上 5A 的，而且不报错）。 */
  if (city && city !== hit.city) {
    ratingRejected.city += 1
    return undefined
  }
  return hit.level
}

/* ★★ 用来**按名字抓**的候选词 —— 给 Overpass 的第四条查询用。
 *   光靠标签抓不到「没有 wikidata 的 5A/4A」（例如白云山），
 *   而闸门放它们进来、抓取却不给，就是"两层判定不一致"（见 MEMORY §四）。
 *   ➜ 闸门认什么，抓取就必须抓什么。 */
const RATED_NAME_RE = [
  ...new Set([
    ...A_LEVEL_GD['5A'].map((x) => coreName(x.name)),
    ...A_LEVEL_GD['4A'].map((x) => coreName(x.name)),
    ...Object.keys(SCENIC_ALIAS),
  ]),
]
  .filter((s) => s.length >= 3)
  /* ⚠️ 转义正则元字符。名单里有 `铁泉·黄金汤`（中点）与
     `银瓶山森林公园-谢岗`（连字符）—— 直接拼进正则会变成"任意字符"，
     从而多抓一堆无关条目。多抓虽会被闸门筛掉，但白花流量。 */
  .map((s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'))
  .join('|')


/* ============================================================
   一、过滤规则
   ============================================================ */

/* ★ 名字黑名单。
   实测踩到的坑：`historic=ruins` 里混着 `沃尔玛`、`盐田综合车场`、
   以及几十个 `XX收费站` / `深圳经济特区XX检查站` —— 这些是
   道路设施，不是景点。光靠标签挡不住，只能按名字挡。

   ★★ 第二组是「园内小景」。深圳一个市就捞出
   `碧岸观山`/`乐水入澜`/`望龙坡`/`灯心窝平台`/`卧龙遗蛋`/`一尺间`
   这类名字 —— 它们是公园里的一个造景点，**不是"一个地方"**。
   判据：这些词**只能当修饰，不能当主体**，所以按名字挡是安全的。
   ⚠️ 刻意**不挡** `世居`/`围`/`第`/`村` —— 客家围屋是正经文物，
   挡了会误伤 `大万世居`（全国重点文保）。宁可留一点噪声。 */
const BAD_NAME = /收费站|检查站|工作口|车场|停车场|沃尔玛|超市|商场|微缩|模型|喷泉|售票|卫生间|洗手间|垃圾|变电|公厕|公交|地铁|小区|大厦|公寓|写字楼|公司|工厂|仓库|码头$|市场$|观景|观山|观水|观圩|听涛|叠水|入澜|清澜|兴澜|水阶|花阶|花海|花坡|游龙|遗蛋|取水|休憩|平台$|驿站|廊桥|悬桥|曲桥|栈道|步道|绿道|小径|涂鸦|一尺间|书房|入口$|出口$|展示厅|展示中心|科普基地|示范园|体验馆|探索城|生态展厅|规划展览馆|档案中心|公墓|陵园|度假村|旧址|炮楼|人家|水源|起点|教育基地/

/* ★★ 「园内小景」的词尾。
 *
 * 为什么用**词尾**而不是词：`繁花谷`/`礼贤台`/`望龙坡`/`兰花溪`
 * 这类名字，词本身没有意义，**只有做结尾时才表示"这是园里一个造景点"**。
 * 判据换成词尾之后，`华强北`/`京基100`/`明华轮` 这些真地方不会被误伤。
 *
 * ⚠️⚠️ 这张表**必须保持很小** —— 09-23 加了「最知名的」闸门之后，
 * 挡噪声的活主要由**出名度**干了（`繁花谷`/`昆虫谷` 根本没有 wikidata），
 * 词尾表再长下去只会误伤。实测踩到的：
 *   · `谷` → 把 **`欢乐谷`**、**`东部华侨城-茶溪谷`** 挡掉了（都是深圳最有名的游乐点！）
 *   · `池` → 会挡掉 **`长白山天池`**
 *   · `陵` → 会挡掉 **`明十三陵`**、**`黄帝陵`**
 *   · `亭` → 会挡掉 **`兰亭`**、**`醉翁亭`**
 *   · `溪`/`源`/`石`/`台`/`坡`/`苑` 都可能出现在真地名里
 * ➜ 只留下**几乎不可能出现在景点名末尾**的那几个。
 * ⚠️ 末尾的繁体字（`灘`/`灣`/`嶼`）是 OSM 简繁混录的产物
 * （实测捞到 `吉坳灣沙灘`），留着是为了库里简繁统一。
 */
const SUFFIX_BAD = /(阶|澜|圩|音|蛋|梗|坳|眼|碧|宾|墓|灘|灣|嶼)$/

/* ★★ 繁体字。OSM 是简繁混录的，实测捞到 `吉坳灣沙灘`、`神秘島樂園`。
   下面这些字**只存在于繁体**（简体分别写作 岛乐园楼庙观馆桥区县广东门车马鸟鱼龙凤阳云电话游缆点号树），
   所以按它们判"这条是繁体"是安全的。
   ⚠️ 别把 `台`/`后`/`里`/`面` 放进来 —— 这几个简繁同形。 */
const TRAD_ONLY = /[島樂園樓廟觀館橋區縣廣東門車馬鳥魚龍鳳陽雲電話遊覽點號樹灣灘嶼鴨鏡]/

/* ★★ 光秃秃的通用名。
   实测捞到 `动物园`、`主体建筑`、`公园` 这种 —— 它们**通过了一切过滤**
   （有 wikidata、名字也不长），但对孩子来说等于没名字：
   「小鸟从动物园带回来一张照片」看不出是哪儿。
   ➜ 只挡**完全等于**这些词的，`广州动物园`/`深圳野生动物园` 不受影响。 */
const GENERIC_NAME = new Set([
  '动物园', '植物园', '公园', '博物馆', '科技馆', '美术馆', '游乐园', '主题公园',
  '水上乐园', '海洋馆', '水族馆', '儿童乐园', '游乐场', '广场', '古城', '古镇',
  '主体建筑', '游客中心', '服务中心', '景区', '风景区', '度假区', '文化中心',
])

/* 只有方位、没有主体的城门名（`北门`/`南门`/`西门`）在列表里毫无信息量。
   ⚠️ 这条会连 `东门` 一起挡掉 —— 它是深圳有名的老街，损失可接受，
   真需要的话在 `CURATED` 之外单独加白名单。 */
const BARE_GATE = /^[东南西北]门$/

/* ★★ 手工剔除表：OSM 里**市界或坐标本身错了**的条目。
 *
 * 为什么只能手工：`惠东大南山` 的坐标是 (22.9236, 114.9259)，
 * 离深圳市民中心 **98.6 公里**，在惠州惠东 —— 但它**通过了
 * Overpass 自己的 `area["name"="深圳市"]` 过滤**。
 * 也就是说**错的是 OSM 的市界多边形本身**，不是我们的判定。
 * ➜ 再拿同一份边界去验（点是否在多边形内）会**继承同一个错误**，
 *   所以这里不走"验边界"那条路，而是**明确列出来**。
 * ⚠️ 这是唯一一处人工干预，每次新增城市后要回看一眼。 */
const MISPLACED = new Set(['惠东大南山'])

/* 名字太长的一律不要（"XX海域界碑原址；墨鱼眼" 这种是标注不是景点） */
const MAX_NAME_LEN = 16

/* ★ `natural=peak` 单独处理：深圳一个市就有 550 个有名山峰
   （三角山、龟山、求水顶…），绝大多数是地形标注，不是景点。
   只留「名字在这张表里」或「有 wikidata」的。 */
const PEAK_ALLOW = /丹霞山|罗浮山|西樵山|白云山|梧桐山|七娘山|莲花山|凤凰山|鼎湖山|圭峰山|南昆山|阴那山|大雁顶|排牙山|塘朗|阳台山|马峦山|银瓶山|黄杨山|飞霞山|观音山|南台山|石坑崆|铜鼓嶂|霍山|越秀山|王子山|帽峰山|大鹏山|笔架山|羊台山|大南山|小南山|燕子岩/

/* ★ 只留这些 `historic` 值。`ruins` 整类不要（噪声率最高的一类）。
 *
 * ⚠️ 09-23 补进来的这几个是**实测漏掉的**（广东缓存里的取值分布）：
 *    `heritage` 35 条、`building` 21 条 —— 这两个加起来比 `castle` 还多，
 *    而它们原来**全被挡在门外**。后果很具体：河源的 `龟峰塔`
 *    （`historic=building` + `tourism=attraction` + wikidata，
 *      是河源唯一一个带 wikidata 的点）就是这样被删掉的，
 *    于是河源整座城市变成 0 条。
 *    ➜ 判据：`historic` 只要**说得出是什么**就留，`ruins`/`yes` 之外不设限。
 *      `yes` 留（是个明确的历史标记），`ruins` 仍然不要。 */
const OK_HISTORIC = new Set([
  'city_gate',
  'castle',
  'tomb',
  'archaeological_site',
  'monument',
  'heritage',
  'building',
  'memorial',
  'fort',
  'manor',
  'citywalls',
  'district',
  'yes',
])

/* 纪念物只在名字像"正经去处"时才留（邓小平塑像可以，一块牌子不行） */
const MEMORIAL_OK = /陵|祠|故居|纪念馆|旧址|堂|塔|书院|围屋|碉楼/

/* ★ 只留这些 `tourism` 值。刻意排除 `hotel`（第一次试查 8 条里 5 条是酒店）
   与 `gallery`（画廊，孩子不感兴趣）。 */
const OK_TOURISM = new Set(['attraction', 'theme_park', 'museum', 'zoo', 'aquarium'])

/* ============================================================
   二、WGS-84 → GCJ-02
   ============================================================ */

const PI = Math.PI
const A = 6378245.0
const EE = 0.00669342162296594323

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}
function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0
  return ret
}
function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0
  return ret
}
/** ★ 国内偏移 300~600 米；国外原样返回 */
function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat]
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI)
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI)
  return [lng + dLng, lat + dLat]
}

/* ============================================================
   三、点在多边形内（用来剔掉园内小件）
   ============================================================ */

function pointInRing(lng, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** 从 Overpass 的 `out geom` 结果里取出所有闭合环（way 与 relation 都收）
 *
 *  ★ 每条环都带上**它自己属于哪个元素**（`w123` / `r456`）。
 *    因为 `out center` 给的是重心，重心**一定落在自己的多边形里** ——
 *    不带 id 的话，`大鹏所城` 会被自己"包含"掉，整条消失。
 */
function collectRings(elements) {
  const rings = []
  const push = (id, geometry) => {
    if (Array.isArray(geometry) && geometry.length >= 4) {
      rings.push({ id, ring: geometry.map((g) => [g.lon, g.lat]) })
    }
  }
  for (const el of elements) {
    const id = `${el.type[0]}${el.id}`
    push(id, el.geometry)
    if (Array.isArray(el.members)) {
      for (const m of el.members) push(id, m.geometry)
    }
  }
  return rings
}

/* ============================================================
   四、scene 推断
   ============================================================
   数据里只写 scene，palette 由它推（见 `landmarks.ts` 的说明）。
   顺序很重要：**先看标签，再看名字**，且名字里
   「海/湾/岛」要排在「山」之前 —— 否则「海山公园」会判成 mountain。
   ============================================================ */

const NAME_RULES = [
  [/(温泉|冷泉|矿泉)/, 'water'],
  [/(瀑布|溪|泉|湖|潭|水库|河|江)/, 'water'],
  [/(海滨|沙滩|海岸|海湾|海滩)/, 'coast'],
  [/(海岛|半岛|湾|海|岛)/, 'coast'],
  [/(溶洞|岩洞|洞穴|地下河)/, 'cave'],
  [/(森林|林场|植物园|树木园|竹林|榕)/, 'forest'],
  [/(草原|牧场|草地|滑草)/, 'grass'],
  [/(滑雪|冰雪|雪山)/, 'snow'],
  /* ⚠️ `塔`/`古城`/`牌坊` 曾经放在这一条（temple），结果 `广州塔`
     被判成"寺庙"配色。现代塔、古城街区、牌坊街都该按 city 走，
     所以把它们挪到了最后一条。这里只留**宗教与宗祠**类。 */
  [/(寺|庙|庙宇|禅院|道观|宫|祠|围屋|碉楼|书院)/, 'temple'],
  [/(山|峰|岭|岩|峡|崖|石|嶂|顶)/, 'mountain'],
  [/(公园|乐园|游乐园|动物园|植物园|农庄|庄园|花园)/, 'grass'],
  [/(街|步行街|古城|广场|塔|中心|博物馆|美术馆|科学馆|展览馆|纪念馆|会馆|口岸|牌坊)/, 'city'],
]

function inferScene(tags) {
  const tourism = tags.tourism
  const historic = tags.historic
  const natural = tags.natural

  /* 标签优先 —— 标签比名字可靠 */
  if (natural === 'beach') return 'coast'
  if (natural === 'peak') return 'mountain'
  if (natural === 'spring') return 'water'
  if (natural === 'waterfall') return 'water'
  if (natural === 'cave_entrance') return 'cave'
  if (tourism === 'zoo') return 'forest'
  if (tourism === 'aquarium') return 'water'
  if (tourism === 'theme_park') return 'grass'
  if (tourism === 'museum') return 'city'
  if (historic === 'city_gate' || historic === 'castle') return 'city'
  if (historic === 'tomb' || historic === 'archaeological_site') return 'temple'

  const name = tags.name || ''
  for (const [re, scene] of NAME_RULES) {
    if (re.test(name)) return scene
  }
  return 'city'
}

/* ============================================================
   五、blurb 生成
   ============================================================
   ⚠️ 诚实说明：**只有下面的 `CURATED` 是逐条写的**，
   其余是按类型套模板 + 按 id 稳定选一条变体。
   套模板的句子读起来会偏"通用"，但**不会张冠李戴**
   （不会给一个公园编出历史典故）—— 这比编造好。

   为什么不逐条写：600~900 条，逐条写要几百次生成，
   而且质量反而会因为疲劳而下降。
   ============================================================ */

const CURATED = {
  世界之窗: '把全世界的名胜缩小搬到一起：埃菲尔铁塔、金字塔、大瀑布都能一眼看到。',
  欢乐谷: '过山车、跳楼机、大摆锤，尖叫声此起彼伏，玩一天都嫌短。',
  锦绣中华民俗村: '中国各地的老房子和名胜做成了小模型，走一圈像走遍全国。',
  东部华侨城: '山上有小火车和茶田，一路都是风景，空气比城里凉快。',
  小梅沙海洋世界: '海底隧道里鱼从头顶游过，白鲸和海豚会跟人打招呼。',
  深圳市儿童乐园: '专给小朋友开的乐园，设施不高不吓人，可以放心玩。',
  梧桐山: '深圳最高的山，爬到顶能同时看到城市和大海。',
  中英街: '一条小街，一边是深圳一边是中国香港，界碑就在路中间。',
  东门: '深圳最热闹的老商业街，好吃的特别多。',
  华强北: '满街都是电子零件和数码产品，像走进一个大迷宫。',
  广州塔: '细细高高的塔，晚上会变色，坐电梯上去能看到整条珠江。',
  白云山: '广州城边的大公园，爬到摩星岭能俯瞰整个广州。',
  陈家祠: '屋顶上雕满了人物和花鸟，每一寸都值得抬头看。',
  沙面岛: '岛上全是老洋楼和百年榕树，走起来很安静。',
  长隆野生动物世界: '坐在小火车里看长颈鹿和老虎，动物离得很近。',
  珠海长隆海洋王国: '巨大的鲸鲨从头顶游过，晚上还有烟花和巡游。',
  圆明新园: '照着北京圆明园的样子仿建的园林，湖上有画舫。',
  佛山祖庙: '屋脊上密密麻麻全是陶塑人物，像一出戏。',
  西樵山: '一座火山变成的大公园，山上有湖有瀑布还有大观音。',
  丹霞山: '红红的石头山一座连一座，形状怪得像画出来的。',
  开平碉楼: '田野里立着一座座小洋楼，是以前华侨回家盖的。',
  罗浮山: '道教名山，云雾常年绕着山顶，有很多古观。',
  鼎湖山: '满山都是树，溪水冰凉，是广东最凉快的地方之一。',
  七星岩: '七座石头山立在湖里，可以坐船从山脚下穿过。',
  惠州西湖: '比杭州西湖小，但桥和塔一样好看，晚上灯亮起来最美。',
  南澳岛: '要坐船才到的小岛，海水很蓝，能吃刚捞上来的海鲜。',
  广济桥: '桥上建着亭子，中间还能开合让船通过，是座会"变身"的桥。',
  潮州牌坊街: '一长排石牌坊立在老街中间，两边全是小吃店。',
  南头古城: '深圳年纪最大的城，老街里藏着很多小展馆。',
  孙中山故居: '一座红色的小楼，周围种着他亲手栽的树。',
  大梅沙: '免费的沙滩，沙子细，夏天人多得像下饺子。',
  深圳湾公园: '沿着海边修的长长绿道，可以骑车，冬天有很多候鸟。',
  莲花山公园: '山顶有座雕像，草坪大得能放风筝，能看见深圳全景。',
  深圳博物馆: '从古代到现在的深圳都在这儿，有讲深圳速度的展。',
  世界之窗阿尔卑斯山冰雪世界: '在南方的夏天里玩雪，进去要穿棉袄。',
}

const BLURB_BY_TYPE = {
  theme_park: [
    '里面全是玩的，一天都玩不完。',
    '有过山车和旋转木马，一进门就听见笑声。',
    '游乐设施排得满满当当，记得留够时间。',
  ],
  zoo: [
    '里面住着很多动物，猴子最热闹。',
    '动物住得离人不远，能看得很清楚。',
    '有长颈鹿、老虎和会开屏的孔雀。',
  ],
  aquarium: [
    '隔着玻璃看鱼游来游去，像走进海底。',
    '水里灯光蓝蓝的，鱼群会成群地转圈。',
  ],
  museum: [
    '里面放着很多老东西，看一圈能知道不少事。',
    '一件件展品摆得整整齐齐，慢慢看很有意思。',
    '有讲解牌，看完能讲给同学听。',
  ],
  attraction: [
    '是个值得停下来看看的地方。',
    '很多人来这儿拍照，景色不错。',
    '在这儿待上一会儿，能记住很久。',
  ],
}

const BLURB_BY_SCENE = {
  mountain: ['山不高，爬起来正好，山顶能看到很远。', '山路有树遮阴，走到顶有风。'],
  water: ['一大片水，风一吹就有波纹。', '水边凉快，夏天来最舒服。'],
  coast: ['有沙滩和海浪，可以光着脚走一走。', '海风咸咸的，浪一层层推上来。'],
  forest: ['树长得又高又密，走进去一下凉快下来。', '满眼都是绿色，能听见鸟叫。'],
  grass: ['有大片草地，可以跑一跑、放风筝。', '草地平平的，适合坐着发呆。'],
  cave: ['洞里凉丝丝的，石头形状很怪。', '走进去像进了另一个世界。'],
  temple: ['屋檐上有雕花，进去要轻声。', '老房子保存得很好，能看出以前的讲究。'],
  city: ['街上人来人往，很热闹。', '周围都是高楼，晚上灯全亮起来。'],
  snow: ['一片白，冷得直跺脚。', '雪踩上去咯吱响。'],
  desert: ['干干的，一眼望过去全是黄沙。', '太阳很大，要戴帽子。'],
}

/** 稳定哈希 —— 同一个 id 永远选到同一条变体，重跑不会让文案乱跳 */
function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

function pickVariant(list, id) {
  return list[hash(id) % list.length]
}

function makeBlurb(name, tags, scene, id) {
  const hit = CURATED[name]
  if (hit) return hit
  /* 名字里带"XX的XX"的（如"东部华侨城 - 茶溪谷"）取后半段再查一次 */
  const tail = name.split(/[ -—·]/).pop()
  if (tail && CURATED[tail]) return CURATED[tail]

  const byType = BLURB_BY_TYPE[tags.tourism]
  if (byType) return pickVariant(byType, id)
  const byScene = BLURB_BY_SCENE[scene]
  if (byScene) return pickVariant(byScene, id)
  return '是个值得停下来看看的地方。'
}

/* ============================================================
   六、抓取
   ============================================================ */

/* ============================================================
   ★★ 「最知名的」闸门（家长 09-23 定的口径）
   ============================================================

   家长原话：「数量太多了……加上世界总数不能超过 3000。
   中国 2000 个点差不多了。**最知名的**。」

   判据：**有 `wikidata` 或 `wikipedia`**（一个地方出名到有人给它建
   百科条目），**或者**是 `theme_park`/`zoo`/`aquarium`
   （这类本身就是"值得专程去"，而且量很少）。

   ⚠️ 为什么不用「5A/4A 景区名单」：那份名单要另外去抓，
   而且**只有名字没有坐标**（实测），还是得回来匹配 OSM。

   ⚠️ 为什么这一条**同时**写进 Overpass 查询和客户端：
   服务端写是为了**少拉数据**（实测深圳 1447 条 → 几十条），
   客户端留一份是为了**换数据源时行为不变**（双保险）。
   ============================================================ */
/* ⚠️ 别用 Overpass 的**键正则** `[~"^(wikidata|wikipedia)$"~"."]`。
   实测它比普通键过滤慢得多、更容易 504；而 `["wikidata"]` / `["wikipedia"]`
   两条分开写**同样短**，服务器吃得住（实测深圳 9.5 秒、45 条）。
   所以下面一律写两遍，不图省那一行。 */
const FAMOUS_KEYS = ['["wikidata"]', '["wikipedia"]']

function isFamous(name, tags, lng, lat, city) {
  return (
    Boolean(tags.wikidata || tags.wikipedia) ||
    /* ★★ 「全国知名」的三条判据（家长 09-23 定）——
       文保单位 / 5A·4A / wikidata，三选一即可。
       ⚠️ 等级那条要带上**坐标与城市**：`ratingOf` 靠它们挡「同名不同地」。 */
    isNationalHeritage(tags) ||
    Boolean(tags['tourism:level:CN']) ||
    Boolean(ratingOf(name, lng, lat, city)) ||
    /* ★★ 名山要靠 `PEAK_ALLOW` 过闸门 —— 这是**两层判定必须一致**的又一处。
       ⚠️ 原来 `PEAK_ALLOW` 只在**标签闸门**里起作用，而闸门比它先跑，
       于是「名字在 PEAK_ALLOW 里、但没有 wikidata」的山**两处都过不了**：
       标签那层想放，出名度那层已经先把它删了。
       实测代价：河源的 `霍山`、`铜鼓嶂` 双双消失（河源整座城市变 0 条）。 */
    (tags.natural === 'peak' && PEAK_ALLOW.test(name)) ||
    tags.tourism === 'theme_park' ||
    tags.tourism === 'zoo' ||
    tags.tourism === 'aquarium'
  )
}

/** 全国重点文物保护单位。
 *
 *  ★ 这是**国家级**称号（`ref:heritage:CN` 是公布批次编号，如 `1-0001-1-001`），
 *    比"有 wikidata"硬得多 —— 实测广东有 27 条带编号。
 *  ⚠️ 光看 `protection_title` 会漏（有些只填了编号、没填称号），两个都要认。 */
function isNationalHeritage(tags) {
  return Boolean(tags['ref:heritage:CN'] || tags['protection_title'])
}

/* ★★ 拆成三条小查询，而不是一条大 union。
 *
 * 为什么：一条「大 union」在广州市这种大市上**必然 504**
 * （实测：连试 4 次全挂，每次都是 `server is probably too busy`）。
 * 拆小之后单次请求轻得多，成功率高很多；而且**一条挂了另外两条还在**
 * —— 代价只是某个类别少几条，而不是整座城市没有。
 */
function buildQueries(city) {
  const head = `[out:json][timeout:180];
area["name"="${city}"]->.a;`
  const each = (filter) => FAMOUS_KEYS.map((k) => `  nwr${filter}${k}(area.a);`).join('\n')
  return [
    {
      label: 'tour',
      query: `${head}
(
${each('["tourism"~"^(attraction|museum)$"]')}
  nwr["tourism"~"^(theme_park|zoo|aquarium)$"](area.a);
${each('["leisure"~"^(park|garden)$"]')}
);
out center tags;`,
    },
    {
      label: 'nat',
      /* ★★ 山峰**在服务端就按名字过滤**，不要拉回来再筛。
         实测深圳一个市有 **550 个**有名山峰（三角山、龟山、求水顶…），
         而 `PEAK_ALLOW` 只留个位数 —— 也就是说 **99% 的流量是白拉的**，
         而 Overpass 的瓶颈恰恰是"拉得多"。用 `["name"~"..."]` 让服务器
         先筛，单次请求轻得多、也少占别人的带宽。
         ⚠️ 客户端那层 `PEAK_ALLOW` 检查**保留**（双保险）：
         服务端正则一旦写错，客户端还兜得住。
         ★ 海滩不看出名度一律留 —— 数量本来就少，而且"能下水玩"
         对孩子来说本身就是目的地。 */
      query: `${head}
(
  nwr["natural"="beach"](area.a);
${each('["natural"~"^(spring|waterfall|cave_entrance)$"]')}
  nwr["natural"="peak"]["wikidata"](area.a);
  nwr["natural"="peak"]["name"~"${PEAK_ALLOW.source}"](area.a);
);
out center tags;`,
    },
    {
      label: 'hist',
      query: `${head}
(
${each('["historic"~"^(city_gate|castle|tomb|archaeological_site|monument)$"]')}
);
out center tags;`,
    },
    {
      label: 'herit',
      /* ★★ 第四条：把「闸门认得、但前三条抓不到」的那些捞回来。
       *
       * 为什么必须有这条：闸门现在放行 ①全国重点文保 ②5A·4A ③wikidata，
       * 而前三条查询**只按 `wikidata`/`wikipedia` 抓** ——
       * 于是"闸门放它进来、抓取却不给它"，正是**两层判定不一致**。
       * 实测代价：`白云山`（广州 5A、羊城八景）是 `natural=peak`
       * 且**没有 wikidata**，纯靠 `PEAK_ALLOW` 侥幸留下。
       *
       * ⚠️ 只放**按键**的过滤（很便宜）；「按名字抓」那半条搬去了整省查询，
       *    见 `buildProvinceNameQuery()` —— 原因见那里的说明。
       * ⚠️ 整条是 `soft` 的（拉不到只少几条，不废掉整座城市）。 */
      query: `${head}
(
  nwr["ref:heritage:CN"](area.a);
  nwr["protection_title"](area.a);
  nwr["tourism:level:CN"](area.a);
);
out center tags;`,
    },
  ]
}

/** 整省「按名字抓」——**一条查询顶 21 条**。
 *
 * ★★ 为什么不是每市一条（实测数据）：
 *    在韶关试「裸正则」与「先按 tag 收窄再正则」两种写法，都是 **41 秒**；
 *    再把正则从 194 个词缩到 25 个词，**还是 41 秒**。
 *    ➜ 说明耗时**不在正则大小**，而在**扫描整片区域**。
 *    于是每市一条 = 21 次全区域扫描；而整省一条只要 **36 秒**，
 *    21 次请求变 1 次 —— 既快得多，也不再招 504。
 *
 * ⚠️ 代价：整省结果**不带城市归属**，得自己按"最近的市质心"分下去
 *    （见 `main()` 阶段三）。而质心要等各市的标签结果回来才算得出来，
 *    所以整省这条必须排在**阶段二**。
 * ⚠️ 这条**不能省**：实测没有它，韶关只剩 `丹霞山摩崖石刻`
 *    （丹霞山景区里的一块石刻），而**丹霞山本身没有 wikidata**，
 *    于是"孩子去的丹霞山"变成了"丹霞山摩崖石刻"。
 */
function buildProvinceNameQuery() {
  return `[out:json][timeout:300];
area["name"="广东省"]->.a;
(
  nwr["name"~"${RATED_NAME_RE}"](area.a);
);
out center tags;`
}

/** 母体几何 —— 用来剔「园内小件」
 *
 *  ★★ 为什么**只取"候选自己"的几何**，而不是把全市公园都拉回来：
 *    一开始的做法是 `way["leisure"~"^(park|garden)$"]` 全量 `out geom`，
 *    实测**一个市 1.7~2.6 MB**（全是小区花园），而其中绝大部分
 *    根本不在候选里、**永远用不上**。
 *    改成"先筛候选、再按 id 拉几何"之后，一个市只有几十上百个多边形。
 *
 *  ⚠️ 副作用（可接受）：落在**非候选**公园里的造景点不会被剔掉。
 *    但那种公园本身也不进库，它的小件靠名字规则挡（见 `SUFFIX_BAD`）。
 *    真正要防的三类 —— 世界之窗、大鹏所城、莲花山公园 ——
 *    **它们自己就是候选**，所以照剔不误。
 */
function buildGeomQuery(candidates) {
  const ways = candidates.filter((c) => c.osm.startsWith('w')).map((c) => c.osm.slice(1))
  const rels = candidates.filter((c) => c.osm.startsWith('r')).map((c) => c.osm.slice(1))
  const parts = []
  if (ways.length) parts.push(`  way(id:${ways.join(',')});`)
  if (rels.length) parts.push(`  relation(id:${rels.join(',')});`)
  if (parts.length === 0) return null
  return `[out:json][timeout:180];
(
${parts.join('\n')}
);
out geom;`
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ★ 城市归属兜底。
   实测：用 `area["name"="深圳市"]` 查，却捞到 `惠东大南山`
   —— 惠东属惠州。原因是 OSM 的市界 relation 有飞地，也有坐标录错的点。
   与其给 21 个市各写一份 bbox，不如按「离本市中心 >120 公里」剔掉：
   广东相邻地级市间距普遍 100 公里以内，120 公里足够宽松。 */
function haversineKm(a, b) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function dropOutliers(points) {
  if (points.length < 5) return { kept: points, removed: 0 }
  /* ⚠️ 用的是 WGS-84 那两个字段 —— 这一步跑在转 GCJ-02 之前 */
  const lngs = points.map((p) => p.lngWgs).sort((a, b) => a - b)
  const lats = points.map((p) => p.latWgs).sort((a, b) => a - b)
  const center = { lng: lngs[lngs.length >> 1], lat: lats[lats.length >> 1] }
  const kept = points.filter(
    (p) => haversineKm(center, { lng: p.lngWgs, lat: p.latWgs }) <= 120,
  )
  return { kept, removed: points.length - kept.length }
}

/* ============================================================
   六、每城上限：同城之内只留最靠前的 N 个
   ============================================================ */

/* 「孩子想去程度」—— 排序的次要权重。
   ★ 一个主题乐园比一座古塔对孩子更有吸引力；温泉/漂流则相反
     （温泉是大人去的，漂流对小孩有危险）。所以这里按类型给分，
     **不是**在说"哪个更有文化价值"。 */
const KID_APPEAL = {
  theme_park: 40,
  zoo: 40,
  aquarium: 40,
  museum: 25,
  attraction: 15,
  park: 10,
  garden: 10,
}

/** 同城排序用的分数（越大越靠前）。
 *
 *  优先级（家长 09-23 定的"全国知名"口径，直接变成排序依据）：
 *    ① 官方等级 5A > 4A
 *    ② 全国重点文物保护单位
 *    ③ 有维基**条目** > 只有 wikidata 条目
 *    ④ 孩子想去程度
 *  ★ 最后一定按名字兜底 —— 否则同分的几条顺序由输入顺序决定，
 *    重跑一次产物就抖一次（`landmarks-gd.json` 会无意义地整份 diff）。
 */
function rankOf(c) {
  let s = 0
  if (c.rating === '5A') s += 10_000
  else if (c.rating === '4A') s += 6_000
  if (c.heritage) s += 3_000
  if (c.wiki) s += 1_200
  if (c.wd) s += 400
  s += KID_APPEAL[c.tags.tourism] ?? 0
  if (c.tags.natural) s += 30
  if (c.tags.historic) s += 20
  return s
}

/** 按城市分档截断。没在 `CITY_CAP` 里的市（三线及以下）**不截**。 */
function applyCityCaps(candidates) {
  const byCity = new Map()
  for (const c of candidates) {
    const list = byCity.get(c.city) ?? []
    list.push(c)
    byCity.set(c.city, list)
  }
  const kept = []
  const cut = {}
  for (const [city, list] of byCity) {
    const cap = CITY_CAP[city]
    if (!cap || list.length <= cap) {
      kept.push(...list)
      continue
    }
    list.sort((a, b) => rankOf(b) - rankOf(a) || a.name.localeCompare(b.name, 'zh'))
    cut[city] = list.length - cap
    kept.push(...list.slice(0, cap))
  }
  return { kept, cut }
}

/* ══════════════ 同一个景区的"重影"要并成一条（家长 09-23 定）══════════════ */

/** 只认「一个核心词 + 一个**景区后缀**」这一种关系。
 *  ⚠️ 判据必须**紧**。放宽成"任意景区套话"会把 `长隆欢乐世界` /
 *    `长隆飞鸟乐园` 也并掉 —— 那是**四个不同的园**（各自的票、各自的一天），
 *    不是重影。所以后缀只列真正的"行政/等级后缀"，**不含** `乐园`/`世界`。 */
const SAME_PLACE_SUFFIX =
  /^(旅游区|旅游景区|风景区|风景名胜区|旅游度假区|文化旅游区|景区|公园|森林公园|国家森林公园|地质公园|世界地质公园|水库|温泉|旅游风景区|生态旅游区|旅游度假区|景区)$/

/** 两个核心词是不是**同一个地方**（一个 = 另一个 + 一个景区后缀）。
 *  ⚠️ 用 `startsWith` 而不是 `includes` —— `莲花山` 在 `小莲花山` 里也"包含"，
 *    但那是另一座山。 */
function samePlace(a, b) {
  if (a === b) return true
  const [long, short] = a.length >= b.length ? [a, b] : [b, a]
  if (short.length < 3 || !long.startsWith(short)) return false
  return SAME_PLACE_SUFFIX.test(long.slice(short.length))
}

/** 同市之内、同一景区的重影只留**排序最高**的那条。
 *
 *  实测要并的：`白云山`/`白云山风景名胜区`、`大雁山`/`大雁山风景区`、
 *  `丹霞山`/`丹霞山世界地质公园`、`莲花山`/`莲花山旅游区`/`莲花山水库`。
 *  ⚠️ **只在同一个市内并** —— 跨市并会把深圳那座真·莲花山公园也删掉，
 *    那是另一个地方、另一个景点。
 */
function collapseSamePlace(candidates) {
  const kept = []
  const merged = []
  for (const c of candidates) {
    const core = coreName(c.name)
    const at = kept.findIndex((k) => k.city === c.city && samePlace(coreName(k.name), core))
    if (at < 0) {
      kept.push(c)
      continue
    }
    const prev = kept[at]
    const winner = rankOf(c) > rankOf(prev) ? c : prev
    const loser = winner === c ? prev : c
    merged.push(`${loser.city}·${loser.name} → 并入 ${winner.name}`)
    kept[at] = winner
  }
  return { kept, merged }
}

/** ★★ 开平碉楼与村落（世界遗产 + 5A）—— **整片只留 1 条**。
 *
 *  江门 41 条里 **19 条**是它拆出来的单体：铭石楼 / 瑞石楼 / 升峰楼 / 居安楼 /
 *  龙胜楼 / 振安楼 / 锦江楼 / 各类居庐与别墅 / 自力村 / 马降龙古村落 /
 *  汀江圩华侨近代建筑群 …。孩子飞过去看到「铭石楼」，不知道那是什么；
 *  而它们本来就同属一个世界遗产。
 *
 *  ⚠️ 用**显式名单**，不用两条看起来更"聪明"的规则：
 *    · 「名字以楼/庐/别墅结尾就删」→ 会误伤真独立的景点；
 *    · 「片区附近 N 公里内的建筑都并进来」→ 佛山祖庙离西樵山才 17 km，
 *      那条规则会把祖庙并进西樵山。 */
const KAIPING_SUB = new Set([
  '铭石楼', '瑞石楼', '升峰楼', '居安楼', '龙胜楼', '振安楼', '锦江楼', '云幻楼',
  '安庐', '官生居庐', '澜生居庐', '球安居庐', '叶生居庐', '逸农庐',
  '养闲别墅', '耀光别墅', '自力村', '马降龙古村落', '汀江圩华侨近代建筑群',
])

function dropKaipingSubBuildings(candidates) {
  const kept = []
  const dropped = []
  for (const c of candidates) {
    if (c.city === '江门市' && KAIPING_SUB.has(c.name)) {
      dropped.push(c.name)
      continue
    }
    kept.push(c)
  }
  return { kept, dropped }
}

async function overpass(query, label, { retries = 6, soft = false, timeoutMs = CLIENT_TIMEOUT_MS } = {}) {
  const cacheFile = path.join(CACHE_DIR, `${label}.json`)
  if (!REFRESH && fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  }
  let lastErr = ''
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const endpoint = ENDPOINTS[(attempt - 1) % ENDPOINTS.length]
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': 'little-writer-forest/1.0 (landmark library build)' },
        body: new URLSearchParams({ data: query }),
        /* ★★ 客户端超时必须有。
           实测备用实例会**挂住不动**（一次请求卡了 75 秒以上），
           而查询里写的 `[timeout:180]` 是**服务端的**执行上限，
           拦不住"连上了但一直不回"。没有这一行，一个挂死的实例
           会把整个抓取拖到天荒地老。 */
        signal: AbortSignal.timeout(timeoutMs),
      })
      const text = await res.text()
      if (res.ok && text.trimStart().startsWith('{')) {
        const json = JSON.parse(text)
        fs.mkdirSync(CACHE_DIR, { recursive: true })
        fs.writeFileSync(cacheFile, text)
        return json
      }
      lastErr = `http=${res.status} ${text.slice(0, 120).replace(/\s+/g, ' ')}`
    } catch (e) {
      lastErr = String(e)
    }
    /* Overpass 经常 504「too busy」—— 退避重试，别当成查询写错了。
       ★ 加抖动，免得多个查询同步重试、把服务器再压一次。
       ★ 换一台实例再试（见 `ENDPOINTS` 的说明）。 */
    const wait = 3000 * attempt + Math.floor(Math.random() * 1500)
    process.stderr.write(
      `    ⟳ ${label} 第 ${attempt} 次失败（${lastErr.slice(0, 60)}），${wait}ms 后换实例重试\n`,
    )
    await sleep(wait)
  }
  /* ★ soft：这一类拉不到就算了，别把整座城市废掉 */
  if (soft) {
    process.stderr.write(`    ⚠️ ${label} 放弃（${lastErr.slice(0, 70)}）\n`)
    return { elements: [] }
  }
  throw new Error(`${label} 抓取失败：${lastErr}`)
}

/* ============================================================
   七、主流程
   ============================================================ */

const argv = process.argv.slice(2)
const REFRESH = argv.includes('--refresh')
const DRY = argv.includes('--dry')
const only = argv.find((a) => a.startsWith('--city='))?.slice(7)
const targets = only ? [only] : CITIES

function coordOf(el) {
  if (typeof el.lon === 'number' && typeof el.lat === 'number') return [el.lon, el.lat]
  if (el.center) return [el.center.lon, el.center.lat]
  return null
}

/** 第一遍：按标签与名字筛。
 *
 *  ★ 这里**不做**"园内小件"判定 —— 那需要几何，而几何要等候选出来之后
 *    才按 id 去拉（见 `buildGeomQuery`）。所以拆成两遍。
 *  ⚠️ 坐标在这一遍**保持 WGS-84**，因为多边形判定用的是 WGS-84；
 *    转 GCJ-02 放到最后写文件时做。
 *
 *  ★ 入参是 `{ el, fromArea }[]` —— 一个市的数据来自两处：
 *    ① 按行政边界抓的三条标签查询（`fromArea: true`）
 *    ② 整省「按名字抓」分下来的（`fromArea: false`）
 *    两者都走同一套筛子、共用同一个 `seen`，所以**同名不会进两次**。
 */
function filterCandidates(city, wrapped) {
  const seen = new Set()
  const out = []
  const dropped = { noName: 0, notFamous: 0, badName: 0, badTag: 0, peak: 0, memorial: 0, dup: 0, badCoord: 0, misplaced: 0 }

  for (const { el, fromArea } of wrapped) {
    const tags = el.tags || {}
    const name = tags.name
    if (!name) {
      dropped.noName += 1
      continue
    }

    /* ★★ 归一化**必须排在所有判定之前，而且只做一次**。
       ⚠️ 踩过的坑（09-23）：OSM 里 `李众胜堂祖铺 李众胜堂祖铺` **中间夹了个空格**
       （raw 是 13 字），而落库前会 `replace(/\s+/g,'')` 变成 12 字。于是
       「重复名」那条判据是在 **raw** 上算的（13 是奇数 → 不成立），
       而落库用的却是 **key**（12 字 → 正好是自身两遍）。
       ➜ **被判断的字符串 ≠ 被存下去的字符串**，守卫整条失效 ——
       而且**不报错、不崩、日志里 `badName: 0`**，看着像"这库里本来就没这种脏名字"。
       ➜ 所以：先归一化成 `key`，后面**所有判定与落库都用 `key`**。 */
    const key = name.replace(/\s+/g, '')

    /* ⚠️ 坐标要**在闸门之前**取 —— `official5A` 靠它挡「同名不同地」
       （广州那个 `natural=water` 的湖也叫 `万绿湖`）。 */
    const coord = coordOf(el)
    if (!coord) {
      dropped.badCoord += 1
      continue
    }

    /* ★★ 「全国知名」闸门 —— 服务端已经筛过一遍，这里是双保险。
       ⚠️ 必须传 `key`：等级名单（`ratingOf`）是按**归一化后的名字**匹配的。 */
    if (!isFamous(key, tags, coord[0], coord[1], city)) {
      dropped.notFamous += 1
      continue
    }

    /* 标签闸门 */
    if (tags.tourism && !OK_TOURISM.has(tags.tourism)) {
      dropped.badTag += 1
      continue
    }
    if (tags.natural === 'peak' && !PEAK_ALLOW.test(name) && !tags.wikidata) {
      dropped.peak += 1
      continue
    }
    if (tags.historic === 'monument' && !MEMORIAL_OK.test(name) && !tags.wikidata) {
      dropped.memorial += 1
      continue
    }
    if (tags.historic && !OK_HISTORIC.has(tags.historic)) {
      dropped.badTag += 1
      continue
    }
    if (!tags.tourism && !tags.natural && !tags.historic && !tags.leisure) {
      dropped.badTag += 1
      continue
    }

    /* 名字闸门（`key` 在上面已经归一化过了，这里直接用） */
    if (
      BAD_NAME.test(key) ||
      SUFFIX_BAD.test(key) ||
      TRAD_ONLY.test(key) ||
      BARE_GATE.test(key) ||
      GENERIC_NAME.has(key) ||
      key.length > MAX_NAME_LEN ||
      /[；;]/.test(key)
    ) {
      dropped.badName += 1
      continue
    }
    /* ★ OSM 里有**名字被写了两遍**的条目（实测 `李众胜堂祖铺 李众胜堂祖铺`），
       是录入时把 name 拼接了两次。判据：正好是自身两遍。
       ⚠️ 必须用归一化后的 `key` —— 用 raw `name` 会被中间那个空格骗过去。 */
    if (key.length % 2 === 0 && key.slice(0, key.length / 2) === key.slice(key.length / 2)) {
      dropped.badName += 1
      continue
    }
    /* 至少要有两个汉字 —— 挡掉纯外文/纯符号 */
    if ((key.match(/[\u4e00-\u9fa5]/g) || []).length < 2) {
      dropped.badName += 1
      continue
    }

    if (MISPLACED.has(key)) {
      dropped.misplaced += 1
      continue
    }
    if (seen.has(key)) {
      dropped.dup += 1
      continue
    }
    seen.add(key)

    out.push({
      osm: `${el.type[0]}${el.id}`,
      name: key,
      city,
      lngWgs: coord[0],
      latWgs: coord[1],
      tags: { tourism: tags.tourism, natural: tags.natural, historic: tags.historic, leisure: tags.leisure },
      /* ★ 下面四个字段只用来**排序**（决定谁进每城前 N），不直接落库。
         `rating` 例外 —— 它就是家长要的「评级」，会写进产物。 */
      rating: ratingOf(key, coord[0], coord[1], city),
      heritage: isNationalHeritage(tags),
      wiki: Boolean(tags.wikipedia),
      wd: Boolean(tags.wikidata),
      /* ★ 这条是**按行政边界**（`area["name"="市名"]`）抓到的，还是按**最近质心**
         从整省结果里分下来的？
         ⚠️ 跨市去重要用：边界归属**比质心猜测权威**，冲突时听边界的。 */
      fromArea,
    })
  }
  return { out, dropped }
}

/** 第二遍：剔掉落在**别的候选**多边形里的（园内小件）。
 *
 *  ⚠️ 必须排除"自己包含自己"：`out center` 的重心**一定落在自己的多边形里**，
 *  不排除的话 `大鹏所城` 会把自己筛掉，整条消失。
 */
function dropInsideParents(candidates, geomData) {
  const rings = collectRings(geomData.elements)
  if (rings.length === 0) return { kept: candidates, removed: 0 }
  const kept = candidates.filter(
    (c) => !rings.some((r) => r.id !== c.osm && pointInRing(c.lngWgs, c.latWgs, r.ring)),
  )
  return { kept, removed: candidates.length - kept.length }
}

async function main() {
  const all = []
  const failed = []
  const stat = { raw: 0, kept: 0, dropped: {} }

  const CONCURRENCY = 2

  /* ── 阶段一：并发抓各市的**标签数据**（四条小查询，各自软失败）──
   *
   * ⚠️ 只开 2 路：Overpass 是**公共资源**，开太多会把别人挤下去，
   * 也会招来更多 504（首轮失败率本来就已经很高）。
   * ⚠️ 这一阶段**只抓不筛** —— 筛要等阶段二把整省的名字结果分下来，
   *    两处来源共用一套筛子（见 `filterCandidates`）。 */
  const partsByCity = new Map()
  {
    const queue = [...targets]
    async function fetchWorker() {
      for (;;) {
        const city = queue.shift()
        if (!city) return
        process.stderr.write(`→ ${city}\n`)
        const parts = []
        for (const q of buildQueries(city)) {
          const r = await overpass(q.query, `${q.label}-${city}`, { soft: true })
          parts.push(...(r.elements || []))
        }
        if (parts.length === 0) {
          failed.push(city)
          process.stderr.write(`   ✖ ${city}：一条都没拿到，跳过\n`)
        }
        partsByCity.set(city, parts)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => fetchWorker()),
    )
  }

  /* ── 阶段二：**整省一条**「按名字抓」──
   * ★ 21 次请求变 1 次，且不招 504。原因见 `buildProvinceNameQuery()`。
   * ⚠️ 客户端超时放到 180 秒：实测这条要 36 秒，而默认的 60 秒
   *    在服务器忙的时候会**误杀**（它没挂，只是慢）。 */
  const nameEls =
    (
      await overpass(buildProvinceNameQuery(), 'names-广东', {
        soft: true,
        timeoutMs: 180_000,
      })
    ).elements || []

  /* ── 阶段三：把整省结果按**最近的市政府**分下去，再逐市筛 ──
   *
   * ★ 为什么用固定的市 seat 而不是"各市点的质心"：见 `CITY_SEAT` 的说明
   *   （质心法把 `万绿湖` 分到了广州、把 `罗浮山` 分到了东莞，
   *    而且某个市标签结果为空时**永远收不到东西** —— 河源就是这样变 0 条的）。
   * ⚠️ 质心/seat 法在**边界**上都会猜错，所以真正的归属仍以阶段一的
   *    `fromArea: true` 为准（见跨市去重那一步）。 */
  const nameElsByCity = new Map()
  let nameUnassigned = 0
  for (const el of nameEls) {
    const c = coordOf(el)
    if (!c) {
      nameUnassigned += 1
      continue
    }
    /* ★ 官方名单里**带城市**，优先用它。
       ⚠️ 5A 与 4A 的用法**不一样**，因为两者的城市信息精度不同：
         · **5A**：只有 16 家、逐个核过 → 无条件优先。
           （罗浮山的多边形重心离东莞市区更近（35 km vs 41 km），
             按 seat 最近会分错；官方说它在惠州。）
         · **4A**：172 家、量大 → **只在名字被完整覆盖时**才优先。
           ⚠️ 无条件优先会把**东莞那座莲花山也搬进广州** ——
             它和番禺的 `莲花山旅游区` 核心词一样，都叫「莲花山」。
             覆盖度 3/7 就把这种挡在外面（见 `fullyCovers`）。
       ★ 这一步同时修掉了一批**城市归属错**：`宝墨园`/`沙湾古镇`（番禺，属广州）、
         `白水寨`（增城，属广州）、`广州融创水世界`（花都，属广州）、
         `皂幕山`（高明，属佛山）、`泉林黄金小镇`（恩平，属江门）、
         `海上田园`（宝安，属深圳）—— 它们都离本市市区 26–85 km，
         而珠三角两个市府之间常常只有 30–50 km，按"最近 seat"必错。 */
    const name = (el.tags || {}).name || ''
    const area = ratedAreaFor(name)
    const seatOk =
      area && (!CITY_SEAT[area.city] || haversineKm(seatOf(area.city), { lng: c[0], lat: c[1] }) <= MAX_OFFICIAL_KM)
    const useOfficialCity = Boolean(area) && seatOk && (area.level === '5A' || nameCoverage(area.name, name) === 1)
    const city = useOfficialCity ? area.city : nearestCity(c[0], c[1])
    const list = nameElsByCity.get(city) ?? []
    list.push(el)
    nameElsByCity.set(city, list)
  }
  if (nameEls.length) {
    process.stderr.write(
      `\n整省「按名字抓」：${nameEls.length} 条，分到 ${nameElsByCity.size} 个市` +
        (nameUnassigned ? `（${nameUnassigned} 条没坐标，弃）` : '') +
        '\n',
    )
  }

  for (const city of targets) {
    const parts = partsByCity.get(city) ?? []
    const extra = nameElsByCity.get(city) ?? []
    if (parts.length === 0 && extra.length === 0) continue

    const wrapped = [
      ...parts.map((el) => ({ el, fromArea: true })),
      ...extra.map((el) => ({ el, fromArea: false })),
    ]
    process.stderr.write(`→ ${city}（标签 ${parts.length} + 按名字 ${extra.length}）\n`)

    /* 第一遍：标签 + 名字 */
    const first = filterCandidates(city, wrapped)

    /* 第二遍：按**候选自己的 id** 拉几何，剔园内小件 */
    let kept2 = first.out
    let inPark = 0
    const geomQuery = buildGeomQuery(first.out)
    if (geomQuery) {
      const geomData = await overpass(geomQuery, `geom-${city}`, { soft: true })
      const r = dropInsideParents(first.out, geomData)
      kept2 = r.kept
      inPark = r.removed
    }

    const { kept, removed } = dropOutliers(kept2)
    const dropped = { ...first.dropped, inPark, outlier: removed }
    stat.raw += wrapped.length
    stat.kept += kept.length
    for (const [k, v] of Object.entries(dropped)) stat.dropped[k] = (stat.dropped[k] || 0) + v
    process.stderr.write(`  原始 ${wrapped.length} → 留 ${kept.length}\n`)
    all.push(...kept)
  }

  /* ★★ 跨市去重 —— 同一个 OSM 元素会被**多个市**同时返回。
   *
   * 两个来源：① 各市按 `area` 抓的标签查询（边界重叠）；
   *          ② 整省「按名字抓」再按质心分下来的（边界上会分错）。
   *
   * 为什么必然发生：`area["name"="深圳市"]` 用的是 OSM **自己的**行政边界，
   * 而那份边界本身就有错（实测 `惠东大南山` 离深圳 98.6 km，却通过了深圳的 area 过滤）。
   * 边界一旦重叠，边界附近的地物就会**同时**进两个市的候选 →
   * 同一个 `osm` id 落库两次 → **id 重复**。
   *
   * ⚠️ 只在**市**内去重（`filterCandidates` 里那个 `seen`）挡不住这个 ——
   * `seen` 是每个市一份的，跨市看不见对方。
   * ➜ 后果：`checkLandmarks` 报「id 重复」；`sproutCount` 少两条（孩子地图上少两格）。
   *
   * ★ 判据：留**几何上最近的**那个市，而不是"先来先得"。
   * 先来先得会把 `石人山`（实际在汕尾，lng 115.0）算进深圳。
   * ⚠️ 这里也改用**固定市 seat**（`nearestCity`），不再用"各市点的质心" ——
   *    质心会被某个市的点分布带偏（见 `CITY_SEAT` 的说明）。
   */
  const byOsm = new Map()
  let crossDup = 0
  for (const p of all) {
    const prev = byOsm.get(p.osm)
    if (!prev) {
      byOsm.set(p.osm, p)
      continue
    }
    crossDup += 1
    /* ★ 归属以**行政边界**为准：按 `area` 抓到的比按 seat 猜的权威。
       （整省「按名字抓」分下来的那些 `fromArea: false`，
         在市的边界上本来就可能被分到隔壁市去。） */
    if (prev.fromArea !== p.fromArea) {
      if (p.fromArea) byOsm.set(p.osm, p)
      continue
    }
    const here = { lng: p.lngWgs, lat: p.latWgs }
    const dNew = haversineKm(seatOf(p.city), here)
    const dPrev = haversineKm(seatOf(prev.city), { lng: prev.lngWgs, lat: prev.latWgs })
    if (dNew < dPrev) byOsm.set(p.osm, p)
  }
  const deduped = [...byOsm.values()]

  /* ★★ 同一景区的重影并成一条（家长 09-23 定）。
     ⚠️ 顺序在**跨市去重之后、每城上限之前** ——
        并完再截，否则重影会白占一个名额。 */
  const samePlace = collapseSamePlace(deduped)
  /* ★★ 开平碉楼整片只留 1 条（同上）。 */
  const kaiping = dropKaipingSubBuildings(samePlace.kept)
  const collapsed = kaiping.kept

  /* ★★ 每城上限（家长 09-23 定：一线/新一线 ≤10、二线 ≤5、三线及以下不限）。
     ⚠️ 必须在**跨市去重之后**做 —— 否则先截断再发现重复，
        等于白占了一个名额。 */
  const { kept: capped, cut } = applyCityCaps(collapsed)

  /* 生成最终 schema */
  const seeds = capped
    .sort((a, b) => (a.city === b.city ? a.name.localeCompare(b.name, 'zh') : a.city.localeCompare(b.city, 'zh')))
    .map((p) => {
      const scene = inferScene(p.tags)
      const id = `gd-${p.osm}`
      /* ★★ 到这里才转 GCJ-02 —— 前面所有几何/距离判定都在 WGS-84 上做 */
      const [lng, lat] = wgs84ToGcj02(p.lngWgs, p.latWgs)
      return {
        id,
        name: p.name,
        province: '广东',
        city: p.city.replace(/市$/, ''),
        lng: Number(lng.toFixed(5)),
        lat: Number(lat.toFixed(5)),
        blurb: makeBlurb(p.name, p.tags, scene, id),
        scene,
        /* ★ 「评级」= 国家 A 级旅游景区等级。⚠️ **只有评到级才有这个字段**，
           没查到就不写 —— 不要写 `null` 或 `'无'`：那会让"没查到"和
           "确实没等级"混成一种，界面上没法区分该不该显示。 */
        ...(p.rating ? { rating: p.rating } : {}),
      }
    })

  /* 报告 */
  const byCity = {}
  const byScene = {}
  const byRating = {}
  for (const s of seeds) {
    byCity[s.city] = (byCity[s.city] || 0) + 1
    byScene[s.scene] = (byScene[s.scene] || 0) + 1
    byRating[s.rating ?? '（没查到等级）'] = (byRating[s.rating ?? '（没查到等级）'] || 0) + 1
  }
  console.log(`\n原始元素 ${stat.raw} → 入库 ${stat.kept}`)
  stat.dropped.crossDup = crossDup
  console.log('剔除明细：', JSON.stringify(stat.dropped))
  console.log('\n按城市：')
  for (const [c, n] of Object.entries(byCity).sort((a, b) => b[1] - a[1])) console.log(`  ${c}  ${n}`)
  console.log('\n按 scene：', JSON.stringify(byScene))
  console.log('按评级：', JSON.stringify(byRating))
  /* ★ 截断必须报出来 —— 否则"这个市只有 10 条"看起来像"这个市本来就只有 10 条" */
  if (Object.keys(cut).length) {
    console.log('按每城上限截掉的：', JSON.stringify(cut))
  }
  /* ★★ 并掉的 / 删掉的 / 被守卫拦下的，**都必须报**。
     ⚠️ 不报的话，「库里没有」和「被删了」长得一模一样 ——
        家长只会以为"这个地方本来就不知名"，永远查不到是我们删的。 */
  if (samePlace.merged.length) {
    console.log(`\n同一景区重影并掉 ${samePlace.merged.length} 条：`)
    for (const m of samePlace.merged) console.log('  ' + m)
  }
  if (kaiping.dropped.length) {
    console.log(`\n开平碉楼整片只留 1 条，删掉 ${kaiping.dropped.length} 个子楼：`)
    console.log('  ' + kaiping.dropped.join('、'))
  }
  if (ratingRejected.city || ratingRejected.far) {
    console.log(
      `\n★ 评级守卫拦下：**城市对不上** ${ratingRejected.city} 次、距离对不上 ${ratingRejected.far} 次`,
    )
  }

  /* ★ 抓取失败的市要显式报出来。
     ⚠️ 不报的话，库会「少几个市但看起来完全正常」——
     孩子飞过去发现附近没地方，而日志里什么都没说。 */
  if (failed.length) {
    console.log(`\n⚠️ 这些市没抓到，库是**不完整**的：${failed.join('、')}`)
    console.log('   重跑一次即可（已抓到的市会走缓存，不会重复请求）。')
  }

  if (DRY) {
    console.log('\n（--dry，没有写文件）')
    return
  }

  /* ★★ ODbL 要求「署名与许可跟着数据走」。
     所以这个文件**不是裸数组**，而是带抬头的对象：
     谁把这份数据复制走，抬头就跟着走，不会只剩一堆坐标。
     ⚠️ 抬头字段本身也被 `landmarks.test.ts` 守着 ——
     有人重跑脚本时把抬头丢了，测试会红。 */
  const payload = {
    license: 'ODbL-1.0',
    source: 'https://www.openstreetmap.org',
    attribution: '© OpenStreetMap contributors',
    generatedBy: 'scripts/fetch-landmarks.mjs',
    generatedAt: new Date().toISOString().slice(0, 10),
    count: seeds.length,
    items: seeds,
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 1) + '\n', 'utf8')
  console.log(`\n已写入 ${path.relative(ROOT, OUT_FILE)}（${seeds.length} 条）`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
