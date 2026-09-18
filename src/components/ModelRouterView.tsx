import React, { useState, useEffect } from 'react';
import { AIModelInfo, ModelRouterRule, ActiveTab } from '../types';
import { SetupWizardCard } from './SetupWizardCard';
import { CanonicalRouterPanel } from './registry/CanonicalRouterPanel';
import { 
  Network, ExternalLink, Zap, DollarSign, Activity, 
  Layers, CheckCircle2, Shield, Play, RefreshCw, 
  Sparkles, ArrowRight, Server, Compass, Clock, 
  Sliders, Terminal, Plus, Trash2, Cpu, Database, Search,
  Radio, Check, Eye, Lock, Filter
} from 'lucide-react';
import { 
  OpenRouterModel, 
  AgentRoleModelMapping, 
  DEFAULT_AGENT_MODEL_MATRIX,
} from '../services/openRouterService';

interface ModelRouterViewProps {
  /** The workspace whose routing constraints and paused tasks are shown. */
  workspaceId?: string;
  models: Record<string, AIModelInfo>;
  rules: ModelRouterRule[];
  onUpdateRule: (id: string, updates: Partial<ModelRouterRule>) => void;
  onAddRule: (rule: Omit<ModelRouterRule, 'id'>) => void;
  onDeleteRule: (id: string) => void;
  onSendQuery: (query: string, targetModel: string) => Promise<string>;
  onSelectTab: (tab: ActiveTab) => void;
}

export const ModelRouterView: React.FC<ModelRouterViewProps> = ({
  workspaceId = '',
  models,
  rules,
  onUpdateRule,
  onAddRule,
  onDeleteRule,
  onSendQuery,
  onSelectTab,
}) => {
  // Navigation tab inside Model Router
  // 'canonical' is the real router (lib/registry/router.ts). The other tabs
  // keep their layout (PRESERVE_VISUAL_UX_ONLY) but now read the registry and
  // the router instead of a browser-side OpenRouter fetch and keyword guesses.
  const [activeRouterTab, setActiveRouterTab] = useState<'canonical' | 'free-hub' | 'agent-matrix' | 'sandbox' | 'custom-rules'>('canonical');

  // OpenRouter Free Models state
  // Free offerings come from the model registry (route imports), never from a
  // hardcoded list or a browser-side provider call. Empty until imported.
  const [freeModels, setFreeModels] = useState<OpenRouterModel[]>([]);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSyncingModels, setIsSyncingModels] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('Active');
  const [isLiveApi, setIsLiveApi] = useState<boolean>(false);
  // Provider credentials live on the server (env / encrypted store), never in browser storage.
  const openRouterApiKey = '';
  const [zeroCostModeEnabled, setZeroCostModeEnabled] = useState<boolean>(true);
  const [agentMatrix, setAgentMatrix] = useState<AgentRoleModelMapping[]>(DEFAULT_AGENT_MODEL_MATRIX);

  // Sandbox testing states
  const [testPrompt, setTestPrompt] = useState('Analyze mathematical convergence in DeepSeek R1 and write a TypeScript refactoring patch');
  const [selectedAgentRole, setSelectedAgentRole] = useState<string>('chief-of-staff');
  const [sandboxTaskClass, setSandboxTaskClass] = useState<string>('content_generation');
  const [routingStrategy, setRoutingStrategy] = useState<'smart-auto' | 'lowest-cost' | 'lowest-latency' | 'deep-reasoning'>('smart-auto');
  const [isRouting, setIsRouting] = useState(false);
  const [routeResult, setRouteResult] = useState<{
    selectedModel: string;
    fallbackChain: string[];
    estimatedCost: string;
    decisionReason: string;
    output?: string;
    failed?: boolean;
  } | null>(null);

  // New Rule Modal
  const [isAddingRule, setIsAddingRule] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleCondition, setNewRuleCondition] = useState('');
  const [newRuleTarget, setNewRuleTarget] = useState('claudecode');
  const [newRuleFallback, setNewRuleFallback] = useState('gemini');

  // Free offerings, from the local registry. Zero provider calls.
  const loadRegistryFreeModels = async (): Promise<number> => {
    const r = await fetch(`/api/registry/models?workspaceId=${encodeURIComponent(workspaceId)}`);
    const j = await r.json().catch(() => null);
    const list: OpenRouterModel[] = (j?.models || [])
      .filter((m: any) => m.freeTier?.free)
      .map((m: any) => ({
        id: `${m.providerId}/${m.modelId}`,
        name: m.displayName,
        description: `${m.routeKind ?? 'DIRECT'} route · ${m.freeTier?.guaranteed ? 'free (guaranteed)' : 'free (volatile — may change without notice)'} · ${m.availability}`,
        context_length: m.limits?.contextTokens ?? 0,
        category: 'General',
      } as OpenRouterModel));
    setFreeModels(list);
    setLastSyncTime(new Date().toLocaleTimeString());
    setIsLiveApi(false);
    return list.length;
  };
  useEffect(() => { loadRegistryFreeModels().catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workspaceId]);

  // Live registry counts for the header — read, never fabricated.
  const [counts, setCounts] = useState<{ families: number; versions: number; offerings: number; available: number; qualified: number } | null>(null);
  const loadCounts = async () => {
    try {
      const q = `workspaceId=${encodeURIComponent(workspaceId)}`;
      const [m, qu, id] = await Promise.all([
        fetch(`/api/registry/models?${q}`).then((r) => r.json()),
        fetch(`/api/registry/qualifications?${q}`).then((r) => r.json()),
        fetch(`/api/registry/identity?${q}`).then((r) => r.json()),
      ]);
      if (!m?.success || !qu?.success || !id?.success) { setCounts(null); return; }
      const models = (m.models || []).filter((x: any) => x.lifecycle !== 'REMOVED');
      setCounts({
        families: (id.families || []).length,
        versions: (id.families || []).reduce((n: number, f: any) => n + (f.versions || []).length, 0),
        offerings: models.length,
        available: models.filter((x: any) => x.executable).length,
        qualified: new Set((qu.qualifications || []).filter((x: any) => x.state === 'VALID').map((x: any) => `${x.providerId}/${x.modelId}`)).size,
      });
    } catch { setCounts(null); }
  };
  useEffect(() => { loadCounts(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workspaceId]);

  const handleSyncFreeModels = async () => {
    setIsSyncingModels(true);
    try { await Promise.all([loadRegistryFreeModels(), loadCounts()]); } catch (err) { console.error(err); } finally { setIsSyncingModels(false); }
  };

  // Filter free models
  const filteredFreeModels = freeModels.filter(m => {
    const matchesCat = selectedCategoryFilter === 'all' || m.category === selectedCategoryFilter;
    const matchesSearch = searchQuery === '' || 
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      m.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.description || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  // Router sandbox: a PREVIEW from the canonical router. Nothing is sent to
  // any provider, and there is no fallback ladder — the router either selects
  // a qualified route or says why none can run.
  const handleTestRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPrompt.trim() || isRouting) return;
    setIsRouting(true);
    const mode = zeroCostModeEnabled ? 'FREE_WHEN_QUALIFIED'
      : routingStrategy === 'lowest-cost' ? 'LOWEST_COST_QUALIFIED'
      : routingStrategy === 'lowest-latency' ? 'FASTEST_QUALIFIED'
      : 'BEST_QUALIFIED';
    try {
      const r = await fetch('/api/router/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, taskClass: sandboxTaskClass, inputChars: testPrompt.length, constraints: { mode } }) });
      const j = await r.json().catch(() => null);
      if (!j?.success) throw new Error(j?.error || `HTTP ${r.status}`);
      const d = j.decision;
      const eligible = (d.candidates || []).filter((c: any) => !c.disqualified.length && c.routeKey !== (d.selected ? `${d.selected.providerId}/${d.selected.modelId}@${d.selected.deploymentId}` : ''));
      setRouteResult({
        selectedModel: d.selected ? `${d.selected.canonicalVersionId ?? `${d.selected.providerId}/${d.selected.modelId}`} via ${d.selected.providerId}` : `NO QUALIFIED ROUTE (${d.waitState ?? d.outcome})`,
        fallbackChain: eligible.slice(0, 4).map((c: any) => `${c.routeKey} (considered, not a fallback)`),
        estimatedCost: d.selected?.estimatedCostUsd == null ? 'UNKNOWN' : `≤ $${Number(d.selected.estimatedCostUsd).toFixed(6)}`,
        decisionReason: `${d.mode} · ${d.policy.policyId} v${d.policy.version} — ${d.explanation}`,
        failed: !d.selected,
      });
    } catch (err: any) {
      setRouteResult({ selectedModel: 'UNKNOWN', fallbackChain: [], estimatedCost: 'UNKNOWN', decisionReason: `Router preview failed: ${err?.message || 'unknown error'}`, failed: true });
    } finally {
      setIsRouting(false);
    }
  };

  const handleCreateRuleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleName.trim()) return;

    onAddRule({
      name: newRuleName,
      condition: newRuleCondition,
      targetModel: newRuleTarget,
      fallbackModel: newRuleFallback,
      enabled: true,
      priority: rules.length + 1
    });

    setIsAddingRule(false);
    setNewRuleName('');
    setNewRuleCondition('');
  };

  const handleUpdateMatrixModel = (roleKey: string, field: 'primaryFreeModel' | 'secondaryFreeModel', modelId: string) => {
    setAgentMatrix(prev => prev.map(m => m.role === roleKey ? { ...m, [field]: modelId } : m));
  };

  return (
    <div id="tour-model-router" className="space-y-8 pb-16 max-w-7xl mx-auto px-4 font-mono">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-4 border-b border-[#1A1D2E] pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="airbyte-badge">
              CANONICAL MODEL ROUTER · QUALIFIED ROUTES ONLY · NO SILENT FALLBACK
            </span>
            <span data-testid="router-qualified-count" className={`text-[10px] font-mono px-2 py-0.5 rounded border ${counts && counts.qualified > 0 ? 'text-[#00D26A] bg-[#00D26A]/10 border-[#00D26A]/30' : 'text-[#E8A845] bg-[#E8A845]/10 border-[#E8A845]/30'}`}>
              {counts === null ? 'COUNTS UNKNOWN' : counts.qualified > 0 ? `${counts.qualified} QUALIFIED ROUTE${counts.qualified === 1 ? '' : 'S'}` : 'NO ROUTES QUALIFIED'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-['Space_Grotesk']">
            Canonical Model Router
          </h1>
          <p className="text-xs sm:text-sm text-[#8E94B8] mt-1" data-testid="router-registry-summary">
            {counts === null
              ? 'Registry counts could not be read.'
              : `Registry-driven model families and versions: ${counts.families} famil${counts.families === 1 ? 'y' : 'ies'}, ${counts.versions} canonical version${counts.versions === 1 ? '' : 's'}, ${counts.offerings} provider route offering${counts.offerings === 1 ? '' : 's'} (${counts.available} available now, ${counts.qualified} qualified for a task class).`}
            {counts !== null && counts.qualified === 0 && ' No route is qualified yet, so every model task waits (paused, not failed) until an operator qualifies one.'}
          </p>
        </div>

        {/* External Resources Links */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleSyncFreeModels}
            disabled={isSyncingModels}
            className="px-3.5 py-2 rounded-xl bg-[#615EFF]/20 hover:bg-[#615EFF]/30 border border-[#615EFF]/50 text-[#A5A2FF] text-xs font-bold transition flex items-center gap-1.5 active:scale-95"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingModels ? 'animate-spin' : ''}`} />
            <span>{isSyncingModels ? 'Reading…' : 'Reload from registry'}</span>
          </button>

          <a
            href="https://openrouter.ai/models"
            target="_blank"
            rel="noopener noreferrer"
            className="airbyte-btn-primary px-4 py-2.5 text-xs font-bold flex items-center gap-2"
          >
            <span>OPENROUTER CATALOG</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* 3-Step Setup Wizard for OpenRouter Free Model Router */}
      <SetupWizardCard
        id="model-router-setup-wizard"
        sectionTitle="Free & Aggregator Routes (from the Model Registry)"
        sectionSubtitle="Free and aggregator offerings arrive by manual route import in the Model Registry. Nothing is fetched from this page, and a free route runs only when qualified for the task class."
        statusBadge={{
          isConnected: isLiveApi || freeModels.length > 0,
          connectedLabel: `${freeModels.length} Free Endpoints Synced`,
          pendingLabel: "Offline",
        }}
        inputConfig={{
          label: "OPENROUTER CREDENTIAL — SERVER-SIDE ONLY",
          value: openRouterApiKey,
          placeholder: "Set OPENROUTER_API_KEY on the server",
          type: "password",
          helperText: "Credentials are never entered or stored in the browser. Set OPENROUTER_API_KEY in the server environment; the registry reports whether it resolves.",
          onChange: () => { /* intentionally inert: see helperText */ },
        }}
        secondaryConfig={{
          label: "ZERO-COST ROUTING MODE",
          value: zeroCostModeEnabled ? "enabled" : "disabled",
          placeholder: "Select routing strategy",
          type: "select",
          options: [
            { label: "Prefer qualified free routes (FREE_WHEN_QUALIFIED)", value: "enabled" },
            { label: "Default (BEST_QUALIFIED)", value: "disabled" },
          ],
          helperText: "Prefers qualified free routes (FREE_WHEN_QUALIFIED). Never falls back to an unqualified route.",
          onChange: (val) => setZeroCostModeEnabled(val === "enabled"),
        }}
        onTestConnection={async () => {
          setIsSyncingModels(true);
          try {
            const n = await loadRegistryFreeModels();
            return { success: true, message: `${n} free route offering(s) in the local model registry. Nothing was fetched from OpenRouter.` };
          } catch (e) {
            return { success: false, message: 'The model registry could not be read.' };
          } finally {
            setIsSyncingModels(false);
          }
        }}
        onSave={() => {
          localStorage.setItem('hermes_zero_cost_mode', zeroCostModeEnabled ? '1' : '0');
        }}
        howToGuide={{
          title: "How routes become usable",
          steps: [
            "Import a route document (OpenRouter, NVIDIA, a local runtime, or a signed manifest) in Admin → Providers & Models.",
            "Approve which canonical model version each aggregator offering serves.",
            "Qualify the route for a task class: deterministic evaluation plus canary ledger evidence, approved by an operator.",
            "Preview routing in the Canonical Router tab — nothing is sent."
          ],
          troubleshooting: [
            "A 429 pauses the task and switches only to an equally qualified route — there is no fallback chain.",
            "Free external routes are volatile and still need qualification; they are never treated as local $0 execution."
          ]
        }}
      />

      {/* Sub-Navigation Tabs within Model Router */}
      <div className="flex items-center gap-2 border-b border-[#1A1D2E] pb-3 overflow-x-auto">
        {[
          { id: 'canonical', label: 'Canonical Router', icon: Network },
          { id: 'free-hub', label: `Free Routes in Registry (${freeModels.length})`, icon: Sparkles },
          { id: 'agent-matrix', label: 'Agent Role Allocation Matrix', icon: Cpu },
          { id: 'sandbox', label: 'Router Testing Sandbox', icon: Play },
          { id: 'custom-rules', label: `Custom Routing Rules (${rules.length})`, icon: Sliders }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeRouterTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveRouterTab(tab.id as any)}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition whitespace-nowrap ${
                isActive
                  ? 'bg-[#615EFF] text-white shadow-lg shadow-[#615EFF]/25'
                  : 'bg-[#0D0E1A] text-[#8E94B8] hover:text-white hover:bg-[#15172A] border border-[#1C1F33]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeRouterTab === 'canonical' && (
        <CanonicalRouterPanel workspaceId={workspaceId} />
      )}

      {/* TAB 1: Free routes — from the model registry (route imports) */}
      {activeRouterTab === 'free-hub' && (
        <div className="space-y-6">
          <div className="text-[11px] text-[#8E94B8] bg-[#090A14] p-3 rounded-xl border border-[#1C1F33]" data-testid="free-routes-source">
            Free offerings come from the Model Registry (Admin → Providers &amp; Models → Route imports): metadata an operator imports, never fetched from this page. A free route is volatile unless its provider guarantees it, and — like every route — runs only when qualified for the task class.{freeModels.length === 0 ? ' None imported yet.' : ''}
          </div>
          {/* Controls Bar: Search & Category Filter */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#090A14] p-4 rounded-2xl border border-[#1C1F33]">
            {/* Search input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#6A7097] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search free models by name, provider, or architecture (e.g. DeepSeek, Llama, Qwen, Gemini)..."
                className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
              />
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {['all', 'Reasoning', 'Code', 'Vision', 'Long Context', 'Speed', 'General'].map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategoryFilter(cat)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                    selectedCategoryFilter === cat
                      ? 'bg-[#615EFF] text-white'
                      : 'bg-[#0E101D] text-[#7B82A8] hover:text-white border border-[#1A1D32]'
                  }`}
                >
                  {cat === 'all' ? 'All Models' : cat}
                </button>
              ))}
            </div>
          </div>

          {/* Free Models Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredFreeModels.map(model => (
              <div
                key={model.id}
                className="bg-[#090A14] border border-[#1C1F33] hover:border-[#615EFF] p-4 rounded-xl space-y-3 transition flex flex-col justify-between group"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#615EFF]/15 text-[#A5A2FF] border border-[#615EFF]/30">
                      {model.category || 'General'}
                    </span>
                    <span className="text-[10px] font-mono text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded border border-[#00D26A]/20 font-bold">
                      $0.0000 / 1M
                    </span>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-white group-hover:text-[#A5A2FF] transition">
                      {model.name}
                    </h4>
                    <div className="text-[10px] text-[#5F6589] font-mono truncate">{model.id}</div>
                    <p className="text-[11px] text-[#8E94B8] mt-1.5 line-clamp-2 leading-relaxed">
                      {model.description}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-[#161828] space-y-2 text-[11px]">
                  <div className="flex items-center justify-between text-[#8E94B8]">
                    <span>Context Window:</span>
                    <span className="text-white font-bold">{Math.round(model.context_length / 1000)}k tokens</span>
                  </div>
                  {/* Pass X / Workstream E4 — throughput and code/reason/math
                      benchmark percentages were previously invented client-
                      side (a keyword-category guess, not a measurement) for
                      every model shown here, live-API or fallback alike.
                      Removed rather than relabeled: no real source for
                      either exists anywhere in this app. */}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: Agent Role Allocation Matrix */}
      {activeRouterTab === 'agent-matrix' && (
        <div className="space-y-6">
          <div className="bg-[#090A14] border border-[#1C1F33] p-5 rounded-2xl space-y-2">
            <h3 className="text-base font-bold text-white font-['Space_Grotesk'] flex items-center gap-2">
              <Cpu className="w-4 h-4 text-[#615EFF]" />
              <span>Dynamic Agent-to-Free-Model Routing Matrix</span>
            </h3>
            <p className="text-xs text-[#8E94B8]">
              Reference layout only — the canonical router does not read this matrix. Tasks run on routes qualified for their task class, never on a per-agent model list.
            </p>
          </div>

          <div className="bg-[#090A14] border border-[#1C1F33] rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#05060C] text-[#6A7097] uppercase border-b border-[#1C1F33]">
                    <th className="py-3 px-4">Agent Role</th>
                    <th className="py-3 px-4">Specialty</th>
                    <th className="py-3 px-4">Primary Free Model (:free)</th>
                    <th className="py-3 px-4">Secondary (reference)</th>
                    <th className="py-3 px-4">Recommended Tier</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#161828]">
                  {agentMatrix.map(row => (
                    <tr key={row.role} className="hover:bg-[#0E101D] transition">
                      <td className="py-3.5 px-4 font-bold text-white whitespace-nowrap">
                        {row.displayName}
                      </td>
                      <td className="py-3.5 px-4 text-[#8E94B8] max-w-xs truncate">
                        {row.specialty}
                      </td>
                      <td className="py-3.5 px-4">
                        <select
                          value={row.primaryFreeModel}
                          onChange={e => handleUpdateMatrixModel(row.role, 'primaryFreeModel', e.target.value)}
                          className="bg-[#121424] border border-[#1E223D] rounded-lg px-2.5 py-1.5 text-xs text-[#00D26A] font-bold focus:outline-none focus:border-[#615EFF]"
                        >
                          {freeModels.map(m => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3.5 px-4">
                        <select
                          value={row.secondaryFreeModel}
                          onChange={e => handleUpdateMatrixModel(row.role, 'secondaryFreeModel', e.target.value)}
                          className="bg-[#121424] border border-[#1E223D] rounded-lg px-2.5 py-1.5 text-xs text-[#A5A2FF] focus:outline-none focus:border-[#615EFF]"
                        >
                          {freeModels.map(m => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-[#615EFF]/15 text-[#A5A2FF] border border-[#615EFF]/30 text-[10px] font-bold">
                          {row.recommendedCategory}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Interactive Router Testing Sandbox */}
      {activeRouterTab === 'sandbox' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left: Router Test & Live Telemetry (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-[#090A14] border border-[#1F233C] rounded-2xl p-6 shadow-2xl space-y-6 relative overflow-hidden">
              <div className="flex items-center justify-between border-b border-[#1A1D30] pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#615EFF]" />
                  <h3 className="text-base font-bold text-white font-['Space_Grotesk']">
                    Dynamic Router Sandbox
                  </h3>
                </div>

                {/* Zero-Cost Mode Toggle */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#8E94B8]">ZERO-COST ROUTING:</span>
                  <button
                    onClick={() => setZeroCostModeEnabled(!zeroCostModeEnabled)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition ${
                      zeroCostModeEnabled
                        ? 'bg-[#00D26A]/20 text-[#00D26A] border-[#00D26A]/50'
                        : 'bg-[#151828] text-[#8E94B8] border-[#222744]'
                    }`}
                  >
                    {zeroCostModeEnabled ? 'FREE_WHEN_QUALIFIED' : 'BEST_QUALIFIED'}
                  </button>
                </div>
              </div>

              <form onSubmit={handleTestRoute} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-mono text-[#8E94B8] block mb-1">
                      ASSIGNED AGENT ROLE
                    </label>
                    <select
                      value={selectedAgentRole}
                      onChange={e => setSelectedAgentRole(e.target.value)}
                      className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                    >
                      {agentMatrix.map(m => (
                        <option key={m.role} value={m.role}>
                          {m.displayName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-mono text-[#8E94B8] block mb-1">
                      STRATEGY
                    </label>
                    <select
                      value={routingStrategy}
                      onChange={e => setRoutingStrategy(e.target.value as any)}
                      className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                    >
                      <option value="smart-auto">Smart Auto Heuristics</option>
                      <option value="lowest-cost">Zero-Cost Free Models ($0.00)</option>
                      <option value="lowest-latency">Lowest Latency (Sub-40ms)</option>
                      <option value="deep-reasoning">Frontier Reasoning (DeepSeek R1)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-mono text-[#8E94B8] block mb-1">
                    TASK CLASS (REGISTRY DATA)
                  </label>
                  <input
                    value={sandboxTaskClass}
                    onChange={(e) => setSandboxTaskClass(e.target.value)}
                    className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                    aria-label="Task class"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-mono text-[#8E94B8] block mb-1">
                    TEST PROMPT DIRECTIVE
                  </label>
                  <textarea
                    value={testPrompt}
                    onChange={(e) => setTestPrompt(e.target.value)}
                    rows={3}
                    placeholder="Type a task prompt to test dynamic model routing..."
                    className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-3 text-xs font-mono text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
                  />
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-mono text-[#6A7097]">
                    Evaluates keyword rules, token count, cost, & latency.
                  </span>
                  <button
                    type="submit"
                    disabled={isRouting || !testPrompt.trim()}
                    className="airbyte-btn-primary px-4 py-2 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Play className={`w-3 h-3 ${isRouting ? 'animate-spin' : ''}`} />
                    <span>{isRouting ? 'ROUTING...' : 'PREVIEW ROUTE (NOTHING IS SENT)'}</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Route Simulation Result */}
            {routeResult && (
              <div className={`bg-[#090A14] border rounded-2xl p-6 shadow-2xl space-y-4 animate-in fade-in ${routeResult.failed ? 'border-[#FF6B6B]/40' : 'border-[#00D26A]/40'}`}>
                <div className="flex items-center justify-between border-b border-[#1A1D30] pb-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className={`w-4 h-4 ${routeResult.failed ? 'text-[#FF6B6B]' : 'text-[#00D26A]'}`} />
                    <h4 className="text-sm font-bold text-white font-mono uppercase">
                      Router Decision (preview — nothing sent)
                    </h4>
                  </div>
                  {routeResult.failed && (
                    <span className="text-xs font-mono text-[#FF6B6B] bg-[#FF6B6B]/10 px-2 py-0.5 rounded border border-[#FF6B6B]/30">
                      QUERY FAILED
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                  <div className="bg-[#05060B] p-3 rounded-xl border border-[#1A1D30]">
                    <span className="text-[10px] text-[#6A7097] block uppercase">Selected Endpoint</span>
                    <span className="text-[#00D26A] font-bold text-xs truncate block">{routeResult.selectedModel}</span>
                  </div>
                  <div className="bg-[#05060B] p-3 rounded-xl border border-[#1A1D30]">
                    <span className="text-[10px] text-[#6A7097] block uppercase">Est. Inference Cost</span>
                    <span className="text-white font-bold text-xs">{routeResult.estimatedCost}</span>
                  </div>
                </div>

                <div className="p-3 bg-[#05060B] rounded-xl border border-[#1A1D30] text-xs space-y-1">
                  <span className="text-[10px] text-[#6A7097] block uppercase font-mono">Decision Heuristic</span>
                  <p className="text-[#A5A2FF] font-mono">{routeResult.decisionReason}</p>
                </div>

                {/* Waterfall Visualizer */}
                <div>
                  <span className="text-[10px] text-[#6A7097] block uppercase font-mono mb-1.5">
                    Other eligible routes considered (the router never falls back silently)
                  </span>
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 text-[11px] font-mono">
                    <span className="bg-[#00D26A]/20 text-[#00D26A] border border-[#00D26A]/40 px-2.5 py-1 rounded-lg font-bold flex items-center gap-1">
                      <span>1. {routeResult.selectedModel}</span>
                    </span>
                    {routeResult.fallbackChain.map((fb, idx) => (
                      <React.Fragment key={fb}>
                        <ArrowRight className="w-3.5 h-3.5 text-[#5F6589]" />
                        <span className="bg-[#121424] text-[#8E94B8] border border-[#1E223D] px-2.5 py-1 rounded-lg">
                          {idx + 2}. {fb}
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {routeResult.output && (
                  <div className="space-y-1 pt-2">
                    <span className="text-[10px] text-[#6A7097] block uppercase font-mono">Inference Output Deliverable</span>
                    <pre className="p-3 bg-[#05060B] rounded-xl border border-[#1A1D30] text-xs font-mono text-[#E2E8F0] whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                      {routeResult.output}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Architecture Specs & Zero-Cost Routing Notes (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-[#090A14] border border-[#1F233C] rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center gap-2 text-white font-bold font-['Space_Grotesk'] text-base">
                <Shield className="w-4 h-4 text-[#00D26A]" />
                <span>Qualified-route protocol</span>
              </div>
              <p className="text-xs text-[#8E94B8] leading-relaxed">
                The router selects only routes qualified for the task class; cost is optimised only among qualified routes; free routes are volatile and must be qualified like any other.
              </p>

              <div className="space-y-2 text-xs font-mono">
                {/* Previously hardcoded run-rate / coverage / savings figures; no measurement backs them. */}
                <div className="p-2.5 bg-[#05060B] rounded-xl border border-[#1A1D30] flex items-center justify-between">
                  <span className="text-[#8E94B8]">Daily Token Run-Rate:</span>
                  <span className="text-[#7E8BB5] font-bold">UNKNOWN — see Spend Control</span>
                </div>
                <div className="p-2.5 bg-[#05060B] rounded-xl border border-[#1A1D30] flex items-center justify-between">
                  <span className="text-[#8E94B8]">Zero-Cost Coverage:</span>
                  <span className="text-[#7E8BB5] font-bold">UNKNOWN</span>
                </div>
                <div className="p-2.5 bg-[#05060B] rounded-xl border border-[#1A1D30] flex items-center justify-between">
                  <span className="text-[#8E94B8]">Monthly Savings:</span>
                  <span className="text-[#7E8BB5] font-bold">UNKNOWN</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Custom Routing Rules */}
      {activeRouterTab === 'custom-rules' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white font-['Space_Grotesk']">
                Legacy Routing Rules ({rules.length}) — not used for selection
              </h3>
              <p className="text-xs text-[#8E94B8]">
                Kept for reference. Model selection is the canonical router's (Canonical Router tab); these keyword rules are never read at execution time.
              </p>
            </div>

            <button
              onClick={() => setIsAddingRule(true)}
              className="airbyte-btn-primary px-3 py-1.5 text-xs font-bold flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>NEW RULE</span>
            </button>
          </div>

          <div className="bg-[#090A14] border border-[#1C1F33] rounded-2xl overflow-hidden shadow-xl">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#05060C] text-[#6A7097] uppercase border-b border-[#1C1F33]">
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">Rule Name</th>
                  <th className="py-3 px-4">Condition Matcher</th>
                  <th className="py-3 px-4">Target Model</th>
                  <th className="py-3 px-4">Legacy fallback (not used)</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#161828]">
                {rules.map((rule, idx) => (
                  <tr key={rule.id} className="hover:bg-[#0E101D] transition">
                    <td className="py-3 px-4 font-mono text-[#615EFF] font-bold">#{idx + 1}</td>
                    <td className="py-3 px-4 font-bold text-white">{rule.name}</td>
                    <td className="py-3 px-4 text-[#8E94B8] font-mono text-[11px]">{rule.condition}</td>
                    <td className="py-3 px-4 text-[#00D26A] font-mono">{rule.targetModel}</td>
                    <td className="py-3 px-4 text-[#A5A2FF] font-mono">{rule.fallbackModel}</td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => onUpdateRule(rule.id, { enabled: !rule.enabled })}
                        className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                          rule.enabled
                            ? 'bg-[#00D26A]/10 text-[#00D26A] border border-[#00D26A]/20'
                            : 'bg-[#FF5E8E]/10 text-[#FF5E8E] border border-[#FF5E8E]/20'
                        }`}
                      >
                        {rule.enabled ? 'ACTIVE' : 'MUTED'}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => onDeleteRule(rule.id)}
                        className="p-1 text-[#6A7097] hover:text-[#FF5E8E] transition"
                        title="Delete Rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add New Rule Modal */}
      {isAddingRule && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#090A14] border border-[#232742] w-full max-w-md rounded-2xl p-6 space-y-4 shadow-2xl font-mono text-xs text-white">
            <h3 className="text-base font-bold text-white font-['Space_Grotesk']">
              Create Deterministic Routing Rule
            </h3>

            <form onSubmit={handleCreateRuleSubmit} className="space-y-3">
              <div>
                <label className="text-[11px] text-[#8E94B8] block mb-1">RULE NAME</label>
                <input
                  type="text"
                  value={newRuleName}
                  onChange={e => setNewRuleName(e.target.value)}
                  placeholder="e.g. High-Complexity Coding Filter"
                  className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#8E94B8] block mb-1">CONDITION REGEX / KEYWORD</label>
                <input
                  type="text"
                  value={newRuleCondition}
                  onChange={e => setNewRuleCondition(e.target.value)}
                  placeholder="e.g. contains 'refactor' or 'typescript'"
                  className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#8E94B8] block mb-1">TARGET MODEL</label>
                  <select
                    value={newRuleTarget}
                    onChange={e => setNewRuleTarget(e.target.value)}
                    className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  >
                    {freeModels.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-[#8E94B8] block mb-1">FALLBACK</label>
                  <select
                    value={newRuleFallback}
                    onChange={e => setNewRuleFallback(e.target.value)}
                    className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  >
                    {freeModels.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#1C1F33]">
                <button
                  type="button"
                  onClick={() => setIsAddingRule(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-[#8E94B8] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="airbyte-btn-primary px-4 py-1.5 text-xs font-bold"
                >
                  Create Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
