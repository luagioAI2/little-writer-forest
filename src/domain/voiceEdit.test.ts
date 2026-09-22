import { describe, expect, it } from 'vitest'
import {
  addUtterance,
  applyEdit,
  applyReplaceAt,
  buildRevisionDiff,
  changedSpan,
  editStats,
  parseEditIntent,
  revisionPraise,
  sentenceChange,
  undoEdit,
} from './voiceEdit'

describe('编辑意图识别', () => {
  it('「把 A 改成 B」', () => {
    expect(parseEditIntent('把棍子改成竹签')).toEqual({
      kind: 'replace',
      from: '棍子',
      to: '竹签',
    })
  })

  it('「A 变成 B」—— 需求里的原例', () => {
    expect(parseEditIntent('棍子变成竹签')).toEqual({
      kind: 'replace',
      from: '棍子',
      to: '竹签',
    })
  })

  it('「把 A 换成 B」', () => {
    expect(parseEditIntent('把小猫换成小狗')).toEqual({
      kind: 'replace',
      from: '小猫',
      to: '小狗',
    })
  })

  it('「A 改为 B」', () => {
    expect(parseEditIntent('红色改为蓝色')).toEqual({
      kind: 'replace',
      from: '红色',
      to: '蓝色',
    })
  })

  it('「加上 X」识别为追加', () => {
    expect(parseEditIntent('加上天上有一只小鸟')).toEqual({
      kind: 'append',
      text: '天上有一只小鸟',
    })
  })

  it('「补充 X」识别为追加', () => {
    expect(parseEditIntent('补充他很开心')).toEqual({ kind: 'append', text: '他很开心' })
  })

  it('「把 A 删掉」识别为删除', () => {
    expect(parseEditIntent('把然后删掉')).toEqual({ kind: 'delete', target: '然后' })
  })

  it('「A 去掉」识别为删除', () => {
    expect(parseEditIntent('那个词去掉')).toEqual({ kind: 'delete', target: '那个词' })
  })

  it('撤销类指令', () => {
    expect(parseEditIntent('撤销').kind).toBe('undo')
    expect(parseEditIntent('刚才那个不算').kind).toBe('undo')
    expect(parseEditIntent('重来').kind).toBe('undo')
  })

  it('听不懂的就老实说听不懂，绝不瞎猜', () => {
    // 这是最重要的安全边界：不确定就不动孩子的文字
    expect(parseEditIntent('今天天气不错').kind).toBe('unknown')
    expect(parseEditIntent('嗯').kind).toBe('unknown')
  })

  it('结尾标点不影响识别', () => {
    expect(parseEditIntent('把棍子改成竹签。')).toEqual({
      kind: 'replace',
      from: '棍子',
      to: '竹签',
    })
  })
})

/* ============================================================
   ★★ 「在 X 后面加 Y」—— 曾经整类说法都识别不了
   ============================================================

   家长 2026-09-19 报的原例：

     「写的 是 小明 正在吃饭。录音 小明后面加 那个时候。就处理不了。」

   查下来不是"限制太多"，是**这一类说法压根没有对应分支**：
   老的 APPEND_PATTERNS 只会把内容挂到整句末尾，所以
   「小明后面加那个时候」要么 unknown，要么更糟 ——
   被当成"在最后补一句"，结果是「小明正在吃饭。那个时候」，
   位置全错，而且还报了成功。改错地方比不改更糟。

   这一节钉的就是这个位置语义。
   ============================================================ */

describe('★★ 插入（在某个字的前面/后面）', () => {
  it('★ 家长报的原例：「小明后面加那个时候」', () => {
    expect(parseEditIntent('小明后面加那个时候')).toEqual({
      kind: 'insert',
      anchor: '小明',
      text: '那个时候',
      position: 'after',
    })
  })

  it('「把 Y 加到 X 后面」—— 语序反过来说也认', () => {
    expect(parseEditIntent('把那个时候加到小明后面')).toEqual({
      kind: 'insert',
      anchor: '小明',
      text: '那个时候',
      position: 'after',
    })
  })

  it('「X 和 Z 之间加上 Y」—— 插到第二个名字前面', () => {
    // 「和」是挂在第一个成分尾巴上的（「小明和」= "小明 and"），
    // 所以两个名字中间的空档在「和」之后、第二个名字之前。
    // 插到「和」前面会变成「小明那个时候和小刚」，更不通。
    expect(parseEditIntent('小明和小刚之间加上那个时候')).toEqual({
      kind: 'insert',
      anchor: '小刚',
      text: '那个时候',
      position: 'before',
    })
  })

  it('「在 X 前面加 Y」—— 前插', () => {
    expect(parseEditIntent('在小明前面加小红')).toEqual({
      kind: 'insert',
      anchor: '小明',
      text: '小红',
      position: 'before',
    })
  })

  it('★ 位置词要整体匹配：「后面」不能被拆成「后」+「面加…」', () => {
    // 正则的 | 是**先匹配先赢**。如果 AFTER_WORDS 把「后」写在「后面」前面，
    // 那么「小明后面加小红」会在「后」处停下，剩下「面加小红」再也匹配不上动词，
    // 整条指令就掉进 unknown。这类 bug 不会报错，只会"有时候听不懂"。
    for (const said of ['小明后面加小红', '小明后边加小红', '小明后头加小红']) {
      expect(parseEditIntent(said), said).toEqual({
        kind: 'insert',
        anchor: '小明',
        text: '小红',
        position: 'after',
      })
    }
  })

  it('★「之后」必须是后插 —— 它踩过一次"看起来是后、被判成前"', () => {
    // 第一版判断前/后用的是 `word.startsWith('后')`。
    // 「之后」以「之」开头 → 判成前插 → 意思**说反**，而且不报任何错。
    // 现在改成查表，这条盯着它别退回去。
    expect(parseEditIntent('小明之后加小红')).toEqual({
      kind: 'insert',
      anchor: '小明',
      text: '小红',
      position: 'after',
    })
    // 前插那一侧同样要准
    expect(parseEditIntent('小明之前加小红')).toMatchObject({ position: 'before' })
    expect(parseEditIntent('小明前面加小红')).toMatchObject({ position: 'before' })
    expect(parseEditIntent('小明前边加小红')).toMatchObject({ position: 'before' })
  })

  it('★ 插入真的落在锚点旁边 —— 不是接到句尾', () => {
    // 家长报的 bug 的另一半：字是加上了，但加在错的地方，还报成功。
    // 这里连**位置**一起断言，光看"有没有加上"是抓不到的。
    const r = applyEdit(
      '小明正在吃饭。',
      parseEditIntent('小明后面加那个时候'),
      1,
    )
    expect(r.ok).toBe(true)
    expect(r.text).toBe('小明那个时候正在吃饭。')

    const before = applyEdit('小明正在吃饭。', parseEditIntent('在小明前面加那个时候'), 1)
    expect(before.text).toBe('那个时候小明正在吃饭。')
  })

  it('★ 没有锚点的「加上 X」还是追加到末尾，不许被 insert 抢走', () => {
    // 「加上那个时候」里也有「加上」，但它没说加在哪里 —— 那就是整篇最后
    expect(parseEditIntent('加上那个时候')).toEqual({ kind: 'append', text: '那个时候' })
  })

  it('找不到锚点时一动不动，并说清是哪个字没找到', () => {
    const r = applyEdit('小明正在吃饭。', { kind: 'insert', anchor: '小红', text: '呀', position: 'after' }, 1)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not-found')
    expect(r.text).toBe('小明正在吃饭。')
    expect(r.message).toContain('小红')
  })

  it('锚点出现多次时停下来问，且问法要带上"后面/前面"', () => {
    const r = applyEdit(
      '小明在跑，小明在笑。',
      { kind: 'insert', anchor: '小明', text: '呀', position: 'after' },
      1,
    )
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('ambiguous')
    expect(r.candidates).toHaveLength(2)
    expect(r.message).toContain('后面')
  })
})

/* ============================================================
   ★★ 「不许 AI 帮写」的另一半：拒绝替孩子生产内容
   ============================================================

   家长的原话：

     「不允许 AI 自己生产内容。类似『给这个句子加点比喻』等等都不行。」

   ⚠️ 拒绝**必须和"没听懂"分开**。
     如果「加点比喻」回的是"没太听懂"，孩子会一遍遍换说法再试；
     必须直接告诉他"这件事得你自己做"，他才会去自己想。

   难点全在**别误伤**：孩子说「把优美改成漂亮」时，句子里也有
   "优美"这种像内容要求的词，但那是他在指挥自己改字，不是让 AI 代写。
   ============================================================ */

describe('★★ 拒绝替孩子生产内容', () => {
  it('「加点比喻」这类要求 → refuse，不是 unknown', () => {
    for (const said of [
      '给这个句子加点比喻',
      '加点比喻',
      '加上一个比喻',
      '加个比喻吧',
      '帮我润色一下',
      '润色',
      '扩写一下',
      '加个好词',
      '加个好句',
      '帮我想个结尾',
      '加个开头',
      '写得生动一点',
      '再优美一些',
      '丰富一点',
      '有文采一点',
      '加一点描写',
    ]) {
      expect(parseEditIntent(said), said).toEqual({ kind: 'refuse', reason: 'content' })
    }
  })

  it('★ 拒绝的理由要和"没听懂"不一样 —— 否则孩子会一直换说法', () => {
    const refused = applyEdit('小明正在吃饭。', parseEditIntent('加点比喻'), 1)
    expect(refused.ok).toBe(false)
    expect(refused.reason).toBe('refused')
    expect(refused.text).toBe('小明正在吃饭。')
    // 要明说"得你自己写"，而不是"没太听懂"
    expect(refused.message).toContain('得你自己写')
    expect(refused.message).not.toContain('没太听懂')

    const unknown = applyEdit('小明正在吃饭。', parseEditIntent('嗯嗯'), 1)
    expect(unknown.reason).toBe('unknown')
    expect(unknown.message).toContain('没太听懂')
  })

  it('★ 不误伤：孩子自己在指挥改字时，带"优美/漂亮"也不许拒', () => {
    // 这是最容易写歪的地方 —— 一看到"优美"就当内容要求，
    // 结果孩子想换个词都换不了。
    expect(parseEditIntent('把优美改成漂亮')).toEqual({
      kind: 'replace',
      from: '优美',
      to: '漂亮',
    })
    expect(parseEditIntent('把小明改成大明')).toEqual({
      kind: 'replace',
      from: '小明',
      to: '大明',
    })
    // 删词、插词也都不算"生产内容"
    expect(parseEditIntent('把正在去掉').kind).toBe('delete')
    expect(parseEditIntent('小明后面加小红').kind).toBe('insert')
  })

  it('★ 只认"光秃秃的内容名词"，不认孩子自己写出来的比喻', () => {
    // 「加上小红的比喻」里「小红的比喻」是孩子说的具体内容，
    // 那是他的字，该加就加；只有「加上一个比喻」这种
    // **空指代**才是让 AI 去造。
    expect(parseEditIntent('加上小红的比喻')).toEqual({
      kind: 'append',
      text: '小红的比喻',
    })
  })

  it('「加点比喻」不许把「一个比喻」四个字当成正文追加进去', () => {
    // 这是改之前真实发生过的：append 分支先命中，
    // 于是正文末尾多出「一个比喻」四个字，还报成功。
    const r = applyEdit('小明正在吃饭。', parseEditIntent('加上一个比喻'), 1)
    expect(r.ok).toBe(false)
    expect(r.text).toBe('小明正在吃饭。')
  })
})

/* ============================================================
   谁动的手 —— applyEdit 的 by 参数
   ============================================================

   接上大模型之后，同一次编辑可能是"孩子自己念的指令被直接执行"，
   也可能是"模型听懂了、引擎照着改"。正文都出自孩子，但
   **界面上的功劳要说准**（鼓励语 + 每一条记录上的标注）。
   ============================================================ */

describe('执行编辑 · 谁动的手', () => {
  const intent = parseEditIntent('把小猫改成小狗')

  it('默认算孩子自己改的 —— 本地那条路就是这个语义', () => {
    const r = applyEdit('我家有一只小猫。', intent, 1)
    expect(r.operation?.by).toBe('child')
    expect(r.message).toContain('这是你自己改的')
  })

  it('★ 传 ai 时，回执不许说成「这是你自己改的」', () => {
    const r = applyEdit('我家有一只小猫。', intent, 1, 'ai')
    expect(r.operation?.by).toBe('ai')
    expect(r.message).not.toContain('这是你自己改的')
    expect(r.message).toContain('按你说的改的')
  })

  it('★ 四种编辑都要带上 by —— 漏一个，那类改动就会冒充孩子改的', () => {
    const cases = [
      applyEdit('小明正在吃饭。', { kind: 'insert', anchor: '小明', text: '那个时候', position: 'after' }, 1, 'ai'),
      applyEdit('小明正在吃饭。', { kind: 'append', text: '他吃得很香' }, 1, 'ai'),
      applyEdit('小明正在吃饭。', { kind: 'delete', target: '正在' }, 1, 'ai'),
      applyEdit('小明正在吃饭。', { kind: 'replace', from: '小明', to: '大明' }, 1, 'ai'),
    ]
    for (const r of cases) {
      expect(r.ok).toBe(true)
      expect(r.operation?.by).toBe('ai')
    }
  })
})

describe('执行编辑', () => {
  it('唯一匹配时正常替换 —— 需求原例', () => {
    const text = '他手里拿着一根直直的棍子，站在门口。'
    const intent = parseEditIntent('棍子变成竹签')
    const r = applyEdit(text, intent, 1000)
    expect(r.ok).toBe(true)
    expect(r.text).toBe('他手里拿着一根直直的竹签，站在门口。')
    expect(r.operation?.from).toBe('棍子')
    expect(r.operation?.to).toBe('竹签')
    // 关键：before/after 都留档，可回放
    expect(r.operation?.before).toBe(text)
    expect(r.operation?.after).toBe(r.text)
  })

  it('找不到目标时不改动一字', () => {
    const text = '他手里拿着一根棍子。'
    const r = applyEdit(text, parseEditIntent('把铅笔改成钢笔'), 1000)
    expect(r.ok).toBe(false)
    expect(r.text).toBe(text)
    expect(r.reason).toBe('not-found')
  })

  it('出现多次时停下来问，不擅自改', () => {
    const text = '棍子很长，棍子很直。'
    const r = applyEdit(text, parseEditIntent('棍子变成竹签'), 1000)
    expect(r.ok).toBe(false)
    expect(r.text).toBe(text) // 原文纹丝不动
    expect(r.reason).toBe('ambiguous')
    expect(r.candidates).toHaveLength(2)
    expect(r.candidates?.[0].context).toContain('【棍子】')
  })

  it('多条候选时孩子可以指定改哪一个', () => {
    const text = '棍子很长，棍子很直。'
    const r = applyReplaceAt(text, text.lastIndexOf('棍子'), '棍子', '竹签', 1000)
    expect(r.ok).toBe(true)
    expect(r.text).toBe('棍子很长，竹签很直。')
  })

  it('追加内容时自动补句号', () => {
    const r = applyEdit('今天很开心', parseEditIntent('加上因为吃了冰淇淋'), 1000)
    expect(r.ok).toBe(true)
    expect(r.text).toBe('今天很开心。因为吃了冰淇淋')
  })

  it('已有句末标点时不再重复加', () => {
    const r = applyEdit('今天很开心。', parseEditIntent('加上因为吃了冰淇淋'), 1000)
    expect(r.text).toBe('今天很开心。因为吃了冰淇淋')
  })

  it('在空文本上追加不加多余标点', () => {
    const r = applyEdit('', parseEditIntent('加上今天下雨了'), 1000)
    expect(r.text).toBe('今天下雨了')
  })

  it('删除操作', () => {
    const r = applyEdit('我今天很开心然后回家了', parseEditIntent('把然后删掉'), 1000)
    expect(r.ok).toBe(true)
    expect(r.text).toBe('我今天很开心回家了')
  })

  it('听不懂的指令原样返回', () => {
    const text = '原文'
    const r = applyEdit(text, parseEditIntent('随便说点什么'), 1000)
    expect(r.ok).toBe(false)
    expect(r.text).toBe(text)
    expect(r.reason).toBe('unknown')
  })

  it('系统绝不改写 —— 只做等量替换', () => {
    // 核心安全断言：除了孩子指定的 from→to，其他字符一律不变
    const text = '金灿灿的阳光照在碧绿的草地上，一只小猫慢慢地走过来。'
    const r = applyEdit(text, parseEditIntent('小猫改成小狗'), 1000)
    expect(r.ok).toBe(true)
    // 把 replace 的那部分还原，应该与原文字节级相等
    const restored = r.text.replace('小狗', '小猫')
    expect(restored).toBe(text)
    // 长度只差 0（小猫和小狗都是两字）
    expect(r.text.length).toBe(text.length)
  })
})

describe('撤销', () => {
  it('撤销回到上一步', () => {
    const t0 = '棍子'
    const r1 = applyEdit(t0, parseEditIntent('棍子变成竹签'), 1000)
    expect(r1.operation).toBeDefined()
    const edits = [r1.operation!]

    const back = undoEdit(edits)
    expect(back).not.toBeNull()
    expect(back!.text).toBe(t0)
    expect(back!.edits).toHaveLength(0)
  })

  it('没有可撤销的返回 null', () => {
    expect(undoEdit([])).toBeNull()
  })

  it('多次撤销逐层回退', () => {
    const t0 = 'A'
    const r1 = applyEdit(t0, parseEditIntent('加上B'), 1000)
    let edits = [r1.operation!]
    const r2 = applyEdit(r1.text, parseEditIntent('加上C'), 2000)
    edits = [...edits, r2.operation!]

    const b1 = undoEdit(edits)!
    expect(b1.text).toBe(r1.text)
    const b2 = undoEdit(b1.edits)!
    expect(b2.text).toBe(t0)
  })
})

describe('语音片段', () => {
  it('追加语音并保留时间', () => {
    const list = addUtterance([], '开始', 1000)
    expect(list).toHaveLength(1)
    expect(list[0].text).toBe('开始')
    expect(list[0].at).toBe(1000)
  })

  it('多条语音按顺序累积', () => {
    let list = addUtterance([], '第一句', 1000)
    list = addUtterance(list, '第二句', 2000)
    expect(list.map((u) => u.text)).toEqual(['第一句', '第二句'])
  })
})

describe('修改统计与对比', () => {
  it('统计各种编辑次数', () => {
    const r1 = applyEdit('a', parseEditIntent('加上b'), 1)
    const stats = editStats([r1.operation!])
    expect(stats.total).toBe(1)
    expect(stats.appends).toBe(1)
  })

  it('生成修改前后对比', () => {
    const r1 = applyEdit('棍子', parseEditIntent('棍子变成竹签'), 1)
    const d = buildRevisionDiff([r1.operation!])
    expect(d).not.toBeNull()
    expect(d!.original).toBe('棍子')
    expect(d!.current).toBe('竹签')
    expect(d!.steps).toHaveLength(1)
  })

  it('没有修改时对比为 null', () => {
    expect(buildRevisionDiff([])).toBeNull()
  })

  it('修改越多鼓励语越强', () => {
    expect(revisionPraise(0)).toContain('一气呵成')
    expect(revisionPraise(2)).toContain('2')
    expect(revisionPraise(10)).toContain('10')
  })
})

/* ============================================================
   changedSpan —— 从两份全文里抠出真正变了的那一段
   ============================================================ */

describe('抠出变化的那一段', () => {
  it('只换一个词：抠出的是**最小**变化区', () => {
    // 注意这里是「猫 → 狗」而不是「小猫 → 小狗」：
    // 小猫/小狗 共享一个「小」字，掐掉公共前缀之后剩下的就是 猫→狗。
    // 最小化是对的 —— 前缀和词一样长时反而会多带一个字进去。
    expect(changedSpan('我家有一只小猫。', '我家有一只小狗。')).toEqual({
      from: '猫',
      to: '狗',
    })
  })

  it('改动不相邻时整段带出来', () => {
    expect(changedSpan('小猫在阳台。', '小狗在院子。')).toEqual({
      from: '猫在阳台',
      to: '狗在院子',
    })
  })

  it('★ 一模一样时必须是两个空串，不能把整篇当成"变化"', () => {
    // 抠错的表现：修订记录里出现一条「整篇 → 整篇」，
    // 长到没法看，而且孩子根本不知道改了哪。
    expect(changedSpan('我家有一只小猫。', '我家有一只小猫。')).toEqual({ from: '', to: '' })
  })

  it('纯追加（前面完全一样）', () => {
    expect(changedSpan('小猫。', '小猫。它爱吃鱼。')).toEqual({ from: '', to: '它爱吃鱼。' })
  })

  it('纯删除（后面完全一样）', () => {
    expect(changedSpan('小猫在阳台上。', '小猫在。')).toEqual({ from: '阳台上', to: '' })
  })

  it('空串不炸', () => {
    expect(changedSpan('', '')).toEqual({ from: '', to: '' })
    expect(changedSpan('', '小猫')).toEqual({ from: '', to: '小猫' })
    expect(changedSpan('小猫', '')).toEqual({ from: '小猫', to: '' })
  })

  it('★ 后缀不能和前缀重叠（"aaa" → "a" 这种）', () => {
    // 边界写错的话会抠出负数长度，slice 出来的东西是反的。
    const r = changedSpan('aaa', 'a')
    expect(r.from + r.to).toBe('aaa'.slice(1)) // 只剩掐掉前 1 个字符的部分
    expect(r.from.length).toBeGreaterThanOrEqual(0)
    expect(r.to.length).toBeGreaterThanOrEqual(0)
  })
})

/* ============================================================
   ★ 鼓励语不能说假话
   ============================================================ */

describe('鼓励语必须分清是谁动的手', () => {
  it('全是孩子自己改的：才可以说「你自己改了一处」', () => {
    expect(revisionPraise(1, 0)).toContain('你自己改了一处')
  })

  it('★ 全是 AI 按孩子指令改的：**不能**说成"你自己改的"', () => {
    // 改作文接了大模型之后，再说"你自己改的"就是对孩子说假话。
    // 孩子做的是"决定改哪里"，这份功劳照认，但话得说准。
    const s = revisionPraise(1, 1)
    expect(s).not.toContain('你自己改了一处')
    expect(s).toContain('说清')
  })

  it('两种都有：两边的功劳各自认，谁也不冒领', () => {
    const s = revisionPraise(3, 1)
    expect(s).toContain('2') // 自己动手 2 处
    expect(s).toContain('1') // AI 1 处
  })

  it('一处都没改时的文案不受影响', () => {
    expect(revisionPraise(0, 0)).toContain('一气呵成')
  })
})

/* ============================================================
   ★★ 2026-09-20 家长报的两条 —— 都要能还原出他想要的句子
   ------------------------------------------------------------
   家长原话：
     「我写了『半大的小学生在操场上玩篮球。』
       我说把操场后加上快乐的玩篮球。他搞了半天。
       另外我说把玩篮球后面的句号改成叹号，始终不行。理解不行。」

   两句都要落到同一个结果：孩子自己能说出这两句话，
   系统就只负责把字搬到他指定的位置 —— 一个字都不许多。
   ============================================================ */

const ESSAY = '半大的小学生在操场上玩篮球。'
/** 家长想要的句子 */
const WANTED = '半大的小学生在操场上快乐的玩篮球。'

describe('★★ 插入 · 带「把」的说法 + 方位词不能插在词中间', () => {
  it('★ 「把操场后加上快乐的」——「把」不许被吞进 anchor', () => {
    /*
     * 这是家长报的「搞了半天」的**直接原因**：
     * 插入那条正则原来只吃掉「在」，没吃「把」，
     * 于是 anchor 变成「把操场」→「文中没有找到『把操场』」。
     * 孩子最自然的说法 100% 失败，他只会换个说法再试，
     * 看起来像"理解不行"，其实是这一行漏了一个字。
     */
    const intent = parseEditIntent('把操场后加上快乐的')
    expect(intent).toEqual({ kind: 'insert', anchor: '操场', text: '快乐的', position: 'after' })
    expect(applyEdit(ESSAY, intent, 1).text).toBe(WANTED)
  })

  it('★ 插在"词"后面，不是插在"匹配到的字"后面', () => {
    // 孩子心里的词是「操场上」；直接插在「操场」后面会得到
    // 「在操场|快乐的|上玩篮球」—— 谁也不这么说。
    const r = applyEdit(ESSAY, { kind: 'insert', anchor: '操场', text: '快乐的', position: 'after' }, 1)
    expect(r.text).toBe(WANTED)
    expect(r.text).not.toContain('操场快乐的上')
  })

  it('★ 「操场后加上快乐的玩篮球」—— 落脚点不许被插两遍', () => {
    /*
     * 孩子说插入时常把**落脚点**也念出来（「操场后加上快乐的，玩篮球那儿」），
     * 那个词本来就在正文里。照着字面插就得到
     * 「在操场上快乐的玩篮球玩篮球」—— 家长看到的正是这一幕。
     */
    const r = applyEdit(
      ESSAY,
      { kind: 'insert', anchor: '操场', text: '快乐的玩篮球', position: 'after' },
      1,
    )
    expect(r.text).toBe(WANTED)
    expect(r.text.match(/玩篮球/g)).toHaveLength(1)
  })

  it('★ 只重合一个字**不算**落脚点（「加上快乐的」不许被削成「快乐」）', () => {
    // 反例守卫：正文紧接着是「的玩篮球」，如果按"重合就削"，
    // 「快乐的」会被削掉尾巴变成「快乐」，得到「在操场上快乐玩篮球」。
    // 所以重合长度至少要 2 个字。
    const r = applyEdit(
      '半大的小学生在操场上玩篮球。',
      { kind: 'insert', anchor: '操场', text: '快乐的', position: 'after' },
      1,
    )
    expect(r.text).toContain('快乐的玩篮球')
  })

  it('要加的东西正文里已经原样在了 → 说清楚，不要加出个重复', () => {
    const r = applyEdit(ESSAY, { kind: 'insert', anchor: '操场', text: '玩篮球', position: 'after' }, 1)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('不用再加')
  })

  it('「操场上加上快乐的」—— 方位词本身就是"加在这儿"，不必再说"后面"', () => {
    const intent = parseEditIntent('把操场上加上快乐的')
    expect(intent).toEqual({ kind: 'insert', anchor: '操场上', text: '快乐的', position: 'after' })
    expect(applyEdit(ESSAY, intent, 1).text).toBe(WANTED)
  })

  it('不该插的地方还是不许乱插（没有方位的普通说法不受影响）', () => {
    // 「小明后面加小红」—— 后面跟着的「在」不是方位后缀，不许贴过去
    const r = applyEdit(
      '小明在操场上跑。',
      { kind: 'insert', anchor: '小明', text: '小红', position: 'after' },
      1,
    )
    expect(r.text).toBe('小明小红在操场上跑。')
  })
})

describe('★★ 改标点 · 「把 X 后面的句号改成叹号」', () => {
  it('★ 家长报的原例：参照物 + 标点名 → 换掉参照物后面那个标点', () => {
    /*
     * 两层根因，缺一层都不算修好：
     *   ① 孩子说的是标点的**名字**（句号），正文里是**符号**（。）——
     *      旧代码把「玩篮球后面的句号」整串当字面量去找，当然找不到。
     *   ② 「X 后面的那个标点」是**相对指位**，旧代码没有这个概念。
     */
    const intent = parseEditIntent('把玩篮球后面的句号改成叹号')
    expect(intent).toEqual({ kind: 'replace-punct', from: '。', to: '！', near: '玩篮球' })

    const r = applyEdit(ESSAY, intent, 1)
    expect(r.ok).toBe(true)
    expect(r.text).toBe('半大的小学生在操场上玩篮球！')
  })

  it('「感叹号」和「叹号」是同一个符号', () => {
    expect(parseEditIntent('把玩篮球后面的句号改成感叹号')).toEqual({
      kind: 'replace-punct',
      from: '。',
      to: '！',
      near: '玩篮球',
    })
  })

  it('★ 记录里存的是**真符号**，不是"句号"两个字', () => {
    // 撤销、diff、修改记录全靠 from/to 跟正文对齐；
    // 存名字会让 diff 对不上正文。
    const r = applyEdit(ESSAY, parseEditIntent('把玩篮球后面的句号改成叹号'), 1)
    expect(r.operation?.from).toBe('。')
    expect(r.operation?.to).toBe('！')
    expect(r.operation?.kind).toBe('replace')
  })

  it('★ 「最后的句号」是孩子指定了哪一处 —— 不许再反问他', () => {
    // 有多个句号时，光说「把句号改成叹号」要停下来问；
    // 但说了「最后的」就是他自己指好了，直接改最后一个。
    const text = '今天下雨。我很开心。回家了。'
    const intent = parseEditIntent('把最后的句号改成叹号')
    expect(intent).toEqual({ kind: 'replace-punct', from: '。', to: '！', pick: 'last' })

    const r = applyEdit(text, intent, 1)
    expect(r.ok).toBe(true)
    expect(r.text).toBe('今天下雨。我很开心。回家了！')
  })

  it('「第一个逗号」同理，取最前面那个', () => {
    const text = '今天下雨，我很开心，回家了。'
    const r = applyEdit(text, parseEditIntent('把第一个逗号改成句号'), 1)
    expect(r.text).toBe('今天下雨。我很开心，回家了。')
  })

  it('★ 没说在哪儿 + 有多个 → 停下来让孩子自己指', () => {
    // 改错地方比不改更糟；"是哪一处"本来就是他该判断的事。
    const text = '今天下雨。我很开心。'
    const r = applyEdit(text, parseEditIntent('把句号改成叹号'), 1)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('ambiguous')
    expect(r.candidates).toHaveLength(2)
  })

  it('没说在哪儿 + 只有一个 → 直接改', () => {
    const r = applyEdit(ESSAY, parseEditIntent('把句号改成叹号'), 1)
    expect(r.text).toBe('半大的小学生在操场上玩篮球！')
  })

  it('参照物找不到 / 它后面没有这个标点 → 说清楚，别乱改', () => {
    const missing = applyEdit(ESSAY, parseEditIntent('把大象后面的句号改成叹号'), 1)
    expect(missing.ok).toBe(false)
    expect(missing.reason).toBe('not-found')
    expect(missing.text).toBe(ESSAY)

    // 「玩篮球」后面是句号，不是逗号
    const wrongKind = applyEdit(ESSAY, parseEditIntent('把玩篮球后面的逗号改成句号'), 1)
    expect(wrongKind.ok).toBe(false)
    expect(wrongKind.message).toContain('后面没有')
    expect(wrongKind.text).toBe(ESSAY)
  })

  it('★ 参照物出现多次 → 停下来问是哪一处', () => {
    const text = '下雨了。小明在操场。小明回家了。'
    const r = applyEdit(text, parseEditIntent('把小明后面的句号改成叹号'), 1)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('ambiguous')
    expect(r.candidates).toHaveLength(2)
  })

  it('回执说人话：用「句号」「叹号」，不是「。」「！」', () => {
    const r = applyEdit(ESSAY, parseEditIntent('把玩篮球后面的句号改成叹号'), 1)
    expect(r.message).toContain('句号')
    expect(r.message).toContain('叹号')
  })

  it('把同一个标点"换成它自己"→ 直说不用换，别装作改了', () => {
    const r = applyEdit(ESSAY, parseEditIntent('把句号改成句号'), 1)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('不用换')
  })

  it('「把句号改成叹号」不会被通用替换先抢走', () => {
    // 标点那条必须排在通用替换**之前** —— 否则通用替换会把
    // 「玩篮球后面的句号」整串当字面量抓走，然后报"找不到"。
    // 这里用「把A改成B」的形状反证：它没被当成普通的词替换。
    expect(parseEditIntent('把玩篮球后面的句号改成叹号').kind).toBe('replace-punct')
  })
})

/* ============================================================
   修改记录里的「原文 / 改成」—— 把改动扩成整句

   家长 2026-09-21：「我希望是 **表明作文原文**，
   修正内容 就是输入的话的内容。」

   光给「小猫 → 小狗」两个词，孩子不知道是在说哪一句。
   ============================================================ */

describe('sentenceChange · 把改动扩成整句', () => {
  it('词替换 → 给出**改动处所在的那一整句**，不是那两个词', () => {
    const r = sentenceChange('我家有一只小猫。', '我家有一只小狗。')
    expect(r.beforeSentence).toBe('我家有一只小猫。')
    expect(r.afterSentence).toBe('我家有一只小狗。')
  })

  it('★ 多句时只取**变了的那一句**，不把整段端出来', () => {
    const before = '今天天气很好。我家有一只小猫。它很可爱。'
    const after = '今天天气很好。我家有一只小狗。它很可爱。'
    const r = sentenceChange(before, after)
    expect(r.beforeSentence).toBe('我家有一只小猫。')
    expect(r.afterSentence).toBe('我家有一只小狗。')
  })

  it('★ 逗号不是句子边界 —— 别把一句话从逗号处切开', () => {
    const before = '早上，我家有一只小猫，它趴在窗台上。'
    const after = '早上，我家有一只小狗，它趴在窗台上。'
    const r = sentenceChange(before, after)
    expect(r.beforeSentence).toBe('早上，我家有一只小猫，它趴在窗台上。')
    expect(r.afterSentence).toBe('早上，我家有一只小狗，它趴在窗台上。')
  })

  it('★★ 追加（变化区在 before 侧是空的）→ 原文那栏不能是空白', () => {
    /*
     * append 时公共前缀吃掉了整篇 before，于是 before 侧的"变化区"长度是 0。
     * 直接按变化区取句子会切出空串 —— 界面上「原文」那一栏就是空白，
     * 看起来像记录坏了。所以要退回"紧邻变化点的那个字符"所在的句子。
     */
    const r = sentenceChange('我家有一只小狗。', '我家有一只小狗。他很开心。')
    expect(r.beforeSentence).toBe('我家有一只小狗。')
    expect(r.afterSentence).toBe('他很开心。')
  })

  it('删掉一整句 → 两侧都还看得出是哪一句', () => {
    const r = sentenceChange('今天很好。我家有一只小猫。它很可爱。', '今天很好。它很可爱。')
    expect(r.beforeSentence).toBe('我家有一只小猫。')
    expect(r.afterSentence).not.toBe('')
  })

  it('★ 和 changedSpan 读的是同一份"哪儿变了"（只有一处判定）', () => {
    // 两个函数算出的变化区必须自洽：sentenceChange 的整句里
    // 一定含着 changedSpan 抠出来的那一段字。
    const before = '今天天气很好。我家有一只小猫。它很可爱。'
    const after = '今天天气很好。我家有一只小狗。它很可爱。'
    const span = changedSpan(before, after)
    const r = sentenceChange(before, after)
    expect(r.beforeSentence).toContain(span.from)
    expect(r.afterSentence).toContain(span.to)
  })
})

/* ============================================================
   指位：`near` / `side` / `pick` —— replace / delete / replace-punct 共用

   2026-09-21：这三个字段原本**只有 replace-punct 有**，
   于是「把玩篮球后面的那个字去掉」这类说法在 delete 上整类失败。
   现在三支共用 `locateOccurrence`，下面守的就是"共用之后三支都对"。
   ============================================================ */

describe('指位 · near / side / pick', () => {
  const TEXT = '半大的小学生在操场上玩篮球。'

  /*
   * ★★ 下面这两条都**故意让目标在别处也出现**。
   *
   *    第一版是拿 TEXT（只有一个「。」）写的 —— 结果它**变异验证时没红**：
   *    目标唯一，有没有 `near` 都能命中，于是这条测试根本没在守 near。
   *    这正是 §十二 那个教训："守卫在 bug 还在的时候照样绿"。
   *    ➜ 写"指位"的测试，**必须让不指位就会歧义**，否则测的是别的东西。
   */
  const TWO_DOTS = '半大的小学生在操场上玩篮球。小学生在操场上跑步。'

  it('★ delete + near：删掉参照物后面那一个（目标在别处也出现，near 真的在起作用）', () => {
    // 先证明"不指位确实会歧义" —— 这一步没了，下面那句就说明不了任何事
    const noHint = applyEdit(TWO_DOTS, { kind: 'delete', target: '。' }, 1)
    expect(noHint.ok, '两个句号，不指位就该停下来问').toBe(false)
    expect(noHint.reason).toBe('ambiguous')

    const r = applyEdit(TWO_DOTS, { kind: 'delete', target: '。', near: '玩篮球' }, 1)
    expect(r.ok, r.ok ? '' : r.message).toBe(true)
    expect(r.text).toBe('半大的小学生在操场上玩篮球小学生在操场上跑步。')
  })

  it('★ replace + near：改掉参照物后面那一个（同样让目标出现两次）', () => {
    const twice = '小学生在操场上玩篮球，在操场边玩篮球。'
    expect(applyEdit(twice, { kind: 'replace', from: '玩篮球', to: '打篮球' }, 1).ok).toBe(false)

    const r = applyEdit(twice, { kind: 'replace', from: '玩篮球', to: '打篮球', near: '操场上' }, 1)
    expect(r.ok, r.ok ? '' : r.message).toBe(true)
    // 改的是「操场上」后面那一个，不是「操场边」后面那个
    expect(r.text).toBe('小学生在操场上打篮球，在操场边玩篮球。')
  })

  it('★ side: "before" —— 取参照物**前面**最近的那一个', () => {
    const r = applyEdit(TEXT, { kind: 'delete', target: '操场上', side: 'before', near: '玩篮球' }, 1)
    expect(r.ok, r.ok ? '' : r.message).toBe(true)
    expect(r.text).toBe('半大的小学生在玩篮球。')
  })

  it('side 缺省是 "after"（「X 后面的那个」是最常见的说法）', () => {
    const withDefault = applyEdit(TEXT, { kind: 'delete', target: '。', near: '玩篮球' }, 1)
    const explicit = applyEdit(TEXT, { kind: 'delete', target: '。', near: '玩篮球', side: 'after' }, 1)
    expect(withDefault.text).toBe(explicit.text)
  })

  it('pick: "first" / "last" 各取一头', () => {
    const text = '小猫很可爱，小猫爱吃鱼。'
    const first = applyEdit(text, { kind: 'delete', target: '猫', pick: 'first' }, 1)
    const last = applyEdit(text, { kind: 'delete', target: '猫', pick: 'last' }, 1)
    expect(first.ok && last.ok).toBe(true)
    expect(first.text).toBe('小很可爱，小猫爱吃鱼。')
    expect(last.text).toBe('小猫很可爱，小爱吃鱼。')
  })

  it('★★ 没给指位 + 多个候选 → 停下来问（不许替孩子挑）', () => {
    const r = applyEdit('小猫很可爱，小猫爱吃鱼。', { kind: 'delete', target: '猫' }, 1)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('ambiguous')
    expect(r.candidates).toHaveLength(2)
  })

  it('★ 参照物出现多次、旁边都有目标 → 也要停下来问', () => {
    // 「小明」出现两次，两处后面都有「。」—— 孩子只说"小明后面的句号"时
    // 仍然分不清是哪一处，不能替他挑第一个。
    const r = applyEdit('小明走了。小红也走了，小明笑了。', { kind: 'delete', target: '。', near: '小明' }, 1)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('ambiguous')
    expect(r.candidates?.length).toBe(2)
  })

  it('参照物在原文里找不到 → 明说找不到参照物，不要说成"没找到目标"', () => {
    const r = applyEdit(TEXT, { kind: 'delete', target: '。', near: '不存在的东西' }, 1)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('不存在的东西')
  })

  it('★ 三种指令共用同一份判定 —— 同一句话在三支上的结论要一致', () => {
    // 这条守的是"判定只许有一个函数"（§四）：抽共用函数之前，
    // replace-punct 有这套机器、replace/delete 没有，
    // 同一句「X 后面的那个」在三支上会得出**不同**的结论。
    // ⚠️ 用 TWO_DOTS（目标出现两次）才测得出来 —— 目标唯一时三支天然一致。
    const asDelete = applyEdit(TWO_DOTS, { kind: 'delete', target: '。', near: '玩篮球' }, 1)
    const asReplace = applyEdit(TWO_DOTS, { kind: 'replace', from: '。', to: '！', near: '玩篮球' }, 1)
    const asPunct = applyEdit(TWO_DOTS, { kind: 'replace-punct', from: '。', to: '！', near: '玩篮球' }, 1)
    expect(asDelete.ok && asReplace.ok && asPunct.ok).toBe(true)
    // 三支都落在**同一个位置**：换/删之后剩下的前缀是同一串
    expect(asReplace.text).toBe(asPunct.text)
    expect(asDelete.text).toBe('半大的小学生在操场上玩篮球小学生在操场上跑步。')
  })
})
