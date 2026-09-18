// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import { LocalRouteControls } from '../src/components/registry/LocalRouteControls';
import { QueueReviewPanel } from '../src/components/admin/QueueReviewPanel';
import { MasterAdminView } from '../src/components/MasterAdminView';

// ---------------------------------------------------------------------------
// ADMIN CONTROLS — registry-driven, exact, confirmed, separate authorities.
// Every fetch is answered locally; the assertions check what is shown before
// a change and which single endpoint each confirmed change calls.
// ---------------------------------------------------------------------------

let calls: Array<{ url: string; method: string; body: any }> = [];
let routes: Record<string, () => any> = {};
beforeEach(() => {
  calls = []; routes = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null });
    const key = Object.keys(routes).find((k) => u.startsWith(k));
    const payload = key ? routes[key]() : { success: false, error: 'not mocked' };
    return { ok: !!key, status: key ? 200 : 404, json: async () => payload };
  }) as any);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// Synthetic registry fixtures (no production model name is hardcoded in the UI).
const localModel = (over: any = {}) => ({
  providerId: 'fixture-local', modelId: 'fixture-model:7b', routeKind: 'LOCAL', adminState: 'QUALIFIED',
  pricing: { state: 'CURRENT', versionKey: 'registry:fixture-local:fixture-model:7b#v1:abc', current: { approval: 'APPROVED', rates: { input: 0, output: 0, cachedInput: 0 }, tiers: [], toolCharges: [], modalityCharges: [] } },
  ...over,
});
const identity = [{ providerId: 'fixture-local', modelId: 'fixture-model:7b', canonicalVersionId: 'fixture/fixture-model-7b', status: 'APPROVED', resolved: true, substanceHash: 'f'.repeat(64) }];
const quals = [{ qualificationId: 'qual-fixture-1', providerId: 'fixture-local', modelId: 'fixture-model:7b', taskClass: 'literal_transformation', state: 'VALID', runId: 'qrun-fixture', suite: 'suite.literal@1.0.0', expiresAt: '2026-12-17T00:00:00Z', evidence: { usageIds: ['u1', 'u2'], receiptIds: ['r1', 'r2'] }, stateReasons: [] }];
const spendStatus = (local = false) => ({ success: true, status: { policy: { localExecutionEnabled: local, paidExecutionEnabled: false, modelExecutionEnabled: true } } });

function renderControls(models = [localModel(), { providerId: 'fixture-direct', modelId: 'd1', routeKind: 'DIRECT' }]) {
  routes['/api/master-admin/spend'] = () => spendStatus(false);
  render(<LocalRouteControls workspaceId="ws-ui" models={models as any} identityRoutes={identity} qualifications={quals} onChanged={() => {}} />);
  fireEvent.change(screen.getByTestId('local-route-select'), { target: { value: 'fixture-local/fixture-model:7b' } });
}

describe('local route controls', () => {
  it('lists only registry LOCAL routes, shows the separation warning and the exact identity before any change', async () => {
    renderControls();
    const options = [...(screen.getByTestId('local-route-select') as HTMLSelectElement).options].map((o) => o.value).filter(Boolean);
    expect(options).toEqual(['fixture-local/fixture-model:7b']);
    expect(screen.getByTestId('authority-separation-warning').textContent).toMatch(/separate authorities.*enabling a model does not switch local or paid execution on.*no bulk action/);
    expect(screen.getByTestId('local-route-identity').textContent).toBe(`provider fixture-local · model fixture-model:7b · version fixture/fixture-model-7b (APPROVED) · deployment default · substance ${'f'.repeat(64)}`);
    expect(screen.getByTestId('qualification-row').textContent).toMatch(/qual-fixture-1 · literal_transformation · VALID · run qrun-fixture .* evidence 2 ledger rows \/ 2 receipts/);
    expect(screen.getByTestId('price-current').textContent).toMatch(/cached 0/);
    // An approved price cannot be approved again.
    expect((screen.getByTestId('price-approve') as HTMLButtonElement).disabled).toBe(true);
    // No control offers a bulk / enable-all action (the warning text says there is none).
    expect([...document.querySelectorAll('button')].map((b) => b.textContent || '').filter((t) => /all|bulk/i.test(t))).toEqual([]);
  });

  it('enabling the model needs a confirmation naming the exact route, calls ONLY the model action, and never the execution switch', async () => {
    renderControls();
    routes['/api/registry/models/action'] = () => ({ success: true });
    fireEvent.click(screen.getByTestId('model-enable'));
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]); // nothing until confirmed
    expect(screen.getByTestId('model-enable-confirm').textContent).toMatch(/enable fixture-local\/fixture-model:7b → fixture\/fixture-model-7b @ default — local execution stays OFF/);
    fireEvent.click(screen.getByTestId('model-enable-yes'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.map((p) => p.url)).toEqual(['/api/registry/models/action']);
    expect(posts[0].body).toMatchObject({ providerId: 'fixture-local', modelId: 'fixture-model:7b', action: 'ENABLE' });
  });

  it('switching local execution needs confirmation and calls ONLY the spend switch — no model is touched; cancel sends nothing', async () => {
    renderControls();
    await waitFor(() => expect(screen.getByTestId('local-execution-switch').textContent).toMatch(/Local \$0 execution: OFF/));
    fireEvent.click(screen.getByTestId('local-execution-toggle'));
    fireEvent.click(screen.getByTestId('local-execution-toggle-no'));
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    routes['/api/master-admin/spend/kill'] = () => ({ success: true });
    fireEvent.click(screen.getByTestId('local-execution-toggle'));
    expect(screen.getByTestId('local-execution-toggle-confirm').textContent).toMatch(/no model is enabled or disabled by this/);
    fireEvent.click(screen.getByTestId('local-execution-toggle-yes'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.map((p) => p.url)).toEqual(['/api/master-admin/spend/kill']);
    expect(posts[0].body).toMatchObject({ scope: 'local-execution', enabled: true });
  });

  it('substance review reads from disk (no inference) and binding requires confirmation naming the hash and route', async () => {
    renderControls();
    routes['/api/registry/local-substance'] = () => ({ success: true, substanceHash: 'e'.repeat(64), substance: { tag: 'fixture-model:7b', manifestDigest: 'sha256:m', configDigest: 'sha256:c', weightsDigest: 'sha256:w', weightsBytes: 10, format: 'gguf', family: 'x', parameterSize: '7B', quantization: 'Q4' } });
    fireEvent.click(screen.getByTestId('substance-read'));
    await waitFor(() => expect(screen.getByTestId('substance-current').textContent).toMatch(/DIFFERS FROM APPROVED/));
    fireEvent.click(screen.getByTestId('substance-bind'));
    expect(screen.getByTestId('substance-bind-confirm').textContent).toMatch(new RegExp(`bind ${'e'.repeat(64)} to fixture-local/fixture-model:7b → fixture/fixture-model-7b @ default`));
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('an unreviewed exact $0 price can be approved (with confirmation naming the version); a non-zero or unstated cached rate cannot', async () => {
    const unreviewed = localModel({ pricing: { state: 'NOT_APPROVED', versionKey: 'registry:fixture-local:fixture-model:7b#v2:def', current: { approval: 'UNREVIEWED', rates: { input: 0, output: 0, cachedInput: 0 }, tiers: [], toolCharges: [], modalityCharges: [] } } });
    renderControls([unreviewed]);
    expect((screen.getByTestId('price-approve') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('price-approve'));
    expect(screen.getByTestId('price-approve-confirm').textContent).toMatch(/approve registry:fixture-local:fixture-model:7b#v2:def for fixture-local\/fixture-model:7b/);
    cleanup();
    renderControls([localModel({ pricing: { state: 'NOT_APPROVED', versionKey: 'k', current: { approval: 'UNREVIEWED', rates: { input: 0, output: 0, cachedInput: null }, tiers: [], toolCharges: [], modalityCharges: [] } } })]);
    expect((screen.getByTestId('price-approve') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('queue review panel', () => {
  const task = { taskId: 'legacy-1', workspaceId: 'ws-ui', title: 't', createdAt: '2026-09-10T19:46:44Z', updatedAt: '2026-09-10T19:46:44Z', state: 'TODO', taskClass: null, outputContract: null, assignedModel: 'n/a', pinnedRoute: null, autonomyEligible: false, qualificationValid: false, couldExecuteNow: false, blockedBecause: ['not autonomy-eligible: the orchestrator never selects it', 'no task class recorded'], actions: [{ action: 'CANCEL', allowed: true, reason: 'moves it to CANCELLED' }, { action: 'ARCHIVE', allowed: true, reason: 'retires it' }, { action: 'REQUEUE', allowed: false, reason: 'no task class recorded' }] };

  it('shows every field and blocker; reviewing posts nothing; an action needs a reason and a confirmation', async () => {
    routes['/api/master-admin/task-queue'] = () => ({ success: true, tasks: [task] });
    render(<QueueReviewPanel />);
    await waitFor(() => expect(screen.getByTestId('queue-task-id').textContent).toBe('legacy-1'));
    const text = screen.getByTestId('queue-task').textContent || '';
    for (const s of ['TODO', 'CANNOT EXECUTE', 'workspace ws-ui', 'created 2026-09-10T19:46:44Z', 'class NOT RECORDED', 'contract NOT RECORDED', 'model n/a', 'autonomy-eligible no', 'valid qualification no']) expect(text).toContain(s);
    expect(screen.getByTestId('queue-task-blockers').textContent).toMatch(/not autonomy-eligible.*no task class recorded/);
    expect((screen.getByTestId('queue-cancel-legacy-1') as HTMLButtonElement).disabled).toBe(true); // no reason yet
    expect((screen.getByTestId('queue-requeue-legacy-1') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('reason for legacy-1'), { target: { value: 'legacy cleanup' } });
    fireEvent.click(screen.getByTestId('queue-cancel-legacy-1'));
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    fireEvent.click(screen.getByTestId('queue-cancel-legacy-1-no'));
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });
});

describe('runtime version on the diagnostic screen', () => {
  const noop = () => {};
  const props = { initialSubTab: 'platform', agents: {}, models: {}, tasks: [], notes: [], activeWorkspaceId: 'ws-ui', auditChecks: [], voiceConfig: {} as any, onUpdateVoiceConfig: noop, onSelectTab: noop, onRunAudit: async () => {}, onExecutePrompt: async () => '' } as any;
  const diag = (runtimeVersion: any) => new Proxy({ database: { status: 'LIVE', tables: { tasks: 0, activity: 0, artifacts: 0, quality: 0, receipts: 0, graphs: 0 } }, platform: { status: 'LIVE', runtime: 'node', nodeVersion: 'v22', port: 3000, platform: 'darwin', arch: 'arm64', uptimeSec: 1, memory: { heapUsedMB: 0, heapTotalMB: 0, rssMB: 0 } }, guardian: { status: 'LIVE' }, aegis: { status: 'LIVE', signingAlgorithm: 'Ed25519' }, ...(runtimeVersion ? { runtimeVersion } : {}) } as Record<string, unknown>, { get: (t, k) => (typeof k !== 'string' || k === 'then' || k === 'toJSON' ? undefined : k in t ? t[k] : (k === 'runtimeVersion' ? undefined : { status: 'UNKNOWN' })) });

  it('shows the authoritative commit, ref, tree, build time and schema versions', async () => {
    routes['/api/master-admin/diagnostics'] = () => diag({ commit: 'c'.repeat(40), buildTime: '2026-09-18T16:00:00.000Z', ref: 'checkpoint/x', tree: 'CLEAN', source: 'LAUNCHER_GIT', node: 'v22.23.0', registrySchema: 'synthos.registry/v1', databaseSchema: { version: 'UNKNOWN', fingerprint: `sha256:${'d'.repeat(64)}` } });
    render(<MasterAdminView {...props} />);
    await waitFor(() => expect(screen.getByTestId('runtime-version-commit').textContent).toBe(`commit ${'c'.repeat(40)}`));
    expect(screen.getByTestId('runtime-version-meta').textContent).toBe('ref checkpoint/x · tree CLEAN · built 2026-09-18T16:00:00.000Z · source LAUNCHER_GIT');
    expect(screen.getByTestId('runtime-version-schema').textContent).toMatch(/registry schema synthos\.registry\/v1 · database schema version UNKNOWN \(fingerprint sha256:d{64}\)/);
  });

  it('reads UNKNOWN when the version is not reported — never a guessed SHA', async () => {
    routes['/api/master-admin/diagnostics'] = () => diag(null);
    render(<MasterAdminView {...props} />);
    await waitFor(() => expect(screen.getByTestId('runtime-version-commit').textContent).toBe('commit UNKNOWN'));
  });
});
