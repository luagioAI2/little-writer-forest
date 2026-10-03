/* ============================================================
   满分范文引擎 v2 —— 顺着孩子的稿子，写一篇「他本可以写成的样子」
   ============================================================

   旧版的问题（被用户当场抓到）：
     孩子写「我的妈妈」，范文却是「推开窗，一片《我的妈妈》扑面而来」。
     原因是正文完全由 SCENE_BANK 硬编码模板拼成，ctx 里的
     时间/地点/事件 全是占位符（'清晨' / '那里' / '我遇到了一点小麻烦'）。
     孩子的原文只贡献了 4 个「好词」。那是换皮，不是改写。

   这一版的思路：
     1. **先读懂孩子写了什么** —— 抽人物、地点、时间、物件、事件、感受。
     2. **顺着他的内容往下写** —— 每写一句都问：这句跟孩子的稿子有关系吗？
        没有关系的句子，一句都不许进范文。
     3. **朝满分方向拔** —— 主动铺设修辞：比喻、拟人、排比、通感、
        叠词、五感。这是「满分作文」与「合格作文」的分水岭。
     4. **保住孩子的视角和口吻** —— 不写成成人腔，不替他抒情。

   小学满分作文的判定要素（据课标与常见评分细则归纳）：
     · 审题准 —— 全文扣题，不跑偏
     · 中心明 —— 有一句能立住的主旨
     · 内容实 —— 有具体的事、具体的细节，不空喊口号
     · 结构清 —— 开头点题 / 中间展开 / 结尾升华，层次分明
     · 语言活 —— 用词准确生动，有修辞，有画面，有声音
     · 情感真 —— 结尾落到自己的真实感受

   本引擎按这六条逐条落实。

   ★ 2026-09-18 又改过一次，改的是「跑偏」—— 先读这里：
     家长原话：「更好的写法 也没有结合图片，和用户写的内容去改写
     （写了一段不相关的内容，你仔细研究下）」

     查到两个真因，都不是「模型不行」，是**管线断了**：
       1. `buildModelEssay` 拿到了 `images`，但**从来没往下传** ——
          本地引擎压根不知道图上有什么（见 scoring.ts 的适配层）；
       2. 素材抽取只认 5 张固定词表（人物/地点/时间/物件/事件）。
          孩子写「天上有一条彩虹」，彩虹**不在任何一张表里**，
          于是被整条丢掉 —— 生成出来的东西里当然没有彩虹。

     所以那一版加了「具体名物」这一层（extractConcrete +
     buildImagerySentences）：把孩子写到的、图上有的东西一个个抓出来，
     再在正文里给它们安排句子。**正文里出现孩子自己的细节，
     是「不跑偏」唯一的硬标准。**

   ★ 2026-09-19 家长第二次报同一件事：
     「还有更好的写法 也还是有问题。 要结合 图 和 用户写的」

     这一轮查到的真因**不在素材层，在文体判定**：
     题库里「看图作文」这个标签的 category 是 `event`（写事，见
     prompts.ts 的 TOPIC_TAGS），于是《看图写话》走的是写事模板：

       「一开始我还没反应过来。一切发生得太快。
         接着，事情往前走，我的手心里全是汗。
         周围有那么多声音，我却只听见自己的心跳。」

     这段跟图没关系、跟孩子写的也没关系。素材层抓得再准，
     也架不住整段中间都是凭空编的。三处改动：

       1. `resolveKind` 加 `pictureFirst`：**写事模板必须有「事」**，
          孩子没写出可识别的事时改走写景（顺着画面和名物写）；
       2. `extractConcrete` 两道修：
          · 词表命中的**不过泛称筛**（「雪人」里有个「人」，
            以前被整条丢掉）；
          · 量词兜底加谓词守卫（「开满粉」「小鸟飞」这种碎词）；
       3. 图注可以**补**孩子没写的地点/时间（只补空，不覆盖）。

     教训记在这里：**「结合图和孩子写的」不是把素材抓全就够了，
     还要保证承载它的那个文体模板本身不是凭空编的。**
   ============================================================ */

import type { CompositionGenre, ModelEssay, SkeletonLine } from './types'
import { resolveGenre } from './types'
import { analyzeText, countWords, splitSentences } from './scoring'

/* ============================================================
   一、从孩子原文里抽取「真实素材」
   ============================================================ */

export interface ChildMaterial {
  /** 人物（妈妈 / 王老师 / 小明 …） */
  person?: string
  /** 地点（公园 / 教室 / 外婆家 …） */
  place?: string
  /** 时间（清晨 / 那个下午 / 去年冬天 …） */
  time?: string
  /** 物件（书 / 小狗 / 风筝 …） —— 状物类的核心 */
  thing?: string
  /** 事件（运动会 / 考试 / 搬家 …） */
  event?: string
  /** 孩子自己写出来的好词，范文里要自然地用回来 */
  goodWords: string[]
  /** 孩子用过的感官 */
  senses: string[]
  /**
   * ★ 孩子写到的**具体名物**（彩虹 / 落叶 / 萤火虫 / 老花镜…）。
   *
   * 这一项是 2026-09-18 加的，原因见文件头：
   * 上面那 5 张词表是「角色位」（谁、在哪、什么时候），
   * 而「不跑偏」靠的是**名物** —— 孩子写了彩虹，
   * 改写里就必须有彩虹，否则读起来就是「跟我没关系」。
   */
  concrete: string[]
  /** 孩子的首句 —— 保留他的切入点 */
  firstSentence: string
  /** 孩子的末句 —— 保留他的落点 */
  lastSentence: string
  /** 原文里所有分句 */
  sentences: string[]
  /** 原文长度 */
  wordCount: number
}

/** 人物词表 —— 命中即取，优先取最长的（「外婆」优先于「婆」） */
const PERSON_PATTERNS: RegExp[] = [
  /(外婆|奶奶|爷爷|外公|姥姥|姥爷)/,
  /(妈妈|母亲|爸爸|父亲)/,
  /(姐姐|妹妹|哥哥|弟弟)/,
  /(王老师|李老师|张老师|老师)/,
  /(小明|小红|小刚|小美|同学)/,
  /(阿姨|叔叔|舅舅|姑姑|伯伯)/,
]

/** 地点词表 */
const PLACE_PATTERNS: RegExp[] = [
  /(公园|花园|校园|学校|教室|操场|图书馆)/,
  /(外婆家|奶奶家|爷爷家|家里|家中|厨房|阳台|房间)/,
  /(河边|小河边|湖边|海边|山上|山顶|树下|田野|草地)/,
  /(马路|街上|路上|车站|医院|超市|书店|动物园)/,
]

/** 时间词表 —— 覆盖具体时刻与相对时间 */
const TIME_PATTERNS: RegExp[] = [
  /(清晨|早晨|早上|黎明)/,
  /(中午|正午|午后|下午)/,
  /(傍晚|黄昏|晚上|夜里|深夜|夜晚)/,
  /(春天|夏天|秋天|冬天|初春|盛夏|深秋|寒冬)/,
  /(去年|今年|那年|那天|那天下午|那个夏天|这个周末|周末)/,
  /(有一次|有一天|第一次|小时候)/,
]

/** 物件词表 —— 状物/写景类靠它 */
const THING_PATTERNS: RegExp[] = [
  /(小狗|小猫|小鸟|小鱼|乌龟|兔子|仓鼠|金鱼)/,
  /(风筝|自行车|书包|铅笔盒|文具盒|橡皮|日记本)/,
  /(玩具|积木|乐高|娃娃|球|篮球|足球|跳绳)/,
  /(花|小草|树|柳树|桃树|向日葵|荷花|竹子|梅花)/,
  /(书|故事书|绘本|漫画)/,
]

/** 事件词表 —— 写事类的骨架 */
const EVENT_PATTERNS: RegExp[] = [
  /(运动会|比赛|考试|测验|表演|演出|朗诵|演讲)/,
  /(大扫除|值日|做家务|做饭|包饺子|种树|植树)/,
  /(春游|郊游|旅行|旅游|露营|野餐|放风筝)/,
  /(搬家|转学|交朋友|吵架|和好|道歉|误会)/,
  /(学骑车|学游泳|学钢琴|第一次)/,
]

/**
 * 事件短语的「可入句」化。
 *
 * 裸动词（做饭 / 值日 / 种树）直接塞进「有一次，{事件}。」会变成
 * 「有一次，做饭。」这种残句。这里给它们补一个宾语或换成完整说法。
 */
const EVENT_PHRASE: Record<string, string> = {
  做饭: '她在厨房里忙了一早上',
  值日: '轮到我值日',
  大扫除: '全班一起大扫除',
  做家务: '我学着做家务',
  包饺子: '一家人围在一起包饺子',
  种树: '我们去山上种树',
  植树: '我们去山上种树',
  考试: '那次考试',
  测验: '那次测验',
  比赛: '那场比赛',
  运动会: '那次运动会',
  表演: '那次表演',
  演出: '那次演出',
  春游: '那次春游',
  郊游: '那次郊游',
  旅行: '那次旅行',
  旅游: '那次旅行',
  露营: '那次露营',
  野餐: '那次野餐',
  放风筝: '我们去放风筝',
  搬家: '我们家搬了家',
  转学: '我转学了',
  交朋友: '我交到了新朋友',
  吵架: '我们吵了一架',
  和好: '我们和好了',
  道歉: '我向他道了歉',
  误会: '我们之间有个误会',
  学骑车: '我学骑自行车',
  学游泳: '我学游泳',
  学钢琴: '我学钢琴',
  第一次: '那是我第一次做这件事',
}

/** 把抽取到的事件词转成能直接进句子的短语 */
export function eventPhrase(event: string | undefined): string | undefined {
  if (!event) return undefined
  return EVENT_PHRASE[event] ?? event
}

/* ============================================================
   一·五、「具体名物」抽取 —— 让孩子的原话和图里的东西真的进正文
   ------------------------------------------------------------
   上面 5 张词表回答的是「谁 / 在哪 / 什么时候 / 什么东西 / 什么事」，
   是**角色位**；但一篇稿子读起来「像不像我写的」，靠的是**名物**：
   彩虹、落叶、萤火虫、老花镜、菜篮子……

   老版只有角色位，所以孩子写「天上有一条彩虹」时，
   彩虹既不是人物也不是地点更不是「物件表」里的东西，被整条丢掉，
   改写出来只剩「校园铺开去，像是被谁用画笔轻轻涂过」这种空写 ——
   这正是家长说的「写了一段不相关的内容」。

   这里补两件事：
     1. `IMAGERY_GROUPS` —— 一张**画面词表**，按「怎么写它」分组；
     2. `extractConcrete` —— 词表命中 + 量词短语兜底，
        把名物一个个抓出来（见文件头第 2 条真因）。
   ============================================================ */

/** 分组只决定「这个名物该怎么入句」，不影响能不能抽到 */
export type ImageryBucket = 'sky' | 'plant' | 'animal' | 'object' | 'water'

const IMAGERY_GROUPS: { bucket: ImageryBucket; words: string[] }[] = [
  {
    bucket: 'sky',
    words: [
      '彩虹', '晚霞', '朝霞', '夕阳', '太阳', '月亮', '月牙', '星星', '星光',
      '云海', '白云', '乌云', '云', '雨点', '雨珠', '雨滴', '雨', '雪球',
      '雪花', '雪人', '雪地', '雪', '冰棱', '霜', '露珠', '雾', '闪电', '雷声',
      '水洼', '水花', '阳光', '影子',
    ],
  },
  {
    bucket: 'water',
    words: [
      '小河', '河水', '湖水', '大海', '海浪', '浪花', '沙滩', '贝壳',
      '石拱桥', '小船', '池塘', '小溪', '水',
    ],
  },
  {
    bucket: 'plant',
    words: [
      // ⚠️ 同长度的词靠**书写顺序**决定谁先命中（sort 是稳定的）：
      //    「树叶」必须排在「叶子」前面，否则「公园里的树叶都黄了」
      //    会同时抽出「叶子」和「树」两个词，正文里就会连着写两遍。
      '树叶', '叶子', '落叶', '银杏树', '柳树', '桃树', '松树', '大树', '树影', '树',
      '小草', '草', '野花', '小花', '花瓣', '花', '荷叶', '荷花', '蒲公英',
      '向日葵', '竹子', '菜苗', '绿植', '麦穗', '稻田',
    ],
  },
  {
    bucket: 'animal',
    words: [
      '小鸟', '蝴蝶', '蜜蜂', '蜻蜓', '萤火虫', '蚂蚁', '小鱼', '金鱼',
      '小猫', '小狗', '兔子', '乌龟', '蜗牛', '青蛙', '麻雀', '鸽子', '猫', '鱼',
    ],
  },
  {
    bucket: 'object',
    words: [
      '风筝', '风筝线', '泡泡', '纸飞机', '雨伞', '红伞', '伞', '灯笼', '气球', '风车',
      '玩具熊', '布娃娃', '陀螺', '积木', '玩具', '弹珠', '沙包', '水枪',
      '自行车', '电动车', '三轮车', '滑梯', '秋千', '沙坑',
      '书包', '铅笔盒', '橡皮', '日记本', '课本', '作业本', '试卷', '奖状',
      '蜡笔', '画笔', '画纸', '剪刀', '尺子', '红领巾', '校服', '饭盒', '水壶',
      '玻璃罐', '手电', '围巾', '手套', '雨衣', '雨鞋', '扇子', '帽子', '草帽', '围裙',
      '老花镜', '眼镜', '毛线团', '毛线', '毛衣', '摇椅', '拐杖', '茶杯', '台灯',
      '飞机', '热气球', '船', '小舟', '火车', '汽车', '拖拉机',
      '闹钟', '工具箱', '扳手', '听诊器', '菜篮子', '篮子', '扫帚', '纸箱', '垃圾车',
      '足球', '篮球', '跳绳', '球门', '红绿灯', '斑马线', '公交车', '站牌',
      '锅', '碗', '课桌', '黑板', '粉笔', '镜子', '窗台', '路灯', '栅栏',
      '小房子', '屋顶', '照片', '蜡烛', '烟花', '鞭炮', '红包', '对联',
      '饺子', '汤圆', '粽子', '月饼', '糖葫芦', '冰棍', '蛋糕', '糖果',
      '西瓜', '苹果', '橘子', '草莓', '葡萄', '鸡蛋', '牛奶', '遮阳伞',
    ],
  },
]

const IMAGERY_BUCKET = new Map<string, ImageryBucket>()
for (const g of IMAGERY_GROUPS) {
  for (const w of g.words) IMAGERY_BUCKET.set(w, g.bucket)
}

/**
 * ⚠️ 必须按长度从长到短排。
 * 否则「雨」会抢在「雨珠」前面命中，抽出来的词就碎了；
 * 同理「云」抢「白云」、「花」抢「荷花」。
 */
const IMAGERY_LEXICON = [...IMAGERY_BUCKET.keys()].sort((a, b) => b.length - a.length)

/**
 * 抽出来但根本不是「名物」的：人称、时间、泛称。
 *
 * ⚠️ **只用在量词兜底上**，不许拿去过滤词表命中 ——
 *    它是个**子串**判断，而「雪人」里也有个「人」。
 *    2026-09-19 真踩过：孩子写「我和小明在雪地里打雪仗，还堆了一个雪人」，
 *    雪人整条被这行丢掉，范文里就只剩一个「雪」，
 *    家长看到的是「我要结合图和孩子写的东西，结果我写的东西没了」。
 *    词表里的词是**人工挑过的名物**，不需要再过这道泛称筛。
 */
const NOT_A_THING =
  /(人|孩子|宝宝|同学|学生|老师|医生|警察|司机|妈妈|爸爸|爷爷|奶奶|阿姨|叔叔|时候|时间|地方|东西|事情|话|声音|味道|感觉|办法|样子)/

/**
 * 量词兜底抽出来的**碎词**特征：里头混进了谓语字（动词/形容词）。
 *
 * 量词后面接的通常是「修饰语 + 名物」，而兜底正则只会闷头取 2-3 个字，
 * 于是把修饰语一起吞进来：
 *   「两棵开满粉花的树」  →「开满粉」（满、开都是谓语字）
 *   「三只小鸟飞过」     →「小鸟飞」（飞是谓语字）
 *   「一排整整齐齐的篱笆」→「整整齐」（整、齐都是谓语字）
 * 这些词进了正文就会变成「还有开满粉。」这种句子。
 *
 * ⚠️ 这是个**启发式**，而且只用在兜底那一层 —— 词表命中不过这道关，
 *    所以「彩虹」「水洼」这些真名物一个字都不受影响。
 *    取舍是明确的：**宁可少抽一个生僻名物，也不许把碎词写进孩子的范文。**
 *    真名物被误伤的出路是**加进词表**（「飞机」就是这么补进去的），
 *    而不是把这道关放松。
 */
const CAPTURE_LOOKS_LIKE_PREDICATE =
  /[满齐整遍净完开飞走跑跳落飘流淌荡摇晃笑哭叫唱响停转翻滚爬游]/

/**
 * 量词短语兜底 —— 词表不可能收全，「一条彩虹」这种写法得能认出来。
 *
 * 只取 2-3 个字，是刻意的：1 个字的名物（花 / 草 / 树）词表里已经有了，
 * 而 4 个字的捕获多半是把修饰语一起吞进来了（「两棵开满粉花的树」）。
 */
const MEASURE =
  /[一二两三四五六七八九十半几]?\s*(?:条|片|朵|只|棵|座|阵|群|颗|把|束|缕|滴|场|块|根|支|张|面|轮|抹|串|团|道|盏|粒|丝|丛|排|摊|汪)([\u4e00-\u9fa5]{2,3})/g

/**
 * 量词短语里混进虚词/方位词的，一律不要。
 *
 * ⚠️ 方位词那一串（上下里中外前后边）是**必须**的：
 *   「我和小明在操场上玩」里的「场」也是量词，
 *   不加这串就会抽出「上玩」这种词，还会把真正的名物挤掉名额
 *   （2026-09-18 真踩过：彩虹就是这么丢的）。
 *
 * 和上面 CAPTURE_LOOKS_LIKE_PREDICATE 是**两道并列的关**，都要过：
 *   这条挡虚词（上玩），那条挡谓语（开满粉）。
 */
const JUNK_CAPTURE = /[的了着过在是有我你他她它和与就都也还又很太上下里中外前后边色种样般似]/

/**
 * 从一段文字里挑出「具体名物」。
 *
 * 优先级：词表命中（长词优先）→ 量词短语兜底。
 * 同一件东西只说一遍：「雨珠」收下了，「雨」就不要再进来。
 *
 * ⚠️ 默认按**出现位置**排序，不是按词表顺序。
 * 孩子先写什么就先说什么 —— 改写要顺着他的叙述走，
 * 不能因为「彩虹」在词表里排得靠前，就把后面的东西提到前面去。
 *
 * @param preferSpecific 图注专用。图注是「泛景多、名物少」的长句，
 *   名额又只有一两个，得先给更具体的（字数多的）。
 *   2026-09-18 真踩过：图注「草地上有两摊水洼」里「草」排在「水洼」前面，
 *   把水洼挤掉了 —— 而草是泛景，水洼才是这场雨的记号。
 */
export function extractConcrete(
  text: string,
  limit = 6,
  preferSpecific = false,
): string[] {
  if (!text) return []
  const out: { word: string; at: number }[] = []

  const push = (w: string) => {
    if (!w) return
    if (out.some((o) => o.word === w)) return
    // 已经被更长的词盖住了（雨珠 ⊃ 雨），就别重复收
    if (out.some((o) => o.word.includes(w))) return
    const at = text.indexOf(w)
    if (at < 0) return
    out.push({ word: w, at })
  }

  /*
   * 词表命中 —— **不过泛称筛**（见 NOT_A_THING 的注释）。
   * 词表是人工挑的名物，含「人」的「雪人」也是名物。
   */
  for (const w of IMAGERY_LEXICON) {
    if (text.includes(w)) push(w)
  }

  /*
   * 量词兜底 —— 词表收不全，这里补生僻名物。
   * 三道筛：泛称（孩子/时候）、虚词（上玩）、碎词（开满粉/小鸟飞）。
   */
  for (const m of text.matchAll(MEASURE)) {
    if (NOT_A_THING.test(m[1])) continue
    if (JUNK_CAPTURE.test(m[1])) continue
    if (CAPTURE_LOOKS_LIKE_PREDICATE.test(m[1])) continue
    push(m[1])
  }

  // sort 是稳定的：同长度的词仍然保持原来的顺序
  // sort 是稳定的：同长度的词仍然保持原来的顺序
  const ordered = preferSpecific
    ? [...out].sort((a, b) => b.word.length - a.word.length)
    : [...out].sort((a, b) => a.at - b.at)

  return ordered.slice(0, limit).map((o) => o.word)
}

/** 这个名物属于哪一类 —— 只影响「怎么写」，没有也不影响能不能写 */
export function imageryBucket(word: string): ImageryBucket | undefined {
  return IMAGERY_BUCKET.get(word)
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const m = text.match(p)
    if (m) return m[1]
  }
  return undefined
}

/**
 * 抽取孩子的真实素材。
 *
 * 这一层是「范文不跑偏」的地基 ——
 * 后面的每一句生成都会优先消费这里的字段。
 */
export function extractChildMaterial(childText: string, title: string): ChildMaterial {
  const analysis = analyzeText(childText)
  const text = `${title}。${childText}`

  const material: ChildMaterial = {
    person: firstMatch(text, PERSON_PATTERNS),
    place: firstMatch(text, PLACE_PATTERNS),
    time: firstMatch(text, TIME_PATTERNS),
    thing: firstMatch(text, THING_PATTERNS),
    event: firstMatch(text, EVENT_PATTERNS),
    goodWords: analysis.goodWords,
    senses: analysis.senses,
    // 正文 + 题目一起扫：题目里点名的东西（「雨后的彩虹」）也是孩子要写的
    concrete: extractConcrete(`${title}。${childText}`, 4),
    firstSentence: analysis.firstSentence,
    lastSentence: analysis.lastSentence,
    sentences: splitSentences(childText),
    wordCount: analysis.wordCount,
  }

  // 题目本身常常直接点明人物/地点/物件 —— 优先级高于正文里偶尔提到的
  if (!material.person) material.person = firstMatch(title, PERSON_PATTERNS)
  if (!material.place) material.place = firstMatch(title, PLACE_PATTERNS)
  if (!material.thing) material.thing = firstMatch(title, THING_PATTERNS)
  if (!material.event) material.event = firstMatch(title, EVENT_PATTERNS)

  return material
}

/* ============================================================
   二、按大类决定「怎么拔高」
   ============================================================ */

export type EssayKind =
  | 'person'
  | 'scene'
  | 'event'
  | 'object'
  | 'imagine'
  /* ★ `applied` 是**题目自带的格式要求**（不是「写什么对象」）—— 见 `resolveKind` */
  | 'applied'

/**
 * 定走哪一支：按「写什么对象」，还是按「题目自带的格式要求」。
 *
 * ★ 2026-09-19 加了 `opts.pictureFirst`，修的是家长第二次报的
 *   「更好的写法 也还是有问题。要结合 图 和 用户写的」。
 *
 *   真因不在提示词，在**文体判定**：
 *   题库里「看图作文」这个标签的 category 是 `event`（写事），
 *   于是孩子写《看图写话》，范文走的是**写事模板**：
 *
 *     「一开始我还没反应过来。一切发生得太快。
 *       接着，事情往前走，我的手心里全是汗。
 *       周围有那么多声音，我却只听见自己的心跳。
 *       就在那时候，我想起了谁说过的一句话。」
 *
 *   这段跟图没关系、跟孩子写的也没关系 —— 它只是「一篇作文里
 *   该有的紧张感」。家长看到的正是这个。
 *
 *   规则：**写事模板必须有「事」。**
 *   孩子没写出可识别的事（`m.event` 为空）时，写事分支就没有锚点，
 *   它只能凭空编一段情绪出来。这种情况下改走写景分支 ——
 *   写景分支是顺着「画面 + 名物」写的，而这两样恰好就是
 *   「图」和「孩子写的」。
 *
 *   ⚠️ 判据用 `m.concrete.length > 0` 而不是「有没有配图」：
 *      老师留的《难忘的事》也可能写打雪仗，孩子写到了雪人、雪地，
 *      同样不该被编出一段「手心冒汗」。
 *      孩子什么都没写具体时（既无事也无名物），才维持写事。
 */
export function resolveKind(
  category: string,
  m: ChildMaterial,
  opts: { pictureFirst?: boolean; genre?: CompositionGenre } = {},
): EssayKind {
  /*
   * ★★★ 2026-09-30 起：**格式要求优先于「写什么对象」**。
   *
   *   `category` 那一层只描述「记叙文写的是什么」（写人/写景/写事/状物/想象），
   *   它装不下应用文 —— 题库里 `applied-writing` 的 category 就是 `event`。
   *   所以应用文必须在 switch **之前**就分流出去，否则
   *   「国旗下的讲话」会走写事模板，生成一段「一开始我还没反应过来」。
   *
   *   ⚠️ 判据是 `genre`，不是标题里有没有「倡议书」这类词 ——
   *      标题词只决定**哪一种**应用文（见 `appliedFormOf`），
   *      而"是不是应用文"是题库标好的，不该靠猜。
   *
   * ★★ 2026-10-01：说明文、议论文也走这条。一次加两个，所以不再逐个
   *   `if` —— **只要不是记叙文，文体名就是 kind 名**（两者取值一一对应）。
   *   ⚠️ 因此 `EssayKind` 必须装得下每一个非记叙文文体，否则这里会静默漏掉：
   *      `modelEssay.test.ts` 有一条守卫**遍历 `GENRES`** 盯着这件事。
   *
   * ★★★ 2026-10-02 家长推翻了上面那一条的一半：
   *   「不需要 写成什么文体…APP 不需要区分文体。」
   *   所以说明文 / 议论文**从模型里删掉了**，`CompositionGenre` 只剩
   *   `narrative` / `applied`。上面那句「遍历 `GENRES`」的守卫仍然有效
   *   （现在只剩应用文一个非记叙文值），而且**更该留着** ——
   *   万一以后有人把 `GENRES` 加回一个值而忘了 `EssayKind`，它立刻红。
   */
  const genre = resolveGenre(opts.genre)
  if (genre !== 'narrative') return genre

  switch (category) {
    case 'scene':
      return 'scene'
    case 'person':
      return 'person'
    case 'object':
      return 'object'
    case 'imagine':
      return 'imagine'
    case 'event':
      // 有「事」就按写事写；没有事，就顺着画面和名物写
      if (m.event) return 'event'
      return opts.pictureFirst || m.concrete.length > 0 ? 'scene' : 'event'
    default:
      // 兜底：靠素材反推
      if (m.person) return 'person'
      if (m.thing) return 'object'
      if (m.event) return 'event'
      return 'event'
  }
}

/* ============================================================
   二·五、应用文：子形态与「称呼 / 号召 / 落款」
   ------------------------------------------------------------
   应用文跟记叙文最大的差别不是「写什么」，而是**有固定格式**：
   称呼 → 正文 → 号召 → 落款。孩子丢分基本都丢在这几样上，
   所以这一节的存在意义就是**把格式写对**，不是把句子写漂亮。

   ★ 子形态从**标题**认。为什么不用 `tagId`：调用链
     （`composeModelEssay` → `buildOpening`）手里只有
     `title` / `category` / `genre`，拿不到标签；
     而题库里这几道题的标题本身就把形态写清楚了
     （「…倡议书」「…建议书」「观后感」「…的发言」）。

   ⚠️⚠️ **认不出来的默认是 `speech`（演讲稿）**。
      理由：应用文里演讲稿占比最高（本库 8 道里 4 道），
      它的形状（称呼 + 正文 + 号召 + 谢谢大家）也最通用。
      ➜ 但这个默认**是会猜错的**（比如将来加「通知」「留言条」
        会被套成演讲稿）。所以不靠"猜得准"，靠**让它猜错时看得见**：
        `modelEssay.test.ts` 有一条**逐题断言** —— 题库里每道
        应用文题的标题都必须认出**预期**的子形态。标题改了、
        或新加了别的形态，那条测试立刻红。

   ⚠️ **`letter`（书信）故意没进来**：题库里 `letter` 标签
      （「给亲人的一封信」）现在**还是记叙文**（没标 `genre`），
      所以加进来会是死代码。这是**分类上的一个缺口，已报家长**。
      等 `letter` 真的标成应用文时，在这里加一档 + 补一条逐题断言。
   ============================================================ */

export type AppliedForm = 'proposal' | 'suggestion' | 'review' | 'speech'

export interface AppliedShape {
  /** 这是哪一种应用文 —— 正文和落款都照着它写 */
  form: AppliedForm
  /** 开头的称呼行（含冒号）。观后感没有称呼 → 空串 */
  salutation: string
  /** 开头点题的那一句（称呼下面那句） */
  opener: string
  /** 结尾的号召 / 收束句 */
  call: string
  /** 落款行（**不含**日期）。演讲稿和观后感没有落款 → 空串 */
  signature: string
  /**
   * ★ 「这件事是什么」——**运行期**才有的字段（见 `appliedTopicOf`）。
   *
   * 为什么不做进上面那张静态表：话题是从**标题**抠出来的，
   * 同一种形态配不同标题会有不同话题（两份倡议书话题不同），
   * 所以它不能是表的一部分。调用方这样拼：
   *   `{ ...appliedShapeOf(title), topic: appliedTopicOf(title) }`
   *
   * ⚠️ 别去读 `m.thing` 当话题 —— 那会把标题里的「书」当成孩子的物件。
   */
  topic?: string
}

/**
 * 四种应用文的「骨架」。
 *
 * ⚠️ 这些句子是**照着小学阶段真实的应用文格式**写的，改动前请先想清楚
 *    孩子在课堂上被要求的是什么 —— 这不是文案，是教学内容。
 */
const APPLIED_SHAPES: Record<AppliedForm, AppliedShape> = {
  proposal: {
    form: 'proposal',
    salutation: '亲爱的同学们：',
    opener: '今天我想请大家和我一起，做一件对大家都好的事。',
    call: '一个人的力量很小，可大家一起做，就完全不一样了。让我们从今天开始，从身边的小事做起吧！',
    signature: '倡议人：小笔苗',
  },
  suggestion: {
    form: 'suggestion',
    salutation: '尊敬的校长：',
    opener: '我是本校的一名学生，有一件事想跟您说一说。',
    call: '以上是我的想法，希望您能看一看。谢谢您！',
    signature: '建议人：小笔苗',
  },
  review: {
    form: 'review',
    // 观后感既没有称呼、也没有落款 —— 它是「夹在记叙和议论之间」的文体
    salutation: '',
    opener: '看完之后，我心里一直放不下。',
    call: '它让我明白，有些东西值得一遍遍回想。我会一直记得。',
    signature: '',
  },
  speech: {
    form: 'speech',
    salutation: '老师们、同学们：',
    opener: '今天我想和大家说一说我的想法。',
    // 演讲稿用致谢收尾，不用落款
    call: '我的话讲完了。谢谢大家！',
    signature: '',
  },
}

/**
 * 从标题认应用文的子形态。
 *
 * ⚠️ 顺序有讲究：**「倡议书」和「建议书」必须先判** ——
 *    它们都带「书」字，先判具体的那两个，再退到通用规则。
 * ⚠️ 认不出 → `speech`（见上面那段注释，靠逐题断言兜住）。
 */
export function appliedFormOf(title: string): AppliedForm {
  if (/倡议书/.test(title)) return 'proposal'
  if (/建议书/.test(title)) return 'suggestion'
  if (/观后感|读后感|听后感|观后有感/.test(title)) return 'review'
  return 'speech'
}

export function appliedShapeOf(title: string): AppliedShape {
  return APPLIED_SHAPES[appliedFormOf(title)]
}

/**
 * 从标题里抠出「这件事到底是什么」。
 *
 * ⚠️⚠️ **不可以用 `m.thing`** —— `extractChildMaterial` 会把**标题**
 *    也算进匹配范围，而应用文的标题自带一个「书」字
 *    （倡议**书** / 建议**书**）→「节约用水倡议书」的 `m.thing` 是 **`书`**，
 *    正文就会写成「因为**书**让我想了很久」。不报错、不崩，但整篇跑题。
 *    （这是实测踩到的，不是假想。）
 *
 * 判据：把子形态那个词去掉，剩下的还得**像个话题** ——
 *   至少 2 个字，而且**不能以「的」结尾**（「国旗下的讲话」→「国旗下的」是残句）。
 *   认不出来就返回 `undefined`，让调用方退到通用说法。
 *
 *   实测：节约用水 ✓ / 保护环境 ✓ / 竞选班干部 ✓
 *        国旗下的讲话 ✗ / 读书节的发言 ✗ / 毕业典礼上的发言 ✗ / 观后感 ✗ / 给校长的建议书 ✗
 */
export function appliedTopicOf(title: string): string | undefined {
  const t = title
    .replace(/倡议书|建议书|观后感|读后感|听后感|演讲稿|发言|讲话|致辞|演讲/g, '')
    .replace(/^[《「]|[》」]$/g, '')
    .trim()
  if (t.length < 2) return undefined
  if (/的$/.test(t)) return undefined
  return t
}

/**
 * 子形态的中文名 —— 提示词和亮点都要说人话。
 * ⚠️ 别在别处再抄一份（本项目栽过「同一判定抄两份」）。
 */
export const APPLIED_FORM_LABELS: Record<AppliedForm, string> = {
  proposal: '倡议书',
  suggestion: '建议书',
  review: '观后感',
  speech: '演讲稿',
}

/**
 * 落款里的日期。
 *
 * 范文是**示例**，用当天日期最自然（真写应用文本来就要写当天日期）。
 * ⚠️ 调用方传 `now` 进来，别在函数里直接读 `Date.now()` ——
 *    否则测试没法固定这个值。
 */
export function appliedDate(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/* ============================================================
   三、修辞生成器 —— 满分作文的分水岭
   ------------------------------------------------------------
   小学满分作文与「合格作文」最大的差别，就在修辞密度：
     · 比喻 —— 把平淡的东西换成可感的
     · 拟人 —— 给无生命的东西一个动作
     · 通感 —— 把一种感官写成另一种（高年级的加分项）
     · 叠词 —— 低年级最稳妥的拿分点
   这四样主动铺设，范文才有「满分样」。

   ★ 2026-09-19：词库**提到模块级**（原来是函数里的局部数组）。
     为什么要提出来：现在有两处要读它们 ——
       ① 生成（`simile()` 等）；
       ② 判断"这篇到底用上了哪些修辞"（`usedRhetoric`），
          亮点标签照着念。
     ⚠️ 以前亮点是**无条件**写「加了比喻和拟人」的，而写事分支里
        根本没有比喻 —— 家长看到的是假话，也就没法据此判断
        "我在设置里点的要求落实了没有"。所以"生成"和"宣称"
        必须共用同一份词库，不能各写一遍（见 §23）。
   ============================================================ */

/**
 * 比喻的尾巴 —— **不含**开头的「像」，调用方自己加。
 *
 * ⚠️ 早先这里把「像」写在模板里，调用方又写了一个，
 *    生产出「都像像老朋友一样」。
 */
const SIMILE_TAILS = [
  `一整个春天忽然撞进眼睛里`,
  `谁把一盒彩色铅笔倒在了纸上`,
  `老朋友一样，安安静静地等在原地`,
  `一粒小石子丢进心里，荡开一圈一圈的涟漪`,
  `被阳光泡软了似的，连边角都透着暖`,
  `一句没说完的话，轻轻悬在半空`,
  `有人悄悄把灯拧亮了一点`,
]

/** 拟人的尾巴 —— 前面接主语（`${subject}${tail}`） */
const PERSONIFY_TAILS = [
  `好像是醒着的，正悄悄打量着我`,
  `把一整天的光都收在怀里，慢慢匀给我`,
  `不说话，可我觉得它什么都懂`,
  `像在跟我招手，又像在等我先开口`,
]

/** 通感的词库 —— 按感官分池 */
const SYNESTHESIA_BANK: Record<string, string[]> = {
  视觉: [`那颜色浓得像是能尝出甜味来`, `亮得让我忍不住眯起眼睛，心里也跟着亮了一下`],
  听觉: [`那声音干干净净的，像刚洗过一样`, `声音不吵，反倒让周围更安静了`],
  触觉: [`摸上去的一瞬间，一股暖顺着指尖爬到了心口`, `凉丝丝的，像摸到了一小块阴凉`],
  嗅觉: [`那味道贴着鼻子钻进来，一直甜到心里`, `香气淡淡的，却怎么也赶不走`],
  味觉: [`甜味在舌尖上散开，像一朵很小的花`],
}

/**
 * 叠词的词库 —— **分两类，不能混用**：
 *   `ADVERB_BANK` 是状语（慢慢地 / 轻轻地…），能接在动词前
 *   `REDUP_ADJ_BANK` 是定语/谓语（亮晶晶的 / 暖融融的…），不能当状语
 * 早先只有一个池子，导致生成「好看的东西，是要亮晶晶看的」这种病句。
 */
const ADVERB_BANK = ['慢慢地', '轻轻地', '悄悄地', '静静地', '缓缓地']
const REDUP_ADJ_BANK = ['亮晶晶', '暖融融', '沉甸甸', '软绵绵', '湿漉漉', '毛茸茸']

/** 比喻：把抽象/平淡的东西换成一个具体可感的东西 */
function simile(seed: number): string {
  return SIMILE_TAILS[Math.abs(seed) % SIMILE_TAILS.length]
}

/** 拟人：给无生命的东西一个动作或表情 */
function personify(subject: string, seed: number): string {
  return `${subject}${PERSONIFY_TAILS[Math.abs(seed) % PERSONIFY_TAILS.length]}`
}

/** 通感：把一种感官写成另一种，高年级最出彩的写法 */
function synesthesia(sense: string, seed: number): string {
  const list = SYNESTHESIA_BANK[sense] ?? SYNESTHESIA_BANK.视觉
  return list[Math.abs(seed) % list.length]
}

function adverbOf(seed: number): string {
  return ADVERB_BANK[Math.abs(seed) % ADVERB_BANK.length]
}

function redupAdjective(seed: number): string {
  return REDUP_ADJ_BANK[Math.abs(seed) % REDUP_ADJ_BANK.length]
}

/** 四类修辞的名字 —— 亮点标签和"家长要求"都用这套说法 */
export type RhetoricName = '比喻' | '拟人' | '通感' | '叠词'

/**
 * 这篇正文**实际**用上了哪些修辞。
 *
 * 指纹直接从上面那几个词库取 —— 「生成」和「宣称」共用一份声明，
 * 改了词库两边一起改，不会走散。
 *
 * ⚠️ 这个函数存在的唯一理由：亮点标签不许凭空宣称。
 *    以前它无条件写「加了比喻和拟人」，而写事分支里根本没有比喻。
 */
export function usedRhetoric(text: string): RhetoricName[] {
  const out: RhetoricName[] = []
  if (SIMILE_TAILS.some((t) => text.includes(t))) out.push('比喻')
  if (PERSONIFY_TAILS.some((t) => text.includes(t))) out.push('拟人')
  if (Object.values(SYNESTHESIA_BANK).flat().some((t) => text.includes(t))) {
    out.push('通感')
  }
  if (
    REDUP_ADJ_BANK.some((t) => text.includes(t)) ||
    ADVERB_BANK.some((t) => text.includes(t))
  ) {
    out.push('叠词')
  }
  return out
}

/* ============================================================
   三·五、家长设置里的附加提示词 —— 本地引擎也要读
   ------------------------------------------------------------
   家长 2026-09-19 提的：
     「更好的写法，还要结合下 家长设置里的 提示词。类似于点比喻之类的。」

   查下来：`extraPrompt` **只进了 AI 提示词**，本地引擎一个字都没读。
   而设置页上写着「AI 点评和改范文时会参考这些要求」——
   所以家长配了「多用比喻」，一旦 AI 没配好（或调用失败降级到本地），
   这条要求就被**静默丢弃**，界面上还看不出任何异样。

   做法分两半，都要诚实：
     · 引擎**做得到**的（比喻/拟人/通感/叠词）→ 主动补进去；
     · 引擎**做不到**的（排比/对话/成语…）→ **认出来并如实说明**，
       不许装作做到了。家长点了一个要求、我们悄悄不理，
       比明确告诉他"这条得配 AI 才能落实"要坏得多。

   ⚠️ 2026-09-19 第三轮：第一版写完了，**要求还是落不了地**。
   实测（`composeModelEssay` 里那段注释记了全过程）踩出两个坑，
   都是"两个上限只补了一个"：
     · 修辞判定做在**裁剪之前**的候选上 → 判成"已经有了"，
       可那句随后被砍掉，于是既没补、正文里也没有；
     · 句数上限 `keepCap` 加了名额，但画面句不受它约束地排在最前，
       家长那句永远排在画面句后面，一次都进不去。
   ➜ 判定要基于**裁剪之后**的正文；家长点名的句子**不参与裁剪**。
   ============================================================ */

/** 家长点名的修辞要求 */
export interface RhetoricDemand {
  simile: boolean
  personify: boolean
  synesthesia: boolean
  redup: boolean
}

/**
 * 家长文本 → 修辞要求。
 *
 * ⚠️ 这里是**关键词包含**匹配，不是「子串→枚举」那种分类
 *    （见 §21 坑 2 说的「必须查表」）——
 *    区别在于：那边是"这句话属于哪一类"，猜错就语义反转；
 *    这边是"这句话有没有提到 X"，提到就算数，多认一个不会出错。
 *    所以用词表列举，允许宽松。
 */
const DEMAND_WORDS: { key: keyof RhetoricDemand; label: RhetoricName; words: string[] }[] = [
  { key: 'simile', label: '比喻', words: ['比喻', '打比方', '比方'] },
  { key: 'personify', label: '拟人', words: ['拟人'] },
  {
    key: 'synesthesia',
    label: '通感',
    words: ['通感', '五感', '感官', '视觉', '听觉', '嗅觉', '触觉', '味觉'],
  },
  { key: 'redup', label: '叠词', words: ['叠词', '叠字'] },
]

/**
 * 家长点名了、但**本地引擎做不到**的要求。
 *
 * 认出来的目的是如实告诉家长，而不是装作做到了。
 * 本地引擎是模板拼的，排比/对话/成语这些要按内容现写，它做不到。
 */
const UNSUPPORTED_DEMANDS: { label: string; words: string[] }[] = [
  { label: '排比', words: ['排比'] },
  { label: '对话描写', words: ['对话', '人物语言', '语言描写'] },
  { label: '成语', words: ['成语', '四字词'] },
  { label: '首尾呼应', words: ['首尾呼应', '前后照应', '前后呼应'] },
  { label: '细节描写', words: ['细节'] },
]

export function parseExtraPrompt(extra: string | undefined): RhetoricDemand {
  const t = extra ?? ''
  const demand: RhetoricDemand = {
    simile: false,
    personify: false,
    synesthesia: false,
    redup: false,
  }
  if (!t.trim()) return demand
  for (const d of DEMAND_WORDS) {
    if (d.words.some((w) => t.includes(w))) demand[d.key] = true
  }
  return demand
}

/** 家长点名、本地引擎做不到的要求（给界面如实说明用） */
export function unfulfilledDemands(extra: string | undefined): string[] {
  const t = extra ?? ''
  if (!t.trim()) return []
  return UNSUPPORTED_DEMANDS.filter((d) => d.words.some((w) => t.includes(w))).map(
    (d) => d.label,
  )
}

/** 修辞名字 → demand 的字段 */
const DEMAND_OF: Record<RhetoricName, keyof RhetoricDemand> = {
  比喻: 'simile',
  拟人: 'personify',
  通感: 'synesthesia',
  叠词: 'redup',
}

/**
 * 家长点名要、但这篇**还没出现**的修辞 —— 补一句话进去。
 *
 * ⚠️ 每句都要在**任何题材下都读得通**，因为补哪一句是由
 *    「家长说了什么」决定的，跟走哪一支无关 —— 这里拿不到那一层。
 *    所以句子一律锚在「那天」和「我」上，不锚在具体名物上
 *    （锚名物就会在别的题材里出病句）。
 */
function demandSentences(
  demand: RhetoricDemand,
  already: RhetoricName[],
  m: ChildMaterial,
  items: string[],
  rng: () => number,
): string[] {
  const out: string[] = []
  const g = Math.floor(rng() * 97)

  const need = (n: RhetoricName) => demand[DEMAND_OF[n]] && !already.includes(n)

  if (need('比喻')) {
    out.push(`那天的一切，都像${simile(g)}。`)
  }
  if (need('拟人')) {
    // 拟人需要一个「东西」当主语：地点 → 名物 → 退到一个中性的
    const subject = m.place ?? items[0] ?? '窗外的光'
    out.push(`${personify(subject, g + 2)}。`)
  }
  if (need('通感')) {
    const senses = m.senses.length > 0 ? m.senses : ['视觉', '听觉']
    out.push(`${synesthesia(senses[g % senses.length], g + 4)}。`)
  }
  if (need('叠词')) {
    out.push(
      `那天的事，我${adverbOf(g + 6)}记着。到现在想起来，心里还是${redupAdjective(g + 7)}的。`,
    )
  }
  return out
}

/** 「他 / 她」—— 中文口语里对孩子而言统一用「他」会出错，按性别/人物选 */
function pronounFor(person: string | undefined): string {
  if (!person) return '他'
  if (/妈|姐|妹|姑|姨|奶|婆|女/.test(person)) return '她'
  return '他'
}


/* ============================================================
   五、分句构造 —— 每一句都锚在孩子的内容上
   ============================================================ */

interface BuiltSection {
  name: string
  text: string
  lines: SkeletonLine[]
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 简单 hash，让同一篇稿子的范文稳定，不同稿子有变化 */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 把句子拆成骨架行（复用统一的骨架提取） */
function toLine(full: string, extract: (s: string) => { core: string; modifiers: string[] }): SkeletonLine {
  const { core, modifiers } = extract(full)
  return { core, modifiers, full }
}

/* ---- 具体画面句：孩子写到的、图上有的东西，一句一个 ----
 *
 * ⚠️ 这里是「不跑偏」的执行点。写这些句子的时候不要贪漂亮 ——
 * 先把名物**原样点出来**，再补一句反应。孩子读到的第一感觉
 * 应该是「这是我写的东西」，而不是「这句好美但跟我没关系」。
 */

/**
 * 反应句。
 *
 * 刻意**不写「它怎么样」**，只写「我怎么样」——
 * 因为名物是任意的（彩虹 / 落叶 / 老花镜 / 雨），
 * 给任意名词配动词一定会出病句（「雨安安静静地悬着」）。
 * 把动词留给「我」，句子就永远是对的。
 */
const IMAGERY_REACTION = [
  '我看了好久，舍不得挪开眼睛。',
  '就是它，把那天变得和别的日子不一样了。',
  '我忍不住多看了两眼，悄悄把它记了下来。',
  '它在那儿待了没多久，可我一直记得。',
  '我到现在还记得它当时的样子。',
]

/**
 * 分组专属的补充句 —— 只在能确定是哪一类时才加。
 *
 * ⚠️ 写成「接收名物的函数」而不是固定句子，有两个原因：
 *   1. 不用「它」指代 —— 前面刚说过「眼睛」，再用「它」就指不清了；
 *   2. 这句是**拼进同一句里**的，不单独占一个位置。
 *      低年级只留 2 句（keepCap），单独占位就会把真正的名物挤掉
 *      （2026-09-18 真踩过：奶奶的「老花镜」就是这么丢的）。
 *      装饰永远不许挤掉内容。
 *
 * ⚠️ 刻意**没有 sky**：天象那一类里既有「彩虹」也有「雨」，
 * 一句「它就那么悬着」配彩虹是对的、配雨就是病句。
 * 拿不准的类别，宁可只留上面那句反应句。
 */
const IMAGERY_BUCKET_TAIL: Partial<Record<ImageryBucket, (w: string) => string>> = {
  plant: (w) => `风一过，${w}就跟着轻轻晃起来。`,
  animal: (w) => `${w}一点也不怕人，自己忙自己的。`,
  object: (w) => `${w}就安安静静地待在那儿，好像在等我。`,
  water: () => `亮亮的一片，晃得我眼睛都花了。`,
}

export function buildImagerySentences(items: string[], rng: () => number): string[] {
  const out: string[] = []
  // 反应句**不许重复** —— 两件名物撞同一句，正文里就会出现
  // 一模一样的两句（modelEssay.test.ts 有这条断言）
  const used = new Set<number>()

  const pickReaction = (): string => {
    let i = Math.floor(rng() * IMAGERY_REACTION.length)
    for (let guard = 0; used.has(i) && guard < IMAGERY_REACTION.length; guard++) {
      i = (i + 1) % IMAGERY_REACTION.length
    }
    used.add(i)
    return IMAGERY_REACTION[i]
  }

  items.forEach((w, i) => {
    // ⚠️ 每个引入句都必须以「。」收尾 ——
    //    测试靠 `split('。')[1]` 取出反应句来验重，格式变了测试就废了
    const lead = i === 0 ? `我最先注意到的是${w}。` : `还有${w}。`
    const tail = i === 0 ? IMAGERY_BUCKET_TAIL[imageryBucket(w) ?? 'sky'] : undefined
    out.push(lead + pickReaction() + (tail ? tail(w) : ''))
  })

  return out
}

/* ---- 各类文章的开头：点题 + 立画面 ---- */
function buildOpening(
  kind: EssayKind,
  m: ChildMaterial,
  rng: () => number,
  applied?: AppliedShape,
): string {
  const time = m.time ?? '那天'
  const place = m.place
  const person = m.person
  const thing = m.thing
  const event = m.event

  switch (kind) {
    case 'person': {
      const who = person ?? '他'
      const bank = [
        `在我认识的所有人里，${who}是最特别的一个。`,
        `有人喜欢热闹，有人喜欢安静，而${who}身上，两样都有。`,
        `要说${who}，得从${time}说起。`,
      ]
      return bank[Math.floor(rng() * bank.length)]
    }
    case 'scene': {
      const where = place ?? '那个地方'
      const bank = [
        `${time}，我站在${where}，一时说不出话。`,
        `推开门的瞬间，${where}整片扑了过来。`,
        `${where}的样子，我记了很久。`,
      ]
      return bank[Math.floor(rng() * bank.length)]
    }
    case 'object': {
      const what = thing ?? '它'
      const bank = [
        // ⚠️ 不要写「我有一${what}」—— 量词是按名物变的，
        // 模板写死就会生成「我有一小狗」「我有一书包」这种病句。
        // 绕开量词，是最省事也最不会错的做法。
        `${what}不是什么贵重东西，可丢了我会难过很久。`,
        `别人眼里，${what}也许再普通不过；在我眼里不是。`,
        `今天我想好好说说我的${what}。`,
      ]
      return bank[Math.floor(rng() * bank.length)]
    }
    case 'event': {
      const what = event ?? '那件事'
      const bank = [
        `有些事一转身就忘了，可${what}，我到现在都记得清清楚楚。`,
        `${what}发生在${time}。那天的一切，我现在还能一件件说出来。`,
        `要说${event ? `${event}` : '难忘的事'}，我第一个想起的就是${time}。`,
      ]
      return bank[Math.floor(rng() * bank.length)]
    }
    case 'applied': {
      /*
       * 应用文的开头 = 称呼 + 一句点题。
       *
       * ⚠️ 用 `\n` 把称呼和起句分成两行 —— 称呼必须**单独占一行**
       *    才是应用文的格式（挤在同一行就不是应用文了）。
       *    组装处（`composeModelEssay`）会按 `\n` 拆成两条骨架行。
       */
      const shape = applied ?? APPLIED_SHAPES.speech
      const line = `${shape.opener}`
      return shape.salutation ? `${shape.salutation}\n${line}` : line
    }
    default: {
      const bank = [
        `如果真有那么一个地方，我希望它是我闭上眼睛时看到的那个样子。`,
        `那天晚上，我做了个特别奇怪的梦。`,
        `闭上眼睛，我就能去任何地方。你信吗？`,
      ]
      return bank[Math.floor(rng() * bank.length)]
    }
  }
}

/* ---- 中间段：细节 + 感官 + 修辞，这是拿分的主战场 ---- */
/* ---- 中间段：细节 + 感官 + 修辞，这是拿分的主战场 ----
 *
 * ⚠️ 这里按「满配」生成（相当于 5 年级的细节量），再由调用方按
 * 目标字数裁剪。**不要**改成「按年级生成一版、不够再加一版」——
 * 那样每加一次都会重新随机到同一个句式槽位，范文里就会出现
 * 「我最忘不掉的是妈妈的手」印两遍这种重复。
 * 一次生成、一次裁剪，是唯一不会重复的做法。
 */
function buildMiddles(
  kind: EssayKind,
  m: ChildMaterial,
  g: number,
  rng: () => number,
  applied?: AppliedShape,
  /**
   * 正文里必须出现的具体名物（孩子写的排前面、图上补的排后面）。
   * ⚠️ 只有应用文这一支读它 —— 记叙文那几支走 `buildImagerySentences`。
   *    应用文不能写「我最先注意到的是X」那种画面句，但**「结合孩子写的」
   *    这条底线在应用文里同样成立**，所以换一种方式把他写的东西放进去。
   */
  items: string[] = [],
): string[] {
  const out: string[] = []
  const senseList = m.senses.length > 0 ? m.senses : ['视觉', '听觉', '触觉']
  const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)]

  // 每个槽位用**互不相同**的随机下标，避免同一句里两个形容词撞车
  const uniq2 = (arr: string[]): [string, string] => {
    const a = Math.floor(rng() * arr.length)
    let b = Math.floor(rng() * arr.length)
    if (b === a) b = (a + 1) % arr.length
    return [arr[a], arr[b]]
  }

  if (kind === 'person') {
    const who = m.person ?? '他'
    const ta = pronounFor(m.person)
    out.push(`${who}的样子我一直记得：不是多好看，是${pick(['一笑起来，眼睛先弯', '说话时眉毛会轻轻动', '安静的时候像在想很远的事'])}。`)
    out.push(`我最忘不掉的是${who}的手——${pick(['不算大，可什么都做得稳稳的', '关节有点粗，却很暖', '好像随时准备着替谁搭一把'])}。`)
    out.push(`有一次，${eventPhrase(m.event) ?? '我遇到了一件糟心事'}。我以为${who}会说点什么，结果${ta}只是${pick(['笑了笑，说"没事"', '拍拍我的肩，什么也没说', '把手里的事放下，站到我旁边'])}。`)
    out.push(`就是那一下，我心里那块湿漉漉的地方，忽然被晒干了。`)
    out.push(`${who}从来不说什么大道理，可${ta}做的每一件小事，都像${simile(g)}。`)
  } else if (kind === 'scene') {
    const where = m.place ?? '那里'
    const [s1] = uniq2(['铺开去，像是被谁用画笔轻轻涂过', '安安静静地待着，把天都衬得亮了些', '一大片，风一吹就晃成一片海'])
    out.push(`远远望去，${where}${s1}。`)
    out.push(`走近了才看清，每一处都不一样：有的高些，有的矮些，风一过，就一起${pick(['晃起来', '摇着头', '往下弯一弯腰'])}。`)
    out.push(`我伸手碰了一下，${synesthesia(pick(senseList), g)}。`)
    out.push(`${personify(where, g)}，我连呼吸都放轻了。`)
    out.push(`${where}把这一整个下午都收在了怀里，${adverbOf(g)}，我舍不得走开。`)
    out.push(`那一刻我忽然懂了：好看的东西，是要${adverbOf(g + 3)}看的，急着走开就什么也看不见了。`)
  } else if (kind === 'object') {
    const what = m.thing ?? '它'
    const [a1, a2] = uniq2(['很朴素', '小小的一个', '并不起眼'])
    out.push(`${what}长得${a1}，${pick(['可摸上去很实在', '颜色已经旧了些', '边角都磨圆了'])}。`)
    out.push(`我最喜欢的是它${pick(['安静陪着我的样子', '身上那点小小的记号', '每次都在原地等我的样子'])}——像${simile(g)}。`)
    out.push(`还记得${m.time ?? '那天'}，它差点就不见了。我找遍了每个角落，越找越慌，眼睛都酸了。`)
    out.push(`等它重新回到我手里，我才发现，原来有些东西，失去了才知道有多要紧。`)
    out.push(`现在它还是老样子，${redupAdjective(g)}地待在那儿。可我知道，我们俩之间，多了点别的东西。`)
    out.push(`它虽然${a2}，却陪着我过了一个又一个普通的日子。`)
  } else if (kind === 'event') {
    const what = eventPhrase(m.event) ?? '那件事'
    out.push(`一开始我还没反应过来。${pick([`${what}来得太突然`, `一切发生得太快`, `我只觉得心跳得厉害`])}。`)
    out.push(`接着，事情往前走，我的手心里全是汗。周围有那么多声音，我却只听见自己的心跳。`)
    out.push(`就在那时候，${pick(['有人拉了我一把', '我想起了谁说过的一句话', '我忽然就不慌了'])}。`)
    out.push(`我咬着牙往前走了一步。一步而已，可那一步迈出去，天好像就宽了。`)
    // ⚠️ 不能写「落在{地点}上」—— 地点缺失时会生成「落在前面上」这种病句
    out.push(m.place
      ? `阳光正好落在${m.place}上，亮亮的一小块，我盯着它看了很久。`
      : `阳光落在我手背上，亮亮的一小块，我盯着它看了很久。`)
    out.push(`最后我把这件事做完了。没有多漂亮，可我一点也不后悔——因为我试过了。`)
  } else if (kind === 'applied') {
    /*
     * ★★ 应用文这一支**不写感官、不写景物**。
     *
     *   记叙文的正文靠「观察 + 名物 + 修辞」，而应用文根本没有画面可观察 ——
     *   这就是为什么五维里的「观察力」对应用文是错指标（见 `focusFor`）。
     *   硬把 `synesthesia` / `personify` 塞进来，出来的就不是应用文了。
     *
     *   这一支只写两件事：**为什么提这件事**、**具体怎么做**。
     */
    const shape = applied ?? APPLIED_SHAPES.speech
    const topic = shape.topic

    /*
     * ⚠️ 句子顺序是**刻意**的：裁剪是从尾部拿掉的（低年级只留 4 句），
     *    所以「缘由 / 分点 / 孩子的具体东西」必须排在前面 ——
     *    这三样是应用文的主干。实测把它们排在后面时，
     *    四年级只留下 4 句，**孩子的具体东西整句被裁掉**，
     *    范文就变成一篇跟孩子无关的套话。
     */
    if (shape.form === 'review') {
      out.push('我看得很认真，有几处甚至屏住了呼吸。')
      if (items.length > 0) {
        out.push(`让我印象最深的，是${items.slice(0, 2).join('、')}。`)
      }
      out.push('看完以后，有个问题一直在我脑子里转：如果换成我，我会怎么做？')
      out.push(
        pick([
          '我想了很久，越想越觉得，有些事情看起来离我们很远，其实就在身边。',
          '我原本以为这只是一场热闹，可它留下来的东西比热闹多得多。',
        ]),
      )
      out.push('我不确定自己有没有看懂它全部的意思，但我知道，它在我心里留下了一点东西。')
    } else {
      out.push(
        topic
          ? `${topic}这件事，我放在心里很久了。`
          : pick([
              '这件事我放在心里很久了，越想越觉得该说出来。',
              '我留意这件事很久了，越想越觉得该说点什么。',
            ]),
      )
      if (shape.form === 'suggestion') {
        out.push(
          '我想到两点，都不太难做到：第一，把这件事定成一条大家都知道的规矩，贴在教室里；' +
            '第二，每隔一段时间请老师带我们看一看，做得好的同学说一说。',
        )
      } else {
        out.push(
          '我想提三点，都是我们马上就能做到的：第一，先管好自己那一份，从自己做起；' +
            '第二，看到身边的人没做到，轻轻提醒一句，别笑话他；' +
            '第三，把这件事坚持下去，不是今天做了、明天就忘。',
        )
      }
      // ★ 「结合孩子写的东西」这条底线在应用文里也成立 —— 排在前面，
      //   保证它活过裁剪，而不是只写在套话里。
      if (items.length > 0) {
        out.push(`就拿${items.slice(0, 2).join('、')}来说，其实只要稍微留心，就能做得更好。`)
      }
      out.push(
        pick([
          '有人可能觉得，这不过是小事，做不做都一样。可我越想越觉得不是这样。',
          '也许有人会想：一个人做不做，能有多大关系？我不同意。',
        ]),
      )
      out.push(pick(['这些事都不难，难的是天天都做到。', '说起来简单，做起来也不难，难的是不半途而废。']))
      if (shape.form === 'speech') {
        out.push('我今天站在这里说这些，不是想教育谁，只是想邀请你一起试试。')
      } else if (shape.form === 'suggestion') {
        out.push('这些想法不一定都对，如果哪里不合适，请您指出来。')
      } else {
        out.push('也许有人会问：就我们几个人做，能改变什么？我想，改变不在今天，在很久以后。')
      }
    }
  } else {
    out.push(`在那里，一切都和这里不一样：${pick(['房子是软的，路是甜的', '树会走路，云会说话', '白天有星星，晚上出太阳'])}。`)
    out.push(`我试着往前走，脚下的路${pick(['软软地起伏着', '像绸带一样铺开去', '藏着说不清的凉意'])}，像${simile(g + 1)}。`)
    out.push(`最神奇的是，我在那里遇见了一个会说话的东西。它看着我说：「这里的规矩，是你自己定的。」`)
    out.push(`我想了很久这句话，想得心里又亮又软。`)
  }

  return out
}

/* ---- 结尾：落到自己的感受上，这是满分作文的收口 ---- */
function buildEnding(
  kind: EssayKind,
  m: ChildMaterial,
  rng: () => number,
  applied?: AppliedShape,
  now?: number,
): string {
  const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)]

  /*
   * ★★ 应用文**必须**走在这条「继承孩子结尾」的判断**之前**。
   *
   *   下面那条是为了「如果孩子自己写了有感情的结尾，优先继承他的落点」——
   *   对记叙文是对的。可应用文的结尾是**格式**（号召 + 落款 + 日期），
   *   继承了孩子那句抒情，落款就丢了 —— 而落款正是应用文最要命的分。
   */
  if (kind === 'applied') {
    const shape = applied ?? APPLIED_SHAPES.speech
    const lines = [shape.call]
    if (shape.signature) {
      // ⚠️ 落款和日期各占一行 —— 挤在一行就不是应用文格式了
      lines.push(shape.signature)
      lines.push(appliedDate(now ?? Date.now()))
    }
    return lines.join('\n')
  }

  // 如果孩子自己写了有感情的结尾，优先继承他的落点
  if (m.lastSentence && m.lastSentence.length >= 8 && /我|心|明白|懂|记得|温暖|难忘|幸福/.test(m.lastSentence)) {
    const base = m.lastSentence.replace(/[。！？]+$/, '')
    const bank = [
      `${base}。这句话，我以后还会一遍遍想起来。`,
      `${base}。原来最动人的东西，说出口反而很轻。`,
    ]
    return pick(bank)
  }

  switch (kind) {
    case 'person': {
      const who = m.person ?? '他'
      const ta = pronounFor(m.person)
      return pick([
        `我想，我以后大概也想成为${who}那样的人——不用多厉害，但要对得起自己做的事。`,
        `现在每次想起${who}，我心里都${pick(['暖暖的', '软软的', '踏实了些'])}。`,
        `原来一个人好不好，不在${ta}说了什么样的话，而在${ta}做了什么。`,
      ])
    }
    case 'scene': {
      const where = m.place ?? '那里'
      return pick([
        `我就那样站了很久。${where}的样子，我会一直记得。`,
        `回去的路上，我总觉得心里也亮堂堂的。`,
        `原来有些好看的东西，是要慢慢看，才看得出来的。`,
      ])
    }
    case 'object': {
      return pick([
        `东西会旧，可有些感情不会。`,
        `这就是我的${m.thing ?? '它'}。它很普通，可我很喜欢它。`,
        `它陪了我很久。我想，等我长大了，应该还会记得它。`,
      ])
    }
    case 'event': {
      return pick([
        `这件事让我明白：${pick(['害怕的时候往前走一步，其实就没那么可怕', '有些事不去试，永远不知道自己行不行', '最难的从来不是做，是迈出去的第一步'])}。`,
        `现在回想起来，我还会忍不住笑。那天的我，真勇敢。`,
        `有些事只发生一次，可它会跟着你走很远很远。`,
      ])
    }
    default:
      return pick([
        `醒来的时候，枕头边好像还留着一点梦的味道。`,
        `虽然只是个想象，可我想，只要一直想，说不定哪天它就成真了。`,
        `如果有机会，我真想再去那里待一会儿。`,
      ])
  }
}

/* ============================================================
   六、组装
   ============================================================ */

export interface ComposeModelEssayInput {
  childText: string
  title: string
  category: string
  /**
   * ★★ 题目自带的格式要求（2026-09-30 加的）。
   *
   * 为什么必须传进来：`category` 那一层**只装记叙文**
   * （写人/写景/写事/状物/想象），应用文在题库里的 category 是 `event`。
   * 不传 genre，应用文就会走写事模板。
   * 缺省 = 记叙文（`resolveGenre`）→ 老调用方行为逐字节不变。
   */
  genre?: CompositionGenre
  grade: number
  targetLen: number
  /**
   * ★ 配图的文字描述（`imageWords(images)`）。
   *
   * 以前这个字段**不存在** —— 调用方拿到了 images 却没地方传，
   * 所以「看图作文」的改写跟图毫无关系。见文件头第 1 条真因。
   */
  imageHints?: string[]
  /**
   * ★ 家长在设置里写的附加提示词（`AiConfig.extraPrompt`）。
   *
   * 以前本地引擎**完全不读**它 —— 家长配了「多用比喻」，
   * 一旦 AI 没配好或调用失败降级到本地，这条要求就被静默丢弃。
   * 见「三·五」那一节。
   */
  extraPrompt?: string
  extract: (s: string) => { core: string; modifiers: string[] }
}

/**
 * 亮点标签。
 *
 * ★ 2026-09-19：修辞那两条改成**照实际产出说**。
 *
 *   以前这里是无条件写死的：
 *     out.push('加了比喻和拟人，让句子活起来')
 *     if (kind === 'scene' || kind === 'object') out.push('用通感…')
 *
 *   而写事分支里根本没有比喻，状物分支也没有通感 —— 那是假话。
 *   更要命的是：家长在设置里点了「多用比喻」，想知道的正是
 *   「有没有落实」，而这条假话让他**永远看不出没落实**。
 */
/**
 * 应用文的亮点。
 *
 * ★ 应用文跟记叙文的分水岭是**格式**，不是「画面立不立得住」，
 *   所以亮点第一条必须说格式 —— 家长看的正是"有没有教对"。
 * ⚠️ 只报**真的有**的那几样：观后感既没有称呼也没有落款，
 *    不能夸它「格式对了」（那就是 §23 那种假话）。
 */
function appliedHighlight(shape: AppliedShape): string {
  if (shape.salutation && shape.signature) {
    return '开头有称呼、结尾有落款，应用文的格式对了'
  }
  if (shape.salutation) return '开头有称呼，讲话的格式对了'
  return '写的是自己的感受和想法，没有编情节'
}

function buildHighlights(
  m: ChildMaterial,
  items: string[],
  used: RhetoricName[],
  demanded: RhetoricName[],
  /**
   * ★ 传进来 = 这是**应用文**。
   *   下面三条「记叙文专属」的夸法要关掉 —— 它的开头是称呼不是场景、
   *   结尾是号召和落款不是抒情、正文没有画面，照记叙文夸就是假话
   *   （§23：宣称必须照实际产出说）。
   */
  applied?: AppliedShape,
): string[] {
  const out: string[] = []
  const off = Boolean(applied)

  // 只夸孩子真的做到了的，没做到的不硬夸
  if (m.goodWords.length > 0) {
    out.push(`用上了「${m.goodWords.slice(0, 3).join('、')}」这样的好词`)
  }
  if (!off && m.senses.length > 0) {
    out.push(`调动了${m.senses.join('、')}，画面立得住`)
  }
  // ★ 这一条是「不跑偏」的证明：把正文里真的写到的名物报出来，
  //   家长一眼就能看出「改写有没有用上孩子的东西」。
  if (items.length > 0) {
    out.push(`抓住了「${items.join('、')}」这些具体的东西，不是空写`)
  }
  if (!off && m.firstSentence) {
    out.push('开头直接进入场景，没有绕圈子')
  }
  if (!off && m.lastSentence && /我|心|明白|懂|记得/.test(m.lastSentence)) {
    out.push('结尾落回了自己的感受上')
  }

  // 修辞：只报正文里**真的**出现的（`usedRhetoric` 从同一份词库判定）
  if (used.length > 0) {
    out.push(`加了${used.join('、')}，句子活起来了`)
  }
  // 家长点名要的那几样，单独回一句 —— 这是他要的「落实没落实」
  if (demanded.length > 0) {
    const done = demanded.filter((d) => used.includes(d))
    if (done.length > 0) {
      out.push(`家长点名的${done.join('、')}，都加进去了`)
    }
  }
  if (applied) {
    // 放在最前面 —— **格式对不对**是应用文的第一判据
    out.unshift(appliedHighlight(applied))
  } else {
    out.push('分了段，读起来一清二楚')
  }

  return out.slice(0, 6)
}

/**
 * 生成满分范文（本地引擎 v2）。
 *
 * 与旧版最大的区别：**孩子的素材进正文，不再只进 4 个好词。**
 */
export function composeModelEssay(inp: ComposeModelEssayInput): ModelEssay {
  const m = extractChildMaterial(inp.childText, inp.title)
  // ★ 只取一次时间：范文的 `at` 和落款里的日期必须是同一个时刻
  const now = Date.now()
  // ★ 应用文要先知道是哪一种（倡议书 / 建议书 / 观后感 / 演讲稿），
  //   称呼、正文、落款三处都照着它写 —— 所以只算一次，往下传。
  //   ⚠️ 必须**展开成新对象**再加 topic：`APPLIED_SHAPES` 是共享的静态表，
  //      直接往上写 `topic` 会污染后面所有同形态的题（而且不报错）。
  const applied: AppliedShape = {
    ...appliedShapeOf(inp.title),
    topic: appliedTopicOf(inp.title),
  }
  // ★ pictureFirst：有配图 → 这是「看图作文」，走哪一支该由图和画面定
  //   （见 resolveKind 的注释，2026-09-19 家长报的第二次「跑偏」）
  const kind = resolveKind(inp.category, m, {
    pictureFirst: (inp.imageHints ?? []).length > 0,
    genre: inp.genre,
  })

  /*
   * ★ 「结合图」最直接的一处：孩子没写地点/时间时，从**图**里取。
   *
   * 孩子写「我和小明在雪地里打雪仗」，没写在哪 —— 而图注写着
   * 「雪后的校园」。写景分支的开头需要「地点」，缺了就变成
   * 「我站在那里，一时说不出话」这种空话。
   *
   * ⚠️ 只**补空**，不覆盖 —— 孩子自己写了地点就一定用他的。
   *    也**只取 place / time 这两个角色位**，不碰 concrete：
   *    名物走的是另一条路（fromImage），两边混在一起会重复。
   */
  const imageText = (inp.imageHints ?? []).join('。')
  if (imageText) {
    if (!m.place) m.place = firstMatch(imageText, PLACE_PATTERNS)
    if (!m.time) m.time = firstMatch(imageText, TIME_PATTERNS)
  }
  const rng = makeRng(hash(`${inp.title}|${inp.childText}|${inp.category}`))

  /* ★ 正文里必须出现的「具体名物」。
   *
   * 顺序是刻意的：**孩子自己写的排前面，图上才有的补在后面**。
   * 后面按字数裁剪时是从尾部拿掉的，所以先丢的是图里的，
   * 不会把孩子的细节丢掉。
   *
   * 名额分配：孩子的占前 2 个，剩下的留给图 —— 这是「既要结合原文、
   * 又要结合图片」的落点。如果孩子自己就写了 3 件东西，
   * 那只留 2 件，也要给图留一个位置。
   */
  const already = new Set(
    [m.person, m.place, m.thing, m.event].filter(Boolean) as string[],
  )
  const fromChild = m.concrete.filter((w) => !already.has(w)).slice(0, 2)
  const fromImage = (inp.imageHints ?? [])
    .flatMap((h) => extractConcrete(h, 6, true))
    .filter((w) => !already.has(w) && !fromChild.includes(w))
  const items = [...fromChild, ...fromImage].slice(0, 3)

  const opening = buildOpening(kind, m, rng, applied)
  const ending = buildEnding(kind, m, rng, applied, now)

  // 中间段：一次生成「满配」版，再按目标字数**从头裁剪**。
  // ⚠️ 不要改成「不够就再生成一轮补进去」—— buildMiddles 每轮都会
  // 重新随机到同样的句式槽位，补进去就会和已有句子重复。
  // 句子按「越靠后越抒情」排序，所以裁剪是从尾部拿掉。
  //
  // ★ 具体画面句排在最前面，就是为了在裁剪里活下来：
  //   低年级只留 2 句（keepCap），如果画面句排在后面就被砍光了，
  //   孩子看到的又会是那段「跟我不相关」的空写。
  //
  // ⚠️ 写人是个例外：第一句必须是「这个人」，不能是「这个人的东西」。
  //    「我最先注意到的是摇椅」放在写奶奶的稿子里，读起来就不是写人了。
  //
  // ★★ 应用文**不要画面句**：
  //    `buildImagerySentences` 产的是「我最先注意到的是X」这类记叙文句子，
  //    放进倡议书里就不是应用文了。
  //    它改用 `items` 参数把孩子的名物织进正文（见 `buildMiddles`）。
  const imagery = kind === 'applied' ? [] : buildImagerySentences(items, rng)
  const generic = buildMiddles(kind, m, inp.grade, rng, applied, items)

  /*
   * ★ 家长点名的修辞（见「三·五」那一节）。
   *
   * 优先级从高到低，`base` 的排序就是它：
   *   ① 写人时第一句必须是这个人（已有约束）；
   *   ② 具体画面句 —— 「不跑偏」的硬标准，必须活过裁剪；
   *   ③ **家长点名的修辞** —— 他明确要求的，优先于通用套话；
   *   ④ 通用套话。
   *
   * ⚠️⚠️ 2026-09-19 第三轮：这段以前是错的，错在**两个上限只补了一个**。
   *
   *   旧写法：先算 `alreadyRhetoric = usedRhetoric([...imagery, ...generic])`，
   *   再 `all = [...imagery, ...demanded, ...generic]`，再按 keepCap 从头裁。
   *   实测两处漏（当时用临时探针把真实产物打出来看的，探针已删）：
   *
   *   漏一（判早了）：写景分支的 generic 里**本来就有**通感和拟人句
   *     （`我伸手碰了一下…` / `…，我连呼吸都放轻了`）。
   *     于是 `alreadyRhetoric` 说「已经有了」，不补；
   *     可这两句排在 generic 靠后，**被裁剪砍掉了** ——
   *     最后正文里既没有通感、也没补，家长的要求两头落空。
   *     ➜ 修辞判定必须做在**真的留下来的那几句**上（`base`），
   *        不是做在全量候选上。同一件事声明两遍，就又走散了。
   *
   *   漏二（名额不够）：`keepCap` 加了 `+ demanded.length`，但画面句
   *     **不受 keepCap 约束地排在最前**（一年级：keepCap=3，画面句正好 3 句），
   *     家长那句永远排在画面句后面 → 一次都进不去。
   *     ➜ 家长点名的句子**不参与裁剪**，直接插在画面句之后。
   *
   *   为什么它值得单独占名额：家长在设置里写了「多点比喻」，
   *   界面上就该看得见比喻。被通用套话挤掉 = 没落实，而且看不出来。
   */
  const demand = parseExtraPrompt(inp.extraPrompt)
  const demandedNames = (Object.keys(DEMAND_OF) as RhetoricName[]).filter(
    (n) => demand[DEMAND_OF[n]],
  )

  // 写人时「这个人」必须是第一句，所以它先占一个头名
  const personHead = kind === 'person' && generic.length > 0 ? [generic[0]] : []
  const genericRest = kind === 'person' ? generic.slice(1) : generic
  const baseCandidates = [...personHead, ...imagery, ...genericRest]

  // 低年级只留最容易的几句：1-2 年级留 2 句，3-4 年级留 4 句，5-6 年级全上。
  // 这一条不能省 —— 否则一、六年级的范文长度几乎一样，低年级孩子读不动。
  const baseCap =
    inp.grade <= 2 ? 2 : inp.grade <= 4 ? 4 : Number.POSITIVE_INFINITY

  const head = countWords(opening) + countWords(ending)
  const budget = Math.max(
    inp.targetLen * 0.6,
    countWords([opening, ...baseCandidates, ending].join('')) * 0.55,
  )
  const base: string[] = []
  let used = head
  for (const s of baseCandidates) {
    if (base.length >= baseCap) break
    const w = countWords(s)
    // 留够余量：正文总长不超过 budget，且至少保留 2 句
    if (used + w <= budget || base.length < 2) {
      base.push(s)
      used += w
    }
  }

  // ★ 判定用 `base`（裁剪之后），不是 `baseCandidates`（裁剪之前）
  const alreadyRhetoric = usedRhetoric(base.join(''))
  const demanded = demandSentences(demand, alreadyRhetoric, m, items, rng)

  // 插在「画面句」之后、通用套话之前 —— 画面句是连续的，扫一段就知道插哪儿
  const personHeadCount = personHead.length
  let imageryKept = 0
  for (let i = personHeadCount; i < base.length; i++) {
    if (!imagery.includes(base[i])) break
    imageryKept += 1
  }
  const insertAt = personHeadCount + imageryKept
  const middles = [...base.slice(0, insertAt), ...demanded, ...base.slice(insertAt)]

  /*
   * ★★ 开头和结尾都可能是**多行**的 —— 只有应用文会这样：
   *    开头是「称呼 \n 起句」，结尾是「号召 \n 落款 \n 日期」。
   *    应用文的格式分就压在这些**换行**上（称呼必须独占一行），
   *    所以这里按 `\n` 拆成多条骨架行，别把三行挤成一行。
   *    ⚠️ 记叙文那几支的 opening/ending 里没有 `\n`，
   *       拆出来仍然是一条 —— 行为逐字节不变。
   */
  const sectionLines = (s: string) =>
    s.split('\n').filter((x) => x.trim().length > 0)

  const sections: BuiltSection[] = [
    {
      name: '开头',
      text: opening,
      lines: sectionLines(opening).map((t) => toLine(t, inp.extract)),
    },
    {
      name: '中间',
      text: middles.join(''),
      lines: middles.map((t) => toLine(t, inp.extract)),
    },
    {
      name: '结尾',
      text: ending,
      lines: sectionLines(ending).map((t) => toLine(t, inp.extract)),
    },
  ]

  const text = sections.map((s) => s.text).join('\n\n')
  const skeletonLines = sections.flatMap((s) => s.lines)

  /*
   * 亮点照**最终正文**说（不是照"我们打算加什么"说）——
   * 裁剪可能把某句拿掉，那样它就没真的出现。
   */
  const finalUsed = usedRhetoric(text)

  /*
   * ★★ 应用文：`items` 那句话可能被字数裁剪砍掉（它排在正文靠后），
   *    所以只报**真的出现在正文里**的那些 —— 「宣称」必须照实际产出说（§23）。
   *    ⚠️ 只对应用文这么做：记叙文那边 `items` 走的是画面句、排在最前、
   *       裁剪不会动它，改了反而会让老测试的行为变。
   */
  const reportedItems =
    kind === 'applied' ? items.filter((w) => text.includes(w)) : items

  return {
    at: now,
    text,
    highlights: buildHighlights(
      m,
      reportedItems,
      finalUsed,
      demandedNames,
      kind === 'applied' ? applied : undefined,
    ),
    skeleton: skeletonLines.map((l) => l.core).join(' '),
    skeletonLines,
    engine: 'local',
  }
}

/** 供外部检查：这篇范文到底用上了孩子哪些素材 */
export function explainMaterial(childText: string, title: string): ChildMaterial {
  return extractChildMaterial(childText, title)
}
