/* ============================================================
   小笔苗 · 作文森林 —— 应用外壳  v3
   ============================================================

   职责：
     · 首次进入的「种下你的树」引导（年级在这里选一次，之后进设置）
     · 紧接着的「新手引导」三屏（怎么用 —— 见 features/onboarding/Guide.tsx）
     · 入场 Splash（每次打开换一句格言）
     · 顶部状态条（昵称 / 段位 / 产出提示 / 设置）
     · 底部四个主入口 + 小鸟旅行 + 地图
     · 全局 Toast
     · 跨页跳转事件

   v3 的变化（对照 v2 的问题）：
     · 年级从「写作文」首页搬走 —— 它是一次性设置，不该占版面
     · 导航与头部全面换掉 emoji，用统一的自绘线性图标
     · 沉浸场景（写作文 / 树洞）会隐藏头部与底部导航，只留一条极细的
       「退出沉浸」条 —— 这是让孩子注意力集中的关键
   ============================================================ */

import { useEffect, useMemo, useState } from 'react'
import { useApp } from './store/useApp'
import { dayKey } from './domain/time'
import { levelAt } from './domain/levels'
import { compositionsScoredToday } from './domain/economy'
import { gradeLabel, type GradeLevel } from './domain/types'
import ComposePage from './features/compose/ComposePage'
import DiaryPage from './features/diary/DiaryPage'
import LevelPage from './features/level/LevelPage'
import CardsPage from './features/cards/CardsPage'
import SettingsPage from './features/settings/SettingsPage'
import WorkbookPage from './features/library/WorkbookPage'
import MapPage from './features/map/MapPage'
import Onboarding from './features/onboarding/Onboarding'
import Guide from './features/onboarding/Guide'
import { ErrorBoundary } from './components/ErrorBoundary'
import { CountUp, IconButton } from './components/ui'
import { IconBook, IconCards, IconCompass, IconLeaf, IconPen, IconSettings } from './components/icons'
import { isNativePlatform } from './platform/native'
import { playSound, setSoundEnabled, unlockAudio } from './platform/sound'
import { setHapticsEnabled } from './platform/haptics'
import { onImmersiveChange, onNavigate, type ShellTabKey } from './shell/events'
import splashMark from './assets/splash-mark.webp'

type TabKey = ShellTabKey

/**
 * 底部导航。
 * 名字都取得像"属于孩子的东西"，而不是功能模块。
 * 图标一律用自绘线性图标 —— 这是 v3 与 v2 最直观的差别。
 */
const TABS: { key: TabKey; label: string; Icon: typeof IconPen }[] = [
  { key: 'compose', label: '写作文', Icon: IconPen },
  { key: 'diary', label: '日记本', Icon: IconBook },
  { key: 'level', label: '成长树', Icon: IconLeaf },
  { key: 'cards', label: '文心卡', Icon: IconCards },
  { key: 'map', label: '旅行图', Icon: IconCompass },
]

/* ============================================================
   努力格言 —— 每次打开随机一句
   ============================================================ */

const QUOTES = [
  '好文章不是写出来的，是改出来的。',
  '你今天写的每一个字，都在帮你长大。',
  '不怕写得慢，就怕不动笔。',
  '把看到的说出来，就已经是作文了。',
  '别人的好句子是别人的，你自己的才是你的。',
  '写错了没关系，橡皮就是为这个准备的。',
  '坚持写下去的人，最后都成了会讲故事的人。',
  '一笔一画，都是在给自己种树。',
  '今天比昨天多写一句，就是进步。',
  '想象力不用花钱，但很值钱。',
  '读得多了，笔下自然就有东西。',
  '不用写得像别人，写得像你自己就好。',
  '每一个作家，都是从"写得不好"开始的。',
  '你的故事只有你能写，别人写不出来。',
  '慢慢来，树也是一年一年才长高的。',
  '认真写下的句子，会一直跟着你。',
  '写作是把心里的话，搬到纸上晒太阳。',
  '今天的努力，是明天的底气。',
]

function pickQuote(): string {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)]
}

/* ============================================================
   Splash
   ============================================================ */

function Splash({ onDone }: { onDone: () => void }) {
  // 每次挂载抽一句，整个启动过程不换
  const quote = useMemo(() => pickQuote(), [])
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    /* ★ 时长怎么定的（别再凭感觉调这个数字）：
       这一屏只负责"别让首屏闪一下"，真正决定停多久的是 boot() 的耗时 ——
       只要 `!ready` 就还停在这里（见下面的 `if (!ready || !splashDone)`）。
       所以这里的下限只负责「别再一闪而过」。

       以前是 520ms + 2000ms 时代的文案，后来实测发现：
       这个数字其实不是主要成本，boot 里的十几次 IndexedDB 事务才是
       （已改成一次事务，见 db.ts 的 readBootSnapshot()）。

       现在 260ms 之后开始淡出、60ms 交棒，总占用约 320ms；
       而真正的"手感"来自下面那层淡出 —— 画面是**化开**的，不是"等完再一跳"，
       所以即使 boot 慢一点，也不会读成"卡住了"。 */
    const HOLD_MS = 260
    const FADE_MS = 60

    const t1 = window.setTimeout(() => setLeaving(true), HOLD_MS)
    const t2 = window.setTimeout(onDone, HOLD_MS + FADE_MS)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [onDone])

  return (
    <div
      className={`scene-ink fixed inset-0 z-[100] flex flex-col items-center justify-center gap-7 overflow-hidden px-8 transition-opacity duration-200 ease-out ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* 远处的一点暖光 */}
      <span className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-inkleaf-400/[0.18] blur-3xl" />
      <span className="pointer-events-none absolute -bottom-28 right-0 h-64 w-64 rounded-full bg-amber-leaf-400/[0.12] blur-3xl" />

      {/* 开场标记。
          ★ 以前这里是「树苗破土」的手绘 SVG，现在换成 App 图标本身
          （和 Android 启动主题里的 splash 图标是同一张圆形图）。
          两边同一张画，所以「系统开场 → 这一屏」接得上，不会跳。
          尺寸也要对上：系统 splash 的图标框是 288dp，画里那个圆占内圈
          192dp；所以这里就写 192px（viewport 是 width=device-width、
          initial-scale=1，1 CSS px 就是 1dp），两边看到的圆一样大。
          图是圆的：Android 12+ 的 splash 会把图标放进圆形区域，
          自己就做成圆形，系统加不加遮罩结果都一样。 */}
      <img
        src={splashMark}
        alt=""
        aria-hidden
        className="relative h-48 w-48 rounded-full anim-pop shadow-[0_14px_36px_-10px_rgba(0,0,0,0.6)]"
      />

      {/* 格言 */}
      <p className="relative max-w-xs text-center font-prose text-sm leading-loose text-[var(--color-night-text-2)] anim-fade-in delay-2">
        「{quote}」
      </p>

      <div className="relative flex gap-1.5 anim-fade-in delay-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-inkleaf-400 anim-sparkle"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
    </div>
  )
}

/* ============================================================
   主组件
   ============================================================ */

export default function App() {
  const ready = useApp((s) => s.ready)
  const boot = useApp((s) => s.boot)
  const settings = useApp((s) => s.settings)
  const wallet = useApp((s) => s.wallet)
  const level = useApp((s) => s.level)
  const streak = useApp((s) => s.streak)
  const toasts = useApp((s) => s.toasts)
  const dismissToast = useApp((s) => s.dismissToast)
  const updateSettings = useApp((s) => s.updateSettings)

  const [tab, setTab] = useState<TabKey>('compose')
  const [showSettings, setShowSettings] = useState(false)
  const [showWorkbook, setShowWorkbook] = useState(false)
  const [splashDone, setSplashDone] = useState(false)
  /** 写作 / 树洞等沉浸场景开启时，外壳让位 */
  const [immersive, setImmersive] = useState(false)

  /* ---- 每日进度 ----------------------------------------------------
     注意：这里刻意用 useMemo 从原始数据自己算，
     而不是让 zustand 的 selector 返回一个新对象 ——
     返回新对象会让 useSyncExternalStore 认为每次都变了，
     直接导致无限重渲染（React error #185）。 */
  const works = useApp((s) => s.works)
  const diary = useApp((s) => s.diary)
  const dailyGoal = useApp((s) => s.settings.dailyGoal)
  const daily = useMemo(() => {
    const key = dayKey()
    /* 用 scoredAt 而不是 createdAt：昨晚开的稿今天交，要算在今天。
       这和「每日才气上限」用的是同一套判定（见 economy.compositionsScoredToday）。 */
    const count = compositionsScoredToday(works)
    return {
      compositions: count,
      goal: dailyGoal,
      reached: count >= dailyGoal,
      diaryDone: diary.some((d) => d.dayKey === key && d.status !== 'draft'),
    }
  }, [works, diary, dailyGoal])

  const meta = levelAt(level.levelIndex)

  /* ---- 启动 ---- */
  useEffect(() => {
    void boot()
  }, [boot])

  /* ---- 同步声音/震动开关 ---- */
  useEffect(() => {
    if (!ready) return
    setSoundEnabled(settings.soundOn)
    setHapticsEnabled(settings.hapticsOn)
  }, [ready, settings.soundOn, settings.hapticsOn])

  /* ---- 跨页跳转 ---- */
  useEffect(() => {
    return onNavigate((tab) => {
      setShowSettings(false)
      setShowWorkbook(false)
      setImmersive(false)
      setTab(tab)
    })
  }, [])

  /* ---- 沉浸模式事件：写作页 / 树洞自己声明什么时候进入沉浸 ---- */
  useEffect(() => {
    return onImmersiveChange(setImmersive)
  }, [])

  /* ---- 原生：状态栏与闪屏 ---- */
  useEffect(() => {
    if (!isNativePlatform()) return
    void (async () => {
      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar')
        await StatusBar.setStyle({ style: Style.Dark })
        await StatusBar.setBackgroundColor({ color: '#101a16' })
        const { SplashScreen } = await import('@capacitor/splash-screen')
        await SplashScreen.hide()
      } catch {
        /* 非原生环境忽略 */
      }
    })()
  }, [])

  /* ---- 首次触摸解锁音频（移动端必须由手势触发） ---- */
  useEffect(() => {
    const unlock = () => {
      unlockAudio()
      window.removeEventListener('pointerdown', unlock)
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  if (!ready || !splashDone) {
    return <Splash onDone={() => setSplashDone(true)} />
  }

  /* ---- 首次进入：种下你的树（一次性引导，年级在这里定） ---- */
  if (!settings.onboarded) {
    return (
      <Onboarding
        onDone={(patch) => {
          void updateSettings({ ...patch, onboarded: true })
        }}
      />
    )
  }

  /* ---- 种完树：教他怎么用（★ 和上面是两件事，别合并） ----
     `onboarded` 决定「要不要问」（昵称/年级/目标），
     `guideDone` 决定「要不要教」（怎么用）。合成一个标记的话，
     设置里点「再看一遍新手引导」就会把昵称年级再问一遍 ——
     那是他一年才改一次的东西。

     两屏都是 .scene-ink，所以 种树 → 引导 是同一个夜色里换内容，不会跳。
     想再看一遍：设置 → 新手引导（把那一位置回 false）。 */
  if (!settings.guideDone) {
    return (
      <Guide
        onDone={() => void updateSettings({ guideDone: true })}
      />
    )
  }

  /* ============================================================
     渲染
     ------------------------------------------------------------
     ⚠️ 这里必须**只有一个**渲染分支，靠条件隐藏外壳，而不是 `if (immersive) return ...`。
     原因：写成两个 `return` 分支时，`immersive` 一翻转，React 看到的是两棵
     结构不同的树，会把整棵子树卸载重建 —— 页面的 useState 全部丢失。

     真实症状（曾经踩过）：在「写作文」里选好类别 → 点「出一道新题」
     → `setStep('write')` 触发沉浸 → ComposePage 被重挂载 → 回到 setup
     且 category 归零 → 两个按钮同时变灰、没有 loading，
     用户看到的就是「页面有遮罩但点了没反应」。

     同一个坑也适用于「日记本 → 沉浸写作」。
     ============================================================ */
  const page =
    tab === 'compose' ? (
      <ComposePage />
    ) : tab === 'diary' ? (
      <DiaryPage />
    ) : tab === 'level' ? (
      <LevelPage />
    ) : tab === 'cards' ? (
      <CardsPage />
    ) : (
      <MapPage />
    )

  return (
    <div
      className={
        immersive
          ? 'scene-ink relative flex min-h-screen flex-col'
          : 'relative flex min-h-screen flex-col'
      }
    >
      {showSettings ? (
        <SettingsPage onBack={() => setShowSettings(false)} />
      ) : showWorkbook ? (
        <div className="flex min-h-screen flex-col">
          <SubHeader title="我的作文本" onBack={() => setShowWorkbook(false)} />
          <main className="page-col flex-1">
            <WorkbookPage />
          </main>
        </div>
      ) : (
        <>
          {/* ---------------- 顶部状态条（沉浸时让位） ---------------- */}
          {!immersive && (
            <header className="sticky top-0 z-30 border-b border-ink-900/[0.06] bg-paper/92 backdrop-blur-md pt-safe">
            <div className="page-col flex items-center gap-3 px-4 py-2.5">
              {/* 段位徽记 */}
              <div className="relative grid h-10 w-10 shrink-0 place-items-center">
                <span
                  className="absolute inset-0 rounded-full opacity-[0.14]"
                  style={{ background: meta.color }}
                />
                <span
                  className="relative grid h-10 w-10 place-items-center rounded-full font-display text-xs font-bold"
                  style={{ color: meta.color }}
                >
                  {level.levelIndex + 1}
                </span>
              </div>

              <div className="mr-auto min-w-0">
                <div className="truncate font-display text-[15px] font-bold leading-tight text-ink-900">
                  {meta.name}
                </div>
                <div className="truncate text-2xs leading-tight text-ink-500">
                  {settings.childName} · {gradeLabel(settings.grade)}
                  {streak.days > 0 && ` · 连续 ${streak.days} 天`}
                </div>
              </div>

              {/* 今日目标 */}
              <div className="hidden items-center gap-1.5 rounded-pill bg-inkleaf-50 px-2.5 py-1.5 shadow-[var(--hair-leaf)] sm:flex">
                <span className="tnum text-2xs font-bold text-inkleaf-700">
                  {daily.compositions}/{daily.goal}
                </span>
                <span className="text-2xs text-inkleaf-600">篇</span>
              </div>

              {/* 金币 */}
              <div className="flex items-center gap-1.5 rounded-pill bg-amber-leaf-50 px-2.5 py-1.5 shadow-[var(--hair-amber)]">
                <span className="h-3 w-3 rounded-full bg-amber-leaf-400" />
                <CountUp
                  value={wallet.coins}
                  className="font-display text-2xs font-bold text-amber-leaf-700"
                />
              </div>

              <IconButton ariaLabel="设置" onClick={() => setShowSettings(true)} size={38}>
                <IconSettings size={18} />
              </IconButton>
            </div>
            </header>
          )}

          {/* ---------------- 内容区 ----------------
              注意这里**没有** key={tab}。早先的写法是 <main key={tab}>，
              那会让每次切 Tab 都重建整棵子树 —— 现在改由页面自己管理，
              Tab 之间的切换不再吞掉沉浸态里的写作进度。 */}
          <main className="page-col flex flex-1 flex-col anim-fade-in">
            <ErrorBoundary resetKey={tab}>{page}</ErrorBoundary>
          </main>

          {/* ---------------- 底部导航（沉浸时让位） ---------------- */}
          {!immersive && (
            <nav className="sticky bottom-0 z-30 border-t border-ink-900/[0.06] bg-paper/92 backdrop-blur-md pb-safe">
              <div className="page-col flex items-stretch justify-center px-2 py-1.5">
                {TABS.map((t) => {
                  const active = tab === t.key
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => {
                        unlockAudio()
                        playSound(active ? 'tap-soft' : 'tap')
                        setTab(t.key)
                      }}
                      aria-current={active ? 'page' : undefined}
                      className={`btn-base active:btn-press flex min-h-[54px] max-w-[7.5rem] flex-1 flex-col items-center justify-center gap-1 rounded-lg py-1.5 ${
                        active ? 'text-inkleaf-700' : 'text-ink-400'
                      }`}
                    >
                      <t.Icon size={21} strokeWidth={active ? 2 : 1.6} />
                      <span className="text-2xs font-semibold leading-none">{t.label}</span>
                    </button>
                  )
                })}
              </div>
            </nav>
          )}
        </>
      )}

      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

/* ============================================================
   子页面头部（题库等）
   ============================================================ */

export function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-900/[0.06] bg-paper/92 px-4 py-2.5 backdrop-blur-md pt-safe">
      {/* ★ 顶栏通栏、内容收进内容列：平板上原来是「中间悬着一条 672px 的横条」，
          两边各空一大块。padding 仍留在 header 上，所以垂直尺寸一个像素都不变。 */}
      <div className="page-col flex items-center gap-3">
        <IconButton ariaLabel="返回" onClick={onBack} size={38}>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </IconButton>
        <span className="font-display text-lg font-bold tracking-tight text-ink-900">{title}</span>
      </div>
    </header>
  )
}

/* ============================================================
   Toast
   ============================================================ */

const TOAST_TONE: Record<string, string> = {
  success: 'bg-inkleaf-50 shadow-[var(--hair-leaf)]',
  reward: 'bg-amber-leaf-50 shadow-[var(--hair-amber)]',
  info: 'bg-mist-50 shadow-[inset_0_0_0_1px_rgb(39_107_131/0.2)]',
  warn: 'bg-clay-50 shadow-[inset_0_0_0_1px_rgb(168_80_63/0.18)]',
}

function ToastHost({
  toasts,
  onDismiss,
}: {
  toasts: { id: string; kind: string; title: string; detail?: string; emoji?: string }[]
  onDismiss: (id: string) => void
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex flex-col items-center gap-2 px-4 pt-safe">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onDismiss(t.id)}
          className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-panel px-4 py-3 text-left shadow-[var(--shadow-tier-3)] anim-rise-in ${
            TOAST_TONE[t.kind] ?? 'bg-white shadow-[var(--hair-strong)]'
          }`}
        >
          {t.emoji && <span className="text-lg leading-none">{t.emoji}</span>}
          <span className="min-w-0 flex-1">
            <span className="block font-display text-sm font-bold text-ink-900">{t.title}</span>
            {t.detail && (
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-700">{t.detail}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  )
}

/* ============================================================
   工具：跳转 / 进入沉浸
   ------------------------------------------------------------
   ⚠️ 这两个函数的实现在 `shell/events.ts`，不要搬回本文件。
   它们曾经定义在这里，页面 `import { setImmersiveMode } from '../../App'`，
   于是形成 App → 页面 → App 的循环依赖 —— 开发环境下会让页面被反复
   重挂载、局部 state 丢失（真实症状：选好类别后一开关抽屉就清空）。
   本文件只 re-export 一次，方便老的引用路径继续用。
   ============================================================ */

export { navigateTo, setImmersiveMode } from './shell/events'

export type { GradeLevel }
