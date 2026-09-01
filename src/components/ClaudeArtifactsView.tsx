import React, { useState } from 'react';
import { ClaudeArtifact, AgentModalEvent, AgentRole, AIModelInfo } from '../types';
import { 
  Sparkles, Code2, Eye, Play, Copy, Check, ExternalLink, 
  Layers, Terminal, Maximize2, Minimize2, RefreshCw, 
  Smartphone, Monitor, Box, FileText, ChevronRight,
  Sliders, MessageSquare, Send, Zap, Shield, CheckCircle2
} from 'lucide-react';

interface ClaudeArtifactsViewProps {
  models: Record<string, AIModelInfo>;
  onSendQuery: (prompt: string, modelId?: string, systemPrompt?: string) => Promise<string>;
}

export const ClaudeArtifactsView: React.FC<ClaudeArtifactsViewProps> = ({
  models,
  onSendQuery,
}) => {
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>('art-1');
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'schema' | 'modals'>('preview');
  const [copied, setCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatPrompt, setChatPrompt] = useState('');
  const [activeModalType, setActiveModalType] = useState<'none' | 'artifact_preview' | 'hydration_sheet' | 'ebook_editor' | 'claim_directory_modal'>('none');
  const [modalPayload, setModalPayload] = useState<Record<string, any>>({});

  // Artifact Collection
  const [artifacts, setArtifacts] = useState<ClaudeArtifact[]>([
    {
      id: 'art-1',
      title: 'Decentralized Agent Fleet Health HUD (React Component)',
      type: 'react-component',
      language: 'tsx',
      agentRole: 'dev',
      modelName: 'Claude Code 3.7',
      timestamp: '21:32:04',
      version: 2,
      tags: ['React', 'Tailwind', 'Recharts', 'Fragments'],
      content: `import React, { useState } from 'react';
import { ShieldCheck, Cpu, Zap, Activity, Radio } from 'lucide-react';

export default function AgentFleetHUD() {
  const [activeNode, setActiveNode] = useState('Orchestrator');
  const fleet = [
    { role: 'Orchestrator', model: 'Nous Hermes 3', status: 'Optimal', ping: '12ms', load: 34 },
    { role: 'Scout', model: 'Sonar Pro', status: 'Crawling', ping: '28ms', load: 68 },
    { role: 'Scribe', model: 'Claude 3.7', status: 'Syncing', ping: '18ms', load: 45 },
    { role: 'Reach', model: 'ChatGPT o3', status: 'Idle', ping: '14ms', load: 12 },
    { role: 'Dev', model: 'Codex 2', status: 'Active', ping: '22ms', load: 82 },
  ];

  return (
    <div className="p-6 bg-[#090A16] border border-[#1A1D34] rounded-2xl text-white font-mono space-y-4 shadow-2xl">
      <div className="flex items-center justify-between pb-3 border-b border-[#16182C]">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-[#00D26A] animate-pulse" />
          <span className="text-xs font-bold tracking-wider text-[#A5A2FF]">HERMES TELEMETRY HUD</span>
        </div>
        <span className="text-[10px] bg-[#00D26A]/10 text-[#00D26A] px-2 py-0.5 rounded border border-[#00D26A]/30">5 NODES ONLINE</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fleet.map(n => (
          <div 
            key={n.role}
            onClick={() => setActiveNode(n.role)}
            className={\`p-3 rounded-xl border transition cursor-pointer \${
              activeNode === n.role 
                ? 'bg-[#181B34] border-[#615EFF] shadow-md shadow-[#615EFF]/20' 
                : 'bg-[#05060C] border-[#141628] hover:border-[#282E54]'
            }\`}
          >
            <div className="flex justify-between items-center text-xs font-bold mb-1">
              <span className="text-white">{n.role}</span>
              <span className="text-[#38BDF8] text-[10px]">{n.ping}</span>
            </div>
            <div className="text-[10px] text-[#7A82A6] mb-2">{n.model}</div>
            <div className="w-full bg-[#101222] h-1.5 rounded-full overflow-hidden">
              <div className="bg-gradient-to-r from-[#38BDF8] to-[#8B5CF6] h-full" style={{ width: \`\${n.load}%\` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}`
    },
    {
      id: 'art-2',
      title: '3D Interactive Plant Care Card with Glassmorphic Shader',
      type: '3d-card',
      language: 'tsx',
      agentRole: 'reach',
      modelName: 'Nous Hermes 3',
      timestamp: '21:15:20',
      version: 1,
      tags: ['3D Card', 'Glassmorphism', 'Bot Mode', 'E-Commerce'],
      content: `<!-- 3D Card Interactive Preview Payload -->
<div class="card-3d-wrapper p-6 rounded-2xl bg-gradient-to-br from-[#12142B] to-[#0A0C18] border border-[#262B4E] text-white shadow-2xl">
  <div class="badge text-[10px] font-bold text-[#00D26A] bg-[#00D26A]/10 px-2.5 py-1 rounded-full inline-block mb-3 border border-[#00D26A]/30">
    MONSTERA DELICIOSA · BOT HYDRATION ACTIVE
  </div>
  <h3 class="text-xl font-extrabold tracking-tight">Variegated Albo Borsigiana</h3>
  <p class="text-xs text-[#8E94B8] mt-1">Autonomous Soil Moisture Sensor: 42% (Optimal: 40-60%)</p>
  <div class="mt-4 flex gap-2">
    <button class="px-4 py-2 bg-[#00D26A] text-black font-bold rounded-xl text-xs">Trigger Mist Sprinkler</button>
    <button class="px-4 py-2 bg-[#1A1D34] text-white font-bold rounded-xl text-xs border border-[#2E355C]">View Care Log</button>
  </div>
</div>`
    },
    {
      id: 'art-3',
      title: 'Autonomous open_agent_modal Tool Invocation Schema',
      type: 'json-schema',
      language: 'json',
      agentRole: 'orchestrator',
      modelName: 'Nous Hermes 3',
      timestamp: '20:50:11',
      version: 3,
      tags: ['JSON Schema', 'Function Calling', 'Modals', 'CopilotKit'],
      content: `{
  "name": "open_agent_modal",
  "description": "Opens a Claude-style visual modal, side panel, or bottom sheet on the user's interface.",
  "parameters": {
    "type": "object",
    "properties": {
      "modal_type": {
        "type": "string",
        "enum": [
          "artifact_preview",
          "hydration_sheet",
          "ebook_editor",
          "claim_directory_modal"
        ]
      },
      "title": {
        "type": "string",
        "description": "The title of the rendered modal dialog."
      },
      "payload": {
        "type": "object",
        "description": "Dynamic JSON data passed into the rendered modal component."
      }
    },
    "required": ["modal_type", "title", "payload"]
  }
}`
    }
  ]);

  const selectedArtifact = artifacts.find(a => a.id === selectedArtifactId) || artifacts[0];

  const handleCopyCode = () => {
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
              Active Artifacts ({artifacts.length})
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
              {selectedArtifact.id === 'art-1' && (
                <div className="p-6 bg-[#05060C] border border-[#1A1D34] rounded-2xl space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-[#16182C]">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#00D26A] animate-pulse" />
                      <span className="text-xs font-bold tracking-wider text-[#A5A2FF]">HERMES TELEMETRY HUD</span>
                    </div>
                    <span className="text-[10px] bg-[#00D26A]/10 text-[#00D26A] px-2 py-0.5 rounded border border-[#00D26A]/30">5 NODES ONLINE</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { role: 'Orchestrator', model: 'Nous Hermes 3', ping: '12ms', load: 34, color: '#EC4899' },
                      { role: 'Scout', model: 'Sonar Pro', ping: '28ms', load: 68, color: '#20B2AA' },
                      { role: 'Scribe', model: 'Claude 3.7', ping: '18ms', load: 45, color: '#8B5CF6' },
                      { role: 'Reach', model: 'ChatGPT o3', ping: '14ms', load: 12, color: '#F59E0B' },
                      { role: 'Dev', model: 'Codex 2', ping: '22ms', load: 82, color: '#00D26A' },
                    ].map(n => (
                      <div key={n.role} className="p-3 bg-[#0B0D1E] rounded-xl border border-[#1A1D38]">
                        <div className="flex justify-between items-center text-xs font-bold mb-1">
                          <span style={{ color: n.color }}>{n.role}</span>
                          <span className="text-[#38BDF8] text-[10px]">{n.ping}</span>
                        </div>
                        <div className="text-[10px] text-[#7A82A6] mb-2">{n.model}</div>
                        <div className="w-full bg-[#101222] h-1.5 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${n.load}%`, backgroundColor: n.color }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedArtifact.id === 'art-2' && (
                <div className="p-6 rounded-2xl bg-gradient-to-br from-[#12142B] to-[#0A0C18] border border-[#262B4E] text-white shadow-2xl space-y-3">
                  <span className="text-[10px] font-bold text-[#00D26A] bg-[#00D26A]/10 px-2.5 py-1 rounded-full border border-[#00D26A]/30 inline-block">
                    MONSTERA DELICIOSA · BOT HYDRATION ACTIVE
                  </span>
                  <h3 className="text-xl font-extrabold tracking-tight">Variegated Albo Borsigiana</h3>
                  <p className="text-xs text-[#8E94B8]">
                    Autonomous Soil Moisture Sensor: 42% (Optimal: 40-60%) · Water Pump Ready
                  </p>
                  <div className="pt-2 flex gap-2">
                    <button 
                      onClick={() => alert('Triggered micro-sprinkler hydration cycle!')}
                      className="px-4 py-2 bg-[#00D26A] hover:bg-[#00B85C] text-black font-bold rounded-xl text-xs transition"
                    >
                      Trigger Mist Sprinkler
                    </button>
                    <button 
                      onClick={() => handleTriggerAgentModal('hydration_sheet', 'Monstera Albo Moisture Diagnostics', { moisture: 42, pump: 'online' })}
                      className="px-4 py-2 bg-[#1A1D34] hover:bg-[#252A4E] text-white font-bold rounded-xl text-xs border border-[#2E355C] transition"
                    >
                      Open Modal Sheet
                    </button>
                  </div>
                </div>
              )}

              {selectedArtifact.id !== 'art-1' && selectedArtifact.id !== 'art-2' && (
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
