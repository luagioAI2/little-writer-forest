/* ============================================================
   思维导图 —— 把作文结构画出来
   ============================================================
   用 SVG 画一个横向展开的树：
     中心 → 一级分支（开头/中间/结尾）→ 叶子（具体内容）

   为什么值得单独画一个图？
     孩子看"结构"这两个字是没感觉的，但看到自己的文章被拆成
     三条枝、每枝上挂着叶子，立刻就懂了"我的文章长这样"。
   ============================================================ */

import type { MindMapNode } from '../domain/types'

interface MindMapProps {
  root: MindMapNode
  className?: string
}

const PALETTE = ['#38bdf8', '#22c55e', '#f59e0b', '#a855f7', '#f43f5e', '#0ea5e9']

/**
 * 布局常量。
 *
 * ⚠️ 别再把 viewBox 的宽度写死成一个数字（曾经是 `0 0 360 H`）。
 *    实测量过：内容真正占的是 x=62…352 —— **左边空 62px、右边只空 8px**，
 *    整张图明显偏右，家长报的就是「偏离了位置，没有靠左」。
 *    根因是常量改了、写死的 360 不会跟着改，而且**不报任何错**。
 *
 *    所以下面把 viewBox 由常量推出来：左右留白恒等，改常量也不会再走散。
 */
const LEAF_H = 30
const BRANCH_GAP = 16
const CENTER_X = 96
const BRANCH_X = 178
const LEAF_X = 262

/** 中心节点宽 68 / 叶子节点宽 94 —— 和下面画图时的尺寸必须是同一份 */
const CENTER_W = 68
const LEAF_W = 94
/** 左右各留这么多，保证图形不贴边 */
const PAD_X = 12

/** 内容真正的横向范围（中心节点左边缘 → 叶子节点右边缘） */
const CONTENT_LEFT = CENTER_X - CENTER_W / 2
const CONTENT_RIGHT_WITH_LEAVES = LEAF_X - 4 + LEAF_W

export function MindMap({ root, className = '' }: MindMapProps) {
  const branches = root.children ?? []

  let cursor = 18
  const layout = branches.map((b, bi) => {
    const leaves = b.children ?? []
    const height = Math.max(LEAF_H, leaves.length * LEAF_H)
    const y = cursor + height / 2
    const leafYs = leaves.map((_, li) => cursor + LEAF_H / 2 + li * LEAF_H)
    cursor += height + BRANCH_GAP
    return { branch: b, y, height, leafYs, color: PALETTE[bi % PALETTE.length] }
  })

  const totalH = Math.max(140, cursor + 8)
  const centerY = totalH / 2

  /*
   * 没有分支时只有中心节点 —— 这时候不能把"叶子那一列"也算进内容宽度，
   * 否则图形会缩在左边、右边空一大片（同样是"偏离位置"）。
   */
  const contentRight =
    branches.length > 0 ? CONTENT_RIGHT_WITH_LEAVES : CONTENT_LEFT + CENTER_W
  const viewX = CONTENT_LEFT - PAD_X
  const viewW = contentRight - CONTENT_LEFT + PAD_X * 2

  return (
    <div className={`overflow-x-auto ${className}`}>
      <svg
        viewBox={`${viewX} 0 ${viewW} ${totalH}`}
        style={{ minWidth: viewW, width: '100%', height: 'auto' }}
        role="img"
        aria-label={`思维导图：${root.label}`}
      >
        {/* 连线先画，压在节点下面 */}
        <g strokeLinecap="round" fill="none">
          {layout.map((l, i) => (
            <g key={i}>
              {/* 中心 → 一级分支 */}
              <path
                d={`M${CENTER_X + 34} ${centerY} C${CENTER_X + 62} ${centerY}, ${BRANCH_X - 26} ${l.y}, ${BRANCH_X - 6} ${l.y}`}
                stroke={l.color}
                strokeWidth="2.6"
                opacity="0.75"
              />
              {/* 一级分支 → 叶子 */}
              {l.leafYs.map((ly, li) => (
                <path
                  key={li}
                  d={`M${BRANCH_X + 30} ${l.y} C${BRANCH_X + 48} ${l.y}, ${LEAF_X - 22} ${ly}, ${LEAF_X - 4} ${ly}`}
                  stroke={l.color}
                  strokeWidth="1.8"
                  opacity="0.5"
                />
              ))}
            </g>
          ))}
        </g>

        {/* 中心节点 */}
        <g>
          <rect
            x={CENTER_X - CENTER_W / 2}
            y={centerY - 26}
            width={CENTER_W}
            height="52"
            rx="16"
            fill="#fef3c7"
            stroke="#f59e0b"
            strokeWidth="2.6"
          />
          <text
            x={CENTER_X}
            y={centerY - 4}
            textAnchor="middle"
            fontSize="17"
            dominantBaseline="middle"
          >
            {root.emoji ?? '🌳'}
          </text>
          <foreignObject x={CENTER_X - 32} y={centerY + 6} width="64" height="18">
            <div className="text-center text-[10px] font-extrabold leading-tight text-ink-900">
              {clip(root.label, 8)}
            </div>
          </foreignObject>
        </g>

        {/* 一级分支 + 叶子 */}
        {layout.map((l, i) => (
          <g key={i}>
            {/* 一级节点 */}
            <rect
              x={BRANCH_X - 6}
              y={l.y - 15}
              width="64"
              height="30"
              rx="12"
              fill="#ffffff"
              stroke={l.color}
              strokeWidth="2.4"
            />
            <text x={BRANCH_X + 4} y={l.y + 1} fontSize="12" dominantBaseline="middle">
              {l.branch.emoji ?? '•'}
            </text>
            <foreignObject x={BRANCH_X + 20} y={l.y - 11} width="36" height="22">
              <div className="flex h-full items-center text-[10px] font-extrabold text-ink-900">
                {clip(l.branch.label, 5)}
              </div>
            </foreignObject>

            {/* 叶子 */}
            {l.leafYs.map((ly, li) => {
              const leaf = l.branch.children?.[li]
              if (!leaf) return null
              return (
                <g key={li}>
                  <rect
                    x={LEAF_X - 4}
                    y={ly - 12}
                    width={LEAF_W}
                    height="24"
                    rx="10"
                    fill={`${l.color}22`}
                    stroke={l.color}
                    strokeWidth="1.6"
                    strokeOpacity="0.6"
                  />
                  <foreignObject x={LEAF_X + 2} y={ly - 10} width="84" height="20">
                    <div className="flex h-full items-center gap-0.5 text-[9.5px] font-bold leading-tight text-ink-700">
                      <span>{leaf.emoji ?? ''}</span>
                      <span className="line-clamp-2">{clip(leaf.label, 13)}</span>
                    </div>
                  </foreignObject>
                </g>
              )
            })}
          </g>
        ))}
      </svg>
    </div>
  )
}

function clip(text: string, n: number): string {
  if (!text) return ''
  return text.length > n ? `${text.slice(0, n)}…` : text
}

/* ============================================================
   五维雷达图 —— 比分数条更直观
   ============================================================ */

import { DIMENSIONS, type DimensionScores } from '../domain/types'

export function RadarChart({
  scores,
  className = '',
  size = 200,
}: {
  scores: DimensionScores
  className?: string
  size?: number
}) {
  const cx = size / 2
  const cy = size / 2
  const R = size * 0.34
  const n = DIMENSIONS.length

  // 角度：从正上方开始，顺时针
  const angleOf = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n

  const pointAt = (i: number, ratio: number) => ({
    x: cx + Math.cos(angleOf(i)) * R * ratio,
    y: cy + Math.sin(angleOf(i)) * R * ratio,
  })

  const rings = [0.25, 0.5, 0.75, 1]
  const shape = DIMENSIONS.map((d, i) => pointAt(i, Math.max(0.06, scores[d.key] / 100)))
  const path = shape.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      style={{ width: '100%', maxWidth: size, height: 'auto' }}
      role="img"
      aria-label="五维能力图"
    >
      {/* 网格 */}
      {rings.map((r, i) => (
        <polygon
          key={i}
          points={DIMENSIONS.map((_, di) => {
            const p = pointAt(di, r)
            return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
          }).join(' ')}
          fill="none"
          stroke="#c9c2b4"
          strokeWidth="1"
          opacity="0.55"
        />
      ))}
      {/* 轴线 */}
      {DIMENSIONS.map((_, i) => {
        const p = pointAt(i, 1)
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            stroke="#c9c2b4"
            strokeWidth="1"
            opacity="0.45"
          />
        )
      })}

      {/* 数据多边形 */}
      <polygon
        points={path}
        fill="#fbbf24"
        fillOpacity="0.35"
        stroke="#f59e0b"
        strokeWidth="2.4"
        strokeLinejoin="round"
        className="anim-pop"
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />

      {/* 数据点 */}
      {shape.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3.4" fill="#f59e0b" stroke="#fff" strokeWidth="1.6" />
      ))}

      {/* 标签 */}
      {DIMENSIONS.map((d, i) => {
        const p = pointAt(i, 1.32)
        return (
          <g key={d.key}>
            <text x={p.x} y={p.y - 3} textAnchor="middle" fontSize="12" dominantBaseline="middle">
              {d.emoji}
            </text>
            <text
              x={p.x}
              y={p.y + 10}
              textAnchor="middle"
              fontSize="9.5"
              fontWeight="700"
              fill="#5f584e"
            >
              {d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
