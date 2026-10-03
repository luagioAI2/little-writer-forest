/* ============================================================
   `content-config.html`（内容配置外壳）和两个子页之间的那条**协议**
   ------------------------------------------------------------
   ★★ 为什么要有这个文件：
      `content-config.html` 把 `landmarks-browse.html` / `library-browse.html`
      内嵌成两屏，靠 **postMessage 的字符串**互通"有没有没保存的改动"：

          子页 → 外壳   { type: 'lw-tool-dirty', tool: 'travel' | 'library', dirty }

      这条约定**没有任何类型检查**，而且跨三个文件。
      把消息名或者 `tool` 名字改掉一处，后果是：
        · 不报错、不崩、子页自己一切正常
        · 只是**外壳上的小圆点永远不亮** → 关标签页时父页也不拦
        · 于是"改了没保存就关掉"变成**静默丢改动**
      ➜ 静态断言比 e2e 更早、更便宜地把这种改名拦下来。
         （端到端那条路由 `scripts/_verify-content-config.mjs` 负责。）

   ⚠️ 断言一律读**钩子**（`data-tool` / 消息名 / `tool` 名 / `.src =`），
      不读界面上的字 —— 文案改了不该红，改名必须红。
   ============================================================ */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (f: string): string => {
  const p = resolve(process.cwd(), f)
  expect(existsSync(p), `找不到 ${p} —— 测试的工作目录不是项目根？`).toBe(true)
  return readFileSync(p, 'utf8')
}

const SHELL = read('content-config.html')
const LIB = read('library-browse.html')
const TRAVEL = read('landmarks-browse.html')

/** 外壳声明了哪几个工具 —— 从 `const TOOLS = { name: { url: '…' } }` 里读 */
function shellTools(): { name: string; url: string }[] {
  const out: { name: string; url: string }[] = []
  const re = /^\s{2}([A-Za-z_$][\w$]*):\s*\{\s*url:\s*'([^']+)'/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(SHELL)) !== null) out.push({ name: m[1], url: m[2] })
  return out
}

/** 标签栏上的按钮声明了哪几个工具（`data-tool="…"`） */
function shellTabTools(): string[] {
  return [...SHELL.matchAll(/data-tool="([^"]+)"/g)].map((m) => m[1])
}

/** 某个页面里 `beforeunload` 那个监听器的源码片段 */
function beforeUnloadBlock(src: string): string {
  const i = src.indexOf("addEventListener('beforeunload'")
  return i < 0 ? '' : src.slice(i, i + 700)
}

const TOOLS = shellTools()

describe('内容配置：外壳跟两个子页之间的那条协议', () => {
  it('外壳声明了两个工具，url 都指向真实存在的页面', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(['library', 'travel'])
    for (const t of TOOLS) {
      expect(
        existsSync(resolve(process.cwd(), t.url.replace(/^\.\//, ''))),
        `外壳里 ${t.name} 指向 ${t.url}，那个文件不存在 —— iframe 会直接开成错误页`,
      ).toBe(true)
    }
  })

  it('★★ 标签栏上的按钮和 TOOLS 一一对应（多一个 = 点它什么都不会发生）', () => {
    /*
     * ⚠️ 这条防的是"加了按钮忘了加工具"：`activate()` 里
     *    `if (!TOOLS[tool]) tool = DEFAULT` —— 于是点那个多出来的标签，
     *    页面**纹丝不动**，而控制台一声不吭（看着像"点了没反应"）。
     */
    expect(shellTabTools().sort()).toEqual(TOOLS.map((t) => t.name).sort())
  })

  it('★★ 两个子页上报的消息名和 tool 名，跟外壳认的一致', () => {
    // 子页 → 外壳 的这条消息，三处必须写同一个字符串
    expect(SHELL.includes("'lw-tool-dirty'"), '外壳没在听 `lw-tool-dirty`').toBe(true)
    expect(
      LIB.includes("{ type: 'lw-tool-dirty', tool: 'library'"),
      'library-browse.html 报的 tool 名不是 `library`（或者根本没报）—— 外壳会把它当陌生人丢掉',
    ).toBe(true)
    expect(
      TRAVEL.includes("{ type: 'lw-tool-dirty', tool: 'travel'"),
      'landmarks-browse.html 报的 tool 名不是 `travel`（或者根本没报）',
    ).toBe(true)
  })

  it('★★ 外壳挂了 beforeunload 守卫（子页的弹不出来，只剩这一份）', () => {
    const block = beforeUnloadBlock(SHELL)
    expect(block, '外壳里没有 beforeunload 监听器').not.toBe('')
    expect(
      block.includes('preventDefault'),
      '外壳的 beforeunload 没有 preventDefault —— 有未保存的改动也拦不住关标签页',
    ).toBe(true)
    expect(
      block.includes('dirty'),
      '外壳的守卫没有读子页报上来的状态 —— 那它守的是个常量',
    ).toBe(true)
  })

  it('★★ 两个子页嵌进去时，都把自己的 beforeunload 让给父页', () => {
    for (const [name, src] of [['library-browse.html', LIB], ['landmarks-browse.html', TRAVEL]] as const) {
      expect(
        src.includes('window.parent !== window'),
        `${name} 里没有"我是不是被内嵌了"的判据`,
      ).toBe(true)
      expect(
        beforeUnloadBlock(src).includes('EMBEDDED'),
        `${name} 的 beforeunload 没有在嵌入时提前返回 —— ` +
          'iframe 里的 beforeunload 弹不出对话框，留着它只会让人以为"已经守住了"',
      ).toBe(true)
    }
  })

  it('★★ 外壳里 iframe 的 `src` 只在**一处**赋值（别的地方再设一次 = 重载 = 丢改动）', () => {
    /*
     * ⚠️⚠️ 这条是"切走不丢改动"的静态版本。
     *    外壳的切换只许动 class（`display`）；一旦有人在别处又写一句
     *    `frame.src = …`，切过去就把人家没保存的改动重载掉了 ——
     *    而家长看到的现象只是"切了一下就没了"，不报错。
     *    （运行时那一版由 `_verify-content-config.mjs` 的 JS 记号守着。）
     */
    const assigns = SHELL.match(/\.src\s*=/g) ?? []
    expect(
      assigns.length,
      `外壳里出现了 ${assigns.length} 处 \`.src =\` —— 只许在 ensureFrame() 里设一次`,
    ).toBe(1)
  })
})
