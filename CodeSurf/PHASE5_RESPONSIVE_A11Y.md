# CodeSurf Phase 5 响应式与无障碍收口记录

日期：2026-06-27

## 目标

确保 CodeSurf 在常见窗口宽度下保持可操作，并完成基础无障碍收口：核心任务应能通过键盘完成，状态/对话框/mini map 不应遮挡主要操作。

## 已完成

### 响应式布局

- 顶部工具栏允许分组内换行，避免在中等宽度下横向溢出。
- 900px 以下：
  - 工具栏换行；
  - 状态区横向收口；
  - minimap 缩小到 `150 × 105`。
- 620px 以下：
  - 工具栏分组改为整行排列；
  - Workspace / Tile type select 限制最大宽度；
  - 状态说明允许换行；
  - minimap 缩小到 `112 × 78`；
  - 路径输入和选择按钮纵向排列；
  - 帮助对话框内容改为单列。
- 460px 以下：
  - minimap 隐藏，避免遮挡画布核心操作。

### 对话框与焦点

- 对话框宽度限制为 `min(520px, calc(100vw - 28px))`；
- 对话框最大高度限制为 `calc(100vh - 28px)` 并允许内部滚动；
- Help dialog 和 New workspace dialog 在 768px viewport 下均可完整显示；
- Escape 关闭 Help / New workspace 后，焦点回到触发按钮。

### 可访问性

- `main#canvas` 增加 `aria-label`；
- `#minimap` 增加 `aria-label`；
- 所有 `role="button"` 元素加入可见焦点样式；
- browser smoke 覆盖纯键盘创建 Tile。

## 验证结果

命令：

```bash
node --check CodeSurf/scripts/browser-smoke.mjs
npm --prefix CodeSurf test
NODE_PATH=/Users/sking/codeSurf/node_modules npm --prefix CodeSurf run smoke:browser
```

结果：

- 语法检查通过；
- `npm --prefix CodeSurf test`：73/73 通过；
- browser smoke：85/85 通过，无 console/page errors。

## 响应式断点记录

自动化已覆盖以下 viewport：

| 宽度 | 检查 |
| --- | --- |
| 1280px | 无水平溢出；canvas 高度充足；工具栏高度受控；minimap 位于 canvas 内。 |
| 1024px | 无水平溢出；canvas 高度充足；工具栏高度受控；minimap 位于 canvas 内。 |
| 768px | 无水平溢出；canvas 高度充足；工具栏高度受控；minimap 位于 canvas 内；Help/New dialog 均完整显示并回焦。 |

## Phase 5 结论

Phase 5 的响应式布局、对话框适配、焦点回归、基础 aria 与键盘创建验收已完成。
