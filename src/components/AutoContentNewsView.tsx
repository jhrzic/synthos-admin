import React, { useState } from 'react';
import { AgentInfo, AIModelInfo, ObsidianNote } from '../types';
import { 
  Newspaper, Sparkles, Globe, Send, Share2, Copy, CheckCircle2, 
  ExternalLink, ArrowRight, RefreshCw, FileText, Database, MessageSquare,
  TrendingUp, Flame, Radio, Clock, Eye, Layers
} from 'lucide-react';

interface AutoContentNewsViewProps {
  agents: Record<string, AgentInfo>;
  models: Record<string, AIModelInfo>;
  onAddNoteToVault: (title: string, content: string, tags: string[], folder?: string) => void;
  onSendTelegramMessage?: (channel: string, text: string) => void;
  onSendQuery: (query: string, model: string) => Promise<string>;
  onSelectTab: (tab: any) => void;
}

interface NewsItem {
  id: string;
  source: 'ProductHunt' | 'arXiv' | 'HackerNews' | 'GitHub Trending' | 'TechCrunch';
  title: string;
  url: string;
  summary: string;
  timeAgo: string;
  category: string;
  upvotes: number;
  tags: string[];
}

export const AutoContentNewsView: React.FC<AutoContentNewsViewProps> = ({
  agents,
  models,
  onAddNoteToVault,
  onSendTelegramMessage,
  onSendQuery,
  onSelectTab,
}) => {
  // Four invented stories, each with a plausible but fabricated citation —
  // an arXiv abstract id, a HackerNews item id, a Product Hunt slug and a
  // GitHub repo — plus invented upvote counts and "18 mins ago" timestamps.
  // No feed, crawler or search provider is connected to this build, so none
  // of it was harvested. Fabricated citations are the worst case of this bug
  // class: they are indistinguishable from real sources by eye, and this
  // screen feeds the selected item into a real model call whose output is
  // saved to the Brain.
  const [newsFeed, setNewsFeed] = useState<NewsItem[]>([]);

  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [contentFormat, setContentFormat] = useState<'substack' | 'twitter' | 'linkedin' | 'obsidian'>('substack');
  const [targetModel, setTargetModel] = useState<string>('claude');
  const [generatedDraft, setGeneratedDraft] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const handleGenerateContent = async () => {
    if (!selectedNews) return;
    setIsGenerating(true);
    setStatusNotice(`Scout and Scribe are synthesizing ${contentFormat.toUpperCase()} with ${targetModel.toUpperCase()}...`);
    try {
      let prompt = '';
      if (contentFormat === 'substack') {
        prompt = `Draft a high-signal 3-paragraph Tech Substack analysis of this breaking story:\nTitle: ${selectedNews.title}\nSource: ${selectedNews.source}\nSummary: ${selectedNews.summary}\nInclude market implications, architectural breakdown, and actionable developer takeaways.`;
      } else if (contentFormat === 'twitter') {
        prompt = `Draft a viral 4-tweet Twitter/X hook thread about this AI development:\nTitle: ${selectedNews.title}\nSummary: ${selectedNews.summary}\nUse compelling data points, short punchy lines, and a closing CTA.`;
      } else if (contentFormat === 'linkedin') {
        prompt = `Draft an executive thought leadership LinkedIn post based on:\nTitle: ${selectedNews.title}\nSummary: ${selectedNews.summary}\nFocus on enterprise ROI, developer productivity, and next-gen multi-agent systems.`;
      } else {
        prompt = `Create a formal Obsidian Investment & Research Memo in pristine Markdown with [[wikilinks]] for:\nTitle: ${selectedNews.title}\nCategory: ${selectedNews.category}\nSummary: ${selectedNews.summary}`;
      }

      const result = await onSendQuery(prompt, targetModel);
      setGeneratedDraft(result);
      setStatusNotice('Draft generated successfully!');
      setTimeout(() => setStatusNotice(null), 3000);
    } catch (e: any) {
      setGeneratedDraft(`### ${selectedNews.title}\n\n**Executive Synthesis**:\nThe rapid maturation of ${selectedNews.category} represents a structural shift in autonomous systems.\n\n- **Core Breakthrough**: ${selectedNews.summary}\n- **Market Impact**: Eliminates redundant compute cycles while accelerating time-to-market.\n- **Recommended Action**: Pilot test within Hermes Dev Sandbox and link findings to [[${selectedNews.title.replace(/\s+/g, '-')}]]\n\n#hermes #autocontent #${selectedNews.source.toLowerCase()}`);
      setStatusNotice('Local draft generated.');
      setTimeout(() => setStatusNotice(null), 3000);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyDraft = () => {
    if (!generatedDraft) return;
    navigator.clipboard.writeText(generatedDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveToObsidian = () => {
    if (!generatedDraft || !selectedNews) return;
    const title = `AutoContent-${selectedNews.source}-${new Date().toISOString().slice(0, 10)}`;
    onAddNoteToVault(title, generatedDraft, ['autocontent', selectedNews.source.toLowerCase(), contentFormat], 'Content-Drafts');
    setStatusNotice('Saved directly to Obsidian Vault /Content-Drafts!');
    setTimeout(() => setStatusNotice(null), 3000);
  };

  const handleDispatchTelegram = () => {
    if (!generatedDraft || !onSendTelegramMessage) return;
    onSendTelegramMessage('104', `[AutoContent Dispatch (${contentFormat.toUpperCase()})]:\n\n${generatedDraft.slice(0, 400)}...`);
    setStatusNotice('Dispatched to Telegram #reach-growth (Thread 104)!');
    setTimeout(() => setStatusNotice(null), 3000);
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Top Title Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-2 border-b border-[#1A1D2E] pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="airbyte-badge">
              HERMES AUTO-CONTENT & NEWS PIPELINE
            </span>
            <span className="text-xs font-mono text-[#7E8BB5] flex items-center gap-1">
              <Radio className="w-3 h-3" />
              NO FEED CONNECTED
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-['Space_Grotesk']">
            Auto-Content & Breaking Tech Harvester
          </h1>
          <p className="text-xs sm:text-sm text-[#8E94B8] mt-1">
            Intelligence harvesting across arXiv, Product Hunt, HackerNews and GitHub trending, with
            one-click synthesis into Substack essays, threads and Brain notes. No feed is connected to this
            build yet, so no signals have been harvested.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              // This used to wait a second and report "4 new breaking stories
              // ingested" — a fixed number, with no feed contacted and no
              // story added.
              setStatusNotice(
                'NOT_CONFIGURED — no news source is connected. arXiv, Product Hunt, HackerNews and GitHub '
                + 'trending are not wired to this build, so there is nothing to refresh and no story was '
                + 'ingested.',
              );
            }}
            className="airbyte-btn-secondary px-4 py-2.5 text-xs font-semibold flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4 text-[#A5A2FF]" />
            <span>REFRESH FEEDS</span>
          </button>
        </div>
      </div>

      {statusNotice && (
        <div className="p-3 bg-[#615EFF]/15 border border-[#615EFF]/40 rounded-xl text-xs font-mono text-[#A5A2FF] flex items-center gap-2 animate-fadeIn">
          <Sparkles className="w-4 h-4 text-[#615EFF] shrink-0" />
          <span>{statusNotice}</span>
        </div>
      )}

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: News Feeds */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-mono font-bold uppercase text-white flex items-center gap-2">
              <Flame className="w-4 h-4 text-[#FF5E8E]" />
              Harvested Intelligence Signals ({newsFeed.length})
            </h2>
            <span className="text-[10px] font-mono text-[#7E8BB5]">HARVESTER NOT CONFIGURED</span>
          </div>

          <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
            {newsFeed.length === 0 && (
              <div
                data-testid="news-feed-empty-state"
                className="rounded-xl border border-dashed border-[#181B2E] bg-[#0B0D1B] px-4 py-8 text-center"
              >
                <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#7E8BB5]">
                  No signals harvested — UNKNOWN
                </p>
                <p className="mx-auto mt-2 max-w-sm text-[11px] leading-relaxed text-[#6A7196]">
                  No news feed, crawler or search provider is connected to this build. Sources, upvote
                  counts and publication times stay unknown until one is, rather than being filled with
                  example stories.
                </p>
              </div>
            )}
            {newsFeed.map((item) => {
              const isSelected = item.id === selectedNews?.id;
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedNews(item)}
                  className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${
                    isSelected
                      ? 'bg-[#181B34] border-[#615EFF] shadow-lg shadow-[#615EFF]/15'
                      : 'bg-[#0B0D1B] border-[#181B2E] hover:border-[#282D4E]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#615EFF]/20 text-[#A5A2FF] border border-[#615EFF]/30">
                      {item.source}
                    </span>
                    <span className="text-[10px] font-mono text-[#6E759D] flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {item.timeAgo}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-white leading-snug">
                    {item.title}
                  </h3>

                  <p className="text-xs text-[#8E94B8] line-clamp-2 leading-relaxed">
                    {item.summary}
                  </p>

                  <div className="flex items-center justify-between pt-1 border-t border-[#1E223D]/50 text-[10px] font-mono">
                    <span className="text-[#00D26A]">▲ {item.upvotes} Upvotes</span>
                    <span className="text-[#A5A2FF] flex items-center gap-1 hover:underline" onClick={(e) => { e.stopPropagation(); window.open(item.url, '_blank'); }}>
                      Source <ExternalLink className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: AI Multi-Format Generation Studio */}
        <div className="lg:col-span-7 space-y-4">
          <div className="airbyte-card p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1A1D30] pb-4">
              <div>
                <h3 className="text-base font-bold text-white font-['Space_Grotesk']">
                  Multi-Format Content Synthesizer
                </h3>
                <p className="text-xs text-[#8E94B8] mt-0.5">
                  {selectedNews ? (
                    <>Transforming: <strong className="text-white">{selectedNews.title}</strong></>
                  ) : (
                    <span className="text-[#7E8BB5]">No signal selected — nothing to transform.</span>
                  )}
                </p>
              </div>

              {/* Format Switcher */}
              <div className="flex items-center gap-1 p-1 bg-[#05060B] border border-[#1E223D] rounded-xl">
                {(['substack', 'twitter', 'linkedin', 'obsidian'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setContentFormat(fmt)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold uppercase transition ${
                      contentFormat === fmt
                        ? 'bg-[#615EFF] text-white shadow'
                        : 'text-[#8E94B8] hover:text-white'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            {/* Model Selector & Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-[#8E94B8]">Inference Model:</span>
                <select
                  value={targetModel}
                  onChange={(e) => setTargetModel(e.target.value)}
                  className="bg-[#05060B] border border-[#1E223D] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                >
                  <option value="claude">Claude 3.7 Sonnet (Hybrid CoT)</option>
                  <option value="chatgpt">ChatGPT o3 (Viral Distribution)</option>
                  <option value="deepseek">DeepSeek R1 (Deep Tech Analysis)</option>
                  <option value="perplexity">Perplexity (Grounded Research)</option>
                  <option value="kimi3">Kimi 3 (Long Context Digest)</option>
                </select>
              </div>

              <button
                onClick={handleGenerateContent}
                disabled={isGenerating || !selectedNews}
                className="airbyte-btn-primary px-4 py-2 text-xs font-bold flex items-center gap-2 shadow-lg shadow-[#615EFF]/25"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isGenerating ? 'SYNTHESIZING...' : 'GENERATE DRAFT'}</span>
              </button>
            </div>

            {/* Output Editor / Preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-mono text-[#8E94B8] uppercase">Generated {contentFormat.toUpperCase()} Draft</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyDraft}
                    disabled={!generatedDraft}
                    className="p-1.5 rounded-lg bg-[#14172B] hover:bg-[#1E2342] text-xs text-[#A5A2FF] border border-[#252A4E] flex items-center gap-1 transition"
                  >
                    {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-[#00D26A]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'COPIED' : 'COPY'}</span>
                  </button>

                  <button
                    onClick={handleSaveToObsidian}
                    disabled={!generatedDraft}
                    className="p-1.5 rounded-lg bg-[#14172B] hover:bg-[#1E2342] text-xs text-[#00D26A] border border-[#252A4E] flex items-center gap-1 transition"
                  >
                    <Database className="w-3.5 h-3.5" />
                    <span>SAVE TO VAULT</span>
                  </button>

                  <button
                    onClick={handleDispatchTelegram}
                    disabled={!generatedDraft}
                    className="p-1.5 rounded-lg bg-[#14172B] hover:bg-[#1E2342] text-xs text-[#FF5E8E] border border-[#252A4E] flex items-center gap-1 transition"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>POST TO TELEGRAM</span>
                  </button>
                </div>
              </div>

              <textarea
                value={generatedDraft}
                onChange={(e) => setGeneratedDraft(e.target.value)}
                placeholder="Click 'Generate Draft' to harvest intelligence and draft structured content..."
                rows={12}
                className="w-full bg-[#05060B] border border-[#1E223D] rounded-xl p-4 text-xs font-mono text-white placeholder-[#53597D] focus:outline-none focus:border-[#615EFF] leading-relaxed"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
