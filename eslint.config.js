import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/* ============================================================
   ESLint 配置
   ------------------------------------------------------------
   为什么这个项目需要 react-hooks 插件（血的教训）：
   日记页曾经把 hook 写进 JSX 属性 —— sub={hint(useAppLevelIndex())}。
   没解锁时那行不执行、解锁后才执行，hook 总数从 72 变 73，
   React 直接抛 "Rendered more hooks than during the previous render"，
   孩子看到的是「这一页出了点小问题」。
   这类 bug `tsc` 完全查不出来，只有 react-hooks/rules-of-hooks 能挡。
   ============================================================ */

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'android', 'gallery-preview.html'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // ⚠️ 这两条是本项目最看重的规则，不要放宽
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // 中文项目里全角标点很常见，标点类规则一律关掉
      'no-irregular-whitespace': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['scripts/**/*.{js,mjs,ts}', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
)
