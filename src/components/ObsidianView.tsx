import React, { useState, useEffect, useCallback } from 'react';
import { ObsidianNote, ObsidianVault, AIModelInfo } from '../types';
import {
  Database, FileText, Plus, Search, Tag, Trash2, Save,
  RefreshCw, Loader2, AlertTriangle, HardDrive, Hash,
  CheckCircle2, XCircle, Network, Activity, Link as LinkIcon
} from 'lucide-react';
import { TaskStatusBadge, RetrievalBadge } from './verification/outcome';
import { ObsidianGraphMind } from './ObsidianGraphMind';
import { VaultActivitySparkline } from './VaultActivitySparkline';

interface ObsidianViewProps {
  vaults: ObsidianVault[];
  notes: ObsidianNote[];
  models: Record<string, AIModelInfo>;
  onAddNote: (title: string, content: string, tags: string[], folder?: string) => void;
  onUpdateNote: (id: string, updates: Partial<ObsidianNote>) => void;
  onDeleteNote: (id: string) => void;
  onSendToModel: (content: string, modelId: string) => void;
  activeWorkspaceId?: string;
}

interface VaultEntry {
  artifact_id: string;
  task_id: string;
  title: string;
  relative_path: string;
  content_hash: string;
  size_bytes: number;
  created_at: string;
  content_type: string;
  preview: string | null;
  task_status?: string | null;
  retrieval_status?: string | null;
  retrieval_status_reason?: string | null;
}

interface VaultEntryDetail extends VaultEntry {
  content: string | null;
}

// ---------------------------------------------------------------------------
// SYNTHOS — Vault screen.
//
// "Vault Artifacts" below is real: it reads from GET /api/vault, which is
// backed entirely by the artifacts the execution spine actually writes to
// disk (recordArtifact() in lib/persistence.ts) — the same files, same
// SHA-256 hashes, same workspace scoping used everywhere else in this app.
//
// "Quick Notes" is a separate, pre-existing feature: session-local notes
// created via onAddNote/onUpdateNote/onDeleteNote, used by other screens
// (Jarvis, Twins) as a lightweight capture tool. It is NOT backend Vault
// storage, and is labeled as such rather than implied to be the same thing.
//
// This screen does not claim a live Obsidian desktop connection — no such
// integration is wired up. That status is shown honestly as NOT_CONNECTED,
// not simulated as an active sync.
// ---------------------------------------------------------------------------

export const ObsidianView: React.FC<ObsidianViewProps> = ({
  vaults,
  notes,
  models,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onSendToModel,
  activeWorkspaceId,
}) => {
  const workspaceId = activeWorkspaceId || 'ws-synthos-primary';
  // 'mesh' restores the Obsidian Knowledge Mesh surface (animated wikilink
  // graph + real ingestion sparkline) that cd60d81 replaced and fee6fe4 then
  // deleted as orphaned code. The 'vault' and 'notes' sections below are the
  // current, real-data screens and are untouched by that restoration.
  const [activeSection, setActiveSection] = useState<'mesh' | 'vault' | 'notes'>('mesh');
  const [selectedMeshNoteId, setSelectedMeshNoteId] = useState<string | null>(null);

  // Real Vault artifacts
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<VaultEntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // -------------------------------------------------------------------
  // THE BRAIN'S REAL KNOWLEDGE, from the configured vault.
  //
  // This surface used to render the `notes` prop, which App.tsx seeds from
  // INITIAL_NOTES in src/data/mockData.ts and persists per-browser in
  // localStorage. So the knowledge graph on screen was a graph of invented
  // notes, while the real vault the Brain actually writes to was not visible
  // anywhere in the Admin.
  //
  // The visual design is unchanged — ObsidianGraphMind and
  // VaultActivitySparkline are the same restored components. Only the data
  // behind them is now real. Keep the surface, fix the data.
  // -------------------------------------------------------------------
  interface BrainVault {
    root: string | null;
    mode: string;
    source: string;
    writable: boolean;
    detail?: string;
    isObsidianIntegration: boolean;
    writeSubdirectory: string;
  }
  interface BrainNote {
    fileName: string;
    vaultRelativePath: string;
    kind: string;
    sizeBytes: number;
    modifiedAt: string;
    title: string;
    type: string | null;
    createdAt: string | null;
    workspaceId: string | null;
    source: string | null;
    sessionId: string | null;
    project: string | null;
    runtime: string | null;
    model: string | null;
    topics: string[];
    tags: string[];
    artifacts: string[];
    receipts: string[];
    generatedBy: string | null;
    wikilinks: string[];
    body: string;
    truncated: boolean;
  }

  const [brainVault, setBrainVault] = useState<BrainVault | null>(null);
  const [brainNotesRaw, setBrainNotesRaw] = useState<BrainNote[]>([]);

  // BRAIN SOURCES — the external vault layer. Fetched separately from the
  // managed mesh, and kept in its own state, because the two are different
  // CLASSES of thing: one is knowledge SynthOS wrote, the other is source
  // material the operator wrote. Merging them into one array is precisely how
  // "we retrieved it" would start to look like "we know it".
  const [externalSources, setExternalSources] = useState<Array<{
    vaultRelativePath: string; folder: string; title: string;
    classification: string; admission: string; wikilinks: string[];
    modifiedAt: string; sizeBytes: number; hasFrontmatter: boolean;
    observedFields: Record<string, string>;
  }> | null>(null);
  const [externalEdges, setExternalEdges] = useState<Array<{ source: string; target: string }>>([]);
  const [externalSummary, setExternalSummary] = useState<any>(null);
  /**
   * Whether the external index has been ASKED for yet.
   *
   * Without this, a null `externalSources` meant two different things — "we
   * have not looked" and "we looked and could not read it" — and the filter
   * label showed UNKNOWN for both. UNKNOWN is a claim about a failed read and
   * must not be used for a read that never happened.
   */
  const [externalAttempted, setExternalAttempted] = useState(false);
  const [selectedSourcePath, setSelectedSourcePath] = useState<string | null>(null);
  /** Brain | External Sources | All. The smallest useful filter, per the brief. */
  const [sourceFilter, setSourceFilter] = useState<'BRAIN' | 'EXTERNAL' | 'ALL'>('BRAIN');
  const [brainLoading, setBrainLoading] = useState(true);
  const [brainError, setBrainError] = useState<string | null>(null);
  const [selectedBrainPath, setSelectedBrainPath] = useState<string | null>(null);
  const [brainQuery, setBrainQuery] = useState('');

  const fetchBrain = useCallback(async () => {
    setBrainLoading(true);
    setBrainError(null);
    try {
      const res = await fetch(`/api/knowledge/mesh?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setBrainError(data.error || `HTTP ${res.status}`);
        setBrainNotesRaw([]);
        setBrainVault(null);
      } else {
        setBrainNotesRaw(data.notes || []);
        setBrainVault(data.vault || null);
      }
    } catch (err: any) {
      setBrainError(err?.message || 'Network error contacting the knowledge API.');
      setBrainNotesRaw([]);
      setBrainVault(null);
    } finally {
      setBrainLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchBrain(); }, [fetchBrain]);

  /**
   * Fetch the external source index.
   *
   * Only when the operator asks for it (filter is EXTERNAL or ALL). Indexing
   * 154 notes is cheap, but fetching a layer nobody is looking at on every
   * Brain mount is how a polling habit starts.
   */
  const fetchSources = useCallback(async () => {
    if (sourceFilter === 'BRAIN') return;
    setExternalAttempted(true);
    try {
      const res = await fetch(`/api/brain/sources?workspaceId=${encodeURIComponent(activeWorkspaceId || '')}&limit=400`);
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || `HTTP ${res.status}`);
      setExternalSources(Array.isArray(body.sources) ? body.sources : []);
      setExternalEdges(Array.isArray(body.graph?.edges) ? body.graph.edges : []);
      setExternalSummary(body.summary ?? null);
    } catch {
      // UNKNOWN rather than an empty layer: "we could not read the vault" and
      // "the vault has no external notes" are different facts.
      setExternalSources(null);
      setExternalEdges([]);
      setExternalSummary(null);
    }
  }, [sourceFilter, activeWorkspaceId]);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  /** Real vault notes mapped onto the shape the graph already speaks. No field is invented. */
  const brainNotes = React.useMemo<ObsidianNote[]>(
    () => brainNotesRaw.map((n) => ({
      id: n.vaultRelativePath,
      title: n.title,
      path: n.vaultRelativePath,
      folder: n.kind,
      content: n.body,
      tags: [...n.tags, ...n.topics],
      wikilinks: n.wikilinks,
      createdAt: n.createdAt || n.modifiedAt,
      updatedAt: n.modifiedAt,
      workspace: n.workspaceId || undefined,
      agent: n.source || undefined,
      model: n.model || undefined,
    })) as ObsidianNote[],
    [brainNotesRaw]
  );

  /** One vault entry describing the REAL configured vault, for the graph's vault ring. */
  const brainVaults = React.useMemo<ObsidianVault[]>(
    () => brainVault?.root
      ? [{
          id: 'vault-configured',
          name: brainVault.isObsidianIntegration ? 'Obsidian vault' : 'Local fallback vault',
          path: brainVault.root,
          notesCount: brainNotesRaw.length,
          lastSynced: brainNotesRaw[0]?.modifiedAt || 'never',
          status: brainVault.writable ? 'synced' : 'offline',
          size: `${(brainNotesRaw.reduce((a, n) => a + n.sizeBytes, 0) / 1024).toFixed(1)} KB`,
        }]
      : [],
    [brainVault, brainNotesRaw]
  );

  const filteredBrainNotes = React.useMemo(() => {
    const q = brainQuery.trim().toLowerCase();
    if (!q) return brainNotesRaw;
    return brainNotesRaw.filter((n) =>
      n.title.toLowerCase().includes(q) ||
      n.body.toLowerCase().includes(q) ||
      n.tags.some((t) => t.toLowerCase().includes(q)) ||
      n.topics.some((t) => t.toLowerCase().includes(q))
    );
  }, [brainNotesRaw, brainQuery]);

  const selectedBrainNote = React.useMemo(
    () => brainNotesRaw.find((n) => n.vaultRelativePath === selectedBrainPath) || null,
    [brainNotesRaw, selectedBrainPath]
  );

  /** Real total of [[wikilinks]] across the REAL vault notes. */
  const meshSynapseCount = React.useMemo(
    () => brainNotesRaw.reduce((acc, n) => acc + n.wikilinks.length, 0),
    [brainNotesRaw]
  );

  const fetchEntries = useCallback(async () => {
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      const res = await fetch(`/api/vault?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setEntriesError(data.error || `HTTP ${res.status}`);
        setEntries([]);
      } else {
        setEntries(data.entries || []);
      }
    } catch (err: any) {
      setEntriesError(err?.message || 'Network error contacting Vault API.');
      setEntries([]);
    } finally {
      setEntriesLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  useEffect(() => {
    if (!selectedArtifactId) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    fetch(`/api/vault/${encodeURIComponent(selectedArtifactId)}?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || data.success === false) {
          setDetailError(data.error || `HTTP ${res.status}`);
          setSelectedDetail(null);
        } else {
          setSelectedDetail(data.entry);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setDetailError(err?.message || 'Network error reading Vault entry.');
          setSelectedDetail(null);
        }
      })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedArtifactId, workspaceId]);

  const filteredEntries = entries.filter((e) =>
    !searchTerm.trim() ||
    e.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.relative_path.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Quick Notes (existing, separate, session-local feature)
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTagsInput, setNewTagsInput] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(notes[0]?.id || null);
  const selectedNote = notes.find((n) => n.id === selectedNoteId) || null;

  const handleCreateNote = () => {
    if (!newTitle.trim()) return;
    const tags = newTagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    onAddNote(newTitle.trim(), newContent, tags);
    setIsCreatingNote(false);
    setNewTitle('');
    setNewContent('');
    setNewTagsInput('');
  };

  return (
    <div className="space-y-6 font-mono pb-12">
      <div className="bg-gradient-to-r from-[#EC4899]/20 via-[#0B0D1B] to-[#615EFF]/20 border border-[#EC4899]/40 rounded-2xl p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#EC4899]/20 border border-[#EC4899]/50 flex items-center justify-center text-[#EC4899] shrink-0">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight font-['Space_Grotesk']">Obsidian Knowledge Mesh</h1>
              <p className="text-xs text-[#8E94B8] mt-1 font-sans">Workspace: <span className="text-white">{workspaceId}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="px-3 py-1 rounded-lg bg-[#8E94B8]/15 text-[#8E94B8] font-bold border border-[#8E94B8]/30 inline-flex items-center gap-1.5" title="No live Obsidian desktop application connection is wired up">
              <XCircle className="w-3.5 h-3.5" /> OBSIDIAN APP: NOT_CONNECTED
            </span>
            <button
              onClick={fetchEntries}
              disabled={entriesLoading}
              className="p-2 rounded-lg bg-[#0B0D1B] border border-[#1F2442] text-[#8E94B8] hover:text-white transition cursor-pointer disabled:opacity-50"
              title="Refresh Vault listing"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${entriesLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="flex border-t border-[#EC4899]/20 pt-4 text-xs gap-2">
          <button
            onClick={() => setActiveSection('mesh')}
            className={`px-3.5 py-2 rounded-xl font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeSection === 'mesh' ? 'bg-[#EC4899] text-white shadow-lg shadow-[#EC4899]/25' : 'bg-[#0B0D1B] text-[#8E94B8] hover:text-white border border-[#1F2442]'
            }`}
          >
            <Network className="w-3.5 h-3.5" /> KNOWLEDGE MESH
          </button>
          <button
            onClick={() => setActiveSection('vault')}
            className={`px-3.5 py-2 rounded-xl font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeSection === 'vault' ? 'bg-[#EC4899] text-white shadow-lg shadow-[#EC4899]/25' : 'bg-[#0B0D1B] text-[#8E94B8] hover:text-white border border-[#1F2442]'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" /> VAULT ARTIFACTS ({entries.length})
          </button>
          <button
            onClick={() => setActiveSection('notes')}
            className={`px-3.5 py-2 rounded-xl font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeSection === 'notes' ? 'bg-[#EC4899] text-white shadow-lg shadow-[#EC4899]/25' : 'bg-[#0B0D1B] text-[#8E94B8] hover:text-white border border-[#1F2442]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" /> QUICK NOTES ({notes.length})
          </button>
        </div>
      </div>

      {activeSection === 'mesh' && (
        <div className="space-y-6">
          {/* BRAIN SOURCES / VAULT BOUNDARY.
              The smallest useful filter, and it states the distinction rather
              than hiding it behind a toggle label. Counts are real: the
              external total comes from the live index, and the canonical count
              from the managed mesh. */}
          <div className="p-3 rounded-2xl border border-[#1E223D] bg-[#090A14] flex items-center gap-3 flex-wrap">
            <span className="text-[9px] font-mono uppercase tracking-wider text-[#8E94B8]">SOURCE</span>
            {([
              ['BRAIN', 'BRAIN', `${brainNotesRaw.length}`, '#EC4899', 'Knowledge SynthOS wrote, under SynthOS/. Admitted.'],
              ['EXTERNAL', 'EXTERNAL SOURCES', externalSources !== null ? `${externalSources.length}` : (externalAttempted ? 'UNKNOWN' : '—'), '#7E8BB5', 'Notes you wrote elsewhere in the vault. Read-only source material, NOT admitted knowledge.'],
              ['ALL', 'ALL', externalSources !== null ? `${brainNotesRaw.length + externalSources.length}` : (externalAttempted ? 'UNKNOWN' : '—'), '#8C8AFF', 'Both classes, each visually distinct.'],
            ] as const).map(([key, label, count, color, title]) => (
              <button
                key={key}
                title={title}
                onClick={() => setSourceFilter(key as 'BRAIN' | 'EXTERNAL' | 'ALL')}
                className={`px-2.5 py-1.5 rounded-lg text-[9px] font-mono uppercase tracking-wider border transition-colors ${
                  sourceFilter === key ? 'text-white' : 'text-[#8E94B8] hover:text-white'
                }`}
                style={sourceFilter === key
                  ? { backgroundColor: `${color}22`, borderColor: `${color}66` }
                  : { backgroundColor: '#0B0D1B', borderColor: '#1F2442' }}
              >
                {label} ({count})
              </button>
            ))}
            <span className="text-[9px] font-mono text-[#665F85] ml-auto">
              external vault content → observed source → reviewed/admitted → Brain knowledge
            </span>
          </div>

          {sourceFilter !== 'BRAIN' && externalSummary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                ['External sources', externalSummary.total, '#7E8BB5'],
                ['Wikilink edges', externalSummary.wikilinkEdges, '#8C8AFF'],
                ['With frontmatter', externalSummary.withFrontmatter, '#7E8BB5'],
                ['Auto-promoted', externalSummary.autoPromoted, '#00D26A'],
              ] as const).map(([label, value, color]) => (
                <div key={label} className="rounded-xl border border-[#1E223D] bg-[#090A14] px-3 py-2">
                  <div className="text-[9px] font-mono uppercase tracking-wider text-[#8E94B8]">{label}</div>
                  <div className="text-lg font-semibold mt-0.5" style={{ color }}>{value}</div>
                </div>
              ))}
            </div>
          )}

          {sourceFilter !== 'BRAIN' && externalAttempted && externalSources === null && (
            <div className="p-3 rounded-xl border border-[#EF4444]/30 bg-[#EF4444]/[.08] text-[11px] font-mono text-[#9C97B4]">
              External vault sources could not be read — UNKNOWN. This is not the same as the vault having none.
            </div>
          )}

          {selectedSourcePath && (
            <div className="p-3 rounded-2xl border border-[#7E8BB5]/40 bg-[#7E8BB5]/[.06]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider text-[#7E8BB5] bg-[#7E8BB5]/15">
                  EXTERNAL SOURCE · UNADMITTED
                </span>
                <span className="text-[11px] font-mono text-[#F1EFF9]">{selectedSourcePath}</span>
                <button onClick={() => setSelectedSourcePath(null)} className="ml-auto text-[9px] font-mono uppercase tracking-wider text-[#8E94B8] hover:text-white">CLOSE</button>
              </div>
              <div className="text-[10px] font-mono text-[#8E94B8] mt-2 leading-relaxed">
                Source material you wrote, read-only. SynthOS has observed it, not admitted it — it carries no
                provenance SynthOS recorded and has not passed the KIL admission threshold. Informational, never authority.
              </div>
            </div>
          )}
          {/* THE VAULT THE BRAIN IS ACTUALLY USING. Stated rather than
              implied: EXTERNAL is an Obsidian integration, LOCAL_FALLBACK is
              a development directory, and the difference decides whether any
              of this is the user's real knowledge. */}
          <div className={`p-4 rounded-2xl border ${
            brainVault?.isObsidianIntegration
              ? 'bg-[#00D26A]/5 border-[#00D26A]/30'
              : 'bg-[#090A14] border-[#1E223D]'
          }`}>
            {brainLoading ? (
              <span className="text-xs font-mono text-[#8E94B8]">Reading the configured vault…</span>
            ) : brainError ? (
              <div>
                <span className="text-[10px] font-mono text-[#FFB020] uppercase tracking-wider block">Vault Authority — UNKNOWN</span>
                <span className="text-xs font-mono text-[#FFB020] mt-1 block">{brainError}</span>
              </div>
            ) : brainVault ? (
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <div>
                  <span className="text-[10px] font-mono text-[#6A7097] uppercase tracking-wider block">Brain Knowledge Vault</span>
                  <span className={`text-sm font-extrabold font-mono mt-1 block ${brainVault.isObsidianIntegration ? 'text-[#00D26A]' : 'text-[#8E94B8]'}`}>
                    {brainVault.isObsidianIntegration ? 'OBSIDIAN (EXTERNAL)' : `${brainVault.mode} — not an Obsidian integration`}
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-mono text-[#6A7097] uppercase tracking-wider block">Path</span>
                  <span className="text-xs font-mono text-white mt-1 block truncate">{brainVault.root || 'UNKNOWN'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-[#6A7097] uppercase tracking-wider block">SynthOS writes only under</span>
                  <span className="text-xs font-mono text-white mt-1 block">{brainVault.writeSubdirectory}/</span>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-[#6A7097] uppercase tracking-wider block">Writable</span>
                  <span className={`text-xs font-mono mt-1 block ${brainVault.writable ? 'text-[#00D26A]' : 'text-[#FF6B6B]'}`}>
                    {brainVault.writable ? 'yes' : 'NO — writeback will fail'}
                  </span>
                </div>
              </div>
            ) : (
              <span className="text-xs font-mono text-[#8E94B8]">NOT_CONFIGURED — no vault resolved</span>
            )}
          </div>

          {/* Mesh metrics — every figure is counted from the REAL vault notes
              loaded above, never seeded and never estimated. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-4 bg-[#090A14] border border-[#1E223D] rounded-2xl">
              <span className="text-[10px] font-mono text-[#6A7097] uppercase tracking-wider block">Knowledge Notes</span>
              <span className="text-2xl font-extrabold text-white font-mono mt-1 block">
                {brainLoading ? '…' : brainError ? 'UNKNOWN' : brainNotesRaw.length}
              </span>
              <span className="text-[10px] text-[#7B82A8] font-mono mt-0.5 block">Real files in the configured vault</span>
            </div>
            <div className="p-4 bg-[#090A14] border border-[#1E223D] rounded-2xl">
              <span className="text-[10px] font-mono text-[#6A7097] uppercase tracking-wider block">Wikilink Synapses</span>
              <span className="text-2xl font-extrabold text-[#00D26A] font-mono mt-1 block">
                {brainLoading ? '…' : brainError ? 'UNKNOWN' : meshSynapseCount}
              </span>
              <span className="text-[10px] text-[#7B82A8] font-mono mt-0.5 block">Counted from note bodies</span>
            </div>
            <div className="p-4 bg-[#090A14] border border-[#1E223D] rounded-2xl">
              <span className="text-[10px] font-mono text-[#6A7097] uppercase tracking-wider block">Receipt-Backed Notes</span>
              <span className="text-2xl font-extrabold text-[#A78BFA] font-mono mt-1 block">
                {brainLoading ? '…' : brainError ? 'UNKNOWN' : brainNotesRaw.filter((n) => n.receipts.length > 0).length}
              </span>
              <span className="text-[10px] text-[#7B82A8] font-mono mt-0.5 block">Notes citing a signed receipt</span>
            </div>
            <div className="p-4 bg-[#090A14] border border-[#1E223D] rounded-2xl">
              <span className="text-[10px] font-mono text-[#6A7097] uppercase tracking-wider block">Workspace Artifacts</span>
              <span className="text-2xl font-extrabold text-[#38BDF8] font-mono mt-1 block">
                {entriesLoading ? '…' : entriesError ? 'UNKNOWN' : entries.length}
              </span>
              <span className="text-[10px] text-[#7B82A8] font-mono mt-0.5 block">A different store — see the Vault tab</span>
            </div>
          </div>

          {/* Vault Activity & Ingestion sparkline — real vault note timestamps */}
          <VaultActivitySparkline notes={brainNotes} vaults={brainVaults} />

          {/* An empty vault is shown as empty. A graph of nothing is not drawn
              as a graph of something. */}
          {!brainLoading && !brainError && brainNotes.length === 0 ? (
            <div className="p-8 bg-[#090A14] border border-dashed border-[#1E223D] rounded-2xl text-center">
              <span className="text-sm font-mono font-bold text-white block">No SynthOS knowledge notes yet</span>
              <span className="text-xs font-mono text-[#7B82A8] mt-2 block">
                {brainVault?.root
                  ? `Nothing has been written under ${brainVault.root}/${brainVault.writeSubdirectory}/ yet. The mesh renders real notes only — no sample graph is drawn.`
                  : 'No vault is configured, so there is nothing to render.'}
              </span>
            </div>
          ) : (
          /* Animated interactive wikilink graph — the restored design, real data */
          <ObsidianGraphMind
            notes={sourceFilter === 'EXTERNAL' ? [] : brainNotes}
            vaults={brainVaults}
            models={models}
            externalSources={sourceFilter === 'BRAIN' ? [] : (externalSources ?? [])}
            externalEdges={sourceFilter === 'BRAIN' ? [] : externalEdges}
            onSelectSource={(p) => setSelectedSourcePath(p)}
            selectedNoteId={selectedMeshNoteId || undefined}
            onSelectNote={(noteId) => setSelectedMeshNoteId(noteId)}
            onOpenNote={(noteId) => {
              setSelectedMeshNoteId(noteId);
              setSelectedBrainPath(noteId);
              setActiveSection('notes');
            }}
            height={560}
          />
          )}
        </div>
      )}

      {activeSection === 'vault' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1 bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-4 space-y-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#8E94B8] absolute left-2.5 top-2.5" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Filter by title or path…"
                className="w-full pl-8 pr-2 py-1.5 bg-[#070811] border border-[#1F2442] rounded-lg text-xs text-white placeholder-[#5A6083] focus:outline-none focus:border-[#EC4899]/50"
              />
            </div>

            {entriesLoading ? (
              <div className="flex items-center gap-2 text-xs text-[#8E94B8] py-4 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading Vault entries…
              </div>
            ) : entriesError ? (
              <div className="flex items-start gap-2 text-xs text-[#FF5E8E] p-3 bg-[#FF5E8E]/10 border border-[#FF5E8E]/30 rounded-lg">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {entriesError}
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <Database className="w-8 h-8 text-[#8E94B8] mx-auto opacity-40" />
                <p className="text-xs text-[#8E94B8]">
                  {entries.length === 0
                    ? 'No Vault artifacts exist for this workspace yet.'
                    : 'No entries match your filter.'}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[520px] overflow-y-auto">
                {filteredEntries.map((entry) => (
                  <button
                    key={entry.artifact_id}
                    onClick={() => setSelectedArtifactId(entry.artifact_id)}
                    className={`w-full text-left p-2.5 rounded-xl border transition cursor-pointer ${
                      selectedArtifactId === entry.artifact_id
                        ? 'bg-[#EC4899]/15 border-[#EC4899]/40'
                        : 'bg-[#070811] border-[#151728] hover:border-[#EC4899]/30'
                    }`}
                  >
                    <div className="text-xs text-white font-semibold truncate">{entry.title}</div>
                    <div className="text-[10px] text-[#8E94B8] truncate">{entry.relative_path}</div>
                    <div className="text-[10px] text-[#5A6083] mt-1">{new Date(entry.created_at).toLocaleString()}</div>
                    {(entry.retrieval_status === 'QUARANTINED' || entry.task_status === 'INCOMPLETE' || entry.task_status === 'VERIFICATION_FAILED') && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        <TaskStatusBadge status={entry.task_status} />
                        {entry.retrieval_status === 'QUARANTINED' && <RetrievalBadge retrieval={{ status: 'QUARANTINED', reason: null }} />}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="md:col-span-2 bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-5">
            {!selectedArtifactId ? (
              <div className="h-full flex items-center justify-center text-xs text-[#8E94B8] py-16 text-center">
                Select a Vault artifact to read its real content.
              </div>
            ) : detailLoading ? (
              <div className="flex items-center gap-2 text-xs text-[#8E94B8] py-16 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : detailError ? (
              <div className="flex items-start gap-2 text-xs text-[#FF5E8E] p-3 bg-[#FF5E8E]/10 border border-[#FF5E8E]/30 rounded-lg">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {detailError}
              </div>
            ) : selectedDetail ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-base font-bold text-white">{selectedDetail.title}</h2>
                  <div className="flex flex-wrap gap-3 mt-1 text-[10px] text-[#8E94B8]">
                    <span>Path: {selectedDetail.relative_path}</span>
                    <span>Size: {selectedDetail.size_bytes.toLocaleString()} bytes</span>
                    <span>Created: {new Date(selectedDetail.created_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-[#5A6083] font-mono break-all">{selectedDetail.content_hash}</div>
                  <div className="mt-1 text-[10px] text-[#5A6083]">Task: {selectedDetail.task_id} · Artifact: {selectedDetail.artifact_id}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <TaskStatusBadge status={selectedDetail.task_status} />
                    <RetrievalBadge retrieval={{ status: selectedDetail.retrieval_status || undefined, reason: selectedDetail.retrieval_status_reason ?? null }} />
                  </div>
                </div>
                <div className="p-4 bg-[#070811] border border-[#151728] rounded-xl max-h-96 overflow-y-auto">
                  {selectedDetail.content === null ? (
                    <p className="text-xs text-[#8E94B8]">This artifact's file could not be read from disk.</p>
                  ) : (
                    <pre className="text-xs text-[#D8DCF0] whitespace-pre-wrap font-sans leading-relaxed">{selectedDetail.content}</pre>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {activeSection === 'notes' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1 bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#8E94B8] uppercase font-bold">Knowledge notes — real vault files</span>
              <button
                onClick={() => setIsCreatingNote(true)}
                className="p-1.5 rounded-lg bg-[#EC4899]/20 border border-[#EC4899]/40 text-[#EC4899] hover:bg-[#EC4899] hover:text-white transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {isCreatingNote && (
              <div className="p-3 bg-[#070811] border border-[#1F2442] rounded-xl space-y-2">
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Title"
                  className="w-full px-2 py-1.5 bg-[#0B0D1B] border border-[#1F2442] rounded-lg text-xs text-white placeholder-[#5A6083]"
                />
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="Content"
                  rows={4}
                  className="w-full px-2 py-1.5 bg-[#0B0D1B] border border-[#1F2442] rounded-lg text-xs text-white placeholder-[#5A6083] resize-none"
                />
                <input
                  value={newTagsInput}
                  onChange={(e) => setNewTagsInput(e.target.value)}
                  placeholder="tags, comma, separated"
                  className="w-full px-2 py-1.5 bg-[#0B0D1B] border border-[#1F2442] rounded-lg text-xs text-white placeholder-[#5A6083]"
                />
                <div className="flex gap-2">
                  <button onClick={handleCreateNote} className="flex-1 py-1.5 bg-[#EC4899] text-white text-xs font-bold rounded-lg cursor-pointer flex items-center justify-center gap-1">
                    <Save className="w-3 h-3" /> Save
                  </button>
                  <button onClick={() => setIsCreatingNote(false)} className="px-3 py-1.5 bg-[#0B0D1B] border border-[#1F2442] text-[#8E94B8] text-xs rounded-lg cursor-pointer">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* REAL knowledge notes from the configured vault. The list used
                to render the session-local `notes` prop (seeded from
                mockData), which is why the Brain's actual knowledge was
                invisible here. */}
            <div className="pt-1">
              <input
                value={brainQuery}
                onChange={(e) => setBrainQuery(e.target.value)}
                placeholder="Search knowledge notes…"
                className="w-full px-2 py-1.5 bg-[#070811] border border-[#1F2442] rounded-lg text-xs text-white placeholder-[#5A6083]"
              />
            </div>

            {brainLoading ? (
              <p className="text-xs text-[#8E94B8] text-center py-6">Reading the vault…</p>
            ) : brainError ? (
              <p className="text-xs text-[#FFB020] text-center py-6">UNKNOWN — {brainError}</p>
            ) : filteredBrainNotes.length === 0 ? (
              <p className="text-xs text-[#8E94B8] text-center py-6">
                {brainNotesRaw.length === 0 ? 'No SynthOS knowledge notes in the vault yet.' : 'No note matches that search.'}
              </p>
            ) : (
              <div className="space-y-1.5 max-h-[440px] overflow-y-auto">
                {filteredBrainNotes.map((note) => (
                  <button
                    key={note.vaultRelativePath}
                    onClick={() => setSelectedBrainPath(note.vaultRelativePath)}
                    className={`w-full text-left p-2.5 rounded-xl border transition cursor-pointer ${
                      selectedBrainPath === note.vaultRelativePath ? 'bg-[#EC4899]/15 border-[#EC4899]/40' : 'bg-[#070811] border-[#151728] hover:border-[#EC4899]/30'
                    }`}
                  >
                    <div className="text-xs text-white font-semibold truncate">{note.title}</div>
                    <div className="text-[9px] font-mono text-[#6A7097] mt-0.5 truncate">{note.kind} · {note.modifiedAt.slice(0, 10)}</div>
                    {(note.tags.length > 0 || note.topics.length > 0) && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {[...note.tags, ...note.topics].slice(0, 3).map((t) => (
                          <span key={t} className="text-[9px] px-1.5 py-0.5 bg-[#EC4899]/10 text-[#EC4899] rounded flex items-center gap-0.5">
                            <Hash className="w-2 h-2" />{t}
                          </span>
                        ))}
                      </div>
                    )}
                    {note.receipts.length > 0 && (
                      <div className="text-[9px] font-mono text-[#A78BFA] mt-1">{note.receipts.length} signed receipt(s)</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="md:col-span-2 bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-5">
            {!selectedBrainNote ? (
              <div className="h-full flex items-center justify-center text-xs text-[#8E94B8] py-16 text-center">
                Select a knowledge note to see its provenance and content.
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <h2 className="text-base font-bold text-white">{selectedBrainNote.title}</h2>
                  <p className="text-[10px] font-mono text-[#6A7097] mt-1 break-all">{selectedBrainNote.vaultRelativePath}</p>
                </div>

                {/* PROVENANCE. Every field is read from the note's own
                    frontmatter; an absent field reads UNKNOWN rather than
                    being filled in with something plausible. */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                  {([
                    ['Source', selectedBrainNote.source],
                    ['Workspace', selectedBrainNote.workspaceId],
                    ['Runtime', selectedBrainNote.runtime],
                    ['Model', selectedBrainNote.model],
                    ['Session', selectedBrainNote.sessionId],
                    ['Written by', selectedBrainNote.generatedBy],
                  ] as Array<[string, string | null]>).map(([label, value]) => (
                    <div key={label} className="p-2 bg-[#070811] border border-[#151728] rounded-lg">
                      <span className="text-[9px] font-mono text-[#6A7097] uppercase tracking-wider block">{label}</span>
                      <span className={`text-[11px] font-mono mt-0.5 block truncate ${value ? 'text-white' : 'text-[#585E82]'}`}>
                        {value || 'UNKNOWN'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Relationships back to the evidence spine — only what the
                    note actually cites. */}
                {(selectedBrainNote.artifacts.length > 0 || selectedBrainNote.receipts.length > 0 || selectedBrainNote.wikilinks.length > 0) && (
                  <div className="p-3 bg-[#070811] border border-[#151728] rounded-xl space-y-2">
                    {selectedBrainNote.artifacts.length > 0 && (
                      <div>
                        <span className="text-[9px] font-mono text-[#6A7097] uppercase tracking-wider">Derived from artifacts</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedBrainNote.artifacts.map((a) => (
                            <span key={a} className="text-[9px] font-mono px-1.5 py-0.5 bg-[#38BDF8]/10 text-[#38BDF8] rounded break-all">{a}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedBrainNote.receipts.length > 0 && (
                      <div>
                        <span className="text-[9px] font-mono text-[#6A7097] uppercase tracking-wider">Attested by receipts</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedBrainNote.receipts.map((r) => (
                            <span key={r} className="text-[9px] font-mono px-1.5 py-0.5 bg-[#A78BFA]/10 text-[#A78BFA] rounded break-all">{r}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedBrainNote.wikilinks.length > 0 && (
                      <div>
                        <span className="text-[9px] font-mono text-[#6A7097] uppercase tracking-wider">Wikilinks</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedBrainNote.wikilinks.map((w) => (
                            <span key={w} className="text-[9px] font-mono px-1.5 py-0.5 bg-[#00D26A]/10 text-[#00D26A] rounded">[[{w}]]</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="p-4 bg-[#070811] border border-[#151728] rounded-xl max-h-96 overflow-y-auto">
                  <pre className="text-xs text-[#D8DCF0] whitespace-pre-wrap font-sans leading-relaxed">{selectedBrainNote.body}</pre>
                  {selectedBrainNote.truncated && (
                    <p className="text-[10px] font-mono text-[#FFB020] mt-2">Truncated at the read ceiling — this is not the whole note.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
