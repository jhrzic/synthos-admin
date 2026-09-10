import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Globe, RefreshCw, Loader2, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, FileCheck, Clock, Zap, ListChecks, Target, HelpCircle, Play
} from 'lucide-react';

// ---------------------------------------------------------------------------
// AEO / GEO / SEO AUDIT
//
// Everything shown here comes from POST /api/aeo/audit, which performs a real
// HTTP crawl of the entered domain. There is no demo mode and no sample audit.
//
// Two honesty rules the UI must uphold:
//   1. A dimension whose score is null renders UNKNOWN — never 0, never a
//      filler bar. `null` means "no applicable check could be evaluated".
//   2. GEO (AI visibility) is only shown as measured when a provider was
//      actually queried. Otherwise the panel states that no claim is being
//      made about ChatGPT / Perplexity / Gemini visibility.
// ---------------------------------------------------------------------------

type CheckStatus = 'pass' | 'fail' | 'warn' | 'not_applicable' | 'unknown';
type Severity = 'critical' | 'high' | 'medium' | 'low';

interface Check {
  id: string;
  dimension: 'seo' | 'aeo' | 'geo';
  title: string;
  status: CheckStatus;
  severity: Severity;
  evidence: string;
  recommendation?: string;
  effort?: 'quick_win' | 'standard' | 'project';
  category?: string;
}

interface DimensionScore { score: number | null; passed: number; applicable: number; formula: string; unknownReason?: string; }

interface Analysis {
  domain: string; origin: string; generatedAt: string;
  crawl: { pagesAnalyzed: number; pagesFailed: number; durationMs: number };
  checks: Check[];
  scores: { seo: DimensionScore; aeo: DimensionScore; geo: DimensionScore; overall: DimensionScore };
  sourcesUsed: { source: string; status: string; detail: string }[];
  competitors: { host: string; basis: string }[];
  unknowns: string[];
  summary: {
    topProblems: Check[]; topOpportunities: Check[]; quickWins: Check[];
    technicalFixes: Check[]; contentOpportunities: Check[]; localActions: Check[]; aeoGeoActions: Check[];
  };
}

interface AuditResult {
  taskId: string;
  artifact: { id: string; path: string; contentHash: string };
  aegis: { decision: string; score: number | null; reviewId: string };
  receiptId: string | null;
  analysis: Analysis;
  report: string;
}

interface HistoryRow {
  artifactId: string; taskId: string; path: string; createdAt: string;
  domain: string | null; businessName: string | null;
  scoreSeo: number | null; scoreAeo: number | null; scoreGeo: number | null; scoreOverall: number | null;
  pagesAnalyzed: number | null;
}

interface AeoAuditViewProps { activeWorkspaceId?: string; }

const SEV_STYLE: Record<Severity, string> = {
  critical: 'bg-[#FF6B6B]/10 border-[#FF6B6B]/40 text-[#FF6B6B]',
  high: 'bg-[#E8A845]/10 border-[#E8A845]/40 text-[#E8A845]',
  medium: 'bg-[#38BDF8]/10 border-[#38BDF8]/40 text-[#38BDF8]',
  low: 'bg-[#7E8BB5]/10 border-[#7E8BB5]/40 text-[#7E8BB5]',
};

const ScoreTile: React.FC<{ label: string; d?: DimensionScore }> = ({ label, d }) => {
  const known = d && d.score !== null;
  return (
    <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl">
      <span className="text-[10px] text-[#6A7097] uppercase tracking-wider block">{label}</span>
      <span className={`text-2xl font-extrabold mt-0.5 block ${known ? 'text-white' : 'text-[#7E8BB5]'}`}>
        {known ? `${d!.score}` : 'UNKNOWN'}
        {known && <span className="text-xs text-[#6A7097] font-normal">/100</span>}
      </span>
      <span className="text-[10px] text-[#7B82A8] block mt-0.5">
        {known ? `${d!.passed}/${d!.applicable} checks passed` : (d?.unknownReason ? 'not measured' : '—')}
      </span>
    </div>
  );
};

export const AeoAuditView: React.FC<AeoAuditViewProps> = ({ activeWorkspaceId }) => {
  const workspaceId = activeWorkspaceId || 'ws-synthos-primary';

  const [domain, setDomain] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [location, setLocation] = useState('');
  const [targetService, setTargetService] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(`/api/aeo/audits?workspaceId=${encodeURIComponent(workspaceId)}`);
      const d = await r.json().catch(() => null);
      if (r.ok && d?.success) setHistory(d.audits || []);
    } catch { /* history is non-critical */ }
  }, [workspaceId]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const runAudit = useCallback(async () => {
    if (!domain.trim()) { setError('Enter a domain or URL.'); return; }
    setRunning(true); setError(null); setResult(null); setNotice(null); setSelected({});
    try {
      const r = await fetch('/api/aeo/audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId, domain: domain.trim(),
          businessName: businessName.trim() || undefined,
          location: location.trim() || undefined,
          targetService: targetService.trim() || undefined,
          maxPages: 12,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.success) {
        setError(d?.error || `Audit failed (HTTP ${r.status})${d?.reason ? ` — ${d.reason}` : ''}`);
      } else {
        setResult(d);
        await loadHistory();
      }
    } catch (err: any) {
      setError(err?.message || 'Network error contacting the audit API.');
    } finally {
      setRunning(false);
    }
  }, [domain, businessName, location, targetService, workspaceId, loadHistory]);

  const actionable = result ? result.analysis.checks.filter((c) => c.recommendation) : [];

  const createMission = useCallback(async () => {
    if (!result) return;
    const items = actionable.filter((c) => selected[c.id]).map((c) => ({
      title: c.title, recommendation: c.recommendation, evidence: c.evidence, category: c.category,
    }));
    if (items.length === 0) { setNotice('Select at least one recommendation first.'); return; }
    try {
      const r = await fetch('/api/aeo/missions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, auditTaskId: result.taskId, domain: result.analysis.origin, items }),
      });
      const d = await r.json().catch(() => null);
      setNotice(r.ok && d?.success ? `Created ${d.count} real SynthOS task(s) from this audit.` : `FAILED — ${d?.error || `HTTP ${r.status}`}`);
    } catch (err: any) {
      setNotice(`FAILED — ${err?.message || 'network error'}`);
    }
  }, [result, actionable, selected, workspaceId]);

  const scheduleRecheck = useCallback(async (days: number) => {
    if (!result) return;
    setScheduling(true); setNotice(null);
    try {
      const r = await fetch('/api/schedules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId, capability: 'aeo.audit', action: 'aeo.audit',
          parameters: { domain: result.analysis.origin, businessName: businessName || undefined },
          rawText: `Re-audit ${result.analysis.origin} every ${days} days`,
          when: `every ${days} days`,
        }),
      });
      const d = await r.json().catch(() => null);
      setNotice(r.ok && d?.success
        ? `Recheck scheduled every ${days} days (next run ${d.schedule?.next_run_at || 'UNKNOWN'}).`
        : `FAILED — ${d?.error || `HTTP ${r.status}`}`);
    } catch (err: any) {
      setNotice(`FAILED — ${err?.message || 'network error'}`);
    } finally { setScheduling(false); }
  }, [result, workspaceId, businessName]);

  const a = result?.analysis;

  return (
    <div className="space-y-6 font-mono pb-12">
      <div className="bg-gradient-to-r from-[#20B2AA]/15 via-[#0B0D1B] to-[#615EFF]/15 border border-[#20B2AA]/40 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#20B2AA]/20 border border-[#20B2AA]/50 flex items-center justify-center text-[#20B2AA] shrink-0">
            <Globe className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight font-['Space_Grotesk']">SEO / AEO / GEO Audit</h1>
            <p className="text-xs text-[#8E94B8] mt-1 font-sans">
              Live crawl-based audit · Workspace: <span className="text-white">{workspaceId}</span>
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 border-t border-[#20B2AA]/20 pt-4">
          <input value={domain} onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !running) void runAudit(); }}
            placeholder="domain or URL (required)"
            className="bg-[#090A16] border border-[#1E223D] rounded-xl px-3 py-2 text-xs text-white placeholder-[#4C5274] focus:outline-none focus:border-[#20B2AA]" />
          <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="business name (optional)"
            className="bg-[#090A16] border border-[#1E223D] rounded-xl px-3 py-2 text-xs text-white placeholder-[#4C5274] focus:outline-none focus:border-[#20B2AA]" />
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="location (optional)"
            className="bg-[#090A16] border border-[#1E223D] rounded-xl px-3 py-2 text-xs text-white placeholder-[#4C5274] focus:outline-none focus:border-[#20B2AA]" />
          <input value={targetService} onChange={(e) => setTargetService(e.target.value)} placeholder="target service (optional)"
            className="bg-[#090A16] border border-[#1E223D] rounded-xl px-3 py-2 text-xs text-white placeholder-[#4C5274] focus:outline-none focus:border-[#20B2AA]" />
        </div>

        <button onClick={() => void runAudit()} disabled={running}
          className="px-4 py-2 rounded-xl bg-[#20B2AA] text-black font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {running ? 'CRAWLING LIVE SITE…' : 'RUN AUDIT'}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-[#FF6B6B]/10 border border-[#FF6B6B]/40 rounded-xl text-xs text-[#FF6B6B] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div><div className="font-bold uppercase">Audit failed</div><div className="text-[#C98B8B] mt-0.5">{error}</div></div>
        </div>
      )}
      {notice && (
        <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${notice.startsWith('FAILED') ? 'bg-[#FF6B6B]/10 border border-[#FF6B6B]/40 text-[#FF6B6B]' : 'bg-[#00D26A]/10 border border-[#00D26A]/40 text-[#00D26A]'}`}>
          <CheckCircle2 className="w-4 h-4" /> {notice}
        </div>
      )}

      {a && result && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <ScoreTile label="Traditional SEO" d={a.scores.seo} />
            <ScoreTile label="AEO — answer readiness" d={a.scores.aeo} />
            <ScoreTile label="GEO — AI visibility" d={a.scores.geo} />
            <ScoreTile label="Overall" d={a.scores.overall} />
          </div>

          <div className="p-3 bg-[#080A16] border border-[#1F2442] rounded-xl text-[10px] text-[#6A7097] leading-relaxed">
            <span className="font-bold text-[#8E94B8]">Score formula: </span>{a.scores.overall.formula}
            {a.scores.geo.unknownReason && (
              <div className="mt-1 text-[#E8A845]"><span className="font-bold">GEO is UNKNOWN — </span>{a.scores.geo.unknownReason}</div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Pages crawled" value={String(a.crawl.pagesAnalyzed)} sub={`${a.crawl.pagesFailed} failed · ${a.crawl.durationMs}ms`} />
            <Stat label="Checks evaluated" value={String(a.checks.length)} sub="from live evidence" />
            <Stat label="Aegis" value={result.aegis.decision} sub={result.aegis.score !== null ? `score ${result.aegis.score}` : 'no score'} />
            <Stat label="Receipt" value={result.receiptId ? 'SIGNED' : 'NONE'} sub={result.receiptId || 'not issued'} />
          </div>

          <Panel title="Sources used" icon={ListChecks}>
            {a.sourcesUsed.map((s) => (
              <div key={s.source} className="flex items-start gap-2 text-[11px] py-0.5">
                <span className={`font-bold shrink-0 ${s.status === 'USED' ? 'text-[#00D26A]' : 'text-[#7E8BB5]'}`}>{s.status}</span>
                <span className="text-white shrink-0">{s.source}</span>
                <span className="text-[#6A7097] truncate">— {s.detail}</span>
              </div>
            ))}
          </Panel>

          {a.unknowns.length > 0 && (
            <Panel title="Unknown / unverified — no claim made" icon={HelpCircle} tone="#E8A845">
              {a.unknowns.map((u, i) => <div key={i} className="text-[11px] text-[#C9A05E] py-0.5">• {u}</div>)}
            </Panel>
          )}

          <Panel title="Competitor gap" icon={Target}>
            {a.competitors.length
              ? a.competitors.map((c) => <div key={c.host} className="text-[11px] py-0.5"><span className="text-white font-bold">{c.host}</span> <span className="text-[#6A7097]">— {c.basis}</span></div>)
              : <div className="text-[11px] text-[#6A7097]">No competitor set derived. Competitor discovery requires a search or AI provider; none is configured.</div>}
          </Panel>

          {/* ---- Findings by dimension ---- */}
          {(['seo', 'aeo', 'geo'] as const).map((dim) => {
            const list = a.checks.filter((c) => c.dimension === dim);
            if (list.length === 0) return null;
            const labels = { seo: 'Traditional SEO', aeo: 'AEO — answer readiness', geo: 'GEO — AI visibility' };
            return (
              <div key={dim} className="border border-[#1F2442] rounded-2xl bg-[#080A16] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#1F2442] text-[10px] font-bold uppercase tracking-wider text-white">
                  {labels[dim]} <span className="text-[#6A7097] ml-1">({list.length})</span>
                </div>
                {list.map((c) => {
                  const open = expanded === c.id;
                  const Icon = c.status === 'pass' ? CheckCircle2 : c.status === 'fail' ? XCircle : AlertTriangle;
                  const tone = c.status === 'pass' ? 'text-[#00D26A]' : c.status === 'fail' ? 'text-[#FF6B6B]' : c.status === 'warn' ? 'text-[#E8A845]' : 'text-[#7E8BB5]';
                  return (
                    <div key={c.id} className="border-b border-[#141628] last:border-0">
                      <div className="flex items-center gap-2 px-4 py-2">
                        {c.recommendation && (
                          <input type="checkbox" checked={!!selected[c.id]}
                            onChange={(e) => setSelected((p) => ({ ...p, [c.id]: e.target.checked }))}
                            title="Include in mission" className="cursor-pointer shrink-0" />
                        )}
                        <button onClick={() => setExpanded(open ? null : c.id)} className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer">
                          {open ? <ChevronDown className="w-3.5 h-3.5 text-[#6A7097] shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-[#6A7097] shrink-0" />}
                          <Icon className={`w-3.5 h-3.5 shrink-0 ${tone}`} />
                          <span className="text-[11px] text-white truncate flex-1">{c.title}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border shrink-0 ${SEV_STYLE[c.severity]}`}>{c.severity}</span>
                          {c.effort === 'quick_win' && <Zap className="w-3 h-3 text-[#00D26A] shrink-0" />}
                        </button>
                      </div>
                      {open && (
                        <div className="px-4 pb-3 pl-11 space-y-1">
                          <div className="text-[11px] text-[#8E94B8]"><span className="text-[#6A7097]">Evidence: </span>{c.evidence}</div>
                          {c.recommendation && <div className="text-[11px] text-[#A5A2FF]"><span className="text-[#6A7097]">Action: </span>{c.recommendation}</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-2 p-4 border border-[#1F2442] rounded-2xl bg-[#080A16]">
            <button onClick={() => void createMission()}
              className="px-3 py-2 rounded-xl bg-[#615EFF] text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer">
              <Play className="w-3.5 h-3.5" /> CREATE MISSION ({actionable.filter((c) => selected[c.id]).length})
            </button>
            <button onClick={() => void scheduleRecheck(7)} disabled={scheduling}
              className="px-3 py-2 rounded-xl bg-[#0B0D1B] border border-[#EC4899]/40 text-[#EC4899] font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
              <Clock className="w-3.5 h-3.5" /> RECHECK EVERY 7 DAYS
            </button>
            <button onClick={() => void scheduleRecheck(30)} disabled={scheduling}
              className="px-3 py-2 rounded-xl bg-[#0B0D1B] border border-[#EC4899]/40 text-[#EC4899] font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
              <Clock className="w-3.5 h-3.5" /> RECHECK EVERY 30 DAYS
            </button>
            <button onClick={() => void runAudit()} disabled={running}
              className="px-3 py-2 rounded-xl bg-[#0B0D1B] border border-[#1F2442] text-[#8E94B8] font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
              <RefreshCw className="w-3.5 h-3.5" /> RUN AGAIN
            </button>
            <span className="text-[10px] text-[#6A7097] ml-auto">
              The scheduler supports fixed intervals only — calendar recurrence (“every Monday”) is not implemented, so weekly/monthly are 7-day and 30-day intervals.
            </span>
          </div>

          <Panel title="Report artifact" icon={FileCheck}>
            <div className="text-[11px] text-[#8E94B8] space-y-0.5">
              <div><span className="text-[#6A7097]">Path: </span>{result.artifact.path}</div>
              <div><span className="text-[#6A7097]">Hash: </span><span className="text-[#8C8AFF] break-all">{result.artifact.contentHash}</span></div>
              <div><span className="text-[#6A7097]">Task: </span>{result.taskId}</div>
            </div>
            <details className="mt-2">
              <summary className="text-[10px] text-[#8C8AFF] cursor-pointer">Open full report</summary>
              <pre className="text-[10px] text-[#C9CCE4] whitespace-pre-wrap break-words mt-2 max-h-[420px] overflow-y-auto">{result.report}</pre>
            </details>
          </Panel>
        </>
      )}

      <div className="border border-[#1F2442] rounded-2xl bg-[#080A16] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#1F2442] flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-white">Audit history</span>
          <span className="text-[10px] text-[#6A7097] ml-auto">{history.length}</span>
        </div>
        {history.length === 0 ? (
          <div className="p-6 text-center text-[11px] text-[#6A7097]">No audits saved in this workspace yet.</div>
        ) : (
          history.map((h) => (
            <div key={h.artifactId} className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-[#141628] last:border-0 text-[11px]">
              <span className="text-white font-bold truncate flex-1 min-w-0">{h.businessName || h.domain || h.path}</span>
              <span className="text-[#6A7097]">{h.pagesAnalyzed ?? '—'} pages</span>
              <span className="text-[#8E94B8]">SEO {h.scoreSeo ?? 'UNKNOWN'}</span>
              <span className="text-[#8E94B8]">AEO {h.scoreAeo ?? 'UNKNOWN'}</span>
              <span className="text-[#8E94B8]">GEO {h.scoreGeo ?? 'UNKNOWN'}</span>
              <span className="text-[#6A7097]">{h.createdAt ? new Date(h.createdAt).toLocaleString() : ''}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl">
    <span className="text-[10px] text-[#6A7097] uppercase tracking-wider block">{label}</span>
    <span className="text-base font-extrabold text-white mt-0.5 block truncate">{value}</span>
    {sub && <span className="text-[10px] text-[#7B82A8] block mt-0.5 truncate">{sub}</span>}
  </div>
);

const Panel: React.FC<{ title: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; tone?: string; children: React.ReactNode }> = ({ title, icon: Icon, tone, children }) => (
  <div className="border border-[#1F2442] rounded-2xl bg-[#080A16] overflow-hidden">
    <div className="px-4 py-2.5 border-b border-[#1F2442] flex items-center gap-2">
      <Icon className="w-3.5 h-3.5" style={{ color: tone || '#38BDF8' }} />
      <span className="text-[10px] font-bold uppercase tracking-wider text-white">{title}</span>
    </div>
    <div className="p-4">{children}</div>
  </div>
);

export default AeoAuditView;
