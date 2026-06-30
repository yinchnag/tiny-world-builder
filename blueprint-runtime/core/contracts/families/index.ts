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

export { AGENT_CONTRACT } from './agent';
export { HUMAN_CONTRACT } from './human';
export { TASK_CONTRACT } from './task';
export { DOCUMENT_CONTRACT } from './document';
export { MEMORY_CONTRACT } from './memory';

/** 功能阶段 BP-1 的内置契约：Agent（execution）+ Human Gate（human）+ Task（task）+ Document/Memory（context）。 */
export const BUILTIN_CONTRACTS: readonly NodeContract[] = [
  AGENT_CONTRACT,
  HUMAN_CONTRACT,
  TASK_CONTRACT,
  DOCUMENT_CONTRACT,
  MEMORY_CONTRACT,
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
