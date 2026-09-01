import React, { useState, useEffect } from 'react';
import { AIModelInfo, ObsidianNote } from '../types';
import { 
  Sparkles, Terminal, Brain, Code2, Globe, Compass, 
  Send, RefreshCw, CheckCircle2, Copy, Save, Database, 
  Cpu, Activity, Zap, Play, ExternalLink, Sliders, Shield, Layers, ChevronRight
} from 'lucide-react';

interface ModelDashboardViewProps {
  model: AIModelInfo;
  onSendQuery: (query: string, modelId: string, systemInstruction?: string) => Promise<string>;
  onAddNoteToVault: (title: string, content: string, tags: string[]) => void;
}

export const ModelDashboardView: React.FC<ModelDashboardViewProps> = ({
  model,
  onSendQuery,
  onAddNoteToVault,
}) => {
  const [prompt, setPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(
    `You are ${model.name} running on the Hermes OS mesh. Provide precise, high-density outputs with Obsidian wikilinks [[topic]] formatted appropriately.`
  );
  const [isLoading, setIsLoading] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [showThinking, setShowThinking] = useState(true);

  // Chat History per model saved in localStorage to guarantee state persistence across navigation
  const storageKey = `hermes_model_chat_${model.id}`;
  const [history, setHistory] = useState<Array<{
    query: string;
    response: string;
    thinking?: string;
    timestamp: string;
  }>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return [
      {
        query: `Sample diagnostics for ${model.name} connected to Obsidian`,
        response: `[${model.name.toUpperCase()}]: Telemetry nominal. Latency is ${model.latency}ms with context window allocation of ${model.contextWindow}.\n\nReady to analyze vaults or compile code modules into [[Obsidian-Knowledge-Graph]].`,
        thinking: model.id === 'deepseek' ? '1. Analyzing model weights...\n2. Validating chain of thought...\n3. Compiling LaTeX equations and theorem proofs.' : undefined,
        timestamp: '1 min ago'
      }
    ];
  });

  const [savedToast, setSavedToast] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(history));
    } catch (e) {
      console.warn('Could not persist chat history:', e);
    }
  }, [history, storageKey]);

  // Update system prompt default when model changes
  useEffect(() => {
    setSystemPrompt(`You are ${model.name} running on the Hermes OS mesh. Provide precise, high-density outputs with Obsidian wikilinks [[topic]] formatted appropriately.`);
  }, [model.id, model.name]);

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isLoading) return;

    const currentQuery = prompt;
    setPrompt('');
    setIsLoading(true);

    try {
      const reply = await onSendQuery(currentQuery, model.id, systemPrompt);
      const thinkingMock = model.id === 'deepseek' 
        ? `[Chain of Thought (CoT)]:\n1. Decomposing query: "${currentQuery.slice(0, 30)}..."\n2. Performing constraint satisfaction search...\n3. Synthesizing formal proof step-by-step.`
        : undefined;

      setHistory(prev => [
        {
          query: currentQuery,
          response: reply,
          thinking: thinkingMock,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        },
        ...prev
      ]);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePushToObsidian = (item: { query: string; response: string }) => {
    const title = `${model.name.replace(/[^a-zA-Z0-9-]/g, '')}-Synthesis-${new Date().toISOString().slice(0, 10)}`;
    const content = `# ${title}\n\n**Model**: ${model.name} (${model.provider})\n**Context**: ${model.contextWindow}\n\n## Input Query\n> ${item.query}\n\n## Response\n${item.response}\n\n## Wikilinks\n- [[Hermes-Knowledge-Mesh]]\n- [[${model.id}]]\n\n#${model.id} #hermes #obsidian`;
    onAddNoteToVault(title, content, [model.id, 'hermes', 'synthesis']);
    setSavedToast(title);
    setTimeout(() => setSavedToast(null), 3000);
  };

  const presetDirectives = [
    `Synthesize a competitive feature matrix for top AI search agents with [[wikilinks]]`,
    `Refactor TypeScript async handler to enforce sub-50ms execution latency`,
    `Audit OpenRouter API fallback waterfall for high-throughput model execution`,
    `Generate an Obsidian memo outline for autonomous multi-agent fleet deployment`
  ];

  const defaultToolGrants = model.toolGrants || [
    'Obsidian Vault Read/Write',
    'OpenRouter API Streaming',
    'Hermes Memory CDC Indexing',
    'AST Parser & Validator'
  ];

  const fallbackWaterfall = model.fallbackWaterfall || ['gemini', 'hermes', 'deepseek', 'claude'];

  return (
    <div className="space-y-8 pb-16 max-w-7xl mx-auto px-4 font-mono">
      {/* Header Banner with Model Identity */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-4 border-b border-[#1A1D2E] pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span 
              className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider border"
              style={{ borderColor: `${model.color}50`, color: model.color, backgroundColor: `${model.color}15` }}
            >
              SYNAPSE DASHBOARD • {model.provider.toUpperCase()}
            </span>
            {model.openRouterSlug && (
              <span className="text-[10px] font-mono text-[#8E94B8] bg-[#0F1122] px-2 py-0.5 rounded border border-[#222744]">
                {model.openRouterSlug}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="w-3.5 h-3.5 rounded-full shadow-[0_0_8px_currentColor]" style={{ backgroundColor: model.color }} />
            <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-['Space_Grotesk']">
              {model.name}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-[#8E94B8] mt-1 max-w-2xl font-sans">
            {model.description}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono px-3 py-1.5 rounded-lg bg-[#0E101B] border border-[#1E2238] text-[#8E94B8]">
            CONTEXT: <strong className="text-white">{model.contextWindow}</strong>
          </span>
          <span className="text-xs font-mono px-3 py-1.5 rounded-lg bg-[#00D26A]/10 border border-[#00D26A]/30 text-[#00D26A] flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#00D26A] animate-pulse" />
            STATUS: ACTIVE
          </span>
        </div>
      </div>

      {savedToast && (
        <div className="p-3 bg-[#00D26A]/10 border border-[#00D26A]/40 rounded-lg text-xs font-mono text-[#00D26A] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>Pushed output into Obsidian: <strong>{savedToast}.md</strong></span>
          </div>
        </div>
      )}

      {/* Model Spec Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#090A14] border border-[#1C1F33] rounded-xl p-4 space-y-1">
          <div className="text-[10px] font-mono text-[#6E759D] uppercase">Latency</div>
          <div className="text-xl font-bold text-white font-['Space_Grotesk']">{model.latency} ms</div>
          <div className="text-[11px] text-[#615EFF] font-mono">Hermes Fast Pipeline</div>
        </div>

        <div className="bg-[#090A14] border border-[#1C1F33] rounded-xl p-4 space-y-1">
          <div className="text-[10px] font-mono text-[#6E759D] uppercase">Throughput</div>
          <div className="text-xl font-bold text-white font-['Space_Grotesk']">{model.tokensPerSec} tok/s</div>
          <div className="text-[11px] text-[#00D26A] font-mono">Stream Synchronized</div>
        </div>

        <div className="bg-[#090A14] border border-[#1C1F33] rounded-xl p-4 space-y-1">
          <div className="text-[10px] font-mono text-[#6E759D] uppercase">Specialty</div>
          <div className="text-xs font-bold text-white truncate">{model.specialty}</div>
          <div className="text-[11px] text-[#8C8AFF] font-mono">Optimized Engine</div>
        </div>

        <div className="bg-[#090A14] border border-[#1C1F33] rounded-xl p-4 space-y-1">
          <div className="text-[10px] font-mono text-[#6E759D] uppercase">Obsidian Link</div>
          <div className="text-xs font-bold text-[#00D26A]">[[{model.id}]] Linked</div>
          <div className="text-[11px] text-[#6E759D] font-mono">Bi-directional graph</div>
        </div>
      </div>

      {/* Main Workspace (2 Column: Left Controls / Right Terminal & Outputs) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Tuning, Tool Grants & Fallback Chain (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Model Parameters */}
          <div className="bg-[#090A14] border border-[#1C1F33] rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-[#615EFF]" />
              <span>Model Parameters</span>
            </h3>

            <div>
              <label className="text-[11px] font-mono text-[#8E94B8] block mb-1">SYSTEM DIRECTIVE</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                className="w-full bg-[#05060B] border border-[#1E223D] rounded-lg p-2.5 text-xs text-white font-mono focus:outline-none focus:border-[#615EFF]"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] font-mono text-[#8E94B8] mb-1">
                <span>Temperature</span>
                <span>{temperature}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-[#615EFF]"
              />
            </div>

            {model.id === 'deepseek' && (
              <label className="flex items-center gap-2 p-2 bg-[#05060B] rounded-lg border border-[#1C1F33] cursor-pointer">
                <input
                  type="checkbox"
                  checked={showThinking}
                  onChange={(e) => setShowThinking(e.target.checked)}
                  className="accent-[#4D6BFE] w-3.5 h-3.5 rounded"
                />
                <span className="text-xs text-[#8E94B8]">Show Chain-of-Thought (CoT)</span>
              </label>
            )}
          </div>

          {/* Active Tool Grants */}
          <div className="bg-[#090A14] border border-[#1C1F33] rounded-xl p-5 space-y-3">
            <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-[#00D26A]" />
              <span>Active Tool Grants</span>
            </h3>
            <div className="space-y-1.5">
              {defaultToolGrants.map((grant, idx) => (
                <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-[#05060B] border border-[#191D35] text-xs text-[#A5A2FF]">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#00D26A] shrink-0" />
                  <span className="truncate">{grant}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Open-Weight & Frontier Fallback Waterfall */}
          <div className="bg-[#090A14] border border-[#1C1F33] rounded-xl p-5 space-y-3">
            <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span>Fallback Waterfall Chain</span>
            </h3>
            <div className="space-y-1.5">
              {fallbackWaterfall.map((fb, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-[#05060B] border border-[#191D35] text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#171A30] text-[#8E94B8]">
                      #{idx + 1}
                    </span>
                    <span className="text-white font-semibold uppercase">{fb}</span>
                  </div>
                  <span className="text-[10px] text-[#00D26A] font-bold">READY</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Interactive Terminal, Preset Directives & History (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-[#090A14] border border-[#1C1F33] rounded-xl p-6 space-y-6">
            {/* Quick Preset Directives */}
            <div className="space-y-2">
              <div className="text-[10px] font-mono text-[#6A7097] uppercase font-bold">
                Quick Preset Directives
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {presetDirectives.map((preset, idx) => (
                  <button
                    key={idx}
                    onClick={() => setPrompt(preset)}
                    className="p-2.5 rounded-xl bg-[#05060B] border border-[#1D213B] hover:border-[#615EFF] text-left text-xs text-[#A5A2FF] hover:text-white transition flex items-center justify-between group"
                  >
                    <span className="truncate">{preset}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-[#555B7F] group-hover:text-white shrink-0 ml-1" />
                  </button>
                ))}
              </div>
            </div>

            {/* Input Form */}
            <form onSubmit={handleExecute} className="space-y-3">
              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={`Send prompt to ${model.name} (writes output to Obsidian with [[wikilinks]])...`}
                  rows={3}
                  className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-3.5 pr-28 text-xs font-mono text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
                />
                <button
                  type="submit"
                  disabled={isLoading || !prompt.trim()}
                  className="absolute right-3 bottom-4 px-4 py-2 text-xs font-bold rounded-xl bg-[#615EFF] hover:bg-[#524EED] text-white transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-lg shadow-[#615EFF]/25"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>STREAMING...</span>
                    </>
                  ) : (
                    <>
                      <span>TRANSMIT</span>
                      <Send className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* History Feed */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono text-[#6A7097] uppercase font-bold">
                  {model.name} Activity Feed ({history.length})
                </div>
                {history.length > 0 && (
                  <button
                    onClick={() => setHistory([])}
                    className="text-[10px] font-mono text-[#FF5E8E] hover:underline"
                  >
                    Clear Feed
                  </button>
                )}
              </div>

              {history.map((item, idx) => (
                <div 
                  key={idx} 
                  className="bg-[#05060A] border border-[#1C1F33] rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-[#8E94B8]">
                      Query: <strong className="text-white">"{item.query}"</strong>
                    </span>
                    <button
                      onClick={() => handlePushToObsidian(item)}
                      className="px-2.5 py-1 rounded bg-[#111322] hover:bg-[#615EFF] border border-[#232742] text-[11px] font-mono text-[#C0C5DE] hover:text-white transition flex items-center gap-1 cursor-pointer"
                    >
                      <Database className="w-3 h-3 text-[#00D26A]" />
                      <span>Save to Vault</span>
                    </button>
                  </div>

                  {item.thinking && showThinking && (
                    <div className="p-2.5 bg-[#080B18] border border-[#1E2545] rounded-lg text-xs font-mono text-[#8E9BDE] leading-relaxed whitespace-pre-wrap">
                      <div className="text-[10px] font-bold text-[#4D6BFE] uppercase mb-1">
                        Chain of Thought Telemetry:
                      </div>
                      {item.thinking}
                    </div>
                  )}

                  <div className="p-3 bg-[#070810] border border-[#17192A] rounded-lg text-xs font-mono text-[#D7DBEE] leading-relaxed whitespace-pre-wrap">
                    {item.response}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
