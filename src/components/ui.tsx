/* ============================================================
   通用 UI 组件  v4 —— 清亮纸感 · 深色沉浸
   ============================================================
   设计约束（全项目统一）：
     · 层次靠「发丝边 + 极轻投影」，绝不粗描边、绝不硬投影
     · 可点区域最小 44px，主操作 56px+
     · 强调色只给主操作与奖励，其余一律中性色
     · 图标一律用自绘线性图标（./icons），绝不拿 emoji 当图标
     · 支持两种世界：纸面（默认）与墨夜（ink）

   ★ v4 追加：空状态和加载状态要有**小笔苗**（./Sprout）。
     家长说「有点老气，孩子不喜欢」—— 光换颜色不够，
     得有活的东西。空状态和加载是孩子最常盯着看的两处，
     所以角色先补在这两个共享组件上，改一处全 App 生效。
     用法：`<EmptyState mood="sleepy" …/>`，不传 mood 就还是老样子。
   ============================================================ */

import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { playSound, unlockAudio } from '../platform/sound'
import { tapFeedback } from '../platform/haptics'
import { IconCheck, IconClose, IconStar, IconStarFilled } from './icons'
import { Sprout } from './Sprout'
import type { SproutMood } from './Sprout'

/**
 * 弹层一律挂到 document.body 上。
 *
 * 为什么必须这样：页面外壳用了 anim-fade-in 之类的入场动画，
 * 动画结束后 transform 仍然保留（fill-mode: both），而任何非 none 的
 * transform 都会让元素成为 fixed 定位的包含块 —— 于是 position:fixed
 * 的弹层会被限制在外壳容器里，跑到屏幕外面去。
 * 挂到 body 上就彻底绕开了这个问题。
 */
function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

/* ============================================================
   色调系统
   ------------------------------------------------------------
   v3 把「色调」收敛成一套受控枚举，组件不能再随手写颜色。
   每个色调都提供 paper / ink 两套（白纸世界 vs 墨夜世界）。
   ============================================================ */

export type Tone = 'neutral' | 'leaf' | 'amber' | 'mist' | 'moss' | 'clay' | 'danger'

/** 纸面世界的色调：淡底 + 深字 */
const TONE_PAPER: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700',
  leaf: 'bg-inkleaf-100 text-inkleaf-700',
  amber: 'bg-amber-leaf-100 text-amber-leaf-700',
  mist: 'bg-mist-100 text-mist-600',
  moss: 'bg-moss-100 text-moss-600',
  clay: 'bg-clay-100 text-clay-600',
  danger: 'bg-clay-100 text-danger',
}

/** 墨夜世界的色调：极淡白底 + 亮字 */
const TONE_INK: Record<Tone, string> = {
  neutral: 'bg-white/10 text-[var(--color-night-text-2)]',
  leaf: 'bg-inkleaf-300/20 text-inkleaf-200',
  amber: 'bg-amber-leaf-300/20 text-amber-leaf-200',
  mist: 'bg-mist-300/20 text-mist-200',
  moss: 'bg-moss-300/20 text-moss-200',
  clay: 'bg-clay-300/20 text-clay-200',
  danger: 'bg-[rgb(168_80_63/0.25)] text-[#e8b3a6]',
}

/* ============================================================
   按钮
   ============================================================ */

type ButtonTone = 'primary' | 'plain' | 'ghost' | 'quiet' | 'danger' | 'reward' | 'tone'

const BUTTON_TONE: Record<ButtonTone, string> = {
  // 全 App 最重的颜色，只给"主行动"
  primary: 'btn-primary',
  // 白面 + 发丝边，最常用
  plain: 'bg-white text-ink-800 shadow-[var(--hair-strong)]',
  ghost: 'bg-transparent text-ink-600',
  quiet: 'bg-ink-50 text-ink-700 shadow-[var(--hair)]',
  danger: 'bg-clay-100 text-danger shadow-[inset_0_0_0_1px_rgb(168_80_63/0.2)]',
  // 收获 / 领取
  reward: 'btn-reward',
  tone: 'bg-inkleaf-50 text-inkleaf-700 shadow-[var(--hair-leaf)]',
}

export function Button({
  children,
  onClick,
  tone = 'plain',
  size = 'md',
  disabled,
  full,
  className = '',
  ariaLabel,
  icon,
}: {
  children: ReactNode
  onClick?: () => void
  tone?: ButtonTone
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  full?: boolean
  className?: string
  ariaLabel?: string
  icon?: ReactNode
}) {
  const sizeClass =
    size === 'sm'
      ? 'px-3 py-2 text-xs min-h-[44px] gap-1.5'
      : size === 'lg'
        ? 'px-6 py-4 text-lg min-h-[58px] gap-2.5'
        : 'px-4 py-3 text-sm min-h-[48px] gap-2'

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        // 首次点击时解锁音频，否则音效在移动端不会响
        unlockAudio()
        playSound('tap')
        tapFeedback()
        onClick?.()
      }}
      className={`btn-base active:btn-press inline-flex items-center justify-center font-semibold ${sizeClass} ${
        BUTTON_TONE[tone]
      } ${full ? 'w-full' : ''} ${
        disabled ? 'pointer-events-none opacity-40' : ''
      } ${className}`}
    >
      {icon}
      {children}
    </button>
  )
}

/** 纯图标按钮（头部工具位、关闭等） */
export function IconButton({
  children,
  onClick,
  ariaLabel,
  className = '',
  size = 40,
  tone = 'paper',
}: {
  children: ReactNode
  onClick?: () => void
  ariaLabel: string
  className?: string
  size?: number
  tone?: 'paper' | 'ink' | 'bare'
}) {
  const base =
    tone === 'ink'
      ? 'bg-white/[0.08] text-[var(--color-night-text-2)] shadow-[var(--hair-light)]'
      : tone === 'bare'
        ? 'bg-transparent text-ink-500'
        : 'bg-white text-ink-600 shadow-[var(--hair-strong)]'

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => {
        unlockAudio()
        playSound('tap-soft')
        tapFeedback()
        onClick?.()
      }}
      style={{ width: size, height: size }}
      className={`btn-base active:btn-press grid shrink-0 place-items-center rounded-full ${base} ${className}`}
    >
      {children}
    </button>
  )
}

/* ============================================================
   面 / 卡片
   ============================================================ */

export function Card({
  children,
  className = '',
  paper,
  tone = 'white',
  padded = true,
  pad,
}: {
  children: ReactNode
  className?: string
  /** 兼容旧用法 */
  paper?: boolean
  tone?: 'white' | 'tint' | 'accent' | 'reward'
  padded?: boolean
  /** 自定义内边距，优先于 padded */
  pad?: string
}) {
  const base =
    tone === 'accent'
      ? 'surface-accent'
      : tone === 'reward'
        ? 'surface-reward'
        : tone === 'tint' || paper
          ? 'surface-2'
          : 'surface'
  const padding = pad ?? (padded ? 'p-4' : '')
  return <div className={`${base} ${padding} ${className}`}>{children}</div>
}

/** 墨夜世界的卡片（writing / hollow 场景用） */
export function InkCard({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <div className={`surface-ink ${padded ? 'p-4' : ''} ${className}`}>{children}</div>
  )
}

/* ============================================================
   区块标题
   ============================================================ */

export function SectionTitle({
  emoji,
  title,
  sub,
  right,
  icon,
  tone = 'leaf',
  ink,
}: {
  /** 兼容旧用法，新代码请用 icon */
  emoji?: string
  title: string
  sub?: string
  right?: ReactNode
  icon?: ReactNode
  tone?: Tone
  /** 墨夜场景 */
  ink?: boolean
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      {(icon || emoji) && (
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${
            ink ? TONE_INK[tone] : TONE_PAPER[tone]
          }`}
        >
          {icon ?? <span className="text-base leading-none">{emoji}</span>}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2
          className={`font-display text-lg font-bold leading-tight tracking-tight ${
            ink ? 'text-[var(--color-night-text)]' : 'text-ink-900'
          }`}
        >
          {title}
        </h2>
        {sub && (
          <p
            className={`mt-0.5 text-xs leading-relaxed ${
              ink ? 'text-[var(--color-night-text-3)]' : 'text-ink-500'
            }`}
          >
            {sub}
          </p>
        )}
      </div>
      {right}
    </div>
  )
}

/* ============================================================
   标签 / 徽章
   ============================================================ */

export function Chip({
  children,
  active,
  onClick,
  className = '',
  icon,
  ink,
}: {
  children: ReactNode
  active?: boolean
  onClick?: () => void
  className?: string
  icon?: ReactNode
  ink?: boolean
}) {
  const interactive = Boolean(onClick)

  const skin = active
    ? ink
      ? 'bg-inkleaf-300/25 text-inkleaf-100 shadow-[var(--hair-light-strong)]'
      : 'bg-inkleaf-600 text-white shadow-[0_6px_16px_-8px_rgb(9_71_46/0.55)]'
    : ink
      ? 'bg-white/[0.06] text-[var(--color-night-text-2)] shadow-[var(--hair-light)]'
      : 'bg-white text-ink-600 shadow-[var(--hair-strong)]'

  return (
    <button
      type="button"
      onClick={
        interactive
          ? () => {
              playSound('tap-soft')
              tapFeedback()
              onClick?.()
            }
          : undefined
      }
      disabled={!interactive}
      className={`inline-flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-sm font-semibold transition-colors duration-150 ${skin} ${
        interactive ? 'btn-base active:btn-press min-h-[40px]' : ''
      } ${className}`}
    >
      {icon}
      {children}
    </button>
  )
}

/** 小圆角标签，用于「稀有」「预测」这类状态 */
export function Badge({
  children,
  tone = 'neutral',
  status,
  className = '',
}: {
  children: ReactNode
  tone?: Tone
  /** 兼容旧色调名 */
  status?: 'neutral' | 'sprout' | 'sun' | 'sky' | 'grape' | 'blossom'
  className?: string
}) {
  const legacyMap: Record<string, Tone> = {
    neutral: 'neutral',
    sprout: 'leaf',
    sun: 'amber',
    sky: 'mist',
    grape: 'moss',
    blossom: 'danger',
  }
  const t: Tone = status ? legacyMap[status] : tone
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-2xs font-bold tracking-wide ${TONE_PAPER[t]} ${className}`}
    >
      {children}
    </span>
  )
}

/* ============================================================
   分段控件
   ============================================================ */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = '',
  ink,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
  ink?: boolean
}) {
  return (
    <div
      className={`inline-flex rounded-btn p-1 ${
        ink
          ? 'bg-black/25 shadow-[var(--hair-light)]'
          : 'bg-ink-50 shadow-[inset_0_0_0_1px_rgb(18_23_20/0.05)]'
      } ${className}`}
    >
      {options.map((o) => {
        const on = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              playSound('tap-soft')
              tapFeedback()
              onChange(o.value)
            }}
            className={`rounded-sm px-3 py-1.5 text-xs font-semibold transition-all duration-150 ${
              on
                ? ink
                  ? 'bg-white/[0.14] text-[var(--color-night-text)]'
                  : 'bg-white text-ink-900 shadow-[var(--hair)]'
                : ink
                  ? 'text-[var(--color-night-text-3)]'
                  : 'text-ink-500'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/* ============================================================
   进度条
   ============================================================ */

export function ProgressBar({
  value,
  max = 100,
  tone = 'leaf',
  height = 8,
  showLabel,
  className = '',
  ink,
}: {
  value: number
  max?: number
  tone?: 'leaf' | 'amber' | 'mist' | 'moss' | 'clay'
  height?: number
  showLabel?: boolean
  className?: string
  ink?: boolean
}) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  const fill: Record<string, string> = {
    leaf: 'bg-inkleaf-500',
    amber: 'bg-amber-leaf-400',
    mist: 'bg-mist-400',
    moss: 'bg-moss-400',
    clay: 'bg-clay-400',
  }
  return (
    <div className={className}>
      <div
        className={`w-full overflow-hidden rounded-pill ${
          ink ? 'bg-white/[0.09]' : 'bg-ink-150'
        }`}
        style={{ height }}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-pill ${fill[tone]} transition-[width] duration-700 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <div
          className={`tnum mt-1 text-right text-xs font-semibold ${
            ink ? 'text-[var(--color-night-text-3)]' : 'text-ink-500'
          }`}
        >
          {Math.round(value)} / {max}
        </div>
      )}
    </div>
  )
}

/* ============================================================
   星级
   ============================================================ */

export function Stars({ count, size = 'md' }: { count: number; size?: 'sm' | 'md' | 'lg' }) {
  const px = size === 'sm' ? 14 : size === 'lg' ? 30 : 20
  return (
    <div className="inline-flex gap-1" aria-label={`${count} 星`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`inline-flex ${i <= count ? 'anim-pop text-amber-leaf-400' : 'text-ink-200'}`}
          style={{ animationDelay: `${i * 0.07}s` }}
        >
          {i <= count ? <IconStarFilled size={px} /> : <IconStar size={px} />}
        </span>
      ))}
    </div>
  )
}

/* ============================================================
   空状态
   ============================================================ */

export function EmptyState({
  emoji,
  title,
  desc,
  action,
  icon,
  mood,
  ink,
}: {
  /** 兼容旧用法，新代码请用 icon */
  emoji?: string
  title: string
  desc?: string
  action?: ReactNode
  icon?: ReactNode
  /**
   * ★ 传了就由**小笔苗**来站台（见 ./Sprout）。
   * 空状态是孩子最常盯着看的地方之一 —— 一张静态图标填不满它，
   * 一个活的小东西可以。不传则维持原来的图标样式。
   *
   * ⚠️ 什么时候**不**传（2026-09-18 定的规矩，别破坏）：
   *   1. **筛选没匹配到**（「没有找到符合条件的题」/「这个条件下没有卡」）
   *      不传 —— 那是"你的条件太窄了"的**工具提示**，不是邀请，
   *      放个笑嘻嘻的角色反而像在嘲笑人。**只给「还空着，来开始吧」的邀请态。**
   *   2. **同一屏已经有小笔苗了就不再加** —— 日记页就是例子：
   *      「今天还没写呢」有大只的，「以前的日记」就留小图标。
   *      两个 104px 的角色同屏，角色就从"惊喜"变成"墙纸"了。
   */
  mood?: SproutMood
  /** 放在 .scene-ink 里时传 true，小笔苗会换成夜色配色 */
  ink?: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center anim-rise-in">
      {mood ? (
        <Sprout size={104} mood={mood} ink={ink} className="mb-0.5" />
      ) : (
        <div className="grid h-16 w-16 place-items-center rounded-full bg-inkleaf-50 text-inkleaf-400 shadow-[var(--hair-leaf)]">
          {icon ?? <span className="text-3xl leading-none">{emoji}</span>}
        </div>
      )}
      <h3 className="font-display text-lg font-bold tracking-tight text-ink-900">{title}</h3>
      {desc && <p className="max-w-xs text-sm leading-relaxed text-ink-500">{desc}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

/* ============================================================
   底部抽屉
   ============================================================ */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
}) {
  // 打开时锁滚动，避免背景跟着动
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-end justify-center">
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="absolute inset-0 bg-ink-950/40 backdrop-blur-[3px]"
        />
        <div className="relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col rounded-t-[1.375rem] bg-paper shadow-[var(--shadow-tier-4)] anim-rise-in">
          <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-pill bg-ink-200" />
          <div className="flex items-center gap-2 px-5 pb-3 pt-2.5">
            <h2 className="min-w-0 flex-1 truncate font-display text-lg font-bold tracking-tight text-ink-900">
              {title}
            </h2>
            <IconButton ariaLabel="关闭" onClick={onClose} size={36}>
              <IconClose size={18} />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
            {children}
          </div>
          {footer && <div className="px-5 pb-4 pt-2 pb-safe">{footer}</div>}
        </div>
      </div>
    </Portal>
  )
}

/* ============================================================
   确认对话框
   ============================================================ */

export function ConfirmDialog({
  open,
  title,
  desc,
  verse,
  confirmText = '确定',
  cancelText = '再想想',
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  desc?: string
  /** 一段诗句式的提醒：用于不可逆操作（封存日记） */
  verse?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <Portal>
      <div className="fixed inset-0 z-[60] grid place-items-center px-6">
        <button
          type="button"
          aria-label="取消"
          onClick={onCancel}
          className="absolute inset-0 bg-ink-950/45 backdrop-blur-[3px]"
        />
        <div className="relative z-10 w-full max-w-sm rounded-panel bg-white p-5 shadow-[var(--shadow-tier-4)] anim-pop">
          <h3 className="font-display text-lg font-bold tracking-tight text-ink-900">{title}</h3>
          {desc && <p className="mt-2 text-sm leading-relaxed text-ink-600">{desc}</p>}
          {verse && (
            <p className="mt-3 rounded-md bg-ink-50 px-3.5 py-2.5 font-prose text-sm leading-loose text-ink-700">
              {verse}
            </p>
          )}
          <div className="mt-5 flex gap-2.5">
            <Button full tone="quiet" onClick={onCancel}>
              {cancelText}
            </Button>
            <Button full tone={danger ? 'danger' : 'primary'} onClick={onConfirm}>
              {confirmText}
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  )
}

/* ============================================================
   自动滚动到底部
   ============================================================ */

export function useAutoScroll<T extends HTMLElement>(deps: unknown[]) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

/* ============================================================
   数字滚动（金币增长动效）
   ============================================================ */

export function CountUp({ value, className = '' }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef(value)

  useEffect(() => {
    const from = prev.current
    const to = value
    prev.current = value
    if (from === to) return

    const el = ref.current
    if (!el) return

    const dur = 620
    const t0 = performance.now()
    let raf = 0

    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      // 缓出，末段慢下来更有"数钱"的感觉
      const eased = 1 - Math.pow(1 - p, 3)
      el.textContent = String(Math.round(from + (to - from) * eased))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])

  return (
    <span ref={ref} className={`tnum ${className}`}>
      {value}
    </span>
  )
}

/* ============================================================
   数据小格
   ============================================================ */

export function StatTile({
  label,
  value,
  icon,
  tone = 'neutral',
  ink,
}: {
  label: string
  value: ReactNode
  icon?: ReactNode
  tone?: Tone
  ink?: boolean
}) {
  const color: Record<Tone, string> = {
    neutral: ink ? 'text-[var(--color-night-text-3)]' : 'text-ink-500',
    leaf: ink ? 'text-inkleaf-300' : 'text-inkleaf-600',
    amber: ink ? 'text-amber-leaf-300' : 'text-amber-leaf-500',
    mist: ink ? 'text-mist-300' : 'text-mist-500',
    moss: ink ? 'text-moss-300' : 'text-moss-500',
    clay: ink ? 'text-clay-300' : 'text-clay-500',
    danger: ink ? 'text-[#e8b3a6]' : 'text-danger',
  }
  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-card px-2 py-3 ${
        ink ? 'surface-ink' : 'surface'
      }`}
    >
      {icon && <span className={color[tone]}>{icon}</span>}
      <div
        className={`tnum font-display text-xl font-bold leading-none tracking-tight ${
          ink ? 'text-[var(--color-night-text)]' : 'text-ink-900'
        }`}
      >
        {value}
      </div>
      <div
        className={`text-2xs font-medium ${
          ink ? 'text-[var(--color-night-text-3)]' : 'text-ink-500'
        }`}
      >
        {label}
      </div>
    </div>
  )
}

/* ============================================================
   加载态
   ============================================================ */

/**
 * 等待中的一行提示。
 *
 * ★ v4：左边换成**正在想事情的小笔苗**。
 * 这是孩子盯着看最久的一处（生成点评 / 写更好的写法都要等），
 * 三个点的跳动只能说明「还没好」，一个在想事情的角色能说明「在为你忙」。
 */
export function LoadingLine({
  text,
  ink,
  mood = 'thinking',
}: {
  text: string
  ink?: boolean
  /** 不传就是「正在想事情」 */
  mood?: SproutMood
}) {
  return (
    <div
      className={`flex items-center justify-center gap-2.5 py-6 text-sm font-medium ${
        ink ? 'text-[var(--color-night-text-2)]' : 'text-ink-600'
      }`}
    >
      {/* ⚠️ 48 是**下限**。小笔苗是圆脸 + 小眼睛的造型，
          低于 48px 脸就糊成一个点了（渲染出来对比过：
          56/48 认得出，34 认不出）。要改小先重新渲染
          `__sprout_gallery.test.tsx` 看一眼。 */}
      <Sprout size={48} mood={mood} ink={ink} />
      {text}
    </div>
  )
}

/* ============================================================
   对勾标记（列表项）
   ============================================================ */

export function TickRow({
  children,
  tone = 'leaf',
  ink,
}: {
  children: ReactNode
  tone?: Tone
  ink?: boolean
}) {
  const map: Record<Tone, string> = {
    neutral: ink ? TONE_INK.neutral : TONE_PAPER.neutral,
    leaf: ink ? TONE_INK.leaf : TONE_PAPER.leaf,
    amber: ink ? TONE_INK.amber : TONE_PAPER.amber,
    mist: ink ? TONE_INK.mist : TONE_PAPER.mist,
    moss: ink ? TONE_INK.moss : TONE_PAPER.moss,
    clay: ink ? TONE_INK.clay : TONE_PAPER.clay,
    danger: ink ? TONE_INK.danger : TONE_PAPER.danger,
  }
  return (
    <li className="flex gap-2.5">
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${map[tone]}`}>
        <IconCheck size={12} strokeWidth={2.6} />
      </span>
      <span
        className={`min-w-0 flex-1 text-sm leading-relaxed ${
          ink ? 'text-[var(--color-night-text-2)]' : 'text-ink-700'
        }`}
      >
        {children}
      </span>
    </li>
  )
}
