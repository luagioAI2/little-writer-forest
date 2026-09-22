/* ============================================================
   音效 —— WebAudio 实时合成
   ============================================================

   不加载任何音频文件：
     · 包体积小（APK 友好）
     · 完全离线可用
     · 不会有"音频加载失败"的 console 噪音

   所有音效都是几个振荡器 + 包络拼出来的，
   风格统一成"清脆的卡通音"。
   ============================================================ */

let ctx: AudioContext | null = null
let enabled = true

/** 拿到 AudioContext（懒创建，规避浏览器的自动播放限制） */
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    try {
      ctx = new Ctor()
    } catch {
      return null
    }
  }
  return ctx
}

export function setSoundEnabled(on: boolean): void {
  enabled = on
}

export function isSoundEnabled(): boolean {
  return enabled
}

/**
 * 在首次用户手势时调用，解锁音频。
 * iOS / 部分安卓浏览器要求音频必须由用户操作触发。
 */
export function unlockAudio(): void {
  const c = getCtx()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
}

interface ToneOptions {
  freq: number
  duration: number
  type?: OscillatorType
  /** 起始延迟，用于拼出旋律 */
  delay?: number
  gain?: number
  /** 频率滑到的目标值，用于"咻"的音效 */
  slideTo?: number
}

function tone(opts: ToneOptions): void {
  if (!enabled) return
  const c = getCtx()
  if (!c || c.state === 'suspended') return

  const t0 = c.currentTime + (opts.delay ?? 0)
  const osc = c.createOscillator()
  const g = c.createGain()

  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(opts.freq, t0)
  if (opts.slideTo) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t0 + opts.duration)
  }

  // 简单的 ADSR：快起音 + 指数衰减，听起来像木琴
  const peak = opts.gain ?? 0.16
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration)

  osc.connect(g)
  g.connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + opts.duration + 0.02)
}

/* ============================================================
   音效表
   ============================================================ */

export type SoundName =
  | 'tap' // 通用点击
  | 'tap-soft' // 次要点击
  | 'success' // 操作成功
  | 'submit' // 提交作文
  | 'score' // 出分
  | 'coin' // 金币
  | 'card' // 掉卡
  | 'card-rare' // 稀有卡
  | 'card-legend' // 传说卡
  | 'levelup' // 升段
  | 'leveldown' // 掉段
  | 'record-start' // 开始录音
  | 'record-stop' // 结束录音
  | 'error' // 出错
  | 'unlock' // 解锁日记
  | 'streak' // 连续签到

export function playSound(name: SoundName): void {
  if (!enabled) return

  switch (name) {
    case 'tap':
      tone({ freq: 660, duration: 0.07, type: 'triangle', gain: 0.13 })
      break

    case 'tap-soft':
      tone({ freq: 520, duration: 0.05, type: 'sine', gain: 0.09 })
      break

    case 'success':
      // 上行三音：do - mi - sol
      tone({ freq: 523, duration: 0.12, type: 'triangle' })
      tone({ freq: 659, duration: 0.12, type: 'triangle', delay: 0.09 })
      tone({ freq: 784, duration: 0.2, type: 'triangle', delay: 0.18 })
      break

    case 'submit':
      tone({ freq: 440, duration: 0.1, type: 'sine' })
      tone({ freq: 660, duration: 0.18, type: 'sine', delay: 0.08 })
      break

    case 'score':
      // 揭晓分数：四音上行，比较有仪式感
      tone({ freq: 523, duration: 0.14, type: 'triangle' })
      tone({ freq: 659, duration: 0.14, type: 'triangle', delay: 0.11 })
      tone({ freq: 784, duration: 0.14, type: 'triangle', delay: 0.22 })
      tone({ freq: 1047, duration: 0.34, type: 'triangle', delay: 0.33, gain: 0.2 })
      break

    case 'coin':
      tone({ freq: 988, duration: 0.08, type: 'square', gain: 0.08 })
      tone({ freq: 1319, duration: 0.14, type: 'square', delay: 0.06, gain: 0.08 })
      break

    case 'card':
      tone({ freq: 700, duration: 0.1, type: 'sine', gain: 0.12 })
      tone({ freq: 1050, duration: 0.16, type: 'sine', delay: 0.07, gain: 0.12 })
      break

    case 'card-rare':
      // 稀有卡：加一串闪音
      tone({ freq: 880, duration: 0.1, type: 'triangle', gain: 0.14 })
      tone({ freq: 1175, duration: 0.1, type: 'triangle', delay: 0.08, gain: 0.14 })
      tone({ freq: 1568, duration: 0.24, type: 'triangle', delay: 0.16, gain: 0.16 })
      break

    case 'card-legend':
      // 传说卡：低音铺底 + 高音爆开，做出"出大货"的感觉
      tone({ freq: 196, duration: 0.5, type: 'sawtooth', gain: 0.07 })
      tone({ freq: 523, duration: 0.16, type: 'triangle', delay: 0.05, gain: 0.15 })
      tone({ freq: 784, duration: 0.16, type: 'triangle', delay: 0.16, gain: 0.15 })
      tone({ freq: 1047, duration: 0.16, type: 'triangle', delay: 0.27, gain: 0.16 })
      tone({ freq: 1568, duration: 0.5, type: 'triangle', delay: 0.38, gain: 0.18 })
      break

    case 'levelup':
      // 升段：五音大调琶音
      ;[523, 659, 784, 1047, 1319].forEach((f, i) =>
        tone({ freq: f, duration: 0.22, type: 'triangle', delay: i * 0.1, gain: 0.17 }),
      )
      break

    case 'leveldown':
      ;[440, 392, 330].forEach((f, i) =>
        tone({ freq: f, duration: 0.24, type: 'sine', delay: i * 0.13, gain: 0.12 }),
      )
      break

    case 'record-start':
      tone({ freq: 440, duration: 0.09, type: 'sine', slideTo: 880, gain: 0.14 })
      break

    case 'record-stop':
      tone({ freq: 880, duration: 0.09, type: 'sine', slideTo: 440, gain: 0.14 })
      break

    case 'error':
      tone({ freq: 260, duration: 0.16, type: 'sawtooth', gain: 0.1 })
      tone({ freq: 200, duration: 0.22, type: 'sawtooth', delay: 0.1, gain: 0.1 })
      break

    case 'unlock':
      tone({ freq: 784, duration: 0.09, type: 'triangle' })
      tone({ freq: 1047, duration: 0.22, type: 'triangle', delay: 0.08 })
      break

    case 'streak':
      ;[659, 784, 988].forEach((f, i) =>
        tone({ freq: f, duration: 0.18, type: 'triangle', delay: i * 0.09, gain: 0.15 }),
      )
      break
  }
}

/** 卡牌音效按稀有度自动挑一个 */
export function playRaritySound(rarity: string): void {
  if (rarity === 'legend') playSound('card-legend')
  else if (rarity === 'epic' || rarity === 'rare') playSound('card-rare')
  else playSound('card')
}
