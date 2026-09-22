import { describe, expect, it } from 'vitest'
import type { ParsedEditInstruction } from './ai'
import {
  MAX_SPAN_CHARS,
  allowedPunctFrom,
  checkProvenance,
  groundedInUtterance,
} from './provenance'

/* ============================================================
   来源铁律：AI 不许自创内容
   ============================================================

   家长 2026-09-21：「我的目的是 修正作文。通过大模型修改。
   但是要限制，**AI 不能自创内容**。」

   判据：要写进正文的字，必须是**孩子那句话的子串**（标点另按白名单放行）。
   ============================================================ */

const ok = (intent: ParsedEditInstruction, said: string) => checkProvenance(intent, said).ok

describe('来源闸门 · 写入的字必须出自孩子那句话', () => {
  it('孩子说的字 → 放行', () => {
    expect(ok({ kind: 'replace', from: '小猫', to: '小狗' }, '把小猫改成小狗')).toBe(true)
    // 带语气词的口语（本地正则的死穴，但字还是他说的）
    expect(ok({ kind: 'replace', from: '小猫', to: '小狗' }, '我觉得小猫改成小狗更好')).toBe(true)
    // 插入
    expect(ok({ kind: 'insert', anchor: '操场', text: '快乐的', position: 'after' }, '在操场后面加上快乐的')).toBe(true)
    // 补一句
    expect(ok({ kind: 'append', text: '他很开心' }, '最后加上他很开心')).toBe(true)
  })

  it('★ 模型自己造的字 → 拦下，而且说清"得你自己说"', () => {
    const v = checkProvenance({ kind: 'replace', from: '小猫', to: '活泼可爱的小狗' }, '把小猫改成小狗')
    expect(v.ok).toBe(false)
    if (v.ok) throw new Error('unreachable')
    // 不能回"没太听懂"—— 换个说法没用，他得把要加的字自己说出来
    expect(v.message).toContain('你没说过')
    expect(v.message).not.toContain('没太听懂')
  })

  it('★ 孩子说「改好一点」而模型自己写了一段 → 拦下', () => {
    // 这是最典型的"假替换真代写"：from 是原文里的字（合法），
    // to 是模型自己编的（越界）。
    const v = checkProvenance(
      { kind: 'replace', from: '小猫', to: '一只毛茸茸的小猫懒洋洋地趴在窗台上' },
      '把小猫那句改好一点',
    )
    expect(v.ok).toBe(false)
  })

  it('子串是**连续**匹配，不是"用字都在里面出现过"', () => {
    // 「的小狗」和「狗小的」用字相同 —— 后者不是子串，必须拦
    expect(groundedInUtterance('小狗', '把小猫改成小狗', new Set())).toBe(true)
    expect(groundedInUtterance('狗小', '把小猫改成小狗', new Set())).toBe(false)
  })
})

describe('来源闸门 · ★★ 标点必须放行（否则改标点 100% 被误杀）', () => {
  /*
   * 家长 2026-09-20 亲口报过：「把玩篮球后面的句号 改成叹号。始终不行。」
   * 孩子嘴里说的是**名字**，指令里带的是**符号** ——
   * 「！」根本不是那句话的子串，照字面卡会把这一整类需求挡在门外。
   */

  it('孩子点名过的标点 → 放行（名字→符号）', () => {
    expect(
      ok(
        { kind: 'replace-punct', from: '。', to: '！', near: '玩篮球' },
        '把玩篮球后面的句号改成叹号',
      ),
    ).toBe(true)
    // 「感叹号」是另一个说法，一样要认
    expect(ok({ kind: 'replace-punct', from: '。', to: '！' }, '把句号改成感叹号')).toBe(true)
    // 省略号是 2 个字符
    expect(ok({ kind: 'replace-punct', from: '。', to: '……' }, '把句号改成省略号')).toBe(true)
  })

  it('★ 孩子没点名的标点 → 仍然拦下（放行是有条件的）', () => {
    // 他说的是叹号，模型却塞了问号
    expect(ok({ kind: 'replace-punct', from: '。', to: '？' }, '把句号改成叹号')).toBe(false)
  })

  it('插入标点也走同一条白名单', () => {
    expect(ok({ kind: 'insert', anchor: '小猫', text: '，', position: 'after' }, '小猫后面加个逗号')).toBe(true)
    // 没提逗号就不许塞逗号
    expect(ok({ kind: 'insert', anchor: '小猫', text: '，', position: 'after' }, '小猫后面加点东西')).toBe(false)
  })

  it('文字 + 被点名的标点混在一起 → 放行', () => {
    expect(ok({ kind: 'replace', from: '小猫', to: '小狗！' }, '把小猫改成小狗，加个叹号')).toBe(true)
  })

  it('allowedPunctFrom：点名才进白名单，没点名不进', () => {
    expect([...allowedPunctFrom('把句号改成叹号')].sort()).toEqual(['。', '！'].sort())
    expect(allowedPunctFrom('把小猫改成小狗').size).toBe(0)
  })
})

describe('来源闸门 · 跨度上限（「加点限制」）', () => {
  const long = '一'.repeat(MAX_SPAN_CHARS + 1)

  it('★ 想一次改掉一整段 → 拦下，并让他一句一句来', () => {
    const v = checkProvenance({ kind: 'replace', from: long, to: '小狗' }, `把${long}改成小狗`)
    expect(v.ok).toBe(false)
    if (v.ok) throw new Error('unreachable')
    expect(v.message).toContain('一句一句来')
  })

  it('★ 想一次写进去一整段 → 拦下', () => {
    // 就算这些字真是他说的，一次写这么多也该拆开 ——
    // 这是"限制"这一条的本意：防整段重写，不只是防自创
    const v = checkProvenance({ kind: 'append', text: long }, `最后加上${long}`)
    expect(v.ok).toBe(false)
  })

  it('刚好到上限 → 放行（边界不能差一个）', () => {
    const edge = '一'.repeat(MAX_SPAN_CHARS)
    expect(ok({ kind: 'append', text: edge }, `最后加上${edge}`)).toBe(true)
  })
})

describe('来源闸门 · 不管的两件事', () => {
  it('undo / refuse 直接放行（它们不写任何字）', () => {
    expect(ok({ kind: 'undo' }, '撤销')).toBe(true)
    expect(ok({ kind: 'refuse', reason: 'content' }, '给这个句子加点比喻')).toBe(true)
  })

  it('★ 定位侧（from / anchor）不在这里查原文 —— 那是 applyEdit 的活', () => {
    /*
     * 「文中没有找到」和「出现了 3 次，你想改哪一个」这两句话，
     * applyEdit 报得更准，对孩子有用；在这里再查一遍只会得到更差的提示。
     * 所以闸门对 from 只卡**长度**，不卡"在不在原文里"。
     */
    expect(ok({ kind: 'replace', from: '正文里根本没有的词', to: '小狗' }, '把那个词改成小狗')).toBe(true)
  })
})
