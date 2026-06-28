# CodeSurf Phase 2 路径输入与首次使用引导记录

日期：2026-06-27

## 目标

让首次用户不阅读额外文档，也能理解 Repository path 的输入要求，并在新建空工作区后知道下一步如何操作。

## 已完成

### Repository path 输入辅助

- 新工作区对话框显示平台感知的路径示例：
  - Windows：`C:\Users\name\project\repo`
  - macOS/Linux：`/Users/name/project/repo`
- 路径字段下方保留常驻说明：路径必须是存在的本机文件夹，且路径只保存在本机。
- 浏览器模式明确提示：需要手动粘贴绝对路径。
- 目录选择按钮在没有桌面 bridge 时禁用，并解释目录选择只在桌面 shell 可用。
- 前端已预留 `window.codesurf.chooseRepositoryFolder()` 检测入口；未来 Electron preload 暴露该函数后，按钮会自动启用。

### 空工作区欢迎卡片

欢迎卡片现在包含四步说明：

1. 添加 Tile；
2. 拖动标题栏移动 Tile；
3. 拖动蓝色端口连接 Tile；
4. Contex 可稍后启用，本地画布、连线和保存不依赖 Contex。

卡片提供两个入口：

- `Add your first Tile`：创建第一个 Tile；
- `Create safe demo layout`：创建一个不执行命令、不读取仓库内容的本地演示布局。

### 安全演示布局

演示布局会创建 3 个本地 Tile：

- `Project brief`：Note；
- `Plan`：Document；
- `Team chat`：Chat。

并建立两条本地连线：

- `Project brief → Plan`
- `Plan → Team chat`

该演示不会启动 Terminal，也不会读取或修改用户仓库。

### 欢迎卡片关闭偏好

- 用户可点击右上角关闭欢迎卡片；
- 关闭偏好记录在 `localStorage` 的 `codesurf:emptyGuideDismissed`；
- 页面刷新后不再强制显示该欢迎卡片。

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
- browser smoke：52/52 通过，无 console/page errors。

## Phase 2 结论

Phase 2 的浏览器模式路径输入、首次使用引导、安全演示布局和关闭偏好已完成。  
原生目录选择还需要 Electron preload/IPC 能力，目前只完成前端能力探测与降级说明。
