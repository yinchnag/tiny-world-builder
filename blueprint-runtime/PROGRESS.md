# Blueprint Runtime · 进度

> 全栈重写 CodeSurf + Contex 为 Blueprint 式图运行时。**先地基后功能。**
> 每个阶段验收全绿再进下一阶段（验收标准见 `docs/DEVELOPMENT_GUIDE.md` §10）。
> 工作方式：开工先读本文 + `docs/architecture/00-overview.md` + `docs/execution/00-protocol.md` + `docs/testing/00-fixtures-and-manifests.md`，按执行协议六步循环干活，收工更新本文。

## 当前状态（2026-06-30）

**🏗️ 地基全部完成 + 功能阶段 BP-1 进行中**（**144 单测 + 1 Playwright E2E 全绿**）。地基(F-guard→F0→F1/F2/F3∥F4/F5/F6→Fx)之上,BP-1 已落 **Agent(execution) + Human Gate(human)** 两份契约 + **节点面板**(用户可建节点)+ 选中→检视器反馈;**Playwright 真浏览器 E2E** 已就位(`pnpm test:e2e`)。**下一步 BP-1 续作**(Terminal/Context/Task 家族,各配 E2E)或 **BP-2**(类型化连线)。
> 规则(用户定 2026-06-30)：**凡改动影响用户使用,必须配 Playwright E2E**,验四问——可见/易见/可操作/有反馈。E2E 在 `editor/e2e/*.spec.ts`(真浏览器,vitest 不收);webServer 用 `127.0.0.1`(避 Windows localhost IPv6 错配)。
> 工具链全就位：`pnpm check`(lint+test+镜像) + `pnpm types`(5 个 tsconfig：core/runtime/editor/tools/integration) 全绿。
> 本机 **Node 24.18**（nvm，符合基线）。`node:sqlite` 在 Node 24 + vitest 直接可用（无需 flag）。前端 jsdom 组件测试（`// @vitest-environment jsdom`）就绪。

## 决策记录（不可动摇基线）

- 全栈重写（含 Contex），非增量改造。
- 技术栈：共享 `core/`(TS) · 后端 `runtime/`(TS, Node) · 前端 `editor/`(React + Vite + xyflow + TS + Zustand) · 测试 Vitest · 护栏 ESLint · monorepo。
- 前后端共享一份 `core/`：节点契约/端口类型/边校验只写一遍，编辑期(xyflow `isValidConnection`)与运行期(message-bus)各调同一个 `core/validate`。
- 依赖白名单制（登记+理由），非绝对零依赖；早期「零构建 vanilla」已被推翻。
- 硬约束：单文件 ≤500 行、单函数 ≤100 行、教程级注释、ASCII 架构图；由 ESLint + 契约自校验机械执行。

## 设计文档（已成稿）

- [x] `docs/architecture/00-overview.md`（母版：分层 · 共享 core · 规范数据结构 · 依赖红线）
- [x] `docs/architecture/10-backend-foundation.md`（后端：事件溯源 · 状态机 · 总线 · MCP 中间件链）
- [x] `docs/architecture/20-frontend-foundation.md`（前端：React + xyflow · 连接校验 · 节点 UI 注册表）
- [x] `docs/architecture/30-guardrails.md`（护栏：ESLint 边界/体积 · 契约自校验 · 测试镜像）
- [x] `docs/DEVELOPMENT_GUIDE.md`（硬约束 · 注释规范 · 阶段顺序）
- [x] `docs/execution/{00,10,20}`（执行协议：全局 + 后端 + 前端，含 §6.1 阶段交接播报）
- [x] `docs/testing/{00,10,20}`（测试清单 + 黄金夹具：全局 + 后端 + 前端）
- [x] 愿景文档收敛进 `docs/vision/`

## 地基建造（依赖图 DAG，非直线 —— 详见 GUIDE §10）

```text
F-guard ─► F0(core) ─►【契约冻结点】─┬─► F1 ─► F2 ─► F3  (runtime 支)
                                     └─► F4 ─► F5 ─► F6  (editor 支，对 mock)
                                                  └───────┬──────┘ ►【Fx 集成】
```
> editor 支只卡 F0 + 契约冻结点，**可与 runtime 支并行**（前后端不直连）。

- [x] **F-guard** ✅ — pnpm monorepo（core/runtime/editor/tools）+ 护栏：ESLint flat config（G1 boundaries+前后端禁连+无环 / G2 体积复杂度 / G5 jsdoc）、`tools/guard`（G6 测试镜像 + check 总入口）、G4 `core/contracts` 元校验（C1–C7 抛 `contract.invalid`）。验收全过：`pnpm check`/`pnpm test`/`tsc --noEmit` 全绿（16 测试）；5 类违规夹具被逐项拦下（600 行 / 137 行函数 / 裸导出无 JSDoc / core 引 node:* / 跨前后端 import）；坏契约 register 即抛。
- [x] **F0 · core/** ✅ — types(payload-types+Zod schema/events §5.6-5.7/compatibility) · graph(port/node/edge/graph) · state/machine · contracts/registry(C1–C7) · validate(canConnect 覆盖 §5.7 全部连接码/validatePayload §5.9/validateGraph required.unmet)。验收：同构单测全绿(50)；canConnect/validateGraph 正反例齐。决策：**运行期允许环**(B)。golden-graph/protocol-samples 夹具留契约冻结点落地。
- [x] **【契约冻结点】** ✅ — 跨 MCP 线契约冻结：事件词表+码表(00 §5.6/5.7)、**MCP 协议封套**落地 `core/test/fixtures/protocol-samples.ts`(00 §5.8)、`RuntimeAdapter`(20 §4)、**golden-graph + protocol-samples** 夹具(testing/00 §3/§3.1)。验收：夹具自洽全绿；两支「接受/产出」断言留 F3/F5(transport·mcp-client)落地。
- **runtime 支**（可与 editor 支并行）：
  - [x] **F1 · 内核+持久化** ✅ — L0 kernel(ids/result/errors/clock/ctx) + L3 persist(sqlite-adapter/event-log append-scan-head/projections framework+nodes/snapshot)。验收：重放与快照重建一致(冒烟绿)；node:sqlite Node24 可用。
  - [x] **F2 · 引擎** ✅ — node-machine(状态机推进+产事件) / message-bus(运行期类型防线,调 core/validate.canConnect+validatePayload,4 个拒绝码) / edge-policy(directed 反向拒+钩子) / scheduler(FIFO)。验收：F2 冒烟「A 产出→经边→B」message.delivered+状态推进 ✓。
  - [x] **F3 · 协议+横切** ✅ — L5: transport(HTTP+JSON-RPC dispatch+SSE,flushHeaders) / middleware(compose 链) / tools/registry / resources(context:// 读投影) / sse(hub+重放) + 横切 auth/logger/audit。验收：F3 冒烟 本地 server JSON-RPC 往返 + SSE 推送 ✓；transport 接受 protocol-samples REQ_CALL ✓。
- **editor 支**（可与 runtime 支并行，对 mock 编码）：
  - [x] **F4 · 状态+画布** ✅ — Vite/React 脚手架 + L-State(graph-store zustand/commands zundo 撤销/selection/ui) + L-Graph(adapters core↔xyflow / FlowCanvas) + L-App(App/providers/main)。验收：store/命令撤销单测 ✓；FlowCanvas jsdom 渲染画布+节点 ✓。
  - [x] **F5 · 连接+同步** ✅ — connection/validate-connection(checkConnection→core/validate.canConnect,与运行期同一函数) · edges/lane-color+TypedEdge · sync(runtime-adapter no-op/mock · mcp-client REQ_CALL · sse 事件→store · mirror 本地→后端)。验收：连线类型校验含拒绝码 ✓；mock adapter 同步流 ✓。
  - [x] **F6 · 节点UI+装配** ✅ — nodes/registry(type→组件) + GenericNode(契约摆 Handle) + inspector/InspectorPanel(契约驱动) + workspace(use-workspace/autosave) + app/App 装配(注入 nodeTypes/edgeTypes)。验收：契约驱动检视器渲染 ✓；editor 自身端到端 f6-smoke(建节点→连线校验→镜像→SSE，对 mock)✓。
- [x] **Fx · 集成** ✅ — 顶层 `integration/fx-smoke`：真 runtime transport ⇔ 真 editor mcp-client（HTTP JSON-RPC 往返）+ runtime SSE 帧 → editor applyEvent → graph-store。位置在顶层 `integration/`（非 editor/runtime 元素，R3 与 boundaries 不覆盖，集成层允许同握两侧）。验收：跨栈端到端线上一致 ✓（131 测试）。**🏗️ 地基就绪。**

> F-guard → F0 →（F1–F3 ∥ F4–F6）→ Fx 完成 = 地基就绪：空白但类型安全、可执行、可观测、可扩展的图运行时 + 编辑器骨架。

## 功能阶段（地基之上，后续单独设计）

对应愿景路线图 BP-1..BP-7（见 `docs/vision/`）：逐个节点家族（Agent/Human/Task/Context/Observation/Integration）→ 工作流资产 → 可视化调试 → Polly 集成。
**每个功能 = 一份契约(core) + 一组 handler(runtime) + 一个 nodes 目录(editor)**，不改地基。

- [~] BP-1 节点契约落地（各家族）— ✅ **Agent**(execution:message/task/context/human_reply 入,message/report/handoff/human_attention/task_update 出) + **Human Gate**(human:question 入,reply/approval 出);新增 `HandoffRequest`(task 泳道)载荷类型;`registerBuiltinContracts()` 统一注册入口。验收:C1–C7 元校验 ✓、跨家族「人在回路」闭合(attention→question→reply→human_reply)✓、引擎用 Agent 契约推进状态机 ✓。⏳ 余 Terminal/Document/Memory/Task 等家族。**editor 用户面**：NodePalette(BUILTIN_CONTRACTS 驱动,点击建节点)+ FlowCanvas 选中接线(点节点→selection→检视器),Playwright E2E `bp1-palette.spec` 真浏览器验收 ✓。
- [ ] BP-2 类型化连线全流程
- [ ] BP-3 端口 UI / 检视器完善
- [ ] BP-4 运行时事件映射 + 调试高亮
- [ ] BP-5 工作流模板资产
- [ ] BP-6 可视化调试 / 回放
- [ ] BP-7 Polly 集成节点

## 备注

- 早期散落在 `CodeSurf/`、`Contex/` 下的 14 份重复蓝图文档已删除；本目录 `blueprint-runtime/` 是唯一权威。
- 2026-06-29 边界检查：跨 MCP/SSE 线的**共享词表**归位 00 §5.6（事件类型）/§5.7（拒绝+契约码），常量落 `core/events.ts`；后端**私有接缝接口**+阶段内建造顺序+每模块完工定义补入 10 §10/§11；前端 `RuntimeAdapter` 接缝补入 20 §4；阈值改以 30 §G2 为唯一权威（GUIDE §3 降级为镜像）；vision/ 各篇加「形状以 00 §5 为准」横幅。
- 2026-06-29 入口接线 + F-guard 设定基线：新增 `blueprint-runtime/CLAUDE.md`（agent 工作入口，先读 execution/00 + testing/00）；F-guard 四项设定定稿落 30 §7——**pnpm** workspaces · **Node 24 LTS** · 三包 `@blueprint/{core,runtime,editor}` + tools · **ESM**(tsx + vitest + tsc)。文档内 `npm run` 命令统一改 `pnpm`。
- 2026-06-29 分期改 DAG：阶段从线性改为依赖图——F0 后 runtime 支(F1–F3) ∥ editor 支(F4–F6) 可并行；新增**【契约冻结点】**(F0 后冻结跨 MCP 线契约，解锁 editor 支并行)与**【Fx 集成阶段】**(全栈端到端)；execution/00 增 **§6.1 阶段交接播报**(完成阶段主动告知下一步内容与方向)。详见 GUIDE §10。
- 2026-06-29 契约冻结点写实 + F-guard 决策：新增 **00 §5.8 MCP 协议封套**(JSON-RPC 信封/`context://`/SSE 帧/镜像方向) + **testing/00 §3.1 protocol-samples** 协议样本夹具与两支契约测试；30 §9 四个 F-guard 开放问题拍板(覆盖率分层门槛 / G5 只查存在 / 依赖登记 `DEPENDENCIES.md` / 不强加 pre-commit)。
- 2026-06-30 决策：载荷 schema 用 **Zod**（00 §5.9）——字段级结构校验，两道边界（模型侧 strict tool use 生成 + 应用侧 `parse` 挡）；与 `core/validate`（图结构）互补；新增 §5.7 码 `payload.schema_invalid`；Zod 平台中立可入 `core/`，F0 落地 + 登记 `DEPENDENCIES.md`。
- 愿景文档（`docs/vision/`）部分实现建议（如「static JS metadata」「零依赖」）早于技术栈决定，已被 `docs/architecture/` 取代——以架构文档为准。
</content>
