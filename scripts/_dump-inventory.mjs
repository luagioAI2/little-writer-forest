/* 一次性：把「还没配图的标签 → 题目」清单 dump 出来，供挑图用。
   用完即删。跑法：
     node --experimental-strip-types scripts/_dump-inventory.mjs
*/
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const { TOPIC_TAGS, PROMPT_TEMPLATES } = await import(
  'file://' + path.join(ROOT, 'src/domain/prompts.ts').replace(/\\/g, '/')
)

const ov = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/library-items.json'), 'utf8'))
const covered = new Set(Object.keys(ov).map((k) => k.replace(/^builtin-/, '').replace(/-\d+$/, '')))

const out = []
for (const t of TOPIC_TAGS) {
  const tpls = PROMPT_TEMPLATES[t.id] ?? []
  out.push({
    tagId: t.id,
    category: t.category,
    label: t.label,
    minGrade: t.minGrade,
    tagHint: t.hint,
    covered: covered.has(t.id),
    items: tpls.map((tp, i) => ({
      id: `builtin-${t.id}-${i + 1}`,
      title: tp.title,
      lead: tp.lead,
      scenes: tp.scenes,
    })),
  })
}

const dest = path.join(ROOT, 'scripts/_inventory.json')
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf8')

const unc = out.filter((x) => !x.covered)
console.log('标签总数', out.length, '｜已配图', out.length - unc.length, '｜未配图', unc.length)
console.log('未配图的题目数', unc.reduce((n, x) => n + x.items.length, 0))
console.log('写到', dest)
