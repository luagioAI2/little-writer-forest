import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_CONTENT_ID_PREFIX,
  DROPPED_CONTENT_COUNT,
  RAW_CONTENTS,
  TRAVEL_CONTENTS,
  contentById,
  contentCount,
  contentCountByLandmark,
  contentsByGrade,
  contentsByLandmark,
  gradeCounts,
  gradeOf,
  pickPhotoForLandmark,
} from './travelContents'
import { TRAVEL_GRADES, gradeMeta } from './types'
import { LANDMARKS, landmarkById } from './travel'
import { defaultPhotoFor, photoLandmarkIds } from '../data/landmarkPhotos'

/* ============================================================
   旅行内容包体检 —— 每一条都必须过
   ------------------------------------------------------------
   为什么这批断言值得单独写：
   内容包是**人（和网页编辑工具）填**的数据，而它出错时是**静默的** ——
   landmarkId 写错一个字母，这条内容就永远没机会被小鸟带回来，
   界面上什么都不会发生，也没有报错。只有测试能拦住这种"内容失踪"。

   ★ 2026-09-24：数据从 `domain/travelContents.ts` 内联的 TS 字面量
     搬到了 `src/data/travel-contents.json`。**断言的意图一条都没改**，
     只是改成读 JSON —— 因为搬走之后，"谁在守着这些规则"这件事
     必须还在原处，否则数据一改就没人拦了。
   ============================================================ */

describe('内容包体检', () => {
  it('至少有一条内容', () => {
    expect(TRAVEL_CONTENTS.length).toBeGreaterThan(0)
  })

  it('★ 每条内容的 landmarkId 都能在地标表里找到（写错就会永远带不回来）', () => {
    // ⚠️ 2026-09-25 起 `landmarkId` 是**必填**了（图片是挂在地标上的附件），
    //    所以这里不再有"野点"分支 —— 原来那句 `if (c.landmarkId === undefined) continue`
    //    是死代码，留着会让人以为"可以不关联地标"。
    for (const c of TRAVEL_CONTENTS) {
      expect(c.landmarkId, `${c.id} 没有 landmarkId`).toBeTruthy()
      expect(
        landmarkById(c.landmarkId),
        `landmarkId「${c.landmarkId}」不存在于 LANDMARKS —— 这条内容永远带不回来`,
      ).toBeDefined()
    }
  })

  it('★★ 被丢掉的内容必须是 0 条 —— 地标 id 打错一个字就会静默丢一条', () => {
    /*
      ★ 为什么这条非有不可：`toTravelContent()` 查不到 `landmarkId` 时
        **返回 undefined**，那条内容就整条从 `TRAVEL_CONTENTS` 里消失。
        丢掉是**静默的** —— 界面上什么都不发生、控制台不报错，
        编辑器里看起来就像"我明明存过"。

      ⚠️ 上面那条「每条内容的 landmarkId 都能找到」是遍历
         `TRAVEL_CONTENTS` 的 —— 而**被丢掉的那条根本不在里面**，
         所以它拦不住这件事。只有这个计数能拦。

      ⚠️⚠️ 这条必须在"地标表变了"之后跑：`landmarks.ts` 会用抬头里的
         `supersedes` 滤掉被官方名录取代的老 id，而内容包引用的
         `gugong` / `huangshan` 正是这一类 —— 哪天过滤规则一改，
         这两条就会**一声不响地消失**。
    */
    expect(
      DROPPED_CONTENT_COUNT,
      `${DROPPED_CONTENT_COUNT} 条内容因为 landmarkId 查不到被丢掉了 —— 去看 travel-contents.json`,
    ).toBe(0)
  })

  it('★★ id 必须唯一（重复的话 contentById 只会拿到第一条）', () => {
    // ⚠️ 这条和 v5 那条**刚好相反**：
    //    v5 是「一个地标只能有一条内容」；v6 是「一个地标可以有多条」。
    //    所以"唯一"的判据从 **landmarkId** 挪到了 **id** 上。
    //    漏了这条，两条同 id 的内容里后面那条就**永远不会被小鸟选中**
    //    （pickContent 用 id 去重），而且不报错。
    const ids = TRAVEL_CONTENTS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('★★ 一个景点多张图：查询必须把**全部**都给出来，不能只给第一条', () => {
    /*
      2026-09-25 —— 这条原来断言的是「至少有一个景点真的配了多张」。
      现在**做不到**：内容包按家长的话收窄成"只放图片附件"之后只剩 2 条、
      2 个地标（八达岭 + 西湖），一条一个景点。

      ⚠️ 这不是能力退化了 —— `contentsByLandmark` / `pickContentForLandmark`
         都是按 N 张写的；是**内容还没填**（家长要一张张挑图、写散文）。

      ➜ 所以改成对**每一个**出现过的地标断言"一张都不许被吞掉"：
         查出来的 id 序列必须和 JSON 里那个地标的 id 序列**完全一样**。
         这才是真正的回归点 —— "顺手去重"或"只返回第一条"会在这里红，
         而那正是把「一个景点多张图」改回"一张一个景点"的那个动作。
         （⚠️ 它现在**空过**：没有多张的组。空过比红着好 ——
            红着会让人以为代码坏了，而实际是数据没填。
            一旦家长配了第二张，它立刻开始工作。）

      ★ 想让它现在就不空过：往 `src/data/travel-contents.json` 里给
        同一个 landmarkId 再加一条即可（编辑器里「＋ 新建一张」就是干这个的）。
    */
    const idsByLandmark = new Map<string, string[]>()
    for (const raw of RAW_CONTENTS) {
      const list = idsByLandmark.get(raw.landmarkId) ?? []
      list.push(raw.id)
      idsByLandmark.set(raw.landmarkId, list)
    }

    for (const [lmId, ids] of idsByLandmark) {
      expect(contentsByLandmark(lmId).map((c) => c.id), `「${lmId}」的图被吞了`).toEqual(ids)
      expect(contentCountByLandmark(lmId), `「${lmId}」的图数不对`).toBe(ids.length)
    }

    // 现状报一下（不红）：内容包薄是**已知**的，不是失败
    const multi = [...idsByLandmark.values()].filter((ids) => ids.length > 1).length
    console.log(
      `  · 一个景点多张图：${multi} 组多张 / ${idsByLandmark.size} 个地标 · ${contentCount()} 条内容`,
    )
  })

  it('图片只存开源外链，且必须是 https', () => {
    for (const c of TRAVEL_CONTENTS) {
      if (c.mediaUrl === undefined) continue // 允许先写散文、图晚点再贴
      expect(c.mediaUrl.startsWith('https://'), `${c.id} 的图片不是 https 外链`).toBe(true)
      // 不能是本地路径 —— 内容包不打包图片，只存地址
      expect(c.mediaUrl.startsWith('/')).toBe(false)
    }
  })

  it('署名必须有图库名和出处链接', () => {
    for (const c of TRAVEL_CONTENTS) {
      if (c.credit === undefined) continue
      expect(c.credit.source.length, `${c.id} 的署名缺图库名`).toBeGreaterThan(0)
      expect(c.credit.link.startsWith('https://'), `${c.id} 的署名链接不是 https`).toBe(true)
    }
  })

  it('地名和摘要都不能是空的', () => {
    for (const c of TRAVEL_CONTENTS) {
      // ⚠️ `place` 现在是从地标派生的，所以这条只拦得住"地标名字本身是空的"
      //    （以及 `toTravelContent` 哪天忘了抄这个字段）。
      expect(c.place.trim().length, `${c.id} 没有地名`).toBeGreaterThan(0)
      expect(c.summary.trim().length, `${c.id} 没有摘要`).toBeGreaterThan(0)
      // 摘要是列表里那一行，太长会撑破卡片
      expect(c.summary.length, `${c.id} 的摘要太长`).toBeLessThanOrEqual(60)
    }
  })

  it('散文至少要 4 段，每段都不是空占位', () => {
    for (const c of TRAVEL_CONTENTS) {
      if (c.essay === undefined) continue // 允许先贴图、散文晚点再写（编辑器里会标「还没散文」）
      const paras = c.essay.split('\n\n')
      expect(paras.length, `${c.id} 的散文段数太少`).toBeGreaterThanOrEqual(4)
      for (const p of paras) {
        expect(p.trim().length, `${c.id} 有一段是空的`).toBeGreaterThan(4)
      }
      // 全文得有分量 —— 这不是一句配文，是一篇散文
      expect(c.essay.length, `${c.id} 的散文太短`).toBeGreaterThan(200)
    }
  })

  it('散文和摘要里不出现半角逗号（给孩子看的界面一律全角标点）', () => {
    for (const c of TRAVEL_CONTENTS) {
      expect(c.essay?.includes(','), `${c.id} 的散文里有半角逗号`).not.toBe(true)
      expect(c.summary.includes(','), `${c.id} 的摘要里有半角逗号`).toBe(false)
    }
  })

  it('散文里不放 emoji（界面图标一律用手绘线性图标，不用 emoji 当 UI）', () => {
    /*
      覆盖常见 emoji 区段：象形符号、杂项符号、装饰符号。
      变体选择符 U+FE0F 用 `|` 单独写，不塞进字符类 ——
      它和前一个字符是**组合关系**，放进 `[...]` 会被
      ESLint 的 no-misleading-character-class 判为误导性字符类。
    */
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u
    for (const c of TRAVEL_CONTENTS) {
      expect(emoji.test(c.essay ?? ''), `${c.id} 的散文里有 emoji`).toBe(false)
      expect(emoji.test(c.summary), `${c.id} 的摘要里有 emoji`).toBe(false)
    }
  })

  it('★ 坐标必须在合理范围内（填错就落海里了）', () => {
    // 世界景点最南到 −51°（百内国家公园），最北 66.5°（圣诞老人村）；
    // 经度是中国 −180…180 的子集。给一圈余量，只拦"明显填错"。
    for (const c of TRAVEL_CONTENTS) {
      expect(Number.isFinite(c.lng) && Number.isFinite(c.lat), `${c.id} 坐标不是数字`).toBe(true)
      expect(Math.abs(c.lng), `${c.id} 的经度越界`).toBeLessThanOrEqual(180)
      expect(c.lat, `${c.id} 的纬度越界`).toBeGreaterThanOrEqual(-60)
      expect(c.lat, `${c.id} 的纬度越界`).toBeLessThanOrEqual(75)
    }
  })

  it('★★ 坐标是**从地标派生**的 —— 内容包自己不再存坐标', () => {
    /*
      2026-09-25：以前每条内容自己存 lng/lat，于是**同一个景点写了两套坐标**
      —— 八达岭两条写了 116.0167/40.3563 和 116.02/40.35，西湖两条也各一套。

      ⚠️ 改成派生之后，原来那条「坐标不能离地标太远」就变成**废话**了
         （算出来必然是 0 公里，永远绿）。所以这里换成两条真有牙的：

         ① 派生出来的坐标**必须等于**地标那一份。
            这是给"以后有人想按图片钉坐标"留的口子 —— 那时这条会红，
            提醒他那会让同一个景点**再次出现两套坐标**。
         ② JSON 里**不许**出现 lng / lat 键。
            光看 ① 拦不住"存了但没人读"—— 那正是 `heat` 那个死字段的老路
            （声明了、注释说有、实际 0 处读）。
    */
    for (const c of TRAVEL_CONTENTS) {
      const lm = landmarkById(c.landmarkId)
      expect(lm, `${c.id} 的地标查不到了`).toBeDefined()
      expect([c.lng, c.lat], `${c.id} 的坐标和「${lm?.name}」不一致`).toEqual([lm?.lng, lm?.lat])
    }
    for (const raw of RAW_CONTENTS) {
      const has = (k: string) => Object.prototype.hasOwnProperty.call(raw, k)
      expect(
        has('lng') || has('lat'),
        `「${raw.id}」又自己存了坐标 —— 同一个景点迟早出现两套`,
      ).toBe(false)
    }
  })
})

/* ============================================================
   等级（顺路 · 驻足 · 奇遇 · 绝景 · 传世）
   ------------------------------------------------------------
   ★★ 为什么这批断言重要：
   `gradeOf()` 只放行白名单里的值，放不进来就是 `undefined` ——
   这是有意的（保证"有值 ⇒ 合法"），但代价是
   **打错一个字会静默降级成「顺路」**：内容里写着"传世"，
   界面上显示绿色"顺路"，不报错、不崩、别的测试全绿。
   ➜ 所以必须有一条"JSON 里的 grade 一个字都不能错"的守卫。
   ============================================================ */

describe('等级', () => {
  it('★★ JSON 里每条的 grade 都必须是表里的五档之一（打错字 = 静默降级成「顺路」）', () => {
    const legal = TRAVEL_GRADES.map((g) => g.key) as string[]
    for (const raw of RAW_CONTENTS) {
      expect(
        legal,
        `「${raw.id}」的 grade 是「${raw.grade}」，不在 ${legal.join(' / ')} 里 —— 会被静默当成「顺路」`,
      ).toContain(raw.grade)
    }
  })

  it('★ gradeOf 认得好值、挡住坏值（挡的方式是返回 undefined，不是抛错）', () => {
    for (const g of TRAVEL_GRADES) expect(gradeOf(g.key)).toBe(g.key)
    for (const bad of ['传世级', 'chuanshi', '', null, undefined, 1, {}]) {
      expect(gradeOf(bad)).toBeUndefined()
    }
  })

  it('★ 每条内容都拿到了等级（没被 gradeOf 过滤掉）', () => {
    for (const c of TRAVEL_CONTENTS) {
      expect(c.grade, `${c.id} 的等级没能通过归一化`).toBeDefined()
    }
  })

  it('★★ 用到的档位都必须合法，且至少用满 2 档', () => {
    /*
      2026-09-25 —— 这条原来叫「五档都有人 —— 某一档空了说明等级是摆设」，
      现在**做不到**：「顺路」原来只挂在 `badaling-joke` 上，而按家长的话，
      笑话 / 格言 / 音乐 / 故事 / 视频**全都搬去了事件库**
      （`src/data/travel-event-contents.json`），内容包里只剩图片附件 2 条
      （绝景 + 奇遇）→ 五档里空了 3 档。

      ⚠️ 那是**数据还没填**，不是代码坏了 —— 留一条永远红的测试，
         只会训练人闭着眼睛忽略它。所以拆成两条真正守得住的：

         ① 所有计数必须落在五档之内（没有第六档）。
            打错一个字会被 `gradeOf()` 挡掉，这条顺带确认计数表没有多出键。
         ② 至少用满 2 档 —— 这是**占位检测**：哪天内容被删空到只剩一档，
            提醒去填，而不是让等级表变成摆设。

      ★ 家长往内容包里补图时，每档会自然长回来；
        等五档都有图了，把 ② 改回 `used.length === TRAVEL_GRADES.length` 即可。
    */
    const counts = gradeCounts()
    expect(Object.keys(counts).sort()).toEqual(TRAVEL_GRADES.map((g) => g.key).sort())

    const used = TRAVEL_GRADES.filter((g) => counts[g.key] > 0).map((g) => g.key)
    const missing = TRAVEL_GRADES.filter((g) => counts[g.key] === 0).map((g) => g.key)
    expect(
      used.length,
      `只用了 ${used.length} 档（${used.join(' / ') || '一档都没有'}），内容包太薄了`,
    ).toBeGreaterThanOrEqual(2)
    if (missing.length > 0) console.log(`  · 还没有内容的档位：${missing.join(' / ')}`)
  })

  it('★ contentsByGrade 和 gradeCounts 对得上', () => {
    const counts = gradeCounts()
    let total = 0
    for (const g of TRAVEL_GRADES) {
      const list = contentsByGrade(g.key)
      expect(list.length, `「${g.key}」的条数不一致`).toBe(counts[g.key])
      for (const c of list) expect(c.grade).toBe(g.key)
      total += list.length
    }
    expect(total).toBe(contentCount())
  })

  it('★ 等级表自身：五档、序号 1–5 不重复、颜色不重复', () => {
    expect(TRAVEL_GRADES.length).toBe(5)
    expect(TRAVEL_GRADES.map((g) => g.order)).toEqual([1, 2, 3, 4, 5])
    expect(new Set(TRAVEL_GRADES.map((g) => g.key)).size).toBe(5)
    expect(new Set(TRAVEL_GRADES.map((g) => g.color)).size).toBe(5)
    for (const g of TRAVEL_GRADES) {
      expect(g.color, `${g.key} 的颜色不是 #rrggbb`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('★ 顺序即等级高低（数组顺序 = order 递增）', () => {
    // 界面按 order 排序显示「高等级在上」。重排数组而不改 order
    // 会让排序和颜色对不上 —— 这种错从界面上看不出来。
    const orders = TRAVEL_GRADES.map((g) => g.order)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
  })

  it('★ 查不到等级时返回最低档，界面永远拿得到一个颜色', () => {
    expect(gradeMeta(undefined).key).toBe('顺路')
    expect(gradeMeta(undefined)).toBe(TRAVEL_GRADES[0])
    for (const g of TRAVEL_GRADES) expect(gradeMeta(g.key)).toBe(g)
  })

  it('★★ 等级**不影响**掉落：pickContent 是等概率的', () => {
    /*
      家长 2026-09-24 明确：「等级只需要标注」。

      ⚠️ 这条守的是一个**设计决定**，不是实现细节 ——
         哪天有人觉得"传世应该很难拿到"就顺手给 pickContent 加了权重，
         这条会红，提醒他这是要**单独确认**的事，不是顺手改的。
      ⚠️ 反过来：`TravelGradeMeta` 里**不该有** `weight` 字段
         （卡片稀有度 `RarityMeta` 才有）。下面这条顺带把它钉住。
    */
    for (const g of TRAVEL_GRADES) {
      expect(Object.keys(g).sort()).toEqual(['color', 'key', 'order'])
    }
  })
})

/* ============================================================
   查询
   ============================================================ */

describe('内容包查询', () => {
  it('能按 id 查到内容', () => {
    const first = TRAVEL_CONTENTS[0]
    expect(contentById(first.id)).toBe(first)
  })

  it('查不到时返回 undefined，也不报错', () => {
    expect(contentById('not-a-real-id')).toBeUndefined()
    expect(contentsByLandmark('not-a-real-place')).toEqual([])
    expect(contentCountByLandmark('not-a-real-place')).toBe(0)
  })

  it('contentCount 和数组长度一致', () => {
    expect(contentCount()).toBe(TRAVEL_CONTENTS.length)
  })

  it('覆盖到的地标都真的存在', () => {
    const all = new Set(LANDMARKS.map((l) => l.id))
    for (const c of TRAVEL_CONTENTS) {
      expect(all.has(c.landmarkId), `${c.landmarkId} 不在库里`).toBe(true)
    }
  })
})

/* ============================================================
   ★★ 拍照事件取图：**内容包优先，默认图兜底**
   ------------------------------------------------------------
   家长 2026-09-25：「帮我添加上默认的图片链接。」
   ➜ 以前只有配过内容的景点才拿得到图（全库就 2 个），
     其余抽到拍照只能给程序化插画。现在多了一层兜底。

   ⚠️ 这里守的核心是**优先级**和**唯一出口**这两件事，不是"有没有图"。
   ============================================================ */

describe('拍照取图（pickPhotoForLandmark）', () => {
  const rng = () => 0.5

  it('★★ 内容包优先 —— 配过图就不许用默认图', () => {
    /* badaling / xihu 两处都**既有内容包又有默认图** —— 正好是验优先级的地方。
       ⚠️ 顶替了的话，家长挑的标题 / 等级 / 散文会全丢，
          而界面上只是"这张图没配过内容"，看不出是被顶掉的。 */
    for (const id of ['badaling', 'xihu']) {
      const pack = new Set(contentsByLandmark(id).map((c) => c.id))
      expect(pack.size, `${id} 内容包是空的，这条验不到优先级`).toBeGreaterThan(0)
      const got = pickPhotoForLandmark(id, { rng })
      expect(got, `${id} 取不到图`).toBeDefined()
      expect(pack.has(got!.id), `拿到了 ${got!.id}，但内容包里有 ${[...pack].join('/')}`).toBe(true)
      expect(got!.id.startsWith(DEFAULT_CONTENT_ID_PREFIX)).toBe(false)
    }
  })

  it('★★ 没配内容时用默认图兜底，并把 match 一起带过来', () => {
    const id = photoLandmarkIds().find((x) => contentsByLandmark(x).length === 0)
    expect(id, '没有"配了默认图但没内容包"的地标').toBeDefined()
    const photo = defaultPhotoFor(id!)!

    const got = pickPhotoForLandmark(id!, { rng })
    expect(got, `${id} 没兜底成功`).toBeDefined()
    expect(got!.id).toBe(`${DEFAULT_CONTENT_ID_PREFIX}${id}`)
    expect(got!.mediaUrl).toBe(photo.mediaUrl)
    expect(got!.credit).toEqual(photo.credit)
    /* ★★ `match` 必须**抄下来** —— 不抄的话"这张是顶替图"这件事到不了消费端，
       界面就会把 `scene` 的图当成"这就是它本人的样子"。 */
    expect(got!.match, 'match 没从默认图抄过来').toBe(photo.match)
    /* ⚠️ 但**不许**替家长编等级和散文 —— 那是他挑图时才有的东西 */
    expect(got!.grade).toBeUndefined()
    expect(got!.essay).toBeUndefined()
  })

  it('★★ 默认图的派生字段跟地标一致（place / lng / lat 不许各写一份）', () => {
    for (const id of photoLandmarkIds().slice(0, 20)) {
      if (contentsByLandmark(id).length > 0) continue
      const lm = landmarkById(id)
      const got = pickPhotoForLandmark(id, { rng })
      expect(got, `${id} 取不到图`).toBeDefined()
      expect(got!.place).toBe(lm!.name)
      expect(got!.lng).toBe(lm!.lng)
      expect(got!.lat).toBe(lm!.lat)
    }
  })

  it('★ 摘要用**地标自己的一句话介绍**，不另编文案', () => {
    const id = photoLandmarkIds().find((x) => contentsByLandmark(x).length === 0)!
    const got = pickPhotoForLandmark(id, { rng })
    expect(got!.summary).toBe(landmarkById(id)!.blurb)
  })

  it('★ 两样都没有 → undefined（由 pets.ts 退回程序化插画）', () => {
    const bare = LANDMARKS.find((l) => contentsByLandmark(l.id).length === 0 && !defaultPhotoFor(l.id))
    expect(bare, '库里没有"两样都没有"的地标了').toBeDefined()
    expect(pickPhotoForLandmark(bare!.id, { rng })).toBeUndefined()
  })

  it('★ 地标根本不存在 → undefined，不抛错', () => {
    expect(pickPhotoForLandmark('not-a-real-place', { rng })).toBeUndefined()
  })

  it('★★ `travelEvents.ts` 里不许再直接调 `pickContentForLandmark`', () => {
    /*
      ⚠️⚠️ 这条是**源码级**守卫，守的是"两条路必须一样"。

      `rollArrivalEvent` 里有两处取图：
        · 抽中拍照
        · 抽中别的但池子落空 → 退回拍照
      以前两处各写了一遍 `pickContentForLandmark(...)`。
      加默认图兜底时**只改一处**，另一处就悄悄还是旧行为 ——
      **不报错、不崩、测试也全绿**，只有"有时候有图、有时候没图"。

      ➜ 判据：那两处必须都走 `pickPhotoForLandmark`。
        所以这里直接读源码，禁止 `pickContentForLandmark` 再出现在 `travelEvents.ts` 里。
      ⚠️ 别把这条改成"允许出现在注释里"就放宽 —— 要放宽就改成匹配**调用**（带括号）而不是名字。
      ⚠️ 读文件用 `process.cwd()` 拼，**别用 `new URL(..., import.meta.url)`** ——
         vitest 里 `import.meta.url` 不是 file: 协议，会直接抛
         "The URL must be of scheme file"（这个坑踩过）。
    */
    const file = resolve(process.cwd(), 'src/domain/travelEvents.ts')
    expect(existsSync(file), `找不到 ${file} —— 测试的工作目录不是项目根？`).toBe(true)
    const src = readFileSync(file, 'utf8')
    const calls = src.match(/\bpickContentForLandmark\s*\(/g) ?? []
    expect(
      calls,
      `travelEvents.ts 里还有 ${calls.length} 处直接调 pickContentForLandmark —— ` +
        '取图必须走 pickPhotoForLandmark（内容包优先、默认图兜底），两条路要一样',
    ).toEqual([])
    /* ★ 顺带钉住"两处都改了"：`pickPhotoForLandmark` 必须出现**两次**
       （抽中拍照 / 池子落空退回拍照）—— 只改一处正是这条要防的事。 */
    const used = src.match(/\bpickPhotoForLandmark\s*\(/g) ?? []
    expect(used.length, `travelEvents.ts 里只调了 ${used.length} 次 pickPhotoForLandmark，应该是 2 次`).toBe(2)
  })
})
