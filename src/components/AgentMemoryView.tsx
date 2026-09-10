import React, { useState, useCallback, useEffect } from 'react';
import { AgentInfo, AIModelInfo, ObsidianNote } from '../types';
import {
  Search, Loader2, AlertTriangle, FileText, RefreshCw, Database, ExternalLink,
  Bot, HardDrive, Save, Share2, Layers, Ban, CheckCircle2
} from 'lucide-react';

/**
 * FTS5's snippet() returns plain text from real Vault content — which
 * ultimately originates from LLM task output, not something to trust as
 * pre-sanitized HTML. Escape it before ever touching innerHTML, then apply
 * the `[`/`]` match-highlight markers (chosen as snippet() delimiters
 * specifically because they aren't HTML metacharacters, so this ordering is
 * safe) on the escaped text.
 */
function highlightSnippet(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return escaped
    .replace(/\[/g, '<mark class="bg-[#615EFF]/30 text-white rounded px-0.5">')
    .replace(/\]/g, '</mark>');
}

interface AgentMemoryViewProps {
  agents: Record<string, AgentInfo>;
  models: Record<string, AIModelInfo>;
  notes: ObsidianNote[];
  onAddNoteToVault: (title: string, content: string, tags: string[]) => void;
  onSendQuery: (query: string, model: string) => Promise<string>;
  onSelectTab: (tab: any) => void;
  activeWorkspaceId?: string;
}

interface MemorySearchResult {
  artifact_id: string;
  workspace_id: string;
  title: string;
  snippet: string;
  source_path: string;
  updated_at: string;
}

interface VaultEntryDetail {
  artifact_id: string;
  title: string;
  relative_path: string;
  content: string | null;
  created_at: string;
  size_bytes: number;
}

// ---------------------------------------------------------------------------
// SYNTHOS — Memory workspace.
//
// This is the historical "Long-Term Agent Memory Subsystem" information
// architecture (agent roster · document list · document viewer · export)
// rebuilt over the CURRENT canonical backend instead of the mock data it
// originally carried.
//
// WHAT HAPPENED. cd60d81 rewrote this screen from that rich IA down to a bare
// search box, because everything it displayed was fabricated: a seeded agent-
// memory roster, invented per-agent memory sizes, invented "vector synapse"
// counts, an invented telemetry latency, a fabricated sub-15ms change-data-
// capture status and an invented file-watcher event stream. Removing those
// numbers was correct. Removing the whole product surface with them was the
// regression — see CLAUDE.md, Product Preservation. (The exact fabricated
// field names are deliberately not repeated here; test/memory-workspace-ui
// asserts none of them reappear in this file.)
//
// WHAT IS REAL HERE, AND WHAT IS NOT:
//   REAL — the FTS5 search (/api/memory/search), reindex (/api/memory/reindex),
//          the document list it returns, document content read back from the
//          Vault (/api/vault/:artifactId), the agent roster (live agents), and
//          Export to Vault (the canonical vault writer).
//   NOT AVAILABLE — per-agent memory FILES. There is no agents/:id/files or
//          soul route and no per-agent memory store anywhere in this app. The
//          roster is shown because it is real; its per-agent file panel states
//          NOT AVAILABLE rather than inventing per-agent markdown filenames,
//          file sizes, memory sizes, synapse counts or ingestion counts.
//   NOT IMPLEMENTED — Compact Memory. The audit established it never existed
//          as a functioning feature (only an isCompacting flag), so the
//          control is present for design continuity and permanently disabled.
// ---------------------------------------------------------------------------

export const AgentMemoryView: React.FC<AgentMemoryViewProps> = ({
  agents,
  models,
  notes,
  onAddNoteToVault,
  onSendQuery,
  onSelectTab,
  activeWorkspaceId,
}) => {
  const workspaceId = activeWorkspaceId || 'ws-synthos-primary';

  // --- FTS5 search (unchanged, real) ---
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemorySearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexNotice, setReindexNotice] = useState<string | null>(null);

  // --- restored IA state ---
  const [selectedAgentKey, setSelectedAgentKey] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<MemorySearchResult | null>(null);
  const [docDetail, setDocDetail] = useState<VaultEntryDetail | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const runSearch = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/memory/search?workspaceId=${encodeURIComponent(workspaceId)}&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setError(data.error || `HTTP ${res.status}`);
        setResults(null);
      } else {
        setResults(data.results || []);
      }
    } catch (err: any) {
      setError(err?.message || 'Network error contacting Memory search API.');
      setResults(null);
    } finally {
      setLoading(false);
      setHasSearched(true);
    }
  }, [workspaceId]);

  /** Browse the real indexed corpus when there is no search term. */
  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/memory/documents?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setError(data.error || `HTTP ${res.status}`);
        setResults(null);
      } else {
        setResults(data.results || []);
      }
    } catch (err: any) {
      setError(err?.message || 'Network error contacting the Memory API.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  // The list panel shows the real indexed corpus on arrival. An empty FTS5
  // query legitimately matches nothing, so browsing must not go through
  // search — otherwise a populated index would render as "no indexed memory".
  useEffect(() => { void loadDocuments(); }, [loadDocuments]);

  const submitSearch = useCallback((q: string) => {
    if (q.trim()) { setHasSearched(true); void runSearch(q); }
    else { setHasSearched(false); void loadDocuments(); }
  }, [runSearch, loadDocuments]);

  const handleReindex = async () => {
    setReindexing(true);
    setReindexNotice(null);
    try {
      const res = await fetch('/api/memory/reindex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setReindexNotice(`Reindexed ${data.indexed} artifact(s), skipped ${data.skipped}.`);
        submitSearch(query);
      } else {
        setReindexNotice(`FAILED — ${data.error || `HTTP ${res.status}`}`);
      }
    } catch (err: any) {
      setReindexNotice(`FAILED — ${err?.message || 'network error'}`);
    } finally {
      setReindexing(false);
    }
  };

  /** Reads the real artifact body back from the Vault — the historical "memory file" viewer, over real content. */
  const openDoc = useCallback(async (doc: MemorySearchResult) => {
    setSelectedDoc(doc);
    setDocDetail(null);
    setDocError(null);
    setDocLoading(true);
    try {
      const res = await fetch(`/api/vault/${encodeURIComponent(doc.artifact_id)}?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setDocError(data.error || `HTTP ${res.status}`);
      } else {
        setDocDetail(data.entry || null);
      }
    } catch (err: any) {
      setDocError(err?.message || 'Network error reading the document.');
    } finally {
      setDocLoading(false);
    }
  }, [workspaceId]);

  /** Real Export to Vault via the canonical vault writer (App -> /api/vault/notes). */
  const handleExport = () => {
    if (!docDetail?.content) return;
    onAddNoteToVault(
      `Memory export — ${docDetail.title}`,
      docDetail.content,
      ['memory', 'export', workspaceId]
    );
    setExportNotice(`Exported "${docDetail.title}" to the Vault.`);
    setTimeout(() => setExportNotice(null), 5000);
  };

  const agentList = Object.entries(agents || {});
  const docs = results || [];

  return (
    <div className="space-y-6 font-mono pb-12">
      <div className="bg-gradient-to-r from-[#615EFF]/20 via-[#0B0D1B] to-[#EC4899]/20 border border-[#615EFF]/40 rounded-2xl p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#615EFF]/20 border border-[#615EFF]/50 flex items-center justify-center text-[#615EFF] shrink-0">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight font-['Space_Grotesk']">Memory</h1>
              <p className="text-xs text-[#8E94B8] mt-1 font-sans">
                SQLite FTS5 index over real Vault content · Workspace: <span className="text-white">{workspaceId}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Retained for product-design continuity, permanently disabled:
                Compact Memory never existed as a functioning feature. */}
            <button
              disabled
              title="Compact Memory has no implementation — there is no memory compaction backend in this app."
              className="px-3 py-1.5 rounded-lg bg-[#0B0D1B] border border-[#1F2442] text-[#4C5274] text-xs font-bold flex items-center gap-1.5 cursor-not-allowed"
            >
              <Ban className="w-3.5 h-3.5" /> COMPACT · NOT IMPLEMENTED
            </button>
            <button
              onClick={handleReindex}
              disabled={reindexing}
              className="px-3 py-1.5 rounded-lg bg-[#0B0D1B] border border-[#1F2442] text-[#8E94B8] hover:text-white transition cursor-pointer disabled:opacity-50 text-xs font-bold flex items-center gap-1.5"
              title="Rebuild the index from what's currently in this workspace's Vault"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reindexing ? 'animate-spin' : ''}`} /> REINDEX
            </button>
          </div>
        </div>

        {reindexNotice && (
          <div className={`text-[11px] font-mono ${reindexNotice.startsWith('FAILED') ? 'text-[#FF6B6B]' : 'text-[#00D26A]'}`}>
            {reindexNotice}
          </div>
        )}
        {exportNotice && (
          <div className="text-[11px] font-mono text-[#00D26A] flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> {exportNotice}
          </div>
        )}

        <div className="relative border-t border-[#615EFF]/20 pt-4">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 mt-2 -translate-y-1/2 text-[#4C5274]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitSearch(query); }}
            placeholder="Search real Vault content for this workspace…"
            className="w-full bg-[#090A16] border border-[#1E223D] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-[#4C5274] focus:outline-none focus:border-[#615EFF]"
          />
        </div>
      </div>

      <div className="grid lg:grid-cols-[240px_minmax(0,1fr)_minmax(0,1.1fr)] gap-4">
        {/* ---- Agent roster (real agents; per-agent memory files have no backend) ---- */}
        <div className="border border-[#1F2442] rounded-2xl bg-[#080A16] overflow-hidden">
          <div className="px-3 py-2.5 border-b border-[#1F2442] flex items-center gap-2">
            <Bot className="w-3.5 h-3.5 text-[#8C8AFF]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-white">Agents</span>
            <span className="text-[10px] text-[#6A7097] ml-auto">{agentList.length}</span>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {agentList.length === 0 && (
              <div className="p-3 text-[11px] text-[#6A7097]">No agents in this workspace.</div>
            )}
            {agentList.map(([key, agent]) => (
              <button
                key={key}
                onClick={() => setSelectedAgentKey(selectedAgentKey === key ? null : key)}
                className={`w-full text-left px-3 py-2 border-b border-[#141628] transition cursor-pointer ${
                  selectedAgentKey === key ? 'bg-[#615EFF]/15' : 'hover:bg-[#0E1120]'
                }`}
              >
                <div className="text-[11px] text-white font-bold truncate">{agent?.name || key}</div>
                <div className="text-[10px] text-[#6A7097] truncate">{agent?.role || 'UNKNOWN'}</div>
              </button>
            ))}
          </div>
          {selectedAgentKey && (
            <div className="p-3 border-t border-[#1F2442] bg-[#05060C] space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#6A7097] flex items-center gap-1.5">
                <HardDrive className="w-3 h-3" /> Memory Files
              </div>
              {/* No agents/:id/files or soul route exists. Stating that is the
                  honest alternative to inventing per-agent file names and sizes. */}
              <div className="text-[11px] text-[#7E8BB5]">NOT AVAILABLE</div>
              <div className="text-[10px] text-[#6A7097] leading-relaxed">
                Per-agent memory files have no backend in this app. Workspace memory below is real and shared.
              </div>
            </div>
          )}
        </div>

        {/* ---- Document list (real FTS5 corpus) ---- */}
        <div className="border border-[#1F2442] rounded-2xl bg-[#080A16] overflow-hidden">
          <div className="px-3 py-2.5 border-b border-[#1F2442] flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-[#38BDF8]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-white">
              {hasSearched && query.trim() ? 'Search Results' : 'Indexed Memory'}
            </span>
            <span className="text-[10px] text-[#6A7097] ml-auto">{loading ? '…' : docs.length}</span>
          </div>

          {loading && (
            <div className="p-6 text-center text-[11px] text-[#8E94B8] flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
            </div>
          )}

          {!loading && error && (
            <div className="m-3 p-3 bg-[#FF6B6B]/10 border border-[#FF6B6B]/40 rounded-xl text-[11px] text-[#FF6B6B] flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div><div className="font-bold uppercase">Search failed</div><div className="text-[#C98B8B]">{error}</div></div>
            </div>
          )}

          {!loading && !error && docs.length === 0 && (
            <div className="p-6 text-center">
              <FileText className="w-6 h-6 text-[#2D3352] mx-auto mb-2" />
              <p className="text-[11px] text-[#8E94B8]">
                {query.trim() ? 'No indexed content matches this search.' : 'No indexed memory in this workspace yet.'}
              </p>
              <p className="text-[10px] text-[#6A7097] mt-1">
                An artifact is indexed once its task completes with Aegis verification and a signed receipt.
              </p>
            </div>
          )}

          <div className="max-h-[520px] overflow-y-auto">
            {!loading && !error && docs.map((d) => (
              <button
                key={d.artifact_id}
                onClick={() => openDoc(d)}
                className={`w-full text-left px-3 py-2.5 border-b border-[#141628] transition cursor-pointer ${
                  selectedDoc?.artifact_id === d.artifact_id ? 'bg-[#615EFF]/15' : 'hover:bg-[#0E1120]'
                }`}
              >
                <div className="text-[11px] text-white font-bold truncate">{d.title}</div>
                <div
                  className="text-[10px] text-[#8E94B8] mt-0.5 line-clamp-2"
                  dangerouslySetInnerHTML={{ __html: highlightSnippet(d.snippet || '') }}
                />
                <div className="text-[9px] text-[#4C5274] mt-1 truncate">{d.source_path}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ---- Document viewer (historical editor pane, over real Vault content) ---- */}
        <div className="border border-[#1F2442] rounded-2xl bg-[#080A16] overflow-hidden flex flex-col">
          <div className="px-3 py-2.5 border-b border-[#1F2442] flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-[#00D26A]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-white truncate">
              {selectedDoc ? selectedDoc.title : 'Document'}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              {/* Artifacts are immutable, content-hashed and receipted — there is
                  no write-back route, so this is disabled rather than faked. */}
              <button
                disabled
                title="Vault artifacts are immutable and content-hashed. There is no edit/write-back route."
                className="px-2 py-1 rounded-lg bg-[#0B0D1B] border border-[#1F2442] text-[#4C5274] text-[10px] font-bold flex items-center gap-1 cursor-not-allowed"
              >
                <Save className="w-3 h-3" /> READ-ONLY
              </button>
              <button
                onClick={handleExport}
                disabled={!docDetail?.content}
                title="Write a copy of this document into the Vault via the canonical vault writer"
                className="px-2 py-1 rounded-lg bg-[#0B0D1B] border border-[#EC4899]/40 text-[#EC4899] text-[10px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Share2 className="w-3 h-3" /> EXPORT TO VAULT
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-[300px] max-h-[520px] overflow-y-auto p-3">
            {!selectedDoc && (
              <div className="h-full flex items-center justify-center text-[11px] text-[#6A7097] text-center px-4">
                Select an indexed document to read its real Vault content.
              </div>
            )}
            {selectedDoc && docLoading && (
              <div className="text-[11px] text-[#8E94B8] flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading document…</div>
            )}
            {selectedDoc && !docLoading && docError && (
              <div className="p-3 bg-[#FF6B6B]/10 border border-[#FF6B6B]/40 rounded-xl text-[11px] text-[#FF6B6B]">
                <div className="font-bold uppercase">Could not read document</div>
                <div className="text-[#C98B8B] mt-0.5">{docError}</div>
              </div>
            )}
            {selectedDoc && !docLoading && !docError && docDetail && (
              <>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] mb-3 pb-3 border-b border-[#141628]">
                  <Meta label="Artifact" value={docDetail.artifact_id} />
                  <Meta label="Path" value={docDetail.relative_path} />
                  <Meta label="Created" value={docDetail.created_at ? new Date(docDetail.created_at).toLocaleString() : null} />
                  <Meta label="Size" value={typeof docDetail.size_bytes === 'number' ? `${docDetail.size_bytes} bytes` : null} />
                </div>
                <pre className="text-[11px] text-[#C9CCE4] whitespace-pre-wrap break-words leading-relaxed">
                  {docDetail.content ?? 'NOT AVAILABLE — this artifact has no readable text content.'}
                </pre>
              </>
            )}
          </div>

          <div className="px-3 py-2 border-t border-[#1F2442] flex items-center justify-between">
            <span className="text-[10px] text-[#6A7097]">Backed by the workspace Vault</span>
            <button
              onClick={() => onSelectTab('obsidian')}
              className="text-[10px] text-[#8C8AFF] hover:text-white transition cursor-pointer flex items-center gap-1"
            >
              Open Vault <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Meta: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div className="flex items-start gap-1.5 min-w-0">
    <span className="text-[#6A7097] shrink-0">{label}:</span>
    <span className="text-[#8E94B8] truncate">{value || 'UNKNOWN'}</span>
  </div>
);

export default AgentMemoryView;
