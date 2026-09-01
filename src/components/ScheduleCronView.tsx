import React, { useState } from 'react';
import { CronScheduleJob, ActiveTab } from '../types';
import { 
  Clock, Play, RefreshCw, CheckCircle2, AlertCircle, 
  Bot, Terminal, Search, PenTool, Code2, Share2, 
  Calendar, ShieldCheck, Zap
} from 'lucide-react';

interface ScheduleCronViewProps {
  cronJobs: CronScheduleJob[];
  onRunCronJob: (jobId: string) => Promise<void>;
  onSelectTab: (tab: ActiveTab) => void;
}

export const ScheduleCronView: React.FC<ScheduleCronViewProps> = ({
  cronJobs,
  onRunCronJob,
  onSelectTab,
}) => {
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [lastExecutedJob, setLastExecutedJob] = useState<string | null>(null);

  const handleRunNow = async (jobId: string) => {
    setRunningJobId(jobId);
    try {
      await onRunCronJob(jobId);
      const job = cronJobs.find(j => j.id === jobId);
      setLastExecutedJob(`Successfully executed scheduled job: "${job?.name}". Updated target Obsidian note.`);
      setTimeout(() => setLastExecutedJob(null), 4000);
    } catch (err: any) {
      console.error(err);
    } finally {
      setRunningJobId(null);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#080913] border border-[#1A1D30] p-6 rounded-2xl">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2">
            <span className="airbyte-badge">
              HERMES CRON SCHEDULER • PART 06 STEP 28
            </span>
            <span className="text-[10px] font-mono text-[#00D26A] bg-[#00D26A]/10 px-2 py-0.5 rounded border border-[#00D26A]/30">
              {cronJobs.length} ACTIVE PIPELINES
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white font-['Space_Grotesk']">
            Autonomous Scheduled Agents & Scrapers
          </h2>
          <p className="text-xs text-[#8E94B8]">
            Hermes cron pipelines executing web scrapers, repository watchers, daily Obsidian synthesizers, and growth distribution sweeps.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onSelectTab('bot-mode')}
            className="airbyte-btn-secondary px-4 py-2.5 text-xs font-semibold flex items-center gap-2"
          >
            <Bot className="w-3.5 h-3.5 text-[#00D26A]" />
            <span>Bot Mode Swarm</span>
          </button>
        </div>
      </div>

      {lastExecutedJob && (
        <div className="p-3.5 bg-[#00D26A]/10 border border-[#00D26A]/30 rounded-xl text-xs font-mono text-[#00D26A] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{lastExecutedJob}</span>
        </div>
      )}

      {/* Jobs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {cronJobs.map((job) => {
          const isExecuting = runningJobId === job.id;

          return (
            <div
              key={job.id}
              className="bg-[#070810] border border-[#181B2E] hover:border-[#2C3052] rounded-2xl p-5 flex flex-col justify-between space-y-4 shadow-lg transition group"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-mono text-[#615EFF] uppercase font-bold tracking-wider">
                      {job.category.toUpperCase()} PIPELINE
                    </span>
                    <h3 className="text-base font-bold text-white font-mono group-hover:text-[#A5A2FF] transition mt-0.5">
                      {job.name}
                    </h3>
                  </div>

                  <span className="text-[10px] font-mono px-2 py-0.5 rounded border font-semibold text-[#00D26A] bg-[#00D26A]/10 border-[#00D26A]/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00D26A] animate-ping" />
                    RUNNING
                  </span>
                </div>

                <p className="text-xs text-[#8E94B8] leading-relaxed">
                  {job.description}
                </p>

                <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl space-y-1.5 text-xs font-mono text-[#7B82A8]">
                  <div className="flex justify-between">
                    <span>Cron Expression:</span>
                    <span className="text-[#EAB308] font-bold">{job.expression}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Assigned Specialist:</span>
                    <span className="text-white uppercase font-bold">{job.agentRole}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Inference Model:</span>
                    <span className="text-[#615EFF]">{job.model}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Target Vault Note:</span>
                    <span className="text-white truncate max-w-[190px]">{job.targetOutput}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-[#121422]">
                    <span>Lifetime Executions:</span>
                    <span className="text-[#00D26A]">{job.runCount} runs</span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-[#141626] flex items-center justify-between">
                <div className="text-[11px] font-mono text-[#6A7097]">
                  Next run: <span className="text-white">{job.nextRun}</span>
                </div>

                <button
                  onClick={() => handleRunNow(job.id)}
                  disabled={isExecuting}
                  className="px-4 py-2 rounded-lg bg-[#615EFF] hover:bg-[#4F4CE6] text-xs font-mono font-bold text-white transition flex items-center gap-1.5 disabled:opacity-50 shadow"
                >
                  <Play className={`w-3.5 h-3.5 ${isExecuting ? 'animate-spin' : ''}`} />
                  <span>{isExecuting ? 'EXECUTING...' : 'RUN NOW'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
