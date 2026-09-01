import React, { useState } from 'react';
import { BotTask, AIModelInfo } from '../types';
import { 
  Bot, Play, Pause, Plus, RefreshCw, Clock, CheckCircle2, 
  Terminal, Shield, Zap, Activity, AlertCircle, Trash2, 
  Layers, ArrowUpRight, Cpu, Radio, Sparkles
} from 'lucide-react';

interface BotModeViewProps {
  tasks: BotTask[];
  models: Record<string, AIModelInfo>;
  onToggleTaskStatus: (taskId: string) => void;
  onRunTaskNow: (taskId: string) => void;
  onAddTask: (task: Omit<BotTask, 'id' | 'lastRun' | 'actionsCount'>) => void;
  onDeleteTask: (taskId: string) => void;
}

export const BotModeView: React.FC<BotModeViewProps> = ({
  tasks,
  models,
  onToggleTaskStatus,
  onRunTaskNow,
  onAddTask,
  onDeleteTask,
}) => {
  const [isArmingAll, setIsArmingAll] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);

  // New task form state
  const [taskName, setTaskName] = useState('');
  const [taskCron, setTaskCron] = useState('*/15 * * * * (Every 15m)');
  const [taskModel, setTaskModel] = useState('Gemini 2.5 Flash');
  const [taskTarget, setTaskTarget] = useState('Automations/Daily-Log.md');
  const [taskDesc, setTaskDesc] = useState('');

  const handleExecuteSingle = (id: string) => {
    setRunningTaskId(id);
    onRunTaskNow(id);
    setRunningTaskId(null);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskName.trim()) return;

    onAddTask({
      name: taskName,
      cron: taskCron,
      model: taskModel,
      targetVaultNote: taskTarget,
      status: 'running',
      nextRun: 'NOT_AVAILABLE',
      description: taskDesc || 'Bot task template configured for Hermes OS.'
    });

    setIsModalOpen(false);
    setTaskName('');
    setTaskDesc('');
  };

  return (
    <div className="space-y-8 pb-16 max-w-7xl mx-auto px-4">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-4 border-b border-[#1A1D2E] pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="airbyte-badge">
              AUTONOMOUS BOT SWARM ENGINE (TEMPLATES)
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-['Space_Grotesk']">
            Hermes BOT MODE Swarm
          </h1>
          <p className="text-xs sm:text-sm text-[#8E94B8] mt-1">
            Continuous background agent loops compiling research, healing codebases, and updating Obsidian vaults.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-4 py-2.5 rounded-lg text-xs font-bold font-mono uppercase tracking-wider flex items-center gap-2 bg-[#181B2E] border border-[#2B304E] text-[#8E94B8]">
            <span className="w-2 h-2 rounded-full bg-[#555A7B]"></span>
            <span>SWARM RUNTIME: NOT_CONNECTED</span>
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            className="airbyte-btn-primary px-4 py-2.5 text-xs font-bold flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>DEPLOY NEW BOT</span>
          </button>
        </div>
      </div>

      {/* Swarm Metrics matching Airbyte Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="airbyte-card p-5 space-y-2">
          <div className="text-[10px] font-mono text-[#6E759D] uppercase">Configured Templates</div>
          <div className="text-2xl font-extrabold text-white font-['Space_Grotesk']">
            {tasks.length}
          </div>
          <div className="text-xs text-[#8E94B8] font-mono flex items-center gap-1">
            <AlertCircle className="w-3 h-3 text-[#555A7B]" />
            <span>NOT_CONNECTED (No runtime daemon)</span>
          </div>
        </div>

        <div className="airbyte-card p-5 space-y-2">
          <div className="text-[10px] font-mono text-[#6E759D] uppercase">Vault Actions (24h)</div>
          <div className="text-2xl font-extrabold text-white font-['Space_Grotesk']">
            NOT_AVAILABLE
          </div>
          <div className="text-xs text-[#8E94B8] font-mono flex items-center gap-1">
            <Activity className="w-3 h-3 text-[#555A7B]" />
            <span>NOT_AVAILABLE</span>
          </div>
        </div>

        <div className="airbyte-card p-5 space-y-2">
          <div className="text-[10px] font-mono text-[#6E759D] uppercase">Context Efficiency</div>
          <div className="text-2xl font-extrabold text-white font-['Space_Grotesk']">
            NOT_AVAILABLE
          </div>
          <div className="text-xs text-[#8E94B8] font-mono flex items-center gap-1">
            <Zap className="w-3 h-3 text-[#555A7B]" />
            <span>NOT_AVAILABLE</span>
          </div>
        </div>

        <div className="airbyte-card p-5 space-y-2">
          <div className="text-[10px] font-mono text-[#6E759D] uppercase">Vault Replication</div>
          <div className="text-2xl font-extrabold text-white font-['Space_Grotesk']">
            NOT_CONNECTED
          </div>
          <div className="text-xs text-[#8E94B8] font-mono flex items-center gap-1">
            <Radio className="w-3 h-3 text-[#555A7B]" />
            <span>NOT_CONNECTED</span>
          </div>
        </div>
      </div>

      {/* Bot Tasks Table / Cards */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white font-['Space_Grotesk']">
            Configured Bot Templates
          </h3>
          <span className="airbyte-badge-subtle font-mono text-xs text-[#8E94B8]">
            CRON DISPATCHER: NOT_CONNECTED (Phase 1)
          </span>
        </div>

        <div className="space-y-3">
          {tasks.map((task) => {
            const isExecuting = runningTaskId === task.id;
            return (
              <div
                key={task.id}
                className="airbyte-card p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 group"
              >
                <div className="space-y-2 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1A1D33] text-[#A5A2FF] border border-[#2B304E] font-bold">
                      SAMPLE TEMPLATE
                    </span>
                    <span className="text-sm font-bold text-white font-['Space_Grotesk']">
                      {task.name}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded border bg-[#181B2E] text-[#8E94B8] border-[#2B304E]">
                      {task.status === 'running' ? 'STANDBY (TEMPLATE)' : 'PAUSED'}
                    </span>
                    <span className="text-[10px] font-mono bg-[#615EFF]/10 text-[#A5A2FF] border border-[#615EFF]/30 px-2 py-0.5 rounded">
                      {task.model}
                    </span>
                  </div>

                  <p className="text-xs text-[#8E94B8] leading-relaxed">
                    {task.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono text-[#6A7097]">
                    <span>Schedule: <strong className="text-[#C0C5DE]">{task.cron}</strong></span>
                    <span>Target Vault Note: <strong className="text-[#A5A2FF]">[[{task.targetVaultNote}]]</strong></span>
                    <span>Last run: <strong className="text-[#8E94B8]">NOT_AVAILABLE</strong></span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleExecuteSingle(task.id)}
                    disabled={isExecuting}
                    className="px-3 py-1.5 rounded bg-[#131626] hover:bg-[#1C2036] border border-[#232844] text-xs font-mono text-[#8E94B8] hover:text-white transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isExecuting ? 'animate-spin' : ''}`} />
                    <span>{isExecuting ? 'DISPATCHING...' : 'TRIGGER TEMPLATE'}</span>
                  </button>

                  <button
                    onClick={() => onToggleTaskStatus(task.id)}
                    className="p-2 rounded bg-[#131626] hover:bg-[#1C2036] border border-[#232844] text-[#8E94B8] hover:text-white transition cursor-pointer"
                    title={task.status === 'running' ? 'Pause Template' : 'Enable Template'}
                  >
                    {task.status === 'running' ? <Pause className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-[#00D26A]" />}
                  </button>

                  <button
                    onClick={() => onDeleteTask(task.id)}
                    className="p-2 rounded bg-[#131626] hover:bg-[#1C2036] border border-[#232844] text-[#8E94B8] hover:text-rose-400 transition cursor-pointer"
                    title="Remove Template"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* New Bot Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0B0D18] border border-[#242844] rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#1A1D30]">
              <h3 className="text-base font-bold text-white font-['Space_Grotesk']">
                Deploy Autonomous Bot Daemon
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-[#8E94B8] hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] block mb-1">BOT NAME</label>
                <input
                  type="text"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="e.g. arXiv Autonomous Research Extractor"
                  required
                  className="w-full bg-[#05060B] border border-[#1E223D] rounded-lg px-3 py-2 text-xs text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] block mb-1">AI MODEL ENGINE</label>
                <select
                  value={taskModel}
                  onChange={(e) => setTaskModel(e.target.value)}
                  className="w-full bg-[#05060B] border border-[#1E223D] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                >
                  <option value="Gemini 2.5 Flash">Gemini 2.5 Flash (Ultra Fast)</option>
                  <option value="DeepSeek R1">DeepSeek R1 (Deep Reasoning)</option>
                  <option value="Claude Code 3.7">Claude Code 3.7 (Code Healer)</option>
                  <option value="ChatGPT o3">ChatGPT o3 (Logic Synthesis)</option>
                  <option value="Perplexity Sonar">Perplexity Sonar (Web Grounding)</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] block mb-1">CRON SCHEDULE</label>
                <input
                  type="text"
                  value={taskCron}
                  onChange={(e) => setTaskCron(e.target.value)}
                  placeholder="*/15 * * * * (Every 15m)"
                  className="w-full bg-[#05060B] border border-[#1E223D] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] block mb-1">TARGET OBSIDIAN NOTE PATH</label>
                <input
                  type="text"
                  value={taskTarget}
                  onChange={(e) => setTaskTarget(e.target.value)}
                  placeholder="Research-2026/arXiv-Trends.md"
                  className="w-full bg-[#05060B] border border-[#1E223D] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] block mb-1">DESCRIPTION</label>
                <textarea
                  value={taskDesc}
                  onChange={(e) => setTaskDesc(e.target.value)}
                  rows={3}
                  placeholder="Describe what this bot does..."
                  className="w-full bg-[#05060B] border border-[#1E223D] rounded-lg p-3 text-xs font-mono text-white focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-[#8E94B8] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="airbyte-btn-primary px-4 py-2 text-xs font-bold"
                >
                  Deploy Bot Daemon
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
