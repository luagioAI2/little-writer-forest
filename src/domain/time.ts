/* ============================================================
   时间工具 —— 逻辑日 / 日期键
   ============================================================ */

/** 一天从凌晨 4 点算起：孩子熬到 1 点写的日记，仍然算"昨天" */
export const DAY_START_HOUR = 4

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * 逻辑日键 yyyy-MM-dd。
 *
 * 把 0:00-3:59 归到前一天，避免"半夜写完算断签"这种挫伤积极性的事。
 */
export function dayKey(ts: number = Date.now(), dayStartHour = DAY_START_HOUR): string {
  const d = new Date(ts)
  if (d.getHours() < dayStartHour) {
    d.setDate(d.getDate() - 1)
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 解析日期键为 Date（当地 0 点） */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** 两个日期键相差几天（b - a） */
export function daysBetween(a: string, b: string): number {
  const da = parseDayKey(a).getTime()
  const db = parseDayKey(b).getTime()
  return Math.round((db - da) / 86_400_000)
}

/** 日期键加减天数 */
export function shiftDayKey(key: string, delta: number): string {
  const d = parseDayKey(key)
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 友好的日期显示 */
export function friendlyDay(key: string): string {
  const today = dayKey()
  const diff = daysBetween(key, today)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff === 2) return '前天'
  if (diff === -1) return '明天'
  const d = parseDayKey(key)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** 星期几 */
export function weekdayLabel(key: string): string {
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return names[parseDayKey(key).getDay()]
}

/** 当前时间段的问候语 */
export function greeting(ts: number = Date.now()): { text: string; emoji: string } {
  const h = new Date(ts).getHours()
  if (h < 6) return { text: '这么早就起来啦', emoji: '🌅' }
  if (h < 11) return { text: '早上好呀', emoji: '☀️' }
  if (h < 14) return { text: '中午好', emoji: '🍚' }
  if (h < 18) return { text: '下午好', emoji: '🌤️' }
  if (h < 22) return { text: '晚上好', emoji: '🌙' }
  return { text: '该睡觉啦', emoji: '😴' }
}

/** 时长格式化 mm:ss */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${pad(s)}`
}

/** 相对时间：刚刚 / 3 分钟前 / 昨天 */
export function timeAgo(ts: number, now: number = Date.now()): string {
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const days = Math.floor(diff / 86_400_000)
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  return friendlyDay(dayKey(ts))
}

/** 生成最近 n 天的日期键（含今天，从早到晚） */
export function recentDayKeys(n: number, now: number = Date.now()): string[] {
  const today = dayKey(now)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(shiftDayKey(today, -i))
  return out
}
