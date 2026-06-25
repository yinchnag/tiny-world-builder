// adapters/harness.mjs — drive an installed coding-agent CLI (②).
//
// Tutorial note:
//   Claude Code and Codex are not raw APIs — they are full agent CLIs that are
//   already installed and AUTHENTICATED on the machine. So this adapter spawns
//   the CLI as a subprocess in the item's worktree and lets it do the work,
//   then Polly commits the result. Crucially it passes NO API KEY: the CLI uses
//   whatever auth it was set up with (company SSO, a managed key, Bedrock, …).
//   That's why a harness vendor works even when you can't get a key yourself.
//
//   Same contract as every adapter (docs/04 §2): implement → AgentResult,
//   review → ReviewResult. Differences from the openai-compatible adapter:
//     * no tool loop — the CLI IS the agent; we just hand it the task.
//     * the prompt goes via STDIN (quote-safe; avoids shell-escaping a spec).
//     * review output is parsed from strict POLLY_VERDICT/POLLY_FINDING markers
//       (a CLI can't be forced into tool-calling like an API can).
//     * resume (⑤) uses the CLI's OWN session (claude --session-id/--resume).
//
//   `runner` is injectable so tests drive a fake CLI with no real process.

import { execFileSync, spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ---- vendor presets --------------------------------------------------------
// Each preset says how to invoke its CLI. Flags here reflect Claude Code 2.1.x;
// verify on the target machine (esp. the workspace-trust prompt + permissions).

export const HARNESS_PRESETS = {
  claude_code: {
    command: 'claude',
    family: 'anthropic',
    supportsResume: true, // native session resume → ⑤ for free
    // prompt via stdin; flags only in args.
    implement: ({ sessionId, resume }) => ({
      args: [
        '-p', '--output-format', 'json', '--permission-mode', 'acceptEdits',
        ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]),
      ],
      viaStdin: true,
    }),
    review: () => ({ args: ['-p', '--output-format', 'json'], viaStdin: true }),
    // claude -p --output-format json prints a JSON envelope.
    extractText: (stdout) => { try { return JSON.parse(stdout).result ?? ''; } catch { return stdout; } },
    extractMeta: (stdout) => {
      try {
        const j = JSON.parse(stdout);
        const u = j.usage ?? {};
        return {
          sessionId: j.session_id,
          usage: {
            calls: 1,
            promptTokens: u.input_tokens ?? 0,
            completionTokens: u.output_tokens ?? 0,
            totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
            costUsd: j.total_cost_usd ?? 0,
          },
        };
      } catch { return {}; }
    },
  },

  codex: {
    command: 'codex',
    family: 'openai',
    supportsResume: false, // soft-resume: the worktree carries prior state
    implement: ({ spec }) => ({ args: ['exec', spec], viaStdin: false }),
    review: ({ prompt }) => ({ args: ['exec', prompt], viaStdin: false }),
    extractText: (stdout) => stdout,
    extractMeta: () => ({}),
  },
};

const newUsage = () => ({ calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 });

/** Default subprocess runner. Writes `input` to stdin; captures stdout/stderr/code. */
export function defaultRunner({ command, args, cwd, input, shell = false }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, shell });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err.message) });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr + String(err.message) }));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
    if (input != null) { child.stdin?.write(input); child.stdin?.end(); }
    else child.stdin?.end();
  });
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).toString().trim();
}

function buildReviewPrompt(spec, diff) {
  return [
    'You are an adversarial code reviewer from a different vendor than the author.',
    'Review the DIFF against the TASK. Find real bugs, missing cases, security issues, spec violations.',
    'Do NOT modify any files.',
    'End your reply with exactly one line:',
    'POLLY_VERDICT: CLEAN | NON_BLOCKING | BLOCKING',
    'For each issue, add a line: POLLY_FINDING: <where> :: <what>',
    '',
    `TASK:\n${spec}`,
    '',
    `DIFF:\n${String(diff).slice(0, 24000)}`,
  ].join('\n');
}

function parseReviewMarkers(text) {
  const vm = /POLLY_VERDICT:\s*(CLEAN|NON_BLOCKING|BLOCKING)/i.exec(text);
  const verdict = vm ? vm[1].toUpperCase() : 'BLOCKING'; // unparseable → conservative
  const findings = [...text.matchAll(/POLLY_FINDING:\s*(.+?)\s*::\s*(.+)/gi)].map((m) => ({
    severity: verdict === 'BLOCKING' ? 'blocking' : 'nit',
    where: m[1].trim(),
    what: m[2].trim(),
  }));
  return { verdict, findings };
}

/**
 * @param {object} cfg
 * @param {string} cfg.vendor      - 'claude_code' | 'codex' (or a key in presets)
 * @param {string} cfg.repoPath    - repo root, to resolve relative worktrees
 * @param {object} [cfg.preset]    - override the preset (default: HARNESS_PRESETS[vendor])
 * @param {string} [cfg.command]   - override the CLI command (e.g. 'claude.cmd' on Windows)
 * @param {boolean} [cfg.shell]    - spawn via shell (default false)
 * @param {Function} [cfg.runner]  - injectable runner (tests)
 * @param {string} [cfg.baseRef]   - base branch for review diffs (default 'main')
 */
export function createHarnessAdapter(cfg) {
  const vendor = cfg.vendor;
  const preset = cfg.preset ?? HARNESS_PRESETS[vendor];
  if (!preset) throw new Error(`no harness preset for vendor "${vendor}"`);
  if (!cfg.repoPath) throw new Error('repoPath is required');

  const command = cfg.command ?? preset.command;
  const shell = cfg.shell ?? false;
  const runner = cfg.runner ?? defaultRunner;
  const baseRef = cfg.baseRef ?? 'main';
  const absWt = (wt) => (isAbsolute(wt) ? wt : join(cfg.repoPath, wt));

  let counter = 0;

  return {
    vendor,

    async implement(task) {
      const root = absWt(task.worktreePath);
      const resume = Boolean(task.resumeConvId && preset.supportsResume);
      const sessionId = task.resumeConvId
        ?? (preset.supportsResume ? randomUUID() : `conv_${vendor}_${task.itemId ?? 'item'}_${counter += 1}`);

      const { args, viaStdin } = preset.implement({ spec: task.spec, sessionId, resume });
      const { code, stdout, stderr } = await runner({
        command, args, cwd: root, shell, input: viaStdin ? task.spec : undefined,
      });
      if (code !== 0) {
        return { ok: false, convId: sessionId, summary: `${vendor} exited ${code}: ${String(stderr).slice(0, 300)}`, commits: [], usage: newUsage() };
      }

      const meta = preset.extractMeta(stdout) ?? {};
      const usage = meta.usage ?? newUsage();
      const text = preset.extractText(stdout) || '';
      const summary = (text.trim().split('\n').pop() || 'changes committed').slice(0, 200);

      // The CLI edited files in the worktree; Polly commits the result.
      if (git(root, ['status', '--porcelain']).length === 0) {
        return { ok: false, convId: meta.sessionId ?? sessionId, summary: 'no file changes produced', commits: [], usage };
      }
      git(root, ['add', '-A']);
      git(root, ['commit', '-m', summary.split('\n')[0].slice(0, 72) || `implement ${task.itemId ?? 'item'}`]);
      const sha = git(root, ['rev-parse', '--short', 'HEAD']);
      return { ok: true, convId: meta.sessionId ?? sessionId, summary, commits: [sha], usage };
    },

    async review(task) {
      const root = absWt(task.worktreePath);
      let diff = '';
      try { diff = git(root, ['diff', `${baseRef}...HEAD`]); } catch { diff = git(root, ['diff', 'HEAD~1']); }
      const prompt = buildReviewPrompt(task.spec, diff);

      const { args, viaStdin } = preset.review({ prompt });
      const { code, stdout, stderr } = await runner({
        command, args, cwd: root, shell, input: viaStdin ? prompt : undefined,
      });
      const convId = `conv_${vendor}_rev_${task.itemId ?? 'item'}`;
      if (code !== 0) {
        return { ok: false, convId, verdict: 'BLOCKING', findings: [{ severity: 'error', where: '-', what: `${vendor} exited ${code}: ${String(stderr).slice(0, 200)}` }], usage: newUsage() };
      }
      const text = preset.extractText(stdout) || stdout;
      const { verdict, findings } = parseReviewMarkers(text);
      const usage = preset.extractMeta(stdout)?.usage ?? newUsage();
      return { ok: true, convId, verdict, findings, usage };
    },
  };
}
