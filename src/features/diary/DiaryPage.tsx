/* ============================================================
   日记页 —— 一个只属于孩子的安静角落
   ============================================================

   为什么日记要单独上锁？
     作文是写给老师看的，日记是写给自己的。孩子只有确信
     「没人会偷看」，才敢写真话 —— 而真话，才是一切的起点。
     这把锁只是「尊重」的象征，不是安全机制。

   ------------------------------------------------------------
   v3 三条硬规则（都来自需求原文）

   一、**只用声音写**。
       键盘入口彻底关掉，只留麦克风。为什么：
       打字会让孩子不自觉地"开始写作文" —— 挑词、掂量、删改，
       真话就在这个过程中被磨掉了。说出来的才是心里话。

   二、**一天一篇，写完封存，不许回头改**。
       封存前用一段诗句提醒："今日已经过去，无需回头。"
       这不是防呆，是让这个动作有分量 —— 孩子按下去的那一刻，
       会知道自己在做一个决定，而不是随手点了个确定。

   三、**封存之后可以丢进树洞**。
       树洞只做一件事：听。它不评价、不纠错、不打分，
       只回一句"我听见了"。好让日记有个能安放的地方。

   ------------------------------------------------------------
   ⚠️⚠️ 两个必须避开的坑（都真实踩过，症状都是"输完密码页面崩了"）

   坑一：**这个组件里有 4 个顶层 `return`**（密码关卡 / 设密码关卡 /
        沉浸写作 / 正文）。React 允许这样写，**前提是任何 `return` 之前
        不能有条件执行的 hook**。所以：
        → 所有 useState/useMemo/useApp 必须在组件最顶部一次性声明完，
          一个都不能留在分支里、叶子组件里、或 JSX 的 props 里。

   坑二（真实事故）：曾经把段位读成
            sub={hollowUnlockHint(useAppLevelIndex())}
        —— hook 写在 JSX 属性里。它在**没解锁时不执行、解锁后才执行**，
        于是 hook 总数从 72 变成 73，React 抛
        「Rendered more hooks than during the previous render」，
        ErrorBoundary 接住，孩子看到的是「这一页出了点小问题」。
        修法：把 `const levelIndex = useApp(...)` 提到组件顶部。
        → 记住：**hook 永远只能写在组件函数体的最外层**，
          不能写进 §props、§条件表达式、§循环、§回调 里。
   ============================================================ */

import { useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useApp } from '../../store/useApp'
import type { DiarySubmitResult } from '../../store/useApp'
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  IconButton,
  SectionTitle,
  Sheet,
  Stars,
} from '../../components/ui'
import { CardDropOverlay } from '../../components/CardView'
import { VoiceComposer } from '../../components/VoiceComposer'
import { PIN_LINK_CLASS, PinGate } from '../../components/PinPad'
import {
  MOODS,
  WEATHERS,
  diaryLengthPraise,
  diaryStats,
  randomDiaryPrompt,
  sortEntriesDesc,
} from '../../domain/diary'
import {
  isHollowUnlocked,
  hollowUnlockHint,
  HOLLOW_ECHOES,
  HOLLOW_UNLOCK_LEVEL,
} from '../../domain/hollow'
import { levelAt } from '../../domain/levels'
import { countWords } from '../../domain/scoring'
import { dayKey, friendlyDay, weekdayLabel } from '../../domain/time'
import { playSound } from '../../platform/sound'
import type { CardDrop, DiaryEntry, DiaryReview } from '../../domain/types'
import {
  IconBirdSitting,
  IconBook,
  IconCheck,
  IconClose,
  IconFeather,
  IconInk,
  IconLightbulb,
  IconLock,
  IconMic,
  IconMoon,
  IconQuill,
  IconSprout,
  IconTreeHollow,
} from '../../components/icons'

/* ============================================================
   一、封存用的诗句 —— 不可逆操作的仪式感
   ============================================================
   需求原话：「写完了确定了，不允许修改（要提醒。用类似的诗词，
   今日已经过去，无需回头这种）」。所以这里不写"确定要提交吗"，
   而是让文字本身承担这个提示。
   ============================================================ */

const SEAL_VERSES = [
  '今日已经过去，无需回头。\n说出去的话，就让它待在那一天里。',
  '这一页合上了，就成了昨天。\n昨天不必修改，它本来就很完整。',
  '字落在纸上，日子就有了重量。\n封上它，让它保持今天的样子。',
  '写完就说完了。\n风会替你把这一页翻过去。',
]

function pickVerse(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return SEAL_VERSES[h % SEAL_VERSES.length]
}

/* ============================================================
   二、密码键盘
   ------------------------------------------------------------
   ★ 2026-09-18：圆点 + 键盘已经抽到 `../../components/PinPad`，
     和「家长验证」共用一份（家长说那边"好窄、别扭"，
     根因就是各写了一套）。改密码界面请改那个文件。
   ============================================================ */

/* ============================================================
   三、点评展示
   ============================================================ */

function ReviewBlock({
  review,
  childText,
  result,
}: {
  review: DiaryReview
  childText: string
  result?: DiarySubmitResult | null
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-center gap-1.5">
        <Stars count={review.stars} size="lg" />
        <p className="text-center text-sm font-semibold leading-relaxed text-ink-800">
          {review.summary}
        </p>
      </div>

      {review.strengths.length > 0 && (
        <div className="flex flex-col gap-2">
          {review.strengths.map((s, i) => (
            <div
              key={i}
              className="flex gap-2.5 rounded-md bg-inkleaf-50 px-3 py-2.5 shadow-[var(--hair-leaf)]"
            >
              <span className="mt-0.5 shrink-0 text-inkleaf-600">
                <IconCheck size={14} strokeWidth={2.4} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-ink-900">{s.title}</div>
                {s.evidence && (
                  <div className="mt-0.5 text-xs leading-relaxed text-ink-600">
                    「{s.evidence}」
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 原文保留在上面，优化版只做对照 —— 绝不替换孩子自己写的东西 */}
      <div className="flex flex-col gap-2">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-2xs font-bold text-ink-500">
            <IconQuill size={12} />
            你写的
          </div>
          <p className="whitespace-pre-wrap rounded-md bg-white px-3 py-2.5 font-prose text-[15px] leading-[1.9] text-ink-900 shadow-[var(--hair)]">
            {childText || '（还没写内容）'}
          </p>
        </div>
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-2xs font-bold text-mist-600">
            <IconInk size={12} />
            小笔苗帮你理顺的版本
          </div>
          <p className="whitespace-pre-wrap rounded-md bg-mist-50 px-3 py-2.5 font-prose text-[15px] leading-[1.9] text-ink-900 shadow-[var(--hair)]">
            {review.polished}
          </p>
          <p className="mt-1 text-2xs text-ink-500">
            只是帮你把话说顺，内容还是你自己的 —— 想用哪句，你自己挑。
          </p>
        </div>
      </div>

      {result && (
        <div className="rounded-md bg-amber-leaf-50 px-3 py-3 shadow-[var(--hair-amber)]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="tnum font-display text-base font-bold text-amber-leaf-700">
              +{result.coins} 金币
            </span>
            <span className="tnum text-sm font-bold text-moss-600">+{result.xp} 经验</span>
            <span className="tnum text-sm font-semibold text-ink-700">
              连续 {result.streakDays} 天
            </span>
          </div>
          <p className="mt-1.5 text-xs font-semibold text-ink-700">{result.blessing}</p>
          {result.buffLabel && (
            <p className="mt-0.5 text-xs text-ink-500">当前加成：{result.buffLabel}</p>
          )}
          {result.leveledUp && result.levelMessage && (
            <p className="mt-1.5 rounded-sm bg-moss-50 px-2.5 py-1.5 text-xs font-bold text-moss-600">
              {result.levelMessage}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ============================================================
   四、树洞区块
   ============================================================ */

function HollowSection({ entry }: { entry: DiaryEntry }) {
  const level = useApp((s) => s.level)
  const tree = useApp((s) => s.tree)
  const dropInto = useApp((s) => s.dropDiaryIntoHollow)
  const toast = useApp((s) => s.toast)

  const [echo, setEcho] = useState<string | null>(null)
  const [busyDrop, setBusyDrop] = useState(false)

  const unlocked = isHollowUnlocked(level.levelIndex)

  // 已经丢过的：直接把当时那句回响找回来
  const existing = useMemo(
    () => tree.hollowDiaries.find((h) => h.entryId === entry.id),
    [tree.hollowDiaries, entry.id],
  )

  if (!unlocked) {
    return (
      <div className="flex items-start gap-2.5 rounded-md bg-paper-2 px-3 py-3">
        <span className="mt-0.5 shrink-0 text-ink-400">
          <IconTreeHollow size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-ink-700">树洞还没打开</div>
          <p className="mt-0.5 text-2xs leading-relaxed text-ink-500">
            {hollowUnlockHint(level.levelIndex)} 长到「{levelAt(HOLLOW_UNLOCK_LEVEL).name}」，就能把日记丢进去。
          </p>
        </div>
      </div>
    )
  }

  if (existing || echo) {
    return (
      <div className="flex items-start gap-2.5 rounded-md bg-moss-50 px-3.5 py-3.5 shadow-[var(--hair)]">
        <span className="mt-0.5 shrink-0 text-moss-500">
          <IconTreeHollow size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-moss-600">树洞回了一句</div>
          <p className="mt-1 font-prose text-[15px] leading-loose text-ink-800">
            {existing?.echo ?? echo}
          </p>
        </div>
      </div>
    )
  }

  if (!entry.sealed) return null

  return (
    <button
      type="button"
      disabled={busyDrop}
      onClick={() => {
        setBusyDrop(true)
        playSound('tap-soft')
        void dropInto(entry.id).then((r) => {
          setBusyDrop(false)
          if (r) {
            setEcho(r.echo)
            playSound('success')
            toast({ kind: 'reward', title: '树洞收下了', detail: r.echo })
          }
        })
      }}
      className="btn-base active:btn-press flex w-full items-center gap-3 rounded-md bg-moss-50 px-3.5 py-3 text-left shadow-[var(--hair)] disabled:opacity-50"
    >
      <span className="shrink-0 text-moss-500">
        <IconTreeHollow size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold text-moss-600">丢进树洞</span>
        <span className="mt-0.5 block text-2xs leading-relaxed text-ink-600">
          这篇已经封存了。可以把它交给树洞，它会替你收好。
        </span>
      </span>
    </button>
  )
}

/* ============================================================
   五、页面
   ============================================================ */

export default function DiaryPage(): ReactElement {
  const diary = useApp((s) => s.diary)
  const streak = useApp((s) => s.streak)
  const settings = useApp((s) => s.settings)
  // ⚠️ 树洞的段位提示要用它。必须在组件顶部调用，绝不能写进 JSX 的 props 里
  // （曾经写成 sub={hollowUnlockHint(useAppLevelIndex())}，见下方教训注释）。
  const levelIndex = useApp((s) => s.level.levelIndex)
  const busy = useApp((s) => s.busy)
  const toast = useApp((s) => s.toast)
  const getTodayDiary = useApp((s) => s.getTodayDiary)
  const createDiary = useApp((s) => s.createDiary)
  const patchDiary = useApp((s) => s.patchDiary)
  const submitDiary = useApp((s) => s.submitDiary)
  const deleteDiary = useApp((s) => s.deleteDiary)
  const sealDiary = useApp((s) => s.sealDiary)
  const updateSettings = useApp((s) => s.updateSettings)

  // 依赖 diary 触发重算，这样写完日记后今天这篇会立刻出现
  const today = useMemo(() => getTodayDiary(), [diary, getTodayDiary])

  /* 解锁状态只放内存：刷新即重新上锁，避免"一次解锁永久可见" */
  const [unlocked, setUnlocked] = useState(false)
  const [skippedPin, setSkippedPin] = useState(false)
  const [buf, setBuf] = useState('')
  const [shake, setShake] = useState(false)
  const [gateMsg, setGateMsg] = useState('')
  const [setupStage, setSetupStage] = useState<'first' | 'confirm'>('first')
  const [setupFirst, setSetupFirst] = useState('')

  const [writing, setWriting] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [forgotOpen, setForgotOpen] = useState(false)
  const [detail, setDetail] = useState<DiaryEntry | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<DiaryEntry | null>(null)
  const [confirmSeal, setConfirmSeal] = useState(false)
  const [result, setResult] = useState<DiarySubmitResult | null>(null)
  const [drops, setDrops] = useState<CardDrop[]>([])
  const [showDrops, setShowDrops] = useState(false)
  /** 附件录音（dataURL） */
  const [audio, setAudio] = useState<{ dataUrl: string; seconds: number } | null>(null)
  const [recording, setRecording] = useState(false)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const stats = useMemo(() => diaryStats(diary), [diary])
  const past = useMemo(() => sortEntriesDesc(diary), [diary])

  /* ---------------- 密码逻辑 ---------------- */

  const failPin = (msg: string) => {
    playSound('error')
    setShake(true)
    setGateMsg(msg)
    // 抖一下再清空，让孩子看清"错了"
    window.setTimeout(() => {
      setShake(false)
      setBuf('')
    }, 520)
  }

  const handleEnter = (k: string) => {
    if (k === 'del') {
      setBuf((b) => b.slice(0, -1))
      setGateMsg('')
      return
    }
    if (buf.length >= 4) return
    const next = buf + k
    setBuf(next)
    if (next.length < 4) return
    if (next === settings.diaryPin) {
      playSound('success')
      setUnlocked(true)
      setBuf('')
      setGateMsg('')
    } else {
      failPin('密码不对哦，再想想')
    }
  }

  const handleSetup = (k: string) => {
    if (k === 'del') {
      setBuf((b) => b.slice(0, -1))
      setGateMsg('')
      return
    }
    if (buf.length >= 4) return
    const next = buf + k
    setBuf(next)
    if (next.length < 4) return

    if (setupStage === 'first') {
      setSetupFirst(next)
      setBuf('')
      setSetupStage('confirm')
      setGateMsg('')
      return
    }
    if (next === setupFirst) {
      void updateSettings({ diaryPin: next })
      playSound('success')
      setUnlocked(true)
      setBuf('')
      setGateMsg('')
      toast({ kind: 'success', title: '日记密码设好了', detail: '以后只有知道密码的人才能看' })
    } else {
      setSetupStage('first')
      setSetupFirst('')
      failPin('两次不一样，再来一次吧')
    }
  }

  /* ---------------- 录音附件 ---------------- */

  async function toggleRecording() {
    if (recording) {
      mediaRef.current?.stop()
      setRecording(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      const startedAt = Date.now()
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        const reader = new FileReader()
        reader.onloadend = () => {
          const url = String(reader.result ?? '')
          if (url) setAudio({ dataUrl: url, seconds: Math.round((Date.now() - startedAt) / 1000) })
        }
        reader.readAsDataURL(blob)
      }
      mediaRef.current = rec
      rec.start()
      setRecording(true)
      playSound('record-start')
    } catch {
      toast({ kind: 'warn', title: '录不了音', detail: '这台设备没有允许麦克风，或者不支持录音。' })
    }
  }

  /* ---------------- 写作动作 ---------------- */

  const handleCreate = async () => {
    await createDiary(settings.grade)
    setWriting(true)
  }

  /** 第一步：提交给 AI 看，拿到点评（此时还没封存） */
  const handleSubmit = async (id: string) => {
    try {
      const res = await submitDiary(id)
      setResult(res)
      setWriting(false)
      playSound('score')
      if (res.drops.length > 0) {
        setDrops(res.drops)
        setShowDrops(true)
      }
      toast({
        kind: 'reward',
        title: res.isNewDay ? '今天打卡成功' : '日记又更新了',
        detail: res.blessing,
      })
      if (res.warning) {
        toast({ kind: 'warn', title: 'AI 没接上', detail: res.warning, emoji: '⚠️' })
      }
    } catch (err) {
      toast({
        kind: 'warn',
        title: '还差一点点',
        detail: err instanceof Error ? err.message : '再写一点点吧',
      })
    }
  }

  /** 第二步：封存。不可逆，所以要过一道诗句 */
  const handleSeal = async () => {
    if (!today) return
    if (audio) {
      // 附件跟着日记一起封存
      await patchDiary(today.id, { audio: audio.dataUrl, audioSeconds: audio.seconds })
    }
    const sealed = await sealDiary(today.id)
    setConfirmSeal(false)
    if (sealed) {
      playSound('success')
      toast({
        kind: 'success',
        title: '封好了',
        detail: '今天的日记，从此不会再变了。',
      })
    }
  }

  const handleDelete = async (id: string) => {
    await deleteDiary(id)
    setConfirmDelete(null)
    setDetail(null)
    toast({ kind: 'info', title: '这篇日记删掉了' })
  }

  const openPrompt = () => {
    setPromptText(randomDiaryPrompt())
    setPromptOpen(true)
  }

  /* ---------------- 关卡一：输入密码 ---------------- */

  if (settings.diaryPin && !unlocked) {
    return (
      <>
        <PinGate
          title="日记本锁着"
          hint="输入 4 位密码，才能打开自己的小秘密"
          filled={buf.length}
          error={shake}
          message={gateMsg}
          onKey={handleEnter}
          disabled={shake}
          footer={
            <button type="button" onClick={() => setForgotOpen(true)} className={PIN_LINK_CLASS}>
              忘记密码了？
            </button>
          }
        />

        <Sheet open={forgotOpen} onClose={() => setForgotOpen(false)} title="忘记密码怎么办？">
          <div className="flex flex-col gap-3 py-2 text-sm leading-relaxed text-ink-700">
            <p>这个密码只存在这台设备上，小笔苗也没办法帮你找回来。</p>
            <p>
              如果实在想不起来，可以让爸爸妈妈打开「设置 → 日记密码」，把密码清掉，再重新设一个新的。
            </p>
            <p className="rounded-md bg-paper-2 px-3 py-2 text-xs text-ink-500">
              日记是写给你自己的，所以这里不会留任何"偷偷进去"的办法。
            </p>
            <Button full onClick={() => setForgotOpen(false)}>
              知道啦
            </Button>
          </div>
        </Sheet>
      </>
    )
  }

  /* ---------------- 关卡二：还没设密码 ---------------- */

  if (!settings.diaryPin && !skippedPin) {
    return (
      <PinGate
        title="给日记本上把锁吧"
        hint={setupStage === 'first' ? '想一个 4 位数字密码，只有你知道' : '再输一次，确认没记错'}
        filled={buf.length}
        error={shake}
        message={gateMsg}
        onKey={handleSetup}
        disabled={shake}
        footer={
          <button
            type="button"
            onClick={() => {
              void updateSettings({ diaryPin: null })
              setSkippedPin(true)
            }}
            className={PIN_LINK_CLASS}
          >
            先不设密码，直接看日记
          </button>
        }
      />
    )
  }

  /* ---------------- 沉浸写作：只有声音 ---------------- */

  if (writing && today) {
    return (
      <div className="scene-ink flex min-h-screen flex-col">
        {/* 极细的顶部条：只有一个退出 */}
        <header className="flex items-center gap-3 px-4 pt-safe">
          <IconButton ariaLabel="退出" tone="ink" onClick={() => setWriting(false)} size={38}>
            <IconClose size={18} />
          </IconButton>
          <div className="min-w-0 flex-1 text-center">
            <div className="font-display text-sm font-bold text-[var(--color-night-text)]">
              今天的日记
            </div>
            <div className="text-2xs text-[var(--color-night-text-3)]">
              {friendlyDay(dayKey())} · {weekdayLabel(dayKey())}
            </div>
          </div>
          <span className="h-[38px] w-[38px]" />
        </header>

        <div className="flex flex-1 flex-col px-4 pb-6 pt-4">
          {/* 心情 / 天气 */}
          <div className="mb-4 flex flex-col gap-3">
            <div>
              <div className="mb-1.5 text-2xs font-semibold text-[var(--color-night-text-3)]">
                今天心情怎么样
              </div>
              <div className="flex flex-wrap gap-1.5">
                {MOODS.map((m) => {
                  const on = today.mood === m.emoji
                  return (
                    <button
                      key={m.emoji}
                      type="button"
                      onClick={() => void patchDiary(today.id, { mood: m.emoji })}
                      className={`btn-base active:btn-press flex min-h-[44px] items-center gap-1.5 rounded-pill px-3 py-2 text-sm font-semibold ${
                        on
                          ? 'bg-amber-leaf-300/25 text-amber-leaf-100 shadow-[var(--hair-light-strong)]'
                          : 'bg-white/[0.06] text-[var(--color-night-text-2)] shadow-[var(--hair-light)]'
                      }`}
                    >
                      <span className="text-base leading-none">{m.emoji}</span>
                      {m.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-2xs font-semibold text-[var(--color-night-text-3)]">
                今天天气呢
              </div>
              <div className="flex flex-wrap gap-1.5">
                {WEATHERS.map((w) => {
                  const on = today.weather === w.emoji
                  return (
                    <button
                      key={w.emoji}
                      type="button"
                      onClick={() => void patchDiary(today.id, { weather: w.emoji })}
                      className={`btn-base active:btn-press flex min-h-[44px] items-center gap-1.5 rounded-pill px-3 py-2 text-sm font-semibold ${
                        on
                          ? 'bg-mist-300/25 text-mist-100 shadow-[var(--hair-light-strong)]'
                          : 'bg-white/[0.06] text-[var(--color-night-text-2)] shadow-[var(--hair-light)]'
                      }`}
                    >
                      <span className="text-base leading-none">{w.emoji}</span>
                      {w.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 语音台：只有声音，没有键盘 */}
          <VoiceComposer
            ink
            voiceOnly
            text={today.text}
            utterances={today.utterances}
            edits={today.edits}
            placeholder="今天发生了什么？说出来，小笔苗帮你记下来。"
            transcribe={settings.transcribe}
            onChange={(next) =>
              void patchDiary(today.id, {
                text: next.text,
                utterances: next.utterances,
                edits: next.edits,
                wordCount: countWords(next.text),
              })
            }
          />

          {today.text.trim() && (
            <p className="mt-2 text-center text-2xs font-semibold text-inkleaf-300">
              {diaryLengthPraise(today.wordCount)}
            </p>
          )}

          {/* 附件录音 */}
          <div className="mt-4 flex items-center gap-2.5 rounded-md bg-white/[0.05] px-3.5 py-3 shadow-[var(--hair-light)]">
            <button
              type="button"
              onClick={() => void toggleRecording()}
              className={`btn-base active:btn-press grid h-11 w-11 shrink-0 place-items-center rounded-full ${
                recording
                  ? 'bg-[#a8503f] text-white'
                  : 'bg-white/10 text-[var(--color-night-text-2)] shadow-[var(--hair-light)]'
              }`}
              aria-label={recording ? '停止录音' : '录一段话附在日记上'}
            >
              <IconMic size={18} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-[var(--color-night-text)]">
                {recording ? '正在录音…' : audio ? '录音已附上' : '附一段录音'}
              </div>
              <div className="mt-0.5 text-2xs leading-relaxed text-[var(--color-night-text-3)]">
                {recording
                  ? '说完了再点一下，就停下。'
                  : audio
                    ? `${audio.seconds} 秒 · 会和这篇日记一起封存`
                    : '想留一段声音也可以。这是可选的。'}
              </div>
            </div>
            {audio && !recording && (
              <button
                type="button"
                onClick={() => setAudio(null)}
                className="btn-base active:btn-press shrink-0 rounded-pill bg-white/[0.06] px-3 py-1.5 text-2xs font-bold text-[var(--color-night-text-2)]"
              >
                去掉
              </button>
            )}
          </div>

          {/* 提示 */}
          <button
            type="button"
            onClick={openPrompt}
            className="btn-base active:btn-press mt-3 flex items-center justify-center gap-1.5 rounded-md bg-white/[0.05] py-3 text-xs font-semibold text-[var(--color-night-text-2)]"
          >
            <IconLightbulb size={14} />
            不知道写什么
          </button>

          {busy && (
            <p className="mt-3 text-center text-xs font-semibold text-[var(--color-night-text-3)]">
              {busy}
            </p>
          )}

          {/* 提交给 AI 看 */}
          <button
            type="button"
            disabled={Boolean(busy) || !today.text.trim()}
            onClick={() => void handleSubmit(today.id)}
            className="btn-base btn-primary active:btn-press mt-4 w-full rounded-btn py-4 text-base font-bold disabled:opacity-40"
          >
            说完了，让小笔苗看看
          </button>

          <p className="mt-3 text-center text-2xs leading-relaxed text-[var(--color-night-text-3)]">
            日记一天只能写一篇。写完封存之后，就不能再改了 —— 今天过去了就是过去了。
          </p>
        </div>

        <Sheet
          open={promptOpen}
          onClose={() => setPromptOpen(false)}
          title="不知道写什么？"
          footer={
            <Button full tone="primary" onClick={() => setPromptText(randomDiaryPrompt())}>
              换一个问题
            </Button>
          }
        >
          <div className="py-4 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-leaf-50 text-amber-leaf-600 shadow-[var(--hair-amber)]">
              <IconLightbulb size={24} />
            </div>
            <p className="mt-3 font-display text-lg font-bold leading-relaxed text-ink-900">
              {promptText}
            </p>
            <p className="mt-2 text-sm text-ink-500">就从这个说起，说到哪儿算哪儿。</p>
          </div>
        </Sheet>
      </div>
    )
  }

  /* ---------------- 日记正文 ---------------- */

  const sealedNow = Boolean(today?.sealed)

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-3">
      {/* ---------- 顶部问候 ---------- */}
      <Card className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-inkleaf-50 text-inkleaf-600 shadow-[var(--hair-leaf)]">
          <IconMoon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-base font-bold text-ink-900">今天也要记一笔</div>
          <div className="text-2xs text-ink-500">
            {friendlyDay(dayKey())} · {weekdayLabel(dayKey())} · 已连续 {streak.days} 天
          </div>
        </div>
        {settings.diaryPin && (
          <IconButton
            ariaLabel="锁上日记"
            onClick={() => {
              playSound('tap')
              setUnlocked(false)
            }}
          >
            <IconLock size={17} />
          </IconButton>
        )}
      </Card>

      {/* ---------- 今天的日记 ---------- */}
      <Card>
        <SectionTitle
          icon={<IconBook size={16} />}
          title="今天的日记"
          sub={`${friendlyDay(dayKey())} · ${weekdayLabel(dayKey())}`}
          right={
            sealedNow ? (
              <span className="shrink-0 rounded-pill bg-inkleaf-50 px-2.5 py-1 text-2xs font-bold text-inkleaf-700 shadow-[var(--hair-leaf)]">
                已封存
              </span>
            ) : undefined
          }
        />

        {!today ? (
          <div className="flex flex-col gap-3">
            <EmptyState
              mood="sleepy"
              title="今天还没写呢"
              desc="不用写很多，记一件今天发生的小事就很好。日记只用说的，不用打字。"
            />
            <Button
              full
              size="lg"
              tone="primary"
              icon={<IconMic size={18} />}
              disabled={Boolean(busy)}
              onClick={() => void handleCreate()}
            >
              开始说今天的日记
            </Button>
          </div>
        ) : sealedNow ? (
          /* ---- 已封存：只读 + 树洞 ---- */
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-2xs font-semibold text-ink-500">
              {today.mood && <span className="text-base leading-none">{today.mood}</span>}
              {today.weather && <span className="text-sm leading-none">{today.weather}</span>}
              <span className="tnum">{today.wordCount} 字</span>
              {today.audio && <span>· 附了一段 {today.audioSeconds ?? 0} 秒录音</span>}
            </div>

            <p className="whitespace-pre-wrap rounded-md bg-paper-2 px-3.5 py-3 font-prose text-[15px] leading-[1.95] text-ink-900">
              {today.text || '（还没写内容）'}
            </p>

            {today.audio && (
              <audio controls src={today.audio} className="w-full">
                <track kind="captions" />
              </audio>
            )}

            {today.review ? (
              <ReviewBlock review={today.review} childText={today.text} result={result} />
            ) : (
              <p className="text-xs text-ink-500">这篇还没有让小笔苗看过。</p>
            )}

            <HollowSection entry={today} />

            <p className="rounded-md bg-ink-50 px-3 py-2.5 text-2xs leading-relaxed text-ink-500">
              这一页已经封上了。今天过去了，不用回头改它。
            </p>
          </div>
        ) : writing === false && today.text.trim() ? (
          /* ---- 说完了，等封存 ---- */
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-2xs font-semibold text-ink-500">
              {today.mood && <span className="text-base leading-none">{today.mood}</span>}
              {today.weather && <span className="text-sm leading-none">{today.weather}</span>}
              <span className="tnum">{today.wordCount} 字</span>
            </div>

            <p className="whitespace-pre-wrap rounded-md bg-paper-2 px-3.5 py-3 font-prose text-[15px] leading-[1.95] text-ink-900">
              {today.text}
            </p>

            {today.review ? (
              <ReviewBlock review={today.review} childText={today.text} result={result} />
            ) : (
              <Button full onClick={() => void handleSubmit(today.id)} disabled={Boolean(busy)}>
                让小笔苗看看
              </Button>
            )}

            <div className="flex gap-2">
              <Button icon={<IconMic size={16} />} onClick={() => setWriting(true)}>
                再补几句
              </Button>
              <Button
                full
                tone="primary"
                icon={<IconFeather size={16} />}
                disabled={Boolean(busy)}
                onClick={() => setConfirmSeal(true)}
              >
                封存今天
              </Button>
            </div>

            <p className="rounded-md bg-amber-leaf-50 px-3 py-2.5 text-2xs leading-relaxed text-amber-leaf-700 shadow-[var(--hair-amber)]">
              封存之后就不能再改了。今天过去了就是过去了 —— 想好了再按。
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="rounded-md bg-paper-2 px-3 py-3 text-xs leading-relaxed text-ink-600">
              日记是用说的。点下面开始，说完了停一下就好。
            </p>
            <Button
              full
              size="lg"
              tone="primary"
              icon={<IconMic size={18} />}
              onClick={() => setWriting(true)}
            >
              开始说
            </Button>
          </div>
        )}
      </Card>

      {/* ---------- 连续签到 / 加成 ---------- */}
      <Card>
        <SectionTitle
          icon={<IconSprout size={16} />}
          tone="amber"
          title="连续记录"
          sub={`历史最长 ${streak.best} 天`}
          right={
            <span className="tnum shrink-0 font-display text-xl font-bold text-amber-leaf-600">
              {streak.days} 天
            </span>
          }
        />
        <div className="rounded-md bg-amber-leaf-50 px-3 py-2.5 shadow-[var(--hair-amber)]">
          <div className="text-sm font-bold text-amber-leaf-700">{streak.buffLabel}</div>
          <div className="mt-0.5 text-xs text-ink-600">
            {streak.days > 0
              ? `稀有卡更容易出现（+${Math.round((streak.rarityBoost - 1) * 100)}%），金币也会多一点点（+${Math.round((streak.coinBoost - 1) * 100)}%）`
              : '连续写 2 天，就有第一档加成'}
          </div>
        </div>
      </Card>

      {/* ---------- 树洞 ---------- */}
      <Card>
        <SectionTitle
          icon={<IconTreeHollow size={16} />}
          tone="moss"
          title="树洞"
          sub={hollowUnlockHint(levelIndex)}
        />
        <TreeHollowLog />
      </Card>

      {/* ---------- 以前的日记 ---------- */}
      <Card>
        <SectionTitle
          icon={<IconBook size={16} />}
          title="以前的日记"
          sub={stats.total > 0 ? `一共 ${stats.total} 篇 · ${stats.totalWords} 字` : '还没有写过'}
        />

        {past.length === 0 ? (
          <EmptyState icon={<IconFeather size={26} />} title="还没有日记" desc="从今天开始，每天留一小段给自己。" />
        ) : (
          <div className="flex flex-col gap-2">
            {past.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setDetail(e)}
                className="btn-base active:btn-press flex w-full items-start gap-3 rounded-card surface px-3.5 py-3 text-left"
              >
                <span className="mt-0.5 shrink-0 text-xl">{e.mood}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-bold text-ink-900">{friendlyDay(e.dayKey)}</span>
                    <span className="text-2xs font-semibold text-ink-500">
                      {weekdayLabel(e.dayKey)}
                    </span>
                    {e.weather && <span className="text-sm leading-none">{e.weather}</span>}
                    {e.sealed && (
                      <span className="shrink-0 text-2xs font-bold text-inkleaf-600">已封存</span>
                    )}
                    {e.inHollow && (
                      <span className="shrink-0 text-moss-500">
                        <IconTreeHollow size={12} />
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-ink-600">
                    {e.text || '（还没写内容）'}
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    {e.review && <Stars count={e.review.stars} size="sm" />}
                    <span className="tnum text-2xs text-ink-500">{e.wordCount} 字</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {stats.total > 0 && (
          <div className="mt-3 grid grid-cols-4 gap-2 border-t border-ink-900/[0.06] pt-3">
            {[
              ['总篇数', `${stats.total}`],
              ['总字数', `${stats.totalWords}`],
              ['写过的天', `${stats.activeDays}`],
              ['平均字数', `${stats.avgWords}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md bg-ink-50 px-2 py-2 text-center">
                <div className="tnum font-display text-base font-bold text-ink-900">{value}</div>
                <div className="text-2xs font-medium text-ink-500">{label}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ---------- 封存确认（诗句提醒） ---------- */}
      <ConfirmDialog
        open={confirmSeal}
        title="把这页封起来吗？"
        desc="封存之后，这篇日记就永远保持现在的样子，不能再改了。"
        verse={pickVerse(today?.id ?? 'seed')}
        confirmText="封起来"
        cancelText="再想想"
        onConfirm={() => void handleSeal()}
        onCancel={() => setConfirmSeal(false)}
      />

      {/* ---------- 写作提示 ---------- */}
      <Sheet
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        title="不知道写什么？"
        footer={
          <Button full tone="primary" onClick={() => setPromptText(randomDiaryPrompt())}>
            换一个问题
          </Button>
        }
      >
        <div className="py-4 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-leaf-50 text-amber-leaf-600 shadow-[var(--hair-amber)]">
            <IconLightbulb size={24} />
          </div>
          <p className="mt-3 font-display text-lg font-bold leading-relaxed text-ink-900">
            {promptText}
          </p>
          <p className="mt-2 text-sm text-ink-500">就从这个说起，说到哪儿算哪儿。</p>
        </div>
      </Sheet>

      {/* ---------- 往日日记详情 ---------- */}
      <Sheet
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `${friendlyDay(detail.dayKey)} · ${weekdayLabel(detail.dayKey)}` : ''}
      >
        {detail && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">{detail.mood}</span>
              {detail.weather && <span className="text-lg leading-none">{detail.weather}</span>}
              <span className="tnum text-xs text-ink-500">{detail.wordCount} 字</span>
              {detail.sealed && (
                <span className="rounded-pill bg-inkleaf-50 px-2 py-0.5 text-2xs font-bold text-inkleaf-700">
                  已封存
                </span>
              )}
            </div>
            <p className="whitespace-pre-wrap rounded-md bg-paper-2 px-3.5 py-3 font-prose text-[15px] leading-[1.95] text-ink-900">
              {detail.text || '（还没写内容）'}
            </p>
            {detail.audio && (
              <audio controls src={detail.audio} className="w-full">
                <track kind="captions" />
              </audio>
            )}
            {detail.review ? (
              <ReviewBlock review={detail.review} childText={detail.text} />
            ) : (
              <p className="text-sm text-ink-500">这篇还没有让小笔苗看过。</p>
            )}
            <HollowSection entry={detail} />
            <Button
              full
              tone="quiet"
              disabled={detail.sealed}
              onClick={() => setConfirmDelete(detail)}
            >
              {detail.sealed ? '封存过的日记不能删' : '删除这篇日记'}
            </Button>
          </div>
        )}
      </Sheet>

      {/* ---------- 删除确认 ---------- */}
      <ConfirmDialog
        open={Boolean(confirmDelete)}
        danger
        title="要删掉这篇日记吗？"
        desc="删掉就再也找不回来了。"
        confirmText="删掉"
        cancelText="再想想"
        onConfirm={() => {
          if (confirmDelete) void handleDelete(confirmDelete.id)
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* ---------- 掉卡演出 ---------- */}
      {showDrops && drops.length > 0 && (
        <CardDropOverlay drops={drops} title="写日记也有奖励" onClose={() => setShowDrops(false)} />
      )}
    </div>
  )
}

/* ============================================================
   六、树洞里的东西
   ============================================================ */

function TreeHollowLog() {
  const tree = useApp((s) => s.tree)
  const level = useApp((s) => s.level)

  const unlocked = isHollowUnlocked(level.levelIndex)
  const diaries = tree.hollowDiaries
  const events = tree.events ?? []

  if (!unlocked) {
    return (
      <p className="rounded-md bg-paper-2 px-3 py-3 text-xs leading-relaxed text-ink-600">
        {hollowUnlockHint(level.levelIndex)}
        <br />
        树洞只做一件事：听。它不会评价你写得好不好。
      </p>
    )
  }

  if (diaries.length === 0 && events.length === 0) {
    return (
      <p className="rounded-md bg-moss-50 px-3 py-3 text-xs leading-relaxed text-moss-600">
        树洞开着，里面还很安静。
        <br />
        把封存好的日记丢进来，它会回你一句话。
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {diaries.length > 0 && (
        <div className="text-2xs font-semibold text-ink-500">
          收着 {diaries.length} 篇日记
        </div>
      )}
      {[...diaries]
        .reverse()
        .slice(0, 5)
        .map((h) => (
          <div
            key={h.id}
            className="rounded-md bg-moss-50 px-3.5 py-3 shadow-[var(--hair)]"
          >
            <div className="text-2xs font-semibold text-moss-600">{friendlyDay(h.dayKey)}</div>
            <p className="mt-1 font-prose text-sm leading-loose text-ink-800">{h.echo}</p>
          </div>
        ))}

      {events.length > 0 && (
        <>
          <div className="mt-1 text-2xs font-semibold text-ink-500">树上冒出来的小事</div>
          {[...events]
            .reverse()
            .slice(0, 4)
            .map((ev) => (
              <div key={ev.id} className="flex items-start gap-2.5 rounded-md surface px-3 py-2.5">
                <span className="mt-0.5 shrink-0 text-inkleaf-500">
                  <IconBirdSitting size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold text-ink-800">{ev.title}</span>
                  <span className="mt-0.5 block text-2xs leading-relaxed text-ink-500">
                    {ev.body}
                  </span>
                </span>
              </div>
            ))}
        </>
      )}

      {/* 树洞的回响是固定的一批，随机展示一句，让孩子觉得它在说话 */}
      <p className="mt-1 rounded-md bg-paper-2 px-3 py-2.5 font-prose text-xs leading-loose text-ink-500">
        {HOLLOW_ECHOES[diaries.length % HOLLOW_ECHOES.length]}
      </p>
    </div>
  )
}
