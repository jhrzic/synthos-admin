import React, { useState } from 'react';
import { IdeaItem, AgentRole } from '../types';
import { 
  Lightbulb, Sparkles, Plus, ArrowRight, Tag, 
  Trash2, Filter, Search, CheckCircle2, TrendingUp, 
  Layers, ExternalLink, Compass, DollarSign, Users,
  BookOpen, Edit3, ArrowUpRight
} from 'lucide-react';

interface IdeaStrategyHubViewProps {
  ideas: IdeaItem[];
  onAddIdea: (idea: Omit<IdeaItem, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateIdea: (id: string, updates: Partial<IdeaItem>) => void;
  onDeleteIdea: (id: string) => void;
  onConvertToTask: (idea: IdeaItem) => void;
}

export const IdeaStrategyHubView: React.FC<IdeaStrategyHubViewProps> = ({
  ideas,
  onAddIdea,
  onUpdateIdea,
  onDeleteIdea,
  onConvertToTask
}) => {
  const [selectedDomain, setSelectedDomain] = useState<string>('all');
  const [selectedImpact, setSelectedImpact] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeIdea, setActiveIdea] = useState<IdeaItem | null>(ideas[0] || null);
  const [isCreating, setIsCreating] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // New Idea Form State
  const [newTitle, setNewTitle] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [newDomain, setNewDomain] = useState<IdeaItem['domain']>('Growth');
  const [newImpact, setNewImpact] = useState<IdeaItem['potentialImpact']>('High');
  const [newEffort, setNewEffort] = useState<IdeaItem['effortEstimate']>('Medium (1w)');
  const [newTags, setNewTags] = useState('');
  const [newAudience, setNewAudience] = useState('');
  const [newMonetization, setNewMonetization] = useState('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const filteredIdeas = ideas.filter(idea => {
    const matchesDomain = selectedDomain === 'all' || idea.domain === selectedDomain;
    const matchesImpact = selectedImpact === 'all' || idea.potentialImpact === selectedImpact;
    const matchesSearch = idea.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          idea.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          idea.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesDomain && matchesImpact && matchesSearch;
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    onAddIdea({
      title: newTitle,
      summary: newSummary,
      domain: newDomain,
      status: 'raw',
      potentialImpact: newImpact,
      effortEstimate: newEffort,
      tags: newTags.split(',').map(t => t.trim()).filter(Boolean),
      notes: [`Initial idea capture: ${newSummary}`],
      targetAudience: newAudience || 'General developers & early adopters',
      monetizationModel: newMonetization || 'Value-add feature or subscription tier',
      wikilinks: [`Strategy/${newTitle.replace(/\s+/g, '-')}`],
      authorAgent: 'reach'
    });

    setNewTitle('');
    setNewSummary('');
    setNewTags('');
    setNewAudience('');
    setNewMonetization('');
    setIsCreating(false);
    showToast('Strategic idea logged into backlog.');
  };

  const getImpactBadge = (impact: IdeaItem['potentialImpact']) => {
    switch (impact) {
      case 'Moonshot':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#EC4899]/15 text-[#EC4899] border border-[#EC4899]/30">🚀 MOONSHOT</span>;
      case 'High':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30">★ HIGH IMPACT</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/30">MEDIUM</span>;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0D0E1A] p-5 rounded-2xl border border-[#1E2238] shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#EAB308] to-[#EC4899] flex items-center justify-center shadow-lg shadow-[#EAB308]/25">
            <Lightbulb className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-tight">Idea Backlog & Strategy Hub</h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#EAB308]/15 text-[#EAB308] border border-[#EAB308]/30">
                PORTFOLIO
              </span>
            </div>
            <p className="text-xs text-[#9AA2C6] mt-0.5">
              Strategic hypotheses, monetization models, market whitespace detection, and task conversion.
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#615EFF] hover:bg-[#5653d9] text-white text-xs font-semibold rounded-xl shadow-lg shadow-[#615EFF]/20 transition active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>New Strategic Idea</span>
        </button>
      </div>

      {toastMessage && (
        <div className="p-3 bg-[#00D26A]/10 border border-[#00D26A]/30 rounded-xl text-xs text-[#00D26A] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: List & Filters */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-[#0D0E1A] border border-[#1E2238] p-3 rounded-xl space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#5F6589]" />
              <input
                type="text"
                placeholder="Search ideas, tags, domains..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-[#141628] border border-[#1E2238] rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              {['all', 'Growth', 'Infrastructure', 'Product', 'AI Core', 'Monetization'].map(domain => (
                <button
                  key={domain}
                  onClick={() => setSelectedDomain(domain)}
                  className={`px-2.5 py-1 rounded-lg font-mono text-[10px] uppercase transition ${
                    selectedDomain === domain ? 'bg-[#615EFF] text-white font-bold' : 'bg-[#141628] text-[#8E94B8] hover:text-white'
                  }`}
                >
                  {domain}
                </button>
              ))}
            </div>
          </div>

          {/* Ideas List */}
          <div className="space-y-2.5 max-h-[620px] overflow-y-auto pr-1">
            {filteredIdeas.map(idea => {
              const isSelected = activeIdea?.id === idea.id;
              return (
                <div
                  key={idea.id}
                  onClick={() => setActiveIdea(idea)}
                  className={`p-3.5 rounded-xl border transition cursor-pointer text-left ${
                    isSelected
                      ? 'bg-[#15172A] border-[#EAB308] shadow-lg shadow-[#EAB308]/10'
                      : 'bg-[#0D0E1A] border-[#1E2238] hover:border-[#2D3354] hover:bg-[#111324]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[10px] font-mono font-bold text-[#EAB308]">{idea.domain}</span>
                    {getImpactBadge(idea.potentialImpact)}
                  </div>

                  <h3 className="text-xs font-bold text-white leading-snug">
                    {idea.title}
                  </h3>
                  <p className="text-[11px] text-[#9AA2C6] line-clamp-2 mt-1 leading-relaxed">
                    {idea.summary}
                  </p>

                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#1C2035] text-[10px] text-[#8E94B8] font-mono">
                    <span>Effort: {idea.effortEstimate}</span>
                    <span className="text-[#A5A2FF] capitalize">{idea.status.replace('_', ' ')}</span>
                  </div>
                </div>
              );
            })}

            {filteredIdeas.length === 0 && (
              <div className="p-8 text-center bg-[#0D0E1A] border border-[#1E2238] rounded-xl text-[#5F6589] text-xs">
                No strategic ideas found in this filter.
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Detail & Conversion to Task */}
        <div className="lg:col-span-7">
          {activeIdea ? (
            <div className="bg-[#0D0E1A] border border-[#1E2238] rounded-2xl p-5 space-y-5">
              <div className="flex items-start justify-between gap-4 border-b border-[#1E2238] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-[#EAB308] px-2 py-0.5 bg-[#EAB308]/10 border border-[#EAB308]/30 rounded">
                      {activeIdea.domain}
                    </span>
                    {getImpactBadge(activeIdea.potentialImpact)}
                    <span className="text-xs text-[#8E94B8] font-mono">{activeIdea.effortEstimate}</span>
                  </div>
                  <h2 className="text-base font-bold text-white mt-2">
                    {activeIdea.title}
                  </h2>
                </div>

                <button
                  onClick={() => onDeleteIdea(activeIdea.id)}
                  className="p-1.5 text-[#8E94B8] hover:text-[#FF5E8E] hover:bg-[#FF5E8E]/10 rounded-lg transition"
                  title="Delete Idea"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Summary */}
              <div className="bg-[#121424] border border-[#1E2238] p-4 rounded-xl space-y-1.5">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#5F6589]">Executive Thesis & Summary</div>
                <p className="text-xs text-[#E2E8F0] leading-relaxed">
                  {activeIdea.summary}
                </p>
              </div>

              {/* Target Audience & Monetization Model */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="bg-[#121424] border border-[#1E2238] p-3.5 rounded-xl space-y-1.5">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#38BDF8] flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    <span>Target Audience (ICP)</span>
                  </div>
                  <p className="text-xs text-[#9AA2C6]">
                    {activeIdea.targetAudience || 'Early adopter engineers, founder networks'}
                  </p>
                </div>

                <div className="bg-[#121424] border border-[#1E2238] p-3.5 rounded-xl space-y-1.5">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#00D26A] flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>Monetization Model</span>
                  </div>
                  <p className="text-xs text-[#9AA2C6]">
                    {activeIdea.monetizationModel || 'Usage-based API tokens & enterprise license'}
                  </p>
                </div>
              </div>

              {/* Strategic Notes */}
              <div className="bg-[#121424] border border-[#1E2238] p-4 rounded-xl space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#A5A2FF] flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Strategic Notes & Observations</span>
                </div>
                <ul className="space-y-1.5 text-xs text-[#9AA2C6]">
                  {activeIdea.notes.map((note, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-[#EAB308]">•</span>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Tags & Wikilinks */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#1E2238]">
                <div className="flex flex-wrap gap-1.5">
                  {activeIdea.tags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 rounded bg-[#1C2035] text-[#8E94B8] text-[10px] font-mono border border-[#2D3354]">
                      #{tag}
                    </span>
                  ))}
                </div>

                <button
                  onClick={() => {
                    onConvertToTask(activeIdea);
                    showToast(`Idea converted to Kanban task in board.db!`);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#EAB308] to-[#EC4899] hover:opacity-90 text-white text-xs font-bold rounded-xl shadow-lg transition active:scale-95"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Convert to board.db Task</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-[#0D0E1A] border border-[#1E2238] rounded-2xl text-[#5F6589]">
              Select an idea from the list to view strategic breakdown and dispatch to Kanban.
            </div>
          )}
        </div>
      </div>

      {/* Modal: Create Strategic Idea */}
      {isCreating && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0D0E1A] border border-[#1E2238] rounded-2xl w-full max-w-xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-[#1E2238] pb-3">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-[#EAB308]" />
                <h3 className="text-sm font-bold text-white">Log Strategic Hypothesis</h3>
              </div>
              <button onClick={() => setIsCreating(false)} className="text-[#8E94B8] hover:text-white text-xs">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="e.g. Autonomous Local LLM Node Mesh"
                  required
                  className="w-full bg-[#141628] border border-[#1E2238] rounded-xl p-2.5 text-xs text-white placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Executive Summary</label>
                <textarea
                  value={newSummary}
                  onChange={e => setNewSummary(e.target.value)}
                  placeholder="Describe the opportunity, technical approach, and economic advantage..."
                  rows={3}
                  required
                  className="w-full bg-[#141628] border border-[#1E2238] rounded-xl p-2.5 text-xs text-white placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Domain</label>
                  <select
                    value={newDomain}
                    onChange={e => setNewDomain(e.target.value as IdeaItem['domain'])}
                    className="w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  >
                    <option value="Growth">Growth & GTM</option>
                    <option value="Infrastructure">Infrastructure</option>
                    <option value="Product">Product</option>
                    <option value="AI Core">AI Core</option>
                    <option value="Monetization">Monetization</option>
                    <option value="Research">Research</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Potential Impact</label>
                  <select
                    value={newImpact}
                    onChange={e => setNewImpact(e.target.value as IdeaItem['potentialImpact'])}
                    className="w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  >
                    <option value="High">High Impact</option>
                    <option value="Moonshot">Moonshot</option>
                    <option value="Medium">Medium</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Effort Estimate</label>
                  <select
                    value={newEffort}
                    onChange={e => setNewEffort(e.target.value as IdeaItem['effortEstimate'])}
                    className="w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  >
                    <option value="Small (1-2d)">Small (1-2d)</option>
                    <option value="Medium (1w)">Medium (1w)</option>
                    <option value="Large (2-4w)">Large (2-4w)</option>
                    <option value="Epic (Months)">Epic (Months)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Target Audience</label>
                  <input
                    type="text"
                    value={newAudience}
                    onChange={e => setNewAudience(e.target.value)}
                    placeholder="e.g. AI engineers, enterprise founders"
                    className="w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Tags (comma separated)</label>
                  <input
                    type="text"
                    value={newTags}
                    onChange={e => setNewTags(e.target.value)}
                    placeholder="e.g. mlx, apple-silicon, local"
                    className="w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#1E2238]">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-4 py-2 bg-[#1E2238] text-[#8E94B8] hover:text-white rounded-lg text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#615EFF] hover:bg-[#5653d9] text-white rounded-lg text-xs font-bold transition shadow-lg shadow-[#615EFF]/20"
                >
                  Save Idea
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
