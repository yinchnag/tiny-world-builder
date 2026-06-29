# 测试清单 · 前端（testing/20）

> 继承 [`00-fixtures-and-manifests.md`](./00-fixtures-and-manifests.md) 的格式与黄金夹具。本文逐模块列前端必含用例。
> editor 支可与 runtime 并行（GUIDE §10）；集成前所有后端交互对 **mock adapter + 冻结契约** 编码，真集成测试归 Fx。
> 框架 Vitest + React Testing Library；新增模块或拿不准用例 → 停-问（execution/00 §3）。

---

## L-State

```text
state/graph-store.ts        夹具：golden-graph
  single_source_holds_nodes_edges   持 xyflow 形态 nodes/edges，core 域数据内嵌 data
  selector_subscription_scoped      改一个节点只通知订阅它的选择器，不全量
  apply_runtime_event_updates_cache message.delivered → 对应边 data 只读缓存更新

state/commands.ts
  add_edge_via_command              加边必经 command
  undo_reverts_structure            zundo undo 回退
  redo_reapplies                    redo 重做
  property_change_is_undoable

state/selection-store.ts
  tracks_selection_set
state/ui-store.ts
  holds_connection_reject_reason    连线被拒原因可读（供高亮，§5.7 码）
```

---

## L-Graph

```text
graph/adapters/to-xyflow.ts        夹具：golden-graph
  maps_node_type_position_data      core Node → xyflow node
  maps_ports_to_handles             端口 → Handle（id==端口id，dir→source/target）
  maps_edge_lane_payload            core Edge → xyflow edge（携 lane/payloadType）

graph/adapters/from-xyflow.ts
  position_change_to_core_view      位置变更 → core view
  connect_to_core_edge              onConnect → core 端口级 Edge

graph/connection/validate-connection.ts   夹具：E1 正 / X1·X2·X3 反
  accepts_compatible                E1 通过
  rejects_incompatible_with_reason  X1 → reason:'payload.incompatible'
  rejects_lane_mismatch             X3 → reason:'lane.mismatch'
  rejects_direction                 X2 → reason:'direction.invalid'
  uses_core_validate                断言走 core/validate.canConnect（与后端同函数）

graph/edges/TypedEdge.tsx
  colors_by_lane
  shows_payload_label
  highlights_on_runtime_event       收 message.delivered → 高亮
```

---

## L-NodeUI / Inspector

```text
nodes/registry.ts
  maps_type_to_components           type → {node, inspector}
  feeds_xyflow_nodetypes            喂 xyflow nodeTypes
inspector/InspectorPanel.tsx        夹具：golden-graph 的 agent 契约
  renders_ports_state_actions       按 core/contracts 渲染端口/状态/动作
  falls_back_to_generic             无专属 Inspector → 通用契约驱动
```

> 具体 `nodes/<type>/Node.tsx`·`Inspector.tsx` 属功能阶段（BP）；地基只测 `registry` + `InspectorPanel` + 一个最小通用节点。

---

## L-Sync（对 mock + 冻结契约）

```text
sync/runtime-adapter.ts
  noop_offline_works                no-op：mirror/save 返 ok 不发网，subscribe 返空取消
sync/mcp-client.ts                  对冻结的 JSON-RPC 封套（00 §5.8，mock fetch）
  builds_jsonrpc_request
  parses_error_shape
  matches_protocol_samples          产出 REQ_CALL、解析 RES_OK/RES_FAIL/ERR_PROTO
sync/sse.ts
  dispatches_event_to_store         mock SSE → graph-store.applyRuntimeEvent
  resumes_by_last_event_id
  consumes_sample_sse_frame         消费 SSE_FRAME（protocol-samples）
sync/mirror.ts
  mirrors_edge_with_ports           本地加边 → mirror 携端口+lane+payloadType（mock 记录）
```

---

## L-Workspace

```text
workspace/use-workspace.ts
  load_save_roundtrip               （mock adapter）加载→保存往返
workspace/autosave.ts
  debounced_save_fires_once         防抖只触发一次
```
