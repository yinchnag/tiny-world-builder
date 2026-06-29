# 蓝图运行时 · 底层架构总览（00-overview）

> 本文是「蓝图运行时（Blueprint Runtime）」底层设计文档集的**第 0 篇 / 母版**。
> 它只描述**地基（foundation）**：分层、共享模型、模块边界、依赖规则、数据形态。
> 具体功能（Agent 推理、Polly 集成、可视化调试……）**不在本文范围**，在地基稳定后再单独设计。

---

## 0. 文档集导航

蓝图运行时的底层设计共 5 份文档，本文是入口：

| 编号 | 文档 | 职责 | 状态 |
| --- | --- | --- | --- |
| **00** | `architecture/00-overview.md`（本文） | 系统总览 · 共享 `core` 模型 · 全景分层 · 模块依赖规则 · 规范数据结构 | ✅ 评审中 |
| 10 | `architecture/10-backend-foundation.md` | 后端「图运行时」底层：事件溯源 · 状态机 · 消息总线 · MCP 传输 | ✅ 已成稿 |
| 20 | `architecture/20-frontend-foundation.md` | 前端「图编辑器」底层：React + Vite + xyflow + Zustand · 连接校验 · 节点 UI 注册表 | ✅ 已成稿 |
| 30 | `architecture/30-guardrails.md` | 代码护栏：ESLint 架构边界/体积 · 契约自校验 · 测试镜像 · 阈值 | ✅ 已成稿 |
| GUIDE | `DEVELOPMENT_GUIDE.md` | 开发指导：编码硬约束 · 注释规范 · 依赖规则 · 测试 · 阶段顺序（含 F-guard） | ✅ 已成稿 |

愿景层（高视野，已存在）位于 `docs/vision/`：`runtime-design.md`、`node-inventory.md`、`node-evolution.md`。
**愿景层回答「要做成什么」，本文档集回答「代码地基怎么搭」。**

**执行与验收**（地基开工前必读）：`docs/execution/`＝AI 作业协议（怎么照做、何时停、什么算完工），`docs/testing/`＝测试清单 + 黄金夹具（用什么证明做对了）。二者同样按 **00 全局 / 10 后端 / 20 前端** 三视角；全局篇是共享真相，10/20 只写增量。前端篇现为占位，进入 F4 再填。

---

## 1. 背景与重构主张

### 1.1 现状

当前系统由两个零依赖项目组成：

```text
CodeSurf  = 浏览器原生 DOM/SVG 无限画布（前端 public/canvas.js 单体 2784 行）
Contex    = 零依赖 Node MCP 协调后端（五层：db → store → domain → facade → transport）
```

二者各自维护一套「tile 类型」枚举，靠语义 link 字符串（`controls`、`handoff`…）连接。
**问题**：tile 不是可执行单元、连线不携带类型、非法连接无法在编辑期拦截、时间线事件无法回指到具体节点/端口/边。

### 1.2 目标心智模型

```text
CodeSurf  = 多 Agent 工作流「蓝图编辑器」
Contex    = 「图运行时」+ 消息总线 + 状态机 + 策略层 + 审计日志
```

每个节点是「类型化、可执行、可检视」的单元；每条边携带明确的控制/数据/协作载荷。
这不是模仿 Unreal/Unity 的 UI，而是采纳其**深层模型**。

### 1.3 本次（地基阶段）的范围

| 在范围内（地基） | 不在范围内（功能，后续） |
| --- | --- |
| 节点/端口/边/类型的**数据模型** | 具体节点的业务逻辑（Agent 怎么推理） |
| 编辑期 + 运行期**类型校验机制** | Polly 集成的具体映射 |
| 事件溯源 + 状态投影**持久化骨架** | 可视化调试 UI 的具体面板 |
| 类型化**消息总线**与边策略骨架 | 工作流模板资产的具体预设 |
| MCP **传输 + 中间件链**骨架 | 各节点的渲染细节 |
| 前端**xyflow 集成 + 状态/命令 + 连接校验**骨架 | 各节点检视器的具体字段 |

**原则：先把地基做到层次分明、可扩展、分模块；功能一律长在地基之上。**

---

## 2. 核心架构决定：前后端共享一份 `core/`

这是整套地基的脊椎。

### 2.1 为什么可行

技术栈（已定）：后端 **TypeScript（Node）**、前端 **React + Vite + xyflow + TypeScript**，全栈走构建（Vite/tsc），可自由使用成熟依赖。
我们把一层纯 TS 模型 `core/` 抽成 monorepo 内的共享包，被前后端各自 `import`。
TS 类型让端口/载荷/契约获得**编译期**类型安全，与 `core/validate` 的**运行期**校验互补——这是相比早期「零构建 vanilla」版本的增益，而非损失。

### 2.2 共享什么

```text
            ┌──────────────────────────────────────────────┐
            │  core/   纯 TS 模型 · 零 I/O · 无副作用 · 同构  │
            │  ┌────────────┬────────────┬───────────────┐  │
            │  │ 类型系统    │ 图模型      │ 契约 + 校验     │  │
            │  │ PayloadType │ Node/Port/ │ Contract 注册表 │  │
            │  │ 兼容矩阵    │ Edge/Graph │ validate()     │  │
            │  └────────────┴────────────┴───────────────┘  │
            └───────────────────────┬──────────────────────┘
                          ┌─────────┴─────────┐
                          ▼                   ▼
                 后端 runtime/          前端 editor/
            运行期：执行图、状态机、     编辑期：画节点、连线时
            消息流经边时做类型校验        实时做类型校验、给反馈
```

节点契约、端口类型、边的 lane、连接合法性——**只写一遍**：

- **前端**用它：拖拽连线时即时判断「这两个端口能不能连」，非法连接给出类型不匹配原因。
- **后端**用它：运行期一条消息流经某条边时，再次校验载荷类型，并把 `node_id/port_id/edge_id` 写进审计。

这是相对现状最大的升级：**消灭前后端类型枚举的漂移**，让「很多非法连接根本连不上」成为可能。

### 2.3 `core/` 的铁律

1. **零 I/O · 无副作用**：不碰文件、网络、DOM、sqlite、`process`。纯函数 + 纯数据。
2. **平台中立**：不 import Node 内置（`node:*`）、不碰浏览器 API；只用 ECMAScript 标准库 + 纯工具型依赖（如有）。这样同一份 `core/` 在 Node 与浏览器都能用。
3. **同构可测**：每个模块用 Vitest 单测，不需要 DOM 或 sqlite 即可全覆盖。
4. **被依赖，不依赖**：`core/` 不 import 任何 `runtime/` 或 `editor/` 的东西（依赖永远朝下）。

> `core/` 是「真理的单一来源」。任何「某种节点有哪些端口、什么类型能连什么」的判断，**只允许**经过 `core/`。

---

## 3. 全景分层

整个系统是一棵**单向依赖**的分层树。箭头表示「依赖」，永远朝下，**禁止反向或跨层向上**。

```text
┌──────────── 前端 editor/（React + Vite + xyflow + TS）────────────────┐
│  App        应用外壳 · 工作区加载/保存                                 │
│  Workspace  布局持久化 · 自动保存                                      │
│  Sync       runtime 适配器（MCP client + SSE + 镜像，抽象后端）        │
│  NodeUI     节点组件注册表 + 契约驱动检视器（每种节点 1 目录，扩展点）  │
│  Graph      xyflow 集成：画布 + core↔xyflow 映射 + 连接校验            │
│  State      Zustand 图文档 store · 命令/撤销(zundo) · 选择/UI          │
│  （平移/缩放/拖连/边路由/小地图由 xyflow 提供，不再手写）              │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ 依赖
                                 ▼
┌──────────────────────────── core/（共享）──────────────────────────────┐
│  类型系统 PayloadType + 兼容矩阵                                        │
│  图模型   Node · Port · Edge · Graph                                   │
│  契约     Contract 注册表 · validate()                                 │
└───────────────────────────────▲───────────────────────────────────────┘
                                 │ 依赖
┌───────────────────────────────┴──────────── 后端 runtime/ ─────────────┐
│  L5 Protocol     mcp 传输 · tools（中间件链）· resources · SSE          │
│  L4 Engine       调度器 · 节点状态机 · 类型化消息总线 · 边策略          │
│  L3 Persist      event-log（事件溯源·主存）· 状态投影 · sqlite 适配     │
│  （L2/L1 图模型与类型系统直接复用 core/）                              │
│  L0 Kernel       ids · errors · clock · result · 上下文传播            │
│  横切            audit/timeline（即 L3 事件日志）· auth · logger        │
└───────────────────────────────────────────────────────────────────────┘
```

**读法**：`editor/` 和 `runtime/` 都依赖 `core/`，但彼此**不**直接依赖——前端只通过 Sync 适配器经 MCP 协议与后端通信。`core/` 谁都不依赖。

> 后端为何没有独立的 L2/L1？因为图模型与类型系统**就是** `core/`，后端直接复用，不再重写。这正是 §2 决定的收益。

---

## 4. `core/` 模块分解（地基的关键，本文定稿）

`core/` 是前后端共用的，所以它的模块边界在总览里就定死。下表是文件清单、职责与 LOC 预算（硬约束：单文件 ≤500 行、单函数 ≤100 行，详见 GUIDE）。

| 模块 | 文件 | 职责（单一） | LOC 预算 |
| --- | --- | --- | --- |
| 载荷类型 | `core/types/payload-types.ts` | 定义命名载荷类型（`AgentMessage`、`Task`、`ContextBundle`…）及其元数据 | ≤200 |
| 类型兼容 | `core/types/compatibility.ts` | 「out 端口类型 → in 端口类型」是否相容的纯判定 + 原因 | ≤150 |
| 端口 | `core/graph/port.ts` | Port 数据结构 + 构造/校验（dir/lane/payloadType/required/multiple） | ≤150 |
| 节点 | `core/graph/node.ts` | Node 实例数据结构（id/type/state/properties）+ 不可变更新 | ≤200 |
| 边 | `core/graph/edge.ts` | Edge 数据结构（source/target 端口引用 + lane + payloadType + policy） | ≤180 |
| 图 | `core/graph/graph.ts` | Graph 容器：增删节点/边、查询、拓扑遍历（纯函数，无 I/O） | ≤300 |
| 契约注册表 | `core/contracts/registry.ts` | 注册/查询节点契约（NodeContract）+ `validateContract()`（见 30 G4）；前后端启动时各自填充 | ≤180 |
| 契约定义 | `core/contracts/defs/*.ts` | 每种节点家族一个文件：声明 inputs/outputs/state/actions | 每个 ≤150 |
| 状态机 | `core/state/machine.ts` | 数据驱动的状态机：给定 transitions 表，判定转移是否合法 | ≤150 |
| 校验入口 | `core/validate.ts` | 统一校验门面：`canConnect(edge, graph)`、`validateGraph(graph)` | ≤200 |
| 事件词表 | `core/events.ts` | 事件类型名 + 拒绝/契约 code 常量 + `isKnownEventType()`（§5.6/§5.7 唯一来源，跨线共享） | ≤150 |

> 文件后缀均为 `.ts`（`core/` 是共享 TS 包，TS 类型在此定义、前后端共用）。

### 4.1 `core/` 内部依赖图（DAG，无环）

```text
            validate.ts
              │   │   │
   ┌──────────┘   │   └──────────────┐
   ▼              ▼                   ▼
contracts/    graph/graph.ts     state/machine.ts
registry.ts       │
   │              ▼
   │        graph/{node,edge,port}.ts
   │              │
   └──────┬───────┘
          ▼
   types/compatibility.ts
          │
          ▼
   types/payload-types.ts   ← 最底层，谁都不依赖
```

> `core/events.ts`（§5.6/§5.7 的常量）与 `payload-types.ts` 同为最底层叶子，谁都不依赖；`validate.ts` 依赖它取拒绝码。
> 任何 PR 若让这张图出现环、或让低层文件 import 高层文件，应在评审中拒绝。

---

## 5. 规范数据结构（前后端唯一真相）

以下结构在 `core/` 定义，前后端共用。字段名、含义在此**冻结**，10/20 文档不得另立。

### 5.1 PayloadType（载荷类型）

```js
// 命名的载荷类型。lane 决定它能走哪条「连线泳道」。
{
  name: 'AgentMessage',          // 全局唯一标识
  lane: 'message',               // control | message | task | context | resource | human
  description: '一条 Agent 间消息',
  // 可选的结构约束，运行期可据此做更细的载荷校验（地基阶段可留空）
  schema: null,
}
```

六条泳道（lane）与现有语义 link 的对应：

```text
control    控制/权责：controls, handoff, reports_to       —— 执行边
message    AgentMessage / ChatMessage                     —— 数据边
task       Task / TaskUpdate / Claim                       —— 数据边
context    ContextBundle / DocumentSelection / MemoryFact  —— 数据边
resource   FileClaim / TerminalInput / BrowserFinding      —— 数据边
human      HumanAttention / HumanReply / Approval          —— 数据边
```

### 5.2 Port（端口）

```js
{
  id: 'message_in',          // 在所属节点内唯一
  dir: 'in',                 // 'in' | 'out'
  payloadType: 'AgentMessage',
  lane: 'message',           // 必须与 payloadType.lane 一致（校验保证）
  required: false,           // in 口：是否必须连接
  multiple: true,            // 是否允许多条边（扇入/扇出）
}
```

### 5.3 NodeContract（节点契约，静态）+ Node（节点实例，运行时）

```js
// 契约：某「类型」节点长什么样。注册在 core/contracts/registry。
NodeContract = {
  type: 'agent',
  family: 'execution',       // human | execution | context | task | observation | integration
  title: 'Agent',
  description: '自治推理/执行单元',
  inputs:  [Port, ...],      // dir 必为 'in'
  outputs: [Port, ...],      // dir 必为 'out'
  state: {                   // 数据驱动状态机
    values: ['offline','idle','working','waiting','blocked','paused','done','error'],
    initial: 'offline',
    transitions: [['idle','working','start'], ['working','done','finish'], ...],
  },
  actions: [{ id:'claim', label:'认领' }, ...],
  runtime: 'contex',         // contex | editor | integration —— 谁负责执行
}

// 实例：画布上某个具体节点。
Node = {
  id: 'node_xxx',
  type: 'agent',             // 指向 NodeContract.type
  state: 'idle',             // 取自契约 state.values
  properties: { /* 该实例的配置，如 model、systemPrompt */ },
  view: { x, y, w, h, title, minimized, pinned },  // 仅前端关心
}
```

> **分离原则**：`view`（位置/尺寸/外观）只属于前端编辑器，运行时不关心；`state`/`properties` 属于运行时真相。10/20 文档据此各取所需。

### 5.4 Edge（边）

```js
{
  id: 'edge_xxx',
  source: { node: 'node_a', port: 'report_out' },
  target: { node: 'node_b', port: 'message_in' },
  lane: 'message',
  payloadType: 'AgentReport',  // 实际流经的载荷类型（源端口类型）
  directed: true,
  semanticKind: 'reports_to',  // 兼容旧语义标签，用于显示
  policy: { /* 执行策略：retry/cancel/gate，地基阶段留骨架 */ },
  // 运行期回填（调试用）：
  lastPayloadSummary: null,
}
```

### 5.5 RuntimeEvent（运行时事件，事件溯源主存的元素）

```js
{
  seq: 1024,                  // 全局自增
  ts: '2026-06-29T...',
  actorType, actorId,
  eventType: 'message.sent',
  // 图坐标——让任何事件都能回指到节点/端口/边（现状缺失，地基补齐）：
  nodeId, portId, edgeId,
  workflowTemplateId, workflowInstanceId,
  payloadType, payloadSummary,
}
```

> **命名约定**：结构体与线上载荷（MCP/SSE）一律 **camelCase**（`nodeId`/`eventType`/`payloadType`）；持久化列名用 **snake_case**（`node_id`/`event_type`，见 10 §3 建表）。两者是同一字段的两种书写，映射由 `runtime/persist/sqlite-adapter` 唯一负责——**不是字段漂移**。

### 5.6 事件类型词表（共享 · 跨线唯一权威）

> 事件类型名跨 MCP/SSE 流到前端（前端 SSE 据此高亮、后端 event-log 据此落库）。**前后端不得各自造名**，一律取自本表（常量来源 `core/events.ts`）。命名规则 `<domain>.<verb>`，全小写点分。

**按类别的必填图坐标**（其余字段恒由 §5.5 提供：`seq/ts/actorType/actorId/payloadType/workflow*`）：

| 类别 | 必填图坐标 | 含义 |
| --- | --- | --- |
| `node.*` | `nodeId` | 节点自身的状态变化 |
| `message.*`（出口产出）| `nodeId` + `portId` | 某节点在某 out 口产出载荷 |
| `message.*`（经边投递/拒投）| `edgeId` | 载荷沿某边流动的结果 |

**地基阶段引擎自身产出的闭集**（node-machine + message-bus）：

```text
node.transitioned     状态机推进      必填 nodeId（payload: {from,to,trigger}）
message.sent          out 口产出载荷   必填 nodeId,portId
message.delivered     沿边投递成功     必填 edgeId
message.rejected      运行期类型拒投   必填 edgeId（payload: {reason}∈§5.7）
```

> **功能事件**（如 `agent.report`、`task.created`）不在地基闭集内，由各 BP 功能阶段**登记进本表**，但必须遵守上面的命名与必填规则。`core/events.isKnownEventType()` 兜底校验未登记的事件名。

### 5.7 共享码表（拒绝原因 + 契约错误 · 跨线唯一权威）

> 这些 code 同时被**编辑期**（前端连线给「为什么连不上」）与**运行期**（后端 `message.rejected.reason`）使用——因为两端调的是同一个 `core/validate`，故为共享。**区别于** kernel 私有 `ERR.*`（10 §3，不跨线）与前端错误类（GUIDE §6，不跨线）。

| code | 出处 | 含义 |
| --- | --- | --- |
| `lane.mismatch` | `canConnect` | 两端端口 lane 不同 |
| `payload.incompatible` | `canConnect` | out 载荷类型不可赋给 in（types/compatibility 判定）|
| `port.not_found` | `canConnect` | 端点端口在契约中不存在 |
| `direction.invalid` | `canConnect` | out→out 或 in→in |
| `cardinality.exceeded` | `canConnect` | 目标 in 口 `multiple:false` 已被占用 |
| `required.unmet` | `validateGraph` | 必填 in 口未连接 |
| `contract.invalid` | `validateContract`（30 G4）| 契约元校验失败 |

---

## 6. 模块依赖规则（评审红线）

适用于前后端**所有**模块，违反即驳回：

1. **依赖朝下**：高层可依赖低层，低层**禁止** import 高层。层级以本文 §3 为准。
2. **`core/` 纯净**：`core/` 不得 import 任何 Node 内置模块（`node:*`）、浏览器 API、或上层目录。
3. **前后端不直连**：`editor/` 不得 import `runtime/`，反之亦然；唯一通道是前端 Sync ↔ 后端 Protocol 的 MCP 协议。
4. **横切单向**：`logger`/`auth`/`audit` 可被各层调用，但它们自身不得反向依赖业务模块。
5. **DAG 无环**：任何目录内的 import 关系必须无环（§4.1 是 `core/` 的范例）。
6. **类型判定唯一出口**：「能不能连、类型对不对」只能问 `core/validate`，禁止在前端或后端各写一份判断。

---

## 7. 数据流全景（一条边的一生）

用「Agent A 把报告发给 Agent B」串起前后端，演示 `core/` 如何同时服务两端。

```text
【编辑期 · 前端】
  用户从 A 的 report_out 拖到 B 的 message_in
      │
      ▼
  xyflow isValidConnection 调 core/validate.canConnect(edge, graph)
      │            └── 内部走 types/compatibility：AgentReport→AgentMessage 相容？
      ▼
  相容 → graph-store 落库一条 Edge；不相容 → xyflow 拒绝 + 弹出「类型不匹配」原因
      │
      ▼
  Sync 适配器 经 MCP 把 Edge 镜像到后端（携带 source/target 端口 + lane + payloadType）

【运行期 · 后端】
  Agent A 节点产出一条 AgentReport
      │
      ▼
  L4 Engine 消息总线按 Edge 路由到 B.message_in 前，
  再次调 core/validate 校验载荷类型（运行期防线）
      │
      ▼
  L3 Persist 追加一条 RuntimeEvent（含 nodeId/portId/edgeId/payloadType）
      │
      ▼
  Protocol 经 SSE 推给前端 → Graph/State 更新 → React 高亮这条边、预览载荷摘要
```

**一个 `core/` 判定函数，被编辑期和运行期各用一次。** 这就是共享模型的回报。

---

## 8. 与现状的映射（迁移锚点，细节见 10/20）

地基是全栈重写，但概念有迁移锚点，便于复用经验与数据：

| 现状概念 | 蓝图地基对应 | 说明 |
| --- | --- | --- |
| Contex `tile`（类型枚举） | `Node` + `NodeContract` | tile 类型 → 节点契约；状态机数据化 |
| Contex `tile_link`（语义字符串） | `Edge`（端口级 + lane + payloadType） | 旧 `kind` 降级为 `semanticKind` 仅作显示 |
| Contex `audit_event`（副作用表） | `RuntimeEvent`（事件溯源主存） | 审计从副作用升为主存，状态由事件投影 |
| Contex `tools.mjs`（大 if/else） | L5 中间件链 | auth→幂等→上下文→handler 组合 |
| CodeSurf `canvas.js`（2784 行单体） | React + xyflow（基础设施买现成）+ `editor/` 分层模块 | 平移/缩放/连线交给 xyflow，只写蓝图语义 |
| CodeSurf `tiles.mjs` 注册表 | `core/contracts` + `editor/nodes/registry` | 契约（共享）与视图（前端）分离 |
| CodeSurf 内嵌 Contex 轮询 | `editor/sync` 适配器 | 后端交互抽象化，可替换/可 mock |

---

## 9. 术语表

| 术语 | 含义 |
| --- | --- |
| **节点 Node** | 图中的可执行单元；有类型、端口、状态、属性 |
| **契约 NodeContract** | 某类节点的静态声明（端口/状态机/动作） |
| **端口 Port** | 节点的类型化输入/输出接点 |
| **边 Edge** | 连接两个端口的有向连线，携带 lane 与 payloadType |
| **泳道 Lane** | 边的六大类别（control/message/task/context/resource/human） |
| **载荷 Payload** | 流经边的数据；其类型即 PayloadType |
| **图运行时 Runtime** | 后端：执行图、跑状态机、路由总线、记审计 |
| **图编辑器 Editor** | 前端：画图、连线、检视、调试 |
| **事件溯源** | 以不可变事件日志为主存，当前状态由事件投影得出 |

---

## 10. 下一步

底层设计文档集（00/10/20/30/GUIDE）已全部成稿，愿景文档已收敛进 `docs/vision/`。后续：

1. **评审定稿** —— 确认本文 §2/§4/§5/§6 四处基线，以及 10/20/30 的逐模块设计。
2. **进入 F-guard 阶段**（GUIDE §10）：搭 monorepo 脚手架（pnpm workspaces + Vite + TS，设定基线见 30 §7）+ 护栏（ESLint 边界/体积 + 契约自校验 + Vitest），护栏先于代码。
3. **F0**：在护栏之内写 `core/`，再依次 F1–F3（runtime）、F4–F6（editor）。

> 评审请重点确认：§2 共享 `core` 的边界、§4 模块分解与 LOC 预算、§5 规范数据结构的字段命名、§6 依赖红线。这四处是 10/20/30/GUIDE 的不可动摇基线。
</content>
</invoke>
