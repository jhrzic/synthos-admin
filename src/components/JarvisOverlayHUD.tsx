import React from 'react';
import { Sparkles, Mic, Volume2, ArrowRight } from 'lucide-react';
import { JarvisSettings } from '../types';

interface JarvisOverlayHUDProps {
  settings: JarvisSettings;
  onTriggerVoice: () => void;
  onOpenFullJarvis: () => void;
  setActiveTab?: (tab: any) => void;
}

export const JarvisOverlayHUD: React.FC<JarvisOverlayHUDProps> = ({
  settings,
  onTriggerVoice,
  onOpenFullJarvis,
  setActiveTab,
}) => {
  if (!settings.hudOverlay) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40">
      <div 
        onClick={() => {
          if (setActiveTab) {
            setActiveTab('jarvis');
          }
          onOpenFullJarvis();
        }}
        className="bg-[#0B0D18]/95 backdrop-blur-md border border-[#242844] hover:border-[#615EFF] p-3 rounded-2xl shadow-2xl flex items-center gap-3 cursor-pointer group transition duration-200"
      >
        <div className="relative w-9 h-9 rounded-xl bg-gradient-to-tr from-[#615EFF]/20 to-[#A5A2FF]/30 border border-[#615EFF]/50 flex items-center justify-center text-[#A5A2FF]">
          <Sparkles className="w-4 h-4 group-hover:scale-110 transition-transform" />
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#00D26A] border-2 border-[#0B0D18]" />
        </div>

        <div className="hidden sm:block">
          <div className="text-xs font-bold text-white flex items-center gap-1.5 font-mono">
            <span>ASSISTANT HUD</span>
            <span className="text-[10px] text-[#A5A2FF] bg-[#615EFF]/15 px-1.5 py-0.2 rounded border border-[#615EFF]/30">
              {settings.voiceProvider === 'fish_audio' ? 'FISH AUDIO' : 'ACTIVE'}
            </span>
          </div>
          <div className="text-[10px] text-[#7E85A8] font-mono">
            Wake: "{settings.wakeWord}" • Ready
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onTriggerVoice();
          }}
          className="p-2 rounded-lg bg-[#14172B] hover:bg-[#615EFF] hover:text-white text-[#A5A2FF] transition"
          title="Voice Directive"
        >
          <Mic className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
