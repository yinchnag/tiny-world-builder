// services/git.mjs — REAL worktree / git / gates, ASYNC + repo-locked (Phase 2.1 + ③).
//
// Tutorial note:
//   Same shape as services/mock.mjs — { worktree, git, gates } — so the
//   orchestrator is unchanged except that it now `await`s these calls.
//
//   Why async (③): the old version used execFileSync/execSync, which BLOCK the
//   whole event loop. With `--concurrency > 1` that defeats parallelism — one
//   item running `npm test` would freeze every other item. These run the
//   subprocesses asynchronously, so independent work (LLM calls, other items'
//   gates) proceeds in parallel.
//
//   Why a lock (③): once async, two items could interleave operations on SHARED
//   repo state and corrupt it — `git worktree add/remove`, `push`, and the merge
//   (which checks out the base branch in the MAIN working tree). Those go through
//   a per-repo mutex (runExclusive) so they serialize. Everything else stays
//   parallel:
//     * gates run per-worktree and are long → async, NOT locked (must not block).
//     * commits happen in each item's own worktree on its own branch → safe to
//       run concurrently (git locks refs/objects itself), so NOT through the mutex.
//
//   git/gh are still invoked with argument arrays (no shell). Gates run WITH a
//   shell so `npm test`/`npm.cmd` resolves on Windows; the gates command is
//   operator config, not user input.

import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join } from 'node:path';
import { slugify } from '../util/slug.mjs';
import { createMutex } from '../util/mutex.mjs';

const pExecFile = promisify(execFile);
const pExec = promisify(exec);
const MAX_BUFFER = 32 * 1024 * 1024;

/** Run a binary with an argument array (no shell). Returns trimmed stdout. */
async function capture(file, args, opts = {}) {
  const { stdout } = await pExecFile(file, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, ...opts });
  return stdout.toString().trim();
}

/**
 * @param {object} cfg
 * @param {string} cfg.repoPath
 * @param {string} [cfg.remote]
 * @param {string} [cfg.baseRef]
 * @param {string} [cfg.worktreeRoot]
 * @param {string} [cfg.gatesCommand]
 * @param {Function} [cfg.createPullRequest] - ({repoPath,worktree,branch,title,remote}) => prNumber
 * @param {Function} [cfg.mergePullRequest]  - ({repoPath,worktree,branch,baseRef,remote}) => void
 * @param {boolean} [cfg.noPush] - skip pushing to a remote (fully local; no remote needed)
 * @param {Function} [cfg.lock] - shared repo mutex (runExclusive); default: a fresh one
 */
export function createGitServices({
  repoPath,
  remote = 'origin',
  baseRef = 'main',
  worktreeRoot = '.worktrees',
  gatesCommand = 'npm test',
  createPullRequest,
  mergePullRequest,
  noPush = false,
  lock,
} = {}) {
  if (!repoPath) throw new Error('createGitServices: repoPath is required');
  const prCreator = createPullRequest ?? defaultGhCreatePR;
  const prMerger = mergePullRequest ?? defaultGhMerge;
  // The repo-level mutex (③). One per repo; inject a shared one to coordinate
  // across multiple service instances on the same repo.
  const runExclusive = lock ?? createMutex();

  const resolveWt = (item) =>
    isAbsolute(item.worktree) ? item.worktree : join(repoPath, item.worktree);

  return {
    worktree: {
      // LOCKED: creating a worktree touches shared .git/worktrees state.
      create({ item }) {
        return runExclusive(async () => {
          const slug = slugify(item.title);
          const branch = `polly/${item.id}-${slug}`;
          const rel = `${worktreeRoot}/${item.id}-${slug}`;
          const abs = join(repoPath, rel);
          const baseSha = await capture('git', ['-C', repoPath, 'rev-parse', '--short', baseRef]);
          await capture('git', ['-C', repoPath, 'worktree', 'add', '-b', branch, abs, baseRef]);
          return { branch, worktree: rel, base: `${baseRef} ${baseSha}` };
        });
      },
      // LOCKED: removing a worktree touches shared state too.
      teardown({ item }) {
        if (!item.worktree) return Promise.resolve();
        return runExclusive(async () => {
          try {
            await capture('git', ['-C', repoPath, 'worktree', 'remove', resolveWt(item), '--force']);
          } catch {
            /* already removed */
          }
        });
      },
    },

    git: {
      // NOT locked: each commit is in its own worktree on its own branch.
      async commit({ item, message }) {
        const abs = resolveWt(item);
        await capture('git', ['-C', abs, 'add', '-A']);
        await capture('git', ['-C', abs, 'commit', '-m', message ?? `Polly: ${item.id}`]);
        return capture('git', ['-C', abs, 'rev-parse', '--short', 'HEAD']);
      },
      // LOCKED: pushes update remote + remote-tracking refs. Skipped when noPush.
      push({ item }) {
        if (noPush) return Promise.resolve();
        return runExclusive(() => capture('git', ['-C', resolveWt(item), 'push', '-u', remote, item.branch]));
      },
      // LOCKED: push + open the PR as one critical section. With noPush (fully
      // local), the push is skipped — the branch stays local and the PR is stubbed.
      openPR({ item }) {
        return runExclusive(async () => {
          const abs = resolveWt(item);
          if (!noPush) await capture('git', ['-C', abs, 'push', '-u', remote, item.branch]);
          return prCreator({ repoPath, worktree: abs, branch: item.branch, title: item.title, remote });
        });
      },
      // LOCKED: a merge checks out the base branch in the MAIN working tree.
      merge({ item }) {
        return runExclusive(() => prMerger({ repoPath, worktree: resolveWt(item), branch: item.branch, baseRef, remote }));
      },
    },

    gates: {
      // NOT locked: gates run in the item's own worktree and can be long-running,
      // so they must run in parallel without blocking other items.
      async run({ item }) {
        try {
          await pExec(gatesCommand, { cwd: resolveWt(item), maxBuffer: MAX_BUFFER });
          return { command: gatesCommand, passed: true };
        } catch (err) {
          const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.slice(0, 4000);
          return { command: gatesCommand, passed: false, output };
        }
      },
    },
  };
}

/** Default PR creator via the `gh` CLI. Parses the PR number from its output. */
async function defaultGhCreatePR({ worktree, branch, title }) {
  const out = await capture(
    'gh',
    ['pr', 'create', '--head', branch, '--title', title || branch, '--body', 'Automated by Polly.'],
    { cwd: worktree },
  );
  const m = out.match(/\/pull\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// Merge strategies return a RESULT (never throw on a conflict) so the orchestrator
// can route a conflict to BLOCKED instead of crashing (S2):
//   { ok: true }                              — merged cleanly
//   { ok: false, conflicts: [...], reason }   — conflict (or merge failure)

/** Default merge via the `gh` CLI (squash + delete branch). */
async function defaultGhMerge({ worktree, branch }) {
  try {
    await capture('gh', ['pr', 'merge', branch, '--squash', '--delete-branch'], { cwd: worktree });
    return { ok: true };
  } catch (err) {
    // gh refuses to merge a non-mergeable (conflicting) PR — surface it as a conflict.
    return { ok: false, conflicts: [], reason: String(err.stderr ?? err.message ?? 'gh merge failed').slice(0, 300) };
  }
}

/**
 * Offline merge strategy: merge the branch into baseRef in the LOCAL repo, no
 * GitHub. Use as `mergePullRequest` for tests/demos. Runs in the main repo's
 * checkout — the mutex ensures only one of these runs at a time. On conflict it
 * aborts (restoring a clean base) and reports instead of throwing (S2).
 */
export async function localMergeStrategy({ repoPath, branch, baseRef }) {
  const at = (args) => capture('git', ['-C', repoPath, ...args]);
  const current = await at(['rev-parse', '--abbrev-ref', 'HEAD']);
  await at(['checkout', baseRef]);
  try {
    await at(['merge', '--no-ff', '-m', `Polly merge ${branch}`, branch]);
    return { ok: true };
  } catch (err) {
    let conflicts = [];
    try {
      conflicts = (await at(['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean);
    } catch { /* best effort */ }
    try { await at(['merge', '--abort']); } catch { /* nothing to abort */ }
    return { ok: false, conflicts, reason: String(err.stderr ?? err.message ?? 'merge conflict').slice(0, 300) };
  } finally {
    if (current && current !== baseRef && current !== 'HEAD') {
      try { await at(['checkout', current]); } catch { /* ignore */ }
    }
  }
}
