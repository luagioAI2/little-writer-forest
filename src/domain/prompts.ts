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
  CompositionGenre,
  CompositionPrompt,
  GradeLevel,
  ScoreDimension,
  TopicTag,
} from './types'
import { resolveGenre } from './types'

/* ---------------- 细分标签 ---------------- */

export const TOPIC_TAGS: TopicTag[] = [
  /* 关于 `promptMode`（命题方式，轴 2）：**大部分标签不写它** ——
     不写就是 `assigned`（命题作文），因为出题模板给的标题是定死的。
     目前只有 `applied-writing` 写了（`assigned`，顺带把「自带格式要求」写明）。
     ⚠️ `material` / `half` / `topic` 目前**一个标签都没用** ——
     它们是这一轴的定义，等真有那类题时再用（2026-10-01 记）。
     ⛔ 2026-10-02：`material` 原来是靠 `look-picture` / `comic` 撑着的，
     那两个标签删掉后就空出来了。**别顺手把 `material` 从 `PromptMode`
     里删掉** —— 它是这一轴的定义，不是「当前有没有人用」。 */
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
  // ⛔ 2026-10-02 删掉了 `look-picture`（看图作文）—— 家长原话：「整个应用
  //   就是看图作文」，那再单列一个「看图作文」分类就是多余的。6 道题一起删。
  { id: 'custom', category: 'event', label: '节日风俗', emoji: '🧧', minGrade: 2, hint: '传统节日、家乡风俗' },
  // ⛔ 2026-10-02 删掉了 `comic`（漫画的启示）—— 漫画只是换一种图，同样属于
  //   「整个应用就是看图作文」的范畴，不必单列。5 道题一起删了。

  /* ---- 状物 ---- */
  { id: 'pet', category: 'object', label: '小动物', emoji: '🐈', minGrade: 1, hint: '猫狗兔子小鸟' },
  { id: 'plant', category: 'object', label: '花草植物', emoji: '🌻', minGrade: 1, hint: '一盆花、一棵树' },
  { id: 'stationery', category: 'object', label: '学习用品', emoji: '✏️', minGrade: 1, hint: '书包、笔袋、橡皮' },
  { id: 'treasure', category: 'object', label: '心爱之物', emoji: '💎', minGrade: 2, hint: '有故事的物件' },
  { id: 'food', category: 'object', label: '美食', emoji: '🥟', minGrade: 2, hint: '一道好菜、家乡味' },
  { id: 'life-goods', category: 'object', label: '生活用品', emoji: '🛋️', minGrade: 1, hint: '台灯、电风扇、雨伞、闹钟' },

  /* ---- 想象 ---- */
  { id: 'if-i', category: 'imagine', label: '假如我……', emoji: '🦋', minGrade: 2, hint: '假如我会飞、假如我是风' },
  { id: 'future', category: 'imagine', label: '未来世界', emoji: '🛸', minGrade: 3, hint: '未来的学校、城市、家' },
  { id: 'fairy', category: 'imagine', label: '童话续写', emoji: '🧚', minGrade: 2, hint: '改编经典童话' },
  { id: 'talking', category: 'imagine', label: '会说话的它', emoji: '💬', minGrade: 1, hint: '如果物品会说话' },
  { id: 'dream', category: 'imagine', label: '我的梦', emoji: '💤', minGrade: 2, hint: '一场奇妙的梦' },
  { id: 'sci-fi', category: 'imagine', label: '科幻世界', emoji: '🚀', minGrade: 4, hint: '太空旅行、机器人、未来科技' },
  { id: 'deform', category: 'imagine', label: '变形与历险', emoji: '🐜', minGrade: 4, hint: '假如我变小了、变形记、探险' },
  { id: 'growth', category: 'event', label: '成长感悟', emoji: '🌱', minGrade: 3, hint: '挫折、坚持、独立、蜕变' },
  { id: 'reading', category: 'event', label: '读书感悟', emoji: '📖', minGrade: 3, hint: '读后感、书中人物、一句话的启发' },
  { id: 'tradition', category: 'event', label: '传统文化', emoji: '🏮', minGrade: 3, hint: '节日、非遗、老字号、民俗' },
  { id: 'society', category: 'event', label: '社会观察', emoji: '👀', minGrade: 5, hint: '身边的变化、环保、科技与生活' },
  { id: 'gratitude', category: 'person', label: '感恩与致敬', emoji: '💐', minGrade: 2, hint: '想对谁说谢谢、致敬平凡英雄' },
  // ★★ 应用文是**题目自带了格式要求**（「写一份倡议书」没有自选余地 ——
  //    孩子没法"决定"把倡议书写成写景），所以它写 `requiredGenre`，
  //    而不是靠「它挂在哪个 category 下面」来表达。
  //    ⚠️ 这是 `requiredGenre` **唯一**的用途：记叙/说明/议论由孩子自己决定，
  //       APP 不建模（2026-10-02 家长定的）。
  //    `category: 'event'` 同上，只是归档位置（倡议书可以写事、颁奖词
  //    可以写人、导游词可以写景，它本来就跨对象）。
  { id: 'applied-writing', category: 'event', label: '应用文', emoji: '📢', minGrade: 4, hint: '演讲稿、倡议书、观后感、建议书', promptMode: 'assigned', requiredGenre: 'applied' },
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

/**
 * 「纯照片位」的占位 —— **这一格没有插画，只有照片**。
 *
 * 为什么要有它：`PromptTemplate.scenes` 的长度同时承担两个职责 ——
 *   ① 这道题有几个图位  ② 每个图位画哪张插画
 * 纯照片题只需要 ①，不需要 ②。所以用这个空串占位：
 *   · `builtinBaseItems()` 把它转成 `sceneKey: undefined`
 *   · `SceneArt(undefined, imageUrl)` → 画照片；照片没配/挂了 → 「暂无插图」占位框
 *   · `describeImages()` 会因为 `sceneKey` 是空而跳过它（不会给大模型编一段画面描述）
 *
 * ⚠️ 空串是**故意的**：任何真实 sceneKey 都不可能是空串，所以它不会跟插画撞车。
 * ⚠️ 别把它换成 `'photo'` 这类「看着更好懂」的字符串 —— 那就成了一个假 sceneKey，
 *    `builtinLibrary.test.ts` 的「sceneKey 必须真实存在」那条会认它、放它过去，
 *    以后真有人加一个叫 `photo` 的插画就会静默串味。
 */
export const PHOTO_SLOT = ''

/**
 * 一道题的图位长什么样：
 *   · `['spring-park']`        —— 一个图位，画「春天的公园」
 *   · `['', '']`               —— 两个图位，都是纯照片位
 *   · `['bike-fail', '']`      —— 第一个画插画，第二个放照片（连环图混着来）
 *
 * ⚠️ **长度 = 图位个数**，这个不变量别动：覆盖层的 `imageUrls` 按下标补位，
 *    长度一变，家长配过的图就会**静默错位**。
 */
export const PROMPT_TEMPLATES: Record<string, PromptTemplate[]> = {
  /* ---- 写景 ---- */
  season: [
    { title: '春天的公园', lead: '春天来了，公园里全变了样。你看到了什么？', scenes: [PHOTO_SLOT] },
    { title: '秋天的落叶', lead: '一阵风吹过，树叶飘下来了。它们像什么呢？', scenes: [PHOTO_SLOT] },
    {
      title: '冬天的第一场雪',
      lead: '早上推开窗，外面全白了……',
      scenes: [PHOTO_SLOT, PHOTO_SLOT, PHOTO_SLOT],
    },
    { title: '夏天的小院', lead: '太阳火辣辣的，知了在树上叫个不停。', scenes: [PHOTO_SLOT] },
    { title: '夏日的荷塘', lead: '荷叶圆圆的，荷花粉粉的，蜻蜓飞来飞去。', scenes: [PHOTO_SLOT] },
    { title: '金色的秋天', lead: '麦田一望无边，像铺了一地金子。', scenes: [PHOTO_SLOT] },
    { title: '校园的秋天', lead: '银杏叶黄了，一片一片落下来。', scenes: [PHOTO_SLOT] },
    { title: '公园里的春天', lead: '小草绿了，粉色的花开满枝头，远处是青山和白云。你在这个公园里看到了什么？', scenes: ['spring-park'] },
    { title: '一地黄叶', lead: '小路铺满了金黄的落叶，风一吹，叶子还在往下掉。它们像什么呢？', scenes: ['autumn-leaves'] },
    { title: '窗外下雪了', lead: '我趴在窗台上往外看，外面下着雪，窗台上还放着一杯热饮。你猜我在想什么？', scenes: ['winter-window'] },
    { title: '打雪仗', lead: '雪地上，两个小伙伴打起了雪仗，雪球在半空里飞。这一仗最后谁赢了？', scenes: ['snow-play'] },
    { title: '雪人站起来了', lead: '雪地里，我们堆了一个戴红围巾的雪人，鼻子是胡萝卜做的。它是怎么一点一点成形的？', scenes: ['snowman'] },
    { title: '冬天的暖阳', lead: '冬天的太阳晒在身上暖暖的。你最喜欢在哪儿晒？', scenes: [PHOTO_SLOT] },
  ],
  weather: [
    { title: '下雨了', lead: '雨点打在窗户上，发出什么声音？', scenes: [PHOTO_SLOT] },
    { title: '雨后的彩虹', lead: '雨停了，天边出现了一道彩虹……', scenes: [PHOTO_SLOT, PHOTO_SLOT] },
    { title: '大雾的早晨', lead: '出门的时候，前面的路都看不清了。', scenes: [PHOTO_SLOT] },
    { title: '下雨天，妈妈来了', lead: '雨越下越大，校门口出现了一个熟悉的身影。', scenes: [PHOTO_SLOT] },
    { title: '日落时分', lead: '太阳慢慢沉下去，天边烧成了一片橙红色。', scenes: [PHOTO_SLOT] },
    { title: '下雨的窗边', lead: '雨点打在玻璃上，挂成一串串水珠，小猫蹲在窗台上看雨。下雨天里，你在做什么？', scenes: ['rain-window'] },
    { title: '彩虹出来了', lead: '雨停了，一道七色的彩虹架在天上，草地上还留着两摊水洼。看见彩虹的那一刻，你在想什么？', scenes: ['rainbow'] },
    { title: '雾里的小路', lead: '雾太浓了，只能看清近处的小路，远处的树影若有若无。走在雾里是什么感觉？', scenes: ['fog-morning'] },
    { title: '太阳落山了', lead: '太阳慢慢躲到山后面去，天被染成橙红色，远山变成了深色的影子。这个时候你在哪儿？', scenes: ['sunset'] },
    { title: '雪停了', lead: '雪停了，天放晴了，屋檐下挂着一排冰棱，雪人还站在院子里。雪后的空气是什么味道？', scenes: ['snow-clear'] },
    { title: '刮风了', lead: '风把树吹得哗哗响，晾着的衣服也飘起来了。', scenes: [PHOTO_SLOT] },
  ],
  water: [
    { title: '家乡的小河', lead: '那条河从村子旁边流过，你还记得它什么样子吗？', scenes: [PHOTO_SLOT] },
    { title: '爬山看日出', lead: '天还没亮就出发了，等爬到山顶……', scenes: [PHOTO_SLOT, PHOTO_SLOT] },
    { title: '雨后的山', lead: '山被雨洗过一遍，颜色都变深了。', scenes: [PHOTO_SLOT] },
    { title: '海边真好玩', lead: '沙子踩上去软软的，浪花追着你的脚跑。', scenes: [PHOTO_SLOT] },
    { title: '天没亮就出发', lead: '天还是深蓝的，月亮和星星都还在，我们打着手电走上山路。为什么要这么早出发？', scenes: ['mountain-climb'] },
    { title: '山顶看日出', lead: '太阳从两座山之间升起来，脚下是一片白色的云海。站在山顶上，你最想喊什么？', scenes: ['sunrise-peak'] },
    { title: '夏日荷塘', lead: '水面上铺着碧绿的荷叶，粉色的荷花开着，一只蜻蜓停在上头。荷塘里还藏着什么？', scenes: ['summer-pond'] },
    { title: '海边的沙滩', lead: '沙滩上散着贝壳，一把红伞撑在旁边，远处的浪一层层涌过来。你会在沙滩上做什么？', scenes: ['beach'] },
    { title: '山里的瀑布', lead: '水从高处冲下来，声音老远就听得见。', scenes: [PHOTO_SLOT] },
  ],
  campus: [
    { title: '学校的小花园', lead: '花园里现在正开着什么花？', scenes: [PHOTO_SLOT] },
    { title: '热闹的操场', lead: '下课铃一响，操场就活了。', scenes: [PHOTO_SLOT] },
    { title: '大扫除', lead: '大家分工合作，教室慢慢变干净了。', scenes: [PHOTO_SLOT] },
    { title: '雪后的校园', lead: '雪停了，太阳出来了，校园亮闪闪的。', scenes: [PHOTO_SLOT] },
    { title: '推荐一个好地方', lead: '你觉得哪里最好玩？推荐给同学吧。', scenes: [PHOTO_SLOT] },
    { title: '花园里的小路', lead: '教学楼前有一个小花园，花开得正好，一只小鸟从头顶飞过。你最喜欢它的哪个角落？', scenes: ['school-garden'] },
    { title: '课间的操场', lead: '红色的跑道上，同学们在跑、在跳，球场中间放着一个足球。课间的操场是什么样子的？', scenes: ['playground'] },
    { title: '校园里的秋天', lead: '教学楼前的两棵银杏黄了，叶子落了一地，我走在铺满叶子的小路上。你捡到过最好看的那一片吗？', scenes: ['school-autumn'] },
    { title: '街角的小书店', lead: '书架上的书排得满满的，柜台后面有人正看得入神，门口挂着书店的牌子。你最近想看哪一本？', scenes: ['book-store'] },
    { title: '教室的窗边', lead: '上课的时候，你偷偷往窗外看过什么？', scenes: [PHOTO_SLOT] },
  ],
  night: [
    { title: '数星星的晚上', lead: '躺在草地上，天上的星星一颗一颗亮起来。', scenes: [PHOTO_SLOT] },
    { title: '萤火虫之夜', lead: '夏天的晚上，草丛里飞起了小灯笼。', scenes: [PHOTO_SLOT] },
    { title: '月亮跟着我走', lead: '我走一步，它也走一步。这是为什么呢？', scenes: [PHOTO_SLOT] },
    { title: '躺在草地上数星星', lead: '深蓝的夜空挂满了星星，还挂着一弯月亮。你数到第几颗就数不清了？', scenes: ['starry-night'] },
    { title: '萤火虫的夜晚', lead: '草地上飞满了发光的萤火虫，我举着玻璃罐追了过去。你想捉几只？', scenes: ['fireflies'] },
    { title: '路灯下的影子', lead: '路灯把我的影子拉得老长。你踩得到它吗？', scenes: [PHOTO_SLOT] },
  ],
  'home-scene': [
    { title: '悄悄长大的绿萝', lead: '它一直在悄悄地长，你发现了吗？', scenes: [PHOTO_SLOT] },
    { title: '厨房里的香味', lead: '还没进门，就闻到了香味。', scenes: [PHOTO_SLOT] },
    { title: '清晨的窗台', lead: '每天早上，它都会停在窗台上唱歌。', scenes: [PHOTO_SLOT] },
    { title: '我的小房间', lead: '房间里有一张床、一张书桌和一个书架，桌上摆着台灯和书。你最喜欢待在哪个角落？', scenes: ['my-room'] },
    { title: '床头柜上的闹钟', lead: '双铃闹钟立在床头柜上，两根指针慢慢走，底下有两只小脚。它每天早上叫你起床吗？', scenes: ['clock'] },
    { title: '客厅的沙发', lead: '沙发上总有一个位置是你常坐的。为什么是那儿？', scenes: [PHOTO_SLOT] },
  ],
  travel: [
    { title: '游记', lead: '你去过哪个好玩的地方？按游览的顺序写下来。', scenes: [PHOTO_SLOT] },
    { title: '参观记', lead: '参观博物馆或古迹的时候，你看到了什么？', scenes: [PHOTO_SLOT, PHOTO_SLOT] },
    { title: '亭子前的石阶', lead: '古亭子前有石阶和绿树，我举着相机正拍照。这次去的是哪儿？', scenes: ['travel-visit'] },
    { title: '古镇的早晨', lead: '石板路还湿着，两边的店铺刚开门。你最先闻到什么？', scenes: [PHOTO_SLOT] },
    { title: '博物馆里的一天', lead: '展柜里的东西都隔着玻璃。你最想凑近看哪一件？', scenes: [PHOTO_SLOT] },
  ],
  culture: [
    { title: '中国的世界文化遗产', lead: '选一处你感兴趣的世界文化遗产，介绍给别人。', scenes: [PHOTO_SLOT] },
    { title: '古城墙', lead: '站在城墙上，你能想象这里曾经发生过什么吗？', scenes: [PHOTO_SLOT] },
    { title: '城墙上的故事', lead: '城墙上有城楼和城垛，牌子写着世界文化遗产。关于它，你查到过什么？', scenes: ['cultural-heritage'] },
    { title: '故宫的红墙', lead: '红墙很高，路很长，走过去要花不少时间。你在想什么？', scenes: [PHOTO_SLOT] },
    { title: '桥上的石狮子', lead: '老桥的栏杆上蹲着一排石狮子。你数得清吗？', scenes: [PHOTO_SLOT] },
  ],
  hometown: [
    { title: '家乡的田野', lead: '风吹过的时候，家乡的田野像什么？', scenes: [PHOTO_SLOT] },
    { title: '家乡的傍晚', lead: '太阳落到山后面，村子慢慢安静下来了。', scenes: [PHOTO_SLOT] },
    { title: '村口的那条河', lead: '河水从村子旁边流过，你还记得它什么样子吗？', scenes: [PHOTO_SLOT] },
    { title: '村口的小河', lead: '小河从村子中间流过，河上有石拱桥，水面上还漂着一条小船。这条河你熟悉吗？', scenes: ['river-village'] },
    { title: '风里的麦田', lead: '满眼的麦子金黄一片，风一吹就摇成波浪，田边有一条小路。你想不想走进去？', scenes: ['wheat-field'] },
    { title: '藏着快乐的角落', lead: '大树上有一个树屋，旁边架着秋千，地上开满了花。你的乐园在哪儿？', scenes: ['my-paradise'] },
    { title: '回家的那条小路', lead: '从村口到家要走过一条小路。路上有什么？', scenes: [PHOTO_SLOT] },
  ],

  /* ---- 写人 ---- */
  family: [
    { title: '我的妈妈', lead: '妈妈是什么样子的？她做的哪件事让你记得最清楚？', scenes: [PHOTO_SLOT] },
    { title: '爷爷和他的花园', lead: '爷爷在院子里忙活的时候，你在旁边看着。', scenes: [PHOTO_SLOT] },
    {
      title: '妹妹来了',
      lead: '家里多了一个小不点，日子变得不一样了。',
      scenes: [PHOTO_SLOT, PHOTO_SLOT],
    },
    { title: '爸爸修东西', lead: '爸爸蹲在地上，手里拿着扳手，满头是汗。', scenes: [PHOTO_SLOT] },
    { title: '奶奶织毛衣', lead: '奶奶戴着老花镜，坐在摇椅上一针一针地织。', scenes: [PHOTO_SLOT] },
    { title: '邻居阿姨', lead: '隔壁的阿姨总是笑眯眯的，手里拎着菜篮子。', scenes: [PHOTO_SLOT] },
    { title: '妈妈在厨房里', lead: '妈妈系着围裙站在灶台前，锅上冒着热气，台面上摆着切好的菜。今天做的是什么？', scenes: ['mom-cooking'] },
    { title: '爷爷的菜地', lead: '爷爷戴着草帽，提着喷壶，一畦畦菜苗排得整整齐齐。他是怎么照顾这些菜的？', scenes: ['grandpa-garden'] },
    { title: '家里多了一个小宝宝', lead: '屋里多了一张小床，床上躺着一个小宝宝，墙上的气球还没撤。第一次见到他/她，你在想什么？', scenes: ['baby-arrive'] },
    { title: '陪他玩一会儿', lead: '地垫上坐着小宝宝，我陪他一起玩，玩具熊和积木散了一地。他最喜欢哪一个？', scenes: ['play-with-baby'] },
    { title: '爸爸在修东西', lead: '爸爸蹲在倒放的自行车旁边，手里拿着扳手，工具箱摊在地上。他修东西的时候是什么样子？', scenes: ['dad-repair'] },
    { title: '毛线团和摇椅', lead: '奶奶坐在摇椅上织毛衣，腿上放着两个毛线团，鼻梁上架着老花镜。这件毛衣是给谁织的？', scenes: ['grandma-knit'] },
    { title: '妈妈的手', lead: '妈妈的手有点粗糙，做过很多很多事情。你注意过她的手吗？', scenes: [PHOTO_SLOT] },
    { title: '爷爷的老花镜', lead: '爷爷把老花镜架在鼻尖上，眯着眼睛看报纸。他平时还爱做什么？', scenes: [PHOTO_SLOT] },
    { title: '爸爸的呼噜声', lead: '夜里，爸爸的呼噜一阵一阵的。你被吵醒过吗？', scenes: [PHOTO_SLOT] },
  ],
  teacher: [
    { title: '我的老师', lead: '老师站在讲台上的样子，你还记得吗？', scenes: [PHOTO_SLOT] },
    { title: '老师的那句话', lead: '有一句话，老师说过之后你就一直记着。', scenes: [PHOTO_SLOT] },
    { title: '漫画老师', lead: '用画漫画的方式画一画你的老师，他有什么特点？', scenes: [PHOTO_SLOT] },
    { title: '站在黑板前的老师', lead: '黑板上的粉笔字还没擦，老师站在旁边一边讲一边比划。他/她哪句话你记得最清楚？', scenes: ['teacher-class'] },
    { title: '给老师画漫画', lead: '黑板前，老师戴着眼镜、拿着教鞭讲得正起劲。如果给老师画一幅漫画，你会夸张他/她的哪一点？', scenes: ['comic-teacher'] },
    { title: '老师的手', lead: '老师的手上沾着粉笔灰，在黑板上写了一行又一行。那双手还做过什么？', scenes: [PHOTO_SLOT] },
    { title: '放学后的办公室', lead: '放学了，办公室的灯还亮着，老师在低头批改作业。你想对他说什么？', scenes: [PHOTO_SLOT] },
    { title: '老师嗓子哑了', lead: '老师说话的声音变小了，还站在讲台上。那天你怎么做的？', scenes: [PHOTO_SLOT] },
  ],
  classmate: [
    { title: '我的同桌', lead: '同桌是个什么样的人？你们之间发生过什么？', scenes: [PHOTO_SLOT] },
    { title: '一个爱笑的人', lead: '他一笑，周围的人也跟着笑。', scenes: [PHOTO_SLOT] },
    { title: '我的好朋友', lead: '你们是怎么认识的？一起做过什么好玩的事？', scenes: [PHOTO_SLOT] },
    { title: '一张课桌，两个人', lead: '一张课桌，两个人，桌上摊着书和笔。你同桌是个什么样的人？', scenes: ['deskmate'] },
    { title: '肩并肩站着', lead: '草地上，我们俩肩并肩站着，一个穿蓝衣服，一个穿黄衣服。你们之间发生过什么？', scenes: ['best-friend'] },
    { title: '同桌的铅笔盒', lead: '同桌的铅笔盒总是乱七八糟的，什么都有。你翻看过吗？', scenes: [PHOTO_SLOT] },
    { title: '一起值日', lead: '放学后，我和同桌留下来扫地、擦黑板。那天发生了什么？', scenes: [PHOTO_SLOT] },
    { title: '我们吵架了', lead: '因为一件小事，我们俩谁也不理谁。后来呢？', scenes: [PHOTO_SLOT] },
  ],
  'community-helper': [
    { title: '看病的医生', lead: '白大褂、听诊器，医生叔叔（阿姨）是怎么给你看病的？', scenes: [PHOTO_SLOT] },
    { title: '警察叔叔', lead: '十字路口，警察叔叔正指挥着交通。', scenes: [PHOTO_SLOT] },
    { title: '图书管理员', lead: '图书馆里很安静，管理员阿姨帮你找到了书。', scenes: [PHOTO_SLOT] },
    { title: '公交司机', lead: '每天上学坐的公交车，司机叔叔总是笑眯眯的。', scenes: [PHOTO_SLOT] },
    { title: '诊室里的医生', lead: '医生穿着白大褂，胸前挂着听诊器，一个小孩坐在台子前面。他看病的时候是怎么说话的？', scenes: ['doctor'] },
    { title: '路口的警察', lead: '十字路口，警察伸手指着方向，红绿灯在旁边一闪一闪。他一天要指挥多少辆车？', scenes: ['police'] },
    { title: '借书台前的管理员', lead: '书架上的书排得整整齐齐，管理员戴着眼镜站在借书台后面。你想借哪一本？', scenes: ['librarian'] },
    { title: '方向盘后面的司机', lead: '黄色的公交车停在站牌边，司机坐在方向盘后面。坐他开的车，你最喜欢哪个位置？', scenes: ['bus-driver'] },
    { title: '楼下的保安叔叔', lead: '每天进出小区，他都笑着跟我们打招呼。你跟他熟吗？', scenes: [PHOTO_SLOT] },
    { title: '早餐摊的阿姨', lead: '天还没亮，早餐摊的阿姨就忙起来了。你常买她做的什么？', scenes: [PHOTO_SLOT] },
    { title: '小区里的园丁', lead: '花坛里的花开得正好，都是他种的。你注意过他的手吗？', scenes: [PHOTO_SLOT] },
  ],
  stranger: [
    { title: '清晨的环卫工', lead: '天刚亮的时候，路上已经有人在扫地了。', scenes: [PHOTO_SLOT] },
    { title: '雨天的快递员', lead: '雨很大，他穿着雨衣把包裹送到门口。', scenes: [PHOTO_SLOT] },
    { title: '天刚亮的街道', lead: '天刚蒙蒙亮，街上有一位穿橙色工作服的环卫工在扫落叶。你有没有跟他说过话？', scenes: ['street-cleaner'] },
    { title: '雨里的快递员', lead: '雨下得很大，快递员骑着车，后座绑着一个大纸箱，地上的水花溅了起来。看见他，你想说什么？', scenes: ['rain-delivery'] },
    { title: '修鞋的老人', lead: '巷口有个修鞋的老人，低着头一针一线地缝。他修过你的鞋吗？', scenes: [PHOTO_SLOT] },
    { title: '收废品的叔叔', lead: '他骑着三轮车走街串巷，喇叭里一遍遍地喊。你听过那声音吗？', scenes: [PHOTO_SLOT] },
    { title: '公园里练字的老爷爷', lead: '他提着一支大毛笔，在地上写字。你停下来看过吗？', scenes: [PHOTO_SLOT] },
  ],
  self: [
    { title: '这就是我', lead: '对着镜子看看自己，说说你是个什么样的人。', scenes: [PHOTO_SLOT] },
    { title: '我的小毛病', lead: '每个人都有自己的小毛病，你的呢？', scenes: [PHOTO_SLOT] },
    { title: '镜子里的我', lead: '镜子里的那个孩子，和镜子外站着的，是同一个人。你会怎么介绍他？', scenes: ['mirror-self'] },
    { title: '我的名字', lead: '你的名字是谁取的？它有什么来历？', scenes: [PHOTO_SLOT] },
    { title: '我长高了', lead: '门框上那道铅笔线，又往上挪了一格。', scenes: [PHOTO_SLOT] },
  ],
  'people-around': [
    { title: '形形色色的人', lead: '身边有各种各样的人，选一个让你印象最深的写。', scenes: [PHOTO_SLOT] },
    { title: '街头众生', lead: '走在街上，你会看到哪些不同的人？他们在做什么？', scenes: [PHOTO_SLOT] },
    { title: '门口的邻居阿姨', lead: '阿姨提着菜篮子，站在门口笑着跟我打招呼。你们家跟她熟吗？', scenes: ['neighbor'] },
    { title: '身边都有谁', lead: '草地上站着一排人，有的在说，有的在笑，标签上写着同学、路人、邻居。你身边有哪几种人？', scenes: ['all-kinds-people'] },
    { title: '楼下下棋的爷爷们', lead: '棋盘一摆，围过来一圈人。他们在争什么？', scenes: [PHOTO_SLOT] },
    { title: '广场上跳舞的奶奶', lead: '音乐一响，她们就排好了队。你留意过谁？', scenes: [PHOTO_SLOT] },
  ],
  'dream-job': [
    { title: '我的理想', lead: '长大后你想做什么？为什么想做这个？', scenes: [PHOTO_SLOT] },
    { title: '我想成为的人', lead: '身边有谁是你想成为的样子？说说他哪里让你佩服。', scenes: [PHOTO_SLOT] },
    { title: '如果我当医生', lead: '穿上白大褂，你会怎么给病人看病？', scenes: [PHOTO_SLOT] },
    { title: '我想当一名老师', lead: '站在讲台上，你会怎么讲第一节课？', scenes: [PHOTO_SLOT] },
    { title: '如果我是厨师', lead: '灶台前围裙一系，你打算先做哪一道菜？', scenes: [PHOTO_SLOT] },
  ],

  /* ---- 写事 ---- */
  'first-time': [
    {
      title: '第一次骑自行车',
      lead: '刚开始很难，后来你学会了。当时什么感觉？',
      scenes: [PHOTO_SLOT, PHOTO_SLOT],
    },
    {
      title: '第一次做饭',
      lead: '你系上围裙，站到了灶台前……',
      scenes: [PHOTO_SLOT, PHOTO_SLOT, PHOTO_SLOT],
    },
    { title: '第一次上台', lead: '台下的同学都看着你，你的手心里全是汗。', scenes: [PHOTO_SLOT] },
    { title: '第一次独睡', lead: '关了灯，房间里黑黑的，你给自己壮了壮胆。', scenes: [PHOTO_SLOT] },
    { title: '我会骑车了', lead: '我骑着车飞快地往前，爸爸在后面追着跑。学会的那一天，你还记得吗？', scenes: ['bike-ride'] },
    { title: '我要露一手了', lead: '案板、蔬菜、鸡蛋都摆好了，围裙也系上了。我准备做一道什么菜？', scenes: ['cook-start'] },
    { title: '厨房里的“事故”', lead: '面粉飘得到处都是，碗翻了，锅里的东西也糊了。哪一步出了问题？', scenes: ['cook-mess'] },
    { title: '端上桌的那一刻', lead: '一大家子围坐在桌边，中间那盘菜还冒着热气。他们尝了以后说了什么？', scenes: ['cook-done'] },
    { title: '幕布拉开的时候', lead: '幕布拉开，一束灯光只照着台上的我，台下一片黑压压的脑袋。你紧张的时候怎么办？', scenes: ['stage-nervous'] },
    { title: '第一次坐火车', lead: '车窗外的树一棵接一棵往后跑。你数得过来吗？', scenes: [PHOTO_SLOT] },
  ],
  unforgettable: [
    { title: '那一次，我很难忘', lead: '有一件事，过了很久你还记得。', scenes: [PHOTO_SLOT] },
    {
      title: '第一次春游',
      lead: '背上小书包，我们出发啦！',
      scenes: [PHOTO_SLOT, PHOTO_SLOT, PHOTO_SLOT],
    },
    { title: '得奖了', lead: '站在领奖台上，台下响起一片掌声。', scenes: [PHOTO_SLOT] },
    { title: '翻相册', lead: '厚厚的相册摊在桌上，一页一页都是照片。哪一张让你停了下来？', scenes: ['memory-album'] },
    { title: '挥手告别那天', lead: '教学楼前，我们几个挥着手，校门口的横幅还没收。这六年里，你最难忘的是什么？', scenes: ['farewell-school'] },
    { title: '那一次我哭了', lead: '有一件事让我掉了眼泪。现在想起来，是什么感觉？', scenes: [PHOTO_SLOT] },
  ],
  'warm-moment': [
    { title: '他扶了我一把', lead: '你摔倒了，有人伸出了手。', scenes: [PHOTO_SLOT] },
    { title: '雨中送伞', lead: '雨越下越大，校门口出现了一个熟悉的身影。', scenes: [PHOTO_SLOT] },
    { title: '奶奶的针线盒', lead: '那个旧旧的盒子，里面装满了故事。', scenes: [PHOTO_SLOT] },
    { title: '摔了一跤', lead: '自行车歪倒在小路上，我坐在地上揉着膝盖，一只手伸了过来。那一刻你在想什么？', scenes: ['bike-fail'] },
    { title: '伸过来的那只手', lead: '我坐在地上抱着膝盖，一只手伸到了我面前。那只手是谁的？', scenes: ['help-hand'] },
    { title: '雨里的一把伞', lead: '雨下得正大，橙色的伞下挤着两个人，地上积起了水洼。这把伞是谁送来的？', scenes: ['umbrella-rain'] },
    { title: '生病那天', lead: '我盖着被子躺在床上，床头放着温度计和药，妈妈坐在旁边陪着我。生病的时候最想吃什么？', scenes: ['sick'] },
    { title: '借我半块橡皮', lead: '考试时我忘了带橡皮，同桌掰了一半递过来。', scenes: [PHOTO_SLOT] },
  ],
  activity: [
    { title: '热闹的运动会', lead: '哨声一响，跑道上的同学冲了出去。', scenes: [PHOTO_SLOT, PHOTO_SLOT] },
    {
      title: '快乐的春游',
      lead: '背上小书包，我们出发啦！',
      scenes: [PHOTO_SLOT, PHOTO_SLOT, PHOTO_SLOT],
    },
    { title: '班级大扫除', lead: '大家分工合作，教室变干净了。', scenes: [PHOTO_SLOT] },
    { title: '记一次游戏', lead: '你和同学玩了什么游戏？怎么玩的？', scenes: [PHOTO_SLOT] },
    { title: '多彩的活动', lead: '你参加过什么活动？把场面和心情都写下来。', scenes: [PHOTO_SLOT] },
    { title: '运动会那天', lead: '操场上挂满了彩旗，跑道上四个人正在冲刺，内圈的同学在挥手。你参加的是哪个项目？', scenes: ['sports-day'] },
    { title: '坐上春游的大巴', lead: '黄色的大巴停在路边，同学们排着队上车，老师在旁边挥手。你在车上坐在谁旁边？', scenes: ['spring-outing-bus'] },
    { title: '草地上的野餐', lead: '粉格子的布铺在草地上，篮子和食物摆了一地，大家围坐成一圈。谁带的东西最好吃？', scenes: ['spring-outing-picnic'] },
    { title: '放风筝', lead: '我举着线，风筝飞到了半空，泡泡和花瓣一起飘着。你的风筝飞得高吗？', scenes: ['spring-outing-play'] },
    { title: '擦窗还是扫地', lead: '一个擦窗，一个扫地，一个提着水桶，桌椅都搬到了一边。你抢到了哪个活儿？', scenes: ['cleaning-class'] },
    { title: '拔河', lead: '两队人弯着腰用力拉，绳子中间系着红布条，旁边的人在喊。你们班赢了吗？', scenes: ['play-game'] },
    { title: '操场上的活动', lead: '跑道上有人在跑步、有人在跳绳，横幅上写着运动会。你最喜欢哪一种活动？', scenes: ['colorful-activity'] },
    { title: '聚光灯下的琴声', lead: '聚光灯下有一架钢琴，我坐在凳子上弹，音符飘在旁边。你最拿手的是什么？', scenes: ['my-talent'] },
    { title: '学校的读书节', lead: '教室里摆满了书，大家挑得眼花缭乱。你挑了哪一本？', scenes: [PHOTO_SLOT] },
  ],
  mistake: [
    { title: '我撒了一个谎', lead: '说出来之后，心里反而更难受了。', scenes: [PHOTO_SLOT] },
    { title: '打碎的花瓶', lead: '「哐当」一声，屋子里一下子安静了。', scenes: [PHOTO_SLOT] },
    { title: '迟到了', lead: '铃响了才跑到教室门口，老师正看着我。', scenes: [PHOTO_SLOT] },
    { title: '考试前夜', lead: '明天要考试，台灯下翻了一遍又一遍课本。', scenes: [PHOTO_SLOT] },
    { title: '说出来了', lead: '我低着头站着，大人蹲下来，跟我平视着说话。承认的那一刻，你心里是什么感觉？', scenes: ['lie-truth'] },
    { title: '花瓶碎了以后', lead: '地板上散着一堆碎片和几朵花，小猫蹲在角落里看着。接下来你做了什么？', scenes: ['broken-vase'] },
    { title: '跑进校门的那天', lead: '我背着书包一路飞跑，校门口的钟已经指向八点十分。那天为什么会晚？', scenes: ['late'] },
    { title: '弄丢的那本书', lead: '从图书馆借的书找不到了，我把书包翻了个底朝天。', scenes: [PHOTO_SLOT] },
  ],
  'lost-found': [
    { title: '走丢的那个下午', lead: '一回头，妈妈不见了。', scenes: [PHOTO_SLOT, PHOTO_SLOT] },
    { title: '摔了一跤之后', lead: '膝盖火辣辣的，可我记住了这一跤。', scenes: [PHOTO_SLOT] },
    { title: '生病了', lead: '头很烫，妈妈让我躺在床上别动。', scenes: [PHOTO_SLOT] },
    { title: '找不到妈妈了', lead: '街上全是走来走去的大人，我仰着头四处张望，却一个也不认识。那个时候你怕不怕？', scenes: ['lost-crowd'] },
    { title: '终于找到妈妈了', lead: '妈妈蹲下来张开手臂，我一头扑进她怀里。找到的那一刻，你说了什么？', scenes: ['found-mom'] },
    { title: '突然停电了', lead: '灯一下子全灭了，屋里黑得看不见手指。', scenes: [PHOTO_SLOT] },
  ],
  milestone: [
    { title: '过生日', lead: '蛋糕上插着蜡烛，大家围在一起唱生日歌。', scenes: [PHOTO_SLOT] },
    { title: '毕业了', lead: '最后一次排队站在操场上，帽子一抛就散了。', scenes: [PHOTO_SLOT] },
    { title: '搬新家', lead: '纸箱子堆了一屋，新房间还空空的。', scenes: [PHOTO_SLOT] },
    { title: '难忘小学生活', lead: '六年的小学时光，你最难忘的是什么？', scenes: [PHOTO_SLOT] },
    { title: '我的拿手好戏', lead: '你最擅长什么？把过程写具体。', scenes: [PHOTO_SLOT] },
    { title: '上台领奖', lead: '我站在台上举着奖杯，台下的同学都在鼓掌。你最想把这个奖拿给谁看？', scenes: ['award'] },
    { title: '新家的第一晚', lead: '新房间里堆着好几个大纸箱，我抱着自己那个小的。搬到新家的第一晚，你睡得着吗？', scenes: ['moving'] },
    { title: '考试前一夜', lead: '台灯亮着，课本摊在桌上，墙上的钟走得很慢。考试前一夜，你都在想什么？', scenes: ['exam-nervous'] },
    { title: '毕业那天', lead: '我们几个戴着毕业帽站成一排，有人手里捧着花。你最舍不得谁？', scenes: ['graduation'] },
    { title: '第一次自己睡', lead: '房间里蓝幽幽的，窗外有月亮和星星，被子鼓起来，只露出一双眼睛。你后来睡着了吗？', scenes: ['sleep-alone'] },
    { title: '蜡烛和生日歌', lead: '蛋糕上插着五根蜡烛，家人站在两边，屋里挂着彩旗和气球。你许了什么愿？', scenes: ['birthday'] },
    { title: '我学会游泳了', lead: '第一次不用浮板游到对岸，那是什么感觉？', scenes: [PHOTO_SLOT] },
  ],
  observe: [
    { title: '观察日记', lead: '连续观察一样东西的变化，记录下来。', scenes: [PHOTO_SLOT] },
    { title: '我做了一项小实验', lead: '做实验的时候你看到了什么？按步骤写下来。', scenes: [PHOTO_SLOT] },
    { title: '它今天变了样', lead: '你每天观察的那株植物，今天变成什么样了？', scenes: [PHOTO_SLOT] },
    { title: '一次小实验', lead: '烧杯里冒着气泡，滴管往里面滴粉色的液体，我一边看一边记。你猜会变成什么颜色？', scenes: ['experiment'] },
    { title: '蒜苗长到第七天', lead: '日记本摊在桌上，旁边那盆蒜头长出了三根绿苗，墙上的日历写着第七天。这几天它变了多少？', scenes: ['observe-diary'] },
    { title: '展示台前介绍它', lead: '展示台上放着电脑，旁边标着外形、功能、用途。你想介绍哪一样东西？', scenes: ['introduce-thing'] },
    { title: '豆子发芽了', lead: '泡在水里的豆子，第三天冒出了小白芽。', scenes: [PHOTO_SLOT] },
  ],
  letter: [
    { title: '给亲人的一封信', lead: '给远方的亲人写封信，说说你的近况。', scenes: [PHOTO_SLOT] },
    { title: '我想对您说', lead: '有什么话想对爸爸妈妈说？写下来吧。', scenes: [PHOTO_SLOT] },
    { title: '读后感', lead: '读完一本书，你最大的感受是什么？', scenes: [PHOTO_SLOT] },
    { title: '给亲人写一封信', lead: '桌上有信封、邮票和信纸，铅笔已经拿在手里了。你最想写给谁？', scenes: ['write-letter'] },
    { title: '读一本好书', lead: '书架上排满了书，桌上摊开一本，笔记本上已经写了几行。这本书讲了什么？', scenes: ['reading-notes'] },
    { title: '给老师的一封信', lead: '快毕业了，有些话想写在信里告诉老师。', scenes: [PHOTO_SLOT] },
  ],
  // ⛔ 2026-10-02：`look-picture` 的 6 道模板（看图写话 / 连环图编故事 / …）
  //   连同标签一起删了，理由见上面 `TOPIC_TAGS` 里的说明。
  custom: [
    { title: '传统节日', lead: '你家是怎么过传统节日的？写一写过程。', scenes: [PHOTO_SLOT] },
    { title: '家乡的风俗', lead: '你的家乡有什么特别的风俗？介绍给大家。', scenes: [PHOTO_SLOT] },
    { title: '过节了', lead: '天上挂着灯笼，烟花炸开了，桌上摆着月饼和饺子。你们家过节最热闹的是哪一刻？', scenes: ['festival'] },
    { title: '过节时的老规矩', lead: '两座老房子之间挂着灯笼和鞭炮，桌上摆着碗和汤圆。你们家乡有什么特别的讲究？', scenes: ['hometown-custom'] },
    { title: '端午的粽子', lead: '粽叶在手里一折，米就装进去了。你会包吗？', scenes: [PHOTO_SLOT] },
    { title: '元宵看花灯', lead: '街上挂满了花灯，人挤着人往前挪。你猜中了哪个灯谜？', scenes: [PHOTO_SLOT] },
  ],
  // ⛔ 2026-10-02：`comic` 的 5 道模板（一幅漫画的启示 / 漫画里的道理 / …）
  //   连同标签一起删了，理由见上面 `TOPIC_TAGS` 里的说明。

  /* ---- 状物 ---- */
  pet: [
    { title: '我家的小猫', lead: '它长什么样？平时最喜欢干什么？', scenes: [PHOTO_SLOT] },
    { title: '小狗花花', lead: '每次我回家，它都会第一个冲出来。', scenes: [PHOTO_SLOT] },
    { title: '窗外的小鸟', lead: '每天早上，它都会停在窗台上唱歌。', scenes: [PHOTO_SLOT] },
    { title: '我的小金鱼', lead: '鱼缸里的小金鱼，尾巴一摆一摆地游。', scenes: [PHOTO_SLOT] },
    { title: '小乌龟', lead: '它的壳上画着花纹，头一伸一缩的。', scenes: [PHOTO_SLOT] },
    { title: '国宝大熊猫', lead: '黑白相间、圆滚滚的大熊猫，你了解多少？', scenes: [PHOTO_SLOT] },
    { title: '晒太阳的猫', lead: '阳光斜斜地照在地板上，橘猫闭着眼睛趴在光里，旁边滚着一个毛线球。它睡着的时候是什么样子？', scenes: ['cat-sun'] },
    { title: '小狗冲过来了', lead: '门一开，小狗摇着尾巴朝我冲过来，我张开手。它平时最黏谁？', scenes: ['dog-welcome'] },
    { title: '窗边的小鸟', lead: '一只蓝色的小鸟停在窗台上，旁边是一盆小植物，我安静地看着它。它待了多久？', scenes: ['bird-window'] },
    { title: '鱼缸里的金鱼', lead: '两条金鱼在水草间游来游去，缸底铺着彩色石子，水面冒出一串小气泡。它们一天要游多少圈？', scenes: ['goldfish'] },
    { title: '水盆里的小乌龟', lead: '浅水盆里趴着一只小乌龟，头和四条腿都伸在外面，旁边撒着几粒龟粮。它平时都躲在哪里？', scenes: ['turtle'] },
    { title: '竹林里的大熊猫', lead: '竹林里，一只胖熊猫坐着啃竹子，黑眼圈、圆耳朵。关于它，你都知道些什么？', scenes: ['panda'] },
    { title: '我的小兔子', lead: '它竖着两只长耳朵，啃胡萝卜的样子很好笑。它平时最爱吃什么？', scenes: [PHOTO_SLOT] },
    { title: '学说话的鹦鹉', lead: '它学着人说话，学得惟妙惟肖。它学会过哪一句？', scenes: [PHOTO_SLOT] },
    { title: '蚂蚁搬家', lead: '一队蚂蚁排着长队往前爬。它们要去哪儿？', scenes: [PHOTO_SLOT] },
  ],
  plant: [
    { title: '窗台上的绿萝', lead: '它一直在悄悄地长，你发现了吗？', scenes: [PHOTO_SLOT] },
    { title: '蒲公英的旅行', lead: '轻轻一吹，小伞兵们就飞走了。', scenes: [PHOTO_SLOT] },
    { title: '池塘里的荷花', lead: '夏天到了，池塘里的荷花开了。', scenes: [PHOTO_SLOT] },
    { title: '我的仙人掌', lead: '它浑身长着小刺，却开出了小花。', scenes: [PHOTO_SLOT] },
    { title: '一盆绿萝', lead: '书架上的绿萝长得很好，心形的叶子从盆边垂下来，旁边是透光的窗。你是怎么养它的？', scenes: ['pothos'] },
    { title: '蒲公英飞了', lead: '一朵白色的蒲公英正在散开，种子顺着风飘向天空。你吹过蒲公英吗？', scenes: ['dandelion'] },
    { title: '荷叶上的蜻蜓', lead: '池塘上铺着圆圆的荷叶，一朵荷花正开着，旁边还有一个花苞，蜻蜓停在花尖上。你见过荷花是怎么开的吗？', scenes: ['lotus'] },
    { title: '开花的仙人掌', lead: '花盆里的仙人掌浑身是小刺，顶上却开了一朵小红花。它多久才开一次花？', scenes: ['cactus'] },
    { title: '窗台上的多肉', lead: '胖乎乎的叶子挤在一起，晒着太阳。你多久给它浇一次水？', scenes: [PHOTO_SLOT] },
    { title: '门口的桂花树', lead: '一到秋天，满树的小花，整条街都香了。你闻到过吗？', scenes: [PHOTO_SLOT] },
    { title: '窗外的梧桐树', lead: '它一年四季都在变。你见过它哪几种样子？', scenes: [PHOTO_SLOT] },
  ],
  stationery: [
    { title: '我的小书包', lead: '书包里装着什么？它陪了你多久了？', scenes: [PHOTO_SLOT] },
    { title: '一块橡皮的心里话', lead: '如果橡皮会说话，它想说什么？', scenes: [PHOTO_SLOT] },
    { title: '我的文具盒', lead: '打开文具盒，就像打开一个小房子。', scenes: [PHOTO_SLOT] },
    { title: '椅背上的书包', lead: '书包挂在椅背上，桌上摊着书和铅笔。你的书包里都装了什么？', scenes: ['backpack'] },
    { title: '打开文具盒', lead: '文具盒一打开，钢笔、铅笔、直尺、橡皮各就各位。哪一件用得最多？', scenes: ['pencil-case'] },
    { title: '越写越短的铅笔', lead: '它越写越短，最后只剩下一小截。你舍得扔吗？', scenes: [PHOTO_SLOT] },
    { title: '尺子上的刻度', lead: '一格一格的刻度，量过很多东西。它量过最长的是什么？', scenes: [PHOTO_SLOT] },
    { title: '削笔刀', lead: '转几圈，铅笔就尖了，下面堆着一层木屑。', scenes: [PHOTO_SLOT] },
  ],
  treasure: [
    { title: '外婆的针线盒', lead: '那个旧旧的盒子，里面装满了故事。', scenes: [PHOTO_SLOT] },
    { title: '我的旧玩具', lead: '它已经很旧了，可你还是舍不得扔。', scenes: [PHOTO_SLOT] },
    { title: '一张旧照片', lead: '翻相册的时候，一张泛黄的照片掉了出来。', scenes: [PHOTO_SLOT] },
    { title: '我的小闹钟', lead: '每天早上都是它叫我起床，叮铃铃的。', scenes: [PHOTO_SLOT] },
    { title: '我的房间', lead: '推开房门，每一样东西都是你的好朋友。', scenes: [PHOTO_SLOT] },
    { title: '介绍一种事物', lead: '选一种你了解的东西，把它的外形、功能、用途介绍清楚。', scenes: [PHOTO_SLOT] },
    { title: '我的乐园', lead: '你最喜欢待的地方是哪里？为什么？', scenes: [PHOTO_SLOT] },
    { title: '打开的针线盒', lead: '打开的针线盒里排着五轴彩线，剪刀、顶针、扣子都在。这些东西你见过谁用？', scenes: ['sewing-box'] },
    { title: '掉了耳朵的小熊', lead: '架子上坐着一只掉了耳朵、打着补丁的小熊，阳光暖暖地照着它。它陪了你多久？', scenes: ['old-toy'] },
    { title: '相框里的老照片', lead: '相框里那张照片已经泛黄了，旁边搁着一本书和一支钢笔。照片上是什么地方？', scenes: ['old-photo'] },
    { title: '奶奶的顶针', lead: '小小的顶针上满是凹坑，奶奶戴了一辈子。你见她用过吗？', scenes: [PHOTO_SLOT] },
    { title: '我的第一张奖状', lead: '它贴在墙上，边角已经卷起来了。那是哪一次得的奖？', scenes: [PHOTO_SLOT] },
    { title: '爸爸送的手表', lead: '表带有点松了，可我一直戴着。它是什么时候送的？', scenes: [PHOTO_SLOT] },
  ],
  food: [
    { title: '外婆包的饺子', lead: '薄薄的皮，鼓鼓的馅，冒着热气。', scenes: [PHOTO_SLOT] },
    { title: '一碗热汤面', lead: '冬天放学回家，桌上有一碗面。', scenes: [PHOTO_SLOT] },
    { title: '推荐一本书', lead: '你读过的好书，像推荐好朋友一样推荐给同学吧。', scenes: [PHOTO_SLOT] },
    { title: '包饺子', lead: '案板上一排饺子刚包好，擀面杖和面粉还在旁边，锅里的水开了。你包的那只像什么？', scenes: ['dumplings'] },
    { title: '面碗里的热气', lead: '大碗里的面冒着热气，卧着一个鸡蛋，还漂着几根青菜。这碗面是谁做的？', scenes: ['noodle-soup'] },
    { title: '妈妈煮的粥', lead: '早上起床，桌上有一碗热腾腾的粥。里面都放了什么？', scenes: [PHOTO_SLOT] },
    { title: '一根冰棍', lead: '夏天的午后，冰棍化得比吃得还快。你最喜欢什么口味？', scenes: [PHOTO_SLOT] },
    { title: '奶奶做的红烧肉', lead: '一掀锅盖，满屋子都是香味。你等得及吗？', scenes: [PHOTO_SLOT] },
  ],
  'life-goods': [
    { title: '我的小台灯', lead: '每天晚上，它都亮着陪我写作业。它是什么样子的？', scenes: [PHOTO_SLOT] },
    { title: '我家的电风扇', lead: '天热的时候，它转起来呼呼地响。它给家里带来了什么？', scenes: [PHOTO_SLOT] },
    { title: '下雨天的雨伞', lead: '雨点打在伞面上，滴滴答答的。这把伞有什么故事？', scenes: [PHOTO_SLOT] },
    { title: '叫我起床的闹钟', lead: '每天早上，它准时把我叫醒。你喜欢它吗？', scenes: [PHOTO_SLOT] },
    { title: '我的水杯', lead: '它每天跟着我去上学，里面装满了水。它是什么颜色的？', scenes: [PHOTO_SLOT] },
    { title: '家里的冰箱', lead: '打开冰箱门，里面整整齐齐地摆着什么？', scenes: [PHOTO_SLOT] },
    { title: '洗衣机转起来了', lead: '洗衣机轰隆隆地转，衣服在里面翻跟头。你帮妈妈晾过衣服吗？', scenes: [PHOTO_SLOT] },
    { title: '墙角的扫帚', lead: '墙角立着一把扫帚，扫过很多年。它扫过哪些地方？', scenes: [PHOTO_SLOT] },
    { title: '墙上的挂钟', lead: '秒针一格一格地走，从来不休息。你盯着它看过吗？', scenes: [PHOTO_SLOT] },
    { title: '家里的遥控器', lead: '它总是找不到，一找就要找半天。它平时放在哪儿？', scenes: [PHOTO_SLOT] },
    { title: '门边的一串钥匙', lead: '钥匙挂在门边，走起路来叮叮当当。哪一把是你的？', scenes: [PHOTO_SLOT] },
    { title: '洗手间的镜子', lead: '每天早上，我都在它面前刷牙洗脸。它照出过什么？', scenes: [PHOTO_SLOT] },
    { title: '我的小拖鞋', lead: '一进门就换上它，脚底下软软的。它是什么样子的？', scenes: [PHOTO_SLOT] },
    { title: '水开了', lead: '壶嘴咕嘟咕嘟冒着白气，水开了。你听过这个声音吗？', scenes: [PHOTO_SLOT] },
    { title: '电吹风呼呼地吹', lead: '洗完头，头发湿漉漉的。妈妈是怎么帮你吹干的？', scenes: [PHOTO_SLOT] },
    { title: '手电筒的光', lead: '停电的晚上，一道光柱照在墙上。你用它做过什么？', scenes: [PHOTO_SLOT] },
    { title: '会唱歌的收音机', lead: '爷爷的收音机里，每天放着不一样的声音。你听过吗？', scenes: [PHOTO_SLOT] },
    { title: '门铃响了', lead: '叮咚一声，是谁来了？你猜过多少次？', scenes: [PHOTO_SLOT] },
    { title: '阳台上的晾衣架', lead: '一排衣服在风里轻轻晃。哪一件是你的？', scenes: [PHOTO_SLOT] },
    { title: '我的保温杯', lead: '冬天里，打开盖子还冒着热气。它陪了你多久？', scenes: [PHOTO_SLOT] },
    { title: '我的存钱罐', lead: '硬币扔进去，叮当一声。你攒了多久了？', scenes: [PHOTO_SLOT] },
    { title: '我的小牙刷', lead: '它站在杯子里，刷毛有点歪了。你多久换一次？', scenes: [PHOTO_SLOT] },
    { title: '雨天的雨靴', lead: '踩进水洼里，啪嗒啪嗒的。你喜欢穿它吗？', scenes: [PHOTO_SLOT] },
    { title: '家里的窗帘', lead: '早上一拉，阳光就涌进来。你喜欢开着还是拉着？', scenes: [PHOTO_SLOT] },
    { title: '鞋柜里的鞋', lead: '一打开鞋柜，大大小小的鞋排在一起。哪一双最旧？', scenes: [PHOTO_SLOT] },
    { title: '书包上的小挂件', lead: '书包上挂着一个小挂件，走起路来一晃一晃。它是谁送的？', scenes: [PHOTO_SLOT] },
    { title: '电饭煲冒气了', lead: '厨房里飘出米饭的香味，锅盖边冒着白气。今天吃什么？', scenes: [PHOTO_SLOT] },
    { title: '空调吹出来的风', lead: '夏天一进屋，凉风就扑过来。你最喜欢哪个温度？', scenes: [PHOTO_SLOT] },
    { title: '一把旧椅子', lead: '那把椅子有一条腿短了一截，坐上去会晃。它陪了家里多久？', scenes: [PHOTO_SLOT] },
    { title: '我的小书桌', lead: '桌面上有铅笔印和几道划痕。你在这张桌上写过什么？', scenes: [PHOTO_SLOT] },
    { title: '门口的擦鞋垫', lead: '进门之前先在它上面踩两脚。你注意过它吗？', scenes: [PHOTO_SLOT] },
  ],

  /* ---- 想象 ---- */
  'if-i': [
    { title: '假如我有一双翅膀', lead: '你想飞到哪里去？会看到什么？', scenes: [PHOTO_SLOT] },
    { title: '假如我是一阵风', lead: '风会去哪里？会做什么事？', scenes: [PHOTO_SLOT] },
    { title: '假如我能听懂动物说话', lead: '那它们会告诉你什么秘密？', scenes: [PHOTO_SLOT] },
    { title: '假如我只有蚂蚁大', lead: '忽然你变得只有蚂蚁那么小，世界变成了什么样？', scenes: [PHOTO_SLOT] },
    { title: '假如我会飞', lead: '我背着白色的翅膀飞在半空，脚下是小房子和绿树。你想先飞到哪儿去？', scenes: ['fly-sky'] },
    { title: '假如我是风', lead: '我吹过草地，把两棵树吹弯了腰，叶子在空中乱飞。你想吹到哪里去？', scenes: ['wind-travel'] },
    { title: '假如我有一支神笔', lead: '画什么就有什么。你第一笔会画什么？', scenes: [PHOTO_SLOT] },
  ],
  future: [
    { title: '未来的学校', lead: '一百年后的学校，会是什么样子？', scenes: [PHOTO_SLOT] },
    { title: '二十年后的我', lead: '二十年后，你在做什么工作？过着怎样的生活？', scenes: [PHOTO_SLOT] },
    { title: '我的机器人朋友', lead: '它有方方的脑袋，天线一闪一闪的。', scenes: [PHOTO_SLOT] },
    { title: '太空旅行', lead: '坐上火箭，嗖的一下就到了太空里。', scenes: [PHOTO_SLOT] },
    { title: '飘在天上的学校', lead: '半圆形的建筑飘在天上，中间连着一条空中走廊。你希望未来的学校多一样什么？', scenes: ['future-school'] },
    { title: '未来的我', lead: '我抬头想着，头顶的气泡里出现了一个戴头盔的宇航员。你长大以后想成为谁？', scenes: ['future-me'] },
    { title: '跳到未来去看', lead: '大钟的指针转出一圈圈螺旋，前面是未来城市的影子。你想跳到哪一年去看看？', scenes: ['time-travel'] },
    { title: '我的发明设计图', lead: '设计图上画着一双带翅膀的鞋，旁边亮着一个灯泡。你想发明什么？', scenes: ['invention'] },
    { title: '未来的家', lead: '一进门灯就自己亮了，饭也刚好做好。你还想要什么？', scenes: [PHOTO_SLOT] },
  ],
  fairy: [
    { title: '《龟兔赛跑》新编', lead: '如果它们再比一次，会发生什么？', scenes: [PHOTO_SLOT] },
    { title: '卖火柴的小女孩来了我家', lead: '如果她推开门走了进来……', scenes: [PHOTO_SLOT] },
    { title: '龟兔赛跑', lead: '跑道上乌龟还在慢慢往前爬，兔子却靠在树下睡着了。这个故事后来怎么样了？', scenes: ['turtle-rabbit'] },
    { title: '雪夜里的火柴', lead: '雪夜的街上只有一个小女孩，她手里那根火柴亮着，旁边的窗户里透着暖黄的灯光。她看到了什么？', scenes: ['girl-visit'] },
    { title: '笔尖冒出的小人', lead: '笔记本摊在桌上，铅笔在写，笔尖冒出了一个小人和几点星光。如果笔自己会写，它会写什么？', scenes: ['pen-story'] },
    { title: '《狐狸和乌鸦》新编', lead: '乌鸦这次没开口，狐狸又想出了什么办法？', scenes: [PHOTO_SLOT] },
  ],
  talking: [
    { title: '如果书包会说话', lead: '它每天被你背着，肯定有很多话想说。', scenes: [PHOTO_SLOT] },
    {
      title: '一只铅笔的冒险',
      lead: '它从文具盒里溜了出去……',
      scenes: [PHOTO_SLOT, PHOTO_SLOT, PHOTO_SLOT],
    },
    { title: '会说话的橡皮', lead: '桌上的粉色橡皮长着一张笑脸，它忽然开口了。它想跟你说什么？', scenes: ['eraser-talking'] },
    { title: '它们都在说话', lead: '林间空地上坐着一只猫、一只狗和一只小鸟，每一个头顶都冒出一个对话气泡。它们在聊什么？', scenes: ['talk-animals'] },
    { title: '会说话的书包', lead: '椅背上的蓝书包长着一张笑脸，它开口了，桌上的作业本还没写完。它想说什么？', scenes: ['talking-bag'] },
    { title: '铅笔跑了', lead: '铅笔从桌上跳下来，一路朝门口跑，橡皮和本子都看呆了。它为什么要跑？', scenes: ['pencil-escape'] },
    { title: '铅笔的历险', lead: '一支大铅笔站在摊开的巨书上，书页像山谷一样起伏。它在路上遇见了谁？', scenes: ['pencil-adventure'] },
    { title: '铅笔回家了', lead: '红色笔袋一打开，彩笔和橡皮都挤在里面，那支跑掉的铅笔也回到了队伍里。它们会怎么欢迎它？', scenes: ['pencil-home'] },
    { title: '如果台灯会说话', lead: '它每天晚上都亮着陪你，肯定有话想说。', scenes: [PHOTO_SLOT] },
  ],
  dream: [
    { title: '一个奇怪的梦', lead: '梦里的事都不太讲道理，可又很真实。', scenes: [PHOTO_SLOT] },
    { title: '我梦见了未来', lead: '醒来的时候，我还记得那个画面。', scenes: [PHOTO_SLOT] },
    { title: '海底探险', lead: '梦里我变成了一条鱼，在珊瑚丛里穿来穿去。', scenes: [PHOTO_SLOT] },
    { title: '时间快进', lead: '「嗖」的一声，我到了好多好多年以后。', scenes: [PHOTO_SLOT] },
    { title: '奇怪的梦', lead: '紫色的天上，房子倒着长，鱼在云里游，我躺在云朵上睡着了。这个梦里还有什么？', scenes: ['weird-dream'] },
    { title: '我梦见自己会飞', lead: '梦里的风从耳边吹过去。你飞过了哪些地方？', scenes: [PHOTO_SLOT] },
  ],
  'sci-fi': [
    { title: '插上科学的翅膀飞', lead: '展开想象，写一个科幻故事。', scenes: [PHOTO_SLOT] },
    { title: '我的奇思妙想', lead: '你想发明什么东西？它有什么功能？', scenes: [PHOTO_SLOT] },
    { title: '宇宙探险记', lead: '坐上火箭，去宇宙里探险。', scenes: [PHOTO_SLOT, PHOTO_SLOT] },
    { title: '珊瑚丛里的小鱼', lead: '蓝色的海水里长着珊瑚和水草，一群小鱼从身边游过，远处还飘着一个潜水头盔。海底藏着什么宝贝？', scenes: ['underwater'] },
    { title: '飞向带光环的星球', lead: '黑色的星空里有一颗带光环的星球，火箭拖着火焰从旁边飞过。你在太空里最想看见什么？', scenes: ['space'] },
    { title: '方脑袋的机器人', lead: '方脑袋的机器人有天线和齿轮关节，它正朝我挥手。你希望它会做什么？', scenes: ['robot-friend'] },
    { title: '插上科学的翅膀', lead: '深蓝色的太空里，火箭拖着火焰飞，远处是一颗带光环的星球。你想飞到哪儿？', scenes: ['sci-fi-fly'] },
    { title: '会飞的汽车', lead: '堵车时按一下按钮，它就升到了半空。', scenes: [PHOTO_SLOT] },
  ],
  deform: [
    { title: '变形记', lead: '假如你变成了另一种东西，你的世界会变成什么样？', scenes: [PHOTO_SLOT] },
    { title: '假如我变小了', lead: '忽然你变得只有蚂蚁那么小，世界变成了什么样？', scenes: [PHOTO_SLOT] },
    { title: '神奇的探险之旅', lead: '你和同伴深入一个未知的山洞，发生了什么？', scenes: [PHOTO_SLOT] },
    { title: '笔尖流出的故事', lead: '笔尖一动，一个人物就从纸上走了出来……', scenes: [PHOTO_SLOT] },
    { title: '变小以后的世界', lead: '巨大的花朵和草丛中间站着一个很小的人，露珠像湖泊一样大。变小以后，你最想做什么？', scenes: ['if-tiny'] },
    { title: '山洞里的探险', lead: '我打着手电往山洞里走，光柱照到了一个箱子。里面会是什么？', scenes: ['adventure-trip'] },
    { title: '我变成了一只蚂蚁', lead: '草丛里站着一只巨大的蚂蚁，远处那个小小的人影，是变形以前的我。变成蚂蚁以后会怎么样？', scenes: ['deformation'] },
    { title: '我变成了一棵树', lead: '脚扎进土里，手臂变成了树枝。谁会在你身上做窝？', scenes: [PHOTO_SLOT] },
  ],
  growth: [
    { title: '那一刻，我长大了', lead: '生活中总有一个瞬间，让你突然觉得自己不再是小孩。那是怎样的一个时刻？', scenes: [PHOTO_SLOT] },
    { title: '在挫折中成长', lead: '你有没有经历过一次失败，当时很难过，但后来却让你变得更坚强？', scenes: [PHOTO_SLOT] },
    { title: '我战胜了自己', lead: '有时候最大的对手不是别人，而是自己内心的害怕或懒惰。你有过这样的经历吗？', scenes: [PHOTO_SLOT] },
    { title: '独自面对', lead: '第一次没有爸爸妈妈在身边，自己完成一件事。那是什么感觉？', scenes: [PHOTO_SLOT] },
    { title: '从错误中学会', lead: '犯过一次错，被批评过，但那次教训让你记住了什么？', scenes: [PHOTO_SLOT] },
    { title: '坚持就是胜利', lead: '有没有一件事，你差点放弃，但咬咬牙坚持了下来？最后的结果怎么样？', scenes: [PHOTO_SLOT] },
    { title: '我的蜕变', lead: '从胆小到勇敢，从粗心到细心，从懒惰到勤奋……你身上发生过怎样的变化？', scenes: [PHOTO_SLOT] },
    { title: '学会承担', lead: '什么时候开始，你觉得自己要为某件事负责了？那是什么事？', scenes: [PHOTO_SLOT] },
    { title: '风雨之后', lead: '经历过一次困难或打击后，你看到了什么不一样的风景？', scenes: [PHOTO_SLOT] },
    { title: '给自己点赞', lead: '你有没有做过一件让自己特别骄傲的事？当时发生了什么？', scenes: [PHOTO_SLOT] },
  ],
  reading: [
    { title: '书中那句话', lead: '有没有一本书里的一句话，让你记了很久？那句话是什么，为什么打动了你？', scenes: [PHOTO_SLOT] },
    { title: '我和书中的人物', lead: '如果你能和某本书里的一个人物做朋友，你会选谁？你们会一起做什么？', scenes: [PHOTO_SLOT] },
    { title: '读完这本书', lead: '最近读完的一本书，它讲了什么？你最喜欢哪个情节或人物？', scenes: [PHOTO_SLOT] },
    { title: '书里的世界', lead: '有没有一本书，读完之后让你特别想去书里的那个地方看看？', scenes: [PHOTO_SLOT] },
    { title: '一句话的启发', lead: '老师、父母或书里的一句话，曾经在你遇到困难时给过你力量。那句话是什么？', scenes: [PHOTO_SLOT] },
    { title: '如果我是主人公', lead: '选一本你读过的书，如果你是里面的主人公，你会怎么做？', scenes: [PHOTO_SLOT] },
    { title: '我的读书故事', lead: '你是怎么爱上读书的？有没有一本书改变了你对某件事的看法？', scenes: [PHOTO_SLOT] },
    { title: '一本好书推荐给你', lead: '如果要把你最喜欢的一本书推荐给同学，你会怎么介绍它？', scenes: [PHOTO_SLOT] },
  ],
  tradition: [
    { title: '家乡的节日', lead: '你家乡过节有什么特别的习俗？和别的地方有什么不同？', scenes: [PHOTO_SLOT] },
    { title: '老手艺人', lead: '你身边有没有一位老手艺人？他做的是什么？你从他身上看到了什么？', scenes: [PHOTO_SLOT] },
    { title: '年味', lead: '过年的时候，家里最让你期待的是什么？那是一种怎样的味道或感觉？', scenes: [PHOTO_SLOT] },
    { title: '非遗在身边', lead: '你家乡有没有被列入非物质文化遗产的东西？你见过或体验过吗？', scenes: [PHOTO_SLOT] },
    { title: '老物件的故事', lead: '家里有没有一件传下来的老物件？它背后有什么故事？', scenes: [PHOTO_SLOT] },
    { title: '舌尖上的家乡', lead: '家乡有一种传统美食，它是怎么做的？吃着它，你想到了什么？', scenes: [PHOTO_SLOT] },
    { title: '庙会记忆', lead: '你有没有逛过庙会或集市？印象最深的是什么？', scenes: [PHOTO_SLOT] },
    { title: '传统与现代', lead: '你身边有没有一种传统的东西，现在用新的方式在传承？', scenes: [PHOTO_SLOT] },
  ],
  society: [
    { title: '身边的变化', lead: '这几年，你住的地方发生了什么变化？是变好了还是让你有些担心？', scenes: [PHOTO_SLOT] },
    { title: '环保小卫士', lead: '你有没有为保护环境做过一件事？那件事让你有什么感受？', scenes: [PHOTO_SLOT] },
    { title: '科技改变生活', lead: '手机、外卖、网购……科技给你的生活带来了什么改变？是好还是坏？', scenes: [PHOTO_SLOT] },
    { title: '陌生人的善意', lead: '你有没有收到过陌生人的帮助？那是一个怎样的瞬间？', scenes: [PHOTO_SLOT] },
    { title: '我看网红现象', lead: '你身边有没有同学想当网红或追网红？你怎么看这个现象？', scenes: [PHOTO_SLOT] },
    { title: '老小区的春天', lead: '你住的小区或街道最近有没有改造？改造前后有什么不一样？', scenes: [PHOTO_SLOT] },
    { title: '一次志愿服务', lead: '你有没有参加过志愿活动？那次经历让你看到了什么？', scenes: [PHOTO_SLOT] },
    { title: '网络与生活', lead: '网络给你的学习和生活带来了什么？有没有让你困扰的时候？', scenes: [PHOTO_SLOT] },
  ],
  gratitude: [
    { title: '想对您说声谢谢', lead: '有没有一个人，你一直欠他一句「谢谢」？你想对他说什么？', scenes: [PHOTO_SLOT] },
    { title: '致敬平凡英雄', lead: '清洁工、快递员、护士、警察……有没有一位「平凡英雄」让你感动过？', scenes: [PHOTO_SLOT] },
    { title: '那双手', lead: '妈妈的手、老师的手、工人的手……有没有一双手让你印象深刻？', scenes: [PHOTO_SLOT] },
    { title: '背影', lead: '你有没有注视过一个人的背影，那一刻心里涌起很多感触？', scenes: [PHOTO_SLOT] },
    { title: '温暖的目光', lead: '有没有一道目光，在你难过或紧张的时候给了你力量？', scenes: [PHOTO_SLOT] },
    { title: '礼物', lead: '收到过最珍贵的一份礼物是什么？它为什么对你那么重要？', scenes: [PHOTO_SLOT] },
    { title: '一碗面的温度', lead: '有没有一种食物，吃着吃着就让你想起了某个人？', scenes: [PHOTO_SLOT] },
    { title: '师恩难忘', lead: '有没有一位老师，说过的一句话或做过的一件事，让你记到现在？', scenes: [PHOTO_SLOT] },
  ],
  'applied-writing': [
    { title: '国旗下的讲话', lead: '周一的升旗仪式上，轮到你在国旗下讲话。你想对全校同学说些什么？', scenes: [PHOTO_SLOT] },
    { title: '竞选班干部', lead: '班干部竞选开始了，你要上台说说自己的打算。你会怎么介绍自己？', scenes: [PHOTO_SLOT] },
    { title: '读书节的发言', lead: '学校读书节上，老师请你上台说几句。你想跟大家分享哪本书、哪句话？', scenes: [PHOTO_SLOT] },
    { title: '毕业典礼上的发言', lead: '毕业典礼上，你要代表全班同学发言。此刻你最想说的是什么？', scenes: [PHOTO_SLOT] },
    { title: '节约用水倡议书', lead: '班里要发起一次节水行动，请你写一份倡议书，号召大家一起节约用水。', scenes: [PHOTO_SLOT] },
    { title: '保护环境倡议书', lead: '学校要开展环保行动，请你写一份倡议书，告诉大家可以从哪些小事做起。', scenes: [PHOTO_SLOT] },
    { title: '观后感', lead: '看完一场演出或一部纪录片，你心里有很多话。把它们写下来吧。', scenes: [PHOTO_SLOT] },
    { title: '给校长的建议书', lead: '学校里有一件事，你想向校长提个建议。你会怎么写？', scenes: [PHOTO_SLOT] },
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

/**
 * 应用文的考察重点。
 *
 * ★★★ **只此一份** —— `focusFor`（出题用）和 `focusOf`（评分用，
 *   在 `store/useApp.ts`）都读它。
 *
 *   为什么非要抽出来：这两个函数是「同一套考察重点规则的两份实现」，
 *   本项目已经栽过好几次「同一判定抄两份、然后走散」（§四/§十）。
 *   多抄一份 `['structure','emotion','vocabulary']` 看着无害，
 *   但它就是下一次走散的起点。
 *
 * ★ 为什么**去掉「观察力」**：`observation` 的判据是
 *   「图上的东西你都看到了吗」，而应用文**没有画面可观察**
 *   （`composeModelEssay` 的应用文分支也不写感官、不写景物）。
 *   低年级默认那一档带着 observation，用在应用文上就是
 *   把 25% 的权重压在一个不存在的指标上。
 *   ➜ 换成「条理性（格式）+ 真情实感（号召力）+ 词汇量」，
 *     且 `structure` **必须排第一**。
 *
 * ★ 2026-10-02：议论文**不在模型里了**（家长：「APP 不需要区分文体」），
 *   所以这一份现在只服务应用文 —— 它就是 `focusForGenre` 的**唯一**输出。
 */
export const APPLIED_FOCUS: ScoreDimension[] = ['structure', 'emotion', 'vocabulary']

/**
 * ★★★ **格式要求 → 考察重点的唯一判定点**。
 *
 * 为什么必须抽出来：`focusFor`（出题用）和 `focusOf`（评分用，
 * 在 `store/useApp.ts`）是同一套规则的**两份实现**，本项目栽过好几次
 * 「同一判定抄两份、然后走散」。所以这一层只留这一个函数，两边都调它。
 *
 * 返回 `undefined` = 「按年级/对象那套推」（记叙文，也是缺省）。
 * ⚠️ 缺省必须走 `undefined` 这条，**不许**在这里返回记叙文那一档 ——
 *    那会把 `focusFor` 里按年级分档的逻辑整个短路掉。
 *
 * ★ 2026-10-02：说明文 / 议论文那两条分支**删掉了** ——
 *   家长定的「APP 不需要区分文体」，孩子写记叙、说明、议论由他自己决定，
 *   出题不问、评分不判。所以这里只剩应用文一条。
 *   ⚠️ 别因为「孩子可能写议论文」就把它加回来：那正是被推翻的设计。
 */
export function focusForGenre(
  genre: CompositionGenre | undefined,
): ScoreDimension[] | undefined {
  switch (resolveGenre(genre)) {
    case 'applied':
      return APPLIED_FOCUS
    default:
      return undefined
  }
}

/** 各年级考察重点：低年级重观察，高年级重情感与结构 */
export function focusFor(
  grade: GradeLevel,
  category: CompositionCategory,
  /**
   * ★ 题目自带的格式要求（2026-09-30 加，2026-10-02 收窄成只有应用文会用）。
   *   缺省 = 记叙文 → 老调用方行为逐字节不变。
   * ⚠️ 加了字段却不在下面用，等于没加。
   */
  genre?: CompositionGenre,
): ScoreDimension[] {
  // 应用文先分流：它跟「写什么对象」无关（判据见 `focusForGenre`）
  const byGenre = focusForGenre(genre)
  if (byGenre) return byGenre

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
    // ★ 跟内置题同一条规矩：本地出的题也带上**解析后**的格式要求，
    //   这样「拿到的题永远有真实值」这条不变量对两条出题路都成立。
    //   ⚠️ 判据是 `tag.requiredGenre`（题目**自带**的格式要求），不是
    //     「这道题是什么文体」—— 材料题/话题题一律不带。
    requiredGenre: resolveGenre(tag.requiredGenre),
    // ★ 命题方式也带过去（材料题/话题题 = 格式自选，看的就是它）。
    promptMode: tag.promptMode,
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
    focus: focusFor(grade, category, resolveGenre(tag.requiredGenre)),
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
