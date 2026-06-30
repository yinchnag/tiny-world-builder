# 依赖白名单（DEPENDENCIES）

> 取代 G3 零依赖守卫（30 §5/§9）。**每个 npm 依赖一行**：包名 + 版本范围 + 理由 + 登记日期。
> 评审检查「新增依赖是否在此登记」。白名单增长即技术债信号。

## devDependencies（构建/护栏/测试，不进产物）

| 包 | 范围 | 理由 | 登记日 |
| --- | --- | --- | --- |
| `typescript` | ^5.7 | 全栈语言；类型检查 `tsc --noEmit`（30 §7） | 2026-06-30 |
| `tsx` | ^4.19 | 直跑 TS（脚本/护栏入口），免预编译（30 §7） | 2026-06-30 |
| `vitest` | ^3.0 | 测试框架（前后端统一，GUIDE §8） | 2026-06-30 |
| `@vitest/coverage-v8` | ^3.0 | G6 覆盖率门槛 | 2026-06-30 |
| `eslint` | ^9.18 | 护栏 G1/G2/G5（flat config） | 2026-06-30 |
| `typescript-eslint` | ^8.20 | ESLint 的 TS 解析与规则（G2 精确判定） | 2026-06-30 |
| `eslint-plugin-boundaries` | ^5.0 | G1 架构边界（依赖方向/分层） | 2026-06-30 |
| `eslint-plugin-import` | ^2.31 | G1 无环（`import/no-cycle`）+ 跨层路径限制 | 2026-06-30 |
| `eslint-plugin-jsdoc` | ^50.6 | G5 注释存在性（文件头 + @param/@returns） | 2026-06-30 |
| `globals` | ^15.14 | ESLint 全局环境定义 | 2026-06-30 |
| `jiti` | ^2.4 | 让 ESLint 加载 `eslint.config.ts`（TS flat config） | 2026-06-30 |
| `@types/node` | ^22.10 | Node 内置类型（runtime/tools） | 2026-06-30 |
| `vite` | ^6.0 | 前端构建/Dev（editor） | 2026-06-30 |
| `@vitejs/plugin-react` | ^4.3 | Vite React 插件 | 2026-06-30 |
| `@types/react` / `@types/react-dom` | ^18.3 | React 类型 | 2026-06-30 |
| `@testing-library/react` | ^16.1 | 组件单测（RTL） | 2026-06-30 |
| `jsdom` | ^25.0 | 组件单测 DOM 环境（vitest） | 2026-06-30 |
| `@playwright/test` | ^1.61 | 前端真浏览器 E2E（GUIDE §8 / 20 §）：用户可见/可操作/有反馈的关键流（连线校验、节点创建、SSE 高亮） | 2026-06-30 |

## dependencies（进产物）

| 包 | 范围 | 理由 | 登记日 |
| --- | --- | --- | --- |
| `zod` | ^3.24 | 载荷字段级 schema（00 §5.9）：一份 schema → TS 类型 + JSON Schema + 运行期 parse；纯 JS 平台中立，置于 `core/` | 2026-06-30 |
| `react` / `react-dom` | ^18.3 | 前端框架（editor，20-frontend 技术栈） | 2026-06-30 |
| `@xyflow/react` | ^12.3 | 节点图画布——平移/缩放/端口拖连/边路由/小地图（20 §2 现成基础设施） | 2026-06-30 |
| `zustand` | ^5.0 | 图文档 store（单一来源 + 选择器，20 §6） | 2026-06-30 |
| `zundo` | ^2.3 | 命令撤销/重做（与 Zustand 一体，20 §6） | 2026-06-30 |

> editor devDependencies（构建/测试）：`vite` `@vitejs/plugin-react`（构建/Dev）、`@types/react(-dom)`、`@testing-library/react` `jsdom`（组件单测）——登记在 devDependencies 区。
