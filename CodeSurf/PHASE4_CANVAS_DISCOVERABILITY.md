# CodeSurf Phase 4 画布可发现性与防错记录

日期：2026-06-27

## 目标

让新用户更容易发现画布核心手势，并降低误操作成本：移动、连线、删除、撤销和键盘操作都应有清楚反馈。

## 已完成

### Tile 操作提示

- Tile 标题栏增加可见 hover 提示：`Drag header to move`。
- 连接端口增加可见 hover/focus 提示：`Drag to connect`。
- 连接端口保留 title，并新增 `role="button"` 与 `aria-label`，说明“拖到另一个 Tile 创建链接”。
- Resize handle 增加可访问名称。

### Tile 控件可访问性

- Pin、Minimize、Close 按钮增加 `aria-label`。
- 键盘激活按钮时也能触发对应动作：
  - Enter/Space 激活 Minimize；
  - Enter/Space 激活 Pin；
  - Close 保留可访问名称，并与删除 Undo 反馈配合。

### 防错反馈

- 删除 Tile 后继续提供 toast + Undo。
- 连接成功时区分本地模式与 Contex 模式：
  - Contex 未连接：`Tiles connected locally.`
  - Contex 已连接：`Tiles connected. Syncing to Contex…`
- 如果本地连线成功但 Contex 镜像失败，会提示：`Local link kept, but Contex sync failed.`
- 空白处释放连线继续提示：`Drop the port on another Tile to create a link.`

### 测试稳定性

- browser smoke 增加标题栏提示、端口提示、aria label、键盘 Minimize/Pin 验收。
- 对新工作区欢迎卡片的检查改为等待异步工作区加载完成，避免对话框关闭与工作区打开之间的竞态。

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
- browser smoke：68/68 通过，无 console/page errors。

## Phase 4 结论

Phase 4 的画布提示、防错反馈、Tile 控件可访问性和键盘触发已完成。下一步可以进入 Phase 5：响应式与无障碍收口。
