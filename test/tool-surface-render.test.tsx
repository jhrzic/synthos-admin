// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { ToolRegistryView } from '../src/components/ToolRegistryView';
import { ApprovalQueueView } from '../src/components/ApprovalQueueView';

// ---------------------------------------------------------------------------
// DOES THE TOOL / APPROVAL SURFACE ACTUALLY RENDER?
//
// This file exists because of a real crash. Tool Pack 2 added the `gmail`
// category to the manifest, and ToolRegistryView held its OWN hardcoded map of
// category -> icon. For a category it did not know about, the icon lookup
// returned undefined, React was handed `undefined` as an element type, and the
// entire screen threw — so every Gmail row was invisible while /api/tools
// happily returned all four of them.
//
// No existing test could see that: the API tests assert the route's JSON, and
// the source-scanning guards assert the registry is single-sourced. Neither
// renders the component. The same blind spot produced the ClaudeArtifactsView
// fixture crash two passes ago, and the fix then was the same as the fix now —
// mount the real component and look.
//
// jsdom, not a browser, so this cannot catch a CSS problem that hides a correct
// row. It does catch the whole binding layer: fetch shape, parsing, state,
// icon resolution and rendered text.
// ---------------------------------------------------------------------------

const WS = 'ws-render-test';

/** Every category the manifest currently has, plus one it does NOT. */
const TOOL_ROWS = [
  { category: 'brain', capability: 'brain.search', effectClass: 'READ_ONLY', status: 'AVAILABLE' },
  { category: 'github', capability: 'github.search', effectClass: 'READ_ONLY', status: 'AVAILABLE' },
  { category: 'files', capability: 'files.read', effectClass: 'READ_ONLY', status: 'AVAILABLE' },
  { category: 'scheduler', capability: 'schedule.list', effectClass: 'READ_ONLY', status: 'AVAILABLE' },
  { category: 'research', capability: 'research.fetch', effectClass: 'READ_ONLY', status: 'AVAILABLE' },
  { category: 'gmail', capability: 'gmail.search', effectClass: 'READ_ONLY', status: 'NOT_CONFIGURED' },
  { category: 'gmail', capability: 'gmail.create_draft', effectClass: 'INTERNAL_MUTATION', status: 'NOT_CONFIGURED' },
  { category: 'gmail', capability: 'gmail.send', effectClass: 'EXTERNAL_ACTION', status: 'NOT_CONFIGURED' },
  // A category no icon map knows. The view must still render it rather than
  // throwing — this is the regression that broke the screen.
  { category: 'some-future-pack', capability: 'future.thing', effectClass: 'READ_ONLY', status: 'NOT_CONFIGURED' },
].map((r) => ({
  displayName: `Display ${r.capability}`,
  summary: `Summary for ${r.capability}`,
  runtime: 'test-runtime',
  registryEffectClass: r.effectClass === 'READ_ONLY' ? 'READ' : r.effectClass,
  riskTier: 'LOW',
  approvalPolicy: r.effectClass === 'READ_ONLY' ? 'NONE' : 'GUARDIAN_ENFORCED',
  guardianEnforced: r.effectClass !== 'READ_ONLY',
  workspaceScope: 'member',
  brainWriteback: 'NONE',
  configured: r.status === 'AVAILABLE',
  enabled: true,
  missingConfiguration: r.status === 'AVAILABLE' ? null : 'GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET',
  reason: `Reason for ${r.capability}`,
  reference: 'lib/whatever.ts::fn',
  lastInvokedAt: null,
  lastInvokedStatus: null,
  ...r,
}));

const TOOLS_PAYLOAD = {
  success: true,
  count: TOOL_ROWS.length,
  tools: TOOL_ROWS,
  summary: { available: 5, notConfigured: 4, readOnly: 7, internalMutation: 1, externalAction: 1 },
};

const APPROVALS_PAYLOAD = {
  success: true,
  count: 1,
  approvals: [{
    approval_id: 'apr-render-1',
    workspace_id: WS,
    task_id: null,
    correlation_id: 'corr-render-1',
    capability: 'gmail.send',
    action: 'execute',
    effect_class: 'EXTERNAL_ACTION',
    requested_by_user_id: 'requester',
    decided_by_user_id: null,
    guardian_decision: 'SAFE',
    guardian_citation: null,
    action_summary: 'SEND EMAIL — this will leave SynthOS and reach a person.\n\nTo: recipient@external.test\nSubject: Hello',
    input_digest: 'a'.repeat(64),
    status: 'PENDING',
    decision_reason: null,
    created_at: '2026-09-15T20:00:00.000Z',
    decided_at: null,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    consumed_at: null,
    consumed_by_task_id: null,
  }],
  summary: { pending: 1, approved: 0, rejected: 0, consumed: 0, expired: 0 },
};

function stubFetch(routes: Record<string, unknown>, failFor?: RegExp) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (failFor && failFor.test(url)) {
      return { ok: false, status: 500, json: async () => ({ success: false, error: 'Upstream unavailable' }) } as any;
    }
    for (const [fragment, body] of Object.entries(routes)) {
      if (url.includes(fragment)) return { ok: true, status: 200, json: async () => body } as any;
    }
    return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
  });
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} } as any);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the Tool Registry renders every category the registry returns', () => {
  it('mounts without throwing and shows the real count', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/api/tools': TOOLS_PAYLOAD }));
    render(<ToolRegistryView activeWorkspaceId={WS} />);
    await waitFor(() => {
      expect(screen.getByText(/Tool Registry \(9\)/)).toBeTruthy();
    }, { timeout: 4000 });
  });

  it('renders all four Gmail rows, including the external action', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/api/tools': TOOLS_PAYLOAD }));
    render(<ToolRegistryView activeWorkspaceId={WS} />);
    await waitFor(() => expect(screen.getByText(/Tool Registry \(9\)/)).toBeTruthy(), { timeout: 4000 });

    const text = document.body.textContent || '';
    for (const cap of ['gmail.search', 'gmail.create_draft', 'gmail.send']) {
      expect(text, cap).toContain(cap);
    }
    expect(text).toContain('EXTERNAL_ACTION');
    expect(text).toContain('INTERNAL_MUTATION');
  });

  it('renders a category it has no icon for, instead of crashing the screen', async () => {
    // THE REGRESSION. A category absent from the icon map must degrade to a
    // generic icon, never to `undefined` as an element type.
    vi.stubGlobal('fetch', stubFetch({ '/api/tools': TOOLS_PAYLOAD }));
    render(<ToolRegistryView activeWorkspaceId={WS} />);
    await waitFor(() => expect(screen.getByText(/Tool Registry \(9\)/)).toBeTruthy(), { timeout: 4000 });
    expect(document.body.textContent).toContain('future.thing');
    expect(document.body.textContent).toContain('SOME-FUTURE-PACK');
  });

  it('offers a filter button for every category present, derived from the data', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/api/tools': TOOLS_PAYLOAD }));
    render(<ToolRegistryView activeWorkspaceId={WS} />);
    await waitFor(() => expect(screen.getByText(/Tool Registry \(9\)/)).toBeTruthy(), { timeout: 4000 });
    for (const label of ['ALL', 'BRAIN', 'GITHUB', 'FILES', 'SCHEDULER', 'RESEARCH', 'GMAIL', 'SOME-FUTURE-PACK']) {
      expect(screen.getAllByText(label).length, label).toBeGreaterThan(0);
    }
  });

  it('shows the missing configuration for an unconfigured tool', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/api/tools': TOOLS_PAYLOAD }));
    render(<ToolRegistryView activeWorkspaceId={WS} />);
    await waitFor(() => expect(screen.getByText(/Tool Registry \(9\)/)).toBeTruthy(), { timeout: 4000 });
    expect(document.body.textContent).toContain('GOOGLE_OAUTH_CLIENT_ID');
  });

  it('an unreadable registry renders UNKNOWN, not an empty table', async () => {
    vi.stubGlobal('fetch', stubFetch({}, /\/api\/tools/));
    render(<ToolRegistryView activeWorkspaceId={WS} />);
    await waitFor(() => {
      expect(screen.getByText(/Tool Registry \(UNKNOWN\)/)).toBeTruthy();
    }, { timeout: 4000 });
  });
});

describe('the Approval Queue renders a pending external action', () => {
  it('mounts and shows the pending send with its Guardian verdict', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/api/approvals': APPROVALS_PAYLOAD }));
    render(<ApprovalQueueView activeWorkspaceId={WS} />);
    await waitFor(() => {
      expect(screen.getByText(/Approval Queue \(1 pending\)/)).toBeTruthy();
    }, { timeout: 4000 });

    const text = document.body.textContent || '';
    expect(text).toContain('gmail.send');
    expect(text).toContain('EXTERNAL_ACTION');
    expect(text).toContain('Guardian: SAFE');
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.getByText('Reject')).toBeTruthy();
  });

  it('an unreadable queue renders UNKNOWN rather than "nothing needs attention"', async () => {
    vi.stubGlobal('fetch', stubFetch({}, /\/api\/approvals/));
    render(<ApprovalQueueView activeWorkspaceId={WS} />);
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/UNKNOWN/);
    }, { timeout: 4000 });
    expect(document.body.textContent).not.toMatch(/Nothing is waiting/);
  });

  it('an empty queue says so explicitly', async () => {
    vi.stubGlobal('fetch', stubFetch({
      '/api/approvals': { success: true, count: 0, approvals: [], summary: { pending: 0, approved: 0, rejected: 0, consumed: 0, expired: 0 } },
    }));
    render(<ApprovalQueueView activeWorkspaceId={WS} />);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Nothing is waiting for your decision');
    }, { timeout: 4000 });
  });
});
