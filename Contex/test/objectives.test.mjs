import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContex } from '../src/index.mjs';
import { readResource } from '../src/resources.mjs';

function fresh() {
  const c = createContex();
  c.createWorkspace({ name: 'test' });
  c.setState({ tile_id: 'term', tile_type: 'terminal', status: 'working' });
  return c;
}

test('objectives are versioned and signal a reload until acknowledged', () => {
  const c = fresh();
  const v1 = c.setObjective({ tile_id: 'term', markdown: 'Build the settings panel' });
  assert.equal(v1.version, 1);
  assert.equal(c.objectiveReloadRequired('term'), true); // not yet acked

  // reload_objective fetches latest and acks it
  const reloaded = c.reloadObjective({ tile_id: 'term' });
  assert.equal(reloaded.version, 1);
  assert.equal(c.objectiveReloadRequired('term'), false);

  // a new objective version while the agent is working signals reload again
  const v2 = c.setObjective({ tile_id: 'term', markdown: 'Now add mobile widths' });
  assert.equal(v2.version, 2);
  assert.equal(c.objectiveReloadRequired('term'), true);
  c.close();
});

test('acknowledging an old version is reported as stale', () => {
  const c = fresh();
  c.setObjective({ tile_id: 'term', markdown: 'v1' });
  c.setObjective({ tile_id: 'term', markdown: 'v2' });
  const ack = c.acknowledgeObjective({ tile_id: 'term', version: 1 });
  assert.equal(ack.stale, true);
  assert.equal(ack.latest_version, 2);
  assert.equal(c.objectiveReloadRequired('term'), true);
  c.close();
});

test('skills enable/disable and produce skills.json shape', () => {
  const c = fresh();
  c.setSkill({ tile_id: 'term', skill_key: 'tinyworld-i18n', enabled: true });
  c.setSkill({ tile_id: 'term', skill_key: 'tinyworld-visual-qa', enabled: true });
  c.setSkill({ tile_id: 'term', skill_key: 'tinyworld-i18n', enabled: false }); // toggle off (upsert)
  const sj = c.listSkills('term');
  assert.deepEqual(sj.enabled, ['tinyworld-visual-qa']);
  assert.deepEqual(sj.disabled, ['tinyworld-i18n']);
  c.close();
});

test('get_context assembles objective, skills, peers, tasks, attachments', () => {
  const c = fresh();
  c.setState({ tile_id: 'chat', tile_type: 'chat', status: 'idle' });
  c.linkTiles({ source_tile_id: 'term', target_tile_id: 'chat' });
  c.setObjective({ tile_id: 'term', markdown: 'do the thing' });
  c.setSkill({ tile_id: 'term', skill_key: 'tinyworld-visual-qa', enabled: true });
  c.createTask({ title: 'a task', channel: 'term' });
  c.addAttachment({ tile_id: 'term', kind: 'file', label: 'spec', uri: 'docs/spec.md' });

  const ctx = c.getContext({ tile_id: 'term' });
  assert.equal(ctx.objective.markdown, 'do the thing');
  assert.deepEqual(ctx.skills.enabled, ['tinyworld-visual-qa']);
  assert.equal(ctx.peers.length, 1);
  assert.equal(ctx.tasks.length, 1);
  assert.equal(ctx.attachments.length, 1);
  assert.equal(ctx.attachments[0].uri, 'docs/spec.md');
  assert.equal(ctx.reload_required, true);
  c.close();
});

test('objective.md and skills.json resources render', () => {
  const c = fresh();
  c.setObjective({ tile_id: 'term', markdown: 'Ship it', rules: ['reload objective on change', 'notify the human when blocked'] });
  c.setSkill({ tile_id: 'term', skill_key: 'tinyworld-i18n', enabled: true });

  const md = readResource(c, 'context://tile/term/objective').text;
  assert.match(md, /# Objective for term \(v1\)/);
  assert.match(md, /Ship it/);
  assert.match(md, /tile:term/);
  assert.match(md, /reload objective on change/);

  const skills = JSON.parse(readResource(c, 'context://tile/term/skills').text);
  assert.deepEqual(skills.enabled, ['tinyworld-i18n']);
  c.close();
});
