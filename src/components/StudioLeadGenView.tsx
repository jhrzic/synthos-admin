import React, { useState } from 'react';
import { AgentInfo, AIModelInfo, KanbanTask } from '../types';
import { 
  Users, Target, Mail, ArrowRight, Sparkles, CheckCircle2, 
  Send, Database, Kanban, DollarSign, BarChart, FileText, 
  Layers, RefreshCw, Briefcase, Zap, Building2
} from 'lucide-react';

interface StudioLeadGenViewProps {
  agents: Record<string, AgentInfo>;
  models: Record<string, AIModelInfo>;
  onAddTaskToKanban: (task: Omit<KanbanTask, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onAddNoteToVault: (title: string, content: string, tags: string[], folder?: string) => void;
  onSendTelegramMessage?: (channel: string, text: string) => void;
  onSendQuery: (query: string, model: string) => Promise<string>;
  onSelectTab: (tab: any) => void;
}

interface LeadTarget {
  id: string;
  companyName: string;
  industry: string;
  estimatedBudget: string;
  leadScore: number;
  contactName: string;
  role: string;
  painPoint: string;
  status: 'Qualified' | 'Proposal Ready' | 'Negotiation' | 'Closed';
}

export const StudioLeadGenView: React.FC<StudioLeadGenViewProps> = ({
  agents,
  models,
  onAddTaskToKanban,
  onAddNoteToVault,
  onSendTelegramMessage,
  onSendQuery,
  onSelectTab,
}) => {
  const [leads, setLeads] = useState<LeadTarget[]>([
    {
      id: 'lead-1',
      companyName: 'Nexus Cloud Infrastructure',
      industry: 'Enterprise DevOps & Kubernetes',
      estimatedBudget: '$45,000 / mo',
      leadScore: 94,
      contactName: 'Sarah Jenkins',
      role: 'VP of Engineering',
      painPoint: 'LLM token inference waste and lack of persistent vector state sync across distributed engineer teams.',
      status: 'Qualified'
    },
    {
      id: 'lead-2',
      companyName: 'AeroSynth BioAI Labs',
      industry: 'Biotech & Genomics Research',
      estimatedBudget: '$80,000 / project',
      leadScore: 89,
      contactName: 'Dr. Michael Chang',
      role: 'Head of AI Research',
      painPoint: 'Requires multi-agent arXiv preprint synthesis with strict citation validation and Obsidian knowledge graph export.',
      status: 'Proposal Ready'
    },
    {
      id: 'lead-3',
      companyName: 'HyperScale Fintech',
      industry: 'Algorithmic Trading & Settlement',
      estimatedBudget: '$60,000 / mo',
      leadScore: 92,
      contactName: 'David Vance',
      role: 'Chief Technology Officer',
      painPoint: 'Needs sub-50ms deterministic model routing with Airbyte CDC and self-healing sandboxed test harnesses.',
      status: 'Qualified'
    }
  ]);

  const [selectedLead, setSelectedLead] = useState<LeadTarget>(leads[0]);
  const [proposalDraft, setProposalDraft] = useState<string>('');
  const [outreachSequence, setOutreachSequence] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleGenerateProposal = async () => {
    setIsGenerating(true);
    setNotice(`Reach and Orchestrator are formulating tailored proposal for ${selectedLead.companyName}...`);
    try {
      const prompt = `Formulate an elite Enterprise Studio Proposal for:\nClient: ${selectedLead.companyName} (${selectedLead.industry})\nContact: ${selectedLead.contactName} (${selectedLead.role})\nBudget: ${selectedLead.estimatedBudget}\nPain Point: ${selectedLead.painPoint}\nStructure with: 1. Executive Summary, 2. Technical Deliverables (Multi-Agent Swarm, Obsidian Graph, Custom Models), 3. Milestone Pricing & Timeline, 4. ROI Guarantee.`;
      const result = await onSendQuery(prompt, 'claude');
      setProposalDraft(result);
      setNotice('Proposal successfully formulated!');
      setTimeout(() => setNotice(null), 3000);
    } catch (e: any) {
      setProposalDraft(`# Enterprise Proposal: ${selectedLead.companyName}\n\n**Client Lead**: ${selectedLead.contactName} (${selectedLead.role})\n**Target Investment**: ${selectedLead.estimatedBudget}\n\n## 1. Core Problem Statement\n${selectedLead.painPoint}\n\n## 2. Technical Architecture & Deliverables\n- **Autonomous Hermes Swarm**: Dedicated micro-agent pods (Orchestrator, Dev, Scout, Analytics)\n- **Real-Time Knowledge Mesh**: Bi-directional Obsidian synchronization with sub-15ms vector CDC\n- **Deterministic Model Router**: OpenRouter dynamic fallback with token waste elimination\n\n## 3. Implementation Milestones\n- **Week 1-2**: Infrastructure sandbox & profile provisioning\n- **Week 3-4**: Multi-agent test harness & Telegram thread routing\n- **Week 5+**: Production deployment & telemetry monitoring`);
      setNotice('Proposal draft generated.');
      setTimeout(() => setNotice(null), 3000);
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePushToKanban = () => {
    onAddTaskToKanban({
      title: `Client Deliverable: ${selectedLead.companyName} (${selectedLead.estimatedBudget})`,
      description: `Execute enterprise studio onboarding for ${selectedLead.contactName}. Scope: ${selectedLead.painPoint}`,
      column: 'running',
      assignedAgent: 'reach',
      assignedModel: 'claude',
      priority: 'high',
      tags: ['Client', 'Studio', 'LeadGen', selectedLead.industry.split(' ')[0]],
      obsidianWikilinks: [`[[Clients/${selectedLead.companyName.replace(/\s+/g, '-')}]]`],
      subtasks: [
        { id: 'sub-1', title: 'Schedule Technical Architecture Review', completed: true },
        { id: 'sub-2', title: 'Deploy Sandbox Container in Dev Workspace', completed: false },
        { id: 'sub-3', title: 'Connect Obsidian Vault CDC Connector', completed: false }
      ]
    });
    setNotice(`Pushed ${selectedLead.companyName} to Kanban Board (board.db)!`);
    setTimeout(() => setNotice(null), 3000);
  };

  const handleSaveToObsidian = () => {
    if (!proposalDraft) return;
    const title = `Proposal-${selectedLead.companyName.replace(/\s+/g, '-')}`;
    onAddNoteToVault(title, proposalDraft, ['proposal', 'client', 'leadgen'], 'Client-Proposals');
    setNotice(`Saved proposal to Obsidian Vault /Client-Proposals!`);
    setTimeout(() => setNotice(null), 3000);
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-2 border-b border-[#1A1D2E] pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="airbyte-badge">
              HERMES STUDIO & ENTERPRISE LEAD GEN
            </span>
            <span className="text-xs font-mono text-[#00D26A] flex items-center gap-1">
              <Target className="w-3 h-3" />
              PIPELINE VALUE: $185,000 / MO
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-['Space_Grotesk']">
            Studio Client & Lead Gen Engine
          </h1>
          <p className="text-xs sm:text-sm text-[#8E94B8] mt-1">
            Automated enterprise lead qualification, bespoke SOW proposal generation, multi-stage cold outreach, and Kanban pipeline synchronization.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onSelectTab('kanban')}
            className="airbyte-btn-secondary px-4 py-2.5 text-xs font-semibold flex items-center gap-2"
          >
            <Kanban className="w-4 h-4 text-[#A5A2FF]" />
            <span>VIEW KANBAN (BOARD.DB)</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="p-3 bg-[#615EFF]/15 border border-[#615EFF]/40 rounded-xl text-xs font-mono text-[#A5A2FF] flex items-center gap-2 animate-fadeIn">
          <Sparkles className="w-4 h-4 text-[#615EFF] shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Lead Target Roster */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-mono font-bold uppercase text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[#615EFF]" />
              Enterprise Pipeline ({leads.length} Targets)
            </h2>
            <span className="text-[10px] font-mono text-[#00D26A]">REACH AGENT ACTIVE</span>
          </div>

          <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
            {leads.map((lead) => {
              const isSelected = lead.id === selectedLead.id;
              return (
                <div
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  className={`p-4 rounded-xl border transition cursor-pointer space-y-2.5 ${
                    isSelected
                      ? 'bg-[#181B34] border-[#615EFF] shadow-lg shadow-[#615EFF]/15'
                      : 'bg-[#0B0D1B] border-[#181B2E] hover:border-[#282D4E]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      {lead.companyName}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30">
                      {lead.estimatedBudget}
                    </span>
                  </div>

                  <div className="text-[11px] text-[#A5A2FF] font-mono">
                    {lead.contactName} • {lead.role}
                  </div>

                  <p className="text-xs text-[#8E94B8] line-clamp-2 leading-relaxed">
                    <strong>Pain:</strong> {lead.painPoint}
                  </p>

                  <div className="flex items-center justify-between pt-1 border-t border-[#1E223D]/50 text-[10px] font-mono">
                    <span className="text-[#8E94B8]">{lead.industry}</span>
                    <span className="text-[#EC4899] font-bold">Score: {lead.leadScore}/100</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Bespoke Proposal & SOW Studio */}
        <div className="lg:col-span-7 space-y-4">
          <div className="airbyte-card p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1A1D30] pb-4">
              <div>
                <h3 className="text-base font-bold text-white font-['Space_Grotesk']">
                  Bespoke Studio Proposal & Scope Builder
                </h3>
                <p className="text-xs text-[#8E94B8] mt-0.5">
                  Client: <strong className="text-white">{selectedLead.companyName}</strong> ({selectedLead.estimatedBudget})
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerateProposal}
                  disabled={isGenerating}
                  className="airbyte-btn-primary px-3.5 py-1.5 text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-[#615EFF]/25"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isGenerating ? 'BUILDING...' : 'GENERATE SOW'}</span>
                </button>
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-mono text-[#8E94B8]">
                Lead Contact: <span className="text-white font-bold">{selectedLead.contactName}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handlePushToKanban}
                  className="p-2 rounded-lg bg-[#14172B] hover:bg-[#1E2342] text-xs text-[#A5A2FF] border border-[#252A4E] flex items-center gap-1.5 transition font-mono"
                >
                  <Kanban className="w-3.5 h-3.5" />
                  <span>PUSH TO KANBAN</span>
                </button>

                <button
                  onClick={handleSaveToObsidian}
                  disabled={!proposalDraft}
                  className="p-2 rounded-lg bg-[#14172B] hover:bg-[#1E2342] text-xs text-[#00D26A] border border-[#252A4E] flex items-center gap-1.5 transition font-mono"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>SAVE TO VAULT</span>
                </button>
              </div>
            </div>

            <textarea
              value={proposalDraft}
              onChange={(e) => setProposalDraft(e.target.value)}
              placeholder="Click 'Generate SOW' to assemble a complete multi-agent proposal..."
              rows={14}
              className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-4 text-xs font-mono text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF] leading-relaxed"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
