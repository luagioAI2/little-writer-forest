/* ============================================================
   数字密码：圆点指示器 + 键盘 + 整页关卡
   ============================================================
   2026-09-18 新建，原因：
     日记本和「家长验证」各写了一套密码界面，长得不一样 ——
     家长那套是 `max-w-xs`（320px）而且**没有卡片底**，浮在页面背景上，
     看起来又窄又别扭（家长原话：「现在的好像好窄 看起来别扭」）。

   所以把日记那套（家长认可的样子）抽到这里，两边共用一份。
   ★ 以后改密码界面只改这个文件 —— 不要再在页面里各写一份，
     那正是这次两边走样的原因。

   两处唯一该有差异的是**文案**和**底部那行小字**，
   所以 `PinGate` 只接文案，不接样式。

   键盘沿用手机拨号盘的肌肉记忆：
     左下留空、0 居中、右下是退格；满 4 位**自动提交**，不用按确定。
   （原来家长那套还有「清空 / 确定」两个键，跟自动提交重复了，
     已统一成日记这套。）
   ============================================================ */

import type { ReactNode } from 'react'
import { playSound } from '../platform/sound'
import { IconLock } from './icons'
import { Card } from './ui'

/** 4 个圆点：已输入的填实，出错时整排抖一下 */
export function PinDots({ filled, error }: { filled: number; error: boolean }) {
  return (
    <div className={`flex justify-center gap-3 ${error ? 'anim-shake' : ''}`}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-3.5 w-3.5 rounded-full transition ${
            i < filled ? 'bg-inkleaf-500 shadow-[var(--hair-leaf)]' : 'bg-ink-150'
          }`}
        />
      ))}
    </div>
  )
}

/** 数字键盘。满 4 位由调用方的 onKey 逻辑自动提交 */
export function PinKeypad({
  onKey,
  disabled,
}: {
  onKey: (k: string) => void
  disabled?: boolean
}) {
  // 空一格让 0 居中，符合手机拨号盘的肌肉记忆
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']
  return (
    <div className="mx-auto grid max-w-xs grid-cols-3 gap-2.5">
      {keys.map((k) => {
        if (k === '') return <span key="blank" />
        const isDel = k === 'del'
        return (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => {
              playSound('tap')
              onKey(k)
            }}
            aria-label={isDel ? '删除一位' : `数字 ${k}`}
            className="btn-base active:btn-press grid h-16 place-items-center rounded-card bg-white text-2xl font-bold text-ink-900 shadow-[var(--hair-strong)] disabled:opacity-40"
          >
            {isDel ? '⌫' : k}
          </button>
        )
      })}
    </div>
  )
}

/**
 * 整页密码关卡：居中卡片 + 圆锁图标 + 标题 + 提示 + 圆点 + 键盘 + 底部小字。
 *
 * ⚠️ 外面那层 `max-w-md`（448px）不能改回 `max-w-xs`（320px）——
 *    键盘本身就有 `max-w-xs`，外层再窄一圈会显得键盘被"挤"在中间，
 *    这就是当初家长那套看起来别扭的直接原因。
 */
export function PinGate({
  title,
  hint,
  filled,
  error,
  message,
  onKey,
  disabled,
  footer,
}: {
  title: string
  hint?: string
  filled: number
  error: boolean
  /** 出错时的红字（如「密码不对哦，再想想」） */
  message?: string
  onKey: (k: string) => void
  disabled?: boolean
  /** 底部那行小字（「忘记密码了？」/「先算了」） */
  footer?: ReactNode
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-5">
      <Card className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-inkleaf-50 text-inkleaf-600 shadow-[var(--hair-leaf)] anim-float">
          <IconLock size={24} />
        </div>
        <h1 className="mt-3 font-display text-xl font-bold text-ink-900">{title}</h1>
        {hint && <p className="mt-1 text-sm text-ink-500">{hint}</p>}
        <div className="my-5">
          <PinDots filled={filled} error={error} />
        </div>
        {message && <p className="mb-3 text-sm font-semibold text-danger">{message}</p>}
        <PinKeypad onKey={onKey} disabled={disabled} />
        {footer}
      </Card>
    </div>
  )
}

/** 底部小字链接的统一样式（「忘记密码了？」/「先算了」都用它） */
export const PIN_LINK_CLASS =
  'mt-4 text-xs font-semibold text-mist-600 underline decoration-dotted underline-offset-4'
