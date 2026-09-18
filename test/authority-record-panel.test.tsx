// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { AuthorityRecordPanel } from '../src/components/AuthorityRecordPanel';

// The panel must show what the server just re-checked — including problems —
// and never a reassuring default when the API fails.

const summary = (over: Record<string, unknown> = {}) => ({
  success: true,
  summary: {
    actions: 4, withApproval: 3, selfApproved: 1, noApprovalOnRecord: 1,
    outcomes: { sale_closed: 2, visit_booked: 3 },
    lastCheckpoint: { seq: 5, signedAt: '2026-09-18T10:00:00Z' }, headSeq: 9,
    integrity: { ok: true, entries: 9, problems: [] },
    ...over,
  },
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stub = (body: unknown, ok = true) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body })));

describe('AuthorityRecordPanel', () => {
  it('shows approvals, results and how much is not yet pinned', async () => {
    stub(summary());
    render(<AuthorityRecordPanel workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByText(/Intact/)).toBeTruthy());
    expect(screen.getByText('3 · 75%')).toBeTruthy();
    expect(screen.getByText('sale closed')).toBeTruthy();
    expect(screen.getByText(/4 newer entries not yet pinned/)).toBeTruthy();
  });

  it('shows integrity problems instead of hiding them', async () => {
    stub(summary({ integrity: { ok: false, entries: 9, problems: ['entry 3: receipt r3 was altered'] } }));
    render(<AuthorityRecordPanel workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByText(/Problems found/)).toBeTruthy());
    expect(screen.getByText(/was altered/)).toBeTruthy();
  });

  it('shows the error, not zeros, when the API fails', async () => {
    stub({ success: false, error: 'Not a member of this workspace.' }, false);
    render(<AuthorityRecordPanel workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByText(/Not a member/)).toBeTruthy());
    expect(screen.queryByText('Actions on record')).toBeNull();
  });
});
