# 测试清单与黄金夹具 · 全局（testing/00）

> 本文把「测什么」从执行者手里收归规范：**每模块的必含用例由清单钉死，测试数据由唯一黄金夹具提供**。
> 这样 `30-guardrails` G4/G6 就从「查测试存不存在」升级为「查是否符合规范」。
> 后端/前端逐模块清单见 [`10-backend-manifests.md`](./10-backend-manifests.md) / [`20-frontend-manifests.md`](./20-frontend-manifests.md)（增量，不复制本文）。

---

## 1. manifest 格式约定

每个模块在对应清单里占一段，固定三栏：

```text
模块：runtime/engine/message-bus.ts
夹具：golden-graph（§3）
必含用例（每条 = 一个 it()，case_id 用 snake_case）：
  routes_compatible_payload   相容载荷 → 产出 message.delivered{edgeId}
  rejects_incompatible        不相容 → message.rejected{reason:'payload.incompatible'}，不投递
  rejects_lane_mismatch       lane 不同 → reason:'lane.mismatch'
```

规则：清单列出的用例**必须全部存在且绿**；少一条 ＝ 未完工（execution/00 §4）。执行者可加更多用例，但**不得删/改清单用例的断言意图**。

---

## 2. 黄金夹具为什么唯一

每个 session 各自造测试图，必然漂。整套测试只用**一份**标准图 + 一段标准事件序列；因 `core/` 同构，**同一夹具前后端共用**（前端连线校验、后端总线路由都喂它）。

---

## 3. 黄金夹具规格（golden-graph）

落地位置（实现期）：`core/test/fixtures/golden-graph.ts`，前后端 import。

**标准图**（最小但覆盖各 lane 与正反例）：

```text
节点：
  A  agent      out: report_out:AgentReport, message_out:AgentMessage
                in:  message_in:AgentMessage, context_in:ContextBundle
  B  agent      （同 A）
  D  document   out: selection_out:DocumentSelection
  H  human      in:  question_in:HumanAttention   out: reply_out:HumanReply

合法边（正例，各 lane 至少一条）：
  E1  A.report_out    → B.message_in    AgentReport→AgentMessage   相容（message lane）
  E2  D.selection_out → A.context_in    DocumentSelection          相容（context lane）

反例边（负向测试用，不入图，仅供 canConnect 断言）：
  X1  A.report_out    → H.question_in   payload.incompatible
  X2  A.message_out   → B.message_out   direction.invalid（out→out）
  X3  D.selection_out → A.message_in    lane.mismatch（context vs message）
```

**标准事件序列**（喂投影 / 总线 / SSE 测试）：

```text
seq1  node.transitioned {node:A, from:idle, to:working, trigger:start}
seq2  message.sent       {node:A, port:report_out, payloadType:AgentReport}
seq3  message.delivered  {edge:E1}
seq4  message.rejected   {edge:X1, reason:'payload.incompatible'}
```

> 夹具一旦改动属于动验收基线 → 走停-问（execution/00 §3）。

---

## 4. core/ 测试清单（共享，F0 验收）

| 模块 | 必含用例（意图） |
| --- | --- |
| `validate.canConnect` | 每 lane 一条相容正例（E1/E2…）；负例**逐一覆盖 00 §5.7 每个码**：lane.mismatch / payload.incompatible / port.not_found / direction.invalid / cardinality.exceeded |
| `validate.validateGraph` | required.unmet（必填 in 口未连）；无环图通过；带环图被拒 |
| `contracts.validateContract` | 逐一覆盖 30 G4 的 C1–C7（坏契约各一例 → `contract.invalid`） |
| `types/compatibility` | 相容矩阵正例 + 跨 lane 负例 + 同类型自相容 |
| `state/machine` | 合法转移通过；非法转移被拒且无副作用；initial ∈ values |
| `events` | `isKnownEventType` 认地基闭集（00 §5.6）、拒未登记名 |

---

## 5. 与护栏衔接

- 30 G6 镜像守卫保证「每源文件有同名测试」；本清单进一步保证「测试里有这些具名用例」。
- 缺清单用例 ＝ 未完工；新增契约却没在清单加用例 ＝ 停-问没走完。
