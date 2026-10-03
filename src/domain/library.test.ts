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
import { importLibrary, exportLibrary, searchLibrary, migrateStoredItem } from './library'
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

/* ============================================================
   导入 · 格式要求（原「轴 3」）与命题方式（轴 2）（2026-10-01）
   ------------------------------------------------------------
   这一天把题目的 `genre` 改名成 `requiredGenre`，语义收窄为
   「题目**指定**的文体」。（⛔ 2026-10-02 又收窄一次：现在是
   「题目**自带**的格式要求」—— 家长定了「APP 不需要区分文体」。）
   改名会**改掉导出的 key** ——
   所以 2026-10-01 之前导出的文件里写的是旧名字 `genre`。

   ⚠️ 这里认不出来的失败是**静默**的：一道应用文题会悄悄变成记叙文题，
      不报错、不崩、题也进得来、计数也对，只是格式要求错了。
   ============================================================ */

describe('导入 · 格式要求（原「轴 3」）', () => {
  it('★★ 旧导出文件里的 `genre` key 仍然认（改名兼容）', () => {
    // 2026-10-01 之前导出的文件长这样。少认这一个 key，
    // 家长手上的老备份导回来就全变成记叙文题了。
    const r = importLibrary(
      [],
      raw([{ title: '旧文件里的倡议书', category: 'event', genre: 'applied' }]),
      NOW,
    )
    expect(r.items[0].requiredGenre).toBe('applied')
  })

  it('★ 两个名字都写了 → 新名字优先', () => {
    const r = importLibrary(
      [],
      raw([
        { title: '两个都写了', category: 'event', genre: 'applied', requiredGenre: 'narrative' },
      ]),
      NOW,
    )
    expect(r.items[0].requiredGenre).toBe('narrative')
  })

  it('写中文也认（跟 tagId 同一条规矩）', () => {
    const r = importLibrary(
      [],
      raw([{ title: '中文文体', category: 'event', requiredGenre: '应用文' }]),
      NOW,
    )
    expect(r.items[0].requiredGenre).toBe('applied')
  })

  it('★★ 格式要求写了错别字 → 退回「从标签推」，不许硬翻成记叙文', () => {
    // ⚠️ 这条守的是 `parseGenre` 必须返回 `undefined`（而不是 'narrative'）：
    //    一旦它硬翻，`??` 右边那层「从标签推」就永远拿不到值 ——
    //    一道应用文题会因为一个错别字**静默**变成记叙文题。
    const r = importLibrary(
      [],
      raw([
        {
          title: '打错字了',
          category: 'event',
          tagId: 'applied-writing',
          requiredGenre: 'appliedd',
        },
      ]),
      NOW,
    )
    expect(r.items[0].requiredGenre).toBe('applied')
  })

  it('什么都没写、标签也查不到 → 记叙文（老行为，零变更）', () => {
    const r = importLibrary([], raw([{ title: '光秃秃', category: 'scene' }]), NOW)
    expect(r.items[0].requiredGenre).toBe('narrative')
  })
})

describe('导入 · 命题方式（轴 2）', () => {
  it('英文 key 和中文名都认', () => {
    const r = importLibrary(
      [],
      raw([
        { title: 'a', category: 'event', promptMode: 'material' },
        { title: 'b', category: 'event', promptMode: '材料作文' },
      ]),
      NOW,
    )
    expect(r.items.map((i) => i.promptMode)).toEqual(['material', 'material'])
  })

  it('★★ 没写 → 从标签推：标签写了什么就存什么', () => {
    /* ⛔ 2026-10-02：这条原来用的是 `look-picture`（看图作文）——
       那个标签连同它的题已按家长决定删掉，所以换成应用文。
       ★ 判据要能**区分**「从标签取了值」和「走了缺省」：
         · `applied-writing` 标签显式写了 `promptMode: 'assigned'`
           → 存下去就是 `'assigned'`；
         · `weather` 标签**没写** → 存下去是 `undefined`
           （解析后才变「命题作文」）。
       两者解析后都是命题作文，但**存的值不一样**，所以这条能咬住。 */
    const withTag = importLibrary(
      [],
      raw([{ title: '写一份倡议书', category: 'event', tagId: 'applied-writing' }]),
      NOW,
    )
    expect(withTag.items[0].promptMode).toBe('assigned')
    expect(withTag.items[0].requiredGenre).toBe('applied')

    const noTag = importLibrary(
      [],
      raw([{ title: '雨后的校园', category: 'scene', tagId: 'weather' }]),
      NOW,
    )
    expect(noTag.items[0].promptMode).toBeUndefined()
  })

  it('认不出来 → undefined（= 命题作文），不许硬翻', () => {
    // 跟 parseGenre 同理：硬翻成 'assigned' 会盖掉「从标签推」那条路。
    const r = importLibrary([], raw([{ title: 'c', category: 'event', promptMode: '啥玩意儿' }]), NOW)
    expect(r.items[0].promptMode).toBeUndefined()
  })
})

/* ============================================================
   老存档迁移 · `genre` → `requiredGenre`（2026-10-01）
   ------------------------------------------------------------
   改名会改掉**存进去的 key**，老用户库里那批题带的是旧名字。
   「读出来之后走哪条路」由 `src/db/libraryMigration.test.ts` 守着，
   这里只守这个纯函数本身的两条性质。
   ============================================================ */

describe('migrateStoredItem · 纯函数的两条性质', () => {
  it('★★ 不改动传进来的那条记录（它是从 IndexedDB 读出来的活对象）', () => {
    const old = { ...item(), genre: 'applied' } as unknown as LibraryItem
    const snapshot = JSON.parse(JSON.stringify(old))
    const migrated = migrateStoredItem(old)

    expect(migrated).not.toBe(old)
    expect(migrated.requiredGenre).toBe('applied')
    // 传进来的那份必须原封不动
    expect(old).toEqual(snapshot)
  })

  it('★ 只搬 key，不猜格式要求 —— 旧值认不出来时不许硬翻', () => {
    // 判据是「旧 key 在不在」，不是「旧值合不合法」。
    // 这里硬翻成记叙文，会把「家长写错别字」这条信息抹掉。
    const weird = { ...item(), genre: 'appliedd' } as unknown as LibraryItem
    expect(migrateStoredItem(weird).requiredGenre).toBe('appliedd')
  })
})
