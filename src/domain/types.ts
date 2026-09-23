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
  baseUrl: string
  apiKey: string
  model: string
  /**
   * 走哪条路：
   *   'openai'（默认） 整包上传 —— 录完 → 传整段 → 等结果
   *   'volcengine'    流式，边说边传 —— 孩子还在说，音频已经过去了
   *
   * 可选，为了兼容老存档：没有这个字段就按 'openai' 走。
   */
  engine?: 'openai' | 'volcengine'
  /** 火山的资源 ID（留空用 volc.seedasr.sauc.duration） */
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
  /** 这次飞向哪个内容包（v6） */
  contentId?: string
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

export interface Landmark {
  id: string
  name: string
  /** 省 / 自治区 / 直辖市 / 特别行政区。国外条目填国家名 */
  province: string
  /**
   * 国家。可省略，缺省按「中国」。
   *
   * 为什么要加：凤凰那一档能飞到全世界（见 `travelRange.ts`），
   * 地图切到世界图之后要按国家分组显示「去过几个国家」。
   * 国内条目一律省略，省得 1500 条里全是重复的「中国」。
   */
  country?: string
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

  /* ---------------- v5：内容包（可选） ----------------
     有内容包时这几项会被填上，相册里显示真实照片和散文；
     没有的话退回原来的程序化插画 + 一句话配文。
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

/**
 * 小鸟旅行带回来的一段内容 —— 一张照片 + 一篇散文。
 *
 * 设计前提：**App 是离线的**。内容不是实时生成的，而是一份预先写好的
 * 数据包（`domain/travelStories.ts`），按地标 id 索引。
 *
 * 三条约定：
 *   1. 图片**只存开源地址**，不下载、不打包进 APK —— 省体积，也避开版权；
 *      加载失败时界面必须能退回程序化插画，不能白屏。
 *   2. 正文只存纯文本，渲染时按段落切分，不存 HTML。
 *   3. 一个地标一条，`landmarkId` 必须能在 `LANDMARKS` 里找到，
 *      否则这条内容永远没有机会被小鸟带回来（测试会拦）。
 */
export interface TravelStory {
  /** 对应 LANDMARKS 里的地标 id */
  landmarkId: string
  /** 拍照的地方，给孩子看的地名，如「中国长城」 */
  place: string
  /** 开源图片地址 */
  photoUrl: string
  credit: PhotoCredit
  /**
   * 在地图上的落点（可选）。
   *
   * **不填就用 LANDMARKS 里该地标的经纬度** —— 绝大多数情况这就够了，
   * 所以这一项大部分时候是空的，别被它吓到。
   *
   * 什么时候才需要填：想把点钉得更准。比如长城想钉在八达岭那个具体的
   * 烽火台，而不是整个景区的中心点。
   *
   * 两个都要给：只给一个会被当成没给（半对坐标画不出点，宁可退回地标坐标）。
   */
  lng?: number
  lat?: number
  /**
   * 飞了多远（公里）。
   *
   * 留空时由 `travelStories.distanceKmFromHome()` 按经纬度推算 ——
   * 所以填不填都行，填了以填的为准（比如想用真实公路里程）。
   */
  distanceKm?: number
  /** 一句话摘要，相册列表和 toast 里用 */
  summary: string
  /**
   * 散文正文。
   * 用 `\n\n` 分段；界面按空行切成段落，不做 Markdown 解析。
   */
  essay: string
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

/** 内容类型 */
export type TravelContentType = 'photo' | 'music' | 'joke' | 'video' | 'quote' | 'story'

/** 旅行内容包 —— 小鸟飞过去的地方和带回的东西 */
export interface TravelContent {
  id: string
  type: TravelContentType
  /** 关联的地标（可选）。同一个地标可有多条内容 */
  landmarkId?: string
  title: string
  place: string
  /** 坐标 —— 小鸟真正飞过去的地方 */
  lng: number
  lat: number
  /** 图片/音乐/视频 URL */
  mediaUrl?: string
  /** 文本内容（笑话、格言、故事） */
  textContent?: string
  /** 署名 */
  credit?: PhotoCredit
  /** 一句话摘要 */
  summary: string
  /** 散文正文（照片/音乐/视频配散文） */
  essay?: string
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
