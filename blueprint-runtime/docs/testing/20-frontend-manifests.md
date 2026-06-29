# 测试清单 · 前端（testing/20）

> 继承 [`00-fixtures-and-manifests.md`](./00-fixtures-and-manifests.md)。本文是**占位骨架**，进入 **F4** 前按 execution/00 §3 停-问填满，现在不写臆测用例。

---

## 待填模块（进入 F4 时逐一定稿）

```text
state/graph-store.ts                   单一来源读写、选择器订阅
state/commands.ts                      结构变更经命令、zundo 撤销/重做
graph/adapters/to-xyflow.ts            core Node/Edge → xyflow（端口 → Handle）
graph/adapters/from-xyflow.ts          xyflow 变更 → core 域更新
graph/connection/validate-connection.ts  isValidConnection → core/validate
nodes/registry.ts                      type → 组件映射
inspector/InspectorPanel.tsx           契约驱动渲染
sync/mirror.ts, sync/sse.ts            镜像与事件应用（mock adapter）
```

---

## 复用黄金夹具

> 前端连接校验用例**直接复用** testing/00 §3 黄金夹具的 E1（正）/ X1–X3（负），与后端 `message-bus` 同一份夹具——这正是「编辑期与运行期同一函数」（00 §2.2）的验收对照。
> editor 支可与 runtime 并行（GUIDE §10）；集成前所有 sync 测试对 **mock adapter + 冻结契约** 编码，真集成测试归 Fx 阶段。
