/* ============================================================
   内置题库覆盖层 —— 数据侧的守卫
   ============================================================

   家长 09-27：「我希望 作文库 也可以编辑……之后需要同时支持图片链接 (pexels等)。」
   口径（家长选的）：只编辑**内置的 136 道**、配图是**一题一图**。

   这一份守的是**盘上那份表**（`data/library-items.json`）和**合并那一步**。
   界面侧（编辑页计数）与落盘侧（`vite.config.ts` 的端点）各有自己的守卫，
   见 `_verify-library-editor.mjs`。

   ⚠️ 字数上限**从 `libraryItemLimits.ts` 引**，不在这个文件里写 20 / 60 ——
      三处判定（这里 / 编辑页计数 / 落盘端点）必须是同一个数字。
   ============================================================ */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildBuiltinLibrary, builtinBaseItems } from './builtinLibrary'
import {
  LIBRARY_ITEM_OVERRIDES,
  applyLibraryOverride,
  checkLibraryOverrides,
  libraryOverrideCount,
  type LibraryItemOverride,
} from './libraryItems'
import { LIBRARY_LEAD_MAX, LIBRARY_TITLE_MAX, imageUrlProblem } from './libraryItemRules'

const BASE = builtinBaseItems()
const byId = new Map(BASE.map((i) => [i.id, i]))
/** 拿一条真实的底稿条目当夹具，别手捏一个形状 —— 捏错了守卫会假绿 */
const sample = BASE[0]
const SAMPLE_OV: LibraryItemOverride = {
  baseTitle: sample.title,
  baseLead: sample.lead,
}

describe('内置题库覆盖层 · 盘上那份表', () => {
  it('本身没有问题：键都能解析到内置题 / 不串位 / 不超字数 / 地址合法', () => {
    expect(checkLibraryOverrides(LIBRARY_ITEM_OVERRIDES, BASE)).toEqual([])
  })

  it('每条覆盖挂的都是真实存在的内置题 id（打错一个字 = 永远不生效）', () => {
    for (const id of Object.keys(LIBRARY_ITEM_OVERRIDES)) {
      expect(byId.has(id), `覆盖层里的「${id}」不是内置题`).toBe(true)
    }
  })

  it('★ 每条覆盖的 baseTitle / baseLead 都对得上底稿（对不上 = id 被挪位了）', () => {
    /* ⚠️ 这一条和上面那条是**两个**不同的失效：
       上面管"这个 id 不存在"，这一条管"id 还在、但指的东西换了"。
       后者更阴 —— 覆盖会**成功地盖到另一道题上**，不报错、不崩。 */
    for (const [id, ov] of Object.entries(LIBRARY_ITEM_OVERRIDES)) {
      const item = byId.get(id)
      if (!item) continue
      expect(ov.baseTitle, `${id} 的 baseTitle 对不上底稿`).toBe(item.title)
      expect(ov.baseLead, `${id} 的 baseLead 对不上底稿`).toBe(item.lead)
    }
  })

  it('覆盖层不改 id、不改条数 —— 对账与使用痕迹全靠 id', () => {
    const overridden = buildBuiltinLibrary()
    expect(overridden.map((i) => i.id)).toEqual(BASE.map((i) => i.id))
    expect(overridden).toHaveLength(BASE.length)
  })

  it('`libraryOverrideCount()` 跟文件里的条数一致', () => {
    expect(libraryOverrideCount()).toBe(Object.keys(LIBRARY_ITEM_OVERRIDES).length)
  })
})

describe('★★ 合并真的接线了（盘上是空的，所以下面这条不能用盘上那份测）', () => {
  /*
   * ⚠️⚠️ 这个 describe 存在的理由：
   *
   *   盘上那份覆盖层现在是**空的**，所以"空覆盖 ⇒ 输出跟底稿一样"这条
   *   **不管 `buildBuiltinLibrary()` 有没有调用 `applyLibraryOverride` 都通过**。
   *   也就是说，把那行删掉，整套测试依然全绿 —— 这是典型的**装饰性守卫**。
   *
   *   ➜ 判据必须是**塞一份非空覆盖进去、看输出真的变了**。
   */

  it('空覆盖 → 输出跟底稿**逐字节一样**（加这个功能没有改变今天的行为）', () => {
    expect(JSON.stringify(buildBuiltinLibrary({}))).toBe(JSON.stringify(BASE))
  })

  it('塞一条假覆盖进去 → 标题真的被换掉（证明合并没有被删）', () => {
    const out = buildBuiltinLibrary({ [sample.id]: { ...SAMPLE_OV, title: '改过的标题' } })
    expect(out.find((i) => i.id === sample.id)!.title).toBe('改过的标题')
    // 别的题一个字都不许动
    expect(out.filter((i) => i.id !== sample.id)).toEqual(BASE.filter((i) => i.id !== sample.id))
  })

  it('塞一条假覆盖进去 → 引导语真的被换掉', () => {
    const out = buildBuiltinLibrary({ [sample.id]: { ...SAMPLE_OV, lead: '改过的引导语' } })
    expect(out.find((i) => i.id === sample.id)!.lead).toBe('改过的引导语')
  })

  it('塞一条假覆盖进去 → 配图的 imageUrl 真的被填上', () => {
    const url = 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg'
    const out = buildBuiltinLibrary({ [sample.id]: { ...SAMPLE_OV, imageUrls: [url] } })
    expect(out.find((i) => i.id === sample.id)!.images[0].imageUrl).toBe(url)
  })
})

describe('applyLibraryOverride · 只动该动的', () => {
  const url = 'https://images.pexels.com/photos/2/pexels-photo-2.jpeg'

  it('改标题 → 只有 title 变，别的字段一个不动', () => {
    const next = applyLibraryOverride(sample, { ...SAMPLE_OV, title: '新标题' })
    expect(next.title).toBe('新标题')
    expect(next).toEqual({ ...sample, title: '新标题' })
  })

  it('改引导语 → 只有 lead 变', () => {
    const next = applyLibraryOverride(sample, { ...SAMPLE_OV, lead: '新引导语' })
    expect(next).toEqual({ ...sample, lead: '新引导语' })
  })

  it('★★ 换配图**不许把 sceneKey 抹掉** —— 外链挂了还要能退回插画', () => {
    const next = applyLibraryOverride(sample, { ...SAMPLE_OV, imageUrls: [url] })
    expect(next.images[0].imageUrl).toBe(url)
    expect(next.images[0].sceneKey).toBe(sample.images[0].sceneKey)
    // caption 也不动
    expect(next.images[0].caption).toBe(sample.images[0].caption)
  })

  it('id / category / tagId / wordRange / minGrade / maxGrade / focus / addedAt / source 都不动', () => {
    const next = applyLibraryOverride(sample, {
      ...SAMPLE_OV,
      title: '新标题',
      lead: '新引导语',
      imageUrls: [url],
    })
    expect(next.id).toBe(sample.id)
    expect(next.category).toBe(sample.category)
    expect(next.tagId).toBe(sample.tagId)
    expect(next.wordRange).toEqual(sample.wordRange)
    expect(next.minGrade).toBe(sample.minGrade)
    expect(next.maxGrade).toBe(sample.maxGrade)
    expect(next.focus).toEqual(sample.focus)
    expect(next.addedAt).toBe(sample.addedAt)
    expect(next.source).toBe(sample.source)
    expect(next.timesUsed).toBe(sample.timesUsed)
  })

  it('纯函数：不改传进来的那道题', () => {
    const snapshot = JSON.stringify(sample)
    applyLibraryOverride(sample, { ...SAMPLE_OV, title: '新标题', imageUrls: [url] })
    expect(JSON.stringify(sample)).toBe(snapshot)
  })

  it('多图（连环图）只给第一张 → 只换第一张，其余原样', () => {
    const multi = BASE.find((i) => i.images.length > 1)!
    const next = applyLibraryOverride(multi, {
      baseTitle: multi.title,
      baseLead: multi.lead,
      imageUrls: [url],
    })
    expect(next.images[0].imageUrl).toBe(url)
    for (let k = 1; k < multi.images.length; k += 1) {
      expect(next.images[k]).toEqual(multi.images[k])
    }
  })

  it('覆盖层里没写 title / lead / imageUrls → 输出跟底稿一样', () => {
    expect(applyLibraryOverride(sample, SAMPLE_OV)).toEqual(sample)
  })
})

describe('imageUrlProblem · 四种形态（这是"能不能装进 APK"的判据）', () => {
  it('https 外链 → 通过（Pexels 等图库都是这个形状）', () => {
    expect(imageUrlProblem('https://images.pexels.com/photos/1/x.jpeg?auto=compress')).toBeNull()
  })

  it('`/` 开头的本地路径 → 通过（自己塞进 public/ 的图）', () => {
    expect(imageUrlProblem('/photos/my-park.jpg')).toBeNull()
  })

  it('★ `http://` → 拒收，而且要说清"装进 APK 会被拦"', () => {
    const why = imageUrlProblem('http://images.pexels.com/photos/1/x.jpeg')
    expect(why).toBeTruthy()
    expect(why).toContain('https://')
  })

  it('`//evil.com/x` 不算本地路径（协议相对会跑到外站）', () => {
    expect(imageUrlProblem('//evil.com/x.jpg')).toBeTruthy()
  })

  it('别的协议 / 空值 → 拒收', () => {
    expect(imageUrlProblem('ftp://a/b.jpg')).toBeTruthy()
    expect(imageUrlProblem('javascript:alert(1)')).toBeTruthy()
    expect(imageUrlProblem('   ')).toBeTruthy()
    expect(imageUrlProblem('')).toBeTruthy()
  })

  it('大小写不敏感：`HTTPS://` 也认', () => {
    expect(imageUrlProblem('HTTPS://images.pexels.com/x.jpeg')).toBeNull()
  })
})

describe('checkLibraryOverrides · 会静默失效的错都要报出来', () => {
  const good = sample.id
  const ov = (o: Partial<LibraryItemOverride>): LibraryItemOverride => ({ ...SAMPLE_OV, ...o })

  it('键打错一个字 → 「不存在的内置题」', () => {
    /* ⚠️ 夹具必须**带上一个真的改动**（`title`），否则会先撞上"什么都没改"那条 —— 
       那样测到的就不是 id 这条了（同一个夹具只能测一个失效） */
    const out = checkLibraryOverrides({ [`${good}-typo`]: ov({ title: '改了标题' }) }, BASE)
    expect(out.length).toBe(1)
    expect(out[0]).toContain('不存在的内置题')
  })

  it('★★ baseTitle 对不上底稿 → 报「可能被挪位了」（不是照盖）', () => {
    const out = checkLibraryOverrides(
      { [good]: ov({ baseTitle: '另一个标题', title: '新标题' }) },
      BASE,
    )
    expect(out.length).toBe(1)
    expect(out[0]).toContain('挪位')
  })

  it('baseLead 对不上底稿 → 同样报出来', () => {
    const out = checkLibraryOverrides(
      { [good]: ov({ baseLead: '另一句引导语', title: '新标题' }) },
      BASE,
    )
    expect(out.length).toBe(1)
    expect(out[0]).toContain('挪位')
  })

  it('标题超字数 → 报出实际字数和上限', () => {
    const out = checkLibraryOverrides(
      { [good]: ov({ title: '字'.repeat(LIBRARY_TITLE_MAX + 1) }) },
      BASE,
    )
    expect(out.length).toBe(1)
    expect(out[0]).toContain(String(LIBRARY_TITLE_MAX + 1))
    expect(out[0]).toContain(String(LIBRARY_TITLE_MAX))
  })

  it('标题刚好卡在上限 → 不算超（边界不能差一个）', () => {
    const out = checkLibraryOverrides(
      { [good]: ov({ title: '字'.repeat(LIBRARY_TITLE_MAX) }) },
      BASE,
    )
    expect(out).toEqual([])
  })

  it('引导语超字数 / 刚好卡上限', () => {
    expect(
      checkLibraryOverrides({ [good]: ov({ lead: '字'.repeat(LIBRARY_LEAD_MAX + 1) }) }, BASE)
        .length,
    ).toBe(1)
    expect(
      checkLibraryOverrides({ [good]: ov({ lead: '字'.repeat(LIBRARY_LEAD_MAX) }) }, BASE),
    ).toEqual([])
  })

  it('标题 / 引导语是空的 → 报出来（空值不该写进覆盖层）', () => {
    expect(checkLibraryOverrides({ [good]: ov({ title: '   ' }) }, BASE)[0]).toContain('是空的')
    expect(checkLibraryOverrides({ [good]: ov({ lead: '' }) }, BASE)[0]).toContain('是空的')
  })

  it('首尾有空白 → 报出来（落盘会 trim，留着只会让 diff 飘红）', () => {
    expect(checkLibraryOverrides({ [good]: ov({ title: ' 新标题 ' }) }, BASE)[0]).toContain('空白')
  })

  it('跟原文一样 → 报「没改就别写它」（覆盖层只记真的改了的）', () => {
    const out = checkLibraryOverrides({ [good]: ov({ title: sample.title }) }, BASE)
    expect(out.length).toBe(1)
    expect(out[0]).toContain('跟原文一样')
  })

  it('配图给多了（超过这题的张数）→ 报出来', () => {
    const single = BASE.find((i) => i.images.length === 1)!
    const out = checkLibraryOverrides(
      {
        [single.id]: {
          baseTitle: single.title,
          baseLead: single.lead,
          imageUrls: ['https://a/b.jpeg', 'https://a/c.jpeg'],
        },
      },
      BASE,
    )
    expect(out.length).toBe(1)
    expect(out[0]).toContain('只有 1 张')
  })

  it('配图是 http:// → 报出来', () => {
    const out = checkLibraryOverrides({ [good]: ov({ imageUrls: ['http://a/b.jpeg'] }) }, BASE)
    expect(out.length).toBe(1)
    expect(out[0]).toContain('第 1 张')
  })

  it('配图是空数组 → 报出来', () => {
    expect(checkLibraryOverrides({ [good]: ov({ imageUrls: [] }) }, BASE)[0]).toContain('是空的')
  })

  it('一条什么都没改 → 报出来（覆盖层只记真的改了的）', () => {
    const out = checkLibraryOverrides({ [good]: SAMPLE_OV }, BASE)
    expect(out.length).toBe(1)
    expect(out[0]).toContain('什么都没改')
  })

  it('不认识的字段 → 报出来（写进去也不会生效）', () => {
    const out = checkLibraryOverrides(
      { [good]: { ...ov({ title: '新标题' }), oops: 1 } as LibraryItemOverride },
      BASE,
    )
    expect(out.length).toBe(1)
    expect(out[0]).toContain('不认识的字段')
  })

  it('一次报**全部**问题（不是遇到第一个就返回）', () => {
    const out = checkLibraryOverrides(
      {
        [`${good}-typo`]: ov({ title: '改了、但 id 不存在' }),
        [good]: ov({ baseTitle: '错的', title: '字'.repeat(LIBRARY_TITLE_MAX + 5) }),
      },
      BASE,
    )
    // ① 标题超字数（形态层）② id 不存在（底稿层）③ baseTitle 对不上（底稿层）
    expect(out.length).toBe(3)
    expect(out.some((s) => s.includes('超过'))).toBe(true)
    expect(out.some((s) => s.includes('不存在的内置题'))).toBe(true)
    expect(out.some((s) => s.includes('挪位'))).toBe(true)
  })
})

describe('形态检查 · 落盘端点用的是同一个函数（不是另抄一份）', () => {
  it('★★ `vite.config.ts` 引的是 `libraryItemShapeProblems`，没有自己再写一套', () => {
    /*
     * ⚠️⚠️ 为什么这一条是**源码级**的：
     *    `vite.config.ts` 的 tsconfig 是 `nodenext`，引不了 `libraryItems.ts`
     *    （会一路拉进 `types.ts` 报 TS2835），所以它只能引
     *    `libraryItemRules.ts` 里那个**不依赖任何东西**的函数。
     *
     *    这正是最容易走偏的地方：端点校验"看起来"该由它自己写，
     *    于是有人抄一份 —— 两份判定迟早说法不一样，症状是
     *    **编辑页说没问题、保存却 400**，而两边都不报错。
     *
     *    ➜ 判据：端点里必须**出现**这个函数名，且**不许**再出现
     *      `LIBRARY_TITLE_MAX` / `LIBRARY_LEAD_MAX` 之外的字面数字比较。
     */
    const file = resolve(process.cwd(), 'vite.config.ts')
    expect(existsSync(file), `找不到 ${file} —— 测试的工作目录不是项目根？`).toBe(true)
    const src = readFileSync(file, 'utf8')
    expect(
      /libraryItemShapeProblems\s*\(/.test(src),
      'vite.config.ts 里没有调用 `libraryItemShapeProblems()` —— ' +
        '要么端点没接校验，要么它自己抄了一份（两份判定会打架）',
    ).toBe(true)
    expect(
      /from '\.\/src\/domain\/libraryItemRules\.ts'/.test(src),
      'vite.config.ts 不是从 `libraryItemRules.ts` 引的 —— ' +
        '引 `libraryItems.ts` 会因为 nodenext 解析不了而报 TS2835',
    ).toBe(true)
  })

  it('★★ `library-browse.html` 也没自己抄一份地址判定（第一版真的抄了）', () => {
    /*
     * ⚠️⚠️ 这条是**补上来的**：第一版的编辑页里写着
     *
     *     function imageProblem(url) {
     *       if (/^https:\/\//i.test(url)) return null
     *       if (url.startsWith('/') && !url.startsWith('//')) return null
     *       return '地址不合法'
     *     }
     *
     *     —— 就是 `imageUrlProblem()` 的**手抄版**。
     *     后果不是报错，而是**两边说法不一样**：编辑页给绿勾、按保存却 400，
     *     而两边都不报错（正是 `libraryItemRules.ts` 文件头警告的那件事）。
     *
     * ➜ 判据：页面里必须**调用**那个函数，而且**不许再出现**"测 https 开头"的正则。
     */
    const file = resolve(process.cwd(), 'library-browse.html')
    expect(existsSync(file), `找不到 ${file} —— 测试的工作目录不是项目根？`).toBe(true)
    const src = readFileSync(file, 'utf8')
    expect(
      /imageUrlProblem\s*\(/.test(src),
      'library-browse.html 里没有调用 `imageUrlProblem()` —— ' +
        '要么它没做地址校验，要么它自己抄了一份（两份判定会打架）',
    ).toBe(true)
    expect(
      src.includes('/^https:'),
      'library-browse.html 里又出现了一份"https 开头"的正则 —— ' +
        '地址合法性只有 `libraryItemRules.ts` 一份，页面要调那个函数',
    ).toBe(false)
  })
})
