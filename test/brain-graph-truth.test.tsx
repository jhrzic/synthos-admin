// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';

import { ObsidianGraphMind } from '../src/components/ObsidianGraphMind';
import type { ObsidianVault } from '../src/types';

// ---------------------------------------------------------------------------
// BRAIN GRAPH — RICH GRAPHICS, TRUTHFUL DATA.
//
// THE DEFECT THIS EXISTS TO STOP, found by looking at the live Admin rather
// than by reading code:
//
// ObsidianGraphMind built a node for EVERY entry in the model registry,
// unconditionally. With a Brain holding one real note, the graph rendered
// twelve model nodes around it — ElevenLabs, Perplexity, Cursor, Codex,
// OpenClaw and others, most of which this build cannot execute. The
// visualisation looked populated while the knowledge in it was a single note.
//
// That is the exact failure the repo's own standing rules name from two
// directions at once: rich UI carrying fabricated substance (AGENTS.md §3),
// and a graph whose fullness came from its decoration rather than its data.
// A sparse Brain must LOOK sparse.
//
// Separately, model edges were drawn on a CONTENT SUBSTRING match — a note
// merely mentioning "claude" gained a provenance edge to Claude. Provenance is
// recorded in the note's own frontmatter `model:` field; a substring is a
// guess. Both are pinned below.
// ---------------------------------------------------------------------------

/** The real model registry shape, with entries this build cannot execute. */
const MODELS: Record<string, any> = {
  openai: { name: 'OpenAI GPT', color: '#00D26A' },
  gemini: { name: 'Gemini', color: '#1A73E8' },
  claude: { name: 'Claude', color: '#F97316' },
  perplexity: { name: 'Perplexity Sonar Deep Research', color: '#20B2AA' },
  cursor: { name: 'Cursor K13 Agent', color: '#A855F7' },
  elevenlabs: { name: 'ElevenLabs EL Voice Engine', color: '#EC4899' },
};

// The real ObsidianVault shape — path and status are required, and using the
// real type rather than a cast is what makes this fixture a contract check.
const VAULT: ObsidianVault[] = [{
  id: 'vault-1',
  name: 'Obsidian vault',
  path: '/tmp/test-vault',
  status: 'synced',
  notesCount: 1,
  lastSynced: '2026-09-17',
  size: '1.0 KB',
}];

/** One real note, produced by OpenAI, with real topics — and NO wikilinks. */
const ONE_REAL_NOTE = [{
  id: 'SynthOS/Sessions/always-on.md',
  title: 'Always-on runtime verification',
  path: 'SynthOS/Sessions/always-on.md',
  folder: 'Sessions',
  content: 'The runtime was verified. It mentions claude and gemini in passing as unrelated prose.',
  tags: ['verification', 'runtime', 'vault'],
  wikilinks: [] as string[],
  createdAt: '2026-09-15T12:00:00.000Z',
  updatedAt: '2026-09-15T12:00:00.000Z',
  workspace: 'ws-synthos-primary',
  agent: 'core-connectivity-verification',
  model: 'gpt-5.6-terra',
}] as any[];

beforeEach(() => {
  // Canvas is not implemented in jsdom; the component must still mount and
  // build its graph without one.
  (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => ({
    clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), save: vi.fn(), restore: vi.fn(),
    translate: vi.fn(), scale: vi.fn(), fillText: vi.fn(), measureText: vi.fn(() => ({ width: 10 })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    setLineDash: vi.fn(), fillRect: vi.fn(), rect: vi.fn(), quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(), ellipse: vi.fn(),
  })) as any;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} } as any);
  vi.stubGlobal('requestAnimationFrame', ((cb: any) => setTimeout(() => cb(0), 0)) as any);
  vi.stubGlobal('cancelAnimationFrame', (() => {}) as any);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the Brain graph renders rich graphics without inventing data', () => {
  it('mounts with one real note and does not crash', async () => {
    render(<ObsidianGraphMind notes={ONE_REAL_NOTE} vaults={VAULT} models={MODELS} height={400} />);
    await waitFor(() => {
      expect(document.querySelector('canvas')).toBeTruthy();
    }, { timeout: 4000 });
  });

  it('shows NO model node for a model no note came from', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/ObsidianGraphMind.tsx'), 'utf8');
    // The registry is filtered to referenced models before nodes are built.
    expect(src).toMatch(/const referencedModels = Object\.entries\(models\)\.filter/);
    // And the unconditional form is gone.
    expect(src).not.toMatch(/Object\.entries\(models\)\.forEach\(\(\[key, model\], i\) => \{[\s\S]{0,400}type: 'model'/);
  });

  it('derives model provenance from the note’s frontmatter, not a content substring', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/ObsidianGraphMind.tsx'), 'utf8');
    // The canonical field is consulted.
    expect(src).toMatch(/const producedBy = \(n as \{ model\?: string \}\)\.model/);
    // The substring-on-body inference is gone. A note MENTIONING a model must
    // not gain a provenance edge to it — this fixture's body names "claude"
    // and "gemini" precisely to make that regression detectable.
    expect(src).not.toMatch(/n\.content\.toLowerCase\(\)\.includes\(mKey\)/);
  });

  it('renders honestly with an empty Brain — no nodes conjured from the roster', async () => {
    render(<ObsidianGraphMind notes={[]} vaults={VAULT} models={MODELS} height={400} />);
    await waitFor(() => expect(document.querySelector('canvas')).toBeTruthy(), { timeout: 4000 });
    // No fixture names anywhere in the rendered output.
    const text = document.body.textContent || '';
    for (const forbidden of ['Northgate', 'Halcyon', 'RestWell', 'Sleep Haven', 'Hill Country Dental']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('contains no fixture note content of its own', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/ObsidianGraphMind.tsx'), 'utf8');
    for (const forbidden of ['Northgate', 'Halcyon', 'RestWell', 'Sleep Haven', 'meridian-protocol', 'dealer-network', 'synthos-geo']) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });

  it('a note with no wikilinks produces no invented edges', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/ObsidianGraphMind.tsx'), 'utf8');
    // Wikilink edges are resolved against real target notes, not guessed.
    expect(src).toMatch(/sourceNote\.wikilinks\.forEach/);
    // There is no similarity/fuzzy edge builder.
    expect(src).not.toMatch(/similarity|cosine|embedding/i);
  });

  it('the footer counts what is on screen, never a hardcoded number', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/ObsidianGraphMind.tsx'), 'utf8');
    // No hardcoded engine total anywhere. The component's own comment about
    // the removed literal is worded so as not to quote it — three earlier
    // versions of this assertion failed against that documentation rather
    // than against code, which is a test measuring prose.
    expect(src).not.toMatch(/\d+ AI Engines/);
    // Every footer figure is derived.
    expect(src).toMatch(/\{notes\.length\} Notes/);
    expect(src).toMatch(/\{vaults\.length\} Vaults/);
    expect(src).toMatch(/initialNodes\.filter\(\(n\) => n\.type === 'model'\)\.length\} Model Nodes/);
  });

  it('renders the external source layer distinctly and counts it truthfully', async () => {
    const sources = [
      { vaultRelativePath: '10-context/voice.md', title: 'Voice', folder: '10-context', wikilinks: ['positioning'] },
      { vaultRelativePath: '10-context/positioning.md', title: 'Positioning', folder: '10-context', wikilinks: [] },
    ];
    const edges = [{ source: '10-context/voice.md', target: '10-context/positioning.md' }];
    render(
      <ObsidianGraphMind
        notes={ONE_REAL_NOTE}
        vaults={VAULT}
        models={MODELS}
        externalSources={sources}
        externalEdges={edges}
        height={400}
      />,
    );
    await waitFor(() => expect(document.querySelector('canvas')).toBeTruthy(), { timeout: 4000 });
    const text = document.body.textContent || '';
    // Counted, not asserted.
    expect(text).toContain('2 External Sources');
    expect(text).toContain('1 Wikilink Edges');
    // And the knowledge count stays its own number.
    expect(text).toContain('1 Notes');
  });

  it('with no external sources the layer is absent, not zero-padded', async () => {
    render(<ObsidianGraphMind notes={ONE_REAL_NOTE} vaults={VAULT} models={MODELS} height={400} />);
    await waitFor(() => expect(document.querySelector('canvas')).toBeTruthy(), { timeout: 4000 });
    // Nothing claims "0 External Sources" — the layer simply is not there.
    expect(document.body.textContent).not.toContain('External Sources');
  });

  it('survives repeated mount/unmount without leaking an animation loop', async () => {
    for (let i = 0; i < 4; i += 1) {
      const { unmount } = render(<ObsidianGraphMind notes={ONE_REAL_NOTE} vaults={VAULT} models={MODELS} height={300} />);
      await waitFor(() => expect(document.querySelector('canvas')).toBeTruthy(), { timeout: 4000 });
      unmount();
    }
    // The component must clean its own frame loop up on unmount.
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/ObsidianGraphMind.tsx'), 'utf8');
    expect(src).toMatch(/cancelAnimationFrame/);
  });
});
