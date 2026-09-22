/* ============================================================
   旅行内容包 v6 —— 小鸟随便飞，带回各种内容
   ============================================================
   ★ 这是放内容数据的存储文件。以后往里加条目就行。 ★

   ------------------------------------------------------------
   一条数据长什么样

     {
       id: 'badaling-1',              // 唯一标识
       type: 'photo',                  // 内容类型
       landmarkId: 'badaling',         // 关联的地标（可选）
       title: '长城之秋',              // 标题
       place: '中国长城',              // 地名
       lng: 116.0167, lat: 40.3563,   // 坐标（必须）
       mediaUrl: 'https://...',        // 图片/音乐/视频 URL
       textContent: '...',             // 文本内容（笑话/格言/故事）
       credit: { source, link, author? },
       summary: '一句话摘要',
       essay: '散文正文...',           // 用 \n\n 分段
     }

   内容类型：
     photo   — 照片（带散文）
     music   — 音乐（带散文）
     joke    — 笑话（纯文本）
     video   — 视频（带散文）
     quote   — 格言（纯文本）
     story   — 故事（纯文本）

   约定：
     1. 同一个地标可配多条内容（同地方多图/多散文）
     2. 坐标必须给（小鸟飞过去的地方）
     3. landmarkId 可选：给了就关联地标，不给就是"野点"
     4. 媒体内容只存 URL，不下载、不打包
     5. 文本内容按 \n\n 分段
   ============================================================ */

import type { TravelContent } from './types'
import { haversineKm, type GeoPoint } from './travelStories'

/* ============================================================
   一、内容数据
   ============================================================ */

export const TRAVEL_CONTENTS: TravelContent[] = [
  {
    id: 'badaling-autumn',
    type: 'photo',
    landmarkId: 'badaling',
    title: '长城之秋',
    place: '中国长城',
    lng: 116.0167,
    lat: 40.3563,
    mediaUrl:
      'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    credit: {
      source: 'Unsplash',
      link: 'https://unsplash.com/s/photos/great-wall-of-china',
    },
    summary: '一条趴在山上的龙，一半亮一半暗，一直伸到天边去。',
    essay: `我是一只小小的鸟。风最大的那天，我顺着北边的山脊一直飞，飞过一片又一片红透的林子，最后落在一条很长很长的墙上。

它不是墙。它是一条趴在山上的龙，背上铺着方方正正的砖，一级一级，从这座山头爬到那座山头，爬到我看不见的地方去。

我在城砖上走了很久。砖被好多好多人的脚磨得发亮，摸上去是温的，像谁刚刚才走过。风从垛口的缺口里钻进来，呜呜地响，好像在跟我说话。我听不懂它说什么，可是我不想走。

山上的树都黄了。枫树是红的，银杏是金的，还有些我叫不出名字的树，把整面山坡染成一大块暖洋洋的颜色。太阳斜斜地照过来，龙的身子一半亮一半暗，一直伸到天边去。

我站在最高的那座烽火台上往下看。底下的人小得像蚂蚁，慢慢地往上爬。有个小孩落在最后，走得满头大汗，还是不肯停下。我想告诉他：再走一段，你就能看见我看到的这些了。

天快黑的时候我才往回飞。回头看了一眼，长城还在那里，安安静静地趴着，好像已经趴了很多很多年，还要再趴很多很多年。

我把它拍了下来。你看，这就是我那天看见的。`,
  },
  {
    id: 'badaling-joke',
    type: 'joke',
    landmarkId: 'badaling',
    title: '长城上的笑声',
    place: '中国长城',
    lng: 116.02,
    lat: 40.35,
    textContent: `小明爬长城爬到一半，坐在台阶上喘气。

旁边一位老爷爷说：「小伙子，加油啊，不到长城非好汉！」

小明抬头看了看一眼望不到头的台阶，说：「爷爷，我现在下去，算不算好女？」

老爷爷愣了一下，然后笑得胡子都抖了：「算！算！好汉也好，好女也好，知道什么时候该歇着，才是聪明人。」`,
    summary: '爬长城累趴下的时候，一句玩笑能救半条命。',
  },
  {
    id: 'xihu-photo',
    type: 'photo',
    landmarkId: 'xihu',
    title: '西湖晨雾',
    place: '杭州西湖',
    lng: 120.145,
    lat: 30.245,
    mediaUrl:
      'https://images.unsplash.com/photo-1565378435245-2528d587e524?q=80&w=1000&auto=format&fit=crop',
    credit: {
      source: 'Unsplash',
      link: 'https://unsplash.com/s/photos/west-lake-hangzhou',
    },
    summary: '湖面上飘着一层薄薄的纱，远处的山只剩下影子。',
    essay: `我是一只小小的鸟。那天早上雾特别大，我从北边的山飞过来，看见一整片湖都被白色的纱盖住了。

湖面上的船像一只只小虫子，慢慢爬。船夫摇着橹，声音吱呀吱呀的，传到雾里变得很远很远。

我停在一棵柳树上。柳条垂到水面，风一吹就画出一圈一圈的波纹。雾散开一点的时候，我看见对岸有一座塔，尖尖的，像一支笔插在山上。

太阳慢慢升起来，金色的光把雾染成了粉色。湖水从白色变成银色，又变成金色，像有人在下面点了一盏灯。

我想，如果每天都能看到这样的早晨，我愿意天天早起。`,
  },
  {
    id: 'xihu-quote',
    type: 'quote',
    landmarkId: 'xihu',
    title: '西湖边的格言',
    place: '杭州西湖',
    lng: 120.14,
    lat: 30.24,
    textContent: `「水光潋滟晴方好，山色空蒙雨亦奇。
欲把西湖比西子，淡妆浓抹总相宜。」

—— 苏轼《饮湖上初晴后雨》

我在湖边的一根树枝上读到了这几句。一个老人坐在长椅上，对着湖念出来的。

我听不懂所有的字，但「淡妆浓抹总相宜」这一句我记住了。意思就是：不管是晴天还是雨天，西湖都好看。

我想，做人是不是也一样？开心的时候好看，难过的时候也好看，不用总是装成同一个样子。`,
    summary: '苏轼说西湖淡妆浓抹都好看，我想人也是一样。',
  },
  {
    id: 'gugong-story',
    type: 'story',
    landmarkId: 'gugong',
    title: '故宫里的一只猫',
    place: '北京故宫',
    lng: 116.397,
    lat: 39.916,
    textContent: `故宫里住着一只橘色的猫，大家叫它「阿黄」。它不是游客带来的，是世世代代住在这里的猫的后代。

阿黄每天在红墙之间散步。它知道哪片屋檐下面最凉快，知道哪个角落有老鼠，还知道哪个保安叔叔会给它留吃的。

有一天晚上，阿黄跳上了一座宫殿的屋顶。月光把黄色的琉璃瓦照得像金子一样。它坐在屋脊上，看着整个故宫安安静静地睡着。

远处的钟楼敲了一下，声音传得很远。阿黄抖了抖耳朵，觉得这是世界上最好听的声音。

它想：「我的曾曾曾祖父，也坐在这里听过这个声音吧。」

然后它蜷成一个球，在金色的屋顶上睡着了。`,
    summary: '故宫里有一只猫，世世代代住在红墙之间。',
  },
  {
    id: 'huangshan-music',
    type: 'music',
    landmarkId: 'huangshan',
    title: '黄山松风',
    place: '安徽黄山',
    lng: 118.1667,
    lat: 30.1333,
    mediaUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    credit: {
      source: 'SoundHelix',
      link: 'https://www.soundhelix.com',
    },
    summary: '风吹过松针的声音，像有人在低低地弹琴。',
    essay: `我是一只小小的鸟。黄山很高，飞上来的时候风特别大。

山上的松树都长在石头缝里，根把石头抱得紧紧的。风吹过松针，发出呜呜的声音，像有人在低低地弹琴。

我停在迎客松的一根枝上。它伸着手臂一样的枝干，好像在说「欢迎」。它已经在这里站了很多很多年，看过无数的人从下面爬上来。

云在脚下飘来飘去。有时候整座山都被云吞掉了，只剩下几棵树的顶露在外面，像海里的岛。

我把这里的声音录了下来。你听，这是风在跟松树说话。`,
  },
  {
    id: 'tiananmen-video',
    type: 'video',
    landmarkId: 'tiananmen',
    title: '升旗时刻',
    place: '天安门广场',
    lng: 116.3975,
    lat: 39.9087,
    mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    credit: {
      source: 'Sample Video',
      link: 'https://peach.blender.org',
    },
    summary: '天还没亮就有人排队，等着看红旗慢慢升到顶上。',
    essay: `我是一只小小的鸟。天还没亮的时候，广场上就已经有很多人了。他们有的拿着小旗子，有的穿着厚厚的衣服，在晨风里等着。

我想看看他们在等什么，就停在华表上。

突然，整齐的脚步声从远处传过来。一队穿着绿色衣服的人，一步一步走到旗杆下面。他们的脚步完全一样，像一个人在走路。

音乐响起来的时候，所有人都唱起了歌。我看见一个小孩骑在爸爸的肩膀上，跟着哼。他虽然很小，但唱得特别认真。

红旗慢慢升到顶上，风把它吹得展开。太阳正好从东边跳出来，照在红旗上，红得像一团火。

我把它拍了下来。你看，这就是那天早上我看见的。`,
  },
]

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

/** 某个地标关联的内容 */
export function contentsByLandmark(landmarkId: string): TravelContent[] {
  return TRAVEL_CONTENTS.filter((c) => c.landmarkId === landmarkId)
}

/** 内容总数 */
export function contentCount(): number {
  return TRAVEL_CONTENTS.length
}

/** 所有有 landmarkId 的内容 */
export function landmarkContents(): TravelContent[] {
  return TRAVEL_CONTENTS.filter((c) => c.landmarkId)
}

/* ============================================================
   三、目的地选择
   ============================================================ */

/** 随机选一条还没去过的内容；如果都去过了就随便选一条 */
export function pickContent(opts: {
  exclude: string[]       // 已去过的 contentId 列表
  rng: () => number
}): TravelContent | undefined {
  const { exclude, rng } = opts
  const unvisited = TRAVEL_CONTENTS.filter((c) => !exclude.includes(c.id))
  const pool = unvisited.length > 0 ? unvisited : TRAVEL_CONTENTS
  if (pool.length === 0) return undefined
  return pool[Math.floor(rng() * pool.length)]
}

/** 计算从家到内容包的距离（公里） */
export function distanceToContent(content: TravelContent, home?: GeoPoint): number {
  if (!home) return 0
  return haversineKm(home, { lng: content.lng, lat: content.lat })
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
