/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/contracts/families（内置节点契约的统一注册入口 · BP-1）
 * 职责：汇总各家族契约，提供 registerBuiltinContracts()——编辑器/运行时启动时
 *       各调一次即可让 core/contracts 知道全部内置类型（重复注册覆盖，幂等安全）。
 * ─────────────────────────────────────────────────────────────
 */
import { register, type NodeContract } from '../registry';
import { AGENT_CONTRACT } from './agent';
import { HUMAN_CONTRACT } from './human';
import { TASK_CONTRACT } from './task';
import { DOCUMENT_CONTRACT } from './document';
import { MEMORY_CONTRACT } from './memory';
import { TERMINAL_CONTRACT } from './terminal';
import { BROWSER_CONTRACT } from './browser';
import { GIT_CONTRACT } from './git';
import { STATUS_CONTRACT } from './status';
import { POLLY_CONTRACT } from './polly';

export { AGENT_CONTRACT } from './agent';
export { HUMAN_CONTRACT } from './human';
export { TASK_CONTRACT } from './task';
export { DOCUMENT_CONTRACT } from './document';
export { MEMORY_CONTRACT } from './memory';
export { TERMINAL_CONTRACT } from './terminal';
export { BROWSER_CONTRACT } from './browser';
export { GIT_CONTRACT } from './git';
export { STATUS_CONTRACT } from './status';
export { POLLY_CONTRACT } from './polly';

/** 内置契约六家族：execution(Agent/Terminal)·human(Human)·task(Task)·context(Document/Memory)·observation(Browser/Git/Status)·integration(Polly)。 */
export const BUILTIN_CONTRACTS: readonly NodeContract[] = [
  AGENT_CONTRACT,
  HUMAN_CONTRACT,
  TASK_CONTRACT,
  DOCUMENT_CONTRACT,
  MEMORY_CONTRACT,
  TERMINAL_CONTRACT,
  BROWSER_CONTRACT,
  GIT_CONTRACT,
  STATUS_CONTRACT,
  POLLY_CONTRACT,
];

/**
 * 注册全部内置契约（写错的契约会在此当场抛 contract.invalid）。
 *
 * @returns 已注册的内置契约数组
 */
export function registerBuiltinContracts(): readonly NodeContract[] {
  for (const c of BUILTIN_CONTRACTS) register(c);
  return BUILTIN_CONTRACTS;
}
