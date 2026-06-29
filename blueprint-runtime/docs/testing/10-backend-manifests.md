# 测试清单 · 后端（testing/10）

> 继承 [`00-fixtures-and-manifests.md`](./00-fixtures-and-manifests.md) 的格式与黄金夹具。本文逐模块列后端必含用例。
> 新增模块或拿不准用例 → 停-问（execution/00 §3）。

---

## L3 Persist

```text
event-log.ts            夹具：golden 事件序列
  appends_with_incrementing_seq   连续 append → seq 严格 +1
  scan_returns_in_order           scan 顺序 == 写入顺序
  immutable_no_overwrite          尝试改写已写事件 → 失败 / 不可达
  head_reports_latest_seq

projections/nodes.ts    夹具：golden 事件序列
  pure_same_sequence_same_state   同序列重放两次结果相等
  projects_node_state             seq1 后 A 状态 == working
  ignores_unrelated_events

snapshot.ts
  restore_plus_replay_equals_full restore + 增量重放 == 从 seq0 全量
  take_is_pure_snapshot
```

> `projections/{tasks,messages,claims}.ts` 同 nodes 模式：pure / 正确投影 / 忽略无关——各自补具名用例。

---

## L4 Engine

```text
node-machine.ts
  legal_transition_emits_event    合法转移 → node.transitioned
  illegal_transition_rejected     非法转移被拒且无副作用

message-bus.ts          夹具：E1 正例 / X1·X2·X3 反例
  routes_compatible_payload       E1 → message.delivered{edgeId}
  rejects_incompatible            X1 → message.rejected{reason:'payload.incompatible'}，不投递
  rejects_lane_mismatch           X3 → reason:'lane.mismatch'
  uses_same_validate_as_editor    断言走 core/validate（与前端同函数）

edge-policy.ts
  directed_reverse_blocked        反向投递被拒
  retry_hook_invoked              骨架钩子可注入并被调用

scheduler.ts
  ready_queue_fifo                就绪队列顺序
```

---

## L5 Protocol

```text
middleware.ts
  chain_order_auth_idem_ctx_handler   组合顺序断言
  idempotency_hit_returns_cache       幂等命中返缓存且不二次入日志

transport.ts
  jsonrpc_roundtrip                   合法请求往返
  jsonrpc_error_shape                 错误响应符合 JSON-RPC 2.0
  sse_resume_by_last_event_id         断线按 Last-Event-ID 重放

resources.ts
  reads_projection_view               context:// 读到投影视图（非直接表）

sse.ts
  pushes_appended_event               event-log 追加 → 订阅端收到
```

---

## 横切

```text
cross/auth.ts     valid_token_passes / invalid_token_rejected / scope_enforced
cross/logger.ts   redacts_sensitive_fields
cross/audit.ts    timeline_is_readonly_view（只读，绝不写 event-log）
```
