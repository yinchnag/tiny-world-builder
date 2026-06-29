# 执行协议 · 后端（execution/10-backend）

> 继承 [`00-protocol.md`](./00-protocol.md) 全部规则，本文**只列后端差异**。全局规则不在此复制。

---

## 1. 建造序（不复述，指向 10）

后端阶段内文件拓扑序与每阶段冒烟见 [`../architecture/10-backend-foundation.md`](../architecture/10-backend-foundation.md) §11。**按那张序，逐文件走 00 §2 的六步循环。**

> runtime 支（F1–F3）与 editor 支**可并行**：本支只依赖 F0 + 契约冻结点（GUIDE §10），不依赖 editor。每完成 F1/F2/F3 一个阶段，按 00 §6.1 产出「阶段交接」。

---

## 2. 后端专属「必须停-问」

除全局 §3 外，后端再遇下列一律停问：

- 想新增/改 **`ERR.*`** 码（kernel 私有错误码也算契约面）；
- 想新增 **事件类型**（即便看似显然，也须先登记进 00 §5.6 再用）；
- 想改 **sqlite schema**（加表/列/索引）或 **迁移版本**；
- 想改 **投影的状态形态**（projection state shape）——它是读路径契约；
- 想调整 **中间件链顺序** 或 **边策略语义**。

---

## 3. 后端特有纪律（机器 + 评审共同盯）

- **投影必须纯**：`apply(ev, prev)` 内禁 `Date.now()`/随机/任何 I/O；同序列重放须同结果（否则快照发散）。
- **event-log 只追加**：任何「改写历史」的实现即错；过期数据靠投影忽略，不删事件。
- **audit 只读**：`cross/audit` 只查 event-log，绝不写。写只发生在 `event-log.append`。
- **ctx 传播**：correlation_id/actor 经 `kernel/ctx` 隐式带，禁手工穿 `opts` 参数。

---

## 4. 后端冒烟（每阶段收口）

按 10 §11 的三条阶段冒烟跑；全绿才算该阶段完工：

```text
F1  append 3 事件 → scan 回放 → 投影状态 == 预期；restore + 增量 == 全量
F2  喂「A 产出 → 经边 → B」序列 → 断言 message.delivered + 状态推进
F3  起本地 server → JSON-RPC 调一个 mutating 工具 → SSE 收到该事件
```
