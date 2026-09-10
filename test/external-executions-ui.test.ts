import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// P1-B — the Windmill external execution control plane (ADR-006) is real
// backend with 9 routes and had no UI at all. This surface reads it; it does
// not add a second execution mechanism.
//
// The external_executions table is currently EMPTY because the Windmill
// runtime is NOT_CONFIGURED. That must render as an honest empty state — the
// screen is never allowed to seed an execution to look populated.
// ---------------------------------------------------------------------------

const repoRoot = process.cwd();
const read = (p: string) => fs.readFileSync(path.resolve(repoRoot, p), 'utf-8');

const view = read('src/components/ExternalExecutionsView.tsx');
const appContent = read('src/App.tsx');
const sidebar = read('src/components/SidebarNav.tsx');
const serverContent = read('server.ts');

describe('1: reads the existing external execution routes', () => {
  it('lists via the canonical workspace-scoped route', () => {
    expect(view).toContain('/api/external-executions?workspaceId=');
    expect(view).toContain('encodeURIComponent(workspaceId)');
    expect(serverContent).toContain('app.get("/api/external-executions"');
  });

  it('actions post to the existing refresh / retry / cancel routes', () => {
    expect(view).toContain('/api/external-executions/${encodeURIComponent(id)}/${action}');
    expect(view).toContain("'refresh' | 'retry' | 'cancel'");
    for (const r of ['refresh', 'retry', 'cancel']) {
      expect(serverContent).toContain(`/api/external-executions/:id/${r}`);
    }
  });

  it('does not implement an execution mechanism of its own', () => {
    expect(view).not.toContain('windmill-client');
    expect(view).not.toContain('executeEnvelope');
    expect(view).not.toContain('setInterval');
  });
});

describe('2: renders the real record fields', () => {
  it('shows identity, runtime, status, timing, references and errors', () => {
    for (const f of [
      'id', 'workspace_id', 'runtime', 'remote_path', 'remote_job_id',
      'correlation_id', 'skill_id', 'task_id', 'graph_run_id', 'status',
      'attempt_number', 'submitted_at', 'started_at', 'completed_at',
      'last_checked_at', 'error_code', 'error_message_safe',
      'result_artifact_id', 'result_receipt_id',
    ]) {
      expect(view).toContain(f);
    }
  });

  it('surfaces only the SAFE error message field, never a raw provider payload', () => {
    expect(view).toContain('error_message_safe');
    expect(view).not.toContain('error_message_raw');
    expect(view).not.toContain('providerPayload');
  });
});

describe('3: workspace isolation', () => {
  it('every read and action carries the workspace id', () => {
    expect(view).toContain('const workspaceId = activeWorkspaceId');
    // The action body always passes workspaceId through.
    const act = view.slice(view.indexOf('const act = useCallback'), view.indexOf('const act = useCallback') + 900);
    expect(act).toContain('JSON.stringify({ workspaceId })');
  });

  it('the server routes are workspace-guarded', () => {
    const idx = serverContent.indexOf('app.get("/api/external-executions"');
    expect(serverContent.slice(idx, idx + 200)).toContain('requireWorkspaceMember(fromQuery)');
  });
});

describe('4: the empty state is honest, never seeded', () => {
  it('states that nothing is recorded rather than inventing rows', () => {
    expect(view).toContain('No external executions recorded in this workspace.');
    // No inline fixture array anywhere.
    expect(view).not.toMatch(/executions\s*=\s*\[\s*\{/);
    expect(view).not.toContain('MOCK_');
    expect(view).not.toContain('INITIAL_');
  });

  it('explains an empty list using the real runtime configuration status', () => {
    expect(view).toContain('NOT_CONFIGURED');
    expect(view).toContain('/api/master-admin/windmill/status');
    expect(view).toContain('WINDMILL_BASE_URL');
  });

  it('missing values read UNKNOWN', () => {
    expect(view).toContain("'UNKNOWN'");
    expect(view).toContain("return 'UNKNOWN'");
  });
});

describe('5: reachable', () => {
  it('is mounted and present in navigation', () => {
    expect(appContent).toContain("activeTab === 'external-executions'");
    expect(appContent).toContain('<ExternalExecutionsView');
    expect(sidebar).toContain("id: 'external-executions' as ActiveTab");
  });
});
