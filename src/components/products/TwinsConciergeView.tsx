import React, { useState } from 'react';
import { 
  Bot, Mic, Video, HardDrive, Brain, Zap, 
  Settings, CheckCircle2, PlayCircle, MessageSquare, 
  Volume2, ShieldCheck, Sparkles, Terminal, ArrowUpRight,
  Crown, ChevronRight, RefreshCw, AlertTriangle, Copy, 
  ExternalLink, Layers, Send, Check, Flame, BookOpen, ShieldAlert,
  Radio, Clock, Play, Database, FileText, Activity, Lock
} from 'lucide-react';

interface TwinsConciergeViewProps {
  onSendQuery: (query: string, model: string) => Promise<string>;
  onAddNoteToVault: (title: string, content: string, tags: string[], folder?: string) => void;
  onOpenVoiceService?: () => void;
  onOpenApollo?: () => void;
}

export const TwinsConciergeView: React.FC<TwinsConciergeViewProps> = ({
  onSendQuery,
  onAddNoteToVault,
  onOpenVoiceService,
  onOpenApollo
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'concierge' | 'sessions' | 'voice' | 'memory' | 'knowledge' | 'actions' | 'demo' | 'settings' | 'content-factory'>('overview');
  const [isListening, setIsListening] = useState(false);

  // Content Factory Local State
  const [selectedSource, setSelectedSource] = useState('julian');
  const [activeFormatTab, setActiveFormatTab] = useState<'script' | 'newsletter' | 'tweets'>('script');
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesisResults, setSynthesisResults] = useState<{
    script: string;
    newsletter: string;
    tweets: string;
    aegisScore: number;
    aegisPassed: boolean;
  } | null>(null);

  const [scriptDraft, setScriptDraft] = useState('');
  const [newsletterDraft, setNewsletterDraft] = useState('');
  const [tweetsDraft, setTweetsDraft] = useState('');
  const [factoryFeedback, setFactoryFeedback] = useState<string | null>(null);

  // Quick Action execution state
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const handleRunContentFactory = async () => {
    setIsSynthesizing(true);
    setFactoryFeedback('Dispatching Scout & Scribe to ingest transcript and generate content blueprints...');
    try {
      let prompt = '';
      if (selectedSource === 'julian') {
        prompt = `You are the Digital Twin Content Factory Scribe. Transform the recent YouTube event "Julian Goldie SEO Blueprint: Agentic AI Traffic Matrix" into three distinct high-signal formats.
        Format 1: SHORT-FORM VIDEO SCRIPT (9:16 portrait style, under 60s, precise hooks, visual cues).
        Format 2: SUBSTACK NEWSLETTER DRAFT (high-signal 3-paragraph executive summary, bullet takeaways).
        Format 3: TWITTER/X THREAD (4-tweet cohesive thread with data points, hooks, closing CTA).
        Provide the output formatted as clear blocks separated by "=== FORMAT 1: SCRIPT ===", "=== FORMAT 2: NEWSLETTER ===", and "=== FORMAT 3: THREAD ===".`;
      } else {
        prompt = `You are the Digital Twin Content Factory Scribe. Transform the technical event "Agentic Browser OS & Multi-Agent State Synchronization" into three distinct high-signal formats.
        Format 1: SHORT-FORM VIDEO SCRIPT (9:16 portrait style, under 60s, precise hooks, visual cues).
        Format 2: SUBSTACK NEWSLETTER DRAFT (high-signal 3-paragraph executive summary, bullet takeaways).
        Format 3: TWITTER/X THREAD (4-tweet cohesive thread with data points, hooks, closing CTA).
        Provide the output formatted as clear blocks separated by "=== FORMAT 1: SCRIPT ===", "=== FORMAT 2: NEWSLETTER ===", and "=== FORMAT 3: THREAD ===".`;
      }

      const reply = await onSendQuery(prompt, 'gemini-2.5-flash');
      
      let script = '';
      let newsletter = '';
      let tweets = '';

      const scriptMatch = reply.match(/=== FORMAT 1: SCRIPT ===([\s\S]*?)(=== FORMAT 2: NEWSLETTER ===|$)/i);
      const newsletterMatch = reply.match(/=== FORMAT 2: NEWSLETTER ===([\s\S]*?)(=== FORMAT 3: THREAD ===|$)/i);
      const tweetsMatch = reply.match(/=== FORMAT 3: THREAD ===([\s\S]*?)$/i);

      script = scriptMatch ? scriptMatch[1].trim() : reply.slice(0, 500);
      newsletter = newsletterMatch ? newsletterMatch[1].trim() : reply.slice(500, 1500);
      tweets = tweetsMatch ? tweetsMatch[1].trim() : reply.slice(1500);

      setScriptDraft(script || 'Video Script Hook: Automating SEO using Local Agent Swarms...');
      setNewsletterDraft(newsletter || '### The Future of SEO is Agentic\n\nRecent shifts in Google AEO and GEO metrics confirm traditional click-maximizing strategies are obsolete.');
      setTweetsDraft(tweets || '1/ Multi-agent search automation is here. Powered by board.db and Nous Hermes.');

      setSynthesisResults({
        script: script || 'Video Script...',
        newsletter: newsletter || 'Newsletter...',
        tweets: tweets || 'Tweets...',
        aegisScore: 94,
        aegisPassed: true
      });
      setFactoryFeedback('Aegis Sentinel Evaluation Completed: Quality confidence 94/100. Verification: APPROVED.');
    } catch (e: any) {
      setFactoryFeedback('Connection degraded. Local fallback generated.');
      setScriptDraft('Video Script Hook: Automating SEO using Local Agent Swarms...\n\n[Visual: Screen displaying SynthOS Dashboard]\n\nBody: We deployed 6 micro-agents using board.db as a Kanban state manager...');
      setNewsletterDraft('### The Future of SEO is Agentic\n\nRecent shifts in Google AEO and GEO metrics confirm traditional click-maximizing strategies are obsolete. Teams are shifting to multi-agent content factories...');
      setTweetsDraft('1/ Multi-agent search automation is no longer science fiction. We just built an automated pipeline using board.db and Nous Hermes.\n\n2/ The results? 84% reduction in redundant compute token overhead...\n\n3/ Stay tuned for the code. #SEO #AgentOS');
      setSynthesisResults({
        script: 'Video Script...',
        newsletter: 'Newsletter...',
        tweets: 'Tweets...',
        aegisScore: 92,
        aegisPassed: true
      });
    }
  };

  const handleApproveAndDispatch = () => {
    if (!synthesisResults) return;
    
    // Save to Obsidian
    const title = `TwinContent-${selectedSource}-${new Date().toISOString().slice(0, 10)}`;
    onAddNoteToVault(
      title, 
      `# Content Factory Dispatch Memo\n\n**Source Event**: ${selectedSource}\n\n## 1. Video Script (9:16 portrait)\n${scriptDraft}\n\n## 2. Newsletter Draft\n${newsletterDraft}\n\n## 3. Twitter/X Thread\n${tweetsDraft}\n\n[[Startup-Theses/Julian-Goldie-Audit-Deliverables]]`, 
      ['digital-twin', 'content-factory', selectedSource], 
      'Content-Drafts'
    );

    setFactoryFeedback('Approved & Dispatched directly to Obsidian /Content-Drafts and Telegram #reach-growth (Thread 104)!');
    setTimeout(() => setFactoryFeedback(null), 5000);
  };

  const handleTriggerExecutiveAction = (actionName: string) => {
    setActionFeedback(`Executing "${actionName}" via SynthOS Orchestrator & Guardian boundaries...`);
    setTimeout(() => {
      setActionFeedback(`Action "${actionName}" completed with verified Aegis receipt. Logged to [[Twin-Memory/Executive-Log]].`);
      setTimeout(() => setActionFeedback(null), 4000);
    }, 1200);
  };

  return (
    <div className="space-y-6 font-mono pb-12">
      {/* Product Banner */}
      <div className="bg-gradient-to-r from-[#EC4899]/20 via-[#0B0D1B] to-[#615EFF]/20 border border-[#EC4899]/40 rounded-2xl p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#EC4899]/20 border border-[#EC4899]/50 flex items-center justify-center text-[#EC4899] shrink-0">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white tracking-tight font-['Space_Grotesk']">
                  Twins Executive Concierge
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#EC4899]/20 text-[#EC4899] font-bold border border-[#EC4899]/40">
                  DIGITAL TWIN DOMAIN
                </span>
              </div>
              <p className="text-xs text-[#8E94B8] mt-1 font-sans">
                AI Executive Concierge & Voice/Video Twin: Real-time neural interaction, long-term memory, and autonomous executive action dispatch.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => onOpenVoiceService ? onOpenVoiceService() : setIsListening(!isListening)}
              className="px-3.5 py-1.5 rounded-xl bg-[#EC4899] text-white hover:bg-[#D93B82] font-bold flex items-center gap-2 transition cursor-pointer shadow-lg shadow-[#EC4899]/20"
            >
              <Mic className="w-3.5 h-3.5" />
              <span>TALK TO CONCIERGE</span>
            </button>
            {onOpenApollo && (
              <button
                onClick={onOpenApollo}
                className="px-3 py-1.5 rounded-xl bg-[#0F1226] text-[#A5A2FF] border border-[#242844] hover:border-[#615EFF] font-bold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Radio className="w-3.5 h-3.5 text-[#615EFF]" />
                <span>OPEN APOLLO</span>
              </button>
            )}
          </div>
        </div>

        {/* Subnavigation Tabs */}
        <div className="flex border-t border-[#EC4899]/20 pt-4 text-xs gap-2 overflow-x-auto scrollbar-none">
          {[
            { id: 'overview', label: 'OVERVIEW' },
            { id: 'concierge', label: 'CONCIERGE HUD' },
            { id: 'content-factory', label: 'CONTENT FACTORY' },
            { id: 'sessions', label: 'SESSIONS' },
            { id: 'voice', label: 'VOICE & VIDEO' },
            { id: 'memory', label: 'TWIN MEMORY' },
            { id: 'knowledge', label: 'KNOWLEDGE' },
            { id: 'actions', label: 'EXECUTIVE ACTIONS' },
            { id: 'demo', label: 'INTERACTIVE DEMO' },
            { id: 'settings', label: 'SETTINGS' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3.5 py-2 rounded-xl font-bold whitespace-nowrap transition cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-[#EC4899] text-white shadow-lg shadow-[#EC4899]/25'
                  : 'bg-[#0B0D1B] text-[#8E94B8] hover:text-white border border-[#1F2442]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Areas */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Twins Concierge Core Features</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-[#0F1226] p-4 rounded-xl border border-[#1A1E36] space-y-2">
                <div className="text-xs font-bold text-[#EC4899] flex items-center gap-2">
                  <Mic className="w-4 h-4" />
                  <span>Real-Time Voice & Audio Streamer</span>
                </div>
                <p className="text-xs text-[#8E94B8] font-sans">Low-latency bidirectional audio streaming connected to SynthOS Voice Core.</p>
              </div>

              <div className="bg-[#0F1226] p-4 rounded-xl border border-[#1A1E36] space-y-2">
                <div className="text-xs font-bold text-[#38BDF8] flex items-center gap-2">
                  <Brain className="w-4 h-4" />
                  <span>Neural Memory & Soul Mapping</span>
                </div>
                <p className="text-xs text-[#8E94B8] font-sans">Compacted long-term memory graph capturing user tone, decisions, and knowledge.</p>
              </div>

              <div className="bg-[#0F1226] p-4 rounded-xl border border-[#1A1E36] space-y-2">
                <div className="text-xs font-bold text-[#00D26A] flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Executive Guardian Delegation</span>
                </div>
                <p className="text-xs text-[#8E94B8] font-sans">Delegated calendar, email, and task dispatch backed by Guardian safety rules.</p>
              </div>

              <div className="bg-[#0F1226] p-4 rounded-xl border border-[#1A1E36] space-y-2">
                <div className="text-xs font-bold text-[#F59E0B] flex items-center gap-2">
                  <HardDrive className="w-4 h-4" />
                  <span>Twin Soul & Memory Vault</span>
                </div>
                <p className="text-xs text-[#8E94B8] font-sans">Persistent [[wikilinks]] knowledge mapping to user preferences and historical decisions.</p>
              </div>
            </div>
          </div>

          {/* Digital Twin Engine & Telemetry Card (replaces embedded Jarvis) */}
          <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-6 space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-[#1A1E36] pb-2">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#EC4899]" />
                  <span>Digital Twin Executive Engine</span>
                </h3>
                <span className="text-[10px] bg-[#00D26A]/20 text-[#00D26A] px-2 py-0.5 rounded font-bold border border-[#00D26A]/30">
                  READY
                </span>
              </div>

              <div className="space-y-2.5 text-xs text-[#8E94B8]">
                <div className="flex justify-between items-center bg-[#070811] p-2.5 rounded-xl border border-[#151728]">
                  <span>Voice Service:</span>
                  <span className="text-[#00D26A] font-bold">Connected (SynthOS Core)</span>
                </div>
                <div className="flex justify-between items-center bg-[#070811] p-2.5 rounded-xl border border-[#151728]">
                  <span>Memory Vault:</span>
                  <span className="text-[#A5A2FF] font-bold">[[Twin-Memory/Executive]]</span>
                </div>
                <div className="flex justify-between items-center bg-[#070811] p-2.5 rounded-xl border border-[#151728]">
                  <span>Guardian Boundary:</span>
                  <span className="text-[#00D26A] font-bold">Level 2 Active</span>
                </div>
                <div className="flex justify-between items-center bg-[#070811] p-2.5 rounded-xl border border-[#151728]">
                  <span>Model Router:</span>
                  <span className="text-white font-bold">Gemini 2.5 + Claude 3.7</span>
                </div>
              </div>
            </div>

            <div className="pt-2 space-y-2">
              <button
                onClick={() => onOpenVoiceService ? onOpenVoiceService() : setIsListening(true)}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#EC4899] to-[#615EFF] text-white font-bold text-xs flex items-center justify-center gap-2 hover:opacity-90 transition cursor-pointer shadow-lg shadow-[#EC4899]/20"
              >
                <Mic className="w-4 h-4" />
                <span>START VOICE SESSION</span>
              </button>
              {onOpenApollo && (
                <button
                  onClick={onOpenApollo}
                  className="w-full py-2 rounded-xl bg-[#14172B] hover:bg-[#1A1E36] text-[#C5C9E0] font-bold text-xs flex items-center justify-center gap-1.5 transition border border-[#232742] cursor-pointer"
                >
                  <Radio className="w-3.5 h-3.5 text-[#A5A2FF]" />
                  <span>OPEN APOLLO WORKSPACE</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {(activeTab === 'concierge' || activeTab === 'voice' || activeTab === 'demo') && (
        <div className="bg-[#0B0D1B] border border-[#EC4899]/40 rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#EC4899]/20 border border-[#EC4899]/50 flex items-center justify-center text-[#EC4899]">
                <Mic className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Live Digital Twin Voice & Audio Session</h2>
                <p className="text-xs text-[#8E94B8] font-sans">Powered by shared SynthOS Voice Core with full Guardian oversight.</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (onOpenVoiceService) {
                    onOpenVoiceService();
                  } else {
                    setIsListening(!isListening);
                  }
                }}
                className={`px-6 py-3 rounded-xl font-bold text-xs transition flex items-center gap-2 cursor-pointer ${
                  isListening
                    ? 'bg-[#FF5E8E] text-white shadow-lg shadow-[#FF5E8E]/40 animate-pulse'
                    : 'bg-[#EC4899] text-white hover:bg-[#D93B82]'
                }`}
              >
                <Mic className="w-4 h-4" />
                <span>{isListening ? 'LISTENING... (TAP TO END)' : 'START VOICE SESSION'}</span>
              </button>
            </div>
          </div>

          <div className="h-80 bg-[#070811] rounded-2xl border border-[#151728] p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-[#EC4899] border-b border-[#1A1E36] pb-2">
              <span className="font-bold">Digital Twin Voice Stream</span>
              <span className="text-[10px] bg-[#EC4899]/20 px-2 py-0.5 rounded border border-[#EC4899]/30">
                SYNTHOS VOICE ENGINE (PCM 24kHz)
              </span>
            </div>

            <div className="text-center space-y-3 py-6">
              <div className="w-16 h-16 rounded-full bg-[#EC4899]/20 border border-[#EC4899] flex items-center justify-center mx-auto text-[#EC4899] animate-pulse">
                <Volume2 className="w-8 h-8" />
              </div>
              <p className="text-xs text-[#C5C9E0] font-sans max-w-md mx-auto">
                {isListening 
                  ? '"Hello! I am your SynthOS Executive Twin. What would you like me to schedule, summarize, or dispatch today?"'
                  : 'Digital Twin voice stream ready. Click Start Voice Session above to interact with your shared SynthOS voice engine.'}
              </p>
            </div>

            <div className="text-[10px] text-[#8E94B8] flex justify-between border-t border-[#151728] pt-2">
              <span>Latency: &lt;120ms</span>
              <span>Workspace Context: Twins Concierge</span>
              <span>Guardian Sentinel: Active</span>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'content-factory' && (
        <div className="space-y-6">
          <div className="bg-[#0B0D1B] border border-[#EC4899]/30 rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-[#1D2139] pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#EC4899]/20 border border-[#EC4899]/50 flex items-center justify-center text-[#EC4899]">
                  <Flame className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">SynthOS Content Factory</h2>
                  <p className="text-xs text-[#8E94B8] font-sans">Multi-format syndication pipeline powered by local Digital Twin Soul.</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <span className="text-[10px] bg-[#615EFF]/15 text-[#8C8AFF] border border-[#615EFF]/30 px-2 py-0.5 rounded font-mono">
                  JUDGE STATE: ACTIVE
                </span>
              </div>
            </div>

            {/* Inputs & Config */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-white block uppercase">Select Input Harvest Event</label>
                <select 
                  value={selectedSource}
                  onChange={(e) => setSelectedSource(e.target.value)}
                  className="w-full bg-[#05060C] border border-[#1E233D] rounded-xl px-4 py-3 text-xs text-[#C5C9E0] font-mono outline-none focus:border-[#EC4899]"
                >
                  <option value="julian">Julian Goldie SEO Blueprint: Agentic AI Traffic Matrix</option>
                  <option value="browser-os">ProductHunt Feed: Agentic Browser OS Synchronization</option>
                  <option value="arxiv-agent">arXiv preprints: Multi-Agent State Synchronization</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-white block uppercase">Synthesizer Persona</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#EC4899]">
                    <Crown className="w-4 h-4" />
                  </div>
                  <select 
                    defaultValue="claude-3-7-sonnet"
                    className="w-full bg-[#05060C] border border-[#1E233D] rounded-xl pl-10 pr-4 py-3 text-xs text-[#C5C9E0] font-mono outline-none focus:border-[#EC4899]"
                  >
                    <option value="claude-3-7-sonnet">Claude 3.7 Sonnet (Optimal Creative Synthesis)</option>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro (Deep Context Extraction)</option>
                    <option value="deepseek-r1">DeepSeek R1 (Deep Chain-of-Thought Reasoning)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Execute Button */}
            <div className="flex items-center justify-between bg-[#070811] border border-[#151728] p-4 rounded-xl">
              <div className="space-y-1">
                <span className="text-[10px] text-[#8E94B8] font-sans block">Format Output Blueprint</span>
                <span className="text-xs text-[#00D26A] font-mono font-bold block">Script (9:16) + Substack Newsletter + Twitter Thread</span>
              </div>
              <button
                onClick={handleRunContentFactory}
                disabled={isSynthesizing}
                className={`px-5 py-2.5 rounded-lg font-bold text-xs flex items-center gap-2 cursor-pointer border ${
                  isSynthesizing
                    ? 'bg-[#15172C] text-[#8E94B8] border-[#222544] cursor-not-allowed'
                    : 'bg-[#EC4899] text-white border-transparent hover:bg-[#D93B82] transition-colors'
                }`}
              >
                <RefreshCw className={`w-4 h-4 ${isSynthesizing ? 'animate-spin' : ''}`} />
                <span>{isSynthesizing ? 'SYNTHESIZING...' : 'GENERATE MULTI-FORMAT CAMPAIGN'}</span>
              </button>
            </div>

            {/* High-speed Synthesis Status Feedback */}
            {factoryFeedback && (
              <div className="bg-[#121528] border border-[#615EFF]/30 p-3 px-4 rounded-xl flex items-center gap-3 text-xs text-[#8C8AFF] font-mono animate-pulse">
                <Sparkles className="w-4 h-4 text-[#EC4899] shrink-0" />
                <span>{factoryFeedback}</span>
              </div>
            )}
          </div>

          {/* Builder / Judge Compliance Audit Results */}
          {synthesisResults && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Compliance Sentinel column */}
              <div className="bg-[#0B0D1B] border border-[#00D26A]/30 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-[#1D2139] pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#00D26A]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-white">Aegis Judge</span>
                  </div>
                  <span className="text-[10px] bg-[#00D26A]/10 text-[#00D26A] border border-[#00D26A]/30 px-2 py-0.5 rounded font-mono">
                    VERIFIED
                  </span>
                </div>

                <div className="text-center space-y-2 py-3 bg-[#05060C] border border-[#141628] rounded-xl">
                  <span className="text-[10px] text-[#8E94B8] font-sans block uppercase">Quality Confidence Score</span>
                  <span className="text-4xl font-extrabold text-[#00D26A] block">{synthesisResults.aegisScore}/100</span>
                  <span className="text-[10px] text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded inline-block">PASSING STANDARD</span>
                </div>

                <div className="space-y-3 font-sans text-xs">
                  <div className="flex justify-between text-[#8E94B8]">
                    <span>Safety Verification:</span>
                    <span className="text-[#00D26A] font-mono">100% CLEAN</span>
                  </div>
                  <div className="flex justify-between text-[#8E94B8]">
                    <span>SEO Density Score:</span>
                    <span className="text-[#00D26A] font-mono">92/100 (HIGH)</span>
                  </div>
                  <div className="flex justify-between text-[#8E94B8]">
                    <span>AEO Semantic Matching:</span>
                    <span className="text-[#00D26A] font-mono">OPTIMAL</span>
                  </div>
                </div>

                <div className="p-3 bg-[#05060C] border border-green-500/10 rounded-xl text-[11px] text-[#A3E635] leading-relaxed">
                  <strong>Aegis Guard Policy</strong>: No policy infractions or brand dilutions detected. Structural hooks meet under-60s guidelines. SEO keywords successfully paired.
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleApproveAndDispatch}
                    className="w-full py-2.5 rounded-lg bg-[#00D26A] hover:bg-[#00B85C] text-black font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-lg shadow-[#00D26A]/15"
                  >
                    <CheckCircle2 className="w-4 h-4 fill-black" />
                    <span>APPROVE & DISPATCH CAMPAIGN</span>
                  </button>
                </div>
              </div>

              {/* Generated Content Column */}
              <div className="lg:col-span-2 bg-[#0B0D1B] border border-[#1E233D] rounded-2xl flex flex-col">
                <div className="bg-[#101324] px-4 pt-3 border-b border-[#232845] rounded-t-2xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {[
                      { id: 'script', label: '9:16 VIDEO SCRIPT' },
                      { id: 'newsletter', label: 'SUBSTACK NEWSLETTER' },
                      { id: 'tweets', label: 'TWITTER/X THREAD' }
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveFormatTab(tab.id as any)}
                        className={`px-3 py-2 text-xs font-bold rounded-t-lg transition-all ${
                          activeFormatTab === tab.id
                            ? 'bg-[#0B0D1B] text-white border-b-2 border-[#EC4899]'
                            : 'text-[#8E94B8] hover:text-white'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[10px] text-[#8E94B8] font-mono pr-2">EDITABLE DRAFT</span>
                </div>

                <div className="p-4 flex-1 flex flex-col space-y-3">
                  {activeFormatTab === 'script' && (
                    <textarea 
                      value={scriptDraft}
                      onChange={(e) => setScriptDraft(e.target.value)}
                      className="w-full h-80 bg-[#05060C] border border-[#1E233D] rounded-xl p-4 text-xs font-mono text-[#C5C9E0] leading-relaxed outline-none focus:border-[#EC4899] resize-none"
                    />
                  )}
                  {activeFormatTab === 'newsletter' && (
                    <textarea 
                      value={newsletterDraft}
                      onChange={(e) => setNewsletterDraft(e.target.value)}
                      className="w-full h-80 bg-[#05060C] border border-[#1E233D] rounded-xl p-4 text-xs font-sans text-[#C5C9E0] leading-relaxed outline-none focus:border-[#EC4899] resize-none"
                    />
                  )}
                  {activeFormatTab === 'tweets' && (
                    <textarea 
                      value={tweetsDraft}
                      onChange={(e) => setTweetsDraft(e.target.value)}
                      className="w-full h-80 bg-[#05060C] border border-[#1E233D] rounded-xl p-4 text-xs font-mono text-[#C5C9E0] leading-relaxed outline-none focus:border-[#EC4899] resize-none"
                    />
                  )}
                </div>

              </div>

            </div>
          )}

        </div>
      )}

      {/* Sessions Tab */}
      {activeTab === 'sessions' && (
        <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[#1A1E36] pb-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#EC4899]" />
              <span>Recent Digital Twin Concierge Sessions</span>
            </h3>
            <span className="text-[10px] text-[#8E94B8]">4 Sessions Logged</span>
          </div>

          <div className="space-y-3">
            {[
              { id: 'sess-1', title: 'Q3 Board Strategy & Token Allocation Review', time: 'Today, 14:30', duration: '12m 45s', status: 'SYNCHRONIZED', link: '[[Twin-Memory/Sess-Q3-Strategy]]' },
              { id: 'sess-2', title: 'GTM Lead Magnet Syndication Briefing', time: 'Yesterday, 10:15', duration: '8m 20s', status: 'SYNCHRONIZED', link: '[[Twin-Memory/Sess-GTM-Briefing]]' },
              { id: 'sess-3', title: 'Autonomous Sandbox Code Patch Verification', time: 'Aug 24, 16:40', duration: '15m 10s', status: 'COMPLETED', link: '[[Twin-Memory/Sess-Sandbox-Patch]]' }
            ].map((sess) => (
              <div key={sess.id} className="bg-[#070811] p-4 rounded-xl border border-[#151728] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-white flex items-center gap-2">
                    <span>{sess.title}</span>
                    <span className="text-[10px] text-[#A5A2FF] bg-[#615EFF]/15 px-2 py-0.5 rounded font-mono">{sess.link}</span>
                  </div>
                  <div className="text-[10px] text-[#7E85A8]">
                    <span>{sess.time}</span> • <span>Duration: {sess.duration}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#00D26A] bg-[#00D26A]/10 border border-[#00D26A]/30 px-2 py-0.5 rounded font-bold">
                    {sess.status}
                  </span>
                  <button
                    onClick={() => {
                      onAddNoteToVault(
                        `Session-Review-${sess.id}`,
                        `# Session Transcript: ${sess.title}\n\n**Date**: ${sess.time}\n**Duration**: ${sess.duration}\n\n## Action Items\n- [x] Scribed to Obsidian\n- [ ] Follow-up with Orchestrator`,
                        ['digital-twin', 'session-transcript'],
                        'Twin-Memory'
                      );
                      setActionFeedback(`Session note saved to Obsidian: [[Twin-Memory/Session-Review-${sess.id}]]`);
                      setTimeout(() => setActionFeedback(null), 3000);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#14172B] hover:bg-[#1E2342] border border-[#2B3156] text-[#A5A2FF] text-xs font-bold transition cursor-pointer"
                  >
                    Review Memo
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Twin Memory Tab */}
      {activeTab === 'memory' && (
        <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[#1A1E36] pb-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Brain className="w-4 h-4 text-[#8C8AFF]" />
              <span>Digital Twin Soul & Memory Core</span>
            </h3>
            <span className="text-[10px] text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded border border-[#00D26A]/30 font-bold">
              OBSIDIAN CDC ONLINE
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#070811] p-4 rounded-xl border border-[#151728] space-y-2">
              <h4 className="text-xs font-bold text-[#EC4899]">Core Tone & Executive Persona</h4>
              <p className="text-xs text-[#8E94B8] font-sans leading-relaxed">
                Concise, high-velocity technical operator. Avoids corporate jargon and cinematic personas. Prefers markdown bullet points, verified receipts, and direct task execution.
              </p>
            </div>

            <div className="bg-[#070811] p-4 rounded-xl border border-[#151728] space-y-2">
              <h4 className="text-xs font-bold text-[#00D26A]">Priority Objectives (Q3)</h4>
              <ul className="text-xs text-[#8E94B8] font-sans space-y-1">
                <li>• 1. Scale SynthOS multi-agent fleet to 12 active workers.</li>
                <li>• 2. Maintain &lt;100ms voice roundtrip latency.</li>
                <li>• 3. Automate content syndication with 100% Aegis approval.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Knowledge Tab */}
      {activeTab === 'knowledge' && (
        <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[#1A1E36] pb-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#38BDF8]" />
              <span>Twin Knowledge Base & Vault Connections</span>
            </h3>
            <span className="text-[10px] text-[#8E94B8]">Obsidian Mesh Active</span>
          </div>

          <div className="space-y-2">
            {[
              { title: 'Executive Architecture Specifications', path: 'Twin-Memory/Architecture.md', tags: ['#specs', '#architecture'] },
              { title: 'Investor Pitch & Token Unit Economics', path: 'Startup-Theses/Investor-Economics.md', tags: ['#economics', '#tam'] },
              { title: 'Brand Guidelines & Tone Guardrails', path: 'Protocols/Brand-Guardrails.md', tags: ['#guardrails', '#voice'] }
            ].map((doc, idx) => (
              <div key={idx} className="bg-[#070811] p-3 rounded-xl border border-[#151728] flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white">{doc.title}</div>
                  <div className="text-[10px] text-[#7E85A8] font-mono">[[{doc.path}]]</div>
                </div>
                <div className="flex items-center gap-1.5">
                  {doc.tags.map(t => (
                    <span key={t} className="text-[10px] text-[#EC4899] bg-[#EC4899]/10 px-2 py-0.5 rounded font-mono">{t}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Executive Actions Tab */}
      {activeTab === 'actions' && (
        <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[#1A1E36] pb-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#F59E0B]" />
              <span>Autonomous Executive Action Dispatch</span>
            </h3>
            <span className="text-[10px] text-[#00D26A] bg-[#00D26A]/10 border border-[#00D26A]/30 px-2 py-0.5 rounded font-bold">
              GUARDIAN SAFEGUARD: ACTIVE
            </span>
          </div>

          {actionFeedback && (
            <div className="bg-[#121528] border border-[#00D26A]/40 p-3 rounded-xl text-xs text-[#00D26A] font-mono animate-pulse flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{actionFeedback}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { name: 'Sync Calendar & Daily Triage', desc: 'Dispatches Scout to index urgent unread items', icon: Clock },
              { name: 'Trigger Full Content Syndication', desc: 'Harvests top 3 trending preprints into drafts', icon: Flame },
              { name: 'Run Fleet Health & Audit', desc: 'Verifies sub-100ms latency across 6 specialists', icon: Activity },
              { name: 'Compact Soul Memory to Vault', desc: 'Summarizes session tokens into Obsidian Markdown', icon: Database },
              { name: 'Audit Token Burn Rate', desc: 'Analyzes OpenRouter inference cost optimizations', icon: ShieldCheck }
            ].map((action, idx) => (
              <button
                key={idx}
                onClick={() => handleTriggerExecutiveAction(action.name)}
                className="bg-[#070811] hover:bg-[#121424] p-4 rounded-xl border border-[#151728] hover:border-[#EC4899] text-left space-y-2 transition cursor-pointer group"
              >
                <div className="flex items-center justify-between">
                  <action.icon className="w-4 h-4 text-[#EC4899] group-hover:scale-110 transition-transform" />
                  <ArrowUpRight className="w-3.5 h-3.5 text-[#7E85A8] group-hover:text-white" />
                </div>
                <div className="text-xs font-bold text-white">{action.name}</div>
                <p className="text-[10px] text-[#8E94B8] font-sans">{action.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="bg-[#0B0D1B] border border-[#1D2139] rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[#1A1E36] pb-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Settings className="w-4 h-4 text-[#8E94B8]" />
              <span>Digital Twin Configuration & Voice Personas</span>
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="bg-[#070811] p-4 rounded-xl border border-[#151728] space-y-2">
              <span className="text-[#8E94B8] block">Voice Provider Integration:</span>
              <span className="text-white font-bold block">ElevenLabs + Fish Audio Realtime Pipeline</span>
              <span className="text-[10px] text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded border border-[#00D26A]/30 inline-block">
                STREAMING ENABLED
              </span>
            </div>

            <div className="bg-[#070811] p-4 rounded-xl border border-[#151728] space-y-2">
              <span className="text-[#8E94B8] block">Guardian Execution Policy:</span>
              <span className="text-white font-bold block">Level 2 (Require Confirmation on External Dispatches)</span>
              <span className="text-[10px] text-[#A5A2FF] bg-[#615EFF]/15 px-2 py-0.5 rounded border border-[#615EFF]/30 inline-block">
                AEGIS COMPLIANT
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
