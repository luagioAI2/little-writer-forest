/* ============================================================
   核心领域类型 —— 全应用共享的契约
   ============================================================ */

import type { CharacterSpec } from './character'

/* ---------------- 年级 / 标签 ---------------- */

/** 小学 1-6 年级 + 初中 7-9 年级 */
export type GradeLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export const GRADE_GROUPS = [
  { key: 'lower', label: '小学低年级', grades: [1, 2] as GradeLevel[], emoji: '🌱' },
  { key: 'middle', label: '小学中年级', grades: [3, 4] as GradeLevel[], emoji: '🌿' },
  { key: 'upper', label: '小学高年级', grades: [5, 6] as GradeLevel[], emoji: '🌳' },
  { key: 'junior', label: '初中', grades: [7, 8, 9] as GradeLevel[], emoji: '🏔️' },
]

export function gradeLabel(g: GradeLevel): string {
  return g <= 6 ? `${g} 年级` : `初${['一', '二', '三'][g - 7]}`
}

/** 作文大类：写景 / 写人 / 写事 / 状物 / 想象 */
export type CompositionCategory = 'scene' | 'person' | 'event' | 'object' | 'imagine'

export interface CategoryMeta {
  key: CompositionCategory
  label: string
  emoji: string
  /** 主题色（Tailwind 类名片段） */
  tone: string
  desc: string
}

export const CATEGORIES: CategoryMeta[] = [
  {
    key: 'scene',
    label: '写景',
    emoji: '🏞️',
    tone: 'sky',
    desc: '春夏秋冬、风霜雨雪、山川湖海',
  },
  {
    key: 'person',
    label: '写人',
    emoji: '🧑‍🎨',
    tone: 'blossom',
    desc: '爸爸妈妈、老师同学、陌生人',
  },
  {
    key: 'event',
    label: '写事',
    emoji: '⚽',
    tone: 'sprout',
    desc: '一件难忘的事、第一次、那一刻',
  },
  {
    key: 'object',
    label: '状物',
    emoji: '🪁',
    tone: 'tangerine',
    desc: '小动物、植物、心爱的小物件',
  },
  {
    key: 'imagine',
    label: '想象',
    emoji: '🚀',
    tone: 'grape',
    desc: '假如我会飞、未来的世界、童话续写',
  },
]

export function categoryMeta(key: CompositionCategory): CategoryMeta {
  return CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[0]
}

/* ============================================================
   ★★ 两个轴 —— 一道作文题由它们**各自独立**地描述，别混
   ------------------------------------------------------------
       轴 1「写什么」（对象）        → `CompositionCategory`
       轴 2「题目怎么给的」（命题方式）→ `PromptMode`

   ★★★ 2026-10-02 家长定下的：**没有「文体」这一层**。原话：

     「不需要 写成什么文体。不需要 这个。主体还是看图作文。
       即便是看图作文，用户也能写成议论文，说明文的，由用户自己决定。
       APP 不需要区分文体。」

   ➜ 所以「记叙文 / 说明文 / 议论文」**不进模型**：
     孩子爱怎么写就怎么写，出题不问、评分不判、题库不标。
     界面上本来也没出现过「文体」二字（`GENRES` 从来没被任何
     组件引用），所以这一条去掉的是**内部的建模**，不是界面。

   ➜ `CompositionGenre` 因此只剩两个值，而且它**只服务应用文**。
     应用文不是「文体选择」，是**题目自带的格式要求** ——
     《节约用水倡议书》只能是倡议书，孩子没法"决定"把它写成写景。
     ⚠️ 去掉它，这篇会退回写景范文（开头是「那个地方的样子，
        我记了很久」）。2026-09-30 实测踩过这个坑，家长当时选了
        「补应用文缺口」，2026-10-02 再次确认**保留**。
     ➜ 换句话说：`requiredGenre` 的语义是「**题目指定**的格式」，
       **不是**「这道题是什么文体」。文体自选的题目**不写这个字段**。
     ➜ 孩子这一次实际写成什么，记在 `Work.genre` 上（见下面 Work）。

   ★ 为什么应用文不能当 `CompositionCategory` 的第 6 个值：
     它回答的是「**写成什么体例**」（称呼 / 正文 / 号召 / 落款），
     不是「写什么对象」—— 而且它**跨对象**（倡议书可以写事、
     颁奖词可以写人、导游词可以写景）。正因为它跨，它才不在那一层。
     硬塞进去等于对孩子说「应用文是一种写事」，那句话不真。
   ★ 同理「看图作文」也不该挂在轴 1 的「写事」下面 —— 它不是「写什么」，
     它是「题目怎么给的」（轴 2）。2026-10-01 给它标了
     `promptMode: 'material'`；2026-10-02 家长又说「**整个应用就是看图
     作文**」—— 整个 app 都是看图作文，再单列一个「看图作文」分类确实是
     废话，于是连标签带那 6 道题一起删了。（`material` 这个取值**留着**，
     见下面 `PromptMode` 的说明。）
   ============================================================ */

/** 文体 —— **只剩「记叙」和「应用文」两个值**，且后者只服务题目自带的格式要求 */
export type CompositionGenre = 'narrative' | 'applied'

export interface GenreMeta {
  key: CompositionGenre
  /** 正式叫法（老师、家长、教辅都这么说） */
  label: string
}

/**
 * ★ 只用来做**解析白名单**（`library.ts` 的 `parseGenre`）——
 *   题库文件里写 `"narrative"` 或 `"记叙文"` 都要认。
 *
 * ⚠️ 别在这儿加 `emoji` / `kidDesc` / `fromGrade` 这类字段：
 *    它们是给「让孩子选文体」那个界面准备的，而家长 2026-10-02
 *    明确说了**不要文体这一层**。加回来等于把取消掉的东西又请进来。
 */
export const GENRES: GenreMeta[] = [
  { key: 'narrative', label: '记叙文' },
  { key: 'applied', label: '应用文' },
]

/**
 * ★★★ **唯一的「缺省 = 记叙文」判定点**。
 *
 * 为什么缺省是记叙文、而且这不是"没填"：全库 409 道里 401 道是记叙文，
 * 历史上也一直只有记叙文。所以**老存档没有这个字段完全正常**，
 * 读出来就是记叙文，行为跟加这个字段之前**一模一样**。
 *
 * ⚠️⚠️ **别在别处再写一次 `?? 'narrative'`** —— 同一个判定抄成两份，
 *    改的时候漏一处就会漂移，而且两边都不报错（本项目栽过好几次）。
 *    要拿缺省值，一律走这个函数。
 */
export function resolveGenre(g: CompositionGenre | undefined): CompositionGenre {
  return g ?? 'narrative'
}

/* ---------------- 命题方式（轴 2） ---------------- */

/**
 * 命题方式 —— 「这道题是**怎么给出来的**」。
 *
 * 这一轴和「写什么对象」**无关**：同样是写事，
 * 可以命题给（《第一次做饭》），也可以给材料（一幅画、一则漫画）。
 *
 * ★ 它存在的直接原因：`look-picture`（看图作文）曾经挂在
 *   `category: 'event'`（写事）下面 —— 等于说「看图作文是一种写事」，
 *   那句话不真。看图作文是**给材料作文**的一种（材料是图画），
 *   和「写事」根本不在同一个轴上。
 *
 * ⚠️ 2026-10-02 之后**没有任何标签在用 `material`**（那两个标签删了）。
 *    别据此把 `material` 从联合类型里删掉 —— 它是这一轴的**定义**，
 *    不是「当前有没有人用」。判据：删了它，将来真有材料题时又得加回来。
 */
export type PromptMode =
  /** 命题作文：题目直接给死，如《雨后的校园》 */
  | 'assigned'
  /** 半命题作文：《＿＿真美》，空的地方孩子自己填 */
  | 'half'
  /** 话题作文：给一个话题，题目自拟 */
  | 'topic'
  /** 材料作文：给材料（一幅画、一则漫画、一段话…），题目自拟 */
  | 'material'

export interface PromptModeMeta {
  key: PromptMode
  label: string
  /**
   * 这种命题方式下，题目**可不可以自带格式要求**（`requiredGenre`）。
   *
   * 命题/半命题可以 —— 「请写一份倡议书」就是命题作文 + 指定应用文。
   * 话题/材料一律**不自带**（中考题干原文「文体自选（诗歌、戏剧除外）」
   * 说的正是这件事：题目不管格式），
   * 所以它们**不许**写 `requiredGenre`。这条由守卫盯着（见 prompts.test.ts）。
   */
  canFixGenre: boolean
}

/** ★ 顺序即「孩子先遇到哪个」—— 命题作文最早，材料作文最晚 */
export const PROMPT_MODES: PromptModeMeta[] = [
  { key: 'assigned', label: '命题作文', canFixGenre: true },
  { key: 'half', label: '半命题作文', canFixGenre: true },
  { key: 'topic', label: '话题作文', canFixGenre: false },
  { key: 'material', label: '材料作文', canFixGenre: false },
]

export function promptModeMeta(key: PromptMode): PromptModeMeta {
  return PROMPT_MODES.find((m) => m.key === key) ?? PROMPT_MODES[0]
}

/**
 * 命题方式的缺省值 —— **缺省 = 命题作文**。
 *
 * 老题库数据全都没有这个字段。而小学题库里绝大多数题就是命题作文
 * （出题模板直接给一个定死的标题），所以缺省成它最贴事实。
 * ⚠️ 别在别处再写一次 `?? 'assigned'`，一律走这个函数。
 */
export function resolvePromptMode(m: PromptMode | undefined): PromptMode {
  return m ?? 'assigned'
}

/**
 * 细分标签 —— 挂在每个大类下面。
 * 孩子点大类 → 看到这些更小的标签，选一个最贴的。
 */
export interface TopicTag {
  id: string
  category: CompositionCategory
  label: string
  emoji: string
  /** 该标签适合的最低年级，用于过滤 */
  minGrade: GradeLevel
  /** 给 AI 的写作提示方向 */
  hint: string
  /**
   * 命题方式（轴 2）。**省略 = 命题作文**（走 `resolvePromptMode()`）。
   *
   * ⚠️ 全库 46 个标签里**只有 `applied-writing` 写了它** —— 而且写的是
   *    `'assigned'`（跟缺省值一样，只是显式写出来顺带把「自带格式要求」
   *    说明白）。`material` / `half` / `topic` 目前一个标签都没用。
   * ⛔ 2026-10-02 之前这里还写着「`if-i`（半命题）写了它」—— **那句是错的**，
   *    `if-i` 从来没写过 `promptMode`（它的题是定死的标题，缺省 `assigned`
   *    本来就对）。删标签时顺手核了一遍才发现的。
   */
  promptMode?: PromptMode
  /**
   * ★ 题目**自带**的格式要求。**省略 = 记叙文**（走 `resolveGenre()`）。
   *
   * ⚠️ 它**不是**「这道题是什么文体」—— 孩子写记叙、说明、还是议论，
   *    是**孩子自己决定的**，题目不管、APP 也不建模（见文件头 2026-10-02
   *    家长的原话）。所以这个字段现在只剩一个用途：
   *
   *     · **应用文**：「写一份倡议书」没有自选余地，格式就是题目的一部分。
   *       全库 46 个标签里只有 `applied-writing` 写了它。
   *     · **材料题 / 话题题一律不许写它**（那两种命题方式 = 题目不自带
   *       格式要求）。
   *       这条由守卫盯着，见 `prompts.test.ts`。
   *
   * 名字里的 `required` 就是提醒这件事：**要求**，不是**属性**。
   */
  requiredGenre?: CompositionGenre
}

/* ---------------- 题目 / 图片 ---------------- */

/**
 * 一道题的配图。
 *
 * 两种来源，可以只填一个，也可以两个都填（此时外链优先、挂了退 SVG）：
 *
 *   ① `sceneKey` —— 内置插画的 key，对应 assets/scenes.tsx 里的 SVG 场景。
 *      不联网、不打包图片，永远画得出来。AI 出的题走这条。
 *   ② `imageUrl` —— 外链图片地址。手写的题库数据走这条（见 domain/library.ts
 *      的导入说明）。可以是 https 外链，也可以是放在 public/ 下的相对路径
 *      （如 `/photos/spring-1.png`）。
 *
 * ⚠️ 只填 imageUrl 时，图加载失败就只剩占位画了 —— 没有 SVG 可退。
 *    所以「重要的题」建议两个都填：外链好看，SVG 保底。
 */
export interface PromptImage {
  /** 内置插画的 key，对应 assets/scenes.tsx 里的 SVG 场景 */
  sceneKey?: string
  /** 外链图片地址（https 或 public/ 下的相对路径） */
  imageUrl?: string
  /** 图片下方的说明，多图时显示「第1幅」 */
  caption?: string
}

export interface CompositionPrompt {
  id: string
  category: CompositionCategory
  tagId: string
  /**
   * 命题方式（轴 2），从标签带过来。**省略 = 命题作文**（走 `resolvePromptMode()`）。
   *
   * ★ 它和 `requiredGenre` 的关系：`material` / `topic`（材料题、话题题）
   *   一律**不自带格式要求**，此时 `requiredGenre` 一定为空。
   */
  promptMode?: PromptMode
  /**
   * ★ 题目**自带**的格式要求（目前只有应用文会用）。**省略 = 记叙文**（走 `resolveGenre()`）。
   *
   * ★ 内置题一定会带上解析后的真实值（`builtinBaseItems()` 里写了
   *   `requiredGenre: resolveGenre(tag.requiredGenre)`），所以从题库拿到的题
   *   **永远不用再判缺省**；只有「家长从 JSON 导进来的题」可能没有这个字段。
   *
   * ⚠️ 为空**有两种含义**，别混：
   *    · 题目没自带格式要求（记叙文默认）—— 老数据全走这条；
   *    · 题目是材料/话题题，格式自选 —— 此时看 `promptMode` 区分。
   */
  requiredGenre?: CompositionGenre
  /** 题目标题，如「雨后的校园」 */
  title: string
  /** 一句话引导，用孩子的口吻 */
  lead: string
  images: PromptImage[]
  /** 建议字数区间 */
  wordRange: [number, number]
  minGrade: GradeLevel
  maxGrade: GradeLevel
  /** 这篇重点考察什么，用于评分加权 */
  focus: ScoreDimension[]
}

/* ---------------- 评分维度 ---------------- */

/**
 * 五个评分维度 —— 对应小学作文教学的实际要求。
 * 每个维度独立打分（0-100），最终加权成总分。
 */
export type ScoreDimension =
  | 'observation' // 观察力：图上的东西有没有看到、看到多少
  | 'structure' // 结构：开头 中间 结尾，有没有顺序
  | 'vocabulary' // 词句：用词是否丰富、有没有好词
  | 'imagination' // 想象：有没有图以外的合理联想
  | 'emotion' // 情感：有没有自己的感受

export interface DimensionMeta {
  key: ScoreDimension
  label: string
  emoji: string
  /** 面向孩子的说明 */
  kidDesc: string
  /** 默认权重 */
  weight: number
}

export const DIMENSIONS: DimensionMeta[] = [
  {
    key: 'observation',
    label: '观察力',
    emoji: '👀',
    kidDesc: '图上的东西你都看到了吗',
    weight: 0.25,
  },
  {
    key: 'structure',
    label: '条理性',
    emoji: '🧩',
    kidDesc: '先说啥后说啥，有没有顺序',
    weight: 0.25,
  },
  {
    key: 'vocabulary',
    label: '词汇量',
    emoji: '📚',
    kidDesc: '用了多少好词好句',
    weight: 0.2,
  },
  {
    key: 'imagination',
    label: '想象力',
    emoji: '✨',
    kidDesc: '想出了图上看不到的东西',
    weight: 0.15,
  },
  {
    key: 'emotion',
    label: '真情实感',
    emoji: '💗',
    kidDesc: '你自己的心情和感受',
    weight: 0.15,
  },
]

export function dimensionMeta(key: ScoreDimension): DimensionMeta {
  return DIMENSIONS.find((d) => d.key === key) ?? DIMENSIONS[0]
}

/** 一次评分的五个维度得分 */
export type DimensionScores = Record<ScoreDimension, number>

/* ---------------- 提交 / 作品 ---------------- */

/** 语音录入产生的一段文本，带溯源信息 */
export interface Utterance {
  id: string
  /** 识别出的文字 */
  text: string
  /** 这条语音是什么时候说的 */
  at: number
  /** 时长（毫秒），用于展示 */
  durationMs?: number
  /** 是否被后续的编辑替换掉了 */
  superseded?: boolean
}

/**
 * 语音编辑日志 —— 这是本 App 的核心机制之一。
 *
 * 孩子说「一根直直的棍子」，然后又说「棍子变成竹签」，
 * 系统把「棍子」替换成「竹签」。
 *
 * 关键：这是孩子**自己**做的修改，AI 绝不代写。
 * 我们只做「找 → 换」这个机械动作，判断由孩子下。
 */
export interface EditOperation {
  id: string
  at: number
  /** 被替换掉的原文 */
  from: string
  /** 换成的新内容 */
  to: string
  /** 替换方式 */
  kind: 'replace' | 'append' | 'delete' | 'insert'
  /** 操作前的完整正文（用于撤销） */
  before: string
  /** 操作后的完整正文 */
  after: string
  /**
   * 这一处是谁动手改的。
   *
   * ⚠️ 必须记下来，不能靠猜：界面上那句鼓励语原本写的是
   *    「**你自己**改了一处，这就是进步」。改作文接了大模型之后，
   *    再说这句话就是**对孩子说假话** —— 他确实做了决定，
   *    但动手改的不是他。两种功劳要分开说。
   *
   * 缺省（老存档）当 'child'。
   */
  by?: 'child' | 'ai'
  /**
   * 孩子当时**原话**（转写之后的那一句）。
   *
   * 家长 2026-09-21：「我希望是 表明作文原文，**修正内容 就是输入的话的内容**。」
   * 修改记录要能把他自己说的那句话**逐字**摆出来 —— 不是模型给的摘要，
   * 也不是引擎生成的回执。所以他说的什么就存什么。
   *
   * ⚠️ 只有 AI 那条路（`by: 'ai'`）会填。孩子自己动手改的没有"输入的话"。
   *    缺省（老存档）就是 undefined。
   */
  said?: string
}

export type WorkStatus =
  | 'draft' // 正在写
  | 'submitted' // 已提交，等 AI 看
  | 'scored' // 已评分
  | 'recited' // 已完成背诵
  | 'archived' // 已归档

/** 一篇作品的完整记录 */
export interface Work {
  id: string
  kind: 'composition' | 'diary'
  promptId?: string
  /** 冗余存标题，题目库更新后旧作仍可读 */
  title: string
  category?: CompositionCategory
  /**
   * ★ 这篇作文按**哪一套格式**评的分 —— 目前只用来区分「应用文」和「其它」。
   *
   * 跟 `title`/`category` 一样**提交时快照**：题目库以后改了、或者题被
   * 删了，旧作还得知道当时按什么标准评的分。
   *
   * ⚠️ 它**不是**「孩子写成了记叙文/说明文/议论文」—— 那三样 APP 不建模
   *    （见文件头 2026-10-02 家长的原话）。字段名和历史值都没改，
   *    是因为改名要动存档的 key，代价比收益大。
   *
   * ⚠️ 缺省 = 记叙文（老存档全都没有这个字段）。
   */
  genre?: CompositionGenre
  grade: GradeLevel
  createdAt: number
  updatedAt: number
  /**
   * 评分时间。
   *
   * 为什么要单独存一个：每天的作文奖励上限是按「今天评了几篇」算的，
   * 而 `updatedAt` 会被后续动作（比如背诵、改标题）刷新，
   * `createdAt` 又是开稿时间 —— 昨晚开的稿今天交，会被算到昨天去。
   * 只有评分这一刻是准的。
   */
  scoredAt?: number
  status: WorkStatus

  /**
   * 孩子自己收藏的作文 —— 收藏了才会进「我的作文本」。
   *
   * 为什么不复用 `LibraryItem.favorite`：那是「题」的收藏，这是「作品」的收藏，
   * 两回事。题是别人给的，作文是孩子自己写的。
   */
  favorite?: boolean

  /** 当前正文（语音录入 + 孩子编辑后的最终稿） */
  text: string
  /** 所有语音片段 */
  utterances: Utterance[]
  /** 所有编辑操作，完整可回放 */
  edits: EditOperation[]

  /** AI 评分结果 */
  score?: WorkScore
  /** 「更好的写法」（每次 AI 评分后必给） */
  modelEssay?: ModelEssay
  /** 背诵记录 */
  recitation?: Recitation

  /** 图片快照 */
  images: PromptImage[]
  /** 提交时锁定的字数 */
  wordCount: number
}

/** AI 对一篇作文的评分 */
export interface WorkScore {
  at: number
  /** 总分 0-100 */
  total: number
  /** 五维得分 */
  dimensions: DimensionScores
  /** 综合评语，鼓励为主 */
  summary: string
  /** 做得好的点，每条配图上的证据 */
  strengths: StrengthPoint[]
  /** 可以更好的点 —— 只提建议，绝不改写成文 */
  suggestions: Suggestion[]
  /** 作文思维导图 */
  mindMap: MindMapNode
  /** 星级 1-5 */
  stars: number
  /** 评分引擎来源，便于家长排查 */
  engine: 'local' | 'remote'
}

export interface StrengthPoint {
  /** 好在哪，如「观察细致」 */
  title: string
  /** 具体证据：引用孩子原文的哪一句 */
  evidence: string
  emoji: string
}

export interface Suggestion {
  /** 建议标题，如「开头可以更吸引人」 */
  title: string
  /** 具体怎么做 —— 只指方向，不给现成句子 */
  how: string
  emoji: string
}

/** 思维导图节点 */
export interface MindMapNode {
  label: string
  emoji?: string
  children?: MindMapNode[]
}

/**
 * 「更好的写法」—— 顺着孩子这一篇改出来的、接近满分的样子。
 *
 * ⚠️ 它**不是**孩子的正文，两者是分开的两个字段；正文永远原样保留。
 */
export interface ModelEssay {
  at: number
  /** 正文（顺着孩子的稿子改写，保留他的视角和故事） */
  text: string
  /** 范文特色标签 */
  highlights: string[]
  /** 主干版：去掉修饰词，只留骨架，用于背诵 */
  skeleton: string
  /** 骨架的分句，背诵时逐句对照 */
  skeletonLines: SkeletonLine[]
  engine: 'local' | 'remote'
}

/**
 * 背诵骨架的一行。
 * 把范文拆成「主干 + 修饰」，孩子背主干，
 * 修饰词自由发挥 —— 这样既练结构又不变成背书机器。
 */
export interface SkeletonLine {
  /** 主干句 */
  core: string
  /** 被剥离的修饰成分 */
  modifiers: string[]
  /** 在范文里对应的完整句子 */
  full: string
}

/** 背诵记录 */
export interface Recitation {
  at: number
  /** 录音数据 url（blob 转 dataURL，存 IndexedDB） */
  audioRef?: string
  /** 录音时长 */
  durationMs: number
  /** 识别文本 */
  transcript: string
  /** 与骨架的匹配度 0-100 */
  matchScore: number
  /** 逐句匹配结果 */
  lineMatches: { core: string; matched: boolean; heard?: string }[]
  /** 拿到多少奖励 */
  reward: RecitationReward
}

export interface RecitationReward {
  coins: number
  xp: number
  /** 掉落的卡 */
  cards: CardDrop[]
  /** 鼓励寄语 */
  blessing: string
}

/* ---------------- 段位 / 水平 ---------------- */

/**
 * 水平等级的判定状态。
 *
 * 核心规则（按需求设计）：
 * - 最开始是「预测水平」，一篇就变动很大
 * - 积累到 N 篇之后转为「实际水平」，变得稳定
 * - 升级容易降级难：需要连续多篇明显下滑才降
 */
export type LevelConfidence = 'predicted' | 'settling' | 'established'

export interface LevelState {
  /** 当前段位序号 0-11，对应 LEVELS 数组下标 */
  levelIndex: number
  /** 段位内的小进度 0-100 */
  progress: number
  /** 累计经验值 */
  xp: number
  /** 判定置信度 */
  confidence: LevelConfidence
  /** 已评分的作品数 */
  scoredCount: number
  /** 最近 N 篇得分的滑动平均 */
  recentScores: number[]
  /** 历史最佳总分 */
  bestScore: number
  /**
   * 降级护盾 —— 在台阶上站稳后获得。
   * 每次下滑消耗 1 点，耗尽才开始真正掉段。
   */
  shields: number
  /** 连续下滑的篇数，达到阈值才真正降段 */
  declineStreak: number
}

export interface LevelMeta {
  index: number
  /** 段位名，如「灵芽树」 */
  name: string
  /** 阶段称号，如「萌芽」 */
  title: string
  emoji: string
  /** 进入该段位所需累计 XP */
  minXp: number
  /** 树苗在这个阶段长成什么样，用 SVG 层数描述 */
  treeStage: number
  /** 段位主色 */
  color: string
  /** 能力描述：这个段位能做到什么 */
  ability: string
  /** 成长故事：用名人事迹类比，讲清这一段的成长 */
  story: string
  /** 成长寓意：一句话总结 */
  growth: string
}

/* ---------------- 卡片收集 ---------------- */

export type Rarity = 'common' | 'fine' | 'rare' | 'epic' | 'legend'

export interface RarityMeta {
  key: Rarity
  label: string
  /** 基础掉落权重 */
  weight: number
  color: string
  /** 卡片边框光效强度 */
  glow: number
}

export const RARITIES: RarityMeta[] = [
  { key: 'common', label: '普通', weight: 100, color: '#9aa5a0', glow: 0 },
  { key: 'fine', label: '优秀', weight: 52, color: '#3e7f5e', glow: 1 },
  { key: 'rare', label: '稀有', weight: 22, color: '#42779a', glow: 2 },
  { key: 'epic', label: '史诗', weight: 7, color: '#8c73c5', glow: 3 },
  { key: 'legend', label: '传说', weight: 1.6, color: '#c98a2e', glow: 4 },
]

/** 卡片属性 —— 让孩子有"攒卡牌"的感觉 */
export interface CardStats {
  /** 观察 0-100 */
  observation: number
  /** 结构 */
  structure: number
  /** 词句 */
  vocabulary: number
  /** 想象 */
  imagination: number
  /** 情感 */
  emotion: number
}

/** 一个卡组（系列） */
export interface CardSet {
  id: string
  name: string
  emoji: string
  desc: string
  /** 集齐奖励 */
  reward: SetReward
  color: string
  /** 这一系列的世界观，一句话 */
  world: string
}

export interface SetReward {
  coins: number
  /** 解锁的称号 */
  title?: string
  /** 专属头像框 */
  frame?: string
}

/**
 * 一张角色卡。
 *
 * 卡不是"物件"，是"角色"：有立绘、有属性、有技能、有一句话。
 * 属性直接对应作文的五个评分维度 —— 这样"攒卡"和"写作能力"
 * 在孩子心里是同一件事，而不是两套互不相干的系统。
 */
export interface CardDef {
  id: string
  setId: string
  /** 角色名 */
  name: string
  /** 称号，比如「晨读的观察者」 */
  title: string
  /** 兼容旧列表用的小图标（卡面主视觉一律用 character 立绘） */
  emoji: string
  rarity: Rarity
  /** 卡片类型：属性卡 / 特殊卡 */
  kind: 'attribute' | 'special'
  /** 五维属性，0-100 */
  stats: CardStats
  /** 卡面一句话，要有范儿 */
  flavor: string
  /** 技能名 + 说明（特殊卡必填） */
  skill?: string
  /** 立绘参数 —— 由 CharacterArt 渲染 */
  character: CharacterSpec
}

/** 玩家背包里的一张卡 */
export interface OwnedCard {
  /** 卡定义 id */
  defId: string
  /** 拥有数量（重复的可以升级） */
  count: number
  /** 首次获得时间 */
  firstAt: number
  /** 是否已"升星"到满级 */
  starred: boolean
}

/** 一次掉落 */
export interface CardDrop {
  defId: string
  rarity: Rarity
  /** 是否是新卡（首次获得） */
  isNew: boolean
  /** 触发来源 */
  source: DropSource
}

export type DropSource =
  | 'composition' // 完成作文
  | 'high_score' // 高分额外
  | 'recitation' // 背诵
  | 'diary' // 日记
  | 'streak' // 连续签到
  | 'level_up' // 升段
  | 'set_complete' // 集齐卡组
  | 'tree' // 成长树产出
  | 'travel' // 小鸟旅行带回
  | 'hollow' // 树洞事件

/* ---------------- 日记 ---------------- */

export interface DiaryEntry {
  id: string
  /** 日期键，yyyy-MM-dd，一天一篇 */
  dayKey: string
  createdAt: number
  updatedAt: number
  /** 心情 emoji */
  mood: string
  /** 天气 emoji */
  weather?: string
  text: string
  utterances: Utterance[]
  edits: EditOperation[]
  status: WorkStatus
  /** 日记点评 —— 比作文简单，只给亮点和优化 */
  review?: DiaryReview
  wordCount: number
  /**
   * 已封存 —— 一旦确定就永久不能再改。
   * 这是产品规则，不是技术限制：今天过去了就是过去了，
   * 让它保持当时的样子，比"改得更好"更重要。
   */
  sealed: boolean
  /** 封存时间 */
  sealedAt?: number
  /** 附件录音（孩子可以录一段话附在日记上）dataURL */
  audio?: string
  /** 录音时长（秒） */
  audioSeconds?: number
  /** 是否已经丢进树洞 */
  inHollow?: boolean
}

export interface DiaryReview {
  at: number
  summary: string
  strengths: StrengthPoint[]
  mindMap: MindMapNode
  /** 日记专属：AI 优化版 —— 这个直接给，因为日记重在表达流畅 */
  polished: string
  stars: number
  engine: 'local' | 'remote'
}

/** 连续写日记的签到状态 */
export interface DiaryStreak {
  /** 当前连续天数 */
  days: number
  /** 历史最长 */
  best: number
  /** 最后打卡日 */
  lastDayKey?: string
  /** 今天的 Buff 层级 0-3 */
  buffTier: number
  /** Buff 描述 */
  buffLabel: string
  /** 稀有度加成倍率 */
  rarityBoost: number
  /** 金币加成倍率 */
  coinBoost: number
}

/* ---------------- 设置 / 账号 ---------------- */

/**
 * 「家」在哪儿 —— 算小鸟飞了多远用的基准点。
 *
 * 为什么要存起来、而不是写死一个城市：孩子住哪儿只有设备知道
 * （或者家长手动选）。但**拿不到也得给个数** —— 退回默认值（深圳），
 * 而不是干脆不显示距离。「飞了 1900 公里」哪怕基准点不完全准，
 * 也远好过一片空白。
 */
export interface HomePoint {
  /** 给孩子看的城市名，如「深圳」 */
  name: string
  /** GCJ-02 经纬度（与地标表同一套坐标系，不然算出来会偏） */
  lng: number
  lat: number
  /** 这个点是哪来的 —— 界面要能说清「为什么算出来是这个数」 */
  source: 'gps' | 'manual' | 'default'
}

/**
 * 孩子的默认名字 —— **只此一份**。
 *
 * 为什么收成常量：这个字符串原本在三个地方各写了一遍 ——
 *   `db.ts` 的 `defaultSettings()`、引导页的兜底（`name.trim() || '小笔苗'`）、
 *   设置页的昵称兜底。三处各写一遍，改的时候漏一处就漂移，
 *   表现是「引导页说叫小笔苗，设置页留空却显示空白」这种自相矛盾。
 *   （本项目已经因为「同一个值写两遍」栽过好几次，见 MEMORY §四 / §七。）
 *
 * ★ 它的语义是**兜底值，不是默认显示**：名字留空 ≠ 没名字，
 *   而是「还没起名，先这么叫」—— 所以空名字在**落盘时**就要换成它，
 *   不能等到界面渲染时再补，否则存档里会留下一个空字符串，
 *   在 `{childName} · 三年级`、`XX 的森林` 这些地方渲染成一片空白。
 */
export const DEFAULT_CHILD_NAME = '小笔苗'

export interface Settings {
  childName: string
  avatar: string
  grade: GradeLevel
  /** 日记密码（4 位数字） */
  diaryPin: string | null
  /** 家长密码（4 位数字，默认 0000）—— 进入设置需要 */
  parentPin: string | null
  /** 音效开关 */
  soundOn: boolean
  /** 震动开关 */
  hapticsOn: boolean
  /** AI 配置 */
  ai: AiConfig
  /** 每日目标篇数 */
  dailyGoal: number
  /**
   * 最近一次孩子在写作页选的题材。
   *
   * 用作"记住上次选的"：每次孩子点了一个题材，就写到库里；
   * 下次打开写作页直接用它。没有记录时默认 `scene`（写景）。
   */
  lastCategory: CompositionCategory
  /**
   * 距离基准点。
   *
   * 可选，而且**大部分时候就是空的**：没读到 GPS、家长也没手动选，
   * 那就用 `travelStories` 里的默认值（深圳）。
   * 留成可选也是为了兼容老存档 —— 它们没有这个字段。
   */
  homePoint?: HomePoint
  /**
   * 是否已经走完首次引导。
   *
   * 为什么需要它：年级、昵称这类信息是**一次性设定**，
   * 让它出现在「写作文」首页会常年占掉一整屏版面 ——
   * 用户明确反馈过这一点。放进引导里，只问一次。
   */
  onboarded: boolean
  /**
   * 是否已经看过「新手引导」（种完树之后那几屏）。
   *
   * ★ 为什么和 `onboarded` **分开**：
   *   两者是两件事，合并成一个标记就会出错。
   *     · `onboarded` = 资料收集完了（昵称/年级/目标）→ 决定**要不要问**；
   *     · `guideDone` = 玩法看过了 → 决定**要不要教**。
   *   合成一个的话，「再看一遍新手引导」就会顺手把孩子已经填好的
   *   昵称和年级再问一遍 —— 而那是他一年才改一次的东西。
   *
   * ⚠️ 老存档没有这个字段：`mergeSettings` 会补上 `false`，
   *    于是**已经装了 App 的人下次打开会看到一遍引导**。
   *    这是故意的 —— 引导里教的那个「按住说话」手势，
   *    恰恰是现有用户从没被告知过的东西。看过一次就置 true。
   */
  guideDone: boolean
  /**
   * 语音转写（录音 → 文字）的配置。
   *
   * 为什么**不复用** `ai` 那套：
   *   出题评分用的是对话大模型（DeepSeek 这类），而转写要用**专门的
   *   语音识别模型**（SenseVoice / Whisper）。两者是不同的服务，
   *   可以指向不同的服务商、不同的 Key。
   *   硬塞进 `ai` 里会让家长以为填一个 Key 就两件事都能干 ——
   *   而 DeepSeek 根本没有语音识别接口。
   *
   * 可选，为了兼容老存档：没配就走系统识别（老行为）。
   */
  transcribe?: TranscribeConfig
}

/** 语音转写配置 —— 形状与 platform/transcribe.ts 里的 TranscribeConfig 一致 */
export interface TranscribeConfig {
  /** 火山流式的密钥（UUID 形态，**不是** `sk-` 开头） */
  apiKey: string
  /**
   * ⚠️ 在流式这条路上它**不是模型名**，是「选哪个端点」：
   *    `'duplex' | 'nostream' | 'async'`，认不出来一律回落到 duplex。
   *    见 `platform/volcengine.ts` 的 `resolveEndpoint()`。
   */
  model: string
  /** 火山的资源 ID（留空用 volc.seedasr.sauc.duration） */
  resourceId?: string
}

/**
 * 老存档里的语音转写配置 —— **只给迁移读**，不是现在能存的东西。
 *
 * ★ 它比 `TranscribeConfig` 多出 `engine` / `baseUrl` 这两个**已经删掉**的
 *   字段，正是为了认出"配过硅基流动"的老存档，把它们整份换成火山默认值。
 *   ⛔ 2026-10-02 家长定：「去掉硅基流动的东西，只使用火山。」
 *      整包上传那条路连代码一起删了，所以现在没有 `engine`、也没有 `baseUrl`。
 *      ⚠️ **删字段必须同时有读侧迁移** —— 见 `db.ts` 的
 *         `migrateTranscribeConfig()`，别只删类型。
 *
 * 全部可选：形状对不上的时候**宁可不认识**（当它不自洽 → 整份重置），
 * 而不是猜一个出来。
 */
export interface LegacyTranscribeConfig {
  engine?: 'openai' | 'volcengine'
  baseUrl?: string
  apiKey?: string
  model?: string
  resourceId?: string
}

export interface AiConfig {
  /** 优先使用远程还是本地 */
  mode: 'local' | 'remote'
  provider: 'openai-compatible'
  baseUrl: string
  apiKey: string
  model: string
  /** 远程失败时自动回退本地 */
  fallbackToLocal: boolean
  /**
   * 附加提示词 —— 家长在设置里写，AI 评分和改范文时会带上。
   * 比如「描写细致、多用修辞手法、注意段落衔接」。
   */
  extraPrompt?: string
}

/* ============================================================
   成长树 —— 时间产出
   ------------------------------------------------------------
   设计意图：让"回来看看"这件事本身有回报。
   树会按时间结出东西，挂在树上等孩子来收。
   挂满就不再结（避免无限堆积、也避免"离线一个月回来直接满级"），
   所以它奖励的是"常常回来"，而不是"挂着不管"。
   ============================================================ */

/**
 * 树上结出来的东西。
 *
 * ⚠️ `'coin'` 是**历史遗留**，这一版之后树上永远不结金币
 * （金币只能靠写出来，见 economy.ts）。保留它只是为了老存档里
 * 还挂着的几颗能正常收走，新存档不会产生。
 */
export type YieldKind = 'coin' | 'card' | 'seed' | 'letter'

/** 树上挂着的一份产出 */
export interface TreeYield {
  id: string
  kind: YieldKind
  /** 结出的时间 */
  at: number
  /** kind === 'coin' 时的数量 */
  amount?: number
  /** kind === 'card' 时的卡片定义 id */
  defId?: string
  /** kind === 'card' 时的稀有度（冗余存一份，渲染时不用再查表） */
  rarity?: Rarity
  /** 是不是新卡 */
  isNew?: boolean
}

export interface TreeState {
  /** 上次结算时间（用于算离线产出了多少） */
  lastTickAt: number
  /** 树上挂着、还没被收走的产出 */
  pending: TreeYield[]
  /** 累计收获次数 */
  harvests: number
  /** 累计产出金币 */
  totalCoins: number
  /** 累计产出卡片 */
  totalCards: number
  /** 树洞是否已解锁（达到段位后永久解锁） */
  hollowUnlocked: boolean
  /** 树洞解锁时间 */
  hollowAt?: number
  /** 已丢进树洞的日记 */
  hollowDiaries: HollowDiary[]
  /**
   * 树上冒出来的小事件（信 / 礼物 / 小客人 / 回响）。
   *
   * 为什么要挂在 TreeState 上而不是单独开一张表：
   * 事件本来就是"树按时间结出来的东西"的一部分，和 pending 同源；
   * 分开存会让"离线期间树发生了什么"被切成两块，反而难对齐。
   */
  events?: HollowEvent[]
}

/* ============================================================
   宠物 —— 小鸟
   ============================================================ */

export type BirdSpeciesId =
  | 'sparrow'
  | 'swallow'
  | 'oriole'
  | 'dove'
  | 'magpie'
  | 'bluebird'
  | 'crane'
  | 'phoenix'

export interface BirdSpecies {
  id: BirdSpeciesId
  name: string
  /** 解锁所需段位下标（0 = 一开始就有） */
  unlockLevel: number
  rarity: Rarity
  /** 性格，一句话 */
  persona: string
  /** 主色 / 副色，用来画鸟 */
  color: string
  color2: string
  /** 飞行速度倍率：越大越快回来 */
  speed: number
  /** 带回照片的概率加成 */
  photoBonus: number
  desc: string
}

export type BirdStatus = 'home' | 'away' | 'returned'

export interface Bird {
  species: BirdSpeciesId
  /** 昵称，孩子可以改 */
  nickname: string
  status: BirdStatus
  /** 出发时间 */
  departedAt?: number
  /** 预计回来的时间 */
  returnsAt?: number
  /** 这次去哪儿（地标 id） */
  destinationId?: string
  /* ⚠️ 这里原来有个 `contentId`（这次飞向哪个内容包），2026-09-25 删掉了。
     为什么能删：改成「先抽地标 → **到了**才抽事件」之后，出发时根本不知道
     会带回什么，写一个 contentId 上去就是**编的**。
     ⚠️ 老存档里那只已经在飞的鸟身上还留着这个字段 —— 无副作用，
        它只是被忽略了；鸟几小时内就回来了。 */
  /** 累计出行次数 */
  trips: number
  /** 累计带回的照片数 */
  photos: number
  /** 亲密度 0-100 */
  bond: number
  /** 领养时间 */
  adoptedAt: number
  /** 树上叼着信封（有没读的信） */
  hasLetter: boolean
}

/* ============================================================
   旅行 / 地图
   ============================================================ */

/** 照片里的画面类型，决定程序化插画怎么画 */
export type PhotoScene =
  | 'mountain'
  | 'water'
  | 'city'
  | 'desert'
  | 'forest'
  | 'snow'
  | 'temple'
  | 'coast'
  | 'grass'
  | 'cave'

/**
 * ★★ 「知名度」—— **我们自己判的**，跟官方 `rating`（5A/4A）分开。
 *
 * 家长 09-24 原话是「知名景点，都做5A」，但拿库里手工那 35 条去比
 * 官方 357 条 5A 名单，**只有 18 条对得上** —— 剩下的是天安门广场、
 * 上海外滩、桂林山水、呼伦贝尔草原这种**本来就不是景区、永远评不上 A 级**，
 * 却人人知道的地方。硬写 `rating: '5A'` 会让那个字段撒谎。
 *
 * ⚠️ 定义放这里（不是 `data/landmarks.ts`）的理由：`data/landmarks.ts`
 * 已经 `import` 了本文件，反过来引会成环。而且 `Landmark` 要用它。
 */
export type LandmarkFame = '世界知名' | '全国知名' | '地方知名'

export interface Landmark {
  id: string
  name: string
  /** 省 / 自治区 / 直辖市 / 特别行政区。国外条目填国家名 */
  province: string
  /**
   * 国家。★ **运行时一定有值** —— 国内条目在 `toLandmark()` 里补成「中国」。
   *
   * 为什么要加：凤凰那一档能飞到全世界（见 `travelRange.ts`），
   * 地图切到世界图之后要按国家分组显示「去过几个国家」。
   *
   * ⚠️⚠️ 这里**不能写成可选**（`country?: string`）—— 曾经是可选，
   *    于是「中国档 = `country === '中国'`」这个判据在类型上站不住，
   *    而一旦真按 `undefined` 去判，**中国档会一个点都不画**：
   *    地图空白、不报错、也没有日志。补值发生在 `data/landmarks.ts`
   *    的 `toLandmark()`（`seed.country ?? '中国'`），
   *    所以到这一层它已经是必填了。
   */
  country: string
  /**
   * 地级市。可省略 —— 目前只有广东那批由 OSM 生成的数据填了它。
   * 为什么要加：「广东省」这个粒度在库扩到上千条之后已经没法分组显示了，
   * 网页工具也要按市筛。
   */
  city?: string
  /** 经纬度（GCJ-02，与腾讯地图一致） */
  lng: number
  lat: number
  /** 一句话介绍，孩子看得懂 */
  blurb: string
  /**
   * ★★ 「景点公共简介」—— 挂在**地标**上的一段短介绍，≤ `LANDMARK_INTRO_MAX`。
   *
   * 跟 `blurb` 的区别（别把两个混成一个）：
   *   · `blurb`  是**数据源给的**，一句话，8~29 字，全库每条都有 —— 它是**兜底**；
   *   · `intro`  是**人写的**，一段话，给孩子读的 —— 只有写过的景点才有。
   *
   * 显示时是 `intro || blurb`（见 `MapPage.tsx` 与编辑器信息条），
   * 所以没写简介的景点**行为跟以前完全一样**。
   *
   * ★ 它**不属于**内容包（`travel-contents.json`）：那边是"一张图一条"的，
   *   而简介是"一个景点一条"的 —— 混进去就会出现"同一个景点两条简介，
   *   哪条生效看哪张图被选中"，那种不一致没有任何地方会报错。
   *   它的家在 `src/data/landmark-intros.json`（`landmarkId → 简介`）。
   *
   * ⚠️⚠️ 键是 **landmarkId**，打错一个字 = 这条简介**永远不会显示**，
   *    而且不报错、不崩、计数也不变（跟 `fameOf()` 用 id 那次同一类）。
   *    所以 `landmarkIntros.test.ts` 里有一条"每个键都要能解析到真实地标"。
   * ⚠️ 可省略 —— 绝大多数景点没有简介，那是**正常**的，不是数据不全。
   */
  intro?: string
  /**
   * 稀有度：越难去的越稀有，1 最常见。
   *
   * ⚠️ 这是**旧玩法**的产物。改成按距离分档选点之后（`travelRange.ts`），
   * 它**不再影响选点**，只剩「树上掉的树种往哪儿落」还在用
   * （`travel.ts` 的 `seedDestination`）。所以数据里可以省略，缺省 1。
   */
  tier: 1 | 2 | 3
  /**
   * ★ 「评级」= 国家 A 级旅游景区等级（5A / 4A）。
   *
   * ⚠️ **只有评到级的条目才有** —— 景区评级是发给"景区"的，而库里还有
   * 山峰、海滩、步行街、古村这些**本来就不是景区**的地方。
   * 所以缺这个字段**不等于**"数据不全"，界面上别显示成「暂无评级」。
   *
   * ⚠️ 与 `tier` 无关：`tier` 是旧玩法的稀有度（缺省 1），
   * `rating` 是官方称号。两个都别当对方用。
   */
  rating?: '5A' | '4A'
  /**
   * ★★ 「知名度」—— 我们自己判的（见 `LandmarkFame`）。
   *
   * ★ 全库每条都有（兜底「地方知名」），由 `scripts/build-landmarks-fame.mjs` 生成。
   * ⚠️ 与 `rating` **有交集但不相等**，别用一个推另一个：
   *    5A 多半是「全国知名」，但「全国知名」里有大量**没有 A 级称号**的
   *    （天安门广场 / 上海外滩 / 桂林山水 / 呼伦贝尔草原 + 231 条世界景点）。
   */
  fame: LandmarkFame
  /**
   * ★ 平台综合热度分（来源站自带的 `heatScore`）。
   *
   * ⚠️⚠️ **2026-09-24 之前这个字段是坏的** —— 这里原本写着
   *    「5A 约 335/357 有；4A 的 top 1000 每条都有」，但实际 **0/1348 条有值**：
   *    `landmarks-cn.json` 生成于 13:39，而带 heat 的抓取/生成脚本改于 17:10，
   *    盘上那份数据从来没跑过新代码；而且 `toLandmark()` 压根没抄这个字段。
   *    已重新生成。**教训：注释描述的是"代码打算做什么"，不是"盘上有什么"。**
   *
   * 没有就是"源里没有"，**不等于"数据不全"**。
   * ⚠️ 是**平台热度**（偏向"有人点评/打卡"），**不是**知名度 —— 两者别混。
   */
  heat?: number
  /** 照片配色 [天, 地] */
  palette: [string, string]
  scene: PhotoScene
}

export interface TravelPhoto {
  id: string
  landmarkId: string
  /** 谁带回来的 */
  birdSpecies: BirdSpeciesId
  at: number
  /** 配文 */
  caption: string

  /* ---------------- v5 遗留字段（**只为老存档留着**） ----------------

     ⚠️⚠️ 2026-09-24 起，**新写的代码不要再用这几个字段**。
        内容包那条路改走 `TravelContent` → `TravelSouvenir` 了
        （见 `pets.ts` 的 `resolveReturn`），`makePhoto` 也不再产出它们。

     为什么还留着：老存档的 `photos` 表里存着带这些字段的记录，
     删掉类型定义会让那些记录在 TS 看来"多了不认识的键"，
     而相册读的正是这些历史数据 —— 删了它们，孩子以前拍到的
     照片会**静默地变成没有图片、没有散文**。

     ➜ 什么时候能删：确认没有老存档在用了（比如相册改成只读纪念品之后）。
     全部可选 —— 老存档里的照片没有这些字段，不能要求它们存在。 */

  /** 开源图片地址（Unsplash 等）。离线加载不出来时退回插画 */
  photoUrl?: string
  credit?: PhotoCredit
  /** 拍照的地方，给孩子看的地名（可能比地标名更口语，如「中国长城」） */
  place?: string
  /** 飞了多远（公里） */
  distanceKm?: number
  /** 小鸟写回来的散文 */
  essay?: string
}

/**
 * 开源图片的署名。
 *
 * 为什么必须存：内容包里的图片全部是**外部地址**，
 * 开源不等于可以不留名。存下作者和出处，相册里就能标出来。
 */
export interface PhotoCredit {
  /**
   * 摄影者。
   *
   * 可选，而且**查不到就留空，不要编**：编一个名字比不写更糟，
   * 那是对真实摄影师张冠李戴。留空时界面只显示图库来源。
   */
  author?: string
  /** 图库名，如 'Unsplash' */
  source: string
  /** 图片详情页，方便回溯授权 */
  link: string
}

/* ============================================================
   场景外链图片 —— AI 生成或图库找的插画替换 / 补充 SVG
   ============================================================ */

/** 场景图片的风格 */
export type SceneImageStyle = 'cartoon' | 'watercolor' | 'photo'

/**
 * 一张外链场景图片的元数据。
 *
 * 用法见 `domain/sceneImages.ts` 的注释。
 * 核心思路：`sceneKey` 对上 `scenes.tsx` 的 SCENES，填了就用，
 * 没填或加载失败就退回 SVG。
 *
 * `style` 标注图片是什么风格（cartoon / watercolor / photo），
 * 渲染时会根据风格做微调（photo 风格加柔光，让实景和卡通在
 * 同一篇文章里配着也不突兀）。
 *
 * `credit` 可选：填了就留个底，不填也行。
 * 不管是 AI 生成的还是图库找的，都只需要一句话写清来源就行。
 */
export interface SceneImageEntry {
  /** 对应 scenes.tsx 里 SCENES 的 key，必须真实存在 */
  sceneKey: string
  /** 图片地址，必须是 https 外链 */
  imageUrl: string
  /** alt 文字，给屏幕阅读器 / 加载失败时显示 */
  alt: string
  /** 图片风格：cartoon（卡通绘本）/ watercolor（水彩手绘）/ photo（实景照片） */
  style: SceneImageStyle
  /** 来源信息（可选）。一句话写清就行，如 'DALL-E 3 生成' / 'Unsplash' / '自己拍的' */
  source?: string
}

/* ============================================================
   旅行内容包 v6 —— 小鸟随便飞，带回各种内容
   ============================================================ */

/**
 * 内容类型 —— 决定**纪念品卡片怎么渲染**（图片框 / 播放器 / 格言卡 / 笑话卡 …）。
 *
 * ⚠️⚠️ 它**不在内容包里**了（2026-09-25 家长定的）。
 *    「类型」是**事件系统**的事：到了旅游点先抽一个事件，
 *    抽到拍照才从该景点的图片里随机一张；笑话 / 音乐 / 格言各有自己的池子。
 *    ➜ 内容包（`travel-contents.json`）只存**图片附件**，不带 type。
 *    ➜ 纪念品的 `type` 由**事件**给，不是从内容包抄的。
 *
 * ★ 六个值都还留着：`kept: true` 的纪念品**永不过期**，
 *   老存档里可能有 story / video 的纪念品 —— 删掉它们的渲染分支
 *   会让那张卡片变成一片空白（标题还在、内容没了）。
 */
export type TravelContentType = 'photo' | 'music' | 'joke' | 'video' | 'quote' | 'story'

/**
 * ★ 现在**真的会抽到**的事件类型 —— 就是 `TRAVEL_EVENTS` 里那几条。
 *
 * 是 `TravelContentType` 的**子集**：story / video 的数据还在
 * （`travel-event-contents.json` 里占位），但**还没接**事件系统，
 * 所以暂时抽不到。接的时候只要往 `TRAVEL_EVENTS` 加两行 + 定权重。
 */
export type TravelEventKind = 'photo' | 'joke' | 'music' | 'quote'


/* ---------------- 旅行内容包：等级 ---------------- */

/**
 * ★★ 一张旅行照片的「等级」—— **只做展示标注，不影响掉落概率**。
 *
 * 家长 2026-09-24 明确：「只需要标注等级」。
 * 所以这里**没有** `weight` 字段 —— 与卡片的 `RARITIES` 是**两件事**：
 *
 *   · 卡片稀有度（`Rarity`）：**真的**按 weight 抽，决定开出什么卡
 *   · 照片等级（`TravelGrade`）：人**标**上去的，只是让家长和孩子看得出
 *     「这张是随手拍的」还是「这张值得裱起来」
 *
 * ⚠️⚠️ 别顺手给这里加 weight、也别让 `pickContent` 读它 ——
 *    那会把"标注"变成"概率"，而家长要的是标注。
 *    真要做"传世很难拿到"，是**另一件事**，要单独确认。
 *
 * 五档的名字是家长定的（顺路 · 驻足 · 奇遇 · 绝景 · 传世），
 * 配色是「绿 → 蓝 → 紫 → 红 → 金」—— 前四档里绿/蓝/紫与卡片
 * 稀有度同色系，红和金是这一套自己加的（卡片没有红）。
 */
export type TravelGrade = '顺路' | '驻足' | '奇遇' | '绝景' | '传世'

export interface TravelGradeMeta {
  key: TravelGrade
  /** 序号 1–5，用来排序和画进度（别用数组下标，容易跟顺序脱节） */
  order: number
  color: string
}

/**
 * ★ 顺序即等级高低（数组顺序 = `order` 递增）。
 * ⚠️ 别重排这个数组 —— 界面上「高等级在上」是按 `order` 排的。
 */
export const TRAVEL_GRADES: TravelGradeMeta[] = [
  { key: '顺路', order: 1, color: '#3e7f5e' },
  { key: '驻足', order: 2, color: '#42779a' },
  { key: '奇遇', order: 3, color: '#8c73c5' },
  { key: '绝景', order: 4, color: '#c9534a' },
  { key: '传世', order: 5, color: '#c98a2e' },
]

/** 等级 → 元数据。查不到时返回最低档（界面永远拿得到一个颜色） */
export function gradeMeta(g: TravelGrade | undefined): TravelGradeMeta {
  return TRAVEL_GRADES.find((x) => x.key === g) ?? TRAVEL_GRADES[0]
}

/*
 * ★★ 「景点公共简介」的字数上限**定义在 `landmarkIntro.ts`**，
 *    这里只是**转出去**方便 `src/` 侧引用（`data/`、测试都从这儿拿）。
 *
 *    ⚠️ 为什么不定义在这儿：`vite.config.ts`（落盘那道闸）也要读它，
 *       而那个文件的 tsconfig 是 `moduleResolution: nodenext` ——
 *       引 `types.ts` 会把 `types.ts` 也拉进 node 那个项目，而它自己那句
 *       `import type { CharacterSpec } from './character'` 不带扩展名，
 *       会直接报 TS2835（实测红在那一行）。
 *       那个小文件**自己不 import 任何东西**，所以两边都能引。
 *    ⚠️ **千万别在这里再写一个 300** —— 理由见 `landmarkIntro.ts` 的抬头。
 */
export { LANDMARK_INTRO_MAX } from './landmarkIntro'

/**
 * ★★ 这张图跟那个地方的**关系** —— 说真话用的，不是画质评分。
 *
 * 为什么要有这个字段（2026-09-25）：默认图是"搜网页 → 拼 CDN 地址"弄来的，
 * 而有些地方**图库里根本没有**（丹麦小美人鱼、委内瑞拉天使瀑布 —— 实测各试了 3～5 个检索词）。
 * 那时候只有两条路：
 *   · 硬凑一张别的雕像/别的瀑布，标成"这就是它" → **界面在撒谎，而且看不出来**
 *   · 记下 `scene`，承认"这张只是同地带的顶替图" → 复核的人一眼能看见
 *
 * ➜ `place` = 真的搜到了这个地方；`scene` = 搜不到，用同地带的照片顶上。
 *
 * ⚠️⚠️ 别拿它当"图片质量"用：`scene` 不代表图难看，只代表**这不是它本人的样子**。
 * ⚠️ 也**别**用它做筛选/加权 —— 它只描述来源，不参与任何掉落概率。
 */
export type PhotoMatch = 'place' | 'scene'

/**
 * 旅行内容包的一条 —— **一个景点的一张图片附件**。
 *
 * ★★ 2026-09-25 家长重新定的口径：
 *    「图片是附件的。会有很多图。但是经纬度 / 旅游点 / 热度 / 知名度等
 *     都是**共同的**。另外不需要类型 —— 类型是事件，是另外的系统。」
 *
 * ➜ 所以这里**只留"这一张图自己的东西"**：
 *    图片地址、标题、等级、署名、摘要、散文。
 * ⚠️ `landmarkId` 从"可选"变成**必填** —— 图片是挂在地标上的附件，
 *    没有地标就没有坐标，小鸟就没地方飞。
 * ⚠️ `place` / `lng` / `lat` 是**派生字段**：`toTravelContent()` 从
 *    `landmarkId` 查地标填进来，**JSON 里不存**。
 *    为什么不干脆删掉让消费端自己查：`distanceToContent()`、纪念品、
 *    地图都在读它们，派生一次比让七八处各查一遍安全。
 *    ⚠️ 以前是逐条手写的 —— 八达岭两条就写出了两套不同的经纬度。
 */
export interface TravelContent {
  id: string
  /** 关联的地标 —— **必填**，且必须真的存在（有测试守着） */
  landmarkId: string
  title: string
  /** 图片 URL（https 外链）。草稿可以先空着，编辑器会提示缺什么 */
  mediaUrl?: string
  /** 署名 */
  credit?: PhotoCredit
  /** 一句话摘要 */
  summary: string
  /** 散文正文（用 \n\n 分段） */
  essay?: string
  /**
   * ★ 等级（顺路 · 驻足 · 奇遇 · 绝景 · 传世）。
   *
   * **只做展示标注**，不影响小鸟带什么回来（见 `TravelGrade` 的注释）。
   */
  grade?: TravelGrade
  /**
   * ★ 这张图跟这个地方的**关系**（见 `PhotoMatch`）。
   *
   * ⚠️ 只有**默认图**（`data/landmark-photos.json`）会带这个字段；
   *    家长手挑的内容包图片**不写** —— 不写的意思是"没声称过"，
   *    跟 `scene`（声称"这是顶替图"）是两回事。别在界面上把"没写"显示成"顶替图"。
   */
  match?: PhotoMatch

  /* ---------------- 以下三个是派生字段（JSON 里不存） ---------------- */
  /** 给孩子看的地名 —— 就是地标名 */
  place: string
  /** 坐标 —— 小鸟真正飞过去的地方（= 地标的坐标） */
  lng: number
  lat: number
}

/** 小鸟带回的纪念品 —— 阅后即毁 */
export interface TravelSouvenir {
  id: string
  contentId: string
  type: TravelContentType
  title: string
  place: string
  mediaUrl?: string
  textContent?: string
  credit?: PhotoCredit
  /** 散文正文 */
  essay?: string
  /**
   * ★ 等级，从内容包抄下来的（`resolveReturn` 里 `content.grade` → `souvenir.grade`）。
   *
   * ⚠️ 必须抄进纪念品里：相册显示的是**纪念品**，不是内容包。
   *    不抄的话内容包里标了「传世」，相册里却按最低档上色 ——
   *    又是一次「数据有、界面没接上」的静默降级。
   */
  grade?: TravelGrade
  /**
   * ★ 这张图跟这个地方的**关系**，从内容（默认图）抄下来的。
   *
   * ⚠️ 跟 `grade` 同理，**必须抄进纪念品里**：相册显示的是纪念品。
   *    不抄的话默认图里标了 `scene`，相册却当它是实景 —— 界面在撒谎。
   *
   * ⚠️⚠️ **`undefined` ≠ `'scene'`**（见 `TravelContent.match` 的注释）：
   *    家长手挑的图**不写**这个字段，意思是"没声称过"。
   *    界面上**只许**在 `=== 'scene'` 时提示，不许把"没写"显示成"示意图"。
   */
  match?: PhotoMatch
  distanceKm: number
  birdSpecies: BirdSpeciesId
  at: number
  /** 过期时间（默认 24 小时后） */
  expiresAt: number
  /** 是否已用金币永久保留 */
  kept: boolean
  /** 保留花费 */
  keepCost: number
}

/** 小鸟到过的地标记录 */
export interface VisitedLandmark {
  landmarkId: string
  firstAt: number
  visitCount: number
}

/** 地标上发芽的树种 —— 点亮地图 */
export interface Sprout {
  landmarkId: string
  at: number
  /**
   * 是哪只鸟带来的种子。
   * 树上自己掉下来的树种没有鸟送，这里留空。
   */
  byBird?: BirdSpeciesId
  /** 长到第几级 1-3，树越多长得越快 */
  stage: number
}

/* ============================================================
   树洞
   ============================================================ */

export type HollowEventKind = 'letter' | 'gift' | 'visitor' | 'echo'

export interface HollowEvent {
  id: string
  kind: HollowEventKind
  at: number
  title: string
  body: string
  /** 小鸟叼来的信封 */
  fromBird?: BirdSpeciesId
  /**
   * 附带奖励。
   * ⚠️ `coins` 是历史遗留：树洞不再直接送金币（树不产金币），
   * 礼物改成送一颗树种。保留字段只是为了老存档的事件还能正常渲染。
   */
  coins?: number
  /** 附带一颗树种（礼物事件） */
  seeds?: number
  defId?: string
  read: boolean
}

/** 被丢进树洞的日记 —— 树洞会回一句温柔的话 */
export interface HollowDiary {
  id: string
  entryId: string
  dayKey: string
  at: number
  /** 附带的录音 dataURL */
  audio?: string
  /** 树洞的回响 */
  echo: string
}

/* ---------------- 通用 ---------------- */

export type TabKey = 'compose' | 'diary' | 'level' | 'map' | 'cards'
