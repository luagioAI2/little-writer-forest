/* ============================================================
   标签体系 —— 显示与解析
   ============================================================

   这一节守的是「**界面上不能出现英文标签 id**」这件事。

   背景：标签 id 是英文的（`weather`），而孩子和家长看到的应该是中文。
   以前 ComposePage 直接把 id 打出来，孩子看到的是「🌧️ weather」。

   同时家长手写题库数据时会自然写中文（`"tagId": "天气"`），
   所以解析要两头都认：id 和中文 label 都指向同一个标签。

   为什么值得写测试：`resolveTagId` 认错一个标签**不会报错** ——
   只会安静地筛不到题、或者筛到错的题。
   ============================================================ */

import { describe, expect, it } from 'vitest'
import {
  APPLIED_FOCUS,
  TOPIC_TAGS,
  focusFor,
  focusForGenre,
  resolveTagId,
  tagById,
  tagLabel,
} from './prompts'
import { GENRES, PROMPT_MODES, promptModeMeta, resolveGenre, resolvePromptMode } from './types'

describe('tagLabel · 界面上永远显示中文', () => {
  it('认识 id 就翻成中文', () => {
    expect(tagLabel('weather')).toBe('天气')
    expect(tagLabel('season')).toBe('四季')
  })

  it('★ 所有内置标签的显示名都必须是中文（不许漏一个英文 id）', () => {
    const notChinese = TOPIC_TAGS.filter((t) => !/[\u4e00-\u9fa5]/.test(t.label))
    expect(notChinese.map((t) => t.id)).toEqual([])
  })

  it('认不出的标签原样返回，总比显示空白强', () => {
    expect(tagLabel('我的私房题')).toBe('我的私房题')
  })
})

describe('resolveTagId · 写中文也认', () => {
  it('写中文 label 能解析回 id', () => {
    expect(resolveTagId('天气')).toBe('weather')
    expect(resolveTagId('四季')).toBe('season')
  })

  it('写 id 原样通过', () => {
    expect(resolveTagId('weather')).toBe('weather')
  })

  it('前后空格不算数', () => {
    expect(resolveTagId('  天气  ')).toBe('weather')
  })

  it('家长自定义的标签不该被改写', () => {
    expect(resolveTagId('我的私房题')).toBe('我的私房题')
  })

  it('空字符串返回空，不炸', () => {
    expect(resolveTagId('')).toBe('')
    expect(resolveTagId('   ')).toBe('')
  })

  it('★ 中文写法和英文写法必须落到同一个 id（否则筛选会漏）', () => {
    for (const t of TOPIC_TAGS) {
      expect(resolveTagId(t.label), `标签「${t.label}」的中文没解析回 ${t.id}`).toBe(t.id)
      expect(resolveTagId(t.id)).toBe(t.id)
    }
  })
})

describe('★ 标签表本身的约束', () => {
  it('id 不重复', () => {
    const ids = TOPIC_TAGS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('★ 中文名不重复 —— 重名会让「按中文解析」出现歧义，静默选错一个', () => {
    const labels = TOPIC_TAGS.map((t) => t.label)
    const dup = labels.filter((l, i) => labels.indexOf(l) !== i)
    expect(dup).toEqual([])
  })

  it('tagById 和 tagLabel 对同一份表是一致的', () => {
    for (const t of TOPIC_TAGS) {
      expect(tagById(t.id)).toBe(t)
      expect(tagLabel(t.id)).toBe(t.label)
    }
  })
})


/* ============================================================
   考察重点 · 应用文（2026-09-30）
   ------------------------------------------------------------
   五维里的「观察力」判据是「图上的东西你都看到了吗」，
   而应用文**没有画面可观察**（范文那一支也不写感官、不写景物）。
   低年级默认那一档带着 observation —— 用在应用文上就是把 25%
   的权重压在一个不存在的指标上。
   ============================================================ */

describe('focusFor · 应用文', () => {
  it('★ 去掉「观察力」，且以「条理性」打头', () => {
    for (const g of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
      const f = focusFor(g, 'event', 'applied')
      expect(f, `年级 ${g} 的应用文里不该有观察力`).not.toContain('observation')
      expect(f[0], `年级 ${g} 的第一项必须是条理性（格式分）`).toBe('structure')
      expect(f).toEqual(APPLIED_FOCUS)
    }
  })

  it('★ 应用文不分年级都用同一套（它是格式判据，不看年级）', () => {
    for (const g of [4, 5, 6, 7, 8, 9] as const) {
      expect(focusFor(g, 'event', 'applied')).toEqual(focusFor(3, 'event', 'applied'))
    }
  })

  it('★★ 记叙文一个字没变：不传 genre 与传 narrative 完全一致', () => {
    // 这条是「零行为变更」的证据 —— 老调用方（没传 genre）走的是原路
    for (const g of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
      for (const c of ['scene', 'person', 'event', 'object', 'imagine'] as const) {
        expect(focusFor(g, c), `年级 ${g} / ${c}`).toEqual(focusFor(g, c, 'narrative'))
      }
    }
  })

  it('★ 想象类那条分支没被应用文改动带跑', () => {
    // 想象类在低年级会额外看想象力 —— 别被上面的 early return 顺手改掉
    expect(focusFor(3, 'imagine')).toContain('imagination')
    expect(focusFor(7, 'imagine')).toContain('imagination')
  })
})

/* ============================================================
   命题方式（轴 2）与格式要求（原「轴 3」· 2026-10-02 撤销）（2026-10-01）
   ------------------------------------------------------------
   改动的起因（家长原话）：

     「不应该有文体层。因为看图作文，可以理解成材料作文。
       能用来写议论文，记叙文，说明文都可以吧。」

   查证结果：**后半句对，前半句不对。**

     · 对：看图作文确实属于**给材料作文**（百科原文：「看图作文也属
       给材料作文的一种，只不过给的材料不是文字，而是图画」），
       而中考材料作文的题干原文写着「①立意自定，题目自拟，
       **文体自选**（诗歌、戏剧除外）」—— 所以**一道材料本身没有文体**。
     · 不对：文体这一层**不能删**。删了就没有判据了 —— 实测过，
       老路径下《节约用水倡议书》会生成一篇**写景**范文
       （开头是「那个地方的样子，我记了很久」）。

   结论：**「有文体」是对的，错的是「文体挂在题目上」。**
      · `requiredGenre` = 题目**指定**的文体（只有「写一份倡议书」这种）
      · 材料题/话题题 = **文体自选** → 一律不许写 `requiredGenre`
      · 孩子这一次实际写成什么文体 → 记在 `Work.genre` 上

   ⛔ **以上结论 2026-10-02 已撤销。** 家长定：
     「不需要 写成什么文体。不需要 这个。… APP 不需要区分文体。」
   现在是**两个轴**（写什么 × 题目怎么给的），**没有「轴 3」**。
   `requiredGenre` 只剩一个用途：**题目自带的格式要求**（只有应用文写它）。
   这些守卫换的只是说法，守的仍是那两件静默失败：
   材料/话题题不许写 `requiredGenre`；应用文必须写。

   ⛔ **同一天晚些时候又删了两个标签**（`look-picture` / `comic`）——
     家长：「整个应用就是看图作文」。所以原本那条「看图作文与漫画是材料
     作文」的守卫**换成了**「这两个标签不许加回来」。
     ⚠️ 删完之后 `promptMode: 'material'` **一个标签都没在用了**，但那个
     取值留着（它是这一轴的定义，不是「当前有没有人用」）。上面那条
     「材料/话题题不许写 requiredGenre」因此暂时空转 —— **别删**，它是给
     将来真有的材料题准备的。
   ============================================================ */

describe('命题方式 · 轴 2', () => {
  it('★★ 材料题 / 话题题**不许**带格式要求 —— 那两种不自带', () => {
    // ⚠️ 这条守的失败是**静默**的：一旦给材料题写上 requiredGenre，
    //    孩子那道题的格式要求就丢了，而且不报错、不崩、出题照常成功。
    const bad = TOPIC_TAGS.filter(
      (t) => t.requiredGenre && !promptModeMeta(resolvePromptMode(t.promptMode)).canFixGenre,
    )
    expect(
      bad.map((t) => `${t.id}（${resolvePromptMode(t.promptMode)} → ${t.requiredGenre}）`),
      '材料题/话题题不自带格式要求，不许写 requiredGenre',
    ).toEqual([])
  })

  it('⛔ 看图作文 / 漫画这两个标签已按家长决定删除 —— 不许悄悄加回来', () => {
    /*
     * 2026-10-02 家长：「整个应用就是看图作文」「为什么这些还存在。不需要呀。」
     * ➜ 连标签带题一起删了（看图作文 6 道 + 漫画 5 道），**应用文保留**。
     *
     * ⚠️ 这条守的是「有人翻题库觉得少了点什么、顺手又加回来」——
     *    加回来不会报错、不会崩、出题照常成功，只是题库里又冒出一个
     *    多余的分类（而整个 app 本来就是看图作文）。
     */
    for (const id of ['look-picture', 'comic']) {
      expect(tagById(id), `标签 ${id} 已删除，不该再出现`).toBeUndefined()
    }
  })

  it('★★ 应用文是**题目自带格式要求** —— 这才是它的真身份', () => {
    const t = tagById('applied-writing')
    expect(t).toBeDefined()
    expect(t!.requiredGenre).toBe('applied')
    // 两个轴各自独立：命题作文（怎么给的题）× 自带格式要求（应用文），别互相推
    expect(resolvePromptMode(t!.promptMode)).toBe('assigned')
  })

  it('★ 缺省 = 命题作文（老题库数据全都没有这个字段）', () => {
    expect(resolvePromptMode(undefined)).toBe('assigned')
    for (const t of TOPIC_TAGS) {
      expect(resolvePromptMode(t.promptMode)).toBe(t.promptMode ?? 'assigned')
    }
  })

  it('★ 每个命题方式都有中文名，且 canFixGenre 只有命题/半命题为真', () => {
    for (const m of PROMPT_MODES) {
      expect(m.label, `${m.key} 没有中文名`).toMatch(/[\u4e00-\u9fa5]/)
      expect(promptModeMeta(m.key)).toBe(m)
    }
    expect(
      PROMPT_MODES.filter((m) => m.canFixGenre).map((m) => m.key),
      '只有命题/半命题可以自带格式要求（「请写一份倡议书」）',
    ).toEqual(['assigned', 'half'])
  })
})

describe('格式要求（原「轴 3」）', () => {
  it('★★ 缺省 = 记叙文，且这是**唯一**一处判定', () => {
    // 全库 409 道里 401 道是记叙文；老存档没有这个字段完全正常。
    expect(resolveGenre(undefined)).toBe('narrative')
    expect(resolveGenre('applied')).toBe('applied')
  })

  it('★ 记叙文标签一律不写 requiredGenre —— 缺省就是它', () => {
    // 46 个标签里只有 1 个（应用文）写了。剩下的写上去只会多一份判定。
    const explicitNarrative = TOPIC_TAGS.filter((t) => t.requiredGenre === 'narrative')
    expect(explicitNarrative.map((t) => t.id), '记叙文是缺省，不用写').toEqual([])
  })
})


/* ============================================================
   考察重点 · `focusForGenre` 的边界（2026-10-01 起，2026-10-02 收窄）
   ------------------------------------------------------------
   这一层错了是**静默**的：权重错照样出分数，只是那个分数在夸一个
   这道题根本不需要的能力。

   ★ 2026-10-02：说明文 / 议论文的考察重点**删掉了** ——
     家长定的「APP 不需要区分文体」，孩子写记叙、说明、议论由他自己
     决定，出题不问、评分不判。所以这里只剩「应用文」一条正向断言
     （在上一节），这一节只守**边界**。
   ============================================================ */

describe('focusForGenre · 边界', () => {
  it('★★ 记叙文（含不传）返回 undefined —— 不许短路掉按年级推的那套', () => {
    /*
     * 这里返回 `[]` 或任何数组都是**静默**的错：`focusFor` 会以为
     * 「格式说了算」，于是低年级的想象类不再带 imagination、
     * 高年级不再带 emotion —— 而记叙文**根本不该由它决定权重**。
     */
    expect(focusForGenre(undefined)).toBeUndefined()
    expect(focusForGenre('narrative')).toBeUndefined()
  })

  it('★ 应用文不分年级（它是格式判据，不看年级）', () => {
    for (const g of [1, 3, 5, 7, 9] as const) {
      expect(focusFor(g, 'event', 'applied')).toEqual(APPLIED_FOCUS)
    }
  })

  it('★ 记叙文一个字没变：不传 genre 与传 narrative 完全一致', () => {
    for (const g of [1, 3, 5, 7, 9] as const) {
      for (const c of ['scene', 'person', 'event', 'object', 'imagine'] as const) {
        expect(focusFor(g, c), `年级 ${g} / ${c}`).toEqual(focusFor(g, c, 'narrative'))
      }
    }
  })

  it('★★ 每一个非记叙文取值都必须有考察重点（遍历 GENRES 兜底）', () => {
    /*
     * 新增一个取值时最容易漏的就是这里 —— `focusForGenre` 的 switch
     * 会掉进 `default: return undefined`，于是那个取值**按年级的记叙文
     * 权重**评分，而且不报错、不崩，只是分数在夸错的能力。
     *
     * ⚠️ 这条现在还兼职盯着「别把说明文/议论文加回来」：
     *    真加回来就必须同时补上它的考察重点，否则这里红。
     */
    for (const g of GENRES) {
      if (g.key === 'narrative') continue
      expect(focusForGenre(g.key), `取值「${g.label}」没有考察重点`).toBeDefined()
    }
  })
})
