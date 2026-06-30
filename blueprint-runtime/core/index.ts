/**
 * core 公共 API 桶文件——前后端各自 `import { ... } from '@blueprint/core'`。
 * 仅做 re-export（无逻辑，免测试镜像，见 tools/guard/config MIRROR_EXEMPT）。
 */
export * from './events';
export * from './types/payload-types';
export * from './types/compatibility';
export * from './graph/port';
export * from './graph/node';
export * from './graph/edge';
export * from './graph/graph';
export * from './state/machine';
export * from './contracts/registry';
export * from './validate';
