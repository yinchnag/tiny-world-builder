/**
 * ─────────────────────────────────────────────────────────────
 * 模块：core/contracts/registry（契约注册表 + 元校验 · 护栏 G4）
 * 职责：注册/查询 NodeContract，并在注册时做元校验（30 §G4 的 C1–C7），
 *       写错当场抛 `contract.invalid`。
 *
 * 在分层中的位置：
 *   register() ──► validateContract()（纯函数，可离线兜底）
 *
 * 范围说明（F-guard）：
 *   - 本文件是 G4 的最小自洽实现（含内联的最小 NodeContract 形状）；
 *     F0 建 core/ 时会与 types/graph 的正式结构对齐，元校验逻辑不变。
 * ─────────────────────────────────────────────────────────────
 */

export type Lane = 'control' | 'message' | 'task' | 'context' | 'resource' | 'human';
export type PortDir = 'in' | 'out';
export type Family = 'human' | 'execution' | 'context' | 'task' | 'observation' | 'integration';
export type RuntimeOwner = 'contex' | 'editor' | 'integration';

export interface Port {
  id: string;
  dir: PortDir;
  payloadType: string;
  lane: Lane;
}

export interface StateMachineDef {
  values: string[];
  initial: string;
  /** 每条 transition = [from, to, trigger]。 */
  transitions: Array<[string, string, string]>;
}

export interface NodeContract {
  type: string;
  family: Family;
  inputs: Port[];
  outputs: Port[];
  state: StateMachineDef;
  runtime: RuntimeOwner;
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

// C1：端口命名与方向一致（input 以 _in 结尾且 dir=in；output 同理）。
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

// C3/C4：lane 与 payloadType 的 lane 一致，且 payloadType 已注册。
function checkLanes(ports: Port[], lanes: Record<string, Lane>): string[] {
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
 * @param lanes 已注册 payloadType → lane 的映射（C3/C4 用）
 * @returns 违规原因数组；空数组表示通过
 */
export function validateContract(contract: NodeContract, lanes: Record<string, Lane>): string[] {
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
 * @param lanes payloadType → lane 映射
 * @returns 已注册的契约
 */
export function register(contract: NodeContract, lanes: Record<string, Lane>): NodeContract {
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
