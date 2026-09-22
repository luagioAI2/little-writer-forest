/* ============================================================
   套卡背包页 —— 我的文心卡
   ============================================================
   收集欲是孩子坚持写作的燃料：
   已获得的角色给归属感，没获得的剪影给「再来一篇」的动力。

   版式：概览（金币 + 收集进度 + 稀有度分布）→ 筛选 → 按卡组分节。
   每一节把「世界观 → 完成度 → 8 张卡」串起来，
   让一整个卡组像一个可以被读完的小世界，而不是一堆格子。
   ============================================================ */

import { useCallback, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { useApp } from '../../store/useApp'
import {
  Button,
  Card,
  Chip,
  CountUp,
  EmptyState,
  ProgressBar,
  SectionTitle,
  Segmented,
} from '../../components/ui'
import { CardDetailSheet, CardDropOverlay, CardFace, RarityLegend } from '../../components/CardView'
import { allSetProgress, cardsInSet, collectionStats, rarityMeta } from '../../domain/cards'
import { PACK_PRICE, PACK_SIZE } from '../../domain/economy'
import { RARITIES } from '../../domain/types'
import type { CardDef, CardDrop, Rarity } from '../../domain/types'
import {
  IconChevronDown,
  IconCoin,
  IconCrown,
  IconGift,
  IconHeart,
  IconInk,
  IconLeaf,
  IconQuestion,
  IconSearch,
  IconSparkle,
  IconTrophy,
} from '../../components/icons'

/* ---------------- 卡组的图标（数据里的 emoji 只作兜底，界面一律用线性图标） ---------------- */

const SET_ICON: Record<string, ReactNode> = {
  forest: <IconLeaf size={18} />,
  star: <IconSparkle size={18} />,
  scroll: <IconInk size={18} />,
  sweets: <IconHeart size={18} />,
  beast: <IconCrown size={18} />,
}

/* ---------------- 头像框的中文名（frame 在数据里是英文 key） ---------------- */

const FRAME_LABEL: Record<string, string> = {
  leaf: '绿叶框',
  star: '星轨框',
  scroll: '古卷框',
  sweet: '甜点框',
  beast: '兽纹框',
}

/* ---------------- 稀有度的孩子话说明 ---------------- */

const RARITY_KID_DESC: Record<Rarity, string> = {
  common: '最常见的伙伴，随便写一篇都能遇到',
  fine: '稍微用上几个好词，它就来了',
  rare: '要写出亮点才碰得到，值得炫耀一下',
  epic: '很少见！看到它就说明你写得很棒',
  legend: '一百张里才有一张，集齐了能吹一整年',
}

/** 全部权重之和，用来把权重换算成孩子看得懂的百分比 */
const TOTAL_WEIGHT = RARITIES.reduce((a, r) => a + r.weight, 0)

type OwnFilter = 'all' | 'owned' | 'missing'

/** 页面之间没有 props 通道，用自定义事件通知外壳切到写作页 */
function goCompose(): void {
  window.dispatchEvent(new CustomEvent('little-writer:navigate', { detail: 'compose' }))
}

/* ---------------- 页面 ---------------- */

export default function CardsPage(): ReactElement {
  const cards = useApp((s) => s.cards)
  const wallet = useApp((s) => s.wallet)
  const openCardPack = useApp((s) => s.openCardPack)
  const toast = useApp((s) => s.toast)

  const [ownFilter, setOwnFilter] = useState<OwnFilter>('all')
  const [rarityFilter, setRarityFilter] = useState<Rarity | 'all'>('all')
  const [setFilter, setSetFilter] = useState<string>('all')
  const [openDef, setOpenDef] = useState<CardDef | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  /** 正在开包 —— 防止连点把金币一次花光 */
  const [busy, setBusy] = useState(false)
  /** 刚开出来的卡，用来弹演出 */
  const [packDrops, setPackDrops] = useState<CardDrop[] | null>(null)

  /** 花金币开一包 */
  const openPack = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const drops = await openCardPack()
      if (!drops) {
        toast({
          kind: 'warn',
          title: '金币还不够',
          detail: `开一包要 ${PACK_PRICE} 金币。多写一篇作文就有了。`,
        })
        return
      }
      // 开包成功的音效交给 CardDropOverlay：它每揭晓一张就播对应稀有度的声，
      // 这里再播一次「金币」会和老音效叠在一起。
      setPackDrops(drops)
    } finally {
      setBusy(false)
    }
  }, [busy, openCardPack, toast])

  const ownedMap = useMemo(() => new Map(cards.map((c) => [c.defId, c])), [cards])
  const collection = useMemo(() => collectionStats(cards), [cards])
  const setProgresses = useMemo(() => allSetProgress(cards), [cards])

  // 三个筛选条件叠加：卡组 → 已获得/未获得 → 稀有度
  const sections = useMemo(
    () =>
      setProgresses
        .filter((p) => setFilter === 'all' || p.set.id === setFilter)
        .map((p) => ({
          progress: p,
          defs: cardsInSet(p.set.id).filter((d) => {
            const owned = ownedMap.has(d.id)
            if (ownFilter === 'owned' && !owned) return false
            if (ownFilter === 'missing' && owned) return false
            if (rarityFilter !== 'all' && d.rarity !== rarityFilter) return false
            return true
          }),
        }))
        .filter((s) => s.defs.length > 0),
    [setProgresses, ownedMap, ownFilter, rarityFilter, setFilter],
  )

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-3">
      {/* ---------- 概览：金币 + 收集进度 + 稀有度分布 ---------- */}
      <Card>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-amber-leaf-50 text-amber-leaf-600">
            <IconCoin size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-2xs font-bold tracking-wide text-ink-500">我的金币</div>
            <div className="font-display text-2xl font-bold leading-tight text-ink-900">
              <CountUp value={wallet.coins} />
              <span className="ml-1 text-sm font-medium text-ink-500">颗</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xs font-bold tracking-wide text-ink-500">已收集</div>
            <div className="tnum font-display text-2xl font-bold leading-tight text-inkleaf-600">
              {collection.got}
              <span className="text-sm font-medium text-ink-500"> / {collection.total}</span>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-end justify-between">
            <span className="font-display text-sm font-bold text-ink-900">收集进度</span>
            <span className="tnum text-xs font-semibold text-ink-500">{collection.percent}%</span>
          </div>
          <ProgressBar value={collection.percent} max={100} tone="leaf" height={10} />
        </div>

        {/* 按稀有度拆开：让孩子知道自己"卡在哪一档" */}
        <div className="mt-4 grid grid-cols-5 gap-1.5">
          {collection.byRarity.map((r) => (
            <div key={r.rarity} className="rounded-md bg-ink-50 px-1 py-2 text-center">
              <span
                className="mx-auto block h-2.5 w-2.5 rounded-full"
                style={{ background: rarityMeta(r.rarity).color }}
              />
              <div className="tnum mt-1 text-xs font-bold text-ink-900">
                {r.got}/{r.total}
              </div>
              <div className="text-[10px] font-medium text-ink-500">{r.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-3.5 border-t border-ink-900/[0.06] pt-3">
          <RarityLegend />
        </div>

        {/* ---------- 金币的用法（告诉孩子钱能干嘛） ---------- */}
        <div className="mt-3.5 border-t border-ink-900/[0.06] pt-3">
          <div className="mb-2 flex items-start gap-1.5 text-2xs font-semibold leading-relaxed text-ink-500">
            <IconCoin size={13} className="mt-px shrink-0" />
            <span>
              金币只有写出来才赚得到（作文 / 日记 / 背诵），文心树越大给得越多 ——
              树上不掉金币，它给的是加成。攒够了就能开包。
            </span>
          </div>
          <Button
            full
            tone="primary"
            disabled={wallet.coins < PACK_PRICE || busy}
            onClick={() => void openPack()}
            icon={<IconGift size={16} />}
          >
            {wallet.coins >= PACK_PRICE
              ? `开一包文心卡（${PACK_PRICE} 金币 · ${PACK_SIZE} 张）`
              : `还差 ${PACK_PRICE - wallet.coins} 金币`}
          </Button>
        </div>
      </Card>

      {/* ---------- 筛选 ---------- */}
      <div className="space-y-2.5">
        <Segmented<OwnFilter>
          value={ownFilter}
          onChange={setOwnFilter}
          options={[
            { value: 'all', label: '全部' },
            { value: 'owned', label: '已获得' },
            { value: 'missing', label: '未获得' },
          ]}
        />

        <div className="flex flex-wrap gap-2">
          <Chip active={rarityFilter === 'all'} onClick={() => setRarityFilter('all')}>
            全部稀有度
          </Chip>
          {RARITIES.map((r) => (
            <Chip
              key={r.key}
              active={rarityFilter === r.key}
              onClick={() => setRarityFilter(r.key)}
              icon={<span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />}
            >
              {r.label}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Chip active={setFilter === 'all'} onClick={() => setSetFilter('all')}>
            全部卡组
          </Chip>
          {setProgresses.map((p) => (
            <Chip
              key={p.set.id}
              active={setFilter === p.set.id}
              onClick={() => setSetFilter(p.set.id)}
              icon={SET_ICON[p.set.id]}
            >
              {p.set.name}
            </Chip>
          ))}
        </div>
      </div>

      {/* ---------- 空背包 / 筛选无结果 ---------- */}
      {cards.length === 0 ? (
        <Card>
          <EmptyState
            mood="curious"
            title="背包还是空的"
            desc="写完一篇作文，小笔苗就会掉卡给你。写得越好、坚持得越久，遇见的角色越稀罕哦。"
            action={
              <Button tone="primary" icon={<IconSparkle size={18} />} onClick={goCompose}>
                去写第一篇
              </Button>
            }
          />
        </Card>
      ) : sections.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconSearch size={26} />}
            title="这个条件下没有卡"
            desc="换个筛选条件再看看？说不定还有没遇见的伙伴在等你。"
            action={
              <Button
                onClick={() => {
                  setOwnFilter('all')
                  setRarityFilter('all')
                  setSetFilter('all')
                }}
              >
                清空筛选
              </Button>
            }
          />
        </Card>
      ) : (
        sections.map(({ progress, defs }) => {
          const complete = progress.complete
          const reward = progress.set.reward
          return (
            <Card key={progress.set.id}>
              <SectionTitle
                icon={SET_ICON[progress.set.id]}
                title={progress.set.name}
                sub={progress.set.world}
              />
              {/* 完成度单独一行：世界观那句话很长，
                  和进度数字挤在一行会让末尾孤零零地折一个字。 */}
              <div className="mb-1.5 flex items-end justify-between">
                <span className="text-2xs font-semibold text-ink-500">卡组进度</span>
                <span className="tnum text-xs font-bold text-ink-500">
                  {progress.owned} / {progress.total}
                </span>
              </div>
              <ProgressBar
                value={progress.percent}
                max={100}
                tone={complete ? 'amber' : 'leaf'}
                height={10}
              />

              {/* 集齐的卡组：一层暖色横幅，克制但有仪式感 */}
              {complete ? (
                <div className="mt-3 flex items-start gap-2.5 rounded-md bg-amber-leaf-50 px-3 py-2.5 shadow-[var(--hair-amber)]">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-amber-leaf-100 text-amber-leaf-600">
                    <IconTrophy size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-amber-leaf-700">集齐啦，奖励已到手</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs font-semibold text-ink-600">
                      <span className="tnum">+{reward.coins} 金币</span>
                      {reward.title && <span>称号「{reward.title}」</span>}
                      {reward.frame && (
                        <span>{FRAME_LABEL[reward.frame] ?? '专属头像框'}</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-2xs font-medium text-ink-500">
                  再集 {progress.total - progress.owned} 张就能拿奖励：{reward.coins} 金币
                  {reward.title ? ` + 称号「${reward.title}」` : ''}
                </div>
              )}

              {/* 8 张卡：窄屏 3 列、宽屏 4 列 */}
              <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                {defs.map((d) => {
                  const o = ownedMap.get(d.id)
                  return o ? (
                    <CardFace
                      key={d.id}
                      def={d}
                      count={o.count}
                      starred={o.starred}
                      size="md"
                      onClick={() => setOpenDef(d)}
                    />
                  ) : (
                    <CardFace key={d.id} def={d} locked size="md" />
                  )
                })}
              </div>
            </Card>
          )
        })
      )}

      {/* ---------- 稀有度说明 ---------- */}
      <Card>
        <button
          type="button"
          onClick={() => setHelpOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-ink-50 text-ink-500">
            <IconQuestion size={17} />
          </span>
          <span className="min-w-0 flex-1 font-display text-sm font-bold text-ink-900">
            稀有度是怎么定的？
          </span>
          <span
            className={`shrink-0 text-ink-400 transition-transform duration-200 ${
              helpOpen ? 'rotate-180' : ''
            }`}
          >
            <IconChevronDown size={18} />
          </span>
        </button>

        {helpOpen && (
          <div className="mt-3 space-y-2 anim-fade-in">
            <p className="text-xs leading-relaxed text-ink-600">
              每写完一篇作文，小笔苗都会按你的分数抽卡。分数越高、连续写日记的天数越多，
              越容易遇见稀罕的角色。
            </p>
            {RARITIES.map((r) => (
              <div key={r.key} className="flex items-center gap-2.5 rounded-md bg-ink-50 px-3 py-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: r.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-ink-900">
                    {r.label}
                    <span className="tnum ml-1.5 font-medium text-ink-500">
                      约 {Math.round((r.weight / TOTAL_WEIGHT) * 100)}%
                    </span>
                  </div>
                  <div className="text-[11px] leading-relaxed text-ink-500">
                    {RARITY_KID_DESC[r.key]}
                  </div>
                </div>
              </div>
            ))}
            <p className="text-[11px] text-ink-500">
              抽到重复的卡不会浪费，攒够 3 张会自动叠成满星。
            </p>
          </div>
        )}
      </Card>

      {/* ---------- 卡牌详情 ---------- */}
      {openDef && (
        <CardDetailSheet
          def={openDef}
          owned={ownedMap.get(openDef.id)}
          onClose={() => setOpenDef(null)}
        />
      )}

      {/* ---------- 开包演出 ---------- */}
      {packDrops && packDrops.length > 0 && (
        <CardDropOverlay
          drops={packDrops}
          title={`开出了 ${packDrops.length} 张文心卡`}
          onClose={() => setPackDrops(null)}
        />
      )}
    </div>
  )
}
