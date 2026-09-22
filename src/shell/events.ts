/* ============================================================
   外壳事件 —— 页面与 App 之间唯一的通讯通道
   ============================================================

   为什么单独放一个文件，而不是继续写在 App.tsx 里：

   这两个函数原本定义在 `App.tsx`，页面通过 `import ... from '../../App'`
   去用它们。于是形成了 **App → 页面 → App 的循环依赖**。

   循环依赖本身在打包后往往能侥幸跑通，但在开发环境（Vite HMR）下会
   让模块被反复重新求值，表现是**页面组件莫名其妙被重挂载、局部 state 丢失**。
   真实症状：在「写作文」里选好类别后，一打开/关闭题库抽屉，类别就被清空，
   两个按钮同时变灰，而且没有任何 loading 提示 —— 用户看到的就是
   「点了没反应」。

   把事件通道抽成独立的叶子模块（谁都不 import，只被 import），
   循环就断掉了。
   ============================================================ */

/** 顶层 Tab 的 key —— 与 App.tsx 的 TabKey 保持一致 */
export type ShellTabKey = 'compose' | 'diary' | 'level' | 'cards' | 'map'

const NAV_EVENT = 'little-writer:navigate'
const IMMERSIVE_ON = 'little-writer:immersive-on'
const IMMERSIVE_OFF = 'little-writer:immersive-off'

/** 跳到某个主页面（会顺带退出设置 / 题库 / 沉浸） */
export function navigateTo(tab: ShellTabKey): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ShellTabKey>(NAV_EVENT, { detail: tab }))
}

/**
 * 声明「我现在要安静」。
 *
 * 写法上是"声明式"的：页面在进入沉浸的那一步传 true，
 * 卸载或离开时传 false。App 收到就隐藏头部与底部导航。
 */
export function setImmersiveMode(on: boolean): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(on ? IMMERSIVE_ON : IMMERSIVE_OFF))
}

/* ---------------- 内部：给 App 订阅用 ---------------- */

export function onNavigate(handler: (tab: ShellTabKey) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<ShellTabKey>).detail)
  window.addEventListener(NAV_EVENT, listener)
  return () => window.removeEventListener(NAV_EVENT, listener)
}

export function onImmersiveChange(handler: (on: boolean) => void): () => void {
  const enter = () => handler(true)
  const exit = () => handler(false)
  window.addEventListener(IMMERSIVE_ON, enter)
  window.addEventListener(IMMERSIVE_OFF, exit)
  return () => {
    window.removeEventListener(IMMERSIVE_ON, enter)
    window.removeEventListener(IMMERSIVE_OFF, exit)
  }
}
