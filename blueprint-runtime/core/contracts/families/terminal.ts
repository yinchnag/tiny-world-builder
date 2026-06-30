/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/contracts/families/terminal（Terminal 节点契约 · BP-1 · execution 家族）
 * 职责：把命令执行声明为节点（node-evolution §2）。
 *       stdin_in/exit_out 走 control（信令），stdout_out/stderr_out 走 resource（数据流）。
 *       本期独立节点，不强连其他家族。runtime=contex：进程在后端跑。
 * ─────────────────────────────────────────────────────────────
 */
import { createPort } from '../../graph/port';
import type { NodeContract } from '../registry';

/** Terminal 节点契约（命令执行：stdin → stdout/stderr/exit）。 */
export const TERMINAL_CONTRACT: NodeContract = {
  type: 'terminal',
  family: 'execution',
  runtime: 'contex',
  inputs: [
    createPort({ id: 'stdin_in', dir: 'in', payloadType: 'CommandInput', lane: 'control', multiple: true }),
  ],
  outputs: [
    createPort({ id: 'stdout_out', dir: 'out', payloadType: 'StdoutChunk', lane: 'resource', multiple: true }),
    createPort({ id: 'stderr_out', dir: 'out', payloadType: 'StderrChunk', lane: 'resource', multiple: true }),
    createPort({ id: 'exit_out', dir: 'out', payloadType: 'ExitStatus', lane: 'control' }),
  ],
  state: {
    values: ['idle', 'running', 'exited'],
    initial: 'idle',
    transitions: [
      ['idle', 'running', 'run'],
      ['running', 'exited', 'exit'],
      ['exited', 'idle', 'reset'],
    ],
  },
};
