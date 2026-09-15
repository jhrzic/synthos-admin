// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { ClaudeArtifactsView } from '../src/components/ClaudeArtifactsView';
import { ObsidianView } from '../src/components/ObsidianView';

// ---------------------------------------------------------------------------
// DOES THE UI ACTUALLY RENDER THE CORRECTED DATA?
//
// Everything so far has been proven at the API layer and by scanning source.
// Neither answers the question that matters: when the endpoint returns 42
// artifacts, does the panel put 42 on the screen?
//
// These render the REAL components into a real DOM with `fetch` stubbed to
// return the canonical values, then assert what the user would see. It is not
// a screenshot — no browser is involved, so this cannot catch a CSS problem
// that hides a correct number. It does catch the whole binding layer:
// request shape, response parsing, state, and the rendered text.
//
// The fixture bug this closes was invisible to every other kind of test: the
// component rendered three invented artifacts from a hardcoded array while
// the real store held 42, and no API test could see that because the
// component never called the API at all.
// ---------------------------------------------------------------------------

const WS = 'ws-synthos-primary';

/** 42 canonical vault entries, shaped exactly as GET /api/vault returns them. */
const REAL_VAULT_ENTRIES = Array.from({ length: 42 }, (_, i) => ({
  artifact_id: `art-real-${i}`,
  task_id: `task-real-${i}`,
  title: `Real artifact ${i}`,
  relative_path: `workspaces/${WS}/Startup-Theses/art-real-${i}.md`,
  content_hash: `hash${i}`,
  size_bytes: 1024 + i,
  created_at: `2026-09-1${i % 9}T10:00:00.000Z`,
  content_type: 'text/markdown',
}));

/** The real knowledge-mesh response shape, with one SynthOS-written note. */
const REAL_MESH = {
  success: true,
  vault: {
    root: '/Users/hrzic/synthos/vault',
    mode: 'EXTERNAL',
    source: 'SYNTHOS_VAULT_PATH',
    writable: true,
    isObsidianIntegration: true,
    writeSubdirectory: 'SynthOS',
  },
  notes: [{
    fileName: 'Always-on-runtime-verification__2026-09-15.md',
    vaultRelativePath: 'SynthOS/Sessions/Always-on-runtime-verification__2026-09-15.md',
    kind: 'Sessions',
    sizeBytes: 559,
    modifiedAt: '2026-09-15T12:00:00.000Z',
    title: 'Always-on runtime verification',
    type: 'synthos-sessions',
    createdAt: '2026-09-15T12:00:00.000Z',
    workspaceId: WS,
    source: 'core-connectivity-verification',
    sessionId: null,
    project: null,
    runtime: 'synthos-admin',
    model: null,
    topics: ['runtime', 'vault'],
    tags: ['verification'],
    artifacts: [],
    receipts: [],
    generatedBy: 'SynthOS',
    wikilinks: [],
    body: '# Always-on runtime verification\n\nSafe to delete.\n',
    truncated: false,
  }],
  counts: { notes: 1, withReceipts: 0, withArtifacts: 0, withWikilinks: 0, sessions: 0, kinds: ['Sessions'] },
};

/** Routes a stubbed fetch by URL, so each component sees its own real contract. */
function stubFetch(routes: Record<string, unknown>, opts: { failFor?: RegExp } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (opts.failFor && opts.failFor.test(url)) {
      return { ok: false, status: 500, json: async () => ({ success: false, error: 'Upstream unavailable' }) } as any;
    }
    for (const [fragment, body] of Object.entries(routes)) {
      if (url.includes(fragment)) {
        return { ok: true, status: 200, json: async () => body } as any;
      }
    }
    return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
  });
}

const noopModels = {} as any;
const asyncNoop = async () => '';

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  } as any);
  vi.stubGlobal('ResizeObserver', class {
    observe() {} unobserve() {} disconnect() {}
  } as any);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the artifact panel renders the canonical count, not a fixture', () => {
  it('shows 42 when the Vault API returns 42 entries', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/api/vault': { success: true, entries: REAL_VAULT_ENTRIES } }));

    render(<ClaudeArtifactsView models={noopModels} onSendQuery={asyncNoop} activeWorkspaceId={WS} />);

    // The header count is the number an operator reads first.
    await waitFor(() => {
      expect(screen.getByText(/Active Artifacts \(42\)/)).toBeTruthy();
    }, { timeout: 4000 });
  });

  it('the invented fixture artifacts are gone from the rendered output', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/api/vault': { success: true, entries: REAL_VAULT_ENTRIES } }));

    render(<ClaudeArtifactsView models={noopModels} onSendQuery={asyncNoop} activeWorkspaceId={WS} />);
    await waitFor(() => expect(screen.getByText(/Active Artifacts \(42\)/)).toBeTruthy(), { timeout: 4000 });

    // The three that used to ship as if they were real work.
    expect(screen.queryByText(/Decentralized Agent Fleet Health HUD/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/Fleet Health HUD/);
  });

  it('a real artifact title reaches the screen', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/api/vault': { success: true, entries: REAL_VAULT_ENTRIES } }));

    render(<ClaudeArtifactsView models={noopModels} onSendQuery={asyncNoop} activeWorkspaceId={WS} />);
    await waitFor(() => expect(screen.getByText(/Active Artifacts \(42\)/)).toBeTruthy(), { timeout: 4000 });
    expect(document.body.textContent).toContain('Real artifact 0');
  });

  // 0-on-error is a fabricated fact: the real answer is "we could not tell".
  it('a failed fetch renders UNKNOWN, never a fake zero', async () => {
    vi.stubGlobal('fetch', stubFetch({}, { failFor: /\/api\/vault/ }));

    render(<ClaudeArtifactsView models={noopModels} onSendQuery={asyncNoop} activeWorkspaceId={WS} />);

    await waitFor(() => {
      expect(screen.getByText(/Active Artifacts \(UNKNOWN\)/)).toBeTruthy();
    }, { timeout: 4000 });
    expect(screen.queryByText(/Active Artifacts \(0\)/)).toBeNull();
  });

  it('an empty store renders a real zero, which is different from UNKNOWN', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/api/vault': { success: true, entries: [] } }));

    render(<ClaudeArtifactsView models={noopModels} onSendQuery={asyncNoop} activeWorkspaceId={WS} />);
    await waitFor(() => {
      expect(screen.getByText(/Active Artifacts \(0\)/)).toBeTruthy();
    }, { timeout: 4000 });
  });
});

describe('the Brain panel renders the real vault, not fixtures', () => {
  const renderBrain = () => render(
    <ObsidianView
      vaults={[]}
      notes={[]}
      models={noopModels}
      onAddNote={() => {}}
      onUpdateNote={() => {}}
      onDeleteNote={() => {}}
      onSendToModel={() => {}}
      activeWorkspaceId={WS}
    />,
  );

  it('states the real vault path and that it is an Obsidian integration', async () => {
    vi.stubGlobal('fetch', stubFetch({
      '/api/knowledge/mesh': REAL_MESH,
      '/api/vault': { success: true, entries: REAL_VAULT_ENTRIES },
    }));

    renderBrain();

    await waitFor(() => {
      expect(document.body.textContent).toContain('/Users/hrzic/synthos/vault');
    }, { timeout: 4000 });
    expect(document.body.textContent).toContain('OBSIDIAN (EXTERNAL)');
    // The bounded subtree SynthOS owns, so the screen shows it is not reading
    // the whole personal vault.
    expect(document.body.textContent).toContain('SynthOS');
  });

  // Asserts the DEFAULT tab (mesh). The note list lives in the 'notes'
  // section, so a note TITLE is not on screen until the operator switches —
  // correct component behaviour, and worth pinning rather than asserting a
  // title the default view never shows.
  it('shows the real SynthOS note count on the default tab, and no Northgate fixture content', async () => {
    vi.stubGlobal('fetch', stubFetch({
      '/api/knowledge/mesh': REAL_MESH,
      '/api/vault': { success: true, entries: REAL_VAULT_ENTRIES },
    }));

    renderBrain();

    await waitFor(() => {
      expect(document.body.textContent).toContain('Knowledge Notes');
    }, { timeout: 4000 });
    // One real note, rendered as one — not a fabricated total.
    expect(screen.getByText('1')).toBeTruthy();
    // The 112 fictional-business notes must never appear in the production
    // Brain surface — they are test-harness output for "Northgate Roofing".
    expect(document.body.textContent).not.toMatch(/Northgate/i);
    // And no invented artifact content leaks in from the other panel.
    expect(document.body.textContent).not.toMatch(/Fleet Health HUD/);
  });

  it('an empty vault renders an explicit empty state, not a graph of nothing', async () => {
    vi.stubGlobal('fetch', stubFetch({
      '/api/knowledge/mesh': { ...REAL_MESH, notes: [], counts: { ...REAL_MESH.counts, notes: 0 } },
      '/api/vault': { success: true, entries: [] },
    }));

    renderBrain();

    await waitFor(() => {
      expect(document.body.textContent).toContain('No SynthOS knowledge notes yet');
    }, { timeout: 4000 });
  });

  it('an unreadable vault reports UNKNOWN rather than an empty vault', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/api/vault': { success: true, entries: [] } }, { failFor: /knowledge\/mesh/ }));

    renderBrain();

    await waitFor(() => {
      // "could not read" and "nothing there" are different facts.
      expect(document.body.textContent).toMatch(/UNKNOWN/);
    }, { timeout: 4000 });
  });
});
