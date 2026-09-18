// ---------------------------------------------------------------------------
// AGENT ROSTER — recorded facts only.
//
// SynthOS has no agent registry: an agent is the role string a task is
// assigned to (tasks.assigned_agent; see the note in lib/persistence.ts).
// So the roster is every role the canonical task record has actually
// assigned work to, with what that record can prove — task counts by stage,
// successes/failures, models used, last activity, recent tasks. Tier,
// capabilities, skills, tools, routing requirements, contracts and approval
// policy are NOT RECORDED for any agent and are returned as null. No
// persona, statistic, health or activity is invented.
// ---------------------------------------------------------------------------

import { getDatabase } from './persistence';
import { stageOf, type BoardStage } from './task-board';

export interface ObservedAgent {
  agentId: string;
  kind: 'AGENT_ROLE' | 'TOOL' | 'HUMAN';
  workspaceId: string;
  source: 'CANONICAL_TASK_RECORD';
  taskCount: number;
  byStage: Partial<Record<BoardStage, number>>;
  succeeded: number;
  failed: number;
  modelsUsed: string[];
  firstSeenAt: string;
  lastActivityAt: string;
  recentTasks: Array<{ taskId: string; title: string; status: string; updatedAt: string; assignedModel: string | null }>;
  // Not recorded anywhere in SynthOS today:
  name: null; tier: null; capabilities: null; assignedSkills: null; allowedTools: null;
  routingRequirements: null; outputContracts: null; approvalPolicy: null; enabled: null;
}

export const NOT_RECORDED_FIELDS = ['name', 'tier', 'capabilities', 'assignedSkills', 'allowedTools', 'routingRequirements', 'outputContracts', 'approvalPolicy', 'enabled'] as const;

const kindOf = (role: string): ObservedAgent['kind'] => (role.startsWith('tool:') ? 'TOOL' : role === 'human' || role === 'operator' ? 'HUMAN' : 'AGENT_ROLE');

export function listObservedAgents(workspaceId: string): ObservedAgent[] {
  const db = getDatabase();
  const rows = db.prepare("SELECT task_id, title, status, assigned_agent, assigned_model, created_at, updated_at FROM tasks WHERE workspace_id = ? AND assigned_agent IS NOT NULL AND assigned_agent != '' ORDER BY updated_at DESC").all(workspaceId) as any[];
  const by = new Map<string, any[]>();
  for (const r of rows) { if (!by.has(r.assigned_agent)) by.set(r.assigned_agent, []); by.get(r.assigned_agent)!.push(r); }
  return [...by.entries()].map(([role, ts]) => {
    const byStage: Partial<Record<BoardStage, number>> = {};
    for (const t of ts) { const s = stageOf(t.status); byStage[s] = (byStage[s] ?? 0) + 1; }
    const models = [...new Set(ts.map((t) => t.assigned_model).filter((m) => m && m !== 'n/a' && m !== 'multi'))].sort();
    return {
      agentId: role, kind: kindOf(role), workspaceId, source: 'CANONICAL_TASK_RECORD' as const, taskCount: ts.length, byStage,
      succeeded: byStage.DONE ?? 0, failed: byStage.FAILED ?? 0, modelsUsed: models,
      firstSeenAt: ts.map((t) => t.created_at).sort()[0], lastActivityAt: ts.map((t) => t.updated_at).sort().at(-1)!,
      recentTasks: ts.slice(0, 8).map((t) => ({ taskId: t.task_id, title: t.title, status: t.status, updatedAt: t.updated_at, assignedModel: t.assigned_model ?? null })),
      name: null, tier: null, capabilities: null, assignedSkills: null, allowedTools: null, routingRequirements: null, outputContracts: null, approvalPolicy: null, enabled: null,
    };
  }).sort((a, b) => b.taskCount - a.taskCount || a.agentId.localeCompare(b.agentId));
}
