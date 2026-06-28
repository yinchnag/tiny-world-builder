# CodeSurf Phase 1 工作区创建反馈记录

日期：2026-06-27

## 目标

让 New workspace 的创建流程形成清晰闭环：空字段能在对话框内看到错误，路径错误能自救，提交中不会重复创建，成功后自动进入新工作区。

## 已完成

### 前端行为

- 表单使用自定义校验，不再依赖浏览器原生 required 气泡。
- 空名称显示 `Enter a workspace name.`，焦点回到名称字段，并标记 `aria-invalid=true`。
- 空仓库路径显示 `Enter an absolute path to an existing local folder.`，焦点回到路径字段，并标记 `aria-invalid=true`。
- 服务端返回 `CODESURF_REPO_INVALID` 时，前端显示安全、可行动文案：`Repository folder not found. Paste an absolute path to an existing local folder.`
- 错误后对话框保持打开，用户输入不丢失。
- 创建请求进行中时：
  - Create 禁用并显示 `Creating…`；
  - form 标记 `aria-busy=true`；
  - Cancel 禁用，并通过 title 解释需要等待创建完成；
  - 重复 submit 被忽略，避免重复工作区。
- 创建成功后关闭对话框、清空表单、加载新工作区，并显示空画布引导。

### 测试覆盖

`CodeSurf/scripts/browser-smoke.mjs` 已覆盖：

1. 首次运行自动打开新工作区对话框；
2. 空名称的内联错误、焦点和 `aria-invalid`；
3. 空仓库路径的内联错误、焦点和 `aria-invalid`；
4. 不存在路径的可恢复错误、输入保留和安全文案；
5. 提交中状态、禁用重复提交、Cancel 禁用说明；
6. 有效路径创建后自动进入工作区；
7. 后续空画布、帮助、快捷键、连线、删除 Undo 和持久化仍正常。

## 验证结果

命令：

```bash
node --check CodeSurf/public/canvas.js
node --check CodeSurf/scripts/browser-smoke.mjs
npm --prefix CodeSurf test
NODE_PATH=/Users/sking/codeSurf/node_modules npm --prefix CodeSurf run smoke:browser
```

结果：

- 语法检查通过；
- `npm --prefix CodeSurf test`：73/73 通过；
- browser smoke：40/40 通过，无 console/page errors。

## Phase 1 结论

Phase 1 的实现任务和验收项已完成。下一步可以进入 Phase 2：路径输入与首次使用引导。
