/**
 * core/validate 单测：canConnect 覆盖 §5.7 每个码 + validatePayload + validateGraph。
 */
import { describe, it, expect } from 'vitest';
import { canConnect, validatePayload, validateGraph } from './validate';
import { createPort } from './graph/port';
import { emptyGraph, addNode, addEdge } from './graph/graph';
import { createNode } from './graph/node';
import { createEdge } from './graph/edge';

const reportOut = createPort({ id: 'report_out', dir: 'out', payloadType: 'AgentReport', lane: 'message' });
const messageOut = createPort({ id: 'message_out', dir: 'out', payloadType: 'AgentMessage', lane: 'message' });
const messageIn = createPort({ id: 'message_in', dir: 'in', payloadType: 'AgentMessage', lane: 'message' });
const contextOut = createPort({ id: 'selection_out', dir: 'out', payloadType: 'DocumentSelection', lane: 'context' });
const replyOut = createPort({ id: 'reply_out', dir: 'out', payloadType: 'HumanReply', lane: 'human' });
const questionIn = createPort({ id: 'question_in', dir: 'in', payloadType: 'HumanAttention', lane: 'human' });

describe('canConnect (§5.7 codes)', () => {
  it('E1 positive: report_out → message_in', () => {
    expect(canConnect(reportOut, messageIn)).toEqual({ ok: true });
  });
  it('port.not_found when a port is undefined', () => {
    expect(canConnect(undefined, messageIn).reason).toBe('port.not_found');
  });
  it('direction.invalid for out → out', () => {
    expect(canConnect(messageOut, messageOut).reason).toBe('direction.invalid');
  });
  it('lane.mismatch for context out → message in (X3)', () => {
    expect(canConnect(contextOut, messageIn).reason).toBe('lane.mismatch');
  });
  it('payload.incompatible for same lane unassignable (X1)', () => {
    expect(canConnect(replyOut, questionIn).reason).toBe('payload.incompatible');
  });
  it('cardinality.exceeded when target is single and occupied', () => {
    expect(canConnect(reportOut, messageIn, { targetOccupied: true }).reason).toBe('cardinality.exceeded');
  });
});

describe('validatePayload (§5.9)', () => {
  it('passes a well-formed payload', () => {
    expect(validatePayload('AgentMessage', { text: 'hi' })).toEqual({ ok: true });
  });
  it('rejects a malformed payload → payload.schema_invalid', () => {
    expect(validatePayload('AgentMessage', { nope: 1 }).reason).toBe('payload.schema_invalid');
  });
});

describe('validateGraph', () => {
  const requiredIn = createPort({ id: 'message_in', dir: 'in', payloadType: 'AgentMessage', lane: 'message', required: true });
  const getContract = (type: string) => (type === 'agent' ? { inputs: [requiredIn] } : undefined);

  it('reports required.unmet for an unconnected required in-port', () => {
    const g = addNode(emptyGraph(), createNode({ id: 'A', type: 'agent', state: 'idle' }));
    const issues = validateGraph(g, getContract);
    expect(issues).toEqual([{ reason: 'required.unmet', nodeId: 'A', portId: 'message_in' }]);
  });

  it('passes when the required in-port is connected', () => {
    let g = addNode(emptyGraph(), createNode({ id: 'A', type: 'agent', state: 'idle' }));
    g = addNode(g, createNode({ id: 'B', type: 'document', state: 'idle' })); // 无 required 输入
    g = addEdge(
      g,
      createEdge({
        id: 'E1',
        source: { node: 'B', port: 'report_out' },
        target: { node: 'A', port: 'message_in' },
        lane: 'message',
        payloadType: 'AgentReport',
      }),
    );
    expect(validateGraph(g, getContract)).toEqual([]);
  });
});
