# Blueprint Runtime — 工作入口

> 你正在 `blueprint-runtime/`（CodeSurf + Contex 的**全栈重写**）下工作：一套**先地基后功能**的蓝图式图运行时。
> 动手前**必须**按下序读文档、并遵守执行协议。本文件只**路由**，规则细节在被指向的文档里，**勿在此复述或另立**。

## 开工前必读（按序）

1. `PROGRESS.md` — 当前阶段、决策基线、待办（开工先读，收工更新）
2. `docs/architecture/00-overview.md` — 共享 `core` 模型 · 规范数据结构（§5）· 依赖红线（§6）【母版】
3. `docs/execution/00-protocol.md` — 作业协议：六步循环 · 停-问 · 完工闸门 · 决策权清单
4. `docs/testing/00-fixtures-and-manifests.md` — 验收：测试清单 + 黄金夹具
5. 按你要动的层再读：`architecture/10`(后端)/`20`(前端)/`30`(护栏) + 同号 `execution/` + `testing/`

## 铁律（细节见上述文档）

- **先地基后功能**：F-guard → F0–F6 未稳定前，不写任何节点业务功能。
- **六步循环**：选任务(按建造序)→ 读规范 → 先写测试(按 manifest)→ 实现到绿 → 跑 check(护栏)→ 收口提交。
- **停-问**：规范沉默/有歧义，或要动**任何契约面**（事件/码/端口/lane/接缝/依赖/阈值/目录/阶段）→ 停下来问，**绝不臆造**。
- **类型判定唯一出口**：能否连接/类型对不对，只问 `core/validate`。
- **前后端不直连**：`editor/` ✗ import `runtime/`，唯一通道是 MCP。

## 现状（重要）

**🏗️ 地基全部完成**（F-guard→F0→F1/F2/F3 ∥ F4/F5/F6→Fx，**131 测试**，2026-06-30）。空白但类型安全·可执行·可观测·可扩展的图运行时 + 编辑器骨架就绪。**BP-1/BP-2 + 全六家族（9 节点类型）**（175 单测 + 11 E2E）：`core/contracts/families/` 九契约——execution(Agent/Terminal)·human·task·context(Document/Memory)·observation(Browser/Git/Status)·integration(Polly)，六泳道全有类型。editor：节点面板(BUILTIN_CONTRACTS 驱动,新家族自动接入)·契约驱动检视器·**画布拖端口连线类型校验**(planConnection=core/validate,兼容建 typed 边/不兼容弹拒绝横幅)·节点可拖动(onNodesChange 回写)。BP-2 已收尾：runtime 图工具(create_node/create_edge/deliver) + editor http-adapter(真后端 mirror+SSE) + 边动画反馈，`integration/bp2-deliver` 全链路验收。BP-3 已完成：InspectorPanel 升级为选中实例活面板(实时状态+动作按钮推进+lane 着色端口)。下一步 BP-4(运行时事件映射+调试高亮,可含 editor+runtime 浏览器联跑)、BP-5(工作流模板)、或 Cache/Memo 家族。
- `pnpm types` 现含 5 个 tsconfig（+ 顶层 `integration/`，跨前后端的合龙测试落此，避开 R3 边界）。
- 功能阶段铁律：每功能 = 一份契约(core)+一组 handler(runtime)+一个 nodes 目录(editor)，**不改地基**；新增载荷类型/事件/码仍是契约面，须停-问。
- **用户面铁律（用户定 2026-06-30）**：凡改动影响用户使用，**必须配 Playwright E2E**，验四问——可见/易见/可操作/有反馈。E2E 放 `editor/e2e/*.spec.ts`（`pnpm test:e2e`，真浏览器，vitest 不收 `.spec`）；webServer 用 `127.0.0.1`（避 Windows localhost IPv6 错配）。
- 前端依赖已装（react/vite/xyflow/zustand/zundo + rtl/jsdom）；`.tsx` 组件测试用 `// @vitest-environment jsdom` 文件头。
- 本机 **Node 24.18**（nvm，符合基线）。pnpm 命令需前置 `C:\nvm\nodejs` 到 PATH（旧会话 shell 的 PATH 是陈的）。
- 命令：`pnpm check`（lint+test+镜像）/ `pnpm test` / `pnpm types`。新增依赖登记 `DEPENDENCIES.md`。
- 并行支都 import `@blueprint/core` + 照冻结夹具（golden-graph / protocol-samples）编码；editor 支对 mock，真集成在 Fx。
