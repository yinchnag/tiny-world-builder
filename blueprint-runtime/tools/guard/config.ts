/**
 * ─────────────────────────────────────────────────────────────
 * 模块：tools/guard/config（护栏配置 · 单一可调处）
 * 职责：集中放护栏阈值与豁免白名单，供 mirror/check 与文档引用。
 *
 * 在分层中的位置：
 *   tools/guard/check ──► 本模块（读阈值/豁免）
 *   tools/guard/mirror ─► 本模块（读 MIRROR_EXEMPT）
 *
 * 设计要点：
 *   - 这里是「数字的唯一可调处」之一；ESLint 体积阈值在 eslint.config.ts，
 *     二者均镜像 30-guardrails，数字以 30 §G2/§G6 为准。
 * ─────────────────────────────────────────────────────────────
 */

/** G2 体积·复杂度阈值（镜像 30 §G2；ESLint 精确判定的同一组数字）。 */
export const THRESHOLDS = {
  maxLines: 500,
  maxLinesPerFunction: 100,
  maxParams: 5,
  maxDepth: 4,
  complexity: 15,
} as const;

/** G6 覆盖率门槛（镜像 30 §G6）：全局 / core·纯逻辑 / UI 组件。 */
export const COVERAGE = {
  global: 80,
  core: 90,
  ui: 70,
} as const;

/**
 * G6 测试镜像豁免名单：纯类型/常量文件（无逻辑）可免同名测试。
 * 路径相对 blueprint-runtime/ 根，使用正斜杠。
 */
export const MIRROR_EXEMPT: readonly string[] = [
  'core/index.ts', // 纯 re-export 桶文件，无逻辑
  'editor/src/lib/flow-types.ts', // 纯类型文件，无逻辑
  'editor/src/app/main.tsx', // Vite 入口引导
  'editor/src/app/App.tsx', // 应用外壳装配（渲染由 FlowCanvas 测覆盖）
  'editor/src/app/providers.tsx', // Provider 包裹
  'editor/src/graph/edges/TypedEdge.tsx', // presentational 边组件（着色逻辑在 lane-color，已测）
  'editor/src/nodes/GenericNode.tsx', // presentational 默认节点组件（registry/inspector 已测）
];
