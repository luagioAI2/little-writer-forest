/* ============================================================
   文心卡 —— 角色卡面 + 掉落演出
   ============================================================
   这一版把卡从"物件"换成了"二次元角色"：
     · 立绘由 CharacterArt 按参数现画，零图片资源、完全离线
     · 稀有度用「1px 染色边 + 淡色底 + 角标」表达，
       不再用霓虹光晕 —— 那正是上一版"土"的根源
     · 史诗 / 传说的"贵"只靠一层极淡的斜向流光，
       克制到几乎看不见，才不廉价

   卡面从上到下：立绘（约 78%）+ 名牌（名字 / 称号 / 五维）
   ============================================================ */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CardDef, CardDrop, CardStats, OwnedCard, Rarity } from '../domain/types'
import { RARITIES } from '../domain/types'
import { CARD_STATS, cardDef, rarityMeta, totalPower } from '../domain/cards'
import { CharacterArt } from './CharacterArt'
import { Sprout } from './Sprout'
import { playRaritySound } from '../platform/sound'
import { celebrateFeedback } from '../platform/haptics'
import { Button, IconButton } from './ui'
import { IconBackpack, IconClose, IconLock, IconSparkle, IconStarFilled } from './icons'

/* ============================================================
   稀有度视觉 —— 全部是扁平处理
   ------------------------------------------------------------
   wash 是名牌底色，edge 是描边（低透明度染色），
   sheen 只给史诗 / 传说，且用极低不透明度，避免"廉价发光"。
   ============================================================ */

const RARITY_TONE: Record<
  Rarity,
  { color: string; wash: string; edge: string; sheen: boolean }
> = {
  common: { color: '#9aa5a0', wash: '#f5f7f6', edge: 'rgba(154,165,160,0.42)', sheen: false },
  fine: { color: '#3e7f5e', wash: '#f2f7f3', edge: 'rgba(62,127,94,0.40)', sheen: false },
  rare: { color: '#42779a', wash: '#f1f6fa', edge: 'rgba(66,119,154,0.44)', sheen: false },
  epic: { color: '#8c73c5', wash: '#f5f3fb', edge: 'rgba(140,115,197,0.48)', sheen: true },
  legend: { color: '#c98a2e', wash: '#fdf8ee', edge: 'rgba(201,138,46,0.52)', sheen: true },
}

/* 未获得的剪影：去色 + 压暗 + 轻微模糊，
   模糊是关键 —— 只压暗的话眼镜、眼睛还是看得见，等于把脸露了。 */
const LOCKED_FILTER = 'grayscale(1) brightness(0.42) blur(2px)'

/* ============================================================
   五维迷你属性条
   ------------------------------------------------------------
   窄卡上放不下「观察力」这种两字标签，用单字 + 竖条：
   五根柱子并排，一眼就能看出这张卡的强项在哪。
   ============================================================ */

function StatProfile({
  stats,
  color,
  className = '',
}: {
  stats: CardStats
  color: string
  className?: string
}) {
  return (
    <div className={`grid grid-cols-5 items-end gap-1 ${className}`}>
      {CARD_STATS.map(({ key, glyph }) => {
        const v = Math.max(0, Math.min(100, stats[key]))
        return (
          <div key={key} className="flex flex-col items-center gap-1">
            <span
              className="relative block w-full overflow-hidden rounded-[3px] bg-ink-100"
              style={{ height: 24 }}
            >
              <span
                className="absolute bottom-0 left-0 block w-full rounded-[3px]"
                style={{ height: `${v}%`, background: color, opacity: 0.82 }}
              />
            </span>
            <span className="text-[9px] font-medium leading-none text-ink-400">{glyph}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ============================================================
   卡面
   ============================================================ */

export function CardFace({
  def,
  size = 'md',
  locked,
  count,
  starred,
  className = '',
  onClick,
}: {
  def: CardDef
  /** sm：极紧凑（无属性）；md：网格内自适应宽度；lg：掉落演出用固定宽 */
  size?: 'sm' | 'md' | 'lg'
  /** 未获得时显示剪影 + 锁，绝不露出脸 */
  locked?: boolean
  count?: number
  starred?: boolean
  className?: string
  onClick?: () => void
}) {
  const tone = RARITY_TONE[def.rarity]
  const rm = rarityMeta(def.rarity)
  const Wrapper = onClick ? 'button' : 'div'
  const showStats = size !== 'sm'

  const widthClass = size === 'lg' ? 'w-[150px]' : size === 'sm' ? 'w-[86px]' : 'w-full'
  const nameSize = size === 'lg' ? 'text-sm' : size === 'sm' ? 'text-[10px]' : 'text-xs'
  const isHigh = def.rarity === 'epic' || def.rarity === 'legend'

  return (
    <Wrapper
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      aria-label={locked ? '还没遇见的角色' : `${def.name}（${rm.label}）· ${def.title}`}
      className={`group relative block overflow-hidden rounded-card text-left transition-transform duration-150 ${
        onClick ? 'active:scale-[0.975]' : ''
      } ${widthClass} ${className}`}
      style={{
        background: '#fff',
        border: `1px solid ${locked ? 'rgba(28,33,30,0.08)' : tone.edge}`,
        boxShadow: locked
          ? 'var(--hair)'
          : isHigh
            ? 'var(--hair), var(--shadow-tier-3)'
            : 'var(--hair), var(--shadow-tier-1)',
      }}
    >
      {/* ---------- 立绘区（约 78%） ---------- */}
      <div className="relative overflow-hidden" style={{ aspectRatio: '5 / 6' }}>
        <div
          className="h-full w-full"
          style={locked ? { filter: LOCKED_FILTER } : undefined}
        >
          <CharacterArt spec={def.character} uid={def.id} />
        </div>

        {/* 剪影上再压一层白纱，进一步吞掉五官 */}
        {locked && <span className="pointer-events-none absolute inset-0 bg-white/25" />}

        {/* 史诗 / 传说的斜向流光：极淡，只是一点"金属感" */}
        {tone.sheen && !locked && (
          <span className="pointer-events-none absolute inset-0 overflow-hidden">
            <span className="anim-shimmer absolute inset-0 block opacity-[0.32]" />
          </span>
        )}

        {/* 未获得：中央一把锁 */}
        {locked && (
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/70 text-ink-500 ring-1 ring-inset ring-ink-900/10 backdrop-blur-[2px]">
              <IconLock size={18} />
            </span>
          </span>
        )}

        {/* 左上：稀有度角标（一颗小宝石） */}
        <span
          className="absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white/85"
          style={{ background: locked ? '#b6bdb7' : tone.color }}
        />

        {/* 右上：叠星 / 数量 */}
        <span className="absolute right-1.5 top-1.5 flex flex-col items-end gap-1">
          {starred && !locked && (
            <span className="grid h-5 w-5 place-items-center rounded-full bg-white/92 text-amber-leaf-500 shadow-[var(--hair)]">
              <IconStarFilled size={12} />
            </span>
          )}
          {typeof count === 'number' && count > 1 && (
            <span className="tnum rounded-pill bg-ink-900/85 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">
              ×{count}
            </span>
          )}
        </span>
      </div>

      {/* ---------- 名牌 ---------- */}
      <div
        className="px-2 pb-2 pt-1.5"
        style={{ background: locked ? '#f5f6f5' : tone.wash }}
      >
        <div className="flex items-center gap-1">
          <span
            className={`min-w-0 flex-1 truncate font-display font-bold leading-tight text-ink-900 ${nameSize}`}
          >
            {locked ? '？？？' : def.name}
          </span>
          <span
            className="shrink-0 text-[9px] font-bold tracking-wide"
            style={{ color: locked ? '#b6bdb7' : tone.color }}
          >
            {rm.label}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[10px] leading-tight text-ink-500">
          {locked ? '还没遇见' : def.title}
        </div>
        {showStats && !locked && (
          <StatProfile stats={def.stats} color={tone.color} className="mt-1.5" />
        )}
      </div>
    </Wrapper>
  )
}

/* ============================================================
   掉落演出
   ------------------------------------------------------------
   演出分档：
     普通/优秀 → 依次弹出
     稀有以上 → 加冲击波
     传说     → 全屏暖光 + 震动
   每张卡揭晓时播对应稀有度的音效，让"出好卡"有听觉记忆。
   「收进背包」必须等全部揭晓后才渲染 —— 这是被 E2E 盯着的交互。
   ============================================================ */

export function CardDropOverlay({
  drops,
  onClose,
  title = '掉卡啦！',
}: {
  drops: CardDrop[]
  onClose: () => void
  title?: string
}) {
  const [revealed, setRevealed] = useState(0)

  // 依次揭晓：第一张 260ms，之后每张 420ms
  useEffect(() => {
    if (revealed >= drops.length) return
    const t = window.setTimeout(() => {
      const d = drops[revealed]
      if (d) {
        playRaritySound(d.rarity)
        if (d.rarity === 'legend' || d.rarity === 'epic') celebrateFeedback()
      }
      setRevealed((n) => n + 1)
    }, revealed === 0 ? 260 : 420)
    return () => window.clearTimeout(t)
  }, [revealed, drops])

  const done = revealed >= drops.length
  const hasLegend = drops.some((d) => d.rarity === 'legend')
  const hasEpic = drops.some((d) => d.rarity === 'epic')
  const hasRare = drops.some((d) => d.rarity === 'rare')

  // 用 portal 挂到 body：页面外壳 <main> 上有 anim-fade-in，
  // 动画结束后仍残留 transform，会让 fixed 定位以 <main> 为基准，
  // 弹层于是被居中到整页高度里、跑出屏幕。portal 出去才稳。
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center px-5">
      <button
        type="button"
        aria-label="关闭"
        onClick={done ? onClose : undefined}
        className="absolute inset-0 bg-ink-900/70 backdrop-blur-sm"
      />

      {/* 高稀有度的全屏氛围光：暖金 / 淡紫，不做刺眼光晕。
          ⚠️ 颜色要跟着稀有度令牌走（金 = rarity-legend，紫 = rarity-epic），
             否则改主题时这两团光会留在旧配色里 —— v3→v4 就漏过一次。
             紫光用 moss-400 而不是 moss-500：氛围光要比色块亮一档，
             用 500 会在深色遮罩上暗到看不见。 */}
      {(hasLegend || hasEpic) && (
        <div
          className="pointer-events-none absolute inset-0 anim-fade-in"
          style={{
            background: hasLegend
              ? 'radial-gradient(circle at 50% 45%, rgb(236 158 6 / 0.34) 0%, transparent 62%)'
              : 'radial-gradient(circle at 50% 45%, rgb(151 123 194 / 0.30) 0%, transparent 60%)',
          }}
        />
      )}

      <div className="relative z-10 flex w-full max-w-md flex-col items-center">
        {/* ★ 抽卡揭晓是小笔苗最该出现的地方 —— 它自己在欢呼。
            这里是深色遮罩（不是 .scene-ink），所以用 ink 配色。 */}
        {done && <Sprout size={96} mood="cheer" ink className="mb-1" />}
        <h2 className="mb-1 font-display text-2xl font-bold tracking-tight text-white">
          {done ? title : '……'}
        </h2>
        {done && (
          <p className="mb-4 text-sm font-medium text-white/80">
            {hasLegend
              ? '传说卡！这是最难遇见的一张。'
              : hasEpic
                ? '出史诗卡了，运气真好。'
                : hasRare
                  ? '稀有卡到手，继续加油。'
                  : '又遇见新角色啦。'}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3">
          {drops.map((d, i) => {
            const def = cardDef(d.defId)
            if (!def || i >= revealed) return null
            const tone = RARITY_TONE[d.rarity]
            return (
              <div key={i} className="relative anim-card-drop">
                {/* 冲击波 */}
                {(d.rarity === 'epic' || d.rarity === 'legend') && (
                  <span
                    className="pointer-events-none absolute inset-0 rounded-card anim-shockwave"
                    style={{ border: `2px solid ${tone.color}` }}
                  />
                )}
                <CardFace def={def} size="lg" />
                {d.isNew && (
                  <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-pill bg-inkleaf-600 px-2 py-0.5 text-[10px] font-bold text-white anim-pop">
                    NEW
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {done && (
          <div className="mt-7 w-full max-w-xs">
            <Button full tone="primary" size="lg" icon={<IconBackpack size={20} />} onClick={onClose}>
              收进背包
            </Button>
          </div>
        )}

        {!done && (
          <p className="tnum mt-6 text-xs font-medium text-white/60">
            {revealed} / {drops.length}
          </p>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ============================================================
   卡牌详情
   ============================================================ */

export function CardDetailSheet({
  def,
  owned,
  onClose,
}: {
  def: CardDef
  /** 背包里的持有记录；没有就是还没获得 */
  owned?: OwnedCard
  onClose: () => void
}) {
  const tone = RARITY_TONE[def.rarity]
  const rm = rarityMeta(def.rarity)
  const locked = !owned

  // 同样 portal 到 body，避免被 <main> 残留的 transform 带偏
  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-center justify-center px-6">
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/45 backdrop-blur-sm"
      />
      <div className="relative z-10 max-h-[88vh] w-full max-w-sm overflow-hidden overflow-y-auto rounded-card bg-white shadow-[var(--shadow-tier-4)] anim-pop">
        {/* 头部：大立绘 + 名字 */}
        <div className="flex gap-3 p-4" style={{ background: tone.wash }}>
          <div
            className="relative w-24 shrink-0 overflow-hidden rounded-lg"
            style={{ aspectRatio: '5 / 6', border: `1px solid ${tone.edge}` }}
          >
            <div
              className="h-full w-full"
              style={locked ? { filter: LOCKED_FILTER } : undefined}
            >
              <CharacterArt spec={def.character} uid={`detail-${def.id}`} />
            </div>
            {locked && <span className="pointer-events-none absolute inset-0 bg-white/25" />}
            {tone.sheen && !locked && (
              <span className="pointer-events-none absolute inset-0 overflow-hidden">
                <span className="anim-shimmer absolute inset-0 block opacity-30" />
              </span>
            )}
            {locked && (
              <span className="absolute inset-0 grid place-items-center text-ink-500">
                <IconLock size={20} />
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-display text-xl font-bold tracking-tight text-ink-900">
                  {locked ? '？？？' : def.name}
                </h3>
                <p className="mt-0.5 truncate text-xs text-ink-500">
                  {locked ? '还没遇见这位角色' : def.title}
                </p>
              </div>
              <IconButton ariaLabel="关闭" size={32} onClick={onClose}>
                <IconClose size={16} />
              </IconButton>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-bold tracking-wide text-white"
                style={{ background: tone.color }}
              >
                {rm.label}
              </span>
              {def.kind === 'special' && (
                <span className="inline-flex items-center gap-1 rounded-sm bg-moss-100 px-1.5 py-0.5 text-2xs font-bold text-moss-600">
                  <IconSparkle size={11} /> 特殊
                </span>
              )}
              <span className="tnum text-2xs font-semibold text-ink-500">
                战力 {totalPower(def)}
              </span>
            </div>

            <div className="tnum mt-2 text-2xs font-semibold text-ink-500">
              {owned ? `拥有 ×${owned.count}${owned.starred ? ' · 已叠满三星' : ''}` : '尚未获得'}
            </div>
          </div>
        </div>

        <div className="space-y-3 p-4">
          <p className="rounded-lg bg-paper-2 px-3 py-2.5 font-prose text-sm italic leading-relaxed text-ink-700">
            「{def.flavor}」
          </p>

          {def.skill && (
            <div className="rounded-lg bg-moss-100 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-2xs font-bold text-moss-600">
                <IconSparkle size={13} /> 特殊能力
              </div>
              <div className="mt-1 text-sm font-medium leading-relaxed text-ink-800">
                {def.skill}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-2xs font-bold tracking-wide text-ink-500">属性</div>
            <div className="space-y-1.5">
              {CARD_STATS.map(({ key, label }) => {
                const v = def.stats[key]
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-xs font-medium text-ink-700">{label}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-pill bg-ink-100">
                      <span
                        className="block h-full rounded-pill transition-[width] duration-500"
                        style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: tone.color }}
                      />
                    </span>
                    <span className="tnum w-7 shrink-0 text-right text-xs font-bold text-ink-900">
                      {v}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <Button full onClick={onClose}>
            知道啦
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ============================================================
   稀有度图例
   ============================================================ */

export function RarityLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {RARITIES.map((r) => (
        <span
          key={r.key}
          className="inline-flex items-center gap-1.5 text-2xs font-semibold text-ink-500"
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
          {r.label}
        </span>
      ))}
    </div>
  )
}
