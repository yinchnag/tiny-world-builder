# 后端「图运行时」底层设计（10-backend-foundation）

> 本文承接 [`00-overview.md`](./00-overview.md)，把后端 `runtime/` 的 L0–L5 + 横切层
> **逐模块**落到文件清单、职责、LOC 预算、接口与数据流。
> 所有数据结构以 00 的 §5 为唯一真相，本文不另立字段。图模型/类型系统直接复用 `core/`，本文不重述。
>
> **技术栈说明**：后端为 **TypeScript（Node）**，可使用成熟依赖（白名单制，见 GUIDE §2）；持久化用 Node 原生 `node:sqlite`；测试框架 Vitest。下文新建文件后缀均为 `.ts`；§8 映射表里的 `db.mjs/store.mjs/index.mjs/tools.mjs/...` 指**现状 Contex 文件**，保留 `.mjs`。

---

## 1. 后端职责与边界

`runtime/` 是「图运行时」，拥有**运行期真相**：

| 拥有 | 不拥有 |
| --- | --- |
| 节点身份与状态机推进 | 节点的视觉布局（x/y/w/h，归前端） |
| 类型化消息总线与边路由 | 节点的业务推理逻辑（归功能阶段） |
| 边策略（retry/cancel/gate 骨架） | UI 渲染 |
| 事件溯源主存 + 状态投影 | —— |
| 审计 / 时间线 | —— |
| MCP 传输 + 工具中间件链 | —— |
| 向前端下发命令、推送 SSE | —— |

边界铁律（来自 00 §6）：`runtime/` **不** import `editor/`；与前端唯一通道是 MCP 协议。

---

## 2. 后端分层全景

```text
┌──────────────────────────────── runtime/ ────────────────────────────────┐
│ L5 Protocol   mcp/transport · mcp/tools(中间件链) · mcp/resources · sse    │
│                         │ 调用                                             │
│ L4 Engine     scheduler · node-machine · message-bus · edge-policy        │
│                         │ 读/写状态、追加事件                              │
│ L3 Persist    event-log(主存·追加) · projections(投影) · sqlite-adapter   │
│                         │ 复用                                             │
│ ── 复用 core/ ── 图模型 graph/* · 类型系统 types/* · 校验 validate ──      │
│                         │ 依赖                                             │
│ L0 Kernel     ids · errors · clock · result · ctx(上下文传播)             │
│ 横切          audit/timeline(=event-log 视图) · auth · logger             │
└───────────────────────────────────────────────────────────────────────────┘
```

依赖朝下：L5→L4→L3→core/→L0。横切层可被各层调用，自身不反向依赖业务模块。

---

## 3. 逐层逐模块

### L0 Kernel（内核原语）

最底层，零业务。替换现状 Contex 里「手工穿 `correlation_id`」的脆弱做法。

| 文件 | 职责（单一） | 关键导出 | LOC |
| --- | --- | --- | --- |
| `runtime/kernel/ids.ts` | 生成节点/边/事件 id | `nodeId()`, `edgeId()`, `eventId()` | ≤60 |
| `runtime/kernel/errors.ts` | 运行时错误类型 + 稳定 code | `RuntimeError`, `ERR.*` | ≤120 |
| `runtime/kernel/clock.ts` | 可注入时钟（测试可控） | `createClock()`, `nowIso()` | ≤60 |
| `runtime/kernel/result.ts` | 统一返回包装 `{ok,value}`/`{ok:false,error}` | `ok()`, `fail()`, `isOk()` | ≤80 |
| `runtime/kernel/ctx.ts` | 调用上下文传播（correlation_id/actor/workspace），替代手工穿参 | `withCtx()`, `currentCtx()` | ≤120 |

> `ctx.ts` 用一个浅栈/闭包在一次 tool 调用内隐式携带 correlation_id，避免每个 domain 函数显式收 `opts`。

### L3 Persist（事件溯源持久化）

**最关键的重构**：审计日志从「副作用表」升为**主存**。当前状态不是直接存的，而是由事件**投影**得出。

```text
                 写路径                          读路径
  L4 Engine ──append(RuntimeEvent)──► event-log ──scan──► projections ──► 当前状态视图
                                          │                   │
                                    sqlite-adapter      (节点状态/任务/消息/认领)
```

| 文件 | 职责 | 关键导出 | LOC |
| --- | --- | --- | --- |
| `runtime/persist/event-log.ts` | 追加 + 顺序读取不可变事件（自增 seq） | `append(ev)`, `scan({sinceSeq,limit})`, `head()` | ≤200 |
| `runtime/persist/sqlite-adapter.ts` | 包裹 Node 原生 `node:sqlite`：连接、迁移、预编译语句 | `openDb()`, `migrate()`, `prepare()` | ≤220 |
| `runtime/persist/projections/index.ts` | 投影注册表 + 重放驱动 | `register()`, `rebuild()`, `apply(ev)` | ≤150 |
| `runtime/persist/projections/nodes.ts` | 由事件投影「节点当前状态」 | `project(ev,state)` | ≤180 |
| `runtime/persist/projections/tasks.ts` | 由事件投影「任务当前状态」 | `project(ev,state)` | ≤180 |
| `runtime/persist/projections/messages.ts` | 由事件投影「消息/收件箱」 | `project(ev,state)` | ≤180 |
| `runtime/persist/projections/claims.ts` | 由事件投影「文件认领」 | `project(ev,state)` | ≤150 |
| `runtime/persist/snapshot.ts` | 周期性快照，避免每次从 seq=0 重放 | `take()`, `restore()` | ≤180 |

**事件溯源要点**

- 事件即 00 §5.5 的 `RuntimeEvent`，**只追加、不修改**。
- 任意当前状态 = 「最近快照」+「快照之后的事件重放」。
- 投影是纯函数 `(event, prevState) => nextState`，可独立单测、可随时重建。
- `event-log` 表结构（在 `sqlite-adapter` 迁移中定义）：

```text
event_log( seq INTEGER PK AUTOINCREMENT, ts TEXT, actor_type TEXT, actor_id TEXT,
           event_type TEXT, node_id TEXT, port_id TEXT, edge_id TEXT,
           workflow_template_id TEXT, workflow_instance_id TEXT,
           payload_type TEXT, payload_json TEXT, correlation_id TEXT )
```

> 表里存完整 `payload_json`；00 §5.5 的 `payloadSummary` 是 `cross/audit` 时间线视图从 `payload_json` **派生**的摘要，不单独落表。

### L4 Engine（图执行引擎）

把图「跑起来」：推进状态机、按边路由载荷、执行边策略。

| 文件 | 职责 | 关键导出 | LOC |
| --- | --- | --- | --- |
| `runtime/engine/node-machine.ts` | 用 `core/state/machine` 推进节点状态，产出状态转移事件 | `transition(node,event)` | ≤180 |
| `runtime/engine/message-bus.ts` | 类型化总线：按 `Edge` 把载荷从 out 口路由到 in 口 | `publish(payload,fromPort)`, `route(edge,payload)` | ≤220 |
| `runtime/engine/edge-policy.ts` | 边策略骨架：directed 校验、retry/cancel/gate 钩子 | `applyPolicy(edge,payload)` | ≤160 |
| `runtime/engine/scheduler.ts` | 决定下一步推进哪个节点（地基阶段：简单就绪队列） | `enqueue()`, `tick()` | ≤200 |

**运行期类型防线**：`message-bus.route()` 在投递前调 `core/validate.canConnect`/载荷类型校验——与前端编辑期用的是**同一函数**（00 §2.2、§7）。校验失败 → 产出 `message.rejected` 事件，不投递。事件名取自 00 §5.6 词表，`reason` 取自 00 §5.7 码表，**本文不另造名**。

### L5 Protocol（MCP 协议与传输）

对外暴露能力。把现状 `tools.mjs` 的大 if/else 改成**中间件链**。

| 文件 | 职责 | 关键导出 | LOC |
| --- | --- | --- | --- |
| `runtime/mcp/transport.ts` | HTTP + JSON-RPC 2.0 + SSE 通道（POST 调用 / GET 订阅） | `createTransport()` | ≤260 |
| `runtime/mcp/middleware.ts` | 中间件组合器：auth → 幂等 → 上下文 → handler | `compose()`, `MIDDLEWARES` | ≤140 |
| `runtime/mcp/tools/registry.ts` | 工具注册表（name → {schema, handler, mutates, adminOnly}） | `register()`, `lookup()`, `list()` | ≤120 |
| `runtime/mcp/tools/*.ts` | 按域分组的工具 handler（每组一个文件） | 各组 handler | 每个 ≤200 |
| `runtime/mcp/resources.ts` | MCP resources：把投影视图暴露为 `context://...` 只读资源 | `listResources()`, `readResource()` | ≤220 |
| `runtime/mcp/sse.ts` | 事件环 + Last-Event-ID 重放，把 event-log 推给前端 | `createSseHub()` | ≤180 |

> 传输/资源/SSE 的**线上封套形状**以 00 §5.8 为唯一权威（前后端同一份契约）；本层只管实现。

**中间件链**（替代现状散落的 `_setCallCtx`/幂等/鉴权判断）：

```text
请求 ─► auth(校验 bearer/scope) ─► idempotency(幂等键命中即返回缓存)
     ─► ctx(注入 correlation_id/actor) ─► handler(域逻辑) ─► 结果
```

### 横切层

| 文件 | 职责 | 关键导出 | LOC |
| --- | --- | --- | --- |
| `runtime/cross/audit.ts` | 时间线/审计**视图**（注意：审计就是 event-log，本模块只做查询与归类） | `timeline()`, `auditFeed()` | ≤180 |
| `runtime/cross/auth.ts` | 内存态 bearer token + scoped token | `createTokenStore()`, `authenticate()` | ≤140 |
| `runtime/cross/logger.ts` | 结构化 JSON 日志 + 敏感字段自动脱敏 | `createLogger()` | ≤120 |

> 关键差异：现状 audit 是「写副作用」，本设计 audit **只读** event-log。写入只发生在 L3 `event-log.append`。

---

## 4. 模块清单总表

| 层 | 文件 | 依赖（仅低层/同层/core） | LOC |
| --- | --- | --- | --- |
| L0 | kernel/{ids,errors,clock,result,ctx}.ts | 无 | ≤120 |
| L3 | persist/event-log.ts | sqlite-adapter, kernel | ≤200 |
| L3 | persist/sqlite-adapter.ts | node:sqlite, kernel | ≤220 |
| L3 | persist/projections/*.ts | core/graph, kernel | ≤180 |
| L3 | persist/snapshot.ts | event-log, projections | ≤180 |
| L4 | engine/node-machine.ts | core/state, event-log | ≤180 |
| L4 | engine/message-bus.ts | core/validate, event-log | ≤220 |
| L4 | engine/edge-policy.ts | core/graph | ≤160 |
| L4 | engine/scheduler.ts | engine/*, event-log | ≤200 |
| L5 | mcp/transport.ts | node:http, middleware | ≤260 |
| L5 | mcp/middleware.ts | cross/auth, kernel/ctx | ≤140 |
| L5 | mcp/tools/registry.ts | 无 | ≤120 |
| L5 | mcp/tools/*.ts | engine, persist, registry | ≤200 |
| L5 | mcp/resources.ts | persist/projections | ≤220 |
| L5 | mcp/sse.ts | event-log | ≤180 |
| 横切 | cross/{audit,auth,logger}.ts | event-log / 无 | ≤180 |

---

## 5. 后端内部依赖 DAG

```text
        mcp/transport ──► mcp/middleware ──► mcp/tools/* ──► engine/* ──► persist/*
             │                  │                 │             │           │
             ├─► mcp/sse ───────┼─────────────────┼─────────────┘           │
             ├─► mcp/resources ─┼─────────────────┼───────────────────────► │
             ▼                  ▼                 ▼                          ▼
         cross/auth         kernel/ctx       core/validate            sqlite-adapter
                                                  │                          │
                                              core/graph,types          node:sqlite
                                                  │
                                              kernel(最底)
```

无环；高层不被低层 import。

---

## 6. 关键数据流时序

> 下列时序里出现的事件名（`message.delivered` 等）与拒绝码均引自 00 §5.6/§5.7 的共享词表，非本文私有。

### 6.1 一次 MCP 工具调用落到事件日志

```text
客户端 POST /mcp {tool:'agent_report', args}
   │
   ▼ transport 解析 JSON-RPC
middleware: auth ✔ → idempotency(未命中) → ctx(注入 correlation_id)
   │
   ▼ tools/registry.lookup('agent_report').handler
engine 校验状态机转移合法 → event-log.append(RuntimeEvent{event_type:'agent.report', nodeId, edgeId, payloadType})
   │
   ├─► projections 增量 apply → 节点状态视图更新
   └─► sse.push(event) → 前端 SSE 收到 → 高亮该节点/边
   ▼
middleware 回写幂等缓存 → transport 返回结果
```

### 6.2 状态投影（读路径）

```text
请求 context://workspace/X/graph
   │
   ▼ resources.readResource
projections.rebuild = snapshot.restore() + event-log.scan(sinceSeq>快照).reduce(apply)
   │
   ▼ 返回「当前节点 + 边 + 状态」视图（从未直接存过，全由事件得出）
```

### 6.3 一条消息经总线（运行期类型防线）

```text
节点 A 产出 AgentReport（out: report_out）
   │
   ▼ message-bus.publish(payload, fromPort=report_out)
对每条出边 edge: core/validate(payloadType, edge.target 端口类型)
   │            └─ 不相容 → append('message.rejected') ，不投递
   ▼ 相容 → edge-policy.applyPolicy → route 到 B.message_in
append('message.delivered'{edgeId}) → sse 推送
```

---

## 7. 持久化设计细节

- **幂等**：mutating 工具携带幂等键；命中则返回缓存结果（中间件层处理，不进 event-log 二次写）。
- **重放与快照**：`snapshot.take()` 周期执行；`rebuild` = 最近快照 + 增量重放，避免线性增长。
- **保留策略**：event-log 原则上不删（审计完整性）；过期消息/认领通过「投影时忽略」体现，而非删事件。
- **迁移**：`sqlite-adapter.migrate()` 持版本号；只增表/列，向前兼容。

---

## 8. 与现状 Contex 的映射

| 现状（Contex 五层） | 本设计 | 变化 |
| --- | --- | --- |
| `db.mjs` + sqlite | L3 `sqlite-adapter` | 仅作适配，状态不再直接存 |
| `store.mjs`（audit 副作用 + 幂等） | L3 `event-log`（主存）+ L5 中间件幂等 | audit 升为主存 |
| `domain/*`（直接改状态表） | L3 `projections`（事件投影） | 状态由事件派生 |
| `index.mjs` facade + 手工 correlation | L0 `ctx` + L4 engine | 上下文隐式传播 |
| `tools.mjs` 大 if/else | L5 中间件链 + tools/registry | 可组合、可测 |
| `mcp-transport.mjs` | L5 `transport`+`sse` | 拆分传输与事件推送 |
| `resources.mjs` | L5 `resources` | 读投影而非遍历表 |
| `auth/logger` | 横切 `auth/logger` | 基本保留 |

---

## 9. 测试策略

| 层 | 测法 |
| --- | --- |
| L0 Kernel | 纯单测，无 I/O |
| core/ | 纯单测（同构，前后端共享同一套测试夹具） |
| L3 Persist | 投影纯函数单测 + 内存 sqlite 集成测（重放/快照一致性） |
| L4 Engine | 喂事件序列断言状态机/总线/校验行为 |
| L5 Protocol | 中间件链组合测 + 起本地 server 跑 JSON-RPC 往返 |
| 横切 | audit 视图查询测、脱敏测 |

**框架**：Vitest（node 环境）。**回归基线**：`pnpm test`（后端全量）+ `pnpm check`（护栏）+ 一条「工具调用→事件→投影→SSE」端到端冒烟。

---

## 10. 接缝接口（后端私有扩展点）

> 这些是后端内部的扩展插槽——新增投影/中间件/工具/边策略都往这里插。签名在此冻结（同 00 §5 地位，但**后端私有、不跨线**）。前端的 `RuntimeAdapter` 接缝见 20 §4；二者不互相 import，只经 MCP 通信。

```ts
// 投影：纯函数 (事件, 旧状态) → 新状态。必须纯——同序列重放须得同结果，否则快照/重建发散。
interface Projection<S> {
  readonly name: string;
  init(): S;
  apply(ev: RuntimeEvent, prev: S): S;   // 纯，零 I/O
}

// 中间件：包裹 handler，组合成链 auth → 幂等 → ctx → handler。
type Middleware = (next: ToolHandler) => ToolHandler;

// 工具 handler + 定义：域逻辑的唯一形态。
type ToolHandler = (req: ToolRequest, ctx: CallCtx) => Promise<Result<ToolResult>>;
interface ToolDef {
  name: string;
  schema: JsonSchema;     // 入参校验（由 Zod 导出，00 §5.9）
  mutates: boolean;       // true 才需幂等键
  adminOnly: boolean;
  handler: ToolHandler;
}

// 边策略：投递前钩子（directed 校验 / retry / cancel / gate 骨架）。
interface EdgePolicy {
  applyPolicy(edge: Edge, payload: unknown): Result<unknown>;
}
```

> 新增一个投影/工具/中间件 = 实现对应接口 + 在各自 registry 注册 + 配同名测试，**不改既有接缝**——这是「加文件不改核心」（GUIDE §2.4）的落点。

---

## 11. 阶段内建造顺序与完工定义

> PROGRESS / GUIDE §10 给的是**阶段间**顺序（F1→F2→F3）；本节给**阶段内**的文件拓扑序与每模块「完工＝什么」，让单个文件也有可机械判定的验收。

**建造顺序**（严格按依赖，先底后顶；每阶段以一条集成冒烟收口）：

```text
F1  sqlite-adapter → event-log → projections/* → snapshot
    (建表/语句)     (追加·读取)  (纯投影)        (快照·重建)
    冒烟：append 3 事件 → scan 回放 → 投影状态 == 预期；restore+增量 == 全量

F2  node-machine → edge-policy → message-bus → scheduler
    冒烟：喂「A 产出 → 经边 → B」序列，断言 message.delivered + 状态推进

F3  tools/registry → middleware → transport+sse → resources
    冒烟：本地 server 起 → JSON-RPC 调一个 mutating 工具 → SSE 收到该事件
```

**每模块完工定义**（导出齐 + 测试绿 + 护栏过）：

| 模块 | 完工 = |
| --- | --- |
| `event-log` | `append/scan/head` 实现；seq 严格自增；事件不可变（测试改写即失败） |
| `projections/*` | `init/apply` 纯函数；同序列两次重放结果相等（性质测试） |
| `snapshot` | `take/restore`；`restore + 增量重放 == 全量重放`（一致性测试） |
| `node-machine` | 非法转移被拒且无副作用；合法转移产出 `node.transitioned`（00 §5.6） |
| `message-bus` | 相容→`message.delivered`；不相容→`message.rejected{reason∈§5.7}` 不投递 |
| `edge-policy` | directed 反向被拒；retry/cancel/gate 钩子可注入（骨架可空实现） |
| `transport` | JSON-RPC 2.0 往返；SSE GET 订阅可按 Last-Event-ID 重连重放 |
| `middleware` | 链序 auth→幂等→ctx→handler；幂等键命中返缓存且不二次入日志 |
| `tools/*` | 每工具入参过 schema；mutating 走幂等；产出事件携带 00 §5.6 类型 |

---

## 12. 开放问题

- 投影是否需要落地缓存表（加速冷启动），还是每次内存重建？
- `scheduler` 地基阶段用就绪队列即可，并发/优先级留到功能阶段。
- event-log 是否分 workspace 物理分库，还是单库逻辑分区？
- 边策略（retry/cancel/gate）在地基阶段保留到什么粒度的骨架？

> 本文定稿后，L0–L5 的文件清单、LOC 预算、依赖方向即为后端开工的不可动摇基线。功能（具体节点逻辑、Polly、调试 UI）一律长在此地基之上。
</content>
