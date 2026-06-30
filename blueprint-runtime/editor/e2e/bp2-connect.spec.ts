import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * BP-2 真浏览器 E2E：拖拽连线的类型校验。
 * 四问：端口可见/可抓取（可操作）；不兼容 → 弹拒绝原因（有反馈）；
 *       兼容 → 画布出现 typed 边（有反馈）。
 */
async function dragHandle(page: Page, src: Locator, tgt: Locator): Promise<void> {
  const sb = await src.boundingBox();
  const tb = await tgt.boundingBox();
  if (sb === null || tb === null) throw new Error('handle not found');
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.describe('BP-2 类型化连线', () => {
  test('不兼容连线弹拒绝原因；兼容连线创建 typed 边', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('palette-add-document').click();
    await page.getByTestId('palette-add-agent').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(2);

    const doc = page.locator('.react-flow__node', { hasText: 'document' });
    const agent = page.locator('.react-flow__node', { hasText: 'agent' });

    // 不兼容：Document.selection_out(context) → Agent.message_in(message) = lane.mismatch
    await dragHandle(page, doc.locator('[data-handleid="selection_out"]'), agent.locator('[data-handleid="message_in"]'));
    await expect(page.getByTestId('connect-reason')).toBeVisible();
    await expect(page.getByTestId('connect-reason')).toContainText('lane.mismatch');
    await expect(page.locator('.react-flow__edge')).toHaveCount(0);

    // 兼容：Document.selection_out(context) → Agent.context_in(context) → 建 typed 边
    await dragHandle(page, doc.locator('[data-handleid="selection_out"]'), agent.locator('[data-handleid="context_in"]'));
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  });
});
