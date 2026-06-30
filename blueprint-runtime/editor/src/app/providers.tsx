/**
 * editor/src/app/providers（应用 Provider 包裹 · L-App）。
 * 现阶段无需额外 Provider（store 是模块级单例）；保留扩展点。
 */
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
