import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// P0-B — the canonical scheduler shipped with 7 routes, real occurrence records
// and substantial test coverage (test/scheduler.test.ts), but no UI. Real
// schedules were running that nobody could see, pause or inspect.
//
// The rule this file protects: SchedulerView is a VIEW over the existing
// scheduler. It must never become a second scheduling engine, and it must never
// re-decide the server's state machine locally.
// ---------------------------------------------------------------------------

const repoRoot = process.cwd();
const read = (p: string) => fs.readFileSync(path.resolve(repoRoot, p), 'utf-8');

const view = read('src/components/SchedulerView.tsx');
const appContent = read('src/App.tsx');
const sidebar = read('src/components/SidebarNav.tsx');
const serverContent = read('server.ts');

describe('1: schedule listing comes from the canonical API', () => {
  it('lists via GET /api/schedules with an explicit workspaceId', () => {
    expect(view).toContain('/api/schedules?workspaceId=');
    expect(view).toContain('encodeURIComponent(workspaceId)');
  });

  it('renders the real schedule columns', () => {
    for (const field of [
      'schedule_id', 'workspace_id', 'capability', 'action', 'raw_text',
      'recurrence_type', 'interval_seconds', 'next_run_at', 'last_run_at',
      'status', 'status_reason',
    ]) {
      expect(view).toContain(field);
    }
  });

  it('renders every status the schema allows, and only those', () => {
    for (const st of ['ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED', 'BLOCKED', 'NOT_CONFIGURED', 'CANCELLED']) {
      expect(view).toContain(st);
    }
    // The schema's CHECK constraint is the source of truth for this union.
    const schema = read('lib/persistence.ts');
    expect(schema).toContain("status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED', 'BLOCKED', 'NOT_CONFIGURED', 'CANCELLED'))");
  });
});

describe('2: actions call the server routes — no second scheduling engine', () => {
  it('pause / resume / run-now post to the canonical endpoints', () => {
    // The action name is interpolated into the URL, so assert the union that
    // feeds it plus the exact URL template it is interpolated into.
    expect(view).toContain("'pause' | 'resume' | 'run-now' | 'cancel'");
    expect(view).toContain('/api/schedules/${encodeURIComponent(scheduleId)}/${action}');
    expect(view).toContain("method: 'POST'");
    expect(view).toContain("act(s.schedule_id, 'pause')");
    expect(view).toContain("act(s.schedule_id, 'resume')");
    expect(view).toContain("act(s.schedule_id, 'run-now')");
  });

  it('cancel uses the server soft-delete, preserving occurrence history', () => {
    expect(view).toContain("method: 'DELETE'");
    const schedulerRoutes = serverContent.slice(serverContent.indexOf('app.delete("/api/schedules/:id"'));
    expect(schedulerRoutes.slice(0, 400)).toContain('Soft delete');
    expect(schedulerRoutes.slice(0, 400)).toContain('CANCELLED');
  });

  it('the UI never computes next_run_at, fires occurrences, or writes schedule state itself', () => {
    // Step 7 semantics (no missed-run burst, idempotency, capability recheck,
    // approval restrictions) live server-side. Re-implementing any of them here
    // would fork them.
    expect(view).not.toContain('setInterval');
    expect(view).not.toContain('computeResumeNextRunAt');
    expect(view).not.toContain('fireScheduleOccurrence');
    expect(view).not.toContain('idempotencyKey');
  });

  it('a rejected action surfaces the server\'s real reason instead of being swallowed', () => {
    expect(view).toContain('Scheduler rejected the action');
    expect(view).toContain('setActionError');
  });
});

describe('3: occurrence history is real', () => {
  it('loads occurrences from the schedule detail route', () => {
    expect(view).toContain('/api/schedules/${encodeURIComponent(scheduleId)}?workspaceId=');
    expect(view).toContain('data.occurrences');
  });

  it('renders occurrence outcome fields, including task/artifact/receipt links', () => {
    for (const field of ['occurrence_id', 'due_at', 'outcome', 'reason', 'task_id', 'artifact_id', 'receipt_id']) {
      expect(view).toContain(field);
    }
  });

  it('an empty history says so rather than implying a run happened', () => {
    expect(view).toContain('No occurrences recorded yet.');
  });
});

describe('4: the surface is reachable and honest', () => {
  it('is mounted and present in Operations navigation', () => {
    expect(appContent).toContain("activeTab === 'scheduler'");
    expect(appContent).toContain('<SchedulerView');
    expect(sidebar).toContain("id: 'scheduler' as ActiveTab");
  });

  it('shows UNKNOWN rather than a fabricated timestamp or count', () => {
    expect(view).toContain("return 'UNKNOWN'");
    expect(view).toContain("'UNKNOWN'");
    expect(view).toContain('No schedules in this workspace.');
  });

  it('does not fabricate a schedule when the backend returns none', () => {
    expect(view).not.toMatch(/schedules\s*=\s*\[\s*\{/);
  });
});
