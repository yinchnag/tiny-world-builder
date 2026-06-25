// report.mjs — derived views over the registry (Phase 4, item 14).
//
// Tutorial note:
//   These are COMPUTED from items on demand — never stored (docs/02 section 6),
//   so the report can never drift from reality. Used to answer "how is wave1
//   doing?" and to print a one-glance status of the whole line.

import { STATES } from './state-machine.mjs';

/** Count items by status: { BUILDING: 2, MERGED: 3, ... }. */
export function statusCounts(items) {
  const counts = {};
  for (const it of items) counts[it.status] = (counts[it.status] ?? 0) + 1;
  return counts;
}

/** Progress for one wave (use null for items with no wave). */
export function waveProgress(reg, waveId) {
  const items = reg.items.filter((i) => (i.wave ?? null) === waveId);
  return {
    wave: waveId,
    total: items.length,
    merged: items.filter((i) => i.status === STATES.MERGED).length,
    byStatus: statusCounts(items),
  };
}

/** Every distinct wave id present in the registry (including null). */
export function waveIds(reg) {
  return [...new Set(reg.items.map((i) => i.wave ?? null))];
}

/** A one-line-per-wave human summary. */
export function formatReport(reg) {
  return waveIds(reg)
    .map((w) => {
      const p = waveProgress(reg, w);
      const parts = Object.entries(p.byStatus).map(([s, n]) => `${n} ${s}`);
      return `${w ?? '(no wave)'}: ${p.merged}/${p.total} merged — ${parts.join(', ')}`;
    })
    .join('\n');
}
