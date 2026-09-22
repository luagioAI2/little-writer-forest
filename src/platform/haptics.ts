/* ============================================================
   震动反馈
   ============================================================ */

let enabled = true

export function setHapticsEnabled(on: boolean): void {
  enabled = on
}

/** 短促轻震 —— 点击、切页 */
export function tapFeedback(): void {
  if (!enabled) return
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(12)
    } catch {
      /* 不支持就忽略 */
    }
  }
}

/** 成功震动 —— 两下短震 */
export function successFeedback(): void {
  if (!enabled) return
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([18, 60, 28])
    } catch {
      /* 忽略 */
    }
  }
}

/** 重震动 —— 升段、传说卡 */
export function celebrateFeedback(): void {
  if (!enabled) return
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([30, 50, 30, 50, 60])
    } catch {
      /* 忽略 */
    }
  }
}

/** 出错震动 */
export function errorFeedback(): void {
  if (!enabled) return
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([40, 40, 40])
    } catch {
      /* 忽略 */
    }
  }
}
