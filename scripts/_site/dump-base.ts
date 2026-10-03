/* 走真代码 dump 内置题底稿（没盖覆盖层）—— 覆盖层的 baseTitle/baseLead 锚点从这里读，不许手抄 */
import { writeFileSync } from 'node:fs'
import { builtinBaseItems } from '../../src/domain/builtinLibrary'

const items = builtinBaseItems()
writeFileSync('scripts/_site/base-items.json', JSON.stringify(items, null, 1) + '\n')
console.log('builtinBaseItems():', items.length)
const byTag: Record<string, number> = {}
for (const it of items) byTag[it.tagId] = (byTag[it.tagId] ?? 0) + 1
for (const t of ['growth', 'reading', 'tradition', 'society', 'gratitude']) {
  console.log(' ', t, byTag[t] ?? 0)
}
