/* ============================================================
   新手引导 —— 种完树之后的那几屏
   ============================================================

   为什么要有它：
     `Onboarding` 只**收集设置**（昵称 / 年级 / 目标），一个字都没教。
     于是孩子种完树、拿到一个空白首页，得自己猜「这个 App 是干嘛的、
     我该按哪儿」。所以种完树之后补三屏，每屏只讲一件事：

     ① 我是你的树 —— 你写一篇，我长高一点（讲清核心循环）
     ② 写完了会看到什么 —— 点评 / 更好的写法，以及那条铁律
     ③ 森林里还有这些 —— 底部五个入口各一句话

   ★★ 2026-09-22 家长要求**删掉原来的第二屏「你不用会打字」**：
     「新手引导那 录音的指引 可以去掉。因为那时候用户还没有设置 火山模型。」

     那一屏原来有个**可以真的按一遍**的录音演示，而且被写成这一节的
     "第一目标"（孩子会去**点**那个麦克风，配好转写时点一下什么都不会发生，
      于是以为坏了）。删它是有代价的，所以把理由留在下面：

     · 那一屏教哪个手势（按住 / 点一下）是**跟着 `canHoldToTalk()` 走的**，
       而这个判定取决于**转写配没配好** —— 可引导跑在家长配好之前。
       于是引导教的那一套，和孩子之后在写作页遇到的**可能是两套**；
       而"教错手势"恰恰是那一屏本来要解决的问题（教错了 = 把孩子送回老路）。
     · 与其教一个"到时候不一定对"的手势，不如不教。

     ⚠️ 所以那类反馈（孩子点麦克风没反应 → 以为坏了）**可能回来**。
       要重新处理它，得先想清楚"在配好之前该教什么"，
       而**不是把那一屏原样加回来** —— 原样加回来 = 又教一个会错的手势。
     ⚠️ `canHoldToTalk()` 本身**没删**：写作页那个真按钮（`VoiceComposer`）
       仍然用它。那份判定只有一处，在 platform/transcribe.ts。

   几条设计约束：
     · **引导里绝不申请麦克风权限。** 那是最糟的时机 —— 孩子还不知道
       这 App 是干嘛的，拒绝一次就再也不给了；而 WebView 里没有权限时
       录音会**静默失败**。（原来那个演示是纯脚本、不碰 `getUserMedia`；
       现在连演示都没了，这条只剩"别把它加回来"这一层意思。）
     · **跳过永远可用。** 不靠"必须走完"来保证阅读率。
       想再看一遍：设置 → 新手引导。
     · 文案不许和别处打架。AI 的边界统一说成
       「我帮你看，但不替你写」（与设置页、点评页同一口径）。
   ============================================================ */

import { useState } from 'react'
import { Card, IconButton } from '../../components/ui'
import {
  IconArrowRight,
  IconBook,
  IconCards,
  IconCheck,
  IconCompass,
  IconLeaf,
  IconPen,
  IconSparkle,
} from '../../components/icons'
import { Sprout } from '../../components/Sprout'
import { MiniTree } from '../../components/TreeArt'
import { playSound } from '../../platform/sound'

/** 一共几屏 —— 进度点和「跳过」的判据都用它，别在别处再写一遍数字 */
export const GUIDE_SCREENS = 3

/* ★ 2026-09-22：这里原来还导出 `HOLD_OK_MS`（按多久算"说了一句"）和
   `DEMO_SENTENCE`（演示用的那句话），两者都只服务于被删掉的录音演示那一屏，
   跟着一起删了。
   ⚠️ 写作页那条路有**它自己的一份**时长门槛（在 `VoiceComposer` 里），
     没有 import 这两个常量，所以删它们**不影响**真实录音。 */

/* ============================================================
   主组件
   ============================================================ */

/* ★ 2026-09-22：原来这里还有一个 `canHold` 属性（`canHoldToTalk(settings.transcribe)`），
   只传给被删掉的录音演示那一屏用，所以一起删了 —— 引导现在不碰转写配置，
   也就没有"引导和写作页各判一次、判出两个结果"的可能了。 */
export default function Guide({ onDone }: { onDone: () => void }) {
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

          ⚠️ 别把它当成"上一屏的状态不会串到下一屏"的保证 —— 那是下面这些
             条件渲染在做的事：`screen` 一变，上一个组件就被卸载了，
             `key` 有没有都一样。曾经在这里写过反了，变异验证时才发现
             （去掉 key 那条用例照样绿）。 */}
      <div key={screen} className="relative flex flex-1 flex-col px-7 pb-8 anim-rise-in">
        {screen === 0 && <ScreenTree />}
        {screen === 1 && <ScreenAfter />}
        {screen === 2 && <ScreenTabs />}
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
   ★★ 原来的「② 你不用会打字」整屏（含可交互的录音演示）已于 2026-09-22 删除
   ------------------------------------------------------------
   家长原话：「新手引导那 录音的指引 可以去掉。因为那时候用户还没有设置 火山模型。」

   删掉的东西：`ScreenVoice`、`HoldToTalkDemo`（可以真的按一遍的演示）、
   `Waveform`（演示波形），以及 `HOLD_OK_MS` / `DEMO_SENTENCE` 两个常量
   和主组件上的 `canHold` 属性。

   为什么删（完整理由见文件头）：那一屏教哪个手势是跟着 `canHoldToTalk()` 走的，
   而它取决于转写配没配好 —— 引导却跑在家长配好之前，教的和之后遇到的可能是两套。
   与其教一个"到时候不一定对"的手势，不如不教。

   ⚠️ 别把这一屏"顺手加回来"。要处理"孩子点麦克风没反应 → 以为坏了"，
     得先想清楚**在配好之前该教什么**（见文件头），而不是原样恢复。
   ⚠️ `canHoldToTalk()` 没删 —— 写作页的 `VoiceComposer` 还在用它。
   ============================================================ */

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
