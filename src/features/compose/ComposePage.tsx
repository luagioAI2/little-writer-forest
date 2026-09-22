/* ============================================================
   看图作文 —— 主流程  v3
   ============================================================

   完整链路：
     选题 → 看图 → 语音录入 → 语音编辑（孩子自己改）
       → 提交 → 评分（分数 / 亮点 / 建议 / 思维导图）
       → 看更好的写法 → 背诵挑战 → 留档

   v3 的三个关键变化（对照用户反馈）：
     · 年级不再出现在这一页。它是一次性设定，已经在引导里问过，
       想改去设置。这里只显示一行淡淡的「三年级」作为上下文。
     · 选题页重排为「类别 → 细标签 → 出题」，一屏内解决，
       不再需要用滚动条去找按钮。
     · 「写作」这一步进入**沉浸模式**：外壳的头部与底部导航整体让位，
       页面自己变成一张安静的深色稿纸。孩子会明显感到"开始写了"。
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AiConfig,
  CompositionCategory,
  CompositionPrompt,
  GradeLevel,
  TranscribeConfig,
  Work,
} from '../../domain/types'
import { CATEGORIES, categoryMeta, gradeLabel } from '../../domain/types'
import { tagById } from '../../domain/prompts'
import { isEssayStale } from '../../domain/ai'
import { searchLibrary, randomFromLibrary, type LibraryItem } from '../../domain/library'
import { countWords } from '../../domain/scoring'
import { DAILY_COMPOSITION_LIMIT } from '../../domain/economy'
import { PromptImageArt, promptImageCaption } from '../../assets/scenes'
import { useApp, type SubmitResult } from '../../store/useApp'
import { VoiceComposer } from '../../components/VoiceComposer'
import { CardDropOverlay } from '../../components/CardView'
import { Sprout } from '../../components/Sprout'
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
  EmptyState,
  LoadingLine,
  SectionTitle,
  Sheet,
  Stars,
} from '../../components/ui'
import { ScoreView, ModelEssayView } from './ScoreView'
import { ReciteView } from './ReciteView'
import { playSound } from '../../platform/sound'
import { successFeedback } from '../../platform/haptics'
import { setImmersiveMode } from '../../shell/events'
import {
  IconArrowRight,
  IconCards,
  IconCheck,
  IconCoin,
  IconDice,
  IconFeather,
  IconFolder,
  IconInk,
  IconMagic,
  IconSearch,
  IconSparkle,
  IconStar,
  IconStarFilled,
  IconTrophy,
} from '../../components/icons'

type Step = 'setup' | 'write' | 'score' | 'essay' | 'recite'

const STEP_LABEL: { key: Step; label: string }[] = [
  { key: 'setup', label: '出题' },
  { key: 'write', label: '写作文' },
  { key: 'score', label: '看点评' },
  { key: 'essay', label: '看写法' },
  { key: 'recite', label: '背诵' },
]

/** 从当前题库中提取某大类下实际存在的细标签（存的是英文 id，显示时翻成中文） */
function dynamicTagsFor(
  items: LibraryItem[],
  category: CompositionCategory | null,
): string[] {
  if (!category) return []
  const set = new Set<string>()
  for (const it of items) {
    if (it.category === category && it.tagId) set.add(it.tagId)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh'))
}

export default function ComposePage() {
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)

  const [step, setStep] = useState<Step>('setup')

  // 出题参数（年级不再由本页选择）
  // ★ 2026-09-21：默认写景；记住孩子上次选的（存在 Settings 里）
  // ⚠️ `?? 'scene'` 是防旧存档/测试环境直接写了缺字段的状态，
  //    真实 App 启动时 mergeSettings 会补上，但组件不能信 merge 一定先跑完。
  const [category, setCategory] = useState<CompositionCategory>(settings.lastCategory ?? 'scene')
  const [tagId, setTagId] = useState<string | null>(null)

  // 当前这道题 / 这篇稿子
  const [prompt, setPrompt] = useState<CompositionPrompt | null>(null)
  const [workId, setWorkId] = useState<string | null>(null)
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null)

  const [picking, setPicking] = useState(false)
  const [showDrops, setShowDrops] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const busy = useApp((s) => s.busy)
  const works = useApp((s) => s.works)
  const library = useApp((s) => s.library)
  const toast = useApp((s) => s.toast)

  const pendingPrompt = useApp((s) => s.pendingPrompt)
  const takePendingPrompt = useApp((s) => s.takePendingPrompt)
  const pickRandomPrompt = useApp((s) => s.pickRandomPrompt)
  const startWork = useApp((s) => s.startWork)
  const updateWorkText = useApp((s) => s.updateWorkText)
  const submitWork = useApp((s) => s.submitWork)
  const generateModelEssayFor = useApp((s) => s.generateModelEssayFor)
  const deleteWork = useApp((s) => s.deleteWork)

  const grade = settings.grade
  const work: Work | undefined = useMemo(() => works.find((w) => w.id === workId), [works, workId])

  /* ---------------- 存着的那份写法是不是"旧的" ----------------
     用来回答家长最常见的一个困惑：「我改了设置，怎么没变化？」
     判断规则在 domain/ai.ts 的 isEssayStale 里（含"老数据没有 engine"那种情况）。 */
  const essayIsStale = isEssayStale(work?.modelEssay, settings.ai)

  /* ---------------- 沉浸模式开关 ----------------
     写作这一步把外壳让掉。为什么用副作用而不是条件渲染：
     沉浸状态活在外壳里，页面只要"声明"自己需要安静，
     进入/退出都走同一个通道，卸载时自动还原。 */
  const immersiveOn = step === 'write' || step === 'recite'
  useEffect(() => {
    setImmersiveMode(immersiveOn)
    return () => setImmersiveMode(false)
  }, [immersiveOn])

  /* ---------------- 出题 ---------------- */

  const beginWith = useCallback(
    async (p: CompositionPrompt) => {
      const w = await startWork(p, grade)
      setPrompt(p)
      setWorkId(w.id)
      setStep('write')
      setSubmitResult(null)
      playSound('success')
    },
    [grade, startWork],
  )

  /* ---------------- 从题库页接过来的题目 ----------------
     题库页点「就用这题」时，会把题目放进 store.pendingPrompt 再跳过来。
     这里取一次就消费掉（takePendingPrompt 内部会清空），然后直接进写作步。

     为什么非得走 store：打开题库页时 App 会把整棵页面树换掉，
     本组件会被卸载重建，页面内的 useState 一律归零 ——
     题目存在页面 state 里，切页那一瞬间就丢了。
     这也正是以前「题库里点了『就用这题』，跳过去却什么也没发生」的根因。 */
  useEffect(() => {
    if (!pendingPrompt) return
    const picked = takePendingPrompt()
    if (picked) void beginWith(picked)
  }, [pendingPrompt, takePendingPrompt, beginWith])

  /**
   * 随机出题 —— 直接从系统题库里抽，不走 AI，瞬间完成。
   */
  const handleGenerate = useCallback(async () => {
    if (!category) return
    const prompt = await pickRandomPrompt({ grade, category, tagId: tagId ?? undefined })
    if (prompt) {
      await beginWith(prompt)
    } else {
      toast({
        kind: 'warn',
        title: '题库是空的',
        detail: '先导入一些题目吧',
      })
    }
  }, [category, tagId, grade, pickRandomPrompt, beginWith, toast])

  /* ---------------- 提交 ---------------- */

  const handleSubmit = useCallback(async () => {
    if (!workId) return
    try {
      const r = await submitWork(workId)
      setSubmitResult(r)
      setStep('score')
      successFeedback()
      playSound('success')
      if (r.warning) {
        /* ⚠️ 标题不能写死成「AI 没接上」——
           降级有两种：连不上（真的没接上）、以及**接上了但模型少给了东西**
           （评价整份退回本地）。后者说"没接上"会把排查方向带偏。
           detail 里会说清是哪一种。 */
        toast({ kind: 'warn', title: '这次用了本地引擎', detail: r.warning, emoji: '⚠️' })
      }
    } catch (err) {
      toast({
        kind: 'warn',
        title: '提交没成功',
        detail: err instanceof Error ? err.message : '再过一会儿试试',
      })
    }
  }, [workId, submitWork, toast])

  /**
   * 看「更好的写法」。
   *
   * ★ 默认**先用已经存好的那份**（提交时一起生成好的），不再花一次 AI 调用。
   *   但必须留一条"重新生成"的路 —— 见参数 `force`。
   *
   *   为什么：家长改完 AI 配置、或者换了密钥之后，存着的那份还是**旧引擎**写的。
   *   以前这里 `if (w?.modelEssay) return` 直接把它端出来，永远不重算 ——
   *   表现就是「我明明改了设置，点进去一点变化都没有，改动没生效」。
   */
  const handleEssay = useCallback(
    async (force = false) => {
      if (!workId) return
      const w = works.find((x) => x.id === workId)
      if (!force && w?.modelEssay) {
        setStep('essay')
        return
      }
      // 兜底：没生成过、或者家长要求重来
      setStep('essay')
      try {
        const r = await generateModelEssayFor(workId)
        if (r.warning) {
          toast({ kind: 'warn', title: '写法降级生成', detail: r.warning })
        }
      } catch {
        toast({ kind: 'warn', title: '更好的写法没生成', detail: '网络可能不太顺，等下再试' })
      }
    },
    [workId, works, generateModelEssayFor, toast],
  )

  /* ---------------- 重置 ---------------- */

  /**
   * 收尾：**回到出题页**，清掉当前题目。
   *
   * ⚠️ 这里原来带一个 `backToSetup` 参数，`false` 那一支会
   * `beginWith(prompt)` —— **同一个题目新建一篇空白稿、直接跳进写作页**。
   * 它的注释说是给「再写一篇」用的，但那个按钮在代码里根本不存在
   * （`grep 再写一篇` 只命中那段注释），于是那一支实际上只被
   * **背诵领奖**用到：孩子领完奖，看到的是一篇同名的空白作文 ——
   * 家长报的「好像回到的页面不对，还是在当前写的」就是它。
   *
   * ★ 现在把那个分支**删掉**：全流程的出口只有"回出题页"这一种，
   *   也就不存在"选错出口"这类 bug 了（比加一条测试更硬）。
   *   要恢复"同一个题目再写一篇"，得先有一个真的按钮，再把这个分支加回来。
   */
  const reset = useCallback(() => {
    setSubmitResult(null)
    setShowDrops(false)
    setPrompt(null)
    setWorkId(null)
    setStep('setup')
  }, [])

  /* ---------------- 离开确认 ---------------- */

  const handleBack = useCallback(() => {
    if (step === 'write' && work && countWords(work.text) > 0) {
      setConfirmLeave(true)
      return
    }
    reset()
  }, [step, work, reset])

  const confirmDiscard = useCallback(async () => {
    if (workId) await deleteWork(workId)
    setConfirmLeave(false)
    reset()
  }, [workId, deleteWork, reset])

  /* ---------------- 渲染：沉浸写作单独走一条分支 ---------------- */

  if (step === 'write' && prompt && work) {
    return (
      <WriteStage
        prompt={prompt}
        work={work}
        onChange={(next) => void updateWorkText(work.id, next.text, next)}
        onBack={handleBack}
        onSubmit={() => void handleSubmit()}
        busyText={busy}
        transcribe={settings.transcribe}
        ai={settings.ai}
      />
    )
  }

  const stepIndex = STEP_LABEL.findIndex((s) => s.key === step)

  return (
    <div className="px-4 pb-6 pt-3">
      {/* ---------------- 步骤条 ---------------- */}
      <div className="mb-4 flex items-center gap-1.5">
        {STEP_LABEL.map((s, i) => {
          const done = i < stepIndex
          const active = i === stepIndex
          return (
            <div key={s.key} className="flex flex-1 items-center gap-1.5">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-2xs font-bold transition-colors ${
                    done
                      ? 'bg-inkleaf-100 text-inkleaf-600'
                      : active
                        ? 'bg-inkleaf-600 text-white'
                        : 'bg-ink-100 text-ink-400'
                  }`}
                >
                  {done ? <IconCheck size={11} strokeWidth={2.8} /> : i + 1}
                </span>
                <span
                  className={`truncate text-2xs font-semibold ${
                    active ? 'text-ink-900' : 'text-ink-400'
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < STEP_LABEL.length - 1 && (
                <span
                  className={`h-px flex-none transition-colors ${
                    done ? 'w-3 bg-inkleaf-200' : 'w-3 bg-ink-150'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* ---------------- 忙碌 ---------------- */}
      {busy && (
        <Card className="mb-3" tone="tint">
          <LoadingLine text={busy} />
        </Card>
      )}

      {/* ============ 第一步：出题 ============ */}
      {step === 'setup' && (
        <div className="space-y-4">
          <Card pad="p-5">
            <div className="mb-4 flex items-baseline gap-2">
              <h2 className="font-display text-xl font-bold tracking-tight text-ink-900">
                今天写什么
              </h2>
              <span className="text-xs text-ink-400">{gradeLabel(grade)}</span>
            </div>

            {/* 类别：一行图标 + 文字，紧凑且清楚 */}
            <div className="grid grid-cols-5 gap-2">
              {CATEGORIES.map((c) => {
                const on = category === c.key
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      playSound('tap-soft')
                      setCategory(c.key)
                      setTagId(null)
                      // 记住孩子这次选的题材，下次进来直接用它
                      updateSettings({ lastCategory: c.key })
                    }}
                    className={`btn-base active:btn-press flex flex-col items-center gap-1.5 rounded-md py-3 ${
                      on
                        ? 'bg-inkleaf-600 text-white shadow-[0_6px_16px_-8px_rgb(9_71_46/0.5)]'
                        : 'bg-ink-50 text-ink-600 shadow-[var(--hair)]'
                    }`}
                  >
                    <CategoryGlyph category={c.key} />
                    <span className="text-2xs font-bold">{c.label}</span>
                  </button>
                )
              })}
            </div>

            {category && (
              <p className="mt-3 text-xs leading-relaxed text-ink-500 anim-fade-in">
                {categoryMeta(category).desc}
              </p>
            )}

            {/* 细标签 —— 从题库动态提取；数据里存英文 id，显示中文 */}
            {category && dynamicTagsFor(library, category).length > 0 && (
              <div className="mt-4 anim-fade-in">
                <div className="mb-2 text-2xs font-semibold text-ink-400">
                  再具体一点 · 可以跳过
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {dynamicTagsFor(library, category).map((tid) => {
                    const known = tagById(tid)
                    return (
                      <Chip
                        key={tid}
                        active={tagId === tid}
                        onClick={() => setTagId(tagId === tid ? null : tid)}
                      >
                        {/* 显示中文 label，不是 id —— 否则孩子看到的是「🌧️ weather」 */}
                        {known ? `${known.emoji} ${known.label}` : tid}
                      </Chip>
                    )
                  })}
                </div>
              </div>
            )}
          </Card>

          {/* 出题按钮 */}
          <div className="flex gap-2">
            <Button
              full
              tone="primary"
              size="lg"
              disabled={!category || Boolean(busy)}
              onClick={() => void handleGenerate()}
              icon={<IconSparkle size={18} />}
            >
              随机出题
            </Button>
            <Button
              full
              disabled={Boolean(busy)}
              onClick={() => setPicking(true)}
              icon={<IconFolder size={17} />}
            >
              题库中选择
            </Button>
          </div>

          {/* ★ 小笔苗在这儿等着。
              这一屏在"还没选类别"时下面是一大片空白，而这是孩子每天
              打开 App 看到的第一屏 —— 放个活的东西比放空白好。
              选了类别它就让位（那时下面会冒出描述和细标签）。 */}
          {!category && (
            <div className="flex flex-col items-center gap-0.5 pt-2 anim-rise-in">
              <Sprout size={112} mood="curious" />
              <p className="text-xs font-semibold text-ink-400">先挑一个想写的方向吧</p>
            </div>
          )}

          {/* 写过的作文 / 收藏的作文 */}
          {works.filter((w) => w.score).length > 0 && (
            <WorkListTabs
              works={works}
              onSelect={(w) => {
                setWorkId(w.id)
                setPrompt(null)
                setSubmitResult(null)
                setStep('score')
              }}
            />
          )}
        </div>
      )}

      {/* ============ 第三步：点评 ============ */}
      {step === 'score' && (
        <div className="space-y-3.5">
          {submitResult ? (
            <>
              {/* 奖励条 */}
              <Card tone="reward" pad="p-5">
                <div className="flex items-center justify-around gap-2 text-center">
                  <RewardTile icon={<IconCoin size={20} />} value={`+${submitResult.coins}`} label="金币" tone="amber" />
                  <span className="h-9 w-px bg-amber-leaf-200" />
                  <RewardTile icon={<IconStar size={20} />} value={`+${submitResult.xp}`} label="经验" tone="amber" />
                  <span className="h-9 w-px bg-amber-leaf-200" />
                  <RewardTile icon={<IconCards size={20} />} value={`×${submitResult.drops.length}`} label="卡片" tone="amber" />
                </div>

                {/* 金币是怎么来的 —— 让孩子看见"树加成"和"今日才气" */}
                <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-2xs font-semibold text-ink-600">
                  {submitResult.treeBoost > 1 && (
                    <span className="rounded-pill bg-white/70 px-2.5 py-1">
                      文心树加成 +{Math.round((submitResult.treeBoost - 1) * 100)}%
                    </span>
                  )}
                  <span className="rounded-pill bg-white/70 px-2.5 py-1">
                    今日才气还剩 {submitResult.talentLeft} / {DAILY_COMPOSITION_LIMIT} 篇
                  </span>
                </p>

                {submitResult.dailyLimitReached && (
                  <p className="mt-3 rounded-md bg-white/70 px-3.5 py-3 text-xs leading-relaxed text-ink-700">
                    今天的 {DAILY_COMPOSITION_LIMIT} 篇才气都用完啦。这一篇照样给你打了分、加了经验，
                    只是金币和卡片要等明天 —— 才气是有限的，明天再来浇灌成长树吧。
                  </p>
                )}

                <p className="mt-4 rounded-md bg-white/70 px-3.5 py-3 text-center font-prose text-sm leading-loose text-ink-800">
                  {submitResult.blessing}
                </p>
                {submitResult.levelMessage && (
                  <p className="mt-2.5 text-center text-xs font-semibold text-moss-500">
                    {submitResult.levelMessage}
                  </p>
                )}
                {submitResult.drops.length > 0 && (
                  <Button
                    full
                    size="sm"
                    className="mt-3.5"
                    tone="reward"
                    onClick={() => setShowDrops(true)}
                    icon={<IconSparkle size={16} />}
                  >
                    看看掉了什么卡
                  </Button>
                )}
              </Card>

              <ScoreView
                score={submitResult.score}
                scoredCount={submitResult.scoredCount}
                confidence={submitResult.confidence}
              />

              {/* 修改记录 */}
              {work && work.edits.length > 0 && (
                <Card tone="tint">
                  <SectionTitle
                    icon={<IconFeather size={16} />}
                    title="你自己改过的地方"
                    sub={`一共 ${work.edits.length} 处 —— 这些分是你自己挣的`}
                  />
                  <div className="space-y-1.5">
                    {work.edits.map((e) => (
                      <div key={e.id} className="text-xs text-ink-700">
                        {e.kind === 'append' ? (
                          <span className="font-semibold text-inkleaf-600">＋ 加上「{e.to}」</span>
                        ) : e.kind === 'delete' ? (
                          <span className="font-semibold text-danger">－ 删掉「{e.from}」</span>
                        ) : (
                          <span className="font-medium">
                            <span className="text-ink-400 line-through">{e.from}</span>
                            <span className="mx-1.5 text-ink-300">→</span>
                            <span className="text-inkleaf-700">{e.to}</span>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              <div className="space-y-2">
                <Button
                  full
                  tone="primary"
                  size="lg"
                  onClick={() => void handleEssay()}
                  icon={<IconTrophy size={18} />}
                >
                  看看更好的写法
                </Button>
              </div>
            </>
          ) : work?.score ? (
            <>
              <ScoreView score={work.score} />
              <div className="space-y-2">
                <Button full tone="primary" onClick={() => void handleEssay()}>
                  看看更好的写法
                </Button>
                <Button full onClick={() => reset()}>
                  回到出题
                </Button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<IconInk size={26} />}
              title="这篇还没有点评"
              desc="可能还没提交，或者数据出了点小问题"
              action={<Button onClick={() => reset()}>回到出题</Button>}
            />
          )}
        </div>
      )}

      {/* ============ 第四步：写法 ============ */}
      {step === 'essay' && (
        <div className="space-y-3.5">
          {work?.modelEssay ? (
            <>
              {/* ★ 存着的那份和当前配置对不上 —— 明说，并给一键重来。
                  不说的话，家长改完设置点进来看到的还是旧的，
                  只会得出"改了没生效"这个结论（而代码其实是生效的）。 */}
              {essayIsStale && (
                <Card>
                  <SectionTitle
                    icon={<IconMagic size={16} />}
                    title="这份是本地引擎写的"
                    sub="当时还没配好 AI"
                  />
                  <p className="text-xs leading-relaxed text-ink-700">
                    你现在已经配好了 AI。重新生成一次，就会用上 AI ——
                    它会看着配图和正文一起改写，比本地引擎贴近得多。
                  </p>
                  <Button
                    full
                    tone="primary"
                    className="mt-3"
                    onClick={() => void handleEssay(true)}
                  >
                    用 AI 重新生成
                  </Button>
                </Card>
              )}
              <ModelEssayView essay={work.modelEssay} onRecite={() => setStep('recite')} />
            </>
          ) : busy ? (
            <Card>
              <LoadingLine text="正在写更好的写法…" />
            </Card>
          ) : (
            <EmptyState
              mood="curious"
              title="更好的写法还没生成"
              desc="可能是 AI 没接上，点下面再试一次"
              action={
                <Button tone="primary" onClick={() => void handleEssay()}>
                  再生成一次
                </Button>
              }
            />
          )}

          <div className="flex gap-2">
            <Button full onClick={() => setStep('score')}>
              回到点评
            </Button>
            {/* 已经有一份、又不是"旧引擎"的时候，也给一个重来的入口 ——
                孩子可能就是想让 AI 再写一版看看 */}
            {work?.modelEssay && !essayIsStale && (
              <Button full onClick={() => void handleEssay(true)}>
                换一版
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ============ 第五步：背诵 ============ */}
      {step === 'recite' && work?.modelEssay && (
        <ReciteView
          workId={work.id}
          title={work.title}
          lines={work.modelEssay.skeletonLines}
          /* ★ 领完奖**回到出题页**收尾（全流程到这里已经走完：写 → 点评 → 写法 → 背诵）。
             ⚠️ 原来传的是 `reset(false)`，那一支会新建一篇同名的空白稿、直接跳进写作页 ——
             家长报的「背诵完 点领取奖励，好像回到的页面不对」就是它。
             为什么把那个分支整个删掉了：见 `reset` 的说明。 */
          onDone={() => reset()}
        />
      )}

      {/* 题库选择器 */}
      <LibraryPicker
        open={picking}
        onClose={() => setPicking(false)}
        items={library}
        grade={grade}
        category={category}
        onPick={(item) => {
          setPicking(false)
          void beginWith(item)
        }}
      />

      {/* 掉卡演出 */}
      {showDrops && submitResult && submitResult.drops.length > 0 && (
        <CardDropOverlay drops={submitResult.drops} onClose={() => setShowDrops(false)} />
      )}

      {/* 放弃确认 */}
      <ConfirmDialog
        open={confirmLeave}
        title="这篇还没交哦"
        desc="现在离开的话，刚写的内容就没有了。"
        verse="先把它交上去，让树记住你今天写过的字。"
        confirmText="不要了"
        cancelText="继续写"
        danger
        onConfirm={() => void confirmDiscard()}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  )
}

/* ============================================================
   沉浸写作台
   ------------------------------------------------------------
   这一屏是整个 App 里最需要"安静"的地方，所以它：
     · 没有头部、没有底部导航（外壳已让位）
     · 底色是夜色稿纸，两侧有轻微压暗，视野被收进中间
     · 主控件只有一个巨大的麦克风

   ★ v4：图常驻。
     上一版把图收进「看图」抽屉，理由是"图会抢注意力"。
     但孩子听到的指令是「按下麦克风，把看到的说出来」——
     看不见图，这句话就落空了：他得先点开抽屉、看完、再收起来，
     说的时候图上有什么已经模糊了。
     现在图就在稿纸上方，一直在。多图（连环图）横向连排，
     左右滑着看，顺序不丢，稿纸也不会被挤没。
   ============================================================ */

function WriteStage({
  prompt,
  work,
  onChange,
  onBack,
  onSubmit,
  busyText,
  transcribe,
  ai,
}: {
  prompt: CompositionPrompt
  work: Work
  onChange: (next: {
    text: string
    utterances: Work['utterances']
    edits: Work['edits']
  }) => void
  onBack: () => void
  onSubmit: () => void
  busyText: string | null
  /** 语音转写配置：有它就用「按住说话」，没有则退回系统识别 */
  transcribe?: TranscribeConfig
  /** AI 配置：「改作文」配好了就走大模型，没配就退回本地精确替换 */
  ai?: AiConfig
}) {
  const words = countWords(work.text)
  const target = prompt.wordRange[0]
  const pct = target <= 0 ? 0 : Math.min(100, Math.round((words / target) * 100))
  const reached = words >= target
  const scroller = useRef<HTMLDivElement>(null)

  const images = prompt.images
  const multi = images.length > 1

  // 说出新内容时，视线跟着文字走
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [work.utterances.length])

  return (
    <div className="scene-ink relative flex min-h-screen flex-col">
      {/* 顶部：极简。只有一个退出 —— 图已经常驻在下面，不需要开关了。
          保持吸顶（退出要随时够得着），所以要给自己垫一层夜色底，
          不然正文滚上去会和标题叠在一起。 */}
      <header className="sticky top-0 z-20 flex shrink-0 items-center gap-2 bg-[rgb(16_26_22/0.88)] px-4 py-3 pt-safe backdrop-blur-sm">
        <button
          type="button"
          onClick={onBack}
          className="btn-base active:btn-press min-h-[40px] rounded-pill px-3.5 text-xs font-semibold text-[var(--color-night-text-3)]"
        >
          退出
        </button>

        <div className="min-w-0 flex-1 text-center">
          <div className="truncate font-display text-sm font-semibold text-[var(--color-night-text-2)]">
            {prompt.title}
          </div>
        </div>

        {/* 占位：让标题保持居中 */}
        <span className="w-[52px] shrink-0" aria-hidden />
      </header>

      {/* ---------------- 图（常驻） ----------------
          单图：居中铺开，宽度封顶，免得把稿纸挤没。
          多图：横向连排，snap 对齐，滑一下看下一幅。 */}
      {images.length > 0 && (
        <div className="shrink-0 px-4 pb-2">
          {multi ? (
            <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-contain pb-1">
              {images.map((img, i) => (
                <figure
                  key={i}
                  className="w-[56%] shrink-0 snap-start overflow-hidden rounded-lg shadow-[var(--hair-light)]"
                >
                  <PromptImageArt image={img} />
                  <figcaption className="bg-black/30 px-2 py-1 text-center text-2xs text-[var(--color-night-text-3)]">
                    {promptImageCaption(img, `第 ${i + 1} 幅`)}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[16.5rem] overflow-hidden rounded-lg shadow-[var(--hair-light)]">
              <PromptImageArt image={images[0]} />
            </div>
          )}

          {prompt.lead && (
            <p className="mt-2 text-center text-2xs leading-relaxed text-[var(--color-night-text-3)]">
              {prompt.lead}
            </p>
          )}
        </div>
      )}

      {/* 稿纸 */}
      <div className="relative flex min-h-0 flex-1 flex-col px-4 pb-2">
        <div className="paper-sheet focus-vignette relative min-h-[7rem] flex-1 overflow-hidden rounded-lg shadow-[var(--hair-light)]">
          <div ref={scroller} className="h-full overflow-y-auto overscroll-contain px-5 py-5">
            {work.text.trim() ? (
              <p className="whitespace-pre-wrap font-prose text-[17px] leading-[2.4rem] text-[var(--color-night-text)]">
                {work.text}
              </p>
            ) : (
              <div className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-2 text-center">
                <IconFeather size={22} className="text-[var(--color-night-text-3)]" />
                <p className="text-sm text-[var(--color-night-text-3)]">
                  按下麦克风，把看到的说出来
                </p>
              </div>
            )}

            {/* 孩子刚刚改动的痕迹 */}
            {work.edits.length > 0 && (
              <div className="mt-6 space-y-1.5 border-t border-white/[0.07] pt-4">
                {work.edits.slice(-3).map((e) => (
                  <div key={e.id} className="text-2xs text-[var(--color-night-text-3)]">
                    {e.kind === 'append' ? (
                      <>＋ 加上「{e.to}」</>
                    ) : e.kind === 'delete' ? (
                      <>－ 删掉「{e.from}」</>
                    ) : (
                      <>
                        <span className="line-through opacity-60">{e.from}</span>
                        <span className="mx-1">→</span>
                        <span className="text-inkleaf-300">{e.to}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 字数进度：极细一条，不打扰 */}
        <div className="mt-3 flex items-center gap-3 px-1">
          <div className="h-[3px] flex-1 overflow-hidden rounded-pill bg-white/[0.08]">
            <div
              className={`h-full rounded-pill transition-[width] duration-500 ${
                reached ? 'bg-amber-leaf-300' : 'bg-inkleaf-300'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span
            className={`tnum shrink-0 text-2xs font-semibold ${
              reached ? 'text-amber-leaf-200' : 'text-[var(--color-night-text-3)]'
            }`}
          >
            {words} / {target} 字
          </span>
        </div>
      </div>

      {/* 语音写作台 */}
      <div className="shrink-0 px-4 pb-6 pb-safe">
        <VoiceComposer
          text={work.text}
          utterances={work.utterances}
          edits={work.edits}
          minWords={prompt.wordRange[0]}
          ink
          transcribe={transcribe}
          ai={ai}
          onChange={onChange}
        />

        {busyText ? (
          <LoadingLine text={busyText} ink />
        ) : (
          <button
            type="button"
            disabled={words === 0}
            onClick={onSubmit}
            className="btn-base active:btn-press mt-3 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn bg-inkleaf-600 font-display text-base font-bold text-white shadow-[0_8px_24px_-10px_rgb(9_71_46/0.65)] disabled:opacity-35"
          >
            <IconCheck size={19} strokeWidth={2.2} />
            写好了，让树看看
          </button>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   小件
   ============================================================ */

function RewardTile({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode
  value: string
  label: string
  tone: 'amber'
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      <span className={tone === 'amber' ? 'text-amber-leaf-500' : 'text-ink-500'}>{icon}</span>
      <span className="tnum font-display text-lg font-bold leading-none text-ink-900">
        {value}
      </span>
      <span className="text-2xs text-ink-500">{label}</span>
    </div>
  )
}

/**
 * 类别图形。
 * 用形状区分而不是 emoji —— emoji 在不同设备上完全不一样，
 * 而且大小、基线都不可控，拼在一起就是"土"的来源。
 */
export function CategoryGlyph({
  category,
  size = 19,
}: {
  category: CompositionCategory
  size?: number
}) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (category) {
    case 'scene': // 山 + 日
      return (
        <svg {...common}>
          <circle cx="17" cy="7" r="2.6" />
          <path d="M3 18.5l5-7 4 5.2 2.4-2.6 3.6 4.4" />
          <path d="M3 21h18" />
        </svg>
      )
    case 'person': // 人像
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.6" />
          <path d="M5 20.5c0-3.6 3.1-6 7-6s7 2.4 7 6" />
        </svg>
      )
    case 'event': // 脚印 / 时间
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.2" />
          <path d="M12 7.5V12l3 1.8" />
        </svg>
      )
    case 'object': // 礼物盒
      return (
        <svg {...common}>
          <path d="M4 10.5h16v9.5H4z" />
          <path d="M3 7.2h18v3.3H3z" />
          <path d="M12 7.2v12.8" />
          <path d="M12 7.2S10.6 3.6 8.6 3.6a2 2 0 0 0 0 3.6M12 7.2s1.4-3.6 3.4-3.6a2 2 0 0 1 0 3.6" />
        </svg>
      )
    case 'imagine': // 星星 / 魔法
      return (
        <svg {...common}>
          <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.5l5.1-1.9z" />
          <path d="M18.5 17l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
        </svg>
      )
  }
}

/* ============================================================
   收藏按钮 —— 收藏了才会进「我的作文本」
   ============================================================ */

/**
 * 列表内联收藏按钮 —— 放在「写过的作文」每条右侧，点一下切换收藏状态。
 */
function FavoriteWorkInlineButton({ work }: { work?: Work }) {
  const toggleWorkFavorite = useApp((s) => s.toggleWorkFavorite)
  if (!work) return null
  const on = Boolean(work.favorite)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        void toggleWorkFavorite(work.id)
      }}
      className="btn-base grid h-8 w-8 place-items-center rounded-full"
      aria-label={on ? '取消收藏' : '收藏'}
    >
      {on ? (
        <IconStarFilled size={16} className="text-amber-leaf-500" />
      ) : (
        <IconStar size={16} className="text-ink-300" />
      )}
    </button>
  )
}

/* ============================================================
   作文列表 Tab 切换 —— 「写过的作文」/「收藏的作文」
   ============================================================ */

function WorkListTabs({
  works,
  onSelect,
}: {
  works: Work[]
  onSelect: (w: Work) => void
}) {
  const [tab, setTab] = useState<'all' | 'favorite'>('all')
  const scored = works.filter((w) => w.score)
  const favorites = scored.filter((w) => w.favorite)
  const list = tab === 'favorite' ? favorites : scored

  return (
    <div className="pt-2">
      {/* Tab 头 */}
      <div className="mb-3 flex items-center gap-1 rounded-lg bg-ink-50 p-1">
        <button
          type="button"
          onClick={() => setTab('all')}
          className={`flex-1 rounded-md py-2 text-center text-2xs font-bold transition ${
            tab === 'all'
              ? 'bg-white text-ink-900 shadow-[var(--hair)]'
              : 'text-ink-400'
          }`}
        >
          写过的作文 ({scored.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('favorite')}
          className={`flex-1 rounded-md py-2 text-center text-2xs font-bold transition ${
            tab === 'favorite'
              ? 'bg-white text-ink-900 shadow-[var(--hair)]'
              : 'text-ink-400'
          }`}
        >
          收藏的作文 ({favorites.length})
        </button>
      </div>

      {/* 列表 */}
      <div className="space-y-2">
        {list.length === 0 ? (
          <p className="py-4 text-center text-2xs text-ink-400">
            {tab === 'favorite' ? '还没有收藏的作文 · 在点评页点星标就能收藏' : '还没有写过的作文'}
          </p>
        ) : (
          list.slice(0, 6).map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => onSelect(w)}
              className="btn-base active:btn-press flex w-full items-center gap-3 rounded-card bg-white px-3.5 py-3 text-left shadow-[var(--hair),var(--shadow-tier-1)]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-ink-50 text-ink-500">
                <CategoryGlyph category={w.category ?? 'event'} size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-sm font-semibold text-ink-900">
                  {w.title}
                </span>
                <span className="tnum block text-2xs text-ink-400">
                  {w.score?.total} 分 · {w.wordCount} 字
                </span>
              </span>
              <span className="flex items-center gap-2">
                <FavoriteWorkInlineButton work={w} />
                <Stars count={w.score?.stars ?? 0} size="sm" />
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

/* ============================================================
   题库选择器
   ============================================================ */

function LibraryPicker({
  open,
  onClose,
  items,
  grade,
  category,
  onPick,
}: {
  open: boolean
  onClose: () => void
  items: LibraryItem[]
  grade: GradeLevel
  category: CompositionCategory | null
  onPick: (item: LibraryItem) => void
}) {
  const [keyword, setKeyword] = useState('')
  const [catFilter, setCatFilter] = useState<CompositionCategory | null>(category)

  const results = useMemo(
    () =>
      searchLibrary(items, {
        keyword,
        category: catFilter ?? undefined,
        grade,
        sort: 'recent',
      }),
    [items, keyword, catFilter, grade],
  )

  const rollRandom = () => {
    const pick = randomFromLibrary(items, { grade, category: catFilter ?? undefined })
    if (pick) onPick(pick)
  }

  return (
    <Sheet open={open} onClose={onClose} title="从题库里挑一道">
      {items.length === 0 ? (
        <EmptyState
          icon={<IconFolder size={26} />}
          title="题库还是空的"
          desc="先出一道新题，生成出来的题目会自动存进题库，以后就能在这里挑啦"
        />
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
                <IconSearch size={16} />
              </span>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜题目，比如「春天」「妈妈」"
                className="w-full rounded-md bg-ink-50 py-2.5 pl-9 pr-3 text-sm shadow-[var(--hair)] outline-none focus:shadow-[var(--hair-leaf)]"
              />
            </div>
            <Button tone="quiet" onClick={rollRandom} ariaLabel="随机抽题" icon={<IconDice size={17} />}>
              随机
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Chip active={catFilter === null} onClick={() => setCatFilter(null)}>
              全部
            </Chip>
            {CATEGORIES.map((c) => (
              <Chip
                key={c.key}
                active={catFilter === c.key}
                onClick={() => setCatFilter(catFilter === c.key ? null : c.key)}
              >
                {c.label}
              </Chip>
            ))}
          </div>

          {results.length === 0 ? (
            <EmptyState
              icon={<IconSearch size={26} />}
              title="没找到合适的题"
              desc="换个词试试，或者点「随机」"
            />
          ) : (
            <div className="space-y-2">
              {results.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => onPick(it)}
                  className="btn-base active:btn-press flex w-full items-center gap-3 rounded-card bg-white px-3 py-2.5 text-left shadow-[var(--hair),var(--shadow-tier-1)]"
                >
                  <span className="block h-12 w-16 shrink-0 overflow-hidden rounded-sm shadow-[var(--hair)]">
                    {/* 没配图的题也给一张默认场景，缩略图不至于开天窗 */}
                    <PromptImageArt image={it.images[0] ?? { sceneKey: 'spring-park' }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-sm font-semibold text-ink-900">
                      {it.favorite && '★ '}
                      {it.title}
                    </span>
                    <span className="block truncate text-2xs text-ink-500">{it.lead}</span>
                    <span className="tnum mt-0.5 block text-2xs text-ink-400">
                      {categoryMeta(it.category).label} · {it.minGrade}-{it.maxGrade} 年级 · 用过{' '}
                      {it.timesUsed} 次
                    </span>
                  </span>
                  <IconArrowRight size={16} className="shrink-0 text-ink-300" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
