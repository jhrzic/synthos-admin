// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// A PRODUCT MAY NOT ADVERTISE "LIVE" WITHOUT A WORKING PATH.
//
// The demo launcher badged Auto-Content, Lead Scraper and the Startup Idea
// Generator as LIVE. All three open surfaces that immediately declare they
// have no backend — the browser walk watched Auto-Content report NO FEED
// CONNECTED and the Lead Scraper refuse a scrape with NOT_CONFIGURED. A green
// LIVE badge on a surface whose own first words are "not configured" is the
// launcher contradicting the product.
//
// THE RULE PINNED HERE
// If a demo's component declares an unconfigured or illustrative state, the
// launcher may not badge it LIVE. Enforced against the real files, so adding a
// new demo or flipping a badge is checked automatically.
// ---------------------------------------------------------------------------

const LAUNCHER = 'src/components/products/FrontendDemosView.tsx';

/** Phrases by which a surface admits it has no working backend. */
const UNCONFIGURED_MARKERS = [
  'NOT_CONFIGURED',
  'NOT CONFIGURED',
  'NO FEED CONNECTED',
  'NO SCRAPER BACKEND',
  'NO SOURCE CONNECTED',
  'NO LEAD SOURCE',
  'NOT_IMPLEMENTED',
  'not real research',
  'illustrative',
];

/** Map a launcher tab id to the component App mounts for it. */
const COMPONENT_FOR_TAB: Record<string, string> = {
  'startup-generator': 'src/components/StartupIdeaGeneratorView.tsx',
  'auto-content': 'src/components/AutoContentNewsView.tsx',
  'studio-leadgen': 'src/components/StudioLeadGenView.tsx',
  'lead-scraper': 'src/components/LeadScraperView.tsx',
  'model-stacking': 'src/components/ModelStackingView.tsx',
  'intake-triage': 'src/components/IntakeTriageView.tsx',
};

function launcherStatuses(): Array<{ id: string; status: string }> {
  const src = fs.readFileSync(path.join(process.cwd(), LAUNCHER), 'utf8');
  const out: Array<{ id: string; status: string }> = [];
  const re = /id:\s*'([a-z0-9-]+)'[\s\S]*?status:\s*'([A-Z]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push({ id: m[1], status: m[2] });
  return out;
}

describe('the demo launcher does not claim LIVE for an unconfigured product', () => {
  it('found the launcher entries', () => {
    const entries = launcherStatuses();
    expect(entries.length).toBeGreaterThan(3);
    // Guards the parser: if the launcher's shape changes, this fails rather
    // than silently matching nothing and passing.
    expect(entries.every((e) => ['LIVE', 'PROTOTYPE', 'SIMULATED'].includes(e.status))).toBe(true);
  });

  it('every LIVE demo has a surface that does not declare itself unconfigured', () => {
    const offenders: string[] = [];
    for (const { id, status } of launcherStatuses()) {
      if (status !== 'LIVE') continue;
      const componentPath = COMPONENT_FOR_TAB[id];
      // A LIVE demo with no known component is itself a failure — the rule
      // cannot be checked, so it must not claim LIVE.
      if (!componentPath) { offenders.push(`${id}: LIVE but no component mapped`); continue; }
      const src = fs.readFileSync(path.join(process.cwd(), componentPath), 'utf8');
      // Ignore comment lines: this file and the components themselves discuss
      // these markers in prose, and a test that matched documentation would be
      // measuring comments rather than behaviour.
      const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      const found = UNCONFIGURED_MARKERS.filter((mk) => code.includes(mk));
      if (found.length) offenders.push(`${id}: LIVE but declares ${found.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the three previously mislabelled demos are no longer LIVE', () => {
    const byId = Object.fromEntries(launcherStatuses().map((e) => [e.id, e.status]));
    expect(byId['auto-content']).not.toBe('LIVE');
    expect(byId['lead-scraper']).not.toBe('LIVE');
    expect(byId['startup-generator']).not.toBe('LIVE');
  });

  it('no launcher description names a provider this build cannot dispatch', () => {
    const src = fs.readFileSync(path.join(process.cwd(), LAUNCHER), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    // These appeared in purpose text as though they were wired up.
    for (const provider of ['Perplexity', 'DeepSeek', 'ChatGPT o3', 'Claude Code 3.7']) {
      expect(code, provider).not.toContain(provider);
    }
  });
});
