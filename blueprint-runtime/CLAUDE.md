# Blueprint Runtime — 工作入口

> 你正在 `blueprint-runtime/`（CodeSurf + Contex 的**全栈重写**）下工作：一套**先地基后功能**的蓝图式图运行时。
> 动手前**必须**按下序读文档、并遵守执行协议。本文件只**路由**，规则细节在被指向的文档里，**勿在此复述或另立**。

## 开工前必读（按序）

1. `PROGRESS.md` — 当前阶段、决策基线、待办（开工先读，收工更新）
2. `docs/architecture/00-overview.md` — 共享 `core` 模型 · 规范数据结构（§5）· 依赖红线（§6）【母版】
3. `docs/execution/00-protocol.md` — 作业协议：六步循环 · 停-问 · 完工闸门 · 决策权清单
4. `docs/testing/00-fixtures-and-manifests.md` — 验收：测试清单 + 黄金夹具
5. 按你要动的层再读：`architecture/10`(后端)/`20`(前端)/`30`(护栏) + 同号 `execution/` + `testing/`

## 铁律（细节见上述文档）

- **先地基后功能**：F-guard → F0–F6 未稳定前，不写任何节点业务功能。
- **六步循环**：选任务(按建造序)→ 读规范 → 先写测试(按 manifest)→ 实现到绿 → 跑 check(护栏)→ 收口提交。
- **停-问**：规范沉默/有歧义，或要动**任何契约面**（事件/码/端口/lane/接缝/依赖/阈值/目录/阶段）→ 停下来问，**绝不臆造**。
- **类型判定唯一出口**：能否连接/类型对不对，只问 `core/validate`。
- **前后端不直连**：`editor/` ✗ import `runtime/`，唯一通道是 MCP。

## 现状（重要）

**runtime 支 F2 完成**（L4 引擎，88 测试，2026-06-30）。下一步 **runtime F3**（MCP 协议 + 横切）；editor 支(F4–F6) 可并行起步（未开）。
- 本机 **Node 24.18**（nvm，符合基线）。pnpm 命令需前置 `C:\nvm\nodejs` 到 PATH（旧会话 shell 的 PATH 是陈的）。
- 命令：`pnpm check`（lint+test+镜像）/ `pnpm test` / `pnpm types`。新增依赖登记 `DEPENDENCIES.md`。
- 并行支都 import `@blueprint/core` + 照冻结夹具（golden-graph / protocol-samples）编码；editor 支对 mock，真集成在 Fx。
