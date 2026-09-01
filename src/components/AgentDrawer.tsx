import React, { useState } from 'react';
import { AgentInfo, ActiveTab, KanbanTask, AIModelInfo, AgentRole } from '../types';
import { 
  X, Crown, Search, PenTool, Share2, Code2, 
  BarChart3, Bot, Terminal, Folder, HardDrive, 
  ShieldCheck, CheckCircle2, MessageSquare, Play, Sparkles,
  Plus, Trash2, Save, Send, Clock, Layers, Zap, Database,
  Sliders, RefreshCw, Radio, Globe, Brain, Compass
} from 'lucide-react';

interface AgentDrawerProps {
  agent: AgentInfo | null | undefined;
  isOpen: boolean;
  onClose: () => void;
  onSelectTab: (tab: ActiveTab) => void;
  models?: Record<string, AIModelInfo>;
  onSendQuery?: (query: string, targetModel: string, systemInstruction?: string) => Promise<string>;
  onAddTask?: (task: Omit<KanbanTask, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onAddNoteToVault?: (title: string, content: string, tags: string[], folder?: string) => void;
  onUpdateAgent?: (role: AgentRole, updates: Partial<AgentInfo>) => void;
}

export const AgentDrawer: React.FC<AgentDrawerProps> = ({
  agent,
  isOpen,
  onClose,
  onSelectTab,
  models = {},
  onSendQuery,
  onAddTask,
  onAddNoteToVault,
  onUpdateAgent,
}) => {
  const [activeDrawerTab, setActiveDrawerTab] = useState<'sandbox' | 'skills' | 'rules' | 'tasks' | 'overview'>('sandbox');
  
  // Sandbox State
  const [sandboxPrompt, setSandboxPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState(agent?.assignedModel || 'claude');
  const [isRunningSandbox, setIsRunningSandbox] = useState(false);
  const [sandboxOutput, setSandboxOutput] = useState<string | null>(null);
  const [sandboxLatency, setSandboxLatency] = useState<number | null>(null);
  const [sandboxTokens, setSandboxTokens] = useState<number | null>(null);

  // Skills State
  const [newSkillInput, setNewSkillInput] = useState('');
  const [skillsList, setSkillsList] = useState<string[]>(agent?.capabilities || []);

  // Rules State
  const [newRuleInput, setNewRuleInput] = useState('');
  const [rulesList, setRulesList] = useState<string[]>(agent?.rules || [
    'Enforce strict role boundaries and zero-token-waste compression.',
    'Always validate citations and link to [[Obsidian-Knowledge-Graph]].',
    'Execute sub-50ms deterministic stage transitions.'
  ]);
  const [editSystemPrompt, setEditSystemPrompt] = useState(agent?.systemPrompt || '');

  // Quick Task State
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskPriority, setTaskPriority] = useState<KanbanTask['priority']>('high');
  const [taskEstimatedHours, setTaskEstimatedHours] = useState('2.0h');

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync state when agent changes
  React.useEffect(() => {
    if (agent) {
      setSelectedModel(agent.assignedModel || 'claude');
      setSkillsList(agent.capabilities || []);
      setRulesList(agent.rules || [
        'Enforce strict role boundaries and zero-token-waste compression.',
        'Always validate citations and link to [[Obsidian-Knowledge-Graph]].'
      ]);
      setEditSystemPrompt(agent.systemPrompt || '');
      setSandboxOutput(null);
    }
  }, [agent]);

  if (!isOpen || !agent) return null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const getAgentIcon = (role: string) => {
    switch (role) {
      case 'orchestrator': return Crown;
      case 'scout': return Search;
      case 'scribe': return PenTool;
      case 'reach': return Share2;
      case 'dev': return Code2;
      case 'analytics': return BarChart3;
      case 'claude': return Sparkles;
      case 'claudecode': return Terminal;
      case 'kimi3': return Layers;
      case 'deepseek': return Brain;
      case 'chatgpt': return MessageSquare;
      case 'codex': return Code2;
      case 'cursor': return Terminal;
      case 'antigravity': return Compass;
      case 'perplexity': return Search;
      case 'elevenlabs': return Radio;
      default: return Bot;
    }
  };

  const Icon = getAgentIcon(agent.role);

  // 1. Run Directive in Sandbox
  const handleRunSandbox = async () => {
    if (!sandboxPrompt.trim() && !agent.description) return;
    const promptToRun = sandboxPrompt.trim() || `Execute default operational scan for ${agent.name}: "${agent.description}"`;
    
    setIsRunningSandbox(true);
    const startTime = Date.now();

    try {
      if (onSendQuery) {
        const reply = await onSendQuery(promptToRun, selectedModel, editSystemPrompt);
        setSandboxOutput(reply);
      } else {
        await new Promise(r => setTimeout(r, 600));
        setSandboxOutput(`[${agent.name.toUpperCase()} / ${selectedModel.toUpperCase()}]: Direct directive executed successfully.\n\nKey Findings:\n- Analyzed objective with 0 unhandled promise rejections.\n- Memory context synchronized to ${agent.workspacePath || '/agents/workspace'}.\n- Emitted inotify CDC signal to [[Obsidian-Knowledge-Graph]].`);
      }
      const latency = Date.now() - startTime;
      setSandboxLatency(latency);
      setSandboxTokens(Math.floor(promptToRun.length * 0.75 + 180));
      showToast(`Directive executed in ${latency}ms via ${selectedModel.toUpperCase()}!`);
    } catch (err: any) {
      setSandboxOutput(`[Error in execution]: ${err?.message || 'Failed to dispatch directive.'}`);
    } finally {
      setIsRunningSandbox(false);
    }
  };

  // 2. Add / Delete Skill
  const handleAddSkill = () => {
    if (!newSkillInput.trim()) return;
    const updated = [...skillsList, newSkillInput.trim()];
    setSkillsList(updated);
    setNewSkillInput('');
    if (onUpdateAgent) {
      onUpdateAgent(agent.role, { capabilities: updated });
    }
    showToast(`Added capability: "${newSkillInput.trim()}"`);
  };

  const handleDeleteSkill = (index: number) => {
    const updated = skillsList.filter((_, i) => i !== index);
    setSkillsList(updated);
    if (onUpdateAgent) {
      onUpdateAgent(agent.role, { capabilities: updated });
    }
    showToast('Removed capability.');
  };

  // 3. Add / Delete Rule & Save Prompt
  const handleAddRule = () => {
    if (!newRuleInput.trim()) return;
    const updated = [...rulesList, newRuleInput.trim()];
    setRulesList(updated);
    setNewRuleInput('');
    if (onUpdateAgent) {
      onUpdateAgent(agent.role, { rules: updated });
    }
    showToast(`Added operating rule #${updated.length}`);
  };

  const handleDeleteRule = (index: number) => {
    const updated = rulesList.filter((_, i) => i !== index);
    setRulesList(updated);
    if (onUpdateAgent) {
      onUpdateAgent(agent.role, { rules: updated });
    }
    showToast('Removed rule.');
  };

  const handleSavePromptAndRules = () => {
    if (onUpdateAgent) {
      onUpdateAgent(agent.role, { 
        systemPrompt: editSystemPrompt,
        rules: rulesList,
        assignedModel: selectedModel
      });
    }
    showToast(`Saved system prompt and rules for ${agent.name}!`);
  };

  // 4. Dispatch Task to Kanban
  const handleDispatchTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || !onAddTask) return;

    onAddTask({
      title: taskTitle.trim(),
      description: taskDesc.trim() || `Specialized task assigned to ${agent.name}.`,
      column: 'todo',
      assignedAgent: agent.role,
      assignedModel: selectedModel,
      priority: taskPriority,
      tags: [agent.role, 'specialist-directive'],
      obsidianWikilinks: [`[[Startup-Theses/${agent.name.replace(/\s+/g, '-')}]]`],
      subtasks: [
        { id: `st-${Date.now()}-1`, title: 'Execute specialist cognitive reasoning stage', completed: false },
        { id: `st-${Date.now()}-2`, title: 'Verify deliverables and compile markdown note', completed: false }
      ],
      estimatedHours: taskEstimatedHours,
      category: 'startup-curation'
    });

    setTaskTitle('');
    setTaskDesc('');
    showToast(`Task dispatched to board.db for ${agent.name}!`);
  };

  // 5. Export Sandbox Output to Obsidian
  const handleExportOutputToVault = () => {
    if (!sandboxOutput || !onAddNoteToVault) return;
    const title = `Sandbox-Run-${agent.name.replace(/\s+/g, '-')}-${Date.now().toString().slice(-4)}`;
    const content = `# Directive Sandbox Execution: ${agent.name}\n**Model**: ${selectedModel.toUpperCase()}\n**Timestamp**: ${new Date().toISOString()}\n**Prompt**: ${sandboxPrompt || agent.description}\n\n## Output\n${sandboxOutput}\n\n#hermes #sandbox #${agent.role}`;
    onAddNoteToVault(title, content, ['sandbox', agent.role, 'hermes'], 'Sandbox-Runs');
    showToast('Saved sandbox deliverable to Obsidian Vault!');
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-black/75 backdrop-blur-sm transition-all animate-fadeIn">
      <div className="w-full max-w-2xl bg-[#080914] border-l border-[#1E223D] h-full overflow-y-auto p-6 flex flex-col justify-between shadow-2xl space-y-6">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#161828] pb-4">
            <div className="flex items-center gap-3">
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center border shadow-inner"
                style={{ 
                  backgroundColor: `${agent.avatarColor}15`, 
                  borderColor: `${agent.avatarColor}40`,
                  color: agent.avatarColor 
                }}
              >
                <Icon className="w-6 h-6" />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-white font-['Space_Grotesk']">
                    {agent.name}
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold text-[#00D26A] bg-[#00D26A]/10 border border-[#00D26A]/30">
                    ONLINE & READY
                  </span>
                </div>
                <div className="text-xs font-mono text-[#8E94B8]">{agent.title}</div>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-[#121424] hover:bg-[#1A1D36] text-[#8E94B8] hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Toast Notification */}
          {toastMessage && (
            <div className="p-3 bg-[#615EFF]/15 border border-[#615EFF]/40 rounded-xl text-xs font-mono text-[#A5A2FF] flex items-center gap-2 animate-fadeIn">
              <Sparkles className="w-4 h-4 text-[#615EFF] shrink-0" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-[#04050A] rounded-xl border border-[#181B2E] overflow-x-auto scrollbar-none">
            <button
              onClick={() => setActiveDrawerTab('sandbox')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-mono font-bold transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
                activeDrawerTab === 'sandbox'
                  ? 'bg-[#615EFF] text-white shadow-lg shadow-[#615EFF]/25'
                  : 'text-[#8E94B8] hover:text-white hover:bg-[#121426]'
              }`}
            >
              <Play className="w-3.5 h-3.5" />
              <span>DIRECT SANDBOX</span>
            </button>

            <button
              onClick={() => setActiveDrawerTab('skills')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-mono font-bold transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
                activeDrawerTab === 'skills'
                  ? 'bg-[#615EFF] text-white shadow-lg shadow-[#615EFF]/25'
                  : 'text-[#8E94B8] hover:text-white hover:bg-[#121426]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>SKILLS ({skillsList.length})</span>
            </button>

            <button
              onClick={() => setActiveDrawerTab('rules')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-mono font-bold transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
                activeDrawerTab === 'rules'
                  ? 'bg-[#615EFF] text-white shadow-lg shadow-[#615EFF]/25'
                  : 'text-[#8E94B8] hover:text-white hover:bg-[#121426]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>RULES ({rulesList.length})</span>
            </button>

            <button
              onClick={() => setActiveDrawerTab('tasks')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-mono font-bold transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
                activeDrawerTab === 'tasks'
                  ? 'bg-[#615EFF] text-white shadow-lg shadow-[#615EFF]/25'
                  : 'text-[#8E94B8] hover:text-white hover:bg-[#121426]'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>ADD TASK</span>
            </button>

            <button
              onClick={() => setActiveDrawerTab('overview')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-mono font-bold transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
                activeDrawerTab === 'overview'
                  ? 'bg-[#615EFF] text-white shadow-lg shadow-[#615EFF]/25'
                  : 'text-[#8E94B8] hover:text-white hover:bg-[#121426]'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>WORKSPACE</span>
            </button>
          </div>

          {/* TAB 1: DIRECT DIRECTIVE SANDBOX */}
          {activeDrawerTab === 'sandbox' && (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-4 bg-[#05060C] border border-[#181B2E] rounded-xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold text-white uppercase flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-[#EAB308]" />
                    Direct Directive Execution Sandbox
                  </span>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[#6A7097]">MODEL:</span>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="bg-[#0B0D1B] border border-[#232746] rounded-lg px-2.5 py-1 text-xs font-mono text-white focus:outline-none focus:border-[#615EFF]"
                    >
                      <option value="claude">Claude 3.7 Sonnet</option>
                      <option value="claudecode">Claude Code (Terminal)</option>
                      <option value="perplexity">Perplexity Sonar</option>
                      <option value="deepseek">DeepSeek R1</option>
                      <option value="chatgpt">ChatGPT o3</option>
                      <option value="codex">Codex Engine</option>
                      <option value="kimi3">Kimi 3 (2M Docs)</option>
                      <option value="gemini">Gemini 2.5 Flash</option>
                    </select>
                  </div>
                </div>

                <textarea
                  value={sandboxPrompt}
                  onChange={(e) => setSandboxPrompt(e.target.value)}
                  placeholder={`Enter immediate operational directive for ${agent.name} (e.g. "Scrape latest 50 Product Hunt launches and evaluate TAM")...`}
                  rows={4}
                  className="w-full bg-[#080914] border border-[#1E223D] rounded-xl p-3 text-xs font-mono text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF] leading-relaxed"
                />

                <div className="flex items-center justify-between gap-3">
                  <div className="text-[10px] font-mono text-[#6A7097]">
                    Role Boundary: <span className="text-[#00D26A] font-bold">Enforced</span>
                  </div>

                  <button
                    onClick={handleRunSandbox}
                    disabled={isRunningSandbox}
                    className="airbyte-btn-primary px-5 py-2 text-xs font-bold font-mono flex items-center gap-2 shadow-lg shadow-[#615EFF]/25 disabled:opacity-50"
                  >
                    <Play className={`w-3.5 h-3.5 ${isRunningSandbox ? 'animate-spin' : ''}`} />
                    <span>{isRunningSandbox ? 'EXECUTING IN SANDBOX...' : 'RUN DIRECTIVE NOW'}</span>
                  </button>
                </div>
              </div>

              {/* Output Display */}
              {sandboxOutput && (
                <div className="p-4 bg-[#030408] border border-[#1A1D33] rounded-xl space-y-3 animate-fadeIn">
                  <div className="flex items-center justify-between border-b border-[#141728] pb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#00D26A] animate-pulse" />
                      <span className="text-xs font-mono font-bold text-white uppercase">Deliverable Output</span>
                    </div>

                    <div className="flex items-center gap-3 text-[10px] font-mono text-[#8E94B8]">
                      {sandboxLatency && <span>Latency: <strong className="text-[#00D26A]">{sandboxLatency}ms</strong></span>}
                      {sandboxTokens && <span>Tokens: <strong className="text-[#A5A2FF]">{sandboxTokens}</strong></span>}
                      <button
                        onClick={handleExportOutputToVault}
                        className="px-2 py-0.5 rounded bg-[#15182D] hover:bg-[#1E2342] text-[#00D26A] border border-[#252A4E] flex items-center gap-1 transition"
                      >
                        <Database className="w-3 h-3" />
                        <span>Save to Vault</span>
                      </button>
                    </div>
                  </div>

                  <pre className="text-xs font-mono text-gray-200 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto p-2 bg-[#05060D] rounded-lg border border-[#121424]">
                    {sandboxOutput}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SKILLS & CAPABILITIES */}
          {activeDrawerTab === 'skills' && (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-4 bg-[#05060C] border border-[#181B2E] rounded-xl space-y-3">
                <span className="text-xs font-mono font-bold text-white uppercase block">
                  Add New Specialist Capability
                </span>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newSkillInput}
                    onChange={(e) => setNewSkillInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddSkill()}
                    placeholder="e.g. arXiv Semantic Parsing, TAM Unit Economics, WASM Sandbox..."
                    className="flex-1 bg-[#080914] border border-[#1E223D] rounded-xl px-3.5 py-2 text-xs font-mono text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
                  />
                  <button
                    onClick={handleAddSkill}
                    className="px-4 py-2 rounded-xl bg-[#615EFF] hover:bg-[#5653D9] text-white text-xs font-mono font-bold flex items-center gap-1.5 shadow"
                  >
                    <Plus className="w-4 h-4" />
                    <span>ADD</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-mono text-[#6A7097] uppercase">Current Active Skills ({skillsList.length})</span>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {skillsList.map((skill, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-[#080A14] border border-[#181B2E] rounded-xl flex items-center justify-between gap-3 group hover:border-[#2A2F50] transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <Sparkles className="w-4 h-4 text-[#615EFF] shrink-0" />
                        <span className="text-xs font-mono text-white">{skill}</span>
                      </div>

                      <button
                        onClick={() => handleDeleteSkill(idx)}
                        className="p-1.5 rounded-lg text-[#6E759D] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition opacity-60 group-hover:opacity-100"
                        title="Remove skill"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: OPERATING RULES & PROMPTS */}
          {activeDrawerTab === 'rules' && (
            <div className="space-y-4 animate-fadeIn">
              {/* Add Rule */}
              <div className="p-4 bg-[#05060C] border border-[#181B2E] rounded-xl space-y-3">
                <span className="text-xs font-mono font-bold text-white uppercase block">
                  Add Permanent Operating Rule
                </span>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newRuleInput}
                    onChange={(e) => setNewRuleInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddRule()}
                    placeholder="e.g. Always generate a TypeScript interface before implementing API..."
                    className="flex-1 bg-[#080914] border border-[#1E223D] rounded-xl px-3.5 py-2 text-xs font-mono text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
                  />
                  <button
                    onClick={handleAddRule}
                    className="px-4 py-2 rounded-xl bg-[#615EFF] hover:bg-[#5653D9] text-white text-xs font-mono font-bold flex items-center gap-1.5 shadow"
                  >
                    <Plus className="w-4 h-4" />
                    <span>ADD</span>
                  </button>
                </div>
              </div>

              {/* Rules List */}
              <div className="space-y-2">
                <span className="text-[10px] font-mono text-[#6A7097] uppercase">Permanent Rules ({rulesList.length})</span>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {rulesList.map((rule, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-[#080A14] border border-[#181B2E] rounded-xl flex items-center justify-between gap-3 group hover:border-[#2A2F50] transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="w-5 h-5 rounded-md bg-[#14172B] text-[#00D26A] text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <span className="text-xs font-mono text-gray-200">{rule}</span>
                      </div>

                      <button
                        onClick={() => handleDeleteRule(idx)}
                        className="p-1.5 rounded-lg text-[#6E759D] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition opacity-60 group-hover:opacity-100"
                        title="Remove rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* System Prompt Editor */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-[#6A7097] uppercase">
                    Core System Prompt (SOUL.md)
                  </span>
                  <button
                    onClick={handleSavePromptAndRules}
                    className="text-[10px] font-mono text-[#00D26A] flex items-center gap-1 hover:underline"
                  >
                    <Save className="w-3 h-3" />
                    <span>Save Prompt</span>
                  </button>
                </div>

                <textarea
                  value={editSystemPrompt}
                  onChange={(e) => setEditSystemPrompt(e.target.value)}
                  rows={4}
                  className="w-full bg-[#030408] border border-[#181B2E] rounded-xl p-3 text-xs font-mono text-[#00D26A] placeholder-[#53597D] focus:outline-none focus:border-[#615EFF] leading-relaxed"
                />
              </div>
            </div>
          )}

          {/* TAB 4: ADD TASK (board.db) */}
          {activeDrawerTab === 'tasks' && (
            <form onSubmit={handleDispatchTask} className="space-y-4 animate-fadeIn">
              <div className="p-4 bg-[#05060C] border border-[#181B2E] rounded-xl space-y-4">
                <span className="text-xs font-mono font-bold text-white uppercase block">
                  Dispatch Task for {agent.name} (board.db)
                </span>

                <div>
                  <label className="text-[10px] font-mono text-[#6A7097] block mb-1">Task Title</label>
                  <input
                    type="text"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder={`e.g. Scrape and analyze competitor feature matrix...`}
                    required
                    className="w-full bg-[#080914] border border-[#1E223D] rounded-xl px-3.5 py-2 text-xs font-mono text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono text-[#6A7097] block mb-1">Description & Deliverable Specs</label>
                  <textarea
                    value={taskDesc}
                    onChange={(e) => setTaskDesc(e.target.value)}
                    placeholder="Provide execution details and expected deliverable markdown format..."
                    rows={3}
                    className="w-full bg-[#080914] border border-[#1E223D] rounded-xl p-3 text-xs font-mono text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-[#6A7097] block mb-1">Priority</label>
                    <select
                      value={taskPriority}
                      onChange={(e) => setTaskPriority(e.target.value as any)}
                      className="w-full bg-[#080914] border border-[#1E223D] rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#615EFF]"
                    >
                      <option value="critical">Critical (P0)</option>
                      <option value="high">High (P1)</option>
                      <option value="medium">Medium (P2)</option>
                      <option value="low">Low (P3)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-mono text-[#6A7097] block mb-1">Estimated Hours</label>
                    <input
                      type="text"
                      value={taskEstimatedHours}
                      onChange={(e) => setTaskEstimatedHours(e.target.value)}
                      className="w-full bg-[#080914] border border-[#1E223D] rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#615EFF]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full airbyte-btn-primary py-2.5 text-xs font-mono font-bold flex items-center justify-center gap-2 shadow-lg shadow-[#615EFF]/25"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>DISPATCH TASK TO BOARD.DB</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 5: WORKSPACE & TELEMETRY */}
          {activeDrawerTab === 'overview' && (
            <div className="space-y-4 animate-fadeIn">
              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl space-y-1">
                  <span className="text-[10px] text-[#6A7097]">TELEGRAM CHANNEL</span>
                  <div className="text-white font-bold truncate">{agent.telegramChannelName || '#specialist'}</div>
                  <span className="text-[10px] text-[#00D26A]">Thread ID: {agent.telegramThreadId || 101}</span>
                </div>

                <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl space-y-1">
                  <span className="text-[10px] text-[#6A7097]">PRIMARY MODEL</span>
                  <div className="text-[#615EFF] font-bold truncate">{agent.assignedModel}</div>
                  <span className="text-[10px] text-[#8E94B8]">Backup: {agent.secondaryModel}</span>
                </div>

                <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl space-y-1">
                  <span className="text-[10px] text-[#6A7097]">ISOLATED WORKSPACE</span>
                  <div className="text-white font-bold truncate">{agent.workspacePath || `/workspace/${agent.role}`}</div>
                  <span className="text-[10px] text-[#00D26A]">Role Boundary Enforced</span>
                </div>

                <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl space-y-1">
                  <span className="text-[10px] text-[#6A7097]">MEMORY RETENTION</span>
                  <div className="text-[#00D26A] font-bold">{agent.memoryFileSize || '32.4 KB'}</div>
                  <span className="text-[10px] text-[#8E94B8]">Inotify Watcher Active</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[10px] font-mono text-[#6A7097] uppercase">MISSION PROFILE</span>
                <p className="text-xs text-[#CBD2EE] leading-relaxed bg-[#05060C] p-3.5 rounded-xl border border-[#161828]">
                  {agent.description}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-[#161828] flex items-center gap-3">
          <button
            onClick={() => {
              onClose();
              onSelectTab('telegram-chat');
            }}
            className="flex-1 airbyte-btn-secondary py-2.5 text-xs font-bold flex items-center justify-center gap-2"
          >
            <MessageSquare className="w-3.5 h-3.5 text-[#00D26A]" />
            <span>Open Telegram Thread</span>
          </button>

          <button
            onClick={() => {
              onClose();
              onSelectTab('kanban');
            }}
            className="flex-1 airbyte-btn-primary py-2.5 text-xs font-bold flex items-center justify-center gap-2"
          >
            <Play className="w-3.5 h-3.5" />
            <span>View Tasks (board.db)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
