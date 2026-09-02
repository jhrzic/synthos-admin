import React, { useState, useCallback } from 'react';
import { AgentInfo, AIModelInfo, ObsidianNote } from '../types';
import { Search, Loader2, AlertTriangle, FileText, RefreshCw, Database, ExternalLink } from 'lucide-react';

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

// ---------------------------------------------------------------------------
// SYNTHOS — Memory search.
//
// Real SQLite FTS5 search over the same Vault artifacts shown in the Vault
// screen (see lib/memory-index.ts). An artifact is indexed automatically
// once its task completes with Aegis verification and a signed receipt —
// there is no separate "agent memory file" system with its own storage;
// that concept doesn't exist as a real backend anywhere in this app, so it
// is not simulated here either.
// ---------------------------------------------------------------------------

export const AgentMemoryView: React.FC<AgentMemoryViewProps> = ({
  onSelectTab,
  activeWorkspaceId,
}) => {
  const workspaceId = activeWorkspaceId || 'ws-synthos-primary';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemorySearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexNotice, setReindexNotice] = useState<string | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setHasSearched(true);
      return;
    }
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
        if (hasSearched && query.trim()) runSearch(query);
      } else {
        setReindexNotice(`FAILED — ${data.error || `HTTP ${res.status}`}`);
      }
    } catch (err: any) {
      setReindexNotice(`FAILED — ${err?.message || 'network error'}`);
    } finally {
      setReindexing(false);
    }
  };

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
                Local SQLite FTS5 search over real Vault content · Workspace: <span className="text-white">{workspaceId}</span>
              </p>
            </div>
          </div>
          <button
            onClick={handleReindex}
            disabled={reindexing}
            className="px-3 py-1.5 rounded-lg bg-[#0B0D1B] border border-[#1F2442] text-[#8E94B8] hover:text-white transition cursor-pointer disabled:opacity-50 text-xs font-bold flex items-center gap-1.5"
            title="Rebuild the index from what's currently in this workspace's Vault"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reindexing ? 'animate-spin' : ''}`} /> REINDEX
          </button>
        </div>
        {reindexNotice && <p className="text-[11px] text-[#8E94B8]">{reindexNotice}</p>}

        <div className="relative">
          <Search className="w-4 h-4 text-[#8E94B8] absolute left-3 top-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(query); }}
            placeholder="Search real Vault content for this workspace…"
            className="w-full pl-10 pr-24 py-2.5 bg-[#070811] border border-[#1F2442] rounded-xl text-sm text-white placeholder-[#5A6083] focus:outline-none focus:border-[#615EFF]/50"
          />
          <button
            onClick={() => runSearch(query)}
            disabled={loading}
            className="absolute right-1.5 top-1.5 px-3 py-1.5 bg-[#615EFF] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Search'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-[#FF5E8E]/10 border border-[#FF5E8E]/30 rounded-2xl p-4 flex items-start gap-2 text-xs text-[#FF5E8E]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {hasSearched && !error && (
        <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-5">
          {results === null || results.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <Database className="w-8 h-8 text-[#8E94B8] mx-auto opacity-40" />
              <p className="text-xs text-[#8E94B8]">
                {!query.trim()
                  ? 'Enter a search term to query this workspace\'s indexed Vault content.'
                  : 'No indexed content matches this query in this workspace.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-[10px] text-[#8E94B8] uppercase font-bold">{results.length} result{results.length === 1 ? '' : 's'}</div>
              {results.map((r) => (
                <div key={r.artifact_id} className="p-3.5 bg-[#070811] border border-[#151728] rounded-xl space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-white font-semibold">
                      <FileText className="w-3.5 h-3.5 text-[#615EFF] shrink-0" />
                      {r.title}
                    </div>
                    <button
                      onClick={() => onSelectTab('obsidian')}
                      className="text-[10px] text-[#8E94B8] hover:text-white flex items-center gap-1 cursor-pointer shrink-0"
                      title="Open in Vault"
                    >
                      Open in Vault <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                  <p
                    className="text-[11px] text-[#A3A8CC] leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: highlightSnippet(r.snippet) }}
                  />
                  <div className="flex gap-3 text-[10px] text-[#5A6083]">
                    <span>{r.source_path}</span>
                    <span>{new Date(r.updated_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
