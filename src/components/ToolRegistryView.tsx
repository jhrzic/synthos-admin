import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Wrench, RefreshCw, ShieldCheck, ShieldAlert, Eye, PenLine, Globe,
  Brain, Github, FolderOpen, CalendarClock, Search, AlertTriangle, Check, Mail, Box,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// TOOL PACK 1 — the production tool surface.
//
// Every value rendered here comes from GET /api/tools, which derives it from
// the canonical capability registry and the one tool manifest. This component
// computes NO status of its own. That is the point of the instruction not to
// hardcode UI status separately from registry truth: if the registry says a
// tool is NOT_CONFIGURED, this screen says NOT_CONFIGURED, and there is no
// local table that could drift away from it.
//
// It also renders no invented rows. Before the fetch resolves it says so;
// if the fetch fails it says UNKNOWN rather than drawing an empty table that
// reads as "no tools exist"; and a tool that has never been invoked shows an
// em-dash for Last Verified rather than a plausible timestamp.
// ---------------------------------------------------------------------------

type ToolStatus = 'AVAILABLE' | 'NOT_CONFIGURED' | 'UNSUPPORTED' | 'DEGRADED' | 'APPROVAL_REQUIRED';
type EffectClass = 'READ_ONLY' | 'INTERNAL_MUTATION' | 'EXTERNAL_ACTION';

interface ToolRow {
  capability: string;
  displayName: string;
  /**
   * Deliberately a plain string rather than a union of known categories.
   *
   * An earlier version enumerated them, and when Tool Pack 2 added `gmail` to
   * the manifest this screen could neither label nor filter it — the rows came
   * back from the API and the UI had no idea what they were. The registry is
   * the source of truth for what categories exist, so the view derives them
   * from the response instead of keeping a second list that can fall behind.
   */
  category: string;
  summary: string;
  runtime: string;
  status: ToolStatus;
  effectClass: EffectClass;
  riskTier: string;
  approvalPolicy: string;
  guardianEnforced: boolean;
  workspaceScope: string;
  brainWriteback: string;
  configured: boolean;
  enabled: boolean;
  missingConfiguration: string | null;
  reason: string;
  reference: string;
  lastInvokedAt: string | null;
  lastInvokedStatus: string | null;
}

interface ToolsSummary {
  available: number;
  notConfigured: number;
  readOnly: number;
  internalMutation: number;
  externalAction: number;
}

// Known icons. A category with no entry still renders, with a generic icon and
// its own name upper-cased — an unlabelled row is a UI gap, never a hidden tool.
const CATEGORY_ICON: Record<string, React.ElementType> = {
  brain: Brain,
  github: Github,
  files: FolderOpen,
  scheduler: CalendarClock,
  research: Globe,
  gmail: Mail,
};

function categoryIcon(category: string): React.ElementType {
  return CATEGORY_ICON[category] ?? Box;
}

function categoryLabel(category: string): string {
  return category.toUpperCase();
}

function statusColor(status: ToolStatus): string {
  switch (status) {
    case 'AVAILABLE': return '#00D26A';
    case 'DEGRADED': return '#F59E0B';
    case 'APPROVAL_REQUIRED': return '#A5A2FF';
    case 'UNSUPPORTED': return '#EF4444';
    default: return '#7E8BB5'; // NOT_CONFIGURED — steel: missing data recedes, it never glows
  }
}

function effectBadge(cls: EffectClass): { label: string; color: string; Icon: React.ElementType } {
  switch (cls) {
    case 'READ_ONLY': return { label: 'READ_ONLY', color: '#38BDF8', Icon: Eye };
    case 'INTERNAL_MUTATION': return { label: 'INTERNAL_MUTATION', color: '#F59E0B', Icon: PenLine };
    case 'EXTERNAL_ACTION': return { label: 'EXTERNAL_ACTION', color: '#EF4444', Icon: Globe };
  }
}

export const ToolRegistryView: React.FC<{ activeWorkspaceId?: string }> = () => {
  const [tools, setTools] = useState<ToolRow[] | null>(null);
  const [summary, setSummary] = useState<ToolsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tools');
      const body = await res.json();
      if (!res.ok || !body?.success) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setTools(Array.isArray(body.tools) ? body.tools : []);
      setSummary(body.summary ?? null);
      setError(null);
    } catch (err: any) {
      // Never a silent empty table: an unreadable registry is UNKNOWN, which
      // is a different fact from "there are no tools".
      setError(err?.message || String(err));
      setTools(null);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Derived from what the registry actually returned, in first-seen order.
  const categories = useMemo(() => {
    if (!tools) return [] as string[];
    return Array.from(new Set(tools.map((t) => t.category)));
  }, [tools]);

  const visible = useMemo(() => {
    if (!tools) return [];
    const needle = filter.trim().toLowerCase();
    return tools.filter((t) => {
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
      if (!needle) return true;
      return (
        t.capability.toLowerCase().includes(needle) ||
        t.displayName.toLowerCase().includes(needle) ||
        t.summary.toLowerCase().includes(needle)
      );
    });
  }, [tools, filter, categoryFilter]);

  const countLabel = tools === null ? 'UNKNOWN' : String(tools.length);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-[#F3F4F9] flex items-center gap-2">
            <Wrench size={18} style={{ color: '#615EFF' }} />
            Tool Registry ({countLabel})
          </h2>
          <p className="text-[11px] text-[#9C97B4] mt-1 max-w-3xl font-mono">
            Production tools exposed through the Execution Fabric. Status, effect class and approval
            policy are read from the canonical capability registry — this screen holds no state of its own.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-[11px] border border-white/[.085] bg-white/[.035] hover:bg-white/[.055] text-[10px] font-mono uppercase tracking-wider text-[#F3F4F9] disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Reading registry' : 'Refresh'}
        </button>
      </div>

      {/* Summary — real counts only, hidden entirely when unknown */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {[
            { label: 'Available', value: summary.available, color: '#00D26A' },
            { label: 'Not Configured', value: summary.notConfigured, color: '#7E8BB5' },
            { label: 'Read Only', value: summary.readOnly, color: '#38BDF8' },
            { label: 'Internal Mutation', value: summary.internalMutation, color: '#F59E0B' },
            { label: 'External Action', value: summary.externalAction, color: '#EF4444' },
          ].map((s) => (
            <div key={s.label} className="rounded-[11px] border border-white/[.085] bg-white/[.035] px-3 py-2">
              <div className="text-[9px] font-mono uppercase tracking-wider text-[#9C97B4]">{s.label}</div>
              <div className="text-xl font-semibold mt-0.5" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#665F85]" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tools…"
            className="w-full pl-8 pr-3 py-1.5 rounded-[11px] border border-white/[.085] bg-white/[.035] text-[11px] text-[#F3F4F9] placeholder:text-[#665F85] font-mono focus:outline-none focus:border-[#615EFF]/50"
          />
        </div>
        {['all', ...categories].map((c) => (
          <button
            key={c}
            onClick={() => setCategoryFilter(c)}
            className={`px-2.5 py-1.5 rounded-[11px] border text-[9px] font-mono uppercase tracking-wider transition-colors ${
              categoryFilter === c
                ? 'border-[#615EFF]/60 bg-[#615EFF]/15 text-[#F3F4F9]'
                : 'border-white/[.085] bg-white/[.035] text-[#9C97B4] hover:bg-white/[.055]'
            }`}
          >
            {c === 'all' ? 'ALL' : categoryLabel(c)}
          </button>
        ))}
      </div>

      {/* Error — explicit, not an empty table */}
      {error && (
        <div className="rounded-[11px] border border-[#EF4444]/30 bg-[#EF4444]/[.08] px-3 py-2.5 flex items-start gap-2">
          <AlertTriangle size={14} className="text-[#EF4444] mt-0.5 shrink-0" />
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-[#EF4444]">Registry unreadable — UNKNOWN</div>
            <div className="text-[11px] text-[#9C97B4] mt-0.5 font-mono">{error}</div>
          </div>
        </div>
      )}

      {loading && tools === null && !error && (
        <div className="text-[11px] font-mono text-[#665F85] px-1">Reading the capability registry…</div>
      )}

      {/* Table */}
      {tools !== null && (
        <div className="overflow-x-auto rounded-[14px] border border-white/[.085]">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-white/[.035]">
                {['Tool', 'Category', 'Runtime', 'Status', 'Effect Class', 'Guardian', 'Approval', 'Last Verified'].map((h) => (
                  <th key={h} className="px-3 py-2 text-[9px] font-mono uppercase tracking-wider text-[#9C97B4] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-[11px] font-mono text-[#665F85]">
                    {tools.length === 0
                      ? 'No tools are registered.'
                      : 'No tools match this filter.'}
                  </td>
                </tr>
              )}
              {visible.map((t) => {
                const CatIcon = categoryIcon(t.category);
                const badge = effectBadge(t.effectClass);
                return (
                  <tr key={t.capability} className="border-t border-white/[.055] hover:bg-white/[.02] align-top">
                    <td className="px-3 py-2.5">
                      <div className="text-[12px] text-[#F3F4F9] font-medium">{t.displayName}</div>
                      <div className="text-[10px] font-mono text-[#615EFF] mt-0.5">{t.capability}</div>
                      <div className="text-[10px] text-[#9C97B4] mt-1 max-w-md leading-relaxed">{t.summary}</div>
                      {t.missingConfiguration && (
                        <div className="text-[10px] font-mono text-[#F59E0B] mt-1">
                          Needs: {t.missingConfiguration}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-[#9C97B4]">
                        <CatIcon size={12} />
                        {categoryLabel(t.category)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[10px] font-mono text-[#9C97B4] whitespace-nowrap">{t.runtime}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className="inline-block px-2 py-0.5 rounded-[20px] text-[9px] font-mono uppercase tracking-wider whitespace-nowrap"
                        style={{ color: statusColor(t.status), backgroundColor: `${statusColor(t.status)}1A` }}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[20px] text-[9px] font-mono uppercase tracking-wider whitespace-nowrap"
                        style={{ color: badge.color, backgroundColor: `${badge.color}1A` }}
                      >
                        <badge.Icon size={10} />
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {t.guardianEnforced ? (
                        <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-[#00D26A]">
                          <ShieldCheck size={12} /> ENFORCED
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-[#7E8BB5]">
                          <ShieldAlert size={12} /> N/A — READ ONLY
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[9px] font-mono uppercase tracking-wider text-[#9C97B4] whitespace-nowrap">
                      {t.approvalPolicy}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {t.lastInvokedAt ? (
                        <div>
                          <div className="text-[10px] font-mono text-[#F3F4F9]">{new Date(t.lastInvokedAt).toISOString().replace('T', ' ').slice(0, 19)}</div>
                          <div
                            className="text-[9px] font-mono uppercase tracking-wider mt-0.5 inline-flex items-center gap-1"
                            style={{ color: t.lastInvokedStatus === 'SUCCESS' ? '#00D26A' : '#F59E0B' }}
                          >
                            {t.lastInvokedStatus === 'SUCCESS' ? <Check size={10} /> : <AlertTriangle size={10} />}
                            {t.lastInvokedStatus}
                          </div>
                        </div>
                      ) : (
                        // Never invoked. An em-dash, not a fabricated timestamp.
                        <span className="text-[10px] font-mono text-[#665F85]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* The writeback policy, stated on the surface rather than buried in code */}
      {tools !== null && tools.length > 0 && (
        <div className="rounded-[11px] border border-white/[.085] bg-white/[.02] px-3 py-2.5">
          <div className="text-[9px] font-mono uppercase tracking-wider text-[#9C97B4]">Brain writeback policy — observation is not knowledge</div>
          <div className="text-[10px] text-[#9C97B4] mt-1.5 leading-relaxed font-mono">
            Tool output does not become canonical knowledge. Read-only tools return observations
            ({tools.filter((t) => t.brainWriteback === 'NONE').length} tools, writeback NONE);
            {' '}artifact writers produce evidence of work, not approved knowledge;
            {' '}and <span className="text-[#F3F4F9]">brain.write_session_note</span> is the single explicitly
            authorized internal writeback, confined to the SynthOS/ subtree.
          </div>
        </div>
      )}
    </div>
  );
};
