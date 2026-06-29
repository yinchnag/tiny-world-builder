# 前端「图编辑器」底层设计（20-frontend-foundation）

> 本文承接 [`00-overview.md`](./00-overview.md)。
> **技术栈（已定）**：React + Vite + TypeScript + [xyflow（React Flow）](https://reactflow.dev) + Zustand。
> 数据结构以 00 §5 为唯一真相（现以 TS 类型表达）；图模型/类型/校验复用共享 `core/`（TS），本文不重述。
> 与早期「零构建 vanilla 手写一切」的版本相比，本版**用框架 + 现成节点图编辑器替代手写**，
> 把现状 `public/canvas.js`（2784 行单体）里大量基础设施（平移/缩放/端口拖连/边路由/小地图）交给 xyflow，
> 我们只写**蓝图语义**（类型化端口、连接校验、节点 UI、检视器、后端同步）。

---

## 1. 职责与边界

`editor/` 是「图编辑器」，拥有**编辑期真相**与**可视化**：

| 我们仍然拥有 | 交给 xyflow / React 的 | 不拥有（归后端/功能阶段） |
| --- | --- | --- |
| 蓝图语义：类型化端口、**连接合法性校验** | 画布、平移/缩放、节点拖动 | 节点的执行/推理 |
| core ↔ 视图映射 | 端口拖连手势、边路由、箭头 | 运行期状态机推进 |
| 节点 UI（自定义节点组件）+ 检视器 | 小地图、选择框、对齐 | 持久化真相（运行真相在后端 event-log） |
| 图文档状态 + 命令/撤销 | 重渲染（React 协调） | 类型判定逻辑本身（调 `core/validate`） |
| 可视化调试（高亮/载荷预览） | —— | —— |
| 经适配器与后端同步 | —— | —— |

边界铁律（00 §6）：`editor/` **不** import `runtime/`；唯一通道是 sync 适配器经 MCP 协议。
**离线可用**：未连后端时，画布编辑/布局/校验仍独立工作（注入 no-op 适配器）。

---

## 2. 「自写 vs 现成」对照（这次重写的核心收益）

```text
现状 canvas.js 手写的          →  新栈由谁提供
──────────────────────────────────────────────
平移/缩放/视口变换             →  xyflow（内置）
节点拖动 / 选择 / 多选         →  xyflow（内置）
端口（连接点）+ 拖拽连线        →  xyflow Handle + onConnect
边的贝塞尔路径 / 箭头 / 标签    →  xyflow Edge（+ 自定义 edge 组件加 lane/载荷标签）
小地图                        →  xyflow <MiniMap/>
全量 renderAll 重绘            →  React 协调（增量天然）
全局 app + 零散 Map 状态        →  Zustand store（单一来源 + 选择器）
手写响应式/订阅                →  Zustand 订阅 + React 重渲染
──────────────────────────────────────────────
我们自己写的（蓝图语义）：
  类型化端口 + 连接校验（isValidConnection → core/validate）
  core Graph ↔ xyflow nodes/edges 映射适配
  每种节点的自定义组件 + 契约驱动检视器
  命令/撤销（zundo/自定义）
  后端同步适配器（MCP client + SSE + 命令 drain + 镜像）
```

> 一句话：**基础设施买现成，蓝图语义自己写。** 这正是逃开 2784 行手写画布的方式。

---

## 3. 目录结构

Vite + React + TS 应用，`editor/` 自身是一个包（与 `core/`、`runtime/` 同 monorepo）。

```text
editor/
  index.html
  vite.config.ts
  src/
    main.tsx                入口：挂载 <App/>
    app/                    L-App   应用外壳：布局、Provider、主题
      App.tsx
      providers.tsx
    graph/                  L-Graph xyflow 集成（画布层）
      FlowCanvas.tsx        ReactFlow 容器（pan/zoom/minimap/controls）
      adapters/             core Graph ↔ xyflow 表示 互转
        to-xyflow.ts
        from-xyflow.ts
      connection/           编辑期类型防线
        validate-connection.ts   isValidConnection → core/validate
      edges/                自定义边组件（lane 颜色 + 载荷标签 + 高亮）
        TypedEdge.tsx
    state/                  L-State Zustand 状态
      graph-store.ts        图文档（nodes/edges，含 core 数据）
      commands.ts           命令模式 + 撤销/重做（zundo）
      selection-store.ts
      ui-store.ts
    nodes/                  L-NodeUI 每种节点一个目录（主扩展点）
      registry.ts           type → { Node 组件, Inspector }
      <type>/Node.tsx       自定义 xyflow 节点（含 typed Handle 端口）
      <type>/Inspector.tsx
    inspector/              L-Inspector 契约驱动检视器框架
      InspectorPanel.tsx
    sync/                   L-Sync 后端适配（抽象）
      runtime-adapter.ts
      mcp-client.ts
      sse.ts
      mirror.ts
    workspace/              L-Workspace 加载/保存/自动保存
      use-workspace.ts
      autosave.ts
    lib/                    小工具与 hooks
  test/                     镜像 src/ 的 Vitest 测试
```

---

## 4. 逐层模块

> 单文件 ≤500 行、单函数/组件 ≤100 行仍是硬约束（见 GUIDE §3）。React 组件天然小。

### L-App（应用外壳）

| 文件 | 职责 | LOC |
| --- | --- | --- |
| `app/App.tsx` | 顶层布局：画布 + 检视器面板 + 工具栏 | ≤120 |
| `app/providers.tsx` | 注入 runtime-adapter、store、主题 | ≤80 |
| `main.tsx` | 引导挂载 | ≤30 |

### L-Graph（xyflow 集成）

| 文件 | 职责 | LOC |
| --- | --- | --- |
| `graph/FlowCanvas.tsx` | `<ReactFlow>` 容器，接 store 的 nodes/edges 与变更回调，挂 MiniMap/Controls | ≤180 |
| `graph/adapters/to-xyflow.ts` | core `Node/Edge` → xyflow `Node/Edge`（端口→Handle 位） | ≤140 |
| `graph/adapters/from-xyflow.ts` | xyflow 变更 → core 域更新（位置/连接） | ≤140 |
| `graph/connection/validate-connection.ts` | `isValidConnection(conn)`：查端口契约 → 调 `core/validate.canConnect` → 允许/拒绝+原因 | ≤120 |
| `graph/edges/TypedEdge.tsx` | 自定义边：按 lane 着色、显示 payloadType 标签、运行期高亮 | ≤140 |

### L-State（Zustand 状态）

| 文件 | 职责 | LOC |
| --- | --- | --- |
| `state/graph-store.ts` | 图文档单一来源：xyflow 形态的 `nodes/edges`，其 `data` 内嵌 core 域数据 | ≤220 |
| `state/commands.ts` | 所有结构变更走命令；用 `zundo` 提供撤销/重做 | ≤180 |
| `state/selection-store.ts` | 选择集 | ≤80 |
| `state/ui-store.ts` | 瞬态 UI（检视器开合、连线预览态） | ≤100 |

### L-NodeUI（节点视图注册表 · 主扩展点）

| 文件 | 职责 | LOC |
| --- | --- | --- |
| `nodes/registry.ts` | `type → { node: React.FC, inspector: React.FC }`，喂给 xyflow `nodeTypes` | ≤120 |
| `nodes/<type>/Node.tsx` | 该类型自定义节点：渲染外壳 + 状态 + 用 `<Handle>` 摆 typed 端口 | 每个 ≤200 |
| `nodes/<type>/Inspector.tsx` | 该类型检视器字段（可选；缺省走契约驱动通用检视器） | 每个 ≤150 |

### L-Inspector（契约驱动检视器）

| 文件 | 职责 | LOC |
| --- | --- | --- |
| `inspector/InspectorPanel.tsx` | 读选中节点的 `core/contracts`，自动渲染端口/状态/动作/最近事件；有专属 Inspector 则用之 | ≤200 |

### L-Sync（后端适配，抽象化）

| 文件 | 职责 | LOC |
| --- | --- | --- |
| `sync/runtime-adapter.ts` | 适配器门面（接口 + no-op 离线实现） | ≤160 |
| `sync/mcp-client.ts` | 浏览器 MCP 客户端（`fetch` 调用 + `EventSource` SSE） | ≤180 |
| `sync/sse.ts` | 订阅后端事件流 → dispatch 到 store | ≤120 |
| `sync/mirror.ts` | 本地图变更镜像到后端（节点/边 + 端口 + lane + payloadType） | ≤140 |

> **关于"命令"**：现状 Contex 的画布命令总线（`canvas_create_tile`/`canvas_connect`/聚焦/高亮）在新模型里**被统一为 SSE 事件**——后端运行时改图即产出 RuntimeEvent，前端经 `sse.ts` 应用到 store，不再单设命令队列。双向都是"事件"：前端→后端用 `mirror`，后端→前端用 `sse`。

**L-Sync 接缝接口**（前端唯一的后端出入口；前端私有扩展点，与后端 10 §10 接缝对称但互不 import，只经 MCP）：

```ts
interface RuntimeAdapter {
  mirror(change: GraphChange): Promise<Result<void>>;        // 出：本地图变更镜像到后端（端口+lane+payloadType）
  subscribe(onEvent: (ev: RuntimeEvent) => void): Unsubscribe; // 入：订阅后端事件流（事件名见 00 §5.6），dispatch 到 store
  loadWorkspace(id: string): Promise<WorkspaceSnapshot>;
  saveWorkspace(id: string, snap: WorkspaceSnapshot): Promise<Result<void>>;
}
// no-op 离线实现：mirror/save 返回 ok 不发网，subscribe 返回空取消函数 —— 未连后端时画布照常工作（§1）。
```

> 线上封套（JSON-RPC 信封 / `context://` / SSE 帧）照 **00 §5.8** 编码；集成前对 `protocol-samples`（testing/00 §3.1）+ mock 断言。

### L-Workspace（装配持久化）

| 文件 | 职责 | LOC |
| --- | --- | --- |
| `workspace/use-workspace.ts` | 加载/保存工作区布局（经后端 server） | ≤160 |
| `workspace/autosave.ts` | 防抖自动保存 | ≤80 |

---

## 5. core ↔ xyflow 映射（关键设计）

**真相只有一份**：core 域的 `Node/Edge`（00 §5）。xyflow 需要它自己形态的 `nodes/edges`，二者由 store + adapter 衔接。

**存储策略**：store 直接持 xyflow 形态的 `nodes/edges`，把 core 域数据内嵌进 `data`，避免双向同步开销：

```ts
// xyflow 节点：node.type=契约类型；position=视图；data=运行真相（00 §5.3 view/runtime 分离）
type FlowNode = XYNode<{
  state: NodeState;              // 运行状态（由后端 SSE 同步，只读缓存）
  properties: Record<string, unknown>;
}>;
// 约定：xyflow node.type === core Node.type === NodeContract.type（00 §5.3），
//      由 nodes/registry 喂给 xyflow `nodeTypes` 选中对应 React 组件——不另设 contractType 字段。

// xyflow 边：携带 core Edge 的 lane/payloadType（00 §5.4）
type FlowEdge = XYEdge<{ lane: Lane; payloadType: string; semanticKind?: string }>;
```

**端口 = typed Handle**：节点组件用 xyflow `<Handle id={port.id} type={port.dir==='out'?'source':'target'} .../>` 摆端口；`id` 即 core 端口 id。

**连接校验（编辑期类型防线，00 §7）**：

```text
用户从 A.report_out 拖向 B.message_in
   │
   ▼ xyflow 调 isValidConnection(conn)
validate-connection: 由 conn.source/sourceHandle/target/targetHandle
   定位两端 Port（经 core/contracts）→ core/validate.canConnect(sourcePort,targetPort)
   │  ├─ 相容 → 允许落点
   │  └─ 不相容 → xyflow 拒绝连接 + ui-store 记录原因 → 高亮提示
   ▼ onConnect → commands.addEdge → graph-store（+ 撤销栈）→ mirror 到后端
```

**与后端同一函数**：`canConnect` 就是后端 message-bus 运行期用的那个（00 §2.2），消灭前后端类型枚举漂移。

---

## 6. 状态、撤销与 view/runtime 分离

- **单一来源**：`graph-store`（Zustand）持 nodes/edges；组件用选择器订阅，避免无谓重渲染。
- **命令唯一入口**：结构变更（增删节点/边、改属性）必经 `commands`，用 `zundo` 得撤销/重做——与后端事件溯源同构（前端命令 ≈ 后端事件）。
- **view/runtime 分离**（00 §5.3）：节点 `position`=视图存前端；`data.state/properties`=运行真相，由 L-Sync 从后端同步，前端只读缓存，不双写。
- **重渲染**：交给 React 协调 + Zustand 细粒度订阅，告别现状全量 `renderAll`。

---

## 7. 模块依赖与红线

层级（rank 越小越底层；依赖只朝下）：

```text
0  core/（共享 TS 包）
1  lib
2  state
3  graph(adapters/connection/edges)
4  nodes / inspector
5  sync
6  workspace / app
```

```text
app ─► workspace ─► sync ─► nodes/inspector ─► graph ─► state ─► lib ─► core
                      │                                   ▲
                      └──(SSE 事件)──► state 更新 ─► React 重渲染 ─┘
```

红线（与 00 §6 一致，由 ESLint boundaries 机械执行，见 30-guardrails）：
- 依赖朝下，禁向上/跨层；
- `editor/` 不 import `runtime/`；
- 「能否连接」只问 `core/validate`；
- 无环。

---

## 8. 关键数据流时序

### 8.1 连线（编辑期类型防线）

见 §5 时序图——`isValidConnection → core/validate`，相容才落点，再镜像后端。

### 8.2 后端事件驱动重渲染（运行期可视化）

```text
后端 event-log 新增 message.delivered{edgeId}   （事件名见 00 §5.6 共享词表）
   │
   ▼ sync/sse 收到 → graph-store.applyRuntimeEvent
更新对应节点 data.state / 边 data.lastPayloadSummary（只读缓存）
   │
   ▼ React 重渲染：TypedEdge 高亮该边、节点按 state 变色、检视器刷新最近事件
```

### 8.3 命令与撤销

```text
任何结构变更 → commands.dispatch(cmd) → zundo 记录 → graph-store 变更 → 镜像后端
Ctrl+Z → zundo.undo() → store 回退 → （可选）镜像撤销到后端
```

---

## 9. 与现状 canvas.js 的映射

| 现状 canvas.js | 新栈 |
| --- | --- |
| 平移/缩放/视口、拖动、选择、小地图、边路由 | **xyflow 内置**（不再手写） |
| `renderAll`/`makeTileEl`/`renderLinks` 全量重绘 | React 协调 + 自定义节点/边组件 |
| 全局 `app` + 零散 `Map` | `graph-store`（Zustand）+ 选择器 |
| 散落的 `addTile/deleteTile/addLink` | `state/commands`（统一入口 + 撤销） |
| `tiles.mjs` 注册表 | `core/contracts`（共享契约）+ `nodes/registry`（视图） |
| 各 `wire*Tile()`（terminal/agent/chat/...） | `nodes/<type>/Node.tsx` + `Inspector.tsx` |
| 内嵌 Contex 轮询/SSE/命令 drain/镜像 | `sync/*` 适配器 |
| 对话框 | `app` + 检视器 + 各节点组件 |

---

## 10. 测试策略

- 框架：**Vitest**（与 Vite 一体）+ React Testing Library。
- `state`（store/命令/撤销）、`graph/adapters`、`connection`（连接校验）→ 纯逻辑单测，重点覆盖。
- `core/`：同构 TS 单测，前后端共享夹具。
- 节点组件 / 检视器：RTL 渲染断言（契约驱动检视器快照）。
- `sync`：注入 mock adapter / mock SSE 断言事件→store→渲染。
- 端到端冒烟：建节点→连线（类型校验）→镜像→SSE 高亮（可用 Playwright，替代现状 browser-smoke）。

---

## 11. 开放问题

- 撤销用 `zundo` 还是自写命令栈？（倾向 zundo，省事且与 Zustand 一体）
- 后端同步要不要引 TanStack Query，还是 sync 适配器自管？（倾向自管，契合 §1 抽象边界）
- 端口默认是否全部可见，还是「高级模式」才显示次要端口？（影响 Node.tsx Handle 渲染）
- xyflow 的受控/非受控用法：完全受控（store 持 nodes/edges）确定，但大图性能需实测。
- UI 组件库是否引入（如 shadcn/Radix）做检视器/工具栏，还是裸 React？

> 本文定稿后，目录结构、各层模块清单、依赖方向即为前端开工基线。具体节点的渲染/检视细节属功能阶段，长在此地基之上。
</content>
