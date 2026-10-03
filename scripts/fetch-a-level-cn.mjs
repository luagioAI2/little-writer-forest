/* ============================================================
   全国 A 级景区名录 —— 抓取与生成（31 个省级行政区）

   产出 `scripts/cn-a-level.json`，结构跟 `gd-a-level.json` 一样是
   `byProvince[省] = { '5A': [...], '4A': [...] }`，每条 `{name, city}`。
   多两个字段（`lng`/`lat`）—— 见下面「为什么这次能多给坐标」。

   ⚠️ 为什么另开一份、不去改 `gd-a-level.json`：
      `fetch-landmarks.mjs` 在读它（`byProvince['广东']`），而广东那份是
      **逐条人工核对过城市归属**的（172 家 4A 全核过），是验证过的基准。
      全国这份是**机器抽的**，质量档次不一样 —— 混在一起就分不清哪条能信了。
      两份可以互相对照（广东的 4A 应当逐条一致）。

   ★★ 数据源与校准
     源：`https://www.cnlifes.com/location/4a/<省 slug>`（分页，每页 20 条）
     页面里带一份 Next.js 的 RSC 载荷，**结构化**给出每条景区的
     `locationName / provinceId / cityId / longitude / latitude / address / level`。
     ➜ 这就是为什么这次能多给坐标：广东那版只有名字，坐标得回 OSM 查。

     **校准（必做）**：广东 4A 抓出来 = **172 条 / 9 页**，与人工核对过的
     基准 **172 完全一致** ➜ 4A 这条线可信。

   ⚠️⚠️ **5A 的名单不能用这个站**：`/location/5a/广东` 返回 **18 条**，
      而基准是 **16**。多出来的 `红花湖`、`犁头尖山` 不是 5A。
      ➜ 5A 的**名单**一律走文旅部（`FIVE_A_URL`）；这个站**只当坐标池用** ——
        名单以文旅部那 357 条为准，坐标按名字从池子里捞（见「5A 坐标补全」一节）。
      ⚠️ 反过来说：池子里**多出来的**条目**无害**（捞不着就不捞），
        池子里**少**了才是问题 —— 那才要退到中心点兜底。

   用法：
     node scripts/fetch-a-level-cn.mjs            # 抓全部 31 个省级行政区
     node scripts/fetch-a-level-cn.mjs 湖南 广东   # 只抓指定的
   ============================================================ */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { containScore, normLandmarkName } from './lib/a-level-names.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_FILE = path.join(ROOT, 'scripts', 'cn-a-level.json')
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'cnlifes')

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; little-writer-forest/1.0; landmark seeding)' }

/* ★ 31 个省级行政区（cnlifes 的 slug → 中文名）。
   ⚠️ **不含中国台湾 / 中国香港 / 中国澳门** —— 聚合站没有这三地的 A 级名单
      （跟 `fetch-landmarks.mjs` 里那条注释一致）。它们目前只有手工精选那 3 条。
   ⚠️ 直辖市（北京/天津/上海/重庆）在这里也当"省"处理：它们没有地级市，
      条目会归到「市辖区」，城市归属要用下面的 `CITY_FIX` 兜。 */
const PROVINCES = {
  beijing: '北京', tianjin: '天津', shanghai: '上海', chongqing: '重庆',
  hebei: '河北', shanxi: '山西', neimenggu: '内蒙古',
  liaoning: '辽宁', jilin: '吉林', heilongjiang: '黑龙江',
  jiangsu: '江苏', zhejiang: '浙江', anhui: '安徽', fujian: '福建', jiangxi: '江西',
  shandong: '山东', henan: '河南', hubei: '湖北', hunan: '湖南',
  guangdong: '广东', guangxi: '广西', hainan: '海南',
  sichuan: '四川', guizhou: '贵州', yunnan: '云南', xicang: '西藏',
  shaanxi: '陕西', gansu: '甘肃', qinghai: '青海', ningxia: '宁夏', xinjiang: '新疆',
}

/* ---------------- 抓取 ---------------- */

function cachePath(key) {
  return path.join(CACHE_DIR, key.replace(/[^\w.-]+/g, '_') + '.html')
}

async function fetchPage(url, cacheKey, { refresh = false } = {}) {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const f = cachePath(cacheKey)
  if (!refresh && fs.existsSync(f)) return fs.readFileSync(f, 'utf8')

  // ★ 退避重试：聚合站偶发 5xx/超时，重试 3 次、间隔翻倍
  // ⚠️ **404 不重试、也不缓存** —— 那是"翻过头了"，不是错误（见 fetchLevel）
  let lastErr
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000) })
      if (res.status === 404) return null
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const text = await res.text()
      fs.writeFileSync(f, text)
      return text
    } catch (e) {
      lastErr = e
      await sleep(800 * (i + 1))
    }
  }
  throw new Error(url + ' → ' + lastErr.message)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 还原 `self.__next_f.push([1,"…"])` 里的转义字符串，拼成一份可整体匹配的载荷。
 *  ⚠️ 必须**先还原再匹配** —— 直接在 HTML 上写正则会被转义符绊住。 */
function rscPayload(html) {
  let payload = ''
  const pushRe = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g
  let m
  while ((m = pushRe.exec(html))) {
    try { payload += JSON.parse(m[1]) } catch { /* 个别片段不是合法 JSON，跳过 */ }
  }
  return payload
}

/** 从载荷里抠出景区对象。 */
function extract(html) {
  const payload = rscPayload(html)

  const items = []
  const objRe =
    /\{"id":"(\d+)","uid":\d+,"cateId":\d+,"locationName":"((?:[^"\\]|\\.)*)"[\s\S]*?"provinceId":(\d+),"cityId":(\d+),"regionId":(\d+|null),"longitude":([\d.]+),"latitude":([\d.]+),"address":"((?:[^"\\]|\\.)*)"[\s\S]*?"level":"(\w+)"/g
  let o
  while ((o = objRe.exec(payload))) {
    items.push({
      name: JSON.parse('"' + o[2] + '"'),
      provinceId: Number(o[3]),
      cityId: Number(o[4]),
      regionId: o[5] === 'null' ? null : Number(o[5]),
      lng: Number(o[6]),
      lat: Number(o[7]),
      address: JSON.parse('"' + o[8] + '"'),
      level: o[9],
    })
  }
  const ro = /"rankOffset":(\d+)/.exec(payload)
  return { items, rankOffset: ro ? Number(ro[1]) : null }
}

/** 一个省的某一级（4a/5a）全部页。
 *  ⚠️ **翻过头是 404，不是空页** —— 第一版按"空页停"写，湖南第 8 页直接抛错。
 *     两个停止条件都留着：404、以及 rankOffset 不再前进（防它把最后一页重复吐）。 */
async function fetchLevel(slug, level) {
  const all = []
  let prevOffset = -1
  for (let p = 1; p <= 30; p++) {
    const url = `https://www.cnlifes.com/location/${level}/${slug}` + (p === 1 ? '' : `?page=${p}`)
    const html = await fetchPage(url, `${level}-${slug}-p${p}`)
    if (html === null) break // 404 = 没有更多页
    const { items, rankOffset } = extract(html)
    if (!items.length) break
    if (rankOffset === prevOffset) break
    prevOffset = rankOffset
    all.push(...items)
    await sleep(300) // 别把人家站点打疼
  }
  return all
}

/* ---------------- 城市归属 ---------------- */

/* ★★ 城市归属**不能用地址猜**。
   第一版是「从地址里学市名」（`湖南省长沙市…` → 长沙），实测**会错**：
   湖南有 6 条被安到了「洪江」，而洪江是**县级市**（属怀化市）——
   因为那几条的地址是「洪江市新民路367号」，**根本没写地级市**。

   ★ 正解：载荷里本来就有两个代码 ——
     · `cityId`   = **地级市**（洪江古商城 → 431200 = 怀化）✅ 这才是要的
     · `regionId` = 县级   （洪江古商城 → 431281 = 洪江市）
   所以按 `cityId` 归市，而 `cityId → 市名` 这张表**从市级页面学**：
     `/location/4a/hunan/huaihua` 的标题是「湖南怀化4A景区名单」，
     页面里条目的 `cityId` 就是 431200 ➜ 精确映射，不用猜。

   ⚠️ 市级页面还**顺带给出每个省的下辖市名单**（nav 里那些 slug），
      后面抓 OSM 时要用同一份名单 —— 别在别处再写一遍。 */

/** 从省级页面的 nav 里抠出下辖市的 slug 与中文名。 */
function extractCitySlugs(html, provSlug) {
  let payload = rscPayload(html)
  const re = new RegExp(
    '"href":"/location/4a/' + provSlug + '/([a-z0-9-]+)","className":"[^"]*","children":"([^"]+)"',
    'g',
  )
  const out = []
  const seen = new Set()
  let m
  while ((m = re.exec(payload))) {
    if (seen.has(m[1])) continue
    seen.add(m[1])
    // 「长沙4A景区名单」→「长沙」
    out.push({ slug: m[1], label: m[2].replace(/4A景区名单$/, '').trim() })
  }
  return out
}

/** 页面里出现的全部 cityId（一个市级页应该只出现一个）。 */
function extractCityIds(html) {
  const payload = rscPayload(html)
  const ids = new Set()
  const re = /"cityId":(\d+),/g
  let m
  while ((m = re.exec(payload))) ids.add(Number(m[1]))
  return [...ids]
}

/** cityId → 市名。逐个市级页学。 */
async function learnCityMap(provSlug) {
  const provHtml = await fetchPage(`https://www.cnlifes.com/location/4a/${provSlug}`, `4a-${provSlug}-p1`)
  const map = new Map()
  if (provHtml === null) return map
  const cities = extractCitySlugs(provHtml, provSlug)
  for (const { slug: cs, label } of cities) {
    const html = await fetchPage(`https://www.cnlifes.com/location/4a/${provSlug}/${cs}`, `city-${provSlug}-${cs}`)
    if (html === null) continue
    const ids = extractCityIds(html)
    if (ids.length === 1) map.set(ids[0], label)
    else if (ids.length > 1) {
      // 一个市级页里出现多个 cityId = 这份映射不能信，宁可留空（留空 = 评不上级）
      console.warn(`\n  ⚠️ ${label}(${cs}) 页里出现 ${ids.length} 个 cityId：${ids.join(',')} → 该市条目一律留空`)
      for (const id of ids) map.set(id, null)
    }
    await sleep(250)
  }
  return map
}

/* ★ 直辖市没有地级市，条目会落到「市辖区」。
   按 `PROVINCES` 里的省名兜底：直辖市 → city 留空、province 用省名本身，
   与手工精选那 35 条一致（`landmarks.json` 里天安门广场的 province 就是「北京」，没有 city）。 */
const MUNICIPALITIES = new Set(['北京', '天津', '上海', '重庆'])

/* ★★ 5A 的来源（跟 4A 不是同一个地方 —— 见文件头那段说明）：
   文旅部自己的数据服务栏目，Nuxt 服务端渲染，载荷里是结构化的：
     aj[N]={province:{code:…,name:"河北",sort:980},list:[{name:"衡水市衡水湖旅游景区2024年",…}]}
   **校准**：广东抽出 **16 条**，与 `gd-a-level.json` 人工核对过的 16 家**完全一致** ➜ 可信。
   ⚠️ 名字末尾**一定**带评定年份，且**可能带斜杠**（「晋中市乔家大院景区2014/2024年」）。
   ⚠️ 名字自带**市前缀**（「衡水市衡水湖旅游景区」）—— 这是 5A 的城市归属来源。 */
const FIVE_A_URL = 'https://sjfw.mct.gov.cn/site/dataservice/rural?type=10'

/* ⚠️ 「兵团」（新疆生产建设兵团）**不是省级行政区**，行政上属新疆 ——
   归到新疆那一格，不要另开一格（否则省级行政区数会变成 32，跟别的口径对不上）。 */
const PROVINCE_ALIAS = { 兵团: '新疆' }

/* ★★ 从**地址**认省时用的写法（必须带行政后缀）。
   ⚠️⚠️ 不能只写「海南」「广西」这种短名：青海有个「**海南**藏族自治州」，
      短名匹配会把它的地址判成海南省 —— **不报错、只是安静地判错**。
     带上「省/市/自治区」后缀就区分开了（「海南藏族自治州」不以「海南省」开头）。
   ⚠️ 自治区必须是**全称**（「广西壮族自治区」），写「广西自治区」匹配不到。 */
const PROVINCE_ADDR_FORMS = {
  北京: ['北京市'], 天津: ['天津市'], 上海: ['上海市'], 重庆: ['重庆市'],
  河北: ['河北省'], 山西: ['山西省'], 辽宁: ['辽宁省'], 吉林: ['吉林省'],
  黑龙江: ['黑龙江省'], 江苏: ['江苏省'], 浙江: ['浙江省'], 安徽: ['安徽省'],
  福建: ['福建省'], 江西: ['江西省'], 山东: ['山东省'], 河南: ['河南省'],
  湖北: ['湖北省'], 湖南: ['湖南省'], 广东: ['广东省'], 海南: ['海南省'],
  四川: ['四川省'], 贵州: ['贵州省'], 云南: ['云南省'], 陕西: ['陕西省'],
  甘肃: ['甘肃省'], 青海: ['青海省'], 台湾: ['台湾省'],
  内蒙古: ['内蒙古自治区'], 广西: ['广西壮族自治区'], 西藏: ['西藏自治区'],
  宁夏: ['宁夏回族自治区'], 新疆: ['新疆维吾尔自治区'],
}

/* ⚠️ 兜底表：**站上没有页面的地级/县级单位**（地址里只写了它们）。
   站的地级市列表只列"有 4A 条目的市"（云南 nav 只有 7 个市：昆明/曲靖/玉溪/保山/昭通/丽江/普洱），
   所以 大理、红河、楚雄、海西、凉山 这些**从来没进过 `cityProv`**，
   而热度榜里这些条目的地址只写州名 → 认不出省。
   ★ **只补真正用到的那几个**，不做全量行政区划表（那是另一件事）。
   ⚠️ 每一条都是可查证的真实归属，**不是按坐标就近猜的** ——
      按坐标猜在跨省边界会张冠李戴，而这类错误**不报错、只是安静地判错**。
   ⚠️ 以后重跑若又冒出"仍无省"的，**在这里补一条**，别改成按坐标猜。 */
const PREFECTURE_PROVINCE = {
  海西州: '青海', 海西蒙古族藏族自治州: '青海',
  红河州: '云南', 红河哈尼族彝族自治州: '云南',
  楚雄州: '云南', 楚雄彝族自治州: '云南',
  凉山州: '四川', 凉山彝族自治州: '四川',
  景洪市: '云南', 芒市: '云南', 弥勒市: '云南', 弥阳镇: '云南', 德阳市: '四川',
  伊宁市: '新疆', 盐边县: '四川', 多伦县: '内蒙古',
  琼中黎族苗族自治县: '海南', 防城港市: '广西',
  资阳市: '四川', 锡林浩特市: '内蒙古',
}

/* ⚠️ 省名的**两种写法都要认**：带后缀的（「甘肃省…」）和光秃秃的（「甘肃酒泉市…」「内蒙古兴安盟…」）。
   ⚠️⚠️ 唯独**「海南」不能收光秃秃那种**：青海有个「**海南**藏族自治州」，
      收了它就会把青海的地址判成海南省 —— **不报错、只是安静地判错**。
      带后缀的「海南省」没这个问题，所以海南只留带后缀的写法。
   按**长度倒序**匹配，保证「广西壮族自治区」不会被更短的写法抢先。 */
const PROVINCE_ADDR_NEEDLES = (() => {
  const out = []
  for (const [prov, forms] of Object.entries(PROVINCE_ADDR_FORMS)) {
    for (const f of forms) out.push({ needle: f, prov })
    if (prov !== '海南' && !forms.includes(prov)) out.push({ needle: prov, prov })
  }
  return out.sort((a, b) => b.needle.length - a.needle.length)
})()

/* ★ 5A 里城市写法是「照抄名字前缀」，只剥掉末尾的「市」：
     「衡水市衡水湖旅游景区」→ 衡水     「阿克苏地区天山托木尔景区」→ 阿克苏地区
     「湘西州凤凰古城旅游区」→ 湘西州   「昌吉回族自治州江布拉克景区」→ 昌吉回族自治州
   ⚠️ 4A 那边是 cnlifes 市级页的标题，写法不统一（四川写「阿坝藏族羌族」、
      新疆写「阿勒泰地区」）—— 两边**可能对不上**。5A 不设上限，城市只影响显示分组，
      所以先不动；要统一得先有一张「地级行政区规范名」表（跟每城上限那张表是同一张）。 */

/* ★★ 名字是**两层**前缀，都要剥（家长 09-24 定）：
     源里是「地级市 + （可选）县级单位 + 景区名」——
       江门市开平市开平碉楼文化旅游区 / 上饶市婺源县江湾景区 / 广州市白云区白云山景区
     只剥地级市的话，孩子看到的是「白云区白云山景区」「婺源县江湾景区」，
     跟 4A 那边的干净名字（「广州塔」「南澳岛」）风格对不上，
     而且会**妨碍以后「同一个景区只留 1 条」的合并**（前缀不同就匹配不上）。
   ⚠️ 原始名字存进 `rawName` —— 剥过的信息不丢，对不上时能回溯。
   ⚠️ 守卫 `!/景$/` 是必须的：没有它，「清西陵景区」会被当成「清西陵景」+「区」剥成「清西陵」。 */
const COUNTY_RE = /^([\u4e00-\u9fa5]{2,4})(区|县|市|旗)/

/** 剥掉开头的省名（「湖北省武汉」→「武汉」）。
 *  ⚠️ 有些 5A 名字带**省**前缀（「湖北省武汉市黄鹤楼…」），
 *     只剥一层「市」的话 city 会变成「湖北省武汉」这种脏值。 */
function stripProvincePrefix(s) {
  for (const forms of Object.values(PROVINCE_ADDR_FORMS)) {
    for (const f of forms) if (s.startsWith(f)) return s.slice(f.length)
  }
  return s
}

function parse5AName(raw, province) {
  const full = raw.replace(/\d{4}(\/\d{4})?年$/, '').trim()
  if (MUNICIPALITIES.has(province)) return { name: full }

  let name = full
  let city
  const m = /^(.{2,12}?)(市|自治州|州|地区|盟)/.exec(name)
  if (m) {
    // ⚠️⚠️ 切的位置是**整个前缀** `m[0].length`（「衡水市」= 3 个字），
    // 不是 `city.length`（「衡水」= 2 个字）—— 少切这一个字，名字会变成「市衡水湖旅游景区」。
    // 这个 bug **不报错、条数也不变**（广东照样 16 条，跟基准一致），
    // 只有把名字打出来才看得见 —— 全国 357 条里有 **282 条**中招。
    const rest = name.slice(m[0].length)
    if (rest) {
      city = stripProvincePrefix((m[1] + m[2]).replace(/市$/, ''))
      name = rest
    }
  }

  // 县级前缀：剥掉后至少还要剩 2 个字才算数（否则整个名字就是那个县名）
  const c = COUNTY_RE.exec(name)
  if (c && c[0].length + 2 <= name.length && !/景$/.test(c[1])) name = name.slice(c[0].length)

  if (name === full) return { name }
  return { name, ...(city ? { city } : {}), rawName: full }
}

/** 抽全国 5A（文旅部）。返回 [{prov, items:[{name, city}]}] */
async function fetch5A() {
  const html = await fetchPage(FIVE_A_URL, 'mct-5a')
  if (html === null) throw new Error('5A 源 404：' + FIVE_A_URL)
  const groups = []
  const provRe = /\{province:\{code:[^,]+,\s*name:"([^"]+)",[^}]*\},list:\[([\s\S]*?)\]\}/g
  let p
  while ((p = provRe.exec(html))) {
    const prov = PROVINCE_ALIAS[p[1]] ?? p[1]
    const raw = [...p[2].matchAll(/name:"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse('"' + m[1] + '"'))
    groups.push({ prov, items: raw.map((r) => parse5AName(r, prov)) })
  }
  return groups
}

/* ══════════ 4A 的「知名度」排序（家长 09-24 定：4A 总数 ≤1000，按知名度）══════════

   ★★ 好消息：**源站自己就带热度分**，不用我们另做一套加权。
     全国页 `https://www.cnlifes.com/location/4a`（**不带省 slug**）就是
     「**按平台综合热度排序**」的全国 4A 榜，每条记录里带数字 `heatScore`。
     实测严格单调递减：第 1 页 9.6→8.5、第 50 页 5.5→5.5、第 167 页 2.1→2.0。

   ★ 于是「按知名度取前 N 条」= **直接取这个榜的前 N 条**。
     ⚠️ 但它是**平台热度**，不是学术意义上的知名度：偏向「有人点评/打卡」的景区，
        城市周边、游乐场类会偏前，偏远但级别高的自然景观会偏后。
        可以接受 —— 孩子要去的本来就是「有人去、值得去」的地方。
     ⚠️ **别自己按 heatScore 重排**：同分时的次序也是站点给的，重排会把它的判断覆盖掉。
        **只校验单调，不重排。**

   ★ `description`（一句话介绍）也在这条记录里 —— 正好是 `Landmark.blurb` 要的东西，白捡的。
   ⚠️ `tagList` 里有「世界遗产」「2026中国100必打卡景点」这类标签，
      将来要给"知名度"加硬闸门时可以直接用。 */
const FOUR_A_NATIONAL_URL = 'https://www.cnlifes.com/location/4a'
const FOUR_A_KEEP = 1000

/** 从 `start` 处的 `{` 开始做 JSON 配平，返回结束下标（跳过字符串里的括号与转义）。
 *  ⚠️ 不能用大跨度正则抠记录：某条缺 `heatScore` 时它会一路吃到下一条，静默串行。 */
function scanJson(payload, start) {
  let depth = 0
  let inStr = false
  let esc = false
  for (let k = start; k < payload.length; k++) {
    const ch = payload[k]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return k + 1
    }
  }
  return -1
}

/** 抠出带 `heatScore` 的记录（全国榜专用：比 `extract` 多要热度与简介）。 */
function extractRanked(html) {
  const payload = rscPayload(html)
  const items = []
  const re = /\{"id":"\d+","uid":\d+,"cateId":\d+,"locationName":/g
  let m
  while ((m = re.exec(payload))) {
    const end = scanJson(payload, m.index)
    if (end < 0) break
    try {
      items.push(JSON.parse(payload.slice(m.index, end)))
    } catch {
      /* 不是一条完整记录，跳过 */
    }
    re.lastIndex = end
  }
  const ro = /"rankOffset":(\d+)/.exec(payload)
  return { items, rankOffset: ro ? Number(ro[1]) : null }
}

/** 全国 4A 热度榜（保持站点给的顺序，**不重排**）。
 *  停止条件同 `fetchLevel`：404、或 `rankOffset` 不再前进。 */
async function fetch4ANationalRanked() {
  const all = []
  let prevOffset = -1
  for (let p = 1; p <= 220; p++) {
    const url = FOUR_A_NATIONAL_URL + (p === 1 ? '' : `?page=${p}`)
    const html = await fetchPage(url, `4a-national-p${p}`)
    if (html === null) break
    const { items, rankOffset } = extractRanked(html)
    if (!items.length) break
    if (rankOffset === prevOffset) break
    prevOffset = rankOffset
    all.push(...items)
    await sleep(300)
  }
  return all
}

/* ══════════ 5A 坐标补全（家长 09-24 定：「用市中心点凑上」）══════════

   ★★ 为什么 5A 要单独补坐标：文旅部的载荷**只有名字**（`fetch5A`），
      没有经纬度。而 `Landmark` 的 `lng`/`lat` 是**必填**，
      `checkLandmarks()` 还会把 (0,0) 和越界的都挡掉
      ➜ 357 条 5A **一条都进不了库**，除非先补上坐标。

   ★ 坐标从哪来 —— 四层，从可信到粗略，**每层都把自己写进 `coordSource`**：
     ① `site-5a`  站点 5A 省级页（`/location/5a/<slug>`）：**同一份结构化载荷**，
                  带 `longitude`/`latitude`/`description`。实测命中 **318** 条。
     ② `site-4a`  本省 4A 池（`byProvince[省]['4A']`，带坐标）：5A 改名/降级后
                  常以 4A 的名字留在站上。又救回 **17** 条
                  （`红海滩风景廊道景区` → `红海滩国家风景廊道`、`嘉峪关文物景区` → `嘉峪关关城`）。
     ③ `city-centroid`    同市 4A 条目的中心点：**14** 条。
     ④ `province-centroid` 同省 4A 条目的中心点：**8** 条 —— 那 8 条所属的市在站上
                  一条 4A 都没有（广东河源 / 贵州黔西南州 / 甘肃甘南州 / 青海海东 / 直辖市），
                  所以市一级算不出来。⚠️ 直辖市里 上海 还行（省=市），**重庆不行**
                  （8.2 万 km²，中心点离彭水/万盛一百多公里）—— 这正是要如实标出来的原因。
     ➜ 实测真坐标 **335/357 = 93.8%**，近似 22 条。近似的那 22 条**全部**带
       `coordSource`，界面/构建脚本据此可以区别对待，**不是偷偷混进去的**。

   ★★ 匹配判据：**短名必须被长名完全包含**（`matchInPool`），**不是**最长公共子串。
      为什么不能用 LCS：它会踩这种坑 ——
        `乔家大院景区` ⇐ `山西王家大院`、`城墙•碑林历史文化景区` ⇐ `终南山古楼观历史文化景区`
      共的只是「大院」「历史文化景区」这种**通用词**，**看着完全合理、不报错**，
      正是本项目最怕的那类错。包含关系保守且够用：
        `乌镇`⊂`乌镇古镇` ✓    `西湖`⊂`杭州西湖` ✓    `乔家大院`⊄`王家大院` ✗
      ⚠️ 试过放宽到「公共子串 ≥3 字且占比 ≥50%」，**第一条就翻车**：
        `环球恐龙城休闲旅游区` ⇐ `南京游子山休闲旅游区`（只共「休闲旅游区」）
      ➜ 所以**不放宽**。剩下 22 条宁可走中心点，也不赌。

   ⚠️ 名字里带分隔符的（`·•-－—–`）是**合并条目**（`岳麓山-橘子洲旅游区`），
      而站上是**拆开的两条**（`岳麓山` / `橘子洲`）➜ 整体匹配必然落空，
      必须**先按分隔符拆开**再逐个匹配。全国 357 条里有 **39** 条是这种。
   ⚠️ 拆开后**两个部件都命中**是常态（`岳麓山` 和 `橘子洲` 都是真条目）——
      这**不是歧义**，它们本来就同属一个景区、相距几公里，**取哪条都对**。
      ➜ 平手时按「规范化名更长（更具体）→ 名字升序（可复现）」定一条，**不报警**；
        只有「两个候选相距 > 50km」才记一笔给人看（那种才值得人瞄一眼）。
*/

/* ★ 规范化（`normLandmarkName`）与包含匹配（`containScore`）**不在这里实现** ——
   它们在 `scripts/lib/a-level-names.mjs`，因为 `build-landmarks-cn.mjs` 合并去重时
   用的是**同一份判定**。两处各写一遍的话，改了这处忘了那处
   → 表现是"去重结果和坐标结果对不上"，**不报错**（MEMORY §四）。 */

/** 两点大概距离（km）。只用来判断「两个候选是不是同一个景区」，不求精确。 */
function approxKm(a, b) {
  const dLat = (a.lat - b.lat) * 111
  const dLng = (a.lng - b.lng) * 111 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180)
  return Math.hypot(dLat, dLng)
}

/** 在池子里给一条 5A 找坐标。
 *  返回 `{hit, score, tied, spreadKm}`；一条都没命中返回 `null`。
 *  ⚠️ `tied > 1` 通常是**合并条目拆开后两个部件都命中**（正常）；
 *     只有 `spreadKm` 很大时才值得人看，所以两个数分开返回。 */
function matchInPool(name, pool) {
  const parts = name.split(/[·•\-－—–]/).map((s) => s.trim())
  const cands = [normLandmarkName(name), ...parts.map(normLandmarkName)].filter(
    (x, i, a) => x.length >= 2 && a.indexOf(x) === i,
  )

  let score = 0
  let best = []
  for (const cand of cands) {
    for (const c of pool) {
      if (!Number.isFinite(c.lng) || !Number.isFinite(c.lat)) continue
      const s = containScore(cand, normLandmarkName(c.name))
      if (s === 0) continue
      if (s > score) {
        score = s
        best = [c]
      } else if (s === score && !best.some((x) => x.name === c.name)) {
        best.push(c)
      }
    }
    if (score >= 100) break // 已经精确相等，不用再看别的写法
  }
  if (!best.length) return null

  // 平手定一条：规范化名更长（更具体）→ 名字升序（同输入必得同输出）
  best.sort(
    (x, y) =>
      normLandmarkName(y.name).length - normLandmarkName(x.name).length || (x.name < y.name ? -1 : 1),
  )
  const spreadKm = best.reduce((m, c) => Math.max(m, approxKm(best[0], c)), 0)
  return { hit: best[0], score, tied: best.length, spreadKm }
}

/** 一组坐标点的中心点（算术平均）。空数组 / 全无坐标 → null。 */
function centroid(rows) {
  const ok = rows.filter((r) => Number.isFinite(r.lng) && Number.isFinite(r.lat))
  if (!ok.length) return null
  return {
    lng: round6(ok.reduce((s, r) => s + r.lng, 0) / ok.length),
    lat: round6(ok.reduce((s, r) => s + r.lat, 0) / ok.length),
  }
}

/** 站点 5A 省级页的条目 —— **当坐标+热度+简介池用，不当名单用**（见文件头那段）。
 *  比 `fetchLevel` 多要三样：`description`（= `Landmark.blurb`）、`heatScore`（= `Landmark.heat`）、`longitude`/`latitude`。
 *  ⚠️ 用 `extractRanked`（`scanJson` + `JSON.parse`）而不是 `extract` 的大跨度正则：
 *     后者从 `"provinceId"` 起匹配，**拿不到 `description`/`heatScore`**（它们在 `provinceId` 之前）。 */
async function fetch5ASitePool(slug) {
  const all = []
  let prevOffset = -1
  for (let p = 1; p <= 30; p++) {
    const url = `https://www.cnlifes.com/location/5a/${slug}` + (p === 1 ? '' : `?page=${p}`)
    const html = await fetchPage(url, `5a-${slug}-p${p}`)
    if (html === null) break // 404 = 没有更多页
    const { items, rankOffset } = extractRanked(html)
    if (!items.length) break
    if (rankOffset === prevOffset) break
    prevOffset = rankOffset
    for (const x of items) {
      all.push({
        name: x.locationName,
        lng: x.longitude,
        lat: x.latitude,
        desc: x.description || '',
        // ★ 热度分（`heatScore`）—— 文旅部只给名字，但聚合站的 5A 页自带平台综合热度。
        //   这跟 4A 全国榜用的是**同一个字段**（`heatScore`），口径一致。
        //   ⚠️ 不是所有 5A 省级页都有热度（有些省的 5A 条目在聚合站没收录）→
        //      `typeof x.heatScore === 'number'` 守一下，非数字就不带。
        ...(typeof x.heatScore === 'number' ? { heat: x.heatScore } : {}),
      })
    }
    await sleep(300)
  }
  return all
}

/* ---------------- 生成 ---------------- */

async function main() {
  const want = process.argv.slice(2)
  const targets = Object.entries(PROVINCES).filter(([, cn]) => !want.length || want.includes(cn))

  const byProvince = {}
  const cityMap = new Map() // cityId → 市名（代码全国唯一，跨省共用一张）
  const provinceIdMap = new Map() // provinceId → 省名（从省级页的记录里学，别硬编码行政区划码）
  const cityProv = new Map() // 市名 → 省名（给"地址里只有市名"的条目认省用）
  const cityProvDup = new Set() // 跨省重名的市 → 一律不用

  /* ★ 登记「市名 → 省」，**同时登记去尾缀的词干**。
     ⚠️ 为什么必须要词干：5A 写的是短式「大理州」「迪庆州」「恩施州」，
        而地址写的是全称「大理白族自治州」「迪庆藏族自治州」「恩施土家族苗族自治州」——
        只登记「大理州」的话 `addr.includes('大理州')` **永远为 false**，
        那 28 条就这么一直认不出省（不报错，只是空着）。
     ⚠️ 词干若与省名同名就不登记：青海有个「海南州」，词干「海南」会把海南省误判成青海。
     ⚠️ 2 字市名去尾缀后只剩 1 个字（柳州→柳、泸州→泸）→ 长度守卫直接挡掉，不会误伤。
     ⚠️ 跨省重名一律不用（宁可留空，不能张冠李戴）。 */
  const PROVINCE_SHORT = new Set(Object.values(PROVINCES))
  function addCity(name, prov) {
    if (!name) return
    const forms = [name]
    const stem = name.replace(/(自治州|州|地区|盟)$/, '')
    if (stem !== name && stem.length >= 2 && !PROVINCE_SHORT.has(stem)) forms.push(stem)
    for (const f of forms) {
      if (cityProv.has(f) && cityProv.get(f) !== prov) cityProvDup.add(f)
      else cityProv.set(f, prov)
    }
  }

  for (const [slug, cn] of targets) {
    process.stdout.write(`抓 ${cn}… `)
    const fourA = await fetchLevel(slug, '4a')
    const local = await learnCityMap(slug)
    for (const [id, name] of local) cityMap.set(id, name)
    /* ★★ 市名 → 省 的反查表也从**同一份** `learnCityMap` 学。
       ⚠️ 关键：它列的是该省**全部**地级市，不只是"有 4A 条目的那些"。
          靠"条目里出现过的市"根本学不到「大理」—— 云南只有 44 条 4A，
          而热度榜里的地址写的正是「大理白族自治州洱源县…」，于是那几条认不出省。
       ⚠️ 跨省重名的市一律不用（宁可留空，不能张冠李戴）。 */
    for (const [, name] of local) addCity(name, cn)
    // 全国热度榜只给 `provinceId`，不给省名 —— 这里顺手把映射学下来
    for (const x of fourA) provinceIdMap.set(x.provinceId, cn)
    const uniq = dedupeByName(fourA)
    byProvince[cn] = { '5A': [], '4A': uniq.map((x) => toRow(x, cn, cityMap)) }
    const noCity = uniq.filter((x) => !MUNICIPALITIES.has(cn) && !cityMap.get(x.cityId)).length
    console.log(
      `4A ${uniq.length} 条（原始 ${fourA.length}）` +
        (noCity ? `  ⚠️ ${noCity} 条没归到市` : '  市归属齐'),
    )
  }

  // ★ 全国 5A（文旅部）。家长 09-24 定：「全国 5A 肯定都要算上」→ 5A **不设上限**。
  process.stdout.write('\n抓 全国 5A（文旅部）… ')
  const fiveA = await fetch5A()
  let n5 = 0
  for (const { prov, items } of fiveA) {
    if (!byProvince[prov]) {
      // 5A 里出现了 4A 没有的省（例如某个省没抓到 4A）→ 补一格，别把数据丢掉
      byProvince[prov] = { '5A': [], '4A': [] }
    }
    // ⚠️⚠️ 这里是 **concat，不是赋值**。赋值的写法在"两个组落到同一个省"时
    // **会把先到的那组整组丢掉** —— 不报错、不崩，只是那个省悄悄少了十几条。
    // 「兵团」被 `PROVINCE_ALIAS` 并进新疆正是这种情况：
    // 实测新疆那 16 条被兵团的 2 条盖掉 → 总数 357 变 341，而只有把两个数字对一下才看得出来。
    byProvince[prov]['5A'] = byProvince[prov]['5A'].concat(items)
    n5 += items.length
    /* ★ 5A 的 `city` 是「照抄名字前缀」，正好是**自治州/地区全称**
       （「大理白族自治州崇圣寺三塔文化旅游区」→ 大理白族自治州）。
       补进 `cityProv` 能救回一批「地址里只写州名」的 4A ——
       ⚠️ 云南/青海/新疆这些省在站上**只有少数几个市页**（云南 nav 只有 7 个市，
          大理压根没有市页），所以 `learnCityMap` 永远学不到「大理」，
          而热度榜里的地址写的正是「大理白族自治州洱源县…」。 */
    for (const it of items) addCity(it.city, prov)
  }
  console.log(`${fiveA.length} 组 / ${n5} 条`)

  // ★★ 自查一：抓到的条数必须**一条不少地**落进表里
  // （专门盯上面那种"组被覆盖"的静默丢数据 —— 它对不上时不会抛异常，只会少几条）
  const landed5 = Object.values(byProvince).reduce((s, p) => s + p['5A'].length, 0)
  console.log(
    landed5 === n5
      ? `✓ 5A ${n5} 条全部落表`
      : `⚠️⚠️ 抓到 ${n5} 条、落表只有 ${landed5} 条 —— 有组被覆盖了，先查`,
  )

  // ★ 自查二：广东 5A 必须仍是 16（人工核对过的基准），少了就是源变了
  const gd5 = byProvince['广东']?.['5A']?.length ?? 0
  console.log(gd5 === 16 ? '✓ 广东 5A = 16（与人工核对过的基准一致）' : `⚠️⚠️ 广东 5A = ${gd5}，基准是 16 —— 源变了，先查`)

  /* ══════════ 给 5A 补坐标 + 热度（详见上面「5A 坐标补全」一节）══════════ */
  process.stdout.write('\n补 5A 坐标与热度… ')
  const slugOf = new Map(Object.entries(PROVINCES).map(([s, cn]) => [cn, s]))
  const tier = { 'site-5a': 0, 'site-4a': 0, 'city-centroid': 0, 'province-centroid': 0 }
  const noPool = [] // 站点 5A 页一条都没抓到的省（多半是源变了）
  const wideTies = [] // 平手但两个候选相距 >50km（值得人瞄一眼）
  const coarse = [] // 落到省中心点的（最粗的一档）
  let n5NoCoord = 0
  let n5Heat = 0 // ★ 顺带带上了热度的条数

  for (const [prov, g] of Object.entries(byProvince)) {
    if (!g['5A'].length) continue
    const slug = slugOf.get(prov)
    const pool5 = slug ? await fetch5ASitePool(slug) : []
    if (!pool5.length) noPool.push(prov)
    // ⚠️ `city` 要留着 —— 第三层「同市中心点」靠它筛；`matchInPool` 不看这个字段，多给无妨
    const pool4 = (g['4A'] || []).map((r) => ({ name: r.name, lng: r.lng, lat: r.lat, city: r.city }))
    const provFix = centroid(pool4)

    for (const row of g['5A']) {
      const m1 = matchInPool(row.name, pool5)
      const m2 = m1 ? null : matchInPool(row.name, pool4)
      const m = m1 ?? m2
      if (m) {
        row.lng = round6(m.hit.lng)
        row.lat = round6(m.hit.lat)
        if (m.hit.desc) row.desc = m.hit.desc // 白捡的一句话介绍（`Landmark.blurb`）
        // ★ 热度也白捡 —— 只有 `site-5a` 那条路有（4A 池没带 heat）。
        //   `site-4a` / `city-centroid` / `province-centroid` 那三档**没有热度**，
        //   那不是"丢了"，是"源里就没有" —— `Landmark.heat` 是可选字段。
        if (typeof m.hit.heat === 'number') { row.heat = m.hit.heat; n5Heat++ }
        row.coordSource = m1 ? 'site-5a' : 'site-4a'
        tier[row.coordSource]++
        if (m.tied > 1 && m.spreadKm > 50) {
          wideTies.push(`${prov} ${row.name}（命中 ${m.tied} 条，最远 ${Math.round(m.spreadKm)}km）`)
        }
        continue
      }

      // ③ 同市 4A 的中心点（家长 09-24 定的兜底）
      const city = row.city
      const cityRows = city
        ? pool4.filter(
            (r) => r.city && (r.city === city || r.city.startsWith(city) || city.startsWith(r.city)),
          )
        : []
      const fix = centroid(cityRows) ?? provFix
      if (!fix) {
        n5NoCoord++
        continue
      }
      row.lng = fix.lng
      row.lat = fix.lat
      row.coordSource = cityRows.length ? 'city-centroid' : 'province-centroid'
      tier[row.coordSource]++
      if (!cityRows.length) {
        coarse.push(`${prov} | ${row.name}（city=${city || '—'}，站上该市没有 4A）`)
      }
    }
  }

  const real = tier['site-5a'] + tier['site-4a']
  console.log(
    `① 站点 5A 页 ${tier['site-5a']}   ② 本省 4A 池 ${tier['site-4a']}   ` +
      `③ 同市中心点 ${tier['city-centroid']}   ④ 同省中心点 ${tier['province-centroid']}`,
  )
  console.log(
    `  → 真坐标 ${real}/357（${((real / 357) * 100).toFixed(1)}%），近似 ${tier['city-centroid'] + tier['province-centroid']}` +
      (n5NoCoord ? `  ⚠️⚠️ 还有 ${n5NoCoord} 条连省中心点都算不出来` : ''),
  )
  console.log(
    `  → 带热度 ${n5Heat}/357（${((n5Heat / 357) * 100).toFixed(1)}%）` +
      `  ⚠️ 只有 site-5a 那条路有热度（${tier['site-5a']} 条里命中的那些）；其余 ${357 - n5Heat} 条的热度是"源里就没有"，不是"丢了"`,
  )
  if (noPool.length) {
    console.log(`  ⚠️ 站点 5A 页一条都没抓到：${noPool.join('、')} —— 先查是不是源变了`)
  }
  if (wideTies.length) {
    console.log(`  ⚠️ 平手且相距 >50km 的 ${wideTies.length} 条（多半是"一景区跨两市"，人瞄一眼）：`)
    for (const x of wideTies) console.log('     ' + x)
  }
  if (coarse.length) {
    console.log(`  ⚠️ 落到「同省中心点」的 ${coarse.length} 条（最粗的一档，要如实标出来）：`)
    for (const x of coarse) console.log('     ' + x)
  }

  // ★★ 全国 4A 热度榜 → 取前 1000（家长 09-24 定：「4A 总数不超过 1000，按知名度」）
  process.stdout.write('\n抓 全国 4A 热度榜… ')
  const ranked = await fetch4ANationalRanked()
  const scored = ranked.filter((x) => x.level === '4A' && typeof x.heatScore === 'number')
  console.log(`共 ${scored.length} 条带热度分`)

  const top = scored.slice(0, FOUR_A_KEEP)
  // ★ 自查：榜单必须是**热度不升**的。乱了就说明分页顺序/接口变了 ——
  //   那时「取前 1000」不再等于「最知名的 1000」，而且**不报错、照样出数据**。
  const brokeAt = top.findIndex((x, i) => i > 0 && x.heatScore > top[i - 1].heatScore)
  console.log(
    brokeAt < 0
      ? `✓ 前 ${top.length} 条热度单调不升（${top[0].heatScore} → ${top[top.length - 1].heatScore}）`
      : `⚠️⚠️ 第 ${brokeAt} 条热度回升（${top[brokeAt].heatScore} > ${top[brokeAt - 1].heatScore}）—— 榜单顺序变了，先查`,
  )

  // ★ 兜底一：源里有些记录的 `provinceId`/`cityId` 是 **0**（不是 null）——
  //   实测「三星堆博物馆」「西江千户苗寨」就是 0/0。
  //   ⚠️ 这些条目**省级页永远看不到**（省级页是按 provinceId 过滤的），
  //      所以连名字回查 `byProvince` 也查不到 —— 得另找依据（见兜底二）。
  //   ⚠️ 同名可能跨省（「莲花山」全国有好几个）→ **只在唯一命中时才补**，
  //      多个候选就留空。宁可空着，也不能张冠李戴（评级那次就是这么错的）。
  const nameIndex = new Map()
  for (const [cn, p] of Object.entries(byProvince)) {
    for (const r of p['4A']) {
      const hit = nameIndex.get(r.name) ?? []
      hit.push({ province: cn, city: r.city })
      nameIndex.set(r.name, hit)
    }
  }

  // ★ 兜底二：用 `address` 认省。市名 → 省 用上面从 `learnCityMap` 学的 `cityProv`
  //   （⚠️ 不用"条目里出现过的市"—— 那样学不到「大理」这种没有 4A 条目的市）。
  for (const c of cityProvDup) cityProv.delete(c)

  /** 从地址认省（顺带认市）。
   *  ⚠️ 只认**省**是靠确定性前缀；认**市**是靠"市名确实出现在地址里"，
   *     而且这个市名来自 `cityId` 学来的**地级市**表 —— 不是从地址里硬抠字符串
   *     （上次从地址抠市，抠出了县级市：洪江 → 该是怀化）。
   *  ⚠️ 认不出就返回 null，**绝不按坐标就近猜省** —— 跨省边界会张冠李戴。 */
  function provinceFromAddress(addr) {
    if (!addr) return null
    for (const { needle, prov } of PROVINCE_ADDR_NEEDLES) {
      if (addr.startsWith(needle)) return { province: prov }
    }
    // ⚠️⚠️ 匹配位置必须是**（去掉省名之后的）最开头** —— 不能放宽成 `includes`。
    //   地址是「地级市 + 区/县 + 街道」的顺序，地级市一定在最前面。
    //   放宽成 includes 会踩这种坑：「德阳市广汉市**西安**路133号」（三星堆博物馆）
    //   → 命中「西安」→ 判成**陕西**，而三星堆在**四川**。
    //   这类错误**看着完全合理**，不逐条人肉核对根本发现不了。
    const rest = stripProvincePrefix(addr)
    let best = null
    for (const [city, prov] of cityProv) {
      if (!rest.startsWith(city)) continue
      if (!best || city.length > best.city.length) best = { city, province: prov }
    }
    if (best) return best
    // 兜底三：站上没有页面的地级单位（见 `PREFECTURE_PROVINCE`）
    let hit = null
    for (const [pref, prov] of Object.entries(PREFECTURE_PROVINCE)) {
      if (!addr.includes(pref)) continue
      if (!hit || pref.length > hit.length) hit = { pref, prov }
    }
    return hit ? { province: hit.prov } : null
  }

  const top4A = top.map((x) => {
    const uniq = nameIndex.get(x.locationName)
    const fb = uniq && uniq.length === 1 ? uniq[0] : undefined
    const addrHit = provinceFromAddress(x.address)
    const province = provinceIdMap.get(x.provinceId) ?? fb?.province ?? addrHit?.province ?? ''
    const row = {
      name: x.locationName,
      province,
      lng: round6(x.longitude),
      lat: round6(x.latitude),
      heat: x.heatScore,
    }
    const city = MUNICIPALITIES.has(province) ? undefined : (cityMap.get(x.cityId) ?? fb?.city ?? addrHit?.city)
    if (city) row.city = city
    if (x.description) row.desc = x.description
    return row
  })
  const noProv = top4A.filter((r) => !r.province)
  console.log(
    `前 ${top4A.length} 条落表  省齐 ${top4A.length - noProv.length}/${top4A.length}  市齐 ${top4A.filter((r) => r.city).length}` +
      (noProv.length ? `  ⚠️ 仍无省：${noProv.map((r) => r.name).join('、')}` : ''),
  )

  const out = {
    source:
      '国家 A 级旅游景区名录。5A = 文化和旅游部数据服务栏目（官方，**只有名字**，坐标是后补的，见 fiveACoordNote）；' +
      '4A = cnlifes.com 聚合页（机器抽取，非官方），其中要进库的那批按站点的「平台综合热度」排序取前 1000',
    collectedFrom: [
      '5A 名单：https://sjfw.mct.gov.cn/site/dataservice/rural?type=10（文旅部，Nuxt 载荷里结构化）',
      '5A 坐标：https://www.cnlifes.com/location/5a/<省 slug>（同一份结构化载荷，带 longitude/latitude/description）',
      '4A：https://www.cnlifes.com/location/4a/<省 slug>（分页，每页 20 条）',
      '4A 热度榜（全国）：https://www.cnlifes.com/location/4a（不带省 slug，页面自称「按平台综合热度排序」，带 heatScore）',
      '4A 校准基准：scripts/gd-a-level.json（广东 4A = 172 家，人工逐条核对过）',
      '抓取脚本：scripts/fetch-a-level-cn.mjs',
    ],
    asOf: '2025-09',
    whyThisFileExists:
      'gd-a-level.json 只有广东一省，且城市归属是逐条人工核对的 —— 全国 3300+ 家 4A 不可能照那个方式做。' +
      'cnlifes 的页面里带结构化载荷（名字/省/市/经纬度/等级），机器就能抽；' +
      '5A 则改用文旅部自己的数据服务栏目（也是结构化载荷），因为聚合站的 5A 页有假阳性。',
    note:
      '★★ 5A 与 4A 是**两个不同的源**，可信度不同：\n' +
      '  · 5A 来自**文旅部官方**，全国 357 条。校准：广东 = 16 家，与 gd-a-level.json 人工核对过的完全一致。\n' +
      '  · 4A 来自**聚合站**，全国 3322 条。校准：广东 = 172 家，与 gd-a-level.json 一致 ——' +
      '    但要注意 gd-a-level.json 的 172 家**本来就是从这个聚合站抓的**，所以这只能证明「抽取对了」，' +
      '    不能证明「这个站全」。那份文件自己写着「官方口径 187 家，差的 15 家是聚合站未收录」。\n' +
      '  ⚠️ **各省完整度不一样**：云南只有 44 条（第 4 页就 404），远低于官方口径。用之前要心里有数。\n' +
      '  ⚠️ 聚合站的 5A 页**有假阳性**（广东返回 18 条，多出来的 `红花湖`、`犁头尖山` 连 4A 都不是）——' +
      '    所以 5A 的**名单一律**走文旅部；聚合站的 5A 页只当**坐标池**用（见 fiveACoordNote）。',
    fiveACoordNote:
      '★★ 5A 的坐标是**后补的**，而且**四档可信度不同** —— 每条带 `coordSource` 标明自己哪一档：\n' +
      '  · `site-5a`（318 条）：站点 5A 省级页 `/location/5a/<省 slug>` 的 `longitude`/`latitude`。' +
      '    这页有假阳性（见 note），但**捞名字**不受影响 —— 多出来的条目捞不着就不捞。\n' +
      '  · `site-4a`（17 条）：本省 4A 池里同名的条目。5A 改名/降级后常以 4A 名字留在站上' +
      '（`红海滩风景廊道景区`→`红海滩国家风景廊道`、`嘉峪关文物景区`→`嘉峪关关城`）。\n' +
      '  · `city-centroid`（14 条）：**该市 4A 条目的中心点**（家长 09-24 定的兜底口径）。' +
      '    ⚠️ 不是景区自己的点，误差可达几十公里 —— 用它是因为**宁可粗、不可假**。\n' +
      '  · `province-centroid`（8 条）：该省 4A 的中心点。**最粗的一档** ——' +
      '    那 8 条所属的市在站上一条 4A 都没有（广东河源 / 贵州黔西南州 / 甘肃甘南州 / 青海海东 / 直辖市）。' +
      '    ⚠️ 直辖市里 上海 还行（省=市），**重庆不行**（8.2 万 km²，中心点离彭水/万盛一百多公里）。\n' +
      '  ➜ 实测真坐标 **335/357 = 93.8%**，近似 22 条。要进库的 1,357 条里这 22 条占 1.6%。\n' +
      '  ★★ 匹配判据是**「短名被长名完全包含」**，不是最长公共子串。\n' +
      '    LCS 会认下 `乔家大院景区`⇐`山西王家大院`、`城墙•碑林历史文化景区`⇐`终南山古楼观历史文化景区`' +
      ' —— 只共了「大院」「历史文化景区」这种通用词，**看着完全合理、不报错**。\n' +
      '    ⚠️ 试过放宽到「公共子串 ≥3 字且占比 ≥50%」，**第一条就翻车**：' +
      '      `环球恐龙城休闲旅游区` ⇐ `南京游子山休闲旅游区`（只共「休闲旅游区」）➜ 所以不放宽。\n' +
      '  ⚠️ 名字带分隔符的（`·•-－—–`）是**合并条目**（`岳麓山-橘子洲旅游区`），' +
      '    站上是**拆开的两条**（`岳麓山`/`橘子洲`）➜ 必须先拆开再匹配（357 条里 39 条）。\n' +
      '  ⚠️ 剩下那 22 条里有 4 条我**看到了对得上的候选**（红海滩/世界雕塑公园/延安革命纪念地/嘉峪关），' +
      '    但判据一松就会立刻产生假命中，所以没放 —— 要救得单独开一张**人工白名单**，不能靠规则。',
    cityNote:
      '★ 两边的 city **来源不同，写法可能对不上**：\n' +
      '  · 4A：用载荷里的 `cityId`（**= 地级市**代码）归市，市名从**市级页面的标题**学。' +
      '    ⚠️ 不要用地址猜 —— 地址会给出县级市（洪江→该是怀化、仁怀→该是遵义），广西还会啃出「治区桂林」。\n' +
      '  · 5A：照抄名字前缀（「衡水市衡水湖旅游景区」→ 衡水），只剥末尾的「市」。\n' +
      '  ⚠️ 于是同一张表里可能出现「阿勒泰地区」（4A 的写法）与「昌吉回族自治州」（5A 的写法）两种风格。' +
      '    要统一得先有一张「地级行政区规范名」表 —— 跟「每城上限」那张分档表是同一张，**目前还没有**。\n' +
      '  ⚠️ 直辖市没有地级市，city 留空、province 用省名本身（跟手工精选那 35 条一致）。\n' +
      '  ⚠️ 这份是机器抽的，**没有**逐条人工核对 —— 与 gd-a-level.json 冲突时，以 gd-a-level.json 为准。',
    fourANote:
      '★★ 4A 的取舍口径（家长 09-24 定：「4A 总数不超过 1000，按知名度」）：\n' +
      '  · 榜单 = https://www.cnlifes.com/location/4a （**不带省 slug** 的全国页）。' +
      '    页面自己写着「**按平台综合热度排序**」，每条记录带数字 `heatScore`。\n' +
      '  · 实测严格单调递减（第 1 页 9.6→8.5、第 50 页 5.5、第 167 页 2.1→2.0）➜ ' +
      '    **取前 1000 条 = 最知名的 1000 条**，不需要另做一套加权。\n' +
      '  ⚠️ 它是**平台热度**，不是学术意义上的知名度：偏向「有人点评/打卡」的景区 ——' +
      '    城市周边、游乐场类会偏前，偏远但级别高的自然景观会偏后。\n' +
      '  ⚠️ **不按 heatScore 重排** —— 同分时的次序也是站点给的，重排会覆盖它的判断。' +
      '    脚本只**校验单调**，乱了就报警。\n' +
      '  · 每条另带 `desc`（一句话介绍）—— 正好是 `Landmark.blurb` 要的东西，白捡的。\n' +
      `  ⚠️ 只取前 ${FOUR_A_KEEP} 条（热度 ≥ 5.5）；再往后的留在 byProvince 里，没进 top4A。`,
    top4A,
    byProvince,
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n')

  const tot4 = Object.values(byProvince).reduce((s, p) => s + p['4A'].length, 0)
  const tot5 = Object.values(byProvince).reduce((s, p) => s + p['5A'].length, 0)
  console.log('\n=== 合计 ===')
  console.log('省级行政区', Object.keys(byProvince).length, '个')
  console.log('4A', tot4, '条   5A', tot5, '条')
  // ★★ 自查三：**每条 5A 都必须带 lng/lat 和 coordSource**
  //   —— `Landmark` 的坐标是必填，缺一条就是"进库时才发现"，而那时已经查不到是哪一步漏的了。
  const bare = Object.entries(byProvince).flatMap(([cn, p]) =>
    p['5A'].filter((r) => !Number.isFinite(r.lng) || !Number.isFinite(r.lat) || !r.coordSource)
      .map((r) => `${cn} ${r.name}`),
  )
  console.log(
    bare.length === 0
      ? '✓ 5A 每条都带坐标与 coordSource'
      : `⚠️⚠️ ${bare.length} 条 5A 缺坐标/coordSource：${bare.join('、')}`,
  )
  const srcTally = Object.entries(
    Object.values(byProvince)
      .flatMap((p) => p['5A'])
      .reduce((m, r) => ((m[r.coordSource] = (m[r.coordSource] || 0) + 1), m), {}),
  )
    .map(([k, v]) => `${k} ${v}`)
    .join('   ')
  console.log('  坐标来源：' + srcTally)
  // ★ 自查四：5A 带热度的条数（不强制必须有多少，但要打出来给家长看覆盖率）
  const withHeat = Object.values(byProvince).flatMap((p) => p['5A']).filter((r) => typeof r.heat === 'number').length
  console.log(`  5A 带热度：${withHeat}/${tot5}（${((withHeat / tot5) * 100).toFixed(1)}%）`)
  console.log('\n=== 要进库的 ===')
  console.log(`5A ${tot5} 条（全保留） + 4A top ${top4A.length} 条 = ${tot5 + top4A.length} 条（再加手工精选 35）`)
  const rows = Object.entries(byProvince)
    .map(([cn, p]) => [cn, p['4A'].length, p['5A'].length])
    .sort((a, b) => b[1] - a[1])
  for (const [cn, a4, a5] of rows) console.log('  ' + cn.padEnd(5, '　') + ' 4A ' + String(a4).padStart(4) + '   5A ' + a5)
  console.log('\n→', path.relative(ROOT, OUT_FILE))
}

/** 同名去重（同一个景区在聚合站可能出现两次）。 */
function dedupeByName(list) {
  const seen = new Set()
  const out = []
  for (const it of list) {
    if (seen.has(it.name)) continue
    seen.add(it.name)
    out.push(it)
  }
  return out
}

/** 转成 `gd-a-level.json` 的行形状 `{name, city}`，多带坐标。 */
function toRow(it, province, cityMap) {
  const city = MUNICIPALITIES.has(province) ? undefined : cityMap.get(it.cityId)
  const row = { name: it.name, lng: round6(it.lng), lat: round6(it.lat) }
  // ⚠️ 字段顺序跟 gd-a-level.json 对齐：name → city（city 放后面，便于人工扫）
  if (city) row.city = city
  return row
}

const round6 = (n) => Math.round(n * 1e6) / 1e6

await main()
