import React, { useState } from 'react';
import { RegistryModelSelect } from './RegistryModelSelect';

// ---------------------------------------------------------------------------
// REQUEST A MODEL EVALUATION — explicit, visible before it runs, never
// automatic. Replaces the hidden "Aegis Judge" call the task board used to make
// after every successful task.
//
//   1. Pick a model from the registry (JSON_OBJECT-capable only).
//   2. Preview: identity, availability, Guardian, spend-guard estimate and
//      price version. No task, no ledger row, no provider call.
//   3. Run: only on an explicit click. It becomes its own child task with its
//      own ledger row, Aegis review and receipt. The evaluated task's status,
//      artifact and receipt are not changed by it.
// ---------------------------------------------------------------------------

export const EvaluationRequestPanel: React.FC<{ workspaceId: string | undefined; taskId: string }> = ({ workspaceId, taskId }) => {
  const [model, setModel] = useState('');
  const [preview, setPreview] = useState<any | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = async (confirmed: boolean) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/execution/tasks/${encodeURIComponent(taskId)}/evaluations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, model, confirmed }),
      });
      const j = await res.json().catch(() => null);
      if (!confirmed) {
        if (!res.ok || !j?.success) { setError(j?.error || `HTTP ${res.status}`); setPreview(null); }
        else setPreview(j.preview);
      } else {
        setResult({ httpStatus: res.status, ...j });
      }
    } catch (e: any) {
      setError(e?.message || 'Network error');
    } finally {
      setBusy(false);
    }
  };

  const p = preview;
  return (
    <div className="space-y-2 p-3 bg-[#05060C] border border-[#1C2038] rounded-xl text-[11px] font-mono" data-testid="evaluation-request">
      <div className="text-[#8E94B8] uppercase text-[10px]">Model evaluation (optional, separately run and receipted)</div>
      <RegistryModelSelect workspaceId={workspaceId} value={model} onChange={(v) => { setModel(v); setPreview(null); setResult(null); }} outputContract="JSON_OBJECT" />
      <button type="button" disabled={!model || busy} onClick={() => call(false)} className="px-2 py-1 rounded border border-[#2D3352] text-[#C9CCE6] disabled:opacity-40">Preview evaluation (no cost)</button>
      {error && <div className="text-[#FF6B6B]">{error}</div>}
      {p && (
        <div className="space-y-1 text-[#C9CCE6]" data-testid="evaluation-preview">
          <div>Model: {p.model.providerId}/{p.model.modelId} — {p.availability.state}{!p.availability.executable ? ` (${p.availability.blockers.map((b: any) => b.reason).join('; ')})` : ''}</div>
          <div>Guardian: {p.guardian.allowed ? 'allowed' : `refused — ${p.guardian.error}`}</div>
          <div>Spend guard: {p.estimate.permitted ? `permitted · up to $${Number(p.estimate.estimatedMaxUsd).toFixed(4)}` : `would block — ${p.estimate.code}: ${p.estimate.reason}`}{p.estimate.approvalRequired ? ' (approval required)' : ''}</div>
          <div>Price version: {p.estimate.priceVersion ?? 'UNKNOWN'} · Output contract: JSON_OBJECT (verdict, rationale)</div>
          <div className="text-[#6A7097]">Running creates a new evaluation task. This task's status and receipt are not changed.</div>
          <button type="button" disabled={busy || !p.guardian.allowed} onClick={() => call(true)} className="px-2 py-1 rounded border border-[#615EFF] text-white disabled:opacity-40">Run evaluation</button>
        </div>
      )}
      {result && (
        <div className="text-[#C9CCE6]" data-testid="evaluation-result">
          Evaluation task {result.evaluationTaskId ?? '—'}: {result.evaluation?.status ?? result.code ?? 'UNKNOWN'}
          {result.evaluation?.receipt?.receiptId ? ` · receipt ${result.evaluation.receipt.receiptId} (${result.evaluation.receipt.payload?.outcome ?? 'outcome not stated'})` : ''}
          {result.error ? ` — ${result.error}` : result.evaluation?.error ? ` — ${result.evaluation.error}` : ''}
        </div>
      )}
    </div>
  );
};

export default EvaluationRequestPanel;
