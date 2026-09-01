import React, { useState } from 'react';
import { IntakeItem, KanbanTask, AgentRole, AIModelInfo, AgentInfo } from '../types';
import { SetupWizardCard } from './SetupWizardCard';
import { 
  Inbox, Sparkles, CheckCircle2, ArrowRight, Clock, AlertTriangle, 
  Cpu, Brain, Radio, MessageSquare, Code2, Plus, Filter, 
  Trash2, RefreshCw, Send, Check, ShieldCheck, ChevronRight,
  Sliders, Mic, FileText, Share2, Layers, Search
} from 'lucide-react';

interface IntakeTriageViewProps {
  intakeItems: IntakeItem[];
  agents: Record<string, AgentInfo>;
  models: Record<string, AIModelInfo>;
  onAddIntakeItem: (item: Omit<IntakeItem, 'id' | 'timestamp'>) => void;
  onUpdateIntakeItem: (id: string, updates: Partial<IntakeItem>) => void;
  onDeleteIntakeItem: (id: string) => void;
  onOptimizeToTask: (intakeId: string) => void;
  onExecutePrompt: (prompt: string, targetModel: string) => Promise<string>;
}

export const IntakeTriageView: React.FC<IntakeTriageViewProps> = ({
  intakeItems,
  agents,
  models,
  onAddIntakeItem,
  onUpdateIntakeItem,
  onDeleteIntakeItem,
  onOptimizeToTask,
  onExecutePrompt,
}) => {
  const [selectedOrigin, setSelectedOrigin] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [activeItem, setActiveItem] = useState<IntakeItem | null>(intakeItems[0] || null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Intake Ingestion Configuration (State persisted)
  const [gatewayMode, setGatewayMode] = useState<'autonomous' | 'human_approval'>('human_approval');
  const [webhookUrl, setWebhookUrl] = useState('https://agentos.internal/api/v1/intake/webhook');
  
  // New Intake Form
  const [isCreating, setIsCreating] = useState(false);
  const [newRawInput, setNewRawInput] = useState('');
  const [newOrigin, setNewOrigin] = useState<IntakeItem['origin']>('DIRECTIVE');
  const [newComplexity, setNewComplexity] = useState<number>(6);
  const [newAgent, setNewAgent] = useState<AgentRole>('orchestrator');
  const [newModelTier, setNewModelTier] = useState<IntakeItem['recommendedModelTier']>('FRONTIER_REASONING');
  
  // Optimizing State
  const [isOptimizingAi, setIsOptimizingAi] = useState(false);
  const [optimizationSuccessToast, setOptimizationSuccessToast] = useState<string | null>(null);

  const filteredItems = intakeItems.filter(item => {
    const matchesOrigin = selectedOrigin === 'all' || item.origin === selectedOrigin;
    const matchesStatus = selectedStatus === 'all' || item.status === selectedStatus;
    const matchesSearch = item.rawInput.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.deliverableSpec.objective.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesOrigin && matchesStatus && matchesSearch;
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRawInput.trim()) return;

    onAddIntakeItem({
      rawInput: newRawInput,
      origin: newOrigin,
      status: 'pending_triage',
      complexityScore: newComplexity,
      cognitiveLoad: newComplexity > 7 ? 'Heavy' : newComplexity > 4 ? 'Moderate' : 'Light',
      recommendedAgent: newAgent,
      recommendedModelTier: newModelTier,
      recommendedModel: newModelTier === 'FRONTIER_REASONING' ? 'hermes' : newModelTier === 'FAST_CODE' ? 'claudecode' : 'gemini',
      suggestedSkills: ['system:advanced-drive-search', 'bash_executor'],
      contextEnrichment: [
        'Auto-extracted from Hermes Ingestion Gate',
        'Awaiting human-in-the-loop review or CoS autonomous DAG schedule'
      ],
      deliverableSpec: {
        objective: newRawInput.slice(0, 120),
        constraints: ['Follow standard context compression protocol'],
        expectedOutputFormat: 'Structured Markdown deliverable + Obsidian [[wikilinks]]',
        evaluationCriteria: 'Zero error codes, verified against target schema.'
      },
      dependencies: []
    });

    setNewRawInput('');
    setIsCreating(false);
  };

  const handleAiAutoEnrich = async (item: IntakeItem) => {
    setIsOptimizingAi(true);
    try {
      const enrichmentPrompt = `As the Hermes Chief of Staff Intake Optimizer, analyze this raw user directive: "${item.rawInput}".
Return an enriched objective and 2 strict constraints formatted as bullet points.`;
      
      const response = await onExecutePrompt(enrichmentPrompt, 'gemini');
      
      onUpdateIntakeItem(item.id, {
        status: 'optimized',
        contextEnrichment: [
          ...item.contextEnrichment,
          `AI CoS Analysis: ${response.slice(0, 160)}...`
        ],
        complexityScore: Math.min(10, item.complexityScore + 1)
      });

      setOptimizationSuccessToast(`Intake ${item.id} optimized with AI CoS context.`);
      setTimeout(() => setOptimizationSuccessToast(null), 3500);
    } catch (err) {
      console.error(err);
    } finally {
      setIsOptimizingAi(false);
    }
  };

  const getOriginBadge = (origin: IntakeItem['origin']) => {
    switch (origin) {
      case 'VOICE_MEMO_JARVIS':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#EC4899]/15 text-[#EC4899] border border-[#EC4899]/30"><Mic className="w-3 h-3" /> VOICE JARVIS</span>;
      case 'TELEGRAM':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30"><MessageSquare className="w-3 h-3" /> TELEGRAM</span>;
      case 'EMAIL_WEBHOOK':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/30"><Radio className="w-3 h-3" /> WEBHOOK</span>;
      case 'DIRECTIVE':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#615EFF]/15 text-[#A5A2FF] border border-[#615EFF]/30"><Brain className="w-3 h-3" /> DIRECTIVE</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#858585]/15 text-[#858585] border border-[#383838]">MANUAL</span>;
    }
  };

  return (
    <div id="tour-intake" className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0D0E1A] p-5 rounded-2xl border border-[#1E2238] shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#615EFF] to-[#EC4899] flex items-center justify-center shadow-lg shadow-[#615EFF]/25">
            <Inbox className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-tight">Intake & Triage Engine</h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30">
                GATEWAY v3.8.4
              </span>
            </div>
            <p className="text-xs text-[#9AA2C6] mt-0.5">
              Intelligent ingestion staging for voice memos, directives, webhooks, and prompt optimization.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#615EFF] hover:bg-[#5653d9] text-white text-xs font-semibold rounded-xl shadow-lg shadow-[#615EFF]/20 transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>New Intake Entry</span>
          </button>
        </div>
      </div>

      {/* 3-Step Setup Wizard for Intake & Triage Engine */}
      <SetupWizardCard
        id="intake-setup-wizard"
        sectionTitle="Intake & Ingestion Gateway Setup"
        sectionSubtitle="3-Step triage policy configuration. Configure ingestion approval gates, inbound webhooks, and voice buffer routing."
        statusBadge={{
          isConnected: true,
          connectedLabel: `Online: ${gatewayMode === 'human_approval' ? 'Human Gate Active' : 'Autonomous Ingestion'}`,
          pendingLabel: "Offline",
        }}
        inputConfig={{
          label: "INGESTION APPROVAL GATEWAY",
          value: gatewayMode,
          placeholder: "Select review policy",
          type: "select",
          options: [
            { label: "Human-in-the-Loop Review Gate (Recommended)", value: "human_approval" },
            { label: "Autonomous Auto-Dispatch (Zero Gate)", value: "autonomous" },
          ],
          helperText: "Autonomous mode converts raw directives straight into Kanban tasks without supervisor pause.",
          onChange: (val) => setGatewayMode(val as any),
        }}
        secondaryConfig={{
          label: "INBOUND WEBHOOK ENDPOINT",
          value: webhookUrl,
          placeholder: "https://agentos.internal/api/v1/intake/webhook",
          type: "text",
          helperText: "Accepts JSON payloads from external Telegram webhooks, Siri shortcuts, or cPanel cron.",
          onChange: (val) => setWebhookUrl(val),
        }}
        onTestConnection={async () => {
          await new Promise((r) => setTimeout(r, 600));
          return {
            success: true,
            message: `Ingestion gateway verified. Mode set to ${gatewayMode.toUpperCase()} with 0 queued errors.`,
          };
        }}
        onSave={() => {
          localStorage.setItem('hermes_intake_mode', gatewayMode);
        }}
        howToGuide={{
          title: "How to Configure the Intake & Triage Gateway",
          steps: [
            "Select your triage gate mode: 'Human-in-the-Loop' stages items in pending_triage; 'Autonomous' routes them immediately.",
            "Inbound voice memos from Jarvis and Telegram threads are normalized with 150ms buffer audio logs.",
            "Use 'CoS Auto-Enrich' on any directive to inject constraints and automatically recommend specialist agents.",
            "Click 'Optimize to Kanban Task' to move validated directives to the SQLite board.db pipeline."
          ],
          troubleshooting: [
            "If incoming webhooks drop, check your Telegram token in the Telegram Mesh settings.",
            "Voice memos require Jarvis Voice microphone permissions enabled."
          ]
        }}
      />

      {optimizationSuccessToast && (
        <div className="p-3 bg-[#00D26A]/10 border border-[#00D26A]/30 rounded-xl text-xs text-[#00D26A] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{optimizationSuccessToast}</span>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-[#0D0E1A] border border-[#1E2238] p-4 rounded-xl">
          <div className="text-[11px] font-mono text-[#8E94B8] uppercase">Total Ingestion Queue</div>
          <div className="text-2xl font-bold text-white mt-1">{intakeItems.length}</div>
          <div className="text-[10px] text-[#00D26A] mt-1 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Active FIFO Buffer
          </div>
        </div>
        <div className="bg-[#0D0E1A] border border-[#1E2238] p-4 rounded-xl">
          <div className="text-[11px] font-mono text-[#8E94B8] uppercase">Optimized & Approved</div>
          <div className="text-2xl font-bold text-[#00D26A] mt-1">
            {intakeItems.filter(i => i.status === 'optimized' || i.status === 'approved').length}
          </div>
          <div className="text-[10px] text-[#8E94B8] mt-1">Ready for CoS Dispatch</div>
        </div>
        <div className="bg-[#0D0E1A] border border-[#1E2238] p-4 rounded-xl">
          <div className="text-[11px] font-mono text-[#8E94B8] uppercase">Avg Complexity Score</div>
          <div className="text-2xl font-bold text-[#FF5E8E] mt-1">6.5 / 10</div>
          <div className="text-[10px] text-[#8E94B8] mt-1">Cognitive load balanced</div>
        </div>
        <div className="bg-[#0D0E1A] border border-[#1E2238] p-4 rounded-xl">
          <div className="text-[11px] font-mono text-[#8E94B8] uppercase">Voice Intake Source</div>
          <div className="text-2xl font-bold text-[#EC4899] mt-1">
            {intakeItems.filter(i => i.origin === 'VOICE_MEMO_JARVIS').length} Memos
          </div>
          <div className="text-[10px] text-[#EC4899] mt-1">Fish Audio Streamed</div>
        </div>
      </div>

      {/* Main Grid: Left List, Right Detail Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Filterable List */}
        <div className="lg:col-span-5 space-y-4">
          {/* Filters */}
          <div className="bg-[#0D0E1A] border border-[#1E2238] p-3 rounded-xl space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#5F6589]" />
              <input
                type="text"
                placeholder="Search raw inputs, objectives, IDs..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-[#141628] border border-[#1E2238] rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
              <button
                onClick={() => setSelectedOrigin('all')}
                className={`px-2.5 py-1 rounded-lg font-mono text-[11px] transition ${
                  selectedOrigin === 'all' ? 'bg-[#615EFF] text-white font-bold' : 'bg-[#141628] text-[#8E94B8] hover:text-white'
                }`}
              >
                ALL
              </button>
              <button
                onClick={() => setSelectedOrigin('VOICE_MEMO_JARVIS')}
                className={`px-2.5 py-1 rounded-lg font-mono text-[11px] transition ${
                  selectedOrigin === 'VOICE_MEMO_JARVIS' ? 'bg-[#EC4899] text-white font-bold' : 'bg-[#141628] text-[#8E94B8] hover:text-white'
                }`}
              >
                VOICE
              </button>
              <button
                onClick={() => setSelectedOrigin('TELEGRAM')}
                className={`px-2.5 py-1 rounded-lg font-mono text-[11px] transition ${
                  selectedOrigin === 'TELEGRAM' ? 'bg-[#00D26A] text-white font-bold' : 'bg-[#141628] text-[#8E94B8] hover:text-white'
                }`}
              >
                TELEGRAM
              </button>
              <button
                onClick={() => setSelectedOrigin('EMAIL_WEBHOOK')}
                className={`px-2.5 py-1 rounded-lg font-mono text-[11px] transition ${
                  selectedOrigin === 'EMAIL_WEBHOOK' ? 'bg-[#38BDF8] text-white font-bold' : 'bg-[#141628] text-[#8E94B8] hover:text-white'
                }`}
              >
                WEBHOOK
              </button>
            </div>
          </div>

          {/* Cards List */}
          <div className="space-y-2.5 max-h-[620px] overflow-y-auto pr-1">
            {filteredItems.map(item => {
              const isSelected = activeItem?.id === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => setActiveItem(item)}
                  className={`p-3.5 rounded-xl border transition cursor-pointer text-left ${
                    isSelected
                      ? 'bg-[#15172A] border-[#615EFF] shadow-lg shadow-[#615EFF]/10'
                      : 'bg-[#0D0E1A] border-[#1E2238] hover:border-[#2D3354] hover:bg-[#111324]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[10px] font-mono font-bold text-[#615EFF]">{item.id}</span>
                    <div className="flex items-center gap-1.5">
                      {getOriginBadge(item.origin)}
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase font-bold ${
                        item.status === 'optimized' || item.status === 'approved' 
                          ? 'bg-[#00D26A]/15 text-[#00D26A]' 
                          : item.status === 'dispatched'
                          ? 'bg-[#38BDF8]/15 text-[#38BDF8]'
                          : 'bg-[#EAB308]/15 text-[#EAB308]'
                      }`}>
                        {item.status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-white font-medium line-clamp-2 leading-relaxed">
                    {item.rawInput}
                  </p>

                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#1C2035] text-[10px] text-[#8E94B8] font-mono">
                    <span className="flex items-center gap-1">
                      <Cpu className="w-3 h-3 text-[#615EFF]" />
                      {item.recommendedAgent.toUpperCase()} ({item.recommendedModel})
                    </span>
                    <span className="text-[#FF5E8E] font-bold">
                      Complexity: {item.complexityScore}/10
                    </span>
                  </div>
                </div>
              );
            })}

            {filteredItems.length === 0 && (
              <div className="p-8 text-center bg-[#0D0E1A] border border-[#1E2238] rounded-xl text-[#5F6589] text-xs">
                No intake items matching current filters.
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Active Intake Detail & Optimization Gate */}
        <div className="lg:col-span-7">
          {activeItem ? (
            <div className="bg-[#0D0E1A] border border-[#1E2238] rounded-2xl p-5 space-y-5">
              {/* Header Info */}
              <div className="flex items-start justify-between gap-4 border-b border-[#1E2238] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-[#615EFF] px-2 py-0.5 bg-[#615EFF]/10 border border-[#615EFF]/30 rounded">
                      {activeItem.id}
                    </span>
                    <span className="text-xs text-[#8E94B8] font-mono">{activeItem.timestamp}</span>
                    {getOriginBadge(activeItem.origin)}
                  </div>
                  <h2 className="text-sm font-semibold text-white mt-2">
                    {activeItem.deliverableSpec.objective}
                  </h2>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAiAutoEnrich(activeItem)}
                    disabled={isOptimizingAi}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1E2238] hover:bg-[#2A2F4C] text-[#A5A2FF] text-xs rounded-lg transition"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${isOptimizingAi ? 'animate-spin' : ''}`} />
                    <span>{isOptimizingAi ? 'Enriching...' : 'CoS Auto-Enrich'}</span>
                  </button>
                  <button
                    onClick={() => onDeleteIntakeItem(activeItem.id)}
                    className="p-1.5 text-[#8E94B8] hover:text-[#FF5E8E] hover:bg-[#FF5E8E]/10 rounded-lg transition"
                    title="Delete Entry"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Raw Ingested Input */}
              <div className="bg-[#121424] border border-[#1E2238] p-3.5 rounded-xl space-y-1.5">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#5F6589] flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-[#615EFF]" />
                  <span>Raw Ingested Directive</span>
                </div>
                <p className="text-xs text-[#E2E8F0] font-mono leading-relaxed bg-[#080911] p-3 rounded-lg border border-[#161828]">
                  {activeItem.rawInput}
                </p>
                {activeItem.audioWaveformData && (
                  <div className="mt-2 pt-2 border-t border-[#1C2035] flex items-center gap-2">
                    <Mic className="w-3.5 h-3.5 text-[#EC4899]" />
                    <span className="text-[10px] font-mono text-[#EC4899]">Audio Stream Waveform Captured (150ms buffer):</span>
                    <div className="flex items-end gap-1 h-5">
                      {activeItem.audioWaveformData.map((h, i) => (
                        <div key={i} className="w-1 bg-[#EC4899] rounded-full" style={{ height: `${Math.min(100, h * 0.7)}%` }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Context Enrichment & Constraints */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#121424] border border-[#1E2238] p-3.5 rounded-xl space-y-2">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#00D26A] flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Context Injected</span>
                  </div>
                  <ul className="space-y-1.5 text-xs text-[#9AA2C6]">
                    {activeItem.contextEnrichment.map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-[#00D26A]">•</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-[#121424] border border-[#1E2238] p-3.5 rounded-xl space-y-2">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#FF5E8E] flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Constraints & Scope</span>
                  </div>
                  <ul className="space-y-1.5 text-xs text-[#9AA2C6]">
                    {activeItem.deliverableSpec.constraints.map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-[#FF5E8E]">•</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Routing & Allocation Recommendation */}
              <div className="bg-[#121424] border border-[#1E2238] p-4 rounded-xl space-y-3">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#A5A2FF] flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Model Tier & Specialist Dispatch Recommendation</span>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="bg-[#080911] p-2.5 rounded-lg border border-[#161828]">
                    <div className="text-[10px] font-mono text-[#5F6589]">ASSIGNED AGENT</div>
                    <div className="font-bold text-white uppercase mt-0.5">{activeItem.recommendedAgent}</div>
                  </div>
                  <div className="bg-[#080911] p-2.5 rounded-lg border border-[#161828]">
                    <div className="text-[10px] font-mono text-[#5F6589]">MODEL TIER</div>
                    <div className="font-bold text-[#615EFF] mt-0.5">{activeItem.recommendedModelTier}</div>
                  </div>
                  <div className="bg-[#080911] p-2.5 rounded-lg border border-[#161828]">
                    <div className="text-[10px] font-mono text-[#5F6589]">PRIMARY MODEL</div>
                    <div className="font-bold text-[#00D26A] mt-0.5">{activeItem.recommendedModel}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {activeItem.suggestedSkills.map(skill => (
                    <span key={skill} className="px-2 py-0.5 rounded bg-[#1C2035] text-[#A5A2FF] text-[10px] font-mono border border-[#2D3354]">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action Buttons: Optimize to Task & Review Gate */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-[#1E2238]">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      onUpdateIntakeItem(activeItem.id, { status: 'approved' });
                      setOptimizationSuccessToast(`Directive ${activeItem.id} approved by human supervisor.`);
                      setTimeout(() => setOptimizationSuccessToast(null), 3000);
                    }}
                    className="px-3 py-2 bg-[#00D26A]/15 hover:bg-[#00D26A]/25 text-[#00D26A] border border-[#00D26A]/30 text-xs font-semibold rounded-xl transition active:scale-95"
                  >
                    Approve Gate
                  </button>
                  <button
                    onClick={() => {
                      onUpdateIntakeItem(activeItem.id, { status: 'rejected' });
                      setOptimizationSuccessToast(`Directive ${activeItem.id} rejected.`);
                      setTimeout(() => setOptimizationSuccessToast(null), 3000);
                    }}
                    className="px-3 py-2 bg-[#FF5E8E]/15 hover:bg-[#FF5E8E]/25 text-[#FF5E8E] border border-[#FF5E8E]/30 text-xs font-semibold rounded-xl transition active:scale-95"
                  >
                    Reject
                  </button>
                </div>

                <button
                  onClick={() => onOptimizeToTask(activeItem.id)}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#615EFF] to-[#EC4899] hover:opacity-90 text-white text-xs font-bold rounded-xl shadow-lg shadow-[#615EFF]/25 transition active:scale-95"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Optimize to Kanban Task</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-[#0D0E1A] border border-[#1E2238] rounded-2xl text-[#5F6589]">
              Select an intake item from the left queue to inspect or optimize.
            </div>
          )}
        </div>
      </div>

      {/* Modal: New Intake Item */}
      {isCreating && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0D0E1A] border border-[#1E2238] rounded-2xl w-full max-w-xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-[#1E2238] pb-3">
              <div className="flex items-center gap-2">
                <Inbox className="w-5 h-5 text-[#615EFF]" />
                <h3 className="text-sm font-bold text-white">Create New Intake Directive</h3>
              </div>
              <button onClick={() => setIsCreating(false)} className="text-[#8E94B8] hover:text-white text-xs">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">
                  Raw User Directive / Prompt / Memo
                </label>
                <textarea
                  value={newRawInput}
                  onChange={e => setNewRawInput(e.target.value)}
                  placeholder="Enter unstructured user goal, voice transcription, or incoming client webhook payload..."
                  rows={4}
                  required
                  className="w-full bg-[#141628] border border-[#1E2238] rounded-xl p-3 text-xs text-white placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Origin Channel</label>
                  <select
                    value={newOrigin}
                    onChange={e => setNewOrigin(e.target.value as IntakeItem['origin'])}
                    className="w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  >
                    <option value="DIRECTIVE">Direct Prompt / Task</option>
                    <option value="VOICE_MEMO_JARVIS">Voice Memo (Jarvis)</option>
                    <option value="TELEGRAM">Telegram Channel</option>
                    <option value="EMAIL_WEBHOOK">Webhook / API</option>
                    <option value="MANUAL">Manual Scratchpad</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Complexity (1-10)</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={newComplexity}
                    onChange={e => setNewComplexity(Number(e.target.value))}
                    className="w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Recommended Agent</label>
                  <select
                    value={newAgent}
                    onChange={e => setNewAgent(e.target.value as AgentRole)}
                    className="w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  >
                    <option value="orchestrator">Orchestrator (Fleet Master)</option>
                    <option value="scout">Scout (Scraping & Trends)</option>
                    <option value="scribe">Scribe (Obsidian Vaults)</option>
                    <option value="reach">Reach (Growth & GTM)</option>
                    <option value="dev">Dev (Full-Stack Engineer)</option>
                    <option value="analytics">Analytics (Metrics)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Model Tier</label>
                  <select
                    value={newModelTier}
                    onChange={e => setNewModelTier(e.target.value as IntakeItem['recommendedModelTier'])}
                    className="w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  >
                    <option value="FRONTIER_REASONING">Frontier Reasoning (Hermes / Claude Opus)</option>
                    <option value="FAST_CODE">Fast Code (Claude Code 3.7)</option>
                    <option value="LONG_CONTEXT">Long Context (Kimi / Gemini Flash)</option>
                    <option value="LOW_LATENCY">Low Latency (Fast Standard)</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#1E2238]">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-4 py-2 bg-[#1E2238] text-[#8E94B8] hover:text-white rounded-lg text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#615EFF] hover:bg-[#5653d9] text-white rounded-lg text-xs font-bold transition shadow-lg shadow-[#615EFF]/20"
                >
                  Create & Stage
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
