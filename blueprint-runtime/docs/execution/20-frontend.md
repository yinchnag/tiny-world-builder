# 执行协议 · 前端（execution/20-frontend）

> 继承 [`00-protocol.md`](./00-protocol.md)。本文是**占位骨架**：前端执行细则在进入 **F4** 前按需填满，现在不写臆测规范（违背全局停-问精神）。
> 现阶段（F-guard / F0–F3）开发集中在 `core/` 与后端；本文只先钉下已知骨架。

---

## 1. 何时填满本文

进入 F4（editor State+Graph）**之前**，按 00 §3 停-问把以下各节补全，经评审再开工写前端。

---

## 2. 已知骨架（待 F4 展开）

- **依赖与并行**：editor 支只卡 **F0 + 契约冻结点**（GUIDE §10），**可与 runtime（F1–F3）并行**；F5 对 **mock adapter + 冻结的 MCP 协议封套**编码，真集成在 Fx。
- **建造序**：F4→F5→F6，文件拓扑序见 [`../architecture/20-frontend-foundation.md`](../architecture/20-frontend-foundation.md) §3/§7（届时落进本文 §3）。
- **前端专属「必须停-问」**（初稿，F4 再定稿）：新增**节点类型** / 新 **lane** / 引入 **UI 组件库** / 改 **xyflow 受控性能策略**。
- **前端纪律**：禁手写平移/缩放/连线（交给 xyflow）；`graph-store` 单一来源；结构变更必经 `commands`（撤销）；`data.state` 只读缓存，不双写（20 §6）。

---

## 3. 填写触发

> 当任务进入 F4，第一步不是写代码，而是**先把本文补全并送审**——这本身就是一次 00 §3 的停-问。
