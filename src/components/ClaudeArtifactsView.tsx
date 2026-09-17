import React, { useState, useEffect } from 'react';
import { ClaudeArtifact, AgentModalEvent, AgentRole, AIModelInfo } from '../types';
import { 
  Sparkles, Code2, Eye, Play, Copy, Check, ExternalLink, 
  Layers, Terminal, Maximize2, Minimize2, RefreshCw, 
  Smartphone, Monitor, Box, FileText, ChevronRight,
  Sliders, MessageSquare, Send, Zap, Shield, CheckCircle2
} from 'lucide-react';

interface ClaudeArtifactsViewProps {
  models: Record<string, AIModelInfo>;
  // `modelId` is required: the handler behind this prop takes a
  // non-optional targetModel, and every call site here supplies one.
  onSendQuery: (prompt: string, modelId: string, systemPrompt?: string) => Promise<string>;
  /** Required to scope artifacts to the caller's workspace. */
  activeWorkspaceId?: string;
}

export const ClaudeArtifactsView: React.FC<ClaudeArtifactsViewProps> = ({
  models,
  onSendQuery,
  activeWorkspaceId,
}) => {
  // Was 'art-1' — a fixture id. With the hardcoded array gone the list starts
  // empty, so a default pointing at a nonexistent artifact made
  // `selectedArtifact` undefined and the drawer below crashed on mount.
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'schema' | 'modals'>('preview');
  const [copied, setCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatPrompt, setChatPrompt] = useState('');
  const [activeModalType, setActiveModalType] = useState<'none' | 'artifact_preview' | 'hydration_sheet' | 'ebook_editor' | 'claim_directory_modal'>('none');
  const [modalPayload, setModalPayload] = useState<Record<string, any>>({});

  // ---------------------------------------------------------------------
  // REAL artifacts, from the canonical Vault store.
  //
  // This was a hardcoded array of three invented artifacts — a "Decentralized
  // Agent Fleet Health HUD" and friends — rendered in production as if they
  // were the workspace's real output. The real store had 48 artifacts at the
  // time this was found, so the panel was simultaneously fabricating rows and
  // hiding actual work.
  //
  // Mapped honestly: the Vault carries id, title, path, hash, size and
  // created_at. It does NOT carry which agent produced an artifact, which
  // model, a language, or a version number — so those are reported as unknown
  // rather than invented. Keep the surface, fix the data.
  // ---------------------------------------------------------------------
  const [artifacts, setArtifacts] = useState<ClaudeArtifact[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(true);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;
    (async () => {
      setArtifactsLoading(true);
      setArtifactsError(null);
      try {
        const res = await fetch(`/api/vault?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || data.success === false) {
          setArtifactsError(data.error || `HTTP ${res.status}`);
          setArtifacts([]);
          return;
        }
        const entries: Array<Record<string, any>> = data.entries || [];
        setArtifacts(entries.map((e) => ({
          id: String(e.artifact_id),
          title: String(e.title || e.relative_path || e.artifact_id),
          // The store records a content type, not a UI artifact kind. Markdown
          // is what the Vault writer actually produces.
          type: 'markdown' as const,
          content: '',
          // UNKNOWN, not a plausible guess: the Vault has no producer column.
          agentRole: 'UNKNOWN' as any,
          modelName: 'UNKNOWN',
          timestamp: String(e.created_at || ''),
          version: 1,
          tags: [],
        })));
      } catch (err: any) {
        if (!cancelled) {
          setArtifactsError(err?.message || 'Network error contacting the Vault API.');
          setArtifacts([]);
        }
      } finally {
        if (!cancelled) setArtifactsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeWorkspaceId]);

  // May be undefined: an empty Vault is a real state, not an error.
  const selectedArtifact = artifacts.find(a => a.id === selectedArtifactId) || artifacts[0];

  const handleCopyCode = () => {
    if (!selectedArtifact) return;
    navigator.clipboard.writeText(selectedArtifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGenerateArtifact = async () => {
    if (!chatPrompt.trim()) return;
    setIsGenerating(true);

    try {
      const prompt = `Create a high-quality React TypeScript component or Claude Artifact for: "${chatPrompt}". Include full working code, styling with Tailwind CSS, and informative comments.`;
      const codeReply = await onSendQuery(prompt, 'claudecode', 'You are Claude Code & Hermes Artifact Generator emitting clean, valid TSX code.');

      const newArt: ClaudeArtifact = {
        id: `art-${Date.now()}`,
        title: chatPrompt.slice(0, 45) + ' (Artifact)',
        type: 'react-component',
        language: 'tsx',
        agentRole: 'dev',
        modelName: 'Claude Code 3.7',
        timestamp: new Date().toLocaleTimeString(),
        version: 1,
        tags: ['React', 'Tailwind', 'Claude-Artifact'],
        content: codeReply || `// Generated Artifact for ${chatPrompt}\nexport default function CustomArtifact() {\n  return <div className="p-4 bg-black text-white">Generated Component for ${chatPrompt}</div>;\n}`
      };

      setArtifacts(prev => [newArt, ...prev]);
      setSelectedArtifactId(newArt.id);
      setActiveTab('preview');
      setChatPrompt('');
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleTriggerAgentModal = (type: 'artifact_preview' | 'hydration_sheet' | 'ebook_editor' | 'claim_directory_modal', title: string, payload: Record<string, any>) => {
    setActiveModalType(type);
    setModalPayload(payload);
  };

  return (
    <div className="space-y-8 pb-16 max-w-7xl mx-auto px-4 font-mono">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-4 border-b border-[#1A1D2E] pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="bg-[#615EFF]/15 text-[#A5A2FF] border border-[#615EFF]/30 text-[11px] font-bold px-2.5 py-0.5 rounded-full">
              CLAUDE-STYLE ARTIFACTS &amp; SPLIT-PANE DRAWERS
            </span>
            <span className="bg-[#FF5E8E]/10 text-[#FF5E8E] border border-[#FF5E8E]/30 text-[10px] font-bold px-2 py-0.5 rounded-full">
              E2B FRAGMENTS · ASSISTANT-UI · COPILOTKIT
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-sans">
            Claude Artifacts, Side Panels &amp; Agent Modals
          </h1>
          <p className="text-xs sm:text-sm text-[#8E94B8] mt-1 font-sans">
            Live split-pane workspace rendering code, interactive React components, and 3D card viewers while the Hermes chat stream remains active.
          </p>
        </div>

        {/* Quick Modal Launcher Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => handleTriggerAgentModal('hydration_sheet', 'Plant Hydration & Sensor Sheet', { plantName: 'Monstera Albo', moisture: 42, lastWatered: 'Yesterday 4:00 PM' })}
            className="px-3 py-1.5 bg-[#00D26A]/15 hover:bg-[#00D26A]/25 border border-[#00D26A]/40 text-[#00D26A] rounded-xl text-xs font-bold transition flex items-center gap-1.5"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Bottom Sheet</span>
          </button>

          <button
            onClick={() => handleTriggerAgentModal('claim_directory_modal', 'Claim Business Listing Modal', { businessName: 'Greenery Botanicals NYC', phone: '646-941-9454', verified: false })}
            className="px-3 py-1.5 bg-[#38BDF8]/15 hover:bg-[#38BDF8]/25 border border-[#38BDF8]/40 text-[#38BDF8] rounded-xl text-xs font-bold transition flex items-center gap-1.5"
          >
            <Box className="w-3.5 h-3.5" />
            <span>Directory Modal</span>
          </button>
        </div>
      </div>

      {/* Main Split-Pane Layout (Left: Chat & Artifact Selector, Right: Live Canvas Drawer) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Chat Stream & Artifact List (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Artifact List Picker */}
          <div className="bg-[#090B18] border border-[#1A1D34] rounded-2xl p-4 space-y-2">
            <span className="text-[11px] font-bold text-[#8E94B8] uppercase tracking-wider block">
              Active Artifacts ({artifactsLoading ? '…' : artifactsError ? 'UNKNOWN' : artifacts.length})
            </span>
            <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
              {artifacts.map(art => {
                const isSelected = art.id === selectedArtifactId;
                return (
                  <button
                    key={art.id}
                    onClick={() => setSelectedArtifactId(art.id)}
                    className={`w-full text-left p-3 rounded-xl border transition flex items-center justify-between ${
                      isSelected
                        ? 'bg-[#161932] border-[#615EFF] text-white shadow-md shadow-[#615EFF]/20'
                        : 'bg-[#05060C] border-[#141628] text-[#8E94B8] hover:text-white hover:bg-[#0E101E]'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-xs font-bold truncate text-white">{art.title}</div>
                      <div className="text-[10px] text-[#6A7196] flex items-center gap-2 mt-0.5">
                        <span className="text-[#38BDF8]">{art.modelName}</span>
                        <span>·</span>
                        <span>v{art.version}</span>
                        <span>·</span>
                        <span>{art.timestamp}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 shrink-0 text-[#615EFF]" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Artifact Generator Input Form */}
          <div className="bg-[#090B18] border border-[#1A1D34] rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5 text-[#A5A2FF]" />
              <span>Prompt New Claude Artifact</span>
            </div>
            <textarea
              rows={3}
              value={chatPrompt}
              onChange={(e) => setChatPrompt(e.target.value)}
              placeholder="e.g., Build a 3D Glassmorphic token burn calculator with interactive slider and export buttons..."
              className="w-full bg-[#05060C] border border-[#1A1D34] text-white p-3 rounded-xl text-xs font-mono focus:outline-hidden focus:border-[#615EFF]"
            />
            <button
              onClick={handleGenerateArtifact}
              disabled={isGenerating || !chatPrompt.trim()}
              className="w-full py-2.5 bg-[#615EFF] hover:bg-[#504DF5] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition disabled:opacity-50 shadow-lg shadow-[#615EFF]/20"
            >
              <Zap className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
              <span>{isGenerating ? 'Synthesizing TSX Component...' : 'Generate New Artifact'}</span>
            </button>
          </div>

          {/* Framework Ecosystem Reference Notes */}
          <div className="bg-[#05060C] border border-[#141628] rounded-2xl p-4 space-y-2 text-xs text-[#7A82A6]">
            <span className="text-white font-bold block">Supported Modal Architectures:</span>
            <ul className="space-y-1 text-[11px] list-disc list-inside">
              <li><strong className="text-[#38BDF8]">e2b-dev/fragments</strong>: Split-pane code sandbox</li>
              <li><strong className="text-[#00D26A]">copilotkit</strong>: &lt;CopilotSidebar/&gt; &amp; &lt;CopilotModal/&gt;</li>
              <li><strong className="text-[#EC4899]">expo/router</strong>: presentation: 'modal' stack</li>
              <li><strong className="text-[#F59E0B]">gorhom/bottom-sheet</strong>: gesture modal sheet</li>
            </ul>
          </div>
        </div>

        {/* Right Column: Live Artifact Drawer & Interactive Canvas (7 cols) */}
        <div className="lg:col-span-7 bg-[#090B18] border border-[#1A1D34] rounded-2xl p-6 shadow-2xl space-y-4">
          {/* An empty Vault is a real state and must render as one. Previously
              the fixture array guaranteed a selection, so every expression
              below assumed `selectedArtifact` existed — with real data and an
              empty store, that assumption crashed the whole panel. */}
          {!selectedArtifact ? (
            <div className="py-16 text-center space-y-2">
              <div className="text-sm font-bold text-white">
                {artifactsLoading ? 'Loading artifacts…' : artifactsError ? 'Artifacts UNKNOWN' : 'No artifacts in this workspace yet'}
              </div>
              <div className="text-xs text-[#7B82A8] font-mono">
                {artifactsError
                  ? `The Vault API could not be read: ${artifactsError}`
                  : artifactsLoading
                    ? 'Reading the canonical Vault store.'
                    : 'Artifacts appear here once a task writes one. Nothing is shown until then.'}
              </div>
            </div>
          ) : (
          <>
          {/* Drawer Header with Tabs */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#16182C]">
            <div>
              <span className="text-[10px] font-bold text-[#615EFF] uppercase tracking-widest block mb-0.5">
                ACTIVE ARTIFACT DRAWER · {selectedArtifact.type.toUpperCase()}
              </span>
              <h2 className="text-base font-extrabold text-white">
                {selectedArtifact.title}
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex bg-[#05060C] p-1 rounded-xl border border-[#161828]">
                <button
                  onClick={() => setActiveTab('preview')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                    activeTab === 'preview' ? 'bg-[#615EFF] text-white' : 'text-[#8E94B8] hover:text-white'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Preview</span>
                </button>
                <button
                  onClick={() => setActiveTab('code')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                    activeTab === 'code' ? 'bg-[#615EFF] text-white' : 'text-[#8E94B8] hover:text-white'
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Code</span>
                </button>
                <button
                  onClick={() => setActiveTab('schema')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                    activeTab === 'schema' ? 'bg-[#615EFF] text-white' : 'text-[#8E94B8] hover:text-white'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Schema</span>
                </button>
              </div>

              <button
                onClick={handleCopyCode}
                className="p-2 bg-[#121426] hover:bg-[#1C203E] text-white rounded-xl border border-[#252A4A] transition text-xs"
                title="Copy Code"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[#00D26A]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* VIEW: LIVE PREVIEW */}
          {activeTab === 'preview' && (
            <div className="space-y-4">
              {/* One renderer for every artifact. The two id-keyed blocks that
                  used to sit above this rendered bespoke demo content for the
                  fixture artifacts 'art-1' and 'art-2'; with real ids from the
                  Vault they could never match again. */}
              {(
                <div className="p-6 bg-[#05060C] rounded-2xl border border-[#1A1D34] text-center space-y-3">
                  <div className="text-sm font-bold text-white">Live Component Renderer Active</div>
                  <pre className="text-xs text-[#38BDF8] text-left bg-[#0A0C18] p-4 rounded-xl overflow-x-auto">
                    {selectedArtifact.content}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* VIEW: SOURCE CODE */}
          {activeTab === 'code' && (
            <div className="space-y-2">
              <pre className="text-xs text-[#A5A2FF] bg-[#05060C] p-4 rounded-2xl border border-[#161828] overflow-x-auto leading-relaxed max-h-96">
                {selectedArtifact.content}
              </pre>
            </div>
          )}

          {/* VIEW: FUNCTION CALL SCHEMA */}
          {activeTab === 'schema' && (
            <div className="space-y-3">
              <span className="text-xs font-bold text-white block">Hermes open_agent_modal Parameter Definition</span>
              <pre className="text-xs text-[#00D26A] bg-[#05060C] p-4 rounded-2xl border border-[#161828] overflow-x-auto leading-relaxed">
{`{
  "name": "open_agent_modal",
  "description": "Opens a Claude-style visual modal or artifact drawer on the user's interface.",
  "parameters": {
    "type": "object",
    "properties": {
      "modal_type": {
        "type": "string",
        "enum": ["artifact_preview", "hydration_sheet", "ebook_editor", "claim_directory_modal"]
      },
      "title": { "type": "string" },
      "payload": {
        "type": "object",
        "description": "Dynamic data passed into the rendered modal component."
      }
    },
    "required": ["modal_type", "title", "payload"]
  }
}`}
              </pre>
            </div>
          )}
          </>
          )}
        </div>
      </div>

      {/* FLOATING AGENT MODAL SIMULATION OVERLAY */}
      {activeModalType !== 'none' && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#090B18] border border-[#615EFF] rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-[#1A1D34]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#00D26A] animate-ping" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Agent Modal Event: {activeModalType}
                </h3>
              </div>
              <button
                onClick={() => setActiveModalType('none')}
                className="text-[#8E94B8] hover:text-white text-xs bg-[#16182C] px-2.5 py-1 rounded-lg border border-[#232746]"
              >
                Close (ESC)
              </button>
            </div>

            <div className="p-4 bg-[#05060C] rounded-2xl border border-[#161828] space-y-2">
              <span className="text-xs font-bold text-[#38BDF8]">Modal Payload Data:</span>
              <pre className="text-xs text-[#E2E8F0] overflow-x-auto">
                {JSON.stringify(modalPayload, null, 2)}
              </pre>
            </div>

            <button
              onClick={() => {
                alert('Action executed through modal state controller.');
                setActiveModalType('none');
              }}
              className="w-full py-2.5 bg-[#615EFF] hover:bg-[#504DF5] text-white font-bold rounded-xl text-xs transition"
            >
              Confirm &amp; Synchronize with Hermes Memory
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
