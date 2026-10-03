/**
 * 防串位对账 —— 覆盖层每条的 `baseTitle`/`baseLead` 必须跟**代码底稿**里同 id 的题一致。
 *
 * 为什么这条最重要：新题只能追加在标签数组末尾。一旦有人插在中间，
 * 后面所有题的 `builtin-<标签>-<序号>` 都会往后挪一格，
 * 而覆盖层是按 id 找题的 —— 于是"这条改过的题"会**静默**盖到**另一道题**上，
 * 界面不报错、测试也可能全绿（因为 id 都存在、图也都有）。
 * `baseTitle`/`baseLead` 就是用来抓这个的锚点。
 */
import { readFileSync } from 'node:fs'
import { builtinBaseItems } from '../../src/domain/builtinLibrary'

const overrides = JSON.parse(readFileSync('src/data/library-items.json', 'utf8')) as Record<
  string,
  { baseTitle?: string; baseLead?: string }
>
const base = new Map(builtinBaseItems().map((i) => [i.id, i]))

let checked = 0
const problems: string[] = []
for (const [id, ov] of Object.entries(overrides)) {
  const b = base.get(id)
  if (!b) {
    problems.push(`代码里没有这个 id（孤儿条目）: ${id}`)
    continue
  }
  checked++
  if (ov.baseTitle !== undefined && ov.baseTitle !== b.title) {
    problems.push(`baseTitle 不符 ${id}\n     覆盖层: ${JSON.stringify(ov.baseTitle)}\n     代码底稿: ${JSON.stringify(b.title)}`)
  }
  if (ov.baseLead !== undefined && ov.baseLead !== b.lead) {
    problems.push(`baseLead 不符 ${id}\n     覆盖层: ${JSON.stringify(ov.baseLead)}\n     代码底稿: ${JSON.stringify(b.lead)}`)
  }
}

console.log('覆盖层条目      ', Object.keys(overrides).length)
console.log('代码底稿条目    ', base.size)
console.log('逐条核对过      ', checked)
console.log('串位/孤儿 异常  ', problems.length)
for (const p of problems) console.log('   ✗', p)
console.log(problems.length === 0 ? '✅ 无串位' : '❌ 有串位')
