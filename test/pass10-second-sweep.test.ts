import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Strips // and /* */ comments before matching, so an explanatory comment that quotes the old
// fabricated string as documentation (this codebase's own established convention — see
// OverviewOfficeView.tsx's header comment) doesn't trip a "still contains the fabrication" check.
const readCode = (relPath: string) => {
  const raw = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf-8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
};

// ---------------------------------------------------------------------------
// Pass X, second sweep: four active-screen fabrications found in files the
// first sweep never opened, locked in as regression tests so a future edit
// can't silently reintroduce them. See docs/UI-IA-AUDIT.md's addendum and
// docs/IMPLEMENTATION-STATUS.md's Overview row for the full writeup.
// ---------------------------------------------------------------------------

describe('Pass X second sweep: StartupIdeaGeneratorView never defaults to fabricated content', () => {
  const content = readCode('src/components/StartupIdeaGeneratorView.tsx');

  it('does not default the visible idea card to a canned sample on first load', () => {
    expect(content).not.toContain('useState<GeneratedIdea | null>(SAMPLE_GENERATED_IDEAS[0])');
  });

  it('does not claim a live scrape or an automated cron sweep produced its example content', () => {
    expect(content).not.toContain('LIVE SCRAPING SIGNALS');
    expect(content).not.toContain('harvested from previous Scout & Analytics cron sweeps');
    expect(content).not.toContain('CACHED THESES');
  });

  it('does not send Telegram messages asserting fabricated numbers as "Identified"/"validated" fact', () => {
    expect(content).not.toContain('New High-Viability Startup Opportunity Identified');
    expect(content).not.toContain('Unit Economics validated for');
  });
});

describe('Pass X second sweep: HermesOracleView no longer fabricates per-agent memory telemetry', () => {
  const content = readCode('src/components/HermesOracleView.tsx');

  it('does not import the hardcoded fake memory-telemetry seed data', () => {
    expect(content).not.toContain('INITIAL_AGENT_MEMORIES');
    expect(content).not.toContain('AgentMemoryStatus');
  });

  it('does not fabricate a fake success message when a real diagnostic query fails', () => {
    expect(content).not.toContain('SIGNAL TELEMETRY OK');
    expect(content).not.toContain('responded in 74ms');
  });

  it('does not hardcode a "15/15 SIGNALS ONLINE" claim', () => {
    expect(content).not.toContain('15/15 SIGNALS ONLINE');
  });

  it('derives its one real signal from the real Hermes health endpoint', () => {
    expect(content).toContain("fetch('/api/hermes/health')");
  });
});

describe('Pass X second sweep: JulianGoldieAuditRunner status bar no longer defaults to LIVE/ACTIVE', () => {
  const content = readCode('src/components/JulianGoldieAuditRunner.tsx');

  it('does not default any status badge to a fabricated LIVE/ACTIVE claim before a real result exists', () => {
    expect(content).not.toContain("|| 'LIVE'");
    expect(content).not.toContain('ACTIVE (Dynamic)');
  });
});

describe('Pass X second sweep: MasterAdminView Guardian/Aegis badges are never hardcoded LIVE', () => {
  const content = readCode('src/components/MasterAdminView.tsx');

  it('does not hardcode getStatusBadge(\'LIVE\') for Guardian or Aegis regardless of real state', () => {
    expect(content).not.toContain("getStatusBadge('LIVE')");
  });

  it('reads the real diagnostics.guardian.status / diagnostics.aegis.status fields instead', () => {
    expect(content).toContain('diagnostics?.guardian.status');
    expect(content).toContain('diagnostics?.aegis.status');
  });

  it('the client-side guardian type matches what the real API actually returns (reviewsCount, not policyCount)', () => {
    expect(content).not.toContain('policyCount: number');
    expect(content).not.toContain('hitlRequired: boolean');
    expect(content).toContain('reviewsCount: number');
  });
});
