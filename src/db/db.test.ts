/* ============================================================
   mergeSettings / mergeLevel —— 存档迁移的回归测试
   ============================================================

   为什么值得单独写一个文件：

   这些 `merge*` 函数是**老存档能不能活下去**的唯一关口。
   用户升级 App 时，存档里没有新加的字段 —— UI 那边一句
   `settings.transcribe.baseUrl` 就会读成 undefined。

   而这里有个特别隐蔽的失败模式：**它不报错，只是静静地降级。**
   `transcribe` 丢了 → `isTranscribeConfigured()` 返回 false →
   孩子按麦克风时悄悄退回系统识别 → 在华为上就是我们刚花一整轮
   修掉的那个"一个字都不出来"。整个过程没有任何异常、没有日志、
   没有界面提示，看起来就像"这个功能根本没做"。

   所以这几条断言不是在测实现细节，是在钉住
   "**老用户升级后一定拿到能用的默认值**"。
   ============================================================ */

import { describe, expect, it } from 'vitest'
import {
  defaultSettings,
  mergeLevel,
  mergeSettings,
  mergeStats,
  mergeStreak,
  mergeTree,
  mergeWallet,
  defaultWallet,
} from './db'
import type { Settings } from '../domain/types'
import { initialLevelState } from '../domain/levels'
import { initialTreeState } from '../domain/tree'
import { DEFAULT_DEEPSEEK_MODEL, defaultAiConfig } from '../domain/ai'
import {
  defaultTranscribeConfig,
  isTranscribeConfigured,
  VOLC_TEST_API_KEY,
  type TranscribeConfig,
} from '../platform/transcribe'

describe('mergeSettings —— 空存档 / 缺字段', () => {
  it('undefined 时返回完整默认设置', () => {
    const s = mergeSettings(undefined)
    expect(s).toEqual(defaultSettings())
    // 默认值里必须**已经带着** transcribe，否则新装用户也按不了麦克风
    expect(s.transcribe).toBeDefined()
    expect(s.ai).toBeDefined()
  })

  /* ★ 本文件存在的理由：这条是"老用户升级"的核心用例 */
  it('老存档没有 transcribe 字段时，补上完整默认值（不是 undefined）', () => {
    // 造一个"加这个功能之前"的存档：只有当时的字段
    const oldSave = {
      childName: '小明',
      avatar: '🐣',
      grade: 4,
      diaryPin: null,
      parentPin: '1234',
      soundOn: false,
      hapticsOn: true,
      ai: defaultAiConfig(),
      dailyGoal: 1,
      onboarded: true,
    } as unknown as Settings

    const s = mergeSettings(oldSave)

    // 老字段一个都不能丢
    expect(s.childName).toBe('小明')
    expect(s.grade).toBe(4)
    expect(s.soundOn).toBe(false)
    expect(s.onboarded).toBe(true)

    // 新字段必须被补成**完整可用**的默认值 ——
    // 只补一个空对象 `{}` 是不够的，那会读成一个半成品配置。
    //
    // ⚠️ 这里刻意断言"可用"而不是"baseUrl 非空"：
    //    默认已经换成火山流式，那条路**不用 baseUrl**（地址内置），
    //    拿 baseUrl 当判据会误报。真正该守的是
    //    「补出来的配置能直接拿去转写」。
    expect(s.transcribe).toEqual(defaultTranscribeConfig())
    expect(isTranscribeConfigured(s.transcribe)).toBe(true)
    expect(s.transcribe?.apiKey).toBeTruthy()
    expect(s.transcribe?.model).toBeTruthy()
  })

  it('老存档的 transcribe 是空对象时，也补成完整默认值', () => {
    // 比缺字段更刁钻：字段在、但是个半成品（比如手工写入或跨版本写过一次空值）
    const half = { ...defaultSettings(), transcribe: {} as never }
    const s = mergeSettings(half)

    // 半成品被补全 —— 具体补成什么由 defaultTranscribeConfig 决定，
    // 这里要守的是"补全了、且可用"，不是某个具体字段
    expect(s.transcribe).toEqual(defaultTranscribeConfig())
    expect(isTranscribeConfigured(s.transcribe)).toBe(true)
  })

  it('用户已经填好的 transcribe 不能被默认值盖掉', () => {
    // 反向把关：合并顺序写反（default 在后）就会把家长的 Key 冲掉，
    // 而且家长不会发现 —— 只会觉得"怎么又不好使了"
    //
    // ⚠️ 必须带 `engine: 'volcengine'` 且 baseUrl 为空：不带 engine、或者
    //    带着地址，都会被 migrateTranscribeConfig 判成"不自洽"而整份重置成
    //    火山默认值（见本文件后面那组用例）。
    //    也就是说 —— **只有自洽的配置才算"家长的明确选择"**。
    const mine = {
      ...defaultSettings(),
      transcribe: {
        engine: 'volcengine' as const,
        baseUrl: '',
        apiKey: 'my-own-uuid-key',
        model: 'nostream',
        resourceId: 'volc.seedasr.sauc.duration',
      },
    }
    const s = mergeSettings(mine)

    expect(s.transcribe?.apiKey).toBe('my-own-uuid-key')
    expect(s.transcribe?.model).toBe('nostream')
  })

  it('老的 ai 配置同样不能被默认值盖掉', () => {
    const mine = {
      ...defaultSettings(),
      ai: { ...defaultAiConfig(), apiKey: 'sk-deepseek-mine' },
    }
    expect(mergeSettings(mine).ai.apiKey).toBe('sk-deepseek-mine')
  })

  it('dailyGoal 超限的老存档会被夹回来（曾经可选到 5）', () => {
    const old = { ...defaultSettings(), dailyGoal: 5 } as Settings
    const s = mergeSettings(old)
    expect(s.dailyGoal).toBeLessThanOrEqual(3)
    expect(s.dailyGoal).toBeGreaterThanOrEqual(1)
  })

  /* ★ DeepSeek 模型改名：改了默认值只对新装生效，老存档必须一起扶正 */
  it('★ 老存档里弃用的 deepseek-chat 会被换成正式名', () => {
    /*
     * 为什么非要有这一步：改 `defaultAiConfig()` 只对**新装**的生效。
     * 存过设置的用户那边 `{ ...defaultAiConfig(), ...s.ai }` 里
     * `s.ai.model` 会把默认值盖掉 —— 代码里明明写着新模型，
     * 家长那边跑的还是旧名字，只会得出「你改了但我这边没变化」。
     * 这个项目里"改了没生效"已经踩过好几次。
     */
    const old = {
      ...defaultSettings(),
      ai: { ...defaultAiConfig(), model: 'deepseek-chat' },
    }
    expect(mergeSettings(old).ai.model).toBe(DEFAULT_DEEPSEEK_MODEL)
  })

  it('内测期的 deepseek-v4-flash 也一并扶正', () => {
    const old = {
      ...defaultSettings(),
      ai: { ...defaultAiConfig(), model: 'deepseek-v4-flash' },
    }
    expect(mergeSettings(old).ai.model).toBe(DEFAULT_DEEPSEEK_MODEL)
  })

  it('★ 家长自己填的模型名一律不碰（换过服务商就更是）', () => {
    // 判据故意收得窄：只认"我们预置过的旧名字 + 官方 base_url"。
    // 家长自己挑的模型是他的选择，不是"没跟上默认值"。
    const custom = {
      ...defaultSettings(),
      ai: { ...defaultAiConfig(), model: 'my-own-model' },
    }
    expect(mergeSettings(custom).ai.model).toBe('my-own-model')

    // 同样的旧模型名，但 base_url 是别家的 —— 不碰
    const otherVendor = {
      ...defaultSettings(),
      ai: {
        ...defaultAiConfig(),
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'deepseek-ai/DeepSeek-V4-Flash',
      },
    }
    expect(mergeSettings(otherVendor).ai.model).toBe('deepseek-ai/DeepSeek-V4-Flash')
  })

  /* ★ 新手引导的迁移：这是一条**刻意的**行为，不是顺手补的默认值 */
  it('★ 老存档（没有 guideDone）会被补成 false —— 也就是会看一遍引导', () => {
    /*
     * 为什么这是故意的：引导里教的「按住说话」手势，
     * 恰恰是现有用户从来没被告知过的东西 —— 他们会去**点**那个麦克风，
     * 点一下什么都不会发生（真实行为就是这样），于是以为功能坏了。
     * 所以已经装了 App 的人下次打开会看到一遍引导，看过就置 true。
     */
    const oldSave = {
      childName: '小明',
      avatar: '🐣',
      grade: 4,
      diaryPin: null,
      parentPin: '1234',
      soundOn: true,
      hapticsOn: true,
      ai: defaultAiConfig(),
      dailyGoal: 1,
      onboarded: true,
    } as unknown as Settings

    const s = mergeSettings(oldSave)
    expect(s.onboarded).toBe(true) // 资料不重问
    expect(s.guideDone).toBe(false) // 玩法要教一遍
  })

  it('★ guideDone 和 onboarded 是两个独立的开关，不许互相带', () => {
    // 「再看一遍新手引导」把 guideDone 置回 false 时，
    // onboarded 必须还是 true —— 否则昵称和年级会被再问一遍，
    // 而那是他一年才改一次的东西（见 types.ts 的说明）
    const done = { ...defaultSettings(), onboarded: true, guideDone: true }
    expect(mergeSettings(done)).toMatchObject({ onboarded: true, guideDone: true })

    const replay = { ...defaultSettings(), onboarded: true, guideDone: false }
    expect(mergeSettings(replay)).toMatchObject({ onboarded: true, guideDone: false })
  })

  it('合并结果一定是新对象，不改动传进来的存档', () => {
    const save = defaultSettings()
    const snapshot = JSON.parse(JSON.stringify(save))
    const merged = mergeSettings(save)

    expect(merged).not.toBe(save)
    // 传进来的那份必须原封不动 —— 它是从 IndexedDB 读出来的活对象
    expect(save).toEqual(snapshot)
  })

  it('★ 老存档没有 lastCategory 时，默认补成 scene（写景）', () => {
    const oldSave = {
      childName: '小明',
      avatar: '🐣',
      grade: 4,
      diaryPin: null,
      parentPin: '1234',
      soundOn: true,
      hapticsOn: true,
      ai: defaultAiConfig(),
      dailyGoal: 1,
      onboarded: true,
      guideDone: true,
    } as unknown as Settings

    const s = mergeSettings(oldSave)
    expect(s.lastCategory).toBe('scene')
  })

  it('已有的 lastCategory 不能被默认值盖掉', () => {
    const mine = { ...defaultSettings(), lastCategory: 'person' as const }
    expect(mergeSettings(mine).lastCategory).toBe('person')
  })
})

describe('mergeLevel —— 数组字段兜底', () => {
  it('undefined 时返回初始段位', () => {
    expect(mergeLevel(undefined)).toEqual(initialLevelState())
  })

  /* readLevel 的注释专门警告过：缺 recentScores 会让成长树整页打崩 */
  it('缺 recentScores 的老存档补上空数组', () => {
    const old = { level: 3 } as never
    const s = mergeLevel(old)
    expect(Array.isArray(s.recentScores)).toBe(true)
  })

  it('recentScores 类型不对（不是数组）时也要兜底', () => {
    // 展开运算符只保证"字段存在"，不保证"是数组" —— 这行注释在源码里，
    // 这条用例把它钉住
    const bad = { ...initialLevelState(), recentScores: 'oops' as never }
    const s = mergeLevel(bad)
    expect(Array.isArray(s.recentScores)).toBe(true)
  })

  it('已有的 recentScores 内容保留', () => {
    const scores = [90, 85, 70]
    const s = mergeLevel({ ...initialLevelState(), recentScores: scores })
    expect(s.recentScores).toEqual(scores)
  })
})

describe('几个直接返回型 merge —— 只保证不返回 undefined', () => {
  it('mergeStreak', () => {
    expect(mergeStreak(undefined)).toBeDefined()
    const mine = 12 as never
    expect(mergeStreak(mine)).toBe(mine)
  })

  it('mergeWallet', () => {
    expect(mergeWallet(undefined)).toEqual(defaultWallet())
    const mine = { coins: 42, totalEarned: 100 }
    expect(mergeWallet(mine)).toEqual(mine)
  })

  it('mergeStats', () => {
    expect(mergeStats(undefined)).toBeDefined()
    expect(mergeStats(undefined).compositions).toBe(0)
  })

  it('mergeTree 的数组字段全部兜底（缺字段的老存档）', () => {
    const s = mergeTree({} as never)
    expect(Array.isArray(s.pending)).toBe(true)
    expect(Array.isArray(s.hollowDiaries)).toBe(true)
    expect(Array.isArray(s.events)).toBe(true)
  })

  it('mergeTree 传 undefined 时返回初始状态', () => {
    expect(mergeTree(undefined).pending).toEqual(initialTreeState(Date.now()).pending)
  })
})

/* ============================================================
   语音转写配置的迁移 —— 一次真实故障的回归测试
   ============================================================

   故障现象（家长原话）：「写作文 录音 好像有问题了。之前正常的。」

   根因：`engine` 是后加的字段，而 `defaultTranscribeConfig()` 后来从
   「整包上传（硅基流动）」换成了「火山流式」。老存档没有 `engine`，
   于是 `{ ...default, ...saved }` 拼出一个自相矛盾的配置 ——
   engine 说火山，密钥却是硅基流动的。界面据此切成「按住说话」，
   然后拿硅基流动的密钥去连火山的 WebSocket → **握手被拒 HTTP 401**
   （实测过）→ 一个字都出不来。

   修法只有一条判据：**配置必须自洽** —— engine 与其余字段不许打架。
   · 自洽 = 家长的**明确选择** → 保留（逐字段挑，不 spread）；
   · 不自洽（含"没有 engine"的老存档）→ 整份回到当前默认（火山，密钥内置）。

   为什么老存档算"不自洽"、而不是猜成 openai：那时 engine 还不存在，
   家长没选过路由，他填的只是当时唯一可填的那一格。

   ⛔ 2026-10-02 家长定「去掉硅基流动的东西，只使用火山」之后，
      `'openai'` 那条路连代码一起删了 —— 于是这个函数只剩**一个**目的：
      把盘上那些形状已经作废的老存档（带 `engine` / `baseUrl` / `sk-` 密钥）
      清成当前唯一的那份配置。
      ★ 所以下面每组用例都多了一条断言：**迁移结果里不许再留下
        `engine` / `baseUrl` 这两个键** —— 只删类型是不够的，
        键还在盘上就还会被读出来拼成自相矛盾的配置。
   ============================================================ */

const SF_KEY = 'sk-fscrrhohiidqoakwrfegzgqmakzpkseamllbdshsmpzdrqel'

/** 一个"加 engine 之前"的老存档（配过硅基流动） */
function legacySaveWith(transcribe: Record<string, unknown>) {
  return {
    childName: '小笔苗', avatar: '🌱', grade: 3, diaryPin: null, parentPin: '0000',
    soundOn: true, hapticsOn: true, dailyGoal: 1, onboarded: true,
    transcribe,
  } as unknown as Settings
}

/**
 * 迁移结果必须是**当前这一份配置**，一个字的多余字段都不许有。
 *
 * 判据三条（和 `migrateTranscribeConfig` 的约定一致）：
 *   ① 只剩活着的三个键 —— `engine` / `baseUrl` 必须被清掉；
 *   ② 不许带着别家的 `sk-` 密钥（火山是 UUID，串味的密钥就是 401 的成因）；
 *   ③ 能直接用（`isTranscribeConfigured`）。
 */
function isClean(t: TranscribeConfig) {
  const raw = t as unknown as Record<string, unknown>
  const keys = Object.keys(raw).sort()
  const onlyLiveKeys = keys.every((k) => ['apiKey', 'model', 'resourceId'].includes(k))
  const foreign = (t.apiKey ?? '').trim().startsWith('sk-')
  return onlyLiveKeys && !foreign
}

describe('mergeSettings —— 语音转写配置必须自洽（★ 真实故障回归）', () => {
  it('★★ 老存档配过硅基流动、没有 engine → 整份回到火山默认，绝不能拼出"火山+sk-密钥"', () => {
    const s = mergeSettings(
      legacySaveWith({
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: SF_KEY,
        model: 'Qwen/Qwen3-ASR-1.7B',
      }),
    )

    // 这就是那个 bug 的形态：配置说火山，密钥却是硅基流动的
    expect((s.transcribe?.apiKey ?? '').startsWith('sk-')).toBe(false)
    expect(isClean(s.transcribe!)).toBe(true)
    // ★ 老的两个键不许留在盘上（只删类型 = 没删）
    expect((s.transcribe as unknown as Record<string, unknown>).baseUrl).toBeUndefined()
    expect((s.transcribe as unknown as Record<string, unknown>).engine).toBeUndefined()
    // 而且必须是"能直接用"的（密钥内置），否则家长还是按不动麦克风
    expect(isTranscribeConfigured(s.transcribe)).toBe(true)
  })

  it('★ 已写坏：engine=火山 + baseUrl + sk- 密钥 → 整份回到默认（那正是 401 的成因）', () => {
    const s = mergeSettings(
      legacySaveWith({
        engine: 'volcengine',
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: SF_KEY,
        model: 'Qwen/Qwen3-ASR-1.7B',
      }),
    )
    expect(isClean(s.transcribe!)).toBe(true)
    expect((s.transcribe?.apiKey ?? '').startsWith('sk-')).toBe(false)
    expect((s.transcribe as unknown as Record<string, unknown>).baseUrl).toBeUndefined()
  })

  it('★ 另一种写坏：engine=火山 + 内置火山密钥，但 baseUrl 有残留 → 也要清干净', () => {
    const s = mergeSettings(
      legacySaveWith({
        engine: 'volcengine',
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: VOLC_TEST_API_KEY,
        model: 'bigmodel',
      }),
    )
    expect((s.transcribe as unknown as Record<string, unknown>).baseUrl).toBeUndefined()
    expect(isClean(s.transcribe!)).toBe(true)
  })

  it('★ 自洽的火山配置 → 保留家长的选择，但两个废弃键仍要清掉', () => {
    /* 这一条是"不碰家长的明确选择"和"清掉废弃键"两件事的**交汇点**：
       保留 ≠ 原样 spread。家长填的 apiKey / model / resourceId 留下，
       而 `engine` / `baseUrl` 这两个已经没有意义的键必须消失 ——
       否则"删掉了"只体现在类型上，盘上永远清不干净。 */
    const s = mergeSettings(
      legacySaveWith({
        engine: 'volcengine',
        baseUrl: '',
        apiKey: 'my-own-uuid-key',
        model: 'nostream',
        resourceId: 'volc.seedasr.sauc.duration',
      }),
    )
    expect(s.transcribe?.apiKey).toBe('my-own-uuid-key')
    expect(s.transcribe?.model).toBe('nostream')
    expect((s.transcribe as unknown as Record<string, unknown>).engine).toBeUndefined()
    expect((s.transcribe as unknown as Record<string, unknown>).baseUrl).toBeUndefined()
  })

  it('全新用户（没有 transcribe）→ 用火山默认值，且干净可用', () => {
    const s = mergeSettings(legacySaveWith({}))
    expect(isTranscribeConfigured(s.transcribe)).toBe(true)
    expect(isClean(s.transcribe!)).toBe(true)
  })

  it('★ 任何来源的存档，合并后都必须干净且可用（横扫）', () => {
    const cases: Record<string, unknown>[] = [
      { baseUrl: 'https://api.siliconflow.cn/v1', apiKey: SF_KEY, model: 'Qwen/Qwen3-ASR-1.7B' },
      { engine: 'volcengine', baseUrl: 'https://api.siliconflow.cn/v1', apiKey: SF_KEY, model: 'x' },
      { engine: 'volcengine', baseUrl: 'https://api.siliconflow.cn/v1', apiKey: VOLC_TEST_API_KEY, model: 'bigmodel' },
      { engine: 'volcengine', baseUrl: '', apiKey: VOLC_TEST_API_KEY, model: 'bigmodel' },
      { engine: 'volcengine', baseUrl: '', apiKey: SF_KEY, model: 'bigmodel' }, // 串味的密钥
      { engine: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x', model: 'whisper-1' },
      { engine: 'openai', baseUrl: '', apiKey: 'sk-x', model: 'whisper-1' }, // 缺地址
      {},
    ]
    for (const c of cases) {
      const s = mergeSettings(legacySaveWith(c))
      expect(isClean(s.transcribe!), '不干净: ' + JSON.stringify(c)).toBe(true)
      // 干净还不够 —— 还得是"能直接用"的，否则孩子按不动麦克风
      expect(isTranscribeConfigured(s.transcribe), '不可用: ' + JSON.stringify(c)).toBe(true)
    }
  })
})
