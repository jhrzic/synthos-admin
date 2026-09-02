import React from 'react';
import { ShieldCheck, Cpu, Activity, Radio, Sparkles } from 'lucide-react';

export type ApolloVoiceState = 
  | 'LISTENING'
  | 'PROCESSING'
  | 'RESPONDING'
  | 'TOOL_RUNNING'
  | 'APPROVAL_REQUIRED'
  | 'BLOCKED';

interface ApolloVoiceVisualizerProps {
  state: ApolloVoiceState;
  selectedModel?: string;
  targetAgent?: string;
  guardianStatus?: 'PASS' | 'EVALUATING' | 'BLOCKED';
  aegisStatus?: 'VERIFIED' | 'PENDING' | 'SIGNING';
  /** Real round-trip latency from the last /api/apollo/status poll — undefined until one has completed (D3/D6: no fabricated number). */
  latencyMs?: number;
  /** Real status string from /api/apollo/status (D3's vocabulary: NOT_CONFIGURED/HEALTHY/DEGRADED/UNAVAILABLE/PARTIAL), not a hardcoded default. */
  connectionStatus?: string;
  currentTranscript?: string;
  assistantResponse?: string;
  activeTool?: string;
}

export const ApolloVoiceVisualizer: React.FC<ApolloVoiceVisualizerProps> = ({
  state,
  selectedModel = 'hermes-3-llama-3.1-70b',
  targetAgent = 'orchestrator',
  guardianStatus = 'PASS',
  aegisStatus = 'VERIFIED',
  latencyMs,
  connectionStatus = 'LOADING',
  currentTranscript = '',
  assistantResponse = '',
  activeTool,
}) => {
  // State-based dynamic styling and colors
  const getStateConfig = () => {
    switch (state) {
      case 'LISTENING':
        return {
          label: 'LISTENING',
          subtitle: 'Streaming microphone input & ambient audio...',
          primaryColor: '#FF5E8E',
          glowColor: 'rgba(255, 94, 142, 0.45)',
          pulseSpeed: 'animate-pulse',
          badgeBg: 'bg-[#FF5E8E]/10 text-[#FF5E8E] border-[#FF5E8E]/40',
        };
      case 'PROCESSING':
        return {
          label: 'PROCESSING',
          subtitle: 'Synthesizing voice directive & decomposing tasks...',
          primaryColor: '#38BDF8',
          glowColor: 'rgba(56, 189, 248, 0.45)',
          pulseSpeed: 'animate-spin',
          badgeBg: 'bg-[#38BDF8]/10 text-[#38BDF8] border-[#38BDF8]/40',
        };
      case 'RESPONDING':
        return {
          label: 'RESPONDING',
          subtitle: 'Streaming acoustic speech waveform to audio buffer...',
          primaryColor: '#615EFF',
          glowColor: 'rgba(97, 94, 255, 0.45)',
          pulseSpeed: 'animate-bounce',
          badgeBg: 'bg-[#615EFF]/10 text-[#A5A2FF] border-[#615EFF]/40',
        };
      case 'TOOL_RUNNING':
        return {
          label: 'TOOL_RUNNING',
          subtitle: activeTool ? `Executing tool: ${activeTool}` : 'Executing sandbox tools...',
          primaryColor: '#EAB308',
          glowColor: 'rgba(234, 179, 8, 0.45)',
          pulseSpeed: 'animate-spin',
          badgeBg: 'bg-[#EAB308]/10 text-[#EAB308] border-[#EAB308]/40',
        };
      case 'APPROVAL_REQUIRED':
        return {
          label: 'APPROVAL_REQUIRED',
          subtitle: 'Awaiting human-in-the-loop executive signoff...',
          primaryColor: '#F97316',
          glowColor: 'rgba(249, 115, 22, 0.45)',
          pulseSpeed: 'animate-pulse',
          badgeBg: 'bg-[#F97316]/10 text-[#F97316] border-[#F97316]/40',
        };
      case 'BLOCKED':
        return {
          label: 'BLOCKED',
          subtitle: 'Guardian Gate intercepted policy violation.',
          primaryColor: '#EF4444',
          glowColor: 'rgba(239, 68, 68, 0.45)',
          pulseSpeed: 'animate-none',
          badgeBg: 'bg-red-500/10 text-red-400 border-red-500/40',
        };
    }
  };

  const config = getStateConfig();

  return (
    <div className="relative w-full rounded-2xl bg-[#060710] border border-[#181B34] p-6 overflow-hidden flex flex-col items-center justify-between min-h-[360px] select-none font-mono">
      {/* Background Radial Glow Matrix */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20 transition-all duration-700"
        style={{
          background: `radial-gradient(circle at 50% 45%, ${config.primaryColor} 0%, transparent 65%)`
        }}
      />

      {/* Top Status & Telemetry Strip — dot color and latency reflect the
          real polled connectionStatus (D6: never a hardcoded "connected"
          green indicator regardless of actual state). */}
      <div className="w-full flex flex-wrap items-center justify-between gap-3 text-[11px] z-10 border-b border-[#141628] pb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${
            connectionStatus === 'HEALTHY' ? 'bg-[#00D26A] shadow-[0_0_8px_#00D26A]'
            : connectionStatus === 'DEGRADED' || connectionStatus === 'PARTIAL' ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]'
            : connectionStatus === 'LOADING' ? 'bg-slate-500 animate-pulse'
            : 'bg-[#FF5E8E] shadow-[0_0_8px_rgba(255,94,142,0.5)]'
          }`} />
          <span className="text-white font-bold tracking-wider">APOLLO VOICE MATRIX</span>
          <span className="text-[#8E94B8]">/ {connectionStatus}</span>
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${config.badgeBg}`}>
            {config.label}
          </span>
          <span className="text-[10px] text-[#00D26A] bg-[#00D26A]/10 border border-[#00D26A]/30 px-2 py-0.5 rounded">
            {typeof latencyMs === 'number' ? `${latencyMs}ms` : '—'}
          </span>
        </div>
      </div>

      {/* Center Dynamic Acoustic Rings & Hexagonal Core */}
      <div className="relative my-6 flex items-center justify-center z-10">
        {/* Outer Pulsing Ring 1 */}
        <div 
          className="absolute w-52 h-52 rounded-full border border-dashed transition-all duration-700 opacity-40 animate-spin"
          style={{ 
            borderColor: config.primaryColor, 
            animationDuration: state === 'PROCESSING' || state === 'TOOL_RUNNING' ? '6s' : '24s' 
          }}
        />

        {/* Middle Resonance Ring 2 */}
        <div 
          className="absolute w-40 h-40 rounded-full border transition-all duration-500 opacity-60"
          style={{ 
            borderColor: config.primaryColor,
            boxShadow: `0 0 24px ${config.glowColor}`,
            transform: state === 'LISTENING' || state === 'RESPONDING' ? 'scale(1.08)' : 'scale(1.0)'
          }}
        />

        {/* Inner Acoustic Particle Ring 3 */}
        <div 
          className="w-28 h-28 rounded-2xl bg-gradient-to-tr from-[#0B0D1B] via-[#121528] to-[#181C38] border flex flex-col items-center justify-center p-3 shadow-2xl transition-transform duration-300 group"
          style={{ borderColor: config.primaryColor }}
        >
          <div 
            className="w-10 h-10 rounded-xl flex items-center justify-center mb-1 shadow-inner"
            style={{ 
              backgroundColor: `${config.primaryColor}20`,
              color: config.primaryColor
            }}
          >
            {state === 'LISTENING' && <Radio className="w-5 h-5 animate-pulse" />}
            {state === 'PROCESSING' && <Activity className="w-5 h-5 animate-spin" />}
            {state === 'RESPONDING' && <Sparkles className="w-5 h-5 animate-bounce" />}
            {state === 'TOOL_RUNNING' && <Cpu className="w-5 h-5 animate-spin" />}
            {state === 'APPROVAL_REQUIRED' && <ShieldCheck className="w-5 h-5 text-[#F97316]" />}
            {state === 'BLOCKED' && <ShieldCheck className="w-5 h-5 text-red-400" />}
          </div>
          <span className="text-[9px] font-bold text-white tracking-widest uppercase">
            {targetAgent}
          </span>
        </div>
      </div>

      {/* Bottom Equalizer Bar & Live Subtitle */}
      <div className="w-full z-10 space-y-3">
        {/* Equalizer frequency bars */}
        <div className="flex items-center justify-center gap-1.5 h-10 w-full max-w-md mx-auto bg-[#04050A] rounded-xl border border-[#141728] px-4 py-2">
          {Array.from({ length: 28 }).map((_, i) => {
            let height = 'h-1.5';
            if (state === 'LISTENING') {
              height = (i % 2 === 0 ? 'h-6' : i % 3 === 0 ? 'h-8' : 'h-3');
            } else if (state === 'RESPONDING') {
              height = (i % 4 === 0 ? 'h-7' : i % 2 === 0 ? 'h-5' : 'h-2.5');
            } else if (state === 'PROCESSING' || state === 'TOOL_RUNNING') {
              height = 'h-3 animate-pulse';
            }
            return (
              <div
                key={i}
                className={`w-1 rounded-full transition-all duration-150 ${height}`}
                style={{
                  backgroundColor: config.primaryColor,
                  boxShadow: state === 'LISTENING' || state === 'RESPONDING' ? `0 0 6px ${config.primaryColor}` : 'none',
                  animationDelay: `${i * 30}ms`
                }}
              />
            );
          })}
        </div>

        {/* Live Subtitle / Status Text */}
        <div className="text-center text-[11px] text-slate-400 flex items-center justify-center gap-2">
          <span>{config.subtitle}</span>
        </div>
      </div>

      {/* Model & Security Badges at Bottom */}
      <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-[#141628] text-[10px] z-10 text-slate-400">
        <div className="bg-[#090B18] p-2 rounded-lg border border-[#181B34] flex flex-col">
          <span className="text-slate-500 uppercase text-[9px]">Model</span>
          <span className="text-white font-bold truncate">{selectedModel}</span>
        </div>
        <div className="bg-[#090B18] p-2 rounded-lg border border-[#181B34] flex flex-col">
          <span className="text-slate-500 uppercase text-[9px]">Target</span>
          <span className="text-[#A5A2FF] font-bold capitalize">{targetAgent}</span>
        </div>
        <div className="bg-[#090B18] p-2 rounded-lg border border-[#181B34] flex flex-col">
          <span className="text-slate-500 uppercase text-[9px]">Guardian</span>
          <span className={guardianStatus === 'PASS' ? 'text-[#00D26A] font-bold' : 'text-red-400 font-bold'}>
            {guardianStatus}
          </span>
        </div>
        <div className="bg-[#090B18] p-2 rounded-lg border border-[#181B34] flex flex-col">
          <span className="text-slate-500 uppercase text-[9px]">Aegis</span>
          <span className="text-[#38BDF8] font-bold">{aegisStatus}</span>
        </div>
      </div>
    </div>
  );
};
