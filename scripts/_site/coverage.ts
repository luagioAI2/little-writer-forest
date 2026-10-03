import { buildBuiltinLibrary } from '../../src/domain/builtinLibrary'

const b = buildBuiltinLibrary()
const noPhoto: Record<string, string[]> = {}
const emptySlot: string[] = []
for (const it of b) {
  if (!it.images.some((i) => i.imageUrl)) (noPhoto[it.tagId] ??= []).push(it.id)
  if (it.images.some((i) => !i.sceneKey && !i.imageUrl)) emptySlot.push(it.id)
}
console.log('空图位（既没插画也没照片）:', emptySlot.length, emptySlot.slice(0, 20).join(' '))
console.log('\n没有外链图的题，按标签：')
for (const [k, v] of Object.entries(noPhoto).sort((a, c) => c[1].length - a[1].length)) {
  console.log(`  ${k.padEnd(20)} ${String(v.length).padStart(3)}`)
}
console.log('\n合计没有外链图:', Object.values(noPhoto).reduce((a, c) => a + c.length, 0))
for (const t of ['hometown', 'dream-job', 'comic']) {
  const rows = b.filter((i) => i.tagId === t)
  console.log(`\n${t}:`)
  for (const r of rows) {
    console.log(`  ${r.id.padEnd(22)} ${r.title.padEnd(14)} sceneKey=${r.images.map((i) => i.sceneKey ?? '-')} url=${r.images.map((i) => (i.imageUrl ? 'YES' : '-'))}`)
  }
}
