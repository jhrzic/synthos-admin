// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import { LeadScraperView } from '../src/components/LeadScraperView';
import { StudioLeadGenView } from '../src/components/StudioLeadGenView';
import { AutoContentNewsView } from '../src/components/AutoContentNewsView';
import { MessageBridgeView } from '../src/components/MessageBridgeView';
import { SystemAuditView } from '../src/components/SystemAuditView';
import { UpstreamCapabilityRegistry } from '../src/components/UpstreamCapabilityRegistry';
import {
  INITIAL_SYSTEM_AUDIT_CHECKS,
  INITIAL_AGENTS,
  INITIAL_CRON_JOBS,
  INITIAL_BOT_TASKS,
  INITIAL_VAULTS,
  INITIAL_NOTES,
} from '../src/data/mockData';
import type { SystemAuditCheck } from '../src/types';

// ---------------------------------------------------------------------------
// FABRICATED PRODUCTION STATE.
//
// Every assertion here corresponds to something the Admin actually displayed
// as fact and had not measured. The rule these pin down is the repo's own:
// keep the surface, fix the data. So each test renders the real component and
// asserts on the DOM or on behaviour — what a person sees on the screen —
// rather than grepping the source for a banned word. Three earlier attempts
// at this file's ancestors failed by asserting against comments instead of
// code, which measures prose, not truth.
// ---------------------------------------------------------------------------

const MODELS: Record<string, any> = {
  openai: { name: 'OpenAI GPT', color: '#00D26A' },
  gemini: { name: 'Gemini', color: '#1A73E8' },
  hermes: { name: 'Nous Hermes 3', color: '#EC4899' },
};

const noop = () => {};
const asyncNoop = async () => '';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} } as any);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the lead scraper reports what it has, which is nothing', () => {
  it('starts empty instead of with four real businesses', () => {
    render(
      <LeadScraperView models={MODELS} onAddNoteToVault={noop} onAddTaskToKanban={noop} onLogEvent={noop} />,
    );
    expect(screen.getByTestId('leads-empty-state')).toBeTruthy();
    // The four seeded businesses carried real phone numbers, street
    // addresses, emails and Instagram handles, with invented ratings and
    // review counts, presented as harvested leads.
    const text = document.body.textContent || '';
    for (const seeded of ['Urban Garden', 'Dahing Plants', 'The Sill', 'Greenery Unlimited']) {
      expect(text, seeded).not.toContain(seeded);
    }
    // And no phone number anywhere on the surface.
    expect(text).not.toMatch(/\(?\d{3}\)?[ -]\d{3}-\d{4}/);
  });

  it('refuses the scrape rather than inventing a lead, and says why', async () => {
    const logged: Array<[string, string, string]> = [];
    render(
      <LeadScraperView
        models={MODELS}
        onAddNoteToVault={noop}
        onAddTaskToKanban={noop}
        onLogEvent={(lvl, src, msg) => logged.push([lvl, src, msg])}
      />,
    );
    fireEvent.click(screen.getByText('Execute Scraper Pipeline'));

    // It used to wait 1.5s and prepend a fabricated lead. Nothing appears,
    // now or later.
    await waitFor(() => expect(screen.getByTestId('scraper-not-configured-notice')).toBeTruthy());
    expect(screen.getByTestId('scraper-not-configured-notice').textContent).toContain('NOT_CONFIGURED');
    expect(screen.getByTestId('leads-empty-state')).toBeTruthy();

    // The event log must not record a success for work that did not happen.
    expect(logged).toHaveLength(1);
    expect(logged[0][0]).toBe('warn');
    expect(logged[0][2]).toContain('refused');
  });
});

describe('the studio pipeline does not sum invented budgets into a headline', () => {
  it('reads UNKNOWN rather than $185,000 / MO', () => {
    render(
      <StudioLeadGenView
        agents={{} as any}
        models={MODELS}
        onAddTaskToKanban={noop}
        onAddNoteToVault={noop}
        onSendTelegramMessage={noop}
        onSendQuery={asyncNoop}
        onSelectTab={noop}
      />,
    );
    const text = document.body.textContent || '';
    expect(text).toContain('PIPELINE VALUE: UNKNOWN');
    expect(text).not.toContain('$185,000');
    expect(screen.getByTestId('studio-pipeline-empty-state')).toBeTruthy();
    // No invented company or contact person.
    for (const seeded of ['Nexus Cloud', 'AeroSynth', 'HyperScale Fintech', 'Sarah Jenkins', 'Michael Chang', 'David Vance']) {
      expect(text, seeded).not.toContain(seeded);
    }
    // Lead contact reads UNKNOWN, and the proposal button cannot fire with
    // nothing selected.
    expect(text).toContain('UNKNOWN');
    expect((screen.getByText('GENERATE SOW').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the content harvester does not invent citations', () => {
  it('starts with no signals and no fabricated source URLs', () => {
    render(
      <AutoContentNewsView
        agents={{} as any}
        models={MODELS}
        onAddNoteToVault={noop}
        onSendTelegramMessage={noop}
        onSendQuery={asyncNoop}
        onSelectTab={noop}
      />,
    );
    expect(screen.getByTestId('news-feed-empty-state')).toBeTruthy();
    const text = document.body.textContent || '';
    // A fabricated arXiv id and a fabricated HN item id are the worst case:
    // indistinguishable from real citations by eye.
    expect(text).not.toContain('2502.14920');
    expect(text).not.toContain('39811200');
    expect(text).not.toContain('Hermes-AgentOS');
    // No invented upvote counts.
    expect(text).not.toMatch(/▲ \d+ Upvotes/);
    // And the live-harvesting claim is gone.
    expect(text).not.toContain('LIVE HARVESTING ACTIVE');
    expect(text).toContain('NO FEED CONNECTED');
  });

  it('the refresh button ingests nothing and does not claim a count', () => {
    render(
      <AutoContentNewsView
        agents={{} as any}
        models={MODELS}
        onAddNoteToVault={noop}
        onSendTelegramMessage={noop}
        onSendQuery={asyncNoop}
        onSelectTab={noop}
      />,
    );
    fireEvent.click(screen.getByText('REFRESH FEEDS'));
    const text = document.body.textContent || '';
    expect(text).toContain('NOT_CONFIGURED');
    // It used to report "4 new breaking stories ingested" — a fixed number,
    // with no feed contacted.
    expect(text).not.toContain('stories ingested');
    expect(screen.getByTestId('news-feed-empty-state')).toBeTruthy();
  });
});

describe('the message bridge does not claim a connection it does not have', () => {
  it('opens unconfigured, with no credential literals and no paired session', () => {
    render(<MessageBridgeView models={MODELS} onSendQuery={asyncNoop} onLogEvent={noop} />);
    const text = document.body.textContent || '';
    // Invented secrets that the screen offered to copy out as a .env block.
    for (const secret of ['hermes_sec_auth_9948271', 'whsec_imsg_live_772183', 'hermes_wa_verify_2026', '109876543210987']) {
      expect(text, secret).not.toContain(secret);
    }
    // No seeded conversation, no third party, no invented token counts.
    for (const seeded of ['Alex (Investor)', 'alex.founder@icloud.com', 'Repo-Intel-Today']) {
      expect(text, seeded).not.toContain(seeded);
    }
    expect(screen.getByTestId('bridge-stream-empty-state')).toBeTruthy();
  });

  it('shows no scannable QR and refuses to pair, logging no success', () => {
    const logged: Array<[string, string, string]> = [];
    render(
      <MessageBridgeView
        models={MODELS}
        onSendQuery={asyncNoop}
        onLogEvent={(lvl, src, msg) => logged.push([lvl, src, msg])}
      />,
    );
    fireEvent.click(screen.getByText('WhatsApp Gateway (QR & Cloud API)'));

    // The panel used to draw a hand-built SVG that looked exactly like a
    // scannable pairing code and encoded nothing.
    expect(screen.getByTestId('whatsapp-qr-unavailable')).toBeTruthy();
    expect(document.querySelector('[data-testid="whatsapp-qr-unavailable"] svg')).toBeTruthy();
    expect(document.body.textContent).not.toContain('STATUS: connected');

    fireEvent.click(screen.getByText('Re-Generate Pairing QR'));
    expect(screen.getByTestId('whatsapp-pair-notice').textContent).toContain('NOT_CONFIGURED');
    // It used to declare the account paired after 1800ms and log a success.
    expect(logged.some(([lvl]) => lvl === 'success')).toBe(false);
    expect(logged[0][0]).toBe('warn');
  });
});

describe('the diagnostics screen reports unknown health as unknown', () => {
  it('does not claim a 100% pass rate over checks that never ran', () => {
    render(
      <SystemAuditView
        auditChecks={INITIAL_SYSTEM_AUDIT_CHECKS}
        onRunAudit={async () => {}}
        onPlayVoiceFeedback={noop}
      />,
    );
    const text = document.body.textContent || '';
    expect(text).toContain('NOT MEASURED');
    expect(text).not.toContain('100% PASS RATE');
    expect(text).not.toContain('6 of 6 checks passing');
    // Invented latencies and their invented SLA verdict.
    expect(text).not.toContain('46.5 ms');
    expect(text).not.toContain('Sub-100ms SLA target met');
    expect(text).not.toContain('All buttons verified live');
    // Every check reads UNKNOWN rather than a measurement.
    expect(text).toContain('UNKNOWN');
    expect(text).toContain(`0 of ${INITIAL_SYSTEM_AUDIT_CHECKS.length} checks measured`);
  });

  it('computes the pass rate from real results when some exist', () => {
    // The point of deriving rather than hardcoding: the figure has to move.
    const measured: SystemAuditCheck[] = [
      { id: 'a', component: 'A', category: 'api_routing', status: 'passed', latencyMs: 20, message: '', lastTested: 'now' },
      { id: 'b', component: 'B', category: 'api_routing', status: 'failed', latencyMs: 60, message: '', lastTested: 'now' },
      { id: 'c', component: 'C', category: 'memory_vault', status: 'unknown', latencyMs: 0, message: '', lastTested: 'NEVER' },
    ];
    render(<SystemAuditView auditChecks={measured} onRunAudit={async () => {}} onPlayVoiceFeedback={noop} />);
    const text = document.body.textContent || '';
    // One of two MEASURED checks passed. The unmeasured one is not counted as
    // a pass, and not counted as a failure either.
    expect(text).toContain('50%');
    expect(text).toContain('1 of 2 measured checks passing');
    // Average latency over the measured samples only: (20 + 60) / 2.
    expect(text).toContain('40.0 ms');
  });

  it('the seeded checks assert nothing and carry no invented trace', () => {
    for (const check of INITIAL_SYSTEM_AUDIT_CHECKS) {
      expect(check.status, check.component).toBe('unknown');
      expect(check.latencyMs, check.component).toBe(0);
      expect(check.lastTested, check.component).toBe('NEVER');
      expect(check.traceLog, check.component).toBeUndefined();
    }
  });
});

describe('the upstream registry does not report versions it never fetched', () => {
  it('reads NOT CONFIGURED with UNKNOWN versions, not eight projects up to date', () => {
    render(<UpstreamCapabilityRegistry onSendQuery={asyncNoop} onAddNoteToVault={noop} />);
    const text = document.body.textContent || '';
    expect(screen.getByTestId('upstream-version-source-notice')).toBeTruthy();
    // No item may claim a verdict, and none may show a version string.
    expect(text).not.toContain('UP TO DATE');
    expect(text).not.toContain('UPDATE AVAILABLE');
    for (const version of ['v3.7.1-beta', 'v1.4.2', 'v0.46.2', 'v0.45.8', 'v1.2.5', 'v0.8.2']) {
      expect(text, version).not.toContain(version);
    }
    // Nor an invented poll time.
    expect(text).not.toContain('Just now');
    expect(text).not.toContain('15s poll');
    expect(text).not.toContain('1 hour ago');
    expect(text).toContain('NEVER');
    // Every row says the same true thing.
    expect(screen.getAllByText('NOT CONFIGURED').length).toBeGreaterThan(1);
  });
});

describe('the seeded admin state makes no claim it cannot support', () => {
  it('declares no mounted vaults and no notes on disk', () => {
    // Four vaults with paths under '/User/Obsidian/', note counts of 146, 28,
    // 94 and 320 and sizes in MB, all 'synced'. None existed.
    expect(INITIAL_VAULTS).toHaveLength(0);
    expect(INITIAL_NOTES).toHaveLength(0);
  });

  it('keeps the agent roster but zeroes its telemetry', () => {
    const agents = Object.values(INITIAL_AGENTS);
    // The roster is product design and stays.
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      // Not 'active' or 'busy' — nothing has run.
      expect(agent.status, agent.name).toBe('standby');
      expect(agent.activeTasksCount, agent.name).toBe(0);
      expect(agent.completedTasksCount, agent.name).toBe(0);
      expect(agent.lastActive, agent.name).toBe('Never');
      if (agent.memoryFileSize !== undefined) {
        expect(agent.memoryFileSize, agent.name).toBe('UNKNOWN');
      }
    }
  });

  it('keeps schedule definitions but does not claim they are running', () => {
    expect(INITIAL_CRON_JOBS.length).toBeGreaterThan(0);
    for (const job of INITIAL_CRON_JOBS) {
      // They are not registered with the real scheduler.
      expect(job.status, job.name).toBe('disabled');
      expect(job.lastRun, job.name).toBe('NEVER');
      expect(job.nextRun, job.name).toBe('NEVER');
      expect(job.runCount, job.name).toBe(0);
    }
    for (const task of INITIAL_BOT_TASKS) {
      expect(task.status, task.name).toBe('paused');
      expect(task.lastRun, task.name).toBe('NEVER');
      expect(task.nextRun, task.name).toBe('NEVER');
      expect(task.actionsCount, task.name).toBe(0);
    }
  });
});
