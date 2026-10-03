/* ============================================================
   全局状态与业务动作
   ============================================================
   分层约定：
     · domain/  —— 纯逻辑，无 IO
     · db/      —— 唯一写数据库的地方
     · 本文件    —— 唯一编排业务动作的地方（组件只调这里）

   组件永远不直接碰 db，也不自己算奖励 —— 这样规则只有一份，
   测试和改规则都不用满项目找。
   ============================================================ */

import { create } from 'zustand'
import type {
  Bird,
  BirdSpecies,
  CardDrop,
  CompositionPrompt,
  DiaryEntry,
  DiaryReview,
  DiaryStreak,
  GradeLevel,
  HollowEvent,
  LevelState,
  ModelEssay,
  OwnedCard,
  Recitation,
  ScoreDimension,
  Settings,
  Sprout,
  TravelPhoto,
  TravelSouvenir,
  TreeState,
  VisitedLandmark,
  Utterance,
  EditOperation,
  Work,
  WorkScore,
} from '../domain/types'
import { resolveGenre } from '../domain/types'
import { focusForGenre } from '../domain/prompts'

import {
  addDrops,
  blessingForScore,
  buffForStreak,
  pickBlessing,
  rollDrops,
} from '../domain/cards'
import { applyBonusXp, applyScore, initialLevelState } from '../domain/levels'
import { checkInStreak, computeDiaryReward, initialStreak, todayEntry } from '../domain/diary'
import { reconcileBuiltinLibrary, sameLibraryIds } from '../domain/builtinLibrary'
import {
  existingTitles,
  exportLibraryJson as exportLibraryJsonFn,
  importLibrary,
  markUsed,
  randomFromLibrary,
  removeItem,
  toggleFavorite,
  upsertItem,
  type ImportResult,
  type LibraryItem,
} from '../domain/library'
import { countWords } from '../domain/scoring'
import { dayKey } from '../domain/time'
import {
  db,
  defaultSettings,
  defaultStats,
  defaultWallet,
  deleteDiary as dbDeleteDiary,
  deleteLibraryItem,
  deleteWork as dbDeleteWork,
  exportBackup,
  importBackup,
  readBootSnapshot,
  saveCards,
  saveDiary as dbSaveDiary,
  saveLibraryItems,
  saveWork as dbSaveWork,
  wipeAll,
  writeBirds,
  writeMeta,
  writePhotos,
  writeSouvenirs,
  writeSprouts,
  writeTree,
  writeVisited,
  type BackupFile,
  type LifetimeStats,
  type Wallet,
} from '../db/db'
import { generateModelEssay, generatePrompt, reviewDiaryWithAi, scoreAndRewrite } from '../domain/ai'
import { collectAll, initialTreeState, tickTree, type CollectResult } from '../domain/tree'
import {
  adoptBird,
  birdReady,
  resolveReturn,
  sendBird,
  unlockedSpecies,
  type ReturnResult,
} from '../domain/pets'
import { distanceToLandmark, landmarkById, pickDestination, plantSeeds, sproutCount } from '../domain/travel'
import { dropDiary, isHollowUnlocked, rollHollowEvent } from '../domain/hollow'
import { setHapticsEnabled } from '../platform/haptics'
import { setSoundEnabled } from '../platform/sound'
import {
  DAILY_COMPOSITION_LIMIT,
  PACK_LUCK,
  PACK_SIZE,
  PACK_PRICE,
  canRecruit,
  compositionBaseCoins,
  newlyCompletedSets,
  recruitCost,
  setRewardCoins,
  talentLeftToday,
  treeCoinBoost,
} from '../domain/economy'

/* ============================================================
   类型
   ============================================================ */

export interface Toast {
  id: string
  kind: 'success' | 'reward' | 'info' | 'warn'
  title: string
  detail?: string
  emoji?: string
}

/** 一次提交的完整结算结果 —— 界面拿它来播动画 */
export interface SubmitResult {
  score: WorkScore
  /** AI 改写的「更好的写法」—— 提交时一起生成，点「看看更好的写法」直接展示 */
  modelEssay?: ModelEssay
  drops: CardDrop[]
  coins: number
  xp: number
  leveledUp: boolean
  leveledDown: boolean
  levelMessage?: string
  blessing: string
  /** 本次用了哪个引擎 */
  engine: 'local' | 'remote'
  warning?: string
  /** 这是第几篇（用于"预测水平"提示） */
  scoredCount: number
  /** 出分后的置信度 */
  confidence: LevelState['confidence']
  /**
   * 今天的才气用完了 —— 这篇没有金币也没有卡片。
   * 分数和经验照给，界面上要跟孩子说清楚，别让他以为白写了。
   */
  dailyLimitReached: boolean
  /** 这篇结算完之后，今天还剩多少才气 */
  talentLeft: number
  /** 本次用到的文心树金币加成倍率（1 表示还没有加成） */
  treeBoost: number
}

/**
 * 收树的结果。
 * 在 tree.collectAll 的基础上，补上「树种种到哪儿去了」——
 * 界面要告诉孩子这件事，不然树种等于凭空消失。
 */
export interface HarvestResult extends CollectResult {
  planted: { landmarkId: string; name: string }[]
  /** 这一把收成刚好让某个卡组集齐，额外拿到的奖励金币 */
  setBonus: number
}

export interface DiarySubmitResult {
  review: DiaryReview
  drops: CardDrop[]
  coins: number
  xp: number
  blessing: string
  buffLabel: string
  leveledUp: boolean
  levelMessage?: string
  engine: 'local' | 'remote'
  warning?: string
  /** 今天是不是第一次打卡 */
  isNewDay: boolean
  streakDays: number
}

interface AppState {
  ready: boolean

  settings: Settings
  wallet: Wallet
  level: LevelState
  streak: DiaryStreak
  stats: LifetimeStats

  works: Work[]
  diary: DiaryEntry[]
  library: LibraryItem[]
  cards: OwnedCard[]

  /* ---- v3：成长树 / 小鸟 / 旅行 ---- */
  /** 成长树：树上挂着的产出与累计收获 */
  tree: TreeState
  /** 已经来树上住的鸟 */
  birds: Bird[]
  /** 地标上发芽的树种 —— 点亮地图 */
  sprouts: Sprout[]
  /** 小鸟带回来的旅行照片 */
  photos: TravelPhoto[]
  /** v6：小鸟带回的纪念品（阅后即毁） */
  souvenirs: TravelSouvenir[]
  /** v6：到过的地标记录 */
  visited: VisitedLandmark[]

  toasts: Toast[]
  /** 全局忙碌标记（出题 / 评分中），用于禁用按钮 */
  busy: string | null

  /* ---- 生命周期 ---- */
  boot: () => Promise<void>
  toast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  setBusy: (v: string | null) => void

  /* ---- 设置 ---- */
  updateSettings: (patch: Partial<Settings>) => Promise<void>

  /* ---- 成长树 ---- */
  /** 按时间结算一次产出（幂等，可随时调用） */
  tickTreeNow: (now?: number) => void
  /** 把树上挂着的东西一次收完 */
  harvestTree: () => Promise<HarvestResult>

  /* ---- 小鸟与旅行 ---- */
  /** 段位到了就自动把新鸟接到树上，返回新来的鸟 */
  syncBirds: (levelIndex: number, now?: number) => Promise<Bird[]>
  /** 派一只鸟出门旅行 */
  dispatchBird: (species: Bird['species'], landmarkId?: string) => Promise<Bird | null>
  /** 把已经飞回来的鸟结算掉（照片 / 种子 / 卡 / 金币） */
  settleBird: (species: Bird['species']) => Promise<ReturnResult | null>
  /** 一只鸟是否已经飞回来了 */
  readyBirds: () => Bird[]
  /** v6：花金币永久保留一条纪念品 */
  keepSouvenir: (souvenirId: string) => Promise<boolean>

  /* ---- 金币经济（v3） ---- */
  /** 调试：直接加金币 */
  addCoins: (amount: number) => Promise<void>
  /** 花金币招募一只鸟；金币不够或段位不到则返回 null */
  recruitBird: (species: BirdSpecies) => Promise<Bird | null>
  /** 花金币开一包文心卡；金币不够则返回 null */
  openCardPack: () => Promise<CardDrop[] | null>

  /* ---- 题库 ---- */
  addToLibrary: (
    prompt: CompositionPrompt,
    opts: { source: LibraryItem['source']; aiGenerated: boolean },
  ) => Promise<void>
  removeFromLibrary: (id: string) => Promise<void>
  toggleLibraryFavorite: (id: string) => Promise<void>
  touchLibraryItem: (id: string) => Promise<void>
  importLibraryJson: (raw: string) => Promise<ImportResult>
  exportLibraryJson: () => string
  clearLibrary: () => Promise<void>

  /* ---- 题库 → 写作页 的一次性交接 ----
     为什么需要它：题库页和写作页之间没有 props 通道，而且 App 在
     打开题库时会把整棵页面树换掉（showLibrary ? <LibraryPage/> : page），
     写作页会被卸载重建。所以「选中哪道题」不能存在页面 state 里 ——
     存进去，切页那一瞬间就没了。放在 store 里跨过这次重挂载。
     写作页取走后立刻清空，避免「下次再进写作页又自动开了上次那道题」。 */
  /** 题库页选中的题目，等写作页来取 */
  pendingPrompt: CompositionPrompt | null
  /** 题库页写入：我要写这道题 */
  setPendingPrompt: (p: CompositionPrompt | null) => void
  /** 写作页读取并清空（读一次就消费掉） */
  takePendingPrompt: () => CompositionPrompt | null

  /* ---- 作文 ---- */
  generatePromptFor: (opts: {
    grade: GradeLevel
    category: CompositionPrompt['category']
    tagId?: string
  }) => Promise<{ prompt: CompositionPrompt; engine: 'local' | 'remote'; warning?: string }>
  /**
   * 直接从系统题库里随机抽一道题 —— 不走 AI，瞬间完成。
   * 抽到的题自动标记为「用过一次」。
   */
  pickRandomPrompt: (opts: {
    grade: GradeLevel
    category: CompositionPrompt['category']
    tagId?: string
  }) => Promise<CompositionPrompt | undefined>
  startWork: (prompt: CompositionPrompt, grade: GradeLevel) => Promise<Work>
  patchWork: (id: string, patch: Partial<Work>) => Promise<void>
  updateWorkText: (
    id: string,
    text: string,
    opts?: { utterances?: Utterance[]; edits?: EditOperation[] },
  ) => Promise<void>
  submitWork: (id: string) => Promise<SubmitResult>
  generateModelEssayFor: (id: string) => Promise<{
    essay: ModelEssay
    engine: 'local' | 'remote'
    warning?: string
  }>
  attachModelEssay: (id: string, essay: ModelEssay) => Promise<void>
  saveRecitation: (id: string, recitation: Recitation) => Promise<void>
  deleteWork: (id: string) => Promise<void>
  /**
   * 收藏 / 取消收藏一篇**孩子自己写的作文** —— 收藏了才会进「我的作文本」。
   *
   * ⚠️ 别跟 `toggleLibraryFavorite` 搞混：那个收藏的是「题」。
   *    见 `types.Work.favorite` 的说明。
   */
  toggleWorkFavorite: (id: string) => Promise<void>

  /* ---- 日记 ---- */
  getTodayDiary: () => DiaryEntry | undefined
  createDiary: (grade: GradeLevel) => Promise<DiaryEntry>
  patchDiary: (id: string, patch: Partial<DiaryEntry>) => Promise<void>
  submitDiary: (id: string) => Promise<DiarySubmitResult>
  deleteDiary: (id: string) => Promise<void>
  /** 封存今天的日记：一旦封存就永久不能改 */
  sealDiary: (id: string, audio?: { dataUrl: string; seconds: number }) => Promise<DiaryEntry | null>
  /** 把一篇已封存的日记丢进树洞 */
  dropDiaryIntoHollow: (id: string) => Promise<{ ok: boolean; echo: string } | null>
  /** 树洞是不是已经打开了 */
  hollowUnlocked: () => boolean

  /* ---- 数据 ---- */
  buildBackup: () => Promise<BackupFile>
  restoreBackup: (raw: string) => Promise<{ ok: boolean; message: string }>
  wipe: () => Promise<void>
}

/* ============================================================
   工具
   ============================================================ */

let toastSeq = 0
function makeId(prefix: string): string {
  toastSeq += 1
  return `${prefix}-${Date.now().toString(36)}-${toastSeq}`
}

/* ============================================================
   Store
   ============================================================ */

export const useApp = create<AppState>()((set, get) => ({
  ready: false,

  settings: defaultSettings(),
  wallet: defaultWallet(),
  level: initialLevelState(),
  streak: initialStreak(),
  stats: defaultStats(),

  works: [],
  diary: [],
  library: [],
  cards: [],

  // 题库 → 写作页 的一次性交接，见 AppState 里的说明
  pendingPrompt: null,

  tree: initialTreeState(Date.now()),
  birds: [],
  sprouts: [],
  photos: [],
  souvenirs: [],
  visited: [],

  toasts: [],
  busy: null,

  /* ---------------- 生命周期 ---------------- */

  boot: async () => {
    /* ★ 一次事务把首屏要的状态全读回来，而不是发十几个 Promise.all 请求。
       原因写在 db.ts 的 readBootSnapshot() 上：Android WebView 上
       每次 IndexedDB 事务都要落一次盘（约 20–40ms），十几次串起来
       就是三四百毫秒的白屏 —— 慢的是事务个数，不是数据量。
       （这直接决定了启动画面要停留多久，所以别改回逐条读。） */
    const snap = await readBootSnapshot()

    const {
      settings,
      wallet,
      level,
      streak,
      stats,
      works,
      diary,
      library,
      cards,
      tree,
      birds,
      sprouts,
      photos,
      souvenirs,
      visited,
    } = snap

    setSoundEnabled(settings.soundOn)
    setHapticsEnabled(settings.hapticsOn)

    /* 内置题库对账：把代码里的模板题并进来，并顺手更新老版本残留的模板。
       见 domain/builtinLibrary.ts 的说明 —— 内置题不写死进 DB，每次启动以代码为准。
       只有 id 序列真的变了才落盘，省掉每次启动一次的整表写。 */
    const reconciled = reconcileBuiltinLibrary(library)
    if (!sameLibraryIds(reconciled, library)) {
      void saveLibraryItems(reconciled)
    }

    set({
      ready: true,
      settings,
      wallet,
      level,
      streak,
      stats,
      works,
      diary,
      library: reconciled,
      cards,
      tree,
      birds,
      sprouts,
      photos,
      souvenirs,
      visited,
    })

    // 启动后立刻补一次时间结算 —— 离线期间树上结的东西不能丢
    get().tickTreeNow()
    // 段位涨了就把新鸟接进来
    await get().syncBirds(level.levelIndex)
  },

  toast: (t) => {
    const id = makeId('toast')
    /* 最多同时挂 3 条。
       理由：离线一段时间后回来，树可能一口气结出十几件东西，
       每件都 toast 的话会把整个屏幕糊住，孩子反而看不到重点。
       保留最新的几条，旧的直接让位。 */
    set((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-3) }))
    // 4 秒后自动消失
    window.setTimeout(() => get().dismissToast(id), 4000)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setBusy: (v) => set({ busy: v }),

  /* ---------------- 设置 ---------------- */

  updateSettings: async (patch) => {
    const next = { ...get().settings, ...patch }
    set({ settings: next })
    if (patch.soundOn !== undefined) setSoundEnabled(patch.soundOn)
    if (patch.hapticsOn !== undefined) setHapticsEnabled(patch.hapticsOn)
    await writeMeta('settings', next)
  },

  /* ---------------- 成长树 ---------------- */

  /**
   * 按时间结算产出。
   *
   * 用「随机的 now」调是安全的：tickTree 内部以 lastTickAt 为基准，
   * elapsed 不足一个间隔时槽位为 0，什么也不会发生。
   * 所以界面可以放心地每秒调一次来刷新"下一次还要多久"。
   */
  tickTreeNow: (now = Date.now()) => {
    const { tree, level, cards, birds } = get()
    const { state, grown } = tickTree(tree, {
      now,
      levelIndex: level.levelIndex,
      sproutCount: sproutCount(get().sprouts),
      owned: cards,
      hasPets: birds.length > 0,
    })
    if (state === tree) return

    /* 每结出一颗新果子，就有一次"树上冒出小事件"的机会。
       事件必须稀少才有分量 —— 概率在 hollow.ts 里封了顶。 */
    let next = state
    const events: HollowEvent[] = []
    /* 礼物事件送的是**树种**（树不产金币，礼物也不产）。
       先累加，最后一次性种下去，免得连中几颗时反复写库。 */
    let giftSeeds = 0
    for (let i = 0; i < grown.length; i += 1) {
      const ev = rollHollowEvent({
        now,
        levelIndex: level.levelIndex,
        sproutCount: sproutCount(get().sprouts),
        hasPets: birds.length > 0,
        rng: Math.random,
      })
      if (!ev) continue
      events.push(ev)
      if (ev.kind === 'gift' && ev.seeds) giftSeeds += ev.seeds
    }

    if (giftSeeds > 0) {
      const { sprouts: nextSprouts } = plantSeeds(get().sprouts, giftSeeds, now, Math.random)
      set({ sprouts: nextSprouts })
      void writeSprouts(nextSprouts)
    }

    if (events.length > 0) {
      next = { ...next, events: [...(next.events ?? []), ...events] }
      for (const ev of events) {
        get().toast({ kind: 'reward', title: ev.title, detail: ev.body })
      }
    }

    if (next.pending.length === tree.pending.length && next.lastTickAt === tree.lastTickAt) return
    set({ tree: next })
    void writeTree(next)
  },

  harvestTree: async () => {
    const { tree, wallet, cards, sprouts } = get()
    const result = collectAll(tree, Date.now())

    // 加卡统一走 applyCardDrops：顺手结算"刚集齐的卡组"奖励
    const { cards: nextCards, setBonus } = applyCardDrops(cards, result.drops, Date.now())

    const nextWallet: Wallet = {
      coins: wallet.coins + result.coins + setBonus,
      totalEarned: wallet.totalEarned + result.coins + setBonus,
    }

    /* ---- 树种必须真的落地 ----
       之前这里只把 result.seeds 弹进 toast，没有写进任何状态：
       孩子收下"一颗树种"，树种凭空消失，地图一点没动。
       现在交给 domain 的 plantSeeds：优先种到还没发芽的地标，
       整张地图都亮过了就在最矮的地方往上长一级。 */
    const { sprouts: nextSprouts, planted } = plantSeeds(
      sprouts,
      result.seeds,
      Date.now(),
      Math.random,
    )

    set({
      tree: result.state,
      wallet: nextWallet,
      cards: nextCards,
      sprouts: nextSprouts,
      // 收到的信：交给小鸟那边标记，读的时候就有信封在树上
      birds: result.letters > 0 ? get().birds.map((b) => ({ ...b, hasLetter: true })) : get().birds,
    })

    await Promise.all([
      writeTree(result.state),
      writeMeta('wallet', nextWallet),
      saveCards(nextCards),
      writeBirds(get().birds),
      ...(planted.length > 0 ? [writeSprouts(nextSprouts)] : []),
    ])

    return { ...result, planted, setBonus }
  },

  /* ---------------- 小鸟与旅行 ---------------- */

  syncBirds: async (levelIndex, now = Date.now()) => {
    const unlocked: BirdSpecies[] = unlockedSpecies(levelIndex)
    let birds = get().birds
    // v3：只自动送**免费**的鸟（麻雀）。
    // 其余鸟改成「段位到了 + 花金币招募」，见 recruitBird。
    // 这样金币才有出口，孩子的攒钱行为才有目标。
    for (const sp of unlocked) {
      if (recruitCost(sp.id) === 0) birds = adoptBird(birds, sp, now)
    }
    if (birds.length !== get().birds.length) {
      set({ birds })
      await writeBirds(birds)
    }
    return birds
  },

  readyBirds: () => get().birds.filter((b) => birdReady(b, Date.now())),

  dispatchBird: async (species, landmarkId) => {
    const { birds, visited, settings } = get()
    const idx = birds.findIndex((b) => b.species === species)
    if (idx < 0) return null
    const bird = birds[idx]
    if (bird.status === 'away') return null

    /*
     * ★★ 2026-09-25：目的地从**地标表**里挑，不再从内容包里挑。
     *    家长原话：「到了旅游点 判断会产生什么事件」—— 飞的是**旅游点**，
     *    带回来什么等**到了**再抽（见 `resolveReturn` / `travelEvents.ts`）。
     *
     * ★ `landmarkId` 是地图上「让它自己去一个没去过的地方」传进来的
     *   （`MapPage` 的 `onAct`）—— 以前这个参数被忽略（形参叫 `_landmarkId`），
     *   点了半天还是随机飞。现在认它了。
     * ⚠️ 传了个查不到的 id 就**退回随机挑**，不返回 null ——
     *    "点了没反应"比"去了别处"难查得多。
     */
    const dest =
      (landmarkId ? landmarkById(landmarkId) : undefined) ??
      pickDestination({ exclude: visited.map((v) => v.landmarkId), rng: Math.random })

    const distanceKm = distanceToLandmark(dest, settings.homePoint)

    const next = birds.slice()
    next[idx] = sendBird(bird, dest, distanceKm, Date.now(), Math.random)
    set({ birds: next })
    await writeBirds(next)
    return next[idx]
  },

  settleBird: async (species) => {
    const { birds, cards, photos, wallet, sprouts, souvenirs, visited, settings } = get()
    const idx = birds.findIndex((b) => b.species === species)
    if (idx < 0) return null
    const bird = birds[idx]
    if (!birdReady(bird, Date.now())) return null

    const now = Date.now()
    // 先清理过期的纪念品
    const activeSouvenirs = souvenirs.filter((s) => s.kept || s.expiresAt > now)

    const result = resolveReturn(bird, now, {
      rng: Math.random,
      owned: cards,
      home: settings.homePoint,
      /*
       * ★ 已经见过的内容 / 事件条目 —— 抽事件时优先避开。
       * ⚠️ 这个列表以前是在**派鸟时**算的（那时就定了带什么）；
       *    现在改成到达时才抽，所以要在**结算时**算。
       */
      seen: souvenirs.map((s) => s.contentId),
    })
    if (!result.bird || result.bird.status === 'away') return null

    const nextBirds = birds.slice()
    nextBirds[idx] = result.bird
    const { cards: nextCards, setBonus } = applyCardDrops(cards, result.drops, now)
    const nextPhotos = result.souvenir?.type === 'photo' ? [...photos] : photos
    const nextWallet: Wallet = {
      coins: wallet.coins + result.coins + setBonus,
      totalEarned: wallet.totalEarned + result.coins + setBonus,
    }

    // v6：纪念品
    const nextSouvenirs = result.souvenir ? [...activeSouvenirs, result.souvenir] : activeSouvenirs

    // v6：到访记录
    let nextVisited = visited
    if (result.visitedLandmarkId) {
      const existing = visited.find((v) => v.landmarkId === result.visitedLandmarkId)
      if (existing) {
        nextVisited = visited.map((v) =>
          v.landmarkId === result.visitedLandmarkId
            ? { ...v, visitCount: v.visitCount + 1 }
            : v,
        )
      } else {
        nextVisited = [...visited, { landmarkId: result.visitedLandmarkId, firstAt: now, visitCount: 1 }]
      }
    }

    // v6：种子只有树上有，归巢不带种子
    const nextSprouts = sprouts

    set({
      birds: nextBirds,
      cards: nextCards,
      photos: nextPhotos,
      wallet: nextWallet,
      sprouts: nextSprouts,
      souvenirs: nextSouvenirs,
      visited: nextVisited,
    })

    await Promise.all([
      writeBirds(nextBirds),
      saveCards(nextCards),
      writePhotos(nextPhotos),
      writeMeta('wallet', nextWallet),
      writeSprouts(nextSprouts),
      writeSouvenirs(nextSouvenirs),
      writeVisited(nextVisited),
    ])

    return { ...result, bird: result.bird }
  },

  keepSouvenir: async (souvenirId) => {
    const { souvenirs, wallet } = get()
    const target = souvenirs.find((s) => s.id === souvenirId)
    if (!target || target.kept) return false
    if (wallet.coins < target.keepCost) return false

    const nextSouvenirs = souvenirs.map((s) =>
      s.id === souvenirId ? { ...s, kept: true } : s,
    )
    const nextWallet: Wallet = {
      coins: wallet.coins - target.keepCost,
      totalEarned: wallet.totalEarned,
    }
    set({ souvenirs: nextSouvenirs, wallet: nextWallet })
    await Promise.all([
      writeSouvenirs(nextSouvenirs),
      writeMeta('wallet', nextWallet),
    ])
    return true
  },

  /* ---------------- 金币经济（v3） ---------------- */

  recruitBird: async (species) => {
    const { birds, wallet, level } = get()

    // 已经有同种鸟了，不重复招募
    if (birds.some((b) => b.species === species.id)) return null
    // 段位门槛：还没到这一级，有金币也不能招
    if (!canRecruit(level.levelIndex, species)) return null

    const cost = recruitCost(species.id)
    if (wallet.coins < cost) return null

    const now = Date.now()
    const nextBirds = adoptBird(birds, species, now)
    const nextWallet: Wallet = {
      // 注意 totalEarned 不动 —— 那是"一共挣过多少"的荣誉数字，
      // 花掉金币不该让它变小
      coins: wallet.coins - cost,
      totalEarned: wallet.totalEarned,
    }

    set({ birds: nextBirds, wallet: nextWallet })
    await Promise.all([writeBirds(nextBirds), writeMeta('wallet', nextWallet)])

    // 音效交给 UI 层播 —— store 里不放平台侧效果，方便测试
    get().toast({
      kind: 'reward',
      title: `「${species.name}」来树上住啦`,
      detail: `花了 ${cost} 金币。它说：${species.persona}`,
      emoji: '🐦',
    })

    return nextBirds[nextBirds.length - 1] ?? null
  },

  addCoins: async (amount) => {
    const wallet = get().wallet
    const nextWallet = {
      coins: Math.max(0, wallet.coins + amount),
      totalEarned: wallet.totalEarned,
    }
    set({ wallet: nextWallet })
    await writeMeta('wallet', nextWallet)
  },

  openCardPack: async () => {
    const { wallet, cards } = get()
    if (wallet.coins < PACK_PRICE) return null

    const now = Date.now()
    // 连开 PACK_SIZE 次并去重（同一种卡只留一张，避免"花钱买到重复"的挫败感）
    const drops: CardDrop[] = []
    for (let i = 0; i < PACK_SIZE; i++) {
      const rolled = rollDrops({
        source: 'tree', // 复用树产出的掉落池：卡包和树上掉卡是同一种东西
        count: 1,
        rarityBoost: PACK_LUCK,
        owned: cards,
        guaranteedNew: i === 0, // 第一张保底是新卡
      })
      for (const d of rolled) {
        if (!drops.some((x) => x.defId === d.defId)) drops.push(d)
      }
    }
    if (drops.length === 0) return null

    const { cards: nextCards, setBonus } = applyCardDrops(cards, drops, now)
    const nextWallet: Wallet = {
      // 开包是花钱，但"刚集齐的卡组"该发的奖励照发
      coins: wallet.coins - PACK_PRICE + setBonus,
      totalEarned: wallet.totalEarned + setBonus,
    }

    set({ cards: nextCards, wallet: nextWallet })
    await Promise.all([saveCards(nextCards), writeMeta('wallet', nextWallet)])

    return drops
  },

  /* ---------------- 题库 ---------------- */

  addToLibrary: async (prompt, opts) => {
    const next = upsertItem(get().library, prompt, {
      source: opts.source,
      aiGenerated: opts.aiGenerated,
    })
    set({ library: next })
    // 只写变化的那一条，不整表重写
    const item = next.find((i) => i.id === prompt.id)
    if (item) await saveLibraryItems([item])
  },

  removeFromLibrary: async (id) => {
    set({ library: removeItem(get().library, id) })
    await deleteLibraryItem(id)
  },

  toggleLibraryFavorite: async (id) => {
    const next = toggleFavorite(get().library, id)
    set({ library: next })
    const item = next.find((i) => i.id === id)
    if (item) await saveLibraryItems([item])
  },

  touchLibraryItem: async (id) => {
    const next = markUsed(get().library, id)
    set({ library: next })
    const item = next.find((i) => i.id === id)
    if (item) await saveLibraryItems([item])
  },

  importLibraryJson: async (raw) => {
    const result = importLibrary(get().library, raw)
    if (result.ok) {
      set({ library: result.items })
      await saveLibraryItems(result.items)
    }
    return result
  },

  exportLibraryJson: () => {
    return exportLibraryJsonFn(get().library)
  },

  /**
   * 清空题库 —— **只清掉自己攒的题**（AI 出的 / 本地抽的 / 导入的）。
   *
   * 内置的 136 道会留着，连「用过几次、收藏没收藏」一起留着。
   * 理由：内置题来自代码，删掉下次启动照样对账回来 ——
   * 与其给一个「点了没反应」的按钮，不如老实说清「内置的删不掉」。
   */
  clearLibrary: async () => {
    const kept = get().library.filter((i) => i.source === 'builtin')
    set({ library: kept })
    await db.library.clear()
    await saveLibraryItems(kept)
  },

  setPendingPrompt: (p) => {
    set({ pendingPrompt: p })
  },

  takePendingPrompt: () => {
    const p = get().pendingPrompt
    // 取走就清空 —— 不清的话，下次再进写作页又会自动开同一道题
    if (p) set({ pendingPrompt: null })
    return p
  },

  /* ---------------- 作文 ---------------- */

  generatePromptFor: async ({ grade, category, tagId }) => {
    set({ busy: '正在出题…' })
    try {
      const result = await generatePrompt({
        grade,
        category,
        tagId,
        excludeTitles: existingTitles(get().library),
        cfg: get().settings.ai,
      })

      // 按需求：生成出来的题目自动入库
      await get().addToLibrary(result.prompt, {
        source: result.engine === 'remote' ? 'ai' : 'local',
        aiGenerated: result.engine === 'remote',
      })

      if (result.warning) {
        get().toast({ kind: 'warn', title: 'AI 没接上', detail: result.warning, emoji: '⚠️' })
      }

      return result
    } finally {
      set({ busy: null })
    }
  },

  pickRandomPrompt: async ({ grade, category, tagId }) => {
    const item = randomFromLibrary(get().library, { grade, category, tagId })
    if (!item) return undefined
    // 标记为用过
    const next = markUsed(get().library, item.id)
    set({ library: next })
    await saveLibraryItems(next)
    return item
  },

  startWork: async (prompt, grade) => {
    const now = Date.now()
    const work: Work = {
      id: makeId('work'),
      kind: 'composition',
      promptId: prompt.id,
      title: prompt.title,
      category: prompt.category,
      // ★ 快照格式要求（跟 title/category 一样冗余存）：题目库以后改了或题被删了，
      //   旧作还得知道当时按什么标准评的分。老存档没这个字段 → 读出记叙文。
      //   ⚠️ 来源是 `requiredGenre`（题目**自带**的格式要求，目前只有应用文）。
      //   ⛔ **没有「等孩子自选文体」这一步了** —— 家长 2026-10-02 明确说
      //     「APP 不需要区分文体」，孩子写记叙/说明/议论由他自己决定。
      //     别再照这句话去加文体选择器。
      genre: resolveGenre(prompt.requiredGenre),
      grade,
      createdAt: now,
      updatedAt: now,
      status: 'draft',
      text: '',
      utterances: [],
      edits: [],
      images: prompt.images,
      wordCount: 0,
    }
    set((s) => ({ works: [work, ...s.works] }))
    await dbSaveWork(work)
    await get().touchLibraryItem(prompt.id)
    return work
  },

  patchWork: async (id, patch) => {
    const next = get().works.map((w) =>
      w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w,
    )
    set({ works: next })
    const w = next.find((x) => x.id === id)
    if (w) await dbSaveWork(w)
  },

  updateWorkText: async (id, text, opts) => {
    const patch: Partial<Work> = {
      text,
      wordCount: countWords(text),
      updatedAt: Date.now(),
    }
    if (opts?.utterances) patch.utterances = opts.utterances
    if (opts?.edits) patch.edits = opts.edits
    await get().patchWork(id, patch)
  },

  submitWork: async (id) => {
    const work = get().works.find((w) => w.id === id)
    if (!work) throw new Error('找不到这篇作文')
    if (!work.text.trim()) throw new Error('还没有内容，先写点什么吧')

    const { settings, level, streak, cards: owned } = get()
    const at = Date.now()
    /* 才气在提交前先算：这篇还没打分，所以数到的是"之前评过的"。
       talentBefore > 0 表示这一篇还有奖励额度。 */
    const talentBefore = talentLeftToday(get().works, at)
    const rewarded = talentBefore > 0
    /* 树加成用「写这篇时」的段位，不用评分后的新段位 ——
       否则升级那一次会拿到双份好处，也不好跟孩子解释。 */
    const treeBoost = treeCoinBoost(level.levelIndex)
    set({ busy: 'AI 正在看你的作文…' })

    try {
      /* 1. 评分 + 改范文（一次 AI 调用） */
      const { score, essay, engine, warning } = await scoreAndRewrite({
        text: work.text,
        childText: work.text,
        grade: work.grade,
        category: work.category ?? 'event',
        // ★ 格式要求 —— 少了它，应用文会被当写事题改写、评分也按记叙文给
        genre: resolveGenre(work.genre),
        title: work.title,
        wordRange: wordRangeOf(work),
        focus: focusOf(work, get().library),
        images: work.images,
        cfg: settings.ai,
      })

      /* 2. 段位判定 */
      const lv = applyScore(level, score)

      /* 3. 掉落 —— 分数 + 签到 Buff 共同决定。
            才气用完了就什么都不掉（见 economy.ts 的防刷说明）。 */
      const buff = buffForStreak(streak.days)
      const drops: CardDrop[] = []

      if (rewarded) {
        drops.push(
          ...rollDrops({
            source: 'composition',
            score: score.total,
            stars: score.stars,
            rarityBoost: buff.rarityBoost,
            owned,
          }),
        )

        // 五星额外再掉一张，且必为新卡
        if (score.stars >= 5) {
          drops.push(
            ...rollDrops({
              source: 'high_score',
              score: score.total,
              rarityBoost: buff.rarityBoost * 1.4,
              count: 1,
              owned,
              guaranteedNew: true,
            }),
          )
        }

        // 升段奖励
        if (lv.leveledUp) {
          drops.push(
            ...rollDrops({
              source: 'level_up',
              rarityBoost: buff.rarityBoost * 1.6,
              count: 2,
              owned,
            }),
          )
        }
      }

      /* 4. 金币 —— 写作是唯一的来源，文心树给加成。
            没有才气就不给金币：这是"防止刷金币"的落点。 */
      const baseCoins = compositionBaseCoins(score.total, score.stars)
      const activityCoins = rewarded ? Math.round(baseCoins * buff.coinBoost * treeBoost) : 0

      /* 5. 落库 */
      const { cards: nextCards, setBonus } = applyCardDrops(owned, drops, at)
      // 刚集齐卡组的一次性奖励也算进这次的收入，界面上看到的就是钱包真涨的数
      const coins = activityCoins + setBonus
      const nextWallet: Wallet = {
        coins: get().wallet.coins + coins,
        totalEarned: get().wallet.totalEarned + coins,
      }
      const nextStats: LifetimeStats = {
        ...get().stats,
        compositions: get().stats.compositions + 1,
        words: get().stats.words + work.wordCount,
        utterances: get().stats.utterances + work.utterances.length,
        edits: get().stats.edits + work.edits.length,
      }

      const updatedWork: Work = {
        ...work,
        score,
        modelEssay: essay,
        status: 'scored',
        scoredAt: at,
        updatedAt: at,
      }

      set((s) => ({
        works: s.works.map((w) => (w.id === id ? updatedWork : w)),
        level: lv.next,
        cards: nextCards,
        wallet: nextWallet,
        stats: nextStats,
      }))

      await Promise.all([
        dbSaveWork(updatedWork),
        saveCards(nextCards),
        writeMeta('wallet', nextWallet),
        writeMeta('level', lv.next),
        writeMeta('stats', nextStats),
      ])

      const blessing = blessingForScore(score.total)

      /* 才气用完这件事必须主动说 —— 不然孩子会以为"写了没奖励"是 bug */
      if (!rewarded) {
        get().toast({
          kind: 'info',
          title: '今天的才气用完啦',
          detail: `一天最多 ${DAILY_COMPOSITION_LIMIT} 篇有奖励。这篇照样给你打了分，明天再来结果子吧。`,
        })
      }

      return {
        score,
        modelEssay: essay,
        drops,
        coins,
        xp: lv.xpGained,
        leveledUp: lv.leveledUp,
        leveledDown: lv.leveledDown,
        levelMessage: lv.message,
        blessing,
        engine,
        warning,
        scoredCount: lv.next.scoredCount,
        confidence: lv.next.confidence,
        dailyLimitReached: !rewarded,
        talentLeft: Math.max(0, talentBefore - 1),
        treeBoost,
      }
    } finally {
      set({ busy: null })
    }
  },

  attachModelEssay: async (id, essay) => {
    await get().patchWork(id, { modelEssay: essay })
  },

  /**
   * 生成「更好的写法」。
   *
   * 这是一个独立的、可重复触发的动作，而不是评分的一部分 ——
   * 孩子想再看一遍、或者换了 AI 想重出，都可以再点一次。
   *
   * ★ 它永远不会覆盖孩子的正文，两者在数据里是两个字段。
   */
  generateModelEssayFor: async (id) => {
    const work = get().works.find((w) => w.id === id)
    if (!work) throw new Error('找不到这篇作文')

    set({ busy: 'AI 正在写更好的写法…' })
    try {
      const result = await generateModelEssay({
        childText: work.text,
        title: work.title,
        grade: work.grade,
        category: work.category ?? 'event',
        // ★ 格式要求 —— 少了它，应用文会被当写事题改写
        genre: resolveGenre(work.genre),
        wordRange: wordRangeOf(work),
        images: work.images,
        cfg: get().settings.ai,
      })

      await get().patchWork(id, { modelEssay: result.essay })

      if (result.warning) {
        get().toast({ kind: 'warn', title: 'AI 没接上', detail: result.warning, emoji: '⚠️' })
      }

      return result
    } finally {
      set({ busy: null })
    }
  },

  saveRecitation: async (id, recitation) => {
    const work = get().works.find((w) => w.id === id)
    if (!work) return

    /* 背诵奖励 */
    const { streak, level, cards: owned, stats } = get()
    const buff = buffForStreak(streak.days)

    const drops = rollDrops({
      source: 'recitation',
      score: recitation.matchScore,
      rarityBoost: buff.rarityBoost,
      owned,
    })

    /* 背诵奖励在 ReciteView 里就一次算准了（连续签到 Buff × 文心树加成），
       这里照单入账 —— 界面显示的数字和钱包涨的数字必须是同一个。 */
    const coins = recitation.reward.coins
    const xpGain = recitation.reward.xp
    const lv = applyBonusXp(level, xpGain)

    const { cards: nextCards, setBonus } = applyCardDrops(owned, drops, Date.now())
    const nextWallet: Wallet = {
      coins: get().wallet.coins + coins + setBonus,
      totalEarned: get().wallet.totalEarned + coins + setBonus,
    }
    const nextStats: LifetimeStats = {
      ...stats,
      recitations: stats.recitations + 1,
    }

    const updatedWork: Work = {
      ...work,
      recitation: { ...recitation, reward: { ...recitation.reward, cards: drops } },
      status: 'recited',
      updatedAt: Date.now(),
    }

    set((s) => ({
      works: s.works.map((w) => (w.id === id ? updatedWork : w)),
      cards: nextCards,
      wallet: nextWallet,
      level: lv.next,
      stats: nextStats,
    }))

    await Promise.all([
      dbSaveWork(updatedWork),
      saveCards(nextCards),
      writeMeta('wallet', nextWallet),
      writeMeta('level', lv.next),
      writeMeta('stats', nextStats),
    ])
  },

  deleteWork: async (id) => {
    set((s) => ({ works: s.works.filter((w) => w.id !== id) }))
    await dbDeleteWork(id)
  },

  toggleWorkFavorite: async (id) => {
    const w = get().works.find((x) => x.id === id)
    // 找不到就当没点 —— 收藏是个纯 UI 动作，不值得为它抛错打断孩子
    if (!w) return
    await get().patchWork(id, { favorite: !w.favorite })
  },

  /* ---------------- 日记 ---------------- */

  getTodayDiary: () => todayEntry(get().diary),

  createDiary: async (grade) => {
    const now = Date.now()
    const key = dayKey(now)
    const entry: DiaryEntry = {
      id: makeId('diary'),
      dayKey: key,
      createdAt: now,
      updatedAt: now,
      mood: '🙂',
      weather: '☀️',
      text: '',
      utterances: [],
      edits: [],
      status: 'draft',
      wordCount: 0,
      // 新建的日记一定是未封存的
      sealed: false,
    }
    set((s) => ({ diary: [entry, ...s.diary] }))
    await dbSaveDiary(entry)
    void grade
    return entry
  },

  patchDiary: async (id, patch) => {
    const next = get().diary.map((d) =>
      d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d,
    )
    set({ diary: next })
    const d = next.find((x) => x.id === id)
    if (d) await dbSaveDiary(d)
  },

  submitDiary: async (id) => {
    const entry = get().diary.find((d) => d.id === id)
    if (!entry) throw new Error('找不到这篇日记')
    if (!entry.text.trim()) throw new Error('还没有内容哦')

    const { settings, streak, level, cards: owned, stats } = get()
    set({ busy: 'AI 正在看你的日记…' })

    try {
      /* 1. 点评 */
      const { review, engine, warning } = await reviewDiaryWithAi({
        text: entry.text,
        grade: settings.grade,
        cfg: settings.ai,
      })

      /* 2. 签到 */
      const checkIn = checkInStreak(streak, Date.now())

      /* 3. 奖励 */
      const reward = computeDiaryReward({
        stars: review.stars,
        wordCount: entry.wordCount,
        streak: checkIn.next,
        isNewDay: checkIn.isNewDay,
        owned,
      })

      const lv = applyBonusXp(level, reward.xp)
      const { cards: nextCards, setBonus } = applyCardDrops(owned, reward.cards, Date.now())

      /* 金币吃文心树加成；奖励本身每天只算一次（见 computeDiaryReward） */
      const coins = Math.round(reward.coins * treeCoinBoost(level.levelIndex)) + setBonus
      const nextWallet: Wallet = {
        coins: get().wallet.coins + coins,
        totalEarned: get().wallet.totalEarned + coins,
      }
      const nextStats: LifetimeStats = {
        ...stats,
        diaries: stats.diaries + 1,
        words: stats.words + entry.wordCount,
        utterances: stats.utterances + entry.utterances.length,
        edits: stats.edits + entry.edits.length,
      }

      const updated: DiaryEntry = {
        ...entry,
        review,
        status: 'scored',
        updatedAt: Date.now(),
      }

      set((s) => ({
        diary: s.diary.map((d) => (d.id === id ? updated : d)),
        streak: checkIn.next,
        level: lv.next,
        cards: nextCards,
        wallet: nextWallet,
        stats: nextStats,
      }))

      await Promise.all([
        dbSaveDiary(updated),
        saveCards(nextCards),
        writeMeta('wallet', nextWallet),
        writeMeta('level', lv.next),
        writeMeta('streak', checkIn.next),
        writeMeta('stats', nextStats),
      ])

      return {
        review,
        drops: reward.cards,
        coins,
        xp: reward.xp,
        blessing: reward.blessing,
        buffLabel: reward.buffLabel,
        leveledUp: lv.leveledUp,
        levelMessage: lv.message,
        engine,
        warning,
        isNewDay: checkIn.isNewDay,
        streakDays: checkIn.next.days,
      }
    } finally {
      set({ busy: null })
    }
  },

  deleteDiary: async (id) => {
    set((s) => ({ diary: s.diary.filter((d) => d.id !== id) }))
    await dbDeleteDiary(id)
  },

  /**
   * 封存日记。
   *
   * 「封存」是产品规则而不是技术限制：今天过去了就是过去了，
   * 让它保持当时的样子，比"改得更好"更重要。
   * 所以这里只允许从未封存 → 已封存这一个方向。
   */
  sealDiary: async (id, audio) => {
    const entry = get().diary.find((d) => d.id === id)
    if (!entry || entry.sealed) return null

    const patch: Partial<DiaryEntry> = {
      sealed: true,
      sealedAt: Date.now(),
    }
    if (audio) {
      patch.audio = audio.dataUrl
      patch.audioSeconds = audio.seconds
    }
    await get().patchDiary(id, patch)
    return get().diary.find((d) => d.id === id) ?? null
  },

  dropDiaryIntoHollow: async (id) => {
    const entry = get().diary.find((d) => d.id === id)
    if (!entry || !entry.sealed) return null

    const { state, event } = dropDiary(get().tree, entry, Date.now())
    set({ tree: state })
    await writeTree(state)
    await get().patchDiary(id, { inHollow: true })
    return { ok: true, echo: event.body }
  },

  hollowUnlocked: () => isHollowUnlocked(get().level.levelIndex),

  /* ---------------- 数据 ---------------- */

  buildBackup: async () => exportBackup(),

  restoreBackup: async (raw) => {
    try {
      const parsed = JSON.parse(raw) as BackupFile
      const counts = await importBackup(parsed)
      await get().boot()
      return {
        ok: true,
        message: `恢复完成：作文 ${counts.works} 篇、日记 ${counts.diary} 篇、题目 ${counts.library} 道、卡片 ${counts.cards} 张`,
      }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : '恢复失败，文件可能已损坏',
      }
    }
  },

  wipe: async () => {
    await wipeAll()
    set({
      works: [],
      diary: [],
      library: [],
      cards: [],
      level: initialLevelState(),
      streak: initialStreak(),
      wallet: defaultWallet(),
      stats: defaultStats(),
    })
    await get().boot()
  },
}))

/* ============================================================
   派生数据
   ============================================================
   ⚠️ 这些刻意写成「普通函数」而不是 zustand selector hook。

   原因：它们都返回新对象/新数组。如果直接写成
   `useApp(selectXxx())`，useSyncExternalStore 每次都会认为
   状态变了，导致无限重渲染（React error #185）。

   组件里请这样用：
     const works = useApp((s) => s.works)
     const list = useMemo(() => selectRecentWorks(works, 5), [works])
   ============================================================ */

export function selectRecentWorks(works: Work[], limit = 5): Work[] {
  return works.slice(0, limit)
}

export function selectTodayDiary(diary: DiaryEntry[], now = Date.now()): DiaryEntry | undefined {
  const key = dayKey(now)
  return diary.find((d) => d.dayKey === key)
}

export function selectScoredWorks(works: Work[]): Work[] {
  return works.filter((w) => w.score)
}

export function selectRecentScores(
  works: Work[],
  limit = 10,
): { at: number; total: number; title: string }[] {
  return works
    .filter((w) => w.score)
    .slice(0, limit)
    .map((w) => ({ at: w.createdAt, total: w.score!.total, title: w.title }))
}

/** 每日目标完成情况 */
export function selectDailyProgress(
  works: Work[],
  diary: DiaryEntry[],
  goal: number,
  now = Date.now(),
): { compositions: number; diaryDone: boolean; goal: number; reached: boolean } {
  const key = dayKey(now)
  const today = works.filter((w) => dayKey(w.createdAt) === key && w.score)
  return {
    compositions: today.length,
    diaryDone: diary.some((d) => d.dayKey === key && d.status !== 'draft'),
    goal,
    reached: today.length >= goal,
  }
}

/* ---------------- 内部工具 ---------------- */

/**
 * 所有"加卡"都走这里 —— 加卡，并顺手把「刚刚集齐的卡组」奖励发掉。
 *
 * 为什么要补这一步：集齐卡组本来就有一次性金币奖励（CARD_SETS[].reward），
 * 卡片页也一直写着「再集 N 张就能拿奖励：300 金币」——
 * 但那笔钱从来没有真的发过：屏幕上承诺了，孩子集齐了却什么都没发生。
 * 判定用"加卡前后对比"，所以不需要额外存一份"已领取"清单
 * （卡片只增不减，"没集齐 → 集齐"只会发生一次）。
 *
 * 没有掉落时原样返回，保持引用相等 —— 有些调用点靠这个避免多余的写库。
 */
function applyCardDrops(
  prev: OwnedCard[],
  drops: CardDrop[],
  at: number,
): { cards: OwnedCard[]; setBonus: number } {
  if (drops.length === 0) return { cards: prev, setBonus: 0 }

  const cards = addDrops(prev, drops, at)
  const done = newlyCompletedSets(prev, cards)
  if (done.length === 0) return { cards, setBonus: 0 }

  for (const s of done) {
    useApp.getState().toast({
      kind: 'reward',
      title: `集齐「${s.name}」！`,
      detail: `奖励 ${s.reward.coins} 金币 · 称号「${s.reward.title}」`,
      emoji: '🎉',
    })
  }
  return { cards, setBonus: setRewardCoins(done) }
}

function wordRangeOf(work: Work): [number, number] {
  const len = work.wordCount || countWords(work.text)
  if (len < 50) return [30, 120]
  if (len < 120) return [60, 200]
  if (len < 250) return [120, 350]
  return [200, 500]
}

/**
 * 这篇作文按哪几个维度评分。
 *
 * ⚠️ **导出是为了给测试检查**（跟 `explainMaterial` 同一个理由）——
 *    它守的是「应用文不能按记叙文评分」这条，而这条**不报错**：
 *    权重错了照样出一个分数，只是那个分数在夸「观察力」。
 */
export function focusOf(work: Work, library: LibraryItem[]): ScoreDimension[] {
  // 优先用题库里标注的考察重点；没有就按年级和题材推
  const prompt = library.find((p) => p.id === work.promptId)
  if (prompt && prompt.focus.length > 0) return prompt.focus

  /*
   * ★★ 非记叙文：读**同一份**判定 —— `focusForGenre()`（在 `prompts.ts`）。
   *
   *   这个函数和 `focusFor` 是「同一套考察重点规则的两份实现」
   *   （出题一份、评分一份）—— 本项目已经栽过「同一判定抄两份然后走散」。
   *   2026-10-01 一次加过说明文/议论文（10-02 又删了），当时抄两份就等于抄四次，
   *   所以**这一层**抽成了 `focusForGenre()`，两边都调它。
   *
   *   ⚠️ 内置题**不带 focus**（`builtinBaseItems` 留空），所以
   *      应用文的评分权重**真的会走到这一行** —— 不是死代码。
   *
   *   ⚠️ 下面按年级分档那几行**仍然和 `focusFor` 不完全一样**
   *      （1–4 年级的想象类：这里给 `vocabulary`，`focusFor` 给 `imagination`）。
   *      这是**既有**分歧，2026-10-01 没动 —— 改它等于改变低年级想象类的
   *      评分重点，属于行为变更。真要修就是让这个函数整个委托 `focusFor`。
   */
  const byGenre = focusForGenre(work.genre)
  if (byGenre) return byGenre

  const cat = work.category ?? 'event'
  const g = work.grade
  if (g <= 2) return ['observation', 'vocabulary']
  if (g <= 4) return ['observation', 'structure', 'vocabulary']
  if (cat === 'imagine') return ['structure', 'imagination', 'emotion']
  return ['structure', 'emotion', 'vocabulary']
}

/* 便于外部直接用的重导出 */
export { pickBlessing }
export type { AppState }
