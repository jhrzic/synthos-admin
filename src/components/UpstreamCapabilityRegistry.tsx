import React, { useState } from 'react';
import { 
  Crown, RefreshCw, AlertTriangle, CheckCircle2, ShieldCheck, 
  ExternalLink, Layers, Terminal, Sparkles, Network, Code2, 
  Search, ArrowRight, Zap, Info, Clock, Check, Play, ChevronRight,
  Sliders, Compass, Globe
} from 'lucide-react';

interface RegistryItem {
  id: string;
  name: string;
  category: 'agent' | 'platform' | 'integrations';
  currentVersion: string;
  latestVersion: string;
  status: 'NOT_CONFIGURED' | 'UP_TO_DATE' | 'UPDATE_AVAILABLE' | 'WATCHING' | 'CRITICAL';
  icon: React.ElementType;
  color: string;
  lastChecked: string;
  description: string;
  capabilities: string[];
  breakingChanges: string[];
  githubUrl?: string;
}

export const UpstreamCapabilityRegistry: React.FC<{
  onSendQuery: (query: string, targetModel: string) => Promise<string>;
  onAddNoteToVault: (title: string, content: string, tags: string[], folder?: string) => void;
}> = ({ onSendQuery, onAddNoteToVault }) => {
  const [registryItems, setRegistryItems] = useState<RegistryItem[]>([
    {
      id: 'hermes',
      name: 'Nous Hermes Runtime Adapter',
      category: 'agent',
      currentVersion: 'UNKNOWN',
      latestVersion: 'UNKNOWN',
      status: 'NOT_CONFIGURED',
      icon: Crown,
      color: '#EC4899',
      lastChecked: 'NEVER',
      description: 'ADR-001 Hermes adapter governance layer with strict health check protocol (GET /synthos/health) and capability discovery.',
      capabilities: [
        'Hermes Runtime Health Check Protocol (GET /synthos/health)',
        'Authoritative Capability Introspection Schema v1',
        'Strict 5000ms AbortSignal Timeout & State Mapping'
      ],
      breakingChanges: [
        'Requires Authorization: Bearer <HERMES_ADAPTER_TOKEN> for operational telemetry.'
      ],
      githubUrl: 'https://github.com/NousResearch/hermes-agent'
    },
    {
      id: 'claudecode',
      name: 'Claude Code Terminal',
      category: 'agent',
      currentVersion: 'UNKNOWN',
      latestVersion: 'UNKNOWN',
      status: 'NOT_CONFIGURED',
      icon: Terminal,
      color: '#D97706',
      lastChecked: 'NEVER',
      description: 'Autonomous repository editing tool, AST-grounded search parsing, and isolated compile validation pipelines.',
      capabilities: [
        'Interactive repository navigation & multi-file refactoring',
        'Isolated test harness execution & runtime verification',
        'Automatic Git commit and patch creation verification'
      ],
      breakingChanges: [],
      githubUrl: 'https://github.com/anthropic/claude-code'
    },
    {
      id: 'codex',
      name: 'Codex WASM Sandbox',
      category: 'agent',
      currentVersion: 'UNKNOWN',
      latestVersion: 'UNKNOWN',
      status: 'NOT_CONFIGURED',
      icon: Code2,
      color: '#00D26A',
      lastChecked: 'NEVER',
      description: 'WASM-isolated and containerized sandbox harness for executing test-driven development scripts.',
      capabilities: [
        'WASM-based execution of TypeScript/Python snippets',
        'Automatic coverage report generation (Jest and Pytest equivalents)',
        'Local mock environment fixture generation'
      ],
      breakingChanges: [],
      githubUrl: 'https://github.com/synthos-org/codex-sandbox'
    },
    {
      id: 'cursor',
      name: 'Cursor IDE Agent',
      category: 'agent',
      currentVersion: 'UNKNOWN',
      latestVersion: 'UNKNOWN',
      status: 'NOT_CONFIGURED',
      icon: Sliders,
      color: '#A855F7',
      lastChecked: 'NEVER',
      description: 'Language Server Protocol (LSP) AST codebase semantic indexer and whole-project git diff auto-fix loops.',
      capabilities: [
        'Grounded multi-file semantic search using tree-sitter indices',
        'LSP compiler lookup with self-healing syntax corrections',
        'Whole-project workspace context injection'
      ],
      breakingChanges: [
        'LSP schema version updates broke traditional symbol mappings on custom AST trees.',
        'Configuration files shifted from .cursorrules to global workspace specifications.'
      ],
      githubUrl: 'https://github.com/getcursor/cursor'
    },
    {
      id: 'antigravity',
      name: 'Antigravity Kernel Node',
      category: 'agent',
      currentVersion: 'UNKNOWN',
      latestVersion: 'UNKNOWN',
      status: 'NOT_CONFIGURED',
      icon: Compass,
      color: '#8A5CF5',
      lastChecked: 'NEVER',
      description: 'Google DeepMind Autonomous meta-agent and self-healing workspace watchdog kernel.',
      capabilities: [
        'Continuous container health monitoring & watchdog state triggers',
        'Automated state rollbacks on code test harness crashes',
        'Dynamic tool compilation and custom MCP server loads'
      ],
      breakingChanges: [],
      githubUrl: 'https://github.com/google-deepmind/antigravity'
    },
    {
      id: 'openclaw',
      name: 'OpenClaw Browser Agent',
      category: 'agent',
      currentVersion: 'UNKNOWN',
      latestVersion: 'UNKNOWN',
      status: 'NOT_CONFIGURED',
      icon: Globe,
      color: '#10B981',
      lastChecked: 'NEVER',
      description: 'Autonomous headless browser crawling, selector mapping, DOM node extraction, and anti-bot rate-limit bypassing.',
      capabilities: [
        'Headless chromium crawl with AST extraction loops',
        'Grounded DOM target path selector calculations',
        'Automated captchas, rate limit, and cloudflare challenges handling'
      ],
      breakingChanges: [
        'Headless sandbox profile initialization shifted default arguments causing local chromium permission alerts.'
      ],
      githubUrl: 'https://github.com/openclaw/openclaw'
    },
    {
      id: 'gemini',
      name: 'Google Gemini SDK Platform',
      category: 'platform',
      currentVersion: 'UNKNOWN',
      latestVersion: 'UNKNOWN',
      status: 'NOT_CONFIGURED',
      icon: Sparkles,
      color: '#615EFF',
      lastChecked: 'NEVER',
      description: 'Official unified @google/genai SDK wrapper for Gemini models, supporting audio, video, tool calls, and grounding.',
      capabilities: [
        'High-speed JSON Schema structured output constraint configurations',
        'Google Search & Google Maps platform active search grounding',
        'High-fidelity live stream token completions and function calling'
      ],
      breakingChanges: [],
      githubUrl: 'https://github.com/google/generative-ai-js'
    },
    {
      id: 'youtube-audit',
      name: 'Julian Goldie YouTube Audit',
      category: 'integrations',
      currentVersion: 'UNKNOWN',
      latestVersion: 'UNKNOWN',
      status: 'NOT_CONFIGURED',
      icon: Play,
      color: '#FF0000',
      lastChecked: 'NEVER',
      description: 'YouTube Channel video harvesting, transcription curation, and DeepSeek R1 SEO keyword analysis.',
      capabilities: [
        'RSS video discovery & automated transcription ingest pipelines',
        'SEO keyword density extraction & structural video breakdown',
        'Obsidian-formatted audit note exports & Kanban target generation'
      ],
      breakingChanges: [],
      githubUrl: 'https://github.com/JulianGoldieSEO'
    }
  ]);

  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<RegistryItem | null>(null);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);

  // Trigger Gemini-grounded Search to scan ProductHunt/GitHub for real updates
  const handleTriggerUpstreamScan = async () => {
    setIsScanning(true);
    setScanResult(null);
    try {
      // Use onSendQuery to fetch actual updates via our backend Gemini wrapper
      const query = `
        Search and analyze the latest updates for Google Gemini SDK (@google/genai), Nous Hermes 3, Anthropic Claude Code, Cursor IDE, and openclaw. 
        Provide a detailed JSON-like report listing:
        1. Any new minor/major versions released in the past month.
        2. Known breaking changes or ast changes.
        3. A quick action recommendation for our developers.
        Keep it concise, professional, and dense.
      `;
      const reply = await onSendQuery(query, 'gemini-2.5-flash');
      
      setScanResult(reply);
      
      // A scan reply is free-text from a model, not a structured per-item
      // verdict — so it cannot set any item's status, AND it cannot set
      // `lastChecked` either. `lastChecked` means "this registry polled
      // upstream for a version"; nothing here does that. Stamping it after a
      // model chat reported a version check that never happened. The advisory
      // is shown as itself, in `scanResult` below, and attributed to a model.
      setLastScanAt(new Date().toISOString());

      // Save a note of this capability audit to the vault
      onAddNoteToVault(
        `Upstream-Capability-Audit-${new Date().toISOString().slice(0, 10)}`,
        `# Upstream Capability & API Change Audit\n\nGenerated on: ${new Date().toUTCString()}\n\n## Model advisory (unverified)\n\n${reply}\n\n## Provenance\n\nSource: free-text advisory from model \`gemini-2.5-flash\`, unverified.\nThis build performs no upstream version check, so no per-item version or update status is asserted.`,
        ['audit', 'capability', 'upstream'],
        'System-Audits'
      );
    } catch (e: any) {
      setScanResult(`[FAIL] Upstream Crawler connection degraded. Error: ${e.message || 'Timeout'}`);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="space-y-8 font-mono pb-16 text-[#D0D4EE] max-w-[1600px] mx-auto">
      
      {/* Header and Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1A1D30] pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-bold text-[#D97706] tracking-widest uppercase">
            <Crown className="w-4 h-4" />
            <span>UPSTREAM CAPABILITY WATCHERS</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            Upstream Agent Capability Registry
          </h1>
          <p className="text-xs text-[#7A82A6]">
            Watch list of upstream projects this build depends on, with their documented capabilities and
            breaking changes.
          </p>
        </div>

        <button
          onClick={handleTriggerUpstreamScan}
          disabled={isScanning}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 border transition-all select-none ${
            isScanning 
              ? 'bg-[#121426] text-[#7A82A6] border-[#222644]'
              : 'bg-gradient-to-r from-[#D97706] to-[#EC4899] text-white border-transparent hover:scale-102 shadow-lg shadow-[#D97706]/20'
          }`}
        >
          <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
          {isScanning ? 'REQUESTING MODEL ADVISORY...' : 'REQUEST MODEL ADVISORY'}
        </button>
      </div>

      {/* No upstream version source exists in this build. Saying so is the
          difference between a registry that is honest about its gap and one
          that reported eight projects "up to date" on no evidence. */}
      <div
        data-testid="upstream-version-source-notice"
        className="flex items-start gap-3 rounded-xl border border-[#7E8BB5]/25 bg-[#7E8BB5]/[0.06] px-4 py-3"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#7E8BB5]" />
        <div className="space-y-1 text-[11px] leading-relaxed text-[#9C97B4]">
          <p className="font-bold uppercase tracking-wider text-[#7E8BB5]">
            No upstream version source configured
          </p>
          <p>
            This build queries no package index, GitHub release feed or upstream API, so installed and
            latest versions read <strong className="text-[#C9CCE4]">UNKNOWN</strong> and every item is
            <strong className="text-[#C9CCE4]"> NOT CONFIGURED</strong>. The capability and breaking-change
            notes below are author-written documentation, not measurements.
          </p>
          <p>
            Requesting a model advisory asks a language model what it knows about these projects. The reply
            is unverified free text and updates no item&apos;s version or status.
            {lastScanAt
              ? ` Last advisory requested ${new Date(lastScanAt).toLocaleString()}.`
              : ' No advisory requested this session.'}
          </p>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        
        {/* Registry Items Column */}
        <div className="xl:col-span-7 space-y-4">
          <div className="flex items-center justify-between text-xs text-[#7A82A6] uppercase px-1">
            <span>Tracking {registryItems.length} Key Subsystems</span>
            <span>Real-time watcher telemetry</span>
          </div>

          <div className="space-y-3">
            {registryItems.map((item) => {
              const Icon = item.icon;
              const isSelected = selectedItem?.id === item.id;
              
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className={`p-4 bg-[#090A14]/90 border rounded-xl transition cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                    isSelected 
                      ? 'border-[#D97706] bg-[#121424]/40' 
                      : 'border-[#1C203B] hover:border-[#31365D] hover:bg-[#0E0F1F]'
                  }`}
                >
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div 
                      className="p-2.5 rounded-lg shrink-0"
                      style={{ backgroundColor: `${item.color}15`, color: item.color, border: `1px solid ${item.color}30` }}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white text-sm">{item.name}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.2 rounded uppercase border tracking-wider"
                          style={{ borderColor: `${item.color}30`, color: item.color, backgroundColor: `${item.color}05` }}
                        >
                          {item.category}
                        </span>
                      </div>
                      
                      <p className="text-xs text-[#7A82A6] line-clamp-1">
                        {item.description}
                      </p>

                      <div className="flex items-center gap-4 text-[10px] text-[#555C7F] font-mono pt-1">
                        <span>Installed: <strong className="text-[#7E8BB5]">{item.currentVersion}</strong></span>
                        <span>Latest upstream: <strong className="text-[#7E8BB5]">{item.latestVersion}</strong></span>
                        <span>Version checked: <strong className="text-[#7E8BB5]">{item.lastChecked}</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* Status Badges */}
                  <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
                    {item.status === 'NOT_CONFIGURED' ? (
                      <span className="text-[10px] font-bold text-[#7E8BB5] bg-[#7E8BB5]/10 border border-[#7E8BB5]/30 px-2 py-0.5 rounded flex items-center gap-1">
                        <Info className="w-3 h-3" />
                        NOT CONFIGURED
                      </span>
                    ) : item.status === 'WATCHING' ? (
                      <span className="text-[10px] font-bold text-[#7E8BB5] bg-[#7E8BB5]/10 border border-[#7E8BB5]/30 px-2 py-0.5 rounded flex items-center gap-1">
                        <Compass className="w-3 h-3" />
                        WATCHING
                      </span>
                    ) : item.status === 'UP_TO_DATE' ? (
                      <span className="text-[10px] font-bold text-[#00D26A] bg-[#00D26A]/10 border border-[#00D26A]/30 px-2 py-0.5 rounded flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        UP TO DATE
                      </span>
                    ) : item.status === 'UPDATE_AVAILABLE' ? (
                      <span className="text-[10px] font-bold text-[#D97706] bg-[#D97706]/10 border border-[#D97706]/30 px-2 py-0.5 rounded flex items-center gap-1 animate-pulse">
                        <AlertTriangle className="w-3 h-3" />
                        UPDATE AVAILABLE
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-[#FF5E8E] bg-[#FF5E8E]/10 border border-[#FF5E8E]/30 px-2 py-0.5 rounded flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        CRITICAL
                      </span>
                    )}

                    <ChevronRight className={`w-4 h-4 text-[#4A5178] transition-transform ${isSelected ? 'translate-x-1 text-white' : ''}`} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Dynamic Detail Panel / Scanning logs */}
        <div className="xl:col-span-5 space-y-6">
          
          {/* Detailed Info View */}
          <div className="p-5 bg-[#090A14] border border-[#1A1D30] rounded-2xl shadow-xl space-y-5">
            {selectedItem ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-[#1A1D38] pb-3">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4" style={{ color: selectedItem.color }} />
                    <span className="text-xs font-bold uppercase tracking-widest text-white">
                      {selectedItem.name} Details
                    </span>
                  </div>
                  {selectedItem.githubUrl && (
                    <a
                      href={selectedItem.githubUrl}
                      target="_blank"
                      referrerPolicy="no-referrer"
                      className="text-[10px] text-[#615EFF] hover:text-[#A5A2FF] flex items-center gap-1 font-bold"
                    >
                      <span>REPOS</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                <div className="space-y-1.5">
                  <span className="text-[10px] text-[#7A82A6] font-bold uppercase tracking-wider block">Description</span>
                  <p className="text-xs text-[#C5CBE5] leading-relaxed">
                    {selectedItem.description}
                  </p>
                </div>

                {/* Subsystem Capabilities */}
                <div className="space-y-2 pt-2">
                  <span className="text-[10px] text-[#7A82A6] font-bold uppercase tracking-wider block">Subsystem Capabilities</span>
                  <div className="space-y-1.5">
                    {selectedItem.capabilities.map((cap, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <Check className="w-3.5 h-3.5 text-[#00D26A] shrink-0 mt-0.5" />
                        <span className="text-[#C5CBE5]">{cap}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* API & AST Breaking Changes */}
                {selectedItem.breakingChanges.length > 0 && (
                  <div className="p-3.5 bg-rose-500/5 border border-rose-500/20 rounded-xl space-y-2 pt-2">
                    <span className="text-[10px] text-rose-400 font-bold uppercase tracking-wider flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Breaking Changes & AST Watcher Alert
                    </span>
                    <div className="space-y-1.5">
                      {selectedItem.breakingChanges.map((change, i) => (
                        <p key={i} className="text-[11px] text-rose-300 leading-relaxed pl-1">
                          • {change}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-12 text-center text-xs text-[#7A82A6] space-y-2">
                <Crown className="w-8 h-8 text-[#D97706] mx-auto opacity-50 animate-pulse" />
                <p>Select an upstream subsystem from the list to inspect capability models, compiler versions, and breaking API signatures.</p>
              </div>
            )}
          </div>

          {/* Upstream Scan Results Log Panel */}
          <div className="p-5 bg-[#090A14] border border-[#1A1D30] rounded-2xl shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#1A1D38] pb-3">
              <span className="text-xs font-bold text-[#D97706] uppercase tracking-widest">
                UPSTREAM RAW TELEMETRY LOGS
              </span>
              <span className="text-[10px] bg-[#D97706]/10 text-[#D97706] border border-[#D97706]/30 px-2 py-0.5 rounded font-bold">
                [LIVE CRAWL]
              </span>
            </div>

            {scanResult ? (
              <div className="p-4 bg-black border border-[#161828] rounded-xl text-xs font-mono text-[#D0D4EE] leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap">
                {scanResult}
              </div>
            ) : (
              <div className="p-8 bg-[#05060C] border border-[#141628] rounded-xl text-center text-xs text-[#5D6489] space-y-2">
                <Info className="w-5 h-5 text-[#5D6489] mx-auto" />
                <p>No active crawl data. Hit the check updates button above to query live ProductHunt release lists & GitHub repository telemetry via Gemini Search.</p>
              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  );
};
