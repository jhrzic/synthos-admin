import React, { useState, useEffect } from 'react';
import { 
  Zap, AlertTriangle, ShieldAlert, Cpu, RefreshCw, 
  Layers, DollarSign, Activity, CheckCircle, Info, Database, Eye, Compass
} from 'lucide-react';

interface TelemetryState {
  availableContext: number;
  retrievedContext: number;
  contextAvoided: number;
  cachedTokens: number;
  inputTokens: number;
  outputTokens: number;
  toolSchemasLoaded: number;
  model: string;
  cost: number;
  latencyMs: number;
  activeLevel: 'L0' | 'L1' | 'L2';
}

export const ContextGovernorTelemetry: React.FC = () => {
  const [telemetry, setTelemetry] = useState<TelemetryState>({
    availableContext: 2000000,
    retrievedContext: 15400,
    contextAvoided: 1984600,
    cachedTokens: 32768,
    inputTokens: 41250,
    outputTokens: 18400,
    toolSchemasLoaded: 18,
    model: 'gemini-3.6-flash',
    cost: 0.1145,
    latencyMs: 340,
    activeLevel: 'L0'
  });

  const [isResetting, setIsResetting] = useState(false);

  // Load state from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('synthos.token_telemetry_v2');
      if (saved) {
        setTelemetry(JSON.parse(saved));
      } else {
        updateToLevel('L0');
      }
    } catch (e) {
      console.warn('Failed to load context governor telemetry:', e);
    }
  }, []);

  const saveTelemetry = (state: TelemetryState) => {
    try {
      localStorage.setItem('synthos.token_telemetry_v2', JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save context governor telemetry:', e);
    }
  };

  const updateToLevel = (level: 'L0' | 'L1' | 'L2') => {
    const totalAvail = 2000000;
    const cached = 32768;
    const toolSchemas = 18;
    const modelStr = 'gemini-3.6-flash';

    let retrieved = 4200;
    let input = 12000;
    let output = 4500;
    let latency = 180;

    if (level === 'L0') {
      // Minimal abstract
      retrieved = 4500;
      input = 12500;
      output = 3400;
      latency = 190;
    } else if (level === 'L1') {
      // Structured overview
      retrieved = 45000;
      input = 52000;
      output = 14500;
      latency = 860;
    } else {
      // Full content
      retrieved = 195000;
      input = 210000;
      output = 38500;
      latency = 3450;
    }

    const avoided = totalAvail - retrieved;
    // Standard model token cost: e.g. prompt $0.075 / M, output $0.30 / M
    const costValue = (input * 0.000000075) + (output * 0.0000003);

    const newState: TelemetryState = {
      availableContext: totalAvail,
      retrievedContext: retrieved,
      contextAvoided: avoided,
      cachedTokens: cached,
      inputTokens: input,
      outputTokens: output,
      toolSchemasLoaded: toolSchemas,
      model: modelStr,
      cost: costValue,
      latencyMs: latency,
      activeLevel: level
    };

    setTelemetry(newState);
    saveTelemetry(newState);
  };

  const handleFlushCache = () => {
    setIsResetting(true);
    setTimeout(() => {
      updateToLevel('L0');
      setIsResetting(false);
    }, 1200);
  };

  const retrievedPercentage = (telemetry.retrievedContext / telemetry.availableContext) * 100;

  return (
    <div className={`p-5 bg-[#090A14] border rounded-2xl transition-all duration-300 space-y-4 ${
      telemetry.activeLevel === 'L2' 
        ? 'border-red-500/50 shadow-lg bg-gradient-to-b from-[#090A14] to-red-950/5' 
        : telemetry.activeLevel === 'L1'
        ? 'border-yellow-600/40 shadow-lg bg-gradient-to-b from-[#090A14] to-yellow-950/5'
        : 'border-[#1C203B]'
    }`}>
      
      {/* Title */}
      <div className="flex items-center justify-between border-b border-[#1A1D30] pb-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#615EFF]" />
          <span className="text-xs font-bold uppercase tracking-widest text-white">
            Context Governor Telemetry
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-bold font-mono">
          <button 
            onClick={() => updateToLevel('L0')}
            className={`text-[9px] px-2 py-1 rounded transition select-none ${
              telemetry.activeLevel === 'L0' 
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' 
                : 'bg-transparent text-gray-500 hover:text-white border border-transparent'
            }`}
          >
            L0 (Minimal)
          </button>
          <button 
            onClick={() => updateToLevel('L1')}
            className={`text-[9px] px-2 py-1 rounded transition select-none ${
              telemetry.activeLevel === 'L1' 
                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40' 
                : 'bg-transparent text-gray-500 hover:text-white border border-transparent'
            }`}
          >
            L1 (Structured)
          </button>
          <button 
            onClick={() => updateToLevel('L2')}
            className={`text-[9px] px-2 py-1 rounded transition select-none ${
              telemetry.activeLevel === 'L2' 
                ? 'bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse' 
                : 'bg-transparent text-gray-500 hover:text-white border border-transparent'
            }`}
          >
            L2 (Full Content)
          </button>
        </div>
      </div>

      {/* Model & Registry indicators */}
      <div className="flex items-center justify-between text-xs font-mono text-gray-400">
        <span className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-blue-400" />
          Model: <strong className="text-white">{telemetry.model}</strong>
        </span>
        <span className="flex items-center gap-1.5">
          <Compass className="w-3.5 h-3.5 text-purple-400" />
          Schemas Loaded: <strong className="text-white">{telemetry.toolSchemasLoaded}</strong>
        </span>
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono">
        <div className="bg-[#05060C] p-3 rounded-xl border border-[#141628] space-y-1">
          <span className="text-[9px] text-[#5D6489] uppercase tracking-wider block">Available Context</span>
          <span className="text-xs font-bold text-white block">{(telemetry.availableContext / 1000).toLocaleString()}k tokens</span>
        </div>
        <div className="bg-[#05060C] p-3 rounded-xl border border-[#141628] space-y-1">
          <span className="text-[9px] text-[#5D6489] uppercase tracking-wider block">Retrieved Context</span>
          <span className="text-xs font-bold text-white block">{(telemetry.retrievedContext).toLocaleString()} tokens</span>
        </div>
        <div className="bg-[#05060C] p-3 rounded-xl border border-[#141628] space-y-1">
          <span className="text-[9px] text-[#5D6489] uppercase tracking-wider block">Context Avoided</span>
          <span className="text-xs font-bold text-emerald-400 block">{(telemetry.contextAvoided).toLocaleString()} tokens</span>
        </div>
        <div className="bg-[#05060C] p-3 rounded-xl border border-[#141628] space-y-1">
          <span className="text-[9px] text-[#5D6489] uppercase tracking-wider block">Cached Tokens</span>
          <span className="text-xs font-bold text-[#38BDF8] block">{(telemetry.cachedTokens).toLocaleString()} tokens</span>
        </div>
      </div>

      {/* Model Input/Output Token details */}
      <div className="grid grid-cols-3 gap-3 font-mono">
        <div className="bg-[#05060C] p-2.5 rounded-xl border border-[#141628] space-y-0.5">
          <span className="text-[8px] text-[#5D6489] uppercase tracking-wider block">Input Tokens</span>
          <span className="text-xs font-bold text-white block">{(telemetry.inputTokens).toLocaleString()}</span>
        </div>
        <div className="bg-[#05060C] p-2.5 rounded-xl border border-[#141628] space-y-0.5">
          <span className="text-[8px] text-[#5D6489] uppercase tracking-wider block">Output Tokens</span>
          <span className="text-xs font-bold text-white block">{(telemetry.outputTokens).toLocaleString()}</span>
        </div>
        <div className="bg-[#05060C] p-2.5 rounded-xl border border-[#141628] space-y-0.5">
          <span className="text-[8px] text-[#5D6489] uppercase tracking-wider block">Est. Cost / Latency</span>
          <span className="text-[10px] font-bold text-yellow-500 block">
            ${telemetry.cost.toFixed(5)} / {telemetry.latencyMs}ms
          </span>
        </div>
      </div>

      {/* Progress occupancy */}
      <div className="space-y-1.5 font-mono">
        <div className="flex items-center justify-between text-[10px] text-[#7A82A6]">
          <span className="flex items-center gap-1">
            <Eye className="w-3.5 h-3.5" />
            Hierarchical Retrieval Level: <strong>{telemetry.activeLevel === 'L0' ? 'L0 Minimal Abstract' : telemetry.activeLevel === 'L1' ? 'L1 Structured Overview' : 'L2 Full Content'}</strong>
          </span>
          <span>{retrievedPercentage.toFixed(2)}% of context read</span>
        </div>
        <div className="h-1.5 w-full bg-[#13162C] rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all duration-500 rounded-full ${
              telemetry.activeLevel === 'L2' 
                ? 'bg-rose-500' 
                : telemetry.activeLevel === 'L1'
                ? 'bg-yellow-500'
                : 'bg-emerald-400'
            }`} 
            style={{ width: `${Math.max(1.5, retrievedPercentage)}%` }}
          />
        </div>
      </div>

      {/* Details explanation depending on Level */}
      <div className="p-3 bg-[#05060C] border border-[#141628] rounded-xl text-[11px] text-[#7A82A6] leading-relaxed font-sans flex items-start gap-2">
        <Info className="w-4 h-4 text-[#615EFF] shrink-0 mt-0.5" />
        <div>
          {telemetry.activeLevel === 'L0' && (
            <p><strong>L0 Minimal Abstract Load State</strong>: Sub-200ms parsing active. Only abstracts, tags, and core headers are retrieved. Avoiding <strong>{(telemetry.contextAvoided).toLocaleString()}</strong> unnecessary tokens.</p>
          )}
          {telemetry.activeLevel === 'L1' && (
            <p><strong>L1 Structured Overview Load State</strong>: Ingesting markdown section headers and outline matrices. Optimized for indexing and claim comparisons. Avoids loading large conversational body copy or redundant transcripts.</p>
          )}
          {telemetry.activeLevel === 'L2' && (
            <p className="text-red-300"><strong>L2 Raw Content Deep Ingestion</strong>: Entire transcript or source file loaded into reasoning memory. Recommended exclusively for code parsing, deep script synthesis, and final verification.</p>
          )}
        </div>
      </div>

      {/* Compact cache flushing control */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-[#5D6489] font-mono uppercase">
          Watchdog status: GOVERNED
        </span>
        <button
          onClick={handleFlushCache}
          disabled={isResetting}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border font-mono transition-all select-none ${
            isResetting 
              ? 'bg-[#121426] text-[#7A82A6] border-[#222644]'
              : 'bg-[#121528] border-[#222644] text-white hover:bg-[#1C203B] hover:border-[#38BDF8] cursor-pointer'
          }`}
        >
          <RefreshCw className={`w-3 h-3 ${isResetting ? 'animate-spin' : ''}`} />
          {isResetting ? 'COMPACTING CONTEXT...' : 'FLUSH MEMORY & RESET TO L0'}
        </button>
      </div>

    </div>
  );
};
