/* 打印 classmate-7 在**真实代码路径**下的字段（年级区间 / images） */
import { buildBuiltinLibrary } from '../../src/domain/builtinLibrary'
const lib = buildBuiltinLibrary()
const it = lib.find((i) => i.id === 'builtin-classmate-7')
console.log('总数:', lib.length)
console.log(JSON.stringify(it, null, 2))
const g3 = lib.filter((i) => 3 >= i.minGrade && 3 <= i.maxGrade)
console.log('年级 3 能看到的题:', g3.length)
console.log('其中 classmate 类:', g3.filter((i) => i.category === 'person').length)
const titles = lib.filter((i) => i.title.includes('值日')).map((i) => i.id + ' ' + i.title)
console.log('标题含「值日」:', JSON.stringify(titles))
