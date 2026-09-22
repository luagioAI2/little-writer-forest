/* ============================================================
   题库测试 —— 重点是「导入」
   ============================================================

   这一块出过两类问题，都是静默的：

     1. 导入写成「同 id 直接覆盖」，等于悄悄弄丢库里那条。
        用户的原话是「我希望作文库导入是累加的」。
     2. 只认 App 自己导出的完整格式（带 format 字段），
        手写的「文库数据」（一个数组、或者带图片地址的条目）
        会被整份拒掉，还只回一句「这不是小笔苗的题库文件」。

   所以下面的用例围着三件事转：
     · 库里已有的题**一条都不能少**
     · 同一份文件导两次不能变成两倍
     · 图片地址（非本地 SVG）要能进来，多图按顺序
   ============================================================ */

import { describe, expect, it } from 'vitest'
import { importLibrary, exportLibrary, searchLibrary } from './library'
import type { LibraryItem } from './library'

const NOW = 1_700_000_000_000

/** 造一条题库记录 */
function item(over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: 'a',
    category: 'scene',
    tagId: '',
    title: '雨后的校园',
    lead: '下雨之后，校园里有什么不一样了？',
    images: [{ sceneKey: 'rain-window' }],
    wordRange: [100, 300],
    minGrade: 3,
    maxGrade: 6,
    focus: ['observation'],
    addedAt: NOW,
    source: 'imported',
    timesUsed: 0,
    aiGenerated: false,
    ...over,
  }
}

/** 把若干条数据包成「手写文库数据」的样子（纯数组） */
function raw(items: unknown[]): string {
  return JSON.stringify(items)
}

describe('题库导入 · 累加', () => {
  it('往空题库里导，全都进来', () => {
    const r = importLibrary([], raw([{ title: '春天', category: 'scene' }, { title: '妈妈', category: 'person' }]), NOW)
    expect(r.ok).toBe(true)
    expect(r.added).toBe(2)
    expect(r.items).toHaveLength(2)
    expect(r.items.map((i) => i.title).sort()).toEqual(['妈妈', '春天'])
  })

  it('库里已有的题一条都不动（回归：以前同 id 会被覆盖）', () => {
    const old = item({ id: 'keep-me', title: '库里的老题' })
    const r = importLibrary([old], raw([{ id: 'new-one', title: '新题', category: 'event' }]), NOW)

    expect(r.ok).toBe(true)
    expect(r.added).toBe(1)
    // 老题原封不动地还在，而且内容一模一样
    expect(r.items.find((i) => i.id === 'keep-me')).toEqual(old)
    expect(r.items).toHaveLength(2)
  })

  it('同一份文件导两次，第二次全部跳过，题库不翻倍', () => {
    const data = raw([
      { id: 'x1', title: '题一', category: 'scene' },
      { id: 'x2', title: '题二', category: 'scene' },
    ])
    const first = importLibrary([], data, NOW)
    expect(first.added).toBe(2)

    const second = importLibrary(first.items, data, NOW)
    expect(second.ok).toBe(true)
    expect(second.added).toBe(0)
    expect(second.skipped).toBe(2)
    expect(second.items).toHaveLength(2)
  })

  it('id 撞车也不覆盖 → 换一个新 id，两份都留着', () => {
    // 这是「累加」最容易翻车的地方：手写的数据文件常常都从 1 开始编号，
    // 第二个文件的 1 会神不知鬼不觉盖掉第一个文件的 1。
    const before = item({ id: 'dup', title: '第一道' })
    const r = importLibrary([before], raw([{ id: 'dup', title: '第二道', category: 'scene' }]), NOW)

    expect(r.added).toBe(1)
    expect(r.items).toHaveLength(2)
    const ids = r.items.map((i) => i.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids).toContain('dup')
    expect(ids).toContain('dup-2')
    // 老那条一个字都没被改
    expect(r.items.find((i) => i.id === 'dup')).toEqual(before)
  })

  it('id 撞车换的新 id 再撞就继续往后排（dup-2 → dup-3）', () => {
    const lib = [item({ id: 'dup', title: '一' }), item({ id: 'dup-2', title: '二' })]
    const r = importLibrary(lib, raw([{ id: 'dup', title: '三', category: 'scene' }]), NOW)
    expect(r.items.map((i) => i.id)).toContain('dup-3')
    expect(r.items).toHaveLength(3)
  })

  it('两个文件各自从 1 开始编号，导完两个文件的内容都在', () => {
    const fileA = raw([{ id: '1', title: 'A 的题', category: 'scene' }])
    const fileB = raw([{ id: '1', title: 'B 的题', category: 'event' }])

    const a = importLibrary([], fileA, NOW)
    const b = importLibrary(a.items, fileB, NOW)

    expect(b.added).toBe(1)
    expect(b.items.map((i) => i.title).sort()).toEqual(['A 的题', 'B 的题'])
  })

  it('连导两个文件，两个文件的内容叠在一起', () => {
    const a = importLibrary([], raw([{ title: 'A', category: 'scene' }]), NOW)
    const b = importLibrary(a.items, raw([{ title: 'B', category: 'event' }]), NOW)

    expect(b.added).toBe(1)
    expect(b.items.map((i) => i.title).sort()).toEqual(['A', 'B'])
  })
})

describe('题库导入 · 认哪些输入形状', () => {
  it('认 App 自己导出的完整格式，而且导出→导入是幂等的', () => {
    const items = [item({ id: 'e1' }), item({ id: 'e2', title: '另一道' })]
    const dumped = JSON.stringify(exportLibrary(items, NOW))

    const r = importLibrary([], dumped, NOW)
    expect(r.ok).toBe(true)
    expect(r.added).toBe(2)

    // 再导一次同一份导出文件 —— 一条都不该多
    const again = importLibrary(r.items, dumped, NOW)
    expect(again.added).toBe(0)
    expect(again.skipped).toBe(2)
    expect(again.items).toHaveLength(2)
  })

  it('认「一个数组」这种最省事的手写格式', () => {
    const r = importLibrary([], raw([{ title: '手写题', category: 'imagine' }]), NOW)
    expect(r.ok).toBe(true)
    expect(r.items[0].title).toBe('手写题')
  })

  it('认 { items: [...] } 包了一层的样子', () => {
    const r = importLibrary([], JSON.stringify({ items: [{ title: '包一层的题', category: 'object' }] }), NOW)
    expect(r.ok).toBe(true)
    expect(r.added).toBe(1)
  })

  it('认中文类别名，省得手写时去查英文', () => {
    const r = importLibrary([], raw([{ title: '中文类别', category: '写景' }]), NOW)
    expect(r.ok).toBe(true)
    expect(r.items[0].category).toBe('scene')
  })

  it('别家的 format 会被挡掉，不会把整机备份当题库导进来', () => {
    const r = importLibrary([], JSON.stringify({ format: 'little-writer-forest.backup', items: [item()] }), NOW)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('题库')
  })
})

describe('题库导入 · 图片路径（非本地 SVG）', () => {
  it('images 直接写地址字符串 → 变成 imageUrl，多张按顺序', () => {
    const r = importLibrary(
      [],
      raw([
        {
          title: '连环图',
          category: 'event',
          images: ['https://cdn.example.com/1.png', 'https://cdn.example.com/2.png'],
        },
      ]),
      NOW,
    )
    expect(r.ok).toBe(true)
    expect(r.items[0].images).toEqual([
      { imageUrl: 'https://cdn.example.com/1.png' },
      { imageUrl: 'https://cdn.example.com/2.png' },
    ])
  })

  it('images 写成对象可以带说明文字，也能同时给 sceneKey 兜底', () => {
    const r = importLibrary(
      [],
      raw([
        {
          title: '带说明的图',
          category: 'scene',
          images: [
            { imageUrl: 'https://cdn.example.com/a.png', caption: '下雨了' },
            { imageUrl: '/photos/b.png', sceneKey: 'rainbow' },
          ],
        },
      ]),
      NOW,
    )
    expect(r.items[0].images).toEqual([
      { imageUrl: 'https://cdn.example.com/a.png', caption: '下雨了' },
      { imageUrl: '/photos/b.png', sceneKey: 'rainbow' },
    ])
  })

  it('url / src / path 这几个顺手写法也认', () => {
    const r = importLibrary(
      [],
      raw([
        {
          title: '别名',
          category: 'scene',
          images: [{ url: 'https://a.example.com/1.png' }, { src: 'https://a.example.com/2.png' }, { path: '/p/3.png' }],
        },
      ]),
      NOW,
    )
    expect(r.items[0].images.map((i) => i.imageUrl)).toEqual([
      'https://a.example.com/1.png',
      'https://a.example.com/2.png',
      '/p/3.png',
    ])
  })

  it('既没有地址也没有 sceneKey 的图会被丢掉，不留空图', () => {
    const r = importLibrary(
      [],
      raw([
        {
          title: '半条图',
          category: 'scene',
          images: [{ caption: '只有说明文字' }, { imageUrl: 'https://ok.example.com/x.png' }],
        },
      ]),
      NOW,
    )
    expect(r.items[0].images).toEqual([{ imageUrl: 'https://ok.example.com/x.png' }])
  })

  it('图片地址两样的题不会被当成同一道（判重指纹含配图）', () => {
    const without = importLibrary([], raw([{ title: '同一道题', category: 'scene' }]), NOW)
    const withPic = importLibrary(
      without.items,
      raw([{ title: '同一道题', category: 'scene', images: ['https://cdn.example.com/new.png'] }]),
      NOW,
    )
    // 没给 id → 两条是不同 id 的新题；给了同一道题的新版图就该多一条
    expect(withPic.added).toBe(1)
  })
})

describe('题库导入 · 坏数据要说清原因', () => {
  it('缺 title 的条目被丢掉，并且说出原因', () => {
    const r = importLibrary([], raw([{ category: 'scene' }, { title: '好的', category: 'scene' }]), NOW)
    expect(r.ok).toBe(true)
    expect(r.added).toBe(1)
    expect(r.invalid).toBe(1)
    expect(r.problems[0]).toContain('title')
  })

  it('类别写错时把写错的值念出来', () => {
    const r = importLibrary([], raw([{ title: 'X', category: '写景文' }, { title: '好的', category: 'scene' }]), NOW)
    expect(r.invalid).toBe(1)
    expect(r.problems[0]).toContain('写景文')
  })

  it('一条都不合格时 ok=false，题库原样返回（绝不清空）', () => {
    const existing = [item()]
    const r = importLibrary(existing, raw([{ category: 'scene' }, { title: 'Y', category: '不存在' }]), NOW)
    expect(r.ok).toBe(false)
    expect(r.items).toEqual(existing)
    expect(r.invalid).toBe(2)
  })

  it('文件不是 JSON 时 ok=false，题库原样返回', () => {
    const existing = [item()]
    const r = importLibrary(existing, '这不是 json', NOW)
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
    expect(r.items).toEqual(existing)
  })
})

describe('题库导入 · 落库字段', () => {
  it('导入的题默认 source=imported、用过 0 次、不是 AI 出的', () => {
    const r = importLibrary([], raw([{ title: '新题', category: 'scene' }]), NOW)
    const it0 = r.items[0]
    expect(it0.source).toBe('imported')
    expect(it0.timesUsed).toBe(0)
    expect(it0.aiGenerated).toBe(false)
    expect(it0.addedAt).toBe(NOW)
  })

  it('不写 id 的题也会各自拿到一个不重复的 id', () => {
    const r = importLibrary([], raw([{ title: 'A', category: 'scene' }, { title: 'B', category: 'scene' }]), NOW)
    expect(r.items[0].id).not.toBe(r.items[1].id)
    expect(r.items.every((i) => i.id.length > 0)).toBe(true)
  })

  it('wordRange / 年级缺省时有兜底值，不会变成 NaN', () => {
    const r = importLibrary([], raw([{ title: '缺字段', category: 'scene' }]), NOW)
    const it0 = r.items[0]
    expect(it0.wordRange).toEqual([60, 200])
    expect(it0.minGrade).toBe(1)
    expect(it0.maxGrade).toBe(1)
  })
})

/* ============================================================
   题库导入 · 标签写中文也认
   ============================================================

   标签 id 是英文的（`weather`），但家长手写题库数据时**自然会写中文**
   （`"tagId": "天气"`）。以前只按 id 精确匹配，写中文会**静默匹配不上**：
   标签筛不到题、界面上也不出 emoji，而且不报错 —— 很难查。

   做法：入库时归一化成规范 id；界面上再翻回中文显示。
   和 category 的处理是一致的（category 本来就认中文）。
   ============================================================ */

describe('题库导入 · 标签写中文也认', () => {
  it('★ 写「天气」和写 "weather" 等价，归一化成同一个 id', () => {
    const zh = importLibrary([], raw([{ title: '下雨了', category: 'scene', tagId: '天气' }]), NOW)
    const en = importLibrary([], raw([{ title: '下雨了', category: 'scene', tagId: 'weather' }]), NOW)

    expect(zh.items[0].tagId).toBe('weather')
    expect(en.items[0].tagId).toBe('weather')
  })

  it('★ 中文标签要能真的筛到题 —— 不归一化的话这里会静默返回空', () => {
    const r = importLibrary([], raw([{ title: '下雨了', category: 'scene', tagId: '天气' }]), NOW)
    expect(searchLibrary(r.items, { tagId: 'weather' })).toHaveLength(1)
  })

  it('家长自定义的标签（不在标签表里）原样保留，不该被改写', () => {
    const r = importLibrary([], raw([{ title: '我家的事', category: 'event', tagId: '我的私房题' }]), NOW)
    expect(r.items[0].tagId).toBe('我的私房题')
  })

  it('标签留空不报错', () => {
    const r = importLibrary([], raw([{ title: '没标签', category: 'scene' }]), NOW)
    expect(r.items[0].tagId).toBe('')
  })
})
