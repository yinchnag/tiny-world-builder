/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/contracts/registry（契约注册表 + 元校验 · 护栏 G4 / 00 §5.3）
 * 职责：注册/查询 NodeContract，并在注册时做元校验（30 §G4 的 C1–C7），
 *       写错当场抛 `contract.invalid`。
 *
 * F0 归一：端口/lane/状态机均复用 canonical 类型（graph/port、types/payload-types、
 *          state/machine），不再内联（F-guard 的最小自洽版已被本文件取代）。
 * ─────────────────────────────────────────────────────────────
 */
import type { Lane } from '../types/payload-types';
import { payloadLaneMap } from '../types/payload-types';
import type { Port } from '../graph/port';
import type { StateMachineDef } from '../state/machine';

/** 节点家族（00 §5.3）。 */
export type Family = 'human' | 'execution' | 'context' | 'task' | 'observation' | 'integration';

/** 执行归属（谁负责跑该节点）。 */
export type RuntimeOwner = 'contex' | 'editor' | 'integration';

/** 某类节点的静态契约（端口/状态机/家族/执行归属）。 */
export interface NodeContract {
  readonly type: string;
  readonly family: Family;
  readonly inputs: readonly Port[];
  readonly outputs: readonly Port[];
  readonly state: StateMachineDef;
  readonly runtime: RuntimeOwner;
}

const FAMILIES: readonly Family[] = ['human', 'execution', 'context', 'task', 'observation', 'integration'];
const RUNTIMES: readonly RuntimeOwner[] = ['contex', 'editor', 'integration'];

/** 契约元校验失败错误，携带稳定 code（00 §5.7）。 */
export class ContractInvalidError extends Error {
  readonly code = 'contract.invalid';
  constructor(message: string) {
    super(message);
    this.name = 'ContractInvalidError';
  }
}

// C1：端口命名与方向一致（input 以 _in 结尾且 dir=in；output 以 _out 结尾且 dir=out）。
function checkPortNaming(c: NodeContract): string[] {
  const errs: string[] = [];
  for (const p of c.inputs) {
    if (p.dir !== 'in' || !p.id.endsWith('_in')) errs.push(`C1 input 须 dir=in 且 _in 结尾: ${p.id}`);
  }
  for (const p of c.outputs) {
    if (p.dir !== 'out' || !p.id.endsWith('_out')) errs.push(`C1 output 须 dir=out 且 _out 结尾: ${p.id}`);
  }
  return errs;
}

// C3/C4：port.lane 与 payloadType 的 lane 一致，且 payloadType 已注册。
function checkLanes(ports: readonly Port[], lanes: Record<string, Lane>): string[] {
  const errs: string[] = [];
  for (const p of ports) {
    if (!(p.payloadType in lanes)) errs.push(`C4 未注册 payloadType: ${p.payloadType}`);
    else if (lanes[p.payloadType] !== p.lane) errs.push(`C3 lane 不一致: ${p.id}`);
  }
  return errs;
}

// C5：状态机合法（initial 与每条 transition 端点都在 values 内）。
function checkState(s: StateMachineDef): string[] {
  const errs: string[] = [];
  const vals = new Set(s.values);
  if (!vals.has(s.initial)) errs.push('C5 initial 不在 values');
  for (const [from, to] of s.transitions) {
    if (!vals.has(from) || !vals.has(to)) errs.push(`C5 transition 端点不在 values: ${from}->${to}`);
  }
  return errs;
}

/**
 * 对一个 NodeContract 做元校验（C1–C7）。纯函数，可离线兜底。
 *
 * @param contract 待校验契约
 * @param lanes payloadType → lane 映射（默认取已注册载荷类型）
 * @returns 违规原因数组；空数组表示通过
 */
export function validateContract(
  contract: NodeContract,
  lanes: Record<string, Lane> = payloadLaneMap(),
): string[] {
  const ports = [...contract.inputs, ...contract.outputs];
  const ids = ports.map((p) => p.id);
  const errs = [...checkPortNaming(contract), ...checkLanes(ports, lanes), ...checkState(contract.state)];
  if (new Set(ids).size !== ids.length) errs.push('C2 端口 id 重复'); // C2
  if (!FAMILIES.includes(contract.family)) errs.push(`C6 非法 family: ${contract.family}`); // C6
  if (!RUNTIMES.includes(contract.runtime)) errs.push(`C7 非法 runtime: ${contract.runtime}`); // C7
  return errs;
}

const registry = new Map<string, NodeContract>();

/**
 * 注册一个契约；元校验失败即抛 `contract.invalid`（写错当场炸）。
 *
 * @param contract 待注册契约
 * @param lanes payloadType → lane 映射（默认取已注册载荷类型）
 * @returns 已注册的契约
 */
export function register(contract: NodeContract, lanes: Record<string, Lane> = payloadLaneMap()): NodeContract {
  const errors = validateContract(contract, lanes);
  if (errors.length > 0) throw new ContractInvalidError(errors.join('; '));
  registry.set(contract.type, contract);
  return contract;
}

/**
 * 按 type 查询已注册契约。
 *
 * @param type 契约类型
 * @returns 契约或 undefined
 */
export function lookup(type: string): NodeContract | undefined {
  return registry.get(type);
}
