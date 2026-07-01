/**
 * Vitest 配置 — 测试发现 + G6 覆盖率门槛（镜像 30 §G6）。
 *
 * 覆盖率门槛在 F0（有真实 core/ 代码可覆盖）起才作为闸；F-guard 空骨架阶段
 * `pnpm test`（vitest run，不带 --coverage）即可全绿。门槛数字镜像 tools/guard/config。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    environment: 'node',
    // 并行 HTTP/SSE server 测试在 CPU 竞争下偶发慢/连接竞争（各测本身确定性）：给足超时 + 重试。
    retry: 2,
    testTimeout: 20_000,

    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['core/**', 'runtime/**', 'editor/**', 'tools/**'],
      exclude: ['**/*.test.*', '**/*.config.*', '**/*.d.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        'core/**': { lines: 90, functions: 90, branches: 90, statements: 90 },
      },
    },
  },
});
