import { test, expect } from '@playwright/test';

/**
 * BP-3 真浏览器 E2E：检视器实时状态 + 动作按钮推进。
 * 四问：状态可见/易见；动作按钮可操作；点击后状态变化有反馈。
 */
test.describe('BP-3 检视器', () => {
  test('选中节点显示实时状态，点动作按钮推进状态', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('palette-add-agent').click();

    const node = page.locator('.react-flow__node').first();
    await node.click();

    const inspector = page.getByTestId('inspector');
    await expect(inspector.getByTestId('inspector-state')).toHaveText('idle');

    // 可操作 + 有反馈：点 "start" → 状态变 working
    await inspector.getByTestId('action-start').click();
    await expect(inspector.getByTestId('inspector-state')).toHaveText('working');

    // working 态出现新动作（report/complete/await_human）
    await expect(inspector.getByTestId('action-complete')).toBeVisible();
  });
});
