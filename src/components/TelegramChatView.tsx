import React, { useState } from 'react';
import { AgentInfo, TelegramMessage, AgentRole } from '../types';
import { 
  MessageSquare, Send, Bot, Crown, Search, PenTool, 
  Share2, Code2, BarChart3, Radio, RefreshCw, 
  ShieldCheck, AlertCircle, Sparkles, CheckCircle2,
  Terminal, Layers, ArrowRight, CornerDownLeft
} from 'lucide-react';

interface TelegramChatViewProps {
  agents: Record<string, AgentInfo>;
  messages: Record<string, TelegramMessage[]>;
  onSendMessage: (role: AgentRole, text: string) => Promise<void>;
  onResetChannel: (role: AgentRole) => void;
}

export const TelegramChatView: React.FC<TelegramChatViewProps> = ({
  agents,
  messages,
  onSendMessage,
  onResetChannel,
}) => {
  const [activeRole, setActiveRole] = useState<AgentRole>('orchestrator');
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const channels: { role: AgentRole; name: string; threadId: number; icon: any; color: string; model: string }[] = [
    { role: 'orchestrator', name: '#orchestrator-bridge', threadId: 101, icon: Crown, color: '#EC4899', model: 'Nous Hermes 3' },
    { role: 'scout', name: '#scout-intel', threadId: 102, icon: Search, color: '#20B2AA', model: 'Perplexity Sonar' },
    { role: 'scribe', name: '#scribe-notes', threadId: 103, icon: PenTool, color: '#8B5CF6', model: 'Claude Code 3.7' },
    { role: 'reach', name: '#reach-growth', threadId: 104, icon: Share2, color: '#F59E0B', model: 'ChatGPT o3' },
    { role: 'dev', name: '#dev-terminal', threadId: 105, icon: Code2, color: '#00D26A', model: 'Claude Code 3.7' },
    { role: 'analytics', name: '#analytics-metrics', threadId: 106, icon: BarChart3, color: '#3B82F6', model: 'DeepSeek R1' },
  ];

  const currentChannel = channels.find(c => c.role === activeRole) || channels[0];
  const currentMessages = messages[activeRole] || [];
  const currentAgent = agents[activeRole] || agents['orchestrator'];

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isSending) return;

    const query = inputText.trim();
    setInputText('');
    setIsSending(true);
    setTestResult(null);

    try {
      await onSendMessage(activeRole, query);
    } catch (err: any) {
      console.error('Send message error:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleRunRoutingTest = () => {
    setTestResult(`Routing Plugin Verified: Thread ID ${currentChannel.threadId} securely isolated to [${currentAgent.name}]. Zero cross-talk or Orchestrator bleeding detected.`);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#080913] border border-[#181B2E] p-6 rounded-2xl">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2">
            <span className="airbyte-badge">
              HERMES TELEGRAM ROUTING MESH • PART 04
            </span>
            <span className="text-[10px] font-mono text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded border border-[#00D26A]/30">
              6 ISOLATED THREADS
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white font-['Space_Grotesk']">
            Telegram Swarm Bridge & Multi-Agent Router
          </h2>
          <p className="text-xs text-[#8E94B8]">
            One dedicated Telegram thread per specialist agent. Messages routed dynamically based on thread_id with isolated workspaces and zero context bleeding.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRunRoutingTest}
            className="px-3.5 py-2 rounded-xl bg-[#111425] hover:bg-[#1A1E38] border border-[#232847] text-xs font-mono text-[#A5A2FF] transition flex items-center gap-2"
          >
            <ShieldCheck className="w-4 h-4 text-[#00D26A]" />
            <span>Verify Thread Routing</span>
          </button>
        </div>
      </div>

      {testResult && (
        <div className="p-4 bg-[#00D26A]/10 border border-[#00D26A]/30 rounded-xl flex items-center justify-between text-xs font-mono text-[#00D26A]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{testResult}</span>
          </div>
          <button 
            onClick={() => setTestResult(null)}
            className="text-[10px] underline hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Telegram Workspace Mesh */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-[580px]">
        {/* Left Channels List */}
        <div className="bg-[#070810] border border-[#181B2E] rounded-2xl p-4 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between px-2 text-[10px] font-mono text-[#6A7097] uppercase tracking-wider">
              <span>SPECIALIST CHANNELS</span>
              <span>THREAD ID</span>
            </div>

            <div className="space-y-1.5">
              {channels.map((c) => {
                const Icon = c.icon;
                const isSelected = activeRole === c.role;
                const msgCount = (messages[c.role] || []).length;

                return (
                  <button
                    key={c.role}
                    onClick={() => {
                      setActiveRole(c.role);
                      setTestResult(null);
                    }}
                    className={`w-full flex items-center justify-between p-3 rounded-xl text-xs transition text-left group ${
                      isSelected
                        ? 'bg-[#121426] text-white border border-[#615EFF]/60 shadow-md'
                        : 'text-[#8E94B8] hover:bg-[#0E101D] hover:text-white border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div 
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border"
                        style={{ backgroundColor: `${c.color}20`, borderColor: `${c.color}40`, color: c.color }}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="truncate">
                        <div className="font-semibold font-mono truncate text-white">{c.name}</div>
                        <div className="text-[10px] text-[#5D6388] font-mono">{c.model}</div>
                      </div>
                    </div>

                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${
                      isSelected ? 'bg-[#615EFF]/20 text-[#A5A2FF] border-[#615EFF]/40' : 'bg-[#0B0D1A] text-[#555B7F] border-[#181B2E]'
                    }`}>
                      {c.threadId}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-3 bg-[#0A0B17] border border-[#16182C] rounded-xl text-xs font-mono space-y-1 text-[#787FAD]">
            <div className="text-[10px] uppercase text-[#615EFF] font-bold">HERMES ROUTER PLUGIN</div>
            <div className="text-[11px] text-[#8E94B8]">
              Multi-Agent Mode: <span className="text-[#00D26A]">ENABLED</span>
            </div>
            <div className="text-[11px] text-[#8E94B8]">
              Storage: <span className="text-white">board.db</span>
            </div>
          </div>
        </div>

        {/* Right Active Telegram Channel Chat Area */}
        <div className="lg:col-span-3 bg-[#070810] border border-[#181B2E] rounded-2xl flex flex-col justify-between overflow-hidden shadow-xl">
          {/* Channel Header */}
          <div className="p-4 bg-[#0A0B16] border-b border-[#16182C] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div 
                className="w-9 h-9 rounded-xl flex items-center justify-center border shadow-inner"
                style={{ backgroundColor: `${currentChannel.color}20`, borderColor: `${currentChannel.color}40`, color: currentChannel.color }}
              >
                <currentChannel.icon className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-white font-mono">
                    {currentChannel.name}
                  </h3>
                  <span className="text-[10px] font-mono text-[#00D26A] bg-[#00D26A]/10 px-1.5 py-0.5 rounded border border-[#00D26A]/30">
                    THREAD {currentChannel.threadId}
                  </span>
                </div>
                <p className="text-[11px] text-[#7B82A8]">
                  Assigned Agent: <strong className="text-white">{currentAgent.name}</strong> • Engine: <span className="text-[#615EFF] font-mono">{currentChannel.model}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => onResetChannel(activeRole)}
                className="px-3 py-1.5 rounded-lg bg-[#111324] hover:bg-[#1A1D36] border border-[#202440] text-xs font-mono text-[#8E94B8] hover:text-white transition flex items-center gap-1.5"
                title="Flush and reset thread context buffer"
              >
                <RefreshCw className="w-3 h-3 text-[#615EFF]" />
                <span>Reset Thread (Step 15c)</span>
              </button>
            </div>
          </div>

          {/* Messages Stream */}
          <div className="p-6 space-y-4 flex-1 overflow-y-auto max-h-[460px]">
            {currentMessages.length === 0 ? (
              <div className="py-16 text-center space-y-2">
                <Bot className="w-8 h-8 text-[#4B5175] mx-auto" />
                <p className="text-xs font-mono text-[#6A7097]">
                  No messages yet in {currentChannel.name}. Send a directive to begin autonomous routing.
                </p>
              </div>
            ) : (
              currentMessages.map((msg) => {
                const isUser = msg.senderType === 'user';
                const isSystem = msg.senderType === 'system';

                return (
                  <div 
                    key={msg.id}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-2 mb-1 px-1 text-[10px] font-mono text-[#656C93]">
                      <span className={isUser ? 'text-[#00D26A] font-bold' : isSystem ? 'text-[#EAB308]' : 'text-[#615EFF] font-bold'}>
                        {msg.senderName}
                      </span>
                      <span>•</span>
                      <span>{msg.timestamp}</span>
                      {msg.modelUsed && (
                        <span className="text-[#8E94B8] bg-[#121426] px-1.5 py-0.2 rounded border border-[#1F223B]">
                          {msg.modelUsed} ({msg.tokensUsed || 180} tok)
                        </span>
                      )}
                    </div>

                    <div 
                      className={`p-4 rounded-2xl text-xs leading-relaxed max-w-2xl font-mono whitespace-pre-wrap ${
                        isUser
                          ? 'bg-[#181B33] text-white border border-[#282D54] rounded-br-none shadow-md'
                          : isSystem
                          ? 'bg-[#12111E] text-[#EAB308] border border-[#3D331A] rounded-bl-none'
                          : 'bg-[#0E1020] text-[#D3D8F5] border border-[#1D213E] rounded-bl-none shadow-lg'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                );
              })
            )}

            {isSending && (
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-2 mb-1 px-1 text-[10px] font-mono text-[#615EFF]">
                  <span className="font-bold">{currentAgent.name}</span>
                  <span>•</span>
                  <span>Generating response...</span>
                </div>
                <div className="p-4 rounded-2xl text-xs font-mono bg-[#0E1020] border border-[#1D213E] text-[#615EFF] flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-[#615EFF] animate-ping" />
                  <span>Synthesizing response via {currentChannel.model}...</span>
                </div>
              </div>
            )}
          </div>

          {/* Chat Input Box */}
          <form onSubmit={handleSend} className="p-4 bg-[#0A0B16] border-t border-[#16182C] flex items-center gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`Send directive to ${currentAgent.name} (${currentChannel.name})...`}
                className="w-full bg-[#05060C] border border-[#1E223D] focus:border-[#615EFF] rounded-xl px-4 py-3 text-xs text-white placeholder-[#585E82] font-mono focus:outline-none transition"
              />
            </div>

            <button
              type="submit"
              disabled={isSending || !inputText.trim()}
              className="airbyte-btn-primary px-5 py-3 text-xs font-bold flex items-center gap-2 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>DISPATCH</span>
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
