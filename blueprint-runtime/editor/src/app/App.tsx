/**
 * editor/src/app/App（应用外壳 · L-App）：全屏画布。
 * 检视器/工具栏在 F6 装配。
 */
import { Providers } from './providers';
import { FlowCanvas } from '../graph/FlowCanvas';

export function App() {
  return (
    <Providers>
      <div style={{ width: '100vw', height: '100vh' }}>
        <FlowCanvas />
      </div>
    </Providers>
  );
}
