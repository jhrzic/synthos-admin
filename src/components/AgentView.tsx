import React, { useState } from 'react';
import { AgentInfo, KanbanTask, AIModelInfo, ObsidianNote, AgentRole } from '../types';
import { 
  Crown, BarChart3, PenTool, Code2, Search, 
  Sparkles, CheckCircle2, Clock, Play, Send, 
  Database, RefreshCw, Layers, Shield, ExternalLink, 
  Terminal, ArrowRight, CheckSquare, Square, Sliders,
  Save, Plus, Trash2, Globe, Brain, Radio, MessageSquare,
  Bot, Compass, Activity, Check
} from 'lucide-react';

interface AgentViewProps {
  agent: AgentInfo;
  tasks: KanbanTask[];
  models: Record<string, AIModelInfo>;
  onSendQuery: (query: string, targetModel: string, systemInstruction?: string) => Promise<string>;
  onAddTask: (task: Omit<KanbanTask, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateTask: (id: string, updates: Partial<KanbanTask>) => void;
  onPushNoteToObsidian: (title: string, content: string, tags: string[]) => void;
  onUpdateAgent?: (role: AgentRole, updates: Partial<AgentInfo>) => void;
}

export const AgentView: React.FC<AgentViewProps> = ({
  agent,
  tasks,
  models,
  onSendQuery,
  onAddTask,
  onUpdateTask,
  onPushNoteToObsidian,
  onUpdateAgent,
}) => {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [responseLog, setResponseLog] = useState<Array<{
    query: string;
    reply: string;
    model: string;
    timestamp: string;
  }>>([]);
  const [obsidianToast, setObsidianToast] = useState<string | null>(null);
  const [configToast, setConfigToast] = useState(false);

  // Editable configuration states
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [editSystemPrompt, setEditSystemPrompt] = useState(agent.systemPrompt || '');
  const [editPrimaryModel, setEditPrimaryModel] = useState(agent.assignedModel || 'gemini');
  const [editSecondaryModel, setEditSecondaryModel] = useState(agent.secondaryModel || 'chatgpt');
  const [editStatus, setEditStatus] = useState<AgentInfo['status']>(agent.status || 'active');
  const [editTemperature, setEditTemperature] = useState<number>(agent.temperature || 0.7);
  const [newRuleInput, setNewRuleInput] = useState('');
  const [agentRules, setAgentRules] = useState<string[]>(agent.rules || [
    'Always preserve structured markdown with [[wikilinks]] for Obsidian synchronization.',
    'Verify facts with Perplexity or Live Grounding before declaring thesis conclusion.',
    'Follow zero-token-waste context compression protocols.'
  ]);

  // Quick Task Creation state
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('high');

  const assignedModelInfo = models[editPrimaryModel] || models.gemini;
  const secondaryModelInfo = models[editSecondaryModel] || models.chatgpt;
  const agentTasks = tasks.filter(t => t.assignedAgent === agent.role);

  const getAgentIcon = () => {
    switch (agent.role) {
      case 'orchestrator': return <Crown className="w-6 h-6" />;
      case 'scout': return <Search className="w-6 h-6" />;
      case 'scribe': return <PenTool className="w-6 h-6" />;
      case 'reach': return <Globe className="w-6 h-6" />;
      case 'dev': return <Code2 className="w-6 h-6" />;
      case 'analytics': return <BarChart3 className="w-6 h-6" />;
      case 'claude': return <Sparkles className="w-6 h-6" />;
      case 'claudecode': return <Terminal className="w-6 h-6" />;
      case 'kimi3': return <Layers className="w-6 h-6" />;
      case 'deepseek': return <Brain className="w-6 h-6" />;
      case 'chatgpt': return <MessageSquare className="w-6 h-6" />;
      case 'codex': return <Code2 className="w-6 h-6" />;
      case 'cursor': return <Terminal className="w-6 h-6" />;
      case 'antigravity': return <Compass className="w-6 h-6" />;
      case 'perplexity': return <Search className="w-6 h-6" />;
      case 'elevenlabs': return <Radio className="w-6 h-6" />;
      default: return <Bot className="w-6 h-6" />;
    }
  };

  const handleExecuteAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isLoading) return;

    const currentPrompt = prompt;
    setPrompt('');
    setIsLoading(true);

    try {
      const reply = await onSendQuery(currentPrompt, editPrimaryModel, editSystemPrompt);
      setResponseLog(prev => [
        {
          query: currentPrompt,
          reply,
          model: assignedModelInfo.name,
          timestamp: 'Just now'
        },
        ...prev
      ]);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveConfig = () => {
    if (onUpdateAgent) {
      onUpdateAgent(agent.role, {
        systemPrompt: editSystemPrompt,
        assignedModel: editPrimaryModel,
        secondaryModel: editSecondaryModel,
        status: editStatus,
        temperature: editTemperature,
        rules: agentRules,
      });
    }
    setConfigToast(true);
    setTimeout(() => setConfigToast(false), 3000);
  };

  const handleAddRule = () => {
    if (!newRuleInput.trim()) return;
    setAgentRules(prev => [...prev, newRuleInput.trim()]);
    setNewRuleInput('');
  };

  const handleRemoveRule = (index: number) => {
    setAgentRules(prev => prev.filter((_, i) => i !== index));
  };

  const handleCreateTaskForAgent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    onAddTask({
      title: taskTitle.trim(),
      description: taskDesc.trim() || `Execution directive assigned directly to ${agent.name}.`,
      column: 'todo',
      assignedAgent: agent.role,
      assignedModel: editPrimaryModel,
      priority: taskPriority,
      tags: [agent.role, 'directive'],
      obsidianWikilinks: [`[[${agent.name.replace(/\s+/g, '-')}]]`],
      subtasks: [
        { id: `st-${Date.now()}-1`, title: 'Execute cognitive reasoning stage', completed: false },
        { id: `st-${Date.now()}-2`, title: 'Synthesize output and format markdown', completed: false }
      ]
    });
    setTaskTitle('');
    setTaskDesc('');
    setIsAddingTask(false);
  };

  const handlePushToObsidian = (item: { query: string; reply: string; model: string }) => {
    const title = `${agent.name.replace(/\s+/g, '-')}-Synthesis-${new Date().toISOString().slice(0, 10)}`;
    const content = `# ${title}\n\n**Agent**: ${agent.name} (${agent.role})\n**Primary Model**: ${item.model}\n\n## Directive\n> ${item.query}\n\n## Synthesis & Execution Output\n${item.reply}\n\n## Synapses & Wikilinks\n- [[Hermes-Knowledge-Mesh]]\n- [[${agent.name.replace(/\s+/g, '-')}]]\n\n#hermes #agent #${agent.role} #obsidian`;
    onPushNoteToObsidian(title, content, ['hermes', agent.role, 'synthesis']);
    setObsidianToast(title);
    setTimeout(() => setObsidianToast(null), 3000);
  };

  return (
    <div className="space-y-8 pb-16 max-w-7xl mx-auto px-4">
      {/* Header Profile Banner */}
      <div className="bg-[#090A14] border border-[#1F233C] rounded-2xl p-6 relative overflow-hidden shadow-2xl space-y-6">
        {/* Glow */}
        <div 
          className="absolute -right-16 -top-16 w-80 h-80 rounded-full blur-3xl opacity-15 pointer-events-none"
          style={{ backgroundColor: agent.avatarColor }}
        />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1A1D30] pb-6">
          <div className="flex items-center gap-4">
            <div 
              className="w-16 h-16 rounded-2xl flex items-center justify-center border shadow-lg"
              style={{ 
                backgroundColor: `${agent.avatarColor}15`, 
                borderColor: `${agent.avatarColor}40`,
                color: agent.avatarColor 
              }}
            >
              {getAgentIcon()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span 
                  className="px-2.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase border"
                  style={{ 
                    backgroundColor: `${agent.avatarColor}15`, 
                    borderColor: `${agent.avatarColor}30`,
                    color: agent.avatarColor 
                  }}
                >
                  {agent.role.toUpperCase()}
                </span>
                
                {/* Interactive Status Selector */}
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as any)}
                  className="bg-[#05060B] border border-[#1E223D] text-[10px] font-mono font-bold text-[#00D26A] rounded px-2 py-0.5 focus:outline-none focus:border-[#615EFF]"
                >
                  <option value="active">● ONLINE / ACTIVE</option>
                  <option value="busy">● BUSY (IN-TASK)</option>
                  <option value="idle">○ IDLE</option>
                  <option value="standby">◌ STANDBY</option>
                </select>
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-white font-['Space_Grotesk'] mt-1">
                {agent.name}
              </h1>
              <p className="text-xs text-[#8E94B8] mt-0.5">
                {agent.title} • {agent.description}
              </p>
            </div>
          </div>

          {/* Action Buttons & Model Indicators */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setIsConfigOpen(!isConfigOpen)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border flex items-center gap-2 transition ${
                isConfigOpen
                  ? 'bg-[#615EFF] text-white border-[#615EFF]'
                  : 'bg-[#101222] border-[#20253F] text-[#8E94B8] hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{isConfigOpen ? 'HIDE CONFIG' : 'CONFIGURE AGENT'}</span>
            </button>

            <div className="bg-[#05060B] border border-[#1C1F33] p-2.5 rounded-xl text-right">
              <div className="text-[10px] font-mono text-[#6A7097] uppercase">PRIMARY INFERENCE</div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5 justify-end mt-0.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: assignedModelInfo.color }} />
                <span>{assignedModelInfo.name.split(' ')[0]}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic Config Panel Drawer */}
        {isConfigOpen && (
          <div className="bg-[#05060C] border border-[#1E223D] rounded-xl p-5 space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between border-b border-[#161828] pb-3">
              <h3 className="text-xs font-bold text-white uppercase font-mono tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#615EFF]" />
                <span>Configure Agent Engine & SOP Rules</span>
              </h3>
              <button
                onClick={handleSaveConfig}
                className="px-3 py-1.5 bg-[#615EFF] hover:bg-[#5653D9] text-white text-xs font-bold font-mono rounded-lg transition flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                <span>SAVE CHANGES</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Primary Model Select */}
              <div className="space-y-1">
                <label className="text-[11px] font-mono text-[#8E94B8]">Primary Model Route</label>
                <select
                  value={editPrimaryModel}
                  onChange={(e) => setEditPrimaryModel(e.target.value)}
                  className="w-full bg-[#080A16] border border-[#1E223D] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                >
                  {Object.entries(models).map(([key, m]) => (
                    <option key={key} value={key}>{m.name} ({m.provider})</option>
                  ))}
                </select>
              </div>

              {/* Fallback Model Select */}
              <div className="space-y-1">
                <label className="text-[11px] font-mono text-[#8E94B8]">Fallback Model Route</label>
                <select
                  value={editSecondaryModel}
                  onChange={(e) => setEditSecondaryModel(e.target.value)}
                  className="w-full bg-[#080A16] border border-[#1E223D] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                >
                  {Object.entries(models).map(([key, m]) => (
                    <option key={key} value={key}>{m.name} ({m.provider})</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Temperature Slider */}
            <div className="space-y-2">
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-[#8E94B8]">Temperature & Reasoning Depth</span>
                <span className="text-[#615EFF] font-bold">{editTemperature}</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="1.5"
                step="0.05"
                value={editTemperature}
                onChange={(e) => setEditTemperature(parseFloat(e.target.value))}
                className="w-full accent-[#615EFF] bg-[#141628] h-1.5 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Editable System Prompt */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-[#8E94B8]">Agent System Prompt & Behavior Directives</span>
                <span className="text-[#5B6185]">{editSystemPrompt.length} chars</span>
              </div>
              <textarea
                value={editSystemPrompt}
                onChange={(e) => setEditSystemPrompt(e.target.value)}
                rows={3}
                className="w-full bg-[#080A16] border border-[#1E223D] rounded-lg p-3 text-xs font-mono text-white focus:outline-none focus:border-[#615EFF]"
              />
            </div>

            {/* Permanent Operating Rules */}
            <div className="space-y-2">
              <span className="text-[11px] font-mono text-[#8E94B8] block">Permanent Operating Rules:</span>
              <div className="space-y-1.5">
                {agentRules.map((rule, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-[#080A16] border border-[#181B2E] p-2 rounded-lg text-xs font-mono text-[#CCD2ED]">
                    <span>• {rule}</span>
                    <button
                      onClick={() => handleRemoveRule(idx)}
                      className="text-[#EC4899] hover:text-red-400 p-1"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-1">
                <input
                  type="text"
                  value={newRuleInput}
                  onChange={(e) => setNewRuleInput(e.target.value)}
                  placeholder="Add permanent operating rule (e.g. 'Always output JSON schema')..."
                  className="flex-1 bg-[#080A16] border border-[#1E223D] rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#4E5478] focus:outline-none focus:border-[#615EFF]"
                />
                <button
                  onClick={handleAddRule}
                  className="px-3 py-1.5 bg-[#181B2E] hover:bg-[#20243C] text-[#8E94B8] hover:text-white rounded-lg text-xs font-mono flex items-center gap-1 border border-[#20253E]"
                >
                  <Plus className="w-3 h-3" />
                  <span>ADD RULE</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Toast notifications */}
        {configToast && (
          <div className="p-3 bg-[#00D26A]/10 border border-[#00D26A]/40 rounded-lg text-xs font-mono text-[#00D26A] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>Agent parameters & SOP rules successfully saved and broadcast to memory mesh.</span>
          </div>
        )}

        {obsidianToast && (
          <div className="p-3 bg-[#00D26A]/10 border border-[#00D26A]/40 rounded-lg text-xs font-mono text-[#00D26A] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>Transcribed to Obsidian knowledge vault: <strong>{obsidianToast}.md</strong></span>
          </div>
        )}

        {/* Capabilities Grid */}
        <div className="space-y-2">
          <div className="text-[11px] font-mono text-[#6A7097] uppercase">Core Specialized Capabilities:</div>
          <div className="flex flex-wrap gap-2">
            {agent.capabilities.map((cap, i) => (
              <span key={i} className="text-xs font-mono bg-[#05060B] border border-[#1E223D] px-3 py-1 rounded-lg text-[#C0C5DE]">
                ✓ {cap}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Main Grid: Direct Agent Terminal & Kanban Tasks Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Direct Agent Interactive Directive Terminal (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-[#090A14] border border-[#1F233C] rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-[#1A1D30] pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" style={{ color: agent.avatarColor }} />
                <h3 className="text-base font-bold text-white font-['Space_Grotesk']">
                  Direct Directive Sandbox
                </h3>
              </div>
              <span className="text-[10px] font-mono text-[#6A7097]">
                MODEL: {assignedModelInfo.name.split(' ')[0]}
              </span>
            </div>

            <form onSubmit={handleExecuteAgent} className="space-y-4">
              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  placeholder={`Issue a specialized directive to ${agent.name}...`}
                  className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-4 text-xs font-mono text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
                />
                <button
                  type="submit"
                  disabled={isLoading || !prompt.trim()}
                  className="absolute right-3 bottom-4 px-4 py-2 bg-[#615EFF] hover:bg-[#5653D9] text-white rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 transition"
                >
                  <Send className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>{isLoading ? 'EXECUTING...' : 'DISPATCH DIRECTIVE'}</span>
                </button>
              </div>
            </form>

            {/* Quick Directive Prompts */}
            <div className="flex flex-wrap gap-2">
              {[
                `Decompose next high-priority objective for ${agent.name}`,
                "Run deep analysis and synthesize Obsidian thesis note",
                "Audit latency and token budget consumption"
              ].map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => setPrompt(suggestion)}
                  className="text-[11px] font-mono bg-[#0B0D18] border border-[#1C2038] hover:border-[#615EFF] text-[#8E94B8] hover:text-white px-2.5 py-1 rounded-lg transition"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            {/* Response Logs */}
            <div className="space-y-3">
              <div className="text-[10px] font-mono text-[#6A7097] uppercase">
                Direct Responses & Synthesis Stream
              </div>

              {responseLog.length === 0 ? (
                <div className="p-6 border border-dashed border-[#1B1E33] rounded-xl text-center text-[#585E82] text-xs font-mono">
                  No active directives issued in this session. Dispatch above to begin.
                </div>
              ) : (
                responseLog.map((item, idx) => (
                  <div key={idx} className="bg-[#05060A] border border-[#1C1F33] rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-mono text-[#8E94B8] font-bold">
                        &gt; {item.query}
                      </div>
                      <button
                        onClick={() => handlePushToObsidian(item)}
                        className="px-2.5 py-1 rounded bg-[#10121F] hover:bg-[#615EFF] border border-[#1F233C] text-[10px] font-mono text-[#8E94B8] hover:text-white transition flex items-center gap-1"
                      >
                        <Database className="w-3 h-3" />
                        <span>Scribe to Obsidian</span>
                      </button>
                    </div>

                    <div className="text-xs font-mono text-[#D7DBEE] bg-[#070810] p-3 rounded-lg border border-[#17192A] whitespace-pre-wrap leading-relaxed">
                      {item.reply}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right: Kanban Task Queue for this Agent (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-[#090A14] border border-[#1F233C] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#1A1D30] pb-3">
              <h3 className="text-base font-bold text-white font-['Space_Grotesk']">
                Assigned Kanban Tasks ({agentTasks.length})
              </h3>
              <button
                onClick={() => setIsAddingTask(!isAddingTask)}
                className="px-2.5 py-1 bg-[#15172C] hover:bg-[#615EFF] border border-[#202544] text-white rounded text-[11px] font-mono flex items-center gap-1 transition"
              >
                <Plus className="w-3 h-3" />
                <span>NEW TASK</span>
              </button>
            </div>

            {/* Quick Add Task Form */}
            {isAddingTask && (
              <form onSubmit={handleCreateTaskForAgent} className="p-3 bg-[#05060A] border border-[#1E223D] rounded-xl space-y-2">
                <input
                  type="text"
                  placeholder="Task title..."
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  className="w-full bg-[#090A14] border border-[#1E223D] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                />
                <textarea
                  placeholder="Task description / objective..."
                  value={taskDesc}
                  onChange={(e) => setTaskDesc(e.target.value)}
                  rows={2}
                  className="w-full bg-[#090A14] border border-[#1E223D] rounded p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                />
                <div className="flex items-center justify-between">
                  <select
                    value={taskPriority}
                    onChange={(e) => setTaskPriority(e.target.value as any)}
                    className="bg-[#090A14] border border-[#1E223D] text-[10px] font-mono text-[#8E94B8] rounded px-2 py-1"
                  >
                    <option value="low">Low Priority</option>
                    <option value="medium">Medium Priority</option>
                    <option value="high">High Priority</option>
                    <option value="critical">Critical</option>
                  </select>
                  <button
                    type="submit"
                    className="px-3 py-1 bg-[#615EFF] text-white rounded text-xs font-bold"
                  >
                    Create Task
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-3">
              {agentTasks.length === 0 ? (
                <div className="p-6 border border-dashed border-[#1B1E33] rounded-xl text-center text-[#585E82] text-xs font-mono">
                  No tasks assigned to {agent.name} on the Kanban board.
                </div>
              ) : (
                agentTasks.map((t) => (
                  <div
                    key={t.id}
                    className="p-3.5 rounded-xl bg-[#05060A] border border-[#1A1D30] space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">{t.title}</span>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#615EFF]/15 text-[#8C8AFF] border border-[#615EFF]/30">
                        {t.column}
                      </span>
                    </div>

                    <p className="text-[11px] text-[#7B82A8] line-clamp-2">
                      {t.description}
                    </p>

                    {/* Subtasks */}
                    {t.subtasks && t.subtasks.length > 0 && (
                      <div className="space-y-1 bg-[#090A12] p-2 rounded-lg border border-[#141624]">
                        {t.subtasks.map((st) => (
                          <div
                            key={st.id}
                            onClick={() => {
                              const updated = t.subtasks.map(s => s.id === st.id ? { ...s, completed: !s.completed } : s);
                              onUpdateTask(t.id, { subtasks: updated });
                            }}
                            className="flex items-center gap-1.5 text-[10px] font-mono cursor-pointer text-[#8E94B8]"
                          >
                            {st.completed ? (
                              <CheckSquare className="w-2.5 h-2.5 text-[#00D26A]" />
                            ) : (
                              <Square className="w-2.5 h-2.5 text-[#585E82]" />
                            )}
                            <span className={st.completed ? 'line-through text-[#585E82]' : ''}>
                              {st.title}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
