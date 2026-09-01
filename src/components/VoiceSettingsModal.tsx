import React, { useState, useEffect } from 'react';
import { speakText, VoiceConfig } from '../services/voiceEngine';
import { Volume2, Sparkles, Check, AlertCircle, X, Shield, Sliders } from 'lucide-react';

interface VoiceSettingsModalProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function VoiceSettingsModal({ isOpen = true, onClose }: VoiceSettingsModalProps) {
  const [config, setConfig] = useState<VoiceConfig>({
    provider: 'fish_audio',
    apiKey: '',
    voiceId: '',
    speed: 1.0,
  });
  const [status, setStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('hermes_voice_config');
    if (saved) {
      try {
        setConfig(JSON.parse(saved));
      } catch (e) {}
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('hermes_voice_config', JSON.stringify(config));
    setStatus('Voice configuration saved.');
  };

  const handleTestVoice = async () => {
    setTesting(true);
    setStatus('Testing voice stream...');
    try {
      await speakText('Jarvis audio pipeline verified and active.', config);
      setStatus('Voice verified successfully.');
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  if (!isOpen && onClose) return null;

  const content = (
    <div className="p-6 bg-[#090A14] text-slate-100 rounded-2xl border border-[#1F233C] shadow-2xl max-w-md w-full font-mono text-xs space-y-4">
      <div className="flex items-center justify-between border-b border-[#1A1D30] pb-3">
        <div className="flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-[#615EFF]" />
          <h3 className="text-sm font-bold text-white font-['Space_Grotesk']">Neural Voice & TTS Settings</h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#6A7097] hover:text-white hover:bg-[#151828] transition"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Provider Selector */}
      <div>
        <label className="block text-[10px] uppercase text-[#8E94B8] mb-1 font-bold">Provider</label>
        <select
          value={config.provider}
          onChange={(e) => setConfig({ ...config, provider: e.target.value as any })}
          className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#615EFF]"
        >
          <option value="fish_audio">Fish Audio (Neural TTS - Sub-150ms)</option>
          <option value="elevenlabs">ElevenLabs (Turbo v2)</option>
          <option value="openai">OpenAI TTS (tts-1)</option>
          <option value="web_speech">Browser Web Speech (Offline)</option>
        </select>
      </div>

      {config.provider !== 'web_speech' && (
        <>
          {/* API Key Input */}
          <div>
            <label className="block text-[10px] uppercase text-[#8E94B8] mb-1 font-bold">API Key</label>
            <input
              type="password"
              placeholder="Enter Provider API Key (or use environment default)"
              value={config.apiKey || ''}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#615EFF]"
            />
          </div>

          {/* Reference / Voice ID */}
          <div>
            <label className="block text-[10px] uppercase text-[#8E94B8] mb-1 font-bold">Voice / Reference ID</label>
            <input
              type="text"
              placeholder="e.g. 7f92f8afb8ec43bf81429cc1c9199cb1"
              value={config.voiceId || ''}
              onChange={(e) => setConfig({ ...config, voiceId: e.target.value })}
              className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#615EFF]"
            />
          </div>
        </>
      )}

      {/* Speed Slider */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] uppercase text-[#8E94B8] font-bold">Speed / Rate</label>
          <span className="text-[#A5A2FF] font-bold">{config.speed || 1.0}x</span>
        </div>
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.1"
          value={config.speed || 1.0}
          onChange={(e) => setConfig({ ...config, speed: parseFloat(e.target.value) })}
          className="w-full accent-[#615EFF] cursor-pointer"
        />
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 pt-2 border-t border-[#1A1D30]">
        <button
          type="button"
          onClick={handleTestVoice}
          disabled={testing}
          className="flex-1 bg-[#615EFF] hover:bg-[#524EFA] text-white py-2 rounded-xl text-xs font-bold transition disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          <Sparkles className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
          <span>{testing ? 'Testing...' : 'Test Voice'}</span>
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="flex-1 bg-[#151828] hover:bg-[#1E223D] border border-[#222744] text-[#E2E8F0] py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
        >
          <Check className="w-3.5 h-3.5 text-[#00D26A]" />
          <span>Save Settings</span>
        </button>
      </div>

      {status && (
        <div className={`p-2.5 rounded-xl border flex items-center gap-2 text-xs ${
          status.startsWith('Error') 
            ? 'bg-[#FF5E8E]/10 text-[#FF5E8E] border-[#FF5E8E]/30' 
            : 'bg-[#00D26A]/10 text-[#00D26A] border-[#00D26A]/30'
        }`}>
          {status.startsWith('Error') ? <AlertCircle className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
          <span>{status}</span>
        </div>
      )}
    </div>
  );

  if (onClose) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
        {content}
      </div>
    );
  }

  return content;
}
