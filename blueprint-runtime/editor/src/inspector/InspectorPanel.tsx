/**
 * 组件：editor/src/inspector/InspectorPanel（契约驱动检视器 · L-Inspector · BP-3）
 * 职责：读「选中节点实例 + 其契约」，渲染：类型/id · 实时状态 · 可用动作(状态机触发) ·
 *       端口(lane 着色 + payloadType)。动作按钮点按推进本地状态（有反馈）。
 */
import { lookup } from '@blueprint/core';
import { useGraphStore } from '../state/graph-store';
import { laneColor } from '../graph/edges/lane-color';

export function InspectorPanel({ nodeId }: { nodeId: string | null }) {
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === nodeId) ?? null);
  const applyNodeState = useGraphStore((s) => s.applyNodeState);

  if (node === null) {
    return <div data-testid="inspector-empty">未选择节点</div>;
  }
  const contract = lookup(node.type ?? '');
  if (contract === undefined) {
    return <div data-testid="inspector-unknown">未知类型：{node.type}</div>;
  }
  const state = node.data.state;
  const actions = contract.state.transitions.filter(([from]) => from === state);
  const ports = [...contract.inputs, ...contract.outputs];

  return (
    <div data-testid="inspector">
      <h3 style={{ margin: '0 0 2px' }}>{contract.type}</h3>
      <div style={{ fontSize: 11, color: '#999' }}>{node.id}</div>
      <div style={{ margin: '6px 0' }}>
        状态：<strong data-testid="inspector-state">{state}</strong>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '6px 0' }}>
        动作：
        {actions.length === 0 ? (
          <span style={{ color: '#999' }}>（无）</span>
        ) : (
          actions.map(([, to, trigger]) => (
            <button key={trigger} data-testid={`action-${trigger}`} onClick={() => applyNodeState(node.id, to)}>
              {trigger}
            </button>
          ))
        )}
      </div>
      <ul style={{ paddingLeft: 14, margin: '4px 0' }}>
        {ports.map((p) => (
          <li key={p.id} data-port={p.id} title={`${p.lane} · ${p.payloadType}`}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 8,
                background: laneColor(p.lane),
                marginRight: 6,
              }}
            />
            {p.dir} · {p.id} · {p.payloadType}
          </li>
        ))}
      </ul>
    </div>
  );
}
