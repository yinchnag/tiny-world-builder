// adapters/openai-compatible.mjs — a REAL agent backend for any OpenAI-compatible
// chat API (DeepSeek, OpenAI, Kimi, Qwen, GLM, OpenRouter, …). Phase 2.2.
//
// Tutorial note:
//   A raw LLM API is not an agent — it's a text endpoint. To make it an
//   IMPLEMENTER (which must edit files in a worktree), we wrap it in a
//   tool-calling LOOP (docs/04 section 3):
//
//     1. Send the model the task + a set of TOOLS (read_file, write_file,
//        run_command, list_files, finish), all scoped to the worktree.
//     2. The model replies with tool calls. We EXECUTE them on disk and feed the
//        results back.
//     3. Repeat until the model calls `finish` (or stops asking for tools).
//     4. Commit whatever changed. That commit is what the git service later
//        pushes + opens a PR for.
//
//   As a REVIEWER, no loop is needed: one call returns a structured verdict.
//
//   The adapter implements Polly's standard contract (docs/04 section 2):
//     implement(task) -> { ok, convId, summary, commits }
//     review(task)    -> { ok, convId, verdict, findings }
//   so the orchestrator never knows which provider is behind it.
//
//   Zero dependencies: uses the built-in global `fetch` (Node 18+). `fetchImpl`
//   is injectable so tests can drive the loop with NO network (see the test).

import { execFileSync, execSync } from 'node:child_process';
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync,
} from 'node:fs';
import { isAbsolute, join, resolve, dirname, relative, sep } from 'node:path';

/** Known providers. Add one = a row here + a family in DEFAULT_FAMILIES. */
export const PROVIDERS = {
  deepseek: { baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', keyEnv: 'DEEPSEEK_API_KEY', family: 'deepseek' },
  openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyEnv: 'OPENAI_API_KEY', family: 'openai' },
  kimi: { baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', keyEnv: 'MOONSHOT_API_KEY', family: 'kimi' },
  glm: { baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', keyEnv: 'ZHIPU_API_KEY', family: 'glm' },
  // Qwen / Alibaba DashScope (OpenAI-compatible mode). Mainland endpoint shown;
  // international users: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
  qwen: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', keyEnv: 'DASHSCOPE_API_KEY', family: 'qwen' },
  openrouter: { baseURL: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', keyEnv: 'OPENROUTER_API_KEY', family: 'openrouter' },
};

const IMPLEMENT_SYSTEM = [
  'You are a precise coding agent working inside a git worktree.',
  'Complete the task by editing files with the provided tools.',
  'Make the SMALLEST change that fully satisfies the task. Do not refactor unrelated code.',
  'Read before you write. Prefer write_file with the full new file contents.',
  'When the task is complete, call finish with a one-line summary.',
  'Do not ask questions; act.',
].join(' ');

const REVIEW_SYSTEM = [
  'You are an adversarial code reviewer from a different vendor than the author.',
  'You are TRYING to find real problems: bugs, missing cases, security issues, spec violations.',
  'Judge the diff against the stated task. Call submit_review exactly once.',
  'Use BLOCKING only for issues that must be fixed before merge; NON_BLOCKING for nits; CLEAN if none.',
].join(' ');

// ---- tool schemas (OpenAI function-calling format) -------------------------

const IMPLEMENT_TOOLS = [
  fn('list_files', 'List files in the worktree (recursive, truncated).', {
    dir: { type: 'string', description: 'subdirectory, default "."' },
  }),
  fn('read_file', 'Read a UTF-8 text file in the worktree.', {
    path: { type: 'string' },
  }, ['path']),
  fn('write_file', 'Create or overwrite a file in the worktree with the given contents.', {
    path: { type: 'string' }, content: { type: 'string' },
  }, ['path', 'content']),
  fn('run_command', 'Run a shell command in the worktree (e.g. to build or test).', {
    command: { type: 'string' },
  }, ['command']),
  fn('finish', 'Call when the task is complete.', {
    summary: { type: 'string' },
  }, ['summary']),
];

const REVIEW_TOOLS = [
  fn('submit_review', 'Submit the review verdict.', {
    verdict: { type: 'string', enum: ['CLEAN', 'NON_BLOCKING', 'BLOCKING'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string' },
          where: { type: 'string' },
          what: { type: 'string' },
        },
      },
    },
  }, ['verdict']),
];

function fn(name, description, properties, required = []) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

// ---- the adapter -----------------------------------------------------------

/**
 * @param {object} cfg
 * @param {string} cfg.provider        - key in PROVIDERS (e.g. 'deepseek')
 * @param {string} cfg.repoPath        - repo root, to resolve relative worktrees
 * @param {string} [cfg.apiKey]        - overrides process.env[provider.keyEnv]
 * @param {string} [cfg.model]         - overrides the provider default model
 * @param {string} [cfg.baseURL]       - overrides the provider base URL
 * @param {number} [cfg.maxSteps]      - tool-loop safety cap (default 24)
 * @param {string} [cfg.baseRef]       - base branch for review diffs (default 'main')
 * @param {Function} [cfg.fetchImpl]   - injectable fetch (default global fetch)
 */
export function createOpenAICompatibleAdapter(cfg) {
  const p = PROVIDERS[cfg.provider];
  if (!p) throw new Error(`unknown provider "${cfg.provider}"`);
  if (!cfg.repoPath) throw new Error('repoPath is required');

  const vendor = cfg.provider;
  const baseURL = cfg.baseURL ?? p.baseURL;
  const model = cfg.model ?? p.model;
  const apiKey = cfg.apiKey ?? process.env[p.keyEnv];
  const maxSteps = cfg.maxSteps ?? 24;
  const baseRef = cfg.baseRef ?? 'main';
  const doFetch = cfg.fetchImpl ?? globalThis.fetch;

  const absWt = (worktreePath) =>
    isAbsolute(worktreePath) ? worktreePath : join(cfg.repoPath, worktreePath);

  // One chat-completions call. Returns the assistant message object.
  async function chat(messages, tools, toolChoice = 'auto') {
    if (!apiKey) throw new Error(`${vendor}: missing API key (set ${p.keyEnv})`);
    const res = await doFetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools, tool_choice: toolChoice, temperature: 0 }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${vendor} HTTP ${res.status}: ${body.slice(0, 400)}`);
    }
    const data = await res.json();
    // OpenAI-compatible responses carry token usage; return it for cost tracking.
    return { message: data.choices[0].message, usage: data.usage ?? null };
  }

  return {
    vendor,

    async implement(task) {
      const root = absWt(task.worktreePath);
      const convId = `conv_${vendor}_${task.itemId ?? 'item'}_${Date.now()}`;
      const usage = newUsage();
      const messages = [
        { role: 'system', content: IMPLEMENT_SYSTEM },
        { role: 'user', content: task.spec },
      ];
      let summary = '';

      for (let step = 0; step < maxSteps; step += 1) {
        let resp;
        try {
          resp = await chat(messages, IMPLEMENT_TOOLS);
        } catch (err) {
          return { ok: false, convId, summary: `model call failed: ${err.message}`, commits: [], usage };
        }
        addUsage(usage, resp.usage);
        const msg = resp.message;
        messages.push(msg);

        const calls = msg.tool_calls ?? [];
        if (calls.length === 0) {
          // Model answered with prose and no tool call → treat as finished.
          summary = msg.content ?? '';
          break;
        }

        let finished = false;
        for (const tc of calls) {
          const args = safeParse(tc.function.arguments);
          if (tc.function.name === 'finish') {
            summary = args.summary ?? '';
            finished = true;
            pushToolResult(messages, tc, 'ok');
          } else {
            pushToolResult(messages, tc, runTool(root, tc.function.name, args));
          }
        }
        if (finished) break;
      }

      // Commit whatever changed. No changes → the implement failed to do anything.
      const dirty = gitOut(root, ['status', '--porcelain']).length > 0;
      if (!dirty) {
        return { ok: false, convId, summary: summary || 'no file changes produced', commits: [], usage };
      }
      gitOut(root, ['add', '-A']);
      gitOut(root, ['commit', '-m', commitMessage(task, summary)]);
      const sha = gitOut(root, ['rev-parse', '--short', 'HEAD']);
      return { ok: true, convId, summary: summary || 'changes committed', commits: [sha], usage };
    },

    async review(task) {
      const root = absWt(task.worktreePath);
      const convId = `conv_${vendor}_rev_${task.itemId ?? 'item'}_${Date.now()}`;
      const usage = newUsage();
      // The diff of this branch vs its base.
      let diff = '';
      try {
        diff = gitOut(root, ['diff', `${baseRef}...HEAD`]);
      } catch {
        diff = gitOut(root, ['diff', 'HEAD~1']); // fallback
      }
      const messages = [
        { role: 'system', content: REVIEW_SYSTEM },
        { role: 'user', content: `TASK:\n${task.spec}\n\nDIFF:\n${diff.slice(0, 24000)}` },
      ];
      let resp;
      try {
        resp = await chat(messages, REVIEW_TOOLS, { type: 'function', function: { name: 'submit_review' } });
      } catch (err) {
        return { ok: false, convId, verdict: 'BLOCKING', findings: [{ severity: 'error', where: '-', what: `review failed: ${err.message}` }], usage };
      }
      addUsage(usage, resp.usage);
      const call = (resp.message.tool_calls ?? [])[0];
      const args = call ? safeParse(call.function.arguments) : {};
      const verdict = ['CLEAN', 'NON_BLOCKING', 'BLOCKING'].includes(args.verdict) ? args.verdict : 'BLOCKING';
      return { ok: true, convId, verdict, findings: args.findings ?? [], usage };
    },
  };
}

// ---- tool executors (all scoped to the worktree) ---------------------------

function runTool(root, name, args) {
  try {
    switch (name) {
      case 'list_files': return listFiles(root, args.dir ?? '.');
      case 'read_file': return readWithin(root, args.path);
      case 'write_file': return writeWithin(root, args.path, args.content ?? '');
      case 'run_command': return runCommand(root, args.command ?? '');
      default: return `error: unknown tool ${name}`;
    }
  } catch (err) {
    return `error: ${err.message}`;
  }
}

// Resolve a user-supplied path and REFUSE anything that escapes the worktree.
function within(root, p) {
  const abs = resolve(root, p ?? '.');
  const rel = relative(root, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('path escapes the worktree');
  return abs;
}

function listFiles(root, dir, limit = 300) {
  const start = within(root, dir);
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === '.git' || name === 'node_modules') continue;
      const abs = join(d, name);
      const rel = relative(root, abs).split(sep).join('/');
      if (out.length >= limit) return;
      if (statSync(abs).isDirectory()) walk(abs);
      else out.push(rel);
    }
  };
  walk(start);
  return out.join('\n') || '(empty)';
}

function readWithin(root, p, maxBytes = 60000) {
  const abs = within(root, p);
  if (!existsSync(abs)) return `error: no such file: ${p}`;
  return readFileSync(abs, 'utf8').slice(0, maxBytes);
}

function writeWithin(root, p, content) {
  const abs = within(root, p);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return `wrote ${content.length} bytes to ${p}`;
}

function runCommand(root, command, maxOut = 8000) {
  if (!command) return 'error: empty command';
  try {
    const out = execSync(command, { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
    return `exit 0\n${out}`.slice(0, maxOut);
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    return `exit ${err.status ?? 1}\n${out}`.slice(0, maxOut);
  }
}

// ---- small helpers ---------------------------------------------------------

function gitOut(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).toString().trim();
}

function pushToolResult(messages, toolCall, content) {
  messages.push({ role: 'tool', tool_call_id: toolCall.id, content: String(content) });
}

function safeParse(s) {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

function commitMessage(task, summary) {
  const title = summary?.split('\n')[0]?.slice(0, 72) || `implement ${task.itemId ?? 'item'}`;
  return title;
}

// ---- token usage accounting ------------------------------------------------

function newUsage() {
  return { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

// Fold one API response's `usage` block into the running total. `calls` counts
// model round-trips even when a provider omits token counts.
function addUsage(acc, u) {
  acc.calls += 1;
  if (!u) return;
  acc.promptTokens += u.prompt_tokens ?? 0;
  acc.completionTokens += u.completion_tokens ?? 0;
  acc.totalTokens += u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
}
