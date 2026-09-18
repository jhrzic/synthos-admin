// Plain-language monthly report for a business, rendered from the authority
// record itself. Every number is counted from chained entries in the period;
// nothing is estimated. Printable HTML (the owner saves it as PDF).

import { auditWorkspace, ledgerEntries } from './authority-ledger';
import { getDatabase } from './persistence';

export interface PeriodReport {
  workspaceId: string;
  from: string;
  to: string;
  actions: number;
  withApproval: number;
  selfApproved: number;
  noApproval: number;
  byKind: Record<string, number>;
  results: Record<string, number>;
  integrityOk: boolean;
  problems: string[];
  lastCheckpoint: { seq: number; signedAt: string } | null;
}

const kindOf = (receiptId: string): string => {
  const r: any = getDatabase().prepare('SELECT payload_json FROM receipts WHERE receipt_id = ?').get(receiptId);
  try {
    const p = JSON.parse(r?.payload_json ?? '{}');
    return typeof p.kind === 'string' ? p.kind : typeof p.assignedAgent === 'string' ? `agent task (${p.assignedAgent})` : 'agent task';
  } catch {
    return 'agent task';
  }
};

/** Pure-ish: counts for [from, to). */
export function buildPeriodReport(workspaceId: string, from: string, to: string): PeriodReport {
  const inRange = ledgerEntries(workspaceId).filter((e) => e.recordedAt >= from && e.recordedAt < to);
  const actions = inRange.filter((e) => e.kind !== 'OUTCOME');
  const byKind: Record<string, number> = {};
  for (const a of actions) {
    const k = kindOf(a.receiptId);
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  const results: Record<string, number> = {};
  for (const e of inRange) if (e.kind === 'OUTCOME' && e.outcomeLabel) results[e.outcomeLabel] = (results[e.outcomeLabel] ?? 0) + 1;
  const audit = auditWorkspace(workspaceId);
  const cp: any = getDatabase()
    .prepare('SELECT seq, signed_at FROM authority_checkpoints WHERE workspace_id = ? ORDER BY seq DESC LIMIT 1')
    .get(workspaceId);
  return {
    workspaceId, from, to,
    actions: actions.length,
    withApproval: actions.filter((e) => e.approvalId).length,
    selfApproved: actions.filter((e) => e.selfApproved === true).length,
    noApproval: actions.filter((e) => !e.approvalId).length,
    byKind, results,
    integrityOk: audit.ok, problems: audit.problems,
    lastCheckpoint: cp ? { seq: cp.seq, signedAt: cp.signed_at } : null,
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const human = (k: string) => k.replace(/[._]/g, ' ');

export function renderPeriodReportHtml(r: PeriodReport, businessName?: string): string {
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const rows = (o: Record<string, number>) =>
    Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td>${esc(human(k))}</td><td class="n">${n}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>What your assistant did — ${esc(businessName || r.workspaceId)}</title>
<style>body{font:15px/1.55 system-ui,-apple-system,sans-serif;color:#15181d;max-width:720px;margin:32px auto;padding:0 16px}
h1{font-size:26px;margin:0 0 4px}.m{color:#5b6470}table{width:100%;border-collapse:collapse;margin:8px 0 20px}
td{padding:6px 0;border-bottom:1px solid #e6e8ec}td.n{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.ok{border:1px solid #2e9d62;background:#eefaf3;padding:10px 12px;border-radius:8px}.bad{border:1px solid #c0392b;background:#fdf0ee;padding:10px 12px;border-radius:8px}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:16px 0}.card{border:1px solid #e6e8ec;border-radius:8px;padding:10px 12px}
.card b{display:block;font-size:24px}@media print{body{margin:0}}</style></head><body>
<h1>What your assistant did</h1>
<p class="m">${esc(businessName || r.workspaceId)} · ${day(r.from)} – ${day(r.to)}</p>
<div class="grid">
<div class="card"><span class="m">Actions taken</span><b>${r.actions}</b></div>
<div class="card"><span class="m">Approved by a person on your team</span><b>${r.withApproval}</b></div>
<div class="card"><span class="m">Approved by the same person who asked</span><b>${r.selfApproved}</b></div>
<div class="card"><span class="m">Done without an approval on record</span><b>${r.noApproval}</b></div>
</div>
<h2>Actions by type</h2>${Object.keys(r.byKind).length ? `<table>${rows(r.byKind)}</table>` : '<p class="m">None in this period.</p>'}
<h2>Results</h2>${Object.keys(r.results).length ? `<table>${rows(r.results)}</table>` : '<p class="m">No results recorded in this period.</p>'}
<h2>Can you trust this report?</h2>
<div class="${r.integrityOk ? 'ok' : 'bad'}">${r.integrityOk
    ? 'Yes. Every action above is chained to the one before it and signed, and the whole record was re-checked when this report was made. Nothing has been removed or edited.'
    : `Problems were found when the record was re-checked: ${r.problems.slice(0, 5).map(esc).join('; ')}.`}</div>
<p class="m">${r.lastCheckpoint ? `Last signed checkpoint: entry ${r.lastCheckpoint.seq}, ${day(r.lastCheckpoint.signedAt)}. Keep the exported record; anyone can verify it independently with the free verification tool.` : 'No signed checkpoint yet.'}</p>
</body></html>`;
}
