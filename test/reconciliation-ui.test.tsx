// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueueReviewPanel } from '../src/components/admin/QueueReviewPanel';
import { ExecutionReconciliationPanel } from '../src/components/registry/ExecutionReconciliationPanel';

// ---------------------------------------------------------------------------
// RECONCILIATION UI: reachable from Queue Review (the canonical server task
// list), shows the evidence guide, requires every field, and shows the
// trail. Loading it submits nothing.
// ---------------------------------------------------------------------------

const guide = {
  taskId: 't-recon', status: 'RECONCILING_UNKNOWN_EXECUTION', executionStartedAt: '2026-09-17T20:48:27.969Z',
  suggestedWindow: { start: '2026-09-17T20:48:27.969Z', end: '2026-09-17T20:50:00.000Z' }, model: 'gpt-test', provider: 'openai', endpoint: 'POST /v1/responses',
  instruction: 'Summarise the note in two sentences.', knownIdentifiers: { providerRequestIds: [], responseIds: [] },
  exclude: [{ taskId: 't-sibling', startedAt: '2026-09-17T20:53:37.097Z', model: 'gpt-test' }], evidence: null,
};
const calls: Array<{ method: string; url: string }> = [];
const stub = (recon: { status: number; body: any }) => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method || 'GET', url });
    if (url.startsWith('/api/master-admin/task-queue')) return new Response(JSON.stringify({ success: true, tasks: [{ taskId: 't-recon', workspaceId: 'ws', createdAt: 'x', state: 'RECONCILING_UNKNOWN_EXECUTION', taskClass: null, outputContract: null, assignedModel: 'gpt-test', pinnedRoute: null, autonomyEligible: false, qualificationValid: false, couldExecuteNow: false, blockedBecause: ['an earlier dispatch has an unknown outcome'], actions: [] }] }), { status: 200 });
    if (url.includes('/execution-reconciliation')) return new Response(JSON.stringify(recon.body), { status: recon.status });
    return new Response('{}', { status: 404 });
  }));
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('reconciliation UI', () => {
  it('Queue Review shows the guide and form for a reconciling task, and loading submits nothing', async () => {
    stub({ status: 200, body: { success: true, findings: ['PROVIDER_CONFIRMED_COMPLETED', 'PROVIDER_CONFIRMED_FAILED', 'PROVIDER_CONFIRMED_NO_REQUEST', 'PROVIDER_USAGE_FOUND_RESPONSE_UNAVAILABLE', 'EVIDENCE_INCONCLUSIVE'], guide, trail: [] } });
    render(<QueueReviewPanel />);
    await waitFor(() => expect(screen.getByTestId('reconciliation-guide')).toBeTruthy());
    expect(screen.getByTestId('guide-window').textContent).toBe('2026-09-17T20:48:27.969Z → ~2026-09-17T20:50:00.000Z');
    expect(screen.getByTestId('guide-instruction').textContent).toContain('Summarise the note');
    expect(screen.getByTestId('guide-exclude').textContent).toContain('t-sibling');
    expect(screen.getByTestId('reconciliation-trail').textContent).toMatch(/No finding recorded yet\. The outcome is UNKNOWN\./);
    // The submit control is disabled until every required field is present.
    expect((screen.getByTestId('reconciliation-submit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('reconciliation-finding'), { target: { value: 'PROVIDER_CONFIRMED_NO_REQUEST' } });
    expect((screen.getByTestId('reconciliation-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText('Provider response id')).toBeNull(); // not allowed for NO_REQUEST
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('renders the recorded evidence trail, including corrections', async () => {
    stub({ status: 200, body: { success: true, findings: [], guide: { ...guide, status: 'INCOMPLETE' }, trail: [
      { eventId: 'e1', eventType: 'EXECUTION_RECONCILED', actor: 'u', at: 't1', finding: 'PROVIDER_CONFIRMED_NO_REQUEST', resultingStatus: 'CANCELLED', submissionHash: 'a'.repeat(64), correctsEventId: null, evidence: { evidenceSource: 'Logs', windowStart: 's', windowEnd: 'e', provider: 'openai', model: 'gpt-test', dashboardFinding: 'none seen', note: 'n' } },
      { eventId: 'e2', eventType: 'EXECUTION_RECONCILIATION_CORRECTED', actor: 'u', at: 't2', finding: 'PROVIDER_USAGE_FOUND_RESPONSE_UNAVAILABLE', resultingStatus: 'INCOMPLETE', submissionHash: 'b'.repeat(64), correctsEventId: 'e1', evidence: { evidenceSource: 'Usage', windowStart: 's', windowEnd: 'e', provider: 'openai', model: 'gpt-test', dashboardFinding: 'one request', note: 'n', operatorReportedUsage: { inputTokens: 10, outputTokens: null, costUsd: null } } },
    ] } });
    render(<ExecutionReconciliationPanel workspaceId="ws" taskId="t-recon" />);
    await waitFor(() => expect(screen.getAllByTestId('reconciliation-trail-entry')).toHaveLength(2));
    const text = screen.getByTestId('reconciliation-trail').textContent!;
    expect(text).toMatch(/corrects e1/);
    expect(text).toMatch(/operator-reported usage/);
  });

  it('a task that exists only on the browser board (404) shows no reconciliation panel', async () => {
    stub({ status: 404, body: { success: false, error: 'not found' } });
    const { container } = render(<ExecutionReconciliationPanel workspaceId="ws" taskId="local-only" />);
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});
