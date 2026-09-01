import React, { useState } from 'react';
import { ObsidianNote, ObsidianVault, ActiveTab } from '../types';
import { 
  Database, FileText, Search, Plus, ExternalLink, 
  Tag, Link2, Share2, ArrowRight, CheckCircle2, 
  Folder, RefreshCw, Eye, Edit3, Trash2
} from 'lucide-react';

interface ContentLibraryViewProps {
  notes: ObsidianNote[];
  vaults: ObsidianVault[];
  onAddNote: (title: string, content: string, tags?: string[], folder?: string) => void;
  onUpdateNote: (id: string, updates: Partial<ObsidianNote>) => void;
  onDeleteNote: (id: string) => void;
  onSelectTab: (tab: ActiveTab) => void;
}

export const ContentLibraryView: React.FC<ContentLibraryViewProps> = ({
  notes,
  vaults,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onSelectTab,
}) => {
  const [selectedNoteId, setSelectedNoteId] = useState<string>(notes[0]?.id || 'note-startup-thesis-1');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saveToast, setSaveToast] = useState(false);

  // New Note Modal
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newFolder, setNewFolder] = useState('Startup-Theses');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('startup, ai-agent, thesis');

  const selectedNote = notes.find(n => n.id === selectedNoteId) || notes[0];

  const allTags = Array.from(new Set(notes.flatMap(n => n.tags)));

  const filteredNotes = notes.filter(note => {
    const matchesSearch = note.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          note.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTag = !selectedTag || note.tags.includes(selectedTag);
    return matchesSearch && matchesTag;
  });

  const handleStartEdit = () => {
    if (selectedNote) {
      setEditContent(selectedNote.content);
      setIsEditing(true);
    }
  };

  const handleSaveEdit = () => {
    if (selectedNote) {
      onUpdateNote(selectedNote.id, { content: editContent });
      setIsEditing(false);
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 3000);
    }
  };

  const handleCreateNoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const tags = newTags.split(',').map(t => t.trim()).filter(Boolean);
    onAddNote(newTitle, newContent, tags, newFolder);
    setIsCreatingNote(false);
    setNewTitle('');
    setNewContent('');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#080913] border border-[#1A1D30] p-6 rounded-2xl">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2">
            <span className="airbyte-badge">
              OBSIDIAN VAULT KNOWLEDGE REPOSITORY
            </span>
            <span className="text-[10px] font-mono text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded border border-[#00D26A]/30">
              {notes.length} DOCUMENTS VECTORIZED
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white font-['Space_Grotesk']">
            Startup Theses & Multi-Agent Content Library
          </h2>
          <p className="text-xs text-[#8E94B8]">
            Curated investment memos, technical POCs, and research syntheses authoritatively scribed by Scribe, Scout, Analytics, and Dev.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onSelectTab('obsidian')}
            className="airbyte-btn-secondary px-3.5 py-2 text-xs font-semibold flex items-center gap-2"
          >
            <Database className="w-3.5 h-3.5 text-[#615EFF]" />
            <span>3D Knowledge Graph</span>
          </button>

          <button
            onClick={() => setIsCreatingNote(true)}
            className="airbyte-btn-primary px-4 py-2 text-xs font-bold flex items-center gap-2"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>NEW NOTE</span>
          </button>
        </div>
      </div>

      {saveToast && (
        <div className="p-3 bg-[#00D26A]/10 border border-[#00D26A]/30 rounded-xl text-xs font-mono text-[#00D26A] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>Note updated and synchronized with Obsidian Vault.</span>
        </div>
      )}

      {/* Main 2-Pane Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Pane: Notes Directory & Search */}
        <div className="lg:col-span-5 bg-[#070810] border border-[#181B2E] rounded-2xl p-4 space-y-4 shadow-lg">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#585E82] absolute left-3 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search library, wikilinks, tags..."
              className="w-full bg-[#05060C] border border-[#1E223D] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
            />
          </div>

          {/* Tags */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => setSelectedTag(null)}
              className={`px-2 py-0.5 text-[10px] font-mono rounded ${
                selectedTag === null ? 'bg-[#615EFF] text-white font-bold' : 'bg-[#121424] text-[#8E94B8]'
              }`}
            >
              ALL
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                className={`px-2 py-0.5 text-[10px] font-mono rounded whitespace-nowrap ${
                  selectedTag === tag ? 'bg-[#615EFF] text-white font-bold' : 'bg-[#121424] text-[#8E94B8] hover:text-white'
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>

          {/* Notes List */}
          <div className="space-y-2 max-h-[580px] overflow-y-auto pr-1">
            {filteredNotes.map((note) => {
              const isSelected = selectedNote?.id === note.id;
              return (
                <div
                  key={note.id}
                  onClick={() => {
                    setSelectedNoteId(note.id);
                    setIsEditing(false);
                  }}
                  className={`p-3.5 rounded-xl border transition cursor-pointer flex flex-col justify-between space-y-2 ${
                    isSelected
                      ? 'bg-[#0F1122] border-[#615EFF] shadow-md'
                      : 'bg-[#05060B] border-[#141624] hover:border-[#242844]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-xs font-bold text-white font-mono leading-snug truncate">
                      {note.title}
                    </h4>
                    <span className="text-[9px] font-mono text-[#585E82] shrink-0">
                      {note.updatedAt}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] font-mono text-[#7B82A8]">
                    <Folder className="w-3 h-3 text-[#615EFF]" />
                    <span className="truncate">{note.folder}</span>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {note.tags.slice(0, 3).map((tag, i) => (
                      <span key={i} className="text-[9px] font-mono text-[#8C8AFF] bg-[#615EFF]/10 px-1.5 py-0.2 rounded">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Pane: Markdown Reader & Editor */}
        <div className="lg:col-span-7 bg-[#070810] border border-[#181B2E] rounded-2xl p-6 space-y-4 shadow-lg min-h-[640px] flex flex-col justify-between">
          {selectedNote ? (
            <div className="space-y-4">
              {/* Note Header */}
              <div className="flex items-center justify-between border-b border-[#161828] pb-4">
                <div>
                  <div className="text-[10px] font-mono text-[#615EFF] font-bold uppercase">
                    {selectedNote.folder}
                  </div>
                  <h3 className="text-lg font-bold text-white font-['Space_Grotesk']">
                    {selectedNote.title}
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <button
                      onClick={handleSaveEdit}
                      className="airbyte-btn-primary px-3 py-1.5 text-xs font-bold"
                    >
                      Save Changes
                    </button>
                  ) : (
                    <button
                      onClick={handleStartEdit}
                      className="px-3 py-1.5 rounded-lg bg-[#121424] hover:bg-[#1A1D36] border border-[#202440] text-xs font-mono text-[#A5A2FF] transition flex items-center gap-1.5"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit Note</span>
                    </button>
                  )}

                  <button
                    onClick={() => onDeleteNote(selectedNote.id)}
                    className="p-1.5 rounded-lg bg-[#121424] hover:bg-rose-950/40 border border-[#202440] text-[#8E94B8] hover:text-rose-400 transition"
                    title="Delete Note"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Note Body */}
              {isEditing ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={20}
                  className="w-full bg-[#040408] border border-[#1E223D] rounded-xl p-4 text-xs font-mono text-white leading-relaxed focus:outline-none focus:border-[#615EFF]"
                />
              ) : (
                <div className="prose prose-invert max-w-none text-xs font-mono text-[#CBD2EE] space-y-3 leading-relaxed max-h-[480px] overflow-y-auto pr-2">
                  <pre className="bg-transparent p-0 whitespace-pre-wrap font-sans text-xs text-[#CBD2EE]">
                    {selectedNote.content}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-20 text-[#585E82] font-mono text-xs">
              Select a note from the library to inspect
            </div>
          )}

          {/* Footer Metadata */}
          {selectedNote && (
            <div className="pt-4 border-t border-[#141626] flex items-center justify-between text-[11px] font-mono text-[#6A7097]">
              <div>
                Wikilinks:{' '}
                {selectedNote.wikilinks.map((wl, i) => (
                  <span key={i} className="text-[#8C8AFF] mr-1.5">
                    [[{wl}]]
                  </span>
                ))}
              </div>
              <div>Created: {selectedNote.createdAt}</div>
            </div>
          )}
        </div>
      </div>

      {/* New Note Modal */}
      {isCreatingNote && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0B0D18] border border-[#242844] rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#1A1D30]">
              <h3 className="text-base font-bold text-white font-['Space_Grotesk']">
                Create Obsidian Note
              </h3>
              <button onClick={() => setIsCreatingNote(false)} className="text-[#8E94B8] text-xs">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateNoteSubmit} className="space-y-4">
              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] block mb-1">NOTE TITLE</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g., Autonomous Browser OS Architecture Spec"
                  required
                  className="w-full bg-[#05060B] border border-[#1E223D] rounded-lg px-3 py-2 text-xs text-white"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] block mb-1">FOLDER</label>
                <input
                  type="text"
                  value={newFolder}
                  onChange={(e) => setNewFolder(e.target.value)}
                  className="w-full bg-[#05060B] border border-[#1E223D] rounded-lg px-3 py-2 text-xs text-white"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] block mb-1">MARKDOWN CONTENT</label>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  rows={6}
                  placeholder="# Note Title&#10;&#10;Enter thesis or synthesis content with [[Wikilinks]]..."
                  className="w-full bg-[#05060B] border border-[#1E223D] rounded-lg p-3 text-xs font-mono text-white"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreatingNote(false)}
                  className="px-3 py-1.5 text-xs text-[#8E94B8]"
                >
                  Cancel
                </button>
                <button type="submit" className="airbyte-btn-primary px-4 py-2 text-xs font-bold">
                  Save to Vault
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
