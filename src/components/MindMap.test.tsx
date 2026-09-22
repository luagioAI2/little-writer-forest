/* ============================================================
   思维导图 · 版式
   ============================================================

   家长报的原话：
     「评价里 作文长这样的 图 偏离了位置。没有靠左」

   实测量过：内容真正占的是 x=62…352，而 viewBox 宽 360 ——
   **左边空 62px、右边只空 8px**，整张图明显偏右。

   根因是布局常量（CENTER_X / LEAF_X）和**写死的 viewBox 宽度**是两份声明：
   常量改了，写死的 360 不会跟着改，而且不报任何错。
   现在 viewBox 由常量推出来，这组测试盯着"左右留白恒等"。

   ★ 为什么要在第 2 层测：这是**几何**，不是观感。
     jsdom 算不了布局，但 SVG 的坐标是**画在属性里的** ——
     直接读出来比对比截图更准、更快、还能进 CI。
   ============================================================ */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MindMap } from './MindMap'
import type { MindMapNode } from '../domain/types'

function makeRoot(children: MindMapNode['children']): MindMapNode {
  return { label: '雨后的彩虹', emoji: '🌈', children }
}

const THREE: MindMapNode['children'] = [
  { label: '开头', emoji: '🚪', children: [{ label: '下雨了', emoji: '✏️' }] },
  {
    label: '中间',
    emoji: '🌊',
    children: [
      { label: '出现彩虹', emoji: '👀' },
      { label: '我和小红', emoji: '👀' },
    ],
  },
  { label: '结尾', emoji: '🎯', children: [{ label: '很开心', emoji: '💗' }] },
]

/** 把 SVG 里所有"有横向范围"的元素读出来，算出内容的左右边界 */
function bounds(html: string) {
  const xs: number[] = []
  const rights: number[] = []

  for (const m of html.matchAll(/<rect[^>]*\sx="(-?[\d.]+)"[^>]*\swidth="(-?[\d.]+)"/g)) {
    xs.push(Number(m[1]))
    rights.push(Number(m[1]) + Number(m[2]))
  }
  for (const m of html.matchAll(/<foreignObject[^>]*\sx="(-?[\d.]+)"[^>]*\swidth="(-?[\d.]+)"/g)) {
    xs.push(Number(m[1]))
    rights.push(Number(m[1]) + Number(m[2]))
  }
  for (const m of html.matchAll(/<text[^>]*\sx="(-?[\d.]+)"/g)) xs.push(Number(m[1]))

  const vb = /viewBox="(-?[\d.]+) 0 ([\d.]+) /.exec(html)
  expect(vb, 'viewBox 必须存在').toBeTruthy()
  const [, vx, vw] = vb!
  return {
    left: Math.min(...xs),
    right: Math.max(...rights),
    viewX: Number(vx),
    viewW: Number(vw),
  }
}

describe('思维导图 · 横向位置', () => {
  it('★ 左右留白必须相等 —— 不能像以前那样左空 62、右空 8', () => {
    const b = bounds(renderToStaticMarkup(<MindMap root={makeRoot(THREE)} />))
    const padLeft = b.left - b.viewX
    const padRight = b.viewX + b.viewW - b.right

    // 以前这里是 62 vs 8 —— 差值 54，肉眼一眼就看得出偏
    expect(Math.abs(padLeft - padRight), `左白 ${padLeft} / 右白 ${padRight}`).toBeLessThanOrEqual(1)
  })

  it('★ 图形不许贴边 —— 左右都要留出呼吸位', () => {
    const b = bounds(renderToStaticMarkup(<MindMap root={makeRoot(THREE)} />))
    expect(b.left - b.viewX).toBeGreaterThanOrEqual(8)
    expect(b.viewX + b.viewW - b.right).toBeGreaterThanOrEqual(8)
  })

  it('★ viewBox 要跟着内容走 —— 结构变多时也不能把图挤偏', () => {
    // 一级分支数不同 → 高度不同，但横向范围只由布局常量决定，
    // 所以两次的左右留白必须一致。写死 viewBox 宽度时这条会露馅。
    for (const kids of [
      [THREE[0]],
      THREE,
      [
        ...THREE,
        { label: '第四枝', emoji: '🌟', children: [{ label: '多出来的', emoji: '✏️' }] },
      ],
    ] as MindMapNode['children'][]) {
      const b = bounds(renderToStaticMarkup(<MindMap root={makeRoot(kids)} />))
      expect(Math.abs(b.left - b.viewX - (b.viewX + b.viewW - b.right))).toBeLessThanOrEqual(1)
    }
  })

  it('没有分支时也不炸，且仍然是居中的', () => {
    const b = bounds(renderToStaticMarkup(<MindMap root={makeRoot([])} />))
    expect(Number.isFinite(b.viewW)).toBe(true)
    expect(Math.abs(b.left - b.viewX - (b.viewX + b.viewW - b.right))).toBeLessThanOrEqual(1)
  })
})
