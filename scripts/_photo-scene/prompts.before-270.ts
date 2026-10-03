/* ============================================================
   标签体系与出题模板
   ============================================================

   重要：本文件**不再包含固定题库**。

   按需求，作文题的来源顺序是：
     1. AI 现场生成（默认）
     2. 从「我的作文题库」里搜索 / 随机抽（题库一开始是空的）
     3. 生成出来的题目自动存进题库，以后可复用、可导出

   所以这里只负责两件事：
     · 标签体系（年级 → 大类 → 细分标签）
     · 本地出题模板（没配 API 时，本地引擎靠它生成题目）
   ============================================================ */

import type {
  CompositionCategory,
  CompositionPrompt,
  GradeLevel,
  ScoreDimension,
  TopicTag,
} from './types'

/* ---------------- 细分标签 ---------------- */

export const TOPIC_TAGS: TopicTag[] = [
  /* ---- 写景 ---- */
  { id: 'season', category: 'scene', label: '四季', emoji: '🍂', minGrade: 1, hint: '春夏秋冬的变化' },
  { id: 'weather', category: 'scene', label: '天气', emoji: '🌦️', minGrade: 1, hint: '雨雪风霜、云和雾' },
  { id: 'water', category: 'scene', label: '山水', emoji: '🏔️', minGrade: 2, hint: '江河湖海、高山流水' },
  { id: 'campus', category: 'scene', label: '校园一角', emoji: '🏫', minGrade: 1, hint: '操场、教室、小花园' },
  { id: 'night', category: 'scene', label: '夜晚星空', emoji: '🌙', minGrade: 2, hint: '月亮、星星、萤火虫' },
  { id: 'home-scene', category: 'scene', label: '家里的角落', emoji: '🪟', minGrade: 1, hint: '窗台、厨房、阳台' },
  { id: 'travel', category: 'scene', label: '游记参观', emoji: '🏛️', minGrade: 3, hint: '游览名胜古迹、博物馆' },
  { id: 'culture', category: 'scene', label: '文化遗产', emoji: '🏯', minGrade: 4, hint: '长城、故宫、世界遗产' },
  { id: 'hometown', category: 'scene', label: '家乡景色', emoji: '🏡', minGrade: 2, hint: '家乡的山水、田野、小路' },

  /* ---- 写人 ---- */
  { id: 'family', category: 'person', label: '我的家人', emoji: '👨‍👩‍👧', minGrade: 1, hint: '爸爸妈妈爷爷奶奶' },
  { id: 'teacher', category: 'person', label: '老师', emoji: '👩‍🏫', minGrade: 1, hint: '班主任、任课老师' },
  { id: 'classmate', category: 'person', label: '同学朋友', emoji: '🧑‍🤝‍🧑', minGrade: 1, hint: '同桌、好朋友' },
  { id: 'stranger', category: 'person', label: '陌生人', emoji: '🚶', minGrade: 3, hint: '环卫工、快递员、售票员' },
  { id: 'community-helper', category: 'person', label: '社区里的人', emoji: '🧑‍⚕️', minGrade: 2, hint: '医生、警察、司机、图书管理员' },
  { id: 'self', category: 'person', label: '我自己', emoji: '🪞', minGrade: 2, hint: '自画像、我的特点' },
  { id: 'people-around', category: 'person', label: '形形色色的人', emoji: '👥', minGrade: 4, hint: '身边各种各样的人' },
  { id: 'dream-job', category: 'person', label: '我的理想', emoji: '🌟', minGrade: 3, hint: '长大后想做什么、想成为谁' },

  /* ---- 写事 ---- */
  { id: 'first-time', category: 'event', label: '第一次', emoji: '🎬', minGrade: 1, hint: '第一次做某件事' },
  { id: 'unforgettable', category: 'event', label: '难忘的事', emoji: '💭', minGrade: 2, hint: '印象最深的一件事' },
  { id: 'warm-moment', category: 'event', label: '温暖瞬间', emoji: '🤝', minGrade: 2, hint: '帮助别人或被帮助' },
  { id: 'activity', category: 'event', label: '一次活动', emoji: '🎪', minGrade: 1, hint: '运动会、春游、演出' },
  { id: 'mistake', category: 'event', label: '犯错与成长', emoji: '🩹', minGrade: 3, hint: '做错事、吸取教训' },
  { id: 'lost-found', category: 'event', label: '意外时刻', emoji: '😮', minGrade: 3, hint: '走丢、摔跤、突发状况' },
  { id: 'milestone', category: 'event', label: '成长瞬间', emoji: '🎂', minGrade: 2, hint: '生日、毕业、搬新家、第一次独睡' },
  { id: 'observe', category: 'event', label: '观察记录', emoji: '🔍', minGrade: 2, hint: '观察日记、小实验、连续观察' },
  { id: 'letter', category: 'event', label: '书信与读后感', emoji: '✉️', minGrade: 3, hint: '写信、读后感、我想对您说' },
  { id: 'look-picture', category: 'event', label: '看图作文', emoji: '🖼️', minGrade: 2, hint: '单图写话、连环图编故事' },
  { id: 'custom', category: 'event', label: '节日风俗', emoji: '🧧', minGrade: 2, hint: '传统节日、家乡风俗' },
  { id: 'comic', category: 'event', label: '漫画的启示', emoji: '🖍️', minGrade: 4, hint: '看一幅漫画，说出它给你的想法' },

  /* ---- 状物 ---- */
  { id: 'pet', category: 'object', label: '小动物', emoji: '🐈', minGrade: 1, hint: '猫狗兔子小鸟' },
  { id: 'plant', category: 'object', label: '花草植物', emoji: '🌻', minGrade: 1, hint: '一盆花、一棵树' },
  { id: 'stationery', category: 'object', label: '学习用品', emoji: '✏️', minGrade: 1, hint: '书包、笔袋、橡皮' },
  { id: 'treasure', category: 'object', label: '心爱之物', emoji: '💎', minGrade: 2, hint: '有故事的物件' },
  { id: 'food', category: 'object', label: '美食', emoji: '🥟', minGrade: 2, hint: '一道好菜、家乡味' },

  /* ---- 想象 ---- */
  { id: 'if-i', category: 'imagine', label: '假如我……', emoji: '🦋', minGrade: 2, hint: '假如我会飞、假如我是风' },
  { id: 'future', category: 'imagine', label: '未来世界', emoji: '🛸', minGrade: 3, hint: '未来的学校、城市、家' },
  { id: 'fairy', category: 'imagine', label: '童话续写', emoji: '🧚', minGrade: 2, hint: '改编经典童话' },
  { id: 'talking', category: 'imagine', label: '会说话的它', emoji: '💬', minGrade: 1, hint: '如果物品会说话' },
  { id: 'dream', category: 'imagine', label: '我的梦', emoji: '💤', minGrade: 2, hint: '一场奇妙的梦' },
  { id: 'sci-fi', category: 'imagine', label: '科幻世界', emoji: '🚀', minGrade: 4, hint: '太空旅行、机器人、未来科技' },
  { id: 'deform', category: 'imagine', label: '变形与历险', emoji: '🐜', minGrade: 4, hint: '假如我变小了、变形记、探险' },
]

export function tagsFor(category: CompositionCategory, grade: GradeLevel): TopicTag[] {
  return TOPIC_TAGS.filter((t) => t.category === category && t.minGrade <= grade)
}

export function tagById(id: string): TopicTag | undefined {
  return TOPIC_TAGS.find((t) => t.id === id)
}

/**
 * 标签在界面上的显示名 —— **永远显示中文，不要显示 id**。
 *
 * 为什么单独拎出来：id 是英文的（`weather`），以前界面上直接把 id 打出来，
 * 孩子看到的是「🌧️ weather」。家长看题库数据时也一样，一眼不知道是什么。
 * 认不出的标签（家长自定义的）原样返回，总比显示空白强。
 */
export function tagLabel(id: string): string {
  return tagById(id)?.label ?? id
}

/**
 * 把「家长/题库数据里写的标签」解析成规范 id。
 *
 * 为什么需要它：id 是英文的，但**家长手写题库数据时自然会写中文**
 * （`"tagId": "天气"`）。如果只按 id 精确匹配，写中文会**静默匹配不上** ——
 * 标签筛不到题、界面上也不出 emoji，而且不报错，很难查。
 *
 * 规则：先按 id 认 → 再按中文 label 认 → 都认不出就原样保留
 * （那是家长自己的标签，不该被我们改写）。
 */
export function resolveTagId(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  if (tagById(t)) return t
  return TOPIC_TAGS.find((x) => x.label === t)?.id ?? t
}

/* ============================================================
   出题模板库
   ============================================================

   每个标签下准备多套「题目 + 引导语」模板，
   本地引擎随机取一套，保证同一个标签也能出不同的题。
   ============================================================ */

export interface PromptTemplate {
  title: string
  lead: string
  /** 配套插画（1 张单图，多张为连环图） */
  scenes: string[]
}

export const PROMPT_TEMPLATES: Record<string, PromptTemplate[]> = {
  /* ---- 写景 ---- */
  season: [
    { title: '春天的公园', lead: '春天来了，公园里全变了样。你看到了什么？', scenes: ['spring-park'] },
    { title: '秋天的落叶', lead: '一阵风吹过，树叶飘下来了。它们像什么呢？', scenes: ['autumn-leaves'] },
    {
      title: '冬天的第一场雪',
      lead: '早上推开窗，外面全白了……',
      scenes: ['winter-window', 'snow-play', 'snowman'],
    },
    { title: '夏天的小院', lead: '太阳火辣辣的，知了在树上叫个不停。', scenes: ['grandpa-garden'] },
    { title: '夏日的荷塘', lead: '荷叶圆圆的，荷花粉粉的，蜻蜓飞来飞去。', scenes: ['summer-pond'] },
    { title: '金色的秋天', lead: '麦田一望无边，像铺了一地金子。', scenes: ['wheat-field'] },
    { title: '校园的秋天', lead: '银杏叶黄了，一片一片落下来。', scenes: ['school-autumn'] },
  ],
  weather: [
    { title: '下雨了', lead: '雨点打在窗户上，发出什么声音？', scenes: ['rain-window'] },
    { title: '雨后的彩虹', lead: '雨停了，天边出现了一道彩虹……', scenes: ['rainbow', 'rain-window'] },
    { title: '大雾的早晨', lead: '出门的时候，前面的路都看不清了。', scenes: ['fog-morning'] },
    { title: '下雨天，妈妈来了', lead: '雨越下越大，校门口出现了一个熟悉的身影。', scenes: ['umbrella-rain'] },
    { title: '日落时分', lead: '太阳慢慢沉下去，天边烧成了一片橙红色。', scenes: ['sunset'] },
  ],
  water: [
    { title: '家乡的小河', lead: '那条河从村子旁边流过，你还记得它什么样子吗？', scenes: ['river-village'] },
    { title: '爬山看日出', lead: '天还没亮就出发了，等爬到山顶……', scenes: ['mountain-climb', 'sunrise-peak'] },
    { title: '雨后的山', lead: '山被雨洗过一遍，颜色都变深了。', scenes: ['mountain-climb'] },
    { title: '海边真好玩', lead: '沙子踩上去软软的，浪花追着你的脚跑。', scenes: ['beach'] },
  ],
  campus: [
    { title: '学校的小花园', lead: '花园里现在正开着什么花？', scenes: ['school-garden'] },
    { title: '热闹的操场', lead: '下课铃一响，操场就活了。', scenes: ['playground'] },
    { title: '大扫除', lead: '大家分工合作，教室慢慢变干净了。', scenes: ['cleaning-class'] },
    { title: '雪后的校园', lead: '雪停了，太阳出来了，校园亮闪闪的。', scenes: ['snow-clear'] },
    { title: '推荐一个好地方', lead: '你觉得哪里最好玩？推荐给同学吧。', scenes: ['book-store'] },
  ],
  night: [
    { title: '数星星的晚上', lead: '躺在草地上，天上的星星一颗一颗亮起来。', scenes: ['starry-night'] },
    { title: '萤火虫之夜', lead: '夏天的晚上，草丛里飞起了小灯笼。', scenes: ['fireflies'] },
    { title: '月亮跟着我走', lead: '我走一步，它也走一步。这是为什么呢？', scenes: ['starry-night'] },
  ],
  'home-scene': [
    { title: '窗台上的绿萝', lead: '它一直在悄悄地长，你发现了吗？', scenes: ['pothos'] },
    { title: '厨房里的香味', lead: '还没进门，就闻到了香味。', scenes: ['mom-cooking'] },
    { title: '窗外的小鸟', lead: '每天早上，它都会停在窗台上唱歌。', scenes: ['bird-window'] },
  ],
  travel: [
    { title: '游记', lead: '你去过哪个好玩的地方？按游览的顺序写下来。', scenes: ['travel-visit'] },
    { title: '参观记', lead: '参观博物馆或古迹的时候，你看到了什么？', scenes: ['travel-visit', 'cultural-heritage'] },
  ],
  culture: [
    { title: '中国的世界文化遗产', lead: '选一处你感兴趣的世界文化遗产，介绍给别人。', scenes: ['cultural-heritage'] },
    { title: '古城墙', lead: '站在城墙上，你能想象这里曾经发生过什么吗？', scenes: ['cultural-heritage'] },
  ],
  hometown: [
    { title: '家乡的田野', lead: '风吹过的时候，家乡的田野像什么？', scenes: ['wheat-field'] },
    { title: '家乡的傍晚', lead: '太阳落到山后面，村子慢慢安静下来了。', scenes: ['sunset'] },
    { title: '村口的那条河', lead: '河水从村子旁边流过，你还记得它什么样子吗？', scenes: ['river-village'] },
  ],

  /* ---- 写人 ---- */
  family: [
    { title: '我的妈妈', lead: '妈妈是什么样子的？她做的哪件事让你记得最清楚？', scenes: ['mom-cooking'] },
    { title: '爷爷和他的花园', lead: '爷爷在院子里忙活的时候，你在旁边看着。', scenes: ['grandpa-garden'] },
    {
      title: '妹妹来了',
      lead: '家里多了一个小不点，日子变得不一样了。',
      scenes: ['baby-arrive', 'play-with-baby'],
    },
    { title: '爸爸修东西', lead: '爸爸蹲在地上，手里拿着扳手，满头是汗。', scenes: ['dad-repair'] },
    { title: '奶奶织毛衣', lead: '奶奶戴着老花镜，坐在摇椅上一针一针地织。', scenes: ['grandma-knit'] },
    { title: '邻居阿姨', lead: '隔壁的阿姨总是笑眯眯的，手里拎着菜篮子。', scenes: ['neighbor'] },
  ],
  teacher: [
    { title: '我的老师', lead: '老师站在讲台上的样子，你还记得吗？', scenes: ['teacher-class'] },
    { title: '老师的那句话', lead: '有一句话，老师说过之后你就一直记着。', scenes: ['teacher-class'] },
    { title: '漫画老师', lead: '用画漫画的方式画一画你的老师，他有什么特点？', scenes: ['comic-teacher'] },
  ],
  classmate: [
    { title: '我的同桌', lead: '同桌是个什么样的人？你们之间发生过什么？', scenes: ['deskmate'] },
    { title: '一个爱笑的人', lead: '他一笑，周围的人也跟着笑。', scenes: ['deskmate'] },
    { title: '我的好朋友', lead: '你们是怎么认识的？一起做过什么好玩的事？', scenes: ['best-friend'] },
  ],
  'community-helper': [
    { title: '看病的医生', lead: '白大褂、听诊器，医生叔叔（阿姨）是怎么给你看病的？', scenes: ['doctor'] },
    { title: '警察叔叔', lead: '十字路口，警察叔叔正指挥着交通。', scenes: ['police'] },
    { title: '图书管理员', lead: '图书馆里很安静，管理员阿姨帮你找到了书。', scenes: ['librarian'] },
    { title: '公交司机', lead: '每天上学坐的公交车，司机叔叔总是笑眯眯的。', scenes: ['bus-driver'] },
  ],
  stranger: [
    { title: '清晨的环卫工', lead: '天刚亮的时候，路上已经有人在扫地了。', scenes: ['street-cleaner'] },
    { title: '雨天的快递员', lead: '雨很大，他穿着雨衣把包裹送到门口。', scenes: ['rain-delivery'] },
  ],
  self: [
    { title: '这就是我', lead: '对着镜子看看自己，说说你是个什么样的人。', scenes: ['mirror-self'] },
    { title: '我的小毛病', lead: '每个人都有自己的小毛病，你的呢？', scenes: ['mirror-self'] },
  ],
  'people-around': [
    { title: '形形色色的人', lead: '身边有各种各样的人，选一个让你印象最深的写。', scenes: ['all-kinds-people'] },
    { title: '街头众生', lead: '走在街上，你会看到哪些不同的人？他们在做什么？', scenes: ['all-kinds-people'] },
  ],
  'dream-job': [
    { title: '我的理想', lead: '长大后你想做什么？为什么想做这个？', scenes: ['future-me'] },
    { title: '我想成为的人', lead: '身边有谁是你想成为的样子？说说他哪里让你佩服。', scenes: ['all-kinds-people'] },
    { title: '如果我当医生', lead: '穿上白大褂，你会怎么给病人看病？', scenes: ['doctor'] },
  ],

  /* ---- 写事 ---- */
  'first-time': [
    {
      title: '第一次骑自行车',
      lead: '刚开始很难，后来你学会了。当时什么感觉？',
      scenes: ['bike-fail', 'bike-ride'],
    },
    {
      title: '第一次做饭',
      lead: '你系上围裙，站到了灶台前……',
      scenes: ['cook-start', 'cook-mess', 'cook-done'],
    },
    { title: '第一次上台', lead: '台下的同学都看着你，你的手心里全是汗。', scenes: ['stage-nervous'] },
    { title: '第一次独睡', lead: '关了灯，房间里黑黑的，你给自己壮了壮胆。', scenes: ['sleep-alone'] },
  ],
  unforgettable: [
    { title: '那一次，我很难忘', lead: '有一件事，过了很久你还记得。', scenes: ['memory-album'] },
    {
      title: '第一次春游',
      lead: '背上小书包，我们出发啦！',
      scenes: ['spring-outing-bus', 'spring-outing-picnic', 'spring-outing-play'],
    },
    { title: '得奖了', lead: '站在领奖台上，台下响起一片掌声。', scenes: ['award'] },
  ],
  'warm-moment': [
    { title: '他扶了我一把', lead: '你摔倒了，有人伸出了手。', scenes: ['help-hand'] },
    { title: '雨中送伞', lead: '雨越下越大，校门口出现了一个熟悉的身影。', scenes: ['umbrella-rain'] },
    { title: '奶奶的针线盒', lead: '那个旧旧的盒子，里面装满了故事。', scenes: ['sewing-box'] },
  ],
  activity: [
    { title: '热闹的运动会', lead: '哨声一响，跑道上的同学冲了出去。', scenes: ['sports-day', 'colorful-activity'] },
    {
      title: '快乐的春游',
      lead: '背上小书包，我们出发啦！',
      scenes: ['spring-outing-bus', 'spring-outing-picnic', 'spring-outing-play'],
    },
    { title: '班级大扫除', lead: '大家分工合作，教室变干净了。', scenes: ['cleaning-class'] },
    { title: '记一次游戏', lead: '你和同学玩了什么游戏？怎么玩的？', scenes: ['play-game'] },
    { title: '多彩的活动', lead: '你参加过什么活动？把场面和心情都写下来。', scenes: ['colorful-activity'] },
  ],
  mistake: [
    { title: '我撒了一个谎', lead: '说出来之后，心里反而更难受了。', scenes: ['lie-truth'] },
    { title: '打碎的花瓶', lead: '「哐当」一声，屋子里一下子安静了。', scenes: ['broken-vase'] },
    { title: '迟到了', lead: '铃响了才跑到教室门口，老师正看着我。', scenes: ['late'] },
    { title: '考试前夜', lead: '明天要考试，台灯下翻了一遍又一遍课本。', scenes: ['exam-nervous'] },
  ],
  'lost-found': [
    { title: '走丢的那个下午', lead: '一回头，妈妈不见了。', scenes: ['lost-crowd', 'found-mom'] },
    { title: '摔了一跤之后', lead: '膝盖火辣辣的，可我记住了这一跤。', scenes: ['help-hand'] },
    { title: '生病了', lead: '头很烫，妈妈让我躺在床上别动。', scenes: ['sick'] },
  ],
  milestone: [
    { title: '过生日', lead: '蛋糕上插着蜡烛，大家围在一起唱生日歌。', scenes: ['birthday'] },
    { title: '毕业了', lead: '最后一次排队站在操场上，帽子一抛就散了。', scenes: ['graduation'] },
    { title: '搬新家', lead: '纸箱子堆了一屋，新房间还空空的。', scenes: ['moving'] },
    { title: '难忘小学生活', lead: '六年的小学时光，你最难忘的是什么？', scenes: ['farewell-school'] },
    { title: '我的拿手好戏', lead: '你最擅长什么？把过程写具体。', scenes: ['my-talent'] },
  ],
  observe: [
    { title: '观察日记', lead: '连续观察一样东西的变化，记录下来。', scenes: ['observe-diary'] },
    { title: '我做了一项小实验', lead: '做实验的时候你看到了什么？按步骤写下来。', scenes: ['experiment'] },
    { title: '观察日记', lead: '你每天观察的那株植物，今天变成什么样了？', scenes: ['observe-diary'] },
  ],
  letter: [
    { title: '给亲人的一封信', lead: '给远方的亲人写封信，说说你的近况。', scenes: ['write-letter'] },
    { title: '我想对您说', lead: '有什么话想对爸爸妈妈说？写下来吧。', scenes: ['write-letter'] },
    { title: '读后感', lead: '读完一本书，你最大的感受是什么？', scenes: ['reading-notes'] },
  ],
  'look-picture': [
    { title: '看图写话', lead: '仔细看图，图上画了什么？把你看到的、想到的写下来。', scenes: ['look-picture-single'] },
    { title: '连环图编故事', lead: '三幅图连起来就是一个故事，你来讲一讲。', scenes: ['look-picture-series'] },
  ],
  custom: [
    { title: '传统节日', lead: '你家是怎么过传统节日的？写一写过程。', scenes: ['festival'] },
    { title: '家乡的风俗', lead: '你的家乡有什么特别的风俗？介绍给大家。', scenes: ['hometown-custom'] },
  ],
  comic: [
    { title: '一幅漫画的启示', lead: '先仔细看这幅漫画，它让你想到了什么？', scenes: ['comic-inspiration'] },
    { title: '漫画里的道理', lead: '漫画常常用夸张的办法讲道理，你看懂了哪一幅？', scenes: ['comic-inspiration'] },
  ],

  /* ---- 状物 ---- */
  pet: [
    { title: '我家的小猫', lead: '它长什么样？平时最喜欢干什么？', scenes: ['cat-sun'] },
    { title: '小狗花花', lead: '每次我回家，它都会第一个冲出来。', scenes: ['dog-welcome'] },
    { title: '窗外的小鸟', lead: '每天早上，它都会停在窗台上唱歌。', scenes: ['bird-window'] },
    { title: '我的小金鱼', lead: '鱼缸里的小金鱼，尾巴一摆一摆地游。', scenes: ['goldfish'] },
    { title: '小乌龟', lead: '它的壳上画着花纹，头一伸一缩的。', scenes: ['turtle'] },
    { title: '国宝大熊猫', lead: '黑白相间、圆滚滚的大熊猫，你了解多少？', scenes: ['panda'] },
  ],
  plant: [
    { title: '窗台上的绿萝', lead: '它一直在悄悄地长，你发现了吗？', scenes: ['pothos'] },
    { title: '蒲公英的旅行', lead: '轻轻一吹，小伞兵们就飞走了。', scenes: ['dandelion'] },
    { title: '池塘里的荷花', lead: '夏天到了，池塘里的荷花开了。', scenes: ['lotus'] },
    { title: '我的仙人掌', lead: '它浑身长着小刺，却开出了小花。', scenes: ['cactus'] },
  ],
  stationery: [
    { title: '我的小书包', lead: '书包里装着什么？它陪了你多久了？', scenes: ['backpack'] },
    { title: '一块橡皮的心里话', lead: '如果橡皮会说话，它想说什么？', scenes: ['eraser-talking'] },
    { title: '我的文具盒', lead: '打开文具盒，就像打开一个小房子。', scenes: ['pencil-case'] },
  ],
  treasure: [
    { title: '外婆的针线盒', lead: '那个旧旧的盒子，里面装满了故事。', scenes: ['sewing-box'] },
    { title: '我的旧玩具', lead: '它已经很旧了，可你还是舍不得扔。', scenes: ['old-toy'] },
    { title: '一张旧照片', lead: '翻相册的时候，一张泛黄的照片掉了出来。', scenes: ['old-photo'] },
    { title: '我的小闹钟', lead: '每天早上都是它叫我起床，叮铃铃的。', scenes: ['clock'] },
    { title: '我的房间', lead: '推开房门，每一样东西都是你的好朋友。', scenes: ['my-room'] },
    { title: '介绍一种事物', lead: '选一种你了解的东西，把它的外形、功能、用途介绍清楚。', scenes: ['introduce-thing'] },
    { title: '我的乐园', lead: '你最喜欢待的地方是哪里？为什么？', scenes: ['my-paradise'] },
  ],
  food: [
    { title: '外婆包的饺子', lead: '薄薄的皮，鼓鼓的馅，冒着热气。', scenes: ['dumplings'] },
    { title: '一碗热汤面', lead: '冬天放学回家，桌上有一碗面。', scenes: ['noodle-soup'] },
    { title: '推荐一本书', lead: '你读过的好书，像推荐好朋友一样推荐给同学吧。', scenes: ['book-store'] },
  ],

  /* ---- 想象 ---- */
  'if-i': [
    { title: '假如我有一双翅膀', lead: '你想飞到哪里去？会看到什么？', scenes: ['fly-sky'] },
    { title: '假如我是一阵风', lead: '风会去哪里？会做什么事？', scenes: ['wind-travel'] },
    { title: '假如我能听懂动物说话', lead: '那它们会告诉你什么秘密？', scenes: ['talk-animals'] },
    { title: '假如我变小了', lead: '忽然你变得只有蚂蚁那么小，世界变成了什么样？', scenes: ['if-tiny'] },
  ],
  future: [
    { title: '未来的学校', lead: '一百年后的学校，会是什么样子？', scenes: ['future-school'] },
    { title: '二十年后的我', lead: '二十年后，你在做什么工作？过着怎样的生活？', scenes: ['future-me'] },
    { title: '我的机器人朋友', lead: '它有方方的脑袋，天线一闪一闪的。', scenes: ['robot-friend'] },
    { title: '太空旅行', lead: '坐上火箭，嗖的一下就到了太空里。', scenes: ['space'] },
  ],
  fairy: [
    { title: '《龟兔赛跑》新编', lead: '如果它们再比一次，会发生什么？', scenes: ['turtle-rabbit'] },
    { title: '卖火柴的小女孩来了我家', lead: '如果她推开门走了进来……', scenes: ['girl-visit'] },
  ],
  talking: [
    { title: '如果书包会说话', lead: '它每天被你背着，肯定有很多话想说。', scenes: ['talking-bag'] },
    {
      title: '一只铅笔的冒险',
      lead: '它从文具盒里溜了出去……',
      scenes: ['pencil-escape', 'pencil-adventure', 'pencil-home'],
    },
  ],
  dream: [
    { title: '一个奇怪的梦', lead: '梦里的事都不太讲道理，可又很真实。', scenes: ['weird-dream'] },
    { title: '我梦见了未来', lead: '醒来的时候，我还记得那个画面。', scenes: ['future-me'] },
    { title: '海底探险', lead: '梦里我变成了一条鱼，在珊瑚丛里穿来穿去。', scenes: ['underwater'] },
    { title: '时间快进', lead: '「嗖」的一声，我到了好多好多年以后。', scenes: ['time-travel'] },
  ],
  'sci-fi': [
    { title: '插上科学的翅膀飞', lead: '展开想象，写一个科幻故事。', scenes: ['sci-fi-fly'] },
    { title: '我的奇思妙想', lead: '你想发明什么东西？它有什么功能？', scenes: ['invention'] },
    { title: '太空旅行', lead: '坐上火箭，去宇宙里探险。', scenes: ['space', 'sci-fi-fly'] },
  ],
  deform: [
    { title: '变形记', lead: '假如你变成了另一种东西，你的世界会变成什么样？', scenes: ['deformation'] },
    { title: '假如我变小了', lead: '忽然你变得只有蚂蚁那么小，世界变成了什么样？', scenes: ['if-tiny'] },
    { title: '神奇的探险之旅', lead: '你和同伴深入一个未知的山洞，发生了什么？', scenes: ['adventure-trip'] },
    { title: '笔尖流出的故事', lead: '笔尖一动，一个人物就从纸上走了出来……', scenes: ['pen-story'] },
  ],
}

/** 所有模板里出现过的插画 key —— 用于校验素材是否齐全 */
export function allTemplateScenes(): string[] {
  const set = new Set<string>()
  for (const list of Object.values(PROMPT_TEMPLATES)) {
    for (const t of list) for (const s of t.scenes) set.add(s)
  }
  return [...set]
}

/* ============================================================
   字数与考察重点
   ============================================================ */

/** 按年级给建议字数区间 */
export function wordRangeFor(grade: GradeLevel): [number, number] {
  if (grade <= 1) return [30, 80]
  if (grade === 2) return [60, 150]
  if (grade === 3) return [100, 220]
  if (grade === 4) return [150, 300]
  if (grade === 5) return [220, 400]
  if (grade === 6) return [280, 500]
  if (grade === 7) return [400, 600]
  return [500, 800]
}

/** 各年级考察重点：低年级重观察，高年级重情感与结构 */
export function focusFor(grade: GradeLevel, category: CompositionCategory): ScoreDimension[] {
  const base: ScoreDimension[] =
    grade <= 2
      ? ['observation', 'vocabulary']
      : grade <= 4
        ? ['observation', 'structure', 'vocabulary']
        : ['structure', 'emotion', 'vocabulary']

  // 想象类作文额外看想象力
  if (category === 'imagine' && !base.includes('imagination')) {
    return [...base.slice(0, 2), 'imagination']
  }
  return base
}

/* ============================================================
   本地出题（无 API 时兜底）
   ============================================================ */

let localSeq = 0

/**
 * 本地引擎生成一道题。
 *
 * 注意：它产出的东西和远程 AI 产出的是**同一种结构**，
 * 所以调用方不需要关心题目到底是谁出的。
 */
export function generateLocalPrompt(opts: {
  grade: GradeLevel
  category: CompositionCategory
  tagId?: string
  /** 排除已经出过的标题，避免连续重复 */
  excludeTitles?: string[]
  now?: number
}): CompositionPrompt {
  const { grade, category } = opts
  const tags = tagsFor(category, grade)
  const tag =
    (opts.tagId ? tags.find((t) => t.id === opts.tagId) : undefined) ??
    tags[Math.floor(Math.random() * Math.max(tags.length, 1))] ??
    TOPIC_TAGS.find((t) => t.category === category) ??
    TOPIC_TAGS[0]

  const templates = PROMPT_TEMPLATES[tag.id] ?? PROMPT_TEMPLATES.season
  const used = new Set(opts.excludeTitles ?? [])
  const fresh = templates.filter((t) => !used.has(t.title))
  const pool = fresh.length > 0 ? fresh : templates
  const tpl = pool[Math.floor(Math.random() * pool.length)]

  localSeq += 1
  const now = opts.now ?? Date.now()

  return {
    id: `p-${now.toString(36)}-${localSeq}`,
    category,
    tagId: tag.id,
    title: tpl.title,
    lead: tpl.lead,
    images: tpl.scenes.map((key, i) => ({
      sceneKey: key,
      caption: tpl.scenes.length > 1 ? `第 ${i + 1} 幅` : undefined,
    })),
    wordRange: wordRangeFor(grade),
    minGrade: Math.max(1, grade - 2) as GradeLevel,
    maxGrade: Math.min(9, grade + 2) as GradeLevel,
    focus: focusFor(grade, category),
  }
}

/* ---------------- 常量 ---------------- */

export const ALL_DIMENSIONS: ScoreDimension[] = [
  'observation',
  'structure',
  'vocabulary',
  'imagination',
  'emotion',
]
