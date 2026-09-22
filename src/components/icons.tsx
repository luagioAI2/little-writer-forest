/**
 * 图标系统
 * ------------------------------------------------------------
 * 为什么自己画：emoji 在不同系统上长相完全不一样（安卓是彩色果冻、
 * iOS 是拟物、Windows 是扁平），而且大小、基线、粗细都不可控，
 * 拼在一起就是"土"的来源。统一的自绘线性图标才能有设计感。
 *
 * 规格（全库统一，不许例外）：
 *   · 24 × 24 网格，四周留 2px 安全边距
 *   · 描边 1.6（可传 strokeWidth 覆盖），圆头圆角
 *   · 只用 currentColor，颜色由调用方决定
 *   · 纯几何、无填充，保证在任何底色上都清晰
 */

import type { ReactNode } from 'react'

export interface IconProps {
  /** 像素尺寸，默认 22（比 24 更贴合中文排版的行高） */
  size?: number
  className?: string
  strokeWidth?: number
}

/** 所有图标共用的外壳 */
function Svg({
  size = 22,
  className,
  strokeWidth = 1.6,
  children,
  filled = false,
}: IconProps & { children: ReactNode; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/* ============================================================
   导航 / 主导航
   ============================================================ */

/** 写作文：钢笔尖 */
export const IconPen = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20.2l3.5-.9 10.9-10.9a2.3 2.3 0 0 0-3.2-3.2L4.3 16.1 4 20.2Z" />
    <path d="M13.6 6.4l4 4" />
    <path d="M4.3 16.1l3.6 3.6" />
  </Svg>
)

/** 日记本 */
export const IconBook = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4.6A1.6 1.6 0 0 1 6.6 3H18a1 1 0 0 1 1 1v13.4a1 1 0 0 1-1 1H6.6A1.6 1.6 0 0 0 5 20V4.6Z" />
    <path d="M5 17.6A1.6 1.6 0 0 1 6.6 16H19" />
    <path d="M9.4 3v8.6l2.3-1.7 2.3 1.7V3" />
  </Svg>
)

/** 成长树 */
export const IconTree = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21v-5.6" />
    <path d="M12 15.4c-3.7 0-6.7-2.7-6.7-6S8.3 3.4 12 3.4s6.7 2.7 6.7 6-3 6-6.7 6Z" />
    <path d="M12 12.2 9.1 9.8M12 10.6l2.9-2.4" />
    <path d="M8.4 21h7.2" />
  </Svg>
)

/** 地图 */
export const IconMap = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 4.4 3.6 6.9v12.3L9 16.7l6 2.5 5.4-2.5V4.4L15 6.9 9 4.4Z" />
    <path d="M9 4.4v12.3M15 6.9v12.3" />
  </Svg>
)

/** 卡牌（背包） */
export const IconCards = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.4 5.3h7.4a2.6 2.6 0 0 1 2.6 2.6" />
    <path d="M5.6 10.4A2.6 2.6 0 0 1 8.2 7.8h7.6a2.6 2.6 0 0 1 2.6 2.6v6.5a2.6 2.6 0 0 1-2.6 2.6H8.2a2.6 2.6 0 0 1-2.6-2.6v-6.5Z" />
    <path d="M12 10.4l1 2 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3 1-2Z" />
  </Svg>
)

/* ============================================================
   语音 / 媒体
   ============================================================ */

export const IconMic = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.4a2.7 2.7 0 0 1 2.7 2.7v5.4a2.7 2.7 0 0 1-5.4 0V6.1A2.7 2.7 0 0 1 12 3.4Z" />
    <path d="M6 11.4a6 6 0 0 0 12 0" />
    <path d="M12 17.4v3.2M9.2 20.6h5.6" />
  </Svg>
)

export const IconMicOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.3 6.1a2.7 2.7 0 0 1 5.4 0v3.2" />
    <path d="M14.7 12.6a2.7 2.7 0 0 1-5.4-.9V9.3" />
    <path d="M6 11.4a6 6 0 0 0 8.6 5.4" />
    <path d="M12 17.4v3.2M9.2 20.6h5.6" />
    <path d="M4.4 3.6l15.2 16.8" />
  </Svg>
)

export const IconPlay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.8 5.6a.7.7 0 0 1 1.07-.6l9 6.4a.7.7 0 0 1 0 1.2l-9 6.4a.7.7 0 0 1-1.07-.6V5.6Z" />
  </Svg>
)

export const IconPause = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5.4v13.2M15 5.4v13.2" strokeWidth={2.4} />
  </Svg>
)

export const IconStop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2.4" />
  </Svg>
)

export const IconVolume = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 4.8 6.6 8.4H3.8v7.2h2.8L11 19.2V4.8Z" />
    <path d="M15.2 9.4a3.6 3.6 0 0 1 0 5.2" />
    <path d="M17.8 6.8a7.2 7.2 0 0 1 0 10.4" />
  </Svg>
)

export const IconVolumeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 4.8 6.6 8.4H3.8v7.2h2.8L11 19.2V4.8Z" />
    <path d="M15.4 10.2l4 3.6M19.4 10.2l-4 3.6" />
  </Svg>
)

export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.4 9.6h9.2a5.6 5.6 0 0 1 0 11.2H8" />
    <path d="M8 5.6 4.4 9.6 8 13.6" />
  </Svg>
)

export const IconRedo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.6 9.6h-9.2a5.6 5.6 0 0 0 0 11.2H16" />
    <path d="M16 5.6l3.6 4L16 13.6" />
  </Svg>
)

/* ============================================================
   自然 / 成长
   ============================================================ */

/** 小苗（品牌图形） */
export const IconSprout = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20.6v-7.2" />
    <path d="M12 13.4c0-3.1 2.5-5.6 5.6-5.6 0 3.1-2.5 5.6-5.6 5.6Z" />
    <path d="M12 13.4c0-3.1-2.5-5.6-5.6-5.6 0 3.1 2.5 5.6 5.6 5.6Z" />
  </Svg>
)

/** 种子 */
export const IconSeed = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20.4c-3.4 0-6.2-2.6-6.2-5.9 0-4.2 4-7.5 6.2-9.5 2.2 2 6.2 5.3 6.2 9.5 0 3.3-2.8 5.9-6.2 5.9Z" />
    <path d="M12 20.4c0-3.2.9-6.3 2.6-8.9" />
  </Svg>
)

/** 叶子 */
export const IconLeaf = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.4 4.2c0 8.4-4.6 12.4-9 12.4a4.8 4.8 0 0 1 0-9.6c3 0 5.4-1.4 5.4-1.4s1.6-.9 3.6-1.4Z" />
    <path d="M4 20.4c1.6-5.4 5-9.4 9.6-11.4" />
  </Svg>
)

/** 树洞 */
export const IconHollow = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.4 21V8.6A4.6 4.6 0 0 1 12 4a4.6 4.6 0 0 1 4.6 4.6V21" />
    <path d="M12 12.2c1.4 0 2.5 1.3 2.5 2.9s-1.1 2.9-2.5 2.9-2.5-1.3-2.5-2.9 1.1-2.9 2.5-2.9Z" />
    <path d="M5.6 21h12.8" />
  </Svg>
)

/** 小鸟（宠物） */
export const IconBird = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.3 7.6a2.8 2.8 0 1 1-5.6 0 2.8 2.8 0 0 1 5.6 0Z" />
    <path d="M19.3 7.1l2.6.9-2.6 1" />
    <path d="M13.9 9.1c-.6-.9-1.6-1.5-2.8-1.5" />
    <path d="M11.4 18.6a4.6 4.6 0 0 1-4.6-4.6c0-2.4 1.9-4.4 4.3-4.5" />
    <path d="M11.4 18.6h3.4c2.6 0 4.7-1.9 4.9-4.4" />
    <path d="M6.6 12.4 3.4 10l.9 3.4-1.2 2.6 3.5-1.2" />
    <path d="M11.4 18.6v2.2M14.6 18.6v2.2" />
    <path d="M17.4 7.1h.01" strokeWidth={2.2} />
  </Svg>
)

/** 飞行中的鸟（双弧） */
export const IconBirdFly = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.2 13.6c2.1-2.4 4.8-2.4 6.9 0 2.1-2.4 4.8-2.4 6.9 0" />
    <path d="M14.4 6.6c1.6-1.5 3.4-1.7 5.2-.6" />
  </Svg>
)

/** 蛋（未孵化的宠物） */
export const IconEgg = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.4c3.4 0 6.2 5.3 6.2 9.3a6.2 6.2 0 0 1-12.4 0c0-4 2.8-9.3 6.2-9.3Z" />
    <path d="M9.4 13.2c.4 1.6 1.5 2.5 3 2.7" />
  </Svg>
)

/** 信封（小鸟叼信） */
export const IconEnvelope = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.8 7.6A2.2 2.2 0 0 1 6 5.4h12a2.2 2.2 0 0 1 2.2 2.2v8.8a2.2 2.2 0 0 1-2.2 2.2H6a2.2 2.2 0 0 1-2.2-2.2V7.6Z" />
    <path d="M4.4 7.2 12 13l7.6-5.8" />
  </Svg>
)

/** 羽毛 */
export const IconFeather = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.6 4.4a5 5 0 0 0-7.1 0L5 11.9V19h7.1l7.5-7.5a5 5 0 0 0 0-7.1Z" />
    <path d="M16 8 5.6 18.4" />
    <path d="M14.2 10.6H8.6M12 8.4v5.6" />
  </Svg>
)

/** 山（旅行地标） */
export const IconMountain = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 19.6h18" />
    <path d="M4.6 19.6 11 8.2l3.1 5.6" />
    <path d="M12.8 19.6l3.6-6.4 4 6.4" />
  </Svg>
)

/** 指南针 */
export const IconCompass = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2Z" />
    <path d="M15.4 8.6l-1.9 5-5 1.9 1.9-5 5-1.9Z" />
  </Svg>
)

/* ============================================================
   奖励 / 状态
   ============================================================ */

export const IconCoin = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8Z" />
    <path d="M12 8.4c1.8 0 3.2 1.2 3.2 2.6S13.8 13.6 12 13.6s-3.2-1.2-3.2-2.6S10.2 8.4 12 8.4Z" />
    <path d="M12 13.6v2.2" />
  </Svg>
)

export const IconGift = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.4 11.4h15.2v7.4a1.8 1.8 0 0 1-1.8 1.8H6.2a1.8 1.8 0 0 1-1.8-1.8v-7.4Z" />
    <path d="M3.6 7.8h16.8v3.6H3.6V7.8Z" />
    <path d="M12 7.8v12.8" />
    <path d="M12 7.8S11 3.4 8.6 3.4a2.2 2.2 0 0 0 0 4.4H12ZM12 7.8s1-4.4 3.4-4.4a2.2 2.2 0 0 1 0 4.4H12Z" />
  </Svg>
)

export const IconTrophy = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 4.4h8v5a4 4 0 0 1-8 0v-5Z" />
    <path d="M8 5.6H5.6a1.4 1.4 0 0 0-1.4 1.4c0 2 1.4 3.4 3.8 3.6" />
    <path d="M16 5.6h2.4a1.4 1.4 0 0 1 1.4 1.4c0 2-1.4 3.4-3.8 3.6" />
    <path d="M12 13.4v3.2M8.6 20.4h6.8l-.8-3.8H9.4l-.8 3.8Z" />
  </Svg>
)

export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.4 5.4 5.8v5.4c0 4.2 2.8 7.6 6.6 9.4 3.8-1.8 6.6-5.2 6.6-9.4V5.8L12 3.4Z" />
    <path d="M9.2 11.8l2 2 3.6-4" />
  </Svg>
)

export const IconFlame = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.2c3 3.2 5.6 5.6 5.6 9.4a5.6 5.6 0 0 1-11.2 0c0-2 .9-3.6 2.2-5" />
    <path d="M12 20.6a2.8 2.8 0 0 0 2.8-2.8c0-1.7-1.3-2.6-2.8-4.6-1.5 2-2.8 2.9-2.8 4.6A2.8 2.8 0 0 0 12 20.6Z" />
  </Svg>
)

export const IconStar = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.6l2.6 5.4 5.8.8-4.2 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.2-4.1 5.8-.8L12 3.6Z" />
  </Svg>
)

export const IconStarFilled = (p: IconProps) => (
  <Svg {...p} filled>
    <path
      d="M12 3.6l2.6 5.4 5.8.8-4.2 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.2-4.1 5.8-.8L12 3.6Z"
      stroke="none"
    />
  </Svg>
)

export const IconHeart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20.2s-7.4-4.4-7.4-9.4a4.2 4.2 0 0 1 7.4-2.8 4.2 4.2 0 0 1 7.4 2.8c0 5-7.4 9.4-7.4 9.4Z" />
  </Svg>
)

export const IconSparkle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 3.4l1.7 5.2 5.2 1.7-5.2 1.7L11 17.2 9.3 12 4.1 10.3l5.2-1.7L11 3.4Z" />
    <path d="M18.4 15.4l.8 2.3 2.3.8-2.3.8-.8 2.3-.8-2.3-2.3-.8 2.3-.8.8-2.3Z" />
  </Svg>
)

/** AI / 魔法：四角星加双闪 */
export const IconMagic = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.4 3.6l1.4 4.2 4.2 1.4-4.2 1.4L9.4 14.8 8 10.6 3.8 9.2 8 7.8l1.4-4.2Z" />
    <path d="M17.4 12.4l.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9.9-2.7Z" />
  </Svg>
)

export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 9.6a6 6 0 0 0-12 0c0 5-2 6.4-2 6.4h16s-2-1.4-2-6.4Z" />
    <path d="M13.7 19.4a2 2 0 0 1-3.4 0" />
  </Svg>
)

export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8Z" />
    <path d="M12 7.6V12l3 1.8" />
  </Svg>
)

export const IconCalendar = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.4 6.4h13.2a1.6 1.6 0 0 1 1.6 1.6v10a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6V8a1.6 1.6 0 0 1 1.6-1.6Z" />
    <path d="M4 10.6h16M8.6 3.8v3.4M15.4 3.8v3.4" />
  </Svg>
)

/* ============================================================
   界面操作
   ============================================================ */

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 4.4a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 0 0 0-13.2Z" />
    <path d="M15.9 15.9l4.1 4.1" />
  </Svg>
)

/** 设置：推子（比齿轮更精致，也更符合"调节"的语义） */
export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8.4h8.6M17.6 8.4h2.4M4 15.6h3.4M12.4 15.6h7.6" />
    <path d="M15 8.4a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0Z" />
    <path d="M9.8 15.6a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0Z" />
  </Svg>
)

export const IconChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.6 5.6 8.2 12l6.4 6.4" />
  </Svg>
)

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.4 5.6 15.8 12l-6.4 6.4" />
  </Svg>
)

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.6 9.4 12 15.8l6.4-6.4" />
  </Svg>
)

export const IconChevronUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.6 14.6 12 8.2l6.4 6.4" />
  </Svg>
)

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.4 12h15.2" />
    <path d="M13.6 6l6 6-6 6" />
  </Svg>
)

export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.6 12H4.4" />
    <path d="M10.4 6l-6 6 6 6" />
  </Svg>
)

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5.4v13.2M5.4 12h13.2" />
  </Svg>
)

export const IconMinus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.4 12h13.2" />
  </Svg>
)

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.8 12.6l4.8 4.8 9.6-11" />
  </Svg>
)

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.6 6.8h14.8" />
    <path d="M9 6.8V4.9a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 4.9v1.9" />
    <path d="M6.4 6.8l.9 11.5a1.8 1.8 0 0 0 1.8 1.7h5.8a1.8 1.8 0 0 0 1.8-1.7l.9-11.5" />
    <path d="M10.4 10.6v5.8M13.6 10.6v5.8" />
  </Svg>
)

export const IconEdit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.6 19.4h3.2l10-10a2.3 2.3 0 0 0-3.2-3.2l-10 10v3.2Z" />
    <path d="M14.2 7.4l2.4 2.4" />
  </Svg>
)

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.4 10.6h11.2a1.4 1.4 0 0 1 1.4 1.4v6.6a1.4 1.4 0 0 1-1.4 1.4H6.4A1.4 1.4 0 0 1 5 18.6V12a1.4 1.4 0 0 1 1.4-1.4Z" />
    <path d="M8.4 10.6V7.8a3.6 3.6 0 0 1 7.2 0v2.8" />
    <path d="M12 14.6v2.4" />
  </Svg>
)

export const IconUnlock = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.4 10.6h11.2a1.4 1.4 0 0 1 1.4 1.4v6.6a1.4 1.4 0 0 1-1.4 1.4H6.4A1.4 1.4 0 0 1 5 18.6V12a1.4 1.4 0 0 1 1.4-1.4Z" />
    <path d="M8.4 10.6V7.8a3.6 3.6 0 0 1 6.6-2" />
    <path d="M12 14.6v2.4" />
  </Svg>
)

export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.8 12S6.4 5.8 12 5.8 21.2 12 21.2 12 17.6 18.2 12 18.2 2.8 12 2.8 12Z" />
    <path d="M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z" />
  </Svg>
)

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20.4 4.4v4.2h-4.2" />
  </Svg>
)

/** 骰子：随机抽题 */
export const IconDice = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="3.4" />
    <path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01M12 12h.01" strokeWidth={2.2} />
  </Svg>
)

export const IconFilter = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6.4h16l-6.2 7.2v5.2l-3.6 1.8v-7L4 6.4Z" />
  </Svg>
)

export const IconSort = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.4 4.6v14.8M4 15.8l3.4 3.6 3.4-3.6" />
    <path d="M16.6 19.4V4.6M13.2 8.2l3.4-3.6 3.4 3.6" />
  </Svg>
)

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.8v11.4" />
    <path d="M7.6 10.8 12 15.2l4.4-4.4" />
    <path d="M4.4 19.4h15.2" />
  </Svg>
)

export const IconUpload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15.4V4" />
    <path d="M7.6 8.4 12 4l4.4 4.4" />
    <path d="M4.4 19.4h15.2" />
  </Svg>
)

export const IconShare = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15.4V3.8" />
    <path d="M7.6 8.2 12 3.8l4.4 4.4" />
    <path d="M5.6 12.4v6.2a1.6 1.6 0 0 0 1.6 1.6h9.6a1.6 1.6 0 0 0 1.6-1.6v-6.2" />
  </Svg>
)

export const IconInfo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8Z" />
    <path d="M12 11v5.4M12 7.8h.01" strokeWidth={2} />
  </Svg>
)

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.6 4.4 3.2 17.2A1.6 1.6 0 0 0 4.6 19.6h14.8a1.6 1.6 0 0 0 1.4-2.4L13.4 4.4a1.6 1.6 0 0 0-2.8 0Z" />
    <path d="M12 9.4v4.2M12 16.6h.01" strokeWidth={2} />
  </Svg>
)

export const IconQuestion = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8Z" />
    <path d="M9.6 9.6a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2.5-2.5 2.5" />
    <path d="M12 16.4h.01" strokeWidth={2} />
  </Svg>
)

export const IconMore = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={2.4} />
  </Svg>
)

export const IconUser = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 12.2a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6Z" />
    <path d="M4.8 20.4a7.2 7.2 0 0 1 14.4 0" />
  </Svg>
)

export const IconBackpack = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.4 10.4h11.2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6.4a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z" />
    <path d="M8.4 10.4V7.6a3.6 3.6 0 0 1 7.2 0v2.8" />
    <path d="M8.4 15.6h7.2" />
  </Svg>
)

export const IconCamera = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8.8h2.6l1.4-2.4h8l1.4 2.4H20a1.6 1.6 0 0 1 1.6 1.6v7a1.6 1.6 0 0 1-1.6 1.6H4a1.6 1.6 0 0 1-1.6-1.6v-7A1.6 1.6 0 0 1 4 8.8Z" />
    <path d="M12 16.4a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
  </Svg>
)

export const IconImage = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.4" y="5.4" width="17.2" height="13.2" rx="2.2" />
    <path d="M3.8 15.4l4.4-4.2 3.6 3.4 3-2.8 5.2 4.6" />
    <path d="M8.8 9.6h.01" strokeWidth={2.2} />
  </Svg>
)

export const IconHome = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.4 10.6 12 4.2l7.6 6.4v8.2a1.6 1.6 0 0 1-1.6 1.6H6a1.6 1.6 0 0 1-1.6-1.6v-8.2Z" />
    <path d="M9.6 20.4v-6h4.8v6" />
  </Svg>
)

export const IconMapPin = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20.6c3.6-4 5.6-7 5.6-9.8a5.6 5.6 0 1 0-11.2 0c0 2.8 2 5.8 5.6 9.8Z" />
    <path d="M12 12.8a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" />
  </Svg>
)

export const IconRoute = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.4 19.4a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z" />
    <path d="M17.6 9.8a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z" />
    <path d="M15 9.8H9.6a3.2 3.2 0 0 0 0 6.4h4.8" />
  </Svg>
)

export const IconPaw = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.4 12.2a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8ZM15.6 12.2a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8Z" />
    <path d="M5.6 17a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4ZM18.4 17a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z" />
    <path d="M12 20.4c2.4 0 4.2-1.3 4.2-3s-1.9-3.4-4.2-3.4-4.2 1.6-4.2 3.4 1.8 3 4.2 3Z" />
  </Svg>
)

export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 16.4a4.4 4.4 0 1 0 0-8.8 4.4 4.4 0 0 0 0 8.8Z" />
    <path d="M12 2.6v2.2M12 19.2v2.2M4.4 12H2.2M21.8 12h-2.2M6.6 6.6 5 5M19 19l-1.6-1.6M17.4 6.6 19 5M5 19l1.6-1.6" />
  </Svg>
)

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.4 14.2A8.6 8.6 0 0 1 9.8 3.6a8.6 8.6 0 1 0 10.6 10.6Z" />
  </Svg>
)

export const IconCloud = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.4 18.6h10a4 4 0 0 0 .4-8A5.6 5.6 0 0 0 7 9.2a4.7 4.7 0 0 0 .4 9.4Z" />
  </Svg>
)

export const IconRain = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.4 15.4h10a4 4 0 0 0 .4-8A5.6 5.6 0 0 0 7 6a4.7 4.7 0 0 0 .4 9.4Z" />
    <path d="M9 18.4l-.8 2.4M12.4 18.4l-.8 2.4M15.8 18.4l-.8 2.4" />
  </Svg>
)

export const IconSnow = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.4 15.4h10a4 4 0 0 0 .4-8A5.6 5.6 0 0 0 7 6a4.7 4.7 0 0 0 .4 9.4Z" />
    <path d="M9 18.6h.01M12.4 20h.01M15.8 18.6h.01" strokeWidth={2.2} />
  </Svg>
)

export const IconWind = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.4 8.6h10.2a2.6 2.6 0 1 0-2.6-2.6" />
    <path d="M3.4 12.4h13.4a2.6 2.6 0 1 1-2.6 2.6" />
    <path d="M3.4 16.2h6.4" />
  </Svg>
)

export const IconInk = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.6c2.8 3.2 4.8 5.8 4.8 8.4a4.8 4.8 0 0 1-9.6 0c0-2.6 2-5.2 4.8-8.4Z" />
    <path d="M8.6 20.4h6.8" />
  </Svg>
)

export const IconBookmark = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.4 4.4h11.2v16l-5.6-3.8-5.6 3.8v-16Z" />
  </Svg>
)

export const IconFolder = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.6 7.4a2 2 0 0 1 2-2h3.4l2 2.4h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2V7.4Z" />
  </Svg>
)

export const IconGlobe = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8Z" />
    <path d="M3.8 12h16.4" />
    <path d="M12 3.6c2.2 2.4 3.4 5.3 3.4 8.4s-1.2 6-3.4 8.4c-2.2-2.4-3.4-5.3-3.4-8.4s1.2-6 3.4-8.4Z" />
  </Svg>
)

export const IconLightbulb = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.4 17.4a5.6 5.6 0 1 1 5.2 0v1.4a1.4 1.4 0 0 1-1.4 1.4h-2.4a1.4 1.4 0 0 1-1.4-1.4v-1.4Z" />
    <path d="M9.8 17.4h4.4" />
  </Svg>
)

export const IconCrown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.4 17.4h15.2" />
    <path d="M4.4 17.4 3.2 7.6l4.8 3.6L12 5l4 6.2 4.8-3.6-1.2 9.8" />
  </Svg>
)

export const IconWave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.4 12c1.6 0 1.6-3.4 3.2-3.4S8.2 15.4 9.8 15.4 11.4 8.6 13 8.6s1.6 6.8 3.2 6.8 1.6-3.4 3.2-3.4" />
  </Svg>
)

/* ============================================================
   v3 新增 —— 沉浸写作 / 旅行 / 成长树 需要的一套
   ============================================================ */

/** 扳手：说修改 */
export const IconWrench = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.2 3.6a5.2 5.2 0 0 0-4.9 7l-6.5 6.5a1.9 1.9 0 0 0 2.7 2.7l6.5-6.5a5.2 5.2 0 0 0 6.4-6.6l-3 3-2.6-.5-.5-2.6 2.9-3Z" />
  </Svg>
)

/** 树洞：树干上的一个洞 */
export const IconTreeHollow = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21v-6.4" />
    <path d="M12 14.6c0-2 1.6-3.4 3.6-3.4" />
    <path d="M12 13.8c0-1.8-1.5-3.2-3.4-3.2" />
    <path d="M7 21v-8.2A5 5 0 0 1 12 7.8a5 5 0 0 1 5 5V21" />
    <path d="M4.4 21h15.2" />
    <circle cx="12" cy="15.4" r="1.5" />
  </Svg>
)

/** 鸟：站在树枝上 */
export const IconBirdSitting = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.6 17.6h16.8" />
    <path d="M14.6 6.4a3 3 0 1 0-4.6 2.5v3.3a3.6 3.6 0 0 0 3.6 3.6h1.6" />
    <path d="M10 9.4 6.8 8.2l2.4-2" />
    <path d="M15.2 13.2a2.6 2.6 0 0 0 2.6-2.6" />
  </Svg>
)

/** 照片：旅行带回的风景照 */
export const IconPhoto = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.2" />
    <circle cx="8.6" cy="9.6" r="1.6" />
    <path d="M3.9 16.4l4.4-4.2 3.5 3.4 2.7-2.4 5.4 5" />
  </Svg>
)

/** 信封：小鸟叼来的信 */
export const IconEnvelopeOpen = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.6 10.2 12 4.6l8.4 5.6v8.4a1.4 1.4 0 0 1-1.4 1.4H5a1.4 1.4 0 0 1-1.4-1.4v-8.4Z" />
    <path d="M3.6 10.2 12 15l8.4-4.8" />
  </Svg>
)

/** 种子：地图上发芽的前身 */
export const IconSeedling = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20.4v-7" />
    <path d="M12 13.4C12 10.4 9.6 8 6.6 8c0 3 2.4 5.4 5.4 5.4Z" />
    <path d="M12 13.4c0-3 2.4-5.4 5.4-5.4 0 3-2.4 5.4-5.4 5.4Z" />
    <path d="M6.4 20.4h11.2" />
  </Svg>
)

/** 地图：中国地图 / 旅行图 */
export const IconMapOutline = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.4 6.4 9 4.4v13.2l-5.6 2z" />
    <path d="M9 4.4l6 2.2v13.2L9 17.6z" />
    <path d="M15 6.6l5.6-2v13.2l-5.6 2z" />
  </Svg>
)

/** 时间/时钟：产出倒计时 */
export const IconHourglass = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.6 3.6h10.8" />
    <path d="M6.6 20.4h10.8" />
    <path d="M7.4 3.6v3.2c0 2.6 4.6 3.4 4.6 5.2s-4.6 2.6-4.6 5.2v3.2" />
    <path d="M16.6 3.6v3.2c0 2.6-4.6 3.4-4.6 5.2s4.6 2.6 4.6 5.2v3.2" />
  </Svg>
)

/** 收获篮：收集树上产出 */
export const IconHarvest = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.4 9.4h15.2l-1.6 9.2a1.4 1.4 0 0 1-1.4 1.2H7.4a1.4 1.4 0 0 1-1.4-1.2z" />
    <path d="M8.6 9.4 12 3.8l3.4 5.6" />
    <path d="M9.6 13.4v3.6M14.4 13.4v3.6" />
  </Svg>
)

/** 挂锁：日记封存 */
export const IconSeal = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="10.4" r="4.4" />
    <path d="M9.4 14.2 8 20.4l4-2.2 4 2.2-1.4-6.2" />
  </Svg>
)

/** 月亮：夜晚场景 */
export const IconMoonLit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.4A8.4 8.4 0 0 1 9.6 4a8.4 8.4 0 1 0 10.4 10.4Z" />
  </Svg>
)

/** 羽毛笔：写作 */
export const IconQuill = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20.4c0-8 5.2-13 13.4-14.4" />
    <path d="M17.4 6c.6 4.6-2.8 8.6-7.4 9.4" />
    <path d="M10 15.4c-2.4.6-4 2.2-4.6 4.4" />
  </Svg>
)
