import React, { useRef, useEffect, useState } from 'react';
import { JarvisSettings } from '../types';
import { 
  Sparkles, Mic, Volume2, Cpu, Zap, Activity, 
  RefreshCw, Radio, Shield, Terminal, Sliders, 
  Maximize2, Minimize2, Play, Eye
} from 'lucide-react';

interface JarvisMindVisualizerProps {
  settings?: JarvisSettings;
  isSpeaking?: boolean;
  isListening?: boolean;
  isLoading?: boolean;
  onTriggerVoice?: () => void;
  onSendQuery?: (query: string) => void;
  height?: number | string;
  compact?: boolean;
  showTelemetryHUD?: boolean;
}

export const JarvisMindVisualizer: React.FC<JarvisMindVisualizerProps> = ({
  settings,
  isSpeaking = false,
  isListening = false,
  isLoading = false,
  onTriggerVoice,
  onSendQuery,
  height = 520,
  compact = false,
  showTelemetryHUD: initialShowTelemetryHUD = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mindState, setMindState] = useState<'standby' | 'listening' | 'thinking' | 'speaking' | 'diagnostic'>('standby');
  const [pulseTrigger, setPulseTrigger] = useState(0);
  const [energyLevel, setEnergyLevel] = useState(92);
  const [rotationSpeed, setRotationSpeed] = useState(1.0);
  const [showTelemetryHUD, setShowTelemetryHUD] = useState(initialShowTelemetryHUD);
  const [coreTemp, setCoreTemp] = useState(36.4);
  const [synapseThroughput, setSynapseThroughput] = useState(14.8);

  // Sync props to mindState if active
  useEffect(() => {
    if (isSpeaking) setMindState('speaking');
    else if (isLoading) setMindState('thinking');
    else if (isListening) setMindState('listening');
    else if (mindState !== 'diagnostic') setMindState('standby');
  }, [isSpeaking, isLoading, isListening]);

  // Live telemetry jitter for authentic feel
  useEffect(() => {
    const interval = setInterval(() => {
      setCoreTemp(prev => +(36.0 + Math.random() * 1.2).toFixed(1));
      setSynapseThroughput(prev => +(14.2 + Math.random() * 1.8).toFixed(1));
      if (mindState === 'thinking') {
        setEnergyLevel(prev => Math.min(99, +(prev + (Math.random() - 0.4)).toFixed(0)));
      }
    }, 1800);
    return () => clearInterval(interval);
  }, [mindState]);

  // Canvas 60fps holographic render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let time = 0;

    // Constellation particles
    const particleCount = compact ? 40 : 90;
    const particles: Array<{
      x: number;
      y: number;
      z: number;
      radius: number;
      angle: number;
      speed: number;
      layer: number;
      color: string;
    }> = [];

    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * (compact ? 90 : 160);
      particles.push({
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        z: (Math.random() - 0.5) * 100,
        radius: 1 + Math.random() * 2.2,
        angle,
        speed: (0.003 + Math.random() * 0.008) * (Math.random() > 0.5 ? 1 : -1),
        layer: Math.floor(Math.random() * 3),
        color: Math.random() > 0.4 ? '#EAB308' : '#615EFF',
      });
    }

    // Audio frequency bands (32 radial bars)
    const freqBands = Array.from({ length: 48 }, () => Math.random());

    const resize = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener('resize', resize);

    const render = () => {
      const container = containerRef.current;
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      const cx = w / 2;
      const cy = h / 2;

      ctx.clearRect(0, 0, w, h);

      time += 0.025 * rotationSpeed;

      // Update frequency bands simulation based on state
      for (let i = 0; i < freqBands.length; i++) {
        let target = 0.15;
        if (mindState === 'speaking') {
          target = 0.3 + Math.sin(time * 6 + i * 0.4) * 0.45 + Math.random() * 0.25;
        } else if (mindState === 'listening') {
          target = 0.25 + Math.sin(time * 3 + i * 0.3) * 0.35 + Math.random() * 0.15;
        } else if (mindState === 'thinking') {
          target = 0.4 + Math.cos(time * 8 + i * 0.5) * 0.4 + Math.random() * 0.2;
        } else {
          target = 0.1 + Math.sin(time * 1.5 + i * 0.2) * 0.08;
        }
        freqBands[i] += (target - freqBands[i]) * 0.15;
      }

      ctx.save();
      ctx.translate(cx, cy);

      // Color themes based on state
      const goldColor = '#EAB308';
      const purpleColor = '#615EFF';
      const cyanColor = '#00F0FF';
      const activeColor = 
        mindState === 'speaking' ? goldColor :
        mindState === 'thinking' ? purpleColor :
        mindState === 'listening' ? cyanColor :
        goldColor;

      // 1. Ambient Background Core Glow
      const bgGlow = ctx.createRadialGradient(0, 0, 10, 0, 0, compact ? 120 : 220);
      bgGlow.addColorStop(0, mindState === 'thinking' ? 'rgba(97, 94, 255, 0.25)' : 'rgba(234, 179, 8, 0.2)');
      bgGlow.addColorStop(0.5, 'rgba(97, 94, 255, 0.06)');
      bgGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = bgGlow;
      ctx.beginPath();
      ctx.arc(0, 0, compact ? 120 : 220, 0, Math.PI * 2);
      ctx.fill();

      // 2. 3D Gyroscopic Orbital Rings (Pitch & Yaw Tilt)
      const ringCount = compact ? 3 : 5;
      for (let r = 0; r < ringCount; r++) {
        const radius = (compact ? 45 : 70) + r * (compact ? 22 : 32);
        const ringAngle = time * (0.6 + r * 0.3) * (r % 2 === 0 ? 1 : -1);
        const tiltX = Math.sin(time * 0.5 + r) * 0.45;
        const tiltY = Math.cos(time * 0.4 + r) * 0.45;

        ctx.save();
        ctx.beginPath();

        // Approximate 3D rotated ellipse
        const steps = 60;
        for (let s = 0; s <= steps; s++) {
          const theta = (s / steps) * Math.PI * 2;
          const px = Math.cos(theta + ringAngle) * radius;
          const py = Math.sin(theta + ringAngle) * radius * Math.cos(tiltX);
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }

        ctx.strokeStyle = r % 2 === 0 ? goldColor : purpleColor;
        ctx.lineWidth = r === 0 ? 2 : 1;
        ctx.globalAlpha = 0.3 + (Math.sin(time + r) + 1) * 0.2;
        ctx.stroke();

        // Notches / Gyro nodes on the ring
        for (let n = 0; n < 4; n++) {
          const nAngle = ringAngle + (n * Math.PI) / 2;
          const nx = Math.cos(nAngle) * radius;
          const ny = Math.sin(nAngle) * radius * Math.cos(tiltX);

          ctx.beginPath();
          ctx.arc(nx, ny, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = activeColor;
          ctx.shadowColor = activeColor;
          ctx.shadowBlur = 8;
          ctx.fill();
        }

        ctx.restore();
      }

      // 3. Radial Audio Waveform Equalizer Ring (Circular Bars)
      const eqRadius = compact ? 70 : 130;
      const barCount = freqBands.length;
      for (let i = 0; i < barCount; i++) {
        const angle = (i / barCount) * Math.PI * 2 + time * 0.2;
        const barHeight = freqBands[i] * (compact ? 24 : 50);

        const x1 = Math.cos(angle) * eqRadius;
        const y1 = Math.sin(angle) * eqRadius;
        const x2 = Math.cos(angle) * (eqRadius + barHeight);
        const y2 = Math.sin(angle) * (eqRadius + barHeight);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = i % 2 === 0 ? goldColor : activeColor;
        ctx.lineWidth = compact ? 1.5 : 2.5;
        ctx.globalAlpha = 0.5 + freqBands[i] * 0.5;
        ctx.shadowColor = activeColor;
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.restore();
      }

      // 4. Outer HUD Degree Ticks & Target Reticle
      if (!compact) {
        const hudRadius = 190;
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, hudRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.2)';
        ctx.setLineDash([4, 12]);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);

        // Degree ticks (every 30 deg)
        for (let deg = 0; deg < 360; deg += 30) {
          const rad = (deg * Math.PI) / 180 + time * 0.05;
          const x1 = Math.cos(rad) * (hudRadius - 6);
          const y1 = Math.sin(rad) * (hudRadius - 6);
          const x2 = Math.cos(rad) * (hudRadius + 6);
          const y2 = Math.sin(rad) * (hudRadius + 6);

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = 'rgba(234, 179, 8, 0.4)';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Degree text
          if (deg % 90 === 0) {
            const tx = Math.cos(rad) * (hudRadius + 16);
            const ty = Math.sin(rad) * (hudRadius + 16);
            ctx.font = "9px 'JetBrains Mono', monospace";
            ctx.fillStyle = '#8E94B8';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${deg}°`, tx, ty);
          }
        }
        ctx.restore();
      }

      // 5. Constellation Quantum Particles & Filaments
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.angle += p.speed;
        const currentDist = Math.sqrt(p.x * p.x + p.y * p.y);
        const px = Math.cos(p.angle) * currentDist;
        const py = Math.sin(p.angle) * currentDist;

        // Draw particle
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.restore();

        // Connect nearby particles
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const p2Dist = Math.sqrt(p2.x * p2.x + p2.y * p2.y);
          const p2x = Math.cos(p2.angle) * p2Dist;
          const p2y = Math.sin(p2.angle) * p2Dist;

          const dx = p2x - px;
          const dy = p2y - py;
          const d = Math.sqrt(dx * dx + dy * dy);

          if (d < (compact ? 35 : 55)) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(p2x, p2y);
            ctx.strokeStyle = activeColor;
            ctx.globalAlpha = (1 - d / (compact ? 35 : 55)) * 0.25;
            ctx.lineWidth = 0.8;
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // 6. Central Arc Reactor Quantum Core
      const corePulse = (Math.sin(time * 4) + 1) * 0.5;
      const coreRadius = (compact ? 18 : 28) + (mindState === 'speaking' || mindState === 'thinking' ? corePulse * 6 : 0);

      // Core plasma outer halo
      const coreGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, coreRadius * 2);
      coreGrad.addColorStop(0, '#FFFFFF');
      coreGrad.addColorStop(0.3, goldColor);
      coreGrad.addColorStop(0.7, purpleColor);
      coreGrad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, coreRadius * 2, 0, Math.PI * 2);
      ctx.fillStyle = coreGrad;
      ctx.globalAlpha = 0.8;
      ctx.fill();

      // Solid inner core circle
      ctx.beginPath();
      ctx.arc(0, 0, coreRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#06070E';
      ctx.fill();
      ctx.strokeStyle = goldColor;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = goldColor;
      ctx.shadowBlur = 14;
      ctx.stroke();

      // Inner geometric glyph
      ctx.beginPath();
      const sides = 3;
      for (let s = 0; s < sides; s++) {
        const gAngle = time * 2 + (s * Math.PI * 2) / sides;
        const gx = Math.cos(gAngle) * (coreRadius * 0.55);
        const gy = Math.sin(gAngle) * (coreRadius * 0.55);
        if (s === 0) ctx.moveTo(gx, gy);
        else ctx.lineTo(gx, gy);
      }
      ctx.closePath();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.8;
      ctx.shadowColor = '#FFFFFF';
      ctx.shadowBlur = 8;
      ctx.stroke();

      ctx.restore();

      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [mindState, rotationSpeed, compact]);

  const handleTriggerPulse = () => {
    setPulseTrigger(prev => prev + 1);
    setRotationSpeed(2.4);
    setMindState('thinking');
    setTimeout(() => {
      setRotationSpeed(1.0);
      setMindState('standby');
    }, 2800);
  };

  return (
    <div 
      ref={containerRef}
      className="relative bg-[#06070F] border border-[#242844] rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 w-full"
      style={{ height }}
    >
      {/* Canvas Hologram */}
      <canvas ref={canvasRef} className="w-full h-full block" />

      {/* Top Banner: Apollo Voice Core Badge & Mode Selector */}
      <div className="absolute top-4 left-4 right-4 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto bg-[#0B0D18]/90 backdrop-blur-md border border-[#232742] px-3 py-1.5 rounded-xl">
          <span className="w-2.5 h-2.5 rounded-full bg-[#EAB308] animate-pulse" />
          <span className="text-xs font-bold text-white font-mono tracking-wider">
            JARVIS VOICE CORE
          </span>
          <span className="text-[10px] text-[#EAB308] bg-[#EAB308]/10 px-2 py-0.5 rounded border border-[#EAB308]/30 font-mono">
            {mindState.toUpperCase()}
          </span>
        </div>

        {/* Mind Mode Tabs */}
        <div className="flex items-center gap-1 bg-[#0B0D18]/90 backdrop-blur-md border border-[#232742] p-1 rounded-xl pointer-events-auto">
          {[
            { id: 'standby', label: 'STANDBY' },
            { id: 'listening', label: 'LISTEN' },
            { id: 'thinking', label: 'THINK' },
            { id: 'speaking', label: 'SPEAK' },
          ].map((mode) => (
            <button
              key={mode.id}
              onClick={() => setMindState(mode.id as any)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition ${
                mindState === mode.id
                  ? 'bg-[#EAB308] text-black shadow-lg shadow-[#EAB308]/30'
                  : 'text-[#8E94B8] hover:text-white hover:bg-[#15182B]'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* Telemetry HUD Overlays (Glass Panels) */}
      {showTelemetryHUD && (
        <>
          {/* Top-Right HUD Stats */}
          <div className="absolute top-16 right-4 hidden md:flex flex-col gap-2 pointer-events-none font-mono text-[11px]">
            <div className="bg-[#0B0D18]/85 backdrop-blur-md border border-[#232742] px-3 py-2 rounded-xl text-[#8E94B8] space-y-1 w-44">
              <div className="flex justify-between">
                <span>Core Load:</span>
                <span className="text-[#00D26A] font-bold">{energyLevel}%</span>
              </div>
              <div className="w-full bg-[#1A1D30] h-1.5 rounded-full overflow-hidden">
                <div className="bg-gradient-to-r from-[#00D26A] to-[#EAB308] h-full" style={{ width: `${energyLevel}%` }} />
              </div>
            </div>

            <div className="bg-[#0B0D18]/85 backdrop-blur-md border border-[#232742] px-3 py-2 rounded-xl text-[#8E94B8] space-y-0.5 w-44">
              <div className="flex justify-between">
                <span>Temp:</span>
                <span className="text-white">{coreTemp}°C</span>
              </div>
              <div className="flex justify-between">
                <span>Synapse:</span>
                <span className="text-[#EAB308]">{synapseThroughput} GB/s</span>
              </div>
            </div>
          </div>

          {/* Top-Left Telemetry Feed */}
          <div className="absolute top-16 left-4 hidden lg:flex flex-col gap-2 pointer-events-none font-mono text-[10px] text-[#7E85A8]">
            <div className="bg-[#0B0D18]/85 backdrop-blur-md border border-[#232742] p-2.5 rounded-xl space-y-1 w-48">
              <div className="text-white font-bold flex items-center gap-1">
                <Shield className="w-3 h-3 text-[#615EFF]" />
                <span>HERMES VOICE PROTOCOL</span>
              </div>
              <div>• Neural Arbitration: ACTIVE</div>
              <div>• Obsidian Memory Core: ONLINE</div>
              <div>• FFT Equalizer: 48 BANDS</div>
            </div>
          </div>
        </>
      )}

      {/* Bottom Command Bar */}
      <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto bg-[#0B0D18]/90 backdrop-blur-md border border-[#232742] p-1.5 rounded-xl">
          <button
            onClick={handleTriggerPulse}
            className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#EAB308] to-amber-500 hover:from-amber-400 hover:to-amber-600 text-black text-xs font-bold font-mono flex items-center gap-1.5 transition shadow-lg shadow-[#EAB308]/20"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>NEURAL PULSE</span>
          </button>

          {onTriggerVoice && (
            <button
              onClick={onTriggerVoice}
              className="px-3 py-1.5 rounded-lg bg-[#14172B] hover:bg-[#1E2342] border border-[#2B3156] text-[#EAB308] text-xs font-mono font-bold flex items-center gap-1.5 transition"
            >
              <Mic className="w-3.5 h-3.5" />
              <span>VOICE PROMPT</span>
            </button>
          )}

          <button
            onClick={() => setShowTelemetryHUD(!showTelemetryHUD)}
            className="p-1.5 rounded-lg text-[#8E94B8] hover:text-white hover:bg-[#15182B] transition"
            title="Toggle Telemetry HUD"
          >
            <Eye className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-[#0B0D18]/90 backdrop-blur-md border border-[#232742] px-3 py-1.5 rounded-xl flex items-center gap-3 text-[11px] font-mono text-[#8E94B8] pointer-events-auto">
          <span>Neural Memory Core: Nominal</span>
          <span>•</span>
          <span className="text-[#00D26A]">99.98% Coherence</span>
        </div>
      </div>
    </div>
  );
};
