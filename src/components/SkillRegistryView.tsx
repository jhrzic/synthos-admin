import React, { useState, useEffect, useCallback } from 'react';
import {
  Code, Terminal, Shield, Play, CheckCircle2,
  AlertTriangle, RefreshCw, Plus, Search, Loader2, X, Zap, Network
} from 'lucide-react';

type SkillCategory = 'system' | 'mcp' | 'custom' | 'tool' | 'integration';
type ExecutionTargetType = 'model' | 'deterministic' | 'mcp_tool' | 'hermes_runtime';

interface SkillRecord {
  skill_id: string;
  workspace_id: string;
  name: string;
  description: string;
  category: SkillCategory;
  version: string;
  enabled: boolean;
  status: 'NOT_CONFIGURED';
  source_type: string;
  source_ref: string | null;
  markdown_spec: string | null;
  execution_target_type: ExecutionTargetType | null;
  execution_target_ref: string | null;
  credential_configured: boolean;
  created_at: string;
  updated_at: string;
  callCount: number;
  successCount: number;
  lastTestedAt: string | null;
}

interface Executability {
  executable: boolean;
  reason: 'DISABLED' | 'NO_TARGET' | 'MISSING_PROVIDER' | 'MISSING_RUNTIME' | 'READY';
  message: string;
}

interface McpProbeResult {
  status: 'CONNECTED' | 'FAILED' | 'NOT_CONFIGURED' | 'PROBE_NOT_IMPLEMENTED';
  transport?: string;
  serverInfo?: { name?: string; version?: string };
  tools?: Array<{ name: string; description?: string }>;
  resources?: Array<{ uri: string; name?: string }>;
  error?: string;
  latencyMs?: number;
}

interface SkillRegistryViewProps {
  activeWorkspaceId?: string;
}

// ---------------------------------------------------------------------------
// SYNTHOS — Skill Registry.
//
// Real, workspace-scoped registry backed by GET/POST/PATCH /api/skills (see
// lib/skills.ts). No execution runtime for arbitrary skills exists in this
// deployment (no sandbox, no MCP client), so "Run Skill Test" always
// honestly returns NOT_IMPLEMENTED — it never fabricates a "Sandbox"
// success. callCount/successCount are derived from real recorded test
// attempts, never hardcoded.
// ---------------------------------------------------------------------------

export const SkillRegistryView: React.FC<SkillRegistryViewProps> = ({ activeWorkspaceId }) => {
  const workspaceId = activeWorkspaceId || 'ws-synthos-primary';

  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; message: string } | null>(null);
  const [isAddingSkill, setIsAddingSkill] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState<SkillCategory>('custom');
  const [newSourceRef, setNewSourceRef] = useState('');
  const [newMarkdown, setNewMarkdown] = useState('');

  // Pass V / E9 — real executability, never guessed client-side.
  const [executability, setExecutability] = useState<Executability | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executeInput, setExecuteInput] = useState('');
  const [executeResult, setExecuteResult] = useState<{ success: boolean; status: string; output?: unknown; error?: string } | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<McpProbeResult | null>(null);
  const [isSavingTarget, setIsSavingTarget] = useState(false);
  const [targetType, setTargetType] = useState<ExecutionTargetType | ''>('');
  const [targetRef, setTargetRef] = useState('');
  const [targetCredential, setTargetCredential] = useState('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setError(data.error || `HTTP ${res.status}`);
        setSkills([]);
      } else {
        setSkills(data.skills || []);
        setActiveSkillId((prev) => prev && (data.skills || []).some((s: SkillRecord) => s.skill_id === prev) ? prev : (data.skills || [])[0]?.skill_id || null);
      }
    } catch (err: any) {
      setError(err?.message || 'Network error contacting the Skills API.');
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const activeSkill = skills.find((s) => s.skill_id === activeSkillId) || null;

  const fetchExecutability = useCallback(async (skillId: string) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillId)}/executability?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await res.json();
      setExecutability(res.ok && data.success !== false ? data.executability : null);
    } catch {
      setExecutability(null);
    }
  }, [workspaceId]);

  useEffect(() => {
    setExecuteResult(null);
    setProbeResult(null);
    if (activeSkill) {
      fetchExecutability(activeSkill.skill_id);
      setTargetType(activeSkill.execution_target_type || '');
      setTargetRef(activeSkill.execution_target_ref || '');
      setTargetCredential('');
    } else {
      setExecutability(null);
    }
  }, [activeSkill?.skill_id, fetchExecutability]);

  const filteredSkills = skills.filter((skill) => {
    const matchesCat = selectedCategory === 'all' || skill.category === selectedCategory;
    const matchesSearch = skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          skill.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const handleToggleSkill = async (skill: SkillRecord) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.skill_id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, enabled: !skill.enabled }),
      });
      const data = await res.json();
      if (res.ok && data.success !== false) {
        setSkills((prev) => prev.map((s) => (s.skill_id === skill.skill_id ? data.skill : s)));
      }
    } catch {
      // Real network failure — leave the toggle unchanged rather than
      // optimistically flipping it to a state the backend never confirmed.
    }
  };

  const handleRunTest = async (skill: SkillRecord) => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.skill_id)}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ status: 'FAILED', message: data.error || `HTTP ${res.status}` });
      } else {
        setTestResult({ status: data.status || 'NOT_IMPLEMENTED', message: data.message || '' });
      }
      fetchSkills();
    } catch (err: any) {
      setTestResult({ status: 'FAILED', message: err?.message || 'Network error contacting the test API.' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveTarget = async (skill: SkillRecord) => {
    setIsSavingTarget(true);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.skill_id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          execution_target_type: targetType || null,
          execution_target_ref: targetRef.trim() || null,
          ...(targetCredential.trim() ? { credential: targetCredential.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        showToast(`Could not save execution target: ${data.error || `HTTP ${res.status}`}`);
        return;
      }
      setTargetCredential('');
      showToast('Execution target saved.');
      await fetchSkills();
      fetchExecutability(skill.skill_id);
    } catch (err: any) {
      showToast(`Could not save execution target: ${err?.message || 'network error'}`);
    } finally {
      setIsSavingTarget(false);
    }
  };

  const handleExecute = async (skill: SkillRecord) => {
    setIsExecuting(true);
    setExecuteResult(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.skill_id)}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, prompt: executeInput, query: executeInput }),
      });
      const data = await res.json();
      setExecuteResult({ success: !!data.success, status: data.status || 'FAILED', output: data.output, error: data.error });
    } catch (err: any) {
      setExecuteResult({ success: false, status: 'FAILED', error: err?.message || 'Network error contacting the execute API.' });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleProbeMcp = async (skill: SkillRecord) => {
    setIsProbing(true);
    setProbeResult(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.skill_id)}/mcp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json();
      setProbeResult(res.ok && data.success !== false ? data.probe : { status: 'FAILED', error: data.error || `HTTP ${res.status}` });
    } catch (err: any) {
      setProbeResult({ status: 'FAILED', error: err?.message || 'Network error contacting the probe API.' });
    } finally {
      setIsProbing(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          name: newName.trim(),
          description: newDesc,
          category: newCategory,
          sourceType: newSourceRef.trim() ? 'manual' : 'manual',
          sourceRef: newSourceRef.trim() || undefined,
          markdownSpec: newMarkdown || undefined,
          // No execution target is set at creation time by design — E1: a
          // freshly registered skill is REGISTERED, never implicitly
          // EXECUTABLE. Configure the target from the inspector afterward.
        }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        showToast(`Could not register skill: ${data.error || `HTTP ${res.status}`}`);
        return;
      }
      setNewName('');
      setNewDesc('');
      setNewSourceRef('');
      setNewMarkdown('');
      setIsAddingSkill(false);
      showToast(`Skill "${data.skill.name}" registered for this workspace.`);
      fetchSkills();
      setActiveSkillId(data.skill.skill_id);
    } catch (err: any) {
      showToast(`Could not register skill: ${err?.message || 'network error'}`);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0D0E1A] p-5 rounded-2xl border border-[#1E2238] shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#615EFF] to-[#38BDF8] flex items-center justify-center shadow-lg shadow-[#615EFF]/25">
            <Terminal className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-tight">Skill Registry</h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#8E94B8]/15 text-[#8E94B8] border border-[#8E94B8]/30">
                Workspace: {workspaceId}
              </span>
            </div>
            <p className="text-xs text-[#9AA2C6] mt-0.5">
              Real, persisted per-workspace skill definitions. No execution runtime is wired in this deployment yet — testing a skill honestly reports NOT_IMPLEMENTED.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchSkills}
            disabled={loading}
            className="p-2 rounded-lg bg-[#141628] border border-[#1E2238] text-[#8E94B8] hover:text-white transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setIsAddingSkill(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#615EFF] hover:bg-[#5653d9] text-white text-xs font-semibold rounded-xl shadow-lg shadow-[#615EFF]/20 transition active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Register Skill</span>
          </button>
        </div>
      </div>

      {toastMessage && (
        <div className="p-3 bg-[#00D26A]/10 border border-[#00D26A]/30 rounded-xl text-xs text-[#00D26A] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-[#FF5E8E]/10 border border-[#FF5E8E]/30 rounded-xl text-xs text-[#FF5E8E] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[#8E94B8] py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading skills…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Skill List & Filters */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-[#0D0E1A] border border-[#1E2238] p-3 rounded-xl space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#5F6589]" />
                <input
                  type="text"
                  placeholder="Search skills..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-[#141628] border border-[#1E2238] rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                {['all', 'system', 'mcp', 'tool', 'integration', 'custom'].map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2.5 py-1 rounded-lg font-mono text-[10px] uppercase transition cursor-pointer ${
                      selectedCategory === cat ? 'bg-[#615EFF] text-white font-bold' : 'bg-[#141628] text-[#8E94B8] hover:text-white'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2.5 max-h-[620px] overflow-y-auto pr-1">
              {filteredSkills.map(skill => {
                const isSelected = activeSkillId === skill.skill_id;
                return (
                  <div
                    key={skill.skill_id}
                    onClick={() => { setActiveSkillId(skill.skill_id); setTestResult(null); }}
                    className={`p-3.5 rounded-xl border transition cursor-pointer text-left ${
                      isSelected
                        ? 'bg-[#15172A] border-[#615EFF] shadow-lg shadow-[#615EFF]/10'
                        : 'bg-[#0D0E1A] border-[#1E2238] hover:border-[#2D3354] hover:bg-[#111324]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-mono font-bold text-white flex items-center gap-1.5">
                        <Code className="w-3.5 h-3.5 text-[#615EFF]" />
                        {skill.name}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleSkill(skill); }}
                        className="text-xs cursor-pointer"
                        title={skill.enabled ? 'Disable Skill' : 'Enable Skill'}
                      >
                        {skill.enabled ? (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30">
                            ENABLED
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#FF5E8E]/15 text-[#FF5E8E] border border-[#FF5E8E]/30">
                            DISABLED
                          </span>
                        )}
                      </button>
                    </div>

                    <p className="text-[11px] text-[#9AA2C6] line-clamp-2 leading-relaxed">
                      {skill.description || 'No description.'}
                    </p>

                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#1C2035] text-[10px] text-[#8E94B8] font-mono">
                      <span className="uppercase text-[#38BDF8]">{skill.category}</span>
                      <span>Test attempts: {skill.callCount}</span>
                    </div>
                  </div>
                );
              })}

              {filteredSkills.length === 0 && (
                <div className="p-8 text-center bg-[#0D0E1A] border border-[#1E2238] rounded-xl text-[#5F6589] text-xs">
                  {skills.length === 0 ? 'No skills are installed for this workspace.' : 'No skills matching the current filter.'}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Skill Inspector & Test Harness */}
          <div className="lg:col-span-7">
            {activeSkill ? (
              <div className="bg-[#0D0E1A] border border-[#1E2238] rounded-2xl p-5 space-y-5">
                <div className="flex items-start justify-between gap-4 border-b border-[#1E2238] pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-[#615EFF] px-2 py-0.5 bg-[#615EFF]/10 border border-[#615EFF]/30 rounded">
                        {activeSkill.category.toUpperCase()}
                      </span>
                      <span className="text-xs text-[#8E94B8] font-mono">v{activeSkill.version}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#7E8BB5]/15 text-[#7E8BB5] border border-[#7E8BB5]/30">
                        {activeSkill.status}
                      </span>
                      {/* E9 — real, server-computed executability, never inferred from enabled alone */}
                      {executability && (
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                          executability.executable
                            ? 'bg-[#00D26A]/15 text-[#00D26A] border-[#00D26A]/30'
                            : 'bg-[#7E8BB5]/15 text-[#7E8BB5] border-[#7E8BB5]/30'
                        }`} title={executability.message}>
                          {executability.executable ? 'EXECUTABLE' : executability.reason}
                        </span>
                      )}
                    </div>
                    <h2 className="text-base font-bold text-white mt-1.5 font-mono">
                      {activeSkill.name}
                    </h2>
                    <p className="text-xs text-[#9AA2C6] mt-1">
                      {activeSkill.description || 'No description.'}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-[10px] font-mono text-[#5F6589]">TEST ATTEMPTS</div>
                    <div className="text-lg font-bold text-white font-mono">{activeSkill.callCount}</div>
                  </div>
                </div>

                <div className="bg-[#121424] border border-[#1E2238] p-3.5 rounded-xl space-y-2">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#A5A2FF] flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-[#615EFF]" />
                    <span>Source</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1C2035] text-[#8E94B8] inline-block">
                    {activeSkill.source_type}{activeSkill.source_ref ? `: ${activeSkill.source_ref}` : ' (no reference set)'}
                  </span>
                </div>

                {activeSkill.markdown_spec && (
                  <div className="bg-[#121424] border border-[#1E2238] p-3.5 rounded-xl space-y-2">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[#8E94B8] flex items-center justify-between">
                      <span>SKILL.md Spec</span>
                    </div>
                    <pre className="text-xs text-[#E2E8F0] font-mono whitespace-pre-wrap leading-relaxed bg-[#080911] p-3 rounded-lg border border-[#161828] max-h-40 overflow-y-auto">
                      {activeSkill.markdown_spec}
                    </pre>
                  </div>
                )}

                {/* E2 — real, discriminated execution target. Registering or
                    enabling a skill never implies a target exists; this is
                    the one place that sets it. */}
                <div className="bg-[#121424] border border-[#1E2238] p-4 rounded-xl space-y-3">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#A5A2FF] flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    <span>Execution Target</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <select
                      value={targetType}
                      onChange={(e) => setTargetType(e.target.value as ExecutionTargetType | '')}
                      className="bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                    >
                      <option value="">No target (NOT_EXECUTABLE)</option>
                      <option value="model">Model (Gemini via provider router)</option>
                      <option value="deterministic">Deterministic action</option>
                      <option value="mcp_tool">MCP tool</option>
                      <option value="hermes_runtime">Hermes dedicated runtime</option>
                    </select>
                    <input
                      type="text"
                      value={targetRef}
                      onChange={(e) => setTargetRef(e.target.value)}
                      placeholder={targetType === 'model' ? 'gemini-3.1-flash-lite' : targetType === 'deterministic' ? 'vault.list | memory.search' : targetType === 'mcp_tool' ? 'tool name' : 'n/a'}
                      disabled={!targetType || targetType === 'hermes_runtime'}
                      className="bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white font-mono placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF] disabled:opacity-40"
                    />
                  </div>
                  {targetType === 'mcp_tool' && (
                    <input
                      type="password"
                      value={targetCredential}
                      onChange={(e) => setTargetCredential(e.target.value)}
                      placeholder={activeSkill.credential_configured ? 'Credential configured (leave blank to keep)' : 'Bearer token (optional, write-only)'}
                      className="w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]"
                    />
                  )}
                  <button
                    onClick={() => handleSaveTarget(activeSkill)}
                    disabled={isSavingTarget}
                    className="px-3 py-1.5 bg-[#14172B] hover:bg-[#1C203C] disabled:opacity-50 text-xs font-mono font-bold text-white rounded-lg border border-[#282F52] cursor-pointer"
                  >
                    {isSavingTarget ? 'Saving…' : 'Save Target'}
                  </button>
                </div>

                {/* F4/F5/F6 — real MCP connection probe, mcp-category only */}
                {activeSkill.category === 'mcp' && (
                  <div className="bg-[#121424] border border-[#1E2238] p-4 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-[#38BDF8] flex items-center gap-1.5">
                        <Network className="w-3.5 h-3.5" />
                        <span>MCP Connectivity</span>
                      </div>
                      <button
                        onClick={() => handleProbeMcp(activeSkill)}
                        disabled={isProbing || !activeSkill.source_ref}
                        className="px-3 py-1.5 bg-[#14172B] hover:bg-[#1C203C] disabled:opacity-50 text-xs font-mono font-bold text-[#38BDF8] rounded-lg border border-[#282F52] cursor-pointer"
                      >
                        {isProbing ? 'Probing…' : 'Probe Connection'}
                      </button>
                    </div>
                    {probeResult && (
                      <div className="space-y-1.5">
                        <div className={`text-[10px] font-mono font-bold ${
                          probeResult.status === 'CONNECTED' ? 'text-[#00D26A]' : 'text-[#FF5E8E]'
                        }`}>
                          {probeResult.status}{typeof probeResult.latencyMs === 'number' ? ` (${probeResult.latencyMs}ms)` : ''}
                        </div>
                        {probeResult.error && (
                          <div className="text-[11px] text-[#FF5E8E] font-mono">{probeResult.error}</div>
                        )}
                        {probeResult.status === 'CONNECTED' && (
                          <div className="text-[11px] text-[#9AA2C6] font-mono">
                            {probeResult.tools?.length || 0} tool(s), {probeResult.resources?.length || 0} resource(s) discovered live.
                            {probeResult.tools && probeResult.tools.length > 0 && (
                              <ul className="mt-1 list-disc list-inside">
                                {probeResult.tools.map((t) => <li key={t.name}>{t.name}</li>)}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* E4/E5/E6/E8 — real execution, distinct from Test below */}
                <div className="bg-[#121424] border border-[#1E2238] p-4 rounded-xl space-y-3">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#00D26A] flex items-center gap-1.5">
                    <Play className="w-3.5 h-3.5" />
                    <span>Execute</span>
                  </div>
                  <input
                    type="text"
                    value={executeInput}
                    onChange={(e) => setExecuteInput(e.target.value)}
                    placeholder={targetType === 'model' ? 'Prompt…' : targetType === 'deterministic' && targetRef === 'memory.search' ? 'Search query…' : 'Input (if applicable)…'}
                    className="w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white placeholder-[#5F6589] focus:outline-none focus:border-[#00D26A]"
                  />
                  <button
                    onClick={() => handleExecute(activeSkill)}
                    disabled={isExecuting || !executability?.executable}
                    title={!executability?.executable ? executability?.message : undefined}
                    className="flex items-center gap-2 px-4 py-2 bg-[#00D26A]/15 hover:bg-[#00D26A]/25 disabled:opacity-40 text-[#00D26A] text-xs font-bold rounded-xl border border-[#00D26A]/30 transition cursor-pointer"
                  >
                    <Play className={`w-3.5 h-3.5 ${isExecuting ? 'animate-spin' : ''}`} />
                    <span>{isExecuting ? 'Executing…' : 'Execute Skill'}</span>
                  </button>
                  {executeResult && (
                    <div className="pt-2 border-t border-[#1C2035] space-y-1">
                      <div className={`text-[10px] font-mono font-bold ${executeResult.success ? 'text-[#00D26A]' : 'text-[#FF5E8E]'}`}>
                        {executeResult.status}
                      </div>
                      {executeResult.error && (
                        <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed bg-[#080911] p-3 rounded-lg border text-[#FF5E8E] border-[#FF5E8E]/30">
                          {executeResult.error}
                        </pre>
                      )}
                      {executeResult.success && executeResult.output !== undefined && (
                        <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed bg-[#080911] p-3 rounded-lg border text-[#E2E8F0] border-[#161828] max-h-40 overflow-y-auto">
                          {JSON.stringify(executeResult.output, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>

                {/* Test Harness — honest: no execution runtime is wired */}
                <div className="bg-[#121424] border border-[#1E2238] p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[#7E8BB5] flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5" />
                      <span>Test Execution</span>
                    </div>
                    <span className="text-[10px] font-mono text-[#5F6589]">No sandbox is wired in this deployment</span>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      onClick={() => handleRunTest(activeSkill)}
                      disabled={isTesting}
                      className="flex items-center gap-2 px-4 py-2 bg-[#615EFF] hover:bg-[#5653d9] disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg transition active:scale-95 cursor-pointer"
                    >
                      <Play className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                      <span>{isTesting ? 'Recording Attempt...' : 'Run Skill Test'}</span>
                    </button>
                    <span className="text-[10px] font-mono text-[#8E94B8]">
                      Last attempt: {activeSkill.lastTestedAt ? new Date(activeSkill.lastTestedAt).toLocaleString() : 'Never'}
                    </span>
                  </div>

                  {testResult && (
                    <div className="mt-3 pt-3 border-t border-[#1C2035] space-y-1">
                      <div className={`text-[10px] font-mono ${testResult.status === 'NOT_IMPLEMENTED' ? 'text-[#F59E0B]' : 'text-[#FF5E8E]'}`}>
                        {testResult.status}
                      </div>
                      <pre className={`text-xs font-mono whitespace-pre-wrap leading-relaxed bg-[#080911] p-3 rounded-lg border ${testResult.status === 'NOT_IMPLEMENTED' ? 'text-[#F59E0B] border-[#F59E0B]/30' : 'text-[#FF5E8E] border-[#FF5E8E]/30'}`}>
                        {testResult.message}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-12 text-center bg-[#0D0E1A] border border-[#1E2238] rounded-2xl text-[#5F6589]">
                {skills.length === 0 ? 'No skills are installed for this workspace.' : 'Select a skill from the left directory to inspect it.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Register New Skill */}
      {isAddingSkill && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0D0E1A] border border-[#1E2238] rounded-2xl w-full max-w-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#1E2238] pb-3">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-[#615EFF]" />
                <h3 className="text-sm font-bold text-white">Register Skill</h3>
              </div>
              <button onClick={() => setIsAddingSkill(false)} className="text-[#8E94B8] hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. stripe_invoice_fetcher"
                  required
                  className="w-full bg-[#141628] border border-[#1E2238] rounded-xl p-2.5 text-xs text-white font-mono placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Description</label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  placeholder="Brief description..."
                  className="w-full bg-[#141628] border border-[#1E2238] rounded-xl p-2.5 text-xs text-white placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value as SkillCategory)}
                    className="w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  >
                    <option value="mcp">MCP Server</option>
                    <option value="tool">Local Tool</option>
                    <option value="integration">API Integration</option>
                    <option value="system">System Core</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Source Reference (optional)</label>
                  <input
                    type="text"
                    value={newSourceRef}
                    onChange={e => setNewSourceRef(e.target.value)}
                    placeholder="e.g. src/services/foo.ts"
                    className="w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white font-mono placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">SKILL.md Specification (optional)</label>
                <textarea
                  value={newMarkdown}
                  onChange={e => setNewMarkdown(e.target.value)}
                  rows={4}
                  placeholder={`---\nname: my_skill\n---\n# Instructions\n1. Do XYZ`}
                  className="w-full bg-[#141628] border border-[#1E2238] rounded-xl p-2.5 text-xs text-white font-mono placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#1E2238]">
                <button
                  type="button"
                  onClick={() => setIsAddingSkill(false)}
                  className="px-4 py-2 bg-[#1E2238] text-[#8E94B8] hover:text-white rounded-lg text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#615EFF] hover:bg-[#5653d9] text-white rounded-lg text-xs font-bold transition shadow-lg shadow-[#615EFF]/20 cursor-pointer"
                >
                  Register Skill
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
