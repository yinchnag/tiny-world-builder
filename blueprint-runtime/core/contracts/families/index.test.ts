/**
 * families 单测：registerBuiltinContracts + 跨家族「人在回路」闭合（BP-1 验收）。
 */
import { describe, it, expect } from 'vitest';
import {
  registerBuiltinContracts,
  AGENT_CONTRACT,
  HUMAN_CONTRACT,
  TASK_CONTRACT,
  DOCUMENT_CONTRACT,
  MEMORY_CONTRACT,
  TERMINAL_CONTRACT,
  BROWSER_CONTRACT,
  GIT_CONTRACT,
  POLLY_CONTRACT,
  CACHE_CONTRACT,
} from './index';
import { lookup } from '../registry';
import { canConnect } from '../../validate';
import type { Port } from '../../graph/port';

function port(ports: readonly Port[], id: string): Port | undefined {
  return ports.find((p) => p.id === id);
}

describe('builtin contracts', () => {
  it('registers all builtin contracts', () => {
    registerBuiltinContracts();
    expect(lookup('agent')).toBeDefined();
    expect(lookup('human_gate')).toBeDefined();
    expect(lookup('task')).toBeDefined();
    expect(lookup('document')).toBeDefined();
    expect(lookup('memory')).toBeDefined();
    expect(lookup('terminal')).toBeDefined();
    expect(lookup('browser')).toBeDefined();
    expect(lookup('git')).toBeDefined();
    expect(lookup('status')).toBeDefined();
    expect(lookup('polly')).toBeDefined();
    expect(lookup('cache')).toBeDefined();
  });

  it('wraps a context producer: Document → Cache → Agent', () => {
    const into = canConnect(port(DOCUMENT_CONTRACT.outputs, 'selection_out'), port(CACHE_CONTRACT.inputs, 'input_in'));
    const out = canConnect(port(CACHE_CONTRACT.outputs, 'result_out'), port(AGENT_CONTRACT.inputs, 'context_in'));
    expect(into).toEqual({ ok: true });
    expect(out).toEqual({ ok: true });
  });

  it('wires Polly into Agent tasks and the Human gate (reusing Task / HumanAttention)', () => {
    const task = canConnect(port(POLLY_CONTRACT.outputs, 'item_task_out'), port(AGENT_CONTRACT.inputs, 'task_in'));
    const attn = canConnect(port(POLLY_CONTRACT.outputs, 'human_attention_out'), port(HUMAN_CONTRACT.inputs, 'question_in'));
    expect(task).toEqual({ ok: true });
    expect(attn).toEqual({ ok: true });
  });

  it('feeds observation findings into Agent (browser.finding_out / git.diff_out → context_in)', () => {
    const find = canConnect(port(BROWSER_CONTRACT.outputs, 'finding_out'), port(AGENT_CONTRACT.inputs, 'context_in'));
    const diff = canConnect(port(GIT_CONTRACT.outputs, 'diff_out'), port(AGENT_CONTRACT.inputs, 'context_in'));
    expect(find).toEqual({ ok: true });
    expect(diff).toEqual({ ok: true });
  });

  it('keeps Terminal resource output isolated from message lane (stdout_out → message_in = lane.mismatch)', () => {
    const bad = canConnect(port(TERMINAL_CONTRACT.outputs, 'stdout_out'), port(AGENT_CONTRACT.inputs, 'message_in'));
    expect(bad).toEqual({ ok: false, reason: 'lane.mismatch' });
  });

  it('feeds Memory context into Agent (fact_out / proposal_out → context_in)', () => {
    const fact = canConnect(port(MEMORY_CONTRACT.outputs, 'fact_out'), port(AGENT_CONTRACT.inputs, 'context_in'));
    const prop = canConnect(port(MEMORY_CONTRACT.outputs, 'proposal_out'), port(AGENT_CONTRACT.inputs, 'context_in'));
    expect(fact).toEqual({ ok: true });
    expect(prop).toEqual({ ok: true });
  });

  it('feeds Document context into Agent (text_out / selection_out → context_in)', () => {
    const text = canConnect(port(DOCUMENT_CONTRACT.outputs, 'text_out'), port(AGENT_CONTRACT.inputs, 'context_in'));
    const sel = canConnect(port(DOCUMENT_CONTRACT.outputs, 'selection_out'), port(AGENT_CONTRACT.inputs, 'context_in'));
    expect(text).toEqual({ ok: true });
    expect(sel).toEqual({ ok: true });
  });

  it('wires Task ⇄ Agent (task_out→task_in, task_update_out→task_update_in)', () => {
    const give = canConnect(port(TASK_CONTRACT.outputs, 'task_out'), port(AGENT_CONTRACT.inputs, 'task_in'));
    const update = canConnect(port(AGENT_CONTRACT.outputs, 'task_update_out'), port(TASK_CONTRACT.inputs, 'task_update_in'));
    expect(give).toEqual({ ok: true });
    expect(update).toEqual({ ok: true });
  });

  it('closes the human-in-the-loop circuit (attention→question, reply→human_reply)', () => {
    const ask = canConnect(port(AGENT_CONTRACT.outputs, 'human_attention_out'), port(HUMAN_CONTRACT.inputs, 'question_in'));
    const back = canConnect(port(HUMAN_CONTRACT.outputs, 'reply_out'), port(AGENT_CONTRACT.inputs, 'human_reply_in'));
    expect(ask).toEqual({ ok: true });
    expect(back).toEqual({ ok: true });
  });

  it('rejects a cross-family lane mismatch (message_out → question_in)', () => {
    const bad = canConnect(port(AGENT_CONTRACT.outputs, 'message_out'), port(HUMAN_CONTRACT.inputs, 'question_in'));
    expect(bad).toEqual({ ok: false, reason: 'lane.mismatch' });
  });
});
