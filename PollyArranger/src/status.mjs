// status.mjs — the operability view (Phase 5, items 16–18).
//
// Tutorial note:
//   This is the "what's going on?" command. It renders the registry as a
//   human-readable status: a per-item table, a CATCH-UP section (what needs a
//   human — items ready to merge, items blocked + their open question, items
//   that failed), wave progress, token cost totals, and the latest notes.
//
//   It is READ-ONLY and computed entirely from the registry (docs/02 section 6).
//   This — a plain text report — is the only piece of the original "canvas" worth
//   rebuilding; the line runs headless without a GUI (docs/00 section 5).

import { STATES } from './state-machine.mjs';
import { formatReport, costTotals } from './report.mjs';

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const padL = (s, n) => String(s ?? '').padStart(n);

/** One row per item: id | status | impl→reviewer | pr | rounds | tokens. */
function itemTable(items) {
  const head = `  ${pad('id', 5)} ${pad('status', 22)} ${pad('impl→reviewer', 22)} ${pad('pr', 5)} ${pad('rnd', 4)} ${padL('tokens', 8)}`;
  const rows = items.map((it) => {
    const roles = it.implementer ? `${it.implementer}→${it.reviewer ?? '?'}` : '—';
    const tokens = it.cost?.totalTokens ?? 0;
    return `  ${pad(it.id, 5)} ${pad(it.status, 22)} ${pad(roles, 22)} ${pad(it.pr ?? '—', 5)} ${pad(it.reviewRound ?? 0, 4)} ${padL(tokens, 8)}`;
  });
  return [head, ...rows].join('\n');
}

/** The "needs a human" section. */
function catchUp(items) {
  const ready = items.filter((i) => i.status === STATES.READY_FOR_HUMAN_MERGE);
  const blocked = items.filter((i) => i.status === STATES.BLOCKED);
  const failed = items.filter((i) => i.status === STATES.ABANDONED);
  const lines = [];

  lines.push(`READY to merge (${ready.length}):`);
  for (const i of ready) lines.push(`  • ${i.id} ${i.title}${i.pr ? ` (PR #${i.pr})` : ''}`);

  lines.push(`BLOCKED — needs a decision (${blocked.length}):`);
  for (const i of blocked) lines.push(`  • ${i.id} ${i.title}\n      ↳ ${i.blockedOn ?? '(no reason recorded)'}`);

  if (failed.length) {
    lines.push(`ABANDONED (${failed.length}):`);
    for (const i of failed) lines.push(`  • ${i.id} ${i.title}`);
  }
  return lines.join('\n');
}

/** Full status report as a string. */
export function formatStatus(reg) {
  const c = costTotals(reg);
  const out = [];
  out.push('=== Polly status ===');
  out.push('');
  out.push('Waves:');
  out.push('  ' + formatReport(reg).split('\n').join('\n  '));
  out.push('');
  out.push('Items:');
  out.push(itemTable(reg.items));
  out.push('');
  out.push(catchUp(reg.items));
  out.push('');
  out.push(
    `Cost: ${c.calls} model call(s), ${c.totalTokens} tokens ` +
    `(${c.promptTokens} prompt + ${c.completionTokens} completion)`,
  );
  const notes = reg.notes ?? [];
  if (notes.length) {
    out.push('');
    out.push('Recent notes:');
    for (const n of notes.slice(-5)) out.push(`  [${n.kind ?? 'info'}] ${n.text ?? ''}`);
  }
  return out.join('\n');
}
