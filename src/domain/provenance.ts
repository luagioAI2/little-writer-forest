/* ============================================================
   来源铁律 —— AI 不许自创内容（2026-09-21 家长定）

   家长原话：

     「我的目的是 修正作文。通过大模型修改。
       但是要限制，AI 不能自创内容。」

   在这之前，`ParsedEditInstruction` 只保证了**模型交不出整篇正文**
   （类型里没有"正文"字段）。但它仍然可以在 `to` / `text` 这些自由字符串里
   塞自己造的字 —— 形状挡住了"量"，没挡住"来源"。

   这个模块补的就是"来源"：

     ★★ 改完之后，正文里的每一个字，必须来自
          ① 作文原文，或
          ② 孩子刚才说的那句话。
        没有第三个来源。

   - **写入侧**（`to` / `text`，要写进去的字）：必须是孩子那句话的**子串**。
   - **定位侧**（`from` / `target` / `anchor` / `near`，指的是原文里的字）：
     必须能在原文里找到 —— 这件事**由 `applyEdit` 管**，不在这里重复。
     理由是 `applyEdit` 报得更准：它能区分"文中没有找到"和
     "出现了 3 次，你想改哪一个"，这两句话对孩子是有用的；
     在这里再查一遍只会得到一句更差的提示。

   ⚠️ 判据是**本地可算的**，不靠提示词求模型自觉 —— 和 §一 那条
      "不靠提示词求它别写，靠接口形状让它写不了"是同一个思路，
      只是把防线从"类型"再往前推到"校验"。
   ============================================================ */

import type { ParsedEditInstruction } from './ai'

/* ------------------------------------------------------------
   一、标点必须放行 —— 否则 100% 误杀
   ------------------------------------------------------------

   ⚠️ 这是本模块**最容易写错**的一处，也是唯一必须开的口子。

   孩子说「把玩篮球后面的句号改成叹号」时：
     · 他嘴里说的是**名字** —— 「句号」「叹号」
     · 指令里带的是**符号** —— 「。」「！」

   于是 `to` = 「！」 而那句话 = 「把玩篮球后面的句号改成叹号」，
   「！」**根本不是它的子串** —— 照字面卡，这一整类（改标点）
   会被 100% 挡在门外，而它恰恰是家长 2026-09-20 亲口报过的需求。

   所以标点按**白名单**放行：只有当孩子**点过这个标点的名字**时，
   对应的符号才算"他说过的"。他没提到问号，模型就塞不进「？」。

   这一条不违反来源铁律：符号的选择**是孩子用名字指定的**，
   模型只是做了「名字 → 符号」这一步查表。
   ------------------------------------------------------------ */

/** 标点的**名字 → 符号**。孩子说名字，指令里存符号（见 voiceEdit 的 replace-punct）。 */
export const PUNCT_NAME_TO_SYMBOL: Record<string, readonly string[]> = {
  句号: ['。'],
  逗号: ['，'],
  顿号: ['、'],
  分号: ['；'],
  冒号: ['：'],
  问号: ['？'],
  疑问号: ['？'],
  叹号: ['！'],
  感叹号: ['！'],
  省略号: ['……'],
  破折号: ['——'],
  引号: ['“', '”', '「', '」'],
  书名号: ['《', '》'],
}

/**
 * 这句话"点名"了哪些标点符号。
 *
 * ⚠️ 「感叹号」里**含有**「叹号」，所以两个键会同时命中 —— 没关系，
 *    它们映射到同一个符号，集合天然去重。
 */
export function allowedPunctFrom(utterance: string): Set<string> {
  const out = new Set<string>()
  for (const [name, symbols] of Object.entries(PUNCT_NAME_TO_SYMBOL)) {
    if (utterance.includes(name)) for (const s of symbols) out.add(s)
  }
  return out
}

/* ------------------------------------------------------------
   二、一段"要写进去的字"是不是有来源的
   ------------------------------------------------------------ */

/**
 * 把被点名放行的标点从字符串里摘掉，剩下的就是"必须来自孩子嘴里"的部分。
 *
 * ⚠️ 多字符标点（省略号 `……`、破折号 `——`）要先整体摘，
 *    再逐字过滤 —— 只逐字过滤的话，`……` 会被拆成两个 `…`，
 *    而 `…` 不在白名单里，于是摘不干净。
 */
function stripAllowedPunct(span: string, allowed: Set<string>): string {
  let rest = span
  for (const sym of allowed) {
    if (sym.length > 1) rest = rest.split(sym).join('')
  }
  return [...rest].filter((ch) => !allowed.has(ch)).join('')
}

/**
 * 这段字有没有"来源"？
 *
 * 三种情况放行：
 *   ① 整段就是孩子那句话的子串（最常见）—— 「小狗」⊂「把小猫改成小狗」
 *   ② 摘掉他点过名的标点后是空的（纯标点）—— 「！」⊂ 白名单
 *   ③ 摘掉他点过名的标点后是子串 —— 「小狗！」→「小狗」⊂ 那句话
 *
 * ⚠️ 判据是**子串**（连续），不是"字符都在里面出现过"。
 *    后者太松：「的小猫」和「猫小的」用字相同，会一起放行。
 */
export function groundedInUtterance(span: string, utterance: string, allowed: Set<string>): boolean {
  const w = span.trim()
  if (!w) return true
  if (utterance.includes(w)) return true
  const rest = stripAllowedPunct(w, allowed)
  if (rest === '') return allowed.size > 0
  return utterance.includes(rest)
}

/* ------------------------------------------------------------
   三、跨度上限（家长说的「加点限制」）
   ------------------------------------------------------------ */

/**
 * 单次改动里，**被动的那一段**最多多少字。
 *
 * 防的是"把整段重写"伪装成"替换"：孩子说「把第二段改好一点」，
 * 模型完全可以返回一条 `replace`，`from` 是整段、`to` 是它重写的一段 ——
 * 形状上完全合法。卡住跨度，这种"假替换真代写"就进不来。
 *
 * ⚠️ 数字取得**宽松**是故意的：孩子真想把一整句话换掉（二三十字）是正常需求，
 *    卡太紧会把他自己说的话也挡在外面。这里只拦"整段/整篇"那个量级。
 */
export const MAX_SPAN_CHARS = 40

/* ------------------------------------------------------------
   四、总入口
   ------------------------------------------------------------ */

export type ProvenanceVerdict = { ok: true } | { ok: false; message: string }

/**
 * 检查一条指令有没有"自创内容"。
 *
 * ★ 越界时**不返回 unknown**，而是给一句能照着做的话。
 *   理由同 §一：回"没太听懂"，孩子会一遍遍换说法再试；
 *   必须说清楚"这几个字得你自己说"。
 */
export function checkProvenance(
  intent: ParsedEditInstruction,
  utterance: string,
): ProvenanceVerdict {
  const allowed = allowedPunctFrom(utterance)

  /** 要写进正文的字 */
  let written = ''
  /** 被换掉 / 删掉的那一段（原文里的字） */
  let consumed = ''

  switch (intent.kind) {
    case 'replace':
      written = intent.to
      consumed = intent.from
      break
    case 'insert':
      written = intent.text
      consumed = intent.anchor
      break
    case 'append':
      written = intent.text
      break
    case 'delete':
      consumed = intent.target
      break
    case 'replace-punct':
      // to 是符号，由标点白名单放行；from 是原文里的符号，applyEdit 会去找
      written = intent.to
      break
    case 'undo':
    case 'refuse':
      return { ok: true }
  }

  if (!groundedInUtterance(written, utterance, allowed)) {
    return {
      ok: false,
      message: '这几个字你没说过 —— 要加什么，你直接说出来，我就给你加上',
    }
  }

  if (written.length > MAX_SPAN_CHARS) {
    return { ok: false, message: `一次写得太多了（${written.length} 个字），一句一句来` }
  }
  if (consumed.length > MAX_SPAN_CHARS) {
    return { ok: false, message: `一次改得太多了（${consumed.length} 个字），一句一句来` }
  }

  return { ok: true }
}
