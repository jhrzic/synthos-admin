import React, { useState } from 'react';
import { AgentInfo, AIModelInfo, ObsidianNote } from '../types';
import { INITIAL_AGENT_MEMORIES, AgentMemoryStatus } from '../data/agentDefinitions';
import { 
  HardDrive, Brain, Database, FileText, CheckCircle2, 
  Sparkles, RefreshCw, Save, Trash2, Eye, Download, Shield,
  Terminal, Search, Layers, Clock
} from 'lucide-react';

interface AgentMemoryViewProps {
  agents: Record<string, AgentInfo>;
  models: Record<string, AIModelInfo>;
  notes: ObsidianNote[];
  onAddNoteToVault: (title: string, content: string, tags: string[]) => void;
  onSendQuery: (query: string, model: string) => Promise<string>;
  onSelectTab: (tab: any) => void;
}

export const AgentMemoryView: React.FC<AgentMemoryViewProps> = ({
  agents,
  models,
  notes,
  onAddNoteToVault,
  onSendQuery,
  onSelectTab,
}) => {
  const [memories, setMemories] = useState<AgentMemoryStatus[]>(INITIAL_AGENT_MEMORIES);
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>('orchestrator');
  const [selectedFileName, setSelectedFileName] = useState<string>('memory.md');
  const [fileContent, setFileContent] = useState<string>(`# Long-Term Memory: Orchestrator
**Owner**: Chief Executive
**Active Goals**:
1. Oversee multi-agent Kanban execution on board.db
2. Enforce permanent operating rules across all 15 agents
3. Maintain continuous Obsidian Knowledge Graph vector synchronization

## Operating Context
- Fleet Profile: Multi-Agent Swarm (15 persistent agents)
- Routing Engine: OpenRouter dynamic token arbitrator
- Inotify Watcher: Active at /agents/orchestrator/workspace
- Synapse Matrix: 184 cross-vault connections established`);

  const [notice, setNotice] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState<boolean>(false);

  const activeMem = memories.find(m => m.agentKey === selectedAgentKey) || memories[0];

  const handleSelectAgent = (key: string) => {
    setSelectedAgentKey(key);
    const m = memories.find(item => item.agentKey === key) || memories[0];
    const firstFile = m.files[0] || 'memory.md';
    setSelectedFileName(firstFile);
    setFileContent(`# Long-Term Memory: ${m.agentName}\n**File**: ${firstFile}\n**Allocated**: ${m.memorySizeKB} KB\n**Last Synchronized**: ${m.lastIndexed}\n\n## Core Directives\n- Permanent agent identity locked in SOUL.md\n- Workspace path: /agents/${m.agentKey}/workspace\n- Vector Synapses: ${m.synapseConnections} connected nodes\n\n## Dynamic State Cache\n- 0 unhandled promise rejections\n- Active telemetry ping: ${m.signalTelemetry.latencyMs}ms\n- Inotify event stream: Active`);
  };

  const handleSaveMemoryFile = () => {
    setNotice(`Saved updates to /agents/${selectedAgentKey}/${selectedFileName}!`);
    setTimeout(() => setNotice(null), 3000);
  };

  const handleCompactMemory = () => {
    setIsCompacting(true);
    setNotice(`Compacting vector embeddings and purging duplicate tokens for ${activeMem.agentName}...`);
    setTimeout(() => {
      setMemories(prev => prev.map(m => m.agentKey === selectedAgentKey ? {
        ...m,
        memorySizeKB: Number((m.memorySizeKB * 0.85).toFixed(1)),
        retentionState: 'OPTIMAL',
        lastIndexed: 'Just now'
      } : m));
      setIsCompacting(false);
      setNotice(`Memory compaction complete. Reclaimed 15% vector storage for ${activeMem.agentName}!`);
      setTimeout(() => setNotice(null), 4000);
    }, 1200);
  };

  const handleExportToVault = () => {
    const title = `Vault-Memory-Audit-${activeMem.agentName}-${selectedFileName.replace(/\./g, '-')}`;
    onAddNoteToVault(title, fileContent, ['memory', 'audit', activeMem.agentKey]);
    setNotice(`Exported ${selectedFileName} to Obsidian Vault!`);
    setTimeout(() => setNotice(null), 3000);
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-2 border-b border-[#1A1D2E] pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="airbyte-badge">
              HERMES LONG-TERM AGENT MEMORY
            </span>
            <span className="text-xs font-mono text-[#00D26A] flex items-center gap-1">
              <HardDrive className="w-3 h-3" />
              15 AGENT WORKSPACES ISOLATED
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-['Space_Grotesk']">
            Long-Term Agent Memory Subsystem
          </h1>
          <p className="text-xs sm:text-sm text-[#8E94B8] mt-1">
            Dedicated workspace file inspection, SOUL.md identities, memory compaction, and inotify vector CDC synchronization.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCompactMemory}
            disabled={isCompacting}
            className="airbyte-btn-secondary px-4 py-2.5 text-xs font-semibold flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 text-[#A5A2FF] ${isCompacting ? 'animate-spin' : ''}`} />
            <span>{isCompacting ? 'COMPACTING...' : 'COMPACT MEMORY'}</span>
          </button>

          <button
            onClick={handleExportToVault}
            className="airbyte-btn-primary px-4 py-2.5 text-xs font-bold flex items-center gap-2 shadow-lg shadow-[#615EFF]/25"
          >
            <Database className="w-3.5 h-3.5" />
            <span>EXPORT TO OBSIDIAN</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="p-3 bg-[#615EFF]/15 border border-[#615EFF]/40 rounded-xl text-xs font-mono text-[#A5A2FF] flex items-center gap-2 animate-fadeIn">
          <Sparkles className="w-4 h-4 text-[#615EFF] shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Main Grid: Agent Selector + Memory File Explorer + Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Agent Workspace Selector */}
        <div className="lg:col-span-4 space-y-4">
          <h2 className="text-xs font-mono font-bold uppercase text-white flex items-center gap-2">
            <Brain className="w-4 h-4 text-[#615EFF]" />
            Agent Workspaces ({memories.length})
          </h2>

          <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
            {memories.map((mem) => {
              const isSelected = mem.agentKey === selectedAgentKey;
              return (
                <div
                  key={mem.agentKey}
                  onClick={() => handleSelectAgent(mem.agentKey)}
                  className={`p-3.5 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'bg-[#181B34] border-[#615EFF] shadow-lg shadow-[#615EFF]/15'
                      : 'bg-[#0B0D1B] border-[#181B2E] hover:border-[#282D4E]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${isSelected ? 'bg-[#615EFF]' : 'bg-[#00D26A]'}`} />
                    <div>
                      <div className="text-xs font-bold text-white">
                        {mem.agentName}
                      </div>
                      <div className="text-[10px] text-[#6E759D] font-mono mt-0.5">
                        {mem.memorySizeKB} KB • {mem.files.length} Files
                      </div>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#615EFF]/20 text-[#A5A2FF]">
                    {mem.retentionState}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Workspace Files & Live Memory Editor */}
        <div className="lg:col-span-8 space-y-4">
          <div className="airbyte-card p-6 space-y-5">
            {/* Header & File Tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1A1D30] pb-4">
              <div>
                <h3 className="text-base font-bold text-white font-['Space_Grotesk']">
                  Workspace: /agents/{selectedAgentKey}/
                </h3>
                <p className="text-xs text-[#8E94B8] mt-0.5">
                  Live inotify file watcher synchronization enabled.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveMemoryFile}
                  className="px-3.5 py-1.5 rounded-lg bg-[#615EFF] hover:bg-[#5653D9] text-white text-xs font-mono font-bold flex items-center gap-1.5 transition shadow"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>SAVE CHANGES</span>
                </button>
              </div>
            </div>

            {/* File Switcher */}
            <div className="flex flex-wrap items-center gap-2">
              {activeMem.files.map((file) => (
                <button
                  key={file}
                  onClick={() => setSelectedFileName(file)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono transition flex items-center gap-1.5 ${
                    selectedFileName === file
                      ? 'bg-[#1E2342] text-white border border-[#615EFF]'
                      : 'bg-[#080A14] text-[#8E94B8] hover:text-white border border-[#181B2E]'
                  }`}
                >
                  <FileText className="w-3 h-3 text-[#A5A2FF]" />
                  <span>{file}</span>
                </button>
              ))}
            </div>

            {/* Editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-[#8E94B8]">
                <span>Editing: <strong>{selectedFileName}</strong></span>
                <span>Sub-15ms Vector CDC Active</span>
              </div>

              <textarea
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
                rows={15}
                className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-4 text-xs font-mono text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF] leading-relaxed"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
