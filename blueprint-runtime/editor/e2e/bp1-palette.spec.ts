import { test, expect } from '@playwright/test';

/**
 * BP-1 真浏览器 E2E：节点面板 → 画布 → 检视器。
 * 验四问：可见(面板)·易见(按钮)·可操作(点击建节点)·有反馈(画布出现节点 + 检视器出端口)。
 */
test.describe('BP-1 节点面板', () => {
  test('从面板新建 Agent 节点并在检视器查看其契约端口', async ({ page }) => {
    await page.goto('/');

    // 可见 + 易见：面板与 Agent 按钮在屏
    await expect(page.getByTestId('node-palette')).toBeVisible();
    const addAgent = page.getByTestId('palette-add-agent');
    await expect(addAgent).toBeVisible();

    // 可操作 + 有反馈：点一下 → 画布出现一个节点
    await addAgent.click();
    const node = page.locator('.react-flow__node');
    await expect(node).toHaveCount(1);

    // 有反馈：选中节点 → 检视器显示契约端口
    await node.click();
    const inspector = page.getByTestId('inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.locator('[data-port="message_in"]')).toBeVisible();
    await expect(inspector.locator('[data-port="report_out"]')).toBeVisible();
  });

  test('从面板新建 Task 节点并在检视器查看其契约端口', async ({ page }) => {
    await page.goto('/');

    const addTask = page.getByTestId('palette-add-task');
    await expect(addTask).toBeVisible();
    await addTask.click();

    const node = page.locator('.react-flow__node');
    await expect(node).toHaveCount(1);
    await node.click();

    const inspector = page.getByTestId('inspector');
    await expect(inspector.locator('[data-port="task_out"]')).toBeVisible();
    await expect(inspector.locator('[data-port="task_update_in"]')).toBeVisible();
  });

  test('从面板新建 Document 节点并在检视器查看其契约端口', async ({ page }) => {
    await page.goto('/');

    const addDoc = page.getByTestId('palette-add-document');
    await expect(addDoc).toBeVisible();
    await addDoc.click();

    const node = page.locator('.react-flow__node');
    await expect(node).toHaveCount(1);
    await node.click();

    const inspector = page.getByTestId('inspector');
    await expect(inspector.locator('[data-port="text_out"]')).toBeVisible();
    await expect(inspector.locator('[data-port="selection_out"]')).toBeVisible();
  });

  test('从面板新建 Memory 节点并在检视器查看其契约端口', async ({ page }) => {
    await page.goto('/');

    const addMem = page.getByTestId('palette-add-memory');
    await expect(addMem).toBeVisible();
    await addMem.click();

    const node = page.locator('.react-flow__node');
    await expect(node).toHaveCount(1);
    await node.click();

    const inspector = page.getByTestId('inspector');
    await expect(inspector.locator('[data-port="fact_out"]')).toBeVisible();
    await expect(inspector.locator('[data-port="proposal_out"]')).toBeVisible();
  });
});
