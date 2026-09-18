// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';

import { TaskRoutingPanel } from '../src/components/registry/TaskRoutingPanel';
import { CanonicalRouterPanel } from '../src/components/registry/CanonicalRouterPanel';
import { ModelFamiliesPanel } from '../src/components/registry/ModelFamiliesPanel';
import { taskStatusLabel } from '../src/components/verification/outcome';

// ---------------------------------------------------------------------------
// ROUTER + CONTINUITY UI — rendered, with SYNTHETIC fixtures (no production
// model name). Every fetch is answered locally; the assertions check that the
// views read only SynthOS APIs, show every routing reason, treat paused as
// paused (never failed), and never talk to a provider from the browser.
// ---------------------------------------------------------------------------

const decision = (over: Record<string, unknown> = {}) => ({
  decisionId: 'route-1', taskId: 'task-ui-1', workspaceId: 'ws-ui', segmentId: 'seg-1', policy: { policyId: 'router.default', version: '1.0.0' },
  mode: 'BEST_QUALIFIED', requirements: {}, constraints: {}, outcome: 'SELECTED', waitState: null, createdAt: '2026-09-18T10:00:00.000Z',
  explanation: 'Selected synthetic-pub/pub-large directly from its publisher (deployment default) for this content_generation task.',
  selected: { providerId: 'synthetic-pub', modelId: 'pub-large', deploymentId: 'default', canonicalVersionId: 'synthetic-pub/pub-large', familyId: 'pub-family', routeKind: 'DIRECT', qualificationId: 'qual-1', priceVersion: 'registry:synthetic-pub:pub-large#1:abc', priceSnapshot: null, estimatedCostUsd: 0.0041, score: 0.9 },
  candidates: [
    { routeKey: 'synthetic-pub/pub-large@default', providerId: 'synthetic-pub', modelId: 'pub-large', deploymentId: 'default', canonicalVersionId: 'synthetic-pub/pub-large', routeKind: 'DIRECT', free: false, freeGuaranteed: false, estimatedCostUsd: 0.0041, disqualified: [], score: 0.9, scoreBreakdown: [{ weight: 'quality', w: 0.3, value: 0.95, contribution: 0.285 }] },
    { routeKey: 'synthetic-agg/synthetic-pub/pub-large@default', providerId: 'synthetic-agg', modelId: 'synthetic-pub/pub-large', deploymentId: 'default', canonicalVersionId: 'synthetic-pub/pub-large', routeKind: 'AGGREGATOR', free: true, freeGuaranteed: false, estimatedCostUsd: 0, disqualified: [{ code: 'AGGREGATOR_NOT_PERMITTED', reason: 'aggregator synthetic-agg is not permitted' }] },
  ],
  ...over,
});

const continuityPayload = (state: string, segments: any[] = []) => ({
  success: true,
  continuity: { taskId: 'task-ui-1', workspaceId: 'ws-ui', taskClass: 'content_generation', contract: { mode: 'NARRATIVE' }, requirements: { capabilities: ['text.output'], modality: { input: ['text'], output: ['text'] }, estimatedInputTokens: 100, expectedOutputTokens: 1024, tools: [] }, constraints: {}, state, stateReason: state.startsWith('PAUSED') ? 'Paid execution is switched off.' : null, segmentCount: segments.length, privacyClass: 'STANDARD', excludedRoutes: {} },
  segments,
  checkpoints: [{ checkpointId: 'ckpt-1', taskId: 'task-ui-1', sequence: 1, reason: 'ROUTE_CAPACITY', verified: true, fingerprint: 'abcd1234', retention: 'STANDARD', createdAt: '2026-09-18T10:00:00.000Z', payload: { remainingWork: ['Run the task'], sideEffectsPerformed: [], prohibitedRepeats: [], pendingExternalActions: [], budget: { spentUsd: 0, reservedUsd: 0 } } }],
  sideEffects: [],
  decisions: [decision()],
  activity: [{ event_id: 'e1', event_type: 'ROUTING_DECIDED', created_at: '2026-09-18T10:00:00.000Z' }, { event_id: 'e2', event_type: 'CHECKPOINT_CREATED', created_at: '2026-09-18T10:00:01.000Z' }],
  receipts: [{ receiptId: 'rcpt-1', verified: true, payload: { outcome: 'COMPLETED', routingDecisionId: 'route-1', canonicalVersionId: 'synthetic-pub/pub-large', segmentIds: ['seg-1', 'seg-2'] } }],
});

let calls: Array<{ url: string; method: string; body: any }> = [];
let routes: Record<string, (body: any) => any> = {};
beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null });
    const key = Object.keys(routes).find((k) => u.startsWith(k));
    const payload = key ? routes[key](init?.body ? JSON.parse(init.body) : null) : { success: false, error: 'not mocked' };
    return { ok: payload?.success !== false, status: payload?.success === false ? 400 : 200, json: async () => payload };
  }) as any);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('task detail — Routing & Continuity', () => {
  it('shows class, requirements, the persisted decision with version/route/deployment/qualification/price, every rejected candidate, segments, checkpoints and the receipt chain', async () => {
    routes['/api/tasks/task-ui-1/continuity'] = () => continuityPayload('DONE', [
      { segmentId: 'seg-1', sequence: 1, providerId: 'synthetic-pub', modelId: 'pub-large', deploymentId: 'default', canonicalVersionId: 'synthetic-pub/pub-large', status: 'FAILED', statusReason: 'capacity: HTTP 429', inputHash: 'aaaaaaaaaaaa', budgetUsageId: 'use-1', termination: null },
      { segmentId: 'seg-2', sequence: 2, providerId: 'synthetic-agg', modelId: 'synthetic-pub/pub-large', deploymentId: 'default', canonicalVersionId: 'synthetic-pub/pub-large', status: 'COMPLETED', inputHash: 'bbbbbbbbbbbb', outputHash: 'cccccccccccc', budgetUsageId: 'use-2', termination: { status: 'COMPLETE' }, aegisDecision: 'VERIFIED', receiptId: 'rcpt-1' },
    ]);
    render(<TaskRoutingPanel workspaceId="ws-ui" taskId="task-ui-1" />);
    await waitFor(() => expect(screen.getByTestId('routing-decision')).toBeTruthy());
    const text = document.body.textContent || '';
    expect(text).toContain('CLASS: content_generation');
    expect(text).toContain('synthetic-pub/pub-large');
    expect(text).toContain('qualification qual-1');
    expect(text).toContain('registry:synthetic-pub:pub-large#1:abc');
    expect(text).toContain('Selected synthetic-pub/pub-large directly from its publisher');
    fireEvent.click(screen.getByText(/Show 2 candidates/));
    expect(document.body.textContent).toContain('AGGREGATOR_NOT_PERMITTED: aggregator synthetic-agg is not permitted');
    expect(document.body.textContent).toContain('free (volatile)');
    expect(screen.getAllByTestId('continuity-segment')).toHaveLength(2);
    expect(text).toContain('capacity: HTTP 429');
    expect(text).toContain('SIGNATURE VERIFIES');
    expect(text).toContain('receipt rcpt-1 · verifies · outcome COMPLETED · decision route-1');
    expect(calls.every((c) => c.url.startsWith('/api/'))).toBe(true);
  });

  it('a paused task reads as PAUSED (not failed), explains why, and offers an explicit resume', async () => {
    routes['/api/tasks/task-ui-1/continuity/resume'] = () => ({ success: true, reason: 'resumed' });
    routes['/api/tasks/task-ui-1/continuity'] = () => continuityPayload('PAUSED_AWAITING_BUDGET');
    render(<TaskRoutingPanel workspaceId="ws-ui" taskId="task-ui-1" />);
    await waitFor(() => expect(screen.getByTestId('continuity-resume')).toBeTruthy());
    expect(document.body.textContent).toContain('PAUSED — AWAITING BUDGET');
    expect(document.body.textContent).not.toMatch(/\bFAILED\b/);
    fireEvent.click(screen.getByTestId('continuity-resume'));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/tasks/task-ui-1/continuity/resume' && c.method === 'POST')).toBe(true));
  });

  it('an unknown outcome needs evidence before an operator can reconcile it', async () => {
    routes['/api/tasks/task-ui-1/continuity/reconcile'] = () => ({ success: true, state: 'READY' });
    routes['/api/tasks/task-ui-1/continuity'] = () => continuityPayload('RECONCILING_UNKNOWN_EXECUTION', [
      { segmentId: 'seg-u', sequence: 1, providerId: 'synthetic-pub', modelId: 'pub-large', deploymentId: 'default', status: 'UNKNOWN', inputHash: 'x', budgetUsageId: 'use-9' },
    ]);
    render(<TaskRoutingPanel workspaceId="ws-ui" taskId="task-ui-1" />);
    await waitFor(() => expect(screen.getByTestId('continuity-reconcile')).toBeTruthy());
    const notAccepted = screen.getByText(/Not accepted by provider/) as HTMLButtonElement;
    expect(notAccepted.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/Evidence/), { target: { value: 'provider dashboard: no request' } });
    fireEvent.click(notAccepted);
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/continuity/reconcile'))?.body).toMatchObject({ segmentId: 'seg-u', resolution: 'NOT_ACCEPTED', evidence: 'provider dashboard: no request' }));
  });

  it('a task with no routing record says so instead of inventing one', async () => {
    routes['/api/tasks/task-ui-1/continuity'] = () => ({ success: true, continuity: null, segments: [], checkpoints: [], sideEffects: [], decisions: [], activity: [], receipts: [] });
    render(<TaskRoutingPanel workspaceId="ws-ui" taskId="task-ui-1" />);
    await waitFor(() => expect(document.body.textContent).toContain('No routing record'));
  });
});

describe('Canonical Router view', () => {
  it('a preview posts to /api/router/preview and renders the selection, tradeoffs and every rejection — nothing is executed', async () => {
    routes['/api/registry/task-classes'] = () => ({ success: true, taskClasses: [{ taskClassId: 'content_generation', displayName: 'Content generation' }] });
    routes['/api/router/policies'] = () => ({ success: true, active: { policyId: 'router.default', version: '1.0.0', weights: { quality: 0.3, cost: 0.1 }, defaultMode: 'BEST_QUALIFIED', defaultRouteKinds: ['DIRECT', 'LOCAL'], capacity: { warnAt: 0.8, actAt: 0.9 }, evidence: { minSamples: 20 } }, policies: [{ version: '1.0.0', status: 'ACTIVE' }], modes: ['BEST_QUALIFIED', 'LOWEST_COST_QUALIFIED', 'PINNED_ROUTE'], workspaceRouting: {} });
    routes['/api/continuity/paused'] = () => ({ success: true, tasks: [{ taskId: 'task-p', state: 'PAUSED_AWAITING_CAPACITY', taskClass: 'content_generation', stateReason: 'rate limited' }] });
    routes['/api/router/evidence'] = () => ({ success: false });
    routes['/api/router/preview'] = () => ({ success: true, providerCallsMade: 0, decision: decision() });
    render(<CanonicalRouterPanel workspaceId="ws-ui" />);
    await waitFor(() => expect(screen.getByTestId('router-policy')).toBeTruthy());
    expect(document.body.textContent).toContain('Active policy router.default v1.0.0');
    expect(document.body.textContent).toContain('PAUSED — AWAITING CAPACITY');
    await waitFor(() => expect((screen.getByLabelText('Task class') as HTMLSelectElement).value).toBe('content_generation'));
    fireEvent.click(screen.getByTestId('router-preview'));
    await waitFor(() => expect(screen.getByTestId('router-decision')).toBeTruthy());
    expect(calls.find((c) => c.url === '/api/router/preview')!.body).toMatchObject({ workspaceId: 'ws-ui', taskClass: 'content_generation', constraints: { mode: 'BEST_QUALIFIED' } });
    expect(document.body.textContent).toContain('AGGREGATOR_NOT_PERMITTED');
    // Pinned modes are not offered in a preview (they need a task's pin).
    expect(Array.from(document.querySelectorAll('option')).map((o) => o.textContent)).not.toContain('PINNED_ROUTE');
    expect(calls.every((c) => c.url.startsWith('/api/'))).toBe(true);
  });
});

describe('Model Registry by family', () => {
  const models = [
    { providerId: 'synthetic-pub', modelId: 'pub-large', displayName: 'Pub Large', routeKind: 'DIRECT', freeTier: null, availability: 'AVAILABLE', executable: true, paid: true, lifecycle: 'ACTIVE', limits: { contextTokens: 128000, outputTokens: 4096 }, capabilities: [{ id: 'text.output', supported: true }], outputContracts: ['NARRATIVE'], blockers: [], pricing: { state: 'CURRENT', current: { rates: { input: 2, output: 4, cachedInput: null }, unit: 'tokens', currency: 'USD' } } },
    { providerId: 'synthetic-agg', modelId: 'synthetic-pub/pub-large', displayName: 'Pub Large via agg', routeKind: 'AGGREGATOR', freeTier: { free: true, guaranteed: false }, availability: 'UNQUALIFIED', executable: false, paid: true, lifecycle: 'ACTIVE', limits: { contextTokens: 64000, outputTokens: null }, capabilities: [], outputContracts: ['NARRATIVE'], blockers: [], pricing: { state: 'CURRENT', current: { rates: { input: 0, output: 0, cachedInput: null }, unit: 'tokens', currency: 'USD' } } },
  ] as any[];
  it('groups routes under one canonical version, shows route kind / free-volatile / qualifications, lists pending mappings, imports and the qualification runner', async () => {
    routes['/api/registry/identity'] = () => ({ success: true, families: [{ familyId: 'pub-family', displayName: 'Pub family', publisher: 'synthetic-pub', versions: [{ canonicalVersionId: 'synthetic-pub/pub-large', lifecycle: 'ACTIVE', definedBy: 'route:synthetic-pub' }] }],
      routes: [
        { providerId: 'synthetic-pub', modelId: 'pub-large', status: 'AUTHORITATIVE', canonicalVersionId: 'synthetic-pub/pub-large', resolved: true },
        { providerId: 'synthetic-agg', modelId: 'synthetic-pub/pub-large', status: 'PENDING_REVIEW', canonicalVersionId: null, proposedVersionId: 'synthetic-pub/pub-large', resolved: false, reason: 'awaiting an operator' },
      ] });
    routes['/api/registry/qualifications'] = () => ({ success: true, qualifications: [{ qualificationId: 'q1', providerId: 'synthetic-pub', modelId: 'pub-large', taskClass: 'content_generation', state: 'VALID', quality: 0.95, reliability: 0.97, expiresAt: '2026-11-01T00:00:00Z', stateReasons: [] }] });
    routes['/api/registry/route-imports'] = () => ({ success: true, importers: [{ importerId: 'openrouter', state: 'STALE', offerings: 2, lastSuccessAt: '2026-09-17T00:00:00Z', lastError: 'refresh failed', description: 'OpenRouter model list' }], refresh: { enabled: false, cadenceHours: 24, importers: [] } });
    routes['/api/registry/task-classes'] = () => ({ success: true, taskClasses: [{ taskClassId: 'content_generation' }] });
    routes['/api/registry/route-mappings/approve'] = () => ({ success: true });
    render(<ModelFamiliesPanel workspaceId="ws-ui" models={models} providers={[{ providerId: 'synthetic-pub', health: 'OK' }] as any} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('registry-family')).toBeTruthy());
    const text = document.body.textContent || '';
    expect(text).toContain('Pub family');
    expect(text).toContain('content_generation · VALID · q0.95 r0.97');
    expect(text).toContain('FREE — VOLATILE');
    expect(text).toContain('PENDING_REVIEW');
    expect(text).toContain('Unmapped / pending / conflicting route offerings (1) — cannot run');
    expect(text).toContain('STALE');
    expect(text).toContain('refresh failed');
    expect(screen.getByTestId('route-refresh-settings').textContent).toContain('OFF');
    expect(screen.getByTestId('qualification-runner')).toBeTruthy();
    fireEvent.click(screen.getByText('Approve mapping (audited)'));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/registry/route-mappings/approve')!.body).toMatchObject({ providerId: 'synthetic-agg', modelId: 'synthetic-pub/pub-large', canonicalVersionId: 'synthetic-pub/pub-large' }));
    expect(calls.every((c) => c.url.startsWith('/api/registry/'))).toBe(true);
  });
});

describe('labels and the wiring the views depend on', () => {
  it('every pause state is labelled as waiting, never as failed', () => {
    for (const s of ['PAUSED_AWAITING_BUDGET', 'PAUSED_AWAITING_CAPACITY', 'PAUSED_AWAITING_QUALIFIED_CAPACITY', 'PAUSED_AWAITING_APPROVAL', 'RECONCILING_UNKNOWN_EXECUTION']) {
      const l = taskStatusLabel(s);
      expect(l.tone).not.toBe('error');
      expect(l.label).not.toMatch(/FAIL/);
    }
  });

  it('the Model Router view defaults to the canonical router and no longer calls a provider from the browser or stores keys there', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/ModelRouterView.tsx'), 'utf8');
    expect(src).toContain("useState<'canonical' | 'free-hub' | 'agent-matrix' | 'sandbox' | 'custom-rules'>('canonical')");
    expect(src).toContain('<CanonicalRouterPanel workspaceId={workspaceId} />');
    expect(src).not.toContain('fetchAndSyncFreeOpenRouterModels(');
    expect(src).not.toMatch(/localStorage\.(getItem|setItem)\('hermes_openrouter_key'/);
    expect(src).not.toContain('onSendQuery(testPrompt');
    expect(src).toContain("fetch('/api/router/preview'");
    for (const fabricated of ['12.5M Tokens', '88.4%', '$1,240.00']) expect(src).not.toContain(fabricated);
  });

  it('task detail mounts the routing tab; the admin registry mounts the family view; the client treats a 202 as paused', () => {
    expect(fs.readFileSync(path.join(process.cwd(), 'src/components/KanbanView.tsx'), 'utf8')).toContain('<TaskRoutingPanel');
    expect(fs.readFileSync(path.join(process.cwd(), 'src/components/ProviderModelCatalog.tsx'), 'utf8')).toContain('<ModelFamiliesPanel');
    const app = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toContain('if (execRes.status === 202 && verificationOutcome)');
    expect(app).toContain("'TASK_PAUSED'");
  });
});
