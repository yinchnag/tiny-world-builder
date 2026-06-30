/**
 * ─────────────────────────────────────────────────────────────
 * 模块：tools/guard/check（护栏总入口 · 30 §2）
 * 职责：编排 lint（G1/G2/G5）+ test（G4/G6 用例）+ mirror（G6 存在性），
 *       聚合退出码——任一失败即非 0（CI 红）。
 *
 * 用法：`pnpm check`（= `tsx tools/guard/check.ts`）。
 *
 * 设计要点：
 *   - lint/test 以子进程跑现成工具；mirror 调本地纯函数。
 *   - 覆盖率门槛（G6 阈值）在 F0 起接入（`pnpm test:cov`）；空骨架阶段不入闸。
 * ─────────────────────────────────────────────────────────────
 */
import { spawnSync } from 'node:child_process';
import { findMissingMirrors } from './mirror';

/** 跑一个 pnpm 脚本子进程，返回是否成功（exit 0）。 */
function runScript(script: string): boolean {
  const r = spawnSync('pnpm', ['-s', script], { stdio: 'inherit', shell: true });
  return r.status === 0;
}

const results: Array<[string, boolean]> = [];

results.push(['lint', runScript('lint')]);
results.push(['test', runScript('test')]);

const missing = findMissingMirrors();
if (missing.length > 0) {
  process.stderr.write('\n✗ G6 测试镜像缺失:\n');
  for (const m of missing) process.stderr.write(`    ${m} → 缺少同名 *.test.ts（GUIDE §8）\n`);
}
results.push(['mirror', missing.length === 0]);

const summary = results.map(([k, ok]) => `${k} ${ok ? '✓' : '✗'}`).join('  ');
const allOk = results.every(([, ok]) => ok);
process.stdout.write(`\n护栏汇总: ${summary} → 退出码 ${allOk ? 0 : 1}\n`);
process.exit(allOk ? 0 : 1);
