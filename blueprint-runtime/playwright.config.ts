import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 配置 — 前端真浏览器 E2E（GUIDE §8 / 20 §）。
 * 规格放 editor/e2e/*.spec.ts；vitest 只收 *.test.ts(x)，二者不撞。
 * webServer 起 editor 的 Vite dev（5173），测完自动关。
 */
export default defineConfig({
  testDir: './editor/e2e',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite --port 5173 --strictPort --host 127.0.0.1',
    cwd: './editor',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    stdout: 'pipe',
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
