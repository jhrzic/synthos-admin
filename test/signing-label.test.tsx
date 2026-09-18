// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';

import { MasterAdminView } from '../src/components/MasterAdminView';
import { CanonicalReceiptsView } from '../src/components/CanonicalReceiptsView';
import { receiptAlgorithmLabel, RECEIPT_SIGNING_ALGORITHM } from '../lib/receipt-algorithm';

// ---------------------------------------------------------------------------
// THE SIGNING-ALGORITHM LABEL COMES FROM THE RECEIPTS, NOT FROM A STRING.
// Receipts are signed with Ed25519; the UI once claimed HMAC-SHA256. Every
// label now shows the recorded algorithm, or UNKNOWN — never a guess.
// ---------------------------------------------------------------------------

let routes: Record<string, () => any> = {};
beforeEach(() => {
  routes = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    const key = Object.keys(routes).find((k) => u.startsWith(k));
    const payload = key ? routes[key]() : { success: false, error: 'not mocked' };
    return { ok: key ? payload?.success !== false : false, status: key ? 200 : 404, json: async () => payload };
  }) as any);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const noop = () => {};
const adminProps = {
  initialSubTab: 'aegis', agents: {}, models: {}, tasks: [], notes: [], activeWorkspaceId: 'ws-ui', auditChecks: [],
  voiceConfig: {} as any, onUpdateVoiceConfig: noop, onSelectTab: noop, onRunAudit: async () => {}, onExecutePrompt: async () => '',
} as any;

// The real endpoint returns every section; sections this test does not care
// about read as a neutral UNKNOWN block.
const diagnostics = (aegis: Record<string, unknown>) => new Proxy(
  {
    database: { status: 'LIVE', tables: { tasks: 0, activity: 0, artifacts: 0, quality: 0, receipts: 45, graphs: 0 } },
    platform: { status: 'LIVE', memory: { heapUsedMB: 0, heapTotalMB: 0, rssMB: 0 } },
    guardian: { status: 'LIVE', mode: 'DETERMINISTIC_GATE_IN_EXECUTION_SPINE', reviewsCount: 0, byDecision: {} }, aegis: { status: 'LIVE', mode: 'DETERMINISTIC_VERIFICATION', receiptsCount: 45, ...aegis } } as Record<string, unknown>,
  { get: (t, k) => (typeof k !== 'string' || k === 'then' || k === 'toJSON' ? undefined : k in t ? t[k] : { status: 'UNKNOWN' }) },
);

describe('signing algorithm labels', () => {
  it('the signer and the label helper agree: Ed25519, recorded values verbatim, blank → UNKNOWN', () => {
    expect(RECEIPT_SIGNING_ALGORITHM).toBe('Ed25519');
    expect(receiptAlgorithmLabel('Ed25519')).toBe('Ed25519');
    expect(receiptAlgorithmLabel('LEGACY-ALG')).toBe('LEGACY-ALG');
    expect(receiptAlgorithmLabel('')).toBe('UNKNOWN');
    expect(receiptAlgorithmLabel(null)).toBe('UNKNOWN');
  });

  it('Master Admin → Aegis shows Ed25519 and the recorded per-algorithm counts, never HMAC', async () => {
    routes['/api/master-admin/diagnostics'] = () => diagnostics({ signingAlgorithm: 'Ed25519', receiptAlgorithms: { Ed25519: 44, 'LEGACY-ALG': 1 } });
    render(<MasterAdminView {...adminProps} />);
    await waitFor(() => expect(screen.getByTestId('aegis-signing-algorithm').textContent).toBe('Algorithm: Ed25519'));
    expect(screen.getByTestId('aegis-receipt-algorithms').textContent).toBe('Recorded: Ed25519 × 44 · LEGACY-ALG × 1');
    expect(document.body.textContent).not.toMatch(/HMAC/);
  });

  it('Master Admin → Aegis with no algorithm reported shows UNKNOWN, not HMAC', async () => {
    routes['/api/master-admin/diagnostics'] = () => diagnostics({ signingAlgorithm: '' });
    render(<MasterAdminView {...adminProps} />);
    await waitFor(() => expect(screen.getByTestId('aegis-signing-algorithm').textContent).toBe('Algorithm: UNKNOWN'));
    expect(document.body.textContent).not.toMatch(/HMAC/);
  });

  it('Execution Receipts header shows the receipt\'s own algorithm, and UNKNOWN when there are none', async () => {
    routes['/api/execution/receipts'] = () => ({ success: true, totalInWorkspace: 1, receipts: [{ receipt_id: 'r1', task_id: 't1', review_id: 'v1', algorithm: 'Ed25519', created_at: '2026-09-18T00:00:00Z', signature: 'ab', public_key: 'pk', verified: true, payloadError: null, payload: {} }] });
    routes['/api/authority'] = () => ({ success: false });
    render(<CanonicalReceiptsView activeWorkspaceId="ws-ui" />);
    await waitFor(() => expect(screen.getByTestId('receipts-algorithm').textContent?.trim()).toBe('Ed25519'));
    expect(document.body.textContent).not.toMatch(/HMAC/);
    cleanup();
    routes['/api/execution/receipts'] = () => ({ success: true, totalInWorkspace: 0, receipts: [] });
    render(<CanonicalReceiptsView activeWorkspaceId="ws-ui" />);
    await waitFor(() => expect(screen.getByTestId('receipts-algorithm').textContent?.trim()).toBe('UNKNOWN'));
    expect(document.body.textContent).not.toMatch(/HMAC/);
  });

  it('the server diagnostic reports the signer\'s algorithm and the recorded ones — no HMAC label outside comments', () => {
    const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    expect(server).toContain('signingAlgorithm: RECEIPT_SIGNING_ALGORITHM,');
    expect(server).toContain('details: `${signed.algorithm} signature generation and verification certified.`');
    const code = server.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(code).not.toMatch(/HMAC/);
    for (const f of ['src/components/MasterAdminView.tsx', 'src/components/CanonicalReceiptsView.tsx']) {
      expect(fs.readFileSync(path.join(process.cwd(), f), 'utf8'), f).not.toMatch(/HMAC/);
    }
  });
});
