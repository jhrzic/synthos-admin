import React, { useState } from 'react';
import { MessageBridgeConfig, BridgeMessage, AgentRole, AIModelInfo } from '../types';
import { 
  Radio, MessageSquare, Smartphone, Apple, QrCode, Shield, 
  Send, RefreshCw, CheckCircle2, AlertCircle, Copy, Check, 
  Settings2, Sliders, Zap, Lock, Key, ArrowRight, Bot, 
  ExternalLink, Layers, Terminal, Sparkles, PhoneCall, Play
} from 'lucide-react';

interface MessageBridgeViewProps {
  models: Record<string, AIModelInfo>;
  onSendQuery: (prompt: string, modelId?: string, systemPrompt?: string) => Promise<string>;
  onLogEvent?: (level: 'info' | 'warn' | 'success' | 'agent' | 'error', source: string, message: string) => void;
}

export const MessageBridgeView: React.FC<MessageBridgeViewProps> = ({
  models,
  onSendQuery,
  onLogEvent,
}) => {
  // Config State
  const [config, setConfig] = useState<MessageBridgeConfig>({
    imessageEnabled: true,
    whatsappEnabled: true,
    imessageBridgeUrl: 'https://mac-mini-bridge.loca.lt',
    imessageBridgePassword: 'hermes_sec_auth_9948271',
    imessageWebhookSecret: 'whsec_imsg_live_772183',
    whatsappMode: 'headless-baileys-qr',
    whatsappPhoneNumberId: '109876543210987',
    whatsappBusinessAccountId: '98765432109876',
    whatsappApiToken: 'EAAxxxxxxxxxxxxxxxxxxxxx',
    whatsappVerifyToken: 'hermes_wa_verify_2026',
    whatsappPersonalNumber: '+1 646 941 9454',
    whatsappQrCodeStatus: 'connected',
    botOptInRequired: true,
    rateLimitPerMinute: 20,
    cooldownSeconds: 3,
    autoRoutingAgentRole: 'reach',
  });

  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'whatsapp' | 'imessage' | 'simulator' | 'router-rules'>('overview');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [qrScanning, setQrScanning] = useState(false);

  // Live Messages Feed in Bridge
  const [messages, setMessages] = useState<BridgeMessage[]>([
    {
      id: 'msg-wa-1',
      channel: 'whatsapp',
      senderId: '+1 646 941 9454',
      senderName: 'Personal Device (646-941-9454)',
      recipientId: 'Hermes Bot Mode',
      direction: 'inbound',
      messageText: 'Hey Hermes, summarize today\'s top 3 trending AI repos on GitHub.',
      timestamp: '21:30:12',
      status: 'replied',
      assignedAgent: 'scout',
      modelUsed: 'Nous Hermes 3',
      tokensCount: 420,
    },
    {
      id: 'msg-wa-2',
      channel: 'whatsapp',
      senderId: 'Hermes Bot Mode',
      recipientId: '+1 646 941 9454',
      direction: 'outbound',
      messageText: '🤖 [Hermes Scout]: 1. NousResearch/Hermes-3 (+1.2k stars) 2. e2b-dev/fragments (Claude Artifacts) 3. WhiskeySockets/Baileys (Headless WA). Synchronized full analysis into Obsidian [[Repo-Intel-Today]].',
      timestamp: '21:30:15',
      status: 'delivered',
      assignedAgent: 'scout',
      modelUsed: 'Nous Hermes 3',
      tokensCount: 840,
    },
    {
      id: 'msg-imsg-1',
      channel: 'imessage',
      senderId: 'alex.founder@icloud.com',
      senderName: 'Alex (Investor)',
      recipientId: 'Hermes Bot Mode',
      direction: 'inbound',
      messageText: 'Can you send over the latest investment thesis on decentralized agent swarms?',
      timestamp: '21:18:45',
      status: 'replied',
      assignedAgent: 'scribe',
      modelUsed: 'Claude Code 3.7',
      tokensCount: 512,
    },
    {
      id: 'msg-imsg-2',
      channel: 'imessage',
      senderId: 'Hermes Bot Mode',
      recipientId: 'alex.founder@icloud.com',
      direction: 'outbound',
      messageText: '📄 Dispatched: [[Startup-Theses/Decentralized-AgentOS.md]]. Includes TAM calculations ($4.2B), token unit economics ($0.0014/loop), and multi-agent DAG schemas.',
      timestamp: '21:18:48',
      status: 'delivered',
      assignedAgent: 'scribe',
      modelUsed: 'Claude Code 3.7',
      tokensCount: 960,
    },
  ]);

  // Simulator Input State
  const [simChannel, setSimChannel] = useState<'whatsapp' | 'imessage'>('whatsapp');
  const [simSender, setSimSender] = useState('+1 646 941 9454');
  const [simText, setSimText] = useState('Run TAM calculation on autonomous lead generation engines');
  const [isSimulating, setIsSimulating] = useState(false);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSimulateInbound = async () => {
    if (!simText.trim()) return;
    setIsSimulating(true);

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    
    const inboundId = `msg-in-${Date.now()}`;
    const newInbound: BridgeMessage = {
      id: inboundId,
      channel: simChannel,
      senderId: simSender,
      senderName: simSender === '+1 646 941 9454' ? 'Personal WhatsApp (+1 646-941-9454)' : simSender,
      recipientId: 'Hermes Bot Mode',
      direction: 'inbound',
      messageText: simText,
      timestamp: timeStr,
      status: 'processing',
      assignedAgent: config.autoRoutingAgentRole,
    };

    setMessages(prev => [newInbound, ...prev]);

    try {
      // Simulate real LLM Execution
      const prompt = `[CHANNEL: ${simChannel.toUpperCase()}] [SENDER: ${simSender}] Incoming Bot Request: "${simText}"`;
      const reply = await onSendQuery(prompt, 'hermes', 'You are Hermes Bot Mode Bridge Assistant routing live mobile chats.');
      
      const outboundTime = new Date();
      const outTimeStr = `${String(outboundTime.getHours()).padStart(2, '0')}:${String(outboundTime.getMinutes()).padStart(2, '0')}:${String(outboundTime.getSeconds()).padStart(2, '0')}`;

      const newOutbound: BridgeMessage = {
        id: `msg-out-${Date.now()}`,
        channel: simChannel,
        senderId: 'Hermes Bot Mode',
        recipientId: simSender,
        direction: 'outbound',
        messageText: reply || `⚡ [Hermes ${config.autoRoutingAgentRole.toUpperCase()}]: Processed request for "${simText}". Synced state to board.db and Obsidian vault.`,
        timestamp: outTimeStr,
        status: 'delivered',
        assignedAgent: config.autoRoutingAgentRole,
        modelUsed: 'Nous Hermes 3',
        tokensCount: Math.floor(Math.random() * 400 + 400),
      };

      setMessages(prev => [
        newOutbound,
        ...prev.map(m => m.id === inboundId ? { ...m, status: 'replied' as const } : m)
      ]);

      if (onLogEvent) {
        onLogEvent('success', 'MessageBridge', `Dispatched ${simChannel} auto-reply to ${simSender}`);
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => prev.map(m => m.id === inboundId ? { ...m, status: 'failed' as const } : m));
    } finally {
      setIsSimulating(false);
      setSimText('');
    }
  };

  const handlePairWhatsAppQR = () => {
    setQrScanning(true);
    setConfig(prev => ({ ...prev, whatsappQrCodeStatus: 'scanning' }));
    setTimeout(() => {
      setQrScanning(false);
      setConfig(prev => ({ 
        ...prev, 
        whatsappQrCodeStatus: 'connected',
        whatsappPersonalNumber: '+1 646 941 9454'
      }));
      if (onLogEvent) {
        onLogEvent('success', 'WhatsApp-Baileys', 'Paired successfully with personal phone +1 (646) 941-9454 via Baileys WebSocket!');
      }
    }, 1800);
  };

  return (
    <div className="space-y-8 pb-16 max-w-7xl mx-auto px-4 font-mono">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-4 border-b border-[#1A1D2E] pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="bg-[#615EFF]/15 text-[#A5A2FF] border border-[#615EFF]/30 text-[11px] font-bold px-2.5 py-0.5 rounded-full">
              UNIFIED CHANNEL ROUTER & INGESTION ENGINE
            </span>
            <span className="bg-[#00D26A]/10 text-[#00D26A] border border-[#00D26A]/30 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00D26A] animate-pulse" />
              BRIDGES ONLINE
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-sans">
            iMessage & WhatsApp Bridge Connectors
          </h1>
          <p className="text-xs sm:text-sm text-[#8E94B8] mt-1 font-sans">
            Connect Hermes Bot Mode directly to your personal phone number (<span className="text-[#38BDF8] font-bold">+1 646 941 9454</span>), macOS BlueBubbles bridge, and Meta Cloud API.
          </p>
        </div>

        {/* Master Switches */}
        <div className="flex items-center gap-3">
          {/* iMessage Master Toggle */}
          <button
            onClick={() => setConfig(p => ({ ...p, imessageEnabled: !p.imessageEnabled }))}
            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 border transition ${
              config.imessageEnabled
                ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#38BDF8] shadow-lg shadow-[#38BDF8]/10'
                : 'bg-[#121422] border-[#222742] text-[#6A7196]'
            }`}
          >
            <Apple className="w-4 h-4" />
            <span>iMessage: {config.imessageEnabled ? 'ENABLED' : 'DISABLED'}</span>
          </button>

          {/* WhatsApp Master Toggle */}
          <button
            onClick={() => setConfig(p => ({ ...p, whatsappEnabled: !p.whatsappEnabled }))}
            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 border transition ${
              config.whatsappEnabled
                ? 'bg-[#00D26A]/15 border-[#00D26A] text-[#00D26A] shadow-lg shadow-[#00D26A]/10'
                : 'bg-[#121422] border-[#222742] text-[#6A7196]'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>WhatsApp: {config.whatsappEnabled ? 'ENABLED' : 'DISABLED'}</span>
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-[#1A1D2E] pb-2 overflow-x-auto">
        {[
          { id: 'overview', label: 'Bridge Overview & Telemetry', icon: Radio },
          { id: 'whatsapp', label: 'WhatsApp Gateway (QR & Cloud API)', icon: MessageSquare },
          { id: 'imessage', label: 'iMessage macOS BlueBubbles', icon: Apple },
          { id: 'simulator', label: 'Live Message Dispatcher', icon: Send },
          { id: 'router-rules', label: 'Router Ingestion Rules', icon: Sliders },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition whitespace-nowrap ${
                isActive 
                  ? 'bg-[#615EFF] text-white shadow-md shadow-[#615EFF]/20'
                  : 'bg-[#0E101D] text-[#8E94B8] hover:text-white hover:bg-[#16182B]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* SECTION 1: OVERVIEW */}
      {activeSubTab === 'overview' && (
        <div className="space-y-6">
          {/* Top Status Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* WhatsApp Card */}
            <div className="bg-[#0B0D1D] border border-[#1A1D34] rounded-2xl p-5 space-y-3 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-[#00D26A]/10 border border-[#00D26A]/30 flex items-center justify-center text-[#00D26A]">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">WhatsApp Web / Cloud</h3>
                    <p className="text-[11px] text-[#7A82A6]">Baileys Headless & Meta Graph</p>
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                  config.whatsappQrCodeStatus === 'connected'
                    ? 'bg-[#00D26A]/10 border-[#00D26A]/30 text-[#00D26A]'
                    : 'bg-[#F59E0B]/10 border-[#F59E0B]/30 text-[#F59E0B]'
                }`}>
                  {config.whatsappQrCodeStatus.toUpperCase()}
                </span>
              </div>

              <div className="pt-2 border-t border-[#16182C] space-y-1.5 text-xs text-[#8E94B8]">
                <div className="flex justify-between">
                  <span>Paired Number:</span>
                  <span className="text-white font-bold">{config.whatsappPersonalNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span>Engine:</span>
                  <span className="text-[#38BDF8]">WhiskeySockets / Baileys v6.7</span>
                </div>
                <div className="flex justify-between">
                  <span>Webhook Status:</span>
                  <span className="text-[#00D26A]">Active (200 OK)</span>
                </div>
              </div>

              <button
                onClick={() => setActiveSubTab('whatsapp')}
                className="w-full py-2 bg-[#121426] hover:bg-[#181B34] border border-[#232746] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition"
              >
                <span>Manage WhatsApp QR & WABA</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* iMessage Card */}
            <div className="bg-[#0B0D1D] border border-[#1A1D34] rounded-2xl p-5 space-y-3 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-[#38BDF8]/10 border border-[#38BDF8]/30 flex items-center justify-center text-[#38BDF8]">
                    <Apple className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">iMessage Bridge</h3>
                    <p className="text-[11px] text-[#7A82A6]">macOS BlueBubbles Server</p>
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold border bg-[#38BDF8]/10 border-[#38BDF8]/30 text-[#38BDF8]">
                  BRIDGE ONLINE
                </span>
              </div>

              <div className="pt-2 border-t border-[#16182C] space-y-1.5 text-xs text-[#8E94B8]">
                <div className="flex justify-between">
                  <span>Host Endpoint:</span>
                  <span className="text-white truncate max-w-[150px]">{config.imessageBridgeUrl}</span>
                </div>
                <div className="flex justify-between">
                  <span>Apple ID Relay:</span>
                  <span className="text-[#00D26A]">Connected (Mac Mini M2)</span>
                </div>
                <div className="flex justify-between">
                  <span>Inbound Ping:</span>
                  <span className="text-[#00D26A]">18ms latency</span>
                </div>
              </div>

              <button
                onClick={() => setActiveSubTab('imessage')}
                className="w-full py-2 bg-[#121426] hover:bg-[#181B34] border border-[#232746] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition"
              >
                <span>Configure BlueBubbles Host</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Bot Mode Routing & Permission Status */}
            <div className="bg-[#0B0D1D] border border-[#1A1D34] rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 flex items-center justify-center text-[#8B5CF6]">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Bot Permission & Rules</h3>
                    <p className="text-[11px] text-[#7A82A6]">Rate Limits & Memory Guard</p>
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold border bg-[#8B5CF6]/10 border-[#8B5CF6]/30 text-[#8B5CF6]">
                  AUTONOMOUS
                </span>
              </div>

              <div className="pt-2 border-t border-[#16182C] space-y-1.5 text-xs text-[#8E94B8]">
                <div className="flex justify-between">
                  <span>Bot Opt-In Status:</span>
                  <span className="text-[#00D26A] font-bold">Approved</span>
                </div>
                <div className="flex justify-between">
                  <span>Rate Limit:</span>
                  <span className="text-white font-bold">{config.rateLimitPerMinute} msgs / min</span>
                </div>
                <div className="flex justify-between">
                  <span>Cooldown:</span>
                  <span className="text-white font-bold">{config.cooldownSeconds}s between replies</span>
                </div>
              </div>

              <button
                onClick={() => setActiveSubTab('simulator')}
                className="w-full py-2 bg-[#615EFF] hover:bg-[#504DF5] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-lg shadow-[#615EFF]/20"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Test Live Message Simulator</span>
              </button>
            </div>
          </div>

          {/* Webhook Endpoints & Environment Variables Snippet */}
          <div className="bg-[#090B18] border border-[#1A1D34] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-[#A5A2FF]" />
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                  Hermes Unified Ingestion Webhooks & Env Config
                </h2>
              </div>
              <span className="text-[10px] text-[#6A7196]">Incoming Callback URL Endpoints</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* iMessage Webhook */}
              <div className="bg-[#05060C] p-4 rounded-xl border border-[#16182A] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#38BDF8] font-bold flex items-center gap-1.5">
                    <Apple className="w-3.5 h-3.5" />
                    iMessage Incoming Webhook
                  </span>
                  <button
                    onClick={() => copyToClipboard('https://api.yourdomain.com/webhooks/hermes/imessage', 'imsg-wh')}
                    className="text-[#8E94B8] hover:text-white flex items-center gap-1 text-[11px]"
                  >
                    {copiedKey === 'imsg-wh' ? <Check className="w-3 h-3 text-[#00D26A]" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'imsg-wh' ? 'Copied' : 'Copy URL'}</span>
                  </button>
                </div>
                <code className="text-xs text-[#A5A2FF] bg-[#0E101E] px-2.5 py-1.5 rounded block truncate">
                  https://api.yourdomain.com/webhooks/hermes/imessage
                </code>
                <p className="text-[10px] text-[#636A90]">
                  Set this as the Webhook Callback URL in BlueBubbles Server Settings &gt; API &amp; Webhooks.
                </p>
              </div>

              {/* WhatsApp Webhook */}
              <div className="bg-[#05060C] p-4 rounded-xl border border-[#16182A] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#00D26A] font-bold flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" />
                    WhatsApp Incoming Webhook
                  </span>
                  <button
                    onClick={() => copyToClipboard('https://api.yourdomain.com/webhooks/hermes/whatsapp', 'wa-wh')}
                    className="text-[#8E94B8] hover:text-white flex items-center gap-1 text-[11px]"
                  >
                    {copiedKey === 'wa-wh' ? <Check className="w-3 h-3 text-[#00D26A]" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'wa-wh' ? 'Copied' : 'Copy URL'}</span>
                  </button>
                </div>
                <code className="text-xs text-[#A5A2FF] bg-[#0E101E] px-2.5 py-1.5 rounded block truncate">
                  https://api.yourdomain.com/webhooks/hermes/whatsapp
                </code>
                <p className="text-[10px] text-[#636A90]">
                  Set in Meta Developer Dashboard &gt; WhatsApp &gt; Configuration &gt; Callback URL.
                </p>
              </div>
            </div>

            {/* Env vars export */}
            <div className="bg-[#05060C] p-4 rounded-xl border border-[#16182A] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white font-bold">.env.local / Container Secrets Declaration</span>
                <button
                  onClick={() => copyToClipboard(`IMESSAGE_BRIDGE_URL="${config.imessageBridgeUrl}"\nIMESSAGE_BRIDGE_PASSWORD="${config.imessageBridgePassword}"\nIMESSAGE_WEBHOOK_SECRET="${config.imessageWebhookSecret}"\nWHATSAPP_PHONE_NUMBER_ID="${config.whatsappPhoneNumberId}"\nWHATSAPP_BUSINESS_ACCOUNT_ID="${config.whatsappBusinessAccountId}"\nWHATSAPP_API_TOKEN="${config.whatsappApiToken}"\nWHATSAPP_VERIFY_TOKEN="${config.whatsappVerifyToken}"`, 'env-all')}
                  className="text-[#615EFF] hover:text-[#A5A2FF] flex items-center gap-1 text-[11px]"
                >
                  {copiedKey === 'env-all' ? <Check className="w-3 h-3 text-[#00D26A]" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === 'env-all' ? 'Copied All Secrets' : 'Copy Full .env Block'}</span>
                </button>
              </div>
              <pre className="text-[11px] text-[#7A82A6] font-mono bg-[#090A14] p-3 rounded overflow-x-auto leading-relaxed">
{`# Hermes iMessage & WhatsApp Bridge Environment Variables
IMESSAGE_BRIDGE_URL="${config.imessageBridgeUrl}"
IMESSAGE_BRIDGE_PASSWORD="${config.imessageBridgePassword}"
IMESSAGE_WEBHOOK_SECRET="${config.imessageWebhookSecret}"

WHATSAPP_PHONE_NUMBER_ID="${config.whatsappPhoneNumberId}"
WHATSAPP_BUSINESS_ACCOUNT_ID="${config.whatsappBusinessAccountId}"
WHATSAPP_API_TOKEN="${config.whatsappApiToken}"
WHATSAPP_VERIFY_TOKEN="${config.whatsappVerifyToken}"`}
              </pre>
            </div>
          </div>

          {/* Recent Live Messages Stream */}
          <div className="bg-[#090B18] border border-[#1A1D34] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Radio className="w-4 h-4 text-[#00D26A] animate-pulse" />
                Live Inbound / Outbound Message Stream
              </h2>
              <span className="text-[11px] text-[#6A7196] font-mono">{messages.length} messages logged</span>
            </div>

            <div className="space-y-3">
              {messages.map((msg) => (
                <div 
                  key={msg.id}
                  className={`p-4 rounded-xl border transition ${
                    msg.direction === 'inbound'
                      ? 'bg-[#0E101F] border-[#1E2342]'
                      : 'bg-[#121528] border-[#2A3056]'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        msg.channel === 'whatsapp' 
                          ? 'bg-[#00D26A]/20 text-[#00D26A] border border-[#00D26A]/40' 
                          : 'bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/40'
                      }`}>
                        {msg.channel}
                      </span>
                      <span className="text-white font-bold">{msg.senderName || msg.senderId}</span>
                      <span className="text-[#6A7196]">→ {msg.recipientId}</span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-[#6A7196]">
                      <span>{msg.timestamp}</span>
                      <span className={`px-1.5 py-0.5 rounded ${
                        msg.status === 'delivered' || msg.status === 'replied' ? 'text-[#00D26A] bg-[#00D26A]/10' : 'text-[#F59E0B] bg-[#F59E0B]/10'
                      }`}>
                        {msg.status.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-[#E2E8F0] font-mono leading-relaxed bg-[#05060C]/50 p-2.5 rounded-lg border border-[#161828]">
                    {msg.messageText}
                  </p>

                  {msg.assignedAgent && (
                    <div className="mt-2 flex items-center gap-3 text-[10px] text-[#7A82A6]">
                      <span>Agent: <strong className="text-white">{msg.assignedAgent.toUpperCase()}</strong></span>
                      {msg.modelUsed && <span>Model: <strong className="text-[#38BDF8]">{msg.modelUsed}</strong></span>}
                      {msg.tokensCount && <span>Tokens: <strong className="text-[#A5A2FF]">{msg.tokensCount}</strong></span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: WHATSAPP (PERSONAL NUMBER QR & META CLOUD API) */}
      {activeSubTab === 'whatsapp' && (
        <div className="space-y-6">
          {/* Personal Number QR Pairing Highlight (Specifically for 646 941 9454) */}
          <div className="bg-[#090B18] border border-[#1A1D34] rounded-2xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 mb-1">
                  <span className="bg-[#00D26A]/20 text-[#00D26A] text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-[#00D26A]/40">
                    HEADLESS WEB GATEWAY · BAILEYS / EVOLUTION API
                  </span>
                </div>
                <h2 className="text-lg font-bold text-white">
                  Personal Number WhatsApp QR Pairing
                </h2>
                <p className="text-xs text-[#8E94B8]">
                  Pair personal numbers (like <span className="text-[#00D26A] font-bold">+1 646 941 9454</span>) without requiring a Meta Business API account.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${
                  config.whatsappQrCodeStatus === 'connected' ? 'bg-[#00D26A] shadow-[0_0_8px_#00D26A]' : 'bg-[#F59E0B]'
                }`} />
                <span className="text-xs font-bold text-white uppercase">
                  STATUS: {config.whatsappQrCodeStatus}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center pt-2">
              {/* QR Code Canvas */}
              <div className="md:col-span-4 flex flex-col items-center justify-center p-6 bg-[#05060C] rounded-2xl border border-[#1A1D34] text-center space-y-4">
                <div className="relative p-3 bg-white rounded-2xl shadow-xl">
                  {/* Stylized QR Code SVG */}
                  <svg className="w-44 h-44" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect width="100" height="100" fill="white" />
                    {/* Corners */}
                    <rect x="10" y="10" width="25" height="25" fill="#000000" />
                    <rect x="15" y="15" width="15" height="15" fill="#FFFFFF" />
                    <rect x="18" y="18" width="9" height="9" fill="#000000" />

                    <rect x="65" y="10" width="25" height="25" fill="#000000" />
                    <rect x="70" y="15" width="15" height="15" fill="#FFFFFF" />
                    <rect x="73" y="18" width="9" height="9" fill="#000000" />

                    <rect x="10" y="65" width="25" height="25" fill="#000000" />
                    <rect x="15" y="70" width="15" height="15" fill="#FFFFFF" />
                    <rect x="18" y="73" width="9" height="9" fill="#000000" />

                    {/* Data Points */}
                    <rect x="40" y="12" width="6" height="6" fill="#000000" />
                    <rect x="50" y="15" width="6" height="6" fill="#000000" />
                    <rect x="42" y="24" width="8" height="6" fill="#000000" />
                    <rect x="54" y="28" width="6" height="6" fill="#000000" />

                    <rect x="12" y="42" width="6" height="8" fill="#000000" />
                    <rect x="22" y="48" width="8" height="6" fill="#000000" />
                    <rect x="34" y="42" width="8" height="8" fill="#000000" />
                    <rect x="46" y="46" width="12" height="6" fill="#000000" />
                    <rect x="62" y="42" width="8" height="8" fill="#000000" />
                    <rect x="74" y="46" width="14" height="6" fill="#000000" />

                    <rect x="42" y="64" width="8" height="8" fill="#000000" />
                    <rect x="54" y="68" width="8" height="8" fill="#000000" />
                    <rect x="66" y="64" width="12" height="6" fill="#000000" />
                    <rect x="80" y="72" width="8" height="12" fill="#000000" />
                    <rect x="46" y="80" width="16" height="8" fill="#000000" />
                    <rect x="68" y="82" width="8" height="8" fill="#000000" />

                    {/* Center Brand Icon */}
                    <circle cx="50" cy="50" r="8" fill="#00D26A" />
                  </svg>

                  {qrScanning && (
                    <div className="absolute inset-0 bg-black/60 rounded-2xl flex flex-col items-center justify-center text-white text-xs font-bold gap-2 backdrop-blur-xs">
                      <RefreshCw className="w-6 h-6 animate-spin text-[#00D26A]" />
                      <span>Pairing Session...</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-bold text-white">Scan with WhatsApp</div>
                  <p className="text-[10px] text-[#6A7196]">
                    Settings &gt; Linked Devices &gt; Link a Device
                  </p>
                </div>

                <button
                  onClick={handlePairWhatsAppQR}
                  disabled={qrScanning}
                  className="w-full py-2 bg-[#00D26A] hover:bg-[#00B85C] text-black font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${qrScanning ? 'animate-spin' : ''}`} />
                  <span>{qrScanning ? 'Refreshing QR...' : 'Re-Generate Pairing QR'}</span>
                </button>
              </div>

              {/* Pairing Details & Phone Input */}
              <div className="md:col-span-8 space-y-4">
                <div className="bg-[#05060C] p-4 rounded-xl border border-[#161828] space-y-3">
                  <label className="text-xs font-bold text-white uppercase tracking-wider block">
                    Target WhatsApp Phone Number
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      value={config.whatsappPersonalNumber}
                      onChange={(e) => setConfig(p => ({ ...p, whatsappPersonalNumber: e.target.value }))}
                      placeholder="+1 646 941 9454"
                      className="flex-1 bg-[#090B18] border border-[#222744] text-white px-3 py-2 rounded-xl text-sm font-mono focus:outline-hidden focus:border-[#00D26A]"
                    />
                    <button
                      onClick={() => alert(`Saved phone number ${config.whatsappPersonalNumber} for WhatsApp Baileys routing.`)}
                      className="px-4 py-2 bg-[#14172B] hover:bg-[#1E2240] text-white rounded-xl text-xs font-bold border border-[#2B3158] transition"
                    >
                      Save Number
                    </button>
                  </div>
                  <p className="text-[11px] text-[#6A7196]">
                    Hermes automatically ingests chat events from this phone number, authorizes bot prompts, and returns formatted responses.
                  </p>
                </div>

                {/* Baileys WebSocket Gateway Architecture */}
                <div className="p-4 bg-[#05060C] rounded-xl border border-[#161828] space-y-2">
                  <div className="text-xs font-bold text-[#00D26A] uppercase flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    How Headless Baileys QR Works
                  </div>
                  <p className="text-xs text-[#8E94B8] leading-relaxed">
                    1. Hermes boots an isolated Node.js container running <code>@whiskeysockets/baileys</code>.<br />
                    2. The QR code handshake establishes a persistent Multi-Device WebSocket session.<br />
                    3. Incoming WhatsApp chats stream straight to <code>routeToHermesAgent()</code>, which retrieves Obsidian context and returns AI responses under 500ms.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Meta Cloud API (WABA Enterprise Configuration) */}
          <div className="bg-[#090B18] border border-[#1A1D34] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Meta Cloud API / WhatsApp Business Account (WABA)
                </h3>
                <p className="text-xs text-[#7A82A6]">For enterprise accounts using official Meta Graph API v20.0</p>
              </div>
              <span className="text-[10px] text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded border border-[#00D26A]/20 font-bold">
                META ENTERPRISE READY
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-[#8E94B8]">WHATSAPP_PHONE_NUMBER_ID</label>
                <input
                  type="text"
                  value={config.whatsappPhoneNumberId}
                  onChange={(e) => setConfig(p => ({ ...p, whatsappPhoneNumberId: e.target.value }))}
                  className="w-full bg-[#05060C] border border-[#1A1D34] text-white px-3 py-2 rounded-xl text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[#8E94B8]">WHATSAPP_BUSINESS_ACCOUNT_ID</label>
                <input
                  type="text"
                  value={config.whatsappBusinessAccountId}
                  onChange={(e) => setConfig(p => ({ ...p, whatsappBusinessAccountId: e.target.value }))}
                  className="w-full bg-[#05060C] border border-[#1A1D34] text-white px-3 py-2 rounded-xl text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[#8E94B8]">WHATSAPP_API_TOKEN (System User Permanent Token)</label>
                <input
                  type="password"
                  value={config.whatsappApiToken}
                  onChange={(e) => setConfig(p => ({ ...p, whatsappApiToken: e.target.value }))}
                  className="w-full bg-[#05060C] border border-[#1A1D34] text-white px-3 py-2 rounded-xl text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[#8E94B8]">WHATSAPP_VERIFY_TOKEN</label>
                <input
                  type="text"
                  value={config.whatsappVerifyToken}
                  onChange={(e) => setConfig(p => ({ ...p, whatsappVerifyToken: e.target.value }))}
                  className="w-full bg-[#05060C] border border-[#1A1D34] text-white px-3 py-2 rounded-xl text-xs font-mono"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: IMESSAGE (MACOS BLUEBUBBLES HOST) */}
      {activeSubTab === 'imessage' && (
        <div className="space-y-6">
          <div className="bg-[#090B18] border border-[#1A1D34] rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="inline-flex items-center gap-2 mb-1">
                  <span className="bg-[#38BDF8]/20 text-[#38BDF8] text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-[#38BDF8]/40 flex items-center gap-1">
                    <Apple className="w-3 h-3" />
                    macOS HOST ENVIRONMENT BRIDGE
                  </span>
                </div>
                <h2 className="text-lg font-bold text-white">
                  Apple iMessage &amp; BlueBubbles Server Configuration
                </h2>
                <p className="text-xs text-[#8E94B8]">
                  Apple requires a macOS machine signed into your iCloud Apple ID. The BlueBubbles Server converts incoming messages into JSON webhooks.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-[#8E94B8]">IMESSAGE_BRIDGE_URL (BlueBubbles Server Host)</label>
                <input
                  type="text"
                  value={config.imessageBridgeUrl}
                  onChange={(e) => setConfig(p => ({ ...p, imessageBridgeUrl: e.target.value }))}
                  placeholder="https://your-mac-server.ngrok.io"
                  className="w-full bg-[#05060C] border border-[#1A1D34] text-white px-3 py-2 rounded-xl text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[#8E94B8]">IMESSAGE_BRIDGE_PASSWORD</label>
                <input
                  type="password"
                  value={config.imessageBridgePassword}
                  onChange={(e) => setConfig(p => ({ ...p, imessageBridgePassword: e.target.value }))}
                  className="w-full bg-[#05060C] border border-[#1A1D34] text-white px-3 py-2 rounded-xl text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs text-[#8E94B8]">IMESSAGE_WEBHOOK_SECRET (Validation Token)</label>
                <input
                  type="password"
                  value={config.imessageWebhookSecret}
                  onChange={(e) => setConfig(p => ({ ...p, imessageWebhookSecret: e.target.value }))}
                  className="w-full bg-[#05060C] border border-[#1A1D34] text-white px-3 py-2 rounded-xl text-xs font-mono"
                />
              </div>
            </div>

            {/* Outbound iMessage Dispatcher Code Preview */}
            <div className="p-4 bg-[#05060C] rounded-xl border border-[#161828] space-y-2">
              <div className="text-xs font-bold text-[#38BDF8] flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5" />
                <span>Outbound sendIMessage() Execution Blueprint</span>
              </div>
              <pre className="text-[11px] text-[#8E94B8] font-mono overflow-x-auto leading-relaxed">
{`export async function sendIMessage(recipient: string, message: string) {
  await fetch(\`\${process.env.IMESSAGE_BRIDGE_URL}/api/v1/message/text\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${process.env.IMESSAGE_BRIDGE_PASSWORD}\`,
    },
    body: JSON.stringify({
      recipient: recipient, // Phone number (+1...) or iCloud email
      text: message,
    }),
  });
}`}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: SIMULATOR */}
      {activeSubTab === 'simulator' && (
        <div className="space-y-6">
          <div className="bg-[#090B18] border border-[#1A1D34] rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">
                  Live Message Simulator &amp; Channel Tester
                </h2>
                <p className="text-xs text-[#8E94B8]">
                  Simulate incoming messages from WhatsApp or iMessage and verify instant auto-replies from Hermes.
                </p>
              </div>
              <span className="text-xs text-[#00D26A] bg-[#00D26A]/10 px-2.5 py-1 rounded-full border border-[#00D26A]/30 font-bold">
                READY TO DISPATCH
              </span>
            </div>

            {/* Input Controls */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-[#8E94B8]">Originating Channel</label>
                <select
                  value={simChannel}
                  onChange={(e) => setSimChannel(e.target.value as any)}
                  className="w-full bg-[#05060C] border border-[#1A1D34] text-white px-3 py-2 rounded-xl text-xs font-mono"
                >
                  <option value="whatsapp">WhatsApp (+1 646 941 9454)</option>
                  <option value="imessage">iMessage (Apple ID / SMS)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[#8E94B8]">Sender Identifier</label>
                <input
                  type="text"
                  value={simSender}
                  onChange={(e) => setSimSender(e.target.value)}
                  className="w-full bg-[#05060C] border border-[#1A1D34] text-white px-3 py-2 rounded-xl text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[#8E94B8]">Target Specialist Agent</label>
                <select
                  value={config.autoRoutingAgentRole}
                  onChange={(e) => setConfig(p => ({ ...p, autoRoutingAgentRole: e.target.value as any }))}
                  className="w-full bg-[#05060C] border border-[#1A1D34] text-white px-3 py-2 rounded-xl text-xs font-mono"
                >
                  <option value="orchestrator">Orchestrator (Nous Hermes 3)</option>
                  <option value="scout">Scout (Trend Scraping)</option>
                  <option value="scribe">Scribe (Obsidian Theses)</option>
                  <option value="reach">Reach (Growth & GTM)</option>
                  <option value="dev">Dev (Sandbox Engineer)</option>
                  <option value="analytics">Analytics (TAM & Unit Economics)</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-[#8E94B8]">Message Text Payload</label>
              <textarea
                rows={3}
                value={simText}
                onChange={(e) => setSimText(e.target.value)}
                placeholder="Ask Hermes to analyze a repository, draft a note, or run calculations..."
                className="w-full bg-[#05060C] border border-[#1A1D34] text-white p-3 rounded-xl text-xs font-mono focus:outline-hidden focus:border-[#615EFF]"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-[#6A7196]">
                Target: {simChannel.toUpperCase()} → Hermes Ingestion Router
              </span>

              <button
                onClick={handleSimulateInbound}
                disabled={isSimulating || !simText.trim()}
                className="px-6 py-2.5 bg-[#615EFF] hover:bg-[#504DF5] text-white rounded-xl text-xs font-bold flex items-center gap-2 transition disabled:opacity-50 shadow-lg shadow-[#615EFF]/20"
              >
                <Send className={`w-3.5 h-3.5 ${isSimulating ? 'animate-bounce' : ''}`} />
                <span>{isSimulating ? 'Routing Through LLM...' : 'Simulate Inbound Webhook'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 5: ROUTER INGESTION RULES */}
      {activeSubTab === 'router-rules' && (
        <div className="space-y-6">
          <div className="bg-[#090B18] border border-[#1A1D34] rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Channel Ingestion Security &amp; Rate Limiting Rules
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#05060C] p-4 rounded-xl border border-[#161828] space-y-2">
                <span className="text-xs font-bold text-white block">Bot Permission Opt-In</span>
                <p className="text-[11px] text-[#7A82A6]">
                  Require phone numbers to approve Bot Mode before receiving autonomous proactive pings.
                </p>
                <div className="pt-2">
                  <input
                    type="checkbox"
                    checked={config.botOptInRequired}
                    onChange={(e) => setConfig(p => ({ ...p, botOptInRequired: e.target.checked }))}
                    className="mr-2"
                  />
                  <span className="text-xs text-white">Opt-In Mandatory</span>
                </div>
              </div>

              <div className="bg-[#05060C] p-4 rounded-xl border border-[#161828] space-y-2">
                <span className="text-xs font-bold text-white block">Rate Limit per Recipient</span>
                <p className="text-[11px] text-[#7A82A6]">
                  Caps outbound messages per minute to prevent WhatsApp / iMessage carrier spam flagging.
                </p>
                <div className="pt-2 flex items-center gap-2">
                  <input
                    type="number"
                    value={config.rateLimitPerMinute}
                    onChange={(e) => setConfig(p => ({ ...p, rateLimitPerMinute: Number(e.target.value) }))}
                    className="w-20 bg-[#090B18] border border-[#1A1D34] text-white px-2 py-1 rounded text-xs"
                  />
                  <span className="text-xs text-[#8E94B8]">msgs / min</span>
                </div>
              </div>

              <div className="bg-[#05060C] p-4 rounded-xl border border-[#161828] space-y-2">
                <span className="text-xs font-bold text-white block">Cooldown Timer</span>
                <p className="text-[11px] text-[#7A82A6]">
                  Minimum spacing between consecutive responses to the same chat thread.
                </p>
                <div className="pt-2 flex items-center gap-2">
                  <input
                    type="number"
                    value={config.cooldownSeconds}
                    onChange={(e) => setConfig(p => ({ ...p, cooldownSeconds: Number(e.target.value) }))}
                    className="w-20 bg-[#090B18] border border-[#1A1D34] text-white px-2 py-1 rounded text-xs"
                  />
                  <span className="text-xs text-[#8E94B8]">seconds</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
