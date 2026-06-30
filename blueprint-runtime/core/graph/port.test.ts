/**
 * core/graph/port 单测：构造默认值。
 */
import { describe, it, expect } from 'vitest';
import { createPort } from './port';

describe('createPort', () => {
  it('defaults required/multiple to false', () => {
    const p = createPort({ id: 'message_in', dir: 'in', payloadType: 'AgentMessage', lane: 'message' });
    expect(p).toEqual({
      id: 'message_in',
      dir: 'in',
      payloadType: 'AgentMessage',
      lane: 'message',
      required: false,
      multiple: false,
    });
  });

  it('keeps explicit required/multiple', () => {
    const p = createPort({ id: 'x_in', dir: 'in', payloadType: 'Task', lane: 'task', required: true, multiple: true });
    expect(p.required).toBe(true);
    expect(p.multiple).toBe(true);
  });
});
