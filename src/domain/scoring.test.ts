/* ============================================================
   骨架提取（背诵提示卡）—— 单测
   ============================================================

   为什么单独开这个文件：`scoring.ts` 里 `extractSkeleton` 抛出的
   modifiers 会**原样出现在提示卡上**（「可以自己加的修饰：……」）。
   也就是说，这里抽错了不是内部数据脏，是**直接讲给孩子听**。

   2026-09-19 家长报了「更好的写法 也还是有问题」，顺着查到两处：
     · 「小草安安静静地站着」→ 修饰抽出「安安静静地、安安、静静」
       （AABB 叠词被 `(.)\1` 又切成了 AA + BB）
     · 「妈妈给我买了一条围巾」→ 修饰抽出「妈妈」
       （叠字**名词**被当成了修饰语，可它是主语）
   ============================================================ */

import { describe, expect, it } from 'vitest'
import { extractSkeleton } from './scoring'

describe('骨架提取 · 叠词', () => {
  it('★ AABB 叠词不许被切成 AA + BB', () => {
    const r = extractSkeleton('小草安安静静地站着。')
    expect(r.core).toBe('小草站着。')
    expect(r.modifiers).toContain('安安静静地')
    // 这两个是切碎出来的碎片，提示卡上并排出现三个几乎一样的词
    expect(r.modifiers).not.toContain('安安')
    expect(r.modifiers).not.toContain('静静')
  })

  it('★ 叠字名词是主语，不是修饰语', () => {
    const r = extractSkeleton('妈妈给我买了一条围巾。')
    expect(r.modifiers).not.toContain('妈妈')
  })

  it('叠字名词表覆盖常见的称谓和名物', () => {
    for (const s of ['爸爸去上班了。', '奶奶坐在摇椅上。', '星星在天上一闪一闪。']) {
      const r = extractSkeleton(s)
      for (const noun of ['爸爸', '奶奶', '星星']) {
        expect(r.modifiers, `${s} 里的「${noun}」不该当修饰`).not.toContain(noun)
      }
    }
  })

  it('真·叠词修饰仍然要收（这是低年级的拿分点，不能一起砍掉）', () => {
    expect(extractSkeleton('天空蓝蓝的。').modifiers).toContain('蓝蓝')
    expect(extractSkeleton('小明慢慢地走过来。').modifiers).toContain('慢慢')
    expect(extractSkeleton('小溪悄悄地流着。').modifiers).toContain('悄悄')
  })
})

describe('骨架提取 · 主干', () => {
  it('主干里不许留下孤零零的「的地得」', () => {
    const r = extractSkeleton('金灿灿的阳光暖暖地照着碧绿的草地。')
    expect(r.core).not.toMatch(/^[的地得]|[的地得]$/)
    expect(r.modifiers.length).toBeGreaterThan(0)
  })

  it('剥得太狠（剩不到 4 个字）就保留原句，不要电报体', () => {
    const r = extractSkeleton('好看。')
    expect(r.core).toBe('好看。')
    expect(r.modifiers).toEqual([])
  })
})
