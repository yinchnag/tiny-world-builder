/**
 * terminalExecutor 单测：跑命令 → stdout/exit；失败命令非零退出。
 */
import { describe, it, expect } from 'vitest';
import { terminalExecutor } from './terminal';
import { fixedClock } from '../../kernel/clock';
import type { ExecInput } from './executor';

const clock = fixedClock('2026-06-30T00:00:00.000Z');
function input(command: string): ExecInput {
  return { node: { id: 'T', type: 'terminal', state: 'idle', properties: { command } }, inputs: {}, clock };
}

describe('terminalExecutor', () => {
  it('runs a command, produces stdout + exit 0, state exited', async () => {
    const r = await terminalExecutor(input('echo hello'));
    expect(r.nextState).toBe('exited');
    const stdout = r.outputs.find((o) => o.port === 'stdout_out');
    expect((stdout?.payload as { text: string }).text.trim()).toBe('hello');
    expect((r.outputs.find((o) => o.port === 'exit_out')?.payload as { code: number }).code).toBe(0);
  });

  it('reports non-zero exit for a failing command', async () => {
    const r = await terminalExecutor(input('exit 3'));
    expect((r.outputs.find((o) => o.port === 'exit_out')?.payload as { code: number }).code).not.toBe(0);
  });
});
