/* ============================================================
   数据层 —— Dexie / IndexedDB
   ============================================================

   单机优先：所有数据都在本机，不依赖任何服务端。
   这也是"日记有密码"能成立的前提 —— 数据不上传。

   表设计：
     works     作品（作文）
     diary     日记
     library   我的作文题库
     cards     卡片背包
     meta      单例状态（段位 / 签到 / 设置 / 金币）
   ============================================================ */

import Dexie, { type EntityTable } from 'dexie'
import type {
  Bird,
  DiaryEntry,
  LevelState,
  LegacyTranscribeConfig,
  OwnedCard,
  Settings,
  Sprout,
  TranscribeConfig,
  TravelPhoto,
  TravelSouvenir,
  TreeState,
  VisitedLandmark,
  Work,
} from '../domain/types'
import { DEFAULT_CHILD_NAME } from '../domain/types'
import type { LibraryItem } from '../domain/library'
import { migrateStoredItem } from '../domain/library'
import { initialLevelState } from '../domain/levels'
import { initialStreak } from '../domain/diary'
import { initialTreeState } from '../domain/tree'
import { clampDailyGoal } from '../domain/economy'
import { DEFAULT_DEEPSEEK_MODEL, RETIRED_DEEPSEEK_MODELS, DEEPSEEK_BASE_URL, defaultAiConfig } from '../domain/ai'
import { defaultTranscribeConfig } from '../platform/transcribe'

/* ---------------- 元数据键 ---------------- */

export type MetaKey =
  | 'settings'
  | 'level'
  | 'streak'
  | 'wallet'
  | 'stats'
  /* ---- v3：成长树 / 小鸟 / 旅行 ---- */
  | 'tree'
  | 'birds'
  | 'sprouts'
  | 'photos'
  /* ---- v6：纪念品 / 到访记录 ---- */
  | 'souvenirs'
  | 'visited'

export interface Wallet {
  coins: number
  /** 累计获得，用于展示成就 */
  totalEarned: number
}

export interface LifetimeStats {
  compositions: number
  diaries: number
  recitations: number
  /** 累计写字数 */
  words: number
  /** 累计语音条数 */
  utterances: number
  /** 累计修改次数 */
  edits: number
  /** 首次使用时间 */
  startedAt: number
}

export function defaultSettings(): Settings {
  return {
    childName: DEFAULT_CHILD_NAME,
    avatar: '🌱',
    grade: 3,
    diaryPin: null,
    parentPin: '0000',
    soundOn: true,
    hapticsOn: true,
    ai: defaultAiConfig(),
    transcribe: defaultTranscribeConfig(),
    dailyGoal: 1,
    // 写作页默认题材 —— 新装/老存档没记录时都是写景
    lastCategory: 'scene',
    // 首次引导还没走完 —— 走完后置 true，之后不再出现
    onboarded: false,
    // 玩法引导（种完树之后那几屏）—— 和 onboarded 分开，见 types.ts 的说明
    guideDone: false,
  }
}

export function defaultWallet(): Wallet {
  return { coins: 0, totalEarned: 0 }
}

export function defaultStats(): LifetimeStats {
  return {
    compositions: 0,
    diaries: 0,
    recitations: 0,
    words: 0,
    utterances: 0,
    edits: 0,
    startedAt: Date.now(),
  }
}

/* ---------------- 数据库 ---------------- */

class LittleWriterDb extends Dexie {
  works!: EntityTable<Work, 'id'>
  diary!: EntityTable<DiaryEntry, 'id'>
  library!: EntityTable<LibraryItem, 'id'>
  cards!: EntityTable<OwnedCard, 'defId'>
  meta!: EntityTable<{ key: MetaKey; value: unknown }, 'key'>

  constructor() {
    super('little-writer-forest')

    this.version(1).stores({
      works: 'id, status, createdAt, updatedAt, category, grade',
      diary: 'id, dayKey, createdAt, updatedAt',
      library: 'id, category, tagId, addedAt, lastUsedAt, favorite',
      cards: 'defId, firstAt',
      meta: 'key',
    })
  }
}

export const db = new LittleWriterDb()

/* ---------------- 元数据读写 ---------------- */

export async function readMeta<T>(key: MetaKey): Promise<T | undefined> {
  const row = await db.meta.get(key)
  return row?.value as T | undefined
}

export async function writeMeta(key: MetaKey, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

export async function readSettings(): Promise<Settings> {
  return mergeSettings(await readMeta<Settings>('settings'))
}

/**
 * 设置项合并 —— 纯函数，不碰数据库。
 *
 * ★ 抽出来是为了让"启动快照"能复用同一套合并规则：
 *   快照走的是 `meta.toArray()`（一次拿全表），拿不到 `readMeta()` 的单键接口，
 *   但合并逻辑必须**一模一样**，否则两条路读出来的存档会长得不一样。
 *   所以规则只写在这里，两条路都调它。
 */
export function mergeSettings(s: Settings | undefined): Settings {
  if (!s) return defaultSettings()
  // 合并默认值：老版本数据缺字段时也能用
  return {
    ...defaultSettings(),
    ...s,
    ai: migrateRetiredDeepSeekModel({ ...defaultAiConfig(), ...s.ai }),
    // 语音转写是后加的：老存档里没有这个字段，补上默认值
    // ⚠️ 但它比 ai 那一路更绕 —— 见 migrateTranscribeConfig 的说明
    transcribe: migrateTranscribeConfig(s.transcribe),
    // 每日目标曾经可选到 5 篇，现在奖励上限是 3 —— 把老存档夹回来
    dailyGoal: clampDailyGoal(s.dailyGoal),
  }
}

/**
 * 把老存档里**已经弃用的** DeepSeek 模型名换成正式名。
 *
 * 为什么非要有这一步：改 `defaultAiConfig()` 只对**新装**的生效。
 * 已经存过设置的用户，`{ ...defaultAiConfig(), ...s.ai }` 里 `s.ai.model`
 * 会把默认值盖掉 —— 于是代码里明明写着新模型，家长那边跑的还是旧名字，
 * 得出「你改了但我这边一点变化都没有」的结论。这个项目里这类
 * "改了没生效" 已经踩过好几次（见 MEMORY.md §五），能一次说清就别留。
 *
 * ⚠️ 判据故意收得很窄，两个条件都满足才动：
 *     ① 模型名正好是我们**预置过的那个旧名字**（不是家长自己填的模型）；
 *     ② base_url 还是 DeepSeek 官方那个。
 *   家长自己换过服务商 / 自己填过模型名的一律不碰 —— 那是他的选择，
 *   不是"没跟上默认值"。
 *
 * ⚠️ 旧名字目前还能用（官方临时路由到 V4.1 Flash），所以**不迁移也不会坏**，
 *    只是会有一天静默降级。这也是为什么这里是"顺手扶正"而不是"必须修 bug"。
 */
export function migrateRetiredDeepSeekModel(ai: Settings['ai']): Settings['ai'] {
  if (!ai) return ai
  const isOfficialBase = (ai.baseUrl ?? '').replace(/\/+$/, '') === DEEPSEEK_BASE_URL.replace(/\/+$/, '')
  if (!isOfficialBase) return ai
  if (!RETIRED_DEEPSEEK_MODELS.includes(ai.model)) return ai
  return { ...ai, model: DEFAULT_DEEPSEEK_MODEL }
}

/**
 * 语音转写配置的合并 / 修复。
 *
 * ★★ 这个函数是为了修一个**真实发生过的故障**，别把它简化掉。
 *
 * 背景：转写原来有两条完全不同的路，靠 `engine` 区分 ——
 *   `'volcengine'` 火山流式（边说边传），配置里 **baseUrl 是空的**，密钥是火山家的（UUID）；
 *   `'openai'`     整包上传（硅基流动那类），配置里 **baseUrl 非空**，密钥是 `sk-` 家的。
 *
 * ⛔ 2026-10-02 家长定：「去掉硅基流动的东西，只使用火山。」
 *    整包上传那条路**连代码一起删了**，所以 `engine` / `baseUrl` 现在都不该再存在。
 *    但**这个函数必须留着** —— 盘上还有老存档，而它们的形状正是下面这个故障的现场。
 *    ⚠️ 删字段只改类型是不够的：老存档里那两个键还在，读出来照样会拼出自相矛盾的配置。
 *
 * 问题出在：`engine` 是**后加的字段**，而 `defaultTranscribeConfig()` 后来
 * 从 openai 那套换成了火山那套。老存档里没有 `engine`，于是
 * `{ ...defaultTranscribeConfig(), ...s.transcribe }` 会拼出一个**自相矛盾**的配置：
 *
 *     engine : 'volcengine'                        ← 来自新默认值
 *     apiKey : 'sk-…'（硅基流动的）                  ← 来自老存档
 *     baseUrl: 'https://api.siliconflow.cn/v1'      ← 来自老存档
 *
 * 于是界面切成「按住说话」，然后拿**硅基流动的密钥去连火山的 WebSocket**
 * → 握手被拒 HTTP 401 → 一个字都出不来。
 * （401 是实测的，见 `scripts/_probe-volcengine-stream.mjs` 换个密钥跑一次。）
 *
 * 家长看到的就是「**录音突然不好使了，之前明明是好的**」——
 * 而"之前"正是 engine 还没有、走的是整包上传那条路的时候。
 * 这类"改了默认值、老存档没跟上"本项目已经踩过好几次（见 MEMORY §七），
 * 所以这里按同一个规矩办：**能一次说清就别留**。
 *
 * ★ 判据只有一条：**配置必须自洽** —— 只认 `engine === 'volcengine'`
 *   且不带 baseUrl、不带 `sk-` 密钥的那一份。
 *   自洽的配置是家长的**明确选择**，保留；
 *   **其余（含"没有 engine"的老存档、以及已经删掉的 `'openai'`）→ 整份回到
 *   当前默认值**（火山，密钥内置）。
 *
 *   为什么老存档算"不自洽"而不是"猜成 openai"：
 *   那时 `engine` 还不存在，家长**没选过路由** —— 他填的只是当时唯一可填的那一格。
 *   猜成 openai 会把他钉在一个**已经删掉**的路由上；而火山那条路
 *   密钥内置、不用配、还更快。所以"跟着当前默认走"才是他真正想要的结果。
 */
export function migrateTranscribeConfig(
  saved: LegacyTranscribeConfig | undefined,
): TranscribeConfig {
  const d = defaultTranscribeConfig()
  if (!saved) return d

  const hasBase = Boolean(saved.baseUrl?.trim())
  const key = saved.apiKey?.trim() ?? ''
  /* 火山的密钥是 UUID；`sk-` 开头的一定是另一家（OpenAI / 硅基流动那一类）。
     用它来识别"这条路的密钥被另一条路串味了" —— 这是那个 401 的直接成因。 */
  const foreignKey = key.startsWith('sk-')

  const coherent =
    saved.engine === 'volcengine'
      ? !hasBase && !foreignKey // 火山不需要地址，也不该带着别家的密钥
      : false // 没有 engine（或已经删掉的 'openai'）→ 判不了 → 不自洽

  // 家长自己配的、自洽的配置：保留他的选择
  //
  // ★ 这里是**逐字段挑**，不是 `{ ...d, ...saved }`。
  //   为什么：整包上传那条路删掉之后，老存档里还留着 `engine` / `baseUrl`
  //   两个**已经没有意义的键**。原样 spread 会把它们继续写回存档 ——
  //   于是"删掉了"只体现在类型上，盘上永远清不干净。
  if (coherent) {
    return {
      apiKey: key,
      model: saved.model?.trim() || d.model,
      resourceId: saved.resourceId?.trim() || d.resourceId,
    }
  }

  // 不自洽 → 整份回到当前默认（火山 + 内置密钥），绝不做字段级拼接
  return d
}

/**
 * 读段位状态。
 *
 * ⚠️ 必须和初始值合并，不能直接返回存档里的对象。
 * 老的存档（或者手工写入的、字段不全的存档）可能缺 recentScores 之类的数组字段，
 * 页面上一句 `level.recentScores.length` 就会把整个成长树页打崩。
 * 补默认值的代价是几微秒，代价是不补的话用户看到的是"这一页出了点小问题"。
 */
export async function readLevel(): Promise<LevelState> {
  return mergeLevel(await readMeta<LevelState>('level'))
}

export function mergeLevel(saved: LevelState | undefined): LevelState {
  const base = initialLevelState()
  if (!saved) return base
  return {
    ...base,
    ...saved,
    // 数组字段单独兜底 —— 展开只保证"存在"，不保证"是数组"
    recentScores: Array.isArray(saved.recentScores) ? saved.recentScores : base.recentScores,
  }
}

export async function readStreak() {
  return mergeStreak(await readMeta<ReturnType<typeof initialStreak>>('streak'))
}

export function mergeStreak(saved: ReturnType<typeof initialStreak> | undefined) {
  return saved ?? initialStreak()
}

export async function readWallet(): Promise<Wallet> {
  return mergeWallet(await readMeta<Wallet>('wallet'))
}

export function mergeWallet(saved: Wallet | undefined): Wallet {
  return saved ?? defaultWallet()
}

export async function readStats(): Promise<LifetimeStats> {
  return mergeStats(await readMeta<LifetimeStats>('stats'))
}

export function mergeStats(saved: LifetimeStats | undefined): LifetimeStats {
  return saved ?? defaultStats()
}

/* ---------------- v3：成长树 / 小鸟 / 旅行 ----------------
 *
 * 这一组读函数都做「合并 + 数组兜底」，理由和 readLevel 一样：
 * v2 升级上来的存档没有这些字段，跨版本写入也可能缺项，
 * 而成长树页是每秒 tick 一次的重灾区 —— 一个 undefined 就白屏。
 */

/** 数组字段的兜底：存档里缺了或者类型不对，就用默认值 */
function asArray<T>(v: unknown, fallback: T[]): T[] {
  return Array.isArray(v) ? (v as T[]) : fallback
}

export async function readTree(): Promise<TreeState> {
  return mergeTree(await readMeta<TreeState>('tree'))
}

export function mergeTree(saved: TreeState | undefined): TreeState {
  const base = initialTreeState(Date.now())
  if (!saved) return base
  return {
    ...base,
    ...saved,
    pending: asArray(saved.pending, base.pending),
    hollowDiaries: asArray(saved.hollowDiaries, base.hollowDiaries),
    events: asArray(saved.events, []),
  }
}

export async function writeTree(state: TreeState): Promise<void> {
  await writeMeta('tree', state)
}

export async function readBirds(): Promise<Bird[]> {
  return asArray(await readMeta<Bird[]>('birds'), [])
}

export async function writeBirds(birds: Bird[]): Promise<void> {
  await writeMeta('birds', birds)
}

export async function readSprouts(): Promise<Sprout[]> {
  return asArray(await readMeta<Sprout[]>('sprouts'), [])
}

export async function writeSprouts(sprouts: Sprout[]): Promise<void> {
  await writeMeta('sprouts', sprouts)
}

export async function readPhotos(): Promise<TravelPhoto[]> {
  return asArray(await readMeta<TravelPhoto[]>('photos'), [])
}

export async function writePhotos(photos: TravelPhoto[]): Promise<void> {
  await writeMeta('photos', photos)
}

/* ---------------- v6：纪念品 / 到访记录 ---------------- */

export async function readSouvenirs(): Promise<TravelSouvenir[]> {
  return asArray(await readMeta<TravelSouvenir[]>('souvenirs'), [])
}

export async function writeSouvenirs(souvenirs: TravelSouvenir[]): Promise<void> {
  await writeMeta('souvenirs', souvenirs)
}

export async function readVisited(): Promise<VisitedLandmark[]> {
  return asArray(await readMeta<VisitedLandmark[]>('visited'), [])
}

export async function writeVisited(visited: VisitedLandmark[]): Promise<void> {
  await writeMeta('visited', visited)
}

/* ---------------- 作品 ---------------- */

export async function saveWork(work: Work): Promise<void> {
  await db.works.put(work)
}

export async function deleteWork(id: string): Promise<void> {
  await db.works.delete(id)
}

export async function listWorks(): Promise<Work[]> {
  return db.works.orderBy('createdAt').reverse().toArray()
}

/** 已评分的作品，按时间正序 —— 段位判定需要按顺序回放 */
export async function listScoredWorks(): Promise<Work[]> {
  const all = await db.works.orderBy('createdAt').toArray()
  return all.filter((w) => w.status !== 'draft' && w.score)
}

/* ---------------- 日记 ---------------- */

export async function saveDiary(entry: DiaryEntry): Promise<void> {
  await db.diary.put(entry)
}

export async function deleteDiary(id: string): Promise<void> {
  await db.diary.delete(id)
}

export async function listDiary(): Promise<DiaryEntry[]> {
  return db.diary.orderBy('dayKey').reverse().toArray()
}

/* ---------------- 题库 ---------------- */

export async function saveLibraryItems(items: LibraryItem[]): Promise<void> {
  await db.library.bulkPut(items)
}

export async function deleteLibraryItem(id: string): Promise<void> {
  await db.library.delete(id)
}

/**
 * ★★ 读出题库，并做**老存档迁移**（`genre` → `requiredGenre`）。
 *
 * 2026-10-01 改名之后，老用户库里那批题带的还是旧 key —— 直接读会
 * **全部变成记叙文题**（包括那 8 道应用文题）。而且这个失败是**静默**的：
 * 不报错、不崩、题一道不少、界面照常，只是格式要求悄悄退回缺省了。
 *
 * ⚠️ 所以「从库里读题」的路**必须全部走这里**，别再直接
 *    `db.library.toArray()` —— 抄第二条路就漏一条。
 */
async function readLibraryRows(): Promise<LibraryItem[]> {
  const rows = (await db.library.toArray()) as LibraryItem[]
  return rows.map(migrateStoredItem)
}

export async function listLibrary(): Promise<LibraryItem[]> {
  // ⚠️ 这里原来走 `orderBy('addedAt').reverse()`。改成整表拿回来内存排序，
  //    和 `readBootSnapshot()` 同一个理由（见那边文件头）：`orderBy` 走索引，
  //    `addedAt` 缺值的行**不会出现在索引里**，会被静默漏掉。
  //    本 App 的量级（几百道题）内存排序更快也更稳。
  const rows = await readLibraryRows()
  return rows.sort((a, b) => b.addedAt - a.addedAt)
}

export async function clearLibrary(): Promise<void> {
  await db.library.clear()
}

/* ---------------- 卡片 ---------------- */

export async function listCards(): Promise<OwnedCard[]> {
  return db.cards.toArray()
}

export async function saveCards(cards: OwnedCard[]): Promise<void> {
  await db.cards.bulkPut(cards)
}

/* ---------------- 启动快照 ---------------- */

/** 启动时要读的全部东西，一次事务读完 */
export interface BootSnapshot {
  settings: Settings
  level: LevelState
  streak: ReturnType<typeof initialStreak>
  wallet: Wallet
  stats: LifetimeStats
  tree: TreeState
  birds: Bird[]
  sprouts: Sprout[]
  photos: TravelPhoto[]
  souvenirs: TravelSouvenir[]
  visited: VisitedLandmark[]
  /** 已经写完的作品（草稿不进正文页，启动时就不必读正文那种大对象） */
  works: Work[]
  /** 日记 / 题库 / 卡片：boot 里还要各自加工（对账、排序），所以一并带出来 */
  diary: DiaryEntry[]
  library: LibraryItem[]
  cards: OwnedCard[]
}

/**
 * 启动快照 —— 一次事务把首屏要用的状态读完。
 *
 * ★ 为什么要有这个函数（而不是继续用 `Promise.all([readXX(), readXX(), ...])`）：
 *
 *   那些 `readXX()` 各自是"一次事务"，十几个就是十几次 IndexedDB 事务。
 *   在 Android WebView 上 IndexedDB 落在 SQLite 上，每次事务都要
 *   `BEGIN … COMMIT` 落一次盘（还要过一遍跨进程的桥），一次大约 20–40ms。
 *   十几次串起来就是 **300–500ms 的白屏**，全花在"排队等落盘"上 ——
 *   数据本身没多少，慢的是事务个数。
 *
 *   包成一个事务之后，那几百毫秒就变成一次。
 *   代价：不能再用 `orderBy()` 让游标逐行走，只能整表拿回来在内存里排。
 *   对本 App 的数据量（几十篇作文 / 几百道题）来说，内存排序比走索引更快。
 *
 * ★ works 为什么只拿已完成的：`Work.content` 是整篇作文的字符串，
 *   几十篇堆起来是这个快照里最大的一块。而首屏（首页 / 正文页）只列已完成的，
 *   草稿由写作页自己去取。
 */
export async function readBootSnapshot(): Promise<BootSnapshot> {
  return db.transaction('r', [db.meta, db.works, db.diary, db.library, db.cards], async () => {
    /* ★ 这里刻意用 `meta.toArray()` 而不是逐个 `readMeta()`：
       Dexie 对 `toArray()` 会直接 `getAll()` —— 一条请求把所有行拿回来；
       而 `get(key)` 每调一次都是**一条独立请求**，十几个键就是十几次往返。
       meta 只有十几个键、每个都不大，整表拿回来就地建 Map 最划算。 */
    const metaRows = await db.meta.toArray()
    const m = new Map(metaRows.map((r) => [r.key, r.value]))

    // 同一个事务里发的请求会被 Dexie 并行铺开，一起等
    // ★ 题库走 `readLibraryRows()`（它做老存档迁移：`genre` → `requiredGenre`）
    const [workRows, diaryRows, libraryRows, cardRows] = await Promise.all([
      db.works.toArray(),
      db.diary.toArray(),
      readLibraryRows(),
      db.cards.toArray(),
    ])

    return {
      settings: mergeSettings(m.get('settings') as Settings | undefined),
      level: mergeLevel(m.get('level') as LevelState | undefined),
      streak: mergeStreak(m.get('streak') as ReturnType<typeof initialStreak> | undefined),
      wallet: mergeWallet(m.get('wallet') as Wallet | undefined),
      stats: mergeStats(m.get('stats') as LifetimeStats | undefined),
      tree: mergeTree(m.get('tree') as TreeState | undefined),
      birds: asArray(m.get('birds'), [] as Bird[]),
      sprouts: asArray(m.get('sprouts'), [] as Sprout[]),
      photos: asArray(m.get('photos'), [] as TravelPhoto[]),
      souvenirs: asArray(m.get('souvenirs'), [] as TravelSouvenir[]),
      visited: asArray(m.get('visited'), [] as VisitedLandmark[]),
      works: workRows
        .filter((w) => w.status !== 'draft')
        .sort((a, b) => b.createdAt - a.createdAt),
      diary: diaryRows.sort((a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : 0)),
      library: libraryRows.sort((a, b) => b.addedAt - a.addedAt),
      cards: cardRows,
    }
  })
}

/* ---------------- 备份 ---------------- */

export interface BackupFile {
  format: 'little-writer-forest.backup'
  version: 1
  exportedAt: number
  settings?: Settings
  level?: LevelState
  streak?: unknown
  wallet?: Wallet
  stats?: LifetimeStats
  works: Work[]
  diary: DiaryEntry[]
  library: LibraryItem[]
  cards: OwnedCard[]
}

export async function exportBackup(now = Date.now()): Promise<BackupFile> {
  const [settings, level, streak, wallet, stats, works, diary, library, cards] =
    await Promise.all([
      readSettings(),
      readLevel(),
      readStreak(),
      readWallet(),
      readStats(),
      listWorks(),
      listDiary(),
      listLibrary(),
      listCards(),
    ])

  return {
    format: 'little-writer-forest.backup',
    version: 1,
    exportedAt: now,
    settings,
    level,
    streak,
    wallet,
    stats,
    works,
    diary,
    library,
    cards,
  }
}

/**
 * 从备份恢复。
 *
 * 采用「合并」而不是「覆盖」—— 换设备时用户往往希望
 * 两边的数据都在，而不是丢掉一边。
 */
export async function importBackup(
  backup: BackupFile,
): Promise<{ works: number; diary: number; library: number; cards: number }> {
  if (backup.format !== 'little-writer-forest.backup') {
    throw new Error('这不是小笔苗的备份文件')
  }

  await db.transaction('rw', db.works, db.diary, db.library, db.cards, async () => {
    if (Array.isArray(backup.works)) await db.works.bulkPut(backup.works)
    if (Array.isArray(backup.diary)) await db.diary.bulkPut(backup.diary)
    if (Array.isArray(backup.library)) await db.library.bulkPut(backup.library)
    if (Array.isArray(backup.cards)) await db.cards.bulkPut(backup.cards)
  })

  // 单例状态只在本地没有时才写入，避免把当前进度冲掉
  if (backup.wallet) {
    const cur = await readWallet()
    if (cur.coins === 0 && cur.totalEarned === 0) await writeMeta('wallet', backup.wallet)
  }
  if (backup.stats) {
    const cur = await readStats()
    if (cur.compositions === 0 && cur.diaries === 0) await writeMeta('stats', backup.stats)
  }
  if (backup.level) {
    const cur = await readLevel()
    if (cur.scoredCount === 0) await writeMeta('level', backup.level)
  }
  if (backup.settings) {
    await writeMeta('settings', { ...defaultSettings(), ...backup.settings })
  }

  return {
    works: backup.works?.length ?? 0,
    diary: backup.diary?.length ?? 0,
    library: backup.library?.length ?? 0,
    cards: backup.cards?.length ?? 0,
  }
}

/** 清空全部数据（危险操作，需要二次确认） */
export async function wipeAll(): Promise<void> {
  await db.transaction('rw', db.works, db.diary, db.library, db.cards, db.meta, async () => {
    await Promise.all([
      db.works.clear(),
      db.diary.clear(),
      db.library.clear(),
      db.cards.clear(),
      db.meta.clear(),
    ])
  })
}
