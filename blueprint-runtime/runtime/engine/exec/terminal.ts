/**
 * ─────────────────────────────────────────────────────────────
 * 模块：runtime/engine/exec/terminal（Terminal 执行器 · L4 · EX-1）
 * 职责：跑 node.properties.command（child_process）→ 产 stdout/stderr/exit 出口 + 状态 exited。
 *       确定性纵切，证明执行器模式端到端（无需 API key）。沙箱硬化留后续。
 * ─────────────────────────────────────────────────────────────
 */
import { exec } from 'node:child_process';
import type { NodeExecutor, ExecOutput } from './executor';

// 跑命令，回 {stdout, stderr, code}（非零退出码取 err.code；内部辅助）。
function runCommand(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    exec(command, { timeout: 10_000, windowsHide: true }, (err, stdout, stderr) => {
      const code = err === null ? 0 : typeof err.code === 'number' ? err.code : 1;
      resolve({ stdout, stderr, code });
    });
  });
}

// Terminal 执行器：跑 properties.command，产 StdoutChunk/StderrChunk/ExitStatus。
export const terminalExecutor: NodeExecutor = async (input) => {
  const command = typeof input.node.properties.command === 'string' ? input.node.properties.command : '';
  if (command === '') {
    return { outputs: [{ port: 'exit_out', payload: { code: -1 } }], nextState: 'exited' };
  }
  const { stdout, stderr, code } = await runCommand(command);
  const outputs: ExecOutput[] = [];
  if (stdout.length > 0) outputs.push({ port: 'stdout_out', payload: { text: stdout } });
  if (stderr.length > 0) outputs.push({ port: 'stderr_out', payload: { text: stderr } });
  outputs.push({ port: 'exit_out', payload: { code } });
  return { outputs, nextState: 'exited' };
};
