# 蓝图运行时 · 开发指导（DEVELOPMENT_GUIDE）

> 本文是「蓝图运行时」的**工程规范与开发顺序**手册，与架构文档配套：
> 架构「做什么、怎么分层」见 [`architecture/00-overview.md`](./architecture/00-overview.md)、`10-backend-foundation.md`、`20-frontend-foundation.md`；
> 本文管「怎么写、按什么顺序写、怎么评审」。
> **所有源码贡献必须遵守本文。违反硬约束的 PR 一律驳回。**

---

## 1. 适用范围

适用于 `blueprint-runtime/` 下**全部源码**（前端 `editor/`、后端 `runtime/`、共享 `core/`）。
文档（`docs/`）不受 LOC 硬约束，但鼓励同样的「分文件、单一职责」习惯。

---

## 2. 总体原则

1. **先地基后功能**：地基（core + 前后端 L0–Lx 骨架）未稳定前，不写任何具体节点的业务功能。
2. **分层**：依赖永远朝下，层级以架构文档为准（见 §7）。
3. **分模块 · 单一职责**：一个文件只干一件事；宁可多文件，不要大文件。
4. **可扩展**：新增能力优先通过「加文件/加契约/加注册项」实现，而非改核心。
5. **同构 core**：任何「节点/端口/边/类型」的判断只走共享 `core/`，前后端不得各写一份。
6. **依赖审慎**：技术栈为 TypeScript + Vite（前端 React + xyflow）。可使用成熟依赖，但每个依赖须显式登记 + 写理由（白名单），挡的是意外/未审依赖，不是一切依赖。`core/` 仍保持平台中立（不碰 `node:*`/浏览器 API）。

---

## 3. 硬性编码约束

> 这些是**红线**，CI/评审据此机械判定。

| 约束 | 阈值 | 说明 |
| --- | --- | --- |
| 单文件行数 | **≤ 500 行** | 含注释与空行。逼近 400 行就考虑拆分 |
| 单函数行数 | **≤ 100 行** | 含注释。超了必须拆子函数 |
| 函数参数 | ≤ 5 个 | 更多请用一个选项对象 |
| 嵌套深度 | ≤ 4 层 | 超了用早返回 / 抽函数 |
| 新增依赖 | **须登记+理由** | 白名单制；`core/` 不碰 `node:*`/浏览器 API |
| 圈复杂度 | ≤ 15 | 由 ESLint `complexity` 机械判定；过高拆分支表/策略表 |

> **阈值唯一权威在 [`30-guardrails`](./architecture/30-guardrails.md) §G2**；本表为速查镜像，数字若冲突一律以 30 为准（不在两处各自维护）。

**超限怎么拆**

- 文件超 500：按「子职责」拆。例：`message-bus.mjs` 太大 → 拆出 `bus-routing.mjs` + `bus-validate.mjs`。
- 函数超 100：抽出命名良好的私有子函数，主函数只剩编排。
- 不允许用「一个超长 switch」绕过——改成注册表/策略表（见架构文档的 registry 模式）。

---

## 4. 注释规范（教程级）

要求**教程级**：读者第一次看也能懂「这是什么、为什么这样、怎么用」。

### 4.1 文件头注释（每个源文件必须有）

```js
/**
 * ─────────────────────────────────────────────────────────────
 * 模块：message-bus（L4 Engine · 类型化消息总线）
 * 职责：按 Edge 把载荷从某 out 端口路由到相连的 in 端口。
 *
 * 在分层中的位置：
 *   L4 Engine ──► 本模块 ──► core/validate（投递前类型校验）
 *                        └─► persist/event-log（产出投递/拒绝事件）
 *
 * 设计要点：
 *   - 投递前调 core/validate，与前端编辑期用同一函数（见 00-overview §7）。
 *   - 校验失败不抛错，产出 message.rejected 事件，保证可观测。
 *
 * 不负责：状态机推进（node-machine）、边策略（edge-policy）。
 * ─────────────────────────────────────────────────────────────
 */
```

### 4.2 函数注释

```ts
/**
 * 把一条载荷沿一条边投递到目标端口。
 * （TS 下类型由签名表达，JSDoc 只写「为什么/做什么」，不重复类型）
 *
 * @param edge    目标边（含 source/target 端口引用，见 00 §5.4）
 * @param payload 实际载荷；其类型须与 edge.payloadType 相容
 * @returns ok(投递事件) | fail(类型不匹配原因)
 *
 * 流程：
 *   1) core/validate 校验 payload 类型 ↔ 目标端口类型
 *   2) 不相容 → 产出 message.rejected，返回 fail
 *   3) 相容   → edge-policy 处理 → 投递 → 产出 message.delivered（事件名见 00 §5.6）
 */
function route(edge: Edge, payload: unknown): Result { ... }
```

### 4.3 关键算法行内注释 + ASCII 图

复杂处用行内注释解释「为什么」，并在文件头或函数上方用 ASCII 图讲清数据流/结构（参照架构文档里的图）。**「是什么」靠代码，「为什么」靠注释。**

### 4.4 正反范例

```js
// ✅ 好：解释为什么
// 投影必须是纯函数：同一事件序列重放须得到同一状态，否则快照/重建会发散。
function project(ev, state) { ... }

// ❌ 差：复述代码、无信息量
// 把 ev 应用到 state 然后返回 state
function project(ev, state) { ... }
```

---

## 5. 目录与命名规范

```text
blueprint-runtime/            （pnpm workspaces monorepo · 三包 @blueprint/{core,runtime,editor} + tools，见 30 §7）
  core/        共享 TS 包（types/ graph/ contracts/ state/ validate.ts）
  runtime/     后端 TS（kernel/ persist/ engine/ mcp/ cross/）
  editor/      前端 React+Vite（src/{app,graph,state,nodes,inspector,sync,workspace,lib}）
  tools/       护栏与脚本（见 30-guardrails）
  docs/        架构/愿景/本指导
```

- 逻辑/工具文件名：`kebab-case.ts`；React 组件文件 `PascalCase.tsx`。一个文件一个主导出概念。
- 测试镜像源码路径放各包的 `test/`（或 `*.test.ts` 同目录），框架 Vitest。
- 导出：优先具名导出；工厂函数用 `createXxx()`。
- 目录即层：跨层引用必须符合 §7 方向。

---

## 6. 错误处理与返回约定

- 内核提供错误类型（`RuntimeError` / 前端对应类）+ 稳定 `code`。
- 可预期失败用 `Result`（`ok()/fail()`，见 `kernel/result`）显式返回，不靠抛异常控流。
- 真正的异常（编程错误）才 `throw`。
- 错误信息面向人类可读，且能回指节点/端口/边（携带 id）。

---

## 7. 模块依赖规则（评审红线，与 00 §6 一致）

1. **依赖朝下**，禁止反向/跨层向上。
2. **`core/` 纯净**：不 import `node:*`、不碰浏览器 API、不依赖上层。
3. **前后端不直连**：`editor/` ✗ import `runtime/`，反之亦然；唯一通道 MCP 协议。
4. **横切单向**：`logger/auth/audit` 可被调用，不反向依赖业务。
5. **DAG 无环**。
6. **类型判定唯一出口**：只问 `core/validate`。

**自检**：提交前确认本文件的 import 全部指向更低层或 `core/`；新增跨层引用必须在 PR 说明理由。

---

## 8. 测试要求

- 框架：**Vitest**（前后端统一；前端配 React Testing Library，后端用 node 环境）。
- **每个源模块**配同名测试（`x.test.ts`，见 30-guardrails G6 测试镜像守卫）。
- `core/` 测试**同构**：前后端共享同一套 `core/` 夹具与用例。
- 纯函数（投影、校验、状态机、命令、连接校验）必须 100% 分支覆盖意图。
- 集成层（persist/sqlite、mcp 往返）用内存库/本地 server 跑端到端冒烟。
- 前端端到端冒烟用 **Playwright**：覆盖「连线类型校验」「SSE 高亮」等关键流。
- **回归基线**：每阶段结束跑 `pnpm test`（Vitest 全包）+ `pnpm check`（护栏）+ 一条端到端冒烟，全绿才算完成。

---

## 9. Git 与提交规范

- 在功能分支工作（当前 `codex/blueprint-runtime-design`）。
- 提交信息：首行简明（中文可），范围前缀如 `core:` / `runtime:` / `editor:` / `docs:`。
- 一个提交对应一个内聚改动；地基阶段按「阶段」提交（见 §10）。
- 未经要求不 push、不合主干。

---

## 10. 开发阶段顺序（先地基后功能 · DAG 非直线）

地基不是一条直线，而是一张**依赖图（DAG）**：护栏先行，`core/` 居中，之后 **runtime 支与 editor 支并行**，最后汇到集成。**沿依赖推进，每阶段验收全绿才解锁其下游**；无依赖关系的两支可由不同人/agent 并行。

```text
F-guard ─► F0(core) ─►【契约冻结点】─┬─► F1 ─► F2 ─► F3   (runtime 支)
                                     └─► F4 ─► F5 ─► F6   (editor 支，对 mock 编码)
                                                  └────────┬───────┘
                                                       ►【Fx 集成】
```

> **关键**：editor 支只依赖 **F0 + 契约冻结点**，**不**依赖 runtime（前后端不直连，00 §6）——故 F1–F3 与 F4–F6 可并行，不必前端干等后端。

**【契约冻结点】**（F0 之后、两支分叉前必过；之后改动走停-问）——把跨 MCP 线、两支都要照着编码的契约一次性冻结：

- 事件词表 + 共享码表（00 §5.6/§5.7）；
- MCP 协议封套：JSON-RPC 请求/响应/错误形状、资源 URI 方案 `context://…`、SSE 事件流（10 L5）；
- 前端 `RuntimeAdapter` 接口（20 §4）+ 共享黄金夹具（testing/00 §3）；
- 一份**共享契约测试**两支都跑，证明前后端不漂。
> 此处只冻**协议封套**；具体业务工具（`agent_*`/`task_*`…）属功能阶段（BP）。集成前 editor 支一律对 **mock adapter** 编码。

### 地基阶段

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **F-guard** | monorepo 脚手架 + 护栏（ESLint 边界/体积/注释 + 契约自校验 + 测试镜像 + Vitest）（见 30-guardrails） | 空骨架 `pnpm check`/`pnpm test` 全绿；故意违规夹具被逐项拦下 |
| **F0 · core** | `core/` 全部模块：types/graph/contracts/state/validate/events（00 §4/§5） | 同构单测全绿；`canConnect`/`validateGraph` 覆盖正反例；**过契约冻结点** |
| **F1 · runtime L0+L3** | 内核 + 事件溯源持久化（event-log/sqlite-adapter/projections/snapshot） | 事件重放与快照重建一致性测通过 |
| **F2 · runtime L4** | 引擎：node-machine/message-bus/edge-policy/scheduler | 喂事件序列断言状态机/总线/运行期校验 |
| **F3 · runtime L5+横切** | MCP 传输/中间件链/tools 注册表/resources/sse + audit/auth/logger | 本地 server JSON-RPC 往返 + **后端内**端到端冒烟（工具→事件→投影→SSE） |
| **F4 · editor State+Graph** | Vite/React 脚手架 + Zustand graph-store/命令(zundo) + xyflow 集成 + core↔xyflow 映射 | store/命令撤销单测；画布渲染节点/边 |
| **F5 · editor 连接+Sync** | 连接校验（isValidConnection→core/validate）+ sync 适配器（对**冻结契约**+mock 编码） | 连线类型校验（含拒绝+原因）；mock adapter 同步流 |
| **F6 · editor NodeUI+装配** | 节点组件注册表 + 契约驱动检视器 + app 装配 + 工作区加载/保存 | 契约驱动检视器渲染；**editor 支自身**端到端（对 mock）：建节点→连线→镜像/SSE 走通 |
| **Fx · 集成** | 接通**真** runtime ↔ editor：mirror→后端、SSE→前端，跑通全栈 | 跨栈端到端冒烟：建节点→连线(类型校验)→镜像到后端→后端产事件→SSE→前端高亮，全绿 |

> F-guard → F0 →（F1–F3 ∥ F4–F6）→ Fx 完成即「地基就绪」：一个空白但**类型安全、可执行、可观测、可扩展**的图运行时 + 编辑器骨架。

### 功能阶段（地基之上，后续单独设计）

对应愿景路线图 BP-1..BP-7：逐个节点家族（Agent/Human/Task/Context/Observation/Integration）按契约长出来，再到工作流资产、可视化调试、Polly 集成。**每个功能 = 一份契约（core）+ 一组 handler（runtime）+ 一个 nodeui 目录（editor）**，不改地基。

---

## 11. 评审清单（每个 PR 必过）

- [ ] 单文件 ≤500 行、单函数 ≤100 行？
- [ ] 文件头 + 关键函数有教程级注释？复杂处有 ASCII 图/「为什么」注释？
- [ ] import 仅指向更低层 / `core/`？无跨层向上、无前后端直连？
- [ ] 类型/连接判断走 `core/validate`，没另写一份？
- [ ] 新增依赖已登记+理由？`core/` 没碰 `node:*`/浏览器 API？
- [ ] 配套测试齐全且全绿？回归基线（`pnpm test` + `pnpm check` + 冒烟）通过？
- [ ] 属于当前阶段（先地基后功能），没越界写功能？

> 本指导与架构文档（00/10/20/30）共同构成不可动摇基线。基线变更须先改文档、经评审，再改代码。
</content>