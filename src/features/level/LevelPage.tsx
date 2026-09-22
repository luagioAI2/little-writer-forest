/* ============================================================
   成长树 —— 我的树、树上的产出、以及往下长的那一段
   ============================================================
   这一屏是全 App 情感浓度最高的地方，v4 的重点是：

     · 树是主角。树占最大的一块，且**会随着时间结出东西**挂在
       枝头 —— 这是需求里「树每隔一段时间有产出掉落」的界面落点。
       ★ 但树上**不掉金币**：金币只能靠写出来。树给的是「金币加成」，
       所以这一屏要同时讲清两件事 —— 今天的才气还剩几篇、
       树现在让写出来的东西值多少钱。
     · 收成要一眼看懂。挂着的每一件都能看清是什么（树种/卡片/
       信），点一下就能收，不需要翻页。
     · 数值要诚实。告诉孩子「现在每小时大约结几颗」「还差多少
       件就挂满了」，让等待变得有预期，而不是干等。
     · 别用 emoji 当图标，别用粗描边和彩虹色 —— 全部换成自绘
       线性图标与发丝边。
   ============================================================ */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useApp } from '../../store/useApp'
import {
  Card,
  CountUp,
  ProgressBar,
  SectionTitle,
  Segmented,
  StatTile,
} from '../../components/ui'
import { LevelBadge, TreeArt } from '../../components/TreeArt'
import {
  ESTABLISHED_THRESHOLD,
  LEVELS,
  MAX_SHIELDS,
  confidenceHint,
  confidenceLabel,
  levelAt,
  progressPercent,
  recentAverage,
  xpToNext,
} from '../../domain/levels'
import {
  TREE_FRUIT_MIN_LEVEL,
  pendingCap,
  productionSummary,
  yieldIntervalMs,
} from '../../domain/tree'
import {
  DAILY_COMPOSITION_LIMIT,
  talentLeftToday,
  treeCoinBoostLabel,
} from '../../domain/economy'
import { cardDef } from '../../domain/cards'
import { unlockedSpecies, nextSpeciesToUnlock, BIRD_SPECIES } from '../../domain/pets'
import { LANDMARKS, sproutCount } from '../../domain/travel'
import type { LevelConfidence, LevelState, TreeYield } from '../../domain/types'
import {
  IconBirdSitting,
  IconCards,
  IconCoin,
  IconEnvelopeOpen,
  IconFolder,
  IconHarvest,
  IconHourglass,
  IconLeaf,
  IconPhoto,
  IconSeedling,
  IconTreeHollow,
} from '../../components/icons'
import { playSound } from '../../platform/sound'
import { tapFeedback } from '../../platform/haptics'

/* ============================================================
   一、树上挂着的那一颗产出
   ============================================================ */

/** 把一件产出翻成孩子看得懂的短句 */
function yieldLabel(y: TreeYield): string {
  if (y.kind === 'coin') return `${y.amount ?? 0} 金币`
  if (y.kind === 'seed') return '一颗树种'
  if (y.kind === 'letter') return '一封来信'
  const def = y.defId ? cardDef(y.defId) : undefined
  return def ? def.name : '一张文心卡'
}

/**
 * 树上的收获物。
 *
 * 用不同形状而不是不同颜色来区分种类 —— 颜色留给"稀有度"，
 * 两种信息挤在同一个通道上，孩子会分不清。
 */
function YieldChip({ y, onCollect }: { y: TreeYield; onCollect: (id: string) => void }) {
  const skin =
    y.kind === 'coin'
      ? 'bg-amber-leaf-50 text-amber-leaf-700 shadow-[var(--hair-amber)]'
      : y.kind === 'seed'
        ? 'bg-inkleaf-50 text-inkleaf-700 shadow-[var(--hair-leaf)]'
        : y.kind === 'letter'
          ? 'bg-mist-50 text-mist-600 shadow-[var(--hair)]'
          : 'bg-moss-50 text-moss-600 shadow-[var(--hair)]'

  const Icon =
    y.kind === 'coin'
      ? IconHarvest
      : y.kind === 'seed'
        ? IconSeedling
        : y.kind === 'letter'
          ? IconEnvelopeOpen
          : IconCards

  return (
    <button
      type="button"
      onClick={() => {
        playSound('coin')
        tapFeedback()
        onCollect(y.id)
      }}
      className={`btn-base active:btn-press flex items-center gap-1.5 rounded-pill px-3 py-2 text-xs font-bold anim-pop ${skin}`}
      title={yieldLabel(y)}
    >
      <Icon size={14} />
      <span className="max-w-[9rem] truncate">{yieldLabel(y)}</span>
    </button>
  )
}

/* ============================================================
   二、产出台：树的现在与节奏
   ============================================================ */

function TreePanel() {
  const level = useApp((s) => s.level)
  const tree = useApp((s) => s.tree)
  const sprouts = useApp((s) => s.sprouts)
  const birds = useApp((s) => s.birds)
  const works = useApp((s) => s.works)
  const tickTreeNow = useApp((s) => s.tickTreeNow)
  const harvestTree = useApp((s) => s.harvestTree)
  const toast = useApp((s) => s.toast)

  const meta = levelAt(level.levelIndex)
  const sproutTotal = useMemo(() => sproutCount(sprouts), [sprouts])
  const summary = useMemo(
    () => productionSummary(level.levelIndex, sproutTotal),
    [level.levelIndex, sproutTotal],
  )
  const cap = pendingCap(level.levelIndex)
  const full = tree.pending.length >= cap

  /** 树够大了才会结果子（第 0/1/2 段什么也不结，见 tree.TREE_FRUIT_MIN_LEVEL） */
  const canFruit = level.levelIndex >= TREE_FRUIT_MIN_LEVEL
  /** 今天还剩几篇有奖励的作文 */
  const talentLeft = useMemo(() => talentLeftToday(works), [works])

  /* 每秒走一次时钟：既让树按时间结算，也刷新"下一次还要多久" */
  const [, force] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      tickTreeNow()
      force((n) => n + 1)
    }, 1000)
    return () => window.clearInterval(id)
  }, [tickTreeNow])

  /** 距下一颗还有多久（毫秒） */
  const nextIn = useMemo(() => {
    const interval = yieldIntervalMs(level.levelIndex, sproutTotal)
    const since = Date.now() - tree.lastTickAt
    const left = interval - (since % interval)
    return Math.max(0, left)
  }, [level.levelIndex, sproutTotal, tree.lastTickAt])

  const mins = Math.floor(nextIn / 60_000)
  const secs = Math.floor((nextIn % 60_000) / 1000)
  const nextText = mins > 0 ? `${mins} 分 ${secs} 秒` : `${secs} 秒`

  async function collect(id: string) {
    // 单件收取走 collectAll 之外的路：这里为了交互干脆全收，
    // 因为树上挂着的东西没有"先后"的意义，一颗一颗点太累。
    void id
    const r = await harvestTree()
    const bits: string[] = []
    if (r.coins > 0) bits.push(`${r.coins} 金币`)
    if (r.drops.length > 0) bits.push(`${r.drops.length} 张卡`)
    if (r.letters > 0) bits.push(`${r.letters} 封信`)
    // 集齐卡组的奖励金币是额外发的（卡组自己有 toast，这里只说个数字）
    if (r.setBonus > 0) bits.push(`集齐卡组 +${r.setBonus} 金币`)
    // 树种不是收进背包的 —— 它自己落到地图上发芽，所以要说清楚落在哪儿
    if (r.planted.length > 0) {
      const where = [...new Set(r.planted.map((p) => p.name))].join('、')
      bits.push(`${r.planted.length} 颗树种，种在${where}发了芽`)
    }
    toast({
      kind: 'reward',
      title: '收好啦',
      detail: bits.length > 0 ? bits.join(' · ') : '树上空空的，等下一颗吧',
    })
  }

  return (
    <section className="relative overflow-hidden rounded-panel surface">
      {/* 树冠后的暖光，颜色跟着段位走 */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-56"
        style={{
          background: `radial-gradient(60% 100% at 50% 0%, ${meta.color}24 0%, transparent 70%)`,
        }}
      />

      <div className="relative flex flex-col items-center px-5 pb-4 pt-5">
        {/* 树 */}
        <div className="h-[188px] w-[188px] anim-fade-in">
          <TreeArt stage={meta.treeStage} className="h-full w-full" />
        </div>

        {/* 段位 */}
        <div className="mt-1 flex items-center gap-2">
          <span
            className="grid h-6 w-6 place-items-center rounded-full font-display text-2xs font-bold"
            style={{ background: `${meta.color}22`, color: meta.color }}
          >
            {meta.index + 1}
          </span>
          <span className="font-display text-xl font-bold tracking-tight text-ink-900">
            {meta.name}
          </span>
        </div>
        <p className="mt-0.5 font-display text-xs font-semibold" style={{ color: meta.color }}>
          {meta.title}
        </p>
        <p className="tnum mt-1.5 text-2xs font-semibold text-ink-400">
          {meta.index + 1} / {LEVELS.length} 段 · 累计经验 {level.xp}
        </p>

        {/* 能力描述 + 成长故事 + 成长寓意 */}
        <div className="mt-3 w-full space-y-2">
          <div className="rounded-md bg-paper-2 px-3.5 py-2.5">
            <div className="text-2xs font-bold text-ink-500">能力描述</div>
            <p className="mt-1 text-xs leading-relaxed text-ink-800">{meta.ability}</p>
          </div>
          <div className="rounded-md px-3.5 py-2.5" style={{ background: `${meta.color}0d` }}>
            <div className="text-2xs font-bold" style={{ color: meta.color }}>成长故事</div>
            <p className="mt-1 font-prose text-xs leading-relaxed text-ink-700">{meta.story}</p>
          </div>
          <div className="rounded-md bg-inkleaf-50 px-3.5 py-2.5 shadow-[var(--hair-leaf)]">
            <p className="text-xs leading-relaxed text-inkleaf-700">
              <span className="font-bold">成长寓意</span>
              <span className="mx-1 text-ink-300">|</span>
              {meta.growth}
            </p>
          </div>
        </div>

        {/* 才气与加成 —— 这一屏最该被看懂的两件事 */}
        <div className="mt-4 grid w-full grid-cols-2 gap-2">
          <div className="rounded-md bg-paper-2 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-2xs font-bold text-ink-500">
              <IconLeaf size={13} />
              今日才气
            </div>
            <div className="tnum mt-0.5 font-display text-lg font-bold leading-tight text-ink-900">
              {talentLeft}
              <span className="ml-0.5 text-xs font-medium text-ink-500">
                / {DAILY_COMPOSITION_LIMIT} 篇
              </span>
            </div>
          </div>
          <div className="rounded-md bg-amber-leaf-50 px-3 py-2.5 shadow-[var(--hair-amber)]">
            <div className="flex items-center gap-1.5 text-2xs font-bold text-amber-leaf-700">
              <IconCoin size={13} />
              树的金币加成
            </div>
            <div className="tnum mt-0.5 font-display text-lg font-bold leading-tight text-amber-leaf-700">
              {treeCoinBoostLabel(level.levelIndex)}
            </div>
          </div>
        </div>

        <p className="mt-2 w-full rounded-md bg-paper-2 px-3 py-2.5 text-2xs leading-relaxed text-ink-500">
          才气就是养料：写一篇作文、记一次日记，树就往上长一点。
          金币只从你写的东西里来 —— 树上不掉金币，它给你的是
          <span className="font-bold text-ink-700">加成</span>。
        </p>

        {/* 树上挂着的东西 */}
        <div className="mt-4 w-full">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-2xs font-bold text-ink-500">
              <IconHarvest size={13} />
              树上挂着
            </span>
            <span className={`tnum text-2xs font-bold ${full ? 'text-clay-600' : 'text-ink-400'}`}>
              {tree.pending.length} / {cap}
              {full && ' · 满了'}
            </span>
          </div>

          {tree.pending.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-1.5">
              {tree.pending.map((y) => (
                <YieldChip key={y.id} y={y} onCollect={collect} />
              ))}
            </div>
          ) : (
            <p className="rounded-md bg-ink-50 px-3 py-3 text-center text-xs leading-relaxed text-ink-500">
              {!canFruit
                ? '树还太小，枝头空空的。它得先长大一点，才有力气结果子。'
                : birds.length > 0
                  ? '树正在慢慢结果子，过一会儿回来看看。'
                  : '树正在慢慢结果子。养了小鸟之后，树上还会出现信。'}
            </p>
          )}
        </div>

        {/* 节奏 —— 或者「树还太小，什么也不结」 */}
        {canFruit ? (
          <div className="mt-3 flex w-full items-center gap-2 rounded-md bg-paper-2 px-3 py-2.5">
            <span className="text-inkleaf-500">
              <IconHourglass size={14} />
            </span>
            <span className="min-w-0 flex-1 text-2xs leading-relaxed text-ink-600">
              {full ? (
                <>树上挂满了，收一收才会继续结。</>
              ) : (
                <>
                  {summary.label}，下一颗还要{' '}
                  <span className="tnum font-bold text-ink-800">{nextText}</span>
                </>
              )}
            </span>
          </div>
        ) : (
          <p className="mt-3 w-full rounded-md bg-paper-2 px-3 py-2.5 text-2xs leading-relaxed text-ink-500">
            树还小，还结不出果子。多写几篇，等它长成「
            {levelAt(TREE_FRUIT_MIN_LEVEL).name}」，枝头就会挂满东西。
          </p>
        )}

        {tree.pending.length > 0 && (
          <button
            type="button"
            onClick={() => {
              playSound('coin')
              tapFeedback()
              void collect('all')
            }}
            className="btn-base active:btn-press btn-reward mt-2.5 flex w-full items-center justify-center gap-2 rounded-btn py-3 text-sm font-bold"
          >
            <IconHarvest size={16} />
            全部收下
          </button>
        )}

        {tree.pending.length === 0 && tree.harvests > 0 && (
          <p className="tnum mt-2 text-2xs text-ink-400">
            已经收过 {tree.harvests} 次
            {tree.totalCards > 0 && ` · ${tree.totalCards} 张卡`}
            {tree.totalCoins > 0 && ` · ${tree.totalCoins} 金币（以前的树上掉的）`}
          </p>
        )}
      </div>
    </section>
  )
}

/* ============================================================
   三、树洞 / 小鸟：树上住着什么
   ============================================================ */

function TreeLifePanel() {
  const level = useApp((s) => s.level)
  const birds = useApp((s) => s.birds)
  const photos = useApp((s) => s.photos)
  const sprouts = useApp((s) => s.sprouts)

  const meta = levelAt(level.levelIndex)
  const hollow = level.levelIndex >= 4
  const nextBird = nextSpeciesToUnlock(level.levelIndex)
  const here = birds.length

  const litCount = useMemo(() => sproutCount(sprouts), [sprouts])

  return (
    <Card>
      <SectionTitle
        icon={<IconTreeHollow size={16} />}
        title="树上住着谁"
        sub={`${here} 只小鸟 · ${litCount} 个地方发了芽`}
      />
      <div className="grid grid-cols-3 gap-2">
        <StatTile
          tone="leaf"
          icon={<IconTreeHollow size={15} />}
          value={hollow ? '已开' : `${meta.index + 1}/5`}
          label="树洞"
        />
        <StatTile tone="amber" icon={<IconBirdSitting size={15} />} value={here} label="小鸟" />
        <StatTile tone="mist" icon={<IconPhoto size={15} />} value={photos.length} label="照片" />
      </div>

      {!hollow && (
        <p className="mt-3 rounded-md bg-paper-2 px-3 py-2.5 text-xs leading-relaxed text-ink-600">
          长到「{levelAt(4).name}」，树干上会裂开一个树洞。日记可以丢进去，它会替你把话收好。
        </p>
      )}

      {hollow && (
        <p className="mt-3 rounded-md bg-moss-50 px-3 py-2.5 text-xs leading-relaxed text-moss-600">
          树洞已经打开了。写完日记，可以把它放进树洞 —— 说出去的话，树会记住。
        </p>
      )}

      {nextBird && (
        <div className="mt-3 flex items-center gap-2.5 rounded-md bg-paper-2 px-3 py-2.5">
          <span className="min-w-0 flex-1 text-xs leading-relaxed text-ink-600">
            长到「{levelAt(nextBird.unlockLevel).name}」，「{nextBird.name}」就会来树上住。
          </span>
          <span className="tnum shrink-0 text-2xs font-bold text-ink-500">
            {levelAt(nextBird.unlockLevel).minXp} 经验
          </span>
        </div>
      )}

      {!nextBird && (
        <p className="mt-3 text-xs leading-relaxed text-ink-600">
          八只鸟都到齐了 —— 从麻雀到凤凰，它们都在你的树上。
        </p>
      )}
    </Card>
  )
}

/* ============================================================
   四、成绩走势（手写 SVG，不引图表库）
   ============================================================ */

function ScoreTrend({ scores }: { scores: number[] }) {
  const W = 320
  const H = 136
  const padX = 18
  const padTop = 22
  const padBottom = 24
  const innerW = W - padX * 2
  const innerH = H - padTop - padBottom
  const n = scores.length

  const px = (i: number) => (n <= 1 ? padX + innerW / 2 : padX + (i / (n - 1)) * innerW)
  const py = (v: number) => padTop + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH

  const line = scores
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(1)} ${py(v).toFixed(1)}`)
    .join(' ')
  const base = (padTop + innerH).toFixed(1)
  const area = `${line} L ${px(n - 1).toFixed(1)} ${base} L ${px(0).toFixed(1)} ${base} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="最近几次作文成绩走势">
      <defs>
        <linearGradient id="score-trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#29ce89" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#29ce89" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {[0, 50, 100].map((v) => (
        <line
          key={v}
          x1={padX}
          y1={py(v)}
          x2={W - padX}
          y2={py(v)}
          stroke="rgb(18 23 20 / 0.07)"
          strokeWidth="1"
        />
      ))}
      {/* 60 分是作文的「棒棒线」，给孩子一个参照 */}
      <line
        x1={padX}
        y1={py(60)}
        x2={W - padX}
        y2={py(60)}
        stroke="#febb32"
        strokeWidth="1.2"
        strokeDasharray="5 4"
      />

      <path d={area} fill="url(#score-trend-fill)" />
      <path
        d={line}
        fill="none"
        stroke="#10a368"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {scores.map((v, i) => (
        <g key={i}>
          <circle cx={px(i)} cy={py(v)} r="3.5" fill="#ffffff" stroke="#10a368" strokeWidth="2" />
          <text
            x={px(i)}
            y={py(v) - 8}
            textAnchor="middle"
            fontSize="10"
            fontWeight="700"
            fill="#5f584e"
          >
            {Math.round(v)}
          </text>
        </g>
      ))}
    </svg>
  )
}

/* ============================================================
   五、鼓励文案
   ============================================================ */

function cheerFor(state: LevelState): string {
  const scores = state.recentScores
  const n = scores.length

  if (n === 0) return '你的灵芽刚刚破土。写上一篇作文，它就会开始长高。'
  if (state.declineStreak > 0) return '最近好像有点累？没关系的，护盾替你挡住了。慢慢写，不着急。'

  const half = Math.floor(n / 2)
  const rising = n >= 3 && mean(scores.slice(half)) - mean(scores.slice(0, half)) >= 5
  if (rising) return '一篇比一篇顺。照这个劲头写下去，成长树很快又要长高一截。'

  const avg = recentAverage(state)
  if (avg >= 85) return '这水平，老师要念给全班听了。'
  if (avg >= 70) return '稳稳的。你的好词越来越多，这本本子在偷偷变厚。'
  if (state.scoredCount < ESTABLISHED_THRESHOLD)
    return '刚开始的分数只是猜的，多写几篇才看得准。你已经动笔了，这就比昨天强。'
  return '今天的你只跟昨天的你比，前进了就行。要不挑一句最喜欢的改改？'
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

/* ============================================================
   六、置信度
   ============================================================ */

function confidenceTone(c: LevelConfidence): 'mist' | 'amber' | 'leaf' {
  if (c === 'predicted') return 'mist'
  if (c === 'settling') return 'amber'
  return 'leaf'
}

/* ============================================================
   七、页面
   ============================================================ */

export default function LevelPage(): ReactElement {
  const level = useApp((s) => s.level)
  const stats = useApp((s) => s.stats)
  const streak = useApp((s) => s.streak)
  const settings = useApp((s) => s.settings)
  const birds = useApp((s) => s.birds)
  const sprouts = useApp((s) => s.sprouts)

  const [tab, setTab] = useState<'tree' | 'levels' | 'data'>('tree')

  const sproutTotal = useMemo(() => sproutCount(sprouts), [sprouts])

  const meta = levelAt(level.levelIndex)
  const { need, next } = xpToNext(level)
  const percent = progressPercent(level)
  const avg = recentAverage(level)
  const cheer = cheerFor(level)
  const establishedDone = Math.min(level.scoredCount, ESTABLISHED_THRESHOLD)
  const unlockedBirds = useMemo(() => unlockedSpecies(level.levelIndex), [level.levelIndex])

  const trackRef = useRef<HTMLDivElement>(null)
  const currentRowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (tab !== 'levels') return
    const box = trackRef.current
    const row = currentRowRef.current
    if (!box || !row) return
    // 手算 scrollTop 而不是 scrollIntoView：后者会把整页一起滚走，进页面就跳
    box.scrollTop = row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2
  }, [tab])

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-3">
      {/* ---------- 主角：成长树 ---------- */}
      <TreePanel />

      {/* ---------- 分段 ---------- */}
      <Segmented
        value={tab}
        onChange={(v) => {
          playSound('tap-soft')
          setTab(v)
        }}
        className="self-start"
        options={[
          { value: 'tree', label: '我的树' },
          { value: 'levels', label: '段位' },
          { value: 'data', label: '数据' },
        ]}
      />

      {/* ============================================================
          A. 我的树
         ============================================================ */}
      {tab === 'tree' && (
        <>
          <TreeLifePanel />

          {/* 升级进度 */}
          <Card>
            <SectionTitle
              icon={<IconLeaf size={16} />}
              title="离下一段还有多远"
              sub={next ? `还差一点点，就到「${next.name}」` : '已经是最高段位'}
              right={
                <span className="tnum shrink-0 font-display text-xl font-bold text-inkleaf-600">
                  {percent}%
                </span>
              }
            />
            <ProgressBar value={percent} max={100} tone="leaf" height={10} />
            <p className="mt-2.5 text-xs leading-relaxed text-ink-600">
              {next ? (
                <>
                  还差 <span className="tnum font-bold text-inkleaf-700">{need}</span> 点经验。
                  每写一篇作文、每记一次日记，都会攒经验。
                </>
              ) : (
                <>已经长到最高段位了 —— 你的通天神树遮天蔽日，整片森林都以你为中心。</>
              )}
            </p>
          </Card>

          {/* 护盾 */}
          <Card>
            <SectionTitle
              icon={<IconLeaf size={16} />}
              title="我的护盾"
              tone="amber"
              sub={`${level.shields} / ${MAX_SHIELDS} 个`}
            />
            <div className="flex items-center gap-2">
              {Array.from({ length: MAX_SHIELDS }, (_, i) => (
                <span
                  key={i}
                  className={`grid h-10 w-10 place-items-center rounded-md ${
                    i < level.shields
                      ? 'bg-amber-leaf-50 text-amber-leaf-600 shadow-[var(--hair-amber)] anim-pop'
                      : 'bg-ink-50 text-ink-300'
                  }`}
                  style={{ animationDelay: `${i * 0.08}s` }}
                >
                  <IconLeaf size={17} />
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-600">
              护盾是给你的保护罩。就算有一阵子写得不太顺，它也会先替你挡住，不会马上掉段。
              每升一段就能领到新的，最多攒 {MAX_SHIELDS} 个。
            </p>
          </Card>

          {/* 小笔苗的话 */}
          <section className="relative overflow-hidden rounded-panel bg-gradient-to-br from-amber-leaf-50 via-paper to-inkleaf-50 p-5 shadow-[var(--hair)]">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white text-inkleaf-600 shadow-[var(--hair)] anim-float">
                <IconLeaf size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-sm font-bold text-ink-900">小笔苗想对你说</div>
                <p className="mt-1.5 font-prose text-sm leading-loose text-ink-700">{cheer}</p>
              </div>
            </div>
          </section>
        </>
      )}

      {/* ============================================================
          B. 段位阶梯
         ============================================================ */}
      {tab === 'levels' && (
        <>
          <Card>
            <SectionTitle
              icon={<IconLeaf size={16} />}
              title="这是你现在的水平"
              sub={confidenceHint(level.confidence, level.scoredCount)}
              right={
                <span className="shrink-0 rounded-pill bg-ink-50 px-2.5 py-1 text-2xs font-bold text-ink-600">
                  {confidenceLabel(level.confidence)}
                </span>
              }
            />
            <div className="mt-1">
              <div className="mb-1.5 flex items-center justify-between text-2xs font-semibold text-ink-500">
                <span>距离「实际水平」</span>
                <span className="tnum">
                  已评 {establishedDone}/{ESTABLISHED_THRESHOLD} 篇
                </span>
              </div>
              <ProgressBar
                value={establishedDone}
                max={ESTABLISHED_THRESHOLD}
                tone={confidenceTone(level.confidence)}
                height={8}
              />
            </div>
            <p className="mt-3 rounded-md bg-paper-2 px-3 py-2.5 text-xs leading-relaxed text-ink-600">
              {level.confidence !== 'established'
                ? '一开始还不认识你，只能靠猜。这个段位先当成「预测水平」看看就好 —— 多交几篇，就能把你的真实水平算得稳稳的。'
                : `你已经交满 ${ESTABLISHED_THRESHOLD} 篇啦，现在的段位就是你真实的水平。`}
            </p>
          </Card>

          <Card>
            <SectionTitle
              icon={<IconLeaf size={16} />}
              title="段位阶梯"
              tone="moss"
              sub={`一共 ${LEVELS.length} 段，你在第 ${meta.index + 1} 段`}
            />
            <div
              ref={trackRef}
              className="relative max-h-[380px] space-y-1.5 overflow-y-auto overscroll-contain pr-1"
            >
              {LEVELS.map((m) => {
                const isCurrent = m.index === level.levelIndex
                const isDone = m.index < level.levelIndex
                return (
                  <div
                    key={m.index}
                    ref={isCurrent ? currentRowRef : undefined}
                    className={`flex items-center gap-3 rounded-card px-3 py-2.5 ${
                      isCurrent
                        ? 'bg-inkleaf-50 shadow-[var(--hair-leaf)]'
                        : isDone
                          ? 'surface'
                          : 'surface opacity-45'
                    }`}
                  >
                    <span className={isDone || isCurrent ? '' : 'opacity-45 grayscale'}>
                      <LevelBadge meta={m} size="sm" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-display text-sm font-bold text-ink-900">
                          {m.name}
                        </span>
                        <span className="shrink-0 text-2xs font-semibold text-ink-400">{m.title}</span>
                        {isCurrent && (
                          <span className="shrink-0 text-2xs font-bold text-inkleaf-600">
                            你在这儿
                          </span>
                        )}
                      </div>
                      <div className="tnum mt-0.5 text-2xs font-semibold text-ink-500">
                        {m.minXp} 经验
                      </div>
                      {isCurrent && (
                        <p className="mt-1 text-2xs leading-relaxed text-ink-600">{m.ability}</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-pill px-2 py-0.5 text-2xs font-bold ${
                        isCurrent
                          ? 'bg-inkleaf-600 text-white'
                          : isDone
                            ? 'bg-amber-leaf-100 text-amber-leaf-700'
                            : 'bg-ink-50 text-ink-400'
                      }`}
                    >
                      {isCurrent ? '当前' : isDone ? '已达成' : '未解锁'}
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>

          {/* 鸟的解锁表 —— 让"再写一点"有看得见的理由 */}
          <Card>
            <SectionTitle
              icon={<IconBirdSitting size={16} />}
              title="小鸟什么时候来"
              tone="amber"
              sub={`已经来了 ${birds.length} 只`}
            />
            <div className="grid grid-cols-2 gap-1.5">
              {BIRD_SPECIES.map((sp) => {
                const got = unlockedBirds.some((u) => u.id === sp.id)
                return (
                  <div
                    key={sp.id}
                    className={`flex items-center gap-2 rounded-md px-2.5 py-2 ${
                      got ? 'bg-amber-leaf-50 shadow-[var(--hair-amber)]' : 'bg-ink-50 opacity-55'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: got ? sp.color : 'rgb(18 23 20 / 0.18)' }}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink-800">
                      {sp.name}
                    </span>
                    <span className="tnum shrink-0 text-2xs text-ink-500">
                      {got ? '已来' : levelAt(sp.unlockLevel).name}
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>
        </>
      )}

      {/* ============================================================
          C. 数据
         ============================================================ */}
      {tab === 'data' && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <StatTile tone="leaf" icon={<IconLeaf size={15} />} value={<CountUp value={stats.compositions} />} label="篇作文" />
            <StatTile tone="mist" icon={<IconFolder size={15} />} value={<CountUp value={stats.diaries} />} label="篇日记" />
            <StatTile tone="amber" icon={<IconHarvest size={15} />} value={<CountUp value={stats.words} />} label="个字" />
            <StatTile tone="moss" icon={<IconCards size={15} />} value={<CountUp value={level.bestScore} />} label="最好成绩" />
            <StatTile tone="clay" icon={<IconPhoto size={15} />} value={<CountUp value={Math.round(avg)} />} label="最近平均" />
            <StatTile tone="leaf" icon={<IconHourglass size={15} />} value={<CountUp value={streak.days} />} label="连续日记" />
          </div>

          {level.recentScores.length >= 2 && (
            <Card>
              <SectionTitle
                icon={<IconHarvest size={16} />}
                title="最近几次成绩"
                sub="黄色虚线是 60 分，越过它就说明这篇站稳了"
              />
              <ScoreTrend scores={level.recentScores} />
            </Card>
          )}

          <Card>
            <SectionTitle
              icon={<IconSeedling size={16} />}
              title={`${settings.childName} 的森林`}
              sub={`当前「${meta.name}」· 累计经验 ${level.xp} 点`}
            />
            <ul className="flex flex-col gap-2 text-xs leading-relaxed text-ink-600">
              <li className="flex items-center justify-between">
                <span>累计写作</span>
                <span className="tnum font-bold text-ink-800">
                  {stats.compositions} 篇 · {stats.words} 字
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span>语音录入</span>
                <span className="tnum font-bold text-ink-800">{stats.utterances} 条</span>
              </li>
              <li className="flex items-center justify-between">
                <span>修改次数</span>
                <span className="tnum font-bold text-ink-800">{stats.edits} 次</span>
              </li>
              <li className="flex items-center justify-between">
                <span>去过的地方</span>
                <span className="tnum font-bold text-ink-800">
                  {sproutTotal} / {LANDMARKS.length}
                </span>
              </li>
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}
