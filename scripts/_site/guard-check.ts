/* 体检：① 覆盖层形态 ② 覆盖层 vs 底稿（防串位）③ 空图位枚举 ④ 全库标题/照片重复 */
import { builtinBaseItems, buildBuiltinLibrary } from '../../src/domain/builtinLibrary'
import { LIBRARY_ITEM_OVERRIDES, checkLibraryOverrides } from '../../src/domain/libraryItems'
import { libraryItemShapeProblems } from '../../src/domain/libraryItemRules'

const base = builtinBaseItems()
const built = buildBuiltinLibrary()

const shape = libraryItemShapeProblems(LIBRARY_ITEM_OVERRIDES)
console.log('① 形态体检:', Object.keys(LIBRARY_ITEM_OVERRIDES).length, '条 /', shape.length, '问题')
shape.slice(0, 10).forEach((s) => console.log('   -', s))

const anchors = checkLibraryOverrides(LIBRARY_ITEM_OVERRIDES, base)
console.log('② 防串位:', anchors.length, '问题')
anchors.slice(0, 10).forEach((s) => console.log('   -', s))

const emptySlots = built.filter((it) => it.images.some((im) => !im.sceneKey && !im.imageUrl))
console.log('③ 空图位:', emptySlots.length, '条', emptySlots.slice(0, 10).map((i) => i.id).join(' '))

const noPhoto = built.filter((it) => !it.images.some((im) => im.imageUrl))
console.log('   其中「没有外链图」:', noPhoto.length, '条')

// ④ 标题重复（扫底稿全量）
const titleMap = new Map<string, string[]>()
for (const it of built) titleMap.set(it.title, [...(titleMap.get(it.title) ?? []), it.id])
const dupT = [...titleMap.entries()].filter(([, v]) => v.length > 1)
console.log('④ 标题重复组:', dupT.length)
dupT.slice(0, 12).forEach(([t, v]) => console.log('   -', t, v.join(' / ')))

// ⑤ 照片编号重复
const pidMap = new Map<string, string[]>()
for (const it of built) {
  for (const im of it.images) {
    const m = im.imageUrl?.match(/\/photos\/(\d+)\//)
    if (m) pidMap.set(m[1], [...(pidMap.get(m[1]) ?? []), it.id])
  }
}
const dupP = [...pidMap.entries()].filter(([, v]) => v.length > 1)
console.log('⑤ 照片编号:', pidMap.size, '个 / 重复组', dupP.length)
dupP.slice(0, 12).forEach(([p, v]) => console.log('   -', p, v.join(' / ')))

console.log('⑥ 总条数:', built.length, '｜ 有外链图:', built.filter((i) => i.images.some((m) => m.imageUrl)).length)
