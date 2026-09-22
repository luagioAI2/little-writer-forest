/* ============================================================
   满分范文引擎 v2 的回归测试
   ============================================================

   这些用例全部来自真实踩过的坑：
     · 范文跟孩子写的内容无关（旧版最大问题）
     · 同一句话在范文里印两遍
     · 「像像」双重比喻
     · 「落在前面上」这种缺主语病句
     · 写妈妈却用「他」
     · 孩子写到的名物被丢掉、配图完全没用上（2026-09-18 家长报的）
   ============================================================ */

import { describe, expect, it } from 'vitest'
import {
  buildImagerySentences,
  composeModelEssay,
  explainMaterial,
  extractConcrete,
  parseExtraPrompt,
  resolveKind,
  unfulfilledDemands,
  usedRhetoric,
} from './modelEssay'
import { extractSkeleton, buildModelEssay, analyzeText } from './scoring'

const MAMA = {
  title: '我的妈妈',
  category: 'person',
  grade: 5,
  childText:
    '我的妈妈很普通。她每天早上六点就起来给我做饭。有一次我发烧了，妈妈背着我去了医院，一路上她一直在喘气。我看着她的头发，发现里面有白的了。我心里很难受。我想对妈妈说，你辛苦了。',
}

function essayOf(c: typeof MAMA & { imageHints?: string[]; extraPrompt?: string } = MAMA) {
  return composeModelEssay({
    childText: c.childText,
    title: c.title,
    category: c.category,
    grade: c.grade,
    targetLen: 300,
    imageHints: c.imageHints,
    extraPrompt: c.extraPrompt,
    extract: extractSkeleton,
  })
}

describe('素材抽取', () => {
  it('从原文里认出人物', () => {
    expect(explainMaterial(MAMA.childText, MAMA.title).person).toBe('妈妈')
  })

  it('从原文里认出时间和地点', () => {
    const m = explainMaterial(MAMA.childText, MAMA.title)
    expect(m.time).toBe('早上')
    expect(m.place).toBe('医院')
  })

  it('题目里的信息优先级不高于正文', () => {
    // 正文写了「公园」，题目是「难忘的一天」—— 应该以正文为准
    const m = explainMaterial('那天下午我去了公园，看到了很多花。', '难忘的一天')
    expect(m.place).toBe('公园')
  })

  it('小动物能被认成「物」', () => {
    const m = explainMaterial('我有一只小狗，它叫豆豆。', '我的小狗')
    expect(m.thing).toBe('小狗')
  })

  it('类别解析：有 person 且标为写人 → person', () => {
    expect(resolveKind('person', explainMaterial(MAMA.childText, MAMA.title))).toBe('person')
  })
})

describe('范文不跑偏', () => {
  it('写妈妈的范文里必须出现「妈妈」，不能写成别的题材', () => {
    const e = essayOf()
    expect(e.text).toContain('妈妈')
    // 旧版的经典 bug：套用写景模板
    expect(e.text).not.toContain('推开窗')
    expect(e.text).not.toContain('扑面而来')
  })

  it('写景的范文必须提到那个地点', () => {
    const e = essayOf({
      title: '秋天的公园',
      category: 'scene',
      grade: 4,
      childText: '今天下午我和爸爸去了公园。公园里的树叶都黄了。风一吹，叶子就往下掉。我觉得秋天的公园真好看。',
    })
    expect(e.text).toContain('公园')
  })

  it('状物的范文必须提到那个物件', () => {
    const e = essayOf({
      title: '我的小狗',
      category: 'object',
      grade: 3,
      childText: '我有一只小狗，它叫豆豆。它的毛是白的。我每天放学回家它都会跑过来。我很喜欢它。',
    })
    expect(e.text).toContain('小狗')
  })

  it('量词不能写死 —— 「我有一小狗」是病句', () => {
    const e = essayOf({
      title: '我的小狗',
      category: 'object',
      grade: 3,
      childText: '我有一只小狗，它叫豆豆。它的毛是白的。我很喜欢它。',
    })
    expect(e.text).not.toContain('我有一')
  })
})

describe('具体名物抽取', () => {
  it('孩子写到的名物能被抽出来（旧版一个都抽不到）', () => {
    // 「彩虹」不在人物/地点/时间/物件/事件任何一张表里 ——
    // 旧版就是这样把它整条丢掉的
    expect(extractConcrete('天上有一条彩虹')).toContain('彩虹')
  })

  it('长词优先，不被短词抢先', () => {
    // 「雨」是「雨珠」的子串，顺序错了就会抽出碎词
    expect(extractConcrete('玻璃上挂着雨珠')).toEqual(['雨珠'])
  })

  it('不把人称和泛称当名物', () => {
    const out = extractConcrete('一个孩子举起双手')
    expect(out).not.toContain('孩子')
  })

  it('同一件东西只说一遍', () => {
    const out = extractConcrete('树叶都黄了，风一吹，叶子往下掉。')
    expect(out).toContain('树叶')
    expect(out).not.toContain('树')
  })

  it('素材里带上 concrete 这一项', () => {
    const m = explainMaterial('雨停了以后，天上有一条彩虹。', '雨后')
    expect(m.concrete).toContain('彩虹')
  })

  it('名物按孩子的叙述顺序排，不按词表顺序', () => {
    // 词表里「彩虹」排在「雨」前面，但孩子先写的雨 —— 改写要顺着他走
    expect(extractConcrete('下雨了，后来天上有一条彩虹。')).toEqual(['雨', '彩虹'])
  })

  it('图注里的泛景不能挤掉更具体的名物', () => {
    // 「草地上有两摊水洼」会同时命中「草」和「水洼」，
    // 按出现位置排的话「草」在前 —— 但草是泛景，水洼才是这场雨的记号。
    // 图注走 preferSpecific，孩子原文走出现顺序（上一条）。
    const out = extractConcrete('草地上有两摊水洼', 6, true)
    expect(out.indexOf('水洼')).toBeLessThan(out.indexOf('草'))
  })
})

describe('改写必须用上孩子的内容和配图（2026-09-18 家长报的）', () => {
  const RAIN = {
    title: '雨后的校园',
    category: 'scene',
    grade: 3,
    childText: '下雨了，我和小明在操场上玩。雨停了以后，天上有一条彩虹。我很开心。',
  }

  it('孩子写到的名物必须出现在改写里', () => {
    const e = essayOf(RAIN)
    // 旧版这里是红的：正文全是「校园铺开去，像是被谁用画笔轻轻涂过」，
    // 彩虹、小明一个都没有
    expect(e.text).toContain('彩虹')
    expect(e.text).toContain('雨')
  })

  it('配图里的东西也要写进去', () => {
    const e = essayOf({
      ...RAIN,
      // 孩子没写水洼，但图上有
      imageHints: ['一道六色彩虹架在天地之间，草地上有两摊水洼，远处是山丘和云。'],
    })
    expect(e.text).toContain('水洼')
  })

  it('低年级只留两句时，孩子的名物也不能被裁掉', () => {
    // keepCap = 2，具体画面句必须排在最前面才活得下来
    const e = essayOf({ ...RAIN, grade: 1 })
    expect(e.text).toContain('彩虹')
  })

  it('没配图时不能崩，也不能凭空捏造', () => {
    const e = essayOf({ ...RAIN, imageHints: [] })
    expect(e.text).toContain('彩虹')
    expect(e.text).not.toContain('undefined')
  })

  it('亮点里要报出用到的名物，家长才看得出来', () => {
    const e = essayOf(RAIN)
    expect(e.highlights.join('|')).toContain('彩虹')
  })

  it('孩子自己写的名物排在配图的前面', () => {
    const e = essayOf({
      ...RAIN,
      imageHints: ['雪地上两个孩子打雪仗，半空中飞着几个雪球。'],
    })
    // 孩子写了彩虹，图里有雪球 —— 先彩虹后雪球
    expect(e.text.indexOf('彩虹')).toBeLessThan(e.text.indexOf('雪球'))
  })

  it('两件名物不能撞同一句反应（同一句会印两遍）', () => {
    // ⚠️ 不能靠真随机源来测：撞不撞是看运气，运气好就一直绿。
    // 这里直接喂一个「永远返回 0」的随机源 —— 不排重就必然挑到同一条。
    const lines = buildImagerySentences(['彩虹', '雨', '雪'], () => 0)
    // 每行 = 「引入。反应。补充」，第二个分句就是反应句
    const reactions = lines.map((l) => l.split('。')[1])
    expect(reactions.every((r) => r.length > 0)).toBe(true)
    expect(new Set(reactions).size).toBe(reactions.length)
  })

  it('补充句必须拼在同一句里，不单独占位置', () => {
    // 单独占位的话，低年级只留 2 句时会把真正的名物挤掉
    const lines = buildImagerySentences(['摇椅', '毛衣'], () => 0)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('摇椅就安安静静地待在那儿')
  })

  it('★ 写人的稿子，第一句必须是这个人，不是这个人的东西', () => {
    // 「我最先注意到的是摇椅」放在写奶奶的稿子里，读起来就不是写人了
    const e = essayOf({
      title: '我的奶奶',
      category: 'person',
      grade: 4,
      childText:
        '我的奶奶头发白了。她坐在摇椅上给我织毛衣。她的眼镜滑到鼻子下面，她也不去推。我觉得奶奶真好。',
    })
    const body = e.text.split('\n\n')[1]
    expect(body).toContain('奶奶')
    expect(body).toContain('摇椅')
    expect(body.indexOf('奶奶')).toBeLessThan(body.indexOf('摇椅'))
  })

  it('补充句不能把第三个名物挤掉（老花镜就是这么丢的）', () => {
    // grade 4 只留 4 句：1 句写人 + 3 句画面。补充句要是单独占位，
    // 第三个名物就没了。
    const e = essayOf({
      title: '我的奶奶',
      category: 'person',
      grade: 4,
      childText:
        '我的奶奶头发白了。她坐在摇椅上给我织毛衣。她的眼镜滑到鼻子下面，她也不去推。我觉得奶奶真好。',
      imageHints: ['屋里奶奶坐在摇椅上织毛衣，腿上放着两个毛线团，鼻梁上架着老花镜。'],
    })
    expect(e.text).toContain('摇椅')
    expect(e.text).toContain('毛衣')
    expect(e.text).toContain('老花镜')
  })

  it('★ 走 scoring 的适配层时，images 也必须真的传下去', () => {
    // 这条守的是真因 1：`buildModelEssay` 收下了 inp.images，
    // 但适配层以前**从来没往下传**，所以「看图作文」的改写跟图无关。
    // 上面那些用例是直接调 composeModelEssay 的，守不住这条 ——
    // 一旦有人把 scoring.ts 里那行 imageHints 删掉，只有这条会红。
    const childText = '今天我和妈妈去了公园。我很开心。'
    const e = buildModelEssay({
      childText,
      analysis: analyzeText(childText),
      // 题目里刻意不含任何名物，逼着引擎只能从图里取
      title: '看图写话',
      images: [{ sceneKey: 'rainbow' }],
      grade: 3,
      category: 'scene',
      wordRange: [60, 200],
    })
    expect(e.text).toContain('彩虹')
  })
})

describe('★ 改写必须结合图和用户写的（2026-09-19 家长第二次报的）', () => {
  /*
   * 家长原话：
   *   「还有更好的写法 也还是有问题。 要结合 图 和 用户写的」
   *
   * 上一轮（09-18）已经往提示词和本地引擎里补了配图，为什么还是不行？
   * 真因在**文体判定**：题库里「看图作文」的 category 是 `event`，
   * 于是《看图写话》走的是**写事模板** ——
   *   「一开始我还没反应过来。一切发生得太快。
   *     接着，事情往前走，我的手心里全是汗。
   *     周围有那么多声音，我却只听见自己的心跳。」
   * 这段跟图没关系、跟孩子写的也没关系。
   */
  const SNOW = {
    title: '看图写话',
    // 题库里「看图作文」这个标签就是 event（见 prompts.ts 的 TOPIC_TAGS）
    category: 'event',
    grade: 3,
    childText: '下雪了。我和小明在雪地里打雪仗，还堆了一个雪人。',
    imageHints: ['雪后的校园：地上白茫茫一片，树枝上挂着雪，几个孩子在雪地里跑'],
  }

  it('★ 看图作文（category=event）没有「事」时，不许编出一段写事套话', () => {
    const e = essayOf(SNOW)
    // 这几句就是家长看到的「不相关的内容」
    expect(e.text).not.toContain('手心里全是汗')
    expect(e.text).not.toContain('心跳')
    expect(e.text).not.toContain('咬着牙')
    expect(e.text).not.toContain('一开始我还没反应过来')
  })

  it('★ 孩子写到的名物必须进正文 —— 含「人」的「雪人」也不例外', () => {
    // 「雪人」以前被泛称过滤（NOT_A_THING 里有「人」）整条丢掉，
    // 于是孩子写雪人，范文里一个雪人都没有
    expect(extractConcrete('还堆了一个雪人')).toContain('雪人')
    const e = essayOf(SNOW)
    expect(e.text).toContain('雪人')
  })

  it('★ 图上的地点要补进正文（孩子没写在哪）', () => {
    const e = essayOf(SNOW)
    // 图注写着「雪后的校园」——孩子没写地点，就该从图里取
    expect(e.text).toContain('校园')
  })

  it('★ 孩子写了地点时，图不许把它覆盖掉', () => {
    const e = essayOf({
      ...SNOW,
      childText: '下雪了。我和小明在雪地里打雪仗，还堆了一个雪人。外婆家的院子里全是白的。',
    })
    expect(e.text).toContain('外婆家')
  })

  it('★ 孩子真的写了「事」时，仍然按写事写（别一刀切成写景）', () => {
    const e = essayOf({
      title: '难忘的事',
      category: 'event',
      grade: 4,
      childText: '那次运动会，我参加跳绳比赛。一开始我跳得很差，后来我天天练，最后拿了第三名。',
    })
    // 「一开始我还没反应过来。」是写事分支第一句的固定开头
    // （写景分支永远不会有它 —— 上面 SNOW 那条正好反向钉住了）
    expect(e.text).toContain('一开始我还没反应过来')
  })

  it('★ 文体判定的单元真相：有「事」才是写事', () => {
    const snow = explainMaterial(SNOW.childText, SNOW.title)
    expect(resolveKind('event', snow, { pictureFirst: true })).toBe('scene')

    const sport = explainMaterial(
      '那次运动会，我参加跳绳比赛。一开始我跳得很差，后来我天天练，最后拿了第三名。',
      '难忘的事',
    )
    expect(resolveKind('event', sport, { pictureFirst: false })).toBe('event')
  })

  it('★ 量词兜底不许抽出碎词（「还有开满粉。」这种句子）', () => {
    // 量词后面是「修饰语 + 名物」，兜底正则闷头取 2-3 个字就会把修饰吞进来
    expect(extractConcrete('两棵开满粉花的树')).not.toContain('开满粉')
    expect(extractConcrete('三只小鸟飞过')).not.toContain('小鸟飞')
    expect(extractConcrete('一排整整齐齐的篱笆')).not.toContain('整整齐')
    // 真名物一个都不能被这道关误伤
    expect(extractConcrete('天上有一条彩虹')).toContain('彩虹')
    expect(extractConcrete('草地上有两摊水洼')).toContain('水洼')
  })

  it('★ 没有配图、孩子也没写名物时，才维持写事（不凭空切文体）', () => {
    const e = essayOf({
      title: '难忘的事',
      category: 'event',
      grade: 3,
      childText: '那件事我一直记得。我很难受，后来我明白了。',
    })
    expect(e.text).toContain('一开始我还没反应过来')
  })
})

/* ============================================================
   ★★ 家长设置里的提示词，本地引擎也要落实
   ============================================================

   家长 2026-09-19 提的（第三次）：
     「更好的写法，还要结合下 家长设置里的 提示词。类似于点比喻之类的。」

   真因：`extraPrompt` 以前**只进 AI 提示词**，本地引擎一个字都没读。
   而设置页上写着「AI 点评和改范文时会参考这些要求」——
   所以只要 AI 没配好、或调用失败降级到本地，这条要求就被**静默丢弃**，
   界面上看不出任何异样。家长只会觉得"设置了没用"。
   （设置页那句文案也一并改准了：说明哪几样本地能做、哪些得配 AI。）

   修的时候踩出两个**更深的**坑（都不是"忘了读"，是"读了没落地"）：

     坑一 · 判早了：`usedRhetoric` 原来算在**裁剪之前**的全量候选上。
       写景分支的候选里本来就带通感和拟人句，可它们排在后面、
       会被句数上限砍掉。于是引擎说「已经有了」不补，裁剪又把那句砍了 ——
       家长的要求两头落空。**修辞判定必须做在真的留下来的那几句上。**

     坑二 · 名额不够：`keepCap` 加了 `+ demanded.length`，但画面句
       不受它约束地排在最前（一年级 keepCap=3，画面句正好 3 句），
       家长那句永远排在画面句后面，一次都进不去。
       **家长点名的句子不许参与裁剪。**

   这一节把「能落实的」「落实不了的」两头都钉住。
   ============================================================ */

describe('★★ 家长设置里的提示词，本地引擎也要落实（2026-09-19 家长第三次提的）', () => {
  const SNOW = {
    title: '看图写话',
    category: 'event',
    grade: 3,
    childText: '下雪了。我和小明在雪地里打雪仗，还堆了一个雪人。',
    imageHints: ['雪后的校园：地上白茫茫一片，树枝上挂着雪，几个孩子在雪地里跑'],
  }

  const EVENT = {
    title: '难忘的事',
    category: 'event',
    grade: 4,
    childText: '那次运动会，我参加跳绳比赛。一开始我跳得很差，后来我天天练，最后拿了第三名。',
  }

  it('把家长的口语翻成结构化要求', () => {
    expect(parseExtraPrompt('描写细致、多用比喻')).toMatchObject({
      simile: true,
      personify: false,
    })
    expect(parseExtraPrompt('多点比喻和拟人')).toMatchObject({
      simile: true,
      personify: true,
    })
    expect(parseExtraPrompt('写点五感')).toMatchObject({ synesthesia: true })
    expect(parseExtraPrompt('多用叠词')).toMatchObject({ redup: true })
  })

  it('★ 没填 / 只填了空格 → 一条都不要（不许凭空补句子）', () => {
    const none = { simile: false, personify: false, synesthesia: false, redup: false }
    expect(parseExtraPrompt(undefined)).toEqual(none)
    expect(parseExtraPrompt('')).toEqual(none)
    expect(parseExtraPrompt('   ')).toEqual(none)
  })

  it('★ 家长点了比喻 → 正文里真的找得到比喻', () => {
    // 旧版这里是红的：本地引擎压根不读 extraPrompt
    const e = essayOf({ ...EVENT, extraPrompt: '多用比喻' })
    expect(usedRhetoric(e.text)).toContain('比喻')
  })

  it('★ 亮点要如实回报「家长点名的落实了没有」', () => {
    const e = essayOf({ ...EVENT, extraPrompt: '多用比喻' })
    const hl = e.highlights.join('|')
    expect(hl).toContain('加了比喻')
    expect(hl).toContain('家长点名的比喻')
  })

  it('★ 坑一：修辞判定要做在**裁剪之后**的正文上（写景分支的通感）', () => {
    /*
     * 写景分支的候选里本来就有通感句（「我伸手碰了一下…」），
     * 但它排在通用套话里、会被句数上限砍掉。
     * 旧版拿**裁剪之前**的候选去判定，于是：
     *   「已经有了通感」→ 不补 → 裁剪又把那句砍了 → 正文里一个通感都没有。
     * 这条断言的就是"判早了"：家长点了通感，最终正文里必须真的有。
     */
    const scene = essayOf({
      title: '秋天的公园',
      category: 'scene',
      grade: 4,
      childText:
        '今天下午我和爸爸去了公园。公园里的树叶都黄了。风一吹，叶子就往下掉。我觉得秋天的公园真好看。',
      extraPrompt: '多用通感',
    })
    expect(usedRhetoric(scene.text)).toContain('通感')
  })

  it('★ 坑二：家长点名的句子不受句数上限约束（一年级也塞得进去）', () => {
    // 一年级 keepCap 只有 2 句，而画面句正好占满 ——
    // 旧版家长那句排在画面句后面，一次都进不去
    const e = essayOf({ ...SNOW, grade: 1, extraPrompt: '多用比喻' })
    expect(usedRhetoric(e.text)).toContain('比喻')
    expect(e.highlights.join('|')).toContain('家长点名的比喻')
  })

  it('★ 四样一起点，四样都要落地', () => {
    const e = essayOf({ ...SNOW, grade: 1, extraPrompt: '多用比喻、拟人、通感、叠词' })
    const used = usedRhetoric(e.text)
    for (const n of ['比喻', '拟人', '通感', '叠词'] as const) {
      expect(used).toContain(n)
    }
    // 亮点里也要一条不落地报出来
    expect(e.highlights.join('|')).toContain('家长点名的比喻、拟人、通感、叠词')
  })

  it('★ 正文里已经有的修辞，不再补一句重复的', () => {
    // 写人分支本来就带比喻（「…都像{simile}」）——
    // 家长再点一次比喻，不该多出一句
    const base = essayOf(MAMA)
    expect(usedRhetoric(base.text)).toContain('比喻')
    const demanded = essayOf({ ...MAMA, extraPrompt: '多用比喻' })
    expect(demanded.text).toBe(base.text)
    // 但亮点要告诉家长「你要的那条在」
    expect(demanded.highlights.join('|')).toContain('家长点名的比喻')
  })

  it('★ 亮点不许宣称正文里没有的修辞（以前的假话）', () => {
    /*
     * 旧版 buildHighlights 是**无条件**写「加了比喻和拟人，让句子活起来」的，
     * 而写景/写事分支根本没有比喻 —— 家长看到的是假话。
     * 更要命的是：他在设置里点了「多用比喻」，想知道的正是
     * 「有没有落实」，而这条假话让他**永远看不出没落实**。
     */
    const e = essayOf({ ...SNOW, grade: 3 })
    const used = usedRhetoric(e.text)
    const claim = e.highlights.join('|')

    // 只要有「加了 X」，X 就必须真的在正文里
    for (const n of ['比喻', '拟人', '通感', '叠词'] as const) {
      if (claim.includes(`加了${n}`)) expect(used).toContain(n)
    }
    // 这篇正文确实一句修辞都没有 —— 那就一句都不许夸
    expect(used).toEqual([])
    expect(claim).not.toContain('加了')
  })

  it('★ 引擎做不到的要求要认得出来（好如实告诉家长，不装作做到了）', () => {
    expect(unfulfilledDemands('多用排比，语言要生动')).toEqual(['排比'])
    expect(unfulfilledDemands('要有对话描写和成语')).toEqual(['对话描写', '成语'])
    expect(unfulfilledDemands('结尾要首尾呼应')).toEqual(['首尾呼应'])
    // 做得到的、没填的，都不算「做不到」
    expect(unfulfilledDemands('多用比喻')).toEqual([])
    expect(unfulfilledDemands(undefined)).toEqual([])
    expect(unfulfilledDemands('')).toEqual([])
  })
})

describe('文字质量（都是踩过的坑）', () => {
  const e = essayOf()

  it('不能出现「像像」这种双重比喻', () => {
    expect(e.text).not.toContain('像像')
  })

  it('不能出现「落在前面上」这类缺宾语的病句', () => {
    expect(e.text).not.toMatch(/落在[^，。]{0,3}上/)
  })

  it('写妈妈的范文里不能用「他」指代', () => {
    expect(e.text).not.toMatch(/他只是|他的手|他说/)
  })

  it('同一句话不能在范文里出现两次', () => {
    const sentences = e.text
      .split(/[。！？\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 8)
    const dup = sentences.filter((s, i) => sentences.indexOf(s) !== i)
    expect(dup).toEqual([])
  })

  it('骨架行数应该和正文句数差不多，不能是空的', () => {
    expect(e.skeletonLines.length).toBeGreaterThan(3)
    for (const l of e.skeletonLines) {
      expect(l.full.length).toBeGreaterThan(0)
    }
  })

  it('有些句子应该带修饰词（这是提示卡的原料）', () => {
    const withMods = e.skeletonLines.filter((l) => l.modifiers.length > 0)
    expect(withMods.length).toBeGreaterThan(0)
  })
})

describe('结构完整', () => {
  const e = essayOf()

  it('有亮点标签', () => {
    expect(e.highlights.length).toBeGreaterThan(0)
  })

  it('引擎标记为 local', () => {
    expect(e.engine).toBe('local')
  })

  it('正文分段（开头 / 中间 / 结尾）', () => {
    const parts = e.text.split('\n\n').filter(Boolean)
    expect(parts.length).toBe(3)
  })

  it('低年级的范文比高年级短', () => {
    const low = essayOf({ ...MAMA, grade: 1 })
    const high = essayOf({ ...MAMA, grade: 6 })
    expect(low.text.length).toBeLessThanOrEqual(high.text.length)
  })
})

describe('确定性', () => {
  it('同一篇稿子生成的范文是稳定的', () => {
    const a = essayOf()
    const b = essayOf()
    expect(a.text).toBe(b.text)
  })

  it('不同的稿子生成不同的范文', () => {
    const a = essayOf()
    const b = essayOf({
      title: '我的爸爸',
      category: 'person',
      grade: 5,
      childText: '我的爸爸很高。他每天送我上学，从来不迟到。有一次下大雨，他把伞都给我了，自己淋湿了。',
    })
    expect(a.text).not.toBe(b.text)
  })
})
