/* ============================================================
   语音编辑引擎 —— 「我说了算」
   ============================================================

   这是本 App 最核心的机制，也是最需要守住底线的地方。

   需求原文：
     "他录入已经录入作文『一根直直的棍子XXXX』。
      他再录入『棍子变成竹签』，那么作文就修改为竹签。
      编辑的绝不允许 AI 帮改写。必须是小孩自己的能力。"

   所以我们的职责划分非常清楚：

     ✔ 系统能做：把「棍子」找出来，换成「竹签」
     ✔ 系统能做：理解孩子说的「变成 / 改成 / 换成」是什么意思
     ✔ 系统能做：把修改记录留档，让孩子看到自己改了什么
     ✘ 系统不做：替孩子想一个更好的词
     ✘ 系统不做：润色、扩写、缩写孩子的句子
     ✘ 系统不做：在孩子没说的情况下改动任何一个字

   换句话说：孩子指哪，我们改哪。判断权 100% 在孩子手里。

   ------------------------------------------------------------
   ★ 2026-09-19 补一句澄清 —— 上面那句"绝不允许 AI 帮改写"
     容易被读成"AI 一个字都不许参与"，那是**读窄了**。家长的原话：

       「不许 AI 帮改写。是**不许 AI 帮写**，不是不允许改写。
         比如小明正在吃饭，把正在去掉可以，小明后面加小红可以，
         把小明改成大明可以。但不允许 AI 自己生产内容 ——
         类似『给这个句子加点比喻』都不行。」

     分界线是**内容的来源**，不是"谁在操作"：

       ✔ 可以改（字是孩子自己说的）—— 换 / 删 / 挪位置
         · 谁把这些字找出来、放到对的位置上，不影响这条判断
         · 所以大模型可以来"听懂"孩子说了什么（见 ai.ts 四·五节），
           它翻出来的只是一条指令，正文仍然由**本文件**生成
       ✘ 不可以写（内容是 AI 造的）—— 润色 / 扩写 / 加比喻 / 想结尾

     落地方式见本文件顶部的 `refuse` 分支和 ai.ts 的
     `parseEditInstruction`：**不靠提示词求模型别写，靠接口形状让它写不了**。
   ============================================================ */

import type { EditOperation, Utterance } from './types'

/* ============================================================
   一、编辑指令识别
   ============================================================ */

/**
 * 「孩子指的是哪一处？」
 *
 * 目标在原文里出现多次时，孩子常常**自己已经指好了**：
 *   · 「把玩篮球后面的句号改成叹号」—— 用**参照物**指位（`near` + `side`）
 *   · 「把**最后的**句号改成叹号」—— 用**顺序**指位（`pick`）
 * 这两种情况下都不该再弹候选面板问他一遍（他刚说过）。
 *
 * ★★ `replace` / `delete` / `replace-punct` **共用这一组字段**，
 *    也共用执行层那**一个**定位函数（`locateOccurrence`）。
 *    三个分支各写一遍就会出现「改了一条忘了另一条」——
 *    本项目反复出现的病（§四 `resolveKind` / §六 `replacePairOf`）。
 *
 * ⚠️ 全部可选。什么都不给 = "孩子没说哪一处"，执行层照老规矩：
 *    唯一就改、多个就停下来问。
 */
export interface OccurrenceHint {
  /** 参照物：必须是原文里**一字不差**出现过的字 */
  near?: string
  /** 目标在参照物的哪一边。缺省 `'after'` —— 「X 后面的那个」是最常见的说法 */
  side?: 'after' | 'before'
  /** 没给参照物、但目标出现多次时：孩子说了「最后的」/「第一个」 */
  pick?: 'last' | 'first'
}

export type EditIntent =
  | ({ kind: 'replace'; from: string; to: string } & OccurrenceHint)
  | { kind: 'append'; text: string }
  /**
   * ★ 定位插入 —— 2026-09-19 补的，之前**整类缺失**。
   *
   * 家长报的原话：「小明后面加那个时候」处理不了。
   * 根因就是这里根本没有 insert 这一支（只有 replace/delete/append/undo），
   * 所以「在 X 后面/前面/之间加 Y」全部落到 unknown。
   *
   * `anchor` 是孩子指定的锚点（「小明」），`position` 是加在它前还是后。
   * 插入的**内容仍然来自孩子自己**，系统只负责听懂"加在哪"——
   * 所以这条完全不违反「不许替孩子写」的底线。
   */
  | { kind: 'insert'; anchor: string; text: string; position: 'after' | 'before' }
  /**
   * ★ 2026-09-21 补 `OccurrenceHint`：删除的**相对指位**之前是整类缺失。
   *
   * 家长 09-20 报的「把玩篮球后面的字去掉」处理不了，根因就在这里 ——
   * `delete` 只有 `target` 一个字段，孩子用参照物指位时，
   * **模型没有地方可以表达"哪儿"**（详见 MEMORY §十一 末条）。
   * 现在 `near` / `side` / `pick` 和 replace 完全对称。
   */
  | ({ kind: 'delete'; target: string } & OccurrenceHint)
  /**
   * ★ 改标点 —— 2026-09-20 补的，之前**整类缺失**。
   *
   * 家长报的原话：「我说把玩篮球后面的句号改成叹号。始终不行。理解不行。」
   *
   * 根因有两层，缺一层都不算修好：
   *   ① 孩子说的是标点的**名字**（句号 / 叹号），正文里却是**符号**（。 / ！）。
   *      旧代码把「玩篮球后面的句号」整串当字面量去找，当然找不到。
   *   ② 「X 后面的那个标点」是一种**相对指位**，旧代码只会找字面量，
   *      没有"以某个词为参照物"这个概念。
   *
   * `from` / `to` 存的都是**真符号**（。 / ！），不是名字 ——
   * 名字到符号的翻译在解析那一步就做完了，执行层只管找符号。
   */
  | ({ kind: 'replace-punct'; from: string; to: string } & OccurrenceHint)
  | { kind: 'undo' }
  /**
   * 要求**系统生成内容**（「加点比喻」「润色一下」「扩写」…）。
   *
   * 这是唯一被禁止的一类请求 —— 不是"不会做"，是**不许做**：
   * 作文必须是孩子自己的能力。界面要明确告诉孩子"这个得你自己写"，
   * 而不是假装没听懂（那会让孩子反复试）。
   */
  | { kind: 'refuse'; reason: 'content' }
  | { kind: 'unknown'; raw: string }

/**
 * 中文口语里表达「修改」的各种说法。
 * 孩子说话不会像大人那么规范，所以要覆盖得宽一点。
 */
const REPLACE_VERBS =
  '改成|改为|换成|换为|变成|变为|改成是|改叫|写作|写成|修改成|修改为|改做|换做'

/** 删除类动词 —— 必须单独一组，因为它只有一个捕获组 */
const DELETE_VERBS = '删掉|删除|去掉|删了|不要了|划掉|抹掉|不要|拿掉'

/* ============================================================
   位置词与「加」类动词（定位插入用）
   ------------------------------------------------------------
   ⚠️ 位置词**必须长的排前面**（`后面` 在 `后` 之前）。
     正则的或分支是「先匹配先赢」，写反了就会把「后面」切成「后」+「面…」。

   ⚠️⚠️ 判断"前插还是后插"**不能靠 startsWith('后')**。
     踩过一次：「之后」是以「之」开头的，`startsWith('后')` 为假，
     于是「小明之后加小红」被当成了**前插** —— 意思正好说反，
     而且不会报任何错。改成"查表"，以后往列表里加词也不可能加错桶。
   ============================================================ */
const AFTER_WORD_LIST = ['后面', '后边', '之后', '后头', '后']
const BEFORE_WORD_LIST = ['前面', '前边', '之前', '前头', '前']

const AFTER_WORDS = AFTER_WORD_LIST.join('|')
const BEFORE_WORDS = BEFORE_WORD_LIST.join('|')
const POS_WORDS = `${AFTER_WORDS}|${BEFORE_WORDS}`

const AFTER_SET = new Set(AFTER_WORD_LIST)
/** 捕获到的是"后插"类位置词吗（`之后` / `后面` / `后` …） */
const isAfterPos = (word: string) => AFTER_SET.has(word.trim())

/* ============================================================
   一·五、标点
   ------------------------------------------------------------
   孩子说的永远是标点的**名字**（「句号」「叹号」），
   正文里存的却是**符号**（「。」「！」）。中间必须有一次翻译，
   否则「把玩篮球后面的句号改成叹号」会被当成"去找『玩篮球后面的句号』
   这九个字" —— 那是家长报的「始终不行」的直接原因。
   ============================================================ */

/**
 * 标点的口语名 → 符号。
 *
 * ⚠️ 同一个符号有多个叫法，都要收（孩子说「叹号」还是「感叹号」都对）。
 *    键的顺序无所谓，但**长名字要能先匹配上** —— 见 PUNCT_NAME_RE 的说明。
 */
const PUNCT_BY_NAME: Record<string, string> = {
  句号: '。',
  逗号: '，',
  叹号: '！',
  感叹号: '！',
  感叹符: '！',
  问号: '？',
  顿号: '、',
  分号: '；',
  冒号: '：',
  省略号: '……',
}

/**
 * 匹配「标点名」的正则片段。
 *
 * ⚠️ 「感叹号」必须排在「叹号」前面，否则正则的**最左优先**会先啃掉
 *    「叹号」那一支 —— 但「感叹号」里的「叹」前面还有「感」，
 *    左优先匹配在「感」这个位置压根匹配不上「叹号」，所以真正的风险是
 *    反过来：不排序也能过，但排了更稳。名字长的一律放前面。
 */
const PUNCT_NAMES = Object.keys(PUNCT_BY_NAME).sort((a, b) => b.length - a.length)
const PUNCT_NAME_RE = `(?:${PUNCT_NAMES.join('|')})`

/** 符号 → 口语名（回执文案用。孩子听「。」不如听「句号」亲切） */
const PUNCT_DISPLAY: Record<string, string> = {
  '。': '句号',
  '，': '逗号',
  '！': '叹号',
  '？': '问号',
  '、': '顿号',
  '；': '分号',
  '：': '冒号',
  '……': '省略号',
}

/** 给孩子的说法：认识的用名字，不认识的直接把符号回显 */
export const punctName = (sym: string): string => PUNCT_DISPLAY[sym] ?? `「${sym}」`

/**
 * 方位后缀 —— 附着在前一个名词上，**不能插在它中间**。
 *
 * 「半大的小学生在操场|上玩篮球」把字插进「操场」和「上」之间，
 * 会得到「在操场快乐的上玩篮球」这种谁也不说的话。
 * 孩子说「操场后」时，他心里的词是「操场上」，所以定位要**贴到词的尾巴**。
 *
 * ⚠️ 只收真正的处所后缀（上中里下内外边面间旁）。
 *    「前/后」故意**不收** —— 它们既当方位后缀（门前）又当连接词（然后），
 *    收了会把「小明后来走了」误伤成「小明后」。
 */
const LOCATIVE_SUFFIX = /[上中里下内外边面间旁]/

/** 「加」类动词。**绝不能混进删除动词**，否则「把X后面的去掉」会被当成插入 */
const INSERT_VERBS =
  '加上|加一句|加个|添加|添上|插入|插上|补上|加|添|插|补'

/**
 * 「最后 / 末尾 / 结尾」这类词**不是锚点**，是"加在整篇末尾"的意思。
 *
 * ⚠️ 和标点那边的「最后的句号」是**同一个坑**（见 PUNCT_PATTERNS 的说明）：
 *    插入那条正则的 `(.+?)` 会把「最」当锚点、「后」当方位词，
 *    于是去正文里找「最」→ 报「文中没有找到『最』」。
 *    「最后加上我很开心」本来是极自然的一句话。
 *
 * 见到这种词就不当锚点，让它落到下面「追加」那条路上。
 * ⚠️ 长的排前面，别让「最后」抢了「最后面」的活。
 */
const TAIL_WORDS = ['最后面', '最后边', '最后头', '最末尾', '最后', '末尾', '结尾', '末了']
const TAIL_RE = `(?:${TAIL_WORDS.join('|')})`

/**
 * 这个 anchor 是不是"尾词"？
 *
 * ⚠️ 判据不能只是"等于某个尾词" —— 插入那条正则里 `(${POS_WORDS})` 会把
 *    「后」吃掉，`(.+?)` 只剩一个**「最」**。所以真正要比的是
 *    "**是某个尾词的前缀**"（「最」是「最后」的前缀）。
 *    只判相等的话守卫不会生效，而且**不报任何错** —— 实测就是这样漏过去的。
 */
const isTailAnchor = (anchor: string) =>
  Boolean(anchor) && TAIL_WORDS.some((w) => w.startsWith(anchor))

const INSERT_PATTERNS: { re: RegExp; pick: (m: RegExpMatchArray) => { anchor: string; text: string; position: 'after' | 'before' } }[] = [
  {
    // 「把 Y 加到 X 后面」/「把 Y 加在 X 前面」
    re: new RegExp(
      `^把\\s*(.+?)\\s*(?:${INSERT_VERBS})(?:到|在|进)\\s*(.+?)\\s*(${POS_WORDS})$`,
    ),
    pick: (m) => ({
      text: m[1].trim(),
      anchor: m[2].trim(),
      position: isAfterPos(m[3]) ? 'after' : 'before',
    }),
  },
  {
    /*
     * 「X 和 Z 之间加上 Y」—— 插到**第二个名字前面**。
     *
     * 为什么不是"第一个名字后面"：`和` 是挂在第一个成分尾巴上的
     * （「小明和」= "小明 and"），所以两个名字中间的那个空档，
     * 位置在 `和` 之后、第二个名字之前。
     * 插到 `和` 前面会变成「小明那个时候和小刚」，反而更不通。
     */
    re: new RegExp(
      `^(.+?)\\s*(?:和|跟|与)\\s*(.+?)\\s*(?:之间|中间)\\s*(?:${INSERT_VERBS})\\s*[：:]?\\s*(.+?)$`,
    ),
    pick: (m) => ({ anchor: m[2].trim(), position: 'before', text: m[3].trim() }),
  },
  {
    // 「(在|把) X 后面加上 Y」—— 最常见的一种，放最后
    /*
     * ⚠️ 前缀必须同时吃掉「在」和「把」。
     *    原来只写了 `(?:在)?`，于是孩子说「**把**操场后加上快乐的」时，
     *    `(.+?)` 会把「把」一起吞进 anchor，变成 anchor=「把操场」→
     *    「文中没有找到『把操场』」。这是家长报的「搞了半天」的直接原因：
     *    孩子最自然的说法（带「把」）100% 失败，他只会换个说法再试一次，
     *    于是看起来像"AI 理解不行"，其实是这一行漏了一个字。
     */
    re: new RegExp(
      `^(?:在|把)?\\s*(.+?)\\s*(${POS_WORDS})\\s*(?:${INSERT_VERBS})\\s*[：:]?\\s*(.+?)$`,
    ),
    pick: (m) => ({
      anchor: m[1].trim(),
      position: isAfterPos(m[2]) ? 'after' : 'before',
      text: m[3].trim(),
    }),
  },
  {
    /*
     * 「(在|把) X 上/里/中 加上 Y」—— 方位词**本身就是**"加在这儿"的意思，
     * 孩子不会再说一遍"后面"。
     *
     * 加这一条之前，「把操场上加上快乐的」直接落到 unknown（"没太听懂"），
     * 因为上面三条都要求出现"后/前"。而"在……上加上"是极自然的说法。
     *
     * anchor 取「X + 方位词」整体（操场上），于是插入点天然落在词尾，
     * 不需要再靠 LOCATIVE_SUFFIX 去贴。
     */
    re: new RegExp(
      `^(?:在|把)?\\s*(.+?)\\s*([上中里下内外边面间旁])\\s*(?:${INSERT_VERBS})\\s*[：:]?\\s*(.+?)$`,
    ),
    pick: (m) => ({ anchor: m[1].trim() + m[2], position: 'after', text: m[3].trim() }),
  },
]

/**
 * 改标点 —— 「把 X 后面的句号改成叹号」。
 *
 * ⚠️ 必须放在**所有别的规则之前**（紧跟撤销）。
 *    它的判据最严（两边都必须是标点名），所以不可能抢别人的活；
 *    反过来放在替换后面就晚了 —— 通用替换会先把
 *    「玩篮球后面的句号」整串当字面量抓走，然后报"找不到"。
 *
 * 三种说法：
 *   · 有参照物：「把【玩篮球】后面的句号改成叹号」→ near = 玩篮球
 *   · 说"最后"：「把【最后】的句号改成叹号」     → 不给 near，执行时取最后一个
 *   · 光说标点：「把句号改成叹号」               → 不给 near，全文找；多处就停下来问
 */
const PUNCT_PATTERNS: {
  re: RegExp
  pick: (m: RegExpMatchArray) => { from: string; to: string; near?: string; pick?: 'last' | 'first' }
}[] = [
  {
    /*
     * 「把(最后的|结尾的)句号改成叹号」—— ★ 必须排在"参照物"那条**前面**。
     *
     * 踩过：放后面时，参照物那条的 `(.+?)` 会把「最」当成参照物、
     * 把「后」当成方位词 —— 于是去正文里找「最」，报"找不到"。
     * 「最后 / 第一个」是**固定关键词**，见到就得先认出来。
     */
    re: new RegExp(
      `^(?:把|在)?\\s*(?:最后|末尾|结尾|最后面|最末尾)(?:的|那个|一个)?\\s*(${PUNCT_NAME_RE})\\s*(?:${REPLACE_VERBS})\\s*(?:一个|这个|那个)?\\s*(${PUNCT_NAME_RE})$`,
    ),
    pick: (m) => ({ from: PUNCT_BY_NAME[m[1]], to: PUNCT_BY_NAME[m[2]], pick: 'last' }),
  },
  {
    // 「把第一个逗号改成句号」—— 和上一条对称
    re: new RegExp(
      `^(?:把|在)?\\s*(?:第一个|最前面|开头|最开始|第一个的)(?:的|那个|一个)?\\s*(${PUNCT_NAME_RE})\\s*(?:${REPLACE_VERBS})\\s*(?:一个|这个|那个)?\\s*(${PUNCT_NAME_RE})$`,
    ),
    pick: (m) => ({ from: PUNCT_BY_NAME[m[1]], to: PUNCT_BY_NAME[m[2]], pick: 'first' }),
  },
  {
    // 「把 X 后面的句号改成叹号」/「把 X 前面那个逗号换成句号」
    re: new RegExp(
      `^(?:把|在)?\\s*(.+?)\\s*(?:后面|后边|之后|后头|后|前面|前边|之前|前头|前)\\s*(?:那个|这个|的)?\\s*(${PUNCT_NAME_RE})\\s*(?:${REPLACE_VERBS})\\s*(?:一个|这个|那个)?\\s*(${PUNCT_NAME_RE})$`,
    ),
    pick: (m) => ({
      near: m[1].trim(),
      from: PUNCT_BY_NAME[m[2]],
      to: PUNCT_BY_NAME[m[3]],
    }),
  },
  {
    // 「把句号改成叹号」—— 光说标点，没给位置
    re: new RegExp(
      `^(?:把|在)?\\s*(?:一个|这个|那个)?\\s*(${PUNCT_NAME_RE})\\s*(?:${REPLACE_VERBS})\\s*(?:一个|这个|那个)?\\s*(${PUNCT_NAME_RE})$`,
    ),
    pick: (m) => ({ from: PUNCT_BY_NAME[m[1]], to: PUNCT_BY_NAME[m[2]] }),
  },
]

/**
 * 要求「系统生成内容」的说法 —— 唯一被禁止的一类。
 *
 * ⚠️ 这个检查**必须放在所有具体编辑规则之后**。
 *    否则孩子说「把『优美』改成『漂亮』」时，正文里的「优美」会误伤自己
 *    （正则只看得到指令本身，分不清那是"要改的词"还是"要生成的东西"）。
 *    放到最后 = 只有在**确实没有任何可执行的编辑**时才考虑拒绝。
 */
const CONTENT_REQUEST =
  /(润色|修饰|美化|扩写|扩充|续写|改写|重写|帮我写|替我写|帮我想|替我想|帮我加|替我加|加个(开头|结尾|比喻|成语|好词|好句|段落)|加(点|一点|一些|些|一个|一段)?(比喻|拟人|排比|夸张|好词|好句|成语|修辞|描写|细节|心理活动|环境|外貌|动作)|写得(更|再)(好|生动|优美)|(更|再)(生动|优美|具体|详细|丰富)|(生动|优美|具体|详细|丰富)(一点|一些|些)|有文采)/

/**
 * 「追加的内容」本身就是一句**要内容的请求**。
 *
 * 为什么单列一条：孩子说「加上一个比喻」时，`APPEND_PATTERNS` 会先命中，
 * 把「一个比喻」当成**要追加的文字**接到句尾 —— 结果正文里真的多了
 * 「一个比喻」四个字，又荒唐又难查（上面那条 CONTENT_REQUEST 只看得到
 * 整个句子里的「加」，看不到这层）。
 *
 * ⚠️ 只认「**光秃秃就是个内容名词**」的形状（可带个量词）。
 *    写成宽泛的"含比喻就拒"会误伤「加上小红的比喻」这类正当追加。
 */
const CONTENT_NOUN_ONLY =
  /^(?:一?[个些点段]|一?点|一些)?\s*(?:比喻|拟人|排比|夸张|好词|好句|成语|修辞|描写|细节|心理活动|环境描写|外貌描写|动作描写|对话|结尾|开头)$/

const REPLACE_PATTERNS: RegExp[] = [
  // 「把 A 改成 B」
  new RegExp(`^把\\s*(.+?)\\s*(?:${REPLACE_VERBS})\\s*(.+?)$`),
  // 「A 改成 B」
  new RegExp(`^(.+?)\\s*(?:${REPLACE_VERBS})\\s*(.+?)$`),
]

const DELETE_PATTERNS: RegExp[] = [
  // 「把 A 删掉」
  new RegExp(`^把\\s*(.+?)\\s*(?:${DELETE_VERBS})$`),
  // 「A 删掉」
  new RegExp(`^(.+?)\\s*(?:${DELETE_VERBS})$`),
]

const APPEND_PATTERNS: RegExp[] = [
  /^(?:再)?(?:加上|加一句|补充|补上|再添|添上|继续说|接着写|再加)\s*(.+)$/,
  // 「(在/把) (后面|最后|末尾|结尾) (再)? 加上 Y」—— 位置词可有可无。
  // ★ 补上「在/把」和 TAIL_WORDS：孩子说「在最后加上…」「末尾加上…」都很自然，
  //   而它们必须走到"追加"这里，不能变成"以『最』为锚点插入"（见 TAIL_WORDS）。
  new RegExp(
    `^(?:在|把)?\\s*(?:后面|后边|${TAIL_RE})?\\s*(?:再)?\\s*(?:加上|补充|加一句)\\s*[：:]?\\s*(.+)$`,
  ),
]

const UNDO_PATTERNS = /^(撤销|退回去|退回|取消上一步|刚才那个不算|重来|恢复)/

/**
 * 从一条指令里取出「把 from 换成 to」这一对 —— 只有替换类指令有。
 *
 * 为什么要这么个东西：出现多次时界面要让孩子自己指哪一处，
 * 而候选面板需要 `from` / `to` 才能回调执行。`replace` 和 `replace-punct`
 * 的字段名**完全一样**，但类型上不是一个分支 —— 两处调用点各写一次
 * `kind === 'replace'`，加了标点那支就会漏（漏了的表现是"出现多次时
 * 面板弹不出来"，不报错、只是没反应）。
 * 所以判定只写这一份。
 */
export function replacePairOf(intent: EditIntent): { from: string; to: string } | null {
  if (intent.kind === 'replace') return { from: intent.from, to: intent.to }
  if (intent.kind === 'replace-punct') return { from: intent.from, to: intent.to }
  return null
}

/**
 * 解析一条语音，判断孩子想干什么。
 *
 * 关键：如果识别不出来，绝不猜、绝不擅自改，而是返回 unknown，
 * 让界面问孩子「你是想改哪里呀？」—— 把决定权交回去。
 *
 * ⚠️ 顺序是有讲究的，别随手调：
 *   撤销 → **定位插入** → 追加 → 删除 → 替换 → **拒绝生成内容** → unknown
 *
 *   · 定位插入必须在追加**之前**：「小明后面加上那个时候」同时含有
 *     「加上」，「追加」那套会把它抓成"把『那个时候』接到句尾"——
 *     结果就是字加了、但加在错的地方（这正是家长报的 bug 的另一半）。
 *   · 拒绝生成内容必须在**最后**：见 CONTENT_REQUEST 的说明。
 */
export function parseEditIntent(raw: string): EditIntent {
  const text = raw.trim().replace(/[。！？，、]$/g, '')
  if (!text) return { kind: 'unknown', raw }

  if (UNDO_PATTERNS.test(text)) return { kind: 'undo' }

  /* ★ 改标点 —— 判据最严（两边都得是标点名），所以放最前也不抢别人的活。
     放晚了就会被通用替换先把「玩篮球后面的句号」整串抓走 —— 见 PUNCT_PATTERNS。 */
  for (const { re, pick } of PUNCT_PATTERNS) {
    const m = text.match(re)
    if (!m) continue
    const got = pick(m)
    if (got.from && got.to) {
      return {
        kind: 'replace-punct',
        from: got.from,
        to: got.to,
        near: got.near || undefined,
        pick: got.pick,
      }
    }
  }

  // ★ 定位插入 —— 必须早于「追加」
  for (const { re, pick } of INSERT_PATTERNS) {
    const m = text.match(re)
    if (!m) continue
    const got = pick(m)
    /* ⚠️ 「最后/末尾/结尾」不是锚点，是"加在整篇末尾"（见 TAIL_WORDS）。
       不挡掉的话会变成"以『最』为锚点插入"→ 报找不到「最」。
       放它过去，落到下面的「追加」。 */
    if (isTailAnchor(got.anchor)) continue
    if (got.anchor && got.text) {
      return { kind: 'insert', anchor: got.anchor, text: got.text, position: got.position }
    }
  }

  // 追加 —— 放最前，因为「加上」比「改成」更具体，不容易被误吞
  for (const p of APPEND_PATTERNS) {
    const m = text.match(p)
    if (m && m[1]?.trim()) {
      const addition = m[1].trim()
      // 「加上一个比喻」也是**要系统生成内容**，不是"把这四个字接到句尾"
      if (CONTENT_REQUEST.test(addition) || CONTENT_NOUN_ONLY.test(addition)) {
        return { kind: 'refuse', reason: 'content' }
      }
      return { kind: 'append', text: addition }
    }
  }

  // 删除 —— 只有一个捕获组，必须单独处理，否则会被替换逻辑漏掉
  for (const p of DELETE_PATTERNS) {
    const m = text.match(p)
    if (m && m[1]?.trim()) {
      return { kind: 'delete', target: m[1].trim() }
    }
  }

  // 替换
  for (const p of REPLACE_PATTERNS) {
    const m = text.match(p)
    if (m && m[1]?.trim() && m[2]?.trim()) {
      const from = m[1].trim()
      const to = m[2].trim()
      // 防呆：「把 XX 删掉」万一走到这里，也按删除处理
      if (new RegExp(`^(?:${DELETE_VERBS})$`).test(to)) {
        return { kind: 'delete', target: from }
      }
      return { kind: 'replace', from, to }
    }
  }

  // ★ 到最后才判断「是不是在要求生成内容」——见 CONTENT_REQUEST 的说明
  if (CONTENT_REQUEST.test(text)) return { kind: 'refuse', reason: 'content' }

  return { kind: 'unknown', raw }
}

/* ============================================================
   二、执行编辑
   ============================================================ */

export interface EditResult {
  ok: boolean
  /** 修改后的正文 */
  text: string
  /** 生成的编辑记录（失败时为 undefined） */
  operation?: EditOperation
  /** 给孩子的反馈文案 */
  message: string
  /** 失败原因，用于界面提示 */
  reason?: 'not-found' | 'ambiguous' | 'empty' | 'unknown' | 'refused'
  /** 当找到多处时，返回候选位置供孩子选择 */
  candidates?: { index: number; context: string }[]
}

/**
 * 把一次编辑应用到正文上。
 *
 * ★ 严格规则：只有当 from 在文中**唯一出现**时才自动执行。
 *   如果出现多次，我们停下来问孩子 —— 因为改错地方比不改更糟，
 *   而且让孩子自己判断"是哪一处"，本身就是锻炼。
 *
 * `by` 说的是"这一下是谁动手的"，只影响两处措辞：
 *   · `operation.by` —— 界面靠它标出「AI 按你说的」，鼓励语才不会说假话
 *   · 成功回执里那句"这是你自己改的"
 * 默认 `'child'`：本地解析器那条路，就是孩子自己的指令被直接执行。
 * AI 那条路传 `'ai'` —— 模型只负责**听懂**，动笔的仍然是这个引擎，
 * 所以正文里每个字都是孩子说的；但"是谁动手改的"这件事得说准。
 */
/**
 * 「孩子指的是哪一处？」的判定结果。
 *
 * ⚠️ 它只回答**判定**，不回答措辞 —— 三种指令各自的提示语不一样
 *    （「你想改哪一个」/「你想删哪一个」/「你想换哪一个」），
 *    措辞由调用方渲染。**判定共用、措辞各写**才是对的；
 *    把措辞也塞进来，三个分支就会为了迁就一个函数而互相打架。
 */
type LocateOutcome =
  | { kind: 'hit'; index: number }
  /** `why`：参照物本身没有 / 参照物旁边没有目标 / 目标压根没有 */
  | { kind: 'not-found'; why: 'anchor' | 'beside' | 'target'; anchorCount: number }
  | { kind: 'ambiguous'; positions: number[]; anchorCount: number }

/**
 * 在原文里定位「孩子指的那一处」—— **三种指令共用这一个函数**。
 *
 * 优先级：`near`（参照物）> `pick`（最后的/第一个）> 唯一出现。
 * 前两者都是**孩子自己指好了**，所以不再弹候选面板问他。
 */
function locateOccurrence(
  text: string,
  needle: string,
  hint: OccurrenceHint,
): LocateOutcome {
  let positions: number[]
  let anchorCount = 0

  if (hint.near) {
    /* 以某个词为参照物：「玩篮球后面的句号」。
       ⚠️ 参照物本身可能有多个 —— 那就停下来问，别替孩子挑一个。
          改错地方比不改更糟，而且"是哪一处"本来就是他该判断的事。 */
    const anchors = findAll(text, hint.near)
    anchorCount = anchors.length
    if (anchors.length === 0) return { kind: 'not-found', why: 'anchor', anchorCount: 0 }

    const side = hint.side ?? 'after'
    const hits: number[] = []
    for (const a of anchors) {
      // 'after' = 参照物之后**最近**的那一个；'before' = 之前**最近**的那一个
      const idx =
        side === 'after'
          ? text.indexOf(needle, a + hint.near.length)
          : text.lastIndexOf(needle, a - 1)
      if (idx >= 0 && !hits.includes(idx)) hits.push(idx)
    }
    if (hits.length === 0) return { kind: 'not-found', why: 'beside', anchorCount }
    if (hits.length === 1) return { kind: 'hit', index: hits[0]! }
    positions = hits
  } else {
    positions = findAll(text, needle)
    if (positions.length === 0) return { kind: 'not-found', why: 'target', anchorCount: 0 }
    if (positions.length === 1) return { kind: 'hit', index: positions[0]! }
  }

  /* 到这里一定是"多个候选"。孩子自己指好了就直接用，否则停下来问。 */
  if (hint.pick === 'last') return { kind: 'hit', index: positions[positions.length - 1]! }
  if (hint.pick === 'first') return { kind: 'hit', index: positions[0]! }
  return { kind: 'ambiguous', positions, anchorCount }
}

/** 候选面板要的那份清单（三个分支共用同一份构造）。 */
function candidatesOf(text: string, positions: number[], len: number) {
  return positions.map((p) => ({ index: p, context: contextAround(text, p, len) }))
}

export function applyEdit(
  currentText: string,
  intent: EditIntent,
  now: number,
  by: 'child' | 'ai' = 'child',
): EditResult {
  switch (intent.kind) {
    case 'replace': {
      const { from, to } = intent
      if (!from || !to) {
        return { ok: false, text: currentText, message: '没听清要改哪里呀', reason: 'empty' }
      }

      /* ★ 定位交给共用函数：孩子用参照物（「玩篮球后面的字」）
         或顺序（「最后一个」）指过位时，就不再弹面板问他第二遍。 */
      const loc = locateOccurrence(currentText, from, intent)
      if (loc.kind === 'not-found') {
        return {
          ok: false,
          text: currentText,
          message:
            loc.why === 'anchor'
              ? `文中没有找到「${intent.near}」，是不是记错了？`
              : loc.why === 'beside'
                ? `「${intent.near}」${intent.side === 'before' ? '前面' : '后面'}没有找到「${from}」`
                : `文中没有找到「${from}」，是不是记错了？`,
          reason: 'not-found',
        }
      }
      if (loc.kind === 'ambiguous') {
        return {
          ok: false,
          text: currentText,
          message:
            loc.anchorCount > 1
              ? `「${intent.near}」出现了 ${loc.anchorCount} 次，你想改哪一个${intent.side === 'before' ? '前面' : '后面'}的？`
              : `「${from}」出现了 ${loc.positions.length} 次，你想改哪一个？`,
          reason: 'ambiguous',
          candidates: candidatesOf(currentText, loc.positions, from.length),
        }
      }

      const next = replaceAt(currentText, loc.index, from.length, to)
      return {
        ok: true,
        text: next,
        operation: {
          id: `edit-${now}-${Math.random().toString(36).slice(2, 8)}`,
          at: now,
          from,
          to,
          kind: 'replace',
          before: currentText,
          after: next,
          by,
        },
        message:
          by === 'ai'
            ? `好！「${from}」已经改成「${to}」啦 —— 按你说的改的 ✏️`
            : `好！「${from}」已经改成「${to}」啦 —— 这是你自己改的 ✏️`,
      }
    }

    case 'replace-punct': {
      const { from, to } = intent
      if (!from || !to) {
        return { ok: false, text: currentText, message: '没听清要换哪个标点', reason: 'empty' }
      }
      if (from === to) {
        return {
          ok: false,
          text: currentText,
          message: `本来就是${punctName(from)}呀，不用换`,
          reason: 'empty',
        }
      }

      /*
       * ★ 这一支原本**自己写了一套**「参照物 / 最后的 / 第一个」的定位，
       *   2026-09-21 抽成共用的 `locateOccurrence`，replace / delete 也改走它。
       *
       *   为什么要抽：孩子说「把玩篮球后面的那个字去掉」时，
       *   `delete` 那一支**没有**这套机器，于是整类说法报"没找到"。
       *   同一件事在两处各写一遍，就是"改了一条忘了另一条"的温床（§四）。
       *
       *   ⚠️ 判定共用，**措辞不共用** —— 标点这边说的是"换"，
       *      而且找不到时要说清"没有句号"而不是"没找到「。」"。
       */
      const loc = locateOccurrence(currentText, from, intent)
      if (loc.kind === 'not-found') {
        return {
          ok: false,
          text: currentText,
          message:
            loc.why === 'anchor'
              ? `文中没有找到「${intent.near}」，是不是记错了？`
              : loc.why === 'beside'
                ? `「${intent.near}」${intent.side === 'before' ? '前面' : '后面'}没有${punctName(from)}`
                : `文中没有${punctName(from)}呀`,
          reason: 'not-found',
        }
      }
      if (loc.kind === 'ambiguous') {
        return {
          ok: false,
          text: currentText,
          message:
            loc.anchorCount > 1
              ? `「${intent.near}」出现了 ${loc.anchorCount} 次，你想换哪一个${intent.side === 'before' ? '前面' : '后面'}的？`
              : `文中有 ${loc.positions.length} 个${punctName(from)}，你想换哪一个？`,
          reason: 'ambiguous',
          candidates: candidatesOf(currentText, loc.positions, from.length),
        }
      }

      const next = replaceAt(currentText, loc.index, from.length, to)
      return {
        ok: true,
        text: next,
        operation: {
          id: `edit-${now}-${Math.random().toString(36).slice(2, 8)}`,
          at: now,
          // 记录里存的是真符号：撤销、diff、修改记录全靠 from/to 对齐，
          // 存"句号"那两个字会让 diff 对不上正文。
          from,
          to,
          kind: 'replace',
          before: currentText,
          after: next,
          by,
        },
        message: `好！${punctName(from)}换成${punctName(to)}啦 🌱`,
      }
    }

    case 'append': {
      const addition = intent.text.trim()
      if (!addition) {
        return { ok: false, text: currentText, message: '没听清要加什么', reason: 'empty' }
      }
      const base = currentText.trim()
      // 保持标点自然
      const sep = base === '' ? '' : /[。！？.!?]$/.test(base) ? '' : '。'
      const next = base + sep + addition
      return {
        ok: true,
        text: next,
        operation: {
          id: `edit-${now}-${Math.random().toString(36).slice(2, 8)}`,
          at: now,
          from: '',
          to: addition,
          kind: 'append',
          before: currentText,
          after: next,
          by,
        },
        message: '加上啦！你的故事又长了一点 🌱',
      }
    }

    case 'insert': {
      const { anchor, position } = intent
      let addition = intent.text.trim()
      if (!anchor || !addition) {
        return { ok: false, text: currentText, message: '没听清要加在哪里', reason: 'empty' }
      }

      const positions = findAll(currentText, anchor)
      if (positions.length === 0) {
        return {
          ok: false,
          text: currentText,
          message: `文中没有找到「${anchor}」，是不是记错了？`,
          reason: 'not-found',
        }
      }
      if (positions.length > 1) {
        return {
          ok: false,
          text: currentText,
          message: `「${anchor}」出现了 ${positions.length} 次，你想加在哪一个${position === 'after' ? '后面' : '前面'}？`,
          reason: 'ambiguous',
          candidates: positions.map((p) => ({
            index: p,
            context: contextAround(currentText, p, anchor.length),
          })),
        }
      }

      /*
       * ★ 插在"词"的后面，不是插在"匹配到的那几个字"后面。
       *
       * 孩子说「操场后加上快乐的」时，他心里的词是「操场上」；
       * 而 anchor 只匹配到「操场」，直接插就变成
       * 「在操场|快乐的|上玩篮球」—— 谁也不这么说。
       * 所以往后贴一个方位后缀（见 LOCATIVE_SUFFIX）。
       */
      let at = position === 'after' ? positions[0] + anchor.length : positions[0]
      if (position === 'after' && LOCATIVE_SUFFIX.test(currentText[at] ?? '')) {
        at += 1
      }

      /*
       * ★ 削掉"和正文紧接着的那部分完全重合"的尾巴。
       *
       * 孩子说插入时，常把**落脚点**也一起念出来 —— 他要表达的是
       * 「操场后加上快乐的，玩篮球那儿」，落点那个词（玩篮球）本来就在正文里。
       * 照着字面插一遍就得到「在操场上快乐的玩篮球玩篮球」——
       * 这正是家长报的「搞了半天」里最刺眼的那一幕。
       *
       * 为什么可以直接削而不是问：被削掉的那几个字**本来就在正文里**，
       * 削掉不丢孩子任何一个字，插进去只会多出一份重复。
       *
       * ⚠️ 重合长度**至少 2 个字**才算。只重合一个字是巧合，不是落脚点 ——
       *    「加上快乐的」而正文紧接着是「的玩篮球」时，会把「的」削掉，
       *    变成「快乐玩篮球」。这条守卫就是为这个反例设的。
       */
      if (position === 'after') {
        const following = currentText.slice(at)
        for (let n = addition.length; n >= 2; n--) {
          if (following.startsWith(addition.slice(-n))) {
            addition = addition.slice(0, addition.length - n)
            break
          }
        }
        if (!addition) {
          return {
            ok: false,
            text: currentText,
            message: `「${anchor}」后面就是这几个字了，不用再加啦`,
            reason: 'not-found',
          }
        }
      }

      const next = replaceAt(currentText, at, 0, addition)
      return {
        ok: true,
        text: next,
        operation: {
          id: `edit-${now}-${Math.random().toString(36).slice(2, 8)}`,
          at: now,
          from: anchor,
          to: addition,
          kind: 'insert',
          before: currentText,
          after: next,
          by,
        },
        message: `加好啦：「${anchor}」${position === 'after' ? '后面' : '前面'}多了「${addition}」`,
      }
    }

    case 'delete': {
      const target = intent.target
      /* ★ 定位交给共用函数 —— 和 replace 走的是**同一份判定**。
         孩子说「把玩篮球后面的那个字去掉」时，模型把 target 填成
         它在正文里看到的那个字、再带上 near='玩篮球'，
         这里就能落到正确的那一处，而不再报"没找到"。 */
      const loc = locateOccurrence(currentText, target, intent)
      if (loc.kind === 'not-found') {
        return {
          ok: false,
          text: currentText,
          message:
            loc.why === 'anchor'
              ? `文中没有找到「${intent.near}」，是不是记错了？`
              : loc.why === 'beside'
                ? `「${intent.near}」${intent.side === 'before' ? '前面' : '后面'}没有找到「${target}」`
                : `没找到「${target}」`,
          reason: 'not-found',
        }
      }
      if (loc.kind === 'ambiguous') {
        return {
          ok: false,
          text: currentText,
          message:
            loc.anchorCount > 1
              ? `「${intent.near}」出现了 ${loc.anchorCount} 次，要删哪一个${intent.side === 'before' ? '前面' : '后面'}的？`
              : `「${target}」出现了 ${loc.positions.length} 次，要删哪一个？`,
          reason: 'ambiguous',
          candidates: candidatesOf(currentText, loc.positions, target.length),
        }
      }
      /*
       * ★ 删名词要连**方位后缀**一起删。
       *
       * 正文「半大的小学生在操场上玩篮球。」，孩子说「把操场去掉」——
       * 只删「操场」会剩下一个孤零零的「上」：
       * 「半大的小学生在|上|玩篮球」，谁也不这么说。
       * 孩子心里的词是「操场上」，和插入那边（见 LOCATIVE_SUFFIX）是同一件事的两面：
       * **插入要贴到词尾，删除要吃到词尾。**
       */
      const at = loc.index
      let span = target.length
      if (LOCATIVE_SUFFIX.test(currentText[at + span] ?? '')) span += 1
      // 记录里存**实际删掉的那几个字**（可能是「操场上」），
      // 不是孩子说的「操场」—— 撤销和 diff 都靠它跟正文对齐。
      const removed = currentText.slice(at, at + span)
      const next = replaceAt(currentText, at, span, '')
      return {
        ok: true,
        text: next,
        operation: {
          id: `edit-${now}-${Math.random().toString(36).slice(2, 8)}`,
          at: now,
          from: removed,
          to: '',
          kind: 'delete',
          before: currentText,
          after: next,
          by,
        },
        message: `「${removed}」删掉啦`,
      }
    }

    case 'undo': {
      const next = currentText // 由调用方用 edits 栈处理
      return {
        ok: true,
        text: next,
        message: '好，退回上一步',
      }
    }

    /**
     * 要求系统生成内容 —— **明确拒绝**，而且要说清为什么。
     *
     * ⚠️ 不能混进 unknown（"没听懂"）。孩子说「加点比喻」时，
     *    如果界面回「没太听懂」，他会一遍遍换说法再试；
     *    必须直接告诉他"这件事得你自己做"，他才会去想。
     */
    case 'refuse':
      return {
        ok: false,
        text: currentText,
        message: '这句得你自己写哦 —— 我只帮你改你说的，不会替你写内容。先自己想一想，再念给我改 ✏️',
        reason: 'refused',
      }

    case 'unknown':
      return {
        ok: false,
        text: currentText,
        message:
          '没太听懂～你可以说「把 XX 改成 YY」「把 XX 去掉」，或者「在 XX 后面加上 YY」',
        reason: 'unknown',
      }
  }
}

/* ============================================================
   三、在指定位置执行替换（用于孩子从候选中选一个）
   ============================================================ */

export function applyReplaceAt(
  currentText: string,
  position: number,
  from: string,
  to: string,
  now: number,
): EditResult {
  const next = replaceAt(currentText, position, from.length, to)
  if (next === currentText) {
    return { ok: false, text: currentText, message: '没有变化', reason: 'not-found' }
  }
  return {
    ok: true,
    text: next,
    operation: {
      id: `edit-${now}-${Math.random().toString(36).slice(2, 8)}`,
      at: now,
      from,
      to,
      kind: 'replace',
      before: currentText,
      after: next,
    },
    message: `改好啦：「${from}」→「${to}」`,
  }
}

/* ============================================================
   四、撤销栈
   ============================================================ */

/**
 * 撤销：把孩子最后一步改动还原。
 * 注意是「还原孩子自己的操作」，不是"清除所有"，也不能撤销到
 * 系统状态 —— 每次撤销都消耗一条他自己的编辑记录。
 */
export function undoEdit(
  edits: EditOperation[],
): { text: string; edits: EditOperation[] } | null {
  if (edits.length === 0) return null
  const last = edits[edits.length - 1]
  return {
    text: last.before,
    edits: edits.slice(0, -1),
  }
}

/* ============================================================
   五、小工具
   ============================================================ */

/**
 * 从「改前 / 改后」两份全文里，抠出**真正变了的那一段**。
 *
 * 做法：掐掉公共前缀和公共后缀，剩下的就是变化区。
 * （掐后缀时要保证不和前缀重叠 —— 边界就卡在 `max - p` 上。）
 *
 * ------------------------------------------------------------
 * ⚠️⚠️ 它**已经不在编辑链路上了**，别再拿它去记一条编辑记录。
 *
 * 它是为「AI 改写返回整篇全文」那个旧设计写的：拿到两篇全文之后，
 * 靠 diff 猜出"改了哪一处"。那个设计 2026-09-19 被判定越界
 * （等于让 AI 替孩子写内容），整条路已经删掉，见 ai.ts 四·五节。
 *
 * 现在的编辑记录由 `applyEdit` 直接产出 —— 它本来就知道自己动了哪一段，
 * 不需要猜。用 diff 反推的坏处是：AI 顺手改了别的地方时，
 * diff 会把那段也一起算成"孩子改的"，而界面就会替它冒领。
 *
 * 所以：**留着它只是因为还有测试在跑，不代表它是个可用工具。**
 * 真要再用，先想清楚"这份全文是谁生成的"。
 * ------------------------------------------------------------
 */
export function changedSpan(before: string, after: string): { from: string; to: string } {
  const { p, s } = diffBounds(before, after)
  return { from: before.slice(p, before.length - s), to: after.slice(p, after.length - s) }
}

/**
 * 「改前 / 改后」两份全文的**公共前缀长度 p** 与**公共后缀长度 s**。
 * 变化区 = `[p, len - s)`。
 *
 * ★ **只有这一个函数负责算"到底哪儿变了"。**
 *   `changedSpan`（抠出变化区那一段字）和 `sentenceChange`（把它扩成整句）
 *   都调它 —— 各写一遍前缀/后缀循环，就是 §四 那个
 *   "同一个判定只许有一个函数"的老毛病（改了一条忘另一条 = 没改）。
 *
 * ⚠️ 掐后缀时 `s < max - p`，保证后缀**不和前缀重叠** —— 少了这个界，
 *    "全文只有一个字"这类输入会把同一个字既算进前缀又算进后缀。
 */
function diffBounds(before: string, after: string): { p: number; s: number } {
  const max = Math.min(before.length, after.length)
  let p = 0
  while (p < max && before[p] === after[p]) p++
  let s = 0
  while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++
  return { p, s }
}

/** 句末标点。**逗号不算** —— 逗号是句子内部的事。 */
const SENTENCE_END = /[。！？!?；;\n]/

function sentenceStart(text: string, index: number): number {
  for (let i = Math.min(index, text.length) - 1; i >= 0; i--) {
    if (SENTENCE_END.test(text[i]!)) return i + 1
  }
  return 0
}

function sentenceEnd(text: string, index: number): number {
  for (let i = Math.max(0, index); i < text.length; i++) {
    if (SENTENCE_END.test(text[i]!)) return i + 1
  }
  return text.length
}

/**
 * 把"变了的那一段"扩成**完整的句子** —— 修改记录里的「原文 / 改成」用它。
 *
 * 家长 2026-09-21：「我希望是 **表明作文原文**，修正内容 就是输入的话的内容。」
 * 光看「小猫 → 小狗」两个词，孩子不知道这是在说哪一句；
 * 摆出整句他才认得出"哦，是这一句"。
 *
 * ------------------------------------------------------------
 * ⚠️ 为什么这里用 diff 是**安全的**，而上面 `changedSpan` 被禁掉了：
 *
 *   `changedSpan` 被禁，是因为它当年被用来"从两篇**全文**里猜出改了哪一处"——
 *   那两篇全文可能出自 AI，AI 顺手改了别的地方，diff 就会把那处
 *   也算成"孩子改的"，界面替它冒领。
 *
 *   这里的两份文本是**同一条编辑记录自己的 before / after**，
 *   而 `applyEdit` 是**定点拼接**（一次只动一处，其余逐字不变）——
 *   所以"差异只有一处"是**结构性保证**，不是猜出来的。
 *
 *   ➜ 判据：**这份 before/after 是不是同一次定点编辑的两端。**
 *     不是的话（比如两篇独立生成的全文），别用这个函数。
 * ------------------------------------------------------------
 */
export function sentenceChange(
  before: string,
  after: string,
): { beforeSentence: string; afterSentence: string } {
  const { p, s } = diffBounds(before, after)
  return {
    beforeSentence: sentenceSlice(before, p, before.length - s),
    afterSentence: sentenceSlice(after, p, after.length - s),
  }
}

/**
 * 取"覆盖 `[from, to)` 的那一句"。
 *
 * ⚠️ 变化区在一侧**可能是空的** —— `append` 时 before 侧就是空的
 *    （前缀吃掉了整篇 before）。这时不能返回空串，要退回
 *    **紧邻变化点的那个字符**所在的句子，否则界面上「原文」一栏是空白，
 *    看起来像记录坏了。这也是 `p - 1` 那两处的来由。
 */
function sentenceSlice(text: string, from: number, to: number): string {
  const empty = from >= to
  const start = sentenceStart(text, empty ? Math.max(0, from - 1) : from)
  /*
   * ⚠️ 往后找句末时要从 `to - 1`（变化区的**最后一个字**）起步，不是 `to`。
   *
   *   变化区本身经常**已经以句末标点收尾** —— 比如删掉一整句：
   *     before「今天很好。我家有一只小猫。它很可爱。」
   *     after 「今天很好。它很可爱。」
   *   变化区是「我家有一只小猫。」，`to` 正好落在它后面那个字的**前面**。
   *   从 `to` 起步就会跳过这个句号、继续往后吃到「它很可爱。」，
   *   于是「原文」那一栏把**没被删的那句**也一起摆了出来 ——
   *   孩子会以为那句也被改过。
   */
  const end = sentenceEnd(text, Math.max(0, to - 1))
  return text.slice(start, end).trim()
}

function findAll(haystack: string, needle: string): number[] {
  if (!needle) return []
  const out: number[] = []
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    out.push(idx)
    idx = haystack.indexOf(needle, idx + 1)
  }
  return out
}

function replaceAt(
  text: string,
  index: number,
  length: number,
  replacement: string,
): string {
  return text.slice(0, index) + replacement + text.slice(index + length)
}

function contextAround(text: string, index: number, len: number, span = 12): string {
  const start = Math.max(0, index - span)
  const end = Math.min(text.length, index + len + span)
  const before = text.slice(start, index)
  const hit = text.slice(index, index + len)
  const after = text.slice(index + len, end)
  return `${start > 0 ? '…' : ''}${before}【${hit}】${after}${end < text.length ? '…' : ''}`
}

/* ============================================================
   六、语音片段管理
   ============================================================ */

/**
 * 新增一条语音片段。
 * 每条语音都单独留档 —— 孩子能回看"我一开始是怎么说的"，
 * 这对建立"修改让文章变好"的认知特别有价值。
 */
export function addUtterance(
  list: Utterance[],
  text: string,
  now: number,
  durationMs?: number,
): Utterance[] {
  return [
    ...list,
    {
      id: `utt-${now}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      at: now,
      durationMs,
    },
  ]
}

/** 统计孩子一共改了多少次 —— 用来发"修改达人"奖励 */
export function editStats(edits: EditOperation[]) {
  return {
    total: edits.length,
    replaces: edits.filter((e) => e.kind === 'replace').length,
    appends: edits.filter((e) => e.kind === 'append').length,
    deletes: edits.filter((e) => e.kind === 'delete').length,
  }
}

/**
 * 生成"修改前后对比"，展示给孩子看。
 *
 * 这个功能很重要：它让孩子直观看到「我自己的修改让文章变好了」，
 * 从而建立自主修改的习惯 —— 这正是需求想要的能力。
 */
export interface RevisionDiff {
  original: string
  current: string
  steps: { from: string; to: string; kind: EditOperation['kind'] }[]
  wordDelta: number
}

export function buildRevisionDiff(edits: EditOperation[]): RevisionDiff | null {
  if (edits.length === 0) return null
  return {
    original: edits[0].before,
    current: edits[edits.length - 1].after,
    steps: edits.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
    wordDelta: edits.length,
  }
}

/**
 * 修改次数对应的鼓励语。
 *
 * ⚠️ `aiCount` 不是装饰参数，是为了**不说假话**。
 *    原版只有一句话：「你自己改了一处，这就是进步」。
 *    改作文接了大模型之后，如果那处是 AI 动手改的，这句话就是错的 ——
 *    孩子确实做了决定（这才是要表扬的能力），但动手改的不是他。
 *    所以两种功劳分开说，谁也不冒领。
 *
 * 缺省 aiCount = 0，老调用方行为不变。
 */
export function revisionPraise(count: number, aiCount = 0): string {
  if (count === 0) return '写得很顺，一气呵成！'

  const bySelf = count - aiCount

  // 全是 AI 按孩子指令改的：表扬"说清了要改哪里"这件事，别冒领动手的功劳
  if (bySelf <= 0) {
    return count === 1
      ? '你说清了要改哪里 —— 这比会改更重要 🎯'
      : `你指挥着改了 ${count} 处，每一处都说到了点子上 🎯`
  }

  // 两种都有：各自认各自的
  if (aiCount > 0) {
    return `你自己动手改了 ${bySelf} 处，又让 AI 按你的话改了 ${aiCount} 处 ✏️`
  }

  if (count === 1) return '你自己改了一处，这就是进步 ✏️'
  if (count <= 3) return `你一共改了 ${count} 处，好文章就是这样磨出来的 🔧`
  if (count <= 6) return `改了 ${count} 次！这份认真比分数更值钱 💪`
  return `改了 ${count} 次都不嫌烦，这份劲头不得了 🔥`
}
