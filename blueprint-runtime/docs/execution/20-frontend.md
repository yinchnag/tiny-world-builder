# 执行协议 · 前端（execution/20-frontend）

> 继承 [`00-protocol.md`](./00-protocol.md) 全部规则，本文**只列前端差异**。全局规则不在此复制。

---

## 1. 建造序与并行

- **依赖与并行**：editor 支只卡 **F0 + 契约冻结点**（GUIDE §10），**可与 runtime（F1–F3）并行**；集成（Fx）之前一律对 **mock adapter + 冻结的 MCP 协议封套**编码，不等 runtime 真实现。
- **文件拓扑序**见 [`../architecture/20-frontend-foundation.md`](../architecture/20-frontend-foundation.md) §3/§7（层级 lib → state → graph → nodes/inspector → sync → workspace/app）。按那张序，逐文件走 00 §2 的六步循环。

阶段内建造序（先底后顶）：

```text
F4 State+Graph   lib → state(graph-store → commands → selection/ui)
                 → graph/adapters(to-xyflow, from-xyflow) → graph/FlowCanvas → app 外壳
   冒烟：渲染黄金夹具的图；拖动节点更新 store；undo/redo 回退

F5 连接+Sync     graph/connection/validate-connection → graph/edges/TypedEdge
                 → sync/runtime-adapter(接口+no-op) → mcp-client → sse → mirror
   冒烟：A.report_out→B.message_in 相容落点(E1)；拖 X1/X3 拒绝+显示原因码(§5.7)；
        mock SSE: message.delivered → 边高亮

F6 NodeUI+装配   nodes/registry → inspector/InspectorPanel → 最小通用节点(供冒烟)
                 → app/providers → app/App → workspace/use-workspace → autosave
   冒烟：选中节点→检视器按契约渲染；editor 自身端到端(对 mock)：建节点→连线→(mock)镜像/SSE 走通
```

> **具体节点类型**（agent/document/terminal…）是**功能阶段（BP）**，不在地基。F6 只做 `registry` + 契约驱动 `InspectorPanel` + 一个最小通用节点供冒烟。

每完成 F4/F5/F6 一个阶段，按 00 §6.1 产出「阶段交接」。

---

## 2. 前端专属「必须停-问」

除全局 §3 外，前端再遇下列一律停问：

- 想新增**具体节点类型**（属功能阶段 BP，不该在地基写）；
- 想新增/改 **lane / payloadType**（契约面 → 00 §5）；
- 想改 **core ↔ xyflow 映射策略**（20 §5：store 持 xyflow 形态、core 数据内嵌 `data`）；
- 想**引入 UI 组件库**（shadcn/Radix 等，20 §11 开放问题）或任何新依赖（白名单登记）；
- 撤销方案 **zundo vs 自写**、xyflow **受控/性能策略**等 20 §11 开放问题，定稿前确认。

---

## 3. 前端特有纪律（机器 + 评审共同盯）

- **基础设施交给 xyflow**：禁手写平移/缩放/拖动/连线手势/边路由/小地图（20 §2）；只写蓝图语义。
- **单一来源**：`graph-store` 持 nodes/edges；组件用**选择器**订阅，避免全量重渲染（告别 `renderAll`）。
- **结构变更必经 `commands`**：增删节点/边、改属性走命令（zundo 撤销/重做），不直接改 store。
- **view/runtime 分离**（00 §5.3 / 20 §6）：`position`＝前端视图；`data.state/properties`＝运行真相，由 sync 从后端同步，前端**只读缓存、不双写**。
- **类型判定唯一出口**：连接能否成立只问 `core/validate.canConnect`，前端不另写类型判断（00 §6 R5）。
- **集成前对 mock 编码**：所有后端交互走 mock/no-op adapter + 冻结契约，真集成在 Fx。

---

## 4. 前端冒烟（每阶段收口）

```text
F4  渲染黄金夹具图(A/B/D/H + E1/E2)；拖动节点 position 入 store；undo/redo 回退
F5  连线类型校验：E1 相容落点；X1/X3 拒绝+原因码；mock SSE message.delivered → 边高亮
F6  检视器契约驱动渲染；editor 自身端到端(对 mock)：建节点→连线→镜像/SSE 走通
Fx  跨栈集成冒烟见 GUIDE §10（接真 runtime，不属本支）
```
