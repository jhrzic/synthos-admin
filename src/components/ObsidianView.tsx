import React, { useState, useEffect, useCallback } from 'react';
import { ObsidianNote, ObsidianVault, AIModelInfo } from '../types';
import {
  Database, FileText, Plus, Search, Tag, Trash2, Save,
  RefreshCw, Loader2, AlertTriangle, HardDrive, Hash,
  CheckCircle2, XCircle
} from 'lucide-react';

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
  const [activeSection, setActiveSection] = useState<'vault' | 'notes'>('vault');

  // Real Vault artifacts
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<VaultEntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

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
              <h1 className="text-xl font-bold text-white tracking-tight font-['Space_Grotesk']">Vault</h1>
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
              <span className="text-[10px] text-[#8E94B8] uppercase font-bold">Session-local, not backend Vault storage</span>
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

            {notes.length === 0 ? (
              <p className="text-xs text-[#8E94B8] text-center py-6">No quick notes yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-[440px] overflow-y-auto">
                {notes.map((note) => (
                  <button
                    key={note.id}
                    onClick={() => setSelectedNoteId(note.id)}
                    className={`w-full text-left p-2.5 rounded-xl border transition cursor-pointer ${
                      selectedNoteId === note.id ? 'bg-[#EC4899]/15 border-[#EC4899]/40' : 'bg-[#070811] border-[#151728] hover:border-[#EC4899]/30'
                    }`}
                  >
                    <div className="text-xs text-white font-semibold truncate">{note.title}</div>
                    {note.tags && note.tags.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {note.tags.slice(0, 3).map((t) => (
                          <span key={t} className="text-[9px] px-1.5 py-0.5 bg-[#EC4899]/10 text-[#EC4899] rounded flex items-center gap-0.5">
                            <Hash className="w-2 h-2" />{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="md:col-span-2 bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-5">
            {!selectedNote ? (
              <div className="h-full flex items-center justify-center text-xs text-[#8E94B8] py-16 text-center">
                Select or create a quick note.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white">{selectedNote.title}</h2>
                  <button
                    onClick={() => { onDeleteNote(selectedNote.id); setSelectedNoteId(null); }}
                    className="p-1.5 rounded-lg bg-[#FF5E8E]/10 border border-[#FF5E8E]/30 text-[#FF5E8E] hover:bg-[#FF5E8E]/20 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="p-4 bg-[#070811] border border-[#151728] rounded-xl max-h-96 overflow-y-auto">
                  <pre className="text-xs text-[#D8DCF0] whitespace-pre-wrap font-sans leading-relaxed">{selectedNote.content}</pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
