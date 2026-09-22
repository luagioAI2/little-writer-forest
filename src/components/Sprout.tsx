/* ============================================================
   小笔苗 —— 全 App 的角色本体
   ============================================================

   为什么要有这个东西（家长 2026-09-18 的原话）：
     「UI 的风格 扁平没啥问题。但是有点老气，孩子不喜欢。」

   调色只能让它「不土」，要让孩子真的喜欢，得有个**活的东西**在里面。
   所以 v4 除了换配色，还补了这个角色 —— 它是「年轻化」的主要抓手。

   ★★ 关键：**「小笔苗」这个名字早就有了，只是从来没有身体。**
      做这个组件之前，全 App 已经有 ~25 处文案在讲它：
        · `db.ts` —— 孩子的默认名字就是「小笔苗」
        · `cards.ts` —— 「小笔苗偷偷说：这是我今年读到最好的故事」
        · `scoring.ts` —— 「小笔苗要给你鼓个掌 👏」
        · `LevelPage` —— 有整整一段「小笔苗想对你说」
        · `library.ts` —— 「这不是小笔苗的题库文件」
      也就是说，App 一直在**念叨一个看不见的角色**。
      所以这不是"新加一个吉祥物"，是**给已有的角色补上身体** ——
      文案不用改一个字，它一出现就自己接上了。
      （改这个组件时别忘了这条：名字和人格是既定的，不是我发明的。）

   形象设定：**一支长出叶子的铅笔**。
     名字叫「苗」，App 叫「作文森林」，所以「笔」长成「苗」，
     既是写作工具，又是一个活的、会长大的东西。
     跟 App 里「写作 → 长大 → 结果实」的那套成长线是同一件事。

   ★ 关于构图（改之前先看这条）：
     第一版把身体画得太小（只占画布 43%），而且铅笔杆被身体和叶子
     **完全盖住** —— 渲染出来就是一个圆球顶两片叶子，铅笔的设定没了，
     小尺寸下脸也糊成一团。现在：
       · 身体占画布 63%，脸才看得清；
       · 笔尖（6..18）+ 一段木杆（18..28）**露在叶子上面**，
         这是"这是一支笔"的唯一识别点，不许被叶子盖掉；
       · 叶子下移到 y 26..52，专门让出笔杆。
     改完记得重新渲染 `__sprout_gallery.test.tsx` 看一眼。

   ⚠️ 三条约束（都是项目既有铁律的延伸）：
     · **纯矢量，不用位图。** 零图片资源，APK 体积不受影响，断网可用。
       和 CharacterArt / TreeArt 是同一套做法。
     · **颜色全走 CSS 变量**，不写死色值 —— 这样浅色世界和
       `.scene-ink` 墨夜世界共用同一个组件，不用两份。
     · **不用 emoji 拼脸。** emoji 各设备渲染不同，
       永远不可能「精巧」（见 theme.css 三条铁律）。

   表情只影响眼睛 / 嘴 / 腮红，身体和叶子完全共用 ——
   这样加表情是加几行路径，不是加一份新立绘。
   ============================================================ */

export type SproutMood =
  /** 默认：开心，用在空状态、欢迎 */
  | 'happy'
  /** 正在想事情：用在加载 / 生成中 */
  | 'thinking'
  /** 欢呼：用在奖励、通关、拿到新卡 */
  | 'cheer'
  /** 犯困：用在"今天还没写"这类温和的提醒 */
  | 'sleepy'
  /** 好奇：用在引导、提问 */
  | 'curious'

interface SproutPalette {
  body: string
  bodyLine: string
  leaf: string
  leafDeep: string
  wood: string
  tip: string
  face: string
  blush: string
  shadow: string
  spark: string
}

/** 浅色世界 */
const LIGHT: SproutPalette = {
  body: 'var(--color-inkleaf-50)',
  bodyLine: 'var(--color-inkleaf-300)',
  leaf: 'var(--color-inkleaf-400)',
  leafDeep: 'var(--color-inkleaf-500)',
  wood: '#e8c98f',
  tip: 'var(--color-inkleaf-500)',
  face: 'var(--color-ink-800)',
  blush: 'var(--color-clay-300)',
  shadow: 'rgb(18 23 20 / 0.09)',
  spark: 'var(--color-amber-leaf-400)',
}

/** 墨夜世界（.scene-ink）—— 同一个组件，换一组变量 */
const INK: SproutPalette = {
  body: 'var(--color-night-surface-2)',
  bodyLine: 'var(--color-inkleaf-400)',
  leaf: 'var(--color-inkleaf-300)',
  leafDeep: 'var(--color-inkleaf-400)',
  wood: '#c9a86a',
  tip: 'var(--color-inkleaf-300)',
  face: 'var(--color-night-text)',
  blush: 'rgb(219 132 81 / 0.55)',
  shadow: 'rgb(0 0 0 / 0.35)',
  spark: 'var(--color-amber-leaf-300)',
}

/** 眼睛 —— 表情的主要载体。半径偏大是刻意的：小尺寸下要还认得出 */
function Eyes({ mood, c }: { mood: SproutMood; c: SproutPalette }) {
  const dot = (cx: number, cy: number, r = 5.2) => (
    <circle cx={cx} cy={cy} r={r} fill={c.face} />
  )
  // 眯眼笑：两条向上的弧
  const smileArc = (cx: number) => (
    <path
      d={`M${cx - 6.4} ${78} q6.4 -7 12.8 0`}
      stroke={c.face}
      strokeWidth="3.2"
      strokeLinecap="round"
      fill="none"
    />
  )

  switch (mood) {
    case 'thinking':
      // 眼珠往上看
      return (
        <>
          {dot(48, 74)}
          {dot(72, 74)}
          <circle cx="50" cy="72" r="1.7" fill="#fff" opacity="0.85" />
          <circle cx="74" cy="72" r="1.7" fill="#fff" opacity="0.85" />
        </>
      )
    case 'cheer':
      // 笑成两条弧，最「活」的一档
      return (
        <>
          {smileArc(48)}
          {smileArc(72)}
        </>
      )
    case 'sleepy':
      // 闭眼：向下的弧
      return (
        <>
          <path
            d="M42 77 q6 6.4 12 0"
            stroke={c.face}
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M66 77 q6 6.4 12 0"
            stroke={c.face}
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
        </>
      )
    case 'curious':
      // 一大一小，像在追问
      return (
        <>
          {dot(48, 76, 5.8)}
          {dot(72.5, 75, 4.4)}
        </>
      )
    default:
      return (
        <>
          {dot(48, 76)}
          {dot(72, 76)}
        </>
      )
  }
}

/** 嘴 —— 只做小变化，避免表情之间差太远 */
function Mouth({ mood, c }: { mood: SproutMood; c: SproutPalette }) {
  const stroke = {
    stroke: c.face,
    strokeWidth: 3,
    strokeLinecap: 'round' as const,
    fill: 'none',
  }
  switch (mood) {
    case 'thinking':
      // 抿着的一小条
      return <path d="M53.5 88 h13" {...stroke} />
    case 'cheer':
      // 张开的笑
      return <path d="M50 85 q10 13 20 0 z" fill={c.face} />
    case 'sleepy':
      return <path d="M54 89 q6 4 12 0" {...stroke} />
    case 'curious':
      return <ellipse cx="60" cy="88" rx="4.4" ry="5.2" fill={c.face} />
    default:
      return <path d="M52 86 q8 7 16 0" {...stroke} />
  }
}

export function Sprout({
  size = 96,
  mood = 'happy',
  ink = false,
  animated = true,
  className = '',
  /** 传了才读屏，不传就是纯装饰 */
  label,
}: {
  size?: number
  mood?: SproutMood
  /** 放在 .scene-ink 里时传 true */
  ink?: boolean
  animated?: boolean
  className?: string
  label?: string
}) {
  const c = ink ? INK : LIGHT
  const sway = animated ? 'anim-sway' : ''
  const breathe = animated ? 'anim-breathe' : ''

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {/* 影子 */}
      <ellipse cx="60" cy="113" rx="30" ry="4.2" fill={c.shadow} />

      <g className={breathe}>
        {/* ★ 铅笔：笔尖 + 一段木杆必须**露在叶子上面**，
            这是「这是一支笔」的唯一识别点。先画，后画的叶子只盖下半截。 */}
        <rect x="55" y="18" width="10" height="44" rx="2" fill={c.wood} />
        <path d="M55 18 L60 5.5 L65 18 Z" fill={c.tip} />
        <rect x="55" y="18" width="10" height="4.6" fill={c.tip} opacity="0.55" />

        {/* 两片叶子 —— 下移到 y 22..52，专门给笔杆让位。
            ⚠️ 形状要「胖」：细长的两条会被看成草叶，不像叶子。 */}
        <g className={sway}>
          <path d="M58 52 C44 54 30 46 28 22 C46 26 58 36 58 52 Z" fill={c.leaf} />
          <path
            d="M56 48 C48 42 42 33 42 25"
            stroke="#fff"
            strokeWidth="1.3"
            opacity="0.4"
            fill="none"
          />
        </g>
        <g className={sway} style={{ animationDelay: '0.7s' }}>
          <path d="M62 52 C76 54 90 46 92 22 C74 26 62 36 62 52 Z" fill={c.leafDeep} />
          <path
            d="M64 48 C72 42 78 33 78 25"
            stroke="#fff"
            strokeWidth="1.3"
            opacity="0.35"
            fill="none"
          />
        </g>

        {/* 身体 —— 占画布 58%，脸才看得清 */}
        <ellipse
          cx="60"
          cy="80"
          rx="35"
          ry="32"
          fill={c.body}
          stroke={c.bodyLine}
          strokeWidth="2.2"
        />

        {/* 腮红 */}
        <ellipse cx="33" cy="88" rx="5.6" ry="3.8" fill={c.blush} opacity="0.55" />
        <ellipse cx="87" cy="88" rx="5.6" ry="3.8" fill={c.blush} opacity="0.55" />

        <Eyes mood={mood} c={c} />
        <Mouth mood={mood} c={c} />
      </g>

      {/* 欢呼时的小星点 */}
      {mood === 'cheer' && (
        <>
          <circle cx="16" cy="40" r="2.8" fill={c.spark} className="anim-sparkle" />
          <circle cx="104" cy="34" r="2.3" fill={c.spark} className="anim-sparkle delay-2" />
          <circle cx="110" cy="64" r="1.8" fill={c.spark} className="anim-sparkle delay-3" />
        </>
      )}
      {/* 思考时头顶的三个点 */}
      {mood === 'thinking' && (
        <>
          {[0, 1, 2].map((i) => (
            <circle
              key={i}
              cx={100 + i * 7}
              cy={24 - i * 4.5}
              r={2.6 - i * 0.5}
              fill={c.bodyLine}
              className="anim-sparkle"
              style={{ animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </>
      )}
    </svg>
  )
}

export default Sprout
