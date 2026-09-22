// @vitest-environment node
/**
 * 把「小笔苗」的每个表情渲染成一张 HTML 预览，用于人工看效果。
 *
 * ⚠️ 这是**看图的工具**，不是断言用的测试。
 * 改 Sprout.tsx 的构图之后一定要跑一次：
 *   npx vitest run src/components/__sprout_gallery.test.tsx
 * 然后打开 sprout-preview.html 看 ——
 * 第一版就是没看，铅笔被身体盖掉了都不知道。
 * 输出文件名跟 __gallery.test.tsx 的 gallery-preview.html 保持一致。
 */
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { Sprout } from '../components/Sprout'
import type { SproutMood } from '../components/Sprout'

const MOODS: SproutMood[] = ['happy', 'thinking', 'cheer', 'sleepy', 'curious']

it('render sprout gallery', () => {
  const cell = (mood: SproutMood, ink: boolean) => `
    <div style="text-align:center">
      <div style="
        display:inline-block; padding:14px; border-radius:16px;
        background:${ink ? '#101a16' : '#fbfefc'};
        box-shadow: inset 0 0 0 1px ${ink ? 'rgba(255,255,255,.1)' : 'rgba(18,23,20,.08)'}">
        ${renderToStaticMarkup(<Sprout size={112} mood={mood} ink={ink} animated={false} />)}
      </div>
      <div style="font:600 12px system-ui; margin-top:6px; color:#414b44">${mood}</div>
    </div>`

  // 小笔苗的颜色全走 CSS 变量（这样浅色/墨夜共用一个组件），
  // 所以这份脱离 App 的预览必须把用到的令牌抄进来
  const TOKENS = `
    --color-inkleaf-50:#eafbf1; --color-inkleaf-300:#69dda7;
    --color-inkleaf-400:#29ce89; --color-inkleaf-500:#10a368;
    --color-ink-800:#2b342e; --color-clay-300:#f0b48f;
    --color-amber-leaf-300:#ffd374; --color-amber-leaf-400:#febb32;
    --color-night-surface-2:#213429; --color-night-text:#eef2ee;`

  const html = `<!doctype html><meta charset="utf-8">
  <style>:root{${TOKENS}}</style>
  <body style="margin:0;padding:28px;background:#f1f8f4;font-family:system-ui">
    <h2 style="font:700 15px system-ui;color:#1a211d;margin:0 0 14px">浅色世界</h2>
    <div style="display:flex;gap:20px;align-items:flex-start">
      ${MOODS.map((m) => cell(m, false)).join('')}
    </div>
    <h2 style="font:700 15px system-ui;color:#1a211d;margin:28px 0 14px">墨夜世界</h2>
    <div style="display:flex;gap:20px;align-items:flex-start">
      ${MOODS.map((m) => cell(m, true)).join('')}
    </div>
    <h2 style="font:700 15px system-ui;color:#1a211d;margin:28px 0 14px">实际尺寸对比（空状态 104 / 候选 56 / 48 / 34）</h2>
    <div style="display:flex;gap:28px;align-items:flex-end;background:#fff;padding:18px;border-radius:14px;width:max-content">
      ${renderToStaticMarkup(<Sprout size={104} mood="sleepy" animated={false} />)}
      ${renderToStaticMarkup(<Sprout size={56} mood="thinking" animated={false} />)}
      ${renderToStaticMarkup(<Sprout size={48} mood="thinking" animated={false} />)}
      ${renderToStaticMarkup(<Sprout size={34} mood="thinking" animated={false} />)}
      <span style="font:500 14px system-ui;color:#5a655d">正在写更好的写法…</span>
    </div>
  </body>`

  writeFileSync('sprout-preview.html', html)
})
