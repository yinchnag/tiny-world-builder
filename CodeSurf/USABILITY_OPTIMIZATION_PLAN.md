# CodeSurf 可操作性优化计划

## 1. 背景与结论

当前 CodeSurf 已具备画布、工作区、本地持久化、终端 Tile 和可选 Contex 集成，但首次使用流程仍按原型方式设计。实际测试中，点击 New workspace 的 Create 后可能看似没有反应。

已确认根因位于 `public/canvas.js`：创建请求失败后，代码先写入 `#nw-error`，再调用 `openNewDialog()`；后者又无条件清空 `#nw-error`。用户失去了失败原因，只能感知为按钮无响应。

本计划的目标是把 CodeSurf 的关键任务流提升到“首次使用即可理解、失败可以自救、离线状态不误导”的水平。具体设计基线见 [USABILITY_DESIGN_SPEC.md](./USABILITY_DESIGN_SPEC.md)。

### 当前进度（2026-06-27）

- 已完成：创建表单改为弹窗内异步提交；失败后保留输入、错误和焦点；Create 提交中状态；平台感知的路径示例与本地路径说明。
- 已完成：服务端覆盖缺失字段响应；浏览器冒烟脚本覆盖首次创建、失败可见和修正重试。
- 已完成（Phase 1）：工作区创建反馈闭环，包括空字段自定义校验、服务端错误 code 到前端友好文案的映射、提交中防重复、焦点/aria 状态和成功后进入工作区。记录见 [PHASE1_WORKSPACE_CREATION.md](./PHASE1_WORKSPACE_CREATION.md)。
- 已完成（Phase 2）：路径示例、浏览器模式粘贴说明、可选桌面目录选择能力探测、四步欢迎卡片、安全演示布局和关闭偏好。记录见 [PHASE2_FIRST_USE_GUIDANCE.md](./PHASE2_FIRST_USE_GUIDANCE.md)。
- 已完成（Phase 3）：五段式工具栏、可见 select 分组、实时缩放百分比、Contex 本地/协作状态说明和保存状态文案。记录见 [PHASE3_TOOLBAR_STATUS.md](./PHASE3_TOOLBAR_STATUS.md)。
- 已完成（Phase 4）：标题栏/端口提示、Tile 控件 aria label、键盘激活 Minimize/Pin、Contex 镜像失败提示和防错 smoke 覆盖。记录见 [PHASE4_CANVAS_DISCOVERABILITY.md](./PHASE4_CANVAS_DISCOVERABILITY.md)。
- 已完成（Phase 5）：1280/1024/768 响应式 smoke、对话框适配、焦点回归、minimap 收口、canvas/minimap aria 和键盘创建验收。记录见 [PHASE5_RESPONSIVE_A11Y.md](./PHASE5_RESPONSIVE_A11Y.md)。
- 已完成（P1 第一批）：空画布引导、首个 Tile 的直接创建入口、Contex 离线降级说明、控件可访问名称与窄窗口基础适配。
- 已完成（P2）：帮助面板与键盘快捷键、输入控件的快捷键隔离、对话框关闭后的焦点恢复，以及 900px/620px 两档响应式收口。
- 已完成（P3）：删除 Tile 后的五秒 Undo、连接/重复连接/无目标连接的即时反馈，以及覆盖这些防错行为的浏览器冒烟场景。
- 已验证：`npm --prefix CodeSurf test` 通过（73 项）；静态语法检查通过。
- 已验证：浏览器冒烟脚本使用 `NODE_PATH=/Users/sking/codeSurf/node_modules npm --prefix CodeSurf run smoke:browser` 实际执行并通过（85/85）。
- Phase 0 基线记录：见 [PHASE0_BASELINE.md](./PHASE0_BASELINE.md)。1280px/1024px/768px 断点已由 Phase 5 browser smoke 覆盖。
- 未开始：原生目录选择、空画布欢迎卡片、工具栏重排、撤销和响应式收口。

## 2. 范围与非范围

### 范围

- 浏览器画布的工作区创建、空状态、工具栏、画布帮助与操作反馈。
- Contex 与终端的状态可见性和离线降级说明。
- 键盘可达性、焦点管理、窄窗口适配。
- 对应单元测试、服务端 API 测试、浏览器冒烟测试与人工验收。

### 非范围

- 重写 Canvas 渲染架构。
- 改变 Contex 的领域模型或 MCP 协议。
- 引入前端框架、构建工具或云端遥测。
- 自动上传用户仓库、读取仓库内容或改变 Git 状态。

## 3. 工作分期

### Phase 0：建立基线与复现（0.5 天）

**目标：** 固化当前问题，避免修复后回归。

任务：

1. 在 `test/server.test.mjs` 中覆盖 `POST /api/workspaces` 的成功、空字段和不存在路径三类响应。
2. 在 `scripts/browser-smoke.mjs` 中增加首次启动场景：打开空工作区列表、填入无效路径、断言错误仍然可见。
3. 记录当前窄屏（1280px、1024px、768px）的工具栏与 minimap 截图/检查结果。

验收：无效路径返回 `400`，前端测试可复现错误文字消失的问题。

### Phase 1：修复工作区创建反馈（P0，0.5–1 天）

**目标：** 让创建工作区有可靠、可恢复的反馈闭环。

实现任务：

1. 将 `openNewDialog()` 拆分为“首次打开/重置表单”和“展示已有表单”两种行为；失败重开时不得清空 `#nw-error`。
2. 改为拦截 form 的 `submit` 事件，在对话框仍打开时异步创建，避免 `method=dialog` 先关闭再请求的视觉跳变。
3. 增加 `creating` UI 状态：Create 禁用并显示 `Creating…`，Cancel 在请求期保持可用或明确禁用理由。
4. 客户端预校验名称与路径为空的情形；服务端错误继续作为最终权威。
5. 对 `CODESURF_REPO_INVALID` 显示可行动文案：`找不到该目录。请粘贴本机存在的绝对路径。`
6. 成功后清空表单、关闭对话框、加载新工作区，并在画布显示欢迎引导。

涉及文件：

- `CodeSurf/public/index.html`
- `CodeSurf/public/canvas.js`
- `CodeSurf/public/style.css`
- `CodeSurf/scripts/browser-smoke.mjs`

验收：

- 无效路径后输入值和错误说明仍保留在可见对话框中。
- 有效路径创建后自动进入新工作区。
- 连续点击 Create 不产生重复工作区。
- Enter 提交、Escape 关闭、焦点回归均可预测。

### Phase 2：路径输入与首次使用引导（P0/P1，1–1.5 天）

**目标：** 不让用户猜路径格式或下一步动作。

状态：已完成浏览器模式实现；原生目录选择等待 Electron preload/IPC 能力。

实现任务：

1. 根据 `navigator.platform` 或服务端平台信息提供正确路径示例；macOS/Linux 默认使用 POSIX 路径。
2. 在路径字段下增加常驻说明：`路径只保存到本机；必须是存在的文件夹。`
3. 可行时在 Electron 中提供原生“选择文件夹”；纯浏览器模式保留粘贴绝对路径并说明限制。
4. 新工作区空画布显示欢迎卡片，包括“添加 Tile”“拖动”“连线”“Contex 是可选项”的四步说明。
5. 提供 `查看基础工作流示例` 链接，指向项目内示例或创建一个不执行命令的安全演示布局。
6. 记录用户关闭欢迎卡片的本地偏好，不强制每次出现。

验收：首次用户不阅读文档即可知道路径要求、完成创建并在画布上添加第一个 Tile。

### Phase 3：工具栏与状态系统（P1，1 天）

**目标：** 把“能点”提升为“知道为什么点”。

状态：已完成。

实现任务：

1. 以工作区、创建、视图、协作、保存五个区块重排工具栏。
2. 将 `100%` 改为 `重置缩放`；保留百分比作为实时状态，而不是唯一按钮文案。
3. 为 Tile 类型下拉和工作区下拉增加可见 label 或 aria-label。
4. 将 Contex 状态扩展为 connected / connecting / disconnected / error，并增加简短解释与“如何启动”入口。
5. 保存状态提供可读文案：`保存中`、`已保存 14:32`、`保存失败：重试`。
6. 用文字和图标共同表达状态，不依赖颜色。

验收：在不打开 tooltip 的前提下，用户可以解释每个工具栏区域的用途；Contex 离线不会被误认为画布不可用。

### Phase 4：画布可发现性与防错（P1，1–2 天）

**目标：** 降低隐藏手势和误操作成本。

状态：已完成。

实现任务：

1. 为空画布、Tile 标题栏和端口提供首次出现提示；端口 hover 显示“拖动以连接”。
2. 增加帮助入口，列出双击、新建、移动、连线、缩放、适配、删除和快捷键。
3. 删除 Tile 后显示 toast，并提供 Undo；若短期无法实现命令历史，先实现二次确认。
4. 连接建立/失败时给出明确 toast；本地连接与 Contex 镜像失败需区分显示。
5. 检查并补齐最小化、固定、关闭 Tile 的焦点顺序和键盘触发方式。
6. 评估并实现最小快捷键集合：`N` 新建、`F` 适配、`0` 重置缩放、`?` 帮助、Delete 删除所选 Tile。

验收：新用户可以发现连线操作；错误删除可在限定时间内恢复；核心动作不依赖鼠标手势。

### Phase 5：响应式与无障碍收口（P2，1 天）

**目标：** 在常见窗口和键盘使用下保持可用。

状态：已完成。

实现任务：

1. 为 1024px 和 768px 设置工具栏折叠/换行策略；把低优先级动作放入更多菜单。
2. minimap 在窄屏自动缩小、隐藏或可折叠。
3. 校验对话框焦点陷阱、Escape、回焦和可见焦点样式。
4. 提高文字、边框和状态颜色的对比度至 WCAG 2.2 AA 目标。
5. 用浏览器自动化覆盖键盘创建、对话框提交、关闭、缩放与工作区切换。

验收：1280px、1024px、768px 三种宽度下核心任务可完成；纯键盘可创建并操作至少一个 Tile。

## 4. 测试矩阵

| 场景 | 自动化 | 人工检查 |
| --- | --- | --- |
| 创建有效工作区 | Server + browser smoke | 路径、进入画布、欢迎卡片。 |
| 创建不存在路径 | Browser smoke | 错误可见、输入不丢失、可修正重试。 |
| Contex 未启动 | Browser smoke | 本地画布可用，状态提示准确。 |
| Contex 已连接 | Integration test | 状态变化、链接镜像、聊天/命令入口。 |
| 保存失败与恢复 | Store + server test | 重试操作和数据未丢失。 |
| 删除与撤销 | Browser smoke | Tile、链接、选中状态恢复。 |
| 窄窗口 | Visual/browser smoke | 工具栏、minimap、对话框不遮挡。 |
| 键盘流程 | Browser smoke | Tab、Enter、Escape、快捷键、焦点可见。 |

每个 Phase 完成后至少执行：

```bash
npm --prefix CodeSurf test
npm --prefix CodeSurf run smoke:browser
```

终端相关改动另加：

```bash
npm --prefix CodeSurf run smoke:pty
npm --prefix CodeSurf run smoke:xterm
```

## 5. 风险与决策

- **浏览器无法安全选择任意本机目录：** 浏览器版不模拟文件选择器，保留绝对路径输入并做好校验；Electron 版优先接原生目录选择。
- **Undo 的实现范围：** 首期只覆盖删除 Tile 与链接，避免一开始为所有画布动作引入复杂历史系统。
- **Contex 启动失败：** 不阻塞本地工作区与画布功能；状态区域提供诊断而不是模糊“离线”。
- **路径隐私：** 路径仅存于本地 WorkspaceStore；错误消息不得暴露用户目录以外的敏感内容到远程服务。
- **避免 UI 与协议耦合：** CodeSurf 只显示 Contex 状态与受支持能力，不将 Contex 的内部错误对象直接暴露给用户。

## 6. 完成定义

优化工作完成需同时满足：

1. 已修复“Create 无反应”的错误反馈缺陷。
2. 完成 Phase 1–3，Phase 4–5 至少有排期和验收记录。
3. 所有新增/修改的 CodeSurf 测试通过，浏览器冒烟测试覆盖创建失败与成功。
4. 在 Contex 关闭和开启两种模式下，核心画布任务均经过验证。
5. 本文档与 [USABILITY_DESIGN_SPEC.md](./USABILITY_DESIGN_SPEC.md) 随实现更新，不让计划与实际行为脱节。
