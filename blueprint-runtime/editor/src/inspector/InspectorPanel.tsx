/**
 * 组件：editor/src/inspector/InspectorPanel（契约驱动检视器 · L-Inspector）
 * 职责：读选中节点类型的 core/contracts，自动渲染端口/状态/动作。
 */
import { lookup } from '@blueprint/core';

export function InspectorPanel({ nodeType }: { nodeType: string | null }) {
  if (nodeType === null) {
    return <div data-testid="inspector-empty">未选择节点</div>;
  }
  const contract = lookup(nodeType);
  if (contract === undefined) {
    return <div data-testid="inspector-unknown">未知类型：{nodeType}</div>;
  }
  const ports = [...contract.inputs, ...contract.outputs];
  return (
    <div data-testid="inspector">
      <h3>{contract.type}</h3>
      <div>状态：{contract.state.values.join(' · ')}</div>
      <ul>
        {ports.map((p) => (
          <li key={p.id} data-port={p.id}>
            {p.dir} · {p.id} · {p.lane} · {p.payloadType}
          </li>
        ))}
      </ul>
    </div>
  );
}
