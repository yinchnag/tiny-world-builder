// util/mutex.mjs — a tiny async mutex (③).
//
// Tutorial note:
//   Once the git service became asynchronous (non-blocking), two concurrent items
//   could interleave operations that touch SHARED repo state — `git worktree
//   add/remove`, `push`, and the merge's checkout of the base branch in the main
//   working tree. Those must run one-at-a-time. This mutex serializes them while
//   leaving the expensive, independent work (the LLM calls, and per-worktree
//   gates) free to run in parallel.
//
//   It's a promise-chain: each `runExclusive` waits for the previous one to settle
//   before running. The internal chain swallows rejections so one failure doesn't
//   wedge the lock, but the caller still receives the real result/rejection.

export function createMutex() {
  let tail = Promise.resolve();
  return function runExclusive(fn) {
    const result = tail.then(() => fn());
    tail = result.then(() => {}, () => {}); // keep the chain alive past failures
    return result;
  };
}
