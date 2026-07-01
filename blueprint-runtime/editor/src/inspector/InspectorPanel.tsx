/**
 * 组件：editor/src/inspector/InspectorPanel（契约驱动检视器 · L-Inspector · BP-3/EX-5）
 * 职责：选中节点实例 → 类型/id · 实时状态 · 动作 · 端口(lane 着色) · Agent 模型配置(可编辑)
 *       · 运行按钮(onRun 由 app 注入) · 运行状态 + 后端产出(ui-store)。
 */
import { lookup } from '@blueprint/core';
import { useGraphStore } from '../state/graph-store';
import { useUiStore } from '../state/ui-store';
import { laneColor } from '../graph/edges/lane-color';

function PropertyEditor({ nodeId, properties }: { nodeId: string; properties: Record<string, unknown> }) {
  const setNodeProperties = useGraphStore((s) => s.setNodeProperties);
  const field = (key: string, placeholder: string) => (
    <input
      data-testid={`prop-${key}`}
      value={typeof properties[key] === 'string' ? (properties[key] as string) : ''}
      placeholder={placeholder}
      onChange={(e) => setNodeProperties(nodeId, { [key]: e.target.value })}
      style={{ display: 'block', width: '100%', marginBottom: 4, fontSize: 12 }}
    />
  );
  return (
    <div style={{ margin: '6px 0' }}>
      <div style={{ fontSize: 11, color: '#888' }}>模型配置</div>
      {field('provider', 'provider（如 deepseek）')}
      {field('model', 'model（留空取默认）')}
      {field('systemPrompt', 'system prompt')}
    </div>
  );
}

function RuntimeStatus({ nodeId }: { nodeId: string }) {
  const status = useUiStore((s) => s.execStatus[nodeId]);
  const delivery = useUiStore((s) => s.lastDelivery[nodeId]);
  if (status === undefined && delivery === undefined) return null;
  return (
    <div data-testid="runtime-status" style={{ margin: '6px 0', fontSize: 12 }}>
      {status !== undefined && (
        <div>
          执行：<strong>{status}</strong>
        </div>
      )}
      {delivery !== undefined &&
        Object.entries(delivery).map(([port, payload]) => (
          <div key={port} data-testid={`recv-${port}`} style={{ marginTop: 2 }}>
            收到 {port}：<code style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(payload)}</code>
          </div>
        ))}
    </div>
  );
}

export function InspectorPanel({ nodeId, onRun }: { nodeId: string | null; onRun?: (nodeId: string) => void }) {
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
      {onRun !== undefined && (
        <button data-testid="run-node" onClick={() => onRun(node.id)} style={{ marginBottom: 6 }}>
          ▶ 运行
        </button>
      )}
      {node.type === 'agent' && <PropertyEditor nodeId={node.id} properties={node.data.properties} />}
      <RuntimeStatus nodeId={node.id} />
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
              style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: laneColor(p.lane), marginRight: 6 }}
            />
            {p.dir} · {p.id} · {p.payloadType}
          </li>
        ))}
      </ul>
    </div>
  );
}
