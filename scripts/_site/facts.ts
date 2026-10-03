/**
 * 官网上的数字要跟 App 对齐 —— 这里走真实代码路径把它们算一遍。
 * 改完题库 / 卡片 / 地标之后跑一次：
 *   node node_modules/jiti/lib/jiti-cli.mjs scripts/_site/facts.ts
 * 对不上就去改 website/index.html 里的数字（370 / 42 / 5 / 12 / 40 / 643）。
 */
import { TOPIC_TAGS, PROMPT_TEMPLATES } from '../../src/domain/prompts'
import { CATEGORIES, DIMENSIONS } from '../../src/domain/types'
import { buildBuiltinLibrary } from '../../src/domain/builtinLibrary'

const draft = Object.values(PROMPT_TEMPLATES).reduce((n, g) => n + g.length, 0)

console.log('细标签 TOPIC_TAGS :', TOPIC_TAGS.length)
console.log('大类 CATEGORIES   :', CATEGORIES.length, CATEGORIES.map((c) => c.label).join(' / '))
console.log('点评维度          :', DIMENSIONS.length, DIMENSIONS.map((d) => d.label).join(' / '))
console.log('底稿题数          :', draft)
console.log('合并覆盖层后      :', buildBuiltinLibrary().length)
