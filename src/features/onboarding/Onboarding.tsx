/* ============================================================
   首次引导 —— 「种下你的树」
   ============================================================

   为什么要有这一屏（而不是把年级塞在写作文首页）：
     年级是**一次性设定**，孩子整个小学阶段大概率只改一两次。
     把它放在首页，等于用一个几乎永不使用的选择器占掉第一屏 ——
     用户的原话是"占的版面太多了（操作可能就一次）"。
     搬到这里，只问一次，之后在设置里随时能改。

   三步，每步只问一件事：
     ① 你叫什么（一个输入框，可以跳过）
     ② 你几年级（决定出题难度与评分尺度）
     ③ 许个愿（每日目标），然后把树苗种下去

   视觉：全程墨夜场景。
   第一次打开 App 就是一片安静的夜色 + 一棵刚种下的小树，
   比"欢迎使用"的弹窗更像一个故事的开始。
   ============================================================ */

import { useMemo, useState } from 'react'
import { DEFAULT_CHILD_NAME, GRADE_GROUPS, gradeLabel, type GradeLevel } from '../../domain/types'
import { Card, IconButton } from '../../components/ui'
import { IconArrowRight, IconCheck, IconLeaf } from '../../components/icons'
import { playSound } from '../../platform/sound'

type Step = 0 | 1 | 2

export default function Onboarding({
  onDone,
}: {
  onDone: (patch: { childName: string; grade: GradeLevel; dailyGoal: number }) => void
}) {
  const [step, setStep] = useState<Step>(0)
  const [name, setName] = useState('')
  const [grade, setGrade] = useState<GradeLevel>(3)
  const [goal, setGoal] = useState(1)

  /* 树苗随选择的年级长高一点 —— 一个小小的正反馈 */
  const sproutHeight = useMemo(() => 0.5 + Math.min(0.5, grade / 18), [grade])

  const canNext = step === 0 ? true : true

  function next() {
    playSound('tap')
    if (step < 2) setStep((s) => (s + 1) as Step)
  }

  function finish() {
    playSound('success')
    onDone({ childName: name.trim() || DEFAULT_CHILD_NAME, grade, dailyGoal: goal })
  }

  return (
    <div className="scene-ink relative flex min-h-screen flex-col">
      {/* 夜色里的两团远光 */}
      <span className="pointer-events-none absolute -top-20 left-1/4 h-64 w-64 rounded-full bg-inkleaf-400/[0.14] blur-3xl" />
      <span className="pointer-events-none absolute bottom-0 right-0 h-56 w-56 rounded-full bg-amber-leaf-400/[0.09] blur-3xl" />

      {/* 顶栏：进度 */}
      <div className="relative flex items-center gap-3 px-6 py-5 pt-safe">
        {step > 0 ? (
          <IconButton
            tone="ink"
            size={36}
            ariaLabel="上一步"
            onClick={() => {
              playSound('tap-soft')
              setStep((s) => (s - 1) as Step)
            }}
          >
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </IconButton>
        ) : (
          <span className="h-9 w-9" />
        )}

        <div className="flex flex-1 justify-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`h-1 rounded-pill transition-all duration-400 ${
                i <= step ? 'w-7 bg-inkleaf-300' : 'w-3 bg-white/15'
              }`}
            />
          ))}
        </div>
        <span className="w-9" />
      </div>

      {/* 主体 */}
      <div className="relative flex flex-1 flex-col px-7 pb-8">
        {/* ---------- 第一步：名字 ---------- */}
        {step === 0 && (
          <div className="flex flex-1 flex-col anim-rise-in">
            <Sprout size={92} height={0.55} />

            <h1 className="mt-8 font-display text-2xl font-bold leading-snug tracking-tight text-[var(--color-night-text)]">
              我们先种一棵树吧。
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-night-text-2)]">
              你写下的每一篇作文，都会让它长高一点。
            </p>

            <div className="mt-9">
              <label className="mb-2.5 block text-xs font-semibold tracking-wide text-[var(--color-night-text-3)]">
                我该怎么叫你？
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={DEFAULT_CHILD_NAME}
                maxLength={8}
                className="w-full rounded-md bg-black/25 px-4 py-3.5 font-display text-lg font-semibold text-[var(--color-night-text)] shadow-[var(--hair-light)] outline-none placeholder:text-[var(--color-night-text-3)] focus:shadow-[var(--hair-light-strong)]"
              />
              <p className="mt-2.5 text-2xs text-[var(--color-night-text-3)]">
                不填也行，那就先叫「{DEFAULT_CHILD_NAME}」。
              </p>
            </div>
          </div>
        )}

        {/* ---------- 第二步：年级 ---------- */}
        {step === 1 && (
          <div className="flex flex-1 flex-col anim-rise-in">
            <Sprout size={92} height={sproutHeight} />

            <h1 className="mt-8 font-display text-2xl font-bold leading-snug tracking-tight text-[var(--color-night-text)]">
              你上几年级？
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-night-text-2)]">
              我会按这个年级给你出题、评分。
              <br />
              <span className="text-[var(--color-night-text-3)]">
                只问这一次，以后在「设置」里可以随时改。
              </span>
            </p>

            <div className="mt-8 space-y-4">
              {GRADE_GROUPS.map((g) => (
                <div key={g.key}>
                  <div className="mb-2 text-2xs font-semibold tracking-wide text-[var(--color-night-text-3)]">
                    {g.label}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {g.grades.map((gi) => {
                      const on = grade === gi
                      return (
                        <button
                          key={gi}
                          type="button"
                          onClick={() => {
                            playSound('tap-soft')
                            setGrade(gi)
                          }}
                          className={`btn-base active:btn-press min-h-[46px] rounded-md px-4 text-sm font-semibold ${
                            on
                              ? 'bg-inkleaf-300/25 text-inkleaf-100 shadow-[var(--hair-light-strong)]'
                              : 'bg-white/[0.05] text-[var(--color-night-text-2)] shadow-[var(--hair-light)]'
                          }`}
                        >
                          {gradeLabel(gi)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---------- 第三步：许愿 + 种树 ---------- */}
        {step === 2 && (
          <div className="flex flex-1 flex-col anim-rise-in">
            <div className="flex justify-center">
              <div className="relative">
                <Sprout size={120} height={sproutHeight} />
                <span className="pointer-events-none absolute inset-0 rounded-full bg-inkleaf-400/10 blur-2xl" />
              </div>
            </div>

            <h1 className="mt-8 text-center font-display text-2xl font-bold leading-snug tracking-tight text-[var(--color-night-text)]">
              每天写几篇？
            </h1>
            <p className="mt-3 text-center text-sm leading-relaxed text-[var(--color-night-text-2)]">
              定个小目标就好，达不达成没关系。
            </p>

            <div className="mt-8 flex justify-center gap-2.5">
              {[1, 2, 3].map((n) => {
                const on = goal === n
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      playSound('tap-soft')
                      setGoal(n)
                    }}
                    className={`btn-base active:btn-press flex min-h-[76px] w-24 flex-col items-center justify-center gap-0.5 rounded-lg ${
                      on
                        ? 'bg-amber-leaf-300/22 shadow-[var(--hair-light-strong)]'
                        : 'bg-white/[0.05] shadow-[var(--hair-light)]'
                    }`}
                  >
                    <span
                      className={`tnum font-display text-3xl font-bold leading-none ${
                        on ? 'text-amber-leaf-200' : 'text-[var(--color-night-text-2)]'
                      }`}
                    >
                      {n}
                    </span>
                    <span className="text-2xs text-[var(--color-night-text-3)]">篇 / 天</span>
                  </button>
                )
              })}
            </div>

            <div className="mt-auto pt-10">
              <Card className="!rounded-panel">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-inkleaf-50 text-inkleaf-600">
                    <IconLeaf size={15} />
                  </span>
                  <p className="font-prose text-sm leading-loose text-ink-700">
                    「种一棵树最好的时候是十年前，
                    <br />
                    其次是现在。」
                  </p>
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>

      {/* 底部动作 */}
      <div className="relative px-7 pb-8 pb-safe">
        <button
          type="button"
          disabled={!canNext}
          onClick={step === 2 ? finish : next}
          className="btn-base active:btn-press flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn bg-inkleaf-600 font-display text-base font-bold text-white shadow-[0_8px_24px_-10px_rgb(9_71_46/0.6)] disabled:opacity-40"
        >
          {step === 2 ? (
            <>
              <IconCheck size={19} strokeWidth={2.2} />
              种下我的树
            </>
          ) : (
            <>
              继续
              <IconArrowRight size={19} />
            </>
          )}
        </button>
      </div>
    </div>
  )
}

/* ============================================================
   程序化树苗 —— 随参数长高（零图片资源）
   ============================================================ */

function Sprout({ size, height }: { size: number; height: number }) {
  // height 0.5 → 刚冒头；1 → 小苗
  const h = Math.max(0.35, Math.min(1, height))
  const trunkTop = 108 - 34 * h
  const leafSpread = 12 + 8 * h

  return (
    <div className="flex justify-center pt-4">
      <svg width={size} height={size} viewBox="0 0 128 128" className="anim-sway" aria-hidden>
        <ellipse cx="64" cy="110" rx="34" ry="7" fill="#10a368" opacity="0.18" />
        <ellipse cx="64" cy="110" rx="22" ry="5" fill="#10a368" opacity="0.14" />

        {/* 主干 */}
        <path
          d={`M64 110 Q64 ${(110 + trunkTop) / 2} 64 ${trunkTop}`}
          stroke="#29ce89"
          strokeWidth={3.5}
          strokeLinecap="round"
          fill="none"
        />

        {/* 两片侧叶 */}
        {h > 0.55 && (
          <>
            <ellipse
              cx={64 - leafSpread}
              cy={trunkTop + 12}
              rx={13 + 3 * h}
              ry={6.5}
              fill="#10a368"
              transform={`rotate(-26 ${64 - leafSpread} ${trunkTop + 12})`}
            />
            <ellipse
              cx={64 + leafSpread}
              cy={trunkTop + 7}
              rx={13 + 3 * h}
              ry={6.5}
              fill="#29ce89"
              transform={`rotate(26 ${64 + leafSpread} ${trunkTop + 7})`}
            />
          </>
        )}

        {/* 顶芽 */}
        <ellipse cx="64" cy={trunkTop - 5} rx={10 + 2 * h} ry={7} fill="#69dda7" />

        {/* 一点点光 */}
        <circle cx="98" cy="46" r="2.5" fill="#febb32" className="anim-sparkle" />
        <circle cx="30" cy="60" r="2" fill="#ffd374" className="anim-sparkle delay-2" />
      </svg>
    </div>
  )
}
