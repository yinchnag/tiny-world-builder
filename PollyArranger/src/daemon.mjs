// daemon.mjs — keep the line running and watch for new work (④).
//
// Tutorial note:
//   `orchestrator.run()` is one-shot: it ticks until the line is stable, then
//   returns. A daemon instead runs forever. Because every tick reloads the
//   registry from disk (the single source of truth), anything ADDED to the
//   registry while the daemon runs — e.g. via `polly add` — is picked up on the
//   next poll. So the daemon is just: tick; if it did work, tick again right away
//   (drain); if idle, sleep a bit and re-check; until asked to stop.
//
//   It is error-tolerant (one bad tick doesn't kill the loop) and stops
//   gracefully — `stop()` lets the current tick finish, then the loop exits.

/**
 * @param {object} cfg
 * @param {{ tick: () => Promise<boolean> }} cfg.orchestrator
 * @param {number} [cfg.intervalMs] - idle poll interval (default 5000)
 * @param {() => void} [cfg.onTick] - called after a tick that did work
 * @param {() => void} [cfg.onIdle] - called when a tick found nothing to do
 * @param {(err: Error) => void} [cfg.onError] - called if a tick throws
 */
export function createDaemon({ orchestrator, intervalMs = 5000, onTick, onIdle, onError } = {}) {
  let stopped = false;
  let resolveStop;
  const stopP = new Promise((r) => { resolveStop = r; });

  // Sleep that wakes early when stop() is called.
  const sleep = (ms) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    stopP.then(() => { clearTimeout(t); resolve(); });
  });

  async function start() {
    while (!stopped) {
      let changed = false;
      try {
        changed = await orchestrator.tick();
      } catch (err) {
        onError?.(err); // a bad tick must not kill the daemon
      }
      if (stopped) break;
      if (changed) {
        onTick?.();
        continue; // drain: keep working while there's work
      }
      onIdle?.();
      await sleep(intervalMs);
    }
  }

  return {
    start,
    stop() { stopped = true; resolveStop(); },
    get stopped() { return stopped; },
  };
}
