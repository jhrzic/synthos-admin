// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { ObsidianGraphMind } from '../src/components/ObsidianGraphMind';

// ---------------------------------------------------------------------------
// THE OBSIDIAN VAULT GRAPH (restored design): it mounts, animates only while
// seen, honours reduced motion, and falls back to a static view without a
// canvas. Synthetic notes only.
// ---------------------------------------------------------------------------

const note = (id: string, links: string[] = []) => ({ id, title: `Note ${id}`, content: links.map((l) => `[[${l}]]`).join(' '), folder: 'SynthOS', tags: ['t'], links, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }) as any;
const NOTES = [note('a', ['b']), note('b', ['c']), note('c', ['a'])];
const VAULTS = [{ id: 'v1', name: 'Vault', path: '/v', noteCount: 3 }] as any;

const fakeCtx = () => new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : typeof k === 'string' ? () => undefined : undefined), set: () => true });
const setMotion = (reduce: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener: () => {}, removeEventListener: () => {} })) as any;
};
const mount = () => render(<ObsidianGraphMind notes={NOTES} vaults={VAULTS} models={{}} height={300} />);
const motion = () => document.querySelector('[data-testid="obsidian-graph-mind"]')!.getAttribute('data-motion');

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Obsidian vault graph', () => {
  it('without a canvas it shows a static fallback listing the real nodes, never a blank box', () => {
    setMotion(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as any);
    mount();
    expect(motion()).toBe('static-fallback');
    const fb = document.querySelector('[data-testid="obsidian-graph-static-fallback"]')!;
    expect(fb.textContent).toMatch(/Note a/);
    expect(fb.textContent).toMatch(/links/);
  });

  it('animates with requestAnimationFrame when visible and motion is allowed', () => {
    setMotion(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx() as any);
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    mount();
    expect(motion()).toBe('animating');
    expect(raf).toHaveBeenCalled();
  });

  it('reduced motion: one settled still frame, no animation loop', () => {
    setMotion(true);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx() as any);
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    mount();
    expect(motion()).toBe('reduced-motion');
    expect(raf).not.toHaveBeenCalled();
  });

  it('pauses while the tab is hidden and resumes when visible', () => {
    setMotion(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx() as any);
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    mount();
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(motion()).toBe('paused');
    expect(cancel).toHaveBeenCalled();
    raf.mockClear();
    vis.mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(motion()).toBe('animating');
    expect(raf).toHaveBeenCalled();
  });

  it('a paused graph still redraws when new notes arrive (no stale frame)', () => {
    setMotion(false);
    let arcs = 0;
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'arc' ? () => { arcs += 1; } : k === 'measureText' ? () => ({ width: 10 }) : typeof k === 'string' ? () => undefined : undefined), set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as any);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    // jsdom lays nothing out; give the graph container a real size.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    const { rerender } = render(<ObsidianGraphMind notes={NOTES.slice(0, 1)} vaults={VAULTS} models={{}} height={300} />);
    expect(motion()).toBe('paused');
    arcs = 0;
    rerender(<ObsidianGraphMind notes={NOTES} vaults={VAULTS} models={{}} height={300} />);
    expect(arcs).toBeGreaterThan(0);
  });

  it('has no external runtime asset and is sized from its container (no compounding scale)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/ObsidianGraphMind.tsx'), 'utf8');
    expect(src).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(src).toContain('new ResizeObserver');
    expect(src).toContain('setTransform(dpr, 0, 0, dpr, 0, 0)');
    expect(src).not.toMatch(/ctx\.scale\(dpr, dpr\)|g\.scale\(dpr, dpr\)/);
    expect(src).toContain("addEventListener('visibilitychange'");
    expect(src).toContain('new IntersectionObserver');
  });

  it('the Vault screen draws the graph for the selected source; an empty Brain no longer hides external notes', () => {
    const view = fs.readFileSync(path.join(process.cwd(), 'src/components/ObsidianView.tsx'), 'utf8');
    expect(view).toContain("graphNoteCount === 0 && (sourceFilter === 'BRAIN' || externalAttempted)");
    expect(view).toContain('data-testid="obsidian-show-external"');
    expect(view).toContain('<ObsidianGraphMind');
  });
});
