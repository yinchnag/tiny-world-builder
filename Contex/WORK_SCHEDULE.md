# Contex 与 CodeSurf 开发工作安排

## 总体策略

采用“Contex 先打底、CodeSurf 逐步接入”的双轨开发方式，不同时铺开所有
功能。

```text
证据与协议冻结
       ↓
Contex 核心服务
       ↓
CodeSurf 画布基础
       ↓
Terminal + Chat 完整闭环
       ↓
任务、文件冲突、Objective 与 Skill
       ↓
Git、Workspace Memory、扩展与工作流
```

Contex 是底层协调服务，负责 Tile、Peer、消息、任务、文件声明和 Objective。
CodeSurf 是上层工作空间，负责无限画布、Terminal、Chat、状态展示和用户交互。

## 第一阶段：冻结 MVP 合同

建议周期：2–3 天。

### 工作内容

- 将 Git 历史恢复出的协议数据转为测试 Fixture。
- 确定 `tile` 为正式术语，`block` 和 `card` 仅作为兼容别名。
- 固定第一版 MCP Tool、Resource 和 Notification Schema。
- 明确“确认的历史功能”和“重建新增设计”的边界。
- 制作 CodeSurf 画布、Terminal、Chat 和 Link 的基础交互线框。
- 确认技术栈和目录结构。

### 推荐技术栈

- Contex：Node.js 22、TypeScript、官方 MCP SDK、SQLite。
- CodeSurf：Electron、TypeScript、React、xterm.js。
- 测试：Node Test、Playwright。

### 完成标准

- 每项确认的历史行为都有 Fixture 或测试场景。
- MCP 第一版接口不再随意变动。
- CodeSurf 可以依据接口开始独立开发。

## 第二阶段：Contex MVP

优先实施 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) 的 Phase 1–4。

### 2.1 服务启动与认证

- 创建 `contex serve` CLI。
- 默认监听本机回环地址。
- 支持动态端口。
- 实现 `/health`、`/version` 和 `/mcp`。
- 生成短期 Bearer Token。
- 实现 Token Scope 和过期机制。
- 支持 MCP 初始化和能力列表。

### 2.2 Workspace 与 Tile

- Workspace 创建、打开、归档。
- Tile 注册、更新和查询。
- Tile 心跳与离线检测。
- Tile 状态机。
- SQLite 数据持久化。
- 实现：
  - `peer_set_state`
  - `peer_get_state`

### 2.3 Peer Link

- 创建、删除和查询 Tile Link。
- 根据 Link 发现 Peer。
- 根据 Tile 类型过滤可用操作。
- 生成兼容历史格式的 `peers.md` 资源。
- Link 发生变化时发送通知。

### 2.4 消息系统

- Tile 间直接消息。
- 离线消息保存。
- 未读消息查询。
- 消息确认。
- 回复和关联 ID。
- 实现：
  - `peer_send_message`
  - `peer_read_messages`
  - `chat_send_message`
  - `chat_acknowledge`
  - `notify`

### 阶段里程碑

两个命令行模拟 Agent 可以：

1. 注册为不同 Tile。
2. 建立 Link。
3. 查看对方状态。
4. 互相发送消息。
5. 在服务重启后恢复消息和状态。

## 第三阶段：CodeSurf Canvas MVP

Contex 协议稳定后，可与 Contex 后续工作并行实施。

### 3.1 桌面应用外壳

- Electron 应用。
- 创建和打开 Workspace。
- 绑定 Repository 路径。
- Workspace 自动保存与恢复。
- 设置、日志和错误展示。

### 3.2 无限画布

- 平移和缩放。
- Tile 创建、移动、调整大小。
- Tile 连线。
- 单选和多选。
- Minimap。
- Zoom-to-fit。
- 布局撤销和重做。
- 布局持久化。

### 3.3 通用 Tile Shell

- Tile ID、标题和类型。
- 状态颜色和非颜色状态标识。
- 当前任务摘要。
- 未读、阻塞和人工关注标记。
- 最小化、固定、关闭。
- Resize Handle。
- Link Port。
- Tile 类型注册机制。

### 3.4 接入 Contex

- 启动和监控 Contex 进程。
- 安全接收动态端口与 Token。
- 建立 MCP Client。
- 同步 Tile 状态。
- 同步 Canvas Link 与 Peer Link。
- 接收消息、冲突和 Objective 通知。
- Contex 离线时显示 Stale 状态并尝试恢复。

### 阶段里程碑

画布中的两个模拟 Tile 可以通过 Contex：

- 同步状态；
- 建立 Peer 关系；
- 发送消息；
- 显示离线和阻塞状态。

## 第四阶段：第一个真实 Agent 完整闭环

### 4.1 Terminal Tile

- PTY 后端。
- xterm.js 前端。
- Shell Profile。
- 工作目录选择。
- 启动 Claude、Codex 或自定义命令。
- 注入：
  - `CARD_ID`
  - Contex MCP URL
  - Contex Token
  - Repository 路径
  - 可选 Worktree 路径
- 输出滚动、搜索和复制。
- 进程停止、重启和退出状态。
- 接收 `terminal_send_input`。

### 4.2 Chat Tile

- 人工输入。
- 接收 Agent 消息。
- 向一个或多个相连 Agent 发消息。
- 回复和确认。
- 将消息转换为 Objective、Task 或 Todo。
- 未读和人工关注提醒。

### 4.3 完整流程

1. 用户创建 Terminal Tile。
2. CodeSurf 启动真实 Shell 或编码 Agent。
3. Agent 自动注册到 Contex。
4. 用户从 Chat Tile 发送任务。
5. Agent 更新工作状态和文件列表。
6. CodeSurf 展示进度。
7. Agent返回完成摘要或阻塞原因。

### 阶段里程碑

可以通过 CodeSurf 管理至少两个同时工作的真实编码 Agent。

## 第五阶段：Task、Todo 与文件冲突

### Contex 工作

- Task CRUD 和状态转换。
- Todo 分配与完成。
- 暂停和阻塞原因。
- File Claim：
  - `read`
  - `edit`
  - `exclusive`
- 冲突计算。
- Stale Claim 清理。
- 冲突通知和审计事件。

### CodeSurf 工作

- Status Tile。
- Task Board。
- Todo 分配 UI。
- 当前文件列表。
- 文件冲突边框和提醒。
- 一键聚焦冲突 Tile。
- 人工协调消息入口。

### 阶段里程碑

两个 Agent 声明编辑同一个文件时：

1. Contex 检测冲突。
2. CodeSurf 显示冲突。
3. Agent 收到协调提示。
4. 用户或 Agent 可以通过 Chat 明确分工。

## 第六阶段：Objective、Skill 与 Context

### Contex 工作

- Objective 版本管理。
- Skill Assignment。
- Context Attachment。
- Reload Required 通知。
- Agent Reload Acknowledgement。
- 实现：
  - `get_context`
  - `reload_objective`
- 提供历史兼容资源：
  - `objective.md`
  - `skills.json`
  - `state.json`
  - `peers.md`

### CodeSurf 工作

- Objective 编辑器。
- Skill 搜索和发现。
- Skill 启用和禁用。
- Commands 列表。
- Context Attachment 管理。
- Objective Diff 和版本历史。
- Agent 是否已重新加载的状态展示。

### 阶段里程碑

能够复现历史案例：

- 创建一个独立 Tile；
- 只启用 `tinyworld-i18n`；
- 设置专用 Objective；
- 运行中的 Agent 收到 Reload 通知并确认。

## 第七阶段：工程化能力

按价值和依赖顺序实施。

### 7.1 Git 与 Worktree

- Repository Status。
- Diff 和 Branch 展示。
- 为并行 Agent 创建独立 Worktree。
- Stage 和 Commit 必须明确确认。
- Push 和 PR 必须明确确认。
- Main Branch 保护。
- 部署影响提示。

安全默认值：

- 不自动提交。
- 不自动推送。
- 不自动操作 Main。
- 不自动触发生产部署。

### 7.2 Browser QA Tile

- 本地 URL。
- Screenshot。
- Console Message。
- Playwright/Chrome MCP。
- 将检查结果发送给 Agent。

### 7.3 Document Tile

- Markdown。
- Objective、Spec 和 Plan 模板。
- Repository 文件引用。
- 文本选区发送给 Agent。
- 注释与版本历史。

### 7.4 Workspace Memory

- 收集 Git、Task、Tile Summary 和项目文档。
- 清理 Secret。
- 区分已提交和本地状态。
- 生成 Memory Diff。
- 用户确认或修正。
- Memory Tile 展示。

### 7.5 Extension System

- `extension.json`
- `activate()`
- Sandboxed Iframe。
- `window.codesurf` Bridge。
- `window.contex` 兼容别名。
- Capability Permission。
- 可选后端进程。

### 7.6 Workflow Runtime

- `phase(...)`
- `parallel(...)`
- `agent(...)`
- `log(...)`
- Structured Schema。
- Cancellation 和 Retry。
- Workflow Tile。
- Artifact 展示。

参考验收任务：重现历史 `split-god-file` 的 Analyze、Plan、Execute、Verify
工作流，但禁止默认自动 Push。

## 推荐并行分工

| 工作轨 | 主要职责 | 前置依赖 |
|---|---|---|
| A：Contex Core | MCP、认证、SQLite、Workspace、Tile、Peer | Phase 0 |
| B：Contex Coordination | Message、Task、Todo、Claim、Objective | A 的核心接口 |
| C：CodeSurf Canvas | Electron、Canvas、Tile Shell、Layout | Phase 0 |
| D：Terminal Integration | PTY、xterm、Agent 生命周期 | A 的 Tile 协议 |
| E：QA 与安全 | Contract Test、Playwright、性能、安全审计 | 全程并行 |

A 和 C 可以同时启动。D 必须等待 Tile 注册协议稳定。B 可以在 A
完成数据库和领域接口后开始。

## 分支安排

当前集成开发分支：

```text
codex/contex-codesurf-development
```

建议短分支：

```text
codex/contex-server-bootstrap
codex/contex-tile-presence
codex/contex-peer-messaging
codex/contex-task-claims
codex/codesurf-canvas-shell
codex/codesurf-contex-integration
codex/codesurf-terminal-tile
codex/codesurf-chat-tile
```

每个分支只完成一个可独立验收的功能。不要在一个提交中同时混合 MCP
协议、数据库迁移、Terminal 和 Canvas UI。

## 第一轮迭代

第一轮只开发 Contex，不先开发无限画布。

### 目标

证明协调协议可以独立运行，为 CodeSurf 提供稳定底座。

### 任务清单

1. 创建 `packages/contex-server/`。
2. 建立 TypeScript 项目骨架。
3. 加入官方 MCP SDK。
4. 实现 `contex serve`。
5. 实现 `/health` 和 MCP `initialize`。
6. 建立 SQLite Migration。
7. 建立 Workspace 和 Tile 数据表。
8. 实现 `peer_set_state`。
9. 实现 `peer_get_state`。
10. 编写两个 Mock Agent 的集成测试。
11. 验证服务重启后的 Tile 状态恢复。
12. 编写启动、测试和协议说明。

### 第一轮完成标准

- `npm test` 或独立包测试通过。
- 两个模拟 Agent 可以注册和读取状态。
- 未认证客户端被拒绝。
- Token 不写入仓库。
- SQLite 数据可以在重启后恢复。
- MCP Schema 与文档保持一致。

## 交付节奏

每个阶段结束时必须：

1. 更新开发计划中的完成状态。
2. 更新接口文档和数据模型。
3. 运行单元、集成和兼容测试。
4. 记录已发现的历史行为差异。
5. 提供人工验收步骤。
6. 保持提交小而清晰。

## 总体验收场景

1. 打开 Repository Workspace。
2. 创建一个 Chat Tile 和两个 Terminal Tile。
3. 分别启动 Claude 和 Codex。
4. 将两个 Terminal 与 Chat 相连。
5. 为两个 Agent 设置不同 Objective 和 Skill。
6. Agent 通过 Contex 注册。
7. 一个 Agent 创建 Browser QA 子 Tile。
8. 两个 Agent 声明编辑同一文件。
9. Contex 检测冲突，CodeSurf 展示提醒。
10. 用户通过 Chat 完成分工。
11. Agent 完成 Todo 并发送摘要。
12. Browser Tile 完成页面验证。
13. Git UI 展示变更，但不自动 Push。
14. Workspace Memory 提议更新。
15. 关闭并重新打开 CodeSurf。
16. Layout、Objective、Message、Task、状态历史和 Memory 全部恢复。

