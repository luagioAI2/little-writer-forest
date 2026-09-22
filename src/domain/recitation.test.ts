/* ============================================================
   背诵比对 v2 的回归测试
   ============================================================

   v2 的行为改变（按用户反馈）：
     · 比对目标从「主干」改成「完整范文句子」
     · 主干的角色退化为提示，不再是评分依据
     · 匹配要宽容：孩子漏掉修饰词不该判失败

   这些用例锁定这套行为，防止以后改回「只背主干」。
   ============================================================ */

import { describe, expect, it } from 'vitest'
import { compareRecitation, hintForLine, matchLine } from './recitation'
import type { SkeletonLine } from './types'

const LINE: SkeletonLine = {
  core: '阳光照着草地',
  modifiers: ['金灿灿的', '暖暖地', '碧绿的'],
  full: '金灿灿的阳光暖暖地照着碧绿的草地',
}

const LINES: SkeletonLine[] = [
  LINE,
  {
    core: '我心里那地方忽然被晒干了',
    modifiers: ['块湿漉漉的'],
    full: '就是那一下，我心里那块湿漉漉的地方，忽然被晒干了',
  },
  {
    core: '她只是拍了拍我的肩',
    modifiers: [],
    full: '结果她只是拍了拍我的肩，什么也没说',
  },
]

describe('backing the full model essay（v2 核心行为）', () => {
  it('完全照背拿满分三星', () => {
    const r = compareRecitation(LINES.map((l) => l.full).join('。'), LINES)
    expect(r.matchScore).toBe(100)
    expect(r.stars).toBe(3)
    expect(r.hitCount).toBe(3)
  })

  it('只漏掉修饰词仍然算过（这是 v2 的关键放宽）', () => {
    // 模拟孩子把修饰词漏了，但主干和语序都对
    const heard = '阳光照着草地。就是那一下我心里那块地方忽然被晒干了。结果她只是拍了拍我的肩什么也没说'
    const r = compareRecitation(heard, LINES)
    expect(r.hitCount).toBeGreaterThanOrEqual(2)
    expect(r.matchScore).toBeGreaterThanOrEqual(60)
  })

  it('背一半只能拿一星', () => {
    const r = compareRecitation(LINES[0].full, LINES)
    expect(r.hitCount).toBe(1)
    expect(r.stars).toBe(1)
  })

  it('完全没背拿最低分', () => {
    const r = compareRecitation('今天天气真好我想出去玩', LINES)
    expect(r.hitCount).toBe(0)
    expect(r.matchScore).toBeLessThan(20)
  })

  it('比对的是完整句子，不是主干', () => {
    // 只背主干（三句的 core 拼起来）应该拿不到满分 ——
    // 因为 v2 的目标是完整范文
    const onlyCores = LINES.map((l) => l.core).join('。')
    const r = compareRecitation(onlyCores, LINES)
    expect(r.matchScore).toBeLessThan(100)
  })
})

describe('matchLine 的宽容度', () => {
  it('完全一致 → 100', () => {
    expect(matchLine(LINE.full, LINE.full).score).toBe(100)
  })

  it('长句漏一个修饰词仍然算过', () => {
    const heard = '金灿灿的阳光照着碧绿的草地'
    const r = matchLine(heard, LINE.full)
    expect(r.matched).toBe(true)
    expect(r.score).toBeGreaterThanOrEqual(58)
  })

  it('完全无关 → 不通过', () => {
    expect(matchLine('我爱吃苹果和香蕉', LINE.full).matched).toBe(false)
  })

  it('空输入不报错', () => {
    expect(matchLine('', LINE.full).matched).toBe(false)
    expect(matchLine(LINE.full, '').matched).toBe(true)
  })
})

describe('提示卡（骨架的新角色）', () => {
  it('1 级只给字数和首字', () => {
    const h = hintForLine(LINE.full, 1, LINE.modifiers)
    expect(h).toContain('第一个字是「金」')
    expect(h).not.toContain('暖暖地')
  })

  it('2 级开始透露修饰词', () => {
    const h = hintForLine(LINE.full, 2, LINE.modifiers)
    expect(h).toContain('金灿灿的')
  })

  it('3 级给出全部修饰词', () => {
    const h = hintForLine(LINE.full, 3, LINE.modifiers)
    expect(h).toContain('金灿灿的')
    expect(h).toContain('暖暖地')
    expect(h).toContain('碧绿的')
  })

  it('绝不把整句直接念出来（那不是提示，是抄答案）', () => {
    for (const lv of [1, 2, 3] as const) {
      const h = hintForLine(LINE.full, lv, LINE.modifiers)
      expect(h).not.toContain(LINE.full)
    }
  })

  it('没有修饰词时也不崩', () => {
    const h = hintForLine('阳光照着草地', 2, [])
    expect(h).toContain('阳光')
  })
})
