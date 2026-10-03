/* ============================================================
   景点公共简介 —— 数据侧的守卫
   ============================================================

   家长 09-26：「旅游景点 没有公共简介，字数不超过300。」

   这一份守的是**盘上那份表**（`landmark-intros.json`）和**加载器**。
   界面侧（编辑器信息条）与落盘侧（`vite.config.ts` 的端点）各有自己的守卫，
   见 `_verify-travel-editor.mjs` 与 `_verify-browse-edit.mjs`。

   ⚠️ 字数上限**从 `types.ts` 引**，不在这个文件里写 300 ——
      三处判定（这里 / 编辑器计数 / 落盘端点）必须是同一个数字。
   ============================================================ */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkLandmarkIntros, LANDMARK_SEEDS, toLandmark } from './landmarks'
import { LANDMARK_INTRO_MAX } from '../domain/types'
import { LANDMARKS } from '../domain/travel'
import raw from './landmark-intros.json'

/** 盘上那份简介表：`landmarkId → 一段话` */
const INTROS: Record<string, string> = raw

describe('景点公共简介 · 盘上那份表', () => {
  it('本身没有问题：键都能解析到地标 / 非空 / 不超字数', () => {
    expect(checkLandmarkIntros()).toEqual([])
  })

  it('加载器真的把它接上了 —— 文件里有几条，`LANDMARKS` 里就该有几条带 intro', () => {
    /*
     * ★★ 这一条防的是「接线断了」：文件里明明写着简介，
     *    而 `toLandmark()` 没抄 `intro`（或者键名对不上）。
     *    后果是**简介永远不显示，而且不报错、不崩、计数也不变** ——
     *    跟 `heat` 那次一模一样（字段声明了、数据也在，就是没接上）。
     */
    const withIntro = LANDMARKS.filter((l) => l.intro)
    expect(withIntro.length).toBe(Object.keys(INTROS).length)
  })

  it('每条都非空、不超字数、首尾没有空白', () => {
    for (const [id, text] of Object.entries(INTROS)) {
      expect(text.trim().length, `${id} 是空的`).toBeGreaterThan(0)
      expect(text.length, `${id} 超过 ${LANDMARK_INTRO_MAX} 字`).toBeLessThanOrEqual(
        LANDMARK_INTRO_MAX,
      )
      /* ⚠️ 首尾空白必须没有：落盘端点会 `trim()`。
         手写的文件带一个尾空格 → 第一次保存整行变样，diff 噪音里藏真改动。 */
      expect(text, `${id} 首尾有空白`).toBe(text.trim())
    }
  })

  it('键按 id 排好序 —— 跟落盘端点的写法一致，保存后 diff 不会整篇飘红', () => {
    const keys = Object.keys(INTROS)
    expect(keys).toEqual([...keys].sort())
  })

  it('`toLandmark()` 会把简介带上（不是只在文件里躺着）', () => {
    const first = Object.keys(INTROS)[0]
    if (!first) return
    const seed = LANDMARK_SEEDS.find((s) => s.id === first)
    expect(seed, `简介挂在不存在的地标「${first}」上`).toBeTruthy()
    expect(toLandmark(seed!).intro).toBe(INTROS[first])
  })

  it('没写简介的景点是 `undefined`，不是空串', () => {
    /* ⚠️ 空串会让消费端 `intro || blurb` 通过（空串是 falsy，还好），
       但 `??` 就会通过 —— 所以这里钉死"必须是 undefined"。 */
    const noIntro = LANDMARK_SEEDS.find((s) => !(s.id in INTROS))
    if (!noIntro) return
    expect(toLandmark(noIntro).intro).toBeUndefined()
  })
})

describe('checkLandmarkIntros · 三类会静默失效的错都要报出来', () => {
  const seeds = LANDMARK_SEEDS
  const good = seeds[0].id

  it('键打错一个字 → 「挂在不存在的地标上」', () => {
    const out = checkLandmarkIntros({ [`${good}-typo`]: '一段话' }, seeds)
    expect(out.length).toBe(1)
    expect(out[0]).toContain('不存在的地标')
  })

  it('空值 → 「是空的」', () => {
    const out = checkLandmarkIntros({ [good]: '   ' }, seeds)
    expect(out.length).toBe(1)
    expect(out[0]).toContain('是空的')
  })

  it('超字数 → 报出实际字数和上限', () => {
    const out = checkLandmarkIntros({ [good]: '字'.repeat(LANDMARK_INTRO_MAX + 1) }, seeds)
    expect(out.length).toBe(1)
    expect(out[0]).toContain(String(LANDMARK_INTRO_MAX + 1))
    expect(out[0]).toContain(String(LANDMARK_INTRO_MAX))
  })

  it('刚好卡在上限 → 不算超（边界不能差一个）', () => {
    expect(checkLandmarkIntros({ [good]: '字'.repeat(LANDMARK_INTRO_MAX) }, seeds)).toEqual([])
  })
})

describe('App 侧显示 · 源码级守卫', () => {
  it('★★ `MapPage` 用的是 `intro || blurb`（只写 `blurb` = 简介永远不显示，而且不报错）', () => {
    /*
     * ⚠️⚠️ 为什么这一条是**源码级**的：
     *    `MapPage` 是个几百行的大组件，`features/map/` 下只有
     *    `SouvenirCard` 与投影换算有单测 —— 它**没有**组件测试。
     *
     *    "改了却没生效"这一类里，最安静的一种就是**消费端没接上**：
     *    数据在、加载器也在，就是没人读它。界面上跟"这个景点还没写简介"
     *    长得**一模一样**，不报错、不崩、计数也不变。
     *
     *    ➜ 判据是那一行必须是 `landmark.intro || landmark.blurb`。
     *      ⚠️ 别放宽成"含 `intro` 就行"：`{landmark.intro}` 这种写法会让
     *         **600 多个没写简介的景点变成一片空白**，那正是要防的另一半。
     *      ⚠️ 读文件用 `process.cwd()` 拼，**别用 `new URL(..., import.meta.url)`**
     *         —— vitest 里它不是 file: 协议，会直接抛
     *         "The URL must be of scheme file"（`travelContents.test.ts` 里踩过）。
     */
    const file = resolve(process.cwd(), 'src/features/map/MapPage.tsx')
    expect(existsSync(file), `找不到 ${file} —— 测试的工作目录不是项目根？`).toBe(true)
    const src = readFileSync(file, 'utf8')
    expect(
      /landmark\.intro\s*\|\|\s*landmark\.blurb/.test(src),
      'MapPage.tsx 里找不到 `landmark.intro || landmark.blurb` —— ' +
        '要么简介永远不显示（只写了 blurb），要么没写简介的景点会空白（只写了 intro）',
    ).toBe(true)
  })
})
