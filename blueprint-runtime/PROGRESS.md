# Blueprint Runtime · 进度

> 全栈重写 CodeSurf + Contex 为 Blueprint 式图运行时。**先地基后功能。**
> 每个阶段验收全绿再进下一阶段（验收标准见 `docs/DEVELOPMENT_GUIDE.md` §10）。
> 工作方式：开工先读本文 + `docs/architecture/00-overview.md` + `docs/execution/00-protocol.md` + `docs/testing/00-fixtures-and-manifests.md`，按执行协议六步循环干活，收工更新本文。

## 当前状态（2026-06-29）

**设计阶段完成、评审中；代码未开始。** 下一步：F-guard。

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

- [ ] **F-guard** — monorepo 脚手架 + 护栏（ESLint + 契约自校验 + Vitest）。验收：空骨架 `pnpm check`/`pnpm test` 全绿；故意违规夹具被逐项拦下。
- [ ] **F0 · core/** — types/graph/contracts/state/validate/events。验收：同构单测全绿；`canConnect`/`validateGraph` 覆盖正反例。
- [ ] **【契约冻结点】** — 冻结跨 MCP 线契约：事件词表+码表(00 §5.6/5.7)、**MCP 协议封套(00 §5.8)**、`RuntimeAdapter`(20 §4)、黄金夹具+protocol-samples(testing/00 §3/§3.1)。验收：两支对 protocol-samples 契约测试都绿。
- **runtime 支**（可与 editor 支并行）：
  - [ ] **F1 · 内核+持久化** — kernel + 事件溯源（event-log/sqlite/projections/snapshot）。验收：重放与快照重建一致。
  - [ ] **F2 · 引擎** — node-machine/message-bus/edge-policy/scheduler。验收：事件序列断言状态机/总线/运行期校验。
  - [ ] **F3 · 协议+横切** — MCP 传输/中间件链/tools/resources/sse + audit/auth/logger。验收：JSON-RPC 往返 + 后端内端到端冒烟。
- **editor 支**（可与 runtime 支并行，对 mock 编码）：
  - [ ] **F4 · 状态+画布** — Vite/React + Zustand graph-store/命令(zundo) + xyflow 集成 + core↔xyflow 映射。验收：store/命令撤销单测；画布渲染节点/边。
  - [ ] **F5 · 连接+同步** — isValidConnection→core/validate + sync 适配器(对冻结契约+mock)。验收：连线类型校验(含拒绝+原因)；mock adapter 同步流。
  - [ ] **F6 · 节点UI+装配** — 节点组件注册表 + 契约驱动检视器 + app 装配 + 工作区加载/保存。验收：检视器渲染；editor 自身端到端(对 mock)走通。
- [ ] **Fx · 集成** — 接通真 runtime↔editor。验收：跨栈端到端 建节点→连线→镜像→后端事件→SSE→前端高亮，全绿。

> F-guard → F0 →（F1–F3 ∥ F4–F6）→ Fx 完成 = 地基就绪：空白但类型安全、可执行、可观测、可扩展的图运行时 + 编辑器骨架。

## 功能阶段（地基之上，后续单独设计）

对应愿景路线图 BP-1..BP-7（见 `docs/vision/`）：逐个节点家族（Agent/Human/Task/Context/Observation/Integration）→ 工作流资产 → 可视化调试 → Polly 集成。
**每个功能 = 一份契约(core) + 一组 handler(runtime) + 一个 nodes 目录(editor)**，不改地基。

- [ ] BP-1 节点契约落地（各家族）
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
