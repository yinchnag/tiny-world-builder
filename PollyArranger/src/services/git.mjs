// services/git.mjs — REAL worktree / git / gates (Phase 2.1).
//
// Tutorial note:
//   This is the real counterpart to services/mock.mjs. It exposes the EXACT same
//   shape — { worktree, git, gates } — so the orchestrator never changes; you
//   just hand it these services instead of the mocks (docs/01 section 2.3/2.5,
//   docs/06 Phase 2).
//
//   Isolation is done with `git worktree` (docs/01 section 2.3): each item gets
//   its own checkout of its own branch, so parallel implementers never collide.
//
//   Design choices worth knowing:
//   * git/gh are invoked with execFileSync (NO shell) — arguments are passed as
//     an array, so there is no shell-injection surface.
//   * Gates run a configurable command WITH a shell (execSync), because the
//     default `npm test` is `npm.cmd` on Windows and needs the shell to resolve.
//     The gates command is operator config, not user input.
//   * PR creation is injectable (`createPullRequest`) so tests can exercise the
//     real push against a local bare remote without hitting GitHub. The default
//     uses the `gh` CLI.
//   * gates currently CAPTURE pass/fail and store it; they do not yet block the
//     pipeline (the orchestrator's transition logic is frozen for Phase 2).
//     Making a red gate block a PR is a deliberate later refinement.

import { execFileSync, execSync } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { slugify } from '../util/slug.mjs';

/** Run a binary with arguments (no shell). Returns trimmed stdout. */
function capture(file, args, opts = {}) {
  return execFileSync(file, args, { encoding: 'utf8', ...opts }).toString().trim();
}

/**
 * Create the real git service bundle.
 *
 * @param {object} cfg
 * @param {string} cfg.repoPath          - path to the main repo (where .git lives)
 * @param {string} [cfg.remote]          - git remote to push to (default 'origin')
 * @param {string} [cfg.baseRef]         - branch/ref new work forks from (default 'main')
 * @param {string} [cfg.worktreeRoot]    - dir for worktrees, relative to repo (default '.worktrees')
 * @param {string} [cfg.gatesCommand]    - shell command for gates (default 'npm test')
 * @param {Function} [cfg.createPullRequest] - ({repoPath,worktree,branch,title,remote}) => prNumber
 * @param {Function} [cfg.mergePullRequest]  - ({repoPath,worktree,branch,baseRef,remote}) => void
 */
export function createGitServices({
  repoPath,
  remote = 'origin',
  baseRef = 'main',
  worktreeRoot = '.worktrees',
  gatesCommand = 'npm test',
  createPullRequest,
  mergePullRequest,
} = {}) {
  if (!repoPath) throw new Error('createGitServices: repoPath is required');
  const prCreator = createPullRequest ?? defaultGhCreatePR;
  const prMerger = mergePullRequest ?? defaultGhMerge;

  // Resolve an item's worktree to an absolute path for operations inside it.
  const resolveWt = (item) =>
    isAbsolute(item.worktree) ? item.worktree : join(repoPath, item.worktree);

  return {
    worktree: {
      // Create an isolated checkout on a fresh branch off baseRef.
      create({ item }) {
        const slug = slugify(item.title);
        const branch = `polly/${item.id}-${slug}`;
        const rel = `${worktreeRoot}/${item.id}-${slug}`;
        const abs = join(repoPath, rel);
        const baseSha = capture('git', ['-C', repoPath, 'rev-parse', '--short', baseRef]);
        capture('git', ['-C', repoPath, 'worktree', 'add', '-b', branch, abs, baseRef]);
        return { branch, worktree: rel, base: `${baseRef} ${baseSha}` };
      },
      // Remove the worktree (best-effort; ignore if already gone).
      teardown({ item }) {
        if (!item.worktree) return;
        try {
          capture('git', ['-C', repoPath, 'worktree', 'remove', resolveWt(item), '--force']);
        } catch {
          /* already removed */
        }
      },
    },

    git: {
      // Stage everything and commit inside the item's worktree. Returns short sha.
      // (Used by the implementer adapter in Phase 2.2 to land its edits.)
      commit({ item, message }) {
        const abs = resolveWt(item);
        capture('git', ['-C', abs, 'add', '-A']);
        capture('git', ['-C', abs, 'commit', '-m', message ?? `Polly: ${item.id}`]);
        return capture('git', ['-C', abs, 'rev-parse', '--short', 'HEAD']);
      },
      // Push the branch (used on fix laps).
      push({ item }) {
        capture('git', ['-C', resolveWt(item), 'push', '-u', remote, item.branch]);
      },
      // Push the branch and open a PR. Returns the PR number.
      openPR({ item }) {
        const abs = resolveWt(item);
        capture('git', ['-C', abs, 'push', '-u', remote, item.branch]);
        return prCreator({ repoPath, worktree: abs, branch: item.branch, title: item.title, remote });
      },
      // Merge the PR (used under auto-merge policy). Injectable: the default uses
      // `gh`; localMergeStrategy merges into baseRef in the local repo (for
      // offline tests/demos without GitHub).
      merge({ item }) {
        prMerger({ repoPath, worktree: resolveWt(item), branch: item.branch, baseRef, remote });
      },
    },

    gates: {
      // Run the gates command in the worktree; capture pass/fail (don't throw).
      run({ item }) {
        let passed = true;
        try {
          execSync(gatesCommand, { cwd: resolveWt(item), stdio: 'ignore' });
        } catch {
          passed = false;
        }
        return { command: gatesCommand, passed };
      },
    },
  };
}

/** Default PR creator via the `gh` CLI. Parses the PR number from its output. */
function defaultGhCreatePR({ worktree, branch, title }) {
  const out = capture(
    'gh',
    ['pr', 'create', '--head', branch, '--title', title || branch, '--body', 'Automated by Polly.'],
    { cwd: worktree },
  );
  const m = out.match(/\/pull\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Default merge via the `gh` CLI (squash + delete branch). */
function defaultGhMerge({ worktree, branch }) {
  capture('gh', ['pr', 'merge', branch, '--squash', '--delete-branch'], { cwd: worktree });
}

/**
 * Offline merge strategy: fast-forward/merge the branch into baseRef in the LOCAL
 * repo, no GitHub. Use as `mergePullRequest` for tests/demos.
 * (Operates in the main repo's checkout, not the worktree, so it can move baseRef.)
 */
export function localMergeStrategy({ repoPath, branch, baseRef }) {
  const at = (args) => capture('git', ['-C', repoPath, ...args]);
  const current = at(['rev-parse', '--abbrev-ref', 'HEAD']);
  at(['checkout', baseRef]);
  try {
    at(['merge', '--no-ff', '-m', `Polly merge ${branch}`, branch]);
  } finally {
    // Restore whatever branch the main checkout was on, if different.
    if (current && current !== baseRef && current !== 'HEAD') {
      try { at(['checkout', current]); } catch { /* ignore */ }
    }
  }
}
