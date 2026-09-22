import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

/**
 * 测试专用配置。
 * 与 vite.config.ts 分开，避免 vitest 的类型扩展污染生产构建配置。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // scripts/ 下只有「收件箱闸门」一个测试：它拿 library-inbox/ 里待导入的
    // 题去跑 App 自己的 importLibrary()，所以放在 src 外面更贴切
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    restoreMocks: true,
  },
})
