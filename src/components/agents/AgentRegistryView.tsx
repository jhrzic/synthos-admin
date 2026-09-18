import React, { useCallback, useEffect, useState } from 'react';
import { Bot, RefreshCw } from 'lucide-react';
import { Badge, TaskStatusBadge } from '../verification/outcome';

// ---------------------------------------------------------------------------
// AGENT REGISTRY — recorded facts only (GET /api/agents, lib/agent-roster.ts).
//
// SynthOS has no agent registry yet: an agent is the role a task was assigned
// to. This view lists every role the canonical task record has assigned work
// to, with counts it can prove. Everything else is NOT RECORDED. The earlier
// hardcoded personas (invented stats, "ONLINE" health, persona prose) are not
// rendered in production.
//
// Agent Detail: #/agents/<role> selects an agent (read from the hash).
// ---------------------------------------------------------------------------

interface Agent {
  agentId: string; kind: string; workspaceId: string; source: string; taskCount: number; byStage: Record<string, number>;
  succeeded: number; failed: number; modelsUsed: string[]; firstSeenAt: string; lastActivityAt: string;
  recentTasks: Array<{ taskId: string; title: string; status: string; updatedAt: string; assignedModel: string | null }>;
}

const NOT_RECORDED_LABELS: Array<[string, string]> = [
  ['Name', 'name'], ['Tier', 'tier'], ['Capabilities', 'capabilities'], ['Assigned skills', 'assignedSkills'], ['Allowed tools', 'allowedTools'],
  ['Model-routing requirements', 'routingRequirements'], ['Output contracts', 'outputContracts'], ['Approval policy', 'approvalPolicy'], ['Enabled', 'enabled'],
];

const roleFromHash = () => { try { const m = /^#\/agents\/([^/?#]+)$/.exec(window.location.hash); return m ? decodeURIComponent(m[1]) : null; } catch { return null; } };

export const AgentRegistryView: React.FC<{ workspaceId: string; onOpenSkills?: () => void; onOpenTasks?: () => void }> = ({ workspaceId, onOpenSkills, onOpenTasks }) => {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(roleFromHash);

  const load = useCallback(() => {
    setError(null);
    fetch(`/api/agents?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok || !j?.success || !Array.isArray(j.agents)) { setError(j?.error || `HTTP ${r.status}`); setAgents(null); return; } setAgents(j.agents); })
      .catch((e) => { setError(String(e?.message || e)); setAgents(null); });
  }, [workspaceId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const on = () => setSel(roleFromHash()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);

  const choose = (id: string | null) => {
    setSel(id);
    try { window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${id ? `#/agents/${encodeURIComponent(id)}` : '#/agents'}`); } catch { /* no history */ }
  };
  const agent = agents?.find((a) => a.agentId === sel) ?? null;

  return (
    <div className="space-y-4" data-testid="agent-registry">
      <div className="flex flex-wrap items-center gap-3">
        <Bot className="w-5 h-5 text-[#EAB308]" />
        <h1 className="text-lg font-bold text-white">Agent Registry</h1>
        <Badge tone="inert">FROM THE CANONICAL TASK RECORD</Badge>
        <button onClick={load} className="p-1.5 rounded-lg border border-[#2D3352] text-[#8E94B8]" aria-label="Refresh agents"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>
      <p className="text-xs text-[#8E94B8] max-w-3xl" data-testid="agent-registry-authority">
        SynthOS has no agent registry: an agent is the role a task was assigned to. Listed here is every role the task record has actually assigned work to, with what that record proves. Tier, capabilities, skills, tools, routing requirements, output contracts, approval policy and enabled state are not recorded for any agent.
      </p>

      {error ? (
        <div className="p-8 text-center text-[#FF6B6B] border border-[#FF6B6B]/30 rounded-xl" data-testid="agent-registry-unavailable">Agents are UNAVAILABLE: {error}. This is not an empty roster.</div>
      ) : !agents ? (
        <div className="p-8 text-center text-[#8E94B8]">Loading…</div>
      ) : agents.length === 0 ? (
        <div className="p-8 text-center text-[#8E94B8]" data-testid="agent-registry-empty">No task in this workspace has been assigned to an agent, so there is nothing to list.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="space-y-1.5" data-testid="agent-list">
            {agents.map((a) => (
              <button key={a.agentId} onClick={() => choose(a.agentId)} data-testid="agent-row" aria-current={sel === a.agentId ? 'true' : undefined}
                className={`w-full text-left p-2.5 rounded-xl border ${sel === a.agentId ? 'border-[#615EFF] bg-[#10122A]' : 'border-[#1C2038] bg-[#05060C]'} hover:border-[#615EFF]`}>
                <div className="flex items-center gap-2"><span className="text-white text-sm font-mono">{a.agentId}</span><Badge tone="inert">{a.kind}</Badge></div>
                <div className="text-[10px] font-mono text-[#8E94B8] mt-0.5">{a.taskCount} task(s) · {a.succeeded} done · {a.failed} failed · last {a.lastActivityAt.slice(0, 16)}</div>
              </button>
            ))}
          </div>
          <div data-testid="agent-detail">
            {!agent ? (
              <div className="p-6 text-sm text-[#8E94B8] border border-[#1C2038] rounded-xl">{sel ? `No task in this workspace is assigned to "${sel}".` : 'Select an agent to see its recorded facts.'}</div>
            ) : (
              <div className="p-4 border border-[#1C2038] rounded-xl bg-[#05060C] space-y-3">
                <div className="flex items-center gap-2"><span className="text-white font-mono text-base">{agent.agentId}</span><Badge tone="inert">{agent.kind}</Badge><Badge tone="inert">workspace {agent.workspaceId}</Badge></div>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[11px] font-mono text-[#C9CCE6]" data-testid="agent-detail-fields">
                  <dt className="text-[#6A7097]">Agent ID / role</dt><dd>{agent.agentId}</dd>
                  <dt className="text-[#6A7097]">Tasks</dt><dd>{agent.taskCount} · {Object.entries(agent.byStage).map(([k, v]) => `${k} ${v}`).join(' · ')}</dd>
                  <dt className="text-[#6A7097]">Succeeded / failed</dt><dd>{agent.succeeded} / {agent.failed} (from task status)</dd>
                  <dt className="text-[#6A7097]">Models used</dt><dd>{agent.modelsUsed.length ? agent.modelsUsed.join(', ') : 'none recorded'}</dd>
                  <dt className="text-[#6A7097]">First / last activity</dt><dd>{agent.firstSeenAt} · {agent.lastActivityAt}</dd>
                  {NOT_RECORDED_LABELS.map(([label]) => (<React.Fragment key={label}><dt className="text-[#6A7097]">{label}</dt><dd className="text-[#6A7097]">NOT RECORDED</dd></React.Fragment>))}
                </dl>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  {onOpenSkills && <button className="px-2 py-1 rounded-md border border-[#2D3352] text-[#C9CCE6]" onClick={onOpenSkills}>Skills registry (no skill is assigned to agents)</button>}
                  {onOpenTasks && <button className="px-2 py-1 rounded-md border border-[#2D3352] text-[#C9CCE6]" onClick={onOpenTasks}>All tasks</button>}
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase text-[#6A7097] mb-1">Recent real tasks</div>
                  <ul className="space-y-1" data-testid="agent-recent-tasks">
                    {agent.recentTasks.map((t) => (
                      <li key={t.taskId} className="text-[11px] text-[#C9CCE6] flex flex-wrap gap-2 items-center"><TaskStatusBadge status={t.status} /><span className="truncate max-w-[22rem]">{t.title}</span><span className="font-mono text-[#6A7097]">{t.updatedAt.slice(0, 16)} · {t.assignedModel ?? 'no model'}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
