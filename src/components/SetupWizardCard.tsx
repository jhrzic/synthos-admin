import React, { useState } from 'react';
import { 
  CheckCircle2, AlertTriangle, Key, ExternalLink, Zap, 
  Check, ChevronDown, ChevronUp, Sparkles, HelpCircle, Shield, Info
} from 'lucide-react';

export interface SetupStep {
  stepNumber: 1 | 2 | 3;
  title: string;
  description: string;
}

export interface SetupWizardCardProps {
  id?: string;
  sectionTitle: string;
  sectionSubtitle: string;
  statusBadge: {
    isConnected: boolean;
    connectedLabel: string;
    pendingLabel: string;
  };
  inputConfig: {
    label: string;
    value: string;
    placeholder: string;
    type?: 'text' | 'password' | 'select' | 'toggle';
    options?: { label: string; value: string }[];
    helperText: string;
    externalDocLink?: {
      url: string;
      label: string;
    };
    onChange: (value: string) => void;
  };
  secondaryConfig?: {
    label: string;
    value: string;
    placeholder: string;
    type?: 'text' | 'password' | 'select' | 'toggle';
    options?: { label: string; value: string }[];
    helperText: string;
    onChange: (value: string) => void;
  };
  onTestConnection: () => Promise<{ success: boolean; message: string }>;
  onSave: () => void;
  howToGuide?: {
    title: string;
    steps: string[];
    troubleshooting: string[];
  };
  defaultExpanded?: boolean;
}

export const SetupWizardCard: React.FC<SetupWizardCardProps> = ({
  id,
  sectionTitle,
  sectionSubtitle,
  statusBadge,
  inputConfig,
  secondaryConfig,
  onTestConnection,
  onSave,
  howToGuide,
  defaultExpanded = true,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [showHowToDrawer, setShowHowToDrawer] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleTestAndSave = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await onTestConnection();
      setTestResult(result);
      if (result.success) {
        onSave();
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 3500);
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || 'Connection test failed. Please verify credentials.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div 
      id={id}
      className="bg-[#090A15] border border-[#1E223D] hover:border-[#2D3358] rounded-2xl p-4 sm:p-5 transition shadow-xl space-y-4"
    >
      {/* Header with Collapsible Toggle and Status Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#16182C] pb-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-[#615EFF]/15 border border-[#615EFF]/30 flex items-center justify-center text-[#A5A2FF] shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white font-mono tracking-tight">
                {sectionTitle}
              </h3>
              {/* Step 1: Status Indicator */}
              <span 
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase transition ${
                  statusBadge.isConnected 
                    ? 'bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30 shadow-[0_0_8px_rgba(0,210,106,0.2)]' 
                    : 'bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/30'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.isConnected ? 'bg-[#00D26A] animate-pulse' : 'bg-[#F59E0B]'}`} />
                <span>{statusBadge.isConnected ? statusBadge.connectedLabel : statusBadge.pendingLabel}</span>
              </span>
            </div>
            <p className="text-xs text-[#8E94B8] mt-0.5">
              {sectionSubtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          {howToGuide && (
            <button
              type="button"
              onClick={() => setShowHowToDrawer(!showHowToDrawer)}
              className="px-2.5 py-1 bg-[#141628] hover:bg-[#1E223D] border border-[#232746] text-[#A5A2FF] text-[11px] font-mono rounded-lg transition flex items-center gap-1"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>How to Configure</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 bg-[#121422] hover:bg-[#1A1D34] border border-[#222744] text-[#8E94B8] hover:text-white rounded-lg transition"
            title={isExpanded ? 'Collapse 3-Step Setup' : 'Expand 3-Step Setup'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Collapsible 3-Step Setup Wizard Body */}
      {isExpanded && (
        <div className="space-y-4 pt-1 animate-fadeIn">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            {/* Step 1 Card: Status & Verification */}
            <div className="bg-[#05060C] border border-[#181B30] rounded-xl p-3.5 space-y-2 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono text-[#615EFF] font-bold uppercase tracking-wider">
                    STEP 1: HEALTH STATUS
                  </span>
                  <span className="text-[10px] font-mono text-[#585E82]">
                    [REALTIME]
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <div className={`p-2 rounded-lg ${statusBadge.isConnected ? 'bg-[#00D26A]/10 text-[#00D26A]' : 'bg-[#F59E0B]/10 text-[#F59E0B]'}`}>
                    {statusBadge.isConnected ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white font-mono">
                      {statusBadge.isConnected ? 'Engine Ready' : 'Configuration Needed'}
                    </div>
                    <div className="text-[10px] text-[#7B82A8]">
                      {statusBadge.isConnected ? 'Persistent credentials bound' : 'Enter key to initialize'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-[#121424] text-[10px] text-[#8E94B8] font-mono flex items-center justify-between">
                <span>Persistence:</span>
                <span className="text-[#00D26A] font-bold">Local + Env Bind</span>
              </div>
            </div>

            {/* Step 2 Card: Direct Input Field */}
            <div className="bg-[#05060C] border border-[#181B30] rounded-xl p-3.5 space-y-2 md:col-span-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-[#615EFF] font-bold uppercase tracking-wider">
                  STEP 2: CREDENTIALS
                </span>
                {inputConfig.externalDocLink && (
                  <a
                    href={inputConfig.externalDocLink.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono text-[#615EFF] hover:underline flex items-center gap-0.5"
                  >
                    <span>{inputConfig.externalDocLink.label}</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-mono text-[#A5A2FF] font-semibold flex items-center gap-1">
                  <Key className="w-3 h-3 text-[#615EFF]" />
                  <span>{inputConfig.label}</span>
                </label>

                {inputConfig.type === 'select' && inputConfig.options ? (
                  <select
                    value={inputConfig.value}
                    onChange={(e) => inputConfig.onChange(e.target.value)}
                    className="w-full bg-[#0A0C18] border border-[#1E223D] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#615EFF] font-mono"
                  >
                    {inputConfig.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="relative">
                    <input
                      type={inputConfig.type === 'password' && !showPassword ? 'password' : 'text'}
                      value={inputConfig.value}
                      onChange={(e) => inputConfig.onChange(e.target.value)}
                      placeholder={inputConfig.placeholder}
                      className="w-full bg-[#0A0C18] border border-[#1E223D] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-[#484E70] focus:outline-none focus:border-[#615EFF] font-mono"
                    />
                    {inputConfig.type === 'password' && (
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2 top-2 text-[10px] text-[#585E82] hover:text-white"
                      >
                        {showPassword ? 'HIDE' : 'SHOW'}
                      </button>
                    )}
                  </div>
                )}
                <p className="text-[9px] text-[#7B82A8] truncate">{inputConfig.helperText}</p>
              </div>

              {secondaryConfig && (
                <div className="space-y-1 pt-1.5 border-t border-[#121424]">
                  <label className="text-[10px] font-mono text-[#8E94B8] block">
                    {secondaryConfig.label}
                  </label>
                  {secondaryConfig.type === 'select' && secondaryConfig.options ? (
                    <select
                      value={secondaryConfig.value}
                      onChange={(e) => secondaryConfig.onChange(e.target.value)}
                      className="w-full bg-[#0A0C18] border border-[#1E223D] rounded-lg px-2 py-1 text-xs text-white font-mono"
                    >
                      {secondaryConfig.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={secondaryConfig.value}
                      onChange={(e) => secondaryConfig.onChange(e.target.value)}
                      placeholder={secondaryConfig.placeholder}
                      className="w-full bg-[#0A0C18] border border-[#1E223D] rounded-lg px-2 py-1 text-xs text-white font-mono"
                    />
                  )}
                </div>
              )}
            </div>

            {/* Step 3 Card: Test & Save */}
            <div className="bg-[#05060C] border border-[#181B30] rounded-xl p-3.5 space-y-2 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono text-[#615EFF] font-bold uppercase tracking-wider">
                    STEP 3: TEST & SAVE
                  </span>
                  <span className="text-[10px] font-mono text-[#00D26A]">
                    {isSaved ? 'SAVED ✓' : 'READY'}
                  </span>
                </div>
                <p className="text-[10px] text-[#8E94B8] leading-relaxed">
                  Performs a live 1-second ping test against the service endpoint and saves configuration.
                </p>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleTestAndSave}
                  disabled={isTesting}
                  className="w-full py-2 bg-gradient-to-r from-[#615EFF] to-[#5653D9] hover:opacity-90 text-white text-xs font-mono font-bold rounded-xl shadow-lg shadow-[#615EFF]/20 transition flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
                >
                  <Zap className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                  <span>{isTesting ? 'TESTING CONNECTION...' : 'TEST & SAVE CONFIG'}</span>
                </button>

                {testResult && (
                  <div className={`p-2 rounded-lg text-[10px] font-mono flex items-start gap-1.5 ${
                    testResult.success ? 'bg-[#00D26A]/10 text-[#00D26A] border border-[#00D26A]/30' : 'bg-[#FF5E8E]/10 text-[#FF5E8E] border border-[#FF5E8E]/30'
                  }`}>
                    {testResult.success ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                    <span className="leading-tight">{testResult.message}</span>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* In-Context "How to Configure" Collapsible Drawer */}
          {showHowToDrawer && howToGuide && (
            <div className="mt-3 p-4 bg-[#070814] border border-[#232746] rounded-xl space-y-3 animate-fadeIn text-xs">
              <div className="flex items-center justify-between border-b border-[#16192C] pb-2">
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-[#38BDF8]" />
                  <span className="font-bold text-white font-mono">{howToGuide.title}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHowToDrawer(false)}
                  className="text-[#8E94B8] hover:text-white text-xs font-mono"
                >
                  ✕ Close Guide
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <span className="text-[10px] font-mono text-[#00D26A] uppercase font-bold">Execution Steps:</span>
                  <ul className="space-y-1 text-[#C5C9E0] text-[11px]">
                    {howToGuide.steps.map((step, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-[#615EFF] font-bold font-mono">{idx + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-1.5">
                  <span className="text-[10px] font-mono text-[#F59E0B] uppercase font-bold">Troubleshooting & Edge Cases:</span>
                  <ul className="space-y-1 text-[#9AA2C6] text-[11px]">
                    {howToGuide.troubleshooting.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-[#F59E0B] font-bold">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
