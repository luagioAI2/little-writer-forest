/* ============================================================
   成长树 —— 段位的可视化
   ============================================================

   这是整个 App 情感设计的核心：
   孩子不需要看懂分数，只要看到自己的树长大了。

   12 个阶段对应 12 个段位（灵芽 → 青华 → 扶摇 → … → 通天神树），
   从一颗破土的灵芽长成遮天蔽日的通天神树。
   全部用 SVG 画，不依赖任何图片资源。
   ============================================================ */

import type { LevelMeta } from '../domain/types'

interface TreeArtProps {
  /** 段位序号 0-11 */
  stage: number
  className?: string
  /** 是否播放生长动画 */
  animate?: boolean
}

export function TreeArt({ stage, className = '', animate = true }: TreeArtProps) {
  const s = Math.max(0, Math.min(11, stage))

  // 天空随段位变化：从清晨到星夜再到彩虹
  const sky = SKY_BY_STAGE[s]
  const uid = `tree-${s}`

  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      role="img"
      aria-label={`成长树第 ${s + 1} 阶段`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={sky.top} />
          <stop offset="100%" stopColor={sky.bottom} />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#fde68a" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 天空 */}
      <rect x="0" y="0" width="200" height="200" rx="28" fill={`url(#${uid}-sky)`} />

      {/* 高处段位加光晕 */}
      {s >= 8 && <circle cx="100" cy="90" r="78" fill={`url(#${uid}-glow)`} />}

      {/* 背景装饰：星 / 彩虹 / 光点 */}
      {s >= 6 && <Sparkles seed={s} />}
      {s >= 11 && <Rainbow uid={uid} />}

      {/* 地面 */}
      <ellipse cx="100" cy="168" rx="76" ry="18" fill={sky.ground} opacity="0.55" />
      <ellipse cx="100" cy="170" rx="52" ry="11" fill={sky.ground} opacity="0.5" />

      {/* 树本体 */}
      <g
        className={animate ? 'anim-grow' : ''}
        style={{ transformOrigin: '100px 168px' }}
      >
        <Tree stage={s} />
      </g>

      {/* 果实 / 花 / 光点 */}
      {s >= 5 && <Blossoms stage={s} />}

      {/* 守护精灵：最高段位出现 */}
      {s >= 10 && (
        <g className="anim-float">
          <text x="150" y="60" fontSize="22" textAnchor="middle">
            ✨
          </text>
        </g>
      )}
    </svg>
  )
}

/* ---------------- 天空配色表 ---------------- */

const SKY_BY_STAGE: { top: string; bottom: string; ground: string }[] = [
  { top: '#fef3c7', bottom: '#fde68a', ground: '#d6b98c' }, // 0 灵芽树 · 萌芽
  { top: '#e0f2fe', bottom: '#dcfce7', ground: '#86efac' }, // 1 青华树 · 幼苗
  { top: '#e0f2fe', bottom: '#dcfce7', ground: '#86efac' }, // 2 扶摇树 · 小树
  { top: '#dbeafe', bottom: '#dcfce7', ground: '#7dd3a0' }, // 3 琼华树 · 花成
  { top: '#dbeafe', bottom: '#bbf7d0', ground: '#6ee7a0' }, // 4 苍梧树 · 稳成
  { top: '#fce7f3', bottom: '#e0f2fe', ground: '#86efac' }, // 5 紫宸树 · 细成
  { top: '#fef3c7', bottom: '#fed7aa', ground: '#fbbf24' }, // 6 赤霄树 · 深成
  { top: '#fef3c7', bottom: '#fde68a', ground: '#f59e0b' }, // 7 玉衡树 · 成熟
  { top: '#e0f2fe', bottom: '#bae6fd', ground: '#7dd3fc' }, // 8 沧溟树 · 卓越
  { top: '#ede9fe', bottom: '#ddd6fe', ground: '#c4b5fd' }, // 9 星辰树 · 才成
  { top: '#1e1b4b', bottom: '#4c1d95', ground: '#7c3aed' }, // 10 玄极树 · 大师 · 夜空
  { top: '#312e81', bottom: '#be185d', ground: '#f472b6' }, // 11 通天神树 · 巅峰 · 极光
]

/* ---------------- 树形 ---------------- */

function Tree({ stage }: { stage: number }) {
  /* ---------------- 尺寸 ----------------
     ★ 第 0/1/2 段（灵芽 / 青华 / 扶摇）以前画的是"埋在土里的种子"
       和"一根细茎加两片叶"。问题很直接：这一屏叫「成长树」，
       可孩子看不到一棵树 —— 而树上还要掉金币、掉卡、掉树种。
       现在从第 0 段起就是一**棵树**，只是小得可怜；
       尺寸与第 3 段「琼华树」严丝合缝地接上，长起来是连续的。 */
  const small = stage < 3
  const trunkH = small ? 12 + (stage * 22) / 3 : 34 + Math.min(stage - 3, 5) * 5
  const crownR = small ? 9 + stage * 5 : 24 + Math.min(stage - 3, 6) * 3.2
  const crownY = 168 - trunkH - crownR * 0.55
  const trunkW = stage >= 8 ? 9 : small ? 3.2 + stage * 0.9 : 7

  const foliage =
    stage >= 7
      ? ['#f59e0b', '#fbbf24', '#fcd34d'] // 金叶
      : stage >= 5
        ? ['#4ade80', '#22c55e', '#16a34a', '#fb7185'] // 带花
        : ['#4ade80', '#22c55e', '#16a34a']

  return (
    <g>
      {/* 第 0 段：种子壳还留在土里 —— 提醒孩子"你是从这儿长出来的"（灵芽树） */}
      {stage === 0 && (
        <>
          <ellipse cx="100" cy="166" rx="9.5" ry="6" fill="#a16207" opacity="0.9" />
          <ellipse cx="96.5" cy="163.5" rx="2.6" ry="1.8" fill="#d97706" opacity="0.7" />
        </>
      )}

      {/* 树干 */}
      <path
        d={`M100 168 L100 ${168 - trunkH}`}
        stroke="#92400e"
        strokeWidth={trunkW}
        strokeLinecap="round"
        fill="none"
      />
      {/* 分枝：树越大分枝越多 */}
      {stage >= 4 && (
        <>
          <path
            d={`M100 ${168 - trunkH * 0.6} L${100 - crownR * 0.55} ${168 - trunkH * 0.85}`}
            stroke="#92400e"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d={`M100 ${168 - trunkH * 0.6} L${100 + crownR * 0.55} ${168 - trunkH * 0.85}`}
            stroke="#92400e"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      )}
      {stage >= 8 && (
        <>
          <path
            d={`M100 ${168 - trunkH * 0.35} L${100 - crownR * 0.8} ${168 - trunkH * 0.55}`}
            stroke="#92400e"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path
            d={`M100 ${168 - trunkH * 0.35} L${100 + crownR * 0.8} ${168 - trunkH * 0.55}`}
            stroke="#92400e"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </>
      )}

      {/* 树冠：三个圆叠出体积感 */}
      <circle cx={100} cy={crownY} r={crownR} fill={foliage[1]} />
      <circle cx={100 - crownR * 0.62} cy={crownY + crownR * 0.3} r={crownR * 0.68} fill={foliage[2]} />
      <circle cx={100 + crownR * 0.62} cy={crownY + crownR * 0.3} r={crownR * 0.68} fill={foliage[0]} />
      <circle cx={100} cy={crownY - crownR * 0.5} r={crownR * 0.6} fill={foliage[0]} opacity="0.9" />

      {/* 高光 */}
      <circle cx={100 - crownR * 0.3} cy={crownY - crownR * 0.45} r={crownR * 0.22} fill="#ffffff" opacity="0.28" />

      {/* 传说级：树冠外围光环 */}
      {stage >= 9 && (
        <circle
          cx={100}
          cy={crownY}
          r={crownR * 1.42}
          fill="none"
          stroke={stage >= 10 ? '#fcd34d' : '#c4b5fd'}
          strokeWidth="2.5"
          strokeDasharray="7 6"
          opacity="0.75"
          className="anim-sparkle"
        />
      )}
    </g>
  )
}

/* ---------------- 花果 ---------------- */

function Blossoms({ stage }: { stage: number }) {
  // 紫宸树开粉花，赤霄树结红果，玉衡树撒金叶
  const isFlower = stage === 5
  const isFruit = stage === 6
  const isGold = stage >= 7

  const positions = [
    [80, 78], [122, 72], [100, 62], [68, 96], [132, 94], [100, 108], [88, 88], [114, 100],
  ]

  return (
    <g>
      {positions.map(([x, y], i) => {
        if (isFlower) {
          return (
            <g key={i} className="anim-sparkle" style={{ animationDelay: `${i * 0.2}s` }}>
              <circle cx={x} cy={y} r="4.5" fill="#fb7185" />
              <circle cx={x} cy={y} r="1.8" fill="#fef3c7" />
            </g>
          )
        }
        if (isFruit) {
          return (
            <g key={i}>
              <circle cx={x} cy={y} r="5" fill="#f43f5e" />
              <circle cx={x - 1.5} cy={y - 1.5} r="1.6" fill="#ffffff" opacity="0.6" />
            </g>
          )
        }
        if (isGold) {
          return (
            <ellipse
              key={i}
              cx={x}
              cy={y}
              rx="4"
              ry="2.6"
              fill="#fbbf24"
              className="anim-sway"
              style={{ animationDelay: `${i * 0.3}s` }}
            />
          )
        }
        return null
      })}
    </g>
  )
}

/* ---------------- 装饰 ---------------- */

function Sparkles({ seed }: { seed: number }) {
  // 用固定的伪随机（不用 Math.random，避免每次渲染位置跳动）
  const pts = Array.from({ length: 9 }, (_, i) => {
    const a = (i * 137.5 + seed * 31) % 360
    const r = 60 + ((i * 23 + seed * 7) % 30)
    const x = 100 + Math.cos((a * Math.PI) / 180) * r
    const y = 70 + Math.sin((a * Math.PI) / 180) * r * 0.62
    return { x, y, d: (i % 5) * 0.22 }
  })
  return (
    <g>
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={seed >= 10 ? 2.2 : 1.6}
          fill="#ffffff"
          opacity="0.85"
          className="anim-sparkle"
          style={{ animationDelay: `${p.d}s` }}
        />
      ))}
    </g>
  )
}

function Rainbow({ uid }: { uid: string }) {
  const colors = ['#f43f5e', '#fb923c', '#fcd34d', '#4ade80', '#38bdf8', '#a855f7']
  return (
    <g opacity="0.5">
      {colors.map((c, i) => (
        <path
          key={i}
          d={`M20 168 A80 80 0 0 1 180 168`}
          fill="none"
          stroke={c}
          strokeWidth="4"
          opacity="0.7"
          transform={`scale(${1 - i * 0.055}) translate(${i * 5.5} ${i * 5.5})`}
          style={{ transformOrigin: '100px 168px' }}
        />
      ))}
      <title>{uid}</title>
    </g>
  )
}

/* ---------------- 紧凑版：列表里用 ---------------- */

export function MiniTree({ stage, size = 44 }: { stage: number; size?: number }) {
  return (
    <div style={{ width: size, height: size }} className="shrink-0">
      <TreeArt stage={stage} animate={false} />
    </div>
  )
}

/* ---------------- 段位徽章 ---------------- */

export function LevelBadge({ meta, size = 'md' }: { meta: LevelMeta; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'sm' ? 40 : size === 'lg' ? 64 : 52
  const text = size === 'sm' ? 'text-xl' : size === 'lg' ? 'text-3xl' : 'text-2xl'
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full"
      style={{
        width: dim,
        height: dim,
        background: `linear-gradient(160deg, ${meta.color}22, ${meta.color}55)`,
        boxShadow: `inset 0 0 0 1px ${meta.color}55`,
      }}
      title={meta.name}
    >
      <span className={text}>{meta.emoji}</span>
    </div>
  )
}
