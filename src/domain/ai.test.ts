/* ============================================================
   改作文走大模型 —— 单测
   ============================================================

   这一节守的是**边界**，不是功能。边界被划错过两次：

     第一次（原始需求，见 domain/voiceEdit.ts 顶部）：
       「编辑的绝不允许 AI 帮改写。必须是小孩的能力。」
     于是连"听懂指令"都只能用固定正则，结果「在 X 后面加 Y」
     这一整类说法根本没有对应分支。

     第二次（2026-09-19，家长重新划的）：
       「不许 AI 帮改写。是**不许 AI 帮写**，不是不允许改写。
         把正在去掉可以，小明后面加小红可以，把小明改成大明可以。
         但不允许 AI 自己生产内容 —— 类似『给这个句子加点比喻』都不行。」
     也就是：**改**可以（只要字是孩子自己说的），**写**不行。
     而当时那条 AI 路径正好在"写" —— 它返回的是改好的全文。

   现在这条链路是：模型只翻译 → 引擎去执行。正文永远出自
   domain/voiceEdit.ts 的确定性引擎，模型碰不到。

   ★ 为什么用测试守：这层保护**不是靠提示词**，是靠**接口形状**
     （返回类型里压根没有"正文"这个字段）。形状这种东西，
     后来的人加一个可选字段就破了，而且编译不报错、跑起来也正常。
     所以在这里钉住：**旧的"返回全文"契约不许回来**。
   ============================================================ */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AI_PRESETS,
  AI_TEST_API_KEY,
  defaultAiConfig,
  generateModelEssay,
  isEssayStale,
  parseEditInstruction,
  scoreAndRewrite,
  shouldUseRemote,
} from './ai'
import { applyEdit } from './voiceEdit'
import { usedRhetoric } from './modelEssay'
import type {
  AiConfig,
  CompositionCategory,
  GradeLevel,
  PromptImage,
  ScoreDimension,
} from './types'

function cfg(over: Partial<AiConfig> = {}): AiConfig {
  return { ...defaultAiConfig(), mode: 'remote', apiKey: 'sk-test', ...over }
}

/** 让 fetch 回一段模型输出（content 就是模型回的字符串） */
function mockReply(content: string, status = 200) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => content,
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

const ESSAY = '我家有一只小猫，它很喜欢在阳台上晒太阳。'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseEditInstruction · 正常路径', () => {
  it('把一句口语翻成结构化指令（不返回正文）', async () => {
    mockReply(JSON.stringify({ kind: 'replace', from: '小猫', to: '小狗' }))
    const r = await parseEditInstruction({
      cfg: cfg(),
      text: ESSAY,
      // 本地解析器会被这句骗到（抓成「我觉得小猫」），大模型这条正是为了这个
      instruction: '我觉得小猫改成小狗更好',
    })
    expect(r.ok).toBe(true)
    expect(r.intent).toEqual({ kind: 'replace', from: '小猫', to: '小狗' })
  })

  it('「在 X 后面加 Y」翻成 insert —— 本地解析器没有这一支', async () => {
    mockReply(
      JSON.stringify({ kind: 'insert', anchor: '小猫', position: 'after', text: '和小狗' }),
    )
    const r = await parseEditInstruction({
      cfg: cfg(),
      text: ESSAY,
      instruction: '在小猫后面加上和小狗',
    })
    expect(r.intent).toEqual({
      kind: 'insert',
      anchor: '小猫',
      text: '和小狗',
      position: 'after',
    })
  })

  it('position 缺省 / 写错时按 after 处理（后插是最常见的说法）', async () => {
    mockReply(JSON.stringify({ kind: 'insert', anchor: '小猫', text: '呀' }))
    const r = await parseEditInstruction({ cfg: cfg(), text: ESSAY, instruction: '小猫后面加呀' })
    expect(r.intent).toMatchObject({ kind: 'insert', position: 'after' })
  })

  /* ★ 2026-09-20 家长报的「把玩篮球后面的句号改成叹号，始终不行」 */
  it('★ 「X 后面的句号改成叹号」翻成 replace-punct，且 from/to 是**真符号**', async () => {
    mockReply(JSON.stringify({ kind: 'replace-punct', from: '。', to: '！', near: '小猫' }))
    const r = await parseEditInstruction({
      cfg: cfg(),
      text: ESSAY,
      instruction: '把小猫后面的句号改成叹号',
    })
    expect(r.intent).toEqual({ kind: 'replace-punct', from: '。', to: '！', near: '小猫' })

    // 交给引擎执行 —— 正文仍然只由引擎生成
    const applied = applyEdit(ESSAY, r.intent!, Date.now())
    expect(applied.ok).toBe(true)
    expect(applied.text).toBe('我家有一只小猫，它很喜欢在阳台上晒太阳！')
  })

  it('★ 模型把「句号」两个字塞进 from → 判非法，不许回到家长报的那个 bug', async () => {
    /*
     * 执行层是按**符号**去正文里找的。模型要是把名字当 from 返回，
     * 就会去正文里找"句号"这俩字 —— 那正是家长报的「始终不行」。
     * 所以在收敛这一层就拦掉：名字不是合法标点。
     */
    mockReply(JSON.stringify({ kind: 'replace-punct', from: '句号', to: '叹号' }))
    const r = await parseEditInstruction({ cfg: cfg(), text: ESSAY, instruction: '把句号改成叹号' })
    expect(r.ok).toBe(false)
    expect(r.intent).toBeUndefined()
  })

  it('「最后的句号」带上 pick: last（孩子自己指定了哪一处）', async () => {
    mockReply(JSON.stringify({ kind: 'replace-punct', from: '。', to: '！', pick: 'last' }))
    const r = await parseEditInstruction({
      cfg: cfg(),
      text: ESSAY,
      instruction: '把最后的句号改成叹号',
    })
    expect(r.intent).toEqual({ kind: 'replace-punct', from: '。', to: '！', pick: 'last' })
  })

  it('★ 翻译出来的指令交给引擎执行，正文由引擎生成', async () => {
    // 这一条是整节的重点：模型只给「改哪里、怎么改」，
    // 真正动笔的是 applyEdit —— 所以孩子看到的字全是他自己说的。
    mockReply(JSON.stringify({ kind: 'replace', from: '小猫', to: '小狗' }))
    const r = await parseEditInstruction({
      cfg: cfg(),
      text: ESSAY,
      instruction: '把小猫改成小狗',
    })

    const applied = applyEdit(ESSAY, r.intent!, Date.now())
    expect(applied.ok).toBe(true)
    expect(applied.text).toBe('我家有一只小狗，它很喜欢在阳台上晒太阳。')
  })

  it('refuse 也走同一条路 —— 透传给调用方，由引擎负责说"这句得你自己写"', async () => {
    mockReply(JSON.stringify({ kind: 'refuse', reason: 'content' }))
    const r = await parseEditInstruction({
      cfg: cfg(),
      text: ESSAY,
      instruction: '给这个句子加点比喻',
    })
    expect(r.ok).toBe(true)
    expect(r.intent).toEqual({ kind: 'refuse', reason: 'content' })

    const applied = applyEdit(ESSAY, r.intent!, Date.now())
    expect(applied.ok).toBe(false)
    expect(applied.reason).toBe('refused')
    expect(applied.text).toBe(ESSAY)
  })
})

/* ============================================================
   ★★ 形状守卫 —— 模型"想帮孩子写"也写不进来
   ============================================================

   下面这几条不是在测"模型乖不乖"，是在测**代码有没有给它留门**。
   旧实现的门是 `{ changed, text, summary }`，text 就是整篇改好的作文。
   有人哪天觉得"让模型直接返回全文更省事"，这几条会立刻红。
   ============================================================ */

describe('★★ 不许 AI 帮写 —— 形状守卫', () => {
  it('★ 模型返回旧的「全文」形状 → 当没听懂，绝不当成成功', async () => {
    mockReply(
      JSON.stringify({
        changed: true,
        text: '我家有一只小狗，它每天都很开心地在阳台上玩耍。',
        summary: '润色了一下',
      }),
    )
    const r = await parseEditInstruction({
      cfg: cfg(),
      text: ESSAY,
      instruction: '帮我润色一下',
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('unknown')
    // 关键：结果里**没有** text 字段，那篇"AI 写的作文"无处可放
    expect(r).not.toHaveProperty('text')
    expect(r.intent).toBeUndefined()
  })

  it('★ 模型返回散文（连 JSON 都不是）→ 当没听懂', async () => {
    mockReply('我觉得这篇作文写得挺好的，可以再加一点细节。')
    const r = await parseEditInstruction({ cfg: cfg(), text: ESSAY, instruction: '改一下' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('unknown')
  })

  it('★ 在合法指令上偷偷夹带全文 —— 夹带的部分会被丢掉', async () => {
    mockReply(
      JSON.stringify({
        kind: 'replace',
        from: '小猫',
        to: '小狗',
        text: 'AI 顺手写的一整篇新作文。',
        polished: 'AI 顺手写的一整篇新作文。',
      }),
    )
    const r = await parseEditInstruction({ cfg: cfg(), text: ESSAY, instruction: '把小猫改成小狗' })

    // 只有落在这六种形状里的字段能被接住，其余一律丢弃
    expect(r.intent).toEqual({ kind: 'replace', from: '小猫', to: '小狗' })
    expect(JSON.stringify(r.intent)).not.toContain('顺手写的')
  })

  it('kind 不认识 / 必填字段空着 → 当没听懂', async () => {
    for (const bad of [
      { kind: 'rewrite', text: '整篇重写' },
      { kind: 'replace', from: '小猫' }, // 少了 to
      { kind: 'insert', anchor: '小猫' }, // 少了 text
      { kind: 'delete' }, // 少了 target
      { kind: 'append', text: '   ' }, // 空字符串
      { text: '连 kind 都没有' },
      {},
    ]) {
      mockReply(JSON.stringify(bad))
      const r = await parseEditInstruction({ cfg: cfg(), text: ESSAY, instruction: '随便说点什么' })
      expect(r.ok, JSON.stringify(bad)).toBe(false)
      expect(r.reason).toBe('unknown')
    }
  })

  it('★ undo 不带任何内容字段，也不许模型顺便塞点什么', async () => {
    mockReply(JSON.stringify({ kind: 'undo', text: '顺便改一下别的' }))
    const r = await parseEditInstruction({ cfg: cfg(), text: ESSAY, instruction: '撤销' })
    expect(r.intent).toEqual({ kind: 'undo' })
  })
})

describe('parseEditInstruction · 失败路径', () => {
  it('AI 没配好：报 not-configured，并说清缺什么', async () => {
    const r = await parseEditInstruction({
      cfg: cfg({ apiKey: '' }),
      text: ESSAY,
      instruction: '把小猫改成小狗',
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not-configured')
    expect(r.message).toContain('密钥')
  })

  it('接口回了 4xx：归到 server，并带上状态码（家长的动作和"连不上"不一样）', async () => {
    mockReply('unauthorized', 401)
    const r = await parseEditInstruction({ cfg: cfg(), text: ESSAY, instruction: '把小猫改成小狗' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('server')
    expect(r.message).toContain('401')
  })

  it('连不上：归到 network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Failed to fetch')
      }),
    )
    const r = await parseEditInstruction({ cfg: cfg(), text: ESSAY, instruction: '把小猫改成小狗' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('network')
  })

  it('没有正文 / 没听清：直接返回，不浪费一次接口调用', async () => {
    const f = mockReply('{}')
    const a = await parseEditInstruction({ cfg: cfg(), text: '   ', instruction: '改一下' })
    const b = await parseEditInstruction({ cfg: cfg(), text: ESSAY, instruction: '   ' })
    expect(a.reason).toBe('empty')
    expect(b.reason).toBe('empty')
    expect(f).not.toHaveBeenCalled()
  })
})

describe('★★ 提示词：把"只翻译、不动笔"写在最显眼的地方', () => {
  it('★ 必须明说「不写作文 / 不产出正文」', async () => {
    const f = mockReply(JSON.stringify({ kind: 'undo' }))
    await parseEditInstruction({ cfg: cfg(), text: ESSAY, instruction: '撤销' })

    const init = (f.mock.calls[0] as unknown[])[1] as { body: string }
    const body = JSON.parse(init.body) as { messages: { role: string; content: string }[] }
    const sys = body.messages[0].content

    expect(sys).toContain('不写作文')
    expect(sys).toContain('不产出任何正文')
  })

  it('★ 六种指令形状一个都不能少（少一种，那类说法就废了）', async () => {
    const f = mockReply(JSON.stringify({ kind: 'undo' }))
    await parseEditInstruction({ cfg: cfg(), text: ESSAY, instruction: '撤销' })

    const init = (f.mock.calls[0] as unknown[])[1] as { body: string }
    const body = JSON.parse(init.body) as { messages: { content: string }[] }
    const sys = body.messages[0].content

    for (const k of ['replace', 'insert', 'delete', 'append', 'undo', 'refuse']) {
      expect(sys, k).toContain(`"kind": "${k}"`)
    }
  })

  it('★ 钉住"字必须是原文里的 / 字必须是孩子说的"这两条铁律', async () => {
    const f = mockReply(JSON.stringify({ kind: 'undo' }))
    await parseEditInstruction({ cfg: cfg(), text: ESSAY, instruction: '撤销' })

    const init = (f.mock.calls[0] as unknown[])[1] as { body: string }
    const body = JSON.parse(init.body) as { messages: { content: string }[] }
    const sys = body.messages[0].content

    // 不许编原文里没有的字
    expect(sys).toContain('一字不差出现过的字')
    // 不许润色 / 换同义词 —— 这是"帮写"最容易发生的形态
    expect(sys).toContain('不许润色')
    expect(sys).toContain('不许换同义词')
    // 判定 refuse 看意图不看用词，否则「把优美改成漂亮」会被误拒
    expect(sys).toContain('看**意图**')
  })

  it('★ 旧的「返回全文」契约不许回来', async () => {
    const f = mockReply(JSON.stringify({ kind: 'undo' }))
    await parseEditInstruction({ cfg: cfg(), text: ESSAY, instruction: '撤销' })

    const init = (f.mock.calls[0] as unknown[])[1] as { body: string }
    const body = JSON.parse(init.body) as { messages: { content: string }[] }
    const sys = body.messages[0].content

    expect(sys).not.toContain('"changed"')
    expect(sys).not.toContain('改完之后的完整全文')
  })

  it('原文和孩子说的那句话都要进提示词', async () => {
    const f = mockReply(JSON.stringify({ kind: 'undo' }))
    await parseEditInstruction({ cfg: cfg(), text: ESSAY, instruction: '把小猫改成小狗' })

    const init = (f.mock.calls[0] as unknown[])[1] as { body: string }
    const body = JSON.parse(init.body) as { messages: { content: string }[] }
    const user = body.messages[1].content

    expect(user).toContain(ESSAY)
    expect(user).toContain('把小猫改成小狗')
  })

  it('★ 题目 / 年级 / 家长附加要求不再进提示词 —— 那是"生成正文"的素材', async () => {
    const f = mockReply(JSON.stringify({ kind: 'undo' }))
    await parseEditInstruction({
      cfg: cfg({ extraPrompt: '多用比喻和拟人，结尾要有感悟' }),
      text: ESSAY,
      instruction: '撤销',
    })

    const init = (f.mock.calls[0] as unknown[])[1] as { body: string }
    const body = JSON.parse(init.body) as { messages: { content: string }[] }
    const all = body.messages.map((m) => m.content).join('\n')

    // 给了素材，就是在暗示它可以发挥 —— 只翻译不需要这些
    expect(all).not.toContain('多用比喻和拟人')
    expect(all).not.toContain('家长附加要求')
    expect(all).not.toContain('年级')
  })
})

/* ============================================================
   默认配置 —— 守「光填 key 没切 mode」这个静默失败
   ============================================================

   这是「改作文好像没实现」的根因，值得单独钉住：

     shouldUseRemote() 要求 **mode === 'remote' 而且 key 非空**。
     只填 key、mode 还是 'local'，整条大模型链路一声不响地关着 ——
     界面看起来"配好了"，实际走的是本地启发式。
     没有任何报错，所以只能靠测试拦。

   做法：把 mode 从 key 推出来（defaultAiConfig 里一行三元），
   于是「填了 key」和「开了远程」这两件事不可能再分家。
   ============================================================ */

describe('defaultAiConfig · 内置 key 与 mode 必须一致', () => {
  it('★ 填了 key 就等于开了远程 —— 不许出现「有 key 但 mode 还是 local」', () => {
    const c = defaultAiConfig()

    // 这条断言在 key 为空时也成立。
    // 它的价值在于：一旦有人把 key 填上、却把 mode 写死回 'local'，
    // 右边是 true、左边是 false —— 立刻红。
    expect(shouldUseRemote(c)).toBe(c.apiKey.length > 0)
  })

  it('key 为空时安静地走本地，不报错也不提示缺配置', () => {
    const c = defaultAiConfig()
    if (AI_TEST_API_KEY) return // 填了 key 就跳过这条
    expect(c.mode).toBe('local')
    expect(c.apiKey).toBe('')
    expect(shouldUseRemote(c)).toBe(false)
  })

  it('服务商已经预置成 DeepSeek —— 家长只需要给一把 key', () => {
    const c = defaultAiConfig()
    expect(c.baseUrl).toBe('https://api.deepseek.com/v1')
    // ★ 2026-09-20 换成正式名 `deepseek-flash`（V4.1 Flash）。
    //   旧的 `deepseek-chat` 只是临时兼容路由，不该再出现在默认值里。
    expect(c.model).toBe('deepseek-flash')
    expect(c.provider).toBe('openai-compatible')
  })

  it('预设里的 DeepSeek 和默认配置**指向同一个模型名**', () => {
    // 以前这个字符串在三处各写了一遍（默认配置 / 预设 / 设置页 placeholder），
    // 改一处忘两处就会出现"新装的用新模型、老装的还钉在旧的"。
    const preset = AI_PRESETS.find((p) => p.label === 'DeepSeek')
    expect(preset?.model).toBe(defaultAiConfig().model)
    expect(preset?.baseUrl).toBe(defaultAiConfig().baseUrl)
  })

  it('配了远程也留了本地兜底 —— 断网时不该整页报错', () => {
    expect(defaultAiConfig().fallbackToLocal).toBe(true)
  })
})

/* ============================================================
   scoreAndRewrite —— ★ 配图和附加提示词必须真的进到提示词里
   ============================================================

   这一节守的是一个**真的丢了的功能**：

     `buildScoreAndRewriteUserMessage` 以前完全没读 `opts.images` ——
     配图只喂了本地引擎。于是「看图作文」里最要紧的那半
     （图里到底有什么）AI 根本不知道：
     点评只能泛泛而谈，改写也容易漏掉图上最显眼的东西。

   为什么必须用测试守：这是"少传了一个参数"，没有类型错误、没有报错、
   本地引擎那条路还是好的 —— 光看代码和跑一遍都发现不了。
   ============================================================ */

/**
 * 模型「改写后」的正文 —— **必须真是一篇改写**。
 *
 * ⚠️ 这里以前是占位符「改写后的正文。」。2026-09-19 加了「跑偏守卫」之后，
 *    占位符会被正确判定成跑偏（它一个孩子写到的词都没有），
 *    于是所有用例都开始走补问和退回本地的分支。
 *    这不是守卫太严，是**夹具不真实** —— 一份声称是改写的文本，
 *    本来就该留得住孩子写的东西（`ESSAY` 里的「小猫」「阳台」）。
 */
const ESSAY_REWRITE =
  '我家有一只小猫，它最爱趴在阳台上晒太阳，尾巴一甩一甩的，像一根小鞭子。'

/** scoreAndRewrite 需要一份结构完整的模型回复，否则会走本地兜底 */
const SCORE_REPLY = JSON.stringify({
  dimensions: { observation: 80, structure: 80, vocabulary: 80, imagination: 80, emotion: 80 },
  total: 80,
  summary: '写得不错',
  strengths: [{ title: '观察细致', evidence: '小猫', emoji: '👀' }],
  suggestions: [{ title: '多用比喻', how: '试着把小猫比作什么', emoji: '✨' }],
  mindMap: {
    label: '雨后的校园',
    emoji: '🌳',
    children: [
      { label: '开头', emoji: '🚪', children: [{ label: '下雨了', emoji: '✏️' }] },
      { label: '中间', emoji: '🌊', children: [{ label: '小猫看雨', emoji: '👀' }] },
      { label: '结尾', emoji: '🎯', children: [{ label: '雨停了', emoji: '💗' }] },
    ],
  },
  essayText: ESSAY_REWRITE,
  essayHighlights: ['多用比喻'],
  skeletonLines: [{ core: '小猫趴在阳台上晒太阳', modifiers: [], full: ESSAY_REWRITE }],
})

/** 在完整回复上改几项，用来造"模型漏字段"的场景 */
function scoreReply(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...(JSON.parse(SCORE_REPLY) as object), ...over })
}

/** 依次回多段内容（第 N 次调用用第 N 段）—— 用来测"补问" */
function mockReplySeq(contents: string[]) {
  let i = 0
  const fn = vi.fn(async () => {
    const content = contents[Math.min(i, contents.length - 1)]
    i += 1
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => content,
    }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function scoreOpts(
  over: {
    images?: PromptImage[]
    cfg?: AiConfig
    title?: string
    category?: CompositionCategory
    childText?: string
    text?: string
  } = {},
) {
  return {
    text: ESSAY,
    childText: ESSAY,
    grade: 3 as GradeLevel,
    category: 'scene' as const,
    title: '雨后的校园',
    wordRange: [100, 300] as [number, number],
    focus: ['observation'] as ScoreDimension[],
    images: [] as PromptImage[],
    cfg: cfg(),
    ...over,
  }
}

/** 取出第 n 次（默认第一次）真正发给模型的请求体 */
function outgoingBody(f: ReturnType<typeof mockReply>, n = 0): string {
  const init = (f.mock.calls[n] as unknown[])[1] as { body: string }
  return init.body
}

/** 取出真正发给模型的那条 user message */
function outgoingUser(f: ReturnType<typeof mockReply>): string {
  const body = JSON.parse(outgoingBody(f)) as { messages: { content: string }[] }
  return body.messages[1].content
}

/** 取出 system prompt */
function outgoingSystem(f: ReturnType<typeof mockReply>): string {
  const body = JSON.parse(outgoingBody(f)) as { messages: { content: string }[] }
  return body.messages[0].content
}

describe('scoreAndRewrite · ★ 配图必须真的发给 AI', () => {
  it('★ 手写的 caption 是描述，要出现在提示词里', async () => {
    const f = mockReply(SCORE_REPLY)
    await scoreAndRewrite(scoreOpts({ images: [{ sceneKey: 'rain-window', caption: '雨停了' }] }))

    const user = outgoingUser(f)
    expect(user).toContain('这道题的配图')
    expect(user).toContain('雨停了')
  })

  it('★ 没写 caption 时退回场景自带的中文描述（hint）', async () => {
    const f = mockReply(SCORE_REPLY)
    await scoreAndRewrite(scoreOpts({ images: [{ sceneKey: 'rain-window' }] }))

    // scenes.tsx 里 rain-window 的 hint
    expect(outgoingUser(f)).toContain('一只猫蹲在窗台看雨')
  })

  it('★「第 2 幅」只是位置标记，不能当画面描述发过去', async () => {
    const f = mockReply(SCORE_REPLY)
    await scoreAndRewrite(
      scoreOpts({
        images: [
          { sceneKey: 'rain-window', caption: '第 1 幅' },
          { sceneKey: 'rainbow', caption: '第 2 幅' },
        ],
      }),
    )

    const user = outgoingUser(f)
    // 位置标记由代码自己拼，描述得是真正的画面内容
    expect(user).toContain('第 1 幅')
    expect(user).toContain('一只猫蹲在窗台看雨')
    expect(user).toContain('一道六色彩虹架在天地之间')
    expect(user).not.toContain('第 1 幅：第 1 幅')
  })

  it('没有配图时不留一个空的「配图」段落', async () => {
    const f = mockReply(SCORE_REPLY)
    await scoreAndRewrite(scoreOpts({ images: [] }))
    expect(outgoingUser(f)).not.toContain('这道题的配图')
  })
})

/* ============================================================
   ★★ 「评价里的东西必须真的是 AI 分析的」
   ============================================================

   家长 2026-09-19 报的：

     「似乎 作文的结构 并不是AI分析的。评价里的东西 都需要 AI 分析。」

   查下来是真的：模型少给哪一项，旧实现就静默拿**本地模板**顶上，
   而界面上还写着「本次由远程 AI 评分」。实测最刺眼的两处：

     · 结构图是本地模板（「我的作文 · 真情实感最强」+「感官描写：视觉」）
     · 本地总评写「你做到了 61 分」，而总分是模型给的 85 —— 自相矛盾

   修法是两条：**缺项就补问一次**；补不齐就**整份退回本地**并如实标成 local。
   这一节把两条都钉住。
   ============================================================ */

describe('★★ 评价必须整份都是 AI 分析的', () => {
  /** 模型偷懒：只给了分数和正文，点评和结构全没给 */
  const INCOMPLETE = JSON.stringify({
    dimensions: { observation: 88, structure: 82, vocabulary: 80, imagination: 85, emotion: 90 },
    total: 85,
    essayText: ESSAY_REWRITE,
  })

  it('★ 一次就齐 → 只发一次请求，不补问', async () => {
    const f = mockReplySeq([SCORE_REPLY])
    const r = await scoreAndRewrite(scoreOpts())

    expect(f).toHaveBeenCalledTimes(1)
    expect(r.score.engine).toBe('remote')
    expect(r.essay.engine).toBe('remote')
    expect(r.warning).toBeUndefined()
  })

  it('★ 漏了点评 → 补问一次，并把"漏了什么"点名告诉它', async () => {
    const f = mockReplySeq([INCOMPLETE, SCORE_REPLY])
    await scoreAndRewrite(scoreOpts())

    expect(f, '漏了就要补问一次').toHaveBeenCalledTimes(2)

    const body = JSON.parse(outgoingBody(f, 1)) as {
      messages: { role: string; content: string }[]
    }
    // 补问必须带上模型上一次的原话 —— 它能看到自己刚写的，只补缺口就行
    expect(body.messages.some((m) => m.role === 'assistant')).toBe(true)
    const last = body.messages[body.messages.length - 1]
    expect(last.role).toBe('user')
    expect(last.content).toContain('summary')
    expect(last.content).toContain('mindMap')
    expect(last.content).toContain('strengths')
    expect(last.content).toContain('suggestions')
  })

  it('★ 补齐之后，结构图 / 总评 / 好在哪 用的都是模型给的那份', async () => {
    mockReplySeq([INCOMPLETE, SCORE_REPLY])
    const r = await scoreAndRewrite(scoreOpts())

    expect(r.score.engine).toBe('remote')
    // 这几条只要有一条是本地模板，就等于"结构不是 AI 分析的"
    expect(r.score.mindMap.label).toBe('雨后的校园')
    expect(r.score.mindMap.children?.map((c) => c.label)).toEqual(['开头', '中间', '结尾'])
    expect(r.score.summary).toBe('写得不错')
    expect(r.score.strengths).toHaveLength(1)
    expect(r.score.suggestions).toHaveLength(1)
  })

  it('★ 补问还是缺 → **整份退回本地**，界面才不会说「AI 评分」', async () => {
    mockReplySeq([INCOMPLETE, INCOMPLETE])
    const r = await scoreAndRewrite(scoreOpts())

    expect(r.score.engine).toBe('local')
    expect(r.engine).toBe('local')
    expect(r.warning).toContain('本地引擎')
    /*
     * 关键：不许出现"模型给的总分 + 本地总评"这种自相矛盾。
     * 本地总评会写「你做到了 XX 分」，那个 XX 是本地算的 ——
     * 一旦和模型给的 85 并排出现，孩子看到的就是两个打架的数。
     */
    expect(r.score.summary).not.toContain('85')
  })

  it('★ 整份退回时，写法仍然是 AI 改写的（别把好的也一起扔了）', async () => {
    mockReplySeq([INCOMPLETE, INCOMPLETE])
    const r = await scoreAndRewrite(scoreOpts())

    expect(r.score.engine).toBe('local')
    expect(r.essay.engine).toBe('remote')
    expect(r.essay.text).toBe(ESSAY_REWRITE)
  })

  it('★ 补问那次请求失败 → 不炸，用第一次那份走降级', async () => {
    let i = 0
    const fn = vi.fn(async () => {
      i += 1
      if (i === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: INCOMPLETE } }] }),
          text: async () => INCOMPLETE,
        }
      }
      throw new Error('Failed to fetch')
    })
    vi.stubGlobal('fetch', fn)

    const r = await scoreAndRewrite(scoreOpts())
    expect(r.score.engine).toBe('local')
    expect(r.essay.text).toBe(ESSAY_REWRITE)
  })

  it('★ 结构图只有一条分支 = 没分析出结构，也要补问', async () => {
    // 「开头/中间/结尾」至少两条才叫结构；只有一条等于什么都没拆
    const oneBranch = scoreReply({
      mindMap: { label: 'x', emoji: '🌳', children: [{ label: '开头', emoji: '🚪' }] },
    })
    const f = mockReplySeq([oneBranch, SCORE_REPLY])
    await scoreAndRewrite(scoreOpts())

    expect(f).toHaveBeenCalledTimes(2)
    const body = JSON.parse(outgoingBody(f, 1)) as {
      messages: { content: string }[]
    }
    expect(body.messages[body.messages.length - 1].content).toContain('mindMap')
  })
})

/* ============================================================
   ★★ 「更好的写法」必须结合图和用户写的
   ============================================================

   家长 2026-09-19 报的：

     「还有更好的写法 也还是有问题。 要结合 图 和 用户写的」

   上一轮往提示词里补了配图，为什么还是不行 —— 因为**光把图发给模型，
   不等于它会照着写**。实测（mock 一次跑题回复）：孩子写雪，模型回
   「推开窗，一片《春天的公园》扑面而来。清晨的阳光洒在操场上……」，
   一个字都对不上，可当时**照收不误**，界面上还写着「更好的写法」。

   这一节钉住两件事：
     · 提示词里要**点名**列出「孩子写到的必须留住」和「图上有的要补进去」；
     · 回来后要**照清单核对**，一条都没留住就是跑偏 → 补问 → 还跑偏就退回本地。
   ============================================================ */

describe('★★ 更好的写法必须结合图和用户写的', () => {
  /** 跑偏的改写：跟 ESSAY（小猫、阳台/校园）一个字都对不上 */
  const OFF_TOPIC = scoreReply({
    essayText: '推开窗，一片春天的公园扑面而来。清晨的阳光洒在操场上，暖暖的。',
  })

  it('★ 不许在提示词里告诉模型「这是写事」—— 那等于让它编剧情', async () => {
    /*
     * 题库里「看图作文」的 category 是 event（写事），
     * 直接照抄进提示词，模型就会编一段「手心里全是汗」出来 ——
     * 和本地引擎踩的是同一个坑。
     */
    const f = mockReplySeq([SCORE_REPLY])
    await scoreAndRewrite(
      scoreOpts({
        title: '看图写话',
        category: 'event',
        childText: '下雪了。我和小明在雪地里打雪仗，还堆了一个雪人。',
        text: '下雪了。我和小明在雪地里打雪仗，还堆了一个雪人。',
        images: [{ sceneKey: 'rainbow' }],
      }),
    )

    const body = JSON.parse(outgoingBody(f, 0)) as {
      messages: { role: string; content: string }[]
    }
    const user = body.messages.find((m) => m.role === 'user')!.content
    expect(user).not.toContain('类型：写事')
    expect(user).toContain('类型：写景')
  })

  it('★ 提示词里点名列出「这篇作文里的必须留住」和「图上有的要补进正文」', async () => {
    const f = mockReplySeq([SCORE_REPLY])
    await scoreAndRewrite(
      scoreOpts({
        images: [{ sceneKey: 'rainbow' }],
      }),
    )

    const body = JSON.parse(outgoingBody(f, 0)) as {
      messages: { role: string; content: string }[]
    }
    const user = body.messages.find((m) => m.role === 'user')!.content
    // 这篇作文里的（题目的「校园」+ 正文的「小猫」）要一条条列出来
    expect(user).toContain('改写必须留住')
    expect(user).toContain('小猫')
    // 图上有的（彩虹）也要列出来
    expect(user).toContain('要补进正文')
    expect(user).toContain('彩虹')
  })

  it('★ 改写跑偏 → 补问一次，并点名它丢了什么', async () => {
    const f = mockReplySeq([OFF_TOPIC, SCORE_REPLY])
    const r = await scoreAndRewrite(scoreOpts())

    expect(f, '跑偏了就要补问').toHaveBeenCalledTimes(2)

    const body = JSON.parse(outgoingBody(f, 1)) as {
      messages: { role: string; content: string }[]
    }
    // 补问同样要带上模型上一次的原话
    expect(body.messages.some((m) => m.role === 'assistant')).toBe(true)
    const last = body.messages[body.messages.length - 1]
    expect(last.content).toContain('跑偏')
    expect(last.content).toContain('小猫')

    // 补问回来的这份是好的 → 采纳它
    expect(r.essay.engine).toBe('remote')
    expect(r.essay.text).toBe(ESSAY_REWRITE)
    expect(r.warning).toBeUndefined()
  })

  it('★ 补问还跑偏 → 写法退回本地，但评价不受牵连', async () => {
    mockReplySeq([OFF_TOPIC, OFF_TOPIC])
    const r = await scoreAndRewrite(scoreOpts())

    /*
     * 评价是就孩子**原文**做的分析，跟改写跑没跑偏无关 ——
     * 它不该因为写法跑偏被一起扔掉。
     */
    expect(r.score.engine).toBe('remote')
    expect(r.score.summary).toBe('写得不错')

    // 写法必须退回本地，并且真的在写孩子的东西
    expect(r.essay.engine).toBe('local')
    expect(r.essay.text).toContain('小猫')
    expect(r.essay.text).not.toContain('春天的公园')
    expect(r.warning).toContain('跑偏')
  })

  it('★ 不跑偏就不要多问一次（别把好好的流程拖长）', async () => {
    const f = mockReplySeq([SCORE_REPLY])
    const r = await scoreAndRewrite(scoreOpts())

    expect(f).toHaveBeenCalledTimes(1)
    expect(r.essay.engine).toBe('remote')
  })

  it('★ 孩子什么都没写具体时，用图里的清单判定跑偏', async () => {
    /*
     * 低年级常见：「今天我很开心。」—— 一个具体名物都没有。
     * 题目也要挑一个不含人物/地点/物件的（「雨后的校园」会带进「校园」，
     * 那是**题目**给的锚点，不是这里要测的情形）。
     */
    const opts = scoreOpts({
      title: '看图写话',
      childText: '今天我很开心。',
      text: '今天我很开心。',
      images: [{ sceneKey: 'rainbow' }],
    })
    // 改写里没有图上的彩虹 → 跑偏
    const f = mockReplySeq([OFF_TOPIC, SCORE_REPLY])
    await scoreAndRewrite(opts)

    expect(f, '孩子没写具体东西时，图就是唯一的锚点').toHaveBeenCalledTimes(2)
    const body = JSON.parse(outgoingBody(f, 1)) as {
      messages: { content: string }[]
    }
    expect(body.messages[body.messages.length - 1].content).toContain('彩虹')
  })

  it('★ 补生成那条路（generateModelEssay）同样要拦跑偏', async () => {
    // 这条路回复的形状不同：是 `text`，不是 `essayText`
    const offTopicEssay = JSON.stringify({
      text: '推开窗，一片春天的公园扑面而来。清晨的阳光洒在操场上，暖暖的。',
      highlights: ['多用比喻'],
      skeletonLines: [],
    })
    mockReplySeq([offTopicEssay, offTopicEssay])
    const r = await generateModelEssay(essayOpts())

    expect(r.engine).toBe('local')
    expect(r.essay.text).toContain('小猫')
    expect(r.warning).toContain('跑偏')
  })

  it('★ 补生成这条路，模型没给亮点/骨架时不许借本地范文的', async () => {
    // 以前这里拿的是 `fallback.highlights` / `fallback.skeletonLines` ——
    // 本地那篇范文的，和模型写的正文不是一篇
    mockReplySeq([
      JSON.stringify({ text: ESSAY_REWRITE, highlights: [], skeletonLines: [] }),
    ])
    const r = await generateModelEssay(essayOpts())

    expect(r.essay.engine).toBe('remote')
    expect(r.essay.highlights).toEqual([])
    // 骨架从**模型自己那篇正文**推 —— 每一行都必须能在正文里找到
    expect(r.essay.skeletonLines.length).toBeGreaterThan(0)
    for (const l of r.essay.skeletonLines) {
      expect(r.essay.text, `骨架「${l.full}」不在正文里`).toContain(l.full)
    }
  })
})

describe('★★ 背诵骨架不许借本地范文的', () => {
  it('★ 模型没给骨架 → 从**模型自己那篇正文**推', async () => {
    // 以前这里是 `fallback.essay.skeletonLines` —— 本地那篇范文的骨架。
    // 模型写的正文和本地范文是**两篇不同的文章**，
    // 背诵挑战会让孩子背的句子和看到的正文对不上。
    mockReplySeq([scoreReply({ skeletonLines: undefined })])
    const r = await scoreAndRewrite(scoreOpts())

    expect(r.essay.skeletonLines.length).toBeGreaterThan(0)
    for (const l of r.essay.skeletonLines) {
      expect(r.essay.text, `骨架「${l.full}」不在模型写的正文里`).toContain(l.full)
    }
  })

  it('★ 模型给了骨架 → 用模型给的，不自己重推', async () => {
    mockReplySeq([scoreReply({ skeletonLines: [{ core: '主干', modifiers: ['修饰'], full: '主干修饰' }] })])
    const r = await scoreAndRewrite(scoreOpts())

    expect(r.essay.skeletonLines).toHaveLength(1)
    expect(r.essay.skeletonLines[0].core).toBe('主干')
    expect(r.essay.skeleton).toBe('主干')
  })

  it('★ 模型给的骨架行缺 core/full → 丢掉，不要留下半行', async () => {
    mockReplySeq([
      scoreReply({
        skeletonLines: [{ core: '有主干', modifiers: [], full: '有主干。' }, { core: '' }, { full: '只有全文' }],
      }),
    ])
    const r = await scoreAndRewrite(scoreOpts())

    expect(r.essay.skeletonLines).toHaveLength(1)
    expect(r.essay.skeletonLines[0].core).toBe('有主干')
  })

  it('模型没给 highlights → 不拿本地那篇的顶上（那是另一篇的说法）', async () => {
    mockReplySeq([scoreReply({ essayHighlights: undefined }), scoreReply({ essayHighlights: undefined })])
    const r = await scoreAndRewrite(scoreOpts())
    expect(r.essay.highlights).toEqual([])
  })
})

describe('scoreAndRewrite · 附加提示词和家长的要求', () => {
  it('★ 设置里的附加提示词要单独成块，并明说必须落实', async () => {
    const f = mockReply(SCORE_REPLY)
    await scoreAndRewrite(
      scoreOpts({ cfg: cfg({ extraPrompt: '多用比喻和拟人，结尾要有感悟' }) }),
    )

    const user = outgoingUser(f)
    expect(user).toContain('多用比喻和拟人，结尾要有感悟')
    // 以前它只是跟在「类型：」后面的一句话，很容易被模型当背景噪音
    expect(user).toContain('必须落实')
  })

  it('没填附加提示词时不出现空的要求块', async () => {
    const f = mockReply(SCORE_REPLY)
    await scoreAndRewrite(scoreOpts())
    expect(outgoingUser(f)).not.toContain('家长附加要求')
  })
})

describe('scoreAndRewrite · ★ 提示词里的硬要求（改掉等于悄悄改需求）', () => {
  it('★ 评分那一半仍然禁止替孩子写句子', async () => {
    const f = mockReply(SCORE_REPLY)
    await scoreAndRewrite(scoreOpts())
    expect(outgoingSystem(f)).toContain('绝对禁止')
  })

  it('★ 改写那一半要"接近满分"，且要补上孩子漏掉的画面', async () => {
    const f = mockReply(SCORE_REPLY)
    await scoreAndRewrite(scoreOpts())

    const sys = outgoingSystem(f)
    expect(sys).toContain('接近满分')
    expect(sys).toContain('漏掉的关键画面')
    // 保留孩子的思路 —— 不然就变成"别人家孩子的作文"了
    expect(sys).toContain('这是我写的')
  })

  it('★ 界面已经不叫「满分范文」了，提示词也别再自称满分', async () => {
    const f = mockReply(SCORE_REPLY)
    await scoreAndRewrite(scoreOpts())
    expect(outgoingSystem(f)).not.toContain('满分范文')
    expect(outgoingSystem(f)).toContain('更好的写法')
  })
})

/* ============================================================
   generateModelEssay —— 补生成那条路必须和主路一个口径
   ============================================================

   同一个东西有两个入口：
     · 提交作文时 → `scoreAndRewrite` 一次出评分 + 写法
     · 提交时没生成出来 → 点按钮时走 `generateModelEssay` 补一次

   以前这两条的**口径是相反的**：主路说"改孩子的作文"，
   补生成那条说"另写一篇标杆范文，不是改学生的作文"。
   于是补生成出来的东西跟前面不是一回事，孩子看到两种东西。

   这一节盯的就是"两条路不许走散"。
   ============================================================ */

const ESSAY_REPLY = JSON.stringify({
  text: ESSAY_REWRITE,
  highlights: ['多用比喻'],
  skeletonLines: [],
})

function essayOpts(over: { images?: PromptImage[]; cfg?: AiConfig } = {}) {
  return {
    childText: ESSAY,
    title: '雨后的校园',
    grade: 3 as GradeLevel,
    category: 'scene' as const,
    wordRange: [100, 300] as [number, number],
    images: [] as PromptImage[],
    cfg: cfg(),
    ...over,
  }
}

describe('generateModelEssay · 补生成要和主路一个口径', () => {
  it('★ 也要带配图 —— 不然补生成出来的会漏掉图里的东西', async () => {
    const f = mockReply(ESSAY_REPLY)
    await generateModelEssay(essayOpts({ images: [{ sceneKey: 'rain-window' }] }))

    const user = outgoingUser(f)
    expect(user).toContain('这道题的配图')
    expect(user).toContain('一只猫蹲在窗台看雨')
  })

  it('★ 也要带家长的附加要求（以前这条路完全没读 extraPrompt）', async () => {
    const f = mockReply(ESSAY_REPLY)
    await generateModelEssay(essayOpts({ cfg: cfg({ extraPrompt: '多用比喻和拟人' }) }))

    const user = outgoingUser(f)
    expect(user).toContain('多用比喻和拟人')
    expect(user).toContain('必须落实')
  })

  it('★ 是「改孩子的作文」，不是另写一篇标杆（这两句以前是相反的）', async () => {
    const f = mockReply(ESSAY_REPLY)
    await generateModelEssay(essayOpts())

    const sys = outgoingSystem(f)
    expect(sys).toContain('改孩子的作文')
    expect(sys).toContain('接近满分')
    expect(sys).toContain('漏掉的关键画面')
    // 旧的相反口径不许回来
    expect(sys).not.toContain('不是改学生的作文')
    expect(sys).not.toContain('满分范文')
  })

  it('没配图 / 没附加要求时不留空段落', async () => {
    const f = mockReply(ESSAY_REPLY)
    await generateModelEssay(essayOpts())

    const user = outgoingUser(f)
    expect(user).not.toContain('这道题的配图')
    expect(user).not.toContain('家长附加要求')
  })
})

/* ============================================================
   ★★ 降级到本地引擎时，家长点名的要求必须如实交代
   ============================================================

   家长 2026-09-19 提的：
     「更好的写法，还要结合下 家长设置里的 提示词。类似于点比喻之类的。」

   本地引擎能落实的（比喻/拟人/通感/叠词）已经落实了（见
   modelEssay.ts 的 `demandSentences`）。剩下的是**做不到的那些**
   —— 排比、对话、成语这些要按内容现写，模板拼不出来。

   做不到本身不是错，**装作做到了才是错**：
   家长会一直以为设置生效了、只是孩子写得不够好，
   于是反复改设置、反复重算，永远找不到原因。

   这一节守的就是「说」和「不说」的分界。
   ============================================================ */

describe('★★ 本地引擎做不到的家长要求，要如实说（不许装作做到了）', () => {
  /** 强制走本地引擎：mode 不是 remote 就不调 AI */
  const local = (extraPrompt: string) => cfg({ mode: 'local', extraPrompt })

  it('★ 点了「排比」而这次走本地 → 警告里点名说做不到', async () => {
    const r = await generateModelEssay(essayOpts({ cfg: local('多用排比，语言要生动') }))
    expect(r.engine).toBe('local')
    expect(r.warning).toContain('排比')
    expect(r.warning).toContain('做不到')
    // 得让家长知道下一步怎么办，不然这条警告只是添堵
    expect(r.warning).toContain('配好 AI')
  })

  it('★ 点了「比喻」而这次走本地 → 不许多说一句「做不到」', async () => {
    // 比喻是本地引擎**真的**落实了的，再警告一遍就是撒谎
    const r = await generateModelEssay(essayOpts({ cfg: local('多用比喻') }))
    expect(r.engine).toBe('local')
    expect(r.warning ?? '').not.toContain('做不到')
    // 而且是真的落实了 —— 不是嘴上说说
    expect(usedRhetoric(r.essay.text)).toContain('比喻')
  })

  it('★ 一句都没要求时，不许平白多出一条警告', async () => {
    const r = await generateModelEssay(essayOpts({ cfg: local('') }))
    expect(r.warning).toBeUndefined()
  })

  it('★ scoreAndRewrite 降级到本地时也要说', async () => {
    const r = await scoreAndRewrite(scoreOpts({ cfg: local('要有对话描写和成语') }))
    expect(r.engine).toBe('local')
    expect(r.warning).toContain('对话描写')
    expect(r.warning).toContain('成语')
  })

  it('★ 两条路（评分改写 / 补生成）口径一致 —— 不许一条说一条不说', async () => {
    const a = await generateModelEssay(essayOpts({ cfg: local('多用排比') }))
    const b = await scoreAndRewrite(scoreOpts({ cfg: local('多用排比') }))
    expect(a.warning).toContain('排比')
    expect(b.warning).toContain('排比')
  })
})

/* ============================================================
   isEssayStale —— ★「我改了设置，怎么没变化？」
   ============================================================

   写法是**存进作品里**的，点进去默认直接展示、不重算（为了省一次 AI 调用）。
   于是家长第一次把密钥填上之后，看到的还是旧引擎写的那份，
   只会得出「改动没生效」—— 而代码其实生效了，只是没人去重算。

   这个函数就是判断"该不该提示重新生成"。
   ============================================================ */

describe('isEssayStale · 存着的那份写法是不是跟当前配置对不上', () => {
  const localCfg = defaultAiConfig() // 默认就是 local
  const remoteCfg = cfg() // mode: remote + 有 key

  it('两边都是本地 → 不算旧', () => {
    expect(isEssayStale({ engine: 'local' }, localCfg)).toBe(false)
  })

  it('★ 存的是本地写的、现在已经配好 AI → 算旧（要提示重算）', () => {
    expect(isEssayStale({ engine: 'local' }, remoteCfg)).toBe(true)
  })

  it('两边都是远程 → 不算旧', () => {
    expect(isEssayStale({ engine: 'remote' }, remoteCfg)).toBe(false)
  })

  it('存的是 AI 写的、但 AI 被关掉了 → 也算对不上', () => {
    expect(isEssayStale({ engine: 'remote' }, localCfg)).toBe(true)
  })

  it('★ 老数据没有 engine 字段：不判断，不许误报"这是旧的"', () => {
    // 这个字段是后加的，历史作品全都没有。
    // 误报会让一堆老作品都跳"重新生成"，比不提示更烦。
    expect(isEssayStale({}, remoteCfg)).toBe(false)
    expect(isEssayStale({}, localCfg)).toBe(false)
  })

  it('压根没有写法 → 不算旧（那是"还没生成"，另一条路）', () => {
    expect(isEssayStale(undefined, remoteCfg)).toBe(false)
  })

  it('只填了密钥、没切远程 → 仍然是本地，跟本地写的那份对得上', () => {
    // 这条守的是"半个配置"：shouldUseRemote 要求 mode 也切过去
    const half = { ...defaultAiConfig(), apiKey: 'sk-test' }
    expect(isEssayStale({ engine: 'local' }, half)).toBe(false)
    expect(isEssayStale({ engine: 'remote' }, half)).toBe(true)
  })
})

/* ============================================================
   ★★ 指位字段（near / side / pick）—— 2026-09-21 补

   家长 09-20 报的「很多都理解有问题，没法改」，**结构性根因**就在这里：
   只有 `replace-punct` 有 `near`，`replace` / `delete` 没有 ——
   孩子说「把玩篮球**后面的那个字**去掉」时，**模型没有字段可以表达"哪儿"**。

   修法不是"让模型猜"，而是：
     ① 提示词告诉它「你看得见原文，先往下读一眼，把那一处落成**真实存在的字**」；
     ② 类型上给它 `near` / `side` / `pick`，让它能说清"是哪一个"。
   下面这两条守的就是这个闭环。
   ============================================================ */

describe('★★ 指位字段：模型能表达"是哪一处"了', () => {
  const TEXT = '半大的小学生在操场上玩篮球。'

  it('★ 「把玩篮球后面的那个字去掉」→ 模型填字面量 + near，落到正确那一处', async () => {
    // 模型看得见原文，所以 target 填的是**原文里真实的那个字**（「。」），
    // 不是孩子说的「那个字」三个字。
    //
    // ⚠️ 正文**故意让「。」出现两次** —— 否则目标唯一，有没有 near 都能命中，
    //    这条测试就守不住 near（第一版就是这样，变异验证时它没红）。
    const two = '半大的小学生在操场上玩篮球。小学生在操场上跑步。'
    mockReply(JSON.stringify({ kind: 'delete', target: '。', near: '玩篮球' }))
    const r = await parseEditInstruction({
      cfg: cfg(),
      text: two,
      instruction: '把玩篮球后面的那个字去掉',
    })
    expect(r.ok).toBe(true)
    expect(r.intent).toMatchObject({ kind: 'delete', target: '。', near: '玩篮球' })

    const applied = applyEdit(two, r.intent!, 1, 'ai')
    expect(applied.ok, applied.ok ? '' : applied.message).toBe(true)
    // 删的是「玩篮球」后面那个句号，不是句末那个
    expect(applied.text).toBe('半大的小学生在操场上玩篮球小学生在操场上跑步。')
  })

  it('★ 「把操场上后面的玩篮球改成打篮球」→ replace 也能用 near 指位', async () => {
    mockReply(
      JSON.stringify({ kind: 'replace', from: '玩篮球', to: '打篮球', near: '操场上' }),
    )
    const r = await parseEditInstruction({
      cfg: cfg(),
      text: TEXT,
      instruction: '把操场上后面的玩篮球改成打篮球',
    })
    expect(r.ok).toBe(true)

    const applied = applyEdit(TEXT, r.intent!, 1, 'ai')
    expect(applied.ok, applied.ok ? '' : applied.message).toBe(true)
    expect(applied.text).toBe('半大的小学生在操场上打篮球。')
  })

  it('★ 目标出现多次 + 孩子说了「最后的」→ 用 pick，不再弹候选面板', async () => {
    const text = '小猫很可爱，小猫爱吃鱼。'
    mockReply(JSON.stringify({ kind: 'delete', target: '猫', pick: 'last' }))
    const r = await parseEditInstruction({
      cfg: cfg(),
      text,
      instruction: '把最后一个猫去掉',
    })
    expect(r.ok).toBe(true)

    const applied = applyEdit(text, r.intent!, 1, 'ai')
    expect(applied.ok, applied.ok ? '' : applied.message).toBe(true)
    // 删的是**第二处**的猫（index 7），不是第一处
    expect(applied.text).toBe('小猫很可爱，小爱吃鱼。')
  })

  it('⚠️ 白名单外的 side / pick 一律丢掉，别把垃圾传下去', async () => {
    mockReply(
      JSON.stringify({ kind: 'delete', target: '。', near: '玩篮球', side: 'middle', pick: 'nope' }),
    )
    const r = await parseEditInstruction({
      cfg: cfg(),
      text: TEXT,
      instruction: '把玩篮球后面那个东西去掉',
    })
    expect(r.ok).toBe(true)
    const intent = r.intent as { side?: string; pick?: string }
    expect(intent.side, 'side 只认 after / before').toBeUndefined()
    expect(intent.pick, 'pick 只认 last / first').toBeUndefined()
  })

  it('★★ 对照：孩子**没说**是哪一处时，仍然停下来问（好设计别优化掉）', async () => {
    // 这条是防"顺手把消歧也绕过去"的：指位字段是**孩子自己指好了**才用，
    // 他什么都没说时，程序不许替他挑一个 —— 改错地方比不改更糟。
    const text = '小猫很可爱，小猫爱吃鱼。'
    mockReply(JSON.stringify({ kind: 'delete', target: '猫' }))
    const r = await parseEditInstruction({
      cfg: cfg(),
      text,
      instruction: '把猫去掉',
    })
    expect(r.ok).toBe(true)

    const applied = applyEdit(text, r.intent!, 1, 'ai')
    expect(applied.ok).toBe(false)
    expect(applied.reason).toBe('ambiguous')
    expect(applied.candidates?.length).toBe(2)
  })
})
