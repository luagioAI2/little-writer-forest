/* ============================================================
   评分结果展示  v3
   ============================================================
   展示顺序是有讲究的，对应孩子的心理节奏：

     1. 先给总分和星星 —— 最直观的肯定
     2. 再给"好在哪"   —— 具体的表扬，配原文证据
     3. 然后给思维导图 —— 让他"看见"自己的文章结构
     4. 最后才给建议   —— 放在最后，且只指方向不给答案

   这个顺序很重要：如果把建议放前面，孩子会只记得自己写得不好。

   v3 的变化：粗描边 + 彩虹底色 + emoji 一律撤掉，
   换成发丝边、单色点缀与自绘图标 —— 让"分数"本身成为主角。
   ============================================================ */

import { useEffect, useState } from 'react'
import type { DimensionScores, WorkScore } from '../../domain/types'
import { DIMENSIONS, dimensionMeta } from '../../domain/types'
import { MindMap, RadarChart } from '../../components/MindMap'
import { Card, ProgressBar, SectionTitle, Stars } from '../../components/ui'
import {
  IconCheck,
  IconInk,
  IconLightbulb,
  IconMapOutline,
  IconMinus,
  IconSeal,
  IconSparkle,
  IconSprout,
} from '../../components/icons'
import { playSound } from '../../platform/sound'

/* ---------------- 分数圆环 ---------------- */

function ScoreRing({ score, size = 150 }: { score: number; size?: number }) {
  const [shown, setShown] = useState(0)

  // 数字滚动到目标分数，做出"揭晓"的感觉
  useEffect(() => {
    const dur = 900
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(Math.round(score * eased))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [score])

  const r = size / 2 - 12
  const circumference = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, shown))
  const offset = circumference * (1 - pct / 100)

  // 分数越高颜色越暖，给孩子"越写越亮"的直觉
  const color =
    score >= 90 ? '#febb32' : score >= 78 ? '#29ce89' : score >= 60 ? '#6195b7' : '#8c73c5'

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ece7dc" strokeWidth="10" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.1s linear' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="tnum font-display text-4xl font-bold leading-none text-ink-900">
          {shown}
        </span>
        <span className="mt-0.5 text-2xs font-semibold text-ink-500">分</span>
      </div>
    </div>
  )
}

/* ---------------- 维度条 ---------------- */

function DimensionBars({ scores }: { scores: DimensionScores }) {
  return (
    <div className="flex flex-col gap-3">
      {DIMENSIONS.map((d, i) => {
        const v = scores[d.key]
        const tone = v >= 80 ? 'leaf' : v >= 60 ? 'amber' : v >= 40 ? 'mist' : 'moss'
        return (
          <div key={d.key} className={`anim-fade-in delay-${Math.min(i + 1, 5)}`}>
            <div className="mb-1 flex items-baseline gap-1.5">
              <span className="font-display text-sm font-bold text-ink-900">{d.label}</span>
              <span className="min-w-0 flex-1 truncate text-2xs text-ink-500">{d.kidDesc}</span>
              <span className="tnum shrink-0 text-sm font-bold text-ink-900">{v}</span>
            </div>
            <ProgressBar value={v} tone={tone} height={7} />
          </div>
        )
      })}
    </div>
  )
}

/* ---------------- 主组件 ---------------- */

export function ScoreView({
  score,
  scoredCount,
  confidence,
  className = '',
}: {
  score: WorkScore
  /** 这是第几篇，用于提示"预测水平" */
  scoredCount?: number
  confidence?: 'predicted' | 'settling' | 'established'
  className?: string
}) {
  // 揭晓音效
  useEffect(() => {
    playSound('score')
  }, [])

  return (
    <div className={`flex flex-col gap-3.5 ${className}`}>
      {/* 总分 */}
      <Card className="flex flex-col items-center gap-3">
        <ScoreRing score={score.total} />
        <Stars count={score.stars} size="lg" />
        <p className="text-center font-display text-base font-bold leading-relaxed text-ink-900">
          {score.summary}
        </p>

        {/* 预测水平提示 —— 需求要求明确区分 */}
        {confidence && confidence !== 'established' && (
          <div className="flex w-full items-center justify-center gap-1.5 rounded-md bg-mist-50 px-3 py-2 text-center shadow-[var(--hair)]">
            <span className="text-mist-500">
              <IconSparkle size={13} />
            </span>
            <span className="text-2xs font-bold text-mist-600">
              这是「预测水平」
              {scoredCount ? `（第 ${scoredCount} 篇）` : ''}
              ，多写几篇小笔苗就能算准
            </span>
          </div>
        )}
        {confidence === 'established' && (
          <div className="flex w-full items-center justify-center gap-1.5 rounded-md bg-inkleaf-50 px-3 py-2 text-center shadow-[var(--hair-leaf)]">
            <span className="text-inkleaf-600">
              <IconCheck size={13} strokeWidth={2.6} />
            </span>
            <span className="text-2xs font-bold text-inkleaf-700">
              这已经是你的「实际水平」了，很稳
            </span>
          </div>
        )}
      </Card>

      {/* 五维 */}
      <Card>
        <SectionTitle
          icon={<IconSparkle size={16} />}
          title="五个方面分别怎么样"
          sub="每个方面都是 100 分制"
        />
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <RadarChart scores={score.dimensions} size={190} className="shrink-0" />
          <div className="w-full min-w-0 flex-1">
            <DimensionBars scores={score.dimensions} />
          </div>
        </div>
      </Card>

      {/* 好在哪 */}
      {score.strengths.length > 0 && (
        <Card tone="tint">
          <SectionTitle
            icon={<IconSprout size={16} />}
            title="这些地方做得特别好"
            sub="都是你自己写出来的，不是小笔苗夸的"
          />
          <div className="flex flex-col gap-2">
            {score.strengths.map((s, i) => (
              <div
                key={i}
                className={`flex gap-2.5 rounded-md bg-white px-3 py-2.5 shadow-[var(--hair-leaf)] anim-rise-in delay-${Math.min(i + 1, 5)}`}
              >
                <span className="mt-0.5 shrink-0 text-inkleaf-600">
                  <IconCheck size={15} strokeWidth={2.4} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-bold text-ink-900">{s.title}</div>
                  {s.evidence && (
                    <div className="mt-0.5 font-prose text-xs leading-relaxed text-ink-700">
                      {s.evidence}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 思维导图 */}
      <Card>
        <SectionTitle
          icon={<IconMapOutline size={16} />}
          title="你的作文长这样"
          sub="看看你的文章是怎么搭起来的"
        />
        <MindMap root={score.mindMap} />
      </Card>

      {/* 建议 —— 放最后 */}
      {score.suggestions.length > 0 && (
        <Card tone="tint">
          <SectionTitle
            icon={<IconLightbulb size={16} />}
            tone="amber"
            title="下次可以试试"
            sub="只告诉你想的方向，怎么写还是你自己决定"
          />
          <div className="flex flex-col gap-2">
            {score.suggestions.map((s, i) => (
              <div
                key={i}
                className={`rounded-md bg-white px-3 py-2.5 shadow-[var(--hair-amber)] anim-fade-in delay-${Math.min(i + 1, 5)}`}
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-amber-leaf-600">
                    <IconLightbulb size={14} />
                  </span>
                  <span className="font-display text-sm font-bold text-ink-900">{s.title}</span>
                </div>
                {s.how && (
                  <p className="mt-1 text-xs leading-relaxed text-ink-700">{s.how}</p>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 rounded-md bg-white/70 px-3 py-2 text-2xs font-semibold leading-relaxed text-ink-500">
            这里只给方向，没有现成的句子可以抄 —— 想改哪里，还是你自己说了算。
          </p>
        </Card>
      )}

      {/* 引擎标记，方便家长排查 */}
      <p className="px-1 text-center text-2xs font-medium text-ink-300">
        {score.engine === 'remote' ? '本次由远程 AI 评分' : '本次由本地引擎评分'}
      </p>
    </div>
  )
}

/* ---------------- 范文展示 ---------------- */

export function ModelEssayView({
  essay,
  onRecite,
  className = '',
}: {
  essay: {
    text: string
    highlights: string[]
    skeleton: string
    skeletonLines: unknown[]
    /** 这份写法是谁写的 —— 家长排查「AI 到底有没有生效」就看这一行 */
    engine?: 'local' | 'remote'
  }
  onRecite?: () => void
  className?: string
}) {
  const [tab, setTab] = useState<'full' | 'skeleton'>('full')

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <Card>
        <SectionTitle
          icon={<IconSeal size={16} />}
          tone="amber"
          title="更好的写法"
          sub="是你这一篇可以长成的样子 —— 故事还是你的，只是写得更好了"
        />

        <div className="mb-3 flex gap-1.5 rounded-btn bg-ink-50 p-1">
          <button
            type="button"
            onClick={() => setTab('full')}
            className={`btn-base active:btn-press flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-sm text-sm font-bold ${
              tab === 'full' ? 'bg-white text-ink-900 shadow-[var(--hair)]' : 'text-ink-500'
            }`}
          >
            <IconInk size={14} />
            完整写法
          </button>
          <button
            type="button"
            onClick={() => setTab('skeleton')}
            className={`btn-base active:btn-press flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-sm text-sm font-bold ${
              tab === 'skeleton' ? 'bg-white text-ink-900 shadow-[var(--hair)]' : 'text-ink-500'
            }`}
          >
            <IconMinus size={14} />
            只留主干
          </button>
        </div>

        {tab === 'full' ? (
          <div className="rounded-md bg-white px-4 py-3.5 font-prose text-[16px] leading-[2] text-ink-900 shadow-[var(--hair)]">
            {essay.text
              .split('\n')
              .filter(Boolean)
              .map((p, i) => (
                <p key={i} className="mb-2.5 indent-8 last:mb-0">
                  {p}
                </p>
              ))}
          </div>
        ) : (
          <div className="rounded-md bg-white px-4 py-3.5 shadow-[var(--hair)]">
            <p className="mb-2 text-2xs font-semibold leading-relaxed text-ink-500">
              去掉所有修饰词，只留下文章的骨架。背诵挑战背的是**完整写法**，
              这张骨架是卡壳时的提示 —— 想起主干，再把修饰词一个个补回去。
            </p>
            <p className="font-prose text-[16px] leading-[2.1] text-ink-900">{essay.skeleton}</p>
          </div>
        )}

        {essay.highlights.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-xs font-bold text-ink-500">这篇值得学的地方</div>
            <div className="flex flex-wrap gap-1.5">
              {essay.highlights.map((h, i) => (
                <span
                  key={i}
                  className="rounded-pill bg-moss-50 px-2.5 py-1 text-2xs font-bold text-moss-600 shadow-[var(--hair)]"
                >
                  {h}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      {onRecite && (
        <button
          type="button"
          onClick={onRecite}
          className="btn-base btn-primary active:btn-press w-full rounded-btn px-5 py-4 text-base font-bold"
        >
          去背诵挑战
        </button>
      )}

      {/* 引擎标记 —— 和点评那一页保持一致。
          家长最常问的就是「AI 到底生效了没有」，这一行直接回答它：
          没配密钥 / 断网回退时都会写「本地引擎」，不用去猜。 */}
      {essay.engine && (
        <p className="px-1 text-center text-2xs font-medium text-ink-300">
          {essay.engine === 'remote' ? '这份写法由远程 AI 改写' : '这份写法由本地引擎改写'}
        </p>
      )}
    </div>
  )
}

/* ---------------- 小工具 ---------------- */

export function dimensionLabel(key: string): string {
  return dimensionMeta(key as keyof DimensionScores).label
}
