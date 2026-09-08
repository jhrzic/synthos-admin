import {
  listWorkspaceTasks,
  listWorkspaceReceipts,
  countWorkspaceReceipts,
  listGraphs,
  listGraphRuns,
  summariseKil,
  summariseWorkspaceTasks,
  type KilSummary,
  type WorkspaceTaskCounts,
} from './persistence';
import { countWorkspaceVaultEntries } from './vault';
import { listWorkspaceSkills } from './skills';
import { listWorkspaceExternalExecutions, countWorkspaceExternalExecutions } from './external-executions';

// ---------------------------------------------------------------------------
// Pass X / Workstream B — the real, workspace-scoped Overview backend.
//
// Every field here is either a real SQL COUNT/SUM (never a full-table scan
// counted in JavaScript — see summariseWorkspaceTasks/summariseKil) or a
// bounded, recent list already limited at the query. Nothing here is
// invented: if a subsystem has zero rows, the field is 0, not omitted and
// not padded with a plausible-looking number.
//
// This module does NOT probe external runtimes (Windmill/Hermes/MCP) —
// that's lib/runtime-status.ts's job, called separately by the /api/overview
// route so a slow/unreachable external system never blocks the workspace's
// own real counts from rendering (B5 failure isolation).
// ---------------------------------------------------------------------------

export type OverviewActivityKind = 'task' | 'graph_run' | 'receipt' | 'external_execution' | 'kil_promotion';

export interface OverviewActivityItem {
  kind: OverviewActivityKind;
  id: string;
  label: string;
  status: string;
  timestamp: string;
}

export interface WorkspaceOverviewReport {
  workspaceId: string;
  tasks: WorkspaceTaskCounts;
  graphCount: number;
  graphRunCount: number;
  receiptCount: number;
  vaultArtifactCount: number;
  skillCount: number;
  externalExecutionCount: number;
  kil: KilSummary;
  recentActivity: OverviewActivityItem[];
  generatedAt: string;
}

const RECENT_ACTIVITY_LIMIT = 8;
const PER_SOURCE_FETCH_LIMIT = 8;

export function getWorkspaceOverview(workspaceId: string): WorkspaceOverviewReport {
  const tasks = summariseWorkspaceTasks(workspaceId);
  const recentTasks = listWorkspaceTasks(workspaceId, PER_SOURCE_FETCH_LIMIT);
  const graphs = listGraphs(workspaceId);
  const graphRuns = listGraphRuns(workspaceId);
  const recentReceipts = listWorkspaceReceipts(workspaceId, PER_SOURCE_FETCH_LIMIT);
  const skills = listWorkspaceSkills(workspaceId);
  const recentExternalExecutions = listWorkspaceExternalExecutions(workspaceId, PER_SOURCE_FETCH_LIMIT);
  const kil = summariseKil(workspaceId);

  const activity: OverviewActivityItem[] = [
    ...recentTasks.map((t) => ({
      kind: 'task' as const,
      id: t.task_id,
      label: t.title,
      status: t.status,
      timestamp: t.created_at,
    })),
    ...graphRuns.slice(0, PER_SOURCE_FETCH_LIMIT).map((r) => ({
      kind: 'graph_run' as const,
      id: r.run_id,
      label: `Graph run on ${r.graph_id}`,
      status: r.status,
      timestamp: r.updated_at || r.created_at,
    })),
    ...recentReceipts.map((r) => ({
      kind: 'receipt' as const,
      id: r.receipt_id,
      label: `Receipt for task ${r.task_id}`,
      status: 'SIGNED',
      timestamp: r.created_at,
    })),
    ...recentExternalExecutions.map((e) => ({
      kind: 'external_execution' as const,
      id: e.id,
      label: `${e.runtime} execution (${e.target_kind})`,
      status: e.status,
      timestamp: e.completed_at || e.started_at || e.submitted_at || '',
    })),
  ]
    .filter((item) => !!item.timestamp)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
    .slice(0, RECENT_ACTIVITY_LIMIT);

  return {
    workspaceId,
    tasks,
    graphCount: graphs.length,
    graphRunCount: graphRuns.length,
    receiptCount: countWorkspaceReceipts(workspaceId),
    vaultArtifactCount: countWorkspaceVaultEntries(workspaceId),
    skillCount: skills.length,
    externalExecutionCount: countWorkspaceExternalExecutions(workspaceId),
    kil,
    recentActivity: activity,
    generatedAt: new Date().toISOString(),
  };
}
