import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContex, ErrorCodes } from '../src/index.mjs';
import { callTool, toolCatalog } from '../src/tools.mjs';
import { listResources, readResource } from '../src/resources.mjs';

function fresh(opts = {}) {
  const c = createContex(opts);
  c.createWorkspace({ name: 'agents', repository_path: '/repo' });
  return c;
}

test('agent_register creates a tile-backed agent state', () => {
  const c = fresh();
  const agent = c.agentRegister({
    agent_id: 'agent_worker_1',
    runtime: 'codex',
    role: 'worker',
    display_name: 'Worker 1',
    capabilities: ['chat', 'code_edit'],
    status: 'idle',
    task: 'Waiting for work',
  });
  assert.equal(agent.agent_id, 'agent_worker_1');
  assert.equal(agent.tile_id, 'agent_worker_1');
  assert.equal(agent.runtime, 'codex');
  assert.equal(agent.role, 'worker');
  assert.equal(agent.display_name, 'Worker 1');
  assert.equal(agent.status, 'idle');
  assert.deepEqual(agent.capabilities, ['chat', 'code_edit']);

  const tile = c.getTile('agent_worker_1');
  assert.equal(tile.type, 'terminal');
  assert.ok(tile.capabilities.includes('agent'));
  assert.ok(tile.capabilities.includes('role:worker'));
  assert.ok(tile.capabilities.includes('runtime:codex'));
  c.close();
});

test('agent_update_state updates status and preserves role/runtime markers', () => {
  const c = fresh();
  c.agentRegister({ agent_id: 'agent_reviewer', runtime: 'codex', role: 'reviewer', capabilities: ['review'], status: 'idle' });
  const updated = c.agentUpdateState({
    agent_id: 'agent_reviewer',
    status: 'working',
    task: 'Review Phase 2',
    summary: 'Checking semantic API tests',
  });
  assert.equal(updated.status, 'working');
  assert.equal(updated.task, 'Review Phase 2');
  assert.equal(updated.summary, 'Checking semantic API tests');
  assert.equal(updated.role, 'reviewer');
  assert.equal(updated.runtime, 'codex');
  assert.deepEqual(updated.capabilities, ['review']);
  c.close();
});

test('agent_list filters registered agents by role, runtime, status, and capability', () => {
  const c = fresh();
  c.agentRegister({ agent_id: 'planner', runtime: 'codex', role: 'planner', capabilities: ['planning'], status: 'working' });
  c.agentRegister({ agent_id: 'worker', runtime: 'codex', role: 'worker', capabilities: ['code_edit'], status: 'idle' });
  c.agentRegister({ agent_id: 'shell', runtime: 'shell', role: 'worker', capabilities: ['terminal'], status: 'idle' });
  c.setState({ tile_id: 'plain_terminal', tile_type: 'terminal', status: 'idle' });

  assert.deepEqual(c.agentList({ role: 'worker' }).map((a) => a.agent_id).sort(), ['shell', 'worker']);
  assert.deepEqual(c.agentList({ runtime: 'codex' }).map((a) => a.agent_id).sort(), ['planner', 'worker']);
  assert.deepEqual(c.agentList({ status: 'idle' }).map((a) => a.agent_id).sort(), ['shell', 'worker']);
  assert.deepEqual(c.agentList({ capability: 'planning' }).map((a) => a.agent_id), ['planner']);
  assert.equal(c.agentList({}).some((a) => a.agent_id === 'plain_terminal'), false);
  c.close();
});

test('agent_send_message and agent_read_messages use existing link-gated inbox', () => {
  const c = fresh();
  c.agentRegister({ agent_id: 'planner', runtime: 'codex', role: 'planner', status: 'working' });
  c.agentRegister({ agent_id: 'worker', runtime: 'codex', role: 'worker', status: 'idle' });
  assert.throws(
    () => c.agentSendMessage({ from_agent_id: 'planner', to_agent_id: 'worker', text: 'Implement API' }),
    (e) => e.code === ErrorCodes.PEER_NOT_LINKED,
  );

  c.linkTiles({ source_tile_id: 'planner', target_tile_id: 'worker' });
  c.agentSendMessage({ from_agent_id: 'planner', to_agent_id: 'worker', text: 'Implement API', requires_ack: true });
  const messages = c.agentReadMessages({ agent_id: 'worker', acknowledge: true });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'Implement API');
  assert.ok(messages[0].read_at);
  assert.ok(messages[0].acknowledged_at);
  c.close();
});

test('agent messages respect directed link flow', () => {
  const c = fresh();
  c.agentRegister({ agent_id: 'lead', runtime: 'codex', role: 'planner', status: 'working' });
  c.agentRegister({ agent_id: 'worker', runtime: 'codex', role: 'worker', status: 'working' });
  c.linkTiles({ source_tile_id: 'lead', target_tile_id: 'worker', kind: 'controls', directed: true });

  assert.equal(c.agentSendMessage({ from_agent_id: 'lead', to_agent_id: 'worker', text: 'Please start' }).text, 'Please start');
  assert.throws(
    () => c.agentSendMessage({ from_agent_id: 'worker', to_agent_id: 'lead', text: 'Reverse path' }),
    (e) => e.code === ErrorCodes.PEER_NOT_LINKED,
  );
  c.close();
});

test('agent_claim_task assigns open work and can move it into progress', () => {
  const c = fresh();
  c.agentRegister({ agent_id: 'coordinator', runtime: 'codex', role: 'coordinator', status: 'working' });
  c.agentRegister({ agent_id: 'worker', runtime: 'codex', role: 'worker', status: 'idle' });
  const task = c.createTask({ title: 'Implement Phase 5', creator_tile_id: 'coordinator' });

  const claimed = c.agentClaimTask({ agent_id: 'worker', task_id: task.id, expected_version: task.version });
  assert.equal(claimed.status, 'assigned');
  assert.equal(claimed.owner_tile_id, 'worker');

  const started = c.agentClaimTask({ agent_id: 'worker', task_id: task.id });
  assert.equal(started.status, 'in_progress');
  assert.equal(started.owner_tile_id, 'worker');
  c.close();
});

test('agent_complete_task walks lifecycle to done with result summary', () => {
  const c = fresh();
  c.agentRegister({ agent_id: 'worker', runtime: 'codex', role: 'worker', status: 'working' });
  const task = c.createTask({ title: 'Finish task' });

  const done = c.agentCompleteTask({ agent_id: 'worker', task_id: task.id, result_summary: 'Implemented and tested.' });
  assert.equal(done.status, 'done');
  assert.equal(done.owner_tile_id, 'worker');
  assert.equal(done.result_summary, 'Implemented and tested.');
  assert.ok(done.completed_at);
  c.close();
});

test('agent_request_handoff moves ownership and sends a linked handoff message', () => {
  const c = fresh();
  c.agentRegister({ agent_id: 'worker', runtime: 'codex', role: 'worker', status: 'working' });
  c.agentRegister({ agent_id: 'reviewer', runtime: 'codex', role: 'reviewer', status: 'idle' });
  c.linkTiles({ source_tile_id: 'worker', target_tile_id: 'reviewer' });
  const task = c.createTask({ title: 'Review handoff', owner_tile_id: 'worker' });
  c.agentClaimTask({ agent_id: 'worker', task_id: task.id });

  const out = c.agentRequestHandoff({
    from_agent_id: 'worker',
    to_agent_id: 'reviewer',
    task_id: task.id,
    text: 'Please review this implementation.',
  });
  assert.equal(out.task.owner_tile_id, 'reviewer');
  assert.equal(out.message.to_tile_id, 'reviewer');
  assert.equal(out.message.requires_ack, true);
  assert.equal(c.agentReadMessages({ agent_id: 'reviewer' })[0].text, 'Please review this implementation.');
  c.close();
});

test('agent_report sends results back and can update task summary', () => {
  const c = fresh();
  c.agentRegister({ agent_id: 'reviewer', runtime: 'codex', role: 'reviewer', status: 'working' });
  c.agentRegister({ agent_id: 'coordinator', runtime: 'codex', role: 'coordinator', status: 'working' });
  c.linkTiles({ source_tile_id: 'reviewer', target_tile_id: 'coordinator' });
  const task = c.createTask({ title: 'Report review', owner_tile_id: 'reviewer' });

  const out = c.agentReport({
    from_agent_id: 'reviewer',
    to_agent_id: 'coordinator',
    task_id: task.id,
    text: 'Review passed.',
    result_summary: 'Reviewer approved the change.',
  });
  assert.equal(out.task.result_summary, 'Reviewer approved the change.');
  assert.equal(out.message.text, 'Review passed.');
  assert.equal(c.agentReadMessages({ agent_id: 'coordinator' })[0].text, 'Review passed.');
  c.close();
});

test('agent_broadcast selects agents and reports link-gated delivery results', () => {
  const c = fresh();
  c.agentRegister({ agent_id: 'coordinator', runtime: 'codex', role: 'coordinator', status: 'working' });
  c.agentRegister({ agent_id: 'worker_a', runtime: 'codex', role: 'worker', status: 'idle' });
  c.agentRegister({ agent_id: 'worker_b', runtime: 'codex', role: 'worker', status: 'idle' });
  c.agentRegister({ agent_id: 'reviewer', runtime: 'codex', role: 'reviewer', status: 'idle' });
  c.linkTiles({ source_tile_id: 'coordinator', target_tile_id: 'worker_a' });

  const out = c.agentBroadcast({
    from_agent_id: 'coordinator',
    selector: { role: 'worker' },
    text: 'Workers, stand by.',
  });
  assert.equal(out.recipients.length, 2);
  assert.equal(out.delivered, 1);
  assert.equal(out.failed, 1);
  assert.deepEqual(out.recipients.map((r) => [r.agent_id, r.delivered]).sort(), [
    ['worker_a', true],
    ['worker_b', false],
  ]);
  assert.equal(c.agentReadMessages({ agent_id: 'worker_a' })[0].text, 'Workers, stand by.');
  c.close();
});

test('agent collaboration timeline summarizes status, message, and task events', () => {
  const c = fresh();
  const ws = c.soleWorkspace();
  c.agentRegister({ agent_id: 'coordinator', runtime: 'codex', role: 'coordinator', status: 'working', task: 'Plan Phase 6' });
  c.agentRegister({ agent_id: 'worker', runtime: 'codex', role: 'worker', status: 'idle' });
  c.agentRegister({ agent_id: 'reviewer', runtime: 'codex', role: 'reviewer', status: 'idle' });
  c.linkTiles({ source_tile_id: 'coordinator', target_tile_id: 'worker' });
  c.linkTiles({ source_tile_id: 'worker', target_tile_id: 'reviewer' });
  c.linkTiles({ source_tile_id: 'reviewer', target_tile_id: 'coordinator' });

  const task = c.createTask({ title: 'Build timeline view', creator_tile_id: 'coordinator' });
  c.agentClaimTask({ agent_id: 'worker', task_id: task.id });
  c.agentRequestHandoff({ from_agent_id: 'worker', to_agent_id: 'reviewer', task_id: task.id, text: 'Please review timeline.' });
  c.agentReport({ from_agent_id: 'reviewer', to_agent_id: 'coordinator', task_id: task.id, text: 'Timeline looks good.', result_summary: 'Reviewed.' });

  const workspaceEvents = c.listTimeline({ workspace_id: ws.id, limit: 100 });
  assert.ok(workspaceEvents.some((e) => e.category === 'status' && e.summary.includes('coordinator is working')));
  assert.ok(workspaceEvents.some((e) => e.category === 'task' && e.summary.includes('Build timeline view')));
  assert.ok(workspaceEvents.some((e) => e.category === 'message' && e.summary === 'worker -> reviewer'));
  assert.ok(workspaceEvents.some((e) => e.category === 'message' && e.summary === 'reviewer -> coordinator'));

  const reviewerEvents = c.listTimeline({ tile_id: 'reviewer', limit: 100 });
  assert.ok(reviewerEvents.some((e) => e.summary === 'worker -> reviewer'));
  assert.ok(reviewerEvents.some((e) => e.summary === 'reviewer -> coordinator'));
  assert.equal(reviewerEvents.some((e) => e.summary === 'coordinator -> worker'), false);
  c.close();
});

test('agent timeline is exposed through resources and MCP tools', () => {
  const c = fresh();
  const ws = c.soleWorkspace();
  c.agentRegister({ agent_id: 'coordinator', runtime: 'codex', role: 'coordinator', status: 'working' });
  c.agentRegister({ agent_id: 'worker', runtime: 'codex', role: 'worker', status: 'idle' });
  c.linkTiles({ source_tile_id: 'coordinator', target_tile_id: 'worker' });
  c.agentSendMessage({ from_agent_id: 'coordinator', to_agent_id: 'worker', text: 'Start Phase 6.' });

  const uris = listResources(c).map((r) => r.uri);
  assert.ok(uris.includes(`context://workspace/${ws.id}/timeline`));
  assert.ok(uris.includes('context://tile/worker/timeline'));

  const resource = JSON.parse(readResource(c, 'context://tile/worker/timeline').text);
  assert.equal(resource.tile_id, 'worker');
  assert.ok(resource.events.some((e) => e.category === 'message' && e.summary === 'coordinator -> worker'));

  const toolEvents = callTool(c, 'get_agent_timeline', { agent_id: 'worker' }).events;
  assert.ok(toolEvents.some((e) => e.summary === 'coordinator -> worker'));
  const workspaceEvents = callTool(c, 'get_workspace_timeline', { workspace_id: ws.id }).events;
  assert.ok(workspaceEvents.length >= toolEvents.length);
  c.close();
});

test('agent_request_human_input blocks the agent and emits human attention', () => {
  const c = fresh();
  const notes = [];
  c.events.on('notification', (n) => notes.push(n));
  c.agentRegister({ agent_id: 'worker', runtime: 'codex', role: 'worker', status: 'idle' });
  const task = c.createTask({ title: 'Needs approval', owner_tile_id: 'worker' });

  const out = c.agentRequestHumanInput({
    agent_id: 'worker',
    task_id: task.id,
    question: 'May I modify protected files?',
    severity: 'permission',
  });

  assert.equal(out.ok, true);
  assert.equal(out.agent.status, 'blocked');
  assert.equal(out.agent.blocker, 'May I modify protected files?');
  assert.equal(out.task.blocker, 'May I modify protected files?');
  assert.equal(out.attention.severity, 'permission');
  assert.ok(notes.some((n) => n.method.endsWith('human_attention') && n.params.text === 'May I modify protected files?'));

  const timeline = c.listTimeline({ tile_id: 'worker', limit: 100 });
  assert.ok(timeline.some((e) => e.category === 'notification' && e.summary === 'May I modify protected files?'));
  c.close();
});

test('agent tools are exposed through the MCP tool layer', () => {
  const c = fresh();
  const names = toolCatalog().map((t) => t.name);
  for (const name of [
    'agent_register',
    'agent_update_state',
    'agent_list',
    'agent_send_message',
    'agent_read_messages',
    'agent_claim_task',
    'agent_complete_task',
    'agent_request_handoff',
    'agent_report',
    'agent_broadcast',
    'agent_request_human_input',
    'get_agent_timeline',
    'get_workspace_timeline',
    'list_peers',
    'list_tasks',
    'list_file_claims',
  ]) {
    assert.ok(names.includes(name), `${name} should be in tool catalog`);
  }

  callTool(c, 'agent_register', { agent_id: 'agent_a', runtime: 'codex', role: 'worker', status: 'idle' });
  callTool(c, 'agent_register', { agent_id: 'agent_b', runtime: 'codex', role: 'reviewer', status: 'idle' });
  callTool(c, 'link_tiles', { source_tile_id: 'agent_a', target_tile_id: 'agent_b' });
  callTool(c, 'agent_send_message', { from_agent_id: 'agent_a', to_agent_id: 'agent_b', text: 'ready for review' });

  const list = callTool(c, 'agent_list', { role: 'reviewer' });
  assert.deepEqual(list.agents.map((a) => a.agent_id), ['agent_b']);
  const inbox = callTool(c, 'agent_read_messages', { agent_id: 'agent_b' });
  assert.equal(inbox.messages[0].text, 'ready for review');
  const peerView = callTool(c, 'list_peers', {});
  assert.deepEqual(peerView.peers.map((a) => a.agent_id).sort(), ['agent_a', 'agent_b']);
  const semanticLink = callTool(c, 'link_tiles', { source_tile_id: 'agent_a', target_tile_id: 'agent_c', kind: 'handoff', directed: true });
  assert.equal(semanticLink.kind, 'handoff');

  const task = callTool(c, 'create_task', { title: 'Tool task' });
  const taskList = callTool(c, 'list_tasks', {});
  assert.ok(taskList.tasks.some((row) => row.id === task.id));
  const claims = callTool(c, 'list_file_claims', {});
  assert.deepEqual(claims.claims, []);
  const claimed = callTool(c, 'agent_claim_task', { agent_id: 'agent_a', task_id: task.id });
  assert.equal(claimed.owner_tile_id, 'agent_a');
  const done = callTool(c, 'agent_complete_task', { agent_id: 'agent_a', task_id: task.id, result_summary: 'done' });
  assert.equal(done.status, 'done');
  const human = callTool(c, 'agent_request_human_input', { agent_id: 'agent_a', question: 'Need approval' });
  assert.equal(human.attention.text, 'Need approval');
  c.close();
});
