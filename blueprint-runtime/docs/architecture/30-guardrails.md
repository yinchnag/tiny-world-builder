# 代码护栏设计（30-guardrails）

> 本文承接 [`00-overview.md`](./00-overview.md) 与 [`../DEVELOPMENT_GUIDE.md`](../DEVELOPMENT_GUIDE.md)。
> 目标：把 GUIDE 的**文档约定**升级成**会失败的可执行护栏**——分层、体积、契约正确性不靠自觉，靠机械判定、违规即红。
> 技术栈为 TypeScript + Vite + ESLint + Vitest，所以护栏**大部分由 ESLint/TS 生态直接提供**（flat config + 现成插件），只有领域专属的契约校验与测试镜像需自写少量脚本。

---

## 1. 为什么要护栏

文档约定会腐化：时间一长总有人往上层 `import`、让 `core/` 偷偷引 `node:fs`、写出 600 行文件、
定义一个端口忘了声明类型。**地基越干净，侵蚀的代价越隐蔽。**
护栏把这些变成提交时就炸的红灯。

护栏覆盖 6 项中的 **5 项保留**（用户已决定**取消 G3 零依赖守卫**，依赖改白名单制，见 GUIDE §2/§3）：

| ID | 护栏 | 守什么 | 由谁执行 |
| --- | --- | --- | --- |
| **G1** | 架构边界 | 依赖方向 / `core/` 中立 / 前后端不直连 / 无环 | ESLint（boundaries / import） |
| **G2** | 体积·复杂度 | 文件≤500 / 函数≤100 / 参数≤5 / 嵌套≤4 / 复杂度≤15 | ESLint（core 规则，AST 精确） |
| ~~G3~~ | ~~零依赖~~ | **已取消**——改为依赖白名单（登记+理由），非护栏强检 | — |
| **G4** | 契约自校验 | NodeContract 元校验（端口命名/lane 一致/类型已注册/状态机合法） | 自写（`core` + Vitest） |
| **G5** | 注释覆盖 | 文件头注释 + 导出 JSDoc 存在 | ESLint（jsdoc / header） |
| **G6** | 测试镜像 + 覆盖率 | 每模块有同名测试 + 覆盖率门槛 | 自写脚本 + Vitest coverage |

> **G2 的好处兑现**：TS 走构建、ESLint 有完整 AST，函数长度/嵌套/复杂度是**精确判定**，不再有早期 vanilla 版的「花括号启发式」妥协。

---

## 2. 三种执行形态

```text
   npm run lint   ──►  ESLint flat config  ──►  G1 G2 G5      （AST 静态分析，精确）
   npm test       ──►  Vitest              ──►  G4 G6(覆盖率) （断言 + 覆盖率门槛）
   npm run check  ──►  tools/guard/*.ts    ──►  G4 G6(镜像)   （契约元校验 + 测试镜像存在性）
                          └─ 聚合上面三者，任一失败即退出非 0（CI 红）
```

- `npm run check` 是总入口：跑 `lint` + `test` + 自写镜像/契约检查，统一退出码。
- **G4 双保险**：契约元校验既在 `core/contracts` 注册时实时跑（写错当场炸），又有 Vitest 用例离线兜底。

---

## 3. 逐护栏详规

### G1 · 架构边界（最高价值）

把 00 §6 的依赖红线交给 ESLint 机械执行。

**工具**：`eslint-plugin-boundaries`（定义层级元素 + 允许的依赖方向）配合 `import/no-restricted-paths` / `no-restricted-imports`。

**层级配置**（boundaries elements，越底层越被依赖；此 rank 仅用于 ESLint 边界排序，与 10/20 的「L-层标号」是不同维度，不必一一对应）：

```text
rank  元素（按目录归类）
  0   core
  1   runtime/kernel · editor/lib
  2   runtime/persist · editor/state
  3   runtime/engine  · editor/graph
  4   runtime/mcp     · editor/nodes · editor/inspector
  5                     editor/sync
  6                     editor/workspace · editor/app
  ─   runtime/cross（横切：logger/auth/audit）—— 不入 rank 阶梯，见下
```

> **横切层特例**：`runtime/cross` 是 cross-cutting 元素，可被后端任意层 import（logger/auth 纯下层无依赖；audit 是 event-log 的只读视图，仅依赖 persist）。它**不**进 rank 阶梯，但受 R6 约束：只能向下依赖、绝不 import engine/mcp 等业务/上层。这与 00 §3/§6 把横切置于底部、可被各层调用一致。

**规则**（违反即 ESLint error）：

```text
R1 依赖朝下：元素只能 import rank ≤ 自身的元素（boundaries/element-types）
R2 core 中立：core/** 禁止 import 'node:*' 与浏览器全局（no-restricted-imports + env 约束）
R3 前后端不直连：editor/** 禁 import runtime/**，反之亦然（boundaries/no-private + path 限制）
R4 无环：import/no-cycle
R5 类型判定唯一出口：editor/runtime 里「连接/类型相容」判断只许 import core/validate
R6 横切单向：runtime/cross 可被各层调用，但自身只向下依赖，禁 import 业务/上层（对应 00 §6 第4条）
```

**失败示例**（ESLint 直接在编辑器内标红）：

```text
✗ editor/sync/mcp-client.ts  import '../../runtime/mcp/tools/links'
    boundaries/element-types: 'editor' 不可依赖 'runtime'（前后端不直连，00 §6 R3）
✗ core/graph/node.ts  import 'node:crypto'
    no-restricted-imports: core/ 须平台中立（00 §2.3）
```

### G2 · 体积·复杂度

由 ESLint 核心规则精确判定（含注释空行）：

| 规则 | 阈值 |
| --- | --- |
| `max-lines` | 500 |
| `max-lines-per-function` | 100 |
| `max-params` | 5 |
| `max-depth` | 4 |
| `complexity` | 15 |

> React 组件同样受约束；JSX 偏大时按子组件拆分。阈值集中在 `eslint.config.ts`。

### G4 · 契约自校验（领域专属，自写）

对 `core/contracts` 每个 `NodeContract`（00 §5.3）做元校验，让"写错节点定义"在注册期就炸。

```text
C1 端口命名：input 端口 id 以 _in 结尾且 dir==='in'；output 以 _out 结尾且 dir==='out'
C2 端口唯一：同契约内端口 id 不重复
C3 lane 一致：port.lane === 其 payloadType 的 lane（00 §5.1/§5.2）
C4 类型已注册：port.payloadType ∈ 已注册 PayloadType
C5 状态机合法：state.initial ∈ values；每条 transition 的 from/to ∈ values
C6 family 合法：∈ {human,execution,context,task,observation,integration}
C7 runtime 合法：∈ {contex,editor,integration}
```

**落点**：`core/contracts/registry.ts` 的 `register()` 内调 `validateContract()`，失败抛 `code='contract.invalid'`；
`core/contracts/contracts.test.ts` 遍历全部契约离线兜底。TS 类型先挡一层，元校验挡类型挡不住的语义错。

### G5 · 注释覆盖（软）

把 GUIDE §4「教程级注释」变成存在性门槛：

| 检查 | 工具 |
| --- | --- |
| 文件头注释块存在 | `eslint-plugin-header`（或 jsdoc 的 file-overview 规则） |
| 导出函数有 JSDoc + `@param`/`@returns` | `eslint-plugin-jsdoc`（`require-jsdoc` + `require-param`/`require-returns`） |

> 局限（诚实）：只能查"有没有"，查不了"好不好"。质量仍靠评审（GUIDE §11）。

### G6 · 测试镜像 + 覆盖率（软）

| 检查 | 工具 |
| --- | --- |
| 每个 `core|runtime|editor` 源文件有对应 `*.test.ts` | 自写 `tools/guard/mirror.ts`（遍历比对） |
| 覆盖率门槛（起步 line ≥ 80%，分层可差异化） | Vitest `coverage.thresholds` |

> 豁免：纯类型/常量文件（无逻辑）可在 `tools/guard/config.ts` 白名单登记免镜像。

---

## 4. 工具与配置布局

护栏自身也守 §G2（≤500/≤100）。绝大部分是配置，自写脚本极少：

```text
eslint.config.ts            G1 + G2 + G5（flat config + boundaries/import/jsdoc/header 插件）
vitest.config.ts            G6 覆盖率门槛 + 测试环境（node / jsdom）
tools/guard/
  check.ts                  总入口：编排 lint + test + 下列自写检查，聚合退出码   ≤120
  mirror.ts                 G6 测试镜像存在性                                   ≤120
  config.ts                 阈值与豁免白名单（单一可调处）                       ≤100
core/contracts/
  registry.ts               含 validateContract()（G4 运行时校验）
  contracts.test.ts         G4 离线兜底
```

> G1/G2/G5 几乎零自写代码——靠成熟插件。这正是放宽零依赖、上 TS/ESLint 后的红利。

---

## 5. 配置与豁免

- **阈值集中**：ESLint 阈值在 `eslint.config.ts`，镜像/覆盖率阈值在 `tools/guard/config.ts` 与 `vitest.config.ts`。
- **依赖白名单**：取代 G3。新增 npm 依赖须在 `package.json` + 一处 `DEPENDENCIES.md`（或 config 注释）登记理由；评审检查"是否登记"。白名单增长即技术债信号。
- **豁免最小化**：默认无豁免。确需例外用 ESLint 行内 `// eslint-disable-next-line <rule> -- 理由` 且必须带理由，评审追踪其数量。

---

## 6. 失败输出

ESLint/Vitest 原生输出已可点击定位（file:line + rule id）。自写检查对齐同风格：

```text
✗ G6 测试镜像缺失  runtime/engine/scheduler.ts
    缺少 runtime/engine/scheduler.test.ts（GUIDE §8）
    修法：补同名测试，或在 tools/guard/config.ts 白名单登记理由

护栏汇总：lint ✗1  test ✓  mirror ✗1 → 退出码 1
```

---

## 7. F-guard 阶段（先于 F0）

护栏先于第一行业务代码存在。F-guard 是 GUIDE §10 的第一个阶段。

**交付物**：monorepo 脚手架（workspaces + Vite + TS 配置）+ `eslint.config.ts` + `vitest.config.ts` + `tools/guard/*` + `npm run check` 脚本。

**验收**：
1. 空骨架仓库 `npm run check`（lint+test+镜像）全绿、无误报。
2. 一组**故意违规夹具**逐项被对应护栏红灯拦下（无漏报）：向上 import、跨前后端 import、`core/` 引 `node:*`、600 行文件、137 行函数、坏契约、缺测试、裸导出无 JSDoc。
3. `validateContract` 对坏契约在 `register()` 时即抛 `contract.invalid`。

> F-guard 通过才进 F0。此后**每一行 `core/` 代码从诞生起就活在护栏里**。

---

## 8. 与既有文档的关系

- 本文是**阈值与规则的唯一权威**；与 GUIDE §3 的数字冲突以本文为准（已同步 GUIDE 加 F-guard 行、改依赖为白名单、测试改 Vitest）。
- 00 §6 的依赖红线由 G1（ESLint boundaries）落地执行。

---

## 9. 开放问题

- G6 覆盖率门槛起步定多少（80%？分层差异化：`core`/纯逻辑更高，UI 组件略低？）。
- G5 是否进一步要求"导出函数注释含流程说明段"，还是只查 `@param/@returns` 存在？
- 依赖白名单登记放 `package.json` 注释、独立 `DEPENDENCIES.md`、还是 ESLint 自定义规则强检？
- 是否加**可选** git pre-commit hook 跑 `npm run check`（默认不强加，尊重本地工作流）。

> 本文与 GUIDE 已对齐。下一步：进入 **F-guard** 实现（搭 monorepo + 护栏），再到 **F0** 写 `core/`。
</content>
