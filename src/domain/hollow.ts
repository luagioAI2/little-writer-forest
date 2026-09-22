/* ============================================================
   树洞 —— 事件与日记回响
   ============================================================

   树洞是这个 App 里最"安静"的地方，也是最需要小心的设计。

   它只做一件事：**听**。
     · 孩子把封存的日记丢进来，树洞回一句温柔的话。
     · 回响永远不评价、不纠错、不打分 —— 那不是树洞该干的事。
       写作的对错交给作文批改；心事只交给树洞保管。

   除了日记回响，树上还会随机冒出小事件：
     一封信（小鸟叼来的）、一份礼物、一位路过的小客人、一句回响。
   事件必须**稀少**才有分量，所以每次评估只有 12%-20% 的概率出现，
   而且树越多、概率越高 —— 呼应需求「树越多，掉落事件增幅越多」。

   时间一律由外部传入（now），模块内不调用 Date.now()。
   ============================================================ */

import type {
  BirdSpeciesId,
  DiaryEntry,
  HollowDiary,
  HollowEvent,
  HollowEventKind,
  TreeState,
} from './types'
import { hashSeed } from './tree'
import { BIRD_SPECIES } from './pets'

/* ============================================================
   一、解锁
   ============================================================ */

/** 树洞在第 4 段（琼华树）打开 —— 树够大了，才有资格替孩子保管心事 */
export const HOLLOW_UNLOCK_LEVEL = 3

export function isHollowUnlocked(levelIndex: number): boolean {
  return levelIndex >= HOLLOW_UNLOCK_LEVEL
}

/** 给还没解锁的孩子一句盼头，给解锁了的孩子一句邀请 */
export function hollowUnlockHint(levelIndex: number): string {
  if (isHollowUnlocked(levelIndex)) {
    return '树洞已经打开啦，想说的话都可以丢进去。'
  }
  const left = HOLLOW_UNLOCK_LEVEL - levelIndex
  return `再长高一点点，树干上就会裂开一个小洞…（还差 ${left} 段）`
}

/* ============================================================
   二、回响
   ============================================================ */

/**
 * 树洞的回响。
 *
 * 硬性要求：**绝不评价、绝不纠错、绝不打分**。
 * 这些话只是"我听见了"，让孩子感到被接住，而不是被检查。
 * 语气要温柔、稍微带一点文学味，像一个愿意坐很久的听众。
 */
export const HOLLOW_ECHOES: string[] = [
  '树洞把你今天的话收好了。明天再来看，它还在。',
  '这些话有点重，树洞替你拿着，你可以轻一点往前走。',
  '风从树洞里穿过去，把你的心事吹成了沙沙的响声。',
  '写下来的那一刻，它就真的发生过了。',
  '树洞不说话，只是把你说的都记在心里。',
  '今天的你，比昨天多说了几句真话。',
  '有些话不用给别人看，给树洞看看就好。',
  '树洞里住着一整个安静的晚上。',
  '你把难过分了一半给树洞，它说它拿得动。',
  '字里有一点小小的光，树洞看见了。',
  '树洞把今天折起来，放进年轮的夹层里。',
  '你写的每一句，树洞都当成宝贝收着。',
  '有些心情说出口，就变成树叶上的露水了。',
  '树洞知道你今天很努力，它不催你。',
  '慢慢写，树洞有的是时间听。',
  '你把今天留在这里，明天它还是今天的模样。',
  '树洞听见了。它替你把这句话，轻轻放进土里。',
  '不用担心写得好不好，树洞只在乎是不是你写的。',
]

/**
 * 同一篇日记永远得到同一句回响。
 * 用日记 id 做种子而不是随机数 —— 孩子隔几天回来看，
 * 树洞说的还是那句话，这种"它真的记得"的感觉很重要。
 */
function echoFor(entryId: string): string {
  const idx = hashSeed(entryId) % HOLLOW_ECHOES.length
  return HOLLOW_ECHOES[idx]
}

/* ============================================================
   三、构造事件
   ============================================================ */

interface EventDefault {
  title: string
  body: string
}

const EVENT_DEFAULTS: Record<HollowEventKind, EventDefault> = {
  letter: {
    title: '树上有一封信',
    body: '小鸟叼着一封给你的信，信封上还带着远方的风。',
  },
  gift: {
    title: '树洞里的小礼物',
    body: '树洞悄悄塞给你一颗树种，说是你写日记攒下的。',
  },
  visitor: {
    title: '有位小客人',
    body: '一只小刺猬在树下打了个滚，留下一句：今天的你也很棒。',
  },
  echo: {
    title: '树洞的回音',
    body: '树洞把你的话收好了，轻轻地回了一句。',
  },
}

export interface HollowEventOpts {
  title?: string
  body?: string
  fromBird?: BirdSpeciesId
  /**
   * ⚠️ `coins` 保留只是为了兼容老存档 —— 树洞不再送金币。
   * 礼物事件现在送树种（`seeds`），因为树本身也不产金币了。
   */
  coins?: number
  /** 礼物事件：送一颗树种 */
  seeds?: number
  defId?: string
}

/**
 * 造一个树洞事件。
 * id 由 kind + 时间 + 标题散列而来：同一毫秒的同类事件不会撞号，
 * 且不消耗随机源，方便上层复现。
 */
export function hollowEvent(
  kind: HollowEventKind,
  opts: HollowEventOpts,
  now: number,
): HollowEvent {
  const d = EVENT_DEFAULTS[kind]
  const title = opts.title ?? d.title
  const event: HollowEvent = {
    id: `he-${kind}-${now}-${hashSeed(`${kind}:${now}:${title}`)}`,
    kind,
    at: now,
    title,
    body: opts.body ?? d.body,
    read: false,
  }
  if (opts.fromBird) event.fromBird = opts.fromBird
  if (opts.coins !== undefined) event.coins = opts.coins
  if (opts.seeds !== undefined) event.seeds = opts.seeds
  if (opts.defId) event.defId = opts.defId
  return event
}

/* ============================================================
   四、丢日记进树洞
   ============================================================ */

export interface DropDiaryResult {
  state: TreeState
  event: HollowEvent
}

/**
 * 把一篇封存的日记丢进树洞。
 *
 * 只搬进 hollowDiaries，不改日记本身 —— 日记一旦封存就属于那一天，
 * 树洞只负责替它找一个安静的角落待着，并回一句「我听见了」。
 */
export function dropDiary(state: TreeState, entry: DiaryEntry, now: number): DropDiaryResult {
  const echo = echoFor(entry.id)
  const sealed: HollowDiary = {
    id: `hd-${entry.id}`,
    entryId: entry.id,
    dayKey: entry.dayKey,
    at: now,
    audio: entry.audio,
    echo,
  }
  const next: TreeState = {
    ...state,
    // 能丢日记说明树洞已经开了；顺手把解锁状态补上，避免存档不一致
    hollowUnlocked: true,
    hollowAt: state.hollowAt ?? now,
    hollowDiaries: [...state.hollowDiaries, sealed],
  }
  return { state: next, event: hollowEvent('echo', { body: echo }, now) }
}

/* ============================================================
   五、随机事件
   ============================================================ */

export interface HollowRollOpts {
  now: number
  levelIndex: number
  sproutCount: number
  hasPets: boolean
  rng: () => number
}

/**
 * 树上会不会冒出一个小事件。
 *
 * 概率 = 12% + 每棵树 0.6%，封顶 20%。
 *   · 基础 12%：让事件保持"偶尔才有"的惊喜感，绝不喧宾夺主。
 *   · 随树数增长：呼应「树越多，掉落事件增幅越多」。
 *   · 封顶 20%：再多树也不能把树洞变成事件流水线。
 *
 * 大部分时候返回 null，这是刻意的 —— 稀缺才显得珍贵。
 */
export function rollHollowEvent(opts: HollowRollOpts): HollowEvent | null {
  const { now, levelIndex, sproutCount, hasPets, rng } = opts
  const chance = Math.min(0.2, 0.12 + Math.max(0, sproutCount) * 0.006)
  if (rng() >= chance) return null

  const unlocked = isHollowUnlocked(levelIndex)

  // 权重表：没养鸟就没有信；树洞没开就没有回响。
  // 被砍掉的权重并给"小客人"，保证总权重恒定、事件永远不会缺席。
  const letterW = hasPets ? 30 : 0
  const echoW = unlocked ? 15 : 0
  const visitorW = 25 + (30 - letterW) + (15 - echoW)
  const table: { kind: HollowEventKind; w: number }[] = [
    { kind: 'letter', w: letterW },
    { kind: 'gift', w: 30 },
    { kind: 'visitor', w: visitorW },
    { kind: 'echo', w: echoW },
  ]
  const total = table.reduce((a, b) => a + b.w, 0)
  let roll = rng() * total
  let kind: HollowEventKind = 'visitor'
  for (const it of table) {
    roll -= it.w
    if (roll <= 0) {
      kind = it.kind
      break
    }
  }

  switch (kind) {
    case 'letter': {
      // 从现有的鸟里随便挑一只当信使
      const sender = BIRD_SPECIES[Math.floor(rng() * BIRD_SPECIES.length)]
      return hollowEvent('letter', { fromBird: sender.id }, now)
    }
    case 'gift': {
      // 送树种而不是金币：树不产金币，礼物也不该产。
      // 一颗树种落到地图上会长出看得见的东西，比几枚金币更有分量。
      return hollowEvent('gift', { seeds: 1 }, now)
    }
    case 'visitor':
      return hollowEvent('visitor', {}, now)
    case 'echo':
      return hollowEvent('echo', { body: HOLLOW_ECHOES[Math.floor(rng() * HOLLOW_ECHOES.length)] }, now)
  }
}
