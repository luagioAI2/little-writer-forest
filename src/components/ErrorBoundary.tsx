/* ============================================================
   错误边界
   ============================================================
   低龄用户看到白屏会以为"坏了"。
   所以出错时也要给一句人话，并强调"你的东西都还在"。
   ============================================================ */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 切换时重置错误状态 */
  resetKey?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 保留到控制台，方便家长/开发者反馈问题
    console.error('[小笔苗] 页面出错了：', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="text-6xl">🛠️</div>
        <h2 className="font-display text-xl font-extrabold text-ink-900">
          这一页出了点小问题
        </h2>
        <p className="max-w-xs text-sm leading-relaxed text-ink-700">
          别担心，你写的作文、日记和卡片都好好存着，一点都没丢。
          切到别的页面再回来试试吧。
        </p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="btn-base btn-primary active:btn-press rounded-btn px-6 py-3 text-base font-bold"
        >
          再试一次
        </button>
        <details className="max-w-full">
          <summary className="cursor-pointer text-[11px] font-bold text-ink-300">
            给家长看的技术信息
          </summary>
          <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-ink-100 p-2 text-left text-[10px] leading-relaxed text-ink-700">
            {this.state.error.message}
          </pre>
        </details>
      </div>
    )
  }
}
