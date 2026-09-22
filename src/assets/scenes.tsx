/* ============================================================
   插画库 —— 126 张程序化 SVG 看图作文配图
   ============================================================

   为什么这么做：
   - 全部用 SVG 图元现画，不引用任何图片文件 / 网络资源，
     离线与安卓 APK（file://）里都能直接渲染
   - 统一 viewBox 400×300，每张图都分「远景 / 中景 / 近景」，
     孩子才有东西可写：远处有什么、近处有什么
   - 先搭一层图元（Sky / Ground / Tree / Person ...），场景再由图元拼装，
     避免 126 段互不相干的巨型 SVG，后期改配色只改一处
   - 所有散布（星星、落叶、草丛）都用确定性伪随机 rand(seed)，
     绝不用 Math.random()：否则每次重渲染画面会抖，截图测试也不稳
   - 渐变 / 遮罩的 id 由 sceneKey 派生（见 useUid），
     同一页并排渲染多张图时不会互相串味
   - SceneArt 会先查 sceneImages 有没有外链图片，有就用，没有退回 SVG。
     详见 domain/sceneImages.ts 和 domain/sceneImagePrompts.ts。
   ============================================================ */

import { createContext, useContext, useState } from 'react'
import type * as React from 'react'
import { getSceneImage } from '../domain/sceneImages'
import type { PromptImage } from '../domain/types'

/* ============================================================
   一、对外契约（其他模块依赖，勿改）
   ============================================================ */

export interface SceneProps {
  /** 作用在最外层 <svg> 上的 class（尺寸由使用方决定） */
  className?: string
}

/** 场景元数据：AI 出题时按 fits 挑图，label 给孩子看，hint 给模型看 */
export interface SceneMeta {
  key: string
  /** 中文名，如「春天的公园」 */
  label: string
  /** 一句话中文描述：画面里有什么，作为 AI 提示 */
  hint: string
  /** 适合哪几类作文 */
  fits: ('scene' | 'person' | 'event' | 'object' | 'imagine')[]
}

/* ============================================================
   二、确定性伪随机（mulberry32 变体，纯整数运算）
   ============================================================ */

/** 同一 seed 永远得到同一结果：保证重渲染 / 截图完全一致 */
function rand(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** 区间随机数 */
function rnd(seed: number, lo: number, hi: number): number {
  return lo + rand(seed) * (hi - lo)
}

/** 生成一串互不相同的 seed，配合 map 做散布 */
function seeds(base: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => base + i * 977)
}

/* ============================================================
   三、统一色板（暖调绘本感：饱和但不刺眼）
   ============================================================ */

const C = {
  ink: '#4a453d',
  inkSoft: '#8b8275',
  white: '#ffffff',
  cream: '#fffdf7',
  paper: '#fff7e8',
  wood: '#cf9a63',
  woodDark: '#a4723f',

  skin: '#ffd9b5',
  skinDeep: '#eeb387',
  hairDark: '#4b3a2f',
  hairBrown: '#7a5236',
  hairBlack: '#3a3230',
  hairGold: '#f0c04e',

  grass: '#95da6c',
  grassDeep: '#5cb44c',
  grassDark: '#3f9440',
  leaf: '#63bf5c',
  leafDeep: '#3f9d46',
  leafLight: '#a9e184',
  pine: '#3f9d6a',
  pineDeep: '#2f7d54',
  autumn: '#f0a340',
  autumnDeep: '#dd7a2e',
  blossom: '#ffb7cf',
  blossomDeep: '#f78fb3',
  bark: '#b57a4b',
  barkDeep: '#8d5a33',

  water: '#7fc9ef',
  waterDeep: '#4aa5da',
  snow: '#f4fbff',
  snowDeep: '#d5e9f6',
  brick: '#e4735a',
  brickDeep: '#c9563f',
  sand: '#ecd9b4',
  sandDeep: '#d9bd8f',
} as const

/* ============================================================
   四、场景外壳：id 上下文 + <Frame> + def()
   ============================================================ */

/** 当前场景的 id 前缀。同一页渲染多张图时，defs 里的 id 才不会撞车 */
const KeyCtx = createContext('scene')

/** 生成一个属于当前场景的唯一 id */
function useUid(name: string): string {
  return `${useContext(KeyCtx)}-${name}`
}

/** 所有场景共用的外层 <svg>：固定比例、自适应宽度、可访问标题 */
function Frame({
  sceneKey,
  label,
  className,
  children,
}: {
  sceneKey: string
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <svg
      viewBox="0 0 400 300"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      className={className}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{label}</title>
      <KeyCtx.Provider value={sceneKey}>{children}</KeyCtx.Provider>
    </svg>
  )
}

/** 快速定义一个场景组件，省去 65 次重复的 <Frame> 样板 */
function def(
  sceneKey: string,
  label: string,
  art: () => React.ReactNode,
): React.FC<SceneProps> {
  const Scene: React.FC<SceneProps> = ({ className }) => (
    <Frame sceneKey={sceneKey} label={label} className={className}>
      {art()}
    </Frame>
  )
  return Scene
}

/* ============================================================
   五、基础图元
   ============================================================ */

/* ---------------- 天空 / 地面 ---------------- */

type SkyTone = 'day' | 'dawn' | 'dusk' | 'night' | 'rain' | 'fog'

const SKY_TONES: Record<SkyTone, [string, string]> = {
  day: ['#a9dcff', '#effaff'],
  dawn: ['#ffcd96', '#fff2e0'],
  dusk: ['#ffab74', '#ffe7ca'],
  night: ['#2b3a6b', '#5d70ab'],
  rain: ['#a4b9c9', '#e7eff4'],
  fog: ['#d8e2e8', '#f7fafb'],
}

/** 天空：一层纵向渐变铺满整幅 */
function Sky({ tone = 'day' }: { tone?: SkyTone }) {
  const id = useUid('sky')
  const [top, bot] = SKY_TONES[tone]
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bot} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="400" height="300" fill={`url(#${id})`} />
    </g>
  )
}

/** 室内墙 + 地板：窗景 / 厨房 / 教室这类场景的底子 */
function RoomWall({
  wall = '#fdf2df',
  floor = '#e7d3b4',
  floorY = 218,
  wainscot = '#f4e3c8',
}: {
  wall?: string
  floor?: string
  floorY?: number
  wainscot?: string
}) {
  return (
    <g>
      <rect x="0" y="0" width="400" height={floorY} fill={wall} />
      <rect x="0" y={floorY - 26} width="400" height="26" fill={wainscot} />
      <rect x="0" y={floorY} width="400" height={300 - floorY} fill={floor} />
      <line x1="0" y1={floorY} x2="400" y2={floorY} stroke="#d3bb96" strokeWidth="2" />
    </g>
  )
}

/** 地面：一条起伏的草坡，从 y 铺到底。同一场景画多层地面时用 name 区分 id */
function Ground({
  y = 208,
  color = C.grass,
  deep = C.grassDeep,
  wave = 22,
  name = 'ground',
}: {
  y?: number
  color?: string
  deep?: string
  wave?: number
  name?: string
}) {
  const id = useUid(name)
  const d =
    `M0,${y} C 70,${y - wave} 140,${y + wave * 0.4} 210,${y}` +
    ` C 280,${y - wave * 0.4} 330,${y - wave * 0.7} 400,${y} L400,300 L0,300 Z`
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} />
          <stop offset="1" stopColor={deep} />
        </linearGradient>
      </defs>
      <path d={d} fill={`url(#${id})`} />
    </g>
  )
}

/** 雪地：比草地更亮、更平 */
function SnowGround({ y = 210, color = C.snow, deep = C.snowDeep }: { y?: number; color?: string; deep?: string }) {
  const id = useUid('snowground')
  const d = `M0,${y} C 80,${y - 14} 150,${y + 8} 220,${y} C 300,${y - 8} 340,${y - 12} 400,${y} L400,300 L0,300 Z`
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} />
          <stop offset="1" stopColor={deep} />
        </linearGradient>
      </defs>
      <path d={d} fill={`url(#${id})`} />
    </g>
  )
}

/** 远山 / 中景圆丘 */
function Hill({
  x,
  y,
  rx = 130,
  ry = 62,
  color = '#c2e8a9',
  opacity = 0.95,
}: {
  x: number
  y: number
  rx?: number
  ry?: number
  color?: string
  opacity?: number
}) {
  return <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={color} opacity={opacity} />
}

/** 尖顶山：可带雪帽，远景用 */
function Mountain({
  x,
  base = 208,
  w = 130,
  h = 118,
  color = '#a3bad8',
  shade = '#8aa3c4',
  snow = true,
}: {
  x: number
  base?: number
  w?: number
  h?: number
  color?: string
  shade?: string
  snow?: boolean
}) {
  const peak = `${x},${base - h}`
  return (
    <g>
      <path d={`M${x - w / 2},${base} L${peak} L${x + w / 2},${base} Z`} fill={color} />
      <path d={`M${x},${base - h} L${x + w / 2},${base} L${x + w * 0.06},${base} Z`} fill={shade} />
      {snow && (
        <path
          d={
            `M${x},${base - h} L${x + w * 0.17},${base - h * 0.7}` +
            ` L${x + w * 0.07},${base - h * 0.75} L${x},${base - h * 0.66}` +
            ` L${x - w * 0.07},${base - h * 0.75} L${x - w * 0.17},${base - h * 0.7} Z`
          }
          fill="#f6fcff"
        />
      )}
    </g>
  )
}

/** 水面：横向渐变 + 几道波光 */
function Water({ y = 196, color = C.water, deep = C.waterDeep }: { y?: number; color?: string; deep?: string }) {
  const id = useUid('water')
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} />
          <stop offset="1" stopColor={deep} />
        </linearGradient>
      </defs>
      <rect x="0" y={y} width="400" height={300 - y} fill={`url(#${id})`} />
      {seeds(211, 14).map((s, i) => (
        <line
          key={i}
          x1={rnd(s, 10, 330)}
          y1={rnd(s + 7, y + 8, 292)}
          x2={rnd(s + 7, 10, 330) + rnd(s + 19, 14, 34)}
          y2={rnd(s + 7, y + 8, 292)}
          stroke="#ffffff"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.45"
        />
      ))}
    </g>
  )
}

/** 小路 / 田埂：上窄下宽，制造纵深 */
function Path({
  x = 200,
  top = 206,
  w = 34,
  w2 = 130,
  color = C.sand,
  edge = C.sandDeep,
}: {
  x?: number
  top?: number
  w?: number
  w2?: number
  color?: string
  edge?: string
}) {
  return (
    <path
      d={`M${x - w / 2},${top} L${x + w / 2},${top} L${x + w2 / 2},300 L${x - w2 / 2},300 Z`}
      fill={color}
      stroke={edge}
      strokeWidth="2"
    />
  )
}

/* ---------------- 天上 / 空中的东西 ---------------- */

/** 太阳：光晕 + 本体 + 八根短光芒 */
function Sun({ x = 322, y = 62, r = 28, glow = true }: { x?: number; y?: number; r?: number; glow?: boolean }) {
  const id = useUid('sun')
  return (
    <g>
      <defs>
        <radialGradient id={id}>
          <stop offset="0" stopColor="#fff6bd" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffd45e" stopOpacity="0" />
        </radialGradient>
      </defs>
      {glow && <circle cx={x} cy={y} r={r * 2.2} fill={`url(#${id})`} />}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4 + Math.PI / 8
        return (
          <line
            key={i}
            x1={x + Math.cos(a) * (r + 8)}
            y1={y + Math.sin(a) * (r + 8)}
            x2={x + Math.cos(a) * (r + 17)}
            y2={y + Math.sin(a) * (r + 17)}
            stroke="#f9c542"
            strokeWidth="4"
            strokeLinecap="round"
          />
        )
      })}
      <circle cx={x} cy={y} r={r} fill="#ffd45e" />
      <circle cx={x} cy={y} r={r} fill="none" stroke="#f7b32b" strokeWidth="3" />
      <circle cx={x - r * 0.3} cy={y - r * 0.28} r={r * 0.34} fill="#fff0a8" opacity="0.85" />
    </g>
  )
}

/** 月亮：遮罩抠出弯月，另加一圈柔光 */
function Moon({ x = 312, y = 58, r = 26, crescent = true }: { x?: number; y?: number; r?: number; crescent?: boolean }) {
  const id = useUid('moon')
  return (
    <g>
      <defs>
        <mask id={id}>
          <rect x="0" y="0" width="400" height="300" fill="black" />
          <circle cx={x} cy={y} r={r} fill="white" />
          {crescent && <circle cx={x + r * 0.58} cy={y - r * 0.24} r={r * 0.92} fill="black" />}
        </mask>
      </defs>
      <circle cx={x} cy={y} r={r * 1.85} fill="#fff2b0" opacity="0.2" />
      <circle cx={x} cy={y} r={r} fill="#fff5c6" mask={`url(#${id})`} />
      <circle cx={x - r * 0.22} cy={y + r * 0.18} r={r * 0.16} fill="#f0dfa0" mask={`url(#${id})`} opacity="0.8" />
      <circle cx={x + r * 0.1} cy={y - r * 0.35} r={r * 0.1} fill="#f0dfa0" mask={`url(#${id})`} opacity="0.8" />
    </g>
  )
}

/** 云：三团椭圆叠出来的胖云，可缩放、可调透明度 */
function Cloud({
  x,
  y,
  scale = 1,
  opacity = 0.95,
  fill = '#ffffff',
}: {
  x: number
  y: number
  scale?: number
  opacity?: number
  fill?: string
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
      <ellipse cx="0" cy="2" rx="34" ry="19" fill={fill} />
      <circle cx="-21" cy="4" r="14" fill={fill} />
      <circle cx="19" cy="6" r="16" fill={fill} />
      <circle cx="-2" cy="-14" r="18" fill={fill} />
    </g>
  )
}

/** 五角星 */
function Star({
  x,
  y,
  r = 6,
  color = '#fff0a8',
  opacity = 1,
  rotate = 0,
}: {
  x: number
  y: number
  r?: number
  color?: string
  opacity?: number
  rotate?: number
}) {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.44
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    pts.push(`${(Math.cos(a) * rr).toFixed(2)},${(Math.sin(a) * rr).toFixed(2)}`)
  }
  return (
    <path
      d={`M${pts.join('L')}Z`}
      fill={color}
      opacity={opacity}
      transform={`translate(${x} ${y}) rotate(${rotate})`}
    />
  )
}

/** 四角闪光：用来点「亮晶晶」的地方 */
function Sparkle({ x, y, r = 8, color = '#ffffff', opacity = 0.9 }: { x: number; y: number; r?: number; color?: string; opacity?: number }) {
  const k = r * 0.2
  return (
    <path
      d={`M0,${-r} Q${k},${-k} ${r},0 Q${k},${k} 0,${r} Q${-k},${k} ${-r},0 Q${-k},${-k} 0,${-r} Z`}
      fill={color}
      opacity={opacity}
      transform={`translate(${x} ${y})`}
    />
  )
}

/** 彩虹：六条同心圆弧，架在天地之间 */
function Rainbow({ x = 200, y = 232, r = 128, opacity = 0.8 }: { x?: number; y?: number; r?: number; opacity?: number }) {
  const bands = ['#ff7d7d', '#ffab5c', '#ffe066', '#84dd8b', '#6cc6ff', '#9b8cf0']
  const step = 8
  return (
    <g opacity={opacity} fill="none" strokeWidth={step + 1} strokeLinecap="round">
      {bands.map((c, i) => {
        const rr = r - i * step
        return (
          <path
            key={i}
            d={`M${x - rr},${y} A ${rr},${rr} 0 0 1 ${x + rr},${y}`}
            stroke={c}
          />
        )
      })}
    </g>
  )
}

/** 雨丝 */
function Rain({ count = 46, seed = 91, color = '#8fbcd8', opacity = 0.75 }: { count?: number; seed?: number; color?: string; opacity?: number }) {
  return (
    <g opacity={opacity} stroke={color} strokeWidth="2" strokeLinecap="round">
      {seeds(seed, count).map((s, i) => {
        const x = rnd(s, -10, 410)
        const y = rnd(s + 13, -10, 290)
        return <line key={i} x1={x} y1={y} x2={x - 5} y2={y + rnd(s + 29, 9, 17)} />
      })}
    </g>
  )
}

/** 雪花 */
function Snow({ count = 54, seed = 137, color = '#ffffff', opacity = 0.92 }: { count?: number; seed?: number; color?: string; opacity?: number }) {
  return (
    <g opacity={opacity} fill={color}>
      {seeds(seed, count).map((s, i) => (
        <circle key={i} cx={rnd(s, 0, 400)} cy={rnd(s + 5, 0, 296)} r={rnd(s + 11, 1.4, 3.4)} />
      ))}
    </g>
  )
}

/** 雾带：几条横向的半透明白条 */
function Fog({ bands = 5, opacity = 0.62, seed = 43 }: { bands?: number; opacity?: number; seed?: number }) {
  return (
    <g opacity={opacity}>
      {seeds(seed, bands).map((s, i) => (
        <ellipse
          key={i}
          cx={rnd(s, 40, 360)}
          cy={rnd(s + 3, 40, 270)}
          rx={rnd(s + 9, 90, 170)}
          ry={rnd(s + 17, 12, 22)}
          fill="#ffffff"
        />
      ))}
    </g>
  )
}

/** 风：几道旋涡状的弧线 */
function Wind({ x, y, scale = 1, color = '#ffffff', opacity = 0.72, flip = false }: { x: number; y: number; scale?: number; color?: string; opacity?: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`} opacity={opacity} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round">
      <path d="M-40,-16 q22,-14 44,-2 q16,9 30,-2" />
      <path d="M-30,4 q26,-12 50,0 q14,7 24,0" />
      <path d="M-22,22 q20,-9 38,0" />
    </g>
  )
}

/** 萤火虫：三层同心圆做出光晕，避免额外的渐变 id */
function Firefly({ x, y, r = 3 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r * 4} fill="#eaff9b" opacity="0.12" />
      <circle cx={x} cy={y} r={r * 2.2} fill="#f2ff9e" opacity="0.26" />
      <circle cx={x} cy={y} r={r} fill="#ffffcf" />
    </g>
  )
}

/** 飘落的叶子（秋天） */
function FallingLeaves({ count = 16, seed = 71, colors = ['#f0a340', '#e0733a', '#d94f3d', '#f4c95d'] }: { count?: number; seed?: number; colors?: string[] }) {
  return (
    <g>
      {seeds(seed, count).map((s, i) => (
        <ellipse
          key={i}
          cx={rnd(s, 0, 400)}
          cy={rnd(s + 4, 20, 280)}
          rx={rnd(s + 8, 3.5, 6.5)}
          ry={rnd(s + 12, 2, 3.6)}
          fill={colors[i % colors.length]}
          opacity={rnd(s + 21, 0.7, 1)}
          transform={`rotate(${rnd(s + 31, -60, 60)} ${rnd(s, 0, 400)} ${rnd(s + 4, 20, 280)})`}
        />
      ))}
    </g>
  )
}

/** 花瓣雨（春天） */
function Petals({ count = 22, seed = 33 }: { count?: number; seed?: number }) {
  return (
    <g fill={C.blossom} opacity="0.9">
      {seeds(seed, count).map((s, i) => (
        <ellipse key={i} cx={rnd(s, 0, 400)} cy={rnd(s + 6, 10, 280)} rx={rnd(s + 9, 3, 5)} ry={rnd(s + 14, 2, 3)} />
      ))}
    </g>
  )
}

/* ---------------- 植物 / 自然 ---------------- */

type TreeKind = 'round' | 'pine' | 'bare' | 'blossom' | 'golden'

/** 树：(x,y) 是树根，往上长；五种树形覆盖四季 */
function Tree({
  x,
  y,
  scale = 1,
  kind = 'round',
  sway = 0,
}: {
  x: number
  y: number
  scale?: number
  kind?: TreeKind
  sway?: number
}) {
  const canopy: Record<TreeKind, React.ReactNode> = {
    round: (
      <>
        <circle cx={-14} cy={-58} r={20} fill={C.leafDeep} />
        <circle cx={15} cy={-56} r={21} fill={C.leaf} />
        <circle cx={0} cy={-74} r={23} fill={C.leafLight} />
        <circle cx={-4} cy={-58} r={17} fill={C.leaf} />
      </>
    ),
    golden: (
      <>
        <circle cx={-14} cy={-58} r={20} fill={C.autumnDeep} />
        <circle cx={15} cy={-56} r={21} fill={C.autumn} />
        <circle cx={0} cy={-74} r={23} fill="#f6c862" />
        <circle cx={-4} cy={-58} r={17} fill={C.autumn} />
      </>
    ),
    blossom: (
      <>
        <circle cx={-14} cy={-58} r={20} fill={C.blossomDeep} />
        <circle cx={15} cy={-56} r={21} fill={C.blossom} />
        <circle cx={0} cy={-74} r={23} fill="#ffd3e2" />
        {seeds(503, 10).map((s, i) => (
          <circle key={i} cx={rnd(s, -26, 26)} cy={rnd(s + 3, -92, -44)} r={rnd(s + 7, 1.6, 3)} fill="#fff1f6" />
        ))}
      </>
    ),
    pine: (
      <>
        <path d="M0,-92 L22,-52 L-22,-52 Z" fill={C.pine} />
        <path d="M0,-74 L28,-30 L-28,-30 Z" fill={C.pineDeep} />
        <path d="M0,-54 L34,-8 L-34,-8 Z" fill={C.pine} />
      </>
    ),
    bare: (
      <g stroke={C.barkDeep} strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M0,-46 L-16,-70" />
        <path d="M0,-46 L18,-68" />
        <path d="M0,-40 L-24,-52" />
        <path d="M0,-40 L24,-50" />
        <path d="M0,-52 L0,-84" />
      </g>
    ),
  }
  return (
    <g transform={`translate(${x} ${y}) scale(${scale}) rotate(${sway})`}>
      <path d="M-6,0 L-4,-56 L4,-56 L6,0 Z" fill={C.bark} />
      <path d="M0,0 L0,-56 L4,-56 L6,0 Z" fill={C.barkDeep} />
      {canopy[kind]}
    </g>
  )
}

/** 灌木丛 */
function Bush({ x, y, scale = 1, color = C.leaf, dark = C.leafDeep }: { x: number; y: number; scale?: number; color?: string; dark?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx={-14} cy={-8} rx={17} ry={13} fill={dark} />
      <ellipse cx={14} cy={-8} rx={17} ry={13} fill={dark} />
      <ellipse cx={0} cy={-16} rx={20} ry={16} fill={color} />
    </g>
  )
}

/** 草丛：几片叶子，用来铺近景 */
function GrassTuft({ x, y, scale = 1, color = C.grassDark }: { x: number; y: number; scale?: number; color?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} stroke={color} strokeWidth="3" strokeLinecap="round" fill="none">
      <path d="M0,0 q-2,-12 -8,-17" />
      <path d="M0,0 q0,-14 0,-20" />
      <path d="M0,0 q4,-12 9,-16" />
    </g>
  )
}

/** 花：茎 + 两片叶 + 五瓣花 */
function Flower({ x, y, scale = 1, petal = '#ff8fb1', core = '#ffd45e', h = 26 }: { x: number; y: number; scale?: number; petal?: string; core?: string; h?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d={`M0,0 L0,${-h}`} stroke={C.grassDark} strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx={-6} cy={-h * 0.5} rx={6} ry={3.4} fill={C.leaf} transform={`rotate(-28 -6 ${-h * 0.5})`} />
      <ellipse cx={6} cy={-h * 0.7} rx={6} ry={3.4} fill={C.leafLight} transform={`rotate(28 6 ${-h * 0.7})`} />
      <g transform={`translate(0 ${-h})`}>
        {Array.from({ length: 5 }, (_, i) => {
          const a = (i * 2 * Math.PI) / 5 - Math.PI / 2
          return <circle key={i} cx={Math.cos(a) * 5.4} cy={Math.sin(a) * 5.4} r={4.4} fill={petal} />
        })}
        <circle cx="0" cy="0" r="3.6" fill={core} />
      </g>
    </g>
  )
}

/** 石头 */
function Rock({ x, y, scale = 1, color = '#c3c9cf', dark = '#a7aeb6' }: { x: number; y: number; scale?: number; color?: string; dark?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M-18,0 q-4,-16 8,-19 q14,-4 20,7 q5,8 2,12 z" fill={color} />
      <path d="M-18,0 q-4,-16 8,-19 q4,5 -1,19 z" fill={dark} />
    </g>
  )
}

/** 蒲公英：一朵黄绒球 + 一朵已散开的种子球 */
function Dandelion({ x, y, scale = 1, seed = 61 }: { x: number; y: number; scale?: number; seed?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M0,0 q-3,-22 -1,-40" stroke={C.grassDark} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <ellipse cx={-9} cy={-14} rx={9} ry={4} fill={C.leaf} transform="rotate(-30 -9 -14)" />
      <ellipse cx={8} cy={-24} rx={9} ry={4} fill={C.leafLight} transform="rotate(30 8 -24)" />
      <circle cx="-1" cy="-44" r="11" fill="#fff8dc" />
      <circle cx="-1" cy="-44" r="8" fill="#ffe9a0" opacity="0.7" />
      {seeds(seed, 9).map((s, i) => (
        <line
          key={i}
          x1={-1}
          y1={-44}
          x2={rnd(s, -40, 46)}
          y2={rnd(s + 5, -74, -18)}
          stroke="#ffffff"
          strokeWidth="1.4"
          opacity="0.85"
        />
      ))}
      <circle cx="38" cy="-58" r="9" fill="#ffffff" opacity="0.9" />
      <circle cx="56" cy="-72" r="6" fill="#ffffff" opacity="0.75" />
    </g>
  )
}

/** 盆栽绿萝：花盆 + 垂下来的心形叶 */
function Plant({ x, y, scale = 1, pot = '#e0915f', potDark = '#c4763f', leaf = '#4fae5a', leafDark = '#3a8c48' }: { x: number; y: number; scale?: number; pot?: string; potDark?: string; leaf?: string; leafDark?: string }) {
  const heart = (cx: number, cy: number, r: number, fill: string, rot = 0) => (
    <path
      d={`M${cx},${cy + r * 0.8} C${cx - r * 1.5},${cy - r * 0.3} ${cx - r * 0.5},${cy - r * 1.3} ${cx},${cy - r * 0.5}` +
        ` C${cx + r * 0.5},${cy - r * 1.3} ${cx + r * 1.5},${cy - r * 0.3} ${cx},${cy + r * 0.8} Z`}
      fill={fill}
      transform={`rotate(${rot} ${cx} ${cy})`}
    />
  )
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M0,-18 q-6,-24 8,-34" stroke={leafDark} strokeWidth="2.4" fill="none" />
      <path d="M0,-18 q10,-20 -6,-38" stroke={leafDark} strokeWidth="2.4" fill="none" />
      <path d="M0,-18 q-22,4 -30,20" stroke={leafDark} strokeWidth="2.4" fill="none" />
      <path d="M0,-18 q22,2 28,18" stroke={leafDark} strokeWidth="2.4" fill="none" />
      {heart(10, -56, 8, leaf)}
      {heart(-8, -60, 7.5, leafDark)}
      {heart(2, -70, 7, leaf)}
      {heart(-32, 2, 8, leaf, -20)}
      {heart(30, 0, 7.5, leafDark, 20)}
      {heart(-24, 16, 6.5, leaf)}
      <path d="M-16,-18 L16,-18 L12,0 L-12,0 Z" fill={pot} />
      <path d="M-16,-18 L16,-18 L14.5,-9 L-14.5,-9 Z" fill={potDark} />
      <rect x="-19" y="-24" width="38" height="8" rx="3" fill={potDark} />
    </g>
  )
}

/* ---------------- 建筑 / 大件 ---------------- */

/** 小房子：墙 + 屋顶 + 门 + 窗 + 烟囱 */
function House({
  x,
  y,
  scale = 1,
  wall = '#fff3dd',
  roof = C.brick,
  roofDark = C.brickDeep,
  door = '#b9773f',
}: {
  x: number
  y: number
  scale?: number
  wall?: string
  roof?: string
  roofDark?: string
  door?: string
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x="30" y="-86" width="10" height="26" fill={roofDark} />
      <rect x="-34" y="-54" width="68" height="54" rx="3" fill={wall} />
      <rect x="-34" y="-54" width="68" height="54" rx="3" fill="none" stroke="#e2cba4" strokeWidth="2" />
      <path d="M-44,-52 L0,-88 L44,-52 Z" fill={roof} />
      <path d="M0,-88 L44,-52 L30,-52 L0,-80 Z" fill={roofDark} />
      <rect x="-11" y="-26" width="22" height="26" rx="3" fill={door} />
      <circle cx="6" cy="-13" r="2" fill="#ffe08a" />
      <rect x="10" y="-46" width="17" height="15" rx="3" fill="#cfeaff" stroke="#e2cba4" strokeWidth="2" />
      <line x1="18.5" y1="-46" x2="18.5" y2="-31" stroke="#e2cba4" strokeWidth="2" />
      <line x1="10" y1="-38.5" x2="27" y2="-38.5" stroke="#e2cba4" strokeWidth="2" />
    </g>
  )
}

/** 栅栏 */
function Fence({ x, y, w = 130, h = 34, color = '#ecd9b4', dark = '#d5bd91' }: { x: number; y: number; w?: number; h?: number; color?: string; dark?: string }) {
  const n = Math.max(3, Math.round(w / 22))
  return (
    <g transform={`translate(${x} ${y})`}>
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={(i * w) / (n - 1) - 3} y={-h} width="6" height={h} rx="2" fill={color} stroke={dark} strokeWidth="1.4" />
      ))}
      <rect x="-4" y={-h + 6} width={w + 8} height="6" rx="3" fill={color} stroke={dark} strokeWidth="1.4" />
      <rect x="-4" y={-h * 0.45} width={w + 8} height="6" rx="3" fill={color} stroke={dark} strokeWidth="1.4" />
    </g>
  )
}

/** 圆角面板 / 相框：相册、照片、卡片都用它 */
function Panel({
  x,
  y,
  w,
  h,
  r = 12,
  fill = '#ffffff',
  stroke = '#e2d3b8',
  sw = 3,
  opacity = 1,
  rotate = 0,
}: {
  x: number
  y: number
  w: number
  h: number
  r?: number
  fill?: string
  stroke?: string
  sw?: number
  opacity?: number
  rotate?: number
}) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={r}
      ry={r}
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      opacity={opacity}
      transform={rotate ? `rotate(${rotate} ${x + w / 2} ${y + h / 2})` : undefined}
    />
  )
}

/** 书桌：桌面 + 两侧桌腿，正视视角 */
function Desk({ x, y, w = 120, h = 44, color = C.wood, dark = C.woodDark }: { x: number; y: number; w?: number; h?: number; color?: string; dark?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y={-h} width={w} height="9" rx="4" fill={color} />
      <rect x={-w / 2} y={-h} width={w} height="4" rx="2" fill="#e5bb8c" />
      <rect x={-w / 2 + 8} y={-h + 9} width="8" height={h - 9} fill={dark} />
      <rect x={w / 2 - 16} y={-h + 9} width="8" height={h - 9} fill={dark} />
    </g>
  )
}

/** 黑板：木框 + 绿板 + 粉笔槽，只画抽象笔迹不写字 */
function Board({ x, y, w = 210, h = 96, color = '#3f6b52', frame = '#c78d55' }: { x: number; y: number; w?: number; h?: number; color?: string; frame?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="6" fill={frame} />
      <rect x={-w / 2 + 7} y={-h / 2 + 7} width={w - 14} height={h - 14} rx="3" fill={color} />
      <g stroke="#eaf4ec" strokeWidth="2.6" strokeLinecap="round" fill="none" opacity="0.85">
        <path d={`M${-w / 2 + 24},${-h / 2 + 30} h ${w * 0.42}`} />
        <path d={`M${-w / 2 + 24},${-h / 2 + 46} h ${w * 0.3}`} />
        <path d={`M${-w / 2 + 24},${-h / 2 + 62} h ${w * 0.36}`} />
        <circle cx={w / 2 - 34} cy={-h / 2 + 44} r="14" />
      </g>
      <rect x={-w / 2 - 6} y={h / 2} width={w + 12} height="8" rx="3" fill={frame} />
    </g>
  )
}

/** 窗框（画在墙洞之上）：外框 + 十字窗棂 */
function WindowPane({ x, y, w, h, frame = '#e0b27e', cols = 2, rows = 2, sw = 7 }: { x: number; y: number; w: number; h: number; frame?: string; cols?: number; rows?: number; sw?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="6" fill="none" stroke={frame} strokeWidth={sw} />
      {Array.from({ length: cols - 1 }, (_, i) => (
        <line key={`c${i}`} x1={x + (w * (i + 1)) / cols} y1={y} x2={x + (w * (i + 1)) / cols} y2={y + h} stroke={frame} strokeWidth={sw - 2} />
      ))}
      {Array.from({ length: rows - 1 }, (_, i) => (
        <line key={`r${i}`} x1={x} y1={y + (h * (i + 1)) / rows} x2={x + w} y2={y + (h * (i + 1)) / rows} stroke={frame} strokeWidth={sw - 2} />
      ))}
      <rect x={x - 8} y={y + h} width={w + 16} height="10" rx="4" fill={frame} />
    </g>
  )
}

/** 墙上开洞：把墙铺成「回」字形，洞里的天空就能露出来（不用 clipPath） */
function WallFrame({ x, y, w, h, wall = '#fdf2df', sill = '#e8cfa6' }: { x: number; y: number; w: number; h: number; wall?: string; sill?: string }) {
  return (
    <g>
      <rect x="0" y="0" width="400" height={y} fill={wall} />
      <rect x="0" y={y + h} width="400" height={300 - y - h} fill={wall} />
      <rect x="0" y={y} width={x} height={h} fill={wall} />
      <rect x={x + w} y={y} width={400 - x - w} height={h} fill={wall} />
      <rect x={x - 10} y={y + h} width={w + 20} height="11" rx="4" fill={sill} />
    </g>
  )
}

/** 镜子：椭圆镜框 + 玻璃高光（人物由场景自己画进去） */
function Mirror({ x, y, w = 96, h = 120, frame = '#f0c25f', glass = '#dff1fb' }: { x: number; y: number; w?: number; h?: number; frame?: string; glass?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="0" rx={w / 2 + 8} ry={h / 2 + 8} fill={frame} />
      <ellipse cx="0" cy="0" rx={w / 2} ry={h / 2} fill={glass} />
      <path d={`M${-w * 0.3},${-h * 0.3} L${w * 0.05},${-h * 0.42} L${-w * 0.02},${h * 0.3} L${-w * 0.3},${h * 0.34} Z`} fill="#ffffff" opacity="0.55" />
      <path d={`M${w * 0.14},${-h * 0.38} L${w * 0.24},${-h * 0.34} L${w * 0.16},${h * 0.28} L${w * 0.07},${h * 0.24} Z`} fill="#ffffff" opacity="0.4" />
    </g>
  )
}

/** 舞台幕布：两侧垂幔 + 顶部横幔 */
function Curtains({ color = '#cf4d63', dark = '#a83a4e' }: { color?: string; dark?: string }) {
  return (
    <g>
      <path d="M0,0 h400 v34 q-100,14 -200,4 q-100,-10 -200,4 Z" fill={color} />
      <path d="M0,0 h400 v20 q-100,12 -200,4 q-100,-8 -200,4 Z" fill={dark} />
      <path d="M0,30 q44,10 62,44 q-6,120 -4,226 L0,300 Z" fill={color} />
      <path d="M0,30 q30,14 40,60 q-4,110 -2,210 L0,300 Z" fill={dark} opacity="0.55" />
      <path d="M400,30 q-44,10 -62,44 q6,120 4,226 L400,300 Z" fill={color} />
      <path d="M400,30 q-30,14 -40,60 q4,110 2,210 L400,300 Z" fill={dark} opacity="0.55" />
    </g>
  )
}

/** 聚光灯光柱 */
function Spotlight({ x = 200, top = 34, w = 60, w2 = 190, h = 250, color = '#fff3b0', opacity = 0.4 }: { x?: number; top?: number; w?: number; w2?: number; h?: number; color?: string; opacity?: number }) {
  return <path d={`M${x - w / 2},${top} L${x + w / 2},${top} L${x + w2 / 2},${top + h} L${x - w2 / 2},${top + h} Z`} fill={color} opacity={opacity} />
}

/** 公交车（春游大巴） */
function Bus({ x, y, scale = 1, color = '#ffd45e', dark = '#e8b93a' }: { x: number; y: number; scale?: number; color?: string; dark?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x="-110" y="-72" width="220" height="72" rx="16" fill={color} />
      <rect x="-110" y="-72" width="220" height="20" rx="10" fill={dark} />
      {Array.from({ length: 4 }, (_, i) => (
        <rect key={i} x={-92 + i * 46} y={-46} width="34" height="26" rx="6" fill="#d6efff" stroke="#e8b93a" strokeWidth="2" />
      ))}
      <rect x="-96" y="-14" width="34" height="14" rx="4" fill="#cfeaff" />
      <circle cx="-62" cy="4" r="17" fill="#4a453d" />
      <circle cx="-62" cy="4" r="7" fill="#c9c2b4" />
      <circle cx="62" cy="4" r="17" fill="#4a453d" />
      <circle cx="62" cy="4" r="7" fill="#c9c2b4" />
    </g>
  )
}

/** 自行车 */
function Bike({ x, y, scale = 1, color = '#ff7f7f', dark = '#3f3a36' }: { x: number; y: number; scale?: number; color?: string; dark?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <circle cx="-30" cy="-12" r="16" fill="none" stroke={dark} strokeWidth="4" />
      <circle cx="32" cy="-12" r="16" fill="none" stroke={dark} strokeWidth="4" />
      <path d="M-30,-12 L-6,-38 L24,-38 L32,-12" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M-6,-38 L6,-12 L-30,-12" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24,-38 L18,-52" stroke={dark} strokeWidth="4" strokeLinecap="round" />
      <path d="M10,-52 h16" stroke={dark} strokeWidth="4" strokeLinecap="round" />
      <path d="M-14,-46 h16" stroke={dark} strokeWidth="4" strokeLinecap="round" />
    </g>
  )
}

/** 婴儿床 */
function Crib({ x, y, scale = 1, color = '#f6d9b0', dark = '#d8b485' }: { x: number; y: number; scale?: number; color?: string; dark?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x="-70" y="-56" width="140" height="10" rx="4" fill={dark} />
      <rect x="-70" y="-16" width="140" height="10" rx="4" fill={dark} />
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={i} x={-62 + i * 20} y={-52} width="6" height="40" rx="3" fill={color} />
      ))}
      <rect x="-74" y="-62" width="12" height="62" rx="5" fill={dark} />
      <rect x="62" y="-62" width="12" height="62" rx="5" fill={dark} />
      <path d="M-70,-16 q70,20 140,0" fill="none" stroke={dark} strokeWidth="3" />
    </g>
  )
}

/** 野餐篮 */
function Basket({ x, y, scale = 1, color = '#e8c27a', dark = '#c69b52' }: { x: number; y: number; scale?: number; color?: string; dark?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M-30,-26 q30,-24 60,0" fill="none" stroke={dark} strokeWidth="4" />
      <rect x="-32" y="-26" width="64" height="26" rx="6" fill={color} />
      <rect x="-32" y="-18" width="64" height="4" fill={dark} opacity="0.6" />
      <rect x="-32" y="-10" width="64" height="4" fill={dark} opacity="0.6" />
      <rect x="-34" y="-30" width="68" height="8" rx="4" fill={dark} />
    </g>
  )
}

/** 花瓶 */
function Vase({ x, y, scale = 1, color = '#8fd0f0', dark = '#5eb0da' }: { x: number; y: number; scale?: number; color?: string; dark?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M-13,-46 q6,10 6,20 q0,16 -10,26 q16,6 34,0 q-10,-10 -10,-26 q0,-10 6,-20 Z" fill={color} />
      <path d="M-13,-46 q6,10 6,20 q0,16 -10,26 q8,3 17,3 L0,-46 Z" fill={dark} opacity="0.55" />
      <rect x="-16" y="-52" width="32" height="8" rx="3" fill={dark} />
    </g>
  )
}

/** 旧玩具熊 */
function Teddy({ x, y, scale = 1, color = '#d9a86c', dark = '#b98a51', patch = false }: { x: number; y: number; scale?: number; color?: string; dark?: string; patch?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <circle cx="-22" cy="-58" r="9" fill={dark} />
      <circle cx="22" cy="-58" r="9" fill={dark} />
      <ellipse cx="-20" cy="-14" rx="12" ry="14" fill={dark} />
      <ellipse cx="20" cy="-14" rx="12" ry="14" fill={dark} />
      <ellipse cx="0" cy="-16" rx="24" ry="22" fill={color} />
      <ellipse cx="0" cy="-22" rx="15" ry="14" fill="#f4dcbb" opacity="0.8" />
      <circle cx="0" cy="-56" r="22" fill={color} />
      <ellipse cx="0" cy="-48" rx="12" ry="9" fill="#f4dcbb" />
      <circle cx="-8" cy="-60" r="2.6" fill={C.ink} />
      <circle cx="8" cy="-60" r="2.6" fill={C.ink} />
      <ellipse cx="0" cy="-52" rx="4" ry="3" fill="#8d5a33" />
      <path d="M-6,-46 q6,5 12,0" stroke={C.ink} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      {patch && <rect x="-24" y="-24" width="14" height="12" rx="3" fill="#a8d8f0" stroke="#7fbcd8" strokeWidth="2" transform="rotate(-14 -17 -18)" />}
    </g>
  )
}

/** 铅笔（可带表情，用于「会说话的文具」） */
function Pencil({ x, y, scale = 1, rotate = 0, color = '#f2b134', dark = '#d4941f', face = false }: { x: number; y: number; scale?: number; rotate?: number; color?: string; dark?: string; face?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale}) rotate(${rotate})`}>
      <rect x="-7" y="-34" width="14" height="52" rx="3" fill={color} />
      <rect x="-7" y="-34" width="5" height="52" fill={dark} opacity="0.55" />
      <path d="M-7,18 L0,32 L7,18 Z" fill="#f4e0bd" />
      <path d="M-2.6,25 L0,32 L2.6,25 Z" fill={C.ink} />
      <rect x="-7" y="-42" width="14" height="9" rx="3" fill="#f28ba0" />
      <rect x="-7" y="-35" width="14" height="4" fill="#d9d2c4" />
      {face && (
        <g>
          <circle cx="-2.6" cy="-14" r="1.7" fill={C.ink} />
          <circle cx="2.6" cy="-14" r="1.7" fill={C.ink} />
          <path d="M-3,-9 q3,3 6,0" stroke={C.ink} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </g>
      )}
    </g>
  )
}

/** 橡皮（可带表情） */
function Eraser({ x, y, scale = 1, rotate = 0, color = '#ff9fb0', dark = '#e07a8f', face = true }: { x: number; y: number; scale?: number; rotate?: number; color?: string; dark?: string; face?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale}) rotate(${rotate})`}>
      <rect x="-20" y="-13" width="40" height="26" rx="7" fill={color} />
      <rect x="-20" y="-13" width="40" height="10" rx="6" fill={dark} opacity="0.5" />
      {face && (
        <g>
          <circle cx="-7" cy="-1" r="2.4" fill={C.ink} />
          <circle cx="7" cy="-1" r="2.4" fill={C.ink} />
          <path d="M-5,5 q5,5 10,0" stroke={C.ink} strokeWidth="2" fill="none" strokeLinecap="round" />
          <ellipse cx="-13" cy="4" rx="3" ry="2" fill="#ff7d92" opacity="0.6" />
          <ellipse cx="13" cy="4" rx="3" ry="2" fill="#ff7d92" opacity="0.6" />
        </g>
      )}
    </g>
  )
}

/** 书包（可带表情） */
function Backpack({ x, y, scale = 1, color = '#6fb3ff', dark = '#4a90db', pocket = '#ffe08a', face = false }: { x: number; y: number; scale?: number; color?: string; dark?: string; pocket?: string; face?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M-20,-62 q20,-16 40,0" fill="none" stroke={dark} strokeWidth="6" strokeLinecap="round" />
      <rect x="-34" y="-64" width="68" height="64" rx="18" fill={color} />
      <rect x="-34" y="-64" width="68" height="22" rx="14" fill={dark} opacity="0.5" />
      <rect x="-22" y="-24" width="44" height="24" rx="9" fill={pocket} />
      <rect x="-22" y="-24" width="44" height="8" rx="4" fill={dark} opacity="0.35" />
      <rect x="-6" y="-70" width="12" height="10" rx="4" fill={dark} />
      {face && (
        <g>
          <circle cx="-10" cy="-42" r="3" fill={C.ink} />
          <circle cx="10" cy="-42" r="3" fill={C.ink} />
          <path d="M-7,-34 q7,7 14,0" stroke={C.ink} strokeWidth="2.2" fill="none" strokeLinecap="round" />
        </g>
      )}
    </g>
  )
}

/** 扫帚 */
function Broom({ x, y, scale = 1, rotate = 0, handle = '#c08c4f', hair = '#f0cf7a' }: { x: number; y: number; scale?: number; rotate?: number; handle?: string; hair?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale}) rotate(${rotate})`}>
      <rect x="-3" y="-70" width="6" height="62" rx="3" fill={handle} />
      <path d="M-16,0 L16,0 L10,-12 L-10,-12 Z" fill={hair} />
      <path d="M-16,0 L16,0 L14,-5 L-14,-5 Z" fill="#e0b45c" />
      <path d="M-14,0 L-10,-12 M0,0 L0,-12 M14,0 L10,-12" stroke="#e0b45c" strokeWidth="1.6" />
    </g>
  )
}

/** 碗（可冒热气） */
function Bowl({ x, y, scale = 1, color = '#ffffff', rim = '#7fc9ef', contents = '#f6c98b', steam = false }: { x: number; y: number; scale?: number; color?: string; rim?: string; contents?: string; steam?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {steam && <Steam x={0} y={-24} scale={0.9} />}
      <ellipse cx="0" cy="-14" rx="34" ry="9" fill={contents} />
      <path d="M-34,-14 q0,26 34,26 q34,0 34,-26 Z" fill={color} />
      <path d="M-34,-14 q0,26 34,26 q10,0 18,-3 q-16,-8 -16,-23 Z" fill="#e8eef2" opacity="0.5" />
      <ellipse cx="0" cy="-14" rx="34" ry="9" fill="none" stroke={rim} strokeWidth="3" />
    </g>
  )
}

/** 热气：三缕弯弯的白烟 */
function Steam({ x, y, scale = 1, opacity = 0.6 }: { x: number; y: number; scale?: number; opacity?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity} fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round">
      <path d="M-12,0 q-6,-12 0,-22 q6,-10 0,-20" />
      <path d="M0,4 q-6,-14 0,-24 q6,-10 0,-20" />
      <path d="M12,0 q-6,-12 0,-22 q6,-10 0,-20" />
    </g>
  )
}

/** 一只饺子 */
function Dumpling({ x, y, scale = 1, rotate = 0, color = '#fdf1d8', dark = '#e6d2ac' }: { x: number; y: number; scale?: number; rotate?: number; color?: string; dark?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale}) rotate(${rotate})`}>
      <path d="M-16,0 q2,-16 16,-16 q14,0 16,16 Z" fill={color} />
      <path d="M-16,0 q2,-16 16,-16 q14,0 16,16 Z" fill="none" stroke={dark} strokeWidth="2" />
      <path d="M-11,-4 q3,-6 6,0 M-3,-7 q3,-6 6,0 M5,-5 q3,-6 6,0" fill="none" stroke={dark} strokeWidth="2" strokeLinecap="round" />
    </g>
  )
}

/** 一本摊开的书 */
function Book({ x, y, scale = 1, cover = '#6fb3ff', pages = '#fffdf7' }: { x: number; y: number; scale?: number; cover?: string; pages?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M-34,0 L-34,-16 q17,-6 34,2 q17,-8 34,-2 L34,0 q-17,-6 -34,2 q-17,-8 -34,2 Z" fill={cover} />
      <path d="M-32,-1 L-32,-14 q16,-5 32,2 q16,-7 32,-2 L32,-1 q-16,-5 -32,2 q-16,-7 -32,2 Z" fill={pages} />
      <line x1="0" y1="-12" x2="0" y2="2" stroke={cover} strokeWidth="3" />
      <g stroke="#d9d2c4" strokeWidth="1.4" strokeLinecap="round">
        <path d="M-26,-9 h18" />
        <path d="M-26,-5 h14" />
        <path d="M8,-9 h18" />
        <path d="M8,-5 h14" />
      </g>
    </g>
  )
}

/** 雪人 */
function Snowman({ x, y, scale = 1, scarf = '#f26a6a' }: { x: number; y: number; scale?: number; scarf?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx="0" cy="-4" rx="34" ry="26" fill="#ffffff" stroke={C.snowDeep} strokeWidth="2" />
      <ellipse cx="0" cy="-42" rx="24" ry="20" fill="#ffffff" stroke={C.snowDeep} strokeWidth="2" />
      <circle cx="0" cy="-72" r="18" fill="#ffffff" stroke={C.snowDeep} strokeWidth="2" />
      <path d="M-16,-56 q16,10 32,0 l2,7 q-18,10 -36,0 Z" fill={scarf} />
      <path d="M14,-50 l6,20 l-8,2 l-4,-18 Z" fill={scarf} />
      <path d="M-17,-74 l-14,-6 l16,-3 Z" fill={C.autumn} />
      <circle cx="-6" cy="-76" r="2.6" fill={C.ink} />
      <circle cx="6" cy="-76" r="2.6" fill={C.ink} />
      <circle cx="0" cy="-69" r="3" fill={C.autumn} />
      <path d="M-14,-52 l-20,-8" stroke={C.barkDeep} strokeWidth="4" strokeLinecap="round" />
      <path d="M14,-52 l20,-8" stroke={C.barkDeep} strokeWidth="4" strokeLinecap="round" />
      <circle cx="-4" cy="-40" r="2.2" fill="#5b5b5b" />
      <circle cx="6" cy="-30" r="2.2" fill="#5b5b5b" />
      <path d="M-18,-72 q18,-12 36,0 q-4,-14 -18,-14 q-14,0 -18,14 Z" fill="#c9435c" />
    </g>
  )
}

/** 风筝 */
function Kite({ x, y, scale = 1, color = '#ff8f8f', dark = '#e06767' }: { x: number; y: number; scale?: number; color?: string; dark?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M0,-22 L18,0 L0,22 L-18,0 Z" fill={color} />
      <path d="M0,-22 L0,22 M-18,0 L18,0" stroke={dark} strokeWidth="1.8" />
      <path d="M0,22 q6,16 -2,30 q-8,14 2,26" fill="none" stroke={dark} strokeWidth="1.8" />
      <path d="M-4,40 l8,4 l-8,4 Z" fill="#ffe08a" />
      <path d="M-2,62 l8,4 l-8,4 Z" fill="#ffe08a" />
    </g>
  )
}

/** 气球 */
function Balloon({ x, y, scale = 1, color = '#ff8f8f', dark = '#e06767' }: { x: number; y: number; scale?: number; color?: string; dark?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx="0" cy="-26" rx="16" ry="19" fill={color} />
      <ellipse cx="-5" cy="-32" rx="5" ry="7" fill="#ffffff" opacity="0.5" />
      <path d="M-5,-9 L0,-2 L5,-9 Z" fill={dark} />
      <path d="M0,-2 q7,16 0,32 q-7,16 0,32" fill="none" stroke="#b9b0a3" strokeWidth="1.6" />
    </g>
  )
}

/** 小球 */
function Ball({ x, y, r = 8, color = '#ff7d7d', dark = '#e06767' }: { x: number; y: number; r?: number; color?: string; dark?: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={color} stroke={dark} strokeWidth="1.5" />
      <circle cx={x - r * 0.3} cy={y - r * 0.3} r={r * 0.3} fill="#ffffff" opacity="0.4" />
    </g>
  )
}

/** 雨伞 */
function Umbrella({ x, y, scale = 1, color = '#ff9b6b', dark = '#e07c4d', handle = '#8d5a33' }: { x: number; y: number; scale?: number; color?: string; dark?: string; handle?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M-44,0 A44,44 0 0 1 44,0 Z" fill={color} />
      <path d="M0,-44 A44,44 0 0 1 44,0 L0,0 Z" fill={dark} opacity="0.35" />
      <path d="M-44,0 q7,11 15,0 q7,11 14,0 q7,11 15,0 q7,11 15,0 q7,11 14,0" fill={color} stroke={dark} strokeWidth="1.6" />
      <path d="M0,-44 L0,2" stroke={handle} strokeWidth="3" />
      <path d="M0,2 q0,12 -11,12" fill="none" stroke={handle} strokeWidth="3.4" strokeLinecap="round" />
    </g>
  )
}

/* ---------------- 人物 / 动物 ---------------- */

type Pose = 'stand' | 'run' | 'sit' | 'wave' | 'lie' | 'jump' | 'reach' | 'point'
type Face = 'smile' | 'happy' | 'sad' | 'surprised' | 'calm'

const ARMS: Record<Pose, [number, number, number, number][]> = {
  stand: [[-10, -45, -17, -29], [10, -45, 17, -29]],
  run: [[-10, -45, -21, -56], [10, -45, 21, -35]],
  sit: [[-10, -44, -15, -30], [10, -44, 15, -30]],
  wave: [[-10, -45, -17, -29], [10, -45, 18, -66]],
  lie: [[-10, -45, -17, -29], [10, -45, 17, -29]],
  jump: [[-10, -45, -23, -62], [10, -45, 23, -62]],
  reach: [[-10, -45, -17, -65], [10, -45, 17, -65]],
  point: [[-10, -45, -17, -29], [10, -45, 27, -46]],
}

const LEGS: Record<Pose, [number, number, number, number][]> = {
  stand: [[-5, -26, -5, -2], [5, -26, 5, -2]],
  run: [[-5, -26, -15, -7], [5, -26, 15, -2]],
  sit: [[-5, -24, -15, -16], [5, -24, 15, -16]],
  wave: [[-5, -26, -5, -2], [5, -26, 5, -2]],
  lie: [[-5, -26, -5, -2], [5, -26, 5, -2]],
  jump: [[-5, -26, -13, -12], [5, -26, 13, -12]],
  reach: [[-5, -26, -5, -2], [5, -26, 5, -2]],
  point: [[-5, -26, -5, -2], [5, -26, 5, -2]],
}

/** 小人：(x,y) 是脚底中心；身高约 78，方便和其他图元对高度 */
function Person({
  x,
  y,
  scale = 1,
  pose = 'stand',
  skin = C.skin,
  hair = C.hairDark,
  top = '#7cc4f2',
  bottom = '#5a6b8c',
  face = 'smile',
  flip = false,
  longHair = false,
}: {
  x: number
  y: number
  scale?: number
  pose?: Pose
  skin?: string
  hair?: string
  top?: string
  bottom?: string
  face?: Face
  flip?: boolean
  longHair?: boolean
}) {
  const lying = pose === 'lie'
  const bodyY = pose === 'sit' ? 12 : 0
  const mouths: Record<Face, React.ReactNode> = {
    smile: <path d="M-3,-58 q3,3.4 6,0" stroke={C.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />,
    happy: <path d="M-4.5,-59 q4.5,5.5 9,0" stroke={C.ink} strokeWidth="1.8" fill="none" strokeLinecap="round" />,
    sad: <path d="M-3,-56 q3,-3.4 6,0" stroke={C.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />,
    surprised: <circle cx="0" cy="-57" r="2.4" fill={C.ink} />,
    calm: <path d="M-2.6,-58 h5.2" stroke={C.ink} strokeWidth="1.6" strokeLinecap="round" />,
  }
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})${lying ? ' rotate(84)' : ''}`}>
      <g transform={`translate(0 ${bodyY})`}>
        {LEGS[pose].map((l, i) => (
          <g key={`l${i}`}>
            <line x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke={bottom} strokeWidth="7" strokeLinecap="round" />
            <circle cx={l[2]} cy={l[3]} r="4.4" fill="#4a453d" />
          </g>
        ))}
        <rect x="-11" y="-50" width="22" height="26" rx="9" fill={top} />
        <rect x="-11" y="-32" width="22" height="9" rx="4" fill={bottom} opacity="0.85" />
        {ARMS[pose].map((a, i) => (
          <g key={`a${i}`}>
            <line x1={a[0]} y1={a[1]} x2={a[2]} y2={a[3]} stroke={top} strokeWidth="6" strokeLinecap="round" />
            <circle cx={a[2]} cy={a[3]} r="3.4" fill={skin} />
          </g>
        ))}
        {longHair && (
          <>
            <ellipse cx="-12" cy="-60" rx="5.5" ry="12" fill={hair} />
            <ellipse cx="12" cy="-60" rx="5.5" ry="12" fill={hair} />
          </>
        )}
        <circle cx="0" cy="-64" r="13.5" fill={hair} />
        <circle cx="0" cy="-62" r="12.2" fill={skin} />
        <circle cx="-4.4" cy="-63" r="1.7" fill={C.ink} />
        <circle cx="4.4" cy="-63" r="1.7" fill={C.ink} />
        <ellipse cx="-7.5" cy="-58.5" rx="3" ry="2" fill="#ffb0a0" opacity="0.7" />
        <ellipse cx="7.5" cy="-58.5" rx="3" ry="2" fill="#ffb0a0" opacity="0.7" />
        {mouths[face]}
      </g>
    </g>
  )
}

/** 猫：坐姿，可翻转 */
function Cat({ x, y, scale = 1, color = '#f3a860', dark = '#dd8b45', flip = false, tailUp = true }: { x: number; y: number; scale?: number; color?: string; dark?: string; flip?: boolean; tailUp?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`}>
      <path
        d={tailUp ? 'M14,-8 q20,2 17,-18 q-2,-12 -11,-12' : 'M14,-6 q24,6 22,20'}
        fill="none"
        stroke={dark}
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path d="M-16,0 q-3,-26 16,-26 q19,0 16,26 Z" fill={color} />
      <ellipse cx="-7" cy="-3" rx="4.4" ry="5.4" fill={dark} />
      <ellipse cx="7" cy="-3" rx="4.4" ry="5.4" fill={dark} />
      <path d="M-13,-40 l-2,-12 l11,7 Z" fill={color} />
      <path d="M13,-40 l2,-12 l-11,7 Z" fill={color} />
      <path d="M-11,-41 l-1,-6 l6,4 Z" fill="#ffb8b8" />
      <path d="M11,-41 l1,-6 l-6,4 Z" fill="#ffb8b8" />
      <circle cx="0" cy="-33" r="13.5" fill={color} />
      <ellipse cx="-5.4" cy="-35" rx="2.4" ry="2.8" fill={C.ink} />
      <ellipse cx="5.4" cy="-35" rx="2.4" ry="2.8" fill={C.ink} />
      <circle cx="-4.6" cy="-35.8" r="0.9" fill="#ffffff" />
      <circle cx="6.2" cy="-35.8" r="0.9" fill="#ffffff" />
      <path d="M0,-30.4 l-2.6,1.8 h5.2 Z" fill="#ff8f9c" />
      <path d="M0,-28.6 q-3,3 -6,0.6 M0,-28.6 q3,3 6,0.6" stroke={C.ink} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <g stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" opacity="0.9">
        <path d="M-8,-30 l-14,-4" />
        <path d="M-8,-28 l-14,2" />
        <path d="M8,-30 l14,-4" />
        <path d="M8,-28 l14,2" />
      </g>
      <path d="M-9,-18 q3,4 6,0" stroke={dark} strokeWidth="2.4" fill="none" strokeLinecap="round" opacity="0.7" />
      <path d="M3,-22 q3,4 6,0" stroke={dark} strokeWidth="2.4" fill="none" strokeLinecap="round" opacity="0.7" />
    </g>
  )
}

/** 狗：坐姿，垂耳 */
function Dog({ x, y, scale = 1, color = '#e2b177', dark = '#c48f52', flip = false, tongue = false }: { x: number; y: number; scale?: number; color?: string; dark?: string; flip?: boolean; tongue?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`}>
      <path d="M15,-8 q18,-4 14,-20" fill="none" stroke={dark} strokeWidth="6" strokeLinecap="round" />
      <path d="M-17,0 q-4,-28 17,-28 q21,0 17,28 Z" fill={color} />
      <ellipse cx="-8" cy="-3" rx="5" ry="6" fill="#f6e0c2" />
      <ellipse cx="8" cy="-3" rx="5" ry="6" fill="#f6e0c2" />
      <ellipse cx="-14" cy="-40" rx="7" ry="13" fill={dark} transform="rotate(-14 -14 -40)" />
      <ellipse cx="14" cy="-40" rx="7" ry="13" fill={dark} transform="rotate(14 14 -40)" />
      <circle cx="0" cy="-34" r="14" fill={color} />
      <ellipse cx="0" cy="-27" rx="9" ry="7" fill="#f6e0c2" />
      <circle cx="-5.4" cy="-37" r="2.6" fill={C.ink} />
      <circle cx="5.4" cy="-37" r="2.6" fill={C.ink} />
      <circle cx="-4.6" cy="-37.8" r="0.9" fill="#ffffff" />
      <circle cx="6.2" cy="-37.8" r="0.9" fill="#ffffff" />
      <ellipse cx="0" cy="-29" rx="3.4" ry="2.6" fill="#5b4636" />
      {tongue ? (
        <path d="M0,-26 q-3,7 1,7 q4,0 2,-7 Z" fill="#ff8f9c" />
      ) : (
        <path d="M-3.4,-24 q3.4,3.6 6.8,0" stroke={C.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      )}
      <path d="M-8,-30 q-4,-6 2,-6" stroke={dark} strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M8,-30 q4,-6 -2,-6" stroke={dark} strokeWidth="3" fill="none" strokeLinecap="round" />
    </g>
  )
}

/** 鸟：可停在枝头，也可飞行 */
function Bird({ x, y, scale = 1, color = '#6fb3ff', belly = '#dceeff', fly = false, flip = false }: { x: number; y: number; scale?: number; color?: string; belly?: string; fly?: boolean; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`}>
      <ellipse cx="0" cy="0" rx="15" ry="11" fill={color} />
      <ellipse cx="2" cy="4" rx="9" ry="6" fill={belly} />
      <path d={fly ? 'M-6,-4 q-16,-14 -22,-2 q10,6 22,2 Z' : 'M-8,-2 q-10,-10 -16,-2 q8,6 16,2 Z'} fill={color} />
      <path d="M-13,-2 l-14,-6 l4,8 Z" fill={color} />
      <circle cx="12" cy="-8" r="8.5" fill={color} />
      <circle cx="14.5" cy="-9.5" r="2" fill={C.ink} />
      <circle cx="15.2" cy="-10.2" r="0.7" fill="#ffffff" />
      <path d="M19,-8 l8,2 l-8,3 Z" fill={C.autumn} />
      {fly && <path d="M2,-2 q10,8 20,4 q-6,-10 -20,-4 Z" fill={belly} opacity="0.85" />}
    </g>
  )
}

/* ---------------- 对话气泡 ---------------- */

/** 对话气泡：只画圆点，不写字 */
function SpeechBubble({ x, y, scale = 1, w = 76, h = 46, fill = '#ffffff', stroke = '#c9bfae', flip = false }: { x: number; y: number; scale?: number; w?: number; h?: number; fill?: string; stroke?: string; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2.4} fill={fill} stroke={stroke} strokeWidth="3" />
      <path d={`M${-w / 2 + 16},${h / 2 - 3} l-14,16 l22,-8 Z`} fill={fill} stroke={stroke} strokeWidth="3" strokeLinejoin="round" />
      {[-14, 0, 14].map((dx, i) => (
        <circle key={i} cx={dx} cy={0} r="4" fill={stroke} />
      ))}
    </g>
  )
}

/** 思考气泡：几朵小云往上飘 */
function ThoughtBubble({ x, y, scale = 1, w = 92, h = 58, fill = '#ffffff', stroke = '#c9bfae' }: { x: number; y: number; scale?: number; w?: number; h?: number; fill?: string; stroke?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx="0" cy="0" rx={w / 2} ry={h / 2} fill={fill} stroke={stroke} strokeWidth="3" />
      <circle cx={-w * 0.2} cy={h * 0.42} r="8" fill={fill} stroke={stroke} strokeWidth="3" />
      <circle cx={-w * 0.34} cy={h * 0.62} r="5" fill={fill} stroke={stroke} strokeWidth="2.6" />
      {seeds(1201, 3).map((_s, i) => (
        <circle key={i} cx={-18 + i * 18} cy={-4} r="4.4" fill={stroke} />
      ))}
    </g>
  )
}

/* ============================================================
   六、场景（按题材分组，全部由图元拼装）
   ============================================================ */

/* ---------------- A. 写景 · 四季 / 天气 / 山水 / 校园 / 夜晚 ---------------- */

/** 春天的公园：远处青山、中景花树、近景草地小路与花瓣 */
const SpringPark = def('spring-park', '春天的公园', () => (
  <>
    <Sky tone="day" />
    <Sun x={332} y={52} r={25} />
    <Cloud x={78} y={50} scale={0.9} />
    <Cloud x={226} y={36} scale={0.68} opacity={0.85} />
    <Hill x={62} y={198} rx={152} ry={64} color="#c8ebae" />
    <Hill x={336} y={200} rx={142} ry={58} color="#b2e09c" />
    <Ground y={206} />
    <Path x={200} top={210} w={38} w2={152} />
    <Tree x={62} y={216} scale={0.96} kind="blossom" />
    <Tree x={344} y={212} scale={0.78} kind="blossom" />
    <Bush x={140} y={230} scale={0.9} />
    <Bush x={292} y={240} scale={0.74} />
    <Flower x={112} y={254} scale={1.05} petal="#ff9fc0" />
    <Flower x={300} y={262} scale={0.9} petal="#ffd166" />
    <Flower x={82} y={276} scale={1.15} petal="#c9a2ff" />
    <Person x={186} y={260} scale={0.92} pose="stand" top="#ff9b6b" bottom="#5a6b8c" longHair />
    <Dog x={242} y={272} scale={0.66} />
    <Petals />
  </>
))

/** 秋天的落叶：金黄树、铺地落叶、风里的孩子 */
const AutumnLeaves = def('autumn-leaves', '秋天的落叶', () => (
  <>
    <Sky tone="dawn" />
    <Sun x={320} y={58} r={24} />
    <Cloud x={96} y={46} scale={0.8} opacity={0.8} />
    <Hill x={90} y={200} rx={150} ry={60} color="#e8c98f" />
    <Hill x={330} y={204} rx={140} ry={56} color="#dcbb7c" />
    <Ground y={210} color="#cfe08d" deep="#a8c46a" />
    <Path x={196} top={212} w={44} w2={160} color="#e6cfa2" edge="#cdb27e" />
    <Tree x={58} y={220} scale={1.05} kind="golden" />
    <Tree x={348} y={214} scale={0.86} kind="golden" />
    <Tree x={122} y={206} scale={0.6} kind="bare" />
    <Bush x={286} y={244} scale={0.8} color="#e0b25c" dark="#c48f45" />
    <g fill="#e8a94a" opacity="0.9">
      {seeds(311, 16).map((s, i) => (
        <ellipse key={i} cx={rnd(s, 20, 380)} cy={rnd(s + 4, 244, 294)} rx={rnd(s + 8, 4, 8)} ry={rnd(s + 12, 2, 3.6)} />
      ))}
    </g>
    <Person x={168} y={266} scale={0.94} pose="run" top="#e2604f" bottom="#5f6b7d" face="happy" />
    <Person x={228} y={272} scale={0.82} pose="reach" top="#f2c14e" bottom="#4f7a8c" face="happy" />
    <Wind x={316} y={118} scale={1.1} color="#fff6e0" opacity={0.8} />
    <FallingLeaves />
  </>
))

/** 冬天的窗户：屋里暖，窗外雪；窗台一盆绿植 */
const WinterWindow = def('winter-window', '冬天的窗户', () => (
  <>
    <Sky tone="day" />
    <SnowGround y={148} />
    <Hill x={70} y={150} rx={120} ry={34} color="#e8f3fa" />
    <Tree x={144} y={154} scale={0.66} kind="pine" />
    <Tree x={196} y={150} scale={0.5} kind="bare" />
    <Tree x={252} y={152} scale={0.44} kind="bare" />
    <House x={330} y={156} scale={0.46} />
    <Snow count={44} seed={151} />
    <WallFrame x={104} y={44} w={196} h={146} />
    <WindowPane x={104} y={44} w={196} h={146} />
    <g>
      <ellipse cx="200" cy="206" rx="150" ry="26" fill="#ffe9b8" opacity="0.35" />
      <Plant x={338} y={214} scale={1.05} />
      <g transform="translate(96 196)">
        <rect x="-24" y="-6" width="48" height="14" rx="6" fill="#f6e6c8" />
        <path d="M-24,-6 q24,-22 48,0 Z" fill="#f6e6c8" />
        <path d="M-18,-12 q18,-14 36,0" fill="none" stroke="#e0c79b" strokeWidth="3" />
        <Steam x={0} y={-16} scale={0.5} opacity={0.5} />
      </g>
    </g>
    <Sparkle x={70} y={110} r={10} color="#fff3c4" />
    <Sparkle x={346} y={92} r={8} color="#fff3c4" opacity={0.8} />
  </>
))

/** 玩雪：雪地上打雪仗的孩子，雪球在半空 */
const SnowPlay = def('snow-play', '玩雪', () => (
  <>
    <Sky tone="rain" />
    <Cloud x={86} y={44} scale={0.95} fill="#eef4f8" />
    <Cloud x={292} y={38} scale={0.78} fill="#eef4f8" opacity={0.9} />
    <Hill x={80} y={186} rx={160} ry={60} color="#e4f0f8" />
    <Hill x={330} y={190} rx={140} ry={54} color="#d8e9f5" />
    <SnowGround y={200} />
    <Tree x={44} y={206} scale={0.72} kind="bare" />
    <Tree x={356} y={200} scale={0.62} kind="bare" />
    <Person x={132} y={250} scale={0.96} pose="run" top="#e2604f" bottom="#3f5a7a" face="happy" />
    <Person x={272} y={256} scale={0.9} pose="reach" top="#4f8fd0" bottom="#3f5a7a" face="happy" flip />
    <circle cx="196" cy="188" r="9" fill="#ffffff" stroke={C.snowDeep} strokeWidth="2" />
    <circle cx="214" cy="200" r="7" fill="#ffffff" stroke={C.snowDeep} strokeWidth="2" />
    <circle cx="182" cy="204" r="6" fill="#ffffff" stroke={C.snowDeep} strokeWidth="2" />
    <circle cx="240" cy="230" r="8" fill="#ffffff" stroke={C.snowDeep} strokeWidth="2" />
    <g fill="#ffffff">
      {seeds(233, 10).map((s, i) => (
        <ellipse key={i} cx={rnd(s, 20, 380)} cy={rnd(s + 5, 214, 292)} rx={rnd(s + 9, 12, 26)} ry={rnd(s + 13, 4, 8)} opacity="0.9" />
      ))}
    </g>
    <Snow count={46} seed={173} />
  </>
))

/** 堆雪人：雪人当主角，两个孩子在两边 */
const SnowmanScene = def('snowman', '堆雪人', () => (
  <>
    <Sky tone="rain" />
    <Cloud x={104} y={42} scale={0.9} fill="#eef4f8" />
    <Hill x={60} y={188} rx={150} ry={58} color="#e4f0f8" />
    <SnowGround y={200} />
    <Tree x={42} y={204} scale={0.6} kind="pine" />
    <Tree x={362} y={198} scale={0.52} kind="pine" />
    <Snowman x={200} y={256} scale={1.15} />
    <Person x={92} y={272} scale={0.88} pose="wave" top="#4f8fd0" bottom="#3f5a7a" face="happy" />
    <Person x={312} y={276} scale={0.84} pose="point" top="#f2c14e" bottom="#7a5a3c" face="happy" flip />
    <rect x="150" y="286" width="100" height="9" rx="4" fill="#e2d5c0" opacity="0.9" />
    <circle cx="126" cy="252" r="6" fill="#ffffff" stroke={C.snowDeep} strokeWidth="2" />
    <circle cx="284" cy="262" r="5" fill="#ffffff" stroke={C.snowDeep} strokeWidth="2" />
    <Snow count={40} seed={197} />
  </>
))

/** 下雨的窗户：玻璃上挂满雨珠，猫蹲在窗台看雨 */
const RainWindow = def('rain-window', '下雨的窗户', () => (
  <>
    <Sky tone="rain" />
    <Hill x={90} y={172} rx={150} ry={48} color="#a9c4ae" />
    <Ground y={180} color="#8fb98c" deep="#6d9c74" wave={14} />
    <Tree x={140} y={184} scale={0.5} kind="round" />
    <Tree x={280} y={182} scale={0.42} kind="round" />
    <House x={330} y={186} scale={0.34} />
    <Rain count={40} seed={101} />
    <WallFrame x={96} y={38} w={206} h={152} />
    <WindowPane x={96} y={38} w={206} h={152} />
    <g opacity="0.7" fill="#cfe4f2">
      {seeds(419, 22).map((s, i) => (
        <ellipse key={i} cx={rnd(s, 104, 294)} cy={rnd(s + 6, 46, 182)} rx={rnd(s + 10, 2.4, 5)} ry={rnd(s + 14, 3.4, 8)} />
      ))}
    </g>
    <Cat x={150} y={212} scale={0.86} color="#8d9aa8" dark="#6f7c8b" />
    <g transform="translate(280 200)">
      <rect x="-20" y="-16" width="40" height="16" rx="4" fill="#f2e3c6" />
      <path d="M-14,-16 q14,-12 28,0 Z" fill="#e0cba4" />
      <Steam x={0} y={-22} scale={0.45} opacity={0.45} />
    </g>
  </>
))

/** 雨停了：彩虹、水洼、云缝里的太阳 */
const RainbowScene = def('rainbow', '雨后的彩虹', () => (
  <>
    <Sky tone="day" />
    <Rainbow x={200} y={224} r={126} />
    <Sun x={330} y={50} r={22} />
    <Cloud x={70} y={62} scale={0.9} opacity={0.9} />
    <Cloud x={306} y={44} scale={0.62} opacity={0.75} />
    <Hill x={76} y={198} rx={150} ry={60} color="#bde5a4" />
    <Hill x={334} y={200} rx={138} ry={56} color="#a8da94" />
    <Ground y={206} />
    <Path x={198} top={210} w={40} w2={148} />
    <ellipse cx="112" cy="268" rx="46" ry="13" fill="#a8dcf2" stroke="#7fc9ef" strokeWidth="2" />
    <ellipse cx="112" cy="268" rx="30" ry="7" fill="#d8f0fb" opacity="0.8" />
    <ellipse cx="300" cy="282" rx="52" ry="14" fill="#a8dcf2" stroke="#7fc9ef" strokeWidth="2" />
    <ellipse cx="300" cy="282" rx="34" ry="7" fill="#d8f0fb" opacity="0.8" />
    <Tree x={50} y={214} scale={0.7} kind="round" />
    <Flower x={168} y={256} scale={1} petal="#ff9fc0" />
    <Flower x={248} y={266} scale={0.9} petal="#ffd166" />
    <Person x={196} y={250} scale={0.8} pose="reach" top="#ffd166" bottom="#5a6b8c" face="happy" />
    <Bird x={118} y={96} scale={0.7} fly flip />
    <Bird x={266} y={80} scale={0.58} fly />
    <Sparkle x={60} y={140} r={9} color="#ffffff" opacity={0.8} />
  </>
))

/** 大雾的早晨：路灯、若隐若现的树、赶路的人 */
const FogMorning = def('fog-morning', '大雾的早晨', () => (
  <>
    <Sky tone="fog" />
    <Hill x={80} y={196} rx={160} ry={56} color="#c6d6cc" opacity={0.7} />
    <Ground y={208} color="#b9cfae" deep="#9db894" />
    <Path x={200} top={210} w={30} w2={120} color="#d9d3c0" edge="#c2bba6" />
    <g opacity="0.55">
      <Tree x={70} y={212} scale={0.72} kind="round" />
      <Tree x={330} y={210} scale={0.6} kind="round" />
    </g>
    <g opacity="0.8">
      <Tree x={128} y={214} scale={0.5} kind="pine" />
    </g>
    <g transform="translate(296 210)">
      <rect x="-3" y="-104" width="6" height="104" rx="3" fill="#8b8275" />
      <path d="M-3,-104 q16,4 16,16 h-16 Z" fill="#8b8275" />
      <circle cx="8" cy="-86" r="9" fill="#fff3c4" />
      <circle cx="8" cy="-86" r="20" fill="#fff3c4" opacity="0.25" />
      <path d="M-16,-104 h32 l-4,10 h-24 Z" fill="#8b8275" />
    </g>
    <Person x={176} y={272} scale={0.9} pose="run" top="#7c8fa8" bottom="#4a5568" face="calm" />
    <Person x={228} y={284} scale={0.76} pose="stand" top="#c96a6a" bottom="#4a5568" face="calm" />
    <Fog bands={5} opacity={0.6} seed={59} />
    <Fog bands={3} opacity={0.5} seed={83} />
  </>
))

/** 家乡的小河：石桥、两岸人家、划船的人 */
const RiverVillage = def('river-village', '家乡的小河', () => (
  <>
    <Sky tone="day" />
    <Sun x={324} y={52} r={23} />
    <Cloud x={92} y={44} scale={0.8} opacity={0.85} />
    <Hill x={72} y={172} rx={150} ry={58} color="#b6e0a0" />
    <Hill x={336} y={176} rx={136} ry={54} color="#a4d68e" />
    <Ground y={176} color="#9ed886" deep="#7cbb66" />
    <House x={70} y={176} scale={0.62} />
    <House x={330} y={172} scale={0.52} roof="#d98b52" roofDark="#bd7040" />
    <Tree x={132} y={176} scale={0.44} kind="round" />
    <Water y={188} />
    <Ground y={250} name="ground-near" color="#95da6c" deep="#5cb44c" wave={16} />
    <g>
      <path d="M120,188 q80,-46 160,0" fill="none" stroke={C.bark} strokeWidth="10" />
      <path d="M120,188 q80,-46 160,0" fill="none" stroke={C.barkDeep} strokeWidth="3" opacity="0.5" />
      <path d="M120,188 v-24 M280,188 v-24 M120,166 h160" stroke={C.barkDeep} strokeWidth="4" strokeLinecap="round" />
      <path d="M140,164 v-14 M200,146 v-16 M260,164 v-14" stroke={C.barkDeep} strokeWidth="4" strokeLinecap="round" />
    </g>
    <g transform="translate(96 236)">
      <path d="M-30,0 q30,14 60,0 q-6,10 -30,10 q-24,0 -30,-10 Z" fill="#c98d5a" />
      <rect x="-2" y="-40" width="4" height="40" fill="#a4723f" />
      <path d="M0,-40 l26,12 l-26,12 Z" fill="#fff3dd" />
    </g>
    <Flower x={340} y={272} scale={0.9} petal="#ff9fc0" />
    <Bird x={210} y={104} scale={0.56} fly />
  </>
))

/** 摸黑上山：天还没亮，手电光柱打在山路上 */
const MountainClimb = def('mountain-climb', '摸黑上山', () => (
  <>
    <Sky tone="night" />
    {seeds(601, 40).map((s, i) => (
      <Star key={i} x={rnd(s, 6, 394)} y={rnd(s + 3, 6, 150)} r={rnd(s + 9, 1.4, 3)} opacity={rnd(s + 13, 0.4, 1)} />
    ))}
    <Moon x={318} y={54} r={20} />
    <Mountain x={70} base={214} w={190} h={140} color="#43507f" shade="#374269" snow={false} />
    <Mountain x={290} base={214} w={210} h={160} color="#4d5b8e" shade="#3d4a76" snow={false} />
    <Ground y={214} color="#3f5a45" deep="#2f4636" />
    <Path x={196} top={216} w={26} w2={110} color="#6b6a5c" edge="#565549" />
    <Person x={168} y={272} scale={0.9} pose="run" top="#e2604f" bottom="#3a4356" face="calm" />
    <Person x={214} y={282} scale={0.8} pose="stand" top="#4f8fd0" bottom="#3a4356" face="calm" />
    <g>
      <path d="M186,244 L268,196 L286,214 Z" fill="#fff6c0" opacity="0.28" />
      <circle cx="184" cy="246" r="6" fill="#fff6c0" />
      <circle cx="184" cy="246" r="14" fill="#fff6c0" opacity="0.3" />
    </g>
    <Tree x={52} y={226} scale={0.62} kind="pine" />
    <Tree x={352} y={232} scale={0.56} kind="pine" />
    <Rock x={112} y={258} scale={0.9} color="#5b6478" dark="#48505f" />
  </>
))

/** 日出山顶：云海、跃出山脊的太阳、欢呼的人 */
const SunrisePeak = def('sunrise-peak', '日出山顶', () => (
  <>
    <Sky tone="dawn" />
    <Sun x={200} y={132} r={30} />
    <Mountain x={60} base={228} w={230} h={124} color="#8f9dbe" shade="#7c89a8" />
    <Mountain x={344} base={232} w={240} h={138} color="#9aa8c6" shade="#8592b0" />
    <g fill="#fff3dd" opacity="0.85">
      <ellipse cx="90" cy="216" rx="96" ry="20" />
      <ellipse cx="210" cy="230" rx="120" ry="22" />
      <ellipse cx="336" cy="214" rx="90" ry="18" />
    </g>
    <Ground y={244} color="#8a8f7c" deep="#6d7264" wave={14} />
    <Rock x={330} y={266} scale={0.8} color="#9a9a8c" dark="#7f7f72" />
    <Person x={148} y={274} scale={0.95} pose="reach" top="#e2604f" bottom="#3f4a5c" face="happy" />
    <Person x={196} y={286} scale={0.82} pose="wave" top="#4f8fd0" bottom="#3f4a5c" face="happy" />
    <Bird x={104} y={120} scale={0.6} fly />
    <Bird x={286} y={100} scale={0.5} fly flip />
    <Sparkle x={244} y={150} r={11} color="#fff6d0" />
    <Sparkle x={156} y={168} r={8} color="#fff6d0" opacity={0.8} />
  </>
))

/** 学校的小花园：教学楼、花圃、小路，孩子在里面散步 */
const SchoolGarden = def('school-garden', '学校的小花园', () => (
  <>
    <Sky tone="day" />
    <Sun x={330} y={50} r={22} />
    <Cloud x={80} y={44} scale={0.8} opacity={0.9} />
    <Hill x={60} y={190} rx={150} ry={52} color="#c2e8a9" />
    <Ground y={200} />
    <g transform="translate(300 190) scale(1.05)">
      <rect x="-90" y="-96" width="180" height="96" rx="6" fill="#fdf1dc" />
      <rect x="-90" y="-96" width="180" height="96" rx="6" fill="none" stroke="#e2cba4" strokeWidth="2" />
      <path d="M-100,-94 L0,-124 L100,-94 Z" fill={C.brick} />
      <path d="M0,-124 L100,-94 L74,-94 L0,-118 Z" fill={C.brickDeep} />
      {seeds(811, 8).map((_s, i) => (
        <rect key={i} x={-72 + (i % 4) * 40} y={-78 + Math.floor(i / 4) * 36} width="26" height="24" rx="4" fill="#cfeaff" stroke="#e2cba4" strokeWidth="2" />
      ))}
      <rect x="-16" y="-32" width="32" height="32" rx="4" fill="#b9773f" />
      <path d="M0,-124 v-16 h10 v16" fill={C.brickDeep} />
    </g>
    <Fence x={110} y={214} w={150} h={30} />
    <Path x={110} top={216} w={30} w2={116} />
    <Tree x={52} y={214} scale={0.72} kind="round" />
    <Bush x={252} y={240} scale={0.86} />
    <g>
      <ellipse cx="120" cy="262" rx="62" ry="20" fill="#e8d5ae" />
      <ellipse cx="120" cy="262" rx="50" ry="14" fill="#c8e6a0" />
    </g>
    <Flower x={86} y={266} scale={0.85} petal="#ff9fc0" />
    <Flower x={118} y={272} scale={0.8} petal="#ffd166" />
    <Flower x={152} y={266} scale={0.85} petal="#c9a2ff" />
    <Person x={228} y={266} scale={0.88} pose="stand" top="#7cc4f2" bottom="#5a6b8c" longHair />
    <Person x={276} y={276} scale={0.8} pose="stand" top="#ff9b6b" bottom="#5a6b8c" />
    <Bird x={196} y={230} scale={0.42} fly />
  </>
))

/** 热闹的操场：跑道、球门、奔跑的孩子和远处的教学楼 */
const Playground = def('playground', '热闹的操场', () => (
  <>
    <Sky tone="day" />
    <Sun x={58} y={48} r={21} />
    <Cloud x={300} y={40} scale={0.8} opacity={0.9} />
    <Ground y={186} color="#a8dc8a" deep="#7cbb66" wave={12} />
    <g transform="translate(300 178) scale(0.86)">
      <rect x="-86" y="-88" width="172" height="88" rx="6" fill="#fdf1dc" />
      <path d="M-96,-86 L0,-114 L96,-86 Z" fill={C.brick} />
      {seeds(829, 6).map((_s, i) => (
        <rect key={i} x={-66 + (i % 3) * 44} y={-72 + Math.floor(i / 3) * 36} width="28" height="24" rx="4" fill="#cfeaff" stroke="#e2cba4" strokeWidth="2" />
      ))}
      <rect x="-14" y="-30" width="28" height="30" rx="4" fill="#b9773f" />
    </g>
    <ellipse cx="190" cy="246" rx="190" ry="62" fill="#e08a6a" />
    <ellipse cx="190" cy="246" rx="166" ry="50" fill="#a8dc8a" />
    <ellipse cx="190" cy="246" rx="166" ry="50" fill="none" stroke="#f6f0e0" strokeWidth="3" strokeDasharray="14 10" />
    <g transform="translate(64 216)">
      <rect x="-3" y="-4" width="6" height="34" fill="#f6f0e0" />
      <rect x="33" y="-4" width="6" height="34" fill="#f6f0e0" />
      <rect x="-6" y="-24" width="48" height="24" fill="none" stroke="#f6f0e0" strokeWidth="4" />
    </g>
    <circle cx="236" cy="238" r="11" fill="#ffffff" stroke="#c9c2b4" strokeWidth="2" />
    <Person x={150} y={262} scale={0.9} pose="run" top="#ffd166" bottom="#3f5a7a" face="happy" />
    <Person x={200} y={274} scale={0.86} pose="run" top="#e2604f" bottom="#3f5a7a" face="happy" />
    <Person x={268} y={268} scale={0.84} pose="jump" top="#7cc4f2" bottom="#3f5a7a" face="happy" flip />
    <Person x={330} y={282} scale={0.78} pose="wave" top="#c9a2ff" bottom="#3f5a7a" face="happy" />
    <Tree x={28} y={212} scale={0.6} kind="round" />
  </>
))

/** 数星星的晚上：躺在草地上看星星的孩子 */
const StarryNight = def('starry-night', '数星星的晚上', () => (
  <>
    <Sky tone="night" />
    {seeds(701, 54).map((s, i) => (
      <Star key={i} x={rnd(s, 6, 394)} y={rnd(s + 3, 6, 176)} r={rnd(s + 9, 1.4, 3.8)} opacity={rnd(s + 13, 0.45, 1)} />
    ))}
    <Moon x={310} y={56} r={24} />
    <Sparkle x={120} y={54} r={12} color="#fff6c0" />
    <Hill x={70} y={202} rx={160} ry={58} color="#4a6b58" />
    <Ground y={214} color="#3f6b4c" deep="#2c4f38" />
    <Tree x={44} y={222} scale={0.76} kind="pine" />
    <Tree x={356} y={218} scale={0.66} kind="pine" />
    <Person x={148} y={252} scale={1} pose="lie" top="#7cc4f2" bottom="#5a6b8c" face="happy" />
    <GrassTuft x={86} y={266} scale={1.2} color="#2f5a3f" />
    <GrassTuft x={286} y={274} scale={1.4} color="#2f5a3f" />
    <GrassTuft x={340} y={262} scale={1.1} color="#2f5a3f" />
    <Bird x={92} y={130} scale={0.5} fly />
  </>
))

/** 萤火虫之夜：提着罐子追萤火虫的孩子 */
const Fireflies = def('fireflies', '萤火虫之夜', () => (
  <>
    <Sky tone="night" />
    {seeds(733, 26).map((s, i) => (
      <Star key={i} x={rnd(s, 6, 394)} y={rnd(s + 3, 6, 140)} r={rnd(s + 9, 1.2, 2.8)} opacity={rnd(s + 13, 0.4, 0.9)} />
    ))}
    <Moon x={72} y={50} r={18} />
    <Hill x={330} y={200} rx={150} ry={54} color="#3d5c4c" />
    <Ground y={212} color="#3c6b4e" deep="#284a36" />
    <Tree x={356} y={220} scale={0.7} kind="round" />
    <GrassTuft x={48} y={262} scale={1.5} color="#2f5a3f" />
    <GrassTuft x={120} y={280} scale={1.3} color="#2f5a3f" />
    <GrassTuft x={320} y={270} scale={1.6} color="#2f5a3f" />
    <Person x={228} y={274} scale={0.92} pose="reach" top="#f2c14e" bottom="#4a5568" face="happy" />
    <g transform="translate(258 244)">
      <rect x="-11" y="-14" width="22" height="26" rx="6" fill="#dff3ff" opacity="0.5" stroke="#f6f0e0" strokeWidth="2.4" />
      <rect x="-13" y="-18" width="26" height="6" rx="3" fill="#f6f0e0" />
    </g>
    {seeds(757, 18).map((s, i) => (
      <Firefly key={i} x={rnd(s, 20, 384)} y={rnd(s + 5, 130, 268)} r={rnd(s + 11, 2.2, 3.6)} />
    ))}
    <GrassTuft x={186} y={292} scale={1.4} color="#2f5a3f" />
  </>
))

/* ---------------- B. 写人 · 家人 / 老师 / 同学 / 陌生人 / 自己 ---------------- */

/** 妈妈做饭：灶台、冒热气的锅、切好的菜，妈妈站在料理台后 */
const MomCooking = def('mom-cooking', '妈妈做饭', () => (
  <>
    <RoomWall wall="#fdf0d8" floor="#e4cfae" floorY={238} />
    <rect x="26" y="52" width="150" height="104" rx="8" fill="#cfeaff" stroke="#e0b27e" strokeWidth="7" />
    <line x1="101" y1="52" x2="101" y2="156" stroke="#e0b27e" strokeWidth="5" />
    <line x1="26" y1="104" x2="176" y2="104" stroke="#e0b27e" strokeWidth="5" />
    <Cloud x={70} y={82} scale={0.4} opacity={0.9} />
    <circle cx="150" cy="88" r="12" fill="#ffd45e" />
    <rect x="188" y="40" width="186" height="22" rx="8" fill="#e8cfa6" />
    <rect x="188" y="62" width="186" height="10" fill="#d3bb96" />
    {seeds(1201, 6).map((s, i) => (
      <circle key={i} cx={rnd(s, 202, 358)} cy={72} r={rnd(s + 4, 3, 5.5)} fill={['#e2604f', '#f2c14e', '#7cc4f2'][i % 3]} />
    ))}
    <Person x={132} y={228} scale={1.15} pose="stand" top="#f2a0c0" bottom="#7a5a8c" face="happy" longHair hair={C.hairBrown} />
    <path d="M122,172 h20 l5,24 h-30 Z" fill="#fffdf4" stroke="#e0d3b8" strokeWidth="2" />
    <rect x="30" y="196" width="340" height="22" rx="8" fill="#f0dcbb" />
    <rect x="30" y="218" width="340" height="64" fill="#e2cba4" />
    <line x1="30" y1="196" x2="370" y2="196" stroke="#d3bb96" strokeWidth="3" />
    <g>
      <rect x="252" y="158" width="96" height="38" rx="8" fill="#b9bfc6" />
      <rect x="252" y="150" width="96" height="12" rx="5" fill="#9aa1a9" />
      <ellipse cx="300" cy="158" rx="34" ry="10" fill="#8f979f" />
      <path d="M266,150 q34,-26 68,0 Z" fill="#d9dee3" />
      <ellipse cx="300" cy="150" rx="34" ry="8" fill="#c9d0d6" />
      <Steam x={300} y={116} scale={0.8} opacity={0.55} />
      <circle cx="278" cy="168" r="5" fill="#e2604f" />
      <circle cx="322" cy="168" r="5" fill="#e2604f" />
    </g>
    <g transform="translate(96 194)">
      <ellipse cx="0" cy="0" rx="42" ry="10" fill="#f6e6c8" />
      <circle cx="-16" cy="-4" r="7" fill="#e2604f" />
      <circle cx="0" cy="-5" r="7" fill="#7cc4f2" />
      <circle cx="16" cy="-4" r="7" fill="#f2c14e" />
    </g>
    <Sparkle x={214} y={94} r={9} color="#fff3c4" />
  </>
))

/** 爷爷的花园：草帽爷爷、喷壶、成畦的菜地 */
const GrandpaGarden = def('grandpa-garden', '爷爷的花园', () => (
  <>
    <Sky tone="day" />
    <Sun x={52} y={50} r={22} />
    <Cloud x={300} y={44} scale={0.8} opacity={0.9} />
    <Hill x={330} y={196} rx={150} ry={56} color="#c2e8a9" />
    <Ground y={204} />
    <Fence x={210} y={196} w={180} h={34} />
    <House x={56} y={196} scale={0.5} />
    <g fill="#c8a06a" opacity="0.55">
      {seeds(1301, 5).map((s, i) => (
        <ellipse key={i} cx={30 + i * 76} cy={rnd(s, 236, 286)} rx={62} ry={12} />
      ))}
    </g>
    <g>
      {seeds(1319, 18).map((s, i) => (
        <g key={i} transform={`translate(${rnd(s, 26, 372)} ${rnd(s + 6, 228, 288)})`}>
          <path d="M0,0 q-8,-14 -2,-22" stroke={C.grassDark} strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="-2" cy="-24" r="6" fill={i % 3 === 0 ? '#e2604f' : i % 3 === 1 ? '#63bf5c' : '#f2c14e'} />
        </g>
      ))}
    </g>
    <Person x={128} y={272} scale={1} pose="point" top="#8fb98c" bottom="#6b6f7a" face="happy" hair="#d9d5cc" />
    <ellipse cx="128" cy="192" rx="27" ry="9" fill="#e8cf94" />
    <path d="M104,192 q24,-22 48,0 Z" fill="#f0dcab" />
    <path d="M104,192 q24,8 48,0 q-24,6 -48,0 Z" fill="#d9bd8f" />
    <g transform="translate(226 258)">
      <path d="M-18,-24 h30 l-4,24 h-22 Z" fill="#8fd0f0" />
      <path d="M12,-20 l20,-12 l4,8 l-22,12 Z" fill="#5eb0da" />
      <path d="M32,-32 q10,4 6,12" fill="none" stroke="#5eb0da" strokeWidth="3" strokeLinecap="round" />
      <path d="M-18,-24 h30" stroke="#5eb0da" strokeWidth="3" />
      {seeds(1327, 7).map((_s, i) => (
        <line key={i} x1={-14 + i * 5} y1={-2} x2={-26 + i * 6} y2={12} stroke="#8fd0f0" strokeWidth="2.4" strokeLinecap="round" />
      ))}
    </g>
    <Tree x={358} y={214} scale={0.6} kind="round" />
    <Bird x={196} y={120} scale={0.5} fly />
  </>
))

/** 妹妹来了：婴儿床、围过来的家人、墙上的气球 */
const BabyArrive = def('baby-arrive', '妹妹来了', () => (
  <>
    <RoomWall wall="#fdf1e0" floor="#e8d5b8" floorY={244} />
    <Panel x={30} y={40} w={72} h={56} fill="#dff1fb" stroke="#e0b27e" sw={6} />
    <Panel x={116} y={40} w={72} h={56} fill="#ffe9f2" stroke="#e0b27e" sw={6} />
    <Sparkle x={66} y={68} r={10} color="#fff3c4" />
    <Balloon x={330} y={98} scale={0.9} color="#ff8f8f" />
    <Balloon x={364} y={128} scale={0.7} color="#8fd0f0" />
    <Balloon x={300} y={140} scale={0.6} color="#f2c14e" />
    <Crib x={200} y={262} scale={1.15} />
    <g transform="translate(200 244)">
      <ellipse cx="-16" cy="6" rx="20" ry="12" fill="#ffd9b5" />
      <ellipse cx="0" cy="0" rx="26" ry="16" fill="#ffe6c4" />
      <circle cx="16" cy="-6" r="13" fill="#ffd9b5" />
      <path d="M6,-16 q10,-8 20,0 q-10,-4 -20,0 Z" fill="#7a5236" />
      <circle cx="13" cy="-7" r="1.8" fill={C.ink} />
      <circle cx="20" cy="-7" r="1.8" fill={C.ink} />
      <path d="M15,-3 q2,3 4,0" stroke={C.ink} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <ellipse cx="8" cy="-3" rx="3" ry="2" fill="#ffb0a0" opacity="0.7" />
      <ellipse cx="24" cy="-3" rx="3" ry="2" fill="#ffb0a0" opacity="0.7" />
      <path d="M-26,2 q26,-14 52,0 q-26,10 -52,0 Z" fill="#a8d8f0" />
    </g>
    <Person x={92} y={288} scale={1} pose="stand" top="#7cc4f2" bottom="#5a6b8c" face="happy" longHair />
    <Person x={310} y={292} scale={0.96} pose="wave" top="#f2a0c0" bottom="#7a5a8c" face="happy" longHair hair={C.hairBrown} />
    <Sparkle x={236} y={132} r={9} color="#ffd7e6" />
  </>
))

/** 一起玩：地垫上爬的小宝宝，和陪玩的哥哥姐姐 */
const PlayWithBaby = def('play-with-baby', '一起玩', () => (
  <>
    <RoomWall wall="#fdf3e6" floor="#e8d5b8" floorY={210} />
    <ellipse cx="200" cy="262" rx="150" ry="46" fill="#ffe6b8" stroke="#e8cfa6" strokeWidth="4" />
    <ellipse cx="200" cy="262" rx="120" ry="34" fill="#fff2d4" />
    <Panel x={44} y={44} w={60} h={46} fill="#dff1fb" stroke="#e0b27e" sw={5} />
    <Panel x={296} y={52} w={60} h={46} fill="#ffe9f2" stroke="#e0b27e" sw={5} />
    <Person x={106} y={238} scale={0.96} pose="sit" top="#7cc4f2" bottom="#5a6b8c" face="happy" />
    <Person x={300} y={242} scale={0.9} pose="sit" top="#f2a0c0" bottom="#7a5a8c" face="happy" longHair flip />
    <g transform="translate(200 268)">
      <ellipse cx="0" cy="4" rx="26" ry="15" fill="#ffe6c4" />
      <circle cx="18" cy="-6" r="14" fill="#ffd9b5" />
      <path d="M8,-17 q10,-7 20,0" fill="none" stroke="#7a5236" strokeWidth="4" strokeLinecap="round" />
      <circle cx="15" cy="-7" r="2" fill={C.ink} />
      <circle cx="22" cy="-7" r="2" fill={C.ink} />
      <path d="M17,-2 q3,4 6,0" stroke={C.ink} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <ellipse cx="-24" cy="8" rx="12" ry="8" fill="#ffd9b5" />
    </g>
    <Teddy x={136} y={292} scale={0.6} />
    <g transform="translate(286 288)">
      <rect x="-16" y="-16" width="16" height="16" rx="3" fill="#f2c14e" />
      <rect x="2" y="-24" width="16" height="16" rx="3" fill="#7cc4f2" />
      <rect x="16" y="-12" width="16" height="16" rx="3" fill="#e2604f" />
    </g>
    <Balloon x={68} y={140} scale={0.7} color="#8fd0f0" />
    <Sparkle x={344} y={132} r={9} color="#fff3c4" />
  </>
))

/** 我的老师：黑板前讲课的老师，下面是听讲的学生 */
const TeacherClass = def('teacher-class', '我的老师', () => (
  <>
    <RoomWall wall="#f6f1e2" floor="#dfc9a4" floorY={236} />
    <Board x={172} y={104} w={224} h={104} />
    <rect x="336" y="34" width="44" height="30" rx="6" fill="#dff1fb" stroke="#e0b27e" strokeWidth="4" />
    <Person x={300} y={244} scale={1.02} pose="point" top="#c96a8c" bottom="#5a6b8c" face="happy" longHair hair={C.hairBrown} flip />
    <rect x="278" y="222" width="46" height="16" rx="5" fill="#f2e3c6" />
    <Desk x={92} y={272} w={118} h={44} />
    <Person x={70} y={264} scale={0.82} pose="sit" top="#7cc4f2" bottom="#5a6b8c" face="smile" />
    <Person x={116} y={266} scale={0.8} pose="sit" top="#f2c14e" bottom="#5a6b8c" face="smile" />
    <Book x={92} y={268} scale={0.5} />
    <Desk x={250} y={288} w={118} h={44} />
    <Person x={228} y={280} scale={0.8} pose="sit" top="#a8d8f0" bottom="#5a6b8c" face="smile" longHair />
    <Person x={274} y={282} scale={0.78} pose="sit" top="#e2a0c0" bottom="#5a6b8c" face="smile" />
    <Book x={250} y={284} scale={0.5} />
    <Panel x={352} y={186} w={36} h={28} fill="#fff3c4" stroke="#e0b27e" sw={3} />
  </>
))

/** 我的同桌：课桌前的两个人，一个认真一个笑 */
const Deskmate = def('deskmate', '我的同桌', () => (
  <>
    <RoomWall wall="#f7f2e4" floor="#dfc9a4" floorY={238} />
    <Board x={200} y={96} w={240} h={92} />
    <Panel x={44} y={44} w={46} h={34} fill="#dff1fb" stroke="#e0b27e" sw={4} />
    <Person x={140} y={250} scale={1} pose="sit" top="#7cc4f2" bottom="#5a6b8c" face="happy" />
    <Person x={262} y={250} scale={1} pose="sit" top="#f2c14e" bottom="#6b6f7a" face="happy" longHair flip />
    <Desk x={200} y={276} w={200} h={46} />
    <Book x={160} y={272} scale={0.7} />
    <g transform="translate(248 268)">
      <rect x="-22" y="-14" width="44" height="14" rx="4" fill="#ffffff" stroke="#d3bb96" strokeWidth="2" />
      <rect x="-22" y="-14" width="44" height="5" rx="2" fill="#a8d8f0" />
    </g>
    <g transform="translate(196 262)">
      <rect x="-4" y="-20" width="8" height="20" rx="3" fill="#f2b134" />
      <path d="M-4,-20 L0,-28 L4,-20 Z" fill="#f4e0bd" />
    </g>
    <SpeechBubble x={300} y={148} scale={0.9} />
    <Sparkle x={110} y={152} r={9} color="#fff3c4" />
  </>
))

/** 清晨的环卫工：天刚亮，扫街的人和一地落叶 */
const StreetCleaner = def('street-cleaner', '清晨的环卫工', () => (
  <>
    <Sky tone="dawn" />
    <Sun x={60} y={54} r={20} />
    <Cloud x={250} y={42} scale={0.7} opacity={0.75} />
    <g>
      <rect x="252" y="88" width="90" height="118" rx="5" fill="#e4d3bb" />
      <rect x="342" y="112" width="58" height="94" rx="5" fill="#d8c3a6" />
      <path d="M252,88 h90 l-10,-14 h-70 Z" fill="#c9563f" />
      {seeds(1409, 8).map((_s, i) => (
        <rect key={i} x={264 + (i % 3) * 26} y={104 + Math.floor(i / 3) * 34} width="16" height="18" rx="3" fill={i % 2 === 0 ? '#ffe9b8' : '#cfeaff'} />
      ))}
      {seeds(1427, 6).map((_s, i) => (
        <rect key={i} x={352 + (i % 2) * 24} y={126 + Math.floor(i / 2) * 32} width="14" height="16" rx="3" fill="#ffe9b8" />
      ))}
    </g>
    <rect x="0" y="206" width="400" height="94" fill="#c3bfb6" />
    <rect x="0" y="206" width="400" height="8" fill="#a9a49a" />
    <g stroke="#f6f0e0" strokeWidth="4" strokeDasharray="18 16" opacity="0.8">
      <line x1="0" y1="258" x2="400" y2="258" />
    </g>
    <Person x={150} y={266} scale={1} pose="run" top="#f28a4a" bottom="#4a5568" face="calm" />
    <Broom x={196} y={272} scale={1} rotate={16} />
    <g transform="translate(272 258)">
      <rect x="-34" y="-34" width="68" height="46" rx="8" fill="#6f9e5c" />
      <rect x="-38" y="-42" width="76" height="12" rx="5" fill="#4f7c42" />
      <rect x="-30" y="6" width="60" height="8" rx="4" fill="#4a453d" />
      <circle cx="-20" cy="18" r="9" fill="#4a453d" />
      <circle cx="20" cy="18" r="9" fill="#4a453d" />
    </g>
    <FallingLeaves count={12} seed={79} />
    <g fill="#e8a94a">
      {seeds(1439, 10).map((s, i) => (
        <ellipse key={i} cx={rnd(s, 20, 380)} cy={rnd(s + 4, 222, 292)} rx={rnd(s + 8, 4, 7)} ry={rnd(s + 12, 2, 3.4)} />
      ))}
    </g>
  </>
))

/** 雨天的快递员：雨衣、货箱、小电驴和一路水花 */
const RainDelivery = def('rain-delivery', '雨天的快递员', () => (
  <>
    <Sky tone="rain" />
    <g opacity="0.9">
      <rect x="20" y="86" width="96" height="120" rx="5" fill="#cfd8de" />
      <rect x="126" y="110" width="76" height="96" rx="5" fill="#c2ccd3" />
      <rect x="300" y="96" width="86" height="110" rx="5" fill="#cfd8de" />
      {seeds(1501, 12).map((_s, i) => (
        <rect key={i} x={30 + (i % 3) * 28} y={102 + Math.floor(i / 3) * 34} width="16" height="18" rx="3" fill="#e8eef2" />
      ))}
      {seeds(1519, 6).map((_s, i) => (
        <rect key={i} x={310 + (i % 2) * 30} y={112 + Math.floor(i / 2) * 34} width="16" height="18" rx="3" fill="#e8eef2" />
      ))}
    </g>
    <rect x="0" y="206" width="400" height="94" fill="#9aa4ac" />
    <rect x="0" y="206" width="400" height="8" fill="#848e96" />
    <ellipse cx="86" cy="272" rx="46" ry="12" fill="#8fd0f0" opacity="0.7" />
    <ellipse cx="330" cy="288" rx="56" ry="13" fill="#8fd0f0" opacity="0.7" />
    <Person x={212} y={258} scale={0.94} pose="sit" top="#f2c14e" bottom="#4a5568" face="calm" />
    <g transform="translate(214 274)">
      <circle cx="-40" cy="0" r="15" fill="#4a453d" />
      <circle cx="-40" cy="0" r="6" fill="#c9c2b4" />
      <circle cx="42" cy="0" r="15" fill="#4a453d" />
      <circle cx="42" cy="0" r="6" fill="#c9c2b4" />
      <path d="M-40,0 h24 l14,-24 h-20" fill="none" stroke="#e2604f" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M-16,0 h58" stroke="#e2604f" strokeWidth="7" strokeLinecap="round" />
      <path d="M34,-24 h14" stroke="#4a453d" strokeWidth="6" strokeLinecap="round" />
    </g>
    <g transform="translate(184 214)">
      <rect x="-30" y="-30" width="60" height="42" rx="7" fill="#e2b177" />
      <rect x="-30" y="-30" width="60" height="12" rx="5" fill="#c48f52" />
      <path d="M-14,-30 v42 M14,-30 v42" stroke="#c48f52" strokeWidth="3" />
    </g>
    <Umbrella x={318} y={216} scale={0.86} color="#f26a6a" dark="#c9563f" />
    <Rain count={54} seed={113} />
  </>
))

/** 这就是我：镜子里的自己和镜外的自己 */
const MirrorSelf = def('mirror-self', '这就是我', () => (
  <>
    <RoomWall wall="#fdf2e2" floor="#e6d2b2" floorY={236} />
    <Panel x={28} y={46} w={58} h={44} fill="#dff1fb" stroke="#e0b27e" sw={5} />
    <Plant x={344} y={232} scale={0.95} />
    <Mirror x={214} y={140} w={112} h={132} />
    <Person x={214} y={198} scale={0.72} pose="stand" top="#7cc4f2" bottom="#5a6b8c" face="happy" />
    <Person x={110} y={288} scale={1.06} pose="stand" top="#7cc4f2" bottom="#5a6b8c" face="happy" />
    <rect x="86" y="286" width="48" height="8" rx="4" fill="#c9b998" opacity="0.8" />
    <Sparkle x={276} y={78} r={11} color="#fff3c4" />
    <Sparkle x={160} y={104} r={8} color="#ffe0ee" />
    <Sparkle x={330} y={150} r={8} color="#fff3c4" opacity={0.8} />
  </>
))

/** 摔倒了：车子倒在一旁，膝盖擦破，同学伸手来扶 */
const BikeFail = def('bike-fail', '摔倒了', () => (
  <>
    <Sky tone="day" />
    <Cloud x={300} y={44} scale={0.78} opacity={0.9} />
    <Hill x={330} y={196} rx={150} ry={54} color="#bde5a4" />
    <Ground y={204} />
    <Path x={210} top={208} w={40} w2={150} />
    <Tree x={50} y={214} scale={0.72} kind="round" />
    <Bush x={358} y={236} scale={0.76} />
    <g transform="rotate(-30 272 268)">
      <Bike x={272} y={268} scale={0.92} color="#7cc4f2" dark="#5a6b8c" />
    </g>
    <Person x={148} y={270} scale={0.92} pose="sit" top="#f2c14e" bottom="#5a6b8c" face="sad" />
    <Person x={222} y={272} scale={0.9} pose="reach" top="#7cc4f2" bottom="#6b6f7a" face="smile" flip />
    <Sparkle x={196} y={196} r={10} color="#ffd7a0" opacity={0.7} />
    <GrassTuft x={96} y={286} scale={1.3} />
    <GrassTuft x={344} y={278} scale={1.1} />
  </>
))

/** 学会了：骑上自行车飞驰，爸爸在后面追着笑 */
const BikeRide = def('bike-ride', '学会了骑车', () => (
  <>
    <Sky tone="day" />
    <Sun x={60} y={48} r={20} />
    <Cloud x={280} y={40} scale={0.76} opacity={0.9} />
    <Hill x={70} y={196} rx={150} ry={56} color="#bde5a4" />
    <Ground y={204} />
    <Path x={200} top={210} w={42} w2={170} />
    <Tree x={348} y={212} scale={0.7} kind="round" />
    <Bush x={40} y={232} scale={0.8} />
    <Person x={176} y={258} scale={0.84} pose="sit" top="#e2604f" bottom="#3f5a7a" face="happy" />
    <g transform="translate(176 274) scale(1.05)">
      <circle cx="-32" cy="0" r="17" fill="none" stroke="#4a453d" strokeWidth="4" />
      <circle cx="32" cy="0" r="17" fill="none" stroke="#4a453d" strokeWidth="4" />
      <path d="M-32,0 L-8,-28 L24,-28 L32,0" fill="none" stroke="#e2604f" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M-8,-28 L4,0 L-32,0" fill="none" stroke="#e2604f" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24,-28 L18,-42" stroke="#4a453d" strokeWidth="4" strokeLinecap="round" />
      <path d="M8,-42 h20" stroke="#4a453d" strokeWidth="4" strokeLinecap="round" />
    </g>
    <g stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.85">
      <line x1="96" y1="248" x2="60" y2="248" />
      <line x1="100" y1="262" x2="56" y2="262" />
      <line x1="98" y1="276" x2="68" y2="276" />
    </g>
    <Person x={318} y={288} scale={0.92} pose="run" top="#4f8fd0" bottom="#5a6b8c" face="happy" flip />
    <Bird x={196} y={106} scale={0.48} fly />
  </>
))

/* ---------------- C. 写事 · 第一次 / 难忘 / 温暖 / 活动 / 犯错 ---------------- */

/** 准备开始：围裙、案板、摆好的食材，一切就绪 */
const CookStart = def('cook-start', '准备开始', () => (
  <>
    <RoomWall wall="#fdf1dc" floor="#e4cfae" floorY={236} />
    <rect x="236" y="40" width="140" height="88" rx="8" fill="#cfeaff" stroke="#e0b27e" strokeWidth="6" />
    <line x1="306" y1="40" x2="306" y2="128" stroke="#e0b27e" strokeWidth="4" />
    <rect x="30" y="44" width="120" height="18" rx="7" fill="#e8cfa6" />
    <Panel x={36} y={72} w={92} h={64} fill="#fffdf4" stroke="#e0b27e" sw={5} />
    <g stroke="#c9c2b4" strokeWidth="3" strokeLinecap="round">
      <line x1="48" y1="90" x2="114" y2="90" />
      <line x1="48" y1="104" x2="106" y2="104" />
      <line x1="48" y1="118" x2="112" y2="118" />
    </g>
    <Person x={200} y={228} scale={1.12} pose="stand" top="#f2a0c0" bottom="#5a6b8c" face="happy" longHair />
    <path d="M188,172 h24 l6,26 h-36 Z" fill="#fffdf4" stroke="#e0d3b8" strokeWidth="2" />
    <rect x="30" y="196" width="340" height="20" rx="8" fill="#f0dcbb" />
    <rect x="30" y="216" width="340" height="64" fill="#e2cba4" />
    <g transform="translate(96 194)">
      <ellipse cx="0" cy="0" rx="40" ry="9" fill="#e8cfa6" />
      <circle cx="-14" cy="-4" r="8" fill="#e2604f" />
      <circle cx="4" cy="-5" r="7" fill="#63bf5c" />
      <circle cx="20" cy="-4" r="6" fill="#f2c14e" />
    </g>
    <Bowl x={310} y={184} scale={0.62} contents="#f6d9a0" />
    <g transform="translate(268 180)">
      <ellipse cx="0" cy="0" rx="12" ry="16" fill="#fdf1d8" stroke="#e6d2ac" strokeWidth="2" />
      <ellipse cx="0" cy="0" rx="12" ry="16" fill="none" stroke="#e6d2ac" strokeWidth="2" />
    </g>
    <Sparkle x={330} y={150} r={9} color="#fff3c4" />
  </>
))

/** 手忙脚乱：面粉满天飞，锅也糊了，孩子满脸白 */
const CookMess = def('cook-mess', '手忙脚乱', () => (
  <>
    <RoomWall wall="#fdf1dc" floor="#e4cfae" floorY={236} />
    <rect x="236" y="40" width="140" height="88" rx="8" fill="#ffe0d8" stroke="#e0b27e" strokeWidth="6" />
    <g opacity="0.7" fill="#ffffff">
      {seeds(1601, 14).map((s, i) => (
        <circle key={i} cx={rnd(s, 40, 360)} cy={rnd(s + 5, 40, 200)} r={rnd(s + 9, 8, 26)} />
      ))}
    </g>
    <Person x={186} y={228} scale={1.02} pose="jump" top="#f2a0c0" bottom="#5a6b8c" face="surprised" longHair />
    <g fill="#ffffff">
      <circle cx="186" cy="166" r="7" />
      <circle cx="176" cy="174" r="5" />
      <circle cx="198" cy="178" r="4.5" />
      <circle cx="186" cy="150" r="4" />
    </g>
    <rect x="30" y="196" width="340" height="20" rx="8" fill="#f0dcbb" />
    <rect x="30" y="216" width="340" height="64" fill="#e2cba4" />
    <g transform="translate(84 194)">
      <path d="M-26,-6 h52 l-8,12 h-36 Z" fill="#f0dcbb" />
      <ellipse cx="0" cy="-6" rx="26" ry="6" fill="#e8cfa6" />
      <ellipse cx="18" cy="-3" rx="20" ry="7" fill="#fffdf4" opacity="0.95" />
    </g>
    <g transform="translate(300 190)">
      <path d="M-34,-6 q34,26 68,0 Z" fill="#b9bfc6" />
      <ellipse cx="0" cy="-6" rx="34" ry="9" fill="#9aa1a9" />
      <ellipse cx="0" cy="-6" rx="28" ry="6" fill="#6b4a2f" />
      <Steam x={0} y={-24} scale={0.6} opacity={0.5} />
    </g>
    <g transform="translate(200 262)">
      <ellipse cx="0" cy="0" rx="34" ry="8" fill="#ffffff" opacity="0.9" />
      <ellipse cx="0" cy="0" rx="20" ry="5" fill="#f0e6d2" />
    </g>
    <Sparkle x={120} y={128} r={10} color="#ffffff" />
    <Sparkle x={300} y={110} r={8} color="#ffffff" opacity={0.8} />
  </>
))

/** 端上桌了：一家人围坐，中间是刚出锅的菜 */
const CookDone = def('cook-done', '端上桌了', () => (
  <>
    <RoomWall wall="#fdf3e4" floor="#e6d2b2" floorY={228} />
    <rect x="130" y="34" width="150" height="76" rx="8" fill="#ffe9c4" stroke="#e0b27e" strokeWidth="6" />
    <line x1="205" y1="34" x2="205" y2="110" stroke="#e0b27e" strokeWidth="4" />
    <circle cx="272" cy="70" r="14" fill="#fff3c4" opacity="0.9" />
    <Person x={72} y={252} scale={0.9} pose="sit" top="#4f8fd0" bottom="#5a6b8c" face="happy" />
    <Person x={328} y={252} scale={0.9} pose="sit" top="#f2a0c0" bottom="#7a5a8c" face="happy" longHair hair={C.hairBrown} flip />
    <Person x={132} y={268} scale={0.8} pose="sit" top="#f2c14e" bottom="#6b6f7a" face="happy" />
    <Person x={272} y={268} scale={0.8} pose="sit" top="#7cc4f2" bottom="#6b6f7a" face="happy" flip />
    <rect x="60" y="222" width="280" height="16" rx="7" fill="#e8cfa6" />
    <rect x="60" y="238" width="280" height="62" fill="#d3bb96" />
    <g transform="translate(200 222)">
      <ellipse cx="0" cy="0" rx="52" ry="14" fill="#f6e6c8" />
      <ellipse cx="0" cy="-2" rx="40" ry="10" fill="#fffdf4" />
      <ellipse cx="0" cy="-2" rx="30" ry="7" fill="#f2a05c" />
      <circle cx="-10" cy="-3" r="5" fill="#63bf5c" />
      <circle cx="10" cy="-2" r="5" fill="#e2604f" />
      <Steam x={0} y={-24} scale={0.8} opacity={0.6} />
    </g>
    <g transform="translate(96 220)">
      <ellipse cx="0" cy="0" rx="26" ry="7" fill="#fffdf4" />
      <ellipse cx="0" cy="-1" rx="18" ry="5" fill="#ffe9b8" />
    </g>
    <g transform="translate(304 220)">
      <ellipse cx="0" cy="0" rx="26" ry="7" fill="#fffdf4" />
      <ellipse cx="0" cy="-1" rx="18" ry="5" fill="#c8e6a0" />
    </g>
    <Sparkle x={200} y={168} r={10} color="#fff3c4" />
  </>
))

/** 第一次上台：聚光灯下紧张的小孩，台下是一片脑袋 */
const StageNervous = def('stage-nervous', '第一次上台', () => (
  <>
    <rect x="0" y="0" width="400" height="300" fill="#5c4a7a" />
    <Spotlight x={200} top={30} w={54} w2={200} h={250} />
    <rect x="0" y="212" width="400" height="88" fill="#8a6a4a" />
    <rect x="0" y="206" width="400" height="10" rx="4" fill="#6f533a" />
    <Person x={200} y={268} scale={1.14} pose="stand" top="#f2c14e" bottom="#4a5568" face="surprised" />
    <g fill="#4a3a2a" opacity="0.85">
      {seeds(1709, 11).map((s, i) => (
        <circle key={i} cx={30 + i * 36} cy={rnd(s, 278, 292)} r={rnd(s + 5, 15, 20)} />
      ))}
    </g>
    <g fill="#3f3226" opacity="0.9">
      {seeds(1721, 9).map((s, i) => (
        <circle key={i} cx={14 + i * 46} cy={rnd(s, 292, 300)} r={rnd(s + 5, 17, 22)} />
      ))}
    </g>
    <Curtains />
    <Sparkle x={200} y={84} r={12} color="#fff3c4" />
    <Sparkle x={146} y={130} r={8} color="#ffe0b0" opacity={0.8} />
    <Sparkle x={256} y={130} r={8} color="#ffe0b0" opacity={0.8} />
  </>
))

/** 那一次，我很难忘：翻开的相册，里面是几张旧照片 */
const MemoryAlbum = def('memory-album', '那一次，我很难忘', () => (
  <>
    <RoomWall wall="#fdf0dc" floor="#e0c9a4" floorY={234} />
    <Panel x={20} y={44} w={58} h={44} fill="#ffe9c4" stroke="#e0b27e" sw={5} />
    <ellipse cx="200" cy="268" rx="150" ry="26" fill="#f6e6c8" />
    <g transform="translate(200 214)">
      <path d="M-152,0 L-152,-16 q76,-14 152,6 q76,-20 152,-6 L152,0 q-76,-14 -152,6 q-76,-20 -152,6 Z" fill="#c9563f" />
      <path d="M-146,-1 L-146,-14 q72,-12 144,5 q72,-17 144,-5 L144,-1 q-72,-12 -144,5 q-72,-17 -144,5 Z" fill="#fffdf4" />
      <g transform="translate(-76 -2) rotate(-5)">
        <Panel x={-58} y={-44} w={116} h={80} r={6} fill="#dff1fb" stroke="#e0b27e" sw={5} />
        <circle cx="-16" cy="-8" r="14" fill="#ffd45e" />
        <path d="M-56,26 q22,-26 44,0 Z" fill="#95da6c" />
        <Person x={22} y={28} scale={0.5} pose="wave" top="#e2604f" bottom="#5a6b8c" face="happy" />
      </g>
      <g transform="translate(76 -2) rotate(5)">
        <Panel x={-58} y={-44} w={116} h={80} r={6} fill="#ffe9f2" stroke="#e0b27e" sw={5} />
        <circle cx="18" cy="-14" r="12" fill="#ffd45e" />
        <path d="M-56,26 q20,-22 40,-2 q16,16 40,-6 l16,8 v8 h-96 Z" fill="#a8d8f0" />
        <Person x={-14} y={28} scale={0.5} pose="stand" top="#f2a0c0" bottom="#5a6b8c" face="happy" longHair />
      </g>
    </g>
    <Person x={330} y={288} scale={0.92} pose="sit" top="#7cc4f2" bottom="#5a6b8c" face="happy" flip />
    <Sparkle x={68} y={116} r={10} color="#fff3c4" />
    <Sparkle x={344} y={136} r={9} color="#ffe0ee" />
  </>
))

/** 找不到妈妈了：人堆里的小个子，仰着头四处张望 */
const LostCrowd = def('lost-crowd', '找不到妈妈了', () => (
  <>
    <Sky tone="day" />
    <g opacity="0.85">
      <rect x="0" y="60" width="120" height="146" fill="#e0cdb0" />
      <rect x="130" y="86" width="110" height="120" fill="#d6c0a0" />
      <rect x="250" y="70" width="150" height="136" fill="#e0cdb0" />
      <path d="M0,60 h120 l-12,-14 h-96 Z" fill="#c9563f" />
      <path d="M250,70 h150 l-12,-14 h-126 Z" fill="#c9563f" />
      {seeds(1801, 10).map((_s, i) => (
        <rect key={i} x={12 + (i % 5) * 24} y={92 + Math.floor(i / 5) * 40} width="14" height="20" rx="3" fill="#f4e6cc" />
      ))}
    </g>
    <rect x="0" y="206" width="400" height="94" fill="#c3bfb6" />
    <g opacity="0.75">
      {seeds(1811, 5).map((_s, i) => (
        <Person key={`b${i}`} x={30 + i * 86} y={250} scale={0.98} pose="stand" top={['#7c8fa8', '#c96a6a', '#6f9e5c', '#a8845c', '#8d7fae'][i]} bottom="#4a5568" face="calm" />
      ))}
    </g>
    <g opacity="0.95">
      {seeds(1823, 6).map((_s, i) => (
        <Person key={`m${i}`} x={8 + i * 78} y={288} scale={1.16} pose={i % 2 === 0 ? 'stand' : 'run'} top={['#5c7a9c', '#b8607a', '#5f8c6a', '#8d6a4a', '#6a6a9c', '#9c7a5c'][i]} bottom="#3f4a5c" face="calm" />
      ))}
    </g>
    <Person x={196} y={300} scale={0.94} pose="stand" top="#f2c14e" bottom="#6b6f7a" face="sad" />
    <SpeechBubble x={272} y={198} scale={0.8} />
    <g opacity="0.5" stroke="#fff3c4" strokeWidth="3" strokeLinecap="round">
      <path d="M232,220 q10,-14 22,-16" fill="none" />
    </g>
  </>
))

/** 终于找到了：妈妈蹲下来张开手，孩子扑进怀里 */
const FoundMom = def('found-mom', '终于找到了', () => (
  <>
    <Sky tone="day" />
    <g opacity="0.7">
      <rect x="0" y="80" width="110" height="126" fill="#e0cdb0" />
      <rect x="300" y="96" width="100" height="110" fill="#d6c0a0" />
      <path d="M0,80 h110 l-12,-14 h-86 Z" fill="#c9563f" />
      <path d="M300,96 h100 l-12,-14 h-76 Z" fill="#c9563f" />
    </g>
    <rect x="0" y="206" width="400" height="94" fill="#c3bfb6" />
    <g opacity="0.4">
      {seeds(1841, 4).map((_s, i) => (
        <Person key={i} x={24 + i * 120} y={282} scale={1.02} pose="stand" top="#8d94a0" bottom="#5a6472" face="calm" />
      ))}
    </g>
    <Person x={224} y={286} scale={1.06} pose="sit" top="#f2a0c0" bottom="#7a5a8c" face="happy" longHair hair={C.hairBrown} flip />
    <Person x={148} y={288} scale={0.86} pose="reach" top="#f2c14e" bottom="#6b6f7a" face="happy" />
    <path d="M186,232 q-6,-10 2,-14 q4,4 8,0 q8,4 2,14 Z" fill="#ff8f9c" opacity="0.85" />
    <Sparkle x={192} y={202} r={11} color="#ffd7e6" />
    <Sparkle x={120} y={172} r={8} color="#fff3c4" />
    <Sparkle x={266} y={180} r={8} color="#fff3c4" />
  </>
))

/** 他扶了我一把：操场上摔倒的同学，伸过来的那只手 */
const HelpHand = def('help-hand', '他扶了我一把', () => (
  <>
    <Sky tone="day" />
    <Cloud x={86} y={44} scale={0.78} opacity={0.9} />
    <Sun x={338} y={48} r={20} />
    <Hill x={330} y={194} rx={150} ry={54} color="#bde5a4" />
    <Ground y={204} />
    <Path x={70} top={208} w={36} w2={130} />
    <Tree x={352} y={212} scale={0.68} kind="round" />
    <Person x={142} y={280} scale={0.94} pose="sit" top="#f2c14e" bottom="#5a6b8c" face="sad" />
    <Person x={228} y={276} scale={0.98} pose="reach" top="#7cc4f2" bottom="#6b6f7a" face="smile" flip />
    <g stroke="#c9c2b4" strokeWidth="3" strokeLinecap="round">
      <path d="M196,238 q10,-6 18,-2" fill="none" />
      <path d="M192,250 q12,-4 20,0" fill="none" />
    </g>
    <circle cx="136" cy="276" r="7" fill="#ffb0a0" opacity="0.8" />
    <GrassTuft x={74} y={286} scale={1.2} />
    <GrassTuft x={318} y={280} scale={1} />
    <Bird x={200} y={112} scale={0.46} fly />
    <Sparkle x={186} y={214} r={9} color="#ffe0b0" />
  </>
))

/** 雨中送伞：一把伞下两个人，脚下是水花 */
const UmbrellaRain = def('umbrella-rain', '雨中送伞', () => (
  <>
    <Sky tone="rain" />
    <g opacity="0.85">
      <rect x="0" y="86" width="104" height="120" fill="#cfd8de" />
      <rect x="112" y="110" width="86" height="96" fill="#c2ccd3" />
      <rect x="300" y="92" width="100" height="114" fill="#cfd8de" />
      <path d="M0,86 h104 l-12,-14 h-80 Z" fill="#9aa4ac" />
      <path d="M300,92 h100 l-12,-14 h-76 Z" fill="#9aa4ac" />
    </g>
    <rect x="0" y="206" width="400" height="94" fill="#9aa4ac" />
    <rect x="0" y="206" width="400" height="8" fill="#848e96" />
    <ellipse cx="120" cy="280" rx="56" ry="13" fill="#8fd0f0" opacity="0.65" />
    <ellipse cx="300" cy="290" rx="60" ry="13" fill="#8fd0f0" opacity="0.65" />
    <Tree x={40} y={210} scale={0.6} kind="round" />
    <Person x={186} y={286} scale={0.94} pose="stand" top="#4f8fd0" bottom="#4a5568" face="happy" />
    <Person x={228} y={288} scale={0.84} pose="stand" top="#f2c14e" bottom="#4a5568" face="happy" />
    <Umbrella x={208} y={196} scale={1.06} color="#ff9b6b" dark="#e07c4d" />
    <Rain count={52} seed={127} />
  </>
))

/** 热闹的运动会：跑道上的选手、彩旗和看台 */
const SportsDay = def('sports-day', '热闹的运动会', () => (
  <>
    <Sky tone="day" />
    <Sun x={58} y={46} r={20} />
    <g>
      <path d="M0,34 q50,14 100,0 q50,14 100,0 q50,14 100,0 q50,14 100,0 L400,34 L400,44 q-50,14 -100,0 q-50,14 -100,0 q-50,14 -100,0 q-50,14 -100,0 Z" fill="#f26a6a" />
      {seeds(1901, 8).map((_s, i) => (
        <path key={i} d={`M${i * 52 + 6},44 l26,0 l-13,22 Z`} fill={['#ffd166', '#7cc4f2', '#63bf5c', '#c9a2ff'][i % 4]} />
      ))}
    </g>
    <g opacity="0.9">
      <rect x="0" y="112" width="120" height="94" fill="#e0cdb0" />
      <rect x="290" y="126" width="110" height="80" fill="#d6c0a0" />
    </g>
    <ellipse cx="200" cy="252" rx="200" ry="66" fill="#e08a6a" />
    <ellipse cx="200" cy="252" rx="176" ry="54" fill="#a8dc8a" />
    <g stroke="#f6f0e0" strokeWidth="3" strokeDasharray="12 10" fill="none">
      <ellipse cx="200" cy="252" rx="150" ry="44" />
      <ellipse cx="200" cy="252" rx="112" ry="32" />
    </g>
    <rect x="46" y="196" width="6" height="42" fill="#f6f0e0" />
    <rect x="46" y="196" width="60" height="10" rx="4" fill="#f6f0e0" />
    <Person x={118} y={272} scale={0.9} pose="run" top="#e2604f" bottom="#3f5a7a" face="happy" />
    <Person x={168} y={280} scale={0.88} pose="run" top="#7cc4f2" bottom="#3f5a7a" face="happy" />
    <Person x={222} y={284} scale={0.86} pose="run" top="#f2c14e" bottom="#3f5a7a" face="happy" />
    <Person x={276} y={288} scale={0.84} pose="run" top="#c9a2ff" bottom="#3f5a7a" face="happy" />
    <g opacity="0.75">
      {seeds(1913, 7).map((_s, i) => (
        <Person key={i} x={26 + i * 58} y={208} scale={0.62} pose="wave" top={['#e2604f', '#7cc4f2', '#63bf5c', '#ffd166', '#c9a2ff', '#f2a0c0', '#8fd0f0'][i]} bottom="#4a5568" face="happy" />
      ))}
    </g>
    <Sparkle x={332} y={78} r={10} color="#fff3c4" />
  </>
))

/** 春游·大巴：车门口排队上车，老师在旁边点名 */
const SpringOutingBus = def('spring-outing-bus', '春游·大巴', () => (
  <>
    <Sky tone="day" />
    <Sun x={60} y={48} r={22} />
    <Cloud x={286} y={40} scale={0.8} opacity={0.9} />
    <Hill x={70} y={194} rx={150} ry={54} color="#c2e8a9" />
    <Ground y={204} />
    <rect x="0" y="256" width="400" height="44" fill="#c3bfb6" />
    <Bus x={210} y={262} scale={0.92} />
    <Person x={76} y={288} scale={0.94} pose="wave" top="#c96a8c" bottom="#5a6b8c" face="happy" longHair hair={C.hairBrown} />
    <Person x={122} y={294} scale={0.86} pose="stand" top="#f2c14e" bottom="#5a6b8c" face="happy" />
    <Person x={52} y={296} scale={0.8} pose="stand" top="#7cc4f2" bottom="#5a6b8c" face="happy" />
    <Tree x={352} y={214} scale={0.68} kind="blossom" />
    <Bush x={16} y={228} scale={0.72} />
    <Petals count={12} seed={41} />
  </>
))

/** 春游·野餐：草地上的格子布和一圈小伙伴 */
const SpringOutingPicnic = def('spring-outing-picnic', '春游·野餐', () => (
  <>
    <Sky tone="day" />
    <Sun x={338} y={48} r={21} />
    <Cloud x={80} y={42} scale={0.78} opacity={0.9} />
    <Hill x={70} y={192} rx={150} ry={54} color="#c2e8a9" />
    <Ground y={200} />
    <Tree x={44} y={208} scale={0.72} kind="blossom" />
    <Tree x={360} y={204} scale={0.6} kind="round" />
    <g transform="translate(200 256)">
      <path d="M-130,0 L130,0 L104,-56 L-104,-56 Z" fill="#ffd7e6" />
      <path d="M-130,0 L130,0 L104,-56 L-104,-56 Z" fill="none" stroke="#f2a0c0" strokeWidth="3" />
      {seeds(2001, 12).map((_s, i) => (
        <path key={i} d={`M${-120 + i * 22},-56 l0,56`} stroke="#f2a0c0" strokeWidth="2" opacity="0.6" />
      ))}
      {seeds(2017, 4).map((_s, i) => (
        <path key={`h${i}`} d={`M-130,${-14 * (i + 1)} l260,0`} stroke="#f2a0c0" strokeWidth="2" opacity="0.6" />
      ))}
    </g>
    <Basket x={262} y={244} scale={0.9} />
    <Person x={136} y={252} scale={0.86} pose="sit" top="#7cc4f2" bottom="#5a6b8c" face="happy" />
    <Person x={188} y={248} scale={0.86} pose="sit" top="#f2a0c0" bottom="#7a5a8c" face="happy" longHair />
    <Person x={246} y={262} scale={0.8} pose="sit" top="#f2c14e" bottom="#6b6f7a" face="happy" flip />
    <Bowl x={166} y={232} scale={0.5} contents="#f6d9a0" />
    <g transform="translate(212 232)">
      <ellipse cx="0" cy="0" rx="16" ry="5" fill="#fffdf4" />
      <ellipse cx="0" cy="-1" rx="11" ry="3.6" fill="#e2604f" />
    </g>
    <Balloon x={64} y={150} scale={0.62} color="#8fd0f0" />
    <Petals count={14} seed={37} />
  </>
))

/** 春游·游戏：放风筝、追泡泡，满草地跑 */
const SpringOutingPlay = def('spring-outing-play', '春游·游戏', () => (
  <>
    <Sky tone="day" />
    <Sun x={54} y={46} r={21} />
    <Cloud x={148} y={40} scale={0.8} opacity={0.9} />
    <Cloud x={322} y={62} scale={0.62} opacity={0.8} />
    <Hill x={340} y={194} rx={150} ry={54} color="#bde5a4" />
    <Ground y={204} />
    <Tree x={44} y={212} scale={0.74} kind="round" />
    <Tree x={358} y={208} scale={0.62} kind="blossom" />
    <Kite x={196} y={106} scale={1.1} color="#ff8f8f" dark="#e06767" />
    <path d="M196,128 q10,60 -18,110" fill="none" stroke="#b9b0a3" strokeWidth="1.6" />
    <Person x={196} y={268} scale={0.92} pose="reach" top="#7cc4f2" bottom="#5a6b8c" face="happy" />
    <Person x={124} y={282} scale={0.86} pose="run" top="#f2c14e" bottom="#6b6f7a" face="happy" />
    <Person x={290} y={288} scale={0.84} pose="run" top="#f2a0c0" bottom="#6b6f7a" face="happy" longHair flip />
    <g fill="#8fd0f0" opacity="0.6">
      <circle cx="86" cy="176" r="12" />
      <circle cx="66" cy="146" r="8" />
      <circle cx="106" cy="136" r="6" />
      <circle cx="316" cy="164" r="10" />
      <circle cx="336" cy="136" r="7" />
    </g>
    <Balloon x={344} y={120} scale={0.6} color="#c9a2ff" />
    <Petals count={16} seed={53} />
  </>
))

/** 大扫除：擦窗的、扫地的、提水的，教室一片忙 */
const CleaningClass = def('cleaning-class', '大扫除', () => (
  <>
    <RoomWall wall="#f7f2e4" floor="#dfc9a4" floorY={232} />
    <Board x={92} y={98} w={150} h={86} />
    <rect x="230" y="44" width="140" height="92" rx="8" fill="#d6efff" stroke="#e0b27e" strokeWidth="6" />
    <line x1="300" y1="44" x2="300" y2="136" stroke="#e0b27e" strokeWidth="4" />
    <line x1="230" y1="90" x2="370" y2="90" stroke="#e0b27e" strokeWidth="4" />
    <Cloud x={262} y={70} scale={0.34} opacity={0.9} />
    <Person x={122} y={272} scale={0.96} pose="reach" top="#7cc4f2" bottom="#5a6b8c" face="happy" />
    <Broom x={168} y={276} scale={1} rotate={-18} />
    <Person x={268} y={278} scale={0.9} pose="reach" top="#f2c14e" bottom="#6b6f7a" face="happy" flip />
    <g transform="translate(318 268)">
      <path d="M-22,-20 h44 l-5,20 h-34 Z" fill="#8fd0f0" />
      <ellipse cx="0" cy="-20" rx="22" ry="7" fill="#5eb0da" />
      <path d="M-22,-20 q22,-18 44,0" fill="none" stroke="#5eb0da" strokeWidth="3" />
      <ellipse cx="0" cy="-20" rx="18" ry="5" fill="#dff3ff" opacity="0.85" />
    </g>
    <Desk x={78} y={224} w={100} h={38} />
    <g stroke="#c9c2b4" strokeWidth="3" strokeLinecap="round" opacity="0.8">
      <path d="M150,200 q14,-8 26,-4" fill="none" />
      <path d="M148,212 q16,-6 28,-2" fill="none" />
    </g>
    <Sparkle x={352} y={168} r={10} color="#fff3c4" />
    <Sparkle x={188} y={158} r={8} color="#ffffff" opacity={0.8} />
  </>
))

/** 说谎与承认：低着头的孩子，和蹲下来听的大人 */
const LieTruth = def('lie-truth', '说谎与承认', () => (
  <>
    <RoomWall wall="#fdf1e0" floor="#e6d2b2" floorY={234} />
    <Panel x={28} y={44} w={62} h={48} fill="#dff1fb" stroke="#e0b27e" sw={5} />
    <Desk x={318} y={228} w={120} h={40} />
    <Vase x={318} y={188} scale={0.7} color="#8fd0f0" />
    <Flower x={310} y={188} scale={0.7} petal="#ff9fc0" />
    <Person x={150} y={286} scale={1.02} pose="stand" top="#7cc4f2" bottom="#5a6b8c" face="sad" />
    <Person x={252} y={292} scale={1.1} pose="sit" top="#8fb98c" bottom="#5a6b8c" face="calm" hair={C.hairBrown} flip />
    <g opacity="0.85">
      <circle cx="150" cy="222" r="5" fill="#8fd0f0" opacity="0.7" />
      <circle cx="136" cy="238" r="3.6" fill="#8fd0f0" opacity="0.6" />
      <circle cx="160" cy="242" r="3" fill="#8fd0f0" opacity="0.5" />
    </g>
    <SpeechBubble x={214} y={186} scale={0.86} />
    <Sparkle x={92} y={124} r={9} color="#fff3c4" opacity={0.8} />
  </>
))

/** 打碎花瓶：一地碎片和散落的花，猫在一旁，孩子愣住 */
const BrokenVase = def('broken-vase', '打碎花瓶', () => (
  <>
    <RoomWall wall="#fdf1e0" floor="#e6d2b2" floorY={226} />
    <rect x="248" y="40" width="132" height="92" rx="8" fill="#d6efff" stroke="#e0b27e" strokeWidth="6" />
    <line x1="314" y1="40" x2="314" y2="132" stroke="#e0b27e" strokeWidth="4" />
    <circle cx="290" cy="70" r="10" fill="#ffd45e" opacity="0.9" />
    <Desk x={320} y={226} w={110} h={40} />
    <Person x={130} y={286} scale={1.04} pose="stand" top="#f2c14e" bottom="#6b6f7a" face="surprised" />
    <g stroke="#8fd0f0" strokeWidth="2.5" fill="#b9e2f6">
      <path d="M196,268 l14,-10 l8,12 Z" />
      <path d="M216,276 l16,-8 l4,12 Z" />
      <path d="M180,282 l12,-8 l6,10 Z" />
      <path d="M236,286 l14,-10 l8,12 Z" />
    </g>
    <path d="M186,282 q8,-8 14,-2" stroke="#c9563f" strokeWidth="2" fill="none" />
    <Flower x={200} y={292} scale={0.9} petal="#ff9fc0" />
    <Flower x={232} y={300} scale={0.8} petal="#c9a2ff" />
    <ellipse cx="252" cy="288" rx="20" ry="8" fill="#e8f4fb" opacity="0.8" />
    <Cat x={298} y={300} scale={0.78} color="#f3a860" dark="#dd8b45" />
    <g fill="#8fd0f0" opacity="0.55">
      <ellipse cx="204" cy="270" rx="10" ry="3.4" />
      <ellipse cx="228" cy="280" rx="7" ry="2.6" />
    </g>
    <Sparkle x={96} y={126} r={9} color="#fff3c4" opacity={0.8} />
  </>
))

/* ---------------- D. 状物 · 小动物 / 植物 / 学习用品 / 心爱之物 / 美食 ---------------- */

/** 晒太阳的猫：地板上一道光，猫蜷在光里打盹 */
const CatSun = def('cat-sun', '晒太阳的猫', () => (
  <>
    <RoomWall wall="#fdf2e0" floor="#e8d3ae" floorY={216} />
    <rect x="248" y="36" width="132" height="96" rx="8" fill="#d6efff" stroke="#e0b27e" strokeWidth="6" />
    <line x1="314" y1="36" x2="314" y2="132" stroke="#e0b27e" strokeWidth="4" />
    <circle cx="290" cy="64" r="11" fill="#ffd45e" />
    <path d="M262,132 L392,132 L400,300 L196,300 Z" fill="#fff3c4" opacity="0.5" />
    <path d="M262,132 L392,132 L400,300 L196,300 Z" fill="none" />
    <Cat x={178} y={268} scale={1.2} color="#f3a860" dark="#dd8b45" tailUp={false} />
    <g stroke={C.ink} strokeWidth="2" fill="none" strokeLinecap="round">
      <path d="M170,230 q4,4 8,0" />
      <path d="M188,230 q4,4 8,0" />
    </g>
    <g fill="#8fd0f0" opacity="0.55">
      <circle cx="240" cy="212" r="14" />
      <path d="M232,214 q8,8 16,0" stroke="#5eb0da" strokeWidth="2" fill="none" />
    </g>
    <Plant x={60} y={226} scale={0.98} />
    <g transform="translate(120 200)">
      <circle cx="0" cy="0" r="3" fill="#c9c2b4" opacity="0.8" />
      <circle cx="16" cy="-12" r="2.4" fill="#c9c2b4" opacity="0.6" />
      <circle cx="4" cy="-20" r="2" fill="#c9c2b4" opacity="0.5" />
    </g>
    <Sparkle x={330} y={170} r={10} color="#fff3c4" />
  </>
))

/** 小狗迎接：门一开，小狗摇着尾巴冲过来 */
const DogWelcome = def('dog-welcome', '小狗迎接', () => (
  <>
    <RoomWall wall="#fdf2e2" floor="#e2c9a4" floorY={228} />
    <g transform="translate(60 228)">
      <rect x="-46" y="-136" width="92" height="136" rx="8" fill="#c98d5a" />
      <rect x="-40" y="-130" width="80" height="130" rx="6" fill="#e2b177" />
      <rect x="-32" y="-118" width="64" height="52" rx="5" fill="#c48f52" />
      <rect x="-32" y="-56" width="64" height="46" rx="5" fill="#c48f52" />
      <circle cx="24" cy="-62" r="5" fill="#ffd45e" />
    </g>
    <rect x="96" y="70" width="270" height="120" rx="6" fill="#f4e6cc" opacity="0.6" />
    <Panel x={236} y={62} w={64} h={48} fill="#dff1fb" stroke="#e0b27e" sw={5} />
    <Desk x={330} y={228} w={110} h={40} />
    <Person x={330} y={286} scale={0.94} pose="wave" top="#7cc4f2" bottom="#5a6b8c" face="happy" flip />
    <Dog x={186} y={276} scale={1.1} tongue />
    <g stroke="#e0b27e" strokeWidth="3" strokeLinecap="round" opacity="0.9">
      <path d="M208,262 q12,-10 22,-8" fill="none" />
      <path d="M212,276 q14,-8 24,-4" fill="none" />
    </g>
    <g stroke="#c9c2b4" strokeWidth="3" strokeLinecap="round" opacity="0.7">
      <path d="M130,262 h-18" />
      <path d="M132,274 h-24" />
      <path d="M130,286 h-16" />
    </g>
    <Sparkle x={150} y={200} r={10} color="#ffe0b0" />
    <Sparkle x={244} y={162} r={8} color="#fff3c4" opacity={0.8} />
  </>
))

/** 窗边的小鸟：停在窗台上的小鸟，孩子在旁边静静看 */
const BirdWindow = def('bird-window', '窗边的小鸟', () => (
  <>
    <Sky tone="day" />
    <Hill x={90} y={162} rx={140} ry={44} color="#bde5a4" />
    <Tree x={140} y={168} scale={0.42} kind="round" />
    <Cloud x={276} y={62} scale={0.5} opacity={0.85} />
    <WallFrame x={72} y={36} w={256} h={142} />
    <WindowPane x={72} y={36} w={256} h={142} />
    <rect x="0" y="178" width="400" height="122" fill="#f6e9d2" />
    <rect x="0" y="178" width="400" height="12" rx="4" fill="#e0b27e" />
    <rect x="40" y="190" width="320" height="16" rx="6" fill="#e8cfa6" />
    <Bird x={214} y={184} scale={1.15} color="#6fb3ff" belly="#e8f4ff" />
    <g stroke="#8fd0f0" strokeWidth="1.6" opacity="0.8" fill="none">
      <path d="M206,190 q-8,-4 -14,0" />
      <path d="M206,194 q-8,4 -14,0" />
    </g>
    <Person x={112} y={292} scale={1} pose="stand" top="#f2a0c0" bottom="#7a5a8c" face="happy" longHair />
    <Plant x={336} y={210} scale={0.72} />
    <Sparkle x={264} y={168} r={9} color="#fff3c4" />
    <Sparkle x={70} y={128} r={8} color="#ffe0ee" opacity={0.8} />
  </>
))

/** 绿萝：书架上一盆垂下来的绿萝 */
const Pothos = def('pothos', '绿萝', () => (
  <>
    <RoomWall wall="#fdf3e6" floor="#e2c9a4" floorY={238} />
    <rect x="236" y="34" width="148" height="104" rx="8" fill="#d6efff" stroke="#e0b27e" strokeWidth="6" />
    <line x1="310" y1="34" x2="310" y2="138" stroke="#e0b27e" strokeWidth="4" />
    <circle cx="280" cy="64" r="11" fill="#ffd45e" />
    <Cloud x={344} y={92} scale={0.34} opacity={0.9} />
    <g>
      <rect x="30" y="188" width="230" height="12" rx="5" fill="#c98d5a" />
      <rect x="30" y="200" width="230" height="8" fill="#a4723f" />
      <rect x="42" y="208" width="10" height="52" fill="#b57a4b" />
      <rect x="238" y="208" width="10" height="52" fill="#b57a4b" />
    </g>
    <g>
      <rect x="252" y="164" width="12" height="24" rx="3" fill="#e2604f" />
      <rect x="270" y="158" width="12" height="30" rx="3" fill="#7cc4f2" />
      <rect x="288" y="166" width="12" height="22" rx="3" fill="#63bf5c" />
      <rect x="306" y="160" width="12" height="28" rx="3" fill="#f2c14e" />
      <rect x="252" y="192" width="66" height="6" rx="3" fill="#c98d5a" />
    </g>
    <Plant x={112} y={188} scale={1.5} />
    <g stroke="#3a8c48" strokeWidth="2.4" fill="none">
      <path d="M96,188 q-14,26 -6,52" />
    </g>
    <path d="M84,226 q-12,-2 -16,-12 q12,-2 16,12 Z" fill="#4fae5a" />
    <path d="M90,246 q12,-4 14,-14 q-14,-2 -14,14 Z" fill="#3a8c48" />
    <Sparkle x={330} y={196} r={9} color="#fff3c4" opacity={0.8} />
  </>
))

/** 蒲公英：草地上的绒球，风一吹种子飞起来 */
const DandelionScene = def('dandelion', '蒲公英', () => (
  <>
    <Sky tone="day" />
    <Sun x={330} y={48} r={22} />
    <Cloud x={78} y={44} scale={0.76} opacity={0.9} />
    <Hill x={70} y={194} rx={150} ry={54} color="#c2e8a9" />
    <Ground y={202} />
    <Dandelion x={168} y={278} scale={1.5} />
    <Dandelion x={66} y={286} scale={1.1} />
    <Dandelion x={300} y={292} scale={0.95} />
    <GrassTuft x={110} y={288} scale={1.4} />
    <GrassTuft x={244} y={296} scale={1.2} />
    <Person x={112} y={252} scale={0.78} pose="reach" top="#f2c14e" bottom="#6b6f7a" face="happy" />
    <g fill="#ffffff" opacity="0.95">
      {seeds(2101, 12).map((s, i) => (
        <g key={i} transform={`translate(${rnd(s, 160, 396)} ${rnd(s + 5, 40, 200)})`}>
          <circle cx="0" cy="0" r={rnd(s + 9, 3, 6)} />
          <path d="M0,0 q-8,-4 -12,0 M0,0 q8,-4 12,0 M0,0 q0,-10 0,-12" stroke="#ffffff" strokeWidth="1.2" fill="none" opacity="0.7" />
        </g>
      ))}
    </g>
    <Bird x={220} y={112} scale={0.48} fly />
    <Sparkle x={200} y={92} r={9} color="#ffffff" opacity={0.85} />
  </>
))

/** 书包：椅背上挂着的书包，桌上是摊开的书 */
const BackpackScene = def('backpack', '我的书包', () => (
  <>
    <RoomWall wall="#f7f2e4" floor="#dfc9a4" floorY={236} />
    <Board x={200} y={92} w={240} h={88} />
    <Panel x={40} y={40} w={48} h={36} fill="#dff1fb" stroke="#e0b27e" sw={4} />
    <g transform="translate(150 236)">
      <rect x="-38" y="-58" width="76" height="12" rx="5" fill="#c98d5a" />
      <rect x="-30" y="-46" width="12" height="46" fill="#b57a4b" />
      <rect x="18" y="-46" width="12" height="46" fill="#b57a4b" />
      <rect x="-38" y="-72" width="10" height="20" rx="4" fill="#b57a4b" />
      <rect x="28" y="-72" width="10" height="20" rx="4" fill="#b57a4b" />
      <rect x="-38" y="-78" width="76" height="10" rx="4" fill="#c98d5a" />
    </g>
    <Backpack x={150} y={182} scale={1.24} color="#6fb3ff" dark="#4a90db" pocket="#ffe08a" />
    <Desk x={296} y={250} w={140} h={46} />
    <Book x={296} y={244} scale={0.86} />
    <g transform="translate(266 232)">
      <rect x="-4" y="-22" width="8" height="22" rx="3" fill="#f2b134" />
      <path d="M-4,-22 L0,-30 L4,-22 Z" fill="#f4e0bd" />
    </g>
    <g transform="translate(344 236)">
      <rect x="-16" y="-10" width="32" height="10" rx="3" fill="#ff9fb0" />
    </g>
    <Sparkle x={104} y={152} r={9} color="#fff3c4" />
  </>
))

/** 会说话的橡皮：橡皮长了张脸，铅笔在旁边听 */
const EraserTalking = def('eraser-talking', '会说话的橡皮', () => (
  <>
    <RoomWall wall="#fdf3e4" floor="#e8d3ae" floorY={250} />
    <rect x="30" y="34" width="140" height="96" rx="8" fill="#d6efff" stroke="#e0b27e" strokeWidth="6" />
    <line x1="100" y1="34" x2="100" y2="130" stroke="#e0b27e" strokeWidth="4" />
    <circle cx="70" cy="64" r="10" fill="#ffd45e" />
    <rect x="0" y="212" width="400" height="88" fill="#f0dcbb" />
    <rect x="0" y="212" width="400" height="10" fill="#d3bb96" />
    <g transform="translate(0 214)">
      <rect x="30" y="0" width="200" height="86" rx="4" fill="#fffdf4" />
      <g stroke="#c9c2b4" strokeWidth="2" strokeLinecap="round">
        {seeds(2201, 5).map((_s, i) => (
          <line key={i} x1="46" y1={18 + i * 16} x2={214 - (i % 2) * 30} y2={18 + i * 16} />
        ))}
      </g>
    </g>
    <Eraser x={228} y={272} scale={1.9} color="#ff9fb0" dark="#e07a8f" />
    <Pencil x={316} y={276} scale={1.2} rotate={68} face />
    <SpeechBubble x={200} y={148} scale={1} w={96} h={54} />
    <Sparkle x={132} y={168} r={9} color="#ffe0ee" />
    <Sparkle x={300} y={196} r={8} color="#fff3c4" opacity={0.85} />
  </>
))

/** 针线盒：打开的盒子、几轴彩线、扣子和顶针 */
const SewingBox = def('sewing-box', '针线盒', () => (
  <>
    <RoomWall wall="#fdf1e0" floor="#e2c9a4" floorY={244} />
    <Panel x={34} y={40} w={64} h={48} fill="#ffe9f2" stroke="#e0b27e" sw={5} />
    <rect x="0" y="216" width="400" height="84" fill="#e8cfa6" />
    <rect x="0" y="216" width="400" height="10" fill="#c98d5a" />
    <g transform="translate(200 240)">
      <path d="M-140,10 L-140,-26 L140,-26 L140,10 Z" fill="#c98d5a" />
      <path d="M-146,-26 L146,-26 L136,-52 L-136,-52 Z" fill="#e2b177" />
      <path d="M-146,-26 L146,-26 L140,-32 L-140,-32 Z" fill="#c48f52" />
      {seeds(2301, 5).map((_s, i) => (
        <g key={i} transform={`translate(${-96 + i * 48} -12)`}>
          <rect x="-11" y="-16" width="22" height="32" rx="4" fill="#f6e6c8" />
          <rect x="-11" y="-12" width="22" height="24" fill={['#e2604f', '#7cc4f2', '#63bf5c', '#f2c14e', '#c9a2ff'][i]} />
          <rect x="-11" y="-16" width="22" height="6" rx="3" fill="#e0cba4" />
          <rect x="-11" y="8" width="22" height="8" rx="3" fill="#e0cba4" />
          <rect x="-11" y="-12" width="22" height="24" fill="none" stroke="#d3bb96" strokeWidth="1.4" />
          {seeds(2311 + i * 7, 5).map((_s2, j) => (
            <line key={j} x1="-11" y1={-9 + j * 5} x2="11" y2={-9 + j * 5} stroke="#ffffff" strokeWidth="1" opacity="0.5" />
          ))}
        </g>
      ))}
      <g transform="translate(-132 4)">
        <path d="M0,-14 L26,4 L22,10 L-4,-6 Z" fill="#c9c2b4" />
        <path d="M0,10 L26,-8 L22,-14 L-4,2 Z" fill="#d9d2c4" />
        <circle cx="-10" cy="-14" r="6" fill="none" stroke="#b9b0a3" strokeWidth="3" />
        <circle cx="-10" cy="18" r="6" fill="none" stroke="#b9b0a3" strokeWidth="3" />
      </g>
      <g transform="translate(132 2)">
        <path d="M-12,10 q-2,-26 12,-28 q14,2 12,28 Z" fill="#b9c4cc" />
        {seeds(2321, 8).map((s2, j) => (
          <circle key={j} cx={rnd(s2, -9, 9)} cy={rnd(s2 + 4, -16, 6)} r="1.4" fill="#8f9aa3" />
        ))}
      </g>
    </g>
    <g>
      <path d="M96,282 q60,-16 130,-6" fill="none" stroke="#e2604f" strokeWidth="2.4" />
      <line x1="228" y1="276" x2="264" y2="292" stroke="#b9b0a3" strokeWidth="2.4" strokeLinecap="round" />
    </g>
    <g transform="translate(320 276)">
      <circle cx="0" cy="0" r="12" fill="#f2c14e" />
      <circle cx="0" cy="0" r="12" fill="none" stroke="#d9a92e" strokeWidth="2" />
      {[[-4, -4], [4, -4], [-4, 4], [4, 4]].map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="1.8" fill="#8d6a1e" />
      ))}
    </g>
    <g transform="translate(60 268)">
      <circle cx="0" cy="0" r="10" fill="#8fd0f0" />
      <circle cx="0" cy="0" r="10" fill="none" stroke="#5eb0da" strokeWidth="2" />
      {[[-3, -3], [3, -3], [-3, 3], [3, 3]].map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="1.6" fill="#3f7fa0" />
      ))}
    </g>
    <Sparkle x={336} y={168} r={9} color="#ffe0ee" />
  </>
))

/** 旧玩具：架子上掉了一只耳朵的小熊，身上还有补丁 */
const OldToy = def('old-toy', '旧玩具', () => (
  <>
    <RoomWall wall="#f6ead6" floor="#dfc6a0" floorY={240} />
    <g>
      <rect x="46" y="196" width="308" height="14" rx="6" fill="#c98d5a" />
      <rect x="46" y="210" width="308" height="10" fill="#a4723f" />
    </g>
    <rect x="264" y="44" width="106" height="92" rx="8" fill="#ffe9c4" stroke="#e0b27e" strokeWidth="6" />
    <line x1="317" y1="44" x2="317" y2="136" stroke="#e0b27e" strokeWidth="4" />
    <Teddy x={150} y={196} scale={1.7} color="#d9a86c" dark="#b98a51" patch />
    <circle cx="118" cy="96" r="0" fill="none" />
    <g transform="translate(150 196) scale(1.7)">
      <path d="M-22,-58 q-12,-14 -22,-8" fill="none" stroke="#b98a51" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
      <ellipse cx="0" cy="-56" rx="22" ry="22" fill="none" />
    </g>
    <Panel x={296} y={166} w={62} h={48} r={6} fill="#dff1fb" stroke="#c98d5a" sw={5} />
    <g transform="translate(58 168)">
      <rect x="-22" y="-14" width="44" height="28" rx="4" fill="#e2b177" />
      <rect x="-16" y="-8" width="32" height="16" rx="3" fill="#c48f52" />
    </g>
    <g fill="#fff3c4" opacity="0.6">
      {seeds(2401, 10).map((s, i) => (
        <circle key={i} cx={rnd(s, 40, 360)} cy={rnd(s + 5, 60, 200)} r={rnd(s + 9, 1.6, 3.4)} />
      ))}
    </g>
    <Sparkle x={246} y={112} r={10} color="#fff3c4" />
  </>
))

/** 包饺子：案板、擀面杖、一排饺子，还有热腾腾的锅 */
const Dumplings = def('dumplings', '包饺子', () => (
  <>
    <RoomWall wall="#fdf1dc" floor="#e4cfae" floorY={226} />
    <rect x="236" y="36" width="144" height="92" rx="8" fill="#d6efff" stroke="#e0b27e" strokeWidth="6" />
    <line x1="308" y1="36" x2="308" y2="128" stroke="#e0b27e" strokeWidth="4" />
    <circle cx="278" cy="66" r="11" fill="#ffd45e" />
    <Person x={64} y={228} scale={0.96} pose="stand" top="#f2a0c0" bottom="#7a5a8c" face="happy" longHair hair={C.hairBrown} />
    <Person x={344} y={228} scale={0.92} pose="stand" top="#8fb98c" bottom="#6b6f7a" face="happy" hair="#d9d5cc" flip />
    <rect x="20" y="200" width="360" height="20" rx="8" fill="#f0dcbb" />
    <rect x="20" y="220" width="360" height="66" fill="#e2cba4" />
    <g transform="translate(200 196)">
      <ellipse cx="0" cy="0" rx="120" ry="22" fill="#f6e6c8" />
      <ellipse cx="0" cy="-2" rx="106" ry="16" fill="#fffdf4" />
    </g>
    {seeds(2501, 7).map((_s, i) => (
      <Dumpling key={i} x={112 + i * 30} y={196} scale={1.05} rotate={i % 2 === 0 ? -4 : 5} />
    ))}
    <g transform="translate(268 190) rotate(-16)">
      <rect x="-42" y="-6" width="84" height="12" rx="6" fill="#d9a86c" />
      <rect x="30" y="-8" width="14" height="16" rx="5" fill="#c48f52" />
      <rect x="-46" y="-8" width="12" height="16" rx="5" fill="#c48f52" />
    </g>
    <g transform="translate(66 194)">
      <ellipse cx="0" cy="0" rx="26" ry="8" fill="#fffdf4" />
      <ellipse cx="0" cy="-2" rx="18" ry="5" fill="#f0e6d2" />
    </g>
    <g transform="translate(330 196)">
      <path d="M-30,-8 q30,22 60,0 Z" fill="#b9bfc6" />
      <ellipse cx="0" cy="-8" rx="30" ry="8" fill="#9aa1a9" />
      <Steam x={0} y={-26} scale={0.62} opacity={0.55} />
    </g>
    <Sparkle x={196} y={132} r={10} color="#fff3c4" />
  </>
))

/** 一碗面：热气、鸡蛋、青菜，筷子搁在碗边 */
const NoodleSoup = def('noodle-soup', '一碗面', () => (
  <>
    <RoomWall wall="#fdf2e0" floor="#e6d2b2" floorY={228} />
    <rect x="36" y="36" width="150" height="104" rx="8" fill="#d6efff" stroke="#e0b27e" strokeWidth="6" />
    <line x1="111" y1="36" x2="111" y2="140" stroke="#e0b27e" strokeWidth="4" />
    <circle cx="78" cy="66" r="11" fill="#ffd45e" />
    <Cloud x={148} y={100} scale={0.36} opacity={0.9} />
    <rect x="0" y="204" width="400" height="96" fill="#e8cfa6" />
    <rect x="0" y="204" width="400" height="10" fill="#c98d5a" />
    <g transform="translate(200 226)">
      <Steam x={0} y={-52} scale={1.1} opacity={0.7} />
      <ellipse cx="0" cy="0" rx="86" ry="24" fill="#e8f4fb" />
      <path d="M-86,0 q0,58 86,58 q86,0 86,-58 Z" fill="#ffffff" />
      <path d="M-86,0 q0,58 86,58 q26,0 44,-8 q-38,-16 -38,-50 Z" fill="#e2eef4" />
      <ellipse cx="0" cy="0" rx="86" ry="24" fill="none" stroke="#7fc9ef" strokeWidth="5" />
      <ellipse cx="0" cy="2" rx="72" ry="18" fill="#f6d9a0" />
      <g stroke="#f2e0b0" strokeWidth="4" fill="none" strokeLinecap="round">
        <path d="M-48,0 q12,-12 24,0 q12,12 24,0" />
        <path d="M-30,8 q12,-12 24,0 q12,12 24,0" />
        <path d="M-54,-6 q12,-12 24,0" />
      </g>
      <ellipse cx="34" cy="-4" rx="20" ry="12" fill="#fffdf4" />
      <ellipse cx="34" cy="-4" rx="10" ry="7" fill="#ffd45e" />
      <path d="M-44,-6 q10,-10 22,-4" fill="none" stroke="#63bf5c" strokeWidth="6" strokeLinecap="round" />
      <path d="M-58,6 q8,-8 18,-2" fill="none" stroke="#63bf5c" strokeWidth="5" strokeLinecap="round" />
    </g>
    <g transform="translate(292 214) rotate(24)">
      <rect x="-4" y="-70" width="8" height="70" rx="4" fill="#d9a86c" />
      <rect x="14" y="-70" width="8" height="70" rx="4" fill="#d9a86c" />
    </g>
    <g transform="translate(96 250)">
      <ellipse cx="0" cy="0" rx="24" ry="8" fill="#fffdf4" />
      <ellipse cx="0" cy="-2" rx="16" ry="5" fill="#c8e6a0" />
    </g>
    <Sparkle x={324} y={168} r={9} color="#fff3c4" />
  </>
))

/* ---------------- E. 想象 · 假如 / 未来 / 童话 / 会说话的它 / 梦 ---------------- */

/** 假如我会飞：背生翅膀的孩子，掠过屋顶和云朵 */
const FlySky = def('fly-sky', '假如我会飞', () => (
  <>
    <Sky tone="day" />
    <Sun x={334} y={44} r={24} />
    <Cloud x={70} y={52} scale={0.9} />
    <Cloud x={280} y={96} scale={0.7} opacity={0.85} />
    <Cloud x={130} y={132} scale={0.55} opacity={0.75} />
    <g opacity="0.95">
      <rect x="0" y="228" width="400" height="72" fill="#95da6c" />
      <House x={56} y={248} scale={0.62} />
      <House x={186} y={262} scale={0.72} roof="#7cc4f2" roofDark="#5aa6d8" />
      <House x={330} y={246} scale={0.58} wall="#ffe9c4" roof="#f2a05c" roofDark="#dd8340" />
      <Tree x={130} y={250} scale={0.42} kind="round" />
      <Tree x={262} y={256} scale={0.38} kind="round" />
    </g>
    <g transform="translate(214 172)">
      <path d="M-10,-18 q-46,-30 -62,-6 q26,26 62,10 Z" fill="#dff1fb" stroke="#a8d8f0" strokeWidth="2.5" />
      <path d="M10,-18 q46,-30 62,-6 q-26,26 -62,10 Z" fill="#dff1fb" stroke="#a8d8f0" strokeWidth="2.5" />
      <path d="M-10,-18 q-30,-22 -44,-8 q18,18 44,8 Z" fill="#ffffff" opacity="0.7" />
      <path d="M10,-18 q30,-22 44,-8 q-18,18 -44,8 Z" fill="#ffffff" opacity="0.7" />
    </g>
    <Person x={214} y={240} scale={1.06} pose="reach" top="#e2604f" bottom="#3f5a7a" face="happy" />
    <Bird x={88} y={104} scale={0.56} fly />
    <Bird x={300} y={158} scale={0.46} fly flip />
    <Sparkle x={168} y={80} r={11} color="#ffffff" />
    <Sparkle x={262} y={118} r={8} color="#fff3c4" opacity={0.85} />
  </>
))

/** 假如我是风：风走过的地方，树弯了、叶子飞了 */
const WindTravel = def('wind-travel', '假如我是风', () => (
  <>
    <Sky tone="day" />
    <Cloud x={84} y={46} scale={0.86} />
    <Cloud x={300} y={62} scale={0.7} opacity={0.85} />
    <Hill x={70} y={192} rx={150} ry={56} color="#c2e8a9" />
    <Ground y={202} />
    <Tree x={78} y={214} scale={0.94} kind="round" sway={-12} />
    <Tree x={320} y={210} scale={0.82} kind="round" sway={-9} />
    <Bush x={186} y={236} scale={0.86} />
    <Person x={252} y={272} scale={0.92} pose="stand" top="#7cc4f2" bottom="#5a6b8c" face="happy" />
    <g stroke="#8fb98c" strokeWidth="3" strokeLinecap="round" opacity="0.9">
      <path d="M270,238 q14,-8 26,-2" fill="none" />
      <path d="M268,252 q16,-6 28,0" fill="none" />
    </g>
    <Wind x={148} y={140} scale={1.3} color="#ffffff" opacity={0.85} />
    <Wind x={278} y={112} scale={1} color="#ffffff" opacity={0.7} />
    <Wind x={62} y={176} scale={0.8} color="#ffffff" opacity={0.6} flip />
    <FallingLeaves count={18} seed={83} colors={['#f0a340', '#84c46a', '#f4c95d', '#e0733a']} />
    <Sparkle x={216} y={90} r={9} color="#ffffff" opacity={0.8} />
  </>
))

/** 会说话的动物：林间空地上，小动物们你一句我一句 */
const TalkAnimals = def('talk-animals', '会说话的动物', () => (
  <>
    <Sky tone="day" />
    <Sun x={330} y={44} r={20} />
    <Hill x={70} y={186} rx={150} ry={56} color="#a8dc94" />
    <Hill x={330} y={190} rx={140} ry={52} color="#95d47f" />
    <Ground y={198} color="#8ed36a" deep="#5cb44c" />
    <Tree x={44} y={210} scale={0.96} kind="round" />
    <Tree x={358} y={206} scale={0.84} kind="round" />
    <Tree x={104} y={186} scale={0.56} kind="pine" />
    <Bush x={286} y={222} scale={0.86} />
    <GrassTuft x={150} y={280} scale={1.3} />
    <GrassTuft x={252} y={290} scale={1.1} />
    <Cat x={106} y={276} scale={1.06} color="#f3a860" dark="#dd8b45" />
    <Dog x={196} y={286} scale={1.1} tongue />
    <Bird x={292} y={240} scale={1.05} color="#7cc4f2" />
    <SpeechBubble x={96} y={182} scale={0.72} w={72} h={44} />
    <SpeechBubble x={204} y={196} scale={0.78} w={76} h={46} fill="#fff6d8" />
    <SpeechBubble x={306} y={166} scale={0.7} w={68} h={42} fill="#e8f6ff" flip />
    <Sparkle x={170} y={122} r={9} color="#fff3c4" />
  </>
))

/** 未来的学校：悬浮的穹顶、光环和空中走廊（只画抽象形状） */
const FutureSchool = def('future-school', '未来的学校', () => (
  <>
    <Sky tone="dusk" />
    {seeds(2701, 22).map((s, i) => (
      <Sparkle key={i} x={rnd(s, 20, 380)} y={rnd(s + 5, 20, 150)} r={rnd(s + 9, 3, 7)} color="#ffffff" opacity={rnd(s + 13, 0.4, 0.85)} />
    ))}
    <circle cx="330" cy="70" r="30" fill="#ffd9a0" opacity="0.85" />
    <circle cx="330" cy="70" r="44" fill="none" stroke="#ffe9c4" strokeWidth="3" opacity="0.6" />
    <g opacity="0.95">
      <ellipse cx="120" cy="196" rx="86" ry="34" fill="#9aa8d8" />
      <path d="M34,196 a86,60 0 0 1 172,0 Z" fill="#c8d4f4" />
      <path d="M34,196 a86,60 0 0 1 172,0 Z" fill="none" stroke="#8f9cd0" strokeWidth="3" />
      {seeds(2711, 5).map((_s, i) => (
        <ellipse key={i} cx={62 + i * 30} cy={172} rx="12" ry="7" fill="#8fd0f0" opacity="0.85" />
      ))}
      <rect x="96" y="196" width="48" height="42" rx="10" fill="#a8b8e4" />
      <rect x="108" y="212" width="24" height="26" rx="8" fill="#fff3c4" />
    </g>
    <g opacity="0.95">
      <ellipse cx="292" cy="212" rx="72" ry="28" fill="#8fd0f0" />
      <path d="M220,212 a72,50 0 0 1 144,0 Z" fill="#d6efff" />
      <path d="M220,212 a72,50 0 0 1 144,0 Z" fill="none" stroke="#6cb8e0" strokeWidth="3" />
      {seeds(2719, 4).map((_s, i) => (
        <circle key={i} cx={244 + i * 32} cy={190} r="8" fill="#ffffff" opacity="0.9" />
      ))}
    </g>
    <g opacity="0.9">
      <ellipse cx="206" cy="118" rx="42" ry="26" fill="#c9b6f0" />
      <ellipse cx="206" cy="118" rx="42" ry="26" fill="none" stroke="#a78bfa" strokeWidth="3" />
      <ellipse cx="206" cy="118" rx="60" ry="9" fill="none" stroke="#e0d4ff" strokeWidth="4" transform="rotate(-12 206 118)" />
      <circle cx="206" cy="110" r="12" fill="#fff3c4" />
    </g>
    <g stroke="#c9b6f0" strokeWidth="4" opacity="0.8">
      <path d="M120,196 q30,-56 86,-78" fill="none" strokeDasharray="8 8" />
      <path d="M248,116 q40,20 44,96" fill="none" strokeDasharray="8 8" />
    </g>
    <ellipse cx="200" cy="256" rx="180" ry="30" fill="#7c8ab8" opacity="0.55" />
    <g opacity="0.7" fill="#5f6c96">
      <rect x="0" y="252" width="400" height="48" />
      {seeds(2729, 8).map((_s, i) => (
        <circle key={i} cx={26 + i * 50} cy={276} r="9" fill="#a8b8e4" opacity="0.6" />
      ))}
    </g>
  </>
))

/** 未来的我：孩子仰头想象，气泡里是长大后的自己 */
const FutureMe = def('future-me', '未来的我', () => (
  <>
    <RoomWall wall="#fdf2e2" floor="#e6d2b2" floorY={236} />
    <rect x="30" y="36" width="130" height="96" rx="8" fill="#d6efff" stroke="#e0b27e" strokeWidth="6" />
    <line x1="95" y1="36" x2="95" y2="132" stroke="#e0b27e" strokeWidth="4" />
    <circle cx="66" cy="64" r="10" fill="#ffd45e" />
    <ThoughtBubble x={252} y={110} scale={1.1} w={132} h={86} fill="#f2f8ff" />
    <g transform="translate(252 104)">
      <ellipse cx="0" cy="10" rx="26" ry="30" fill="#e8f4ff" stroke="#a8d8f0" strokeWidth="3" />
      <circle cx="0" cy="-10" r="19" fill="#ffffff" stroke="#a8d8f0" strokeWidth="3" />
      <circle cx="0" cy="-10" r="13" fill="#cfe6f8" />
      <circle cx="-5" cy="-12" r="2.4" fill={C.ink} />
      <circle cx="5" cy="-12" r="2.4" fill={C.ink} />
      <path d="M-4,-5 q4,4 8,0" stroke={C.ink} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <rect x="-24" y="20" width="18" height="14" rx="5" fill="#8fd0f0" />
      <rect x="6" y="20" width="18" height="14" rx="5" fill="#8fd0f0" />
      <path d="M-18,-24 q18,-12 36,0" fill="none" stroke="#a8d8f0" strokeWidth="3" />
    </g>
    <Person x={132} y={296} scale={1.16} pose="stand" top="#f2c14e" bottom="#5a6b8c" face="happy" />
    <Plant x={356} y={236} scale={0.9} />
    <Sparkle x={306} y={196} r={9} color="#fff3c4" />
    <Sparkle x={196} y={166} r={8} color="#ffe0ee" opacity={0.85} />
  </>
))

/** 龟兔赛跑：跑道上，兔子睡着了，乌龟还在慢慢爬 */
const TurtleRabbit = def('turtle-rabbit', '龟兔赛跑', () => (
  <>
    <Sky tone="day" />
    <Cloud x={92} y={42} scale={0.76} opacity={0.9} />
    <Sun x={340} y={46} r={20} />
    <Hill x={330} y={192} rx={150} ry={52} color="#bde5a4" />
    <Ground y={202} />
    <g>
      <rect x="30" y="206" width="340" height="52" rx="8" fill="#e0a06a" />
      <rect x="30" y="206" width="340" height="8" fill="#c98d5a" />
      <g stroke="#f6f0e0" strokeWidth="3" strokeDasharray="12 12">
        <line x1="34" y1="240" x2="366" y2="240" />
      </g>
    </g>
    <g transform="translate(60 196)">
      <rect x="-3" y="-42" width="6" height="42" fill="#f6f0e0" />
      <path d="M3,-42 h44 v22 h-44 Z" fill="#e2604f" />
      <path d="M3,-42 h44 v22 h-44 Z" fill="none" stroke="#c9563f" strokeWidth="2" />
      <g fill="#ffffff" opacity="0.85">
        {seeds(2801, 4).map((_s, i) => (
          <circle key={i} cx={12 + i * 10} cy={-31} r="2.4" />
        ))}
      </g>
    </g>
    <Tree x={366} y={214} scale={0.66} kind="round" />
    <g transform="translate(168 252)">
      <ellipse cx="0" cy="-14" rx="32" ry="19" fill="#5f9c4a" stroke="#3f7a34" strokeWidth="2" />
      <path d="M-32,-14 a32,19 0 0 1 64,0 Z" fill="#4a8a3c" stroke="#3f7a34" strokeWidth="2" />
      <g fill="#9ade74" opacity="0.95">
        <circle cx="-12" cy="-22" r="6" />
        <circle cx="6" cy="-26" r="7" />
        <circle cx="18" cy="-18" r="5" />
      </g>
      <circle cx="36" cy="-14" r="11" fill="#9ad37a" stroke="#3f7a34" strokeWidth="2" />
      <circle cx="40" cy="-17" r="2" fill={C.ink} />
      <path d="M43,-12 q5,2 0,4" stroke={C.ink} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <ellipse cx="-22" cy="0" rx="8" ry="5" fill="#9ad37a" stroke="#3f7a34" strokeWidth="1.6" />
      <ellipse cx="-2" cy="2" rx="8" ry="5" fill="#9ad37a" stroke="#3f7a34" strokeWidth="1.6" />
      <ellipse cx="18" cy="0" rx="8" ry="5" fill="#9ad37a" stroke="#3f7a34" strokeWidth="1.6" />
      <path d="M-32,-6 q-6,4 -10,0" fill="none" stroke="#3f7a34" strokeWidth="3" strokeLinecap="round" />
    </g>
    <g transform="translate(268 268)">
      <ellipse cx="0" cy="-18" rx="18" ry="16" fill="#f0e6d8" />
      <ellipse cx="14" cy="-36" rx="13" ry="12" fill="#f6eee2" />
      <ellipse cx="9" cy="-54" rx="4.5" ry="13" fill="#f6eee2" transform="rotate(-14 9 -54)" />
      <ellipse cx="21" cy="-54" rx="4.5" ry="13" fill="#f6eee2" transform="rotate(10 21 -54)" />
      <ellipse cx="9" cy="-54" rx="2" ry="8" fill="#ffc0cf" transform="rotate(-14 9 -54)" />
      <ellipse cx="21" cy="-54" rx="2" ry="8" fill="#ffc0cf" transform="rotate(10 21 -54)" />
      <path d="M6,-38 q4,3 8,0" stroke={C.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M17,-38 q4,3 8,0" stroke={C.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <ellipse cx="18" cy="-30" rx="3" ry="2.4" fill="#ff8f9c" />
      <ellipse cx="-12" cy="-6" rx="9" ry="6" fill="#f6eee2" />
      <ellipse cx="8" cy="-4" rx="9" ry="6" fill="#f6eee2" />
      <circle cx="-18" cy="-20" r="6" fill="#ffffff" opacity="0.9" />
      <path d="M-24,-26 q-6,-6 -2,-12 q6,4 2,12 Z" fill="#f6eee2" />
    </g>
    <g fill="#8fd0f0" opacity="0.55">
      <circle cx="232" cy="216" r="5" />
      <circle cx="216" cy="200" r="4" />
      <circle cx="244" cy="196" r="3.4" />
    </g>
    <Sparkle x={196} y={140} r={9} color="#fff3c4" />
  </>
))

/** 看望小女孩：雪夜街头，她站在一扇暖窗外面 */
const GirlVisit = def('girl-visit', '雪夜的小女孩', () => (
  <>
    <Sky tone="night" />
    {seeds(2901, 30).map((s, i) => (
      <Star key={i} x={rnd(s, 6, 394)} y={rnd(s + 3, 6, 120)} r={rnd(s + 9, 1.2, 2.6)} opacity={rnd(s + 13, 0.35, 0.85)} />
    ))}
    <Moon x={72} y={52} r={20} />
    <g>
      <rect x="230" y="96" width="140" height="130" rx="6" fill="#4a4a6e" />
      <path d="M222,96 h156 l-12,-16 h-132 Z" fill="#3a3a58" />
      {seeds(2911, 6).map((_s, i) => (
        <rect key={i} x={250 + (i % 2) * 62} y={118 + Math.floor(i / 2) * 44} width="40" height="30" rx="4" fill="#ffd98a" />
      ))}
      <rect x="252" y="122" width="36" height="22" rx="3" fill="#ffe9b8" opacity="0.9" />
    </g>
    <rect x="0" y="216" width="400" height="84" fill="#e4eef6" />
    <SnowGround y={214} />
    <g>
      <rect x="318" y="176" width="6" height="42" fill="#8b8275" />
      <circle cx="321" cy="168" r="11" fill="#ffe9b8" />
      <circle cx="321" cy="168" r="24" fill="#ffe9b8" opacity="0.25" />
    </g>
    <path d="M236,206 L318,168 L342,206 Z" fill="#ffe9b8" opacity="0.22" />
    <Person x={148} y={286} scale={0.9} pose="stand" top="#c96a8c" bottom="#7a5a8c" face="sad" longHair hair={C.hairGold} />
    <g transform="translate(112 262)">
      <rect x="-5" y="-10" width="10" height="22" rx="3" fill="#f0dcab" />
      <circle cx="0" cy="-14" r="7" fill="#ffd45e" opacity="0.9" />
      <circle cx="0" cy="-14" r="13" fill="#ffd45e" opacity="0.3" />
    </g>
    <Sparkle x={128} y={228} r={9} color="#ffe9b8" />
    <Snow count={50} seed={211} />
  </>
))

/** 会说话的书包：书包张嘴说话，桌上还摊着作业 */
const TalkingBag = def('talking-bag', '会说话的书包', () => (
  <>
    <RoomWall wall="#f7f2e4" floor="#dfc9a4" floorY={236} />
    <Panel x={32} y={38} w={58} h={44} fill="#ffe9f2" stroke="#e0b27e" sw={5} />
    <g transform="translate(240 236)">
      <rect x="-44" y="-58" width="88" height="12" rx="5" fill="#c98d5a" />
      <rect x="-34" y="-46" width="12" height="46" fill="#b57a4b" />
      <rect x="22" y="-46" width="12" height="46" fill="#b57a4b" />
      <rect x="-44" y="-80" width="10" height="24" rx="4" fill="#b57a4b" />
      <rect x="34" y="-80" width="10" height="24" rx="4" fill="#b57a4b" />
      <rect x="-44" y="-88" width="88" height="10" rx="4" fill="#c98d5a" />
    </g>
    <Backpack x={240} y={186} scale={1.36} color="#6fb3ff" dark="#4a90db" pocket="#ffe08a" face />
    <SpeechBubble x={128} y={150} scale={1.1} w={110} h={60} />
    <Desk x={92} y={252} w={130} h={44} />
    <Book x={92} y={246} scale={0.8} />
    <Pencil x={44} y={244} scale={0.9} rotate={70} />
    <Sparkle x={330} y={144} r={10} color="#fff3c4" />
  </>
))

/** 铅笔逃跑：它从桌上一跃而下，朝门口跑 */
const PencilEscape = def('pencil-escape', '铅笔逃跑', () => (
  <>
    <RoomWall wall="#fdf3e4" floor="#e8d3ae" floorY={214} />
    <g transform="translate(344 214)">
      <rect x="-40" y="-152" width="80" height="152" rx="8" fill="#c98d5a" />
      <rect x="-34" y="-146" width="68" height="146" rx="6" fill="#e2b177" />
      <rect x="-26" y="-136" width="52" height="52" rx="5" fill="#c48f52" />
      <rect x="-26" y="-76" width="52" height="46" rx="5" fill="#c48f52" />
      <circle cx="20" cy="-80" r="5" fill="#ffd45e" />
    </g>
    <Desk x={148} y={214} w={190} h={52} />
    <rect x="148" y="200" width="190" height="10" rx="4" fill="#e2b177" />
    <Book x={110} y={196} scale={0.8} />
    <Eraser x={196} y={192} scale={1.2} rotate={-8} face />
    <g transform="translate(262 186)">
      <rect x="-20" y="-13" width="40" height="26" rx="6" fill="#ffffff" stroke="#d3bb96" strokeWidth="2" />
      <rect x="-20" y="-13" width="40" height="6" rx="3" fill="#a8d8f0" />
    </g>
    <Pencil x={244} y={276} scale={1.5} rotate={84} face />
    <g stroke="#c9c2b4" strokeWidth="3.4" strokeLinecap="round" opacity="0.8">
      <path d="M200,250 h-22" />
      <path d="M204,264 h-30" />
      <path d="M198,278 h-18" />
    </g>
    <g fill="#8fd0f0" opacity="0.6">
      <circle cx="176" cy="240" r="5" />
      <circle cx="162" cy="258" r="4" />
      <circle cx="180" cy="266" r="3.4" />
    </g>
    <Sparkle x={296} y={132} r={10} color="#fff3c4" />
  </>
))

/** 铅笔历险：它掉进一本摊开的大书，像走进了山谷 */
const PencilAdventure = def('pencil-adventure', '铅笔历险', () => (
  <>
    <Sky tone="dawn" />
    <Cloud x={84} y={40} scale={0.8} opacity={0.9} />
    <Sun x={330} y={42} r={20} />
    <g transform="translate(200 240)">
      <path d="M-190,0 L-190,-52 q95,-30 190,-8 q95,-22 190,8 L190,0 q-95,-24 -190,-4 q-95,-20 -190,4 Z" fill="#6fb3ff" />
      <path d="M-182,-2 L-182,-48 q92,-28 182,-6 q90,-22 182,6 L182,-2 q-92,-22 -182,-2 q-90,-20 -182,2 Z" fill="#fffdf4" />
      <g stroke="#c9c2b4" strokeWidth="2.4" strokeLinecap="round">
        <path d="M-150,-38 h70" />
        <path d="M-150,-28 h56" />
        <path d="M-150,-18 h64" />
        <path d="M30,-38 h76" />
        <path d="M30,-28 h60" />
        <path d="M30,-18 h70" />
      </g>
      <path d="M0,-52 L0,2" stroke="#6fb3ff" strokeWidth="5" />
      <path d="M-186,-50 q92,-28 186,-8 q94,-20 186,8" fill="none" stroke="#4a90db" strokeWidth="3" />
      <g fill="#95da6c" opacity="0.9">
        <path d="M-160,-8 q18,-28 36,0 Z" />
        <path d="M120,-6 q22,-34 44,0 Z" />
      </g>
    </g>
    <Pencil x={200} y={196} scale={2.1} rotate={-24} face />
    <g stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.7">
      <path d="M128,168 q-16,-6 -26,2" fill="none" />
      <path d="M126,182 q-18,-4 -30,4" fill="none" />
    </g>
    <Sparkle x={296} y={132} r={11} color="#fff3c4" />
    <Sparkle x={104} y={112} r={8} color="#ffe0ee" opacity={0.85} />
    <Bird x={286} y={88} scale={0.46} fly />
  </>
))

/** 铅笔回家：回到笔袋里，和伙伴们挤在一起 */
const PencilHome = def('pencil-home', '铅笔回家', () => (
  <>
    <RoomWall wall="#fdf3e4" floor="#e8d3ae" floorY={226} />
    <Panel x={30} y={38} w={62} h={46} fill="#dff1fb" stroke="#e0b27e" sw={5} />
    <rect x="0" y="212" width="400" height="88" fill="#f0dcbb" />
    <rect x="0" y="212" width="400" height="10" fill="#d3bb96" />
    <g transform="translate(200 248)">
      <path d="M-152,-26 q152,-30 304,0 L146,42 q-146,26 -292,0 Z" fill="#e2604f" />
      <path d="M-152,-26 q152,-30 304,0 L146,42 q-146,26 -292,0 Z" fill="none" stroke="#c9563f" strokeWidth="3" />
      <path d="M-140,-20 q140,-26 280,0 L134,34 q-134,22 -268,0 Z" fill="#f28a7a" />
      <g>
        <rect x="-116" y="-18" width="16" height="52" rx="5" fill="#f2b134" transform="rotate(-6 -108 8)" />
        <path d="M-120,34 l8,14 l8,-14 Z" fill="#f4e0bd" transform="rotate(-6 -108 8)" />
        <rect x="-92" y="-16" width="16" height="52" rx="5" fill="#7cc4f2" transform="rotate(-3 -84 10)" />
        <path d="M-96,36 l8,14 l8,-14 Z" fill="#f4e0bd" transform="rotate(-3 -84 10)" />
        <rect x="-68" y="-14" width="16" height="52" rx="5" fill="#63bf5c" />
        <path d="M-72,38 l8,14 l8,-14 Z" fill="#f4e0bd" />
        <rect x="-42" y="-12" width="16" height="52" rx="5" fill="#c9a2ff" transform="rotate(3 -34 14)" />
        <path d="M-46,40 l8,14 l8,-14 Z" fill="#f4e0bd" transform="rotate(3 -34 14)" />
      </g>
      <g transform="translate(56 8) rotate(16)">
        <Pencil x={0} y={0} scale={1.1} face />
      </g>
      <Eraser x={116} y={16} scale={1.15} rotate={-12} face />
      <g stroke="#c9563f" strokeWidth="4" fill="none">
        <path d="M-150,-24 l-6,10 M150,-24 l6,10" />
      </g>
    </g>
    <Sparkle x={96} y={140} r={10} color="#fff3c4" />
    <Sparkle x={304} y={156} r={8} color="#ffe0ee" opacity={0.85} />
  </>
))

/** 奇怪的梦：房子倒着长在天上，鱼在云里游 */
const WeirdDream = def('weird-dream', '奇怪的梦', () => (
  <>
    <Sky tone="dusk" />
    {seeds(3001, 20).map((s, i) => (
      <Sparkle key={i} x={rnd(s, 20, 380)} y={rnd(s + 5, 16, 150)} r={rnd(s + 9, 3, 8)} color="#ffffff" opacity={rnd(s + 13, 0.4, 0.9)} />
    ))}
    <circle cx="66" cy="60" r="26" fill="#fff0c0" opacity="0.9" />
    <g transform="translate(120 96) rotate(180)">
      <House x={0} y={0} scale={0.66} wall="#ffe9f2" roof="#c9a2ff" roofDark="#a78bfa" />
    </g>
    <g transform="translate(300 62) rotate(160)">
      <House x={0} y={0} scale={0.5} wall="#e8f6ff" roof="#8fd0f0" roofDark="#5eb0da" />
    </g>
    <g transform="translate(214 150)">
      <path d="M-44,0 q22,-26 44,0 q22,26 44,0" fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" opacity="0.85" />
      <ellipse cx="0" cy="-8" rx="26" ry="13" fill="#ffd45e" opacity="0.95" />
      <path d="M26,-8 l16,-9 v18 Z" fill="#ffd45e" opacity="0.95" />
      <circle cx="-8" cy="-11" r="2.6" fill={C.ink} />
      <circle cx="-12" cy="-15" r="1" fill="#ffffff" />
    </g>
    <Balloon x={58} y={182} scale={0.8} color="#8fd0f0" />
    <Balloon x={352} y={196} scale={0.66} color="#ff9fc0" />
    <g transform="translate(286 176) rotate(24)">
      <Kite x={0} y={0} scale={0.8} color="#c9a2ff" dark="#a78bfa" />
    </g>
    <Ground y={230} color="#a8b6f0" deep="#8090d8" />
    <g transform="translate(200 250)">
      <path d="M-140,40 L140,40 L140,4 L-140,4 Z" fill="#c9b6f0" />
      <path d="M-140,4 q70,-40 140,0 q70,40 140,0 L140,4 L-140,4 Z" fill="#dcd0f8" />
    </g>
    <ellipse cx="168" cy="252" rx="66" ry="20" fill="#ffe9f2" />
    <Person x={168} y={252} scale={0.94} pose="lie" top="#7cc4f2" bottom="#5a6b8c" face="calm" />
    <g opacity="0.75">
      <circle cx="252" cy="212" r="5" fill="#ffffff" />
      <circle cx="268" cy="200" r="3.6" fill="#ffffff" />
      <circle cx="284" cy="190" r="2.8" fill="#ffffff" />
    </g>
    <Plant x={44} y={266} scale={0.8} pot="#c9a2ff" potDark="#a78bfa" leaf="#8fd0f0" leafDark="#5eb0da" />
    <Sparkle x={330} y={140} r={10} color="#fff3c4" />
  </>
))

/* ---------------- A6. 写景·补充 ---------------- */

/** 夏日荷塘：水面 + 荷叶 + 荷花 + 蜻蜓 */
const SummerPond = def('summer-pond', '夏日荷塘', () => (
  <>
    <Sky tone="day" />
    <Sun x={336} y={48} r={22} glow={false} />
    <Cloud x={82} y={44} scale={0.7} opacity={0.85} />
    <Hill x={60} y={196} rx={160} ry={56} color="#b8e0a0" />
    <Hill x={340} y={198} rx={140} ry={48} color="#a4d088" />
    <Water y={196} color="#7fc9ef" deep="#4aa5da" />
    {/* 荷叶 */}
    <g>
      <ellipse cx={90} cy={220} rx={34} ry={12} fill="#5cb44c" opacity="0.9" />
      <ellipse cx={90} cy={218} rx={28} ry={9} fill="#7acc5e" />
      <path d="M90,209 L90,227" stroke="#3f9440" strokeWidth="1.5" opacity="0.6" />
      <ellipse cx={270} cy={250} rx={40} ry={14} fill="#5cb44c" opacity="0.9" />
      <ellipse cx={270} cy={248} rx={33} ry={10} fill="#7acc5e" />
      <path d="M270,238 L270,258" stroke="#3f9440" strokeWidth="1.5" opacity="0.6" />
      <ellipse cx={180} cy={272} rx={30} ry={10} fill="#5cb44c" opacity="0.85" />
      <ellipse cx={180} cy={270} rx={25} ry={7} fill="#7acc5e" />
    </g>
    {/* 荷花 */}
    <g transform="translate(270 238)">
      <g>
        {seeds(201, 6).map((_s, i) => (
          <ellipse key={i} cx={Math.cos((i / 6) * Math.PI * 2) * 8} cy={Math.sin((i / 6) * Math.PI * 2) * 8 - 4} rx="5" ry="9" fill="#ffb7cf" stroke="#f78fb3" strokeWidth="1" transform={`rotate(${(i / 6) * 360} ${Math.cos((i / 6) * Math.PI * 2) * 8} ${Math.sin((i / 6) * Math.PI * 2) * 8 - 4})`} />
        ))}
        <circle cx="0" cy="-4" r="4" fill="#ffd45e" />
      </g>
    </g>
    <g transform="translate(120 250) scale(0.7)">
      <g>
        {seeds(301, 5).map((_s, i) => (
          <ellipse key={i} cx={Math.cos((i / 5) * Math.PI * 2) * 6} cy={Math.sin((i / 5) * Math.PI * 2) * 6 - 3} rx="4" ry="7" fill="#fff0f6" stroke="#f78fb3" strokeWidth="0.8" transform={`rotate(${(i / 5) * 360} ${Math.cos((i / 5) * Math.PI * 2) * 6} ${Math.sin((i / 5) * Math.PI * 2) * 6 - 3})`} />
        ))}
        <circle cx="0" cy="-3" r="3" fill="#ffd45e" />
      </g>
    </g>
    {/* 蜻蜓 */}
    <g transform="translate(200 170)">
      <ellipse cx="0" cy="0" rx="12" ry="2.5" fill="#6fb3ff" />
      <ellipse cx="-2" cy="-1" rx="8" ry="1.8" fill="#a0c8ff" opacity="0.7" />
      <circle cx="10" cy="-2" r="3" fill="#6fb3ff" />
      <circle cx="11" cy="-3" r="1" fill={C.ink} />
      <path d="M-4,1 l6,2" stroke={C.ink} strokeWidth="0.8" />
      {/* 翅膀 */}
      <ellipse cx="0" cy="-8" rx="10" ry="3" fill="#ffffff" opacity="0.5" transform="rotate(-15)" />
      <ellipse cx="2" cy="-6" rx="8" ry="2.5" fill="#ffffff" opacity="0.4" transform="rotate(10)" />
    </g>
    {/* 鱼影 */}
    <g opacity="0.35">
      <ellipse cx={150} cy={260} rx="10" ry="4" fill="#4aa5da" />
      <path d="M140,260 l-4,-3 l0,6 Z" fill="#4aa5da" />
      <ellipse cx={320} cy={280} rx="8" ry="3" fill="#4aa5da" />
      <path d="M312,280 l-3,-2 l0,4 Z" fill="#4aa5da" />
    </g>
    <Flower x={40} y={288} scale={0.7} petal="#ff9fc0" />
    <GrassTuft x={360} y={294} scale={0.8} />
    <Sparkle x={250} y={130} r={8} color="#fff3c4" />
  </>
))

/** 海边沙滩：沙地 + 海浪 + 贝壳 + 遮阳伞 */
const Beach = def('beach', '海边沙滩', () => (
  <>
    <Sky tone="day" />
    <Sun x={328} y={50} r={24} />
    <Cloud x={80} y={42} scale={0.8} />
    <Cloud x={250} y={36} scale={0.6} opacity={0.8} />
    {/* 远海 */}
    <rect x="0" y="100" width="400" height="60" fill="#4aa5da" />
    <rect x="0" y="100" width="400" height="12" fill="#7fc9ef" opacity="0.6" />
    {/* 海浪 */}
    <path d="M0,160 q40,-8 80,0 q40,8 80,0 q40,-8 80,0 q40,8 80,0 L400,160 Z" fill="#b0e0f0" opacity="0.8" />
    <path d="M0,160 q30,-5 60,0 q30,5 60,0 q30,-5 60,0 q30,5 60,0 L400,160" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.7" />
    {/* 沙滩 */}
    <path d="M0,162 L400,162 L400,300 L0,300 Z" fill="#ecd9b4" />
    <path d="M0,162 L400,162 L400,172 L0,172 Z" fill="#d9bd8f" opacity="0.5" />
    {/* 遮阳伞 */}
    <g transform="translate(110 210)">
      <path d="M0,0 L-40,-30 L40,-30 Z" fill="#ff7d7d" />
      <path d="M0,0 L0,-30 L0,0" fill="#ffffff" opacity="0.3" />
      <path d="M-40,-30 L0,0 L0,-30 Z" fill="#e06767" opacity="0.4" />
      <path d="M0,-30 L0,20" stroke="#8d5a33" strokeWidth="4" strokeLinecap="round" />
    </g>
    {/* 贝壳 */}
    <g transform="translate(200 240)">
      <path d="M-10,0 q10,-14 20,0 Z" fill="#fff0e8" stroke="#f0c0a0" strokeWidth="1.5" />
      <path d="M0,-14 L0,0 M-5,-10 L0,0 M5,-10 L0,0" stroke="#f0c0a0" strokeWidth="1" opacity="0.6" />
    </g>
    <g transform="translate(280 260) scale(0.7)">
      <path d="M-10,0 q10,-14 20,0 Z" fill="#ffe0f0" stroke="#f4a0c0" strokeWidth="1.5" />
    </g>
    <g transform="translate(320 250) scale(0.6)">
      <path d="M-10,0 q10,-14 20,0 Z" fill="#f0f8ff" stroke="#c0d8e8" strokeWidth="1.5" />
    </g>
    {/* 小孩 */}
    <Person x={170} y={280} scale={0.8} pose="sit" top="#ffd45e" bottom="#e8b93a" face="happy" />
    <Ball x={240} y={276} r={6} color="#ff7d7d" />
    <Sparkle x={300} y={120} r={6} color="#fff3c4" />
  </>
))

/** 金色麦田：麦浪 + 田埂 + 远山 */
const WheatField = def('wheat-field', '金色麦田', () => (
  <>
    <Sky tone="day" />
    <Cloud x={80} y={42} scale={0.7} opacity={0.85} />
    <Cloud x={280} y={38} scale={0.55} opacity={0.7} />
    <Hill x={100} y={170} rx={180} ry={48} color="#e8d090" opacity={0.8} />
    <Hill x={320} y={172} rx={160} ry={44} color="#d8c080" opacity={0.7} />
    {/* 麦田 */}
    <rect x="0" y="170" width="400" height="130" fill="#f0c860" />
    <rect x="0" y="170" width="400" height="20" fill="#f6d870" opacity="0.6" />
    {/* 麦穗纹理 */}
    <g stroke="#d4a040" strokeWidth="1.5" strokeLinecap="round" opacity="0.6">
      {seeds(411, 30).map((s, i) => (
        <line key={i} x1={rnd(s, 0, 400)} y1={rnd(s + 1, 180, 296)} x2={rnd(s, 0, 400)} y2={rnd(s + 1, 180, 296) + 8} />
      ))}
    </g>
    <g fill="#d4a040" opacity="0.5">
      {seeds(511, 18).map((s, i) => (
        <ellipse key={i} cx={rnd(s, 10, 390)} cy={rnd(s + 2, 186, 290)} rx="2" ry="4" />
      ))}
    </g>
    {/* 田埂 */}
    <path d="M0,200 Q200,210 400,198" fill="none" stroke="#b57a4b" strokeWidth="6" opacity="0.4" />
    {/* 远处小房子 */}
    <House x={340} y={185} scale={0.35} wall="#fff3dd" roof="#c9563f" />
    <Tree x={60} y={180} scale={0.4} kind="round" />
    <Sparkle x={200} y={120} r={8} color="#fff3c4" />
  </>
))

/** 校园秋天：银杏 + 落叶 + 教学楼 */
const SchoolAutumn = def('school-autumn', '校园秋天', () => (
  <>
    <Sky tone="day" />
    <Cloud x={80} y={40} scale={0.65} opacity={0.8} />
    <Hill x={200} y={196} rx={200} ry={40} color="#d8e8a0" opacity={0.7} />
    <Ground y={200} color="#95da6c" deep="#5cb44c" />
    {/* 教学楼 */}
    <g transform="translate(280 200) scale(0.6)">
      <rect x="-60" y="-70" width="120" height="70" rx="4" fill="#f0f0f0" stroke="#d0d0d0" strokeWidth="2" />
      <rect x="-60" y="-70" width="120" height="14" fill="#c9563f" />
      {seeds(601, 6).map((_s, i) => (
        <rect key={i} x={-52 + (i % 3) * 36} y={-50 + Math.floor(i / 3) * 28} width="24" height="20" rx="2" fill="#cfeaff" stroke="#b0c8d8" strokeWidth="1.5" />
      ))}
      <rect x="-6" y="-18" width="12" height="18" rx="2" fill="#b9773f" />
    </g>
    {/* 银杏树 */}
    <g transform="translate(70 200) scale(0.85)">
      <path d="M-6,0 L-4,-50 L4,-50 L6,0 Z" fill={C.bark} />
      <circle cx="-14" cy="-52" r="18" fill="#f0c860" />
      <circle cx="14" cy="-50" r="19" fill="#f6d870" />
      <circle cx="0" cy="-64" r="21" fill="#ffe080" />
      <circle cx="-4" cy="-52" r="15" fill="#f6d870" />
    </g>
    <g transform="translate(180 206) scale(0.65)">
      <path d="M-5,0 L-3,-40 L3,-40 L5,0 Z" fill={C.bark} />
      <circle cx="-11" cy="-42" r="14" fill="#f0c860" />
      <circle cx="11" cy="-40" r="15" fill="#f6d870" />
      <circle cx="0" cy="-52" r="16" fill="#ffe080" />
    </g>
    {/* 落叶 */}
    <g fill="#f0c860" opacity="0.85">
      {seeds(701, 14).map((s, i) => (
        <ellipse key={i} cx={rnd(s, 10, 390)} cy={rnd(s + 3, 210, 294)} rx={rnd(s + 6, 3, 5)} ry={rnd(s + 9, 2, 3.5)} transform={`rotate(${rnd(s + 12, -60, 60)} ${rnd(s, 10, 390)} ${rnd(s + 3, 210, 294)})`} />
      ))}
    </g>
    <Person x={160} y={270} scale={0.8} pose="run" top="#e06767" bottom="#5a6b8c" face="smile" longHair />
    <Path x={200} top={210} w={30} w2={100} />
    <Sparkle x={320} y={130} r={8} color="#fff3c4" />
  </>
))

/** 日落：晚霞 + 剪影树 + 远山 */
const Sunset = def('sunset', '日落', () => (
  <>
    <Sky tone="dusk" />
    <Sun x={200} y={150} r={36} glow={true} />
    <Cloud x={80} y={50} scale={0.7} fill="#ffd0a0" opacity={0.7} />
    <Cloud x={300} y={60} scale={0.6} fill="#ffb080" opacity={0.6} />
    {/* 远山剪影 */}
    <path d="M0,180 L80,140 L160,170 L240,130 L320,165 L400,145 L400,300 L0,300 Z" fill="#8a7a6a" opacity="0.7" />
    <path d="M0,200 L100,170 L200,195 L300,165 L400,185 L400,300 L0,300 Z" fill="#6a5a4a" opacity="0.8" />
    {/* 剪影树 */}
    <g fill="#4a3a2a" opacity="0.9">
      <g transform="translate(60 210)">
        <path d="M-4,0 L-2,-30 L2,-30 L4,0 Z" />
        <circle cx="-8" cy="-32" r="11" />
        <circle cx="8" cy="-30" r="12" />
        <circle cx="0" cy="-40" r="13" />
      </g>
      <g transform="translate(340 215) scale(0.8)">
        <path d="M-4,0 L-2,-28 L2,-28 L4,0 Z" />
        <circle cx="-7" cy="-30" r="10" />
        <circle cx="7" cy="-28" r="11" />
        <circle cx="0" cy="-38" r="12" />
      </g>
    </g>
    {/* 前景草坡 */}
    <path d="M0,230 Q200,240 400,226 L400,300 L0,300 Z" fill="#5a4a3a" />
    <Person x={200} y={250} scale={0.7} pose="reach" top="#5a4a3a" bottom="#3a2a1a" hair="#3a2a1a" face="calm" />
    <Bird x={120} y={100} scale={0.7} fly={true} color="#6a5a4a" belly="#6a5a4a" />
    <Bird x={280} y={110} scale={0.5} fly={true} color="#6a5a4a" belly="#6a5a4a" />
    <Sparkle x={200} y={100} r={6} color="#fff0a8" />
  </>
))

/** 雪后晴空：蓝天 + 白雪 + 冰棱 */
const SnowClear = def('snow-clear', '雪后晴空', () => (
  <>
    <Sky tone="day" />
    <Sun x={332} y={48} r={24} />
    <Cloud x={80} y={40} scale={0.65} opacity={0.9} />
    <Cloud x={260} y={34} scale={0.5} opacity={0.8} />
    <Mountain x={120} base={210} w={150} h={100} color="#d0dce8" shade="#b0c0d0" snow={true} />
    <Mountain x={280} base={210} w={120} h={80} color="#e0e8f0" shade="#c0ccd8" snow={true} />
    <SnowGround y={208} />
    {/* 屋檐冰棱 */}
    <g>
      <House x={250} y={210} scale={0.5} wall="#fff3dd" roof="#c9563f" />
      <g fill="#cfeaff" opacity="0.8">
        <path d="M222,172 L224,184 L220,184 Z" />
        <path d="M236,172 L238,188 L234,188 Z" />
        <path d="M250,172 L252,186 L248,186 Z" />
        <path d="M264,172 L266,190 L262,190 Z" />
        <path d="M278,172 L280,186 L276,186 Z" />
      </g>
    </g>
    <Tree x={60} y={215} scale={0.7} kind="bare" />
    <Snowman x={120} y={270} scale={0.6} scarf="#4a90db" />
    <Person x={300} y={265} scale={0.75} pose="wave" top="#4a90db" bottom="#2a4d66" face="happy" />
    {/* 雪地闪光 */}
    <g fill="#ffffff" opacity="0.6">
      {seeds(801, 8).map((s, i) => (
        <Sparkle key={i} x={rnd(s, 30, 380)} y={rnd(s + 1, 240, 292)} r={4} color="#ffffff" />
      ))}
    </g>
  </>
))

/* ---------------- B6. 写人·补充 ---------------- */

/** 爸爸修东西：蹲着修自行车，工具箱 */
const DadRepair = def('dad-repair', '爸爸修东西', () => (
  <>
    <Sky tone="day" />
    <Cloud x={80} y={40} scale={0.6} opacity={0.8} />
    <Hill x={200} y={196} rx={200} ry={40} color="#c8ebae" opacity={0.7} />
    <Ground y={210} color="#95da6c" deep="#5cb44c" />
    <Fence x={20} y={206} w={360} h={28} />
    <House x={340} y={214} scale={0.45} wall="#fff3dd" roof="#c9563f" />
    {/* 自行车倒放 */}
    <g transform="translate(160 250) scale(0.85) rotate(-12)">
      <circle cx="-30" cy="-12" r="16" fill="none" stroke="#4a453d" strokeWidth="4" />
      <circle cx="32" cy="-12" r="16" fill="none" stroke="#4a453d" strokeWidth="4" />
      <path d="M-30,-12 L-6,-38 L24,-38 L32,-12" fill="none" stroke="#4a453d" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M-6,-38 L6,-12 L-30,-12" fill="none" stroke="#4a453d" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    {/* 爸爸蹲着 */}
    <Person x={120} y={252} scale={0.85} pose="sit" top="#5a8a5a" bottom="#3a5a3a" hair="#3a3230" face="calm" />
    {/* 工具箱 */}
    <g transform="translate(80 256)">
      <rect x="-20" y="-18" width="40" height="18" rx="3" fill="#cf9a63" stroke="#8d5a33" strokeWidth="2" />
      <rect x="-20" y="-24" width="40" height="8" rx="3" fill="#a4723f" />
      <path d="M-14,-24 q14,-8 28,0" fill="none" stroke="#8d5a33" strokeWidth="2" />
      <rect x="-16" y="-14" width="6" height="4" fill="#8d5a33" />
      <rect x="-6" y="-14" width="6" height="4" fill="#8d5a33" />
      <rect x="4" y="-14" width="6" height="4" fill="#8d5a33" />
    </g>
    <Sparkle x={200} y={120} r={8} color="#fff3c4" />
  </>
))

/** 奶奶织毛衣：摇椅 + 毛线团 */
const GrandmaKnit = def('grandma-knit', '奶奶织毛衣', () => (
  <>
    <RoomWall wall="#fdf2df" floor="#e7d3b4" floorY={218} />
    {/* 摇椅 */}
    <g transform="translate(200 218)">
      <path d="M-40,0 q-6,-10 0,-16 q4,-30 40,-30 q36,0 40,30 q6,6 0,16" fill="none" stroke="#8d5a33" strokeWidth="5" strokeLinecap="round" />
      <path d="M-36,0 q36,16 72,0" fill="none" stroke="#8d5a33" strokeWidth="4" />
      <rect x="-30" y="-40" width="60" height="30" rx="4" fill="#c08c4f" opacity="0.6" />
    </g>
    {/* 奶奶 */}
    <Person x={200} y={200} scale={0.8} pose="sit" skin="#f0c8a0" hair="#d0d0d0" top="#c4788a" bottom="#8a4a5a" face="smile" longHair />
    {/* 毛线团 */}
    <g transform="translate(140 236)">
      <circle cx="0" cy="0" r="10" fill="#c4788a" />
      <path d="M-8,-6 q4,4 0,12 M6,-8 q-4,4 0,12 M-2,-9 q4,4 0,12" stroke="#8a4a5a" strokeWidth="1.2" fill="none" />
      <path d="M10,0 q14,2 16,-8" fill="none" stroke="#c4788a" strokeWidth="2" />
    </g>
    <g transform="translate(120 242) scale(0.7)">
      <circle cx="0" cy="0" r="8" fill="#7acc5e" />
      <path d="M-6,-5 q3,3 0,10 M5,-6 q-3,3 0,10" stroke="#3f9440" strokeWidth="1" fill="none" />
    </g>
    {/* 老花镜 */}
    <g transform="translate(180 190)">
      <circle cx="-6" cy="0" r="5" fill="none" stroke="#4a453d" strokeWidth="1.5" />
      <circle cx="6" cy="0" r="5" fill="none" stroke="#4a453d" strokeWidth="1.5" />
      <line x1="-1" y1="0" x2="1" y2="0" stroke="#4a453d" strokeWidth="1.5" />
    </g>
    {/* 织针 */}
    <g transform="translate(210 190) rotate(30)">
      <line x1="0" y1="0" x2="0" y2="-20" stroke="#8d5a33" strokeWidth="2" strokeLinecap="round" />
      <line x1="8" y1="0" x2="8" y2="-20" stroke="#8d5a33" strokeWidth="2" strokeLinecap="round" />
    </g>
    <Plant x={40} y={240} scale={0.6} />
    <Sparkle x={330} y={100} r={6} color="#fff3c4" />
  </>
))

/** 我的好朋友：两人并肩 */
const BestFriend = def('best-friend', '我的好朋友', () => (
  <>
    <Sky tone="day" />
    <Sun x={332} y={50} r={22} glow={false} />
    <Cloud x={80} y={42} scale={0.7} opacity={0.85} />
    <Hill x={200} y={198} rx={200} ry={44} color="#c8ebae" opacity={0.7} />
    <Ground y={208} />
    <Path x={200} top={210} w={30} w2={100} />
    <Tree x={60} y={216} scale={0.75} kind="round" />
    <Tree x={340} y={212} scale={0.65} kind="round" />
    <Bush x={150} y={232} scale={0.7} />
    <Bush x={260} y={234} scale={0.6} />
    <Flower x={40} y={280} scale={0.7} petal="#ff9fc0" />
    <Flower x={360} y={278} scale={0.6} petal="#ffd166" />
    <Person x={170} y={260} scale={0.85} pose="stand" top="#7cc4f2" bottom="#5a6b8c" face="happy" />
    <Person x={215} y={262} scale={0.85} pose="stand" top="#ffd45e" bottom="#e06767" hair="#7a5236" face="smile" flip longHair />
    <SpeechBubble x={120} y={180} scale={0.7} />
    <Sparkle x={250} y={120} r={8} color="#fff3c4" />
  </>
))

/** 医生看病：白大褂 + 听诊器 */
const DoctorScene = def('doctor', '看病的医生', () => (
  <>
    <RoomWall wall="#eff6ff" floor="#d8e8f0" floorY={218} wainscot="#c8dce8" />
    {/* 诊台 */}
    <g transform="translate(120 218)">
      <rect x="-40" y="-30" width="80" height="30" rx="4" fill="#ffffff" stroke="#b0c8d8" strokeWidth="2" />
      <rect x="-36" y="0" width="8" height="22" fill="#b0c8d8" />
      <rect x="28" y="0" width="8" height="22" fill="#b0c8d8" />
      {/* 纸 */}
      <rect x="-30" y="-26" width="40" height="20" fill="#fffdf7" stroke="#d9d2c4" strokeWidth="1" />
      <g stroke="#b0b0b0" strokeWidth="0.8">
        <path d="M-26,-22 h26" /><path d="M-26,-18 h20" /><path d="M-26,-14 h24" />
      </g>
    </g>
    {/* 医生 */}
    <Person x={200} y={210} scale={0.85} pose="stand" skin="#ffd9b5" hair="#3a3230" top="#ffffff" bottom="#4a90db" face="calm" />
    {/* 白大褂领 */}
    <path d="M190,170 L200,178 L210,170 L206,166 L194,166 Z" fill="#e0e8f0" opacity="0.6" />
    {/* 听诊器 */}
    <g transform="translate(200 178)">
      <path d="M-6,0 q-4,10 0,16 M6,0 q4,10 0,16" fill="none" stroke="#4a90db" strokeWidth="1.5" />
      <circle cx="0" cy="18" r="4" fill="#4a90db" stroke="#2a70a0" strokeWidth="1" />
    </g>
    {/* 十字标 */}
    <g transform="translate(185 168)">
      <rect x="-6" y="-6" width="12" height="12" rx="2" fill="#e04040" />
      <rect x="-4" y="-1" width="8" height="2" fill="#ffffff" />
      <rect x="-1" y="-4" width="2" height="8" fill="#ffffff" />
    </g>
    {/* 药柜 */}
    <g transform="translate(330 180)">
      <rect x="-30" y="-60" width="60" height="60" rx="4" fill="#ffffff" stroke="#b0c8d8" strokeWidth="2" />
      {seeds(901, 6).map((_s, i) => (
        <rect key={i} x={-26 + (i % 3) * 20} y={-56 + Math.floor(i / 3) * 28} width="16" height="24" rx="2" fill="#e8f4ff" stroke="#b0c8d8" strokeWidth="1" />
      ))}
    </g>
    {/* 小孩坐着 */}
    <Person x={90} y={200} scale={0.7} pose="sit" top="#ffd45e" bottom="#e06767" face="sad" />
    <Sparkle x={300} y={80} r={6} color="#fff3c4" />
  </>
))

/** 警察叔叔：敬礼 + 十字路口 */
const PoliceScene = def('police', '警察叔叔', () => (
  <>
    <Sky tone="day" />
    <Sun x={332} y={48} r={22} glow={false} />
    <Cloud x={80} y={42} scale={0.6} opacity={0.8} />
    <Ground y={200} color="#9a9a9a" deep="#7a7a7a" />
    {/* 道路 */}
    <rect x="0" y="200" width="400" height="100" fill="#8a8a8a" />
    <rect x="0" y="246" width="400" height="8" fill="#fffdf7" opacity="0.6" />
    {seeds(1001, 8).map((_s, i) => (
      <rect key={i} x={i * 50} y="248" width="24" height="4" fill="#fffdf7" opacity="0.5" />
    ))}
    {/* 红绿灯 */}
    <g transform="translate(350 210)">
      <rect x="-8" y="-60" width="16" height="50" rx="4" fill="#3a3230" />
      <circle cx="0" cy="-52" r="5" fill="#e04040" />
      <circle cx="0" cy="-42" r="5" fill="#f0c040" opacity="0.5" />
      <circle cx="0" cy="-32" r="5" fill="#40c040" opacity="0.3" />
      <rect x="-3" y="-10" width="6" height="14" fill="#4a453d" />
    </g>
    {/* 斑马线 */}
    <g fill="#fffdf7" opacity="0.7">
      {seeds(1101, 5).map((_s, i) => (
        <rect key={i} x={20 + i * 28} y="206" width="16" height="36" />
      ))}
    </g>
    {/* 警察 */}
    <Person x={200} y={210} scale={0.9} pose="point" skin="#ffd9b5" hair="#3a3230" top="#3a5a8a" bottom="#2a3a5a" face="calm" />
    {/* 警帽 */}
    <g transform="translate(200 148)">
      <path d="M-14,0 q14,-10 28,0 Z" fill="#2a3a5a" />
      <rect x="-14" y="-2" width="28" height="6" rx="2" fill="#2a3a5a" />
      <path d="M-4,-6 L4,-6 L2,0 L-2,0 Z" fill="#f0c040" />
    </g>
    <House x={60} y={200} scale={0.35} />
    <House x={100} y={205} scale={0.3} wall="#f0e8d8" />
    <Sparkle x={300} y={120} r={6} color="#fff3c4" />
  </>
))

/** 图书管理员：书架 + 借书台 */
const Librarian = def('librarian', '图书管理员', () => (
  <>
    <RoomWall wall="#fdf6ec" floor="#e7d3b4" floorY={218} wainscot="#f0e0c0" />
    {/* 书架 */}
    <g transform="translate(100 218)">
      <rect x="-50" y="-120" width="100" height="120" rx="4" fill="#cf9a63" stroke="#8d5a33" strokeWidth="2" />
      {seeds(1201, 4).map((_s, i) => (
        <g key={i}>
          <rect x="-46" y={-114 + i * 30} width="92" height="3" fill="#8d5a33" opacity="0.5" />
          {seeds(1201 + i * 10, 7).map((_s2, j) => (
            <rect key={j} x={-44 + j * 13} y={-114 + i * 30 + 3} width="11" height="24" rx="1" fill={['#e06767', '#7cc4f2', '#ffd45e', '#7acc5e', '#c4788a', '#a088dd', '#f0a340'][j % 7]} />
          ))}
        </g>
      ))}
    </g>
    {/* 借书台 */}
    <g transform="translate(260 218)">
      <rect x="-50" y="-24" width="100" height="24" rx="3" fill="#cf9a63" stroke="#8d5a33" strokeWidth="2" />
      <rect x="-44" y="0" width="8" height="22" fill="#8d5a33" />
      <rect x="36" y="0" width="8" height="22" fill="#8d5a33" />
      {/* 电脑 */}
      <rect x="-10" y="-22" width="20" height="14" rx="2" fill="#3a3a3a" />
      <rect x="-8" y="-20" width="16" height="10" fill="#4a90db" opacity="0.6" />
    </g>
    {/* 管理员 */}
    <Person x={280} y={200} scale={0.8} pose="stand" top="#7acc5e" bottom="#3f9440" hair="#7a5236" face="smile" longHair />
    {/* 眼镜 */}
    <g transform="translate(280 138)">
      <circle cx="-5" cy="0" r="4" fill="none" stroke="#4a453d" strokeWidth="1.2" />
      <circle cx="5" cy="0" r="4" fill="none" stroke="#4a453d" strokeWidth="1.2" />
      <line x1="-1" y1="0" x2="1" y2="0" stroke="#4a453d" strokeWidth="1.2" />
    </g>
    {/* 小孩借书 */}
    <Person x={200} y={210} scale={0.7} pose="reach" top="#ffd45e" bottom="#e06767" face="happy" />
    <Book x={240} y={210} scale={0.6} />
    <Sparkle x={350} y={80} r={6} color="#fff3c4" />
  </>
))

/** 邻居阿姨：门廊 + 提着菜 */
const Neighbor = def('neighbor', '邻居阿姨', () => (
  <>
    <Sky tone="dawn" />
    <Cloud x={80} y={40} scale={0.6} opacity={0.7} />
    <Ground y={210} color="#95da6c" deep="#5cb44c" />
    <Fence x={20} y={206} w={360} h={28} />
    <House x={340} y={214} scale={0.5} wall="#fff3dd" roof="#c9563f" />
    {/* 门廊 */}
    <g transform="translate(280 214)">
      <rect x="-20" y="-50" width="40" height="50" rx="3" fill="#b9773f" />
      <rect x="-16" y="-46" width="32" height="46" rx="2" fill="#cf9a63" />
      <circle cx="12" cy="-24" r="1.5" fill="#ffd45e" />
    </g>
    {/* 邻居阿姨 */}
    <Person x={200} y={258} scale={0.85} pose="wave" skin="#ffd9b5" hair="#7a5236" top="#c4788a" bottom="#8a4a5a" face="smile" longHair />
    {/* 菜篮 */}
    <g transform="translate(170 270)">
      <path d="M-14,-10 q14,-6 28,0 L24,8 L-12,8 Z" fill="#c69b52" stroke="#8d5a33" strokeWidth="1.5" />
      <ellipse cx="0" cy="-10" rx="14" ry="4" fill="#7acc5e" opacity="0.7" />
      <ellipse cx="-4" cy="-13" rx="4" ry="3" fill="#e06767" />
      <ellipse cx="6" cy="-14" rx="3" ry="2.5" fill="#ffd45e" />
    </g>
    <Tree x={60} y={216} scale={0.6} kind="round" />
    <Flower x={40} y={282} scale={0.7} petal="#ff9fc0" />
    <Flower x={390} y={280} scale={0.6} petal="#ffd166" />
    <SpeechBubble x={250} y={190} scale={0.6} />
    <Sparkle x={100} y={100} r={6} color="#fff3c4" />
  </>
))

/** 公交司机：方向盘 + 车厢 */
const BusDriver = def('bus-driver', '公交司机', () => (
  <>
    <Sky tone="day" />
    <Cloud x={80} y={40} scale={0.55} opacity={0.75} />
    <Ground y={220} color="#9a9a9a" deep="#7a7a7a" />
    <rect x="0" y="220" width="400" height="80" fill="#8a8a8a" />
    <rect x="0" y="260" width="400" height="6" fill="#fffdf7" opacity="0.5" />
    {/* 公交车车头 */}
    <g transform="translate(200 220)">
      <rect x="-100" y="-80" width="200" height="80" rx="14" fill="#ffd45e" />
      <rect x="-100" y="-80" width="200" height="18" rx="9" fill="#e8b93a" />
      {/* 前窗 */}
      <rect x="-60" y="-58" width="120" height="40" rx="6" fill="#cfeaff" stroke="#e8b93a" strokeWidth="2" />
      {/* 方向盘区 */}
      <g transform="translate(-40 -30)">
        <circle cx="0" cy="0" r="10" fill="none" stroke="#4a453d" strokeWidth="3" />
        <circle cx="0" cy="0" r="3" fill="#4a453d" />
        <line x1="-8" y1="0" x2="8" y2="0" stroke="#4a453d" strokeWidth="2" />
        <line x1="0" y1="-8" x2="0" y2="8" stroke="#4a453d" strokeWidth="2" />
      </g>
      {/* 投币箱 */}
      <rect x="30" y="-50" width="24" height="30" rx="3" fill="#cf9a63" stroke="#8d5a33" strokeWidth="1.5" />
      <rect x="34" y="-46" width="16" height="8" rx="1" fill="#8d5a33" />
      {/* 车灯 */}
      <circle cx="-88" cy="-14" r="6" fill="#fff0a8" />
      <circle cx="88" cy="-14" r="6" fill="#fff0a8" />
      {/* 轮子 */}
      <circle cx="-56" cy="6" r="14" fill="#4a453d" />
      <circle cx="-56" cy="6" r="6" fill="#c9c2b4" />
      <circle cx="56" cy="6" r="14" fill="#4a453d" />
      <circle cx="56" cy="6" r="6" fill="#c9c2b4" />
    </g>
    {/* 司机 */}
    <Person x={160} y={194} scale={0.65} pose="sit" top="#4a90db" bottom="#2a4d66" hair="#3a3230" face="calm" />
    {/* 站牌 */}
    <g transform="translate(40 240)">
      <rect x="-3" y="-60" width="6" height="60" fill="#4a453d" />
      <rect x="-20" y="-60" width="40" height="24" rx="3" fill="#4a90db" stroke="#2a70a0" strokeWidth="1.5" />
      <rect x="-16" y="-56" width="32" height="3" fill="#ffffff" opacity="0.6" />
      <rect x="-16" y="-50" width="24" height="3" fill="#ffffff" opacity="0.4" />
    </g>
    <Sparkle x={300} y={100} r={6} color="#fff3c4" />
  </>
))

/* ---------------- C6. 写事·补充 ---------------- */

/** 迟到了：跑步 + 书包 + 校门 + 时钟 */
const Late = def('late', '迟到了', () => (
  <>
    <Sky tone="dawn" />
    <Cloud x={80} y={40} scale={0.5} opacity={0.7} />
    <Ground y={210} color="#95da6c" deep="#5cb44c" />
    <House x={340} y={214} scale={0.5} wall="#f0e8d8" roof="#c9563f" />
    {/* 校门 */}
    <g transform="translate(280 214)">
      <rect x="-30" y="-50" width="6" height="50" fill="#b9773f" />
      <rect x="24" y="-50" width="6" height="50" fill="#b9773f" />
      <path d="M-30,-50 q30,-12 60,0" fill="#c9563f" />
      <rect x="-20" y="-44" width="40" height="8" rx="2" fill="#4a90db" />
      <text x="0" y="-37" text-anchor="middle" font-size="6" fill="#ffffff">学校</text>
    </g>
    {/* 时钟 */}
    <g transform="translate(80 100)">
      <circle cx="0" cy="0" r="18" fill="#fffdf7" stroke="#4a453d" strokeWidth="2" />
      <line x1="0" y1="0" x2="0" y2="-12" stroke="#4a453d" strokeWidth="2" strokeLinecap="round" />
      <line x1="0" y1="0" x2="8" y2="2" stroke="#e04040" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="0" cy="0" r="2" fill="#4a453d" />
      <text x="0" y="-22" text-anchor="middle" font-size="8" fill="#e04040">8:10</text>
    </g>
    {/* 小孩跑步 */}
    <Person x={200} y={268} scale={0.85} pose="run" top="#ffd45e" bottom="#e06767" face="surprised" />
    <Backpack x={175} y={235} scale={0.5} />
    {/* 速度线 */}
    <g stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.6">
      <path d="M150,250 L165,248" />
      <path d="M148,260 L165,258" />
      <path d="M152,270 L168,268" />
    </g>
    <Flower x={40} y={282} scale={0.6} petal="#ff9fc0" />
    <Sparkle x={200} y={130} r={6} color="#fff0a8" />
  </>
))

/** 得奖了：领奖台 + 奖杯 + 台下鼓掌 */
const Award = def('award', '得奖了', () => (
  <>
    <Sky tone="day" />
    <Sun x={332} y={48} r={22} glow={false} />
    <Cloud x={80} y={40} scale={0.55} opacity={0.8} />
    <Ground y={220} color="#95da6c" deep="#5cb44c" />
    {/* 彩旗 */}
    <g>
      {seeds(1301, 6).map((_s, i) => (
        <path key={i} d={`M${40 + i * 64},30 L${40 + i * 64 + 14},44 L${40 + i * 64 + 28},30 Z`} fill={['#e06767', '#7cc4f2', '#ffd45e', '#7acc5e', '#c4788a', '#a088dd'][i % 6]} />
      ))}
      <path d="M40,30 Q200,18 360,30" fill="none" stroke="#4a453d" strokeWidth="1.5" opacity="0.4" />
    </g>
    {/* 领奖台 */}
    <g transform="translate(200 220)">
      <rect x="-60" y="-16" width="40" height="16" fill="#d0c8b0" stroke="#b0a890" strokeWidth="1.5" />
      <rect x="-20" y="-24" width="40" height="24" fill="#e0d8c0" stroke="#b0a890" strokeWidth="1.5" />
      <rect x="20" y="-16" width="40" height="16" fill="#d0c8b0" stroke="#b0a890" strokeWidth="1.5" />
      <text x="0" y="-8" text-anchor="middle" font-size="8" fill="#8d5a33">1</text>
    </g>
    {/* 得奖孩子 */}
    <Person x={200} y={198} scale={0.8} pose="wave" top="#ffd45e" bottom="#e06767" face="happy" />
    {/* 奖杯 */}
    <g transform="translate(200 188)">
      <path d="M-8,0 q-4,-14 0,-20 L8,-20 q4,14 0,20 Z" fill="#ffd45e" stroke="#d4941f" strokeWidth="1.5" />
      <path d="M-8,-16 q-6,2 -6,-6 M8,-16 q6,2 6,-6" fill="none" stroke="#d4941f" strokeWidth="2" />
      <rect x="-4" y="0" width="8" height="6" fill="#d4941f" />
      <rect x="-8" y="6" width="16" height="4" rx="1" fill="#d4941f" />
      <path d="M0,-24 l3,6 l6,1 l-4,4 l1,6 l-6,-3 l-6,3 l1,-6 l-4,-4 l6,-1 Z" fill="#fff0a8" transform="translate(0 -2) scale(0.4)" />
    </g>
    {/* 台下同学 */}
    <Person x={120} y={240} scale={0.6} pose="stand" top="#7cc4f2" face="happy" />
    <Person x={150} y={242} scale={0.6} pose="wave" top="#7acc5e" face="smile" />
    <Person x={250} y={240} scale={0.6} pose="stand" top="#a088dd" face="happy" />
    <Person x={280} y={242} scale={0.6} pose="wave" top="#ffd45e" face="smile" />
    <Sparkle x={200} y={140} r={10} color="#fff3c4" />
  </>
))

/** 生病了：床 + 温度计 + 药杯 */
const Sick = def('sick', '生病了', () => (
  <>
    <RoomWall wall="#f0f6ff" floor="#e0e8f0" floorY={220} wainscot="#d0dce8" />
    {/* 床 */}
    <g transform="translate(200 220)">
      <rect x="-80" y="-20" width="160" height="20" rx="3" fill="#cf9a63" stroke="#8d5a33" strokeWidth="2" />
      <rect x="-80" y="-30" width="160" height="12" rx="3" fill="#fff3dd" />
      <rect x="-76" y="0" width="8" height="20" fill="#8d5a33" />
      <rect x="68" y="0" width="8" height="20" fill="#8d5a33" />
      {/* 被子 */}
      <path d="M-30,-28 q40,-8 70,0 L70,-14 L-30,-14 Z" fill="#7cc4f2" stroke="#4a90db" strokeWidth="1.5" />
    </g>
    {/* 小孩躺着 */}
    <Person x={160} y={198} scale={0.7} pose="lie" top="#ffd45e" bottom="#5a6b8c" face="sad" />
    {/* 妈妈陪伴 */}
    <Person x={280} y={214} scale={0.7} pose="sit" skin="#ffd9b5" hair="#7a5236" top="#c4788a" bottom="#8a4a5a" face="calm" longHair />
    {/* 温度计 */}
    <g transform="translate(310 160)">
      <rect x="-2" y="-20" width="4" height="24" rx="2" fill="#ffffff" stroke="#4a453d" strokeWidth="1" />
      <circle cx="0" cy="6" r="4" fill="#e04040" />
      <rect x="-1" y="-12" width="2" height="18" fill="#e04040" />
    </g>
    {/* 药杯 */}
    <g transform="translate(120 196)">
      <path d="M-8,-8 L8,-8 L6,0 L-6,0 Z" fill="#ffffff" stroke="#b0c8d8" strokeWidth="1.5" />
      <ellipse cx="0" cy="-8" rx="8" ry="2.5" fill="#7acc5e" opacity="0.6" />
    </g>
    <Plant x={350} y={240} scale={0.5} />
    <Sparkle x={50} y={100} r={5} color="#fff3c4" opacity={0.5} />
  </>
))

/** 搬新家：纸箱 + 新房间 */
const Moving = def('moving', '搬新家', () => (
  <>
    <RoomWall wall="#fff8ec" floor="#e7d3b4" floorY={218} wainscot="#f4e3c8" />
    {/* 纸箱堆 */}
    <g transform="translate(280 218)">
      <rect x="-30" y="-30" width="60" height="30" rx="2" fill="#d9b878" stroke="#b89050" strokeWidth="2" />
      <path d="M-30,-30 q30,-6 60,0" fill="none" stroke="#b89050" strokeWidth="2" />
      <rect x="-26" y="-26" width="6" height="4" fill="#b89050" />
      <rect x="20" y="-26" width="6" height="4" fill="#b89050" />
      <rect x="-20" y="-50" width="40" height="20" rx="2" fill="#cda868" stroke="#b89050" strokeWidth="2" />
      <path d="M-20,-50 q20,-4 40,0" fill="none" stroke="#b89050" strokeWidth="1.5" />
      <rect x="-16" y="-46" width="5" height="3" fill="#b89050" />
    </g>
    {/* 小孩搬箱子 */}
    <Person x={160} y={250} scale={0.8} pose="stand" top="#7cc4f2" bottom="#5a6b8c" face="smile" />
    <g transform="translate(160 240)">
      <rect x="-16" y="-18" width="32" height="18" rx="2" fill="#d9b878" stroke="#b89050" strokeWidth="1.5" />
      <path d="M-16,-18 q16,-4 32,0" fill="none" stroke="#b89050" strokeWidth="1.5" />
    </g>
    {/* 空房间——只有窗帘和窗 */}
    <WindowPane x={50} y={80} w={80} h={60} frame="#e0b27e" />
    {/* 窗帘 */}
    <g>
      <path d="M42,80 q-4,30 0,60 L50,140 L42,80 Z" fill="#c4788a" opacity="0.7" />
      <path d="M130,80 q4,30 0,60 L122,140 L130,80 Z" fill="#c4788a" opacity="0.7" />
    </g>
    <Plant x={100} y={240} scale={0.5} />
    <Sparkle x={350} y={80} r={6} color="#fff3c4" />
  </>
))

/** 考试前夜：台灯 + 课本 + 时钟 */
const ExamNervous = def('exam-nervous', '考试前夜', () => (
  <>
    <RoomWall wall="#fdf2df" floor="#e7d3b4" floorY={218} wainscot="#f4e3c8" />
    {/* 书桌 */}
    <g transform="translate(200 218)">
      <rect x="-70" y="-12" width="140" height="12" rx="2" fill="#cf9a63" stroke="#8d5a33" strokeWidth="2" />
      <rect x="-64" y="0" width="6" height="22" fill="#8d5a33" />
      <rect x="58" y="0" width="6" height="22" fill="#8d5a33" />
    </g>
    {/* 小孩坐着 */}
    <Person x={200} y={210} scale={0.7} pose="sit" top="#7cc4f2" bottom="#5a6b8c" face="surprised" />
    {/* 课本堆 */}
    <g transform="translate(150 204)">
      <rect x="-20" y="-8" width="40" height="8" rx="1" fill="#7cc4f2" />
      <rect x="-18" y="-14" width="36" height="6" rx="1" fill="#ffd45e" />
      <rect x="-16" y="-20" width="32" height="6" rx="1" fill="#7acc5e" />
    </g>
    {/* 台灯 */}
    <g transform="translate(250 206)">
      <rect x="-4" y="-2" width="8" height="14" rx="2" fill="#4a453d" />
      <path d="M-4,-2 L-14,-16 L14,-16 L4,-2" fill="#ffd45e" stroke="#d4941f" strokeWidth="1.5" />
      <ellipse cx="0" cy="-16" rx="14" ry="4" fill="#fff0a8" opacity="0.7" />
    </g>
    {/* 时钟 */}
    <g transform="translate(100 100)">
      <circle cx="0" cy="0" r="16" fill="#fffdf7" stroke="#4a453d" strokeWidth="2" />
      <line x1="0" y1="0" x2="0" y2="-10" stroke="#4a453d" strokeWidth="2" strokeLinecap="round" />
      <line x1="0" y1="0" x2="7" y2="2" stroke="#e04040" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="0" cy="0" r="2" fill="#4a453d" />
    </g>
    {/* 铅笔 */}
    <Pencil x={280} y={210} scale={0.7} rotate={-20} />
    <Sparkle x={340} y={80} r={5} color="#fff3c4" opacity={0.5} />
  </>
))

/** 毕业告别：拍照 + 校服 + 花束 */
const Graduation = def('graduation', '毕业告别', () => (
  <>
    <Sky tone="day" />
    <Sun x={332} y={48} r={22} glow={false} />
    <Cloud x={80} y={40} scale={0.6} opacity={0.85} />
    <Ground y={210} color="#95da6c" deep="#5cb44c" />
    <House x={340} y={214} scale={0.45} wall="#f0e8d8" roof="#c9563f" />
    <Tree x={60} y={216} scale={0.65} kind="round" />
    {/* 三个同学站一排 */}
    <Person x={150} y={262} scale={0.8} pose="wave" top="#ffffff" bottom="#4a90db" face="happy" />
    <Person x={200} y={264} scale={0.8} pose="stand" top="#ffffff" bottom="#e06767" face="smile" longHair />
    <Person x={250} y={262} scale={0.8} pose="wave" top="#ffffff" bottom="#7acc5e" face="happy" />
    {/* 毕业帽 */}
    {[150, 200, 250].map((px, i) => (
      <g key={i} transform={`translate(${px} ${264 - 78 * 0.8})`}>
        <rect x="-10" y="-4" width="20" height="4" fill="#3a3230" />
        <path d="M-12,-4 L0,-12 L12,-4 Z" fill="#3a3230" />
        <path d="M0,-8 L4,0 L0,2 L-4,0 Z" fill="#ffd45e" />
      </g>
    ))}
    {/* 花束 */}
    <g transform="translate(300 248)">
      <ellipse cx="0" cy="0" rx="14" ry="10" fill="#7acc5e" opacity="0.5" />
      <circle cx="-6" cy="-4" r="5" fill="#e06767" />
      <circle cx="6" cy="-6" r="5" fill="#ffd45e" />
      <circle cx="0" cy="-2" r="5" fill="#c4788a" />
      <circle cx="-4" cy="4" r="4" fill="#7cc4f2" />
      <circle cx="5" cy="3" r="4" fill="#7acc5e" />
    </g>
    {/* 彩旗 */}
    <g>
      {seeds(1401, 5).map((_s, i) => (
        <path key={i} d={`M${60 + i * 70},24 L${60 + i * 70 + 12},36 L${60 + i * 70 + 24},24 Z`} fill={['#e06767', '#ffd45e', '#7acc5e', '#7cc4f2', '#c4788a'][i]} />
      ))}
      <path d="M60,24 Q200,14 340,24" fill="none" stroke="#4a453d" strokeWidth="1.5" opacity="0.3" />
    </g>
    <Sparkle x={200} y={120} r={8} color="#fff3c4" />
  </>
))

/** 第一次独睡：床 + 月亮窗 + 被子蒙头 */
const SleepAlone = def('sleep-alone', '第一次独睡', () => (
  <>
    <Sky tone="night" />
    <Moon x={312} y={58} r={22} />
    {seeds(1501, 12).map((s, i) => (
      <Star key={i} x={rnd(s, 20, 280)} y={rnd(s + 1, 16, 100)} r={rnd(s + 2, 1.5, 3)} opacity={rnd(s + 3, 0.6, 1)} />
    ))}
    <RoomWall wall="#2a2a3a" floor="#1a1a2a" floorY={218} wainscot="#222238" />
    {/* 窗 */}
    <WindowPane x={40} y={60} w={90} h={66} frame="#5a5a6a" />
    {/* 床 */}
    <g transform="translate(200 218)">
      <rect x="-70" y="-18" width="140" height="18" rx="3" fill="#8d5a33" />
      <rect x="-70" y="-26" width="140" height="10" rx="3" fill="#fff3dd" />
      <rect x="-66" y="0" width="6" height="20" fill="#8d5a33" />
      <rect x="60" y="0" width="6" height="20" fill="#8d5a33" />
      {/* 被子鼓起 */}
      <path d="M-40,-24 q20,-14 40,-4 q20,10 40,0 L40,-12 L-40,-12 Z" fill="#4a90db" stroke="#2a70a0" strokeWidth="1.5" />
    </g>
    {/* 被子里的眼睛 */}
    <g transform="translate(200 196)">
      <circle cx="-5" cy="0" r="2" fill="#ffffff" />
      <circle cx="5" cy="0" r="2" fill="#ffffff" />
      <circle cx="-5" cy="0" r="1" fill={C.ink} />
      <circle cx="5" cy="0" r="1" fill={C.ink} />
    </g>
    <Plant x={350} y={240} scale={0.5} leaf="#3a5a3a" leafDark="#2a4a2a" />
    <Sparkle x={100} y={120} r={4} color="#fff0a8" opacity={0.5} />
  </>
))

/** 生日：蛋糕 + 蜡烛 + 气球 + 家人 */
const Birthday = def('birthday', '生日', () => (
  <>
    <RoomWall wall="#fff5f0" floor="#e7d3b4" floorY={218} wainscot="#f4e0d8" />
    {/* 彩旗 */}
    <g>
      {seeds(1601, 6).map((_s, i) => (
        <path key={i} d={`M${40 + i * 64},24 L${40 + i * 64 + 12},36 L${40 + i * 64 + 24},24 Z`} fill={['#e06767', '#7cc4f2', '#ffd45e', '#7acc5e', '#c4788a', '#a088dd'][i % 6]} />
      ))}
    </g>
    {/* 气球 */}
    <Balloon x={60} y={200} scale={0.7} color="#7cc4f2" />
    <Balloon x={340} y={200} scale={0.6} color="#ffd45e" />
    {/* 蛋糕 */}
    <g transform="translate(200 218)">
      <ellipse cx="0" cy="-2" rx="40" ry="8" fill="#f6d8b0" />
      <path d="M-40,-2 q0,20 40,20 q40,0 40,-20" fill="#fff3dd" stroke="#e0c8a0" strokeWidth="2" />
      <ellipse cx="0" cy="-2" rx="40" ry="8" fill="#ffd9b5" />
      {/* 奶油花 */}
      <g fill="#ffffff">
        {seeds(1701, 6).map((_s, i) => (
          <circle key={i} cx={-30 + i * 12} cy="-6" r="4" />
        ))}
      </g>
      {/* 蜡烛 */}
      <g>
        {seeds(1801, 5).map((_s, i) => (
          <g key={i} transform={`translate(${-16 + i * 8} -12)`}>
            <rect x="-1.5" y="-16" width="3" height="16" fill="#ffd45e" />
            <path d="M0,-16 q-2,-4 0,-8 q2,4 0,8 Z" fill="#ff7d3d" />
            <circle cx="0" cy="-20" r="2" fill="#ff7d3d" opacity="0.6" />
          </g>
        ))}
      </g>
    </g>
    {/* 小孩 */}
    <Person x={120} y={250} scale={0.75} pose="reach" top="#ffd45e" bottom="#e06767" face="happy" />
    <Person x={290} y={250} scale={0.7} pose="stand" skin="#ffd9b5" hair="#3a3230" top="#4a90db" face="smile" />
    <Person x={330} y={252} scale={0.7} pose="stand" skin="#f0c8a0" hair="#d0d0d0" top="#c4788a" face="smile" longHair />
    <Sparkle x={200} y={120} r={8} color="#fff3c4" />
  </>
))

/* ---------------- D6. 状物·补充 ---------------- */

/** 金鱼缸：玻璃缸 + 金鱼 + 水草 + 气泡 */
const Goldfish = def('goldfish', '金鱼缸', () => (
  <>
    <RoomWall wall="#f0f8ff" floor="#e0e8f0" floorY={220} wainscot="#d0dce8" />
    <WindowPane x={50} y={60} w={80} h={56} frame="#e0b27e" />
    {/* 鱼缸 */}
    <g transform="translate(200 220)">
      <path d="M-70,0 L-70,-70 q0,-10 70,-10 q70,0 70,10 L70,0 Z" fill="#cfeaff" opacity="0.7" stroke="#a0c8d8" strokeWidth="2.5" />
      <path d="M-70,0 L-70,-70 L70,-70 L70,0" fill="none" stroke="#a0c8d8" strokeWidth="2.5" />
      <ellipse cx="0" cy="-8" rx="70" ry="6" fill="#ffffff" opacity="0.3" />
      {/* 水草 */}
      <g stroke="#3f9440" strokeWidth="3" strokeLinecap="round" fill="none">
        <path d="M-50,-10 q-6,-20 -2,-36" />
        <path d="M-44,-10 q4,-18 0,-30" />
        <path d="M48,-10 q6,-16 2,-28" />
      </g>
      {/* 金鱼 */}
      <g transform="translate(-20 -30)">
        <ellipse cx="0" cy="0" rx="14" ry="9" fill="#ff7d3d" />
        <path d="M-14,0 q-10,-8 -8,4 q2,10 8,4 Z" fill="#ff7d3d" opacity="0.8" />
        <circle cx="6" cy="-3" r="4.5" fill="#ffffff" />
        <circle cx="7" cy="-3" r="2.5" fill={C.ink} />
        <circle cx="7.5" cy="-3.5" r="0.8" fill="#ffffff" />
        <path d="M-2,2 q4,4 6,0" stroke={C.ink} strokeWidth="0.8" fill="none" />
      </g>
      <g transform="translate(30 -22) scale(0.7)">
        <ellipse cx="0" cy="0" rx="12" ry="7" fill="#ff9b6b" />
        <path d="M-12,0 q-8,-6 -6,3 q1,8 6,3 Z" fill="#ff9b6b" opacity="0.8" />
        <circle cx="5" cy="-2" r="4" fill="#ffffff" />
        <circle cx="6" cy="-2" r="2.2" fill={C.ink} />
      </g>
      {/* 气泡 */}
      <g fill="#ffffff" opacity="0.6">
        <circle cx="-30" cy="-50" r="3" />
        <circle cx="-20" cy="-58" r="2" />
        <circle cx="20" cy="-52" r="2.5" />
        <circle cx="35" cy="-60" r="1.5" />
      </g>
      {/* 石子 */}
      <g fill="#c3c9cf" opacity="0.7">
        <ellipse cx="-40" cy="-6" rx="6" ry="3" />
        <ellipse cx="-10" cy="-4" rx="5" ry="2.5" />
        <ellipse cx="25" cy="-6" rx="7" ry="3" />
      </g>
    </g>
    <Plant x={360} y={240} scale={0.5} />
    <Sparkle x={100} y={120} r={5} color="#fff3c4" opacity={0.5} />
  </>
))

/** 文具盒：打开的铁盒 + 笔 + 尺子 */
const PencilCase = def('pencil-case', '文具盒', () => (
  <>
    <RoomWall wall="#fdf6ec" floor="#e7d3b4" floorY={220} wainscot="#f0e0c0" />
    {/* 文具盒 */}
    <g transform="translate(200 200)">
      {/* 盒身 */}
      <path d="M-60,0 L-56,-14 q4,-4 56,-4 q52,0 56,4 L60,0 Z" fill="#4a90db" stroke="#2a70a0" strokeWidth="2" />
      <path d="M-56,-14 q4,-4 56,-4 q52,0 56,4 L60,0" fill="none" stroke="#2a70a0" strokeWidth="2" />
      {/* 盒盖打开 */}
      <path d="M-56,-14 q-4,-16 -40,-20 q40,-4 56,14 Z" fill="#3a80cb" stroke="#2a70a0" strokeWidth="2" />
      {/* 笔 */}
      <g transform="translate(-30 -12) rotate(-8)">
        <rect x="-2" y="-30" width="4" height="30" fill="#ffd45e" />
        <path d="M-2,-30 L0,-36 L2,-30 Z" fill="#f4e0bd" />
        <path d="M-1,-33 L0,-36 L1,-33 Z" fill={C.ink} />
        <rect x="-2" y="-34" width="4" height="4" fill="#f28ba0" />
      </g>
      <g transform="translate(-10 -12) rotate(5)">
        <rect x="-2" y="-26" width="4" height="26" fill="#7acc5e" />
        <path d="M-2,-26 L0,-32 L2,-26 Z" fill="#f4e0bd" />
        <path d="M-1,-29 L0,-32 L1,-29 Z" fill={C.ink} />
      </g>
      <g transform="translate(12 -12) rotate(-3)">
        <rect x="-2" y="-24" width="4" height="24" fill="#e06767" />
        <path d="M-2,-24 L0,-30 L2,-24 Z" fill="#f4e0bd" />
      </g>
      {/* 尺子 */}
      <g transform="translate(30 -10)">
        <rect x="-2" y="-22" width="4" height="22" fill="#cfeaff" stroke="#a0c8d8" strokeWidth="1" />
        <g stroke="#a0c8d8" strokeWidth="0.6">
          {seeds(1901, 6).map((_s, i) => (
            <line key={i} x1="-2" y1={-20 + i * 4} x2="2" y2={-20 + i * 4} />
          ))}
        </g>
      </g>
      {/* 橡皮 */}
      <Eraser x={0} y={-4} scale={0.6} face={false} />
    </g>
    {/* 书 */}
    <Book x={300} y={210} scale={0.5} />
    <Sparkle x={100} y={100} r={5} color="#fff3c4" opacity={0.5} />
  </>
))

/** 我的房间：床 + 书桌 + 书架 + 窗帘 */
const MyRoom = def('my-room', '我的房间', () => (
  <>
    <RoomWall wall="#f0f6ff" floor="#e0e8f0" floorY={220} wainscot="#d0dce8" />
    {/* 窗 */}
    <WindowPane x={40} y={50} w={90} h={60} frame="#e0b27e" />
    <g>
      <path d="M32,50 q-4,30 0,60 L42,110 L32,50 Z" fill="#7cc4f2" opacity="0.6" />
      <path d="M130,50 q4,30 0,60 L122,110 L130,50 Z" fill="#7cc4f2" opacity="0.6" />
    </g>
    {/* 床 */}
    <g transform="translate(80 220)">
      <rect x="-30" y="-18" width="60" height="18" rx="2" fill="#cf9a63" stroke="#8d5a33" strokeWidth="2" />
      <rect x="-30" y="-26" width="60" height="10" rx="2" fill="#fff3dd" />
      <rect x="-26" y="0" width="6" height="22" fill="#8d5a33" />
      <rect x="20" y="0" width="6" height="22" fill="#8d5a33" />
      <path d="M-10,-24 q14,-6 26,0 L16,-12 L-10,-12 Z" fill="#7cc4f2" />
      <rect x="-28" y="-34" width="8" height="10" rx="2" fill="#ffd45e" />
    </g>
    {/* 书桌 */}
    <g transform="translate(250 220)">
      <rect x="-50" y="-10" width="100" height="10" rx="2" fill="#cf9a63" stroke="#8d5a33" strokeWidth="1.5" />
      <rect x="-46" y="0" width="6" height="22" fill="#8d5a33" />
      <rect x="40" y="0" width="6" height="22" fill="#8d5a33" />
      {/* 台灯 */}
      <g transform="translate(-30 -10)">
        <rect x="-3" y="-2" width="6" height="12" rx="1" fill="#4a453d" />
        <path d="M-3,-2 L-10,-12 L10,-12 L3,-2" fill="#ffd45e" stroke="#d4941f" strokeWidth="1" />
      </g>
      {/* 书本 */}
      <Book x={10} y={-8} scale={0.5} />
    </g>
    {/* 书架 */}
    <g transform="translate(340 220)">
      <rect x="-30" y="-80" width="60" height="80" rx="3" fill="#cf9a63" stroke="#8d5a33" strokeWidth="2" />
      {seeds(2001, 3).map((_s, i) => (
        <g key={i}>
          <rect x="-26" y={-76 + i * 26} width="52" height="3" fill="#8d5a33" opacity="0.5" />
          {seeds(2001 + i * 10, 5).map((_s2, j) => (
            <rect key={j} x={-24 + j * 11} y={-73 + i * 26} width="9" height="20" rx="1" fill={['#e06767', '#7cc4f2', '#ffd45e', '#7acc5e', '#c4788a'][j % 5]} />
          ))}
        </g>
      ))}
    </g>
    <Sparkle x={100} y={30} r={5} color="#fff3c4" opacity={0.5} />
  </>
))

/** 荷花：荷叶 + 花苞 + 水面 */
const Lotus = def('lotus', '荷花', () => (
  <>
    <Sky tone="day" />
    <Sun x={332} y={48} r={20} glow={false} />
    <Cloud x={80} y={40} scale={0.5} opacity={0.7} />
    <Water y={160} color="#7fc9ef" deep="#4aa5da" />
    {/* 荷叶 */}
    <g>
      <ellipse cx={100} cy={200} rx={44} ry={16} fill="#5cb44c" />
      <ellipse cx={100} cy={198} rx={38} ry="12" fill="#7acc5e" />
      <path d="M100,186 L100,212" stroke="#3f9440" strokeWidth="2" opacity="0.6" />
      <ellipse cx={280} cy={230} rx={50} ry="18" fill="#5cb44c" />
      <ellipse cx={280} cy={228} rx={42} ry="14" fill="#7acc5e" />
      <ellipse cx={200} cy={260} rx={36} ry="12" fill="#5cb44c" opacity="0.85" />
    </g>
    {/* 荷花（盛开） */}
    <g transform="translate(280 200)">
      {seeds(2101, 8).map((_s, i) => (
        <ellipse key={i} cx={Math.cos((i / 8) * Math.PI * 2) * 12} cy={Math.sin((i / 8) * Math.PI * 2) * 12 - 4} rx="6" ry="14" fill="#ffb7cf" stroke="#f78fb3" strokeWidth="1" transform={`rotate(${(i / 8) * 360} ${Math.cos((i / 8) * Math.PI * 2) * 12} ${Math.sin((i / 8) * Math.PI * 2) * 12 - 4})`} />
      ))}
      <circle cx="0" cy="-4" r="6" fill="#ffd45e" />
      <circle cx="0" cy="-4" r="3" fill="#f0a340" opacity="0.7" />
    </g>
    {/* 花苞 */}
    <g transform="translate(120 190) scale(0.7)">
      <path d="M0,0 q-10,-16 0,-28 q10,12 0,28 Z" fill="#f78fb3" stroke="#e0678f" strokeWidth="1.5" />
      <path d="M-3,-22 q3,-6 3,-6" fill="none" stroke="#7acc5e" strokeWidth="3" />
    </g>
    {/* 蜻蜓 */}
    <g transform="translate(160 150)">
      <ellipse cx="0" cy="0" rx="10" ry="2" fill="#6fb3ff" />
      <circle cx="8" cy="-1" r="2.5" fill="#6fb3ff" />
      <circle cx="9" cy="-2" r="0.8" fill={C.ink} />
      <ellipse cx="0" cy="-7" rx="9" ry="2.5" fill="#ffffff" opacity="0.5" transform="rotate(-12)" />
    </g>
    <Flower x={40} y={290} scale={0.5} petal="#ff9fc0" />
    <Sparkle x={250} y={100} r={6} color="#fff3c4" />
  </>
))

/** 仙人掌：花盆 + 刺 + 小花 */
const Cactus = def('cactus', '仙人掌', () => (
  <>
    <RoomWall wall="#fff8ec" floor="#e7d3b4" floorY={220} wainscot="#f4e3c8" />
    <WindowPane x={50} y={50} w={80} h={56} frame="#e0b27e" />
    {/* 花盆 + 仙人掌 */}
    <g transform="translate(200 220)">
      {/* 仙人掌本体 */}
      <ellipse cx="0" cy="-30" rx="18" ry="34" fill="#5cb44c" stroke="#3f9440" strokeWidth="2" />
      {/* 分枝 */}
      <ellipse cx="-16" cy="-40" rx="8" ry="14" fill="#5cb44c" stroke="#3f9440" strokeWidth="1.5" transform="rotate(-20 -16 -40)" />
      <ellipse cx="16" cy="-34" rx="8" ry="16" fill="#5cb44c" stroke="#3f9440" strokeWidth="1.5" transform="rotate(15 16 -34)" />
      {/* 刺 */}
      <g stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round">
        {seeds(2201, 10).map((s, i) => (
          <line key={i} x1={rnd(s, -14, 14)} y1={rnd(s + 1, -56, -6)} x2={rnd(s, -14, 14) + rnd(s + 2, -2, 2)} y2={rnd(s + 1, -56, -6) + rnd(s + 3, 2, 4)} />
        ))}
      </g>
      {/* 小花 */}
      <g transform="translate(0 -60)">
        {seeds(2301, 5).map((_s, i) => (
          <circle key={i} cx={Math.cos((i / 5) * Math.PI * 2) * 4} cy={Math.sin((i / 5) * Math.PI * 2) * 4} r="3" fill="#ff7d7d" />
        ))}
        <circle cx="0" cy="0" r="2" fill="#ffd45e" />
      </g>
      <g transform="translate(-16 -50) scale(0.5)">
        {seeds(2401, 5).map((_s, i) => (
          <circle key={i} cx={Math.cos((i / 5) * Math.PI * 2) * 3} cy={Math.sin((i / 5) * Math.PI * 2) * 3} r="2.5" fill="#ffd45e" />
        ))}
      </g>
      {/* 花盆 */}
      <path d="M-24,0 L-20,20 L20,20 L24,0 Z" fill="#cf9a63" stroke="#8d5a33" strokeWidth="2" />
      <rect x="-26" y="-4" width="52" height="6" rx="2" fill="#a4723f" />
    </g>
    <Plant x={360} y={240} scale={0.5} />
    <Sparkle x={100} y={100} r={5} color="#fff3c4" opacity={0.5} />
  </>
))

/** 旧照片：相框 + 泛黄 + 支架 */
const OldPhoto = def('old-photo', '旧照片', () => (
  <>
    <RoomWall wall="#fdf6ec" floor="#e7d3b4" floorY={220} wainscot="#f0e0c0" />
    <WindowPane x={50} y={50} w={80} h={56} frame="#e0b27e" />
    {/* 相框放在桌上 */}
    <g transform="translate(200 180)">
      {/* 支架 */}
      <path d="M-4,40 L0,56 L4,40" fill="none" stroke="#8d5a33" strokeWidth="3" strokeLinecap="round" />
      {/* 框 */}
      <rect x="-50" y="-40" width="100" height="80" rx="6" fill="#cf9a63" stroke="#8d5a33" strokeWidth="3" />
      <rect x="-44" y="-34" width="88" height="68" rx="3" fill="#f0e8c8" />
      {/* 泛黄照片内容 */}
      <g opacity="0.8">
        <rect x="-40" y="-30" width="80" height="60" rx="2" fill="#e8dcc0" />
        {/* 简笔风景 */}
        <path d="M-40,10 L-30,0 L-20,6 L-10,-2 L0,4 L10,-4 L20,2 L30,-2 L40,4 L40,30 L-40,30 Z" fill="#c8d8a0" opacity="0.6" />
        <circle cx="20" cy="-18" r="6" fill="#f0d060" opacity="0.5" />
        <g transform="translate(-20 -4) scale(0.4)">
          <path d="M-4,0 L-2,-20 L2,-20 L4,0 Z" fill="#8d5a33" opacity="0.5" />
          <circle cx="0" cy="-22" r="10" fill="#7acc5e" opacity="0.5" />
        </g>
      </g>
      {/* 小人影 */}
      <g opacity="0.4" fill="#8d5a33">
        <circle cx="-10" cy="8" r="3" />
        <rect x="-12" y="11" width="4" height="8" rx="1" />
      </g>
    </g>
    {/* 桌子 */}
    <g transform="translate(200 218)">
      <rect x="-70" y="-8" width="140" height="8" rx="2" fill="#cf9a63" stroke="#8d5a33" strokeWidth="1.5" />
      <rect x="-64" y="0" width="6" height="22" fill="#8d5a33" />
      <rect x="58" y="0" width="6" height="22" fill="#8d5a33" />
    </g>
    <Plant x={340} y={240} scale={0.5} />
    <Sparkle x={100} y={100} r={5} color="#fff3c4" opacity={0.5} />
  </>
))

/** 小乌龟：壳纹 + 短腿 + 水盆 */
const Turtle = def('turtle', '小乌龟', () => (
  <>
    <RoomWall wall="#f0f8ff" floor="#e0e8f0" floorY={220} wainscot="#d0dce8" />
    <WindowPane x={50} y={50} w={80} h={56} frame="#e0b27e" />
    {/* 水盆 */}
    <g transform="translate(200 220)">
      <ellipse cx="0" cy="0" rx="80" ry="14" fill="#7fc9ef" opacity="0.5" />
      <path d="M-80,0 q0,12 80,12 q80,0 80,-12" fill="#a0c8d8" opacity="0.6" />
      <ellipse cx="0" cy="-2" rx="80" ry="14" fill="none" stroke="#a0c8d8" strokeWidth="2" />
    </g>
    {/* 乌龟 */}
    <g transform="translate(200 206)">
      {/* 壳 */}
      <ellipse cx="0" cy="-10" rx="24" ry="16" fill="#5cb44c" stroke="#3f9440" strokeWidth="2" />
      {/* 壳纹 */}
      <g fill="#3f9440" opacity="0.5">
        <path d="M-12,-18 q4,8 0,16" fill="none" stroke="#3f9440" strokeWidth="1.5" />
        <path d="M0,-22 q0,10 0,16" fill="none" stroke="#3f9440" strokeWidth="1.5" />
        <path d="M12,-18 q-4,8 0,16" fill="none" stroke="#3f9440" strokeWidth="1.5" />
        <path d="M-18,-10 q10,4 20,0" fill="none" stroke="#3f9440" strokeWidth="1.5" />
        <path d="M-2,-14 q4,4 4,0" fill="none" stroke="#3f9440" strokeWidth="1.5" />
      </g>
      {/* 头 */}
      <ellipse cx="-22" cy="-10" rx="8" ry="6" fill="#7acc5e" stroke="#3f9440" strokeWidth="1.5" />
      <circle cx="-26" cy="-11" r="1.5" fill={C.ink} />
      <circle cx="-26.5" cy="-11.5" r="0.5" fill="#ffffff" />
      <path d="M-28,-8 q-2,2 -4,0" stroke={C.ink} strokeWidth="0.8" fill="none" />
      {/* 腿 */}
      <ellipse cx="-14" cy="2" rx="5" ry="4" fill="#7acc5e" stroke="#3f9440" strokeWidth="1.2" />
      <ellipse cx="14" cy="2" rx="5" ry="4" fill="#7acc5e" stroke="#3f9440" strokeWidth="1.2" />
      <ellipse cx="-10" cy="-2" rx="4" ry="3" fill="#7acc5e" stroke="#3f9440" strokeWidth="1.2" />
      <ellipse cx="10" cy="-2" rx="4" ry="3" fill="#7acc5e" stroke="#3f9440" strokeWidth="1.2" />
      {/* 尾巴 */}
      <path d="M22,-8 q6,0 8,-2" fill="none" stroke="#3f9440" strokeWidth="3" strokeLinecap="round" />
    </g>
    {/* 水草 */}
    <g stroke="#3f9440" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.6">
      <path d="M130,218 q-4,-10 0,-18" />
      <path d="M270,218 q4,-8 0,-16" />
    </g>
    <Plant x={360} y={240} scale={0.5} />
    <Sparkle x={100} y={100} r={5} color="#fff3c4" opacity={0.5} />
  </>
))

/** 闹钟：表盘 + 指针 + 铃铛 */
const Clock = def('clock', '闹钟', () => (
  <>
    <RoomWall wall="#fdf6ec" floor="#e7d3b4" floorY={220} wainscot="#f0e0c0" />
    <WindowPane x={50} y={50} w={80} h={56} frame="#e0b27e" />
    {/* 闹钟 */}
    <g transform="translate(200 170)">
      {/* 铃铛 */}
      <g fill="#e04040" stroke="#a02020" strokeWidth="2">
        <path d="M-26,-20 q-8,-14 -2,-20 q6,4 4,18 Z" />
        <path d="M26,-20 q8,-14 2,-20 q-6,4 -4,18 Z" />
      </g>
      {/* 表盘 */}
      <circle cx="0" cy="0" r="30" fill="#fffdf7" stroke="#e04040" strokeWidth="4" />
      {/* 刻度 */}
      <g stroke="#4a453d" strokeWidth="2" strokeLinecap="round">
        {seeds(2501, 12).map((_s, i) => {
          const a = (i * Math.PI) / 6 - Math.PI / 2
          return <line key={i} x1={Math.cos(a) * 24} y1={Math.sin(a) * 24} x2={Math.cos(a) * 28} y2={Math.sin(a) * 28} />
        })}
      </g>
      {/* 指针 */}
      <line x1="0" y1="0" x2="0" y2="-18" stroke="#4a453d" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="0" y1="0" x2="14" y2="4" stroke="#e04040" strokeWidth="2" strokeLinecap="round" />
      <circle cx="0" cy="0" r="3" fill="#4a453d" />
      {/* 脚 */}
      <g fill="#e04040" stroke="#a02020" strokeWidth="1.5">
        <ellipse cx="-20" cy="30" rx="5" ry="3" />
        <ellipse cx="20" cy="30" rx="5" ry="3" />
      </g>
    </g>
    {/* 桌子 */}
    <g transform="translate(200 218)">
      <rect x="-60" y="-8" width="120" height="8" rx="2" fill="#cf9a63" stroke="#8d5a33" strokeWidth="1.5" />
      <rect x="-54" y="0" width="6" height="22" fill="#8d5a33" />
      <rect x="48" y="0" width="6" height="22" fill="#8d5a33" />
    </g>
    <Plant x={340} y={240} scale={0.5} />
    <Sparkle x={100} y={100} r={5} color="#fff3c4" opacity={0.5} />
  </>
))

/* ---------------- E6. 想象·补充 ---------------- */

/** 假如我变小了：巨花 + 蚂蚁 */
const IfTiny = def('if-tiny', '假如我变小了', () => (
  <>
    <Sky tone="day" />
    <Sun x={332} y={50} r={24} />
    <Ground y={220} color="#95da6c" deep="#5cb44c" />
    {/* 巨大花 */}
    <g transform="translate(100 280) scale(3)">
      <path d="M0,0 L0,-30" stroke={C.grassDark} strokeWidth="2" strokeLinecap="round" />
      {seeds(2601, 6).map((_s, i) => (
        <circle key={i} cx={Math.cos((i / 6) * Math.PI * 2) * 8} cy={Math.sin((i / 6) * Math.PI * 2) * 8 - 30} r="6" fill="#ff8fb1" />
      ))}
      <circle cx="0" cy="-30" r="4" fill="#ffd45e" />
    </g>
    <g transform="translate(280 280) scale(2.5)">
      <path d="M0,0 L0,-24" stroke={C.grassDark} strokeWidth="2" strokeLinecap="round" />
      {seeds(2701, 5).map((_s, i) => (
        <circle key={i} cx={Math.cos((i / 5) * Math.PI * 2) * 6} cy={Math.sin((i / 5) * Math.PI * 2) * 6 - 24} r="5" fill="#ffd45e" />
      ))}
      <circle cx="0" cy="-24" r="3.5" fill="#e06767" />
    </g>
    {/* 草丛（巨大化） */}
    <g transform="translate(200 280) scale(2)">
      <GrassTuft x={0} y={0} scale={1} />
      <GrassTuft x={-20} y={5} scale={0.8} />
      <GrassTuft x={20} y={3} scale={0.9} />
    </g>
    {/* 变小的孩子 */}
    <Person x={200} y={268} scale={0.3} pose="stand" top="#ffd45e" face="surprised" />
    {/* 蚂蚁 */}
    <g transform="translate(140 285)">
      <ellipse cx="0" cy="0" rx="5" ry="3" fill="#3a3230" />
      <circle cx="-5" cy="-1" r="3" fill="#3a3230" />
      <circle cx="4" cy="-2" r="2" fill="#3a3230" />
      <g stroke="#3a3230" strokeWidth="0.8" fill="none">
        <path d="M-2,2 q-4,4 -8,2" />
        <path d="M2,2 q4,4 8,2" />
      </g>
      <circle cx="-6" cy="-2" r="0.5" fill="#ffffff" />
    </g>
    <Sparkle x={250} y={120} r={8} color="#fff3c4" />
  </>
))

/** 海底探险：鱼 + 珊瑚 + 潜水帽 */
const Underwater = def('underwater', '海底探险', () => (
  <>
    <Sky tone="day" />
    <rect x="0" y="0" width="400" height="300" fill="#4aa5da" />
    <rect x="0" y="0" width="400" height="100" fill="#7fc9ef" opacity="0.6" />
    {/* 水面光斑 */}
    <g fill="#ffffff" opacity="0.3">
      {seeds(2801, 8).map((s, i) => (
        <ellipse key={i} cx={rnd(s, 20, 380)} cy={rnd(s + 1, 10, 50)} rx={rnd(s + 2, 10, 30)} ry="2" />
      ))}
    </g>
    {/* 海底 */}
    <path d="M0,240 Q200,260 400,235 L400,300 L0,300 Z" fill="#d9bd8f" />
    {/* 珊瑚 */}
    <g>
      <g transform="translate(80 240)">
        <path d="M0,0 q-6,-20 -2,-36 M0,0 q6,-16 4,-28 M0,0 q-2,-14 0,-24" fill="none" stroke="#e06767" strokeWidth="6" strokeLinecap="round" />
        <circle cx="-2" cy="-36" r="4" fill="#ff8f8f" />
        <circle cx="4" cy="-28" r="3" fill="#ff8f8f" />
        <circle cx="0" cy="-24" r="3" fill="#ff8f8f" />
      </g>
      <g transform="translate(320 240) scale(0.8)">
        <path d="M0,0 q-5,-16 -1,-28 M0,0 q5,-12 3,-22 M0,0 q-1,-10 1,-18" fill="none" stroke="#ffd45e" strokeWidth="5" strokeLinecap="round" />
        <circle cx="-1" cy="-28" r="3" fill="#fff0a8" />
        <circle cx="3" cy="-22" r="2.5" fill="#fff0a8" />
      </g>
    </g>
    {/* 海草 */}
    <g stroke="#3f9440" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.7">
      <path d="M160,240 q-8,-20 0,-40 q8,-16 0,-30" />
      <path d="M240,240 q8,-16 0,-34 q-8,-14 0,-28" />
    </g>
    {/* 鱼 */}
    <g transform="translate(150 120)">
      <ellipse cx="0" cy="0" rx="16" ry="10" fill="#ffd45e" />
      <path d="M-16,0 q-8,-8 -6,4 q1,8 6,4 Z" fill="#ffd45e" opacity="0.8" />
      <circle cx="6" cy="-3" r="4" fill="#ffffff" />
      <circle cx="7" cy="-3" r="2" fill={C.ink} />
      <path d="M-2,2 q4,4 6,0" stroke={C.ink} strokeWidth="0.8" fill="none" />
    </g>
    <g transform="translate(280 80) scale(0.7) flip">
      <ellipse cx="0" cy="0" rx="14" ry="8" fill="#7cc4f2" />
      <path d="M-14,0 q-6,-6 -4,3 q1,6 4,3 Z" fill="#7cc4f2" opacity="0.8" />
      <circle cx="5" cy="-2" r="3.5" fill="#ffffff" />
      <circle cx="6" cy="-2" r="1.8" fill={C.ink} />
    </g>
    {/* 气泡 */}
    <g fill="#ffffff" opacity="0.5">
      {seeds(2901, 10).map((s, i) => (
        <circle key={i} cx={rnd(s, 20, 380)} cy={rnd(s + 1, 100, 250)} r={rnd(s + 2, 2, 5)} />
      ))}
    </g>
    {/* 小孩戴潜水帽 */}
    <Person x={200} y={200} scale={0.6} pose="reach" top="#4aa5da" face="happy" />
    <g transform="translate(200 148)">
      <circle cx="0" cy="0" r="14" fill="#cfeaff" opacity="0.6" stroke="#4aa5da" strokeWidth="2" />
    </g>
    <Sparkle x={100} y={60} r={6} color="#ffffff" opacity={0.6} />
  </>
))

/** 太空旅行：星球 + 火箭 + 宇航员 */
const Space = def('space', '太空旅行', () => (
  <>
    <rect x="0" y="0" width="400" height="300" fill="#2b3a6b" />
    {/* 星星 */}
    <g fill="#fff0a8">
      {seeds(3001, 30).map((s, i) => (
        <circle key={i} cx={rnd(s, 0, 400)} cy={rnd(s + 1, 0, 300)} r={rnd(s + 2, 0.5, 1.5)} opacity={rnd(s + 3, 0.5, 1)} />
      ))}
    </g>
    <Star x={60} y={50} r={5} color="#ffd45e" />
    <Star x={330} y={80} r={4} color="#fff0a8" />
    {/* 星球 */}
    <g transform="translate(100 200)">
      <circle cx="0" cy="0" r="36" fill="#e06767" />
      <path d="M-30,-6 q10,10 20,0 q10,-10 20,0" fill="none" stroke="#a04040" strokeWidth="2" opacity="0.5" />
      <ellipse cx="-12" cy="-10" rx="8" ry="4" fill="#ff8f8f" opacity="0.4" />
      <ellipse cx="0" cy="0" rx="50" ry="10" fill="none" stroke="#ffd45e" strokeWidth="2" opacity="0.5" transform="rotate(-15)" />
    </g>
    <g transform="translate(310 230) scale(0.6)">
      <circle cx="0" cy="0" r="28" fill="#4a90db" />
      <ellipse cx="-8" cy="-6" rx="6" ry="3" fill="#7fc9ef" opacity="0.4" />
    </g>
    {/* 火箭 */}
    <g transform="translate(220 120) rotate(35)">
      <path d="M0,-30 q-8,0 -8,20 L-8,10 L8,10 L8,-10 q0,-20 -8,-20 Z" fill="#ffffff" stroke="#4a453d" strokeWidth="2" />
      <path d="M-8,10 L-14,20 L-8,10 M8,10 L14,20 L8,10" fill="#e04040" stroke="#a02020" strokeWidth="1.5" />
      <circle cx="0" cy="-10" r="4" fill="#4aa5da" stroke="#2a70a0" strokeWidth="1.5" />
      {/* 尾焰 */}
      <path d="M-6,10 q-4,10 0,18 q4,-8 0,-18" fill="#ffd45e" />
      <path d="M0,10 q-2,10 0,16 q2,-8 0,-16" fill="#ff7d3d" />
      <path d="M6,10 q4,10 0,18 q-4,-8 0,-18" fill="#ffd45e" />
    </g>
    {/* 宇航员 */}
    <g transform="translate(200 240)">
      <circle cx="0" cy="-20" r="14" fill="#ffffff" stroke="#4a453d" strokeWidth="2" />
      <ellipse cx="0" cy="-20" rx="10" ry="9" fill="#cfeaff" opacity="0.7" />
      <rect x="-10" y="-8" width="20" height="20" rx="4" fill="#ffffff" stroke="#4a453d" strokeWidth="2" />
      <rect x="-6" y="12" width="5" height="14" rx="2" fill="#ffffff" stroke="#4a453d" strokeWidth="1.5" />
      <rect x="1" y="12" width="5" height="14" rx="2" fill="#ffffff" stroke="#4a453d" strokeWidth="1.5" />
    </g>
    <Sparkle x={200} y={60} r={8} color="#ffffff" />
  </>
))

/** 机器人朋友：方头 + 天线 + 齿轮 */
const RobotFriend = def('robot-friend', '机器人朋友', () => (
  <>
    <Sky tone="day" />
    <Sun x={332} y={48} r={22} glow={false} />
    <Cloud x={80} y={40} scale={0.5} opacity={0.7} />
    <Ground y={210} color="#a0a0a0" deep="#7a7a7a" />
    {/* 机器人 */}
    <g transform="translate(200 210)">
      {/* 天线 */}
      <line x1="0" y1="-60" x2="0" y2="-72" stroke="#4a453d" strokeWidth="3" strokeLinecap="round" />
      <circle cx="0" cy="-74" r="4" fill="#e04040" />
      {/* 头 */}
      <rect x="-22" y="-60" width="44" height="40" rx="6" fill="#c0c8d0" stroke="#4a453d" strokeWidth="2.5" />
      {/* 眼 */}
      <circle cx="-8" cy="-44" r="6" fill="#4aa5da" stroke="#2a70a0" strokeWidth="1.5" />
      <circle cx="8" cy="-44" r="6" fill="#4aa5da" stroke="#2a70a0" strokeWidth="1.5" />
      <circle cx="-8" cy="-44" r="2.5" fill={C.ink} />
      <circle cx="8" cy="-44" r="2.5" fill={C.ink} />
      <circle cx="-7.5" cy="-44.5" r="0.8" fill="#ffffff" />
      <circle cx="8.5" cy="-44.5" r="0.8" fill="#ffffff" />
      {/* 嘴 */}
      <rect x="-8" y="-30" width="16" height="4" rx="2" fill="#4a453d" />
      {/* 身体 */}
      <rect x="-20" y="-20" width="40" height="36" rx="4" fill="#c0c8d0" stroke="#4a453d" strokeWidth="2.5" />
      {/* 齿轮 */}
      <g transform="translate(0 -4)">
        <circle cx="0" cy="0" r="8" fill="#ffd45e" stroke="#d4941f" strokeWidth="1.5" />
        <g fill="#d4941f">
          {seeds(3101, 6).map((_s, i) => {
            const a = (i * Math.PI) / 3
            return <rect key={i} x={Math.cos(a) * 8 - 1.5} y={Math.sin(a) * 8 - 1.5} width="3" height="3" rx="0.5" transform={`rotate(${(i * 60)} ${Math.cos(a) * 8} ${Math.sin(a) * 8})`} />
          })}
        </g>
        <circle cx="0" cy="0" r="3" fill="#d4941f" />
      </g>
      {/* 手臂 */}
      <rect x="-28" y="-16" width="8" height="24" rx="3" fill="#c0c8d0" stroke="#4a453d" strokeWidth="2" />
      <rect x="20" y="-16" width="8" height="24" rx="3" fill="#c0c8d0" stroke="#4a453d" strokeWidth="2" />
      <circle cx="-24" cy="10" r="5" fill="#c0c8d0" stroke="#4a453d" strokeWidth="2" />
      <circle cx="24" cy="10" r="5" fill="#c0c8d0" stroke="#4a453d" strokeWidth="2" />
      {/* 腿 */}
      <rect x="-12" y="16" width="8" height="20" rx="3" fill="#c0c8d0" stroke="#4a453d" strokeWidth="2" />
      <rect x="4" y="16" width="8" height="20" rx="3" fill="#c0c8d0" stroke="#4a453d" strokeWidth="2" />
      <rect x="-16" y="36" width="16" height="6" rx="2" fill="#4a453d" />
      <rect x="0" y="36" width="16" height="6" rx="2" fill="#4a453d" />
    </g>
    {/* 小孩 */}
    <Person x={120} y={265} scale={0.7} pose="wave" top="#ffd45e" face="happy" />
    <SpeechBubble x={250} y={140} scale={0.6} />
    <Sparkle x={300} y={100} r={6} color="#fff3c4" />
  </>
))

/** 时间快进：时钟漩涡 + 未来城市 */
const TimeTravel = def('time-travel', '时间快进', () => (
  <>
    <Sky tone="dusk" />
    {/* 时钟漩涡 */}
    <g transform="translate(200 150)">
      <circle cx="0" cy="0" r="60" fill="none" stroke="#ffd45e" strokeWidth="2" opacity="0.4" />
      <circle cx="0" cy="0" r="48" fill="none" stroke="#ffd45e" strokeWidth="2" opacity="0.5" />
      <circle cx="0" cy="0" r="36" fill="none" stroke="#ffd45e" strokeWidth="2" opacity="0.6" />
      <circle cx="0" cy="0" r="24" fill="#fff3c4" opacity="0.3" />
      {/* 漩涡线 */}
      <g fill="none" stroke="#ffd45e" strokeWidth="2" opacity="0.7">
        <path d="M-50,0 q20,-30 50,0 q-20,30 -50,0" />
        <path d="M-40,-10 q15,-25 40,-5 q15,20 -5,30" opacity="0.5" />
      </g>
      {/* 时钟指针旋转 */}
      <g transform="rotate(25)">
        <line x1="0" y1="0" x2="0" y2="-20" stroke="#4a453d" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="0" y1="0" x2="16" y2="4" stroke="#e04040" strokeWidth="2" strokeLinecap="round" />
        <circle cx="0" cy="0" r="3" fill="#4a453d" />
      </g>
    </g>
    {/* 未来城市剪影 */}
    <g transform="translate(200 240)" fill="#4a3a2a" opacity="0.8">
      <rect x="-100" y="-40" width="20" height="40" rx="2" />
      <rect x="-76" y="-60" width="16" height="60" rx="2" />
      <rect x="-56" y="-30" width="24" height="30" rx="2" />
      <rect x="-28" y="-50" width="18" height="50" rx="2" />
      <rect x="-6" y="-70" width="14" height="70" rx="2" />
      <rect x="12" y="-45" width="20" height="45" rx="2" />
      <rect x="36" y="-55" width="16" height="55" rx="2" />
      <rect x="56" y="-35" width="24" height="35" rx="2" />
      <rect x="84" y="-50" width="16" height="50" rx="2" />
      {/* 窗户灯 */}
      <g fill="#ffd45e" opacity="0.6">
        {seeds(3201, 16).map((s, i) => (
          <rect key={i} x={rnd(s, -95, 95)} y={rnd(s + 1, -65, -5)} width="3" height="3" />
        ))}
      </g>
    </g>
    {/* 地面 */}
    <path d="M0,240 L400,240 L400,300 L0,300 Z" fill="#2a2a3a" />
    {/* 小孩看着 */}
    <Person x={200} y={268} scale={0.5} pose="reach" top="#4a90db" face="surprised" />
    <Sparkle x={200} y={150} r={8} color="#fff3c4" />
  </>
))

/* ============================================================
   六·补充：课本习作全覆盖（书店 / 看图作文 / 传统节日 / 小实验 等）
   ============================================================ */

/* 书店 —— 四上「推荐一个好地方」/ 五上「推荐一本书」 */
const BookStore = def('book-store', '书店', () => (
  <>
    <RoomWall wall="#f5ecd9" floor="#d9c9a8" floorY={230} />
    {/* 书架 */}
    <rect x="20" y="40" width="160" height="170" rx="4" fill="#8d5a33" />
    <rect x="26" y="48" width="148" height="154" rx="2" fill="#6b4226" />
    {seeds(4001, 5).map((_s, i) => (
      <rect key={i} x="30" y={52 + i * 32} width="140" height="28" fill="#5a3820" />
    ))}
    {seeds(4011, 30).map((_s, i) => {
      const shelf = Math.floor(i / 6)
      const col = i % 6
      const colors = ['#6fb3ff', '#ff8fb1', '#4fae5a', '#ffd45e', '#ff9b6b', '#9b7ed8']
      return (
        <rect
          key={i}
          x={34 + col * 22}
          y={56 + shelf * 32}
          width="18"
          height={24}
          rx="1"
          fill={colors[i % 6]}
          stroke={colors[(i + 3) % 6]}
          strokeWidth="0.5"
        />
      )
    })}
    {/* 柜台 */}
    <rect x="210" y="170" width="170" height="60" rx="4" fill="#8d5a33" />
    <rect x="210" y="170" width="170" height="10" fill="#a06b40" />
    {/* 书堆 */}
    <rect x="240" y="150" width="40" height="20" rx="2" fill="#6fb3ff" />
    <rect x="245" y="138" width="35" height="14" rx="2" fill="#ff8fb1" />
    {/* 小孩在看书 */}
    <Person x={300} y={210} scale={0.55} pose="sit" top="#4a90db" />
    <Book x={295} y={185} scale={0.8} cover="#ff8fb1" />
    {/* 门口牌子 */}
    <rect x="240" y="20" width="80" height="24" rx="4" fill="#fffdf7" stroke="#8d5a33" strokeWidth="2" />
    <text x="280" y="37" textAnchor="middle" fontSize="14" fill="#8d5a33" fontWeight="bold">书店</text>
    {/* 地灯 */}
    <circle cx="60" cy="220" r="6" fill="#ffd45e" opacity={0.6} />
    <circle cx="60" cy="220" r="14" fill="#ffd45e" opacity={0.15} />
  </>
))

/* 看图作文·单图 —— 三下「看图画，写一写」 */
const LookPictureSingle = def('look-picture-single', '看图作文（单图）', () => (
  <>
    <RoomWall wall="#f5ecd9" floor="#e6d2b2" floorY={240} />
    {/* 一张大图挂在墙上 */}
    <rect x="60" y="30" width="280" height="170" rx="6" fill="#fffdf7" stroke="#c08c4f" strokeWidth="6" />
    {/* 画的内容：春天公园 */}
    <rect x="70" y="40" width="260" height="150" fill="#d6efff" />
    <circle cx="300" cy="60" r="18" fill="#ffd45e" />
    <path d="M70,140 Q120,100 170,130 T270,120 L330,140 L330,190 L70,190 Z" fill="#7ec850" />
    <Tree x={100} y={155} scale={0.6} />
    <Tree x={280} y={155} scale={0.6} />
    <Flower x={140} y={175} scale={0.6} petal="#ff8fb1" />
    <Flower x={200} y={178} scale={0.5} petal="#ffd45e" core="#ff9b6b" />
    <Flower x={250} y={172} scale={0.6} petal="#9b7ed8" />
    <Person x={200} y={170} scale={0.35} pose="wave" top="#ff8fb1" />
    {/* 桌上趴着看画的小孩 */}
    <rect x="120" y="220" width="160" height="20" rx="3" fill="#c08c4f" />
    <Person x={200} y={215} scale={0.45} pose="sit" top="#4a90db" />
    <Pencil x={170} y={225} scale={0.5} rotate={-20} />
    {/* 提示文字 */}
    <text x="200" y="270" textAnchor="middle" fontSize="12" fill="#8d5a33">仔细看图，把看到的、想到的写下来</text>
  </>
))

/* 看图作文·连续图 —— 多幅图叙事 */
const LookPictureSeries = def('look-picture-series', '看图作文（连环图）', () => (
  <>
    <RoomWall wall="#f5ecd9" floor="#e6d2b2" floorY={240} />
    {/* 三幅小图并排 */}
    {[0, 1, 2].map((idx) => {
      const x0 = 20 + idx * 130
      return (
        <g key={idx}>
          <rect x={x0} y="20" width="110" height="80" rx="4" fill="#fffdf7" stroke="#c08c4f" strokeWidth="3" />
          <rect x={x0 + 4} y="24" width="102" height="72" fill="#d6efff" />
          {/* 每幅画一个场景 */}
          {idx === 0 && (
            <>
              <circle cx={x0 + 80} cy={35} r={10} fill="#ffd45e" />
              <path d={`M${x0 + 4},70 L${x0 + 106},70 L${x0 + 106},96 L${x0 + 4},96 Z`} fill="#7ec850" />
              <Person x={x0 + 50} y={68} scale={0.25} pose="stand" top="#4a90db" />
            </>
          )}
          {idx === 1 && (
            <>
              <path d={`M${x0 + 4},60 L${x0 + 106},60 L${x0 + 106},96 L${x0 + 4},96 Z`} fill="#7ec850" />
              <Person x={x0 + 30} y={58} scale={0.25} pose="run" top="#4a90db" />
              <Person x={x0 + 70} y={58} scale={0.25} pose="wave" top="#ff8fb1" />
              <SpeechBubble x={x0 + 60} y={30} scale={0.4} />
            </>
          )}
          {idx === 2 && (
            <>
              <circle cx={x0 + 20} cy={35} r={10} fill="#ffd45e" />
              <path d={`M${x0 + 4},70 L${x0 + 106},70 L${x0 + 106},96 L${x0 + 4},96 Z`} fill="#7ec850" />
              <Person x={x0 + 50} y={68} scale={0.25} pose="wave" top="#4a90db" />
              <Flower x={x0 + 80} y={82} scale={0.4} />
            </>
          )}
          <text x={x0 + 55} y="112" textAnchor="middle" fontSize="10" fill="#8d5a33">第 {idx + 1} 幅</text>
          {/* 箭头 */}
          {idx < 2 && (
            <text x={x0 + 118} y="65" textAnchor="middle" fontSize="16" fill="#c08c4f">→</text>
          )}
        </g>
      )
    })}
    {/* 桌和小孩 */}
    <rect x="80" y="200" width="240" height="20" rx="3" fill="#c08c4f" />
    <Person x={200} y={195} scale={0.5} pose="sit" top="#4a90db" />
    <Pencil x={160} y={205} scale={0.5} rotate={-15} />
    <text x="200" y="265" textAnchor="middle" fontSize="11" fill="#8d5a33">看懂每幅图，连起来就是一个故事</text>
  </>
))

/* 传统节日 —— 三下「传统节日」 */
const Festival = def('festival', '传统节日', () => (
  <>
    <Sky tone="dusk" />
    {/* 灯笼 */}
    {seeds(4101, 4).map((_s, i) => {
      const x = 60 + i * 90
      return (
        <g key={i}>
          <line x1={x} y1="0" x2={x} y2="20" stroke="#8d5a33" strokeWidth="1.5" />
          <ellipse cx={x} cy="36" rx="16" ry="20" fill="#f26a6a" stroke="#c04040" strokeWidth="1.5" />
          <line x1={x} y1="56" x2={x} y2="66" stroke="#ffd45e" strokeWidth="2" />
          <text x={x} y="42" textAnchor="middle" fontSize="12" fill="#ffd45e" fontWeight="bold">福</text>
        </g>
      )
    })}
    {/* 烟花 */}
    {seeds(4111, 3).map((s, i) => {
      const x = rnd(s, 80, 320)
      const y = rnd(s + 1, 60, 120)
      return (
        <g key={i}>
          {seeds(s, 8).map((_s2, j) => {
            const ang = (j / 8) * Math.PI * 2
            return <line key={j} x1={x} y1={y} x2={x + Math.cos(ang) * 14} y2={y + Math.sin(ang) * 14} stroke="#ffd45e" strokeWidth="2" opacity={0.8} />
          })}
        </g>
      )
    })}
    {/* 屋檐 */}
    <House x={60} y={180} scale={0.7} />
    <House x={250} y={180} scale={0.7} wall="#f5ecd9" roof="#c04040" />
    {/* 桌上有月饼/饺子 */}
    <rect x="120" y="220" width="160" height="40" rx="4" fill="#8d5a33" />
    <Dumpling x={150} y={215} scale={0.6} />
    <Dumpling x={170} y={215} scale={0.6} rotate={15} />
    <Dumpling x={190} y={215} scale={0.6} rotate={-10} />
    {/* 月饼（圆饼） */}
    <circle cx="240" cy="212" r="12" fill="#d4941f" stroke="#a06b20" strokeWidth="1.5" />
    <circle cx="240" cy="212" r="7" fill="#e0a040" />
    {/* 小孩在看 */}
    <Person x={200} y={258} scale={0.5} pose="wave" top="#f26a6a" />
  </>
))

/* 小实验 —— 三下「我做了一项小实验」 */
const Experiment = def('experiment', '小实验', () => (
  <>
    <RoomWall wall="#fdf2e0" floor="#e6d2b2" floorY={230} />
    {/* 桌面 */}
    <rect x="40" y="180" width="320" height="50" rx="4" fill="#c08c4f" />
    {/* 烧杯 */}
    <path d="M140,120 L140,180 L190,180 L190,120 L185,115 L145,115 Z" fill="#d6efff" stroke="#7fc9ef" strokeWidth="2" opacity={0.7} />
    <rect x="145" y="150" width="40" height="28" fill="#7fc9ef" opacity={0.5} />
    {/* 气泡 */}
    {seeds(4201, 5).map((s, i) => (
      <circle key={i} cx={rnd(s, 150, 180)} cy={rnd(s + 1, 155, 175)} r={rnd(s + 2, 2, 5)} fill="#ffffff" opacity={0.7} />
    ))}
    {/* 滴管 */}
    <rect x="162" y="80" width="6" height="40" rx="3" fill="#7fc9ef" />
    <circle cx="165" cy="76" r="8" fill="#ff8fb1" />
    {/* 记录本 */}
    <rect x="220" y="175" width="80" height="30" rx="2" fill="#fffdf7" stroke="#c08c4f" strokeWidth="1.5" />
    <line x1="225" y1="183" x2="295" y2="183" stroke="#c9bfae" strokeWidth="0.5" />
    <line x1="225" y1="190" x2="295" y2="190" stroke="#c9bfae" strokeWidth="0.5" />
    <line x1="225" y1="197" x2="280" y2="197" stroke="#c9bfae" strokeWidth="0.5" />
    <Pencil x={295} y={190} scale={0.5} rotate={-30} />
    {/* 小孩在观察 */}
    <Person x={100} y={200} scale={0.55} pose="reach" top="#4a90db" face="surprised" />
    {/* 问号 */}
    <text x="200" y="65" textAnchor="middle" fontSize="28" fill="#4a90db" opacity={0.5}>?</text>
  </>
))

/* 国宝大熊猫 —— 三下「国宝大熊猫」 */
const Panda = def('panda', '国宝大熊猫', () => (
  <>
    <Sky />
    <Ground />
    {/* 竹子 */}
    {[60, 320].map((x, i) => (
      <g key={i}>
        <rect x={x} y="60" width="8" height="160" rx="2" fill="#4fae5a" />
        <ellipse cx={x + 4} cy={80 + i * 20} rx="14" ry="5" fill="#4fae5a" transform={`rotate(${i * 20 - 10} ${x + 4} ${80 + i * 20})`} />
        <ellipse cx={x + 4} cy={120 + i * 15} rx="14" ry="5" fill="#3a8c48" transform={`rotate(${-i * 20 + 10} ${x + 4} ${120 + i * 15})`} />
      </g>
    ))}
    {/* 竹叶散落 */}
    {seeds(4301, 6).map((s, i) => (
      <ellipse key={i} cx={rnd(s, 100, 300)} cy={rnd(s + 1, 200, 230)} rx="4" ry="2" fill="#4fae5a" transform={`rotate(${rnd(s + 2, 0, 180)} ${rnd(s, 100, 300)} ${rnd(s + 1, 200, 230)})`} />
    ))}
    {/* 熊猫身体 */}
    <g transform="translate(200 180)">
      {/* 身体 */}
      <ellipse cx="0" cy="20" rx="42" ry="32" fill="#ffffff" stroke="#3a3a3a" strokeWidth="1.5" />
      {/* 头 */}
      <circle cx="0" cy="-12" r="30" fill="#ffffff" stroke="#3a3a3a" strokeWidth="1.5" />
      {/* 黑眼圈 */}
      <ellipse cx="-12" cy="-14" rx="9" ry="12" fill="#2a2a2a" transform="rotate(-20 -12 -14)" />
      <ellipse cx="12" cy="-14" rx="9" ry="12" fill="#2a2a2a" transform="rotate(20 12 -14)" />
      {/* 眼睛 */}
      <circle cx="-11" cy="-12" r="3" fill="#ffffff" />
      <circle cx="-10" cy="-11" r="2" fill="#2a2a2a" />
      <circle cx="11" cy="-12" r="3" fill="#ffffff" />
      <circle cx="12" cy="-11" r="2" fill="#2a2a2a" />
      {/* 鼻子 */}
      <ellipse cx="0" cy="-2" rx="4" ry="3" fill="#2a2a2a" />
      {/* 嘴 */}
      <path d="M-5,2 Q0,7 5,2" stroke="#2a2a2a" strokeWidth="1.5" fill="none" />
      {/* 耳朵 */}
      <circle cx="-22" cy="-32" r="10" fill="#2a2a2a" />
      <circle cx="22" cy="-32" r="10" fill="#2a2a2a" />
      {/* 黑色四肢 */}
      <ellipse cx="-35" cy="30" rx="12" ry="18" fill="#2a2a2a" />
      <ellipse cx="35" cy="30" rx="12" ry="18" fill="#2a2a2a" />
      <ellipse cx="-18" cy="48" rx="14" ry="8" fill="#2a2a2a" />
      <ellipse cx="18" cy="48" rx="14" ry="8" fill="#2a2a2a" />
      {/* 手里拿竹子 */}
      <rect x="-30" y="10" width="6" height="30" rx="2" fill="#4fae5a" transform="rotate(30 -30 10)" />
    </g>
    {/* 牌子 */}
    <rect x="250" y="250" width="100" height="30" rx="4" fill="#fffdf7" stroke="#8d5a33" strokeWidth="2" />
    <text x="300" y="270" textAnchor="middle" fontSize="11" fill="#8d5a33">国宝大熊猫</text>
  </>
))

/* 观察日记 —— 四上「写观察日记」 */
const ObserveDiary = def('observe-diary', '观察日记', () => (
  <>
    <RoomWall wall="#fdf2e0" floor="#e6d2b2" floorY={230} />
    {/* 书桌 */}
    <rect x="60" y="170" width="280" height="50" rx="4" fill="#c08c4f" />
    {/* 日记本 */}
    <rect x="100" y="150" width="120" height="30" rx="3" fill="#fffdf7" stroke="#c08c4f" strokeWidth="1.5" />
    <line x1="105" y1="158" x2="215" y2="158" stroke="#c9bfae" strokeWidth="0.5" />
    <line x1="105" y1="165" x2="215" y2="165" stroke="#c9bfae" strokeWidth="0.5" />
    <line x1="105" y1="172" x2="200" y2="172" stroke="#c9bfae" strokeWidth="0.5" />
    <Pencil x={210} y={160} scale={0.5} rotate={-20} />
    {/* 蒜头瓶（观察对象） */}
    <Vase x={280} y={165} scale={1.2} />
    {/* 蒜苗 */}
    <g transform="translate(280 150)">
      {seeds(4401, 3).map((_s, i) => (
        <path key={i} d={`M${-6 + i * 6},0 Q${-4 + i * 6},-15 ${-2 + i * 6},-25`} stroke="#4fae5a" strokeWidth="2.5" fill="none" />
      ))}
    </g>
    {/* 放大镜 */}
    <g transform="translate(250 120)">
      <circle cx="0" cy="0" r="14" fill="none" stroke="#8d5a33" strokeWidth="3" />
      <circle cx="0" cy="0" r="12" fill="#d6efff" opacity={0.3} />
      <line x1="10" y1="10" x2="20" y2="20" stroke="#8d5a33" strokeWidth="3" />
    </g>
    {/* 小孩在写 */}
    <Person x={150} y={170} scale={0.5} pose="sit" top="#4a90db" />
    {/* 日历提示 */}
    <rect x="40" y="30" width="60" height="50" rx="4" fill="#fffdf7" stroke="#f26a6a" strokeWidth="2" />
    <text x="70" y="50" textAnchor="middle" fontSize="10" fill="#f26a6a">观察</text>
    <text x="70" y="68" textAnchor="middle" fontSize="14" fill="#8d5a33" fontWeight="bold">第7天</text>
  </>
))

/* 写信 —— 四上「写信」 */
const WriteLetter = def('write-letter', '写信', () => (
  <>
    <RoomWall wall="#fdf2e0" floor="#e6d2b2" floorY={230} />
    {/* 桌 */}
    <rect x="60" y="180" width="280" height="50" rx="4" fill="#c08c4f" />
    {/* 信封 */}
    <rect x="120" y="140" width="120" height="70" rx="3" fill="#fffdf7" stroke="#c08c4f" strokeWidth="2" />
    <line x1="120" y1="140" x2="180" y2="175" stroke="#c08c4f" strokeWidth="1.5" />
    <line x1="240" y1="140" x2="180" y2="175" stroke="#c08c4f" strokeWidth="1.5" />
    <line x1="120" y1="210" x2="180" y2="175" stroke="#c08c4f" strokeWidth="1.5" />
    <line x1="240" y1="210" x2="180" y2="175" stroke="#c08c4f" strokeWidth="1.5" />
    {/* 邮票 */}
    <rect x="225" y="148" width="28" height="20" rx="2" fill="#ff8fb1" stroke="#e06767" strokeWidth="0.5" strokeDasharray="2 1" />
    {/* 信纸 */}
    <rect x="260" y="155" width="60" height="50" rx="2" fill="#fffdf7" stroke="#c9bfae" strokeWidth="1" />
    <line x1="265" y1="163" x2="315" y2="163" stroke="#c9bfae" strokeWidth="0.5" />
    <line x1="265" y1="170" x2="315" y2="170" stroke="#c9bfae" strokeWidth="0.5" />
    <line x1="265" y1="177" x2="310" y2="177" stroke="#c9bfae" strokeWidth="0.5" />
    {/* 笔 */}
    <Pencil x={140} y={155} scale={0.6} rotate={30} />
    {/* 小孩在写 */}
    <Person x={100} y={180} scale={0.5} pose="sit" top="#4a90db" />
    {/* 心形（寄给爱的人） */}
    <text x="200" y="80" textAnchor="middle" fontSize="20" fill="#f26a6a" opacity={0.6}>♥</text>
  </>
))

/* 记一次游戏 —— 四上「记一次游戏」 */
const PlayGame = def('play-game', '游戏', () => (
  <>
    <Sky />
    <Ground />
    {/* 拔河 */}
    <line x1="40" y1="180" x2="360" y2="180" stroke="#8d5a33" strokeWidth="3" />
    {/* 中间标记 */}
    <rect x="195" y="172" width="10" height="16" fill="#f26a6a" />
    {/* 左队 */}
    <Person x={80} y={175} scale={0.5} pose="run" top="#4a90db" />
    <Person x={120} y={175} scale={0.5} pose="run" top="#4a90db" />
    <Person x={160} y={175} scale={0.5} pose="run" top="#4a90db" />
    {/* 右队 */}
    <Person x={240} y={175} scale={0.5} pose="run" top="#ff8fb1" flip />
    <Person x={280} y={175} scale={0.5} pose="run" top="#ff8fb1" flip />
    <Person x={320} y={175} scale={0.5} pose="run" top="#ff8fb1" flip />
    {/* 欢呼的同学 */}
    <Person x={200} y={240} scale={0.4} pose="jump" top="#ffd45e" />
    <SpeechBubble x={160} y={220} scale={0.5} />
    <SpeechBubble x={240} y={220} scale={0.5} />
  </>
))

/* 我的乐园 —— 四下「我的乐园」 */
const MyParadise = def('my-paradise', '我的乐园', () => (
  <>
    <Sky />
    <Ground color="#7ec850" />
    {/* 树屋 */}
    <Tree x={200} y={180} scale={1.3} />
    <rect x="170" y="120" width="60" height="40" rx="4" fill="#8d5a33" />
    <rect x="180" y="125" width="20" height="20" rx="2" fill="#d6efff" />
    {/* 梯子 */}
    <line x1="200" y1="160" x2="200" y2="195" stroke="#8d5a33" strokeWidth="2.5" />
    <line x1="192" y1="165" x2="208" y2="165" stroke="#8d5a33" strokeWidth="2" />
    <line x1="192" y1="175" x2="208" y2="175" stroke="#8d5a33" strokeWidth="2" />
    <line x1="192" y1="185" x2="208" y2="185" stroke="#8d5a33" strokeWidth="2" />
    {/* 秋千 */}
    <line x1="80" y1="100" x2="80" y2="200" stroke="#8d5a33" strokeWidth="3" />
    <line x1="120" y1="100" x2="120" y2="200" stroke="#8d5a33" strokeWidth="3" />
    <line x1="80" y1="100" x2="120" y2="100" stroke="#8d5a33" strokeWidth="3" />
    <line x1="88" y1="100" x2="88" y2="170" stroke="#4a453d" strokeWidth="1.5" />
    <line x1="112" y1="100" x2="112" y2="170" stroke="#4a453d" strokeWidth="1.5" />
    <rect x="82" y="168" width="36" height="6" rx="2" fill="#c08c4f" />
    {/* 花丛 */}
    {seeds(4501, 5).map((s, i) => (
      <Flower key={i} x={rnd(s, 40, 360)} y={rnd(s + 1, 230, 260)} scale={0.6} petal={['#ff8fb1', '#ffd45e', '#9b7ed8', '#ff9b6b', '#6fb3ff'][i]} />
    ))}
    {/* 小孩 */}
    <Person x={300} y={235} scale={0.5} pose="wave" top="#4a90db" />
  </>
))

/* 奇思妙想 —— 四下「我的奇思妙想」 */
const Invention = def('invention', '奇思妙想', () => (
  <>
    <RoomWall wall="#fdf2e0" floor="#e6d2b2" floorY={230} />
    {/* 设计图 */}
    <rect x="40" y="30" width="200" height="140" rx="4" fill="#fffdf7" stroke="#c08c4f" strokeWidth="2" />
    <line x1="50" y1="50" x2="230" y2="50" stroke="#c9bfae" strokeWidth="0.5" strokeDasharray="3 2" />
    {/* 会飞的鞋 */}
    <g transform="translate(140 100)">
      <ellipse cx="0" cy="10" rx="30" ry="8" fill="#4a90db" stroke="#2a6ab0" strokeWidth="1.5" />
      <path d="M-30,10 Q-35,5 -30,0 L20,0 Q28,5 30,10" fill="#4a90db" stroke="#2a6ab0" strokeWidth="1.5" />
      {/* 翅膀 */}
      <path d="M-5,0 Q-15,-20 -25,-10 Q-15,-5 -5,0" fill="#ff8fb1" stroke="#e06767" strokeWidth="1" />
      <path d="M10,0 Q20,-20 30,-10 Q20,-5 10,0" fill="#ff8fb1" stroke="#e06767" strokeWidth="1" />
    </g>
    {/* 齿轮 */}
    <g transform="translate(80 60)">
      <circle cx="0" cy="0" r="14" fill="none" stroke="#8d5a33" strokeWidth="2" />
      {seeds(4601, 8).map((_s, i) => {
        const ang = (i / 8) * Math.PI * 2
        return <rect key={i} x={-3} y={-18} width="6" height="8" fill="#8d5a33" transform={`rotate(${(ang * 180 / Math.PI)} 0 0)`} />
      })}
    </g>
    {/* 小孩在画 */}
    <Person x={300} y={180} scale={0.55} pose="sit" top="#4a90db" />
    <Pencil x={270} y={170} scale={0.5} rotate={30} />
    {/* 灵感灯泡 */}
    <g transform="translate(310 60)">
      <circle cx="0" cy="0" r="16" fill="#ffd45e" opacity={0.3} />
      <path d="M-8,-2 Q-8,-14 0,-14 Q8,-14 8,-2 Z" fill="#ffd45e" stroke="#d4941f" strokeWidth="1.5" />
      <rect x="-5" y="-2" width="10" height="6" rx="1" fill="#8d5a33" />
      <Sparkle x={0} y={-20} r={4} color="#ffd45e" opacity={0.8} />
    </g>
  </>
))

/* 游记参观 —— 四下「游__」 */
const TravelVisit = def('travel-visit', '游记参观', () => (
  <>
    <Sky tone="dusk" />
    {/* 古建筑（亭子） */}
    <g transform="translate(200 140)">
      {/* 屋顶 */}
      <path d="M-50,0 Q0,-30 50,0 L40,5 L-40,5 Z" fill="#8d5a33" stroke="#6b4226" strokeWidth="1.5" />
      {/* 柱子 */}
      <rect x="-36" y="5" width="6" height="60" fill="#a06b40" />
      <rect x="30" y="5" width="6" height="60" fill="#a06b40" />
      <rect x="-12" y="5" width="6" height="60" fill="#a06b40" />
      <rect x="6" y="5" width="6" height="60" fill="#a06b40" />
      {/* 台基 */}
      <rect x="-50" y="65" width="100" height="12" fill="#c9bfae" stroke="#8d5a33" strokeWidth="1" />
    </g>
    {/* 石阶 */}
    <path d="M150,210 L250,210 L245,220 L155,220 Z" fill="#c9bfae" stroke="#8d5a33" strokeWidth="1" />
    {/* 树 */}
    <Tree x={70} y={200} scale={0.8} />
    <Tree x={340} y={200} scale={0.8} />
    <Ground />
    {/* 小孩在拍照 */}
    <Person x={120} y={255} scale={0.5} pose="point" top="#4a90db" />
    {/* 相机 */}
    <rect x={130} y={240} width="16" height="12" rx="2" fill="#3a3a3a" />
    <circle cx={138} cy={246} r="4" fill="#1a1a1a" />
  </>
))

/* 漫画老师 —— 五上「漫画老师」 */
const ComicTeacher = def('comic-teacher', '漫画老师', () => (
  <>
    <RoomWall wall="#fdf2e0" floor="#e6d2b2" floorY={230} />
    {/* 黑板 */}
    <rect x="40" y="30" width="200" height="100" rx="4" fill="#2a4a3a" stroke="#8d5a33" strokeWidth="4" />
    <text x="140" y="70" textAnchor="middle" fontSize="14" fill="#fffdf7">认真听讲！</text>
    <line x1="60" y1="80" x2="220" y2="80" stroke="#fffdf7" strokeWidth="0.5" opacity={0.5} />
    <line x1="60" y1="95" x2="200" y2="95" stroke="#fffdf7" strokeWidth="0.5" opacity={0.5} />
    {/* 老师在讲台 */}
    <rect x="260" y="160" width="100" height="60" rx="4" fill="#8d5a33" />
    <Person x={300} y={155} scale={0.6} pose="wave" top="#2a6ab0" />
    {/* 眼镜 */}
    <circle cx={293} cy={150} r="5" fill="none" stroke="#3a3a3a" strokeWidth="1.5" />
    <circle cx={307} cy={150} r="5" fill="none" stroke="#3a3a3a" strokeWidth="1.5" />
    <line x1="298" y1="150" x2="302" y2="150" stroke="#3a3a3a" strokeWidth="1" />
    {/* 教鞭 */}
    <line x1="310" y1="160" x2="335" y2="130" stroke="#8d5a33" strokeWidth="2" />
    {/* 学生 */}
    <Person x={100} y={200} scale={0.45} pose="sit" top="#4a90db" />
    <Person x={150} y={200} scale={0.45} pose="sit" top="#ff8fb1" />
  </>
))

/* 介绍一种事物 —— 五上「介绍一种事物」（说明文） */
const IntroduceThing = def('introduce-thing', '介绍一种事物', () => (
  <>
    <RoomWall wall="#fdf2e0" floor="#e6d2b2" floorY={230} />
    {/* 展示台 */}
    <rect x="100" y="180" width="200" height="40" rx="4" fill="#8d5a33" />
    {/* 笔记本电脑（被介绍的事物） */}
    <rect x="150" y="120" width="100" height="65" rx="4" fill="#3a3a3a" />
    <rect x="156" y="126" width="88" height="53" fill="#d6efff" />
    <text x="200" y="150" textAnchor="middle" fontSize="10" fill="#4a90db">说明文</text>
    <text x="200" y="165" textAnchor="middle" fontSize="8" fill="#8d5a33">特征 · 用途 · 外形</text>
    {/* 键盘 */}
    <rect x="150" y="185" width="100" height="10" rx="2" fill="#5a5a5a" />
    {/* 标注线 */}
    <line x1="150" y1="130" x2="100" y2="110" stroke="#f26a6a" strokeWidth="1.5" strokeDasharray="3 2" />
    <circle cx="100" cy="110" r="3" fill="#f26a6a" />
    <text x="80" y="105" fontSize="9" fill="#f26a6a">外形</text>
    <line x1="250" y1="145" x2="310" y2="130" stroke="#4fae5a" strokeWidth="1.5" strokeDasharray="3 2" />
    <text x="310" y="125" fontSize="9" fill="#4fae5a">功能</text>
    <line x1="200" y1="185" x2="200" y2="215" stroke="#9b7ed8" strokeWidth="1.5" strokeDasharray="3 2" />
    <text x="210" y="222" fontSize="9" fill="#9b7ed8">用途</text>
    {/* 小孩在讲 */}
    <Person x={60} y={210} scale={0.5} pose="wave" top="#4a90db" />
    <SpeechBubble x={50} y={170} scale={0.5} />
  </>
))

/* 读后感 —— 五下「写读后感」 */
const ReadingNotes = def('reading-notes', '读后感', () => (
  <>
    <RoomWall wall="#fdf2e0" floor="#e6d2b2" floorY={230} />
    {/* 书架 */}
    <rect x="20" y="40" width="130" height="160" rx="4" fill="#8d5a33" />
    {seeds(4701, 5).map((_s, i) => (
      <rect key={i} x="26" y={48 + i * 30} width="118" height="26" fill="#5a3820" />
    ))}
    {seeds(4711, 18).map((_s, i) => {
      const shelf = Math.floor(i / 6)
      const col = i % 6
      const colors = ['#6fb3ff', '#ff8fb1', '#4fae5a', '#ffd45e', '#ff9b6b', '#9b7ed8']
      return <rect key={i} x={30 + col * 18} y={52 + shelf * 30} width="14" height="22" rx="1" fill={colors[i % 6]} />
    })}
    {/* 一本翻开的书 */}
    <Book x={200} y={170} scale={1.4} cover="#ff8fb1" />
    {/* 笔记本 */}
    <rect x="240" y="160" width="100" height="50" rx="2" fill="#fffdf7" stroke="#c08c4f" strokeWidth="1.5" />
    <text x="290" y="178" textAnchor="middle" fontSize="10" fill="#8d5a33">读后感</text>
    <line x1="248" y1="185" x2="332" y2="185" stroke="#c9bfae" strokeWidth="0.5" />
    <line x1="248" y1="192" x2="332" y2="192" stroke="#c9bfae" strokeWidth="0.5" />
    <line x1="248" y1="199" x2="320" y2="199" stroke="#c9bfae" strokeWidth="0.5" />
    <Pencil x={325} y={185} scale={0.5} rotate={-20} />
    {/* 小孩 */}
    <Person x={210} y={190} scale={0.45} pose="sit" top="#4a90db" />
    {/* 感悟气泡 */}
    <ThoughtBubble x={240} y={100} scale={1} />
    <text x="285" y="118" textAnchor="middle" fontSize="9" fill="#8d5a33">这本书真好看……</text>
  </>
))

/* 形形色色的人 —— 五下「形形色色的人」 */
const AllKindsPeople = def('all-kinds-people', '形形色色的人', () => (
  <>
    <Sky />
    <Ground />
    {/* 各种人物 */}
    <Person x={60} y={200} scale={0.5} pose="wave" top="#4a90db" />
    <Person x={110} y={200} scale={0.5} pose="run" top="#ff8fb1" />
    <Person x={160} y={200} scale={0.5} pose="sit" top="#4fae5a" />
    <Person x={210} y={200} scale={0.5} pose="stand" top="#ffd45e" />
    <Person x={260} y={200} scale={0.5} pose="point" top="#9b7ed8" />
    <Person x={310} y={200} scale={0.5} pose="wave" top="#ff9b6b" />
    <Person x={360} y={200} scale={0.5} pose="reach" top="#6fb3ff" />
    {/* 标签 */}
    <SpeechBubble x={40} y={150} scale={0.4} />
    <text x="60" y="160" textAnchor="middle" fontSize="8" fill="#8d5a33">同学</text>
    <SpeechBubble x={240} y={150} scale={0.4} />
    <text x="260" y="160" textAnchor="middle" fontSize="8" fill="#8d5a33">路人</text>
    <SpeechBubble x={340} y={150} scale={0.4} />
    <text x="360" y="160" textAnchor="middle" fontSize="8" fill="#8d5a33">邻居</text>
  </>
))

/* 探险之旅 —— 五下「神奇的探险之旅」 */
const AdventureTrip = def('adventure-trip', '探险之旅', () => (
  <>
    <Sky tone="dusk" />
    {/* 山洞入口 */}
    <path d="M100,180 Q120,80 200,80 Q280,80 300,180 L300,300 L100,300 Z" fill="#4a3a2a" />
    <path d="M120,180 Q140,100 200,100 Q260,100 280,180 L280,300 L120,300 Z" fill="#2a2a1a" />
    {/* 火把 */}
    <g transform="translate(150 140)">
      <rect x="-2" y="0" width="4" height="40" fill="#8d5a33" />
      <ellipse cx="0" cy="-5" rx="6" ry="12" fill="#ff9b6b" />
      <ellipse cx="0" cy="-8" rx="4" ry="8" fill="#ffd45e" />
      <Sparkle x={0} y={-15} r={4} color="#ff9b6b" opacity={0.6} />
    </g>
    {/* 背包小孩拿手电 */}
    <Person x={200} y={250} scale={0.55} pose="reach" top="#4a90db" face="surprised" />
    <Backpack x={185} y={220} scale={0.5} />
    {/* 光束 */}
    <path d="M210,230 L260,160 L255,155 L205,225 Z" fill="#ffd45e" opacity={0.2} />
    {/* 宝藏箱角 */}
    <rect x="230" y="270" width="30" height="20" rx="2" fill="#8d5a33" />
    <rect x="233" y="273" width="24" height="14" rx="1" fill="#ffd45e" opacity={0.3} />
    <Sparkle x={245} y={265} r={5} color="#ffd45e" opacity={0.8} />
  </>
))

/* 世界文化遗产 —— 五下「中国的世界文化遗产」 */
const CulturalHeritage = def('cultural-heritage', '文化遗产', () => (
  <>
    <Sky tone="dusk" />
    {/* 城墙 */}
    <rect x="20" y="120" width="360" height="100" fill="#c9bfae" stroke="#8d5a33" strokeWidth="2" />
    {/* 城垛 */}
    {seeds(4801, 10).map((_s, i) => (
      <rect key={i} x={30 + i * 34} y="110" width="20" height="14" fill="#c9bfae" stroke="#8d5a33" strokeWidth="1.5" />
    ))}
    {/* 城楼 */}
    <g transform="translate(200 60)">
      <path d="M-40,40 Q0,0 40,40 L34,44 L-34,44 Z" fill="#8d5a33" stroke="#6b4226" strokeWidth="1.5" />
      <rect x="-30" y="44" width="60" height="76" fill="#c9bfae" stroke="#8d5a33" strokeWidth="2" />
      <rect x="-20" y="60" width="16" height="30" rx="1" fill="#3a3a2a" />
      <rect x="4" y="60" width="16" height="30" rx="1" fill="#3a3a2a" />
    </g>
    {/* 地面 */}
    <Ground color="#d9c9a8" />
    {/* 小孩参观 */}
    <Person x={120} y={255} scale={0.45} pose="point" top="#4a90db" />
    <Person x={280} y={255} scale={0.45} pose="wave" top="#ff8fb1" />
    {/* 标牌 */}
    <rect x="250" y="265" width="100" height="24" rx="3" fill="#fffdf7" stroke="#8d5a33" strokeWidth="1.5" />
    <text x="300" y="280" textAnchor="middle" fontSize="9" fill="#8d5a33">世界文化遗产</text>
  </>
))

/* 漫画的启示 —— 五下「漫画的启示」 */
const ComicInspiration = def('comic-inspiration', '漫画的启示', () => (
  <>
    <RoomWall wall="#fdf2e0" floor="#e6d2b2" floorY={230} />
    {/* 四格漫画框 */}
    {[
      { x: 40, y: 20 },
      { x: 210, y: 20 },
      { x: 40, y: 110 },
      { x: 210, y: 110 },
    ].map((pos, i) => (
      <g key={i}>
        <rect x={pos.x} y={pos.y} width="150" height="80" rx="3" fill="#fffdf7" stroke="#3a3a3a" strokeWidth="2.5" />
        {/* 每格画一个小场景 */}
        {i === 0 && <Person x={115} y={70} scale={0.25} pose="stand" top="#4a90db" />}
        {i === 1 && <Person x={285} y={70} scale={0.25} pose="reach" top="#ff8fb1" />}
        {i === 2 && <><Person x={115} y={160} scale={0.25} pose="sit" top="#4fae5a" /><SpeechBubble x={90} y={130} scale={0.3} /></>}
        {i === 3 && <><Person x={285} y={160} scale={0.25} pose="wave" top="#ffd45e" /><ThoughtBubble x={280} y={130} scale={0.4} /></>}
      </g>
    ))}
    {/* 小孩在看漫画 */}
    <Person x={200} y={210} scale={0.45} pose="sit" top="#4a90db" />
    <Pencil x={170} y={210} scale={0.4} rotate={-30} />
  </>
))

/* 变形记 —— 六上「变形记」 */
const Deformation = def('deformation', '变形记', () => (
  <>
    <Sky tone="dusk" />
    {/* 巨大的蚂蚁（变形后的小孩） */}
    <g transform="translate(200 200)">
      {/* 身体 */}
      <ellipse cx="0" cy="20" rx="18" ry="24" fill="#3a2a1a" />
      {/* 头 */}
      <circle cx="0" cy="-12" r="16" fill="#3a2a1a" />
      {/* 眼睛 */}
      <circle cx="-6" cy="-14" r="4" fill="#ffffff" />
      <circle cx="-5" cy="-13" r="2.5" fill="#2a2a2a" />
      <circle cx="6" cy="-14" r="4" fill="#ffffff" />
      <circle cx="7" cy="-13" r="2.5" fill="#2a2a2a" />
      {/* 触角 */}
      <line x1="-6" y1="-26" x2="-14" y2="-38" stroke="#3a2a1a" strokeWidth="2" />
      <line x1="6" y1="-26" x2="14" y2="-38" stroke="#3a2a1a" strokeWidth="2" />
      <circle cx="-14" cy="-38" r="2" fill="#3a2a1a" />
      <circle cx="14" cy="-38" r="2" fill="#3a2a1a" />
      {/* 六条腿 */}
      <line x1="-16" y1="10" x2="-36" y2="0" stroke="#3a2a1a" strokeWidth="2.5" />
      <line x1="-16" y1="20" x2="-38" y2="20" stroke="#3a2a1a" strokeWidth="2.5" />
      <line x1="-16" y1="30" x2="-36" y2="40" stroke="#3a2a1a" strokeWidth="2.5" />
      <line x1="16" y1="10" x2="36" y2="0" stroke="#3a2a1a" strokeWidth="2.5" />
      <line x1="16" y1="20" x2="38" y2="20" stroke="#3a2a1a" strokeWidth="2.5" />
      <line x1="16" y1="30" x2="36" y2="40" stroke="#3a2a1a" strokeWidth="2.5" />
    </g>
    <Ground />
    {/* 巨大的草 */}
    {seeds(4901, 5).map((s, i) => (
      <path key={i} d={`M${rnd(s, 30, 370)},230 Q${rnd(s + 1, 30, 370)},${rnd(s + 2, 180, 210)} ${rnd(s, 30, 370)},180`} stroke="#4fae5a" strokeWidth="3" fill="none" />
    ))}
    {/* 变形前的影子 */}
    <Person x={80} y={255} scale={0.2} pose="stand" top="#4a90db" />
  </>
))

/* 多彩的活动 —— 六上「多彩的活动」 */
const ColorfulActivity = def('colorful-activity', '多彩的活动', () => (
  <>
    <Sky />
    <Ground />
    {/* 运动场跑道 */}
    <ellipse cx="200" cy="220" rx="160" ry="50" fill="none" stroke="#e0915f" strokeWidth="8" />
    <ellipse cx="200" cy="220" rx="140" ry="38" fill="none" stroke="#e0915f" strokeWidth="2" strokeDasharray="4 4" />
    {/* 跑步的人 */}
    <Person x={120} y={200} scale={0.4} pose="run" top="#4a90db" />
    <Person x={280} y={200} scale={0.4} pose="run" top="#ff8fb1" flip />
    {/* 跳绳 */}
    <Person x={200} y={170} scale={0.4} pose="jump" top="#ffd45e" />
    {/* 观众 */}
    <Person x={60} y={260} scale={0.35} pose="wave" top="#4fae5a" />
    <Person x={340} y={260} scale={0.35} pose="wave" top="#9b7ed8" />
    {/* 横幅 */}
    <rect x="120" y="30" width="160" height="24" rx="4" fill="#f26a6a" />
    <text x="200" y="48" textAnchor="middle" fontSize="13" fill="#ffffff" fontWeight="bold">运动会</text>
  </>
))

/* 笔尖流出的故事 —— 六上「笔尖流出的故事」 */
const PenStory = def('pen-story', '笔尖流出的故事', () => (
  <>
    <RoomWall wall="#fdf2e0" floor="#e6d2b2" floorY={230} />
    {/* 摊开的大笔记本 */}
    <g transform="translate(200 170)">
      <rect x="-120" y="-30" width="240" height="80" rx="4" fill="#fffdf7" stroke="#c08c4f" strokeWidth="2" />
      <line x1="0" y1="-30" x2="0" y2="50" stroke="#c9bfae" strokeWidth="1" />
      {/* 左页文字线 */}
      {[-20, -10, 0, 10, 20, 30].map((y) => (
        <line key={y} x1="-110" y1={y} x2="-10" y2={y} stroke="#c9bfae" strokeWidth="0.4" />
      ))}
      {/* 右页文字线 */}
      {[-20, -10, 0, 10, 20, 30].map((y) => (
        <line key={y} x1="10" y1={y} x2="110" y2={y} stroke="#c9bfae" strokeWidth="0.4" />
      ))}
    </g>
    {/* 巨大的铅笔在写 */}
    <g transform="translate(260 130) rotate(30)">
      <rect x="0" y="0" width="8" height="60" fill="#f2b134" stroke="#d4941f" strokeWidth="1" />
      <path d="M0,60 L4,75 L8,60 Z" fill="#f0cf7a" stroke="#c08c4f" strokeWidth="1" />
      <path d="M2,73 L4,75 L6,73 Z" fill="#3a3a3a" />
    </g>
    {/* 故事角色从笔尖冒出来 */}
    <Person x={264} y={100} scale={0.2} pose="wave" top="#4a90db" />
    <Sparkle x={264} y={90} r={6} color="#ffd45e" opacity={0.7} />
    {/* 小孩在写 */}
    <Person x={120} y={200} scale={0.5} pose="sit" top="#4a90db" />
    <ThoughtBubble x={120} y={120} scale={0.8} />
  </>
))

/* 我的拿手好戏 —— 六上「我的拿手好戏」 */
const MyTalent = def('my-talent', '我的拿手好戏', () => (
  <>
    <RoomWall wall="#fdf2e0" floor="#e6d2b2" floorY={230} />
    {/* 聚光灯 */}
    <Spotlight x={200} top={20} w={50} w2={200} h={200} />
    {/* 钢琴 */}
    <g transform="translate(200 180)">
      <rect x="-80" y="-10" width="160" height="50" rx="3" fill="#2a2a2a" />
      <rect x="-75" y="-8" width="150" height="12" fill="#1a1a1a" />
      {/* 白键 */}
      {seeds(5001, 10).map((_s, i) => (
        <rect key={i} x={-72 + i * 15} y="4" width="13" height="22" fill="#fffdf7" stroke="#5a5a5a" strokeWidth="0.5" />
      ))}
      {/* 黑键 */}
      {[0, 1, 3, 4, 5, 7, 8].map((i) => (
        <rect key={i} x={-66 + i * 15} y="4" width="8" height="12" fill="#1a1a1a" />
      ))}
    </g>
    {/* 弹琴的小孩 */}
    <Person x={200} y={165} scale={0.5} pose="sit" top="#4a90db" />
    {/* 音符 */}
    {seeds(5011, 4).map((s, i) => (
      <g key={i} transform={`translate(${rnd(s, 100, 300)}, ${rnd(s + 1, 50, 120)})`}>
        <ellipse cx="0" cy="0" rx="5" ry="4" fill="#9b7ed8" transform="rotate(-20)" />
        <line x1="5" y1="0" x2="5" y2="-20" stroke="#9b7ed8" strokeWidth="2" />
      </g>
    ))}
  </>
))

/* 家乡的风俗 —— 六下「家乡的风俗」 */
const HometownCustom = def('hometown-custom', '家乡的风俗', () => (
  <>
    <Sky tone="dusk" />
    {/* 老房子 */}
    <House x={70} y={170} scale={0.8} wall="#f5ecd9" roof="#8d5a33" />
    <House x={260} y={170} scale={0.8} wall="#e6d2b2" roof="#a06b40" />
    <Ground color="#d9c9a8" />
    {/* 鞭炮串 */}
    {seeds(5101, 8).map((s, i) => (
      <rect key={i} x={rnd(s, 140, 220)} y={150 + i * 8} width="6" height="6" rx="1" fill="#f26a6a" stroke="#c04040" strokeWidth="0.5" />
    ))}
    {/* 灯笼 */}
    <ellipse cx="160" cy="50" rx="14" ry="18" fill="#f26a6a" stroke="#c04040" strokeWidth="1.5" />
    <text x="160" y="56" textAnchor="middle" fontSize="10" fill="#ffd45e">福</text>
    {/* 汤圆/饺子桌 */}
    <rect x="130" y="220" width="140" height="30" rx="3" fill="#8d5a33" />
    <Bowl x={160} y={215} scale={0.7} />
    <Bowl x={220} y={215} scale={0.7} />
    {/* 小孩 */}
    <Person x={200} y={258} scale={0.5} pose="wave" top="#f26a6a" />
  </>
))

/* 插上科学的翅膀飞 —— 六下「插上科学的翅膀飞」（科幻故事） */
const SciFiFly = def('sci-fi-fly', '插上科学的翅膀飞', () => (
  <>
    {/* 太空背景 */}
    <rect x="0" y="0" width="400" height="300" fill="#0a0a2a" />
    {/* 星星 */}
    {seeds(5201, 30).map((s, i) => (
      <circle key={i} cx={rnd(s, 0, 400)} cy={rnd(s + 1, 0, 250)} r={rnd(s + 2, 0.5, 2)} fill="#ffffff" opacity={rnd(s + 3, 0.3, 1)} />
    ))}
    {/* 星球 */}
    <circle cx="320" cy="60" r="28" fill="#4a90db" stroke="#2a6ab0" strokeWidth="2" />
    <ellipse cx="320" cy="60" rx="40" ry="6" fill="none" stroke="#ffd45e" strokeWidth="1.5" opacity={0.6} />
    {/* 火箭 */}
    <g transform="translate(150 130)">
      <path d="M0,-40 Q10,-40 10,-20 L10,20 L-10,20 L-10,-20 Q-10,-40 0,-40 Z" fill="#fffdf7" stroke="#3a3a3a" strokeWidth="1.5" />
      <circle cx="0" cy="-15" r="5" fill="#6fb3ff" stroke="#2a6ab0" strokeWidth="1" />
      <path d="M-10,10 L-20,25 L-10,20 Z" fill="#f26a6a" />
      <path d="M10,10 L20,25 L10,20 Z" fill="#f26a6a" />
      {/* 火焰 */}
      <path d="M-6,20 Q0,40 6,20" fill="#ff9b6b" />
      <path d="M-3,20 Q0,32 3,20" fill="#ffd45e" />
    </g>
    {/* 小宇航员 */}
    <g transform="translate(60 200)">
      <circle cx="0" cy="-10" r="14" fill="#fffdf7" stroke="#3a3a3a" strokeWidth="1.5" />
      <ellipse cx="-2" cy="-12" rx="5" ry="4" fill="#1a1a3a" opacity={0.3} />
      <rect x="-10" y="4" width="20" height="24" rx="4" fill="#fffdf7" stroke="#3a3a3a" strokeWidth="1.5" />
      <line x1="-6" y1="28" x2="-8" y2="40" stroke="#3a3a3a" strokeWidth="2" />
      <line x1="6" y1="28" x2="8" y2="40" stroke="#3a3a3a" strokeWidth="2" />
    </g>
  </>
))

/* 难忘小学生活 —— 六下「难忘小学生活」 */
const FarewellSchool = def('farewell-school', '难忘小学生活', () => (
  <>
    <Sky tone="dusk" />
    {/* 教学楼 */}
    <g transform="translate(200 120)">
      <rect x="-80" y="0" width="160" height="100" rx="4" fill="#e6d2b2" stroke="#8d5a33" strokeWidth="2" />
      {seeds(5301, 6).map((_s, i) => (
        <rect key={i} x={-70 + (i % 3) * 55} y={10 + Math.floor(i / 3) * 40} width="40" height="28" rx="2" fill="#d6efff" stroke="#8d5a33" strokeWidth="1" />
      ))}
      {/* 校名 */}
      <rect x="-40" y="-28" width="80" height="24" rx="3" fill="#8d5a33" />
      <text x="0" y="-12" textAnchor="middle" fontSize="12" fill="#fffdf7">母校</text>
    </g>
    <Ground color="#7ec850" />
    {/* 毕业生 */}
    <Person x={120} y={260} scale={0.5} pose="wave" top="#4a90db" />
    <Person x={180} y={260} scale={0.5} pose="wave" top="#ff8fb1" />
    <Person x={240} y={260} scale={0.5} pose="wave" top="#4fae5a" />
    <Person x={300} y={260} scale={0.5} pose="wave" top="#ffd45e" />
    {/* 校旗 */}
    <line x1="60" y1="150" x2="60" y2="230" stroke="#8d5a33" strokeWidth="2.5" />
    <rect x="62" y="150" width="36" height="24" rx="2" fill="#f26a6a" />
    {/* 横幅 */}
    <rect x="100" y="50" width="200" height="22" rx="3" fill="#4a90db" />
    <text x="200" y="66" textAnchor="middle" fontSize="11" fill="#ffffff">难忘小学生活</text>
  </>
))

/* ============================================================
   七、场景登记表 + 对外 API
   ============================================================ */

/** key → 渲染组件。SceneArt 只认这张表，加新图只改这里 */
const SCENE_MAP: Record<string, React.FC<SceneProps>> = {
  /* 写景 */
  'spring-park': SpringPark,
  'autumn-leaves': AutumnLeaves,
  'winter-window': WinterWindow,
  'snow-play': SnowPlay,
  snowman: SnowmanScene,
  'rain-window': RainWindow,
  rainbow: RainbowScene,
  'fog-morning': FogMorning,
  'river-village': RiverVillage,
  'mountain-climb': MountainClimb,
  'sunrise-peak': SunrisePeak,
  'school-garden': SchoolGarden,
  playground: Playground,
  'starry-night': StarryNight,
  fireflies: Fireflies,
  /* 写景·补充 */
  'summer-pond': SummerPond,
  beach: Beach,
  'wheat-field': WheatField,
  'school-autumn': SchoolAutumn,
  sunset: Sunset,
  'snow-clear': SnowClear,
  /* 写人 */
  'mom-cooking': MomCooking,
  'grandpa-garden': GrandpaGarden,
  'baby-arrive': BabyArrive,
  'play-with-baby': PlayWithBaby,
  'teacher-class': TeacherClass,
  deskmate: Deskmate,
  'street-cleaner': StreetCleaner,
  'rain-delivery': RainDelivery,
  'mirror-self': MirrorSelf,
  'bike-fail': BikeFail,
  'bike-ride': BikeRide,
  /* 写人·补充 */
  'dad-repair': DadRepair,
  'grandma-knit': GrandmaKnit,
  'best-friend': BestFriend,
  doctor: DoctorScene,
  police: PoliceScene,
  librarian: Librarian,
  neighbor: Neighbor,
  'bus-driver': BusDriver,
  /* 写事 */
  'cook-start': CookStart,
  'cook-mess': CookMess,
  'cook-done': CookDone,
  'stage-nervous': StageNervous,
  'memory-album': MemoryAlbum,
  'lost-crowd': LostCrowd,
  'found-mom': FoundMom,
  'help-hand': HelpHand,
  'umbrella-rain': UmbrellaRain,
  'sports-day': SportsDay,
  'spring-outing-bus': SpringOutingBus,
  'spring-outing-picnic': SpringOutingPicnic,
  'spring-outing-play': SpringOutingPlay,
  'cleaning-class': CleaningClass,
  'lie-truth': LieTruth,
  'broken-vase': BrokenVase,
  /* 写事·补充 */
  late: Late,
  award: Award,
  sick: Sick,
  moving: Moving,
  'exam-nervous': ExamNervous,
  graduation: Graduation,
  'sleep-alone': SleepAlone,
  birthday: Birthday,
  /* 状物 */
  'cat-sun': CatSun,
  'dog-welcome': DogWelcome,
  'bird-window': BirdWindow,
  pothos: Pothos,
  dandelion: DandelionScene,
  backpack: BackpackScene,
  'eraser-talking': EraserTalking,
  'sewing-box': SewingBox,
  'old-toy': OldToy,
  dumplings: Dumplings,
  'noodle-soup': NoodleSoup,
  /* 状物·补充 */
  goldfish: Goldfish,
  'pencil-case': PencilCase,
  'my-room': MyRoom,
  lotus: Lotus,
  cactus: Cactus,
  'old-photo': OldPhoto,
  turtle: Turtle,
  clock: Clock,
  /* 想象·补充 */
  'if-tiny': IfTiny,
  underwater: Underwater,
  space: Space,
  'robot-friend': RobotFriend,
  'time-travel': TimeTravel,
  /* 课本习作·补充 */
  'book-store': BookStore,
  'look-picture-single': LookPictureSingle,
  'look-picture-series': LookPictureSeries,
  festival: Festival,
  experiment: Experiment,
  panda: Panda,
  'observe-diary': ObserveDiary,
  'write-letter': WriteLetter,
  'play-game': PlayGame,
  'my-paradise': MyParadise,
  invention: Invention,
  'travel-visit': TravelVisit,
  'comic-teacher': ComicTeacher,
  'introduce-thing': IntroduceThing,
  'reading-notes': ReadingNotes,
  'all-kinds-people': AllKindsPeople,
  'adventure-trip': AdventureTrip,
  'cultural-heritage': CulturalHeritage,
  'comic-inspiration': ComicInspiration,
  deformation: Deformation,
  'colorful-activity': ColorfulActivity,
  'pen-story': PenStory,
  'my-talent': MyTalent,
  'hometown-custom': HometownCustom,
  'sci-fi-fly': SciFiFly,
  'farewell-school': FarewellSchool,
  /* 想象 */
  'fly-sky': FlySky,
  'wind-travel': WindTravel,
  'talk-animals': TalkAnimals,
  'future-school': FutureSchool,
  'future-me': FutureMe,
  'turtle-rabbit': TurtleRabbit,
  'girl-visit': GirlVisit,
  'talking-bag': TalkingBag,
  'pencil-escape': PencilEscape,
  'pencil-adventure': PencilAdventure,
  'pencil-home': PencilHome,
  'weird-dream': WeirdDream,
}

/** 完整目录：AI 出题按 fits 挑图，label 给孩子看，hint 给模型看 */
export const SCENES: SceneMeta[] = [
  /* ---------------- 写景 ---------------- */
  {
    key: 'spring-park',
    label: '春天的公园',
    hint: '近处草地上开着各色小花、小路弯弯，中景两棵开满粉花的树，远处是淡绿的青山和白云，一个女孩牵着狗在散步。',
    fits: ['scene'],
  },
  {
    key: 'autumn-leaves',
    label: '秋天的落叶',
    hint: '满地金黄的落叶铺在小路上，两棵金黄的树被风吹得摇晃，两个孩子追着飘落的叶子跑。',
    fits: ['scene'],
  },
  {
    key: 'winter-window',
    label: '冬天的窗户',
    hint: '从屋里往外看，窗外下着雪、有落光叶子的树和小房子，窗台上放着一盆绿植和一杯热饮。',
    fits: ['scene'],
  },
  {
    key: 'snow-play',
    label: '玩雪',
    hint: '雪地上两个孩子打雪仗，半空中飞着几个雪球，远处是落光叶子的树。',
    fits: ['event'],
  },
  {
    key: 'snowman',
    label: '堆雪人',
    hint: '雪地中间站着一个戴红围巾、胡萝卜鼻子的雪人，两边各有一个孩子，天上飘着雪。',
    fits: ['event'],
  },
  {
    key: 'rain-window',
    label: '下雨的窗户',
    hint: '窗外下着雨，树和小房子都蒙着一层灰蓝，玻璃上挂着雨珠，一只猫蹲在窗台看雨。',
    fits: ['scene'],
  },
  {
    key: 'rainbow',
    label: '雨后的彩虹',
    hint: '一道六色彩虹架在天地之间，草地上有两摊水洼，远处是山丘和云，一个孩子举起双手。',
    fits: ['scene'],
  },
  {
    key: 'fog-morning',
    label: '大雾的早晨',
    hint: '雾里只能看清近处的小路和两个人影，远处的树影若隐若现，路边立着一盏还亮着的路灯。',
    fits: ['scene'],
  },
  {
    key: 'river-village',
    label: '家乡的小河',
    hint: '一条小河从村子中间流过，河上架着石拱桥，两岸是白墙红顶的小屋和绿树，水面上还有一条小船。',
    fits: ['scene'],
  },
  {
    key: 'mountain-climb',
    label: '摸黑上山',
    hint: '天还没亮，深蓝的天上有月亮和星星，两座大山黑黑地立着，两个人打着手电走在上山的小路上。',
    fits: ['event'],
  },
  {
    key: 'sunrise-peak',
    label: '日出山顶',
    hint: '太阳从两座山之间升起来，山谷里铺着白色的云海，山顶上两个孩子举起手欢呼。',
    fits: ['scene'],
  },
  {
    key: 'school-garden',
    label: '学校的小花园',
    hint: '一座教学楼前有小路和木栅栏，花圃里开满各色小花，两个学生在花园里散步，一只小鸟飞过。',
    fits: ['scene'],
  },
  {
    key: 'playground',
    label: '热闹的操场',
    hint: '红色跑道围着绿茵场，左边有一个白色球门，中间是一个足球，几个孩子在跑、在跳，远处是教学楼。',
    fits: ['event'],
  },
  {
    key: 'starry-night',
    label: '数星星的晚上',
    hint: '深蓝的夜空挂满星星和一弯月亮，草地上一个孩子躺着看天，旁边是两棵松树和草丛。',
    fits: ['scene'],
  },
  {
    key: 'fireflies',
    label: '萤火虫之夜',
    hint: '夜里草地上飞满发光的萤火虫，一个孩子举着玻璃罐去追，远处有月亮和树影。',
    fits: ['scene'],
  },
  /* 写景·补充 */
  {
    key: 'summer-pond',
    label: '夏日荷塘',
    hint: '水面上铺着碧绿的荷叶，两朵粉色的荷花开着，一只蓝色蜻蜓停在上方，水里有鱼影。',
    fits: ['scene'],
  },
  {
    key: 'beach',
    label: '海边沙滩',
    hint: '金黄色的沙滩上散着贝壳，有一把红色遮阳伞，远处是蓝色大海和白色浪花，一个孩子坐在沙地上。',
    fits: ['scene'],
  },
  {
    key: 'wheat-field',
    label: '金色麦田',
    hint: '满眼金黄的麦穗在风里摇晃，远处是小山和一座房子，田间有一条土路。',
    fits: ['scene'],
  },
  {
    key: 'school-autumn',
    label: '校园的秋天',
    hint: '教学楼前两棵银杏树金黄一片，地上落满了叶子，一个女孩走在铺满落叶的小路上。',
    fits: ['scene'],
  },
  {
    key: 'sunset',
    label: '日落',
    hint: '橙红色的天空下，太阳慢慢落到山后面，远山和树木变成深色剪影，一个孩子站着看。',
    fits: ['scene'],
  },
  {
    key: 'snow-clear',
    label: '雪后晴空',
    hint: '雪停了天晴了，蓝天下的屋顶挂着冰棱，远处雪山白白的，一个雪人戴着围巾，一个孩子在挥手。',
    fits: ['scene'],
  },

  /* ---------------- 写人 ---------------- */
  {
    key: 'mom-cooking',
    label: '妈妈做饭',
    hint: '厨房里妈妈系着围裙站在料理台后面，灶上一口锅冒着热气，台面上摆着切好的菜和一只碗。',
    fits: ['person'],
  },
  {
    key: 'grandpa-garden',
    label: '爷爷的花园',
    hint: '菜地里一畦畦菜苗排得整整齐齐，戴草帽的爷爷提着蓝色喷壶浇水，身后是木栅栏和小房子。',
    fits: ['person'],
  },
  {
    key: 'baby-arrive',
    label: '妹妹来了',
    hint: '屋里放着一张婴儿床，里面躺着一个小宝宝，两个人围在床边看，墙上飘着三只气球。',
    fits: ['person'],
  },
  {
    key: 'play-with-baby',
    label: '一起玩',
    hint: '地垫上坐着小宝宝，旁边两个大孩子陪着他玩，地上散着玩具熊和积木。',
    fits: ['person'],
  },
  {
    key: 'teacher-class',
    label: '我的老师',
    hint: '教室前面黑板上写着粉笔字，老师站在黑板旁伸手指着，下面是几排课桌和坐着的学生。',
    fits: ['person'],
  },
  {
    key: 'deskmate',
    label: '我的同桌',
    hint: '一张课桌前坐着两个同学，桌上摊着书和笔，旁边冒出一个对话气泡，背景是黑板。',
    fits: ['person'],
  },
  {
    key: 'street-cleaner',
    label: '清晨的环卫工',
    hint: '天刚亮，街道上一名穿橙色工作服的环卫工在扫落叶，旁边停着绿色的垃圾车，远处是楼房。',
    fits: ['person'],
  },
  {
    key: 'rain-delivery',
    label: '雨天的快递员',
    hint: '雨天街道上，一名快递员骑着电动车、后座绑着大纸箱，路边有一把红伞，地上溅起水花。',
    fits: ['person'],
  },
  {
    key: 'mirror-self',
    label: '这就是我',
    hint: '墙上的圆镜子里映出一个孩子，镜子外面站着同一个孩子，旁边是一盆绿植。',
    fits: ['person'],
  },
  {
    key: 'bike-fail',
    label: '摔倒了',
    hint: '公园小路上，一辆自行车歪倒在地，一个孩子坐在地上摸着膝盖，另一个孩子伸手来扶。',
    fits: ['event'],
  },
  {
    key: 'bike-ride',
    label: '学会了骑车',
    hint: '小路上一个孩子骑着红色自行车飞快前进，身后有几道速度线，爸爸在后面追着跑。',
    fits: ['event'],
  },
  /* 写人·补充 */
  {
    key: 'dad-repair',
    label: '爸爸修东西',
    hint: '院子里爸爸蹲在倒放的自行车旁，手里拿着扳手，旁边放着一个木工具箱。',
    fits: ['person'],
  },
  {
    key: 'grandma-knit',
    label: '奶奶织毛衣',
    hint: '屋里奶奶坐在摇椅上织毛衣，腿上放着两个毛线团，鼻梁上架着老花镜。',
    fits: ['person'],
  },
  {
    key: 'best-friend',
    label: '我的好朋友',
    hint: '草地上两个孩子肩并肩站着，一个穿蓝衣服、一个穿黄衣服，旁边有树和花，头顶有个对话气泡。',
    fits: ['person'],
  },
  {
    key: 'doctor',
    label: '看病的医生',
    hint: '诊室里医生穿着白大褂站在桌旁，胸前挂着听诊器，一个小孩坐在台子前面。',
    fits: ['person'],
  },
  {
    key: 'police',
    label: '警察叔叔',
    hint: '十字路口一名警察穿着蓝色制服、戴着警帽，伸手指引方向，旁边有红绿灯和斑马线。',
    fits: ['person'],
  },
  {
    key: 'librarian',
    label: '图书管理员',
    hint: '书架排满了彩色书脊，管理员戴着眼镜站在借书台后面，一个孩子伸手来借书。',
    fits: ['person'],
  },
  {
    key: 'neighbor',
    label: '邻居阿姨',
    hint: '门廊前一个阿姨提着菜篮子笑着挥手，旁边有栅栏和花。',
    fits: ['person'],
  },
  {
    key: 'bus-driver',
    label: '公交司机',
    hint: '一辆黄色公交车停在路边，司机坐在方向盘后面，车头有投币箱和站牌。',
    fits: ['person'],
  },

  /* ---------------- 写事 ---------------- */
  {
    key: 'cook-start',
    label: '准备开始',
    hint: '厨房台面上摆好了案板、蔬菜、鸡蛋和碗，一个系着围裙的孩子站在台前准备动手，墙上贴着食谱。',
    fits: ['event'],
  },
  {
    key: 'cook-mess',
    label: '手忙脚乱',
    hint: '厨房里到处飘着白面粉，一个孩子张开手一脸惊讶，台面上碗翻了、锅里的东西糊了。',
    fits: ['event'],
  },
  {
    key: 'cook-done',
    label: '端上桌了',
    hint: '一家人围坐在餐桌旁，桌子中间是一盘冒着热气的菜，每个人面前都有小碟子。',
    fits: ['event'],
  },
  {
    key: 'stage-nervous',
    label: '第一次上台',
    hint: '红色幕布拉开，一束聚光灯照在舞台中间一个站着的孩子身上，台下是一片黑压压的脑袋。',
    fits: ['event'],
  },
  {
    key: 'memory-album',
    label: '那一次，我很难忘',
    hint: '桌上摊开一本厚厚的相册，两页里各贴着一张照片，一个孩子坐在旁边翻看。',
    fits: ['event'],
  },
  {
    key: 'lost-crowd',
    label: '找不到妈妈了',
    hint: '街上全是走来走去的大人，中间一个矮矮的孩子仰着头四处张望，头上冒出一个对话气泡。',
    fits: ['event'],
  },
  {
    key: 'found-mom',
    label: '终于找到了',
    hint: '妈妈蹲下来张开手臂，孩子扑进她怀里，两人中间冒出一颗小爱心，周围的人群是模糊的。',
    fits: ['event'],
  },
  {
    key: 'help-hand',
    label: '他扶了我一把',
    hint: '操场上一个孩子坐在地上抱着膝盖，另一个孩子弯腰伸出手去拉他，旁边有几道表示动作的线。',
    fits: ['event'],
  },
  {
    key: 'umbrella-rain',
    label: '雨中送伞',
    hint: '雨天街道上，一把橙色的伞下站着两个人，地面积着水洼，远处是灰蓝色的楼房。',
    fits: ['event'],
  },
  {
    key: 'sports-day',
    label: '热闹的运动会',
    hint: '操场上方挂着一排彩旗，跑道上四个孩子正在赛跑，内圈站着一排挥手的同学，远处是教学楼。',
    fits: ['event'],
  },
  {
    key: 'spring-outing-bus',
    label: '春游·大巴',
    hint: '一辆黄色大巴停在路边，几个孩子排队上车，老师在旁边挥手，旁边开着粉色的花树。',
    fits: ['event'],
  },
  {
    key: 'spring-outing-picnic',
    label: '春游·野餐',
    hint: '草地上铺着粉格子布，上面摆着篮子和食物，三个孩子围坐成一圈，旁边有开花的树。',
    fits: ['event'],
  },
  {
    key: 'spring-outing-play',
    label: '春游·游戏',
    hint: '草地上一个孩子举着线放风筝，风筝飞在半空，另外两个孩子在跑，天上飘着泡泡和花瓣。',
    fits: ['event'],
  },
  {
    key: 'cleaning-class',
    label: '大扫除',
    hint: '教室里一个孩子在擦窗、一个在扫地、一个提着水桶，桌椅搬到了一边，黑板上还留着粉笔字。',
    fits: ['event'],
  },
  {
    key: 'lie-truth',
    label: '说谎与承认',
    hint: '屋里一个孩子低着头站着，一个大人蹲下来平视他听他说话，桌上摆着一瓶花。',
    fits: ['event'],
  },
  {
    key: 'broken-vase',
    label: '打碎花瓶',
    hint: '地板上散着一堆青色的花瓶碎片和几朵花，一个孩子站在旁边张大嘴，一只猫蹲在角落。',
    fits: ['event'],
  },
  /* 写事·补充 */
  {
    key: 'late',
    label: '迟到了',
    hint: '清晨校门口，一个孩子背着书包飞跑过来，头顶有个钟显示八点十分，远处是学校大门。',
    fits: ['event'],
  },
  {
    key: 'award',
    label: '得奖了',
    hint: '领奖台上一个孩子举着手，手里捧着一个金色奖杯，台下同学在鼓掌，上方挂着彩旗。',
    fits: ['event'],
  },
  {
    key: 'sick',
    label: '生病了',
    hint: '床上一个孩子躺着盖着蓝被子，旁边放着温度计和药杯，妈妈坐在床边陪着他。',
    fits: ['event'],
  },
  {
    key: 'moving',
    label: '搬新家',
    hint: '空荡荡的新房间里堆着几个大纸箱，一个孩子抱着一个小纸箱，窗帘是粉色的。',
    fits: ['event'],
  },
  {
    key: 'exam-nervous',
    label: '考试前夜',
    hint: '书桌前一个孩子坐着，桌上堆着课本和台灯，墙上有钟，孩子表情紧张。',
    fits: ['event'],
  },
  {
    key: 'graduation',
    label: '毕业告别',
    hint: '三个穿校服戴毕业帽的孩子站成一排，有人拿着花束，上方挂着彩旗。',
    fits: ['event'],
  },
  {
    key: 'sleep-alone',
    label: '第一次独睡',
    hint: '夜里蓝幽幽的房间，窗外有月亮和星星，床上的被子鼓起来，只露出一双眼睛。',
    fits: ['event'],
  },
  {
    key: 'birthday',
    label: '过生日',
    hint: '桌上放着一个插着五根蜡烛的蛋糕，两边站着家人，房间挂着彩旗和气球。',
    fits: ['event'],
  },

  /* ---------------- 状物 ---------------- */
  {
    key: 'cat-sun',
    label: '晒太阳的猫',
    hint: '地板上有一道斜斜的阳光，一只橘猫闭着眼睛趴在光里打盹，旁边有毛线球和一盆绿萝。',
    fits: ['object'],
  },
  {
    key: 'dog-welcome',
    label: '小狗迎接',
    hint: '门开着，一只小狗摇着尾巴朝门口冲过来，一个孩子站在门边张开手，地上有几道速度线。',
    fits: ['object'],
  },
  {
    key: 'bird-window',
    label: '窗边的小鸟',
    hint: '窗台上停着一只蓝色的小鸟，旁边放着一盆小植物，一个孩子在窗边安静地看着。',
    fits: ['object'],
  },
  {
    key: 'pothos',
    label: '绿萝',
    hint: '书架上摆着一盆绿萝，心形的叶子从花盆边垂下来，旁边是透光的窗户。',
    fits: ['object'],
  },
  {
    key: 'dandelion',
    label: '蒲公英',
    hint: '草地上长着几朵蒲公英，一朵白色的绒球正在散开，种子随风飘向天空。',
    fits: ['object'],
  },
  {
    key: 'backpack',
    label: '我的书包',
    hint: '教室椅背上挂着一个蓝色书包，桌上摊着书和铅笔，后面是黑板。',
    fits: ['object'],
  },
  {
    key: 'eraser-talking',
    label: '会说话的橡皮',
    hint: '桌上放着一块长了笑脸的粉色橡皮，旁边躺着一支铅笔，橡皮上方冒出一个对话气泡。',
    fits: ['object'],
  },
  {
    key: 'sewing-box',
    label: '针线盒',
    hint: '打开的针线盒里排着五轴彩色线，旁边放着剪刀、顶针、针和几颗扣子。',
    fits: ['object'],
  },
  {
    key: 'old-toy',
    label: '旧玩具',
    hint: '架子上坐着一只掉了耳朵、打着补丁的旧小熊，旁边有相框和小木盒，光线暖暖的。',
    fits: ['object'],
  },
  {
    key: 'dumplings',
    label: '包饺子',
    hint: '案板上排着一排刚包好的饺子，旁边有擀面杖、面粉和一口冒热气的锅，两个人在包。',
    fits: ['object'],
  },
  {
    key: 'noodle-soup',
    label: '一碗面',
    hint: '桌上一只白色大碗，里面是热腾腾的面条、鸡蛋和青菜，旁边搁着一双筷子，窗外有太阳。',
    fits: ['object'],
  },
  {
    key: 'goldfish',
    label: '金鱼缸',
    hint: '透明玻璃鱼缸里有两条金鱼在游，缸底铺着彩色石子，种着水草，水面上冒着一串小气泡。',
    fits: ['object'],
  },
  {
    key: 'pencil-case',
    label: '文具盒',
    hint: '打开的文具盒里躺着钢笔、铅笔、直尺和橡皮，每样文具都整整齐齐地排在格子里。',
    fits: ['object'],
  },
  {
    key: 'my-room',
    label: '我的房间',
    hint: '小房间里有床、书桌和书架，窗户挂着窗帘，桌上摆着一盏台灯和几本书，墙上贴着画。',
    fits: ['object'],
  },
  {
    key: 'lotus',
    label: '荷花',
    hint: '池塘水面上铺着圆圆的荷叶，一朵粉色荷花盛开着，旁边还有一个花苞，一只蜻蜓停在花尖上。',
    fits: ['object'],
  },
  {
    key: 'cactus',
    label: '仙人掌',
    hint: '花盆里种着一棵绿色的仙人掌，有圆圆的茎和分枝，身上布满小刺，顶上开着一朵小红花。',
    fits: ['object'],
  },
  {
    key: 'old-photo',
    label: '旧照片',
    hint: '相框里是一张泛黄的风景照，相架立在书桌上，旁边搁着一本书和一支钢笔。',
    fits: ['object'],
  },
  {
    key: 'turtle',
    label: '小乌龟',
    hint: '浅水盆里趴着一只小乌龟，壳上有六边形花纹，头和四条腿伸在外面，旁边放着几粒龟粮。',
    fits: ['object'],
  },
  {
    key: 'clock',
    label: '闹钟',
    hint: '床头柜上放着一个双铃闹钟，钟面上有十二个刻度和两根指针，顶上两个小铃铛，底下有两只脚。',
    fits: ['object'],
  },

  /* ---------------- 想象 ---------------- */
  {
    key: 'fly-sky',
    label: '假如我会飞',
    hint: '一个孩子背着白色的翅膀飞在半空，脚下是小房子和绿树，周围飘着云朵和小鸟。',
    fits: ['imagine'],
  },
  {
    key: 'wind-travel',
    label: '假如我是风',
    hint: '白色的风一道道吹过草地，两棵树被吹得弯了腰，叶子在空中乱飞，一个孩子站在风里。',
    fits: ['imagine'],
  },
  {
    key: 'talk-animals',
    label: '会说话的动物',
    hint: '林间空地上坐着一只猫、一只狗和一只小鸟，每个头顶都有一个对话气泡。',
    fits: ['imagine'],
  },
  {
    key: 'future-school',
    label: '未来的学校',
    hint: '天空下飘着几座半圆形的建筑、光环和一条虚线连成的空中走廊，全是抽象的几何形状。',
    fits: ['imagine'],
  },
  {
    key: 'future-me',
    label: '未来的我',
    hint: '一个孩子站着抬头看，头顶一个大大的思考气泡，气泡里是一个戴头盔的宇航员。',
    fits: ['imagine'],
  },
  {
    key: 'turtle-rabbit',
    label: '龟兔赛跑',
    hint: '跑道上乌龟在慢慢往前爬，兔子靠在树下睡着了，终点插着一面红旗。',
    fits: ['imagine'],
  },
  {
    key: 'girl-visit',
    label: '雪夜的小女孩',
    hint: '雪夜的街道上，一个小女孩站着，手里捏着一根发亮的火柴，旁边是一扇透出暖黄灯光的窗。',
    fits: ['imagine'],
  },
  {
    key: 'talking-bag',
    label: '会说话的书包',
    hint: '椅背上挂着一个长了笑脸的蓝色书包，旁边冒出一个对话气泡，桌上摊着作业本。',
    fits: ['imagine'],
  },
  {
    key: 'pencil-escape',
    label: '铅笔逃跑',
    hint: '一支铅笔从桌上跳下来朝门口跑，身后有几道速度线，桌上有橡皮和本子。',
    fits: ['imagine'],
  },
  {
    key: 'pencil-adventure',
    label: '铅笔历险',
    hint: '一支大铅笔站在一本摊开的巨书上，书页像山谷一样起伏，周围有云和太阳。',
    fits: ['imagine'],
  },
  {
    key: 'pencil-home',
    label: '铅笔回家',
    hint: '打开的红色笔袋里挤着好几支彩笔和一块橡皮，那支铅笔也回到了队伍里。',
    fits: ['imagine'],
  },
  {
    key: 'weird-dream',
    label: '奇怪的梦',
    hint: '紫色的天空下，房子倒着长、鱼在云里游，一个孩子躺在云朵上睡觉，周围飘着气球和风筝。',
    fits: ['imagine'],
  },
  {
    key: 'if-tiny',
    label: '假如我变小了',
    hint: '巨大的花朵和草丛中间站着一个很小的人，旁边有一只蚂蚁爬过，露珠像湖泊一样大。',
    fits: ['imagine'],
  },
  {
    key: 'underwater',
    label: '海底探险',
    hint: '蓝色的海水里长着珊瑚和水草，一群小鱼游来游去，水底冒着一串串气泡，远处有个潜水头盔。',
    fits: ['imagine'],
  },
  {
    key: 'space',
    label: '太空旅行',
    hint: '黑色星空里有一个带光环的星球，一架火箭拖着火焰在飞，旁边飘着一个穿宇航服的小人。',
    fits: ['imagine'],
  },
  {
    key: 'robot-friend',
    label: '机器人朋友',
    hint: '方头机器人有天线和齿轮关节，正在和一个孩子挥手，地上散落着螺丝和电池。',
    fits: ['imagine'],
  },
  {
    key: 'time-travel',
    label: '时间快进',
    hint: '一个大钟表旋出螺旋纹，前方是未来城市的天际线剪影，楼里亮着星星点点的灯。',
    fits: ['imagine'],
  },
  /* ---------------- 课本习作·补充 ---------------- */
  {
    key: 'book-store',
    label: '书店',
    hint: '暖色书架上排满了彩色书脊，柜台后面站着看书的小孩，门口挂着「书店」的牌子。',
    fits: ['scene', 'object'],
  },
  {
    key: 'look-picture-single',
    label: '看图作文（单图）',
    hint: '墙上挂着一张画着春天公园的大图，桌上趴着一个小孩，旁边写着「仔细看图，把看到的、想到的写下来」。',
    fits: ['event'],
  },
  {
    key: 'look-picture-series',
    label: '看图作文（连环图）',
    hint: '墙上并排挂着三幅小图，中间有箭头连接，画着一个故事的三个场景，桌上有铅笔和纸。',
    fits: ['event'],
  },
  {
    key: 'festival',
    label: '传统节日',
    hint: '天上挂着灯笼和烟花，两座红顶房子中间摆着月饼和饺子，一个穿红衣的小孩在挥手。',
    fits: ['event', 'scene'],
  },
  {
    key: 'experiment',
    label: '小实验',
    hint: '桌上有烧杯冒气泡，上方滴管滴着粉色液体，旁边放着记录本，一个小孩在认真观察，头顶有个大问号。',
    fits: ['event'],
  },
  {
    key: 'panda',
    label: '国宝大熊猫',
    hint: '绿竹林里一只胖熊猫坐着吃竹子，黑白毛色，黑眼圈，圆耳朵，旁边牌子写着「国宝大熊猫」。',
    fits: ['object'],
  },
  {
    key: 'observe-diary',
    label: '观察日记',
    hint: '桌上放着日记本和铅笔，旁边一盆蒜头瓶里长出三根绿苗，上方有放大镜，墙上日历写着「观察第7天」。',
    fits: ['event', 'object'],
  },
  {
    key: 'write-letter',
    label: '写信',
    hint: '桌上有信封、邮票和信纸，一支铅笔斜放着，一个小孩在写，头顶飘着一个红色爱心。',
    fits: ['event'],
  },
  {
    key: 'play-game',
    label: '游戏',
    hint: '草地上两队小孩在拔河，绳中间系着红布条，两边小孩弯腰用力，旁边有人在欢呼。',
    fits: ['event'],
  },
  {
    key: 'my-paradise',
    label: '我的乐园',
    hint: '大树上有个树屋，旁边架着秋千，地上开满五颜六色的花，一个小孩在挥手。',
    fits: ['scene'],
  },
  {
    key: 'invention',
    label: '奇思妙想',
    hint: '设计图上画着一双带翅膀的鞋和齿轮，旁边有个灯泡亮着，一个小孩趴在桌前画。',
    fits: ['imagine'],
  },
  {
    key: 'travel-visit',
    label: '游记参观',
    hint: '古亭子前有石阶和绿树，一个小孩举着相机在拍照。',
    fits: ['scene'],
  },
  {
    key: 'comic-teacher',
    label: '漫画老师',
    hint: '黑板前站着戴眼镜的老师，手里拿着教鞭，讲台下面坐着两个学生。',
    fits: ['person'],
  },
  {
    key: 'introduce-thing',
    label: '介绍一种事物',
    hint: '展示台上放着笔记本电脑，旁边有标注线指向「外形」「功能」「用途」，一个小孩在讲。',
    fits: ['object', 'event'],
  },
  {
    key: 'reading-notes',
    label: '读后感',
    hint: '书架上排满了书，桌上翻开一本粉皮书，旁边放着写着「读后感」的笔记本，有个思考气泡。',
    fits: ['event'],
  },
  {
    key: 'all-kinds-people',
    label: '形形色色的人',
    hint: '草地上站着一排不同姿态不同颜色的小孩，头顶有对话气泡标着「同学」「路人」「邻居」。',
    fits: ['person'],
  },
  {
    key: 'adventure-trip',
    label: '探险之旅',
    hint: '山洞入口有一支火把，背着包的小孩打着手电往里走，光束照到一个宝藏箱。',
    fits: ['imagine', 'event'],
  },
  {
    key: 'cultural-heritage',
    label: '文化遗产',
    hint: '城墙上有城楼和城垛，两个小孩在城墙前参观，旁边牌子写着「世界文化遗产」。',
    fits: ['scene'],
  },
  {
    key: 'comic-inspiration',
    label: '漫画的启示',
    hint: '墙上挂着四格漫画框，每格里有一个不同姿态的小人，桌上一个小孩在看漫画。',
    fits: ['event', 'imagine'],
  },
  {
    key: 'deformation',
    label: '变形记',
    hint: '一只巨大的蚂蚁站在草丛中，有触角和六条腿，远处一个很小的人影是变形前的自己。',
    fits: ['imagine'],
  },
  {
    key: 'colorful-activity',
    label: '多彩的活动',
    hint: '椭圆形跑道上有人在跑步和跳绳，两边有观众在挥手，横幅上写着「运动会」。',
    fits: ['event', 'scene'],
  },
  {
    key: 'pen-story',
    label: '笔尖流出的故事',
    hint: '桌上摊着一本大笔记本，一支铅笔斜着在写字，笔尖冒出一个小人和星光，旁边有个思考气泡。',
    fits: ['imagine', 'event'],
  },
  {
    key: 'my-talent',
    label: '我的拿手好戏',
    hint: '聚光灯下一架钢琴，小孩坐在凳上弹琴，旁边飘着紫色的音符。',
    fits: ['event'],
  },
  {
    key: 'hometown-custom',
    label: '家乡的风俗',
    hint: '两座老房子之间挂着灯笼和鞭炮，桌上摆着碗和汤圆，一个穿红衣的小孩在挥手。',
    fits: ['event', 'scene'],
  },
  {
    key: 'sci-fi-fly',
    label: '插上科学的翅膀飞',
    hint: '深蓝色太空中有一架火箭拖着火焰在飞，远处有带光环的星球，旁边飘着一个小宇航员。',
    fits: ['imagine'],
  },
  {
    key: 'farewell-school',
    label: '难忘小学生活',
    hint: '教学楼前站着四个穿不同颜色衣服的小孩在挥手，校门口有校旗和「难忘小学生活」横幅。',
    fits: ['event', 'scene'],
  },
]

/** key → meta 的索引，避免每次线性查找 */
const META_BY_KEY = new Map<string, SceneMeta>(
  SCENES.map((m): [string, SceneMeta] => [m.key, m]),
)

/** 按 key 取元数据；key 不存在时返回 undefined */
export function sceneMeta(key: string): SceneMeta | undefined {
  return META_BY_KEY.get(key)
}

/**
 * 渲染一张插画。
 *
 * 优先级：① 题里自带的 `imageUrl`（手写题库数据） ② sceneImages 注册表里
 * 给这个 sceneKey 填的外链 ③ 加载失败或没填就退回 SVG ④ key 不存在就退化成占位画。
 *
 * 外链图片加载失败时只尝试一次就永久退回 SVG（跟 TravelPhotoFrame 一样），
 * 避免每次渲染都重新加载一张注定失败的图。
 *
 * photo 风格的图片会加一层暖色柔光（CSS filter），让实景照片
 * 和卡通 SVG 在同一篇文章里配着也不突兀。
 *
 * ⚠️ 两个入参都可选，但至少要有一个 —— 都没有时画的是「暂无插图」占位画。
 *    调用方一律走 <SceneArt sceneKey={img.sceneKey} imageUrl={img.imageUrl} />，
 *    写作台、题库缩略图、题库预览共用这一条兜底路径（跟 TravelPhotoFrame 同理：
 *    两条路径的兜底行为必须一致，否则同一个 bug 要修两遍）。
 */
export function SceneArt({
  sceneKey,
  imageUrl,
  alt,
  className,
}: {
  sceneKey?: string
  imageUrl?: string
  /** 外链图的 alt；不填就退用 sceneKey 对应的中文标签 */
  alt?: string
  className?: string
}): React.ReactElement {
  const Scene = sceneKey ? SCENE_MAP[sceneKey] : undefined
  // 注册表里的外链只在 sceneKey 确实对应一张 SVG 时才用 ——
  // 否则图挂了就真的什么都没了（sceneKey 写错是静默失败，见 sceneImages.ts）
  const ext = sceneKey && Scene != null ? getSceneImage(sceneKey) : undefined

  // 题自带的外链优先于注册表；题自带的没写 style，不加滤镜
  const photo = imageUrl
    ? { imageUrl, alt: alt ?? (sceneKey ? sceneMeta(sceneKey)?.label ?? '' : ''), style: undefined }
    : ext
  const [imgFailed, setImgFailed] = useState(false)

  if (photo && !imgFailed) {
    // photo 风格加暖色柔光，让实景跟卡通 SVG 搭配时不突兀
    const photoStyle = photo.style === 'photo'
      ? { filter: 'sepia(0.12) saturate(1.05) brightness(0.98)' as const }
      : undefined

    return (
      <div className={`relative overflow-hidden ${className ?? ''}`} style={{ aspectRatio: '4 / 3' }}>
        <img
          src={photo.imageUrl}
          alt={photo.alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover"
          style={photoStyle}
        />
      </div>
    )
  }

  // 退回 SVG
  if (Scene) return <Scene className={className} />

  return (
    <Frame sceneKey="unknown-scene" label="暂无插图" className={className}>
      <rect x="0" y="0" width="400" height="300" fill="#fdf6e8" />
      <Panel x={116} y={76} w={168} h={148} r={22} fill="#ffffff" stroke="#e2d3b8" sw={4} />
      <path
        d="M170,130 q0,-30 26,-30 q26,0 26,26 q0,20 -22,24 q-4,1 -4,12"
        fill="none"
        stroke="#c9c2b4"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <circle cx="196" cy="184" r="6.5" fill="#c9c2b4" />
      <Sparkle x={74} y={70} r={11} color="#f2e3c6" />
      <Sparkle x={332} y={222} r={13} color="#f2e3c6" />
      <Sparkle x={62} y={232} r={8} color="#f2e3c6" opacity={0.8} />
    </Frame>
  )
}

/**
 * 渲染一道题的配图。
 *
 * 存在的意义只有一个：**所有地方都从这一个口子出图**。
 * 之前写作台、题库缩略图、题库预览各自拼 `<SceneArt sceneKey={...}/>`，
 * 一加 `imageUrl` 就得改三处，漏一处就出现「写作台有图、题库里没图」。
 */
export function PromptImageArt({
  image,
  className,
}: {
  image?: PromptImage
  className?: string
}): React.ReactElement {
  return (
    <SceneArt
      sceneKey={image?.sceneKey}
      imageUrl={image?.imageUrl}
      className={className}
    />
  )
}

/**
 * 配图下方的说明文字。
 *
 * 优先用题里手写的 caption；没写就用 sceneKey 的中文标签；
 * 再没有就返回 fallback（多图时调用方传「第 N 幅」）。
 */
export function promptImageCaption(
  image: { sceneKey?: string; caption?: string },
  fallback = '',
): string {
  if (image.caption) return image.caption
  if (image.sceneKey) return sceneMeta(image.sceneKey)?.label ?? fallback
  return fallback
}

