/* ============================================================
   引擎标记 —— ★ 家长要能一眼看出「AI 到底生效了没有」
   ============================================================

   为什么要专门测这个：这个项目里最反复出现的困惑就是
   「功能好像没实现」，而根因几乎每次都是
   **大模型那条路静默关着**（没配密钥 / 只填了密钥没切模式 / 断网回退）。
   界面看起来完全正常，没有任何报错。

   所以「本次由谁算的」这一行不是装饰，它是**唯一的自证方式**。
   顺手把两个容易再犯的坑也钉住：
     · 老数据里没有 engine 字段 → 不许显示错，也不许炸
     · 需求改过之后，不许再出现「小笔苗不会帮你改作文」这种旧口径
   ============================================================ */

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ModelEssayView, ScoreView } from './ScoreView'
import type { ModelEssay, WorkScore } from '../../domain/types'

function makeScore(over: Partial<WorkScore> = {}): WorkScore {
  return {
    at: 1,
    total: 82,
    dimensions: {
      observation: 80,
      structure: 80,
      vocabulary: 80,
      imagination: 80,
      emotion: 80,
    },
    summary: '写得不错，画面感挺强。',
    strengths: [],
    suggestions: [],
    mindMap: { label: '雨后的校园', emoji: '🌳', children: [] },
    stars: 4,
    engine: 'remote',
    ...over,
  }
}

function makeEssay(over: Partial<ModelEssay> = {}): ModelEssay {
  return {
    at: 1,
    text: '雨停了，操场上亮晶晶的。',
    highlights: ['比喻用得好'],
    skeleton: '雨停了 操场 亮晶晶',
    skeletonLines: [],
    engine: 'remote',
    ...over,
  }
}

describe('点评 · 引擎标记', () => {
  it('远程算的就说远程', () => {
    render(<ScoreView score={makeScore({ engine: 'remote' })} />)
    expect(screen.getByText('本次由远程 AI 评分')).toBeInTheDocument()
  })

  it('本地算的就说本地 —— 不许含糊过去', () => {
    render(<ScoreView score={makeScore({ engine: 'local' })} />)
    expect(screen.getByText('本次由本地引擎评分')).toBeInTheDocument()
  })
})

describe('更好的写法 · 引擎标记', () => {
  it('★ 远程改写时要说清是 AI 改的', () => {
    render(<ModelEssayView essay={makeEssay({ engine: 'remote' })} />)
    expect(screen.getByText('这份写法由远程 AI 改写')).toBeInTheDocument()
  })

  it('★ 本地引擎改写时也要说 —— 否则家长会以为 AI 生效了', () => {
    render(<ModelEssayView essay={makeEssay({ engine: 'local' })} />)
    expect(screen.getByText('这份写法由本地引擎改写')).toBeInTheDocument()
  })

  it('老数据没有 engine 字段：不显示标记，也不许炸', () => {
    const old = makeEssay()
    delete (old as Partial<ModelEssay>).engine
    render(<ModelEssayView essay={old} />)

    expect(screen.queryByText(/由远程 AI 改写/)).toBeNull()
    expect(screen.queryByText(/由本地引擎改写/)).toBeNull()
    // 正文照常显示 —— 缺个标记不该把整页搞坏
    expect(screen.getByText(/操场上亮晶晶的/)).toBeInTheDocument()
  })
})

describe('★ 旧口径的文案不许回来', () => {
  it('「小笔苗不会帮你改作文」已经不成立了 —— 更好的写法就是改写', () => {
    render(<ScoreView score={makeScore({ suggestions: [] })} />)
    expect(screen.queryByText(/不会帮你改作文/)).toBeNull()
  })

  it('界面上一律叫「更好的写法」，不再叫「满分范文」', () => {
    render(<ModelEssayView essay={makeEssay()} />)
    expect(screen.getByText('更好的写法')).toBeInTheDocument()
    expect(screen.queryByText(/满分范文/)).toBeNull()
  })
})
