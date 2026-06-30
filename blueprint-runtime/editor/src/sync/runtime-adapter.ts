/**
 * ─────────────────────────────────────────────────────────────
 * 模块：editor/src/sync/runtime-adapter（后端适配门面 · L-Sync）
 * 职责：前端唯一的后端出入口（接口 + no-op 离线实现 + 测试用 mock）。
 *       离线注入 no-op 时画布照常工作（00 §6 / 20 §4）。
 * ─────────────────────────────────────────────────────────────
 */
import type { RuntimeEvent } from '@blueprint/core';

/** 本地图变更（镜像到后端的载荷）。 */
export interface GraphChange {
  readonly kind: 'node' | 'edge';
  readonly op: 'add' | 'remove' | 'update';
  readonly payload: unknown;
}

/** 取消订阅。 */
export type Unsubscribe = () => void;

/** 后端适配器：出（mirror）+ 入（subscribe）。 */
export interface RuntimeAdapter {
  mirror(change: GraphChange): Promise<void>;
  subscribe(onEvent: (ev: RuntimeEvent) => void): Unsubscribe;
}

/**
 * no-op 离线适配器：mirror 不发网、subscribe 返回空取消（画布离线可用）。
 *
 * @returns RuntimeAdapter
 */
export function createNoopAdapter(): RuntimeAdapter {
  return {
    mirror: async (): Promise<void> => {},
    subscribe: (): Unsubscribe => (): void => {},
  };
}

/** 测试/离线 mock：可注入事件 + 记录镜像。 */
export interface MockAdapter extends RuntimeAdapter {
  emit(ev: RuntimeEvent): void;
  readonly mirrored: GraphChange[];
}

/**
 * 创建 mock 适配器（emit 扇出到订阅者；mirror 记录到 mirrored）。
 *
 * @returns MockAdapter
 */
export function createMockAdapter(): MockAdapter {
  const subs = new Set<(ev: RuntimeEvent) => void>();
  const mirrored: GraphChange[] = [];
  return {
    mirror: async (change: GraphChange): Promise<void> => {
      mirrored.push(change);
    },
    subscribe: (onEvent: (ev: RuntimeEvent) => void): Unsubscribe => {
      subs.add(onEvent);
      return (): void => {
        subs.delete(onEvent);
      };
    },
    emit: (ev: RuntimeEvent): void => {
      for (const s of subs) s(ev);
    },
    mirrored,
  };
}
