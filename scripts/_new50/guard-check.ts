/**
 * 走**真实代码路径**（buildBuiltinLibrary 会把覆盖层盖上），
 * 把所有「既没有插画也没有照片」的题全部列出来。
 *
 * 为什么要单独跑：vitest 那条守卫在**第一个**失败处就停了（expect 在循环里），
 * 所以它只能告诉你"至少有一条"，告诉不了你"一共几条、是哪几条"。
 */
import { buildBuiltinLibrary } from '../../src/domain/builtinLibrary'

const lib = buildBuiltinLibrary()
const offenders = lib.filter((it) => it.images.some((img) => !img.sceneKey && !img.imageUrl))
const noPhotoAtAll = lib.filter((it) => it.images.every((img) => !img.imageUrl))
const noSceneAtAll = lib.filter((it) => it.images.every((img) => !img.sceneKey))

console.log('总题数        ', lib.length)
console.log('有空图位的题  ', offenders.length)
for (const it of offenders) {
  console.log('   ✗', it.id, '|', it.title)
}
console.log('全无照片的题  ', noPhotoAtAll.length)
console.log('全无插画的题  ', noSceneAtAll.length)
console.log('有照片的题    ', lib.length - noPhotoAtAll.length)
