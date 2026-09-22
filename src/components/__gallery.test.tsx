// @vitest-environment node
/**
 * 临时脚本：把角色立绘渲染成一张 HTML 预览，用于人工看效果。
 * 用完即删，不属于交付物。
 */
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { CharacterArt } from '../components/CharacterArt'
import type { CharacterSpec } from '../domain/character'

const HAIRS: CharacterSpec['hair'][] = [
  'long',
  'wave',
  'twin',
  'bob',
  'ponytail',
  'buns',
  'short',
  'braid',
  'hime',
  'spiky',
]

const HAIR_COLORS: [string, string][] = [
  ['#4a3b52', '#2e2436'],
  ['#c98a2e', '#8a5a17'],
  ['#3e7f5e', '#24543e'],
  ['#c5636f', '#8f3f4a'],
  ['#42779a', '#2a4d66'],
  ['#8c73c5', '#5c47a0'],
  ['#e5c073', '#b08a34'],
  ['#7b837d', '#4c544e'],
  ['#db8693', '#a35563'],
  ['#1c211e', '#000000'],
]

const EYES = ['#c98a2e', '#42779a', '#3e7f5e', '#8c73c5', '#c5636f', '#d6a344']

it('render gallery', () => {
  const cards: string[] = []

  for (let i = 0; i < HAIRS.length; i++) {
    const spec: CharacterSpec = {
      hair: HAIRS[i],
      bangs: i % 2 === 0 ? 'straight' : 'side',
      hairColor: HAIR_COLORS[i],
      eyeColor: EYES[i % EYES.length],
      outfit: (['uniform', 'hoodie', 'robe', 'cloak', 'dress', 'kimono', 'sweater', 'armor'] as const)[
        i % 8
      ],
      outfitColor: [
        ['#2f6b4f', '#1c4231'],
        ['#c98a2e', '#8a5a17'],
        ['#42779a', '#2a4d66'],
        ['#8c73c5', '#5c47a0'],
      ][i % 4] as [string, string],
      accent: ([
        'none',
        'ribbon',
        'flower',
        'glasses',
        'headphones',
        'horns',
        'catears',
        'hat',
        'crown',
        'goggles',
        'earring',
      ] as const)[i],
      accentColor: '#c5636f',
      expression: ([
        'smile',
        'bright',
        'calm',
        'determined',
        'shy',
        'curious',
        'cool',
        'smile',
        'bright',
        'determined',
      ] as const)[i],
      bg: [
        ['#f2f7f3', '#e0ede5'],
        ['#fdf9ef', '#f9eed6'],
        ['#f1f6fa', '#deecf5'],
        ['#f3f0fa', '#e4ddf5'],
      ][i % 4] as [string, string],
      backdrop: (['soft', 'burst', 'night', 'sakura', 'bubble', 'ray'] as const)[i % 6],
    }

    cards.push(
      `<figure><div class="art">${renderToStaticMarkup(
        <CharacterArt spec={spec} uid={`g${i}`} />,
      )}</div><figcaption>${HAIRS[i]} · ${spec.expression}</figcaption></figure>`,
    )
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:16px;background:#fbf9f4;font:12px system-ui;display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
  figure{margin:0}
  .art{aspect-ratio:200/240;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgb(0 0 0/.06),0 8px 24px -14px rgb(0 0 0/.2)}
  figcaption{text-align:center;padding-top:4px;color:#4c544e}
  </style></head><body>${cards.join('')}</body></html>`

  writeFileSync('gallery-preview.html', html)
})
