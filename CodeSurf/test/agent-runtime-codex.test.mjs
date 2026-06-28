import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentConfig, buildCodexPrompt, CodexAgentRuntime, parseHumanAttention } from '../scripts/agent-runtime-codex.mjs';

test('buildAgentConfig supports legacy CARD_ID and CODEX_CHAT_MODEL env', () => {
  const cfg = buildAgentConfig({
    CONTEX_URL: 'http://127.0.0.1:9/mcp',
    CONTEX_TOKEN: 'tok',
    CONTEX_WORKSPACE: 'ws_1',
    CARD_ID: 'terminal_codex_agent',
    CODEX_CHAT_MODEL: 'gpt-5',
  }, '/repo');
  assert.equal(cfg.agentId, 'terminal_codex_agent');
  assert.equal(cfg.tileId, 'terminal_codex_agent');
  assert.equal(cfg.model, 'gpt-5');
  assert.equal(cfg.role, 'worker');
  assert.equal(cfg.cwd, '/repo');
  assert.deepEqual(cfg.capabilities, ['chat', 'terminal_input']);
});

test('buildAgentConfig reads profile and explicit Agent env overrides', () => {
  const cfg = buildAgentConfig({
    CONTEX_URL: 'http://127.0.0.1:9',
    CONTEX_TOKEN: 'tok',
    AGENT_ID: 'agent_reviewer',
    AGENT_TILE_ID: 'tile_reviewer',
    AGENT_ROLE: 'reviewer',
    AGENT_MODEL: 'gpt-5.5',
    AGENT_SYSTEM_PROMPT: 'Review risks only.',
    AGENT_CWD: '/work',
    AGENT_PROFILE_JSON: JSON.stringify({
      runtime: 'codex',
      role: 'worker',
      model: 'profile-model',
      display_name: 'Profile Name',
      capabilities: ['review', 'chat'],
      cwd: '/profile',
    }),
  }, '/repo');
  assert.equal(cfg.agentId, 'agent_reviewer');
  assert.equal(cfg.tileId, 'tile_reviewer');
  assert.equal(cfg.role, 'reviewer');
  assert.equal(cfg.runtime, 'codex');
  assert.equal(cfg.model, 'gpt-5.5');
  assert.equal(cfg.systemPrompt, 'Review risks only.');
  assert.equal(cfg.cwd, '/work');
  assert.equal(cfg.displayName, 'Profile Name');
  assert.deepEqual(cfg.capabilities, ['review', 'chat']);
});

test('buildCodexPrompt includes system prompt, role, agent id, and message', () => {
  const cfg = buildAgentConfig({
    CONTEX_URL: 'http://127.0.0.1:9',
    CONTEX_TOKEN: 'tok',
    AGENT_ID: 'agent_planner',
    AGENT_ROLE: 'planner',
    AGENT_SYSTEM_PROMPT: 'Plan the work.',
  }, '/repo');
  const prompt = buildCodexPrompt(cfg, { from_tile_id: 'chat_1', text: 'Start Phase 3' });
  assert.match(prompt, /Plan the work\./);
  assert.match(prompt, /Agent role: planner/);
  assert.match(prompt, /Agent id: agent_planner/);
  assert.match(prompt, /Message from chat_1:/);
  assert.match(prompt, /Start Phase 3/);
});

test('CodexAgentRuntime handles a message through agent_* tools', async () => {
  const cfg = buildAgentConfig({
    CONTEX_URL: 'http://127.0.0.1:9',
    CONTEX_TOKEN: 'tok',
    AGENT_ID: 'agent_worker',
    AGENT_ROLE: 'worker',
  }, '/repo');
  const calls = [];
  const runtime = new CodexAgentRuntime(cfg, { log: () => {} });
  runtime.callTool = async (name, args) => {
    calls.push([name, args]);
    return {};
  };
  runtime.runCodex = async () => 'done';

  await runtime.handleMessage({ from_tile_id: 'agent_planner', text: 'please implement' });

  assert.deepEqual(calls.map((c) => c[0]), [
    'agent_update_state',
    'agent_send_message',
    'agent_update_state',
  ]);
  assert.equal(calls[1][1].from_agent_id, 'agent_worker');
  assert.equal(calls[1][1].to_agent_id, 'agent_planner');
  assert.equal(calls[1][1].text, 'done');
});

test('parseHumanAttention recognizes explicit human escalation markers', () => {
  assert.deepEqual(parseHumanAttention('HUMAN_ATTENTION: May I delete generated files?'), {
    severity: 'decision',
    question: 'May I delete generated files?',
    reason: 'decision',
  });
  assert.deepEqual(parseHumanAttention('HUMAN_ATTENTION[permission]: Need approval to edit outside the workspace.'), {
    severity: 'permission',
    question: 'Need approval to edit outside the workspace.',
    reason: 'permission',
  });
  assert.equal(parseHumanAttention('ordinary answer'), null);
});

test('CodexAgentRuntime escalates human attention instead of sending a normal reply', async () => {
  const cfg = buildAgentConfig({
    CONTEX_URL: 'http://127.0.0.1:9',
    CONTEX_TOKEN: 'tok',
    AGENT_ID: 'agent_worker',
    AGENT_ROLE: 'worker',
  }, '/repo');
  const calls = [];
  const runtime = new CodexAgentRuntime(cfg, { log: () => {} });
  runtime.callTool = async (name, args) => {
    calls.push([name, args]);
    return {};
  };
  runtime.runCodex = async () => 'HUMAN_ATTENTION[permission]: May I edit /etc/hosts?';

  await runtime.handleMessage({ from_tile_id: 'agent_planner', text: 'please configure networking' });

  assert.deepEqual(calls.map((c) => c[0]), [
    'agent_update_state',
    'agent_request_human_input',
    'agent_report',
  ]);
  assert.equal(calls[1][1].question, 'May I edit /etc/hosts?');
  assert.equal(calls[1][1].severity, 'permission');
  assert.equal(calls.some((c) => c[0] === 'agent_send_message'), false);
});
