# CodeSurf Phase 3 工具栏与状态系统记录

日期：2026-06-27

## 目标

把顶部工具栏从一排行为按钮整理为可理解的任务区，并让协作、缩放、保存状态用文字与符号共同表达，不只依赖颜色或 tooltip。

## 已完成

### 工具栏分区

顶部工具栏现在分为五个可见任务区：

1. `Workspace`：当前工作区选择与新建；
2. `Create`：Tile 类型选择与添加；
3. `View`：适配视图、重置缩放、当前缩放百分比、帮助；
4. `Collaborate`：Contex 状态与本地/协作模式说明；
5. `Save`：保存、打开、恢复、失败等状态。

工作区选择和 Tile 类型选择保留 `aria-label`，并新增可见分组标签，减少用户猜测。

### 缩放状态

- `Reset zoom` 保留为明确按钮文案；
- 新增 `#zoom-status`，实时显示当前缩放百分比；
- `Fit` 和滚轮缩放后都会刷新百分比；
- `Reset zoom` 会将状态恢复到 `100%`。

### Contex 状态

Contex 状态现在使用文字 + 符号 + 说明：

- `● Contex: connected`：协作、聊天和 canvas commands 可用；
- `◌ Contex: connecting…`：正在连接，本地画布仍可用；
- `○ Contex: not started`：本地模式，使用 `--contex` 启用 agent 协作；
- `⚠ Contex: offline`：后端不可用，本地模式继续；
- `⚠ Contex: connection failed`：连接失败，可启动 `--contex` 或继续本地工作。

说明文字显示在 `#contex-help`，避免用户把 Contex 未启动误认为画布不可用。

### 保存状态

保存状态现在使用明确文本：

- `⏳ Saving…`
- `✓ Saved 14:32:10`
- `✓ Opened <workspace>`
- `⚠ Recovered from backup`
- `⚠ Save failed: <reason>`

状态使用文字与符号共同表达，不只依赖颜色。

## 验证结果

命令：

```bash
node --check CodeSurf/public/canvas.js
node --check CodeSurf/scripts/browser-smoke.mjs
npm --prefix CodeSurf test
NODE_PATH=/Users/sking/codeSurf/node_modules npm --prefix CodeSurf run smoke:browser
```

结果：

- 语法检查通过；
- `npm --prefix CodeSurf test`：73/73 通过；
- browser smoke：62/62 通过，无 console/page errors。

## Phase 3 结论

Phase 3 的工具栏分区、缩放状态、Contex 本地模式说明和保存状态文案已完成。下一步可以进入 Phase 4：画布可发现性与防错。
