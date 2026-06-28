# CodeSurf Phase 0 基线记录

日期：2026-06-27

## 目标

在继续执行 Phase 1–5 前，固定工作区创建、错误反馈和响应式检查的可复现基线。此记录只陈述已经验证的事实；未执行的浏览器验证不视为通过。

## 已验证

### 服务端工作区 API

命令：

```bash
node --test CodeSurf/test/server.test.mjs
```

结果：13/13 通过。

已覆盖：

- `GET /` 与静态资源可访问；
- 创建、列出、打开、保存、关闭工作区；
- 不存在的仓库目录返回 `400 CODESURF_REPO_INVALID`；
- 缺失工作区名称或仓库路径返回 `400 CODESURF_BAD_REQUEST`；
- 工作区锁、未知路由、非法 JSON 与回环 Host 限制。

### 已纳入浏览器冒烟脚本的首次使用场景

`CodeSurf/scripts/browser-smoke.mjs` 已包含以下断言：

1. 首次运行自动弹出新工作区对话框；
2. 无效仓库路径后，对话框、错误消息和用户输入保持可见；
3. 修正为有效路径后工作区成功创建并打开；
4. 空工作区显示起步引导，添加 Tile 后引导隐藏；
5. 键盘帮助、`N` 新建 Tile、连线反馈、删除 Undo 和撤销后的持久化。

### Playwright 端到端执行

由于 Playwright 当前安装在 `/Users/sking/codeSurf/node_modules`，本轮使用 `NODE_PATH` 显式注入该模块路径执行：

```bash
NODE_PATH=/Users/sking/codeSurf/node_modules npm --prefix CodeSurf run smoke:browser
```

结果：30/30 通过，且无页面 console error。

为支持该验证，已做两项基线级稳定性修正：

- `scripts/browser-smoke.mjs` 支持从 `NODE_PATH` 查找 Playwright；
- 可选的 `/vendor/xterm.css` 缺失时返回空 CSS，避免可选依赖造成浏览器 404 噪音。

### 响应式视觉检查

Phase 5 已在 browser smoke 中覆盖以下 viewport 宽度，逐项检查工具栏、状态文字、minimap 和对话框是否遮挡主操作：

| 宽度 | 预期 |
| --- | --- |
| 1280px | 通过：无水平溢出；canvas 高度充足；工具栏高度受控；minimap 位于 canvas 内。 |
| 1024px | 通过：无水平溢出；canvas 高度充足；工具栏高度受控；minimap 位于 canvas 内。 |
| 768px | 通过：无水平溢出；canvas 高度充足；工具栏高度受控；minimap 位于 canvas 内；工作区创建和帮助对话框完整显示并回焦。 |

## Phase 0 退出条件

1. 服务端工作区创建基线持续通过；✅
2. 浏览器冒烟脚本实际执行并通过；✅
3. 1280px、1024px、768px 三个断点均有人工或自动化检查记录；✅
4. 发现的问题进入 [USABILITY_OPTIMIZATION_PLAN.md](./USABILITY_OPTIMIZATION_PLAN.md) 对应 Phase，而不是口头遗留。✅
