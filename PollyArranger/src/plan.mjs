// plan.mjs — turn a goal into a reviewable backlog (S4).
//
// Tutorial note:
//   Polly executes a backlog; the planner produces one. `plan` asks an agent to
//   decompose a GOAL (+ repo context) into small, independently-reviewable tasks
//   with `id`/`title`/`spec`/`dependsOn`/`tags` — the same shape `seedItems`
//   consumes. The result is written to a file for a HUMAN to review/edit before
//   running it (a gate, like merge). Decomposition quality is a prompt/know-how
//   problem (docs/09 §6) — the human-approval step keeps it safe.
//
//   This module is adapter-agnostic: `createPlan` takes any adapter that has a
//   `plan()` method (openai-compatible, harness, or mock).

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { detectCycle } from './planner.mjs';

export const PLAN_SYSTEM = [
  'You are a software project planner.',
  'Decompose the GOAL into a backlog of small, independently reviewable coding tasks.',
  'Each task has: a short kebab-case "id" (lowercase letters, digits, hyphens); a "title"; a detailed "spec"',
  '(what to build + acceptance criteria); "dependsOn" (ids of tasks that must merge',
  'first); and optional "tags". Order tasks so dependencies are satisfiable. Prefer',
  'many small tasks over a few large ones. Keep specs concrete and self-contained.',
].join(' ');

/** The user message: the goal + a snapshot of the repo. */
export function buildPlanUser(goal, context) {
  return `GOAL:\n${goal}\n\nREPO CONTEXT:\n${context}`;
}

/** OpenAI tool schema that forces a structured backlog (used by the API adapter). */
export const SUBMIT_PLAN_TOOL = {
  type: 'function',
  function: {
    name: 'submit_plan',
    description: 'Submit the decomposed backlog.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              spec: { type: 'string' },
              dependsOn: { type: 'array', items: { type: 'string' } },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['id', 'title', 'spec'],
          },
        },
      },
      required: ['items'],
    },
  },
};

/** Prompt for CLI harnesses (no tool-calling): demand a JSON array between markers. */
export function buildPlanPromptText(goal, context) {
  return [
    PLAN_SYSTEM,
    'Do NOT modify any files. Output ONLY the backlog as a JSON array between the markers:',
    'POLLY_PLAN_BEGIN',
    '[ { "id": "...", "title": "...", "spec": "...", "dependsOn": [], "tags": [] } ]',
    'POLLY_PLAN_END',
    '',
    buildPlanUser(goal, context),
  ].join('\n');
}

/** Extract the backlog JSON array from a CLI harness's text output. */
export function parsePlanText(text) {
  const marked = /POLLY_PLAN_BEGIN([\s\S]*?)POLLY_PLAN_END/.exec(String(text));
  const region = marked ? marked[1] : String(text);
  const arr = region.match(/\[[\s\S]*\]/);
  try { return JSON.parse(arr ? arr[0] : region); } catch { return []; }
}

/** Make an id branch-safe: lowercase, kebab-case, never empty. */
function slugId(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 't';
}

/**
 * Normalize the planner's ids to branch-safe kebab-case and remap `dependsOn`
 * to match, so a model returning e.g. "Proj Setup" or "proj_setup" still works
 * instead of failing validation.
 */
export function normalizePlanIds(items) {
  if (!Array.isArray(items)) return items;
  const map = new Map();
  const used = new Set();
  for (const it of items) {
    if (it?.id == null) continue;
    let id = slugId(it.id);
    while (used.has(id)) id = `${id}-x`;
    used.add(id);
    map.set(String(it.id), id);
  }
  return items.map((it) => ({
    ...it,
    id: it?.id != null ? map.get(String(it.id)) : it?.id,
    dependsOn: (it?.dependsOn ?? []).map((d) => map.get(String(d)) ?? slugId(d)),
  }));
}

/** Throw if the proposed backlog is malformed (structure / ids / deps / cycles). */
export function validatePlan(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('plan has no items');
  const ids = new Set();
  for (const it of items) {
    if (!it || typeof it.title !== 'string' || typeof it.spec !== 'string') {
      throw new Error('each plan item needs a string title and spec');
    }
    if (it.id != null) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(it.id))) throw new Error(`plan item id "${it.id}" must be kebab-case (lowercase letters, digits, hyphens)`);
      if (ids.has(it.id)) throw new Error(`duplicate plan item id "${it.id}"`);
      ids.add(it.id);
    }
  }
  for (const it of items) {
    for (const d of it.dependsOn ?? []) {
      if (!ids.has(d)) throw new Error(`plan item "${it.id ?? it.title}" dependsOn unknown id "${d}"`);
    }
  }
  const cyc = detectCycle(items.filter((i) => i.id != null));
  if (cyc) throw new Error(`plan has a dependency cycle: ${cyc.join(' -> ')}`);
}

/** Read-only snapshot of the repo to ground the planner. */
export function gatherContext(repoPath, { maxFiles = 200 } = {}) {
  let files = [];
  try {
    // stdio pipe so git's "not a git repository" stderr is captured, not leaked.
    files = execFileSync('git', ['-C', repoPath, 'ls-files'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .split('\n').filter(Boolean);
  } catch { /* not a git repo / empty → plan with no file context */ }
  let docs = '';
  for (const f of ['README.md', 'CLAUDE.md', 'AGENTS.md']) {
    const p = join(repoPath, f);
    if (existsSync(p)) docs += `\n--- ${f} ---\n${readFileSync(p, 'utf8').slice(0, 2000)}`;
  }
  const tree = files.slice(0, maxFiles).join('\n');
  return `FILES (${files.length} total, first ${Math.min(files.length, maxFiles)}):\n${tree}\n${docs}`.slice(0, 12000);
}

/**
 * Run the planner: gather context, ask the adapter, validate the backlog.
 * @returns {Promise<{items: object[], usage?: object}>}
 */
export async function createPlan({ adapter, repoPath, goal, context }) {
  if (typeof adapter?.plan !== 'function') {
    throw new Error(`vendor "${adapter?.vendor ?? '?'}" cannot plan (no plan() method)`);
  }
  const ctx = context ?? gatherContext(repoPath);
  const res = await adapter.plan({ goal, context: ctx });
  if (!res || res.ok === false) throw new Error(res?.error ?? 'planner failed');
  const items = normalizePlanIds(res.items); // be lenient about id formatting
  validatePlan(items);
  return { items, usage: res.usage };
}
