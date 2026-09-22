/* ============================================================
   二次元角色立绘 —— 纯 SVG 渲染
   ============================================================
   为什么不用图片：APK 要离线、要小，40 张卡如果都用位图，
   体积和风格一致性都崩。所以角色 = 一组参数，
   由这个组件在运行时画出来。任何一张卡都不需要网络和资源文件。

   几条铁律（踩过坑，别改）：
     · <svg> 上不许写 width/height 属性。
       传 height="auto" 会被 React 当成非法值报错，
       尺寸一律交给外层容器的 100% / 100%。
     · 所有 <defs> 的 id 必须带 uid 前缀。
       一页上会同时挂十几张卡，id 撞了会让 A 卡的渐变
       串到 B 卡身上（而且只在多卡同屏时才出现，很难查）。
     · 不许用 Math.random()。同一个 uid 必须每次渲染完全一样，
       否则 React 重渲染时装饰会跳动。随机感用 mulberry32 种子伪随机。
     · 全部是 props 的纯函数：无 state、无 effect、无定时器。
   ============================================================ */

import type { JSX, ReactNode } from 'react'
import type { Backdrop, CharacterSpec, Expression } from '../domain/character'
import { DEFAULT_SKIN, LINE } from '../domain/character'

/* ============================================================
   颜色工具
   ------------------------------------------------------------
   卡面配色来自参数，深浅要现场算：暗部、亮部、描边、
   半透明光斑……都从主色推导，保证任意配色都自洽。
   解析失败时原样返回，绝不抛异常（画不出来总比崩了好）。
   ============================================================ */

/** 解析 #rgb / #rrggbb；解析不了返回 null */
function parseHex(c: string): [number, number, number] | null {
  const s = c.trim().replace(/^#/, '')
  const to = (h: string) => parseInt(h, 16)
  if (s.length === 3) {
    const r = to(s[0] + s[0])
    const g = to(s[1] + s[1])
    const b = to(s[2] + s[2])
    return Number.isNaN(r + g + b) ? null : [r, g, b]
  }
  if (s.length === 6) {
    const r = to(s.slice(0, 2))
    const g = to(s.slice(2, 4))
    const b = to(s.slice(4, 6))
    return Number.isNaN(r + g + b) ? null : [r, g, b]
  }
  return null
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
}

/** 线性混色，t=0 取 a，t=1 取 b */
function mix(a: string, b: string, t: number): string {
  const pa = parseHex(a)
  const pb = parseHex(b)
  if (!pa || !pb) return a
  return `#${toHex(pa[0] + (pb[0] - pa[0]) * t)}${toHex(pa[1] + (pb[1] - pa[1]) * t)}${toHex(
    pa[2] + (pb[2] - pa[2]) * t,
  )}`
}

function lighten(c: string, t: number): string {
  return mix(c, '#ffffff', t)
}

function darken(c: string, t: number): string {
  return mix(c, '#000000', t)
}

/** 转成 rgba，用于背景光斑、腮红这类需要透明度的填充 */
function alpha(c: string, a: number): string {
  const p = parseHex(c)
  if (!p) return c
  return `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${a})`
}

/** 相对亮度：用来判断"这个颜色是不是暗到需要提亮" */
function luminance(c: string): number {
  const p = parseHex(c)
  if (!p) return 0.5
  return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255
}

/* ============================================================
   确定性伪随机
   ------------------------------------------------------------
   背景的星星 / 花瓣要"看起来随机"，但同一张卡每次都得一样。
   用 uid 做种子，输出与渲染次数、并发顺序都无关。
   ============================================================ */

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ============================================================
   版面常量 —— 全部按 0 0 200 240 的画布标定
   ============================================================ */

/** 脸的中轴 */
const CX = 100
/** 眼睛中心线的高度 */
const EYE_Y = 116
/** 眼睛中心到中轴的距离（左右眼分别在 75 / 125） */
const EYE_DX = 25

/** 脸型：额头饱满、下巴收尖，二次元的标准头骨 */
const FACE_PATH = [
  'M 100 55',
  'C 128 55 143 75 143 100',
  'C 143 116 138 129 128 141',
  'C 120 151 111 158 100 158',
  'C 89 158 80 151 72 141',
  'C 62 129 57 116 57 100',
  'C 57 75 72 55 100 55',
  'Z',
].join(' ')

/** 脖子：上端藏在脸后面，下端插进领口（多留一截，免得领口下沿露缝）
 *  刻意收窄（上口 20、下口 28）—— 之前 24→36 太粗，
 *  整个人像插在一根柱子上，是"廉价剪贴画"的主要来源。 */
const NECK_PATH = 'M 90 140 C 90 156 89 168 86 184 L 114 184 C 111 168 110 156 110 140 Z'

/** 肩胸：从领口向两侧铺开，到画布底部撑满。
 *  关键：肩膀要尽早变宽、并冲出画布左右边界（10 / 190），
 *  这样剪影是"肩膀"而不是一个从脖子直接收到底的三角板。 */
const BODY_PATH = [
  'M 100 160',
  'C 90 160 83 164 77 169',
  'C 48 178 22 192 14 214',
  'L 10 240',
  'L 190 240',
  'L 186 214',
  'C 178 192 152 178 123 169',
  'C 117 164 110 160 100 160',
  'Z',
].join(' ')

/* ============================================================
   表情 → 五官参数
   ------------------------------------------------------------
   表情不是"换个嘴"就完事：眼裂高度、上眼睑下压、外眼角
   倾斜、瞳孔视线、眉毛角度、腮红浓度都要一起变，
   这样一眼就能认出是哪个表情。
   ============================================================ */

type MouthKind = 'soft' | 'bigSmile' | 'flat' | 'firm' | 'tiny' | 'o'

interface ExprCfg {
  /** 眼裂半高：越大眼睛越圆 */
  open: number
  /** 上眼睑额外下压量，做出"半睁"的慵懒感 */
  lid: number
  /** 眼型倾斜：正 = 外眼角上扬（锐利），负 = 外眼角下垂（温柔） */
  tilt: number
  /** 瞳孔偏移 [x, y]，用来做"看旁边 / 看下方" */
  gaze: [number, number]
  /** 腮红强度 0-1 */
  blush: number
  /** 眉毛整体倾斜：正 = 眉尾压向眉心（认真/生气） */
  browTilt: number
  /** 左右眉抬升 [左, 右]，curious 用来做"挑眉" */
  browLift: [number, number]
  /** 眉毛弯度 */
  browArch: number
  mouth: MouthKind
}

const EXPR: Record<Expression, ExprCfg> = {
  // 柔和：眼睛略收，下眼睑上弯，外眼角微微下垂
  smile: { open: 12.2, lid: 0.6, tilt: -3, gaze: [0, 0], blush: 0.5, browTilt: -1, browLift: [0, 0], browArch: 3.4, mouth: 'soft' },
  // 开朗：眼睛最大，笑到张嘴，腮红最重
  bright: { open: 14.2, lid: 0, tilt: 0, gaze: [0, -0.6], blush: 0.85, browTilt: -2, browLift: [1.5, 1.5], browArch: 4.2, mouth: 'bigSmile' },
  // 平静：上眼睑压到一半，嘴是一条小直线
  calm: { open: 12.6, lid: 4.4, tilt: 0, gaze: [0, 0], blush: 0.28, browTilt: 0, browLift: [0, 0], browArch: 2.6, mouth: 'flat' },
  // 认真：眼裂收窄 + 外眼角上扬，眉尾压向眉心
  determined: { open: 10.6, lid: 1.8, tilt: 5.5, gaze: [0, -0.5], blush: 0.22, browTilt: 5.2, browLift: [-1.4, -1.4], browArch: 1.6, mouth: 'firm' },
  // 害羞：视线朝下偏左，腮红很重，嘴角小小地抿着
  shy: { open: 11.4, lid: 1.6, tilt: -4, gaze: [-2.6, 2.8], blush: 0.95, browTilt: -4, browLift: [0.8, 0.8], browArch: 3.8, mouth: 'tiny' },
  // 好奇：眼睛睁大、视线朝上，左眉挑起来，嘴成小圆
  curious: { open: 13.6, lid: 0, tilt: 1.5, gaze: [-0.8, -3.2], blush: 0.4, browTilt: -1, browLift: [4.6, -0.6], browArch: 4.6, mouth: 'o' },
  // 酷：眼睛细长锐利，嘴抿平，没有腮红。
  // lid 不能给太大，否则眼睛被上睫毛盖住，看起来像睡着了。
  cool: { open: 12.6, lid: 1.2, tilt: 4, gaze: [0, 0], blush: 0, browTilt: 3.4, browLift: [-0.6, -0.6], browArch: 1.8, mouth: 'flat' },
}

/* ============================================================
   眼睛几何
   ------------------------------------------------------------
   单只眼按"右眼中心 = (125, 116)"画，左眼用
   translate(200 0) scale(-1 1) 镜像 —— 保证外眼角
   在两侧都朝外，不会出现"斗鸡眼"。
   ============================================================ */

/** 眼裂外形 */
function eyeOutline(cx: number, cy: number, open: number, lid: number): string {
  const top = cy - open + lid
  const bot = cy + open * 0.86 + lid * 0.22
  return [
    `M ${cx - 12} ${cy + 2}`,
    `C ${cx - 11.2} ${top + open * 0.24} ${cx - 5} ${top} ${cx + 1.5} ${top}`,
    `C ${cx + 8.4} ${top} ${cx + 12.6} ${cy - open * 0.62} ${cx + 13} ${cy - 3}`,
    `C ${cx + 13.7} ${bot - open * 0.3} ${cx + 8} ${bot} ${cx + 0.5} ${bot}`,
    `C ${cx - 6.6} ${bot} ${cx - 12} ${cy + 9.6} ${cx - 12} ${cy + 2}`,
    'Z',
  ].join(' ')
}

/** 上睫毛：压在眼裂上沿，比眼裂更粗、更靠外 */
function lashLine(cx: number, cy: number, open: number, lid: number): string {
  const top = cy - open + lid
  return [
    `M ${cx - 12.6} ${cy + 3.2}`,
    `C ${cx - 11.4} ${top + open * 0.16} ${cx - 5.2} ${top - 1.7} ${cx + 1.5} ${top - 1.7}`,
    `C ${cx + 8.6} ${top - 1.7} ${cx + 12.9} ${cy - open * 0.6} ${cx + 13.3} ${cy - 3.4}`,
  ].join(' ')
}

/** 外眼角上挑的睫毛尖，用填充而不是描边，才有"甩出去"的尖 */
function lashFlick(cx: number, cy: number): string {
  return [
    `M ${cx + 10.6} ${cy - 7}`,
    `C ${cx + 14.2} ${cy - 10.6} ${cx + 17.4} ${cy - 12.8} ${cx + 21} ${cy - 13.6}`,
    `C ${cx + 18} ${cy - 10} ${cx + 15.2} ${cy - 6.2} ${cx + 13.6} ${cy - 2.4}`,
    `C ${cx + 12.4} ${cy - 4.6} ${cx + 11.2} ${cy - 5.9} ${cx + 10.6} ${cy - 7}`,
    'Z',
  ].join(' ')
}

/* ============================================================
   镜像小工具
   ============================================================ */

/** 把一段只画了左半边的图形翻到右半边（以 x=100 为轴） */
function Mirrored({ children }: { children: ReactNode }) {
  return <g transform="translate(200 0) scale(-1 1)">{children}</g>
}

/* ============================================================
   主组件
   ============================================================ */

interface ArtProps {
  spec: CharacterSpec
  uid: string
  viewBox: string
  className?: string
  label: string
}

function Art({ spec, uid, viewBox, className, label }: ArtProps): JSX.Element {
  const skin = spec.skin ?? DEFAULT_SKIN
  const skinShade = darken(skin, 0.13)
  const skinDeep = darken(skin, 0.26)

  const hair0 = spec.hairColor[0]
  const hair1 = spec.hairColor[1]
  const hairLight = lighten(hair0, 0.4)
  const hairDeep = darken(hair1, 0.3)

  const outfit0 = spec.outfitColor[0]
  const outfit1 = spec.outfitColor[1]
  const outfitLight = lighten(outfit0, 0.3)
  const outfitDeep = darken(outfit1, 0.22)

  const eyeColor = spec.eyeColor
  const eyeDeep = darken(eyeColor, 0.45)
  const eyeLight = lighten(eyeColor, 0.5)

  // 眉毛跟发色走，但深色头发上必须提亮 —— 否则"挑眉 / 压眉"这些
  // 表情提示会直接糊进头发里，白画了。
  const browColor = luminance(hair1) < 0.3 ? lighten(hair1, 0.36) : darken(hair1, 0.12)

  const bg0 = spec.bg[0]
  const bg1 = spec.bg[1]
  const backdrop: Backdrop = spec.backdrop ?? 'soft'

  const ex = EXPR[spec.expression]

  // 一次性取足随机数，避免"按调用顺序取"导致结构变化时结果漂移
  const rnd = mulberry32(hashSeed(uid))
  const rand: number[] = []
  for (let i = 0; i < 64; i += 1) rand.push(rnd())

  return (
    <svg
      viewBox={viewBox}
      className={className}
      preserveAspectRatio="xMidYMid slice"
      style={{ width: '100%', height: '100%', display: 'block' }}
      role="img"
      aria-label={label}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0%" stopColor={bg0} />
          <stop offset="100%" stopColor={bg1} />
        </linearGradient>

        {/* 头后的柔光：让角色从背景里"浮"出来 */}
        <radialGradient id={`${uid}-glow`} cx="50%" cy="46%" r="52%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>

        {/* 头发：主色 + 暗部。顶光只给一点点，大面积提亮会把发色冲淡 */}
        <linearGradient id={`${uid}-hair`} x1="0.15" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor={lighten(hair0, 0.2)} />
          <stop offset="38%" stopColor={hair0} />
          <stop offset="100%" stopColor={hair1} />
        </linearGradient>

        <linearGradient id={`${uid}-skin`} x1="0.2" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor={lighten(skin, 0.16)} />
          <stop offset="62%" stopColor={skin} />
          <stop offset="100%" stopColor={skinShade} />
        </linearGradient>

        <linearGradient id={`${uid}-outfit`} x1="0.1" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor={outfitLight} />
          <stop offset="40%" stopColor={outfit0} />
          <stop offset="100%" stopColor={outfit1} />
        </linearGradient>

        {/* 虹膜：上深下亮，是二次元眼睛"发光"的关键 */}
        <linearGradient id={`${uid}-iris`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={eyeDeep} />
          <stop offset="46%" stopColor={eyeColor} />
          <stop offset="100%" stopColor={eyeLight} />
        </linearGradient>

        <radialGradient id={`${uid}-blush`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f2708f" stopOpacity="0.62" />
          <stop offset="62%" stopColor="#f2708f" stopOpacity="0.24" />
          <stop offset="100%" stopColor="#f2708f" stopOpacity="0" />
        </radialGradient>

        {/* 眼部裁剪：虹膜只能在眼裂里，左右各一份 */}
        <clipPath id={`${uid}-eyeR`}>
          <path d={eyeOutline(CX + EYE_DX, EYE_Y, ex.open, ex.lid)} />
        </clipPath>
        <clipPath id={`${uid}-eyeL`}>
          <path
            d={eyeOutline(CX + EYE_DX, EYE_Y, ex.open, ex.lid)}
            transform="translate(200 0) scale(-1 1)"
          />
        </clipPath>
        {/* 身体裁剪：服装细节不许画出身体轮廓外 */}
        <clipPath id={`${uid}-body`}>
          <path d={BODY_PATH} />
        </clipPath>
      </defs>

      {/* 1 · 背景 */}
      <BackdropLayer uid={uid} backdrop={backdrop} rand={rand} />
      <circle cx={CX} cy={112} r={92} fill={`url(#${uid}-glow)`} />

      {/* 2 · 后发（画在身体之前，长发就会自然落在肩后） */}
      <BackHair style={spec.hair} hair1={hair1} hairDeep={hairDeep} uid={uid} />

      {/* 3 · 衣服的后层：兜帽、斗篷、护肩 */}
      <OutfitBack
        style={spec.outfit}
        outfit0={outfit0}
        outfit1={outfit1}
        outfitLight={outfitLight}
        accent={spec.accentColor}
      />

      {/* 4 · 身体 */}
      <path d={BODY_PATH} fill={`url(#${uid}-outfit)`} stroke={LINE} strokeWidth="2" />

      {/* 5 · 脖子（先画脖子，再画领口，领子才能"包住"脖子根） */}
      <path d={NECK_PATH} fill={skinShade} stroke={LINE} strokeWidth="1.8" strokeLinejoin="round" />
      <path
        d="M 88 140 C 92 152 108 152 112 140 L 112 148 C 106 156 94 156 88 148 Z"
        fill={skinDeep}
        opacity="0.55"
      />

      {/* 6 · 衣服前层：领子、翻领、腰带、胸甲 */}
      <OutfitFront
        uid={uid}
        style={spec.outfit}
        outfit0={outfit0}
        outfit1={outfit1}
        outfitDeep={outfitDeep}
        outfitLight={outfitLight}
        accent={spec.accentColor}
      />

      {/* 7 · 脸 */}
      <path d={FACE_PATH} fill={`url(#${uid}-skin)`} stroke={LINE} strokeWidth="1.8" />
      {/* 耳朵：大部分会被侧发盖住，露出一点点才有立体感 */}
      <g>
        <ellipse cx={141} cy={116} rx={5.4} ry={8.2} fill={skin} stroke={LINE} strokeWidth="1.4" />
        <ellipse cx={140.6} cy={116} rx={2.2} ry={4.2} fill={skinShade} opacity="0.7" />
        <Mirrored>
          <ellipse cx={141} cy={116} rx={5.4} ry={8.2} fill={skin} stroke={LINE} strokeWidth="1.4" />
          <ellipse cx={140.6} cy={116} rx={2.2} ry={4.2} fill={skinShade} opacity="0.7" />
        </Mirrored>
      </g>

      {/* 8 · 五官 */}
      <Face uid={uid} ex={ex} skinShade={skinShade} eyeDeep={eyeDeep} eyeLight={eyeLight} />

      {/* 9 · 头顶配饰：兽角 / 猫耳，画在刘海之前，发丝会盖住它们的根部 */}
      <HeadwearBack accent={spec.accentColor} accentStyle={spec.accent} />

      {/* 10 · 前发：刘海 + 侧发 */}
      <FrontHair
        hair={spec.hair}
        bangs={spec.bangs}
        uid={uid}
        hair1={hair1}
        hairLight={hairLight}
        hairDeep={hairDeep}
      />

      {/* 11 · 眉毛画在头发之上 —— 二次元常见处理，也让表情能被看见 */}
      <Brows ex={ex} color={browColor} />

      {/* 12 · 面部前方的配饰：眼镜、耳机、帽子、发带、耳饰 */}
      <HeadwearFront accentStyle={spec.accent} accent={spec.accentColor} />
    </svg>
  )
}

/* ============================================================
   背景
   ============================================================ */

function BackdropLayer({
  uid,
  backdrop,
  rand,
}: {
  uid: string
  backdrop: Backdrop
  rand: number[]
}) {
  const r = (i: number) => rand[i % rand.length]

  return (
    <g>
      <rect x="0" y="0" width="200" height="240" fill={`url(#${uid}-bg)`} />

      {backdrop === 'burst' && (
        <g opacity="0.5">
          {Array.from({ length: 20 }, (_, i) => (
            <path
              key={i}
              d="M 100 116 L 86 -80 L 114 -80 Z"
              fill="#ffffff"
              opacity={i % 2 === 0 ? 0.5 : 0.24}
              transform={`rotate(${i * 18} 100 116)`}
            />
          ))}
        </g>
      )}

      {backdrop === 'night' && (
        <g>
          {Array.from({ length: 26 }, (_, i) => {
            const x = 8 + r(i * 2) * 184
            const y = 6 + r(i * 2 + 1) * 200
            const s = 0.9 + r(i * 3) * 1.7
            return <circle key={i} cx={x} cy={y} r={s} fill="#ffffff" opacity={0.35 + r(i) * 0.5} />
          })}
          {Array.from({ length: 5 }, (_, i) => {
            const x = 20 + r(i * 5) * 160
            const y = 14 + r(i * 5 + 1) * 120
            return (
              <path
                key={`sp-${i}`}
                d={`M ${x} ${y - 7} L ${x + 1.7} ${y - 1.7} L ${x + 7} ${y} L ${x + 1.7} ${y + 1.7} L ${x} ${y + 7} L ${x - 1.7} ${y + 1.7} L ${x - 7} ${y} L ${x - 1.7} ${y - 1.7} Z`}
                fill="#ffffff"
                opacity="0.8"
              />
            )
          })}
        </g>
      )}

      {backdrop === 'sakura' && (
        <g>
          {Array.from({ length: 14 }, (_, i) => {
            const x = 6 + r(i * 2) * 188
            const y = 4 + r(i * 2 + 1) * 224
            const rot = r(i * 3) * 360
            const s = 0.75 + r(i * 4) * 0.8
            return (
              <path
                key={i}
                d="M 0 0 C 4.2 -3.4 9 0.4 7.4 4.6 C 6.2 7.8 2 9 -0.6 6.4 C -2.6 4.2 -2.2 1.4 0 0 Z"
                fill="#f288ab"
                opacity="0.9"
                transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}
              />
            )
          })}
        </g>
      )}

      {backdrop === 'bubble' && (
        <g>
          {Array.from({ length: 13 }, (_, i) => {
            const x = 6 + r(i * 2) * 188
            const y = 6 + r(i * 2 + 1) * 220
            const s = 4 + r(i * 3) * 13
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={s} fill="#ffffff" opacity="0.16" />
                <circle
                  cx={x}
                  cy={y}
                  r={s}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="1.1"
                  opacity="0.42"
                />
                <circle cx={x - s * 0.32} cy={y - s * 0.36} r={s * 0.2} fill="#ffffff" opacity="0.6" />
              </g>
            )
          })}
        </g>
      )}

      {backdrop === 'ray' && (
        <g opacity="0.42">
          {Array.from({ length: 6 }, (_, i) => (
            <path
              key={i}
              d={`M ${-70 + i * 46} 250 L ${26 + i * 46} -10 L ${56 + i * 46} -10 L ${-40 + i * 46} 250 Z`}
              fill="#ffffff"
              opacity={i % 2 === 0 ? 0.42 : 0.2}
            />
          ))}
        </g>
      )}
    </g>
  )
}

/* ============================================================
   后发 —— 每种发型必须给出完全不同的剪影
   ============================================================ */

function BackHair({
  style,
  hair1,
  hairDeep,
  uid,
}: {
  style: CharacterSpec['hair']
  hair1: string
  hairDeep: string
  uid: string
}) {
  const paint = `url(#${uid}-hair)`

  switch (style) {
    /* 长直发：一直垂到画布底部，两侧比肩膀更宽，形成外轮廓 */
    case 'long':
      return (
        <path
          d="M 100 34 C 132 34 158 58 160 96 C 163 128 172 178 186 240 L 14 240 C 28 178 37 128 40 96 C 42 58 68 34 100 34 Z"
          fill={paint}
          stroke={LINE}
          strokeWidth="2"
        />
      )

    /* 长卷发：侧边做出深波浪，一眼区别于长直发 */
    case 'wave':
      return (
        <path
          d="M 100 34 C 132 34 158 58 160 96 C 174 112 146 132 164 150 C 180 166 150 190 166 208 C 178 224 186 234 192 240 L 8 240 C 14 234 22 224 34 208 C 50 190 20 166 36 150 C 54 132 26 112 40 96 C 42 58 68 34 100 34 Z"
          fill={paint}
          stroke={LINE}
          strokeWidth="2"
        />
      )

    /* 双马尾：后脑一个贴合的罩子；辫尾在前层画（见 FrontHair），
       否则会被肩膀盖住，只剩耳朵旁边两团，认不出是马尾 */
    case 'twin':
      return (
        <path
          d="M 100 36 C 134 36 164 62 165 100 C 166 124 158 144 148 156 L 52 156 C 42 144 34 124 35 100 C 36 62 66 36 100 36 Z"
          fill={paint}
          stroke={LINE}
          strokeWidth="2"
        />
      )

    /* 波波头：圆润地收到下颌线，发尾微微内扣 */
    case 'bob':
      return (
        <path
          d="M 100 36 C 136 36 166 62 167 100 C 168 126 162 148 150 164 C 142 174 128 180 100 180 C 72 180 58 174 50 164 C 38 148 32 126 33 100 C 34 62 64 36 100 36 Z"
          fill={paint}
          stroke={LINE}
          strokeWidth="2"
        />
      )

    /* 高马尾：后脑留得短，一条尾巴从头顶甩向右后方，尾尖有明显的收口 */
    case 'ponytail':
      return (
        <g>
          <path
            d="M 100 36 C 134 36 164 62 165 100 C 166 120 160 138 150 152 L 50 152 C 40 138 34 120 35 100 C 36 62 66 36 100 36 Z"
            fill={paint}
            stroke={LINE}
            strokeWidth="2"
          />
          <path
            d="M 114 52 C 136 28 168 24 184 40 C 195 52 191 76 175 94 C 180 70 173 52 157 46 C 143 40 126 46 114 52 Z"
            fill={paint}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <ellipse cx={120} cy={56} rx={9} ry={6.5} fill={hairDeep} transform="rotate(38 120 56)" />
        </g>
      )

    /* 双丸子：左右两个圆球，剪影最圆最"甜" */
    case 'buns':
      return (
        <g>
          <path
            d="M 100 44 C 134 44 162 68 163 104 C 164 124 158 140 148 152 L 52 152 C 42 140 36 124 37 104 C 38 68 66 44 100 44 Z"
            fill={paint}
            stroke={LINE}
            strokeWidth="2"
          />
          <circle cx={60} cy={40} r={17} fill={paint} stroke={LINE} strokeWidth="2" />
          <circle cx={140} cy={40} r={17} fill={paint} stroke={LINE} strokeWidth="2" />
          {/* 丸子上的暗部，避免变成两个死平的圆 */}
          <path d="M 50 32 C 56 24 66 22 72 26 C 64 26 56 30 52 36 Z" fill={hair1} opacity="0.55" />
          <Mirrored>
            <path d="M 50 32 C 56 24 66 22 72 26 C 64 26 56 30 52 36 Z" fill={hair1} opacity="0.55" />
          </Mirrored>
          <ellipse cx={66} cy={53} rx={8} ry={4.5} fill={hairDeep} transform="rotate(-18 66 53)" />
          <Mirrored>
            <ellipse cx={66} cy={53} rx={8} ry={4.5} fill={hairDeep} transform="rotate(-18 66 53)" />
          </Mirrored>
        </g>
      )

    /* 短发：贴着后脑收在颌线以上，剪影最紧凑（要和波波头拉开差别） */
    case 'short':
      return (
        <path
          d="M 100 36 C 134 36 164 62 165 100 C 166 118 161 134 152 146 C 148 132 144 120 140 110 C 130 122 116 128 100 128 C 84 128 70 122 60 110 C 56 120 52 132 48 146 C 39 134 34 118 35 100 C 36 62 66 36 100 36 Z"
          fill={paint}
          stroke={LINE}
          strokeWidth="2"
        />
      )

    /* 侧编发：左边垂一条辫子，用交错的椭圆做出"编"的节奏 */
    case 'braid':
      return (
        <g>
          <path
            d="M 100 36 C 134 36 164 62 165 100 C 166 122 158 140 146 152 L 54 152 C 42 140 34 122 35 100 C 36 62 66 36 100 36 Z"
            fill={paint}
            stroke={LINE}
            strokeWidth="2"
          />
          {Array.from({ length: 11 }, (_, i) => {
            const y = 98 + i * 13
            const x = 48 - i * 1.1
            const rx = 13 - i * 0.7
            return (
              <ellipse
                key={i}
                cx={x}
                cy={y}
                rx={rx}
                ry={10.5 - i * 0.55}
                fill={paint}
                stroke={LINE}
                strokeWidth="1.5"
                transform={`rotate(${i % 2 === 0 ? -18 : 18} ${x} ${y})`}
              />
            )
          })}
          <ellipse cx={38} cy={236} rx={7} ry={5} fill={hairDeep} />
        </g>
      )

    /* 姬发式：背后一整片直发，底部一刀平 */
    case 'hime':
      return (
        <path
          d="M 100 36 C 138 36 168 62 170 100 C 173 142 175 192 175 240 L 25 240 C 25 192 27 142 30 100 C 32 62 62 36 100 36 Z"
          fill={paint}
          stroke={LINE}
          strokeWidth="2"
        />
      )

    /* 刺猬头：长短交错的尖角。
       注意别把尖角铺满整个画布 —— 那样剪影会变成一个"黑色太阳"，
       完全不像头发。尖角只从颅顶向外伸出 55~78，收敛在 x 22~178 内。 */
    case 'spiky':
      return (
        <path
          d="M 100 16 L 118 34 L 146 26 L 150 52 L 174 62 L 164 86 L 178 104 L 158 116 L 168 138 L 142 136 L 140 156 L 120 142 L 112 158 L 100 146 L 88 158 L 80 142 L 60 156 L 58 136 L 32 138 L 42 116 L 22 104 L 36 86 L 26 62 L 50 52 L 54 26 L 82 34 Z"
          fill={paint}
          stroke={LINE}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      )

    default:
      return null
  }
}

/* ============================================================
   前发 —— 刘海（bangs）+ 侧发（由发型决定长度）
   ============================================================ */

/** 刘海：四种完全不同的分法 */
function BangsShape({ bangs, paint }: { bangs: CharacterSpec['bangs']; paint: string }) {
  // 齐刘海 / 公主切的罩子：底边必须停在眼睛上方（眼睛上睫毛约在 y=98），
  // 压过 98 就会把眼睑吃掉，整张脸立刻变"没睡醒"。
  const DOME =
    'M 50 104 C 50 62 72 36 100 36 C 128 36 150 62 150 104 C 150 108 148 110 146 111 C 143 98 140 92 136 89 C 130 93 120 95 100 95 C 80 95 70 93 64 89 C 60 92 57 98 54 111 C 52 110 50 108 50 104 Z'

  switch (bangs) {
    /* 齐刘海：额前一整片，最"乖" */
    case 'straight':
      return (
        <path
          d={DOME}
          fill={paint}
          stroke={LINE}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      )

    /* 中分：两片从头顶往两侧铺开，到额头才分开，中间留一个窄 V */
    case 'split':
      return (
        <g>
          <path
            d="M 100 36 C 76 40 56 54 48 78 C 43 96 43 116 48 134 C 58 122 66 112 74 104 C 84 94 92 78 96 60 C 98 50 99 42 100 36 Z"
            fill={paint}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <Mirrored>
            <path
              d="M 100 36 C 76 40 56 54 48 78 C 43 96 43 116 48 134 C 58 122 66 112 74 104 C 84 94 92 78 96 60 C 98 50 99 42 100 36 Z"
              fill={paint}
              stroke={LINE}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </Mirrored>
        </g>
      )

    /* 斜刘海：不对称，底边从左上斜到右上，一眼看出是"扫过去"的 */
    case 'side':
      return (
        <g>
          <path
            d="M 152 100 C 154 60 132 34 100 34 C 74 34 57 50 53 74 C 50 90 55 108 66 122 C 68 106 73 92 81 82 C 92 70 106 65 120 69 C 138 75 148 88 152 100 Z"
            fill={paint}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* 顺着扫势画一道亮痕，加强方向感 */}
          <path
            d="M 132 48 C 108 54 88 68 76 86 C 68 98 63 110 61 122"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.4"
            strokeLinecap="round"
            opacity="0.22"
          />
        </g>
      )

    /* 公主切：头顶一个罩子，两侧各垂一条长帘（帘子贴脸外侧，不挡眼睛） */
    case 'curtain':
      return (
        <g>
          <path
            d={DOME}
            fill={paint}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M 84 44 C 70 54 60 74 56 100 C 52 128 50 158 52 188 C 54 206 58 218 62 226 C 58 198 56 170 58 144 C 60 116 66 92 76 76 C 80 68 83 54 84 44 Z"
            fill={paint}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <Mirrored>
            <path
              d="M 84 44 C 70 54 60 74 56 100 C 52 128 50 158 52 188 C 54 206 58 218 62 226 C 58 198 56 170 58 144 C 60 116 66 92 76 76 C 80 68 83 54 84 44 Z"
              fill={paint}
              stroke={LINE}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </Mirrored>
        </g>
      )

    default:
      return null
  }
}

/** 侧发：同一顶刘海配不同长度的侧发，剪影才会真的不一样 */
function SideLocks({
  hair,
  paint,
  hair1,
  hairDeep,
  uid,
}: {
  hair: CharacterSpec['hair']
  paint: string
  hair1: string
  hairDeep: string
  uid: string
}) {
  // 长侧发：垂过肩膀
  const LONG =
    'M 56 74 C 46 96 42 124 42 152 C 42 180 44 206 48 230 L 50 244 L 72 244 C 67 218 64 192 64 164 C 64 136 68 108 76 86 C 71 80 64 76 56 74 Z'
  // 波浪侧发：外缘是波浪
  const WAVE =
    'M 56 74 C 44 96 40 124 42 152 C 44 174 38 190 44 210 C 48 224 50 234 52 244 L 74 244 C 70 226 74 210 70 194 C 66 174 68 148 66 124 C 65 104 70 90 76 86 C 71 80 64 76 56 74 Z'
  // 及颌侧发（波波头）
  const BOB =
    'M 56 74 C 44 96 40 122 42 146 C 43 158 47 168 53 172 C 50 158 50 142 52 126 C 55 106 62 90 72 78 C 66 76 60 75 56 74 Z'
  // 短发侧发：只到颧骨
  const SHORT =
    'M 58 76 C 47 92 43 112 45 132 C 46 140 48 146 52 149 C 50 136 51 120 55 106 C 59 93 65 84 72 78 C 67 76 62 75 58 76 Z'
  // 姬发式侧发：笔直、发尾一刀切
  const HIME =
    'M 54 72 C 45 94 42 124 42 154 C 42 184 43 208 44 226 L 72 226 C 70 202 69 178 69 154 C 69 126 72 100 78 82 C 72 77 62 73 54 72 Z'

  const left = (() => {
    switch (hair) {
      case 'long':
        return LONG
      case 'wave':
        return WAVE
      case 'hime':
        return HIME
      case 'bob':
        return BOB
      case 'short':
      case 'spiky':
      case 'buns':
      case 'ponytail':
        return SHORT
      case 'twin':
        return BOB
      case 'braid':
        return SHORT
      default:
        return BOB
    }
  })()

  const long = hair === 'long' || hair === 'wave' || hair === 'hime'

  return (
    <g>
      {/* 暗部和发丝都必须裁在侧发轮廓里。
          不裁的话，短发时这条从 y=88 拉到 y=234 的暗部会露在衣服上，
          变成两条半透明的紫带子（踩过，很难查）。 */}
      <defs>
        <clipPath id={`${uid}-lockL`}>
          <path d={left} />
        </clipPath>
        <clipPath id={`${uid}-lockR`}>
          <path d={left} transform="translate(200 0) scale(-1 1)" />
        </clipPath>
      </defs>

      <path d={left} fill={paint} stroke={LINE} strokeWidth="2" strokeLinejoin="round" />
      <Mirrored>
        <path d={left} fill={paint} stroke={LINE} strokeWidth="2" strokeLinejoin="round" />
      </Mirrored>

      {/* 侧发内缘的暗部：让侧发和脸分开，不然会糊成一片 */}
      <g clipPath={`url(#${uid}-lockL)`}>
        <path
          d="M 62 92 C 58 116 58 142 60 168 C 61 190 63 214 65 234 L 60 234 C 57 212 55 188 55 164 C 55 136 57 110 62 88 Z"
          fill={hairDeep}
          opacity="0.5"
        />
      </g>
      <g clipPath={`url(#${uid}-lockR)`}>
        <path
          d="M 62 92 C 58 116 58 142 60 168 C 61 190 63 214 65 234 L 60 234 C 57 212 55 188 55 164 C 55 136 57 110 62 88 Z"
          fill={hairDeep}
          opacity="0.5"
        />
      </g>

      {/* 长发多画两条发丝，不然大面积单色很闷 */}
      {long && (
        <g stroke={hair1} strokeWidth="1.4" fill="none" opacity="0.75" strokeLinecap="round">
          <g clipPath={`url(#${uid}-lockL)`}>
            <path d="M 52 110 C 48 140 47 176 49 214" />
            <path d="M 66 100 C 62 132 61 168 62 206" />
          </g>
          <g clipPath={`url(#${uid}-lockR)`}>
            <path d="M 52 110 C 48 140 47 176 49 214" />
            <path d="M 66 100 C 62 132 61 168 62 206" />
          </g>
        </g>
      )}
    </g>
  )
}

function FrontHair({
  hair,
  bangs,
  uid,
  hair1,
  hairLight,
  hairDeep,
}: {
  hair: CharacterSpec['hair']
  bangs: CharacterSpec['bangs']
  uid: string
  hair1: string
  hairLight: string
  hairDeep: string
}) {
  const paint = `url(#${uid}-hair)`

  return (
    <g>
      {/* 双马尾的辫尾放在前层，才能真的垂到肩膀上 */}
      {hair === 'twin' && (
        <g>
          <path
            d="M 52 76 C 24 88 10 118 8 154 C 6 186 14 212 28 232 C 22 202 22 172 30 146 C 36 124 46 98 52 76 Z"
            fill={paint}
            stroke={LINE}
            strokeWidth="2"
          />
          <Mirrored>
            <path
              d="M 52 76 C 24 88 10 118 8 154 C 6 186 14 212 28 232 C 22 202 22 172 30 146 C 36 124 46 98 52 76 Z"
              fill={paint}
              stroke={LINE}
              strokeWidth="2"
            />
          </Mirrored>
          {/* 扎发处的发圈 */}
          <ellipse cx={52} cy={82} rx={9.5} ry={7} fill={hairDeep} transform="rotate(-24 52 82)" />
          <Mirrored>
            <ellipse cx={52} cy={82} rx={9.5} ry={7} fill={hairDeep} transform="rotate(-24 52 82)" />
          </Mirrored>
        </g>
      )}

      <SideLocks hair={hair} paint={paint} hair1={hair1} hairDeep={hairDeep} uid={uid} />
      <BangsShape bangs={bangs} paint={paint} />

      {/* 高光：两道弧形反光，头发才有"亮面" */}
      <path
        d="M 66 74 C 78 56 122 56 134 74"
        fill="none"
        stroke="#ffffff"
        strokeWidth="7"
        strokeLinecap="round"
        opacity="0.22"
      />
      <path
        d="M 74 68 C 84 58 116 58 126 68"
        fill="none"
        stroke={hairLight}
        strokeWidth="3.4"
        strokeLinecap="round"
        opacity="0.85"
      />
      {/* 一小撮翘起来的呆毛，避免头顶太规整 */}
      <path
        d="M 104 40 C 112 28 124 26 132 32 C 122 32 112 36 106 44 Z"
        fill={paint}
        stroke={LINE}
        strokeWidth="1.6"
      />
    </g>
  )
}

/* ============================================================
   五官
   ============================================================ */

function Face({
  uid,
  ex,
  skinShade,
  eyeDeep,
  eyeLight,
}: {
  uid: string
  ex: ExprCfg
  skinShade: string
  eyeDeep: string
  eyeLight: string
}) {
  const cy = EYE_Y
  const cxR = CX + EYE_DX
  const outline = eyeOutline(cxR, cy, ex.open, ex.lid)
  const lash = lashLine(cxR, cy, ex.open, ex.lid)
  const flick = lashFlick(cxR, cy)

  // 虹膜随视线滑动，但裁剪仍在眼裂内
  const [gx, gy] = ex.gaze

  return (
    <g>
      {/* 鼻：二次元只要一点暗示，画多了立刻变写实、变丑 */}
      <path
        d="M 101 128.4 C 100.2 131 99.6 132.2 98.2 133"
        fill="none"
        stroke={skinShade}
        strokeWidth="1.9"
        strokeLinecap="round"
        opacity="0.9"
      />

      {/* 腮红 */}
      {ex.blush > 0 && (
        <g opacity={ex.blush}>
          <ellipse cx={74} cy={127.5} rx={12} ry={6.4} fill={`url(#${uid}-blush)`} />
          <ellipse cx={126} cy={127.5} rx={12} ry={6.4} fill={`url(#${uid}-blush)`} />
          {/* 三道斜线是二次元腮红的"符号"，比纯渐变更可爱 */}
          <g stroke="#e8637f" strokeWidth="1.3" strokeLinecap="round" opacity="0.5">
            <path d="M 69 124 L 73 131" />
            <path d="M 74 123.4 L 78 130.4" />
            <path d="M 79 123.4 L 83 130.4" />
            <Mirrored>
              <path d="M 69 124 L 73 131" />
              <path d="M 74 123.4 L 78 130.4" />
              <path d="M 79 123.4 L 83 130.4" />
            </Mirrored>
          </g>
        </g>
      )}

      {/* 左右眼 */}
      {[0, 1].map((i) => {
        const mirrored = i === 1
        const realCx = mirrored ? 200 - cxR : cxR
        const clip = `url(#${uid}-eye${mirrored ? 'L' : 'R'})`
        return (
          <g key={i}>
            {/* 眼裂本体 + 睫毛（整体镜像，保证外眼角在两侧都朝外） */}
            <g
              transform={mirrored ? 'translate(200 0) scale(-1 1)' : undefined}
            >
              <g transform={`rotate(${-ex.tilt} ${cxR} ${cy})`}>
                <path d={outline} fill="#fdfaff" />
                {/* 上眼睑在眼球上的投影 */}
                <path
                  d={outline}
                  fill="none"
                  stroke={eyeDeep}
                  strokeWidth="1.3"
                  opacity="0.5"
                />
                <path
                  d={lash}
                  fill="none"
                  stroke={LINE}
                  strokeWidth="3.6"
                  strokeLinecap="round"
                />
                <path d={flick} fill={LINE} />
                {/* 下眼睑：细、淡，只用来收边 */}
                <path
                  d={`M ${cxR - 7.5} ${cy + 13.6} C ${cxR - 3} ${cy + 17.4} ${cxR + 4} ${cy + 17.4} ${cxR + 9.5} ${cy + 13.6}`}
                  fill="none"
                  stroke={LINE}
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  opacity="0.32"
                />
              </g>
            </g>

            {/* 虹膜：不镜像，视线方向才能左右一致 */}
            <g clipPath={clip}>
              <g transform={`rotate(${-ex.tilt} ${cxR} ${cy})`}>
                <ellipse
                  cx={realCx + gx}
                  cy={cy + gy}
                  rx={10.6}
                  ry={13.2}
                  fill={`url(#${uid}-iris)`}
                />
                <ellipse
                  cx={realCx + gx}
                  cy={cy + gy}
                  rx={10.6}
                  ry={13.2}
                  fill="none"
                  stroke={eyeDeep}
                  strokeWidth="1.6"
                  opacity="0.75"
                />
                {/* 放射状纹理：细节虽小，但眼睛的"贵"感全靠它 */}
                <g stroke={eyeDeep} strokeWidth="0.9" opacity="0.4" strokeLinecap="round">
                  {Array.from({ length: 10 }, (_, k) => {
                    const a = (k * 36 * Math.PI) / 180
                    const r0 = 6.2
                    const r1 = 10.2
                    return (
                      <path
                        key={k}
                        d={`M ${realCx + gx + Math.cos(a) * r0} ${cy + gy + Math.sin(a) * r0 * 1.2} L ${
                          realCx + gx + Math.cos(a) * r1
                        } ${cy + gy + Math.sin(a) * r1 * 1.2}`}
                      />
                    )
                  })}
                </g>
                {/* 虹膜下缘的内发光 */}
                <ellipse
                  cx={realCx + gx}
                  cy={cy + gy + 6.6}
                  rx={6.8}
                  ry={4.4}
                  fill={eyeLight}
                  opacity="0.55"
                />
                <ellipse cx={realCx + gx} cy={cy + gy} rx={4.9} ry={6.5} fill="#241a2e" />
                <ellipse
                  cx={realCx + gx}
                  cy={cy + gy + 1.8}
                  rx={3.3}
                  ry={3.8}
                  fill="#120c18"
                  opacity="0.85"
                />
              </g>
            </g>

            {/* 高光：主光在左上，副光在右下，位置不随视线大幅移动 */}
            <circle cx={realCx + gx * 0.35 - 5.2} cy={cy + gy * 0.35 - 6.4} r={3.8} fill="#ffffff" />
            <circle
              cx={realCx + gx * 0.35 + 5}
              cy={cy + gy * 0.35 + 5.8}
              r={1.9}
              fill="#ffffff"
              opacity="0.85"
            />
            <circle
              cx={realCx + gx * 0.35 + 3.4}
              cy={cy + gy * 0.35 - 9.4}
              r={1.15}
              fill="#ffffff"
              opacity="0.7"
            />
          </g>
        )
      })}

      {/* 嘴 */}
      <Mouth kind={ex.mouth} />
    </g>
  )
}

function Mouth({ kind }: { kind: MouthKind }) {
  switch (kind) {
    case 'soft':
      return (
        <g>
          <path
            d="M 92.5 139.4 Q 100 145.6 107.5 139.4"
            fill="none"
            stroke={LINE}
            strokeWidth="2.3"
            strokeLinecap="round"
          />
          <path d="M 96 146 Q 100 148.4 104 146" fill="none" stroke="#d98a94" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
        </g>
      )
    case 'bigSmile':
      return (
        <g>
          <path
            d="M 88 137.5 C 91 151.5 109 151.5 112 137.5 C 105.5 142 94.5 142 88 137.5 Z"
            fill="#6d2a3a"
            stroke={LINE}
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          {/* 舌头 */}
          <path d="M 94 145.5 C 97 149.6 103 149.6 106 145.5 C 102.5 147.8 97.5 147.8 94 145.5 Z" fill="#e8798d" />
          <path d="M 89 138.6 C 95 141.4 105 141.4 111 138.6" fill="none" stroke="#ffffff" strokeWidth="1.6" opacity="0.6" />
        </g>
      )
    case 'flat':
      return (
        <path
          d="M 94.5 140.8 L 105.5 140.8"
          fill="none"
          stroke={LINE}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )
    case 'firm':
      return (
        <g>
          <path
            d="M 92 141.4 L 108 141.4"
            fill="none"
            stroke={LINE}
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <path d="M 96 144.6 L 104 144.6" fill="none" stroke={LINE} strokeWidth="1" opacity="0.35" strokeLinecap="round" />
        </g>
      )
    case 'tiny':
      return (
        <path
          d="M 96 140.4 Q 100 144.4 104 140.4"
          fill="none"
          stroke={LINE}
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      )
    case 'o':
      return (
        <g>
          <ellipse cx={100} cy={141.6} rx={3.3} ry={4.1} fill="#6d2a3a" stroke={LINE} strokeWidth="1.5" />
          <ellipse cx={99} cy={140} rx={1.1} ry={1.3} fill="#ffffff" opacity="0.55" />
        </g>
      )
    default:
      return null
  }
}

/** 眉毛：细弧线，用头发暗部的颜色，才不会像贴了两条黑胶布 */
function Brows({ ex, color }: { ex: ExprCfg; color: string }) {
  const [liftL, liftR] = ex.browLift
  // 左眉（画面左侧，x 62 → 86），眉心在 86
  const left = [
    `M 62 ${95.5 - liftL - ex.browTilt * 1.35}`,
    `C 68 ${90 - liftL - ex.browArch} 78 ${90 - liftL - ex.browArch} 86 ${95.5 - liftL + ex.browTilt * 1.35}`,
  ].join(' ')
  // 右眉镜像
  const right = [
    `M 138 ${95.5 - liftR - ex.browTilt * 1.35}`,
    `C 132 ${90 - liftR - ex.browArch} 122 ${90 - liftR - ex.browArch} 114 ${95.5 - liftR + ex.browTilt * 1.35}`,
  ].join(' ')

  return (
    <g fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" opacity="0.92">
      <path d={left} />
      <path d={right} />
    </g>
  )
}

/* ============================================================
   服装 —— 后层
   ============================================================ */

function OutfitBack({
  style,
  outfit0,
  outfit1,
  outfitLight,
  accent,
}: {
  style: CharacterSpec['outfit']
  outfit0: string
  outfit1: string
  outfitLight: string
  accent: string
}) {
  switch (style) {
    case 'hoodie':
      // 兜帽堆在肩后，比头略宽，形成"帽子"的体量
      return (
        <path
          d="M 58 182 C 48 150 64 126 100 126 C 136 126 152 150 142 182 C 158 188 168 200 170 214 L 30 214 C 32 200 42 188 58 182 Z"
          fill={outfit1}
          stroke={LINE}
          strokeWidth="2"
        />
      )

    case 'armor':
      // 层叠护肩：亮面 + 暗面叠出厚度，深色甲身才不会糊成一团
      return (
        <g>
          <path
            d="M 64 170 C 40 170 26 186 24 210 C 40 218 60 218 74 210 C 67 197 63 184 64 170 Z"
            fill={outfitLight}
            stroke={LINE}
            strokeWidth="2"
          />
          <path
            d="M 62 198 C 38 200 24 216 22 238 C 40 246 62 246 76 236 C 69 224 63 210 62 198 Z"
            fill={outfit0}
            stroke={LINE}
            strokeWidth="2"
          />
          <Mirrored>
            <path
              d="M 64 170 C 40 170 26 186 24 210 C 40 218 60 218 74 210 C 67 197 63 184 64 170 Z"
              fill={outfitLight}
              stroke={LINE}
              strokeWidth="2"
            />
            <path
              d="M 62 198 C 38 200 24 216 22 238 C 40 246 62 246 76 236 C 69 224 63 210 62 198 Z"
              fill={outfit0}
              stroke={LINE}
              strokeWidth="2"
            />
          </Mirrored>
          <circle cx={42} cy={186} r={2.4} fill={accent} opacity="0.9" />
          <circle cx={38} cy={216} r={2.4} fill={accent} opacity="0.9" />
          <Mirrored>
            <circle cx={42} cy={186} r={2.4} fill={accent} opacity="0.9" />
            <circle cx={38} cy={216} r={2.4} fill={accent} opacity="0.9" />
          </Mirrored>
        </g>
      )

    default:
      return null
  }
}

/* ============================================================
   服装 —— 前层（领口、翻领、腰带、胸甲）
   ============================================================ */

function OutfitFront({
  uid,
  style,
  outfit0,
  outfit1,
  outfitDeep,
  outfitLight,
  accent,
}: {
  uid: string
  style: CharacterSpec['outfit']
  outfit0: string
  outfit1: string
  outfitDeep: string
  outfitLight: string
  accent: string
}) {
  const clip = `url(#${uid}-body)`

  switch (style) {
    /* 水手服：一整片方领盖住肩膀，前襟在胸口收成 V，再垂一条领巾 */
    case 'uniform':
      return (
        <g clipPath={clip}>
          <path
            d="M 34 180 C 34 172 40 168 48 170 C 70 177 88 181 100 194 C 112 181 130 177 152 170 C 160 168 166 172 166 180 C 166 200 152 216 132 228 C 118 236 108 239 100 240 C 92 239 82 236 68 228 C 48 216 34 200 34 180 Z"
            fill={outfit1}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* 领口两道白线：水手服最好认的一条细节 */}
          <g fill="none" stroke={outfitLight} strokeWidth="1.8" opacity="0.95">
            <path d="M 46 178 C 66 185 82 190 92 202" />
            <path d="M 54 184 C 71 190 85 195 94 204" />
            <Mirrored>
              <path d="M 46 178 C 66 185 82 190 92 202" />
              <path d="M 54 184 C 71 190 85 195 94 204" />
            </Mirrored>
          </g>
          {/* 领巾 */}
          <path
            d="M 100 190 L 89 194 L 100 224 L 111 194 Z"
            fill={outfitDeep}
            stroke={LINE}
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <ellipse cx={100} cy={193} rx={5.6} ry={4} fill={darken(outfitDeep, 0.22)} stroke={LINE} strokeWidth="1.6" />
        </g>
      )

    /* 连帽卫衣：领口一圈厚边 + 两条抽绳 + 前面的大口袋 */
    case 'hoodie':
      return (
        <g clipPath={clip}>
          <path
            d="M 82 168 C 86 182 114 182 118 168 C 126 172 134 180 138 190 L 62 190 C 66 180 74 172 82 168 Z"
            fill={outfit1}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M 70 212 C 70 207 75 204 80 204 L 120 204 C 125 204 130 207 130 212 L 130 240 L 70 240 Z"
            fill={outfitDeep}
            opacity="0.55"
          />
          <g stroke={outfitLight} strokeWidth="2.4" strokeLinecap="round" fill="none">
            <path d="M 92 180 C 90 194 90 206 91 218" />
            <path d="M 108 180 C 110 194 110 206 109 218" />
          </g>
          <circle cx={91} cy={220} r={2.6} fill={outfitLight} stroke={LINE} strokeWidth="1.2" />
          <circle cx={109} cy={220} r={2.6} fill={outfitLight} stroke={LINE} strokeWidth="1.2" />
        </g>
      )

    /* 古风长袍：宽袖 + 右衽交领（左襟压右襟），腰带束出腰线 */
    case 'robe':
      return (
        <g>
          {/* 宽袖画在身体之前，才能完整露出来 */}
          <path
            d="M 48 186 C 30 198 20 218 18 240 L 66 240 C 59 222 56 204 58 192 Z"
            fill={outfit1}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <Mirrored>
            <path
              d="M 48 186 C 30 198 20 218 18 240 L 66 240 C 59 222 56 204 58 192 Z"
              fill={outfit1}
              stroke={LINE}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </Mirrored>
          <g clipPath={clip}>
          <path
            d="M 100 172 C 118 176 134 188 142 206 L 146 240 L 100 240 Z"
            fill={darken(outfit0, 0.11)}
            stroke={LINE}
            strokeWidth="2"
          />
          <path
            d="M 100 172 C 82 176 66 188 58 206 L 54 240 L 100 240 Z"
            fill={outfit0}
            stroke={LINE}
            strokeWidth="2"
          />
          {/* 两条领带在胸口交叠成 V，内侧正好在中轴相接，不会糊成一坨 */}
          <path
            d="M 100 170 C 82 178 68 194 58 216 L 70 223 C 79 202 90 189 100 182 Z"
            fill={outfit1}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <Mirrored>
            <path
              d="M 100 170 C 82 178 68 194 58 216 L 70 223 C 79 202 90 189 100 182 Z"
              fill={outfit1}
              stroke={LINE}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </Mirrored>
          <path d="M 52 218 L 148 218 L 148 234 L 52 234 Z" fill={outfit1} stroke={LINE} strokeWidth="2" strokeLinejoin="round" />
          <path d="M 52 225 L 148 225" fill="none" stroke={outfitDeep} strokeWidth="2.2" opacity="0.7" />
          <path d="M 92 218 C 96 212 104 212 108 218 C 104 225 96 225 92 218 Z" fill={outfitDeep} stroke={LINE} strokeWidth="1.5" />
          </g>
        </g>
      )

    /* 斗篷：外层一大片披下来，肩上一层小披肩，领口一枚圆形搭扣 */
    case 'cloak':
      return (
        <g>
          {/* 披风主体：不裁切，整片盖住身体才像斗篷 */}
          <path
            d="M 100 154 C 66 156 38 172 26 198 C 18 216 14 228 12 240 L 188 240 C 186 228 182 216 174 198 C 162 172 134 156 100 154 Z"
            fill={outfit1}
            stroke={LINE}
            strokeWidth="2"
          />
          <path
            d="M 100 160 C 72 162 48 176 38 198 C 50 208 66 212 80 208 C 84 194 90 182 100 176 C 110 182 116 194 120 208 C 134 212 150 208 162 198 C 152 176 128 162 100 160 Z"
            fill={outfit0}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M 86 170 C 92 162 108 162 114 170 C 120 178 128 184 138 188 L 62 188 C 72 184 80 178 86 170 Z"
            fill={outfit1}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* 搭扣用配饰色，让主色和点缀色呼应起来 */}
          <circle cx={100} cy={194} r={7.5} fill={accent} stroke={LINE} strokeWidth="2" />
          <circle cx={100} cy={194} r={2.8} fill={outfitDeep} />
          <path
            d="M 100 188 C 96 182 92 178 86 176"
            fill="none"
            stroke={outfitDeep}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M 100 188 C 104 182 108 178 114 176"
            fill="none"
            stroke={outfitDeep}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
      )

    /* 连衣裙：圆领 + 泡泡袖 + 高腰线 */
    case 'dress':
      return (
        <g clipPath={clip}>
          <path
            d="M 82 168 C 86 180 114 180 118 168 C 126 172 134 178 138 186 L 62 186 C 66 178 74 172 82 168 Z"
            fill={outfit1}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M 40 190 C 26 202 22 220 24 240 L 58 240 C 50 222 48 204 54 190 Z"
            fill={outfit1}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <Mirrored>
            <path
              d="M 40 190 C 26 202 22 220 24 240 L 58 240 C 50 222 48 204 54 190 Z"
              fill={outfit1}
              stroke={LINE}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </Mirrored>
          <path
            d="M 46 208 L 154 208 L 154 222 L 46 222 Z"
            fill={outfit1}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M 92 208 C 96 203 104 203 108 208 C 104 214 96 214 92 208 Z" fill={accent} stroke={LINE} strokeWidth="1.6" />
          {/* 裙褶：从腰线往下放射，把"裙摆"撑开 */}
          <g fill="none" stroke={outfitDeep} strokeWidth="1.6" opacity="0.6">
            <path d="M 58 222 L 44 240" />
            <path d="M 72 222 L 62 240" />
            <path d="M 86 222 L 82 240" />
            <path d="M 100 222 L 100 240" />
            <path d="M 114 222 L 118 240" />
            <path d="M 128 222 L 138 240" />
            <path d="M 142 222 L 156 240" />
          </g>
        </g>
      )

    /* 和服：交叠的衣襟 + 宽腰带（带） */
    case 'kimono':
      return (
        <g>
          {/* 两片下摆先铺在两侧 */}
          <path
            d="M 44 194 C 28 206 18 222 16 240 L 70 240 C 60 224 54 206 56 194 Z"
            fill={outfit1}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <Mirrored>
            <path
              d="M 44 194 C 28 206 18 222 16 240 L 70 240 C 60 224 54 206 56 194 Z"
              fill={outfit1}
              stroke={LINE}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </Mirrored>
          <g clipPath={clip}>
          <path
            d="M 100 170 C 114 174 126 184 132 198 L 132 240 L 100 240 Z"
            fill={darken(outfit0, 0.08)}
            stroke={LINE}
            strokeWidth="2"
          />
          <path
            d="M 100 170 C 86 174 74 184 68 198 L 68 240 L 100 240 Z"
            fill={outfit0}
            stroke={LINE}
            strokeWidth="2"
          />
          <path
            d="M 92 166 C 80 174 70 186 64 202 L 64 220 L 76 220 L 76 204 C 81 191 90 182 100 178 Z"
            fill={outfit1}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M 108 166 C 120 174 130 186 136 202 L 136 220 L 124 220 L 124 204 C 119 191 110 182 100 178 Z"
            fill={outfit1}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* 腰带 */}
          <path
            d="M 54 206 L 146 206 L 146 226 L 54 226 Z"
            fill={outfit1}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M 54 213 L 146 213" fill="none" stroke={outfitDeep} strokeWidth="1.8" opacity="0.75" />
          <path d="M 92 206 C 96 200 104 200 108 206 C 104 212 96 212 92 206 Z" fill={outfitDeep} stroke={LINE} strokeWidth="1.5" />
          </g>
        </g>
      )

    /* 毛衣：圆领罗纹 + 竖条织纹 */
    case 'sweater':
      return (
        <g clipPath={clip}>
          <path
            d="M 80 168 C 84 180 116 180 120 168 C 128 174 136 182 140 192 L 60 192 C 64 182 72 174 80 168 Z"
            fill={outfit1}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* 罗纹的竖线 */}
          <g stroke={outfitDeep} strokeWidth="1.3" opacity="0.6" fill="none">
            {Array.from({ length: 9 }, (_, i) => {
              const x = 72 + i * 7
              return <path key={i} d={`M ${x} 174 C ${x - 1} 180 ${x - 1} 186 ${x} 192`} />
            })}
          </g>
          {/* 麻花针织纹 */}
          <g fill="none" stroke={outfitDeep} strokeWidth="1.8" opacity="0.45" strokeLinecap="round">
            <path d="M 84 196 C 80 208 80 222 84 236" />
            <path d="M 100 194 C 96 208 96 224 100 240" />
            <path d="M 116 196 C 120 208 120 222 116 236" />
          </g>
          <path d="M 56 232 L 144 232 L 144 240 L 56 240 Z" fill={outfit1} opacity="0.85" />
        </g>
      )

    /* 轻甲：护颈 + 有脊线的胸甲 */
    case 'armor':
      return (
        <g clipPath={clip}>
          <path
            d="M 82 166 C 86 178 114 178 118 166 C 128 172 138 182 144 194 L 56 194 C 62 182 72 172 82 166 Z"
            fill={outfit1}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M 100 186 C 84 188 72 200 68 216 L 66 240 L 134 240 L 132 216 C 128 200 116 188 100 186 Z"
            fill={outfitDeep}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* 中脊 + 两道横带，把"甲"的层次做出来 */}
          <path d="M 100 188 L 100 240" fill="none" stroke={outfitLight} strokeWidth="2.2" opacity="0.7" />
          <path d="M 70 206 C 82 214 118 214 130 206" fill="none" stroke={outfitLight} strokeWidth="2" opacity="0.65" />
          <path d="M 68 226 C 82 234 118 234 132 226" fill="none" stroke={outfitLight} strokeWidth="2" opacity="0.55" />
          <g fill={accent}>
            <circle cx={82} cy={200} r={2.3} />
            <circle cx={118} cy={200} r={2.3} />
            <circle cx={78} cy={222} r={2.3} />
            <circle cx={122} cy={222} r={2.3} />
          </g>
        </g>
      )

    default:
      return null
  }
}

/* ============================================================
   头顶配饰（画在刘海之下，根部被发丝盖住）
   ============================================================ */

function HeadwearBack({
  accentStyle,
  accent,
}: {
  accentStyle: CharacterSpec['accent']
  accent: string
}) {
  switch (accentStyle) {
    case 'horns':
      // 兽角：从头顶斜着往外长，根部藏在发里
      return (
        <g>
          <path
            d="M 74 52 C 66 34 70 18 84 10 C 78 24 80 38 88 50 Z"
            fill={accent}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M 74 52 C 66 34 70 18 84 10 C 78 24 80 38 88 50 Z"
            fill="none"
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <Mirrored>
            <path
              d="M 74 52 C 66 34 70 18 84 10 C 78 24 80 38 88 50 Z"
              fill={accent}
              stroke={LINE}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </Mirrored>
          {/* 角上的环纹 */}
          <path d="M 71 40 L 86 34" stroke={darken(accent, 0.35)} strokeWidth="2" strokeLinecap="round" />
          <Mirrored>
            <path d="M 71 40 L 86 34" stroke={darken(accent, 0.35)} strokeWidth="2" strokeLinecap="round" />
          </Mirrored>
        </g>
      )

    case 'catears':
      // 猫耳：三角 + 内耳，坐得比头顶高，才不会被刘海吞掉
      return (
        <g>
          <path
            d="M 60 62 C 58 40 64 24 76 16 C 86 26 92 42 92 60 Z"
            fill={accent}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M 68 56 C 67 42 70 32 76 26 C 81 33 84 44 85 56 Z" fill="#f7a8bd" />
          <Mirrored>
            <path
              d="M 60 62 C 58 40 64 24 76 16 C 86 26 92 42 92 60 Z"
              fill={accent}
              stroke={LINE}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M 68 56 C 67 42 70 32 76 26 C 81 33 84 44 85 56 Z" fill="#f7a8bd" />
          </Mirrored>
        </g>
      )

    default:
      return null
  }
}

/* ============================================================
   面部配饰（画在最前层）
   ============================================================ */

function HeadwearFront({
  accentStyle,
  accent,
}: {
  accentStyle: CharacterSpec['accent']
  accent: string
}) {
  const frame = darken(accent, 0.45)

  switch (accentStyle) {
    /* 发带：偏在左耳上方，两只环 + 中间结 */
    case 'ribbon':
      return (
        <g transform="translate(58 62) rotate(-16)">
          <path
            d="M -2 0 C -14 -10 -26 -8 -28 2 C -30 12 -18 16 -2 6 Z"
            fill={accent}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M 2 0 C 14 -10 26 -8 28 2 C 30 12 18 16 2 6 Z"
            fill={accent}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M -2 2 C -6 12 -4 22 2 28 C 8 22 10 12 6 2 Z"
            fill={darken(accent, 0.18)}
            stroke={LINE}
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <ellipse cx={0} cy={2} rx={5.5} ry={5} fill={darken(accent, 0.3)} stroke={LINE} strokeWidth="1.8" />
        </g>
      )

    /* 花饰：五瓣花 + 花心 */
    case 'flower':
      return (
        <g transform="translate(60 66)">
          {Array.from({ length: 5 }, (_, i) => (
            <ellipse
              key={i}
              cx={0}
              cy={-9}
              rx={5.6}
              ry={8.2}
              fill={accent}
              stroke={LINE}
              strokeWidth="1.5"
              transform={`rotate(${i * 72})`}
            />
          ))}
          <circle cx={0} cy={0} r={4.6} fill={lighten(accent, 0.55)} stroke={LINE} strokeWidth="1.5" />
        </g>
      )

    /* 眼镜：圆角方框 + 鼻梁 + 镜腿 */
    case 'glasses':
      return (
        <g fill="none" stroke={frame} strokeWidth="2.6" strokeLinejoin="round">
          <path d="M 60 104 L 90 104 C 93 104 94 106 94 109 L 94 124 C 94 128 92 130 88 130 L 66 130 C 62 130 60 128 60 124 Z" fill={alpha('#ffffff', 0.18)} />
          <Mirrored>
            <path d="M 60 104 L 90 104 C 93 104 94 106 94 109 L 94 124 C 94 128 92 130 88 130 L 66 130 C 62 130 60 128 60 124 Z" fill={alpha('#ffffff', 0.18)} />
          </Mirrored>
          <path d="M 94 112 C 97 110 103 110 106 112" />
          <path d="M 60 108 C 56 108 52 110 50 114" strokeLinecap="round" />
          <Mirrored>
            <path d="M 60 108 C 56 108 52 110 50 114" strokeLinecap="round" />
          </Mirrored>
          {/* 镜片反光 */}
          <path d="M 66 110 L 74 110" stroke="#ffffff" strokeWidth="2.4" opacity="0.75" strokeLinecap="round" />
          <Mirrored>
            <path d="M 66 110 L 74 110" stroke="#ffffff" strokeWidth="2.4" opacity="0.75" strokeLinecap="round" />
          </Mirrored>
        </g>
      )

    /* 护目镜：镜片压在眼睛上（半透明，眼睛仍要看得到）+ 绕头的带子 */
    case 'goggles':
      return (
        <g>
          <path
            d="M 48 108 C 64 102 136 102 152 108 L 152 114 C 136 108 64 108 48 114 Z"
            fill={frame}
            stroke={LINE}
            strokeWidth="1.5"
          />
          <g fill={alpha(accent, 0.3)} stroke={frame} strokeWidth="2.2" strokeLinejoin="round">
            <path d="M 60 106 L 92 106 C 95 106 96 108 96 111 L 96 128 C 96 132 94 134 90 134 L 64 134 C 60 134 58 132 58 128 L 58 111 C 58 108 58 106 60 106 Z" />
            <path d="M 140 106 L 108 106 C 105 106 104 108 104 111 L 104 128 C 104 132 106 134 110 134 L 136 134 C 140 134 142 132 142 128 L 142 111 C 142 108 142 106 140 106 Z" />
          </g>
          <path d="M 96 114 C 99 112 101 112 104 114" fill="none" stroke={frame} strokeWidth="2.4" />
          <path d="M 66 114 L 76 114" stroke="#ffffff" strokeWidth="2.4" opacity="0.55" strokeLinecap="round" />
          <path d="M 134 114 L 124 114" stroke="#ffffff" strokeWidth="2.4" opacity="0.55" strokeLinecap="round" />
          <circle cx={50} cy={110} r={3.6} fill={accent} stroke={LINE} strokeWidth="1.5" />
          <circle cx={150} cy={110} r={3.6} fill={accent} stroke={LINE} strokeWidth="1.5" />
        </g>
      )

    /* 耳机：横梁跨过头顶，两侧是耳罩 */
    case 'headphones':
      return (
        <g>
          <path
            d="M 46 118 C 42 74 64 44 100 44 C 136 44 158 74 154 118"
            fill="none"
            stroke={accent}
            strokeWidth="7"
            strokeLinecap="round"
          />
          <path
            d="M 46 118 C 42 74 64 44 100 44 C 136 44 158 74 154 118"
            fill="none"
            stroke={darken(accent, 0.35)}
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.5"
          />
          <g fill={darken(accent, 0.2)} stroke={LINE} strokeWidth="2">
            <rect x="34" y="102" width="22" height="34" rx="9" />
            <rect x="144" y="102" width="22" height="34" rx="9" />
          </g>
          <g fill={lighten(accent, 0.4)}>
            <rect x="39" y="108" width="12" height="22" rx="6" />
            <rect x="149" y="108" width="12" height="22" rx="6" />
          </g>
        </g>
      )

    /* 贝雷帽：歪戴在头顶，帽顶有个小揪 */
    case 'hat':
      return (
        <g>
          <path
            d="M 44 72 C 40 42 66 22 100 22 C 134 22 160 42 156 72 C 140 62 120 58 100 58 C 80 58 60 62 44 72 Z"
            fill={accent}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M 44 72 C 60 62 80 58 100 58 C 120 58 140 62 156 72 C 158 78 158 84 156 88 C 138 76 120 72 100 72 C 80 72 62 76 44 88 C 42 84 42 78 44 72 Z"
            fill={darken(accent, 0.18)}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx={100} cy={20} r={6.5} fill={darken(accent, 0.25)} stroke={LINE} strokeWidth="2" />
          <path d="M 58 42 C 70 32 88 28 104 30" fill="none" stroke={lighten(accent, 0.45)} strokeWidth="3" opacity="0.6" strokeLinecap="round" />
        </g>
      )

    /* 小皇冠：三个尖 + 一排宝石。整体压低一点，别把头顶的头发全吃掉 */
    case 'crown':
      return (
        <g>
          <path
            d="M 68 54 L 63 22 L 82 38 L 100 12 L 118 38 L 137 22 L 132 54 Z"
            fill={accent}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M 68 54 L 132 54 L 132 64 L 68 64 Z"
            fill={darken(accent, 0.16)}
            stroke={LINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx={63} cy={20} r={3.6} fill={lighten(accent, 0.5)} stroke={LINE} strokeWidth="1.5" />
          <circle cx={100} cy={10} r={4.2} fill={lighten(accent, 0.5)} stroke={LINE} strokeWidth="1.5" />
          <circle cx={137} cy={20} r={3.6} fill={lighten(accent, 0.5)} stroke={LINE} strokeWidth="1.5" />
          <circle cx={80} cy={59} r={3} fill="#e35d7a" stroke={LINE} strokeWidth="1.3" />
          <circle cx={100} cy={59} r={3} fill="#5aa9e6" stroke={LINE} strokeWidth="1.3" />
          <circle cx={120} cy={59} r={3} fill="#7bd389" stroke={LINE} strokeWidth="1.3" />
        </g>
      )

    /* 耳饰：小圆坠 + 一颗垂珠 */
    case 'earring':
      return (
        <g>
          <circle cx={144} cy={122} r={2.6} fill={accent} stroke={LINE} strokeWidth="1.4" />
          <path d="M 144 124 L 144 130" stroke={LINE} strokeWidth="1.2" />
          <circle cx={144} cy={133} r={4} fill={accent} stroke={LINE} strokeWidth="1.5" />
          <circle cx={142.6} cy={131.6} r={1.2} fill="#ffffff" opacity="0.8" />
          <Mirrored>
            <circle cx={144} cy={122} r={2.6} fill={accent} stroke={LINE} strokeWidth="1.4" />
            <path d="M 144 124 L 144 130" stroke={LINE} strokeWidth="1.2" />
            <circle cx={144} cy={133} r={4} fill={accent} stroke={LINE} strokeWidth="1.5" />
          </Mirrored>
        </g>
      )

    default:
      return null
  }
}

/* ============================================================
   对外 API
   ============================================================ */

export function CharacterArt({
  spec,
  className,
  uid,
}: {
  spec: CharacterSpec
  className?: string
  /** 唯一 id 前缀，防止同页多张卡片的 <defs> id 冲突 */
  uid: string
}): JSX.Element {
  return (
    <Art
      spec={spec}
      uid={uid}
      viewBox="0 0 200 240"
      className={className}
      label="角色立绘"
    />
  )
}

/**
 * 列表行用的小头像。
 * 同一个立绘，只把 viewBox 裁到头部 —— 不重画一遍，
 * 保证小图和卡片长得一模一样。
 */
export function CharacterAvatar({
  spec,
  className,
  uid,
}: {
  spec: CharacterSpec
  className?: string
  uid: string
}): JSX.Element {
  return (
    <Art
      spec={spec}
      uid={uid}
      viewBox="24 18 152 152"
      className={className}
      label="角色头像"
    />
  )
}
