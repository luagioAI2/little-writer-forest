/* ============================================================
   类型声明 —— `a-level-names.mjs` 的 `.d.mts`
   ============================================================

   ⚠️ 为什么需要它：`a-level-names.mjs` 是给 **node 直接跑**的 ESM 模块
   （`fetch-a-level-cn.mjs` 与 `build-landmarks-cn.mjs` 引它），
   而 **App 侧的单元测试也要引它** —— 因为「同一个景区」这条判据
   必须**生成侧和守卫共用一份**（两处各写一遍会漂移，MEMORY §四）。

   ⚠️ 但 `tsconfig.app.json` 的 `include` 只有 `src`，`.mjs` 不在编译范围内
   → 不给声明的话，`landmarks.test.ts` 引它会报 TS7016（隐式 any）。

   ⚠️⚠️ 改了 `.mjs` 的导出，**记得同步这里**。
      对不上时**不会静默**：要么 `tsc` 报错，要么测试里调用直接炸。
   ============================================================ */

/** 规范化景区名：去分隔符/空格 → 反复剥通用后缀。 */
export function normLandmarkName(s: string): string

/** 包含关系打分：短名被长名完全包含才算命中，分数 = 短名长度；`100` = 完全相等。 */
export function containScore(a: string, b: string): number

/** 去掉括号注释、开头的「XX市/省」、以及套话，得到"这是哪儿"。 */
export function coreScenicName(name: string): string

/** 两个名字是不是**同一个景区**（调用方负责保证「同一个市」）。 */
export function sameScenicArea(a: string, b: string): boolean
