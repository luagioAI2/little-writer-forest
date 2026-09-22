/* ============================================================
   新手引导 —— 种完树之后的那几屏
   ============================================================

   为什么要有它：
     `Onboarding` 只**收集设置**（昵称 / 年级 / 目标），一个字都没教。
     于是孩子种完树、拿到一个空白首页，得自己猜「这个 App 是干嘛的、
     我该按哪儿」。而这 App 的核心手势只有一个 —— **按住说话** ——
     偏偏它是最不容易被发现的：孩子会去点那个麦克风，点一下没反应，
     就以为坏了。（配好转写时点一下确实什么都不会发生，得按住。）

   ⚠️ 但"按住"**不是唯一的手势**：转写没配好 / 在网页上跑时，
     `VoiceComposer` 那个按钮是「点一下开始、再点一下停」。
     所以第二屏的手势是**跟着 `canHoldToTalk()` 走**的，不是写死的 ——
     教错手势等于把孩子送回"以为坏了"的老路，而这一屏存在的理由就是救他出来。
     判定函数只有一份，在 platform/transcribe.ts。

   所以这一节的**第一目标不是"介绍功能"，是"让他把手势做一遍"**。
   四屏，每屏只讲一件事：

     ① 我是你的树 —— 你写一篇，我长高一点（讲清核心循环）
     ② 你不用会打字 —— **可以真的试一次**（唯一需要学的手势）
     ③ 写完了会看到什么 —— 点评 / 更好的写法，以及那条铁律
     ④ 森林里还有这些 —— 底部五个入口各一句话

   几条设计约束（都是踩过的）：
     · **不调麦克风。** 这一屏的语音演示是**纯脚本**的，不碰 getUserMedia。
       引导里弹权限框是最糟的时机 —— 孩子还不知道这 App 是干嘛的，
       拒绝一次就再也不给了。而且 WebView 里没有权限时录音会静默失败。
     · **状态槽高度写死。** 和 VoiceComposer 一样（见那里的注释）：
       按住时里面会换成波形，如果高度由内容决定，按钮会被顶走 ——
       而按钮正在手指底下。这是真机上最难查的一类问题。
     · **跳过永远可用。** 不靠"必须走完"来保证阅读率。
       想再看一遍：设置 → 新手引导。
     · 文案不许和别处打架。AI 的边界统一说成
       「我帮你看，但不替你写」（与设置页、点评页同一口径）。
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, IconButton } from '../../components/ui'
import {
  IconArrowRight,
  IconBook,
  IconCards,
  IconCheck,
  IconCompass,
  IconLeaf,
  IconMic,
  IconPen,
  IconSparkle,
  IconStop,
} from '../../components/icons'
import { Sprout } from '../../components/Sprout'
import { MiniTree } from '../../components/TreeArt'
import { playSound } from '../../platform/sound'

/** 一共几屏 —— 进度点和「跳过」的判据都用它，别在别处再写一遍数字 */
export const GUIDE_SCREENS = 4

/**
 * 按多久才算「说了一句」。
 *
 * 和真实录音那条路的判据**同源**：按住太短 → 提示「按住多说几个字试试」。
 * 引导里用同一个数字、同一句文案，孩子到了真的写作页才不会觉得两套规矩。
 */
export const HOLD_OK_MS = 800

/**
 * 演示用的那句话。
 *
 * 刻意是**有画面的短句**，而且带一个具体名物（伞）和一个拟声（咚咚咚）——
 * 孩子能立刻看出"这是作文"，而不是一段占位文字。
 */
export const DEMO_SENTENCE =
  '下雨了。我和小明在操场上跑，雨点打在伞上，咚咚咚的，像有人在敲小鼓。'

/* ============================================================
   主组件
   ============================================================ */

export default function Guide({
  onDone,
  /**
   * 这台设备上能不能「按住说话」。
   *
   * ★ 由外面算好传进来（App 里 `canHoldToTalk(settings.transcribe)`），
   *   不在这里各判一次 —— 见 platform/transcribe.ts 那段说明。
   *   默认 true：APK 的默认配置就是流式，按住说话开箱即用。
   */
  canHold = true,
}: {
  onDone: () => void
  canHold?: boolean
}) {
  const [screen, setScreen] = useState(0)

  const isLast = screen === GUIDE_SCREENS - 1

  function next() {
    playSound('tap')
    if (isLast) {
      onDone()
      return
    }
    setScreen((s) => s + 1)
  }

  function skip() {
    playSound('tap-soft')
    onDone()
  }

  return (
    <div className="scene-ink relative flex min-h-screen flex-col">
      {/* 夜色里的两团远光 —— 和 Onboarding 是同一套，两边接得上 */}
      <span className="pointer-events-none absolute -top-20 left-1/4 h-64 w-64 rounded-full bg-inkleaf-400/[0.14] blur-3xl" />
      <span className="pointer-events-none absolute bottom-0 right-0 h-56 w-56 rounded-full bg-amber-leaf-400/[0.09] blur-3xl" />

      {/* ---------------- 顶栏：进度 + 跳过 ---------------- */}
      <div className="relative flex items-center gap-3 px-6 py-5 pt-safe">
        {screen > 0 ? (
          <IconButton
            tone="ink"
            size={36}
            ariaLabel="上一步"
            onClick={() => {
              playSound('tap-soft')
              setScreen((s) => s - 1)
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
          {Array.from({ length: GUIDE_SCREENS }, (_, i) => (
            <span
              key={i}
              className={`h-1 rounded-pill transition-all duration-400 ${
                i <= screen ? 'w-7 bg-inkleaf-300' : 'w-3 bg-white/15'
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={skip}
          className="min-h-[36px] shrink-0 rounded-md px-2 text-xs font-semibold text-[var(--color-night-text-3)]"
        >
          跳过
        </button>
      </div>

      {/* ---------------- 主体 ----------------
          `key={screen}` 的唯一作用是**换屏时重新挂载**，让进场动画重播一次
          （jsdom 里看不出动画，所以用例只能断言"节点换了新的"）。

          ⚠️ 别把它当成"演示状态不会串到下一屏"的保证 —— 那是下面
             `{screen === 1 && <ScreenVoice />}` 这个条件渲染在做的事：
             `screen` 一变，组件就被卸载了，`key` 有没有都一样。
             曾经在这里写过反了，变异验证时才发现（去掉 key 那条用例照样绿）。 */}
      <div key={screen} className="relative flex flex-1 flex-col px-7 pb-8 anim-rise-in">
        {screen === 0 && <ScreenTree />}
        {screen === 1 && <ScreenVoice canHold={canHold} />}
        {screen === 2 && <ScreenAfter />}
        {screen === 3 && <ScreenTabs />}
      </div>

      {/* ---------------- 底部动作 ---------------- */}
      <div className="relative px-7 pb-8 pb-safe">
        <button
          type="button"
          onClick={next}
          className="btn-base active:btn-press flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn bg-inkleaf-600 font-display text-base font-bold text-white shadow-[0_8px_24px_-10px_rgb(9_71_46/0.6)]"
        >
          {isLast ? (
            <>
              <IconCheck size={19} strokeWidth={2.2} />
              开始写第一篇
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
   ① 我是你的树 —— 核心循环
   ============================================================ */

function ScreenTree() {
  return (
    <>
      <Sprout size={96} ink />

      <h1 className="mt-8 font-display text-2xl font-bold leading-snug tracking-tight text-[var(--color-night-text)]">
        我是你的树。
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-night-text-2)]">
        你每写一篇，我就长高一点。
      </p>

      {/* 成长三格：用的是**真实的**成长树画（TreeArt）——
          孩子等一下在「成长树」页看到的就是这几棵，
          所以这一屏不是"示意图"，是预告。不新增任何图片资源。
          ⚠️ 第三格必须是**真正的最后一段**（stage 11 通天神树），不能随手挑一棵大的：
          箭头是「→→」的递进，最后一格会被读成"长到头的样子"，
          而底下那行字写的是"一直长到通天神树" —— 两处对不上就是这屏在说谎。
          最初写的是 stage 9 星辰树（名字对、段位错），截图走查时才发现。 */}
      <div className="mt-9 flex items-end justify-between gap-2">
        {[
          { stage: 0, size: 48, label: '灵芽树' },
          { stage: 4, size: 60, label: '苍梧树' },
          { stage: 11, size: 74, label: '通天神树' },
        ].map((s, i) => (
          <div key={s.label} className="flex flex-1 items-end gap-1.5">
            <div className="flex flex-1 flex-col items-center gap-2">
              <MiniTree stage={s.stage} size={s.size} />
              <span className="text-2xs font-semibold text-[var(--color-night-text-3)]">
                {s.label}
              </span>
            </div>
            {i < 2 && (
              <span className="pb-8 text-[var(--color-night-text-3)]" aria-hidden>
                <IconArrowRight size={14} />
              </span>
            )}
          </div>
        ))}
      </div>

      <p className="mt-auto pt-10 text-2xs leading-relaxed text-[var(--color-night-text-3)]">
        一共 12 段，从灵芽树一直长到通天神树。今天不想写也没关系 ——
        树长得慢，可它一直在长。
      </p>
    </>
  )
}

/* ============================================================
   ② 你不用会打字 —— ★ 这一屏要能真的按住
   ============================================================ */

function ScreenVoice({ canHold }: { canHold: boolean }) {
  return (
    <>
      <Sprout size={80} ink mood="curious" />

      <h1 className="mt-7 font-display text-2xl font-bold leading-snug tracking-tight text-[var(--color-night-text)]">
        你不用会打字。
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-night-text-2)]">
        {canHold
          ? '按住下面的按钮，把看到的、想到的说出来 —— 就像发微信语音那样。'
          : '点一下下面的按钮开始说，说完了再点一下。把看到的、想到的说出来。'}
      </p>

      <div className="mt-7">
        <HoldToTalkDemo canHold={canHold} />
      </div>
    </>
  )
}

/**
 * 试一次的演示。★ 纯脚本，不碰麦克风（见文件头）。
 *
 * 手势跟着 `canHold` 走，两套都要真的能做出来：
 *   · canHold  —— 按住开始、松手结束（和真实录音按钮同一套 pointer 事件）
 *   · 否则     —— 点一下开始、再点一下结束
 * 只做按住那套的话，转写没配好的设备上孩子照着按，界面毫无反应。
 */
function HoldToTalkDemo({ canHold }: { canHold: boolean }) {
  const [holding, setHolding] = useState(false)
  const [typed, setTyped] = useState(0)
  const [tooShort, setTooShort] = useState(false)

  /** 用 ref 而不是 state 判"正在按住" —— pointerup 里读到的是闭包里的旧值 */
  const holdRef = useRef(false)
  const startRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  const stopTyping = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // 翻页 / 卸载时把定时器收掉，别让它在别的屏上继续改 state
  useEffect(() => stopTyping, [stopTyping])

  function begin() {
    stopTyping()
    holdRef.current = true
    startRef.current = Date.now()
    setTooShort(false)
    setTyped(0)
    setHolding(true)
    playSound('tap-soft')
  }

  function end() {
    if (!holdRef.current) return
    holdRef.current = false
    setHolding(false)

    // 太短 = 没听到 —— 和真实录音那条路同一句文案。
    // ⚠️ 只有「按住」那套才有"太短"这回事：点击那套是明确的两下，
    //    不存在误触，所以那里不该拿时长去挡孩子。
    if (canHold && Date.now() - startRef.current < HOLD_OK_MS) {
      setTooShort(true)
      return
    }

    playSound('success')
    // 逐字落进正文：让"我说的字变成了字"这件事看得见
    let i = 0
    timerRef.current = window.setInterval(() => {
      i += 1
      setTyped(i)
      if (i >= DEMO_SENTENCE.length) stopTyping()
    }, 45)
  }

  const shown = DEMO_SENTENCE.slice(0, typed)
  const finished = typed >= DEMO_SENTENCE.length

  return (
    <div className="flex flex-col gap-3">
      {/* 正文框 —— 高度固定，字一个个长出来时不会把下面的按钮顶走 */}
      <div className="flex h-28 items-start rounded-md bg-black/25 p-4 shadow-[var(--hair-light)]">
        {shown ? (
          <p className="font-prose text-sm leading-loose text-[var(--color-night-text)]">
            {shown}
            {!finished && <span className="anim-breathe">▍</span>}
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-[var(--color-night-text-3)]">
            你说的字，会一个一个出现在这里。
          </p>
        )}
      </div>

      {/* ★ 状态槽：高度写死（h-12）。按住时这里换成波形 ——
          如果高度跟着内容变，按钮就会被顶走，而手指正按在上面。
          这是 VoiceComposer 里踩过的同一个坑，这里照抄那份约束。 */}
      <div className="flex h-12 w-full items-center justify-center">
        {holding ? (
          <div className="flex h-full w-full items-center gap-3.5 rounded-md bg-white/[0.06] px-4 shadow-[var(--hair-light)]">
            <Waveform />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-night-text-2)]">
              我在听……
            </span>
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#e8b3a6] anim-breathe" />
          </div>
        ) : tooShort ? (
          <span className="text-xs font-semibold text-[#e8b3a6]">
            按住多说几个字试试
          </span>
        ) : finished ? (
          <span className="text-xs font-semibold text-inkleaf-200">
            {canHold ? '松手，字就落进正文了' : '说完了，字就落进正文了'}
          </span>
        ) : (
          <span className="text-xs font-semibold text-[var(--color-night-text-3)]">
            {canHold ? '按住说话吧' : '点一下，开始说'}
          </span>
        )}
      </div>

      {/* 大圆按钮 —— 尺寸和真实那个（VoiceComposer 的 84px）对齐，
          孩子到写作页看到的是同一个东西 */}
      <div className="flex justify-center">
        <button
          type="button"
          aria-label={canHold ? '按住说话（试一下）' : '点一下开始说（试一下）'}
          onPointerDown={
            canHold
              ? (e) => {
                  // 抓住指针：手指滑出按钮外再松开，也能收到 pointerup
                  e.currentTarget.setPointerCapture?.(e.pointerId)
                  begin()
                }
              : undefined
          }
          onPointerUp={canHold ? end : undefined}
          onPointerCancel={canHold ? end : undefined}
          /* 点击那套：一下开始、再一下结束。这里读 `holding` 是安全的 ——
             两次点击是两个独立的事件轮次，第二次渲染时它已经更新了。 */
          onClick={canHold ? undefined : () => (holding ? end() : begin())}
          className={`select-none touch-none grid h-[84px] w-[84px] place-items-center rounded-full transition-transform duration-150 ${
            holding
              ? 'scale-95 bg-inkleaf-300 text-inkleaf-900'
              : 'bg-inkleaf-600 text-white shadow-[0_10px_26px_-10px_rgb(9_71_46/0.8)]'
          }`}
        >
          {holding ? <IconStop size={28} /> : <IconMic size={30} strokeWidth={1.8} />}
        </button>
      </div>

      {/* 落完字之后的"下一步" —— 顺带把语音改作文也教了 */}
      {finished && (
        <p className="text-center text-2xs leading-relaxed text-[var(--color-night-text-3)] anim-fade-in">
          说错了也不用删 —— 再说一句「把下雨改成下雪」，
          <br />
          我就只改那两个字，别的一个都不动。
        </p>
      )}
    </div>
  )
}

/** 演示用波形 —— 不接真实音量，只是让"在听"看得见 */
function Waveform() {
  const bars = 7
  return (
    <span className="flex h-7 shrink-0 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        // 中间的条更高，形成对称的波形观感（和 VoiceComposer 一致）
        const center = Math.abs(i - (bars - 1) / 2)
        const factor = 1 - center / bars
        return (
          <span
            key={i}
            className="w-[3px] rounded-pill bg-inkleaf-300 anim-breathe"
            style={{
              height: `${Math.round(8 + 18 * factor)}px`,
              animationDelay: `${i * 0.09}s`,
            }}
          />
        )
      })}
    </span>
  )
}

/* ============================================================
   ③ 写完了会看到什么 —— 点评 / 更好的写法 / 那条铁律
   ============================================================ */

function ScreenAfter() {
  return (
    <>
      <Sprout size={80} ink />

      <h1 className="mt-7 font-display text-2xl font-bold leading-snug tracking-tight text-[var(--color-night-text)]">
        写完了，我给你两样东西。
      </h1>

      <div className="mt-7 space-y-3">
        {[
          {
            icon: <IconSparkle size={18} />,
            title: '点评',
            desc: '你哪里写得好，哪里还能更好。分数只是个参考。',
          },
          {
            icon: <IconPen size={18} />,
            title: '更好的写法',
            desc: '同样的内容，换一种写法给你看 —— 读读就好，不用抄。',
          },
        ].map((r) => (
          <Card key={r.title} className="!rounded-panel">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-inkleaf-50 text-inkleaf-600">
                {r.icon}
              </span>
              <div className="min-w-0">
                <div className="font-display text-sm font-bold text-ink-900">{r.title}</div>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{r.desc}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* ★ 那条铁律。口径和设置页、点评页完全一致：帮你看，但不替你写。 */}
      <div className="mt-6 rounded-panel bg-white/[0.06] p-4 shadow-[var(--hair-light)]">
        <p className="text-sm font-semibold leading-relaxed text-[var(--color-night-text)]">
          我帮你看，但不替你写。
        </p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-night-text-2)]">
          你说「把竹签改成铅笔」，我就只动那几个字。
          作文里的每一句，都得是你自己说的。
        </p>
      </div>

      <p className="mt-auto pt-8 text-2xs leading-relaxed text-[var(--color-night-text-3)]">
        遇到喜欢的句子，还能照着背一遍 —— 背完有奖励。
      </p>
    </>
  )
}

/* ============================================================
   ④ 森林里还有这些 —— 底部五个入口
   ============================================================ */

const TAB_NOTES: { Icon: typeof IconPen; name: string; note: string }[] = [
  { Icon: IconPen, name: '写作文', note: '每天从这里开始' },
  // ⚠️ 树洞是**有门槛**的（HOLLOW_UNLOCK_LEVEL，第 4 段琼华树才打开，
  //    见 domain/hollow.ts）。不写这一句，孩子当天就会去日记本里找树洞，
  //    只看到「树洞还没打开」—— 引导说"随时可以去看看"，结果第一站就扑空。
  //    顺带这也是句盼头：再长高一点就开了。
  { Icon: IconBook, name: '日记本', note: '不想给别人看的话，可以丢进树洞 —— 树长大一点它才打开' },
  { Icon: IconLeaf, name: '成长树', note: '看看我长到哪儿了' },
  { Icon: IconCards, name: '文心卡', note: '树上会结卡，金币也能开卡包' },
  { Icon: IconCompass, name: '旅行图', note: '派一只小鸟飞出去，它会带回照片' },
]

function ScreenTabs() {
  return (
    <>
      <Sprout size={72} ink />

      <h1 className="mt-6 font-display text-2xl font-bold leading-snug tracking-tight text-[var(--color-night-text)]">
        森林里还有这些。
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-night-text-2)]">
        都在最下面那一排，随时可以去看看。
      </p>

      <div className="mt-7 space-y-2.5">
        {TAB_NOTES.map((t) => (
          <div key={t.name} className="flex items-center gap-3.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white/[0.06] text-inkleaf-200 shadow-[var(--hair-light)]">
              <t.Icon size={18} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-bold text-[var(--color-night-text)]">{t.name}</div>
              <div className="text-2xs leading-relaxed text-[var(--color-night-text-3)]">
                {t.note}
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-auto pt-8 text-2xs leading-relaxed text-[var(--color-night-text-3)]">
        以后想再看一遍这一页：设置 → 新手引导。
      </p>
    </>
  )
}
