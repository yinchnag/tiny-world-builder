// S4 — planner: decompose a goal into a validated backlog. Offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validatePlan, createPlan, parsePlanText } from '../src/plan.mjs';
import { createMockAdapter } from '../src/adapters/mock.mjs';
import { createOpenAICompatibleAdapter } from '../src/adapters/openai-compatible.mjs';
import { seedItems } from '../src/planner.mjs';
import { createEmptyRegistry } from '../src/registry/store.mjs';

// ---- validatePlan ----------------------------------------------------------

test('validatePlan accepts a good plan and rejects bad ones', () => {
  assert.doesNotThrow(() => validatePlan([
    { id: 'a', title: 'A', spec: 'do a' },
    { id: 'b', title: 'B', spec: 'do b', dependsOn: ['a'] },
  ]));
  assert.throws(() => validatePlan([]), /no items/);
  assert.throws(() => validatePlan([{ id: 'a', title: 'A' }]), /title and spec/);
  assert.throws(() => validatePlan([{ id: 'A', title: 'A', spec: 'x' }]), /lowercase/);
  assert.throws(() => validatePlan([{ id: 'a', title: 'A', spec: 'x', dependsOn: ['ghost'] }]), /unknown id/);
  assert.throws(() => validatePlan([
    { id: 'a', title: 'A', spec: 'x', dependsOn: ['b'] },
    { id: 'b', title: 'B', spec: 'y', dependsOn: ['a'] },
  ]), /cycle/);
});

test('parsePlanText extracts a JSON array (with or without markers)', () => {
  assert.equal(parsePlanText('noise POLLY_PLAN_BEGIN [{"id":"a","title":"A","spec":"x"}] POLLY_PLAN_END tail')[0].id, 'a');
  assert.equal(parsePlanText('here is the plan: [{"id":"b","title":"B","spec":"y"}]')[0].id, 'b');
  assert.deepEqual(parsePlanText('no json here'), []);
});

// ---- createPlan with a mock adapter ----------------------------------------

test('createPlan validates the mock adapter output and feeds seedItems', async () => {
  const items = [
    { id: 'schema', title: 'DB schema', spec: 'create users table' },
    { id: 'api', title: 'API', spec: 'add /users', dependsOn: ['schema'], tags: ['backend'] },
  ];
  const adapter = createMockAdapter({ vendor: 'deepseek', planItems: items });
  // context provided → no repo/git needed
  const plan = await createPlan({ adapter, goal: 'build a users service', context: '(none)' });
  assert.equal(plan.items.length, 2);

  // the plan should be directly runnable as a backlog
  const reg = createEmptyRegistry();
  const created = seedItems(reg, plan.items);
  assert.deepEqual(created.map((i) => i.id), ['schema', 'api']);
  assert.deepEqual(created[1].dependsOn, ['schema']);
  assert.deepEqual(created[1].tags, ['backend']);
});

test('createPlan throws if the adapter cannot plan', async () => {
  await assert.rejects(createPlan({ adapter: { vendor: 'x' }, goal: 'g', context: 'c' }), /cannot plan/);
});

// ---- openai-compatible plan via a fake fetch -------------------------------

test('openai-compatible plan() parses a submit_plan tool call', async () => {
  const fetchImpl = async (_url, options) => {
    // assert the planner asked for the submit_plan tool
    const body = JSON.parse(options.body);
    assert.equal(body.tool_choice.function.name, 'submit_plan');
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'c1', type: 'function',
              function: { name: 'submit_plan', arguments: JSON.stringify({ items: [{ id: 'a', title: 'A', spec: 'do a' }] }) },
            }],
          },
        }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      }),
      text: async () => '',
    };
  };
  const adapter = createOpenAICompatibleAdapter({ provider: 'deepseek', repoPath: '/tmp/x', apiKey: 'k', fetchImpl });
  const res = await adapter.plan({ goal: 'build X', context: 'files...' });
  assert.equal(res.ok, true);
  assert.equal(res.items[0].id, 'a');
  assert.equal(res.usage.totalTokens, 8);
});
