/**
 * ─────────────────────────────────────────────────────────────
 * ESLint flat config — 护栏 G1 / G2 / G5（见 30-guardrails）。
 *
 * G1 架构边界 : eslint-plugin-boundaries（依赖方向/分层）+ no-restricted-imports（core 中立）
 *               + import/no-cycle（无环）。
 * G2 体积复杂度: 核心规则 max-lines / max-lines-per-function / max-params / max-depth / complexity。
 * G5 注释存在性: eslint-plugin-jsdoc（导出函数 JSDoc + @param/@returns）。
 *
 * 阈值唯一权威在 30 §G2；此处数字与 tools/guard/config 同为镜像。
 * 元素分层（rank）镜像 30 §G1：依赖只能朝下（rank ≤ 自身）+ core；前后端互不依赖。
 * ─────────────────────────────────────────────────────────────
 */
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import jsdoc from 'eslint-plugin-jsdoc';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

// 分层元素（越靠前越具体）。pattern 相对仓库根。
const ELEMENTS = [
  { type: 'core', pattern: 'core/**' },
  { type: 'tools', pattern: 'tools/**' },
  { type: 'rt-kernel', pattern: 'runtime/kernel/**' },
  { type: 'rt-persist', pattern: 'runtime/persist/**' },
  { type: 'rt-engine', pattern: 'runtime/engine/**' },
  { type: 'rt-mcp', pattern: 'runtime/mcp/**' },
  { type: 'rt-cross', pattern: 'runtime/cross/**' },
  { type: 'ed-lib', pattern: 'editor/src/lib/**' },
  { type: 'ed-state', pattern: 'editor/src/state/**' },
  { type: 'ed-graph', pattern: 'editor/src/graph/**' },
  { type: 'ed-nodes', pattern: 'editor/src/nodes/**' },
  { type: 'ed-inspector', pattern: 'editor/src/inspector/**' },
  { type: 'ed-sync', pattern: 'editor/src/sync/**' },
  { type: 'ed-workspace', pattern: 'editor/src/workspace/**' },
  { type: 'ed-app', pattern: 'editor/src/app/**' },
];

// R1 依赖朝下 + R3 前后端不直连 + R6 横切单向：每个元素只能 import 下表 allow 的元素。
const ALLOW = [
  { from: ['core'], allow: ['core'] },
  { from: ['tools'], allow: ['core', 'tools'] },
  { from: ['rt-kernel'], allow: ['core', 'rt-kernel'] },
  { from: ['rt-cross'], allow: ['core', 'rt-kernel', 'rt-persist'] },
  { from: ['rt-persist'], allow: ['core', 'rt-kernel', 'rt-persist', 'rt-cross'] },
  { from: ['rt-engine'], allow: ['core', 'rt-kernel', 'rt-persist', 'rt-engine', 'rt-cross'] },
  { from: ['rt-mcp'], allow: ['core', 'rt-kernel', 'rt-persist', 'rt-engine', 'rt-mcp', 'rt-cross'] },
  { from: ['ed-lib'], allow: ['core', 'ed-lib'] },
  { from: ['ed-state'], allow: ['core', 'ed-lib', 'ed-state'] },
  { from: ['ed-graph'], allow: ['core', 'ed-lib', 'ed-state', 'ed-graph'] },
  { from: ['ed-nodes'], allow: ['core', 'ed-lib', 'ed-state', 'ed-graph', 'ed-nodes'] },
  { from: ['ed-inspector'], allow: ['core', 'ed-lib', 'ed-state', 'ed-graph', 'ed-inspector'] },
  { from: ['ed-sync'], allow: ['core', 'ed-lib', 'ed-state', 'ed-graph', 'ed-nodes', 'ed-inspector', 'ed-sync'] },
  { from: ['ed-workspace'], allow: ['core', 'ed-lib', 'ed-state', 'ed-graph', 'ed-nodes', 'ed-inspector', 'ed-sync', 'ed-workspace'] },
  { from: ['ed-app'], allow: ['core', 'ed-lib', 'ed-state', 'ed-graph', 'ed-nodes', 'ed-inspector', 'ed-sync', 'ed-workspace', 'ed-app'] },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/coverage/**',
      '**/dist/**',
      'docs/**',
      'eslint.config.ts',
      'vitest.config.ts',
      '**/vite.config.ts',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { globals: { ...globals.node } },
    plugins: { boundaries, jsdoc, import: importPlugin },
    settings: {
      'boundaries/include': ['core/**', 'runtime/**', 'editor/**', 'tools/**'],
      'boundaries/elements': ELEMENTS,
    },
    rules: {
      // G2 体积·复杂度（含注释空行）
      'max-lines': ['error', { max: 500, skipBlankLines: false, skipComments: false }],
      'max-lines-per-function': ['error', { max: 100, skipBlankLines: false, skipComments: false }],
      'max-params': ['error', 5],
      'max-depth': ['error', 4],
      complexity: ['error', 15],
      // G1 架构边界
      'boundaries/element-types': ['error', { default: 'disallow', rules: ALLOW }],
      'boundaries/no-unknown': 'off',
      'boundaries/no-unknown-files': 'off',
      'import/no-cycle': 'error',
      // G5 注释存在性（导出函数）
      'jsdoc/require-jsdoc': [
        'error',
        { publicOnly: true, require: { FunctionDeclaration: true, ArrowFunctionExpression: false } },
      ],
      'jsdoc/require-param': 'error',
      'jsdoc/require-returns': 'error',
    },
  },
  // R2 core 中立：禁 import node:* 与浏览器全局入口
  {
    files: ['core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*'], message: 'core/ 须平台中立（00 §2.3）：禁 import node:*' }] },
      ],
    },
  },
  // R3 前后端不直连：editor ✗ import runtime（字符串级，免解析；与 boundaries 互补）
  {
    files: ['editor/**/*.ts', 'editor/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/runtime/**', '**/runtime', '@blueprint/runtime', '@blueprint/runtime/**'],
              message: '前后端不直连（00 §6 R3）：editor 禁 import runtime，唯一通道 MCP',
            },
          ],
        },
      ],
    },
  },
  // R3 反向：runtime ✗ import editor
  {
    files: ['runtime/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/editor/**', '**/editor', '@blueprint/editor', '@blueprint/editor/**'],
              message: '前后端不直连（00 §6 R3）：runtime 禁 import editor',
            },
          ],
        },
      ],
    },
  },
  // 测试与脚本：关掉「函数体量 + 导出/参数/返回 JSDoc」（describe/it 回调、内部脚本不适用）
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'tools/**/*.ts'],
    rules: {
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
      'max-lines-per-function': 'off',
    },
  },
  // React 组件（.tsx）：JSX 自说明，免 JSDoc 的 param/returns 要求（体量约束仍在）
  {
    files: ['**/*.tsx'],
    rules: {
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
    },
  },
);
