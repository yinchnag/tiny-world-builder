import { test, expect } from '@playwright/test';

/**
 * 画布交互 E2E：节点可拖动（位置变更经 onNodesChange 回写 store）。
 * 四问：节点可见 + 可操作（拖动）+ 有反馈（位置真的变了）。
 */
test.describe('画布交互', () => {
  test('从面板建的节点可以在画布上拖动', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('palette-add-agent').click();

    const node = page.locator('.react-flow__node').first();
    const before = await node.boundingBox();
    if (before === null) throw new Error('node not found');

    // 抓节点标题区拖动（避开两侧端口 Handle）
    await page.mouse.move(before.x + 30, before.y + 10);
    await page.mouse.down();
    await page.mouse.move(before.x + 200, before.y + 140, { steps: 12 });
    await page.mouse.up();

    const after = await node.boundingBox();
    if (after === null) throw new Error('node not found');
    expect(Math.abs(after.x - before.x)).toBeGreaterThan(60);
    expect(Math.abs(after.y - before.y)).toBeGreaterThan(40);
  });
});
