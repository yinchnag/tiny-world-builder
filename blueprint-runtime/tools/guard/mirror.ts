/**
 * ─────────────────────────────────────────────────────────────
 * 模块：tools/guard/mirror（护栏 G6 · 测试镜像存在性）
 * 职责：核对 core/runtime/editor 下每个源文件都有同名 `*.test.ts(x)`。
 *
 * 在分层中的位置：
 *   tools/guard/check ──► 本模块（findMissingMirrors）
 *                    └─► tools/guard/config（MIRROR_EXEMPT 豁免名单）
 *
 * 设计要点：
 *   - 按 30 §G6：只查 core|runtime|editor；tools/ 自身不在镜像范围。
 *   - 纯类型/常量文件可在 config.MIRROR_EXEMPT 登记免镜像。
 * ─────────────────────────────────────────────────────────────
 */
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIRROR_EXEMPT } from './config';

/** blueprint-runtime/ 仓库根（本文件位于 tools/guard/）。 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 受镜像守卫的包（30 §G6）。 */
const PACKAGES = ['core', 'runtime', 'editor'];

/** 递归收集目录下所有 .ts/.tsx 文件（绝对路径）。 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 某源文件是否非「需镜像」的源（测试/声明文件本身不需要镜像）。 */
function isSource(rel: string): boolean {
  return !/\.test\.tsx?$/.test(rel) && !/\.config\.tsx?$/.test(rel) && !rel.endsWith('.d.ts');
}

/**
 * 找出缺少同名测试的源文件，返回相对仓库根的路径列表（正斜杠）。
 *
 * @param root 仓库根目录（默认 blueprint-runtime/；测试可传临时目录）
 * @returns 缺镜像的源文件路径数组；空数组表示全部就位。
 */
export function findMissingMirrors(root: string = ROOT): string[] {
  const missing: string[] = [];
  for (const pkg of PACKAGES) {
    const base = join(root, pkg);
    if (!existsSync(base)) continue;
    for (const file of walk(base)) {
      const rel = relative(root, file).replaceAll('\\', '/');
      if (!isSource(rel) || MIRROR_EXEMPT.includes(rel)) continue;
      const testTs = file.replace(/\.tsx?$/, '.test.ts');
      const testTsx = file.replace(/\.tsx?$/, '.test.tsx');
      if (!existsSync(testTs) && !existsSync(testTsx)) missing.push(rel);
    }
  }
  return missing;
}
