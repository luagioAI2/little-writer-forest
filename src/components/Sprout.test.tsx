/* ============================================================
   小笔苗的回归测试
   ============================================================

   守的是**渲染顺序**和**可读性下限** —— 这两条都不是"好不好看"，
   是"这个角色还认不认得出"，属于会静默坏掉的那类问题。

   真实踩过的坑（第一版）：
     · 铅笔杆画在身体和叶子**之后**，被完全盖住 ——
       渲染出来只是一个圆球顶两片叶子，"笔长成苗"的设定整个丢了；
     · 身体只占画布 43%，56px 以下脸就糊成一团，看不出是张脸。
   ============================================================ */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Sprout } from './Sprout'
import type { SproutMood } from './Sprout'

const MOODS: SproutMood[] = ['happy', 'thinking', 'cheer', 'sleepy', 'curious']

/** 浅色世界的三个关键色（见 Sprout.tsx 的 LIGHT） */
const WOOD = '#e8c98f'
const LEAF = 'var(--color-inkleaf-400)'
const BODY = 'var(--color-inkleaf-50)'

describe('小笔苗 · 渲染顺序', () => {
  it('★ 铅笔必须画在叶子和身体之前，否则会被盖掉', () => {
    const html = renderToStaticMarkup(<Sprout />)
    const wood = html.indexOf(WOOD)
    const leaf = html.indexOf(LEAF)
    const body = html.indexOf(BODY)

    expect(wood).toBeGreaterThanOrEqual(0)
    // SVG 里后画的盖先画的 —— 笔杆排在这两者前面才露得出来
    expect(wood).toBeLessThan(leaf)
    expect(wood).toBeLessThan(body)
  })

  it('笔尖也必须在叶子之前', () => {
    const html = renderToStaticMarkup(<Sprout />)
    // 笔尖是三角形，路径以 M55 18 开头
    expect(html.indexOf('M55 18')).toBeLessThan(html.indexOf(LEAF))
  })

  it('身体必须画在叶子之后（叶子是从身体后面长出来的）', () => {
    const html = renderToStaticMarkup(<Sprout />)
    expect(html.indexOf(LEAF)).toBeLessThan(html.indexOf(BODY))
  })
})

describe('小笔苗 · 表情', () => {
  it('五种表情都能渲染，且互相不同', () => {
    const seen = new Set<string>()
    for (const mood of MOODS) {
      const html = renderToStaticMarkup(<Sprout mood={mood} />)
      expect(html.startsWith('<svg')).toBe(true)
      expect(html).toContain('</svg>')
      seen.add(html)
    }
    // 表情之间不能渲染成同一个东西
    expect(seen.size).toBe(MOODS.length)
  })

  it('欢呼会撒星点，别的表情不会', () => {
    expect(renderToStaticMarkup(<Sprout mood="cheer" />)).toContain('anim-sparkle')
    expect(renderToStaticMarkup(<Sprout mood="sleepy" />)).not.toContain('anim-sparkle')
  })

  it('想事情时头顶有三个点', () => {
    const html = renderToStaticMarkup(<Sprout mood="thinking" />)
    const dots = html.match(/anim-sparkle/g) ?? []
    expect(dots.length).toBe(3)
  })
})

describe('小笔苗 · 两个世界与可访问性', () => {
  it('墨夜世界换一组颜色，不写死色值', () => {
    const light = renderToStaticMarkup(<Sprout />)
    const ink = renderToStaticMarkup(<Sprout ink />)
    expect(light).not.toBe(ink)
    expect(ink).toContain('var(--color-night-')
  })

  it('默认是纯装饰（读屏跳过），传 label 才读', () => {
    expect(renderToStaticMarkup(<Sprout />)).toContain('aria-hidden="true"')
    const labeled = renderToStaticMarkup(<Sprout label="小笔苗" />)
    expect(labeled).toContain('aria-label="小笔苗"')
    expect(labeled).not.toContain('aria-hidden="true"')
  })

  it('animated=false 时不带动画类 —— 截图和测试要可复现', () => {
    const html = renderToStaticMarkup(<Sprout animated={false} />)
    expect(html).not.toContain('anim-breathe')
    expect(html).not.toContain('anim-sway')
  })
})
