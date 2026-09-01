import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal as TerminalIcon, ShieldCheck, AlertTriangle, CheckCircle2,
  XCircle, Clock, Play, RefreshCw, Folder, Database, HardDrive,
  Cpu, Copy, Check, ChevronRight, CornerDownLeft, Plus, Trash2,
  ExternalLink, Sparkles, Layers, Sliders, FileText, Lock, Unlock,
  Search, Radio, Eye, Download, Server, Key
} from 'lucide-react';
import {
  AgentInfo, AIModelInfo, KanbanTask, ObsidianNote, ActiveTab,
  TerminalCommandStatus, TerminalConnectionStatus, TerminalExecutionRecord,
  TerminalSessionInfo
} from '../types';

interface HermesTerminalViewProps {
  agents?: Record<string, AgentInfo>;
  models?: Record<string, AIModelInfo>;
  tasks?: KanbanTask[];
  notes?: ObsidianNote[];
  onSelectTab?: (tab: ActiveTab) => void;
  onAddTaskToKanban?: (task: Omit<KanbanTask, 'id' | 'createdAt' | 'updatedAt' | 'subtasks'>) => void;
  onAddNoteToVault?: (title: string, content: string, tags: string[], folder?: string) => void;
  onLogActivity?: (event: string, details?: any) => void;
}

export const HermesTerminalView: React.FC<HermesTerminalViewProps> = ({
  agents = {},
  models = {},
  tasks = [],
  notes = [],
  onSelectTab,
  onAddTaskToKanban,
  onAddNoteToVault,
  onLogActivity
}) => {
  // Backend Connection State
  const [connectionStatus, setConnectionStatus] = useState<TerminalConnectionStatus>('PARTIAL');
  const [backendMeta, setBackendMeta] = useState<{
    shell?: string;
    cwd?: string;
    nodeVersion?: string;
    pid?: number;
    platform?: string;
    uptime?: number;
    memoryUsage?: any;
  }>({});
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);

  // Session State
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([
    {
      id: 'default',
      name: 'Fleet Master Shell',
      cwd: '/workspace',
      history: ['node -v', 'pwd', 'ls -la'],
      lastActive: new Date().toISOString(),
      env: {
        HERMES_AGENT_ID: 'orchestrator',
        BOARD_DB_PATH: '~/.hermes/state.db'
      }
    }
  ]);
  const [activeSessionId, setActiveSessionId] = useState('default');
  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];

  // Command & Execution Records
  const [commandInput, setCommandInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [executionLogs, setExecutionLogs] = useState<TerminalExecutionRecord[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeRunningCmd, setActiveRunningCmd] = useState<string | null>(null);
  const [streamChunks, setStreamChunks] = useState<string>('');

  // Association & Controls
  const [associatedTaskId, setAssociatedTaskId] = useState<string>('');
  const [selectedTaskTitle, setSelectedTaskTitle] = useState<string>('No Task Linked');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [savedVaultNoteId, setSavedVaultNoteId] = useState<string | null>(null);

  // Guardian Intercept Modal
  const [pendingApprovalRecord, setPendingApprovalRecord] = useState<{
    command: string;
    guardianWarning?: string;
    ruleCitation?: string;
    riskLevel?: string;
    cwd: string;
  } | null>(null);

  // Terminal screen reference
  const terminalScreenRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 1. Initial Health Check
  const checkBackendStatus = async () => {
    setIsCheckingHealth(true);
    try {
      const res = await fetch('/api/terminal/status');
      if (res.ok) {
        const data = await res.json();
        setConnectionStatus(data.status || 'CONNECTED');
        setBackendMeta({
          shell: data.shell,
          cwd: data.cwd,
          nodeVersion: data.nodeVersion,
          pid: data.pid,
          platform: data.platform,
          uptime: data.uptime,
          memoryUsage: data.memoryUsage
        });
        if (data.cwd && activeSession) {
          setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, cwd: data.cwd } : s));
        }
      } else {
        setConnectionStatus('NOT_CONNECTED');
      }
    } catch (e) {
      setConnectionStatus('NOT_CONNECTED');
    } finally {
      setIsCheckingHealth(false);
    }
  };

  useEffect(() => {
    checkBackendStatus();
    const interval = setInterval(checkBackendStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll terminal screen
  useEffect(() => {
    if (autoScroll && terminalScreenRef.current) {
      terminalScreenRef.current.scrollTop = terminalScreenRef.current.scrollHeight;
    }
  }, [executionLogs, streamChunks, autoScroll]);

  // 2. Command Dispatch Handler
  const handleExecuteCommand = async (customCmd?: string, approvedByHuman = false) => {
    const rawCmd = (customCmd !== undefined ? customCmd : commandInput).trim();
    if (!rawCmd || isExecuting) return;

    // Reset input
    setCommandInput('');
    setHistoryIndex(null);

    const execId = `exec-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const currentCwd = activeSession?.cwd || backendMeta.cwd || '/workspace';

    // Optimistic queued record
    const newRecord: TerminalExecutionRecord = {
      id: execId,
      command: rawCmd,
      status: 'QUEUED',
      exitCode: null,
      stdout: '',
      stderr: '',
      cwd: currentCwd,
      durationMs: 0,
      timestamp: new Date().toLocaleTimeString(),
      sessionId: activeSessionId,
      taskId: associatedTaskId || undefined
    };

    setExecutionLogs(prev => [...prev, newRecord]);
    setIsExecuting(true);
    setActiveRunningCmd(rawCmd);
    setStreamChunks('');

    // Pre-flight Guardian check
    if (!approvedByHuman) {
      try {
        const guardRes = await fetch('/api/terminal/guardian-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: rawCmd })
        });
        if (guardRes.ok) {
          const guardData = await guardRes.json();
          if (guardData.status === 'BLOCKED') {
            setExecutionLogs(prev => prev.map(r => r.id === execId ? {
              ...r,
              status: 'BLOCKED',
              exitCode: 126,
              stderr: `[GUARDIAN SENTINEL BLOCKED]\n${guardData.warning}\nCitation: ${guardData.ruleCitation}\nExecution was strictly denied.`,
              guardianCheck: guardData
            } : r));
            setIsExecuting(false);
            setActiveRunningCmd(null);
            onLogActivity?.(`Guardian Sentinel Blocked Command: ${rawCmd}`);
            return;
          }

          if (guardData.status === 'APPROVAL_REQUIRED') {
            setExecutionLogs(prev => prev.map(r => r.id === execId ? {
              ...r,
              status: 'APPROVAL_REQUIRED',
              stderr: `[APPROVAL REQUIRED]\n${guardData.warning}\nCitation: ${guardData.ruleCitation}`,
              guardianCheck: guardData
            } : r));
            setPendingApprovalRecord({
              command: rawCmd,
              guardianWarning: guardData.warning,
              ruleCitation: guardData.ruleCitation,
              riskLevel: guardData.riskLevel,
              cwd: currentCwd
            });
            setIsExecuting(false);
            setActiveRunningCmd(null);
            return;
          }
        }
      } catch (e) {
        // Proceed to execution if guardian check request fails
      }
    }

    // Set to RUNNING
    setExecutionLogs(prev => prev.map(r => r.id === execId ? { ...r, status: 'RUNNING' } : r));

    try {
      const startTime = Date.now();
      const res = await fetch('/api/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: rawCmd,
          cwd: currentCwd,
          sessionId: activeSessionId,
          taskId: associatedTaskId || undefined,
          approvedByHuman
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} execution failure`);
      }

      const result = await res.json();
      const finalStatus: TerminalCommandStatus = result.status || (result.exitCode === 0 ? 'SUCCEEDED' : 'FAILED');

      setExecutionLogs(prev => prev.map(r => r.id === execId ? {
        ...r,
        status: finalStatus,
        exitCode: result.exitCode ?? 1,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        durationMs: result.durationMs || (Date.now() - startTime),
        cwd: result.cwd || currentCwd,
        guardianCheck: result.guardianCheck
      } : r));

      // Update session CWD and history
      if (result.cwd) {
        setSessions(prev => prev.map(s => s.id === activeSessionId ? {
          ...s,
          cwd: result.cwd,
          history: [...s.history, rawCmd],
          lastActive: new Date().toISOString()
        } : s));
      }

      // Log activity
      onLogActivity?.(`Terminal executed: "${rawCmd.slice(0, 35)}" (${finalStatus})`, {
        exitCode: result.exitCode,
        durationMs: result.durationMs
      });

    } catch (err: any) {
      setExecutionLogs(prev => prev.map(r => r.id === execId ? {
        ...r,
        status: 'FAILED',
        exitCode: 1,
        stderr: err.message || 'Execution error during process dispatch',
        durationMs: 5
      } : r));
    } finally {
      setIsExecuting(false);
      setActiveRunningCmd(null);
    }
  };

  // Keyboard navigation for history (Up / Down)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleExecuteCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const hist = activeSession?.history || [];
      if (hist.length === 0) return;
      const nextIdx = historyIndex === null ? hist.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIdx);
      setCommandInput(hist[nextIdx] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const hist = activeSession?.history || [];
      if (hist.length === 0 || historyIndex === null) return;
      const nextIdx = historyIndex + 1;
      if (nextIdx >= hist.length) {
        setHistoryIndex(null);
        setCommandInput('');
      } else {
        setHistoryIndex(nextIdx);
        setCommandInput(hist[nextIdx] || '');
      }
    }
  };

  // Create New Session
  const handleCreateSession = () => {
    const newId = `session-${Date.now().toString(36)}`;
    const newSession: TerminalSessionInfo = {
      id: newId,
      name: `Session ${sessions.length + 1}`,
      cwd: backendMeta.cwd || '/workspace',
      history: ['pwd'],
      lastActive: new Date().toISOString(),
      env: {
        HERMES_AGENT_ID: 'dev',
        BOARD_DB_PATH: '~/.hermes/state.db'
      }
    };
    setSessions(prev => [...prev, newSession]);
    setActiveSessionId(newId);
  };

  // Delete Session
  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessions.length <= 1) return;
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      setActiveSessionId(remaining[0]?.id || 'default');
    }
  };

  // Save Output to Vault
  const handleSaveToVault = (record: TerminalExecutionRecord) => {
    const title = `Terminal-Output-${record.command.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 30)}-${Date.now()}`;
    const content = `# Terminal Execution Artifact: \`${record.command}\`
**Date**: ${new Date().toISOString()}  
**Status**: [[Status/${record.status}]] | **Exit Code**: \`${record.exitCode}\`  
**Execution Time**: \`${record.durationMs}ms\` | **CWD**: \`${record.cwd}\`  
**Session**: \`${record.sessionId}\` ${record.taskId ? `| **Task**: [[Tasks/${record.taskId}]]` : ''}

---

## 1. Executed Command
\`\`\`bash
${record.command}
\`\`\`

## 2. Standard Output (stdout)
\`\`\`text
${record.stdout || '(no stdout output)'}
\`\`\`

## 3. Standard Error (stderr)
\`\`\`text
${record.stderr || '(no stderr output)'}
\`\`\`

---
*Archived by Hermes Terminal Mission Control Engine*`;

    onAddNoteToVault?.(title, content, ['terminal-artifact', 'shell-run', record.status.toLowerCase()], 'Artifacts');
    setSavedVaultNoteId(record.id);
    setTimeout(() => setSavedVaultNoteId(null), 3000);
  };

  // Quick Shell Command Helpers
  const quickCommands = [
    { label: 'Files (ls -la)', cmd: 'ls -la' },
    { label: 'Working Dir (pwd)', cmd: 'pwd' },
    { label: 'Node Version (node -v)', cmd: 'node -v' },
    { label: 'Git Status (git status)', cmd: 'git status -s' },
    { label: 'Hermes DB Check', cmd: 'ls -la ~/.hermes 2>/dev/null || ls -la .' },
    { label: 'Disk Free (df -h)', cmd: 'df -h .' },
    { label: 'Top Processes (ps aux)', cmd: 'ps aux | head -n 10' },
    { label: 'Env Summary', cmd: 'env | grep -E "(HERMES|NODE|PATH)" | head -n 10' },
  ];

  const filteredLogs = executionLogs.filter(log => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      log.command.toLowerCase().includes(q) ||
      log.stdout.toLowerCase().includes(q) ||
      log.stderr.toLowerCase().includes(q) ||
      log.status.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] bg-[#070811] text-gray-200 font-mono overflow-hidden">
      {/* 1. Header Toolbar */}
      <div className="bg-[#0D0F1D] border-b border-[#1A1D36] p-3 px-4 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#615EFF]/10 border border-[#615EFF]/30 rounded-lg text-[#615EFF]">
            <TerminalIcon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-wide">HERMES SHELL TERMINAL</h1>
              {/* Backend Connection Status Badge */}
              <span className={`px-2 py-0.5 text-xs font-semibold rounded-full flex items-center gap-1.5 border ${
                connectionStatus === 'CONNECTED'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : connectionStatus === 'PARTIAL'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'CONNECTED' ? 'bg-emerald-400 animate-pulse' : connectionStatus === 'PARTIAL' ? 'bg-amber-400' : 'bg-rose-400'
                }`} />
                {connectionStatus}
              </span>
            </div>
            <p className="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
              <span>Host: {backendMeta.platform || 'linux'} ({backendMeta.shell || '/bin/bash'})</span>
              <span className="text-gray-600">•</span>
              <span>PID: {backendMeta.pid || 'Active'}</span>
              <span className="text-gray-600">•</span>
              <span className="text-[#38BDF8]">Node {backendMeta.nodeVersion || 'v22'}</span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Linked Task Selector */}
          <div className="flex items-center gap-1.5 bg-[#121528] border border-[#202444] rounded-lg px-2.5 py-1.5 text-xs">
            <span className="text-gray-400 text-[11px]">Task:</span>
            <select
              value={associatedTaskId}
              onChange={(e) => {
                setAssociatedTaskId(e.target.value);
                const found = tasks.find(t => t.id === e.target.value);
                setSelectedTaskTitle(found?.title || 'No Task Linked');
              }}
              className="bg-transparent text-[#615EFF] font-medium outline-none cursor-pointer max-w-[160px] truncate"
            >
              <option value="" className="bg-[#0D0F1D] text-gray-400">Unlinked (Direct Shell)</option>
              {tasks.map(t => (
                <option key={t.id} value={t.id} className="bg-[#0D0F1D] text-white">
                  [{t.task_id || t.id.slice(0, 6)}] {t.title.slice(0, 25)}...
                </option>
              ))}
            </select>
          </div>

          {/* Re-check Health Button */}
          <button
            onClick={checkBackendStatus}
            disabled={isCheckingHealth}
            title="Refresh backend shell telemetry"
            className="p-1.5 bg-[#121528] hover:bg-[#1A1E38] text-gray-300 border border-[#202444] rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isCheckingHealth ? 'animate-spin text-[#615EFF]' : ''}`} />
          </button>

          {/* Clear Screen */}
          <button
            onClick={() => setExecutionLogs([])}
            className="px-2.5 py-1.5 bg-[#121528] hover:bg-[#1A1E38] text-xs text-gray-300 border border-[#202444] rounded-lg transition-colors cursor-pointer"
          >
            Clear Screen
          </button>

          {/* Jump to Navigation */}
          {onSelectTab && (
            <button
              onClick={() => onSelectTab('guardian-aegis')}
              className="px-2.5 py-1.5 bg-[#615EFF]/10 hover:bg-[#615EFF]/20 text-[#615EFF] border border-[#615EFF]/30 text-xs rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Governance</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Workspace & CWD Strip */}
      <div className="bg-[#090B16] border-b border-[#151728] px-4 py-2 flex flex-wrap items-center justify-between text-xs gap-2">
        <div className="flex items-center gap-2 text-gray-400">
          <Folder className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span className="text-gray-500">CWD:</span>
          <span className="text-white font-semibold bg-[#121528] px-2 py-0.5 rounded border border-[#1E2242]">
            {activeSession?.cwd || backendMeta.cwd || '/workspace'}
          </span>
          <button
            onClick={() => handleExecuteCommand('cd ~')}
            className="text-[11px] text-gray-400 hover:text-[#38BDF8] underline cursor-pointer ml-1"
          >
            cd ~
          </button>
          <button
            onClick={() => handleExecuteCommand('cd ..')}
            className="text-[11px] text-gray-400 hover:text-[#38BDF8] underline cursor-pointer"
          >
            cd ..
          </button>
        </div>

        {/* Quick Command Ribbon */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          <span className="text-gray-500 text-[11px]">Quick:</span>
          {quickCommands.slice(0, 4).map((qc, idx) => (
            <button
              key={idx}
              onClick={() => handleExecuteCommand(qc.cmd)}
              disabled={isExecuting}
              className="px-2 py-0.5 bg-[#121528] hover:bg-[#1C203E] text-gray-300 hover:text-white border border-[#1E2242] rounded text-[11px] transition-colors whitespace-nowrap cursor-pointer"
            >
              {qc.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Session Tabs */}
      <div className="bg-[#0B0D1B] border-b border-[#17192C] px-3 py-1.5 flex items-center justify-between gap-2 overflow-x-auto shrink-0">
        <div className="flex items-center gap-1.5">
          {sessions.map(s => {
            const isActive = s.id === activeSessionId;
            return (
              <div
                key={s.id}
                onClick={() => setActiveSessionId(s.id)}
                className={`px-3 py-1 text-xs rounded-md border flex items-center gap-2 cursor-pointer transition-all ${
                  isActive
                    ? 'bg-[#151833] text-white border-[#615EFF]/50 shadow-xs'
                    : 'bg-[#0E1020] text-gray-400 border-transparent hover:border-[#1E2242] hover:text-gray-200'
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-[#615EFF]' : 'bg-gray-600'}`} />
                <span className="font-medium truncate max-w-[120px]">{s.name}</span>
                {sessions.length > 1 && (
                  <button
                    onClick={(e) => handleDeleteSession(s.id, e)}
                    className="text-gray-500 hover:text-rose-400 p-0.5 rounded-xs"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
          <button
            onClick={handleCreateSession}
            title="Create new shell session"
            className="p-1 bg-[#121528] hover:bg-[#1A1E38] text-gray-400 hover:text-white border border-[#202444] rounded-md transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Filter / Search within terminal outputs */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2 top-2" />
            <input
              type="text"
              placeholder="Search output..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="bg-[#121528] border border-[#202444] text-xs text-gray-300 rounded-md pl-7 pr-2 py-1 w-36 focus:w-48 focus:border-[#615EFF] outline-none transition-all"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-[#615EFF]"
            />
            <span>Auto-scroll</span>
          </label>
        </div>
      </div>

      {/* 4. Terminal Output Screen */}
      <div
        ref={terminalScreenRef}
        className="flex-1 bg-[#05060D] p-4 overflow-y-auto font-mono text-sm leading-relaxed space-y-4 select-text"
      >
        {/* Terminal MOTD Banner */}
        <div className="p-3 bg-[#0C0E1F]/60 border border-[#1A1D36] rounded-lg text-xs space-y-1 text-gray-400">
          <div className="flex items-center justify-between">
            <span className="text-[#615EFF] font-bold">HERMES AGENTOS SHELL RUNTIME</span>
            <span className="text-gray-500">Autonomous Multi-Agent Sandbox</span>
          </div>
          <p className="text-gray-400">
            Real process execution connected to container shell. Commands are governed by Guardian Policy Sentinel and Aegis verification receipts.
          </p>
          <div className="flex flex-wrap gap-4 text-[11px] text-gray-500 pt-1 border-t border-[#16182E]">
            <span>Session: <strong className="text-gray-300">{activeSession?.name}</strong></span>
            <span>Policy: <strong className="text-emerald-400">Strict Guardian Aegis</strong></span>
            <span>Tasks Linked: <strong className="text-[#38BDF8]">{selectedTaskTitle}</strong></span>
          </div>
        </div>

        {/* Execution Log Stream */}
        {filteredLogs.length === 0 ? (
          <div className="py-12 text-center text-gray-500 text-xs">
            <TerminalIcon className="w-8 h-8 mx-auto mb-2 text-gray-600 opacity-50" />
            <p>No execution logs in this session. Type a shell command below or click a quick command.</p>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isSuccess = log.status === 'SUCCEEDED';
            const isBlocked = log.status === 'BLOCKED';
            const isApproval = log.status === 'APPROVAL_REQUIRED';
            const isRunning = log.status === 'RUNNING';

            return (
              <div
                key={log.id}
                className="p-3 bg-[#0A0C1A] border border-[#171A30] hover:border-[#252A4A] rounded-lg transition-colors text-xs space-y-2 group"
              >
                {/* Command Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#14172B] pb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-emerald-400 font-bold">$</span>
                    <span className="text-white font-semibold">{log.command}</span>
                    <span className="text-gray-500 text-[11px]">in {log.cwd}</span>
                  </div>

                  {/* Status & Actions */}
                  <div className="flex items-center gap-2">
                    {/* Status Badge */}
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 ${
                      isSuccess
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : isRunning
                          ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30 animate-pulse'
                          : isBlocked
                            ? 'bg-purple-500/10 text-purple-400 border border-purple-500/30'
                            : isApproval
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    }`}>
                      {isSuccess && <CheckCircle2 className="w-3 h-3" />}
                      {isRunning && <Clock className="w-3 h-3 animate-spin" />}
                      {isBlocked && <Lock className="w-3 h-3" />}
                      {isApproval && <AlertTriangle className="w-3 h-3" />}
                      {!isSuccess && !isRunning && !isBlocked && !isApproval && <XCircle className="w-3 h-3" />}
                      {log.status}
                    </span>

                    {/* Exit Code & Latency */}
                    {log.exitCode !== null && (
                      <span className="text-gray-500 text-[11px]">
                        code: {log.exitCode} ({log.durationMs}ms)
                      </span>
                    )}

                    {/* Copy Output Button */}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(log.stdout || log.stderr || '');
                        setCopiedId(log.id);
                        setTimeout(() => setCopiedId(null), 2000);
                      }}
                      title="Copy output"
                      className="p-1 text-gray-500 hover:text-gray-300 rounded cursor-pointer"
                    >
                      {copiedId === log.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>

                    {/* Save to Vault Action */}
                    <button
                      onClick={() => handleSaveToVault(log)}
                      title="Save output to Obsidian Vault memo"
                      className="px-2 py-0.5 bg-[#615EFF]/10 hover:bg-[#615EFF]/20 text-[#615EFF] border border-[#615EFF]/30 rounded text-[11px] flex items-center gap-1 cursor-pointer"
                    >
                      <Database className="w-3 h-3" />
                      <span>{savedVaultNoteId === log.id ? 'Saved!' : 'Save to Vault'}</span>
                    </button>
                  </div>
                </div>

                {/* STDOUT Block */}
                {log.stdout && (
                  <pre className="bg-[#05060D] p-2.5 rounded border border-[#131526] text-gray-200 text-xs overflow-x-auto whitespace-pre-wrap font-mono max-h-64">
                    {log.stdout}
                  </pre>
                )}

                {/* STDERR / Error Block */}
                {log.stderr && (
                  <pre className={`p-2.5 rounded border text-xs overflow-x-auto whitespace-pre-wrap font-mono ${
                    isBlocked || isApproval
                      ? 'bg-amber-950/20 text-amber-300 border-amber-500/30'
                      : 'bg-rose-950/20 text-rose-300 border-rose-500/30'
                  }`}>
                    {log.stderr}
                  </pre>
                )}
              </div>
            );
          })
        )}

        {/* Live Streaming indicator */}
        {isExecuting && (
          <div className="p-3 bg-[#0A0D20] border border-[#615EFF]/30 rounded-lg text-xs space-y-1 animate-pulse">
            <div className="flex items-center gap-2 text-[#615EFF]">
              <Clock className="w-4 h-4 animate-spin" />
              <span className="font-bold">EXECUTING:</span>
              <span className="text-white">{activeRunningCmd}</span>
            </div>
            <p className="text-gray-500 text-[11px]">Streamed process active. Streaming output to terminal buffer...</p>
          </div>
        )}
      </div>

      {/* 5. Command Input Prompt Bar */}
      <div className="bg-[#0B0D1C] border-t border-[#1A1D36] p-3 px-4 flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm shrink-0">
          <span>$</span>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isExecuting}
          placeholder={isExecuting ? "Executing command..." : "Type shell command (e.g. ls -la, node -v, git status, cd /path)..."}
          className="flex-1 bg-[#121528] border border-[#202444] focus:border-[#615EFF] text-white text-sm rounded-lg px-3 py-2 outline-none font-mono transition-all"
        />

        <button
          onClick={() => handleExecuteCommand()}
          disabled={isExecuting || !commandInput.trim()}
          className="px-4 py-2 bg-[#615EFF] hover:bg-[#504CE6] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg flex items-center gap-2 transition-colors cursor-pointer shrink-0"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Execute</span>
        </button>
      </div>

      {/* 6. Guardian Approval Intercept Modal */}
      {pendingApprovalRecord && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-[#0D0F22] border border-amber-500/50 rounded-xl max-w-lg w-full p-5 shadow-2xl space-y-4 font-mono">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-2 bg-amber-500/10 rounded-lg border border-amber-500/30">
                <AlertTriangle className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">GUARDIAN INTERCEPT: APPROVAL REQUIRED</h3>
                <span className="text-xs text-amber-400 font-semibold">High-Risk / Privileged Command Intercepted</span>
              </div>
            </div>

            <div className="space-y-2 text-xs text-gray-300">
              <p className="text-gray-400">
                The Guardian Policy Sentinel detected an operation requiring explicit human authorization:
              </p>
              <div className="bg-[#060812] p-3 rounded-lg border border-[#1E2242] space-y-1.5">
                <div className="flex items-center justify-between text-gray-500 text-[11px]">
                  <span>Command:</span>
                  <span className="text-amber-400 font-bold">RISK: {pendingApprovalRecord.riskLevel || 'CRITICAL'}</span>
                </div>
                <code className="text-white font-bold block overflow-x-auto text-sm">{pendingApprovalRecord.command}</code>
                <p className="text-gray-400 text-[11px] pt-1 border-t border-[#15172C]">
                  {pendingApprovalRecord.guardianWarning}
                </p>
                {pendingApprovalRecord.ruleCitation && (
                  <p className="text-[10px] text-gray-500">Citation: {pendingApprovalRecord.ruleCitation}</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setPendingApprovalRecord(null)}
                className="px-4 py-2 bg-[#14172E] hover:bg-[#1D2140] text-gray-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Reject & Abort
              </button>
              <button
                onClick={() => {
                  const cmd = pendingApprovalRecord.command;
                  setPendingApprovalRecord(null);
                  handleExecuteCommand(cmd, true);
                }}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black text-xs font-bold rounded-lg flex items-center gap-2 transition-colors cursor-pointer shadow-lg shadow-amber-500/20"
              >
                <Unlock className="w-4 h-4" />
                <span>Authorize & Execute</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
