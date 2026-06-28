# CodeSurf Agent Platform UI Upgrade

日期：2026-06-28  
状态：待开发计划 / Contex 后端能力已就绪  
范围：CodeSurf 对 Contex Agent Platform Phase 5/6 和 human handoff 能力的 UI/交互配合

## 背景

Contex 侧已经具备 Agent 平台核心能力：

- Agent 身份、状态、角色、runtime 注册。
- Agent 间 link-gated 消息。
- task claim / complete。
- handoff / report / broadcast。
- workspace 与单 Agent timeline。
- `agent_request_human_input` 人类接入等待机制。

CodeSurf 侧已经完成一部分基础配合：

- `+ Agent` 创建入口。
- `agent` tile 类型。
- `agent-runtime-codex.mjs` 独立 runtime adapter。
- 每个 Agent 可配置 role / model / system prompt / cwd / profile / env。
- runtime 支持 `HUMAN_ATTENTION:` 标记并调用 Contex human handoff。

仍未完成的是产品化 UI：用户还不能在画布上清晰编排、观察和介入多 Agent 协作。

## 目标

让 CodeSurf 成为可操作的 Agent 编排界面：

- 用户能创建多个独立 Agent，并通过连线定义通信方式。
- 用户能看到每个 Agent 的状态、消息、任务和 timeline。
- 用户能用 UI 发起 claim / handoff / report / broadcast 等协作动作。
- 当 Agent 等待人类时，CodeSurf 能明确显示原因，并提供回复/恢复入口。
- 常见协作链可以一键搭建：Coordinator -> Worker -> Reviewer -> Human。

## 非目标

- 不改变 Contex 的存储模型。
- 不绕过 Contex link-gated 权限。
- 不引入前端框架或 bundler。
- 不让 Agent 自动获取超出用户授权的文件/系统权限。
- 不把人类审批伪装成普通聊天；审批/重大决策必须有明确 UI 状态。

## 当前缺口

### 1. Agent Timeline UI

Contex 已提供：

- `context://workspace/{id}/timeline`
- `context://tile/{id}/timeline`
- `get_workspace_timeline`
- `get_agent_timeline`

CodeSurf 还缺：

- Agent tile 内的 timeline 面板。
- Workspace 级 Agent activity feed。
- timeline 分类展示：status / message / task / link / notification。
- 从 timeline item 跳转到相关 Agent tile、message、task。

### 2. Human Handoff UI

Contex 已提供：

- `agent_request_human_input`
- `notifications/context/human_attention`
- Agent `waiting` / `blocked` 状态和 blocker 字段。

CodeSurf 还缺：

- 明显的“等待人类”状态条。
- Agent tile 上展示具体问题/原因。
- 人类回复入口。
- “继续 / 拒绝 / 改派 / 标记已处理”操作。
- 把人类回复路由给正确 Agent 或 Coordinator。

### 3. Collaboration Actions UI

Contex 已提供：

- `agent_claim_task`
- `agent_complete_task`
- `agent_request_handoff`
- `agent_report`
- `agent_broadcast`

CodeSurf 还缺：

- Agent tile 的动作菜单。
- Task 面板里的 claim / complete 按钮。
- 从 Worker 到 Reviewer 的 handoff 操作。
- Reviewer report 回 Coordinator/Human 的操作。
- 按 role/capability 的 broadcast UI。

### 4. Workflow Presets

CodeSurf 还缺常用 Agent 协作模板：

- Coordinator -> Worker -> Reviewer。
- Planner -> Worker A / Worker B -> Reviewer。
- Human Chat -> Coordinator -> Workers -> Reviewer -> Human Chat。
- Broadcast to all Workers。

这些 preset 应创建 Agent tiles、默认 role/profile、推荐连线和可读标题。

### 5. Link Semantics

CodeSurf 当前连线主要是视觉/通信镜像，还缺更明确的语义：

- `controls`
- `reports_to`
- `reviews`
- `handoff`
- `broadcast_group`

这些语义应同步到 Contex link metadata/kind，并体现在 UI label、tooltip 和默认可用动作上。

## 分期计划

### Phase A：Timeline 面板

状态：已完成首个可用切片（2026-06-28）。CodeSurf 现在有 workspace activity
feed、Agent tile Activity 面板、`/api/contex/timeline` 与
`/api/contex/timeline/:tileId` 代理，并会在相关 SSE 通知后刷新。后续可继续
补跳转到具体 message/task 的深链。

目标：用户能看到 Agent 发生了什么。

任务：

1. 在 Agent tile 上增加 Activity/Timeline tab 或折叠面板。
2. 读取 `context://tile/{tileId}/timeline` 或调用 `get_agent_timeline`。
3. Workspace 顶部/侧边增加 Agent activity feed，读取 workspace timeline。
4. 显示分类、时间、摘要、actor、相关 task/message。
5. SSE 收到 `agent_state_changed`、`message_received`、`task_changed`、`human_attention` 后刷新 timeline。

验收：

- 单个 Agent tile 可显示最近状态、消息、任务事件。
- Workspace feed 可显示 Coordinator/Worker/Reviewer 协作链。
- timeline 不需要刷新页面即可更新。

主要文件：

- `CodeSurf/public/canvas.js`
- `CodeSurf/public/tiles.mjs`
- `CodeSurf/public/style.css`
- `CodeSurf/src/server.mjs`
- `CodeSurf/test/server-contex.test.mjs`

### Phase B：Human Handoff 面板

状态：已完成首个可用切片（2026-06-28）。CodeSurf 现在会从
`/api/contex/human-attention` 拉取 blocked/waiting Agent，右侧面板显示
pending human requests，Agent tile 内显示 waiting/blocked banner，并支持
Reply and continue / Reject / Mark handled。回复会尝试走 Contex
`agent_send_message`，处理状态走 `agent_update_state`；后续可补 Reassign /
handoff 的目标选择器。

目标：Agent 需要人类时，用户能马上看见并处理。

任务：

1. 对 `human_attention` 通知建立 pending attention 列表。
2. Agent tile 显示 waiting/blocked banner，展示 blocker/question。
3. 增加 human response 输入框。
4. 支持回复给 Agent：优先使用 `agent_send_message` 或 chat bridge。
5. 支持处理动作：
   - Reply and continue
   - Reject request
   - Reassign / handoff
   - Mark handled
6. 处理后刷新 Agent state、timeline 和 task panel。

验收：

- Agent 输出 `HUMAN_ATTENTION[permission]: ...` 后，tile 明确显示等待人类。
- 用户能输入回复并发给该 Agent。
- 处理后状态从 blocked/waiting 可恢复到 working/idle。

主要文件：

- `CodeSurf/public/canvas.js`
- `CodeSurf/public/index.html`
- `CodeSurf/public/style.css`
- `CodeSurf/src/server.mjs`
- `CodeSurf/test/server-contex.test.mjs`

### Phase C：Agent 协作动作菜单

状态：已完成首个可用切片（2026-06-28）。Agent tile 现在有可折叠 Actions
面板，支持 Claim / Complete / Handoff / Report / Broadcast；服务端通过
`/api/contex/agent-actions/:tileId/:action` 代理到 Contex `agent_*` tools，
仍由 Contex 执行 link-gated 和 task lifecycle 校验。后续可补更智能的 task /
target picker。

目标：用户不需要手写 MCP tool call，也能安排 Agent 协作。

任务：

1. Agent tile 增加 action menu。
2. 对选中 task 支持 Claim / Start / Complete。
3. 对目标 Agent 支持 Handoff to Reviewer。
4. 支持 Report to Coordinator / Human Chat。
5. 支持 Broadcast to role/capability。
6. 所有动作走 Contex `agent_*` tools，并显示成功/失败 toast。

验收：

- Coordinator 可通过 UI 分配 Worker。
- Worker 可通过 UI 请求 Reviewer。
- Reviewer 可通过 UI 回报 Coordinator 或 Human。
- 未连线目标显示明确错误，不绕过 Contex 权限。

主要文件：

- `CodeSurf/public/canvas.js`
- `CodeSurf/public/tiles.mjs`
- `CodeSurf/public/style.css`
- `CodeSurf/src/server.mjs`
- `CodeSurf/test/tiles.test.mjs`
- `CodeSurf/test/server-contex.test.mjs`

### Phase D：Workflow Presets

状态：已完成首个可用切片（2026-06-28）。Toolbar 已新增 Workflow 入口，
支持 Coordinator + Worker + Reviewer、Planner + 2 Workers + Reviewer、
Human Chat + Coordinator + Worker + Reviewer 三种 preset。Preset 会创建
可编辑 Agent / Chat tiles、默认 profile/env、directed links 和 link kind；
默认不 auto-start。

目标：用户能一键搭建常见多 Agent 工作流。

任务：

1. `+ Agent` 旁增加 `Workflow` 入口。
2. 提供 preset：
   - Coordinator + Worker + Reviewer
   - Planner + 2 Workers + Reviewer
   - Human Chat + Coordinator + Worker + Reviewer
3. 自动创建 tiles、profiles、positions、links。
4. 默认 link kind/directed 与协作语义匹配。
5. 创建后显示简短状态，提示如何启动 Agent。

验收：

- 用户可在空画布上 1 次操作创建完整协作链。
- Agent tile 配置可编辑。
- preset 不自动执行危险命令。

主要文件：

- `CodeSurf/public/canvas.js`
- `CodeSurf/public/index.html`
- `CodeSurf/public/style.css`
- `CodeSurf/test/tiles.test.mjs`
- `CodeSurf/scripts/browser-smoke.mjs`

### Phase E：Link Semantics Polish

目标：连线不仅能通信，也表达协作意图。

状态：已完成。

任务：

1. Link 创建时支持 kind/directed 选择。
2. Link label 展示语义：controls / reports_to / reviews / handoff / broadcast。
3. Workflow preset links 复用同一套可视语义。
4. Contex 镜像失败时保留本地 link，并显示同步失败状态。
5. Browser smoke 覆盖手动连线 label 与 workflow 语义 label。

验收：

- 用户看画布即可理解谁指挥谁、谁评审谁、谁向谁回报。
- directed link 的消息方向和 UI 提示一致。

主要文件：

- `CodeSurf/public/canvas.js`
- `CodeSurf/public/index.html`
- `CodeSurf/public/style.css`
- `CodeSurf/src/server.mjs`
- `CodeSurf/test/server-contex.test.mjs`
- `CodeSurf/scripts/browser-smoke.mjs`

## 建议优先级

1. 全部列出的 Phase A-E 已完成。后续可继续做更深的 task/target picker、
   live Contex validation，或把 link kind 与 Agent action defaults 更紧密联动。

## 验证矩阵

| 场景 | 验收 |
| --- | --- |
| Agent 独立启动 | 每个 Agent tile 有自己的 runtime/env/profile。 |
| Agent 互发消息 | 只有已连线方向允许消息，未连线显示失败。 |
| Worker 请求 Reviewer | UI 触发 handoff，Reviewer inbox/timeline 可见。 |
| Reviewer 回报 Coordinator | UI 触发 report，Coordinator timeline 可见。 |
| Agent 等待人类 | tile 显示 waiting/blocked 和具体问题。 |
| 人类回复 Agent | 回复进入 Agent inbox，Agent 可继续处理。 |
| Workspace timeline | 能复盘一次 Coordinator -> Worker -> Reviewer -> Human 流程。 |
| Browser smoke | 使用 `/Users/sking/codeSurf` 的本地 Playwright 安装。 |

## 相关 Contex 能力

- `agent_register`
- `agent_update_state`
- `agent_list`
- `agent_send_message`
- `agent_read_messages`
- `agent_claim_task`
- `agent_complete_task`
- `agent_request_handoff`
- `agent_report`
- `agent_broadcast`
- `agent_request_human_input`
- `get_agent_timeline`
- `get_workspace_timeline`

## 下一步建议

Phase A-E 已完成。下一步建议做一轮 Contex 联机实测：验证 semantic links、
Agent actions、human handoff、workspace timeline 在真实多 Agent 会话里端到端一致。
