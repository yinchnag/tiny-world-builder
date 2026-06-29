# Blueprint Runtime

把 CodeSurf + Contex **全栈重写**为 Blueprint 式可视化图运行时（对标 Unreal Blueprints / Unity Visual Scripting 的深层模型，而非其 UI）。

```text
CodeSurf = 多 Agent 工作流「蓝图编辑器」（前端）
Contex   = 「图运行时」+ 消息总线 + 状态机 + 策略层 + 审计日志（后端）
```

本目录是**全栈重写的所在地**（不是「跨项目协调轨」）。代码与设计都在这里。

## 技术栈（已定）

- 共享 `core/`：**TypeScript** 纯模型包（节点契约 / 端口类型 / 边 / 校验），前后端各自 import，编辑期与运行期共用同一套类型判定。
- 后端 `runtime/`：**TypeScript（Node）**，事件溯源 + 状态机 + 类型化消息总线 + MCP。
- 前端 `editor/`：**React + Vite + [xyflow](https://reactflow.dev) + TypeScript + Zustand**。
- 测试 **Vitest**；护栏 **ESLint**（架构边界 / 体积）+ 契约自校验；monorepo（**pnpm** workspaces，设定基线见 `docs/architecture/30-guardrails.md` §7）。
- 依赖白名单制（登记 + 理由），非绝对零依赖。

## 从这里开始（设计文档）

```text
docs/architecture/00-overview.md          总览 · 共享 core 模型 · 全景分层 · 规范数据结构 · 依赖红线（母版）
docs/architecture/10-backend-foundation.md 后端图运行时底层
docs/architecture/20-frontend-foundation.md 前端图编辑器底层（React + xyflow）
docs/architecture/30-guardrails.md         代码护栏（ESLint + 契约自校验 + 测试镜像）
docs/DEVELOPMENT_GUIDE.md                  开发指导 · 硬约束 · 注释规范 · 阶段顺序（F-guard → F0–F6）
docs/execution/                            执行协议（AI 作业契约：循环 · 停问 · 完工闸门 · 阶段交接）00 全局 / 10 后端 / 20 前端
docs/testing/                              测试清单 + 黄金夹具（验收内容唯一源）00 全局 / 10 后端 / 20 前端
docs/vision/                               愿景层（高视野「要做成什么」）：runtime-design / node-inventory / node-evolution
```

阅读顺序：先 `00-overview`，再按需 10/20/30/GUIDE；**开工前读 `execution/00` + `testing/00`**。进度见 `PROGRESS.md`。

## 当前状态

底层设计文档集已成稿、评审中；尚未开始写代码。下一步是 **F-guard**（搭 monorepo 脚手架 + 护栏），再 **F0**（写 `core/`）。详见 `PROGRESS.md`。

> 注：早期散落在 `CodeSurf/`、`Contex/` 下的重复蓝图文档已删除，本目录 `blueprint-runtime/` 是唯一权威。
</content>
