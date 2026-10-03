/**
 * 覆盖层形态体检 —— 引的是**保存端点用的同一个函数**（`libraryItemShapeProblems`），
 * 所以这里绿 = dev 端点不会拒收，而不是"我自己另写了一套宽松判定"。
 */
import { readFileSync } from 'node:fs'
import { libraryItemShapeProblems } from '../../src/domain/libraryItemRules'

const parsed = JSON.parse(readFileSync('src/data/library-items.json', 'utf8'))
const problems = libraryItemShapeProblems(parsed)
console.log('覆盖层条目', Object.keys(parsed).length)
console.log('形态问题  ', problems.length)
for (const p of problems.slice(0, 20)) console.log('   ✗', p)
console.log(problems.length === 0 ? '✅ 端点不会拒收' : '❌ 端点会拒收')
