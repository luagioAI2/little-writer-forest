/* ============================================================
   背诵挑战 —— 背主干，拿奖励
   ============================================================

   流程：
     看骨架 → 听一遍（可选）→ 录一遍 → 逐句比对 → 结算奖励

   两条能力同时开：
     · 语音识别 → 拿文本，用于比对打分
     · 录音     → 存音频，进档案以后能回放

   如果设备不支持语音识别，退化为「自我勾选」：
   孩子自己判断哪句背下来了 —— 虽然不精确，但奖励闭环不断，
   而且诚实。
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Recitation, SkeletonLine } from '../../domain/types'
import {
  buildRecitationReward,
  compareRecitation,
  hintForLine,
  recitationProgress,
  type RecitationResult,
} from '../../domain/recitation'
import { buffForStreak } from '../../domain/cards'
import { treeCoinBoost } from '../../domain/economy'
import {
  createRecorder,
  createRecognizer,
  isRecordingSupported,
  isSpeechRecognitionSupported,
  speak,
  stopSpeaking,
  type Recognizer,
} from '../../platform/speech'
import { playSound } from '../../platform/sound'
import { celebrateFeedback, successFeedback } from '../../platform/haptics'
import { Button, Card, Chip, SectionTitle, Stars } from '../../components/ui'
import {
  IconCheck,
  IconCrown,
  IconGift,
  IconHourglass,
  IconQuestion,
  IconLightbulb,
  IconMic,
  IconMinus,
  IconPause,
  IconSparkle,
  IconSprout,
  IconStop,
  IconUndo,
  IconVolume,
} from '../../components/icons'
import { useApp } from '../../store/useApp'

type Phase = 'ready' | 'recording' | 'result'

export function ReciteView({
  workId,
  title,
  lines,
  onDone,
}: {
  workId: string
  title: string
  lines: SkeletonLine[]
  onDone: () => void
}) {
  const [phase, setPhase] = useState<Phase>('ready')
  const [liveText, setLiveText] = useState('')
  const [result, setResult] = useState<RecitationResult | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [selfCheck, setSelfCheck] = useState<Set<number>>(new Set())
  const [hintLevel, setHintLevel] = useState<Record<number, 1 | 2 | 3>>({})

  const recRef = useRef<Recognizer | null>(null)
  const recorderRef = useRef<ReturnType<typeof createRecorder> | null>(null)
  const transcriptRef = useRef('')
  const timerRef = useRef<number | null>(null)

  const saveRecitation = useApp((s) => s.saveRecitation)
  const streak = useApp((s) => s.streak)
  const levelIndex = useApp((s) => s.level.levelIndex)
  const toast = useApp((s) => s.toast)

  const speechOk = isSpeechRecognitionSupported()
  const recordOk = isRecordingSupported()
  const buff = buffForStreak(streak.days)

  /* ---------------- 计时 ---------------- */

  useEffect(() => {
    if (phase !== 'recording') return
    const t0 = Date.now()
    timerRef.current = window.setInterval(() => setElapsed(Date.now() - t0), 200)
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
    }
  }, [phase])

  // 离开时把麦克风关掉
  useEffect(() => {
    return () => {
      recRef.current?.abort()
      recorderRef.current?.cancel()
      stopSpeaking()
    }
  }, [])

  /* ---------------- 录音 + 识别 ---------------- */

  const start = useCallback(async () => {
    setLiveText('')
    setResult(null)
    setAudioUrl(null)
    setElapsed(0)
    transcriptRef.current = ''
    playSound('record-start')

    if (speechOk) {
      const rec = createRecognizer({
        onInterim: (t) => setLiveText(t),
        onFinal: (t) => {
          transcriptRef.current = `${transcriptRef.current}${t}。`
          setLiveText(transcriptRef.current)
        },
        onError: (msg) => {
          toast({ kind: 'warn', title: '语音识别出问题了', detail: msg, emoji: '⚠️' })
        },
      })
      recRef.current = rec
      rec.start()
    }

    if (recordOk) {
      try {
        const recorder = createRecorder()
        recorderRef.current = recorder
        await recorder.start()
      } catch {
        toast({
          kind: 'warn',
          title: '没能打开麦克风',
          detail: '请在浏览器设置里允许使用麦克风',
          emoji: '🎤',
        })
      }
    }

    setPhase('recording')
  }, [speechOk, recordOk, toast])

  const stop = useCallback(async () => {
    playSound('record-stop')
    const rec = recRef.current
    rec?.stop()
    recRef.current = null

    let recording: { dataUrl: string; durationMs: number } | null = null
    if (recorderRef.current) {
      try {
        recording = await recorderRef.current.stop()
      } catch {
        recording = null
      }
      recorderRef.current = null
    }

    if (recording) setAudioUrl(recording.dataUrl)

    /* 等系统把最后一句吐完。
       以前这里写的是 `sleep(320)`，而原生识别会话的 grace 窗口是 1600ms ——
       按停之后系统还没把最后一句送回来，我们就已经把 transcript 读走了，
       于是最后一句永远拿不到（表现："录音录上了，文字却没有"）。
       现在改成问识别器自己什么时候结算完，快则提前返回，慢则等满窗口。 */
    await rec?.settled()

    const transcript = transcriptRef.current.trim()
    const res = speechOk
      ? compareRecitation(transcript, lines)
      : selfCheckResult(selfCheck, lines)

    setResult(res)
    setPhase('result')
    playSound(res.stars === 3 ? 'success' : 'score')
    if (res.stars === 3) celebrateFeedback()
    else successFeedback()
  }, [lines, speechOk, selfCheck])

  /* ---------------- 结算 ---------------- */

  const claim = useCallback(async () => {
    if (!result) return
    /* 奖励在这里一次算准：连续签到 Buff × 文心树加成。
       以前这里只乘了签到 Buff，文心树的加成由 store 事后补乘 ——
       结果孩子看到的数字和实际到手的对不上。现在以这一份为准，
       store 直接照单入账（见 useApp.saveRecitation）。 */
    const reward = buildRecitationReward(result, {
      coinBoost: buff.coinBoost * treeCoinBoost(levelIndex),
    })
    const recitation: Recitation = {
      at: Date.now(),
      audioRef: audioUrl ?? undefined,
      durationMs: elapsed,
      transcript: transcriptRef.current.trim(),
      matchScore: result.matchScore,
      lineMatches: result.lineMatches.map((l) => ({
        core: l.core,
        matched: l.matched,
        heard: l.heard,
      })),
      reward,
    }
    await saveRecitation(workId, recitation)
    playSound('coin')
    toast({
      kind: 'reward',
      title: `背诵奖励 +${reward.coins} 金币`,
      detail: reward.blessing,
      emoji: '🎤',
    })
    onDone()
  }, [result, audioUrl, elapsed, buff.coinBoost, levelIndex, saveRecitation, workId, toast, onDone])

  /* ---------------- 渲染 ---------------- */

  return (
    <div className="space-y-3.5">
      <Card>
        <SectionTitle
          icon={<IconMic size={17} />}
          title={`背诵挑战 · ${title}`}
          sub="背完整写法。卡住了点「提示」，会告诉你这一句里藏着哪些词"
        />

        {/* 骨架逐句 —— v2：显示完整句子，提示卡帮孩子回忆 */}
        <div className="space-y-2">
          {lines.map((l, i) => {
            const m = result?.lineMatches[i]
            const hint = hintLevel[i]
            const target = l.full || l.core
            const revealed = phase === 'ready' || hint !== undefined || Boolean(m && !m.matched)
            return (
              <div
                key={i}
                className={`rounded-md px-3 py-2.5 transition ${
                  m
                    ? m.matched
                      ? 'bg-inkleaf-50 shadow-[var(--hair-leaf)]'
                      : 'bg-clay-50 shadow-[inset_0_0_0_1px_rgb(168_80_63/0.18)]'
                    : 'bg-white shadow-[var(--hair)]'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="tnum mt-0.5 shrink-0 text-xs font-bold text-ink-300">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* 准备阶段和录音中：只给主干当线索；结果出来后展开完整句子，
                        这样孩子能对照自己哪里漏了修饰 */}
                    {revealed ? (
                      <p className="font-prose text-[15px] leading-relaxed text-ink-900">{target}</p>
                    ) : (
                      <>
                        <p className="font-prose text-[15px] leading-relaxed text-ink-900">
                          {l.core}
                        </p>
                        {l.modifiers.length > 0 && (
                          <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                            这句还要带上修饰词（点「提示」看是哪些）
                          </p>
                        )}
                      </>
                    )}
                    {m && !m.matched && hint && (
                      <p className="mt-1.5 flex items-start gap-1 text-[11px] font-semibold text-mist-600">
                        <IconLightbulb size={12} className="mt-px shrink-0" />
                        <span className="min-w-0">{hintForLine(target, hint, l.modifiers)}</span>
                      </p>
                    )}
                  </div>
                  {m && (
                    <span className="shrink-0">
                      {m.matched ? (
                        <IconCheck size={16} className="text-inkleaf-600" />
                      ) : (
                        <IconMinus size={16} className="text-ink-300" />
                      )}
                    </span>
                  )}
                  {/* 没背出来时给提示 */}
                  {phase === 'recording' && !hint && (
                    <button
                      type="button"
                      onClick={() =>
                        setHintLevel((h) => ({ ...h, [i]: ((h[i] ?? 0) + 1) as 1 | 2 | 3 }))
                      }
                      className="shrink-0 rounded-pill bg-mist-50 px-2 py-1 text-[10px] font-bold text-mist-600 shadow-[var(--hair-mist)]"
                    >
                      提示
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* 听一遍 */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip
            icon={<IconVolume size={13} />}
            onClick={() => {
              speak(lines.map((l) => l.full || l.core).join('。'))
            }}
          >
            听一遍写法
          </Chip>
          <Chip
            icon={<IconHourglass size={13} />}
            onClick={() => speak(lines.map((l) => l.core).join('。'), { rate: 0.85 })}
          >
            慢速听主干
          </Chip>
          <Chip icon={<IconPause size={13} />} onClick={stopSpeaking}>
            停止朗读
          </Chip>
        </div>      </Card>

      {/* 不支持语音识别 → 自我勾选 */}
      {!speechOk && phase !== 'result' && (
        <Card className="bg-amber-leaf-50/60 shadow-[var(--hair-amber)]">
          <SectionTitle
            icon={<IconQuestion size={17} />}
            title="这台设备不能听写，你自己勾一下"
            sub="诚实一点哦，这是给你自己练的"
          />
          <div className="flex flex-wrap gap-2">
            {lines.map((_, i) => {
              const on = selfCheck.has(i)
              return (
                <Chip
                  key={i}
                  active={on}
                  onClick={() => {
                    const next = new Set(selfCheck)
                    if (on) next.delete(i)
                    else next.add(i)
                    setSelfCheck(next)
                  }}
                >
                  第 {i + 1} 句
                </Chip>
              )
            })}
          </div>
        </Card>
      )}

      {/* 录音中 */}
      {phase === 'recording' && (
        <Card className="bg-clay-50 shadow-[inset_0_0_0_1px_rgb(168_80_63/0.18)]">
          <div className="flex items-center gap-3">
            <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-clay-100 text-clay-600">
              <IconMic size={22} />
              <span className="anim-pulse-ring absolute inset-0 rounded-full shadow-[inset_0_0_0_2px_rgb(168_80_63/0.45)]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="tnum font-display text-lg font-bold text-ink-900">
                {Math.floor(elapsed / 1000)} 秒
              </div>
              <div className="truncate text-xs text-ink-600">
                {liveText || '正在听你背……'}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 结果 */}
      {phase === 'result' && result && (
        <Card className="bg-paper-2">
          <div className="flex flex-col items-center gap-2 py-2">
            <div
              className={`grid h-14 w-14 place-items-center rounded-full ${
                result.stars === 3
                  ? 'bg-amber-leaf-100 text-amber-leaf-600'
                  : result.stars === 2
                    ? 'bg-mist-50 text-mist-600'
                    : 'bg-inkleaf-50 text-inkleaf-600'
              }`}
            >
              {result.stars === 3 ? (
                <IconCrown size={26} />
              ) : result.stars === 2 ? (
                <IconSparkle size={26} />
              ) : (
                <IconSprout size={26} />
              )}
            </div>
            <Stars count={result.stars * 1.67} size="md" />
            <div className="tnum font-display text-3xl font-bold text-ink-900">
              {result.matchScore}
              <span className="ml-0.5 text-sm text-ink-500">分</span>
            </div>
            <p className="text-center text-sm font-semibold leading-relaxed text-ink-800">
              {result.feedback}
            </p>
            <p className="text-xs font-semibold text-ink-500">
              {recitationProgress(result.hitCount, result.totalCount)}
            </p>
          </div>

          {/* 录音回放 —— 档案里也能听 */}
          {audioUrl && (
            <div className="mt-3 rounded-md bg-white p-3 shadow-[var(--hair)]">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-ink-500">
                <IconVolume size={13} />
                <span>听听你自己背的（会存进档案）</span>
              </div>
              <audio controls src={audioUrl} className="w-full" />
            </div>
          )}
        </Card>
      )}

      {/* 操作区 */}
      <div className="space-y-2">
        {phase === 'ready' && (
          <Button full tone="primary" size="lg" icon={<IconMic size={17} />} onClick={() => void start()}>
            开始背诵
          </Button>
        )}
        {phase === 'recording' && (
          <Button full tone="danger" size="lg" icon={<IconStop size={17} />} onClick={() => void stop()}>
            背完了
          </Button>
        )}
        {phase === 'result' && (
          <>
            <Button full tone="primary" size="lg" icon={<IconGift size={17} />} onClick={() => void claim()}>
              领取奖励
            </Button>
            <Button
              full
              icon={<IconUndo size={16} />}
              onClick={() => {
                setPhase('ready')
                setResult(null)
                setSelfCheck(new Set())
                setHintLevel({})
              }}
            >
              再背一遍
            </Button>
          </>
        )}
      </div>

      {/* Buff 提示 */}
      {streak.days > 0 && (
        <p className="px-1 text-center text-[11px] font-semibold text-ink-500">
          日记连续 {streak.days} 天 · {buff.label}
        </p>
      )}
    </div>
  )
}

/** 不支持语音识别时的自我勾选 → 折算成分数 */
function selfCheckResult(checked: Set<number>, lines: SkeletonLine[]): RecitationResult {
  const total = lines.length
  const hit = checked.size
  const matchScore = total === 0 ? 0 : Math.round((hit / total) * 100)
  return {
    matchScore,
    lineMatches: lines.map((l, i) => ({
      core: l.full || l.core,
      matched: checked.has(i),
      score: checked.has(i) ? 100 : 0,
    })),
    hitCount: hit,
    totalCount: total,
    stars: matchScore >= 88 ? 3 : matchScore >= 65 ? 2 : 1,
    feedback:
      matchScore >= 88
        ? '全背下来啦，太棒了！🎉'
        : matchScore >= 65
          ? '大部分都记住了，再练一遍就全对 💪'
          : '没关系，先挑两句最容易的记住 😊',
  }
}
