import React, { useState } from 'react';
import { ScrapedNurseryLead, AIModelInfo } from '../types';
import { 
  Search, Globe, Database, Sparkles, Terminal, Copy, Check, 
  ArrowRight, ExternalLink, RefreshCw, Layers, CheckCircle2, 
  MapPin, Phone, Instagram, Star, Send, ShieldCheck, Download
} from 'lucide-react';

interface LeadScraperViewProps {
  models: Record<string, AIModelInfo>;
  onAddNoteToVault: (title: string, content: string, tags: string[], folder?: string) => void;
  onAddTaskToKanban?: (title: string, description: string, agent: any, model: string) => void;
  onLogEvent?: (level: 'info' | 'warn' | 'success' | 'agent' | 'error', source: string, message: string) => void;
}

export const LeadScraperView: React.FC<LeadScraperViewProps> = ({
  models,
  onAddNoteToVault,
  onAddTaskToKanban,
  onLogEvent,
}) => {
  const [city, setCity] = useState('New York');
  const [state, setState] = useState('NY');
  const [keyword, setKeyword] = useState('plant nursery boutique');
  const [syncedLeadIds, setSyncedLeadIds] = useState<Set<string>>(new Set());

  // Scraped Leads State
  // No scraper backend exists in this build, so nothing has been harvested.
  // This list was seeded with four real businesses — real phone numbers,
  // addresses and emails — carrying invented ratings, review counts and sync
  // flags, presented as scraper output. An empty list is the true state.
  const [leads, setLeads] = useState<ScrapedNurseryLead[]>([]);
  const [scraperNotice, setScraperNotice] = useState<string | null>(null);

  // This used to wait 1.5s and invent a lead — a fabricated business name
  // built from the city field, a hardcoded phone number, a rating of 4.9 and
  // 178 reviews — then log "Harvested new lead" to the real event log at
  // level `success`. No crawler, no Playwright, no network call. The file it
  // claims to run (scripts/nurseryScraper.ts) has never existed in this repo.
  //
  // A button that cannot do its job says so.
  const handleRunPlaywrightScraper = () => {
    setScraperNotice(
      'NOT_CONFIGURED — no scraper backend is connected to this build. No crawler, directory API or '
      + 'enrichment provider is configured, so no leads can be harvested. Nothing was run and no lead '
      + 'was recorded.',
    );
    if (onLogEvent) {
      onLogEvent(
        'warn',
        'Lead-Scraper',
        `Scrape requested for "${keyword}" in ${city}, ${state} — refused: no scraper backend configured.`,
      );
    }
  };

  const handleSyncToObsidian = (lead: ScrapedNurseryLead) => {
    const title = `Lead-${lead.name.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const content = `# Directory Lead: ${lead.name}
**Location:** ${lead.address}
**Phone:** ${lead.phone}
**Website:** [${lead.website}](${lead.website})
**Instagram:** ${lead.instagramHandle || 'N/A'}
**Rating:** ⭐ ${lead.rating} (${lead.reviewsCount} reviews)
**Specialty:** ${lead.specialty}

## Outreach Strategy
- [[Outreach-Templates/WhatsApp-Bot-Introduction]]
- Target phone: \`${lead.phone}\`
- Hermes Agent: **Reach** (Growth & Viral Loop Architect)
`;

    onAddNoteToVault(title, content, ['directory-leads', 'nursery', lead.city.toLowerCase()], 'Directory-Leads');
    setSyncedLeadIds(prev => new Set(prev).add(lead.id));
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, syncedToObsidian: true } : l));
    if (onLogEvent) {
      onLogEvent('success', 'Obsidian-Vault', `Synchronized [[${title}]] into user vault.`);
    }
  };

  const handlePushToKanban = (lead: ScrapedNurseryLead) => {
    if (onAddTaskToKanban) {
      onAddTaskToKanban(
        `Outreach to ${lead.name} (${lead.city})`,
        `Engage lead at ${lead.phone} / ${lead.email}. Propose automated plant care bot integration and affiliate listing.`,
        'reach',
        'Nous Hermes 3'
      );
    }
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, syncedToKanban: true } : l));
    if (onLogEvent) {
      onLogEvent('success', 'Kanban-board.db', `Created Kanban directive for ${lead.name}`);
    }
  };

  return (
    <div className="space-y-8 pb-16 max-w-7xl mx-auto px-4 font-mono">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-4 border-b border-[#1A1D2E] pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="bg-[#20B2AA]/20 text-[#20B2AA] border border-[#20B2AA]/40 text-[11px] font-bold px-2.5 py-0.5 rounded-full">
              PLAYWRIGHT · CRAWL4AI · FIRECRAWL MCP PIPELINE
            </span>
            <span className="bg-[#615EFF]/15 text-[#A5A2FF] border border-[#615EFF]/30 text-[10px] font-bold px-2 py-0.5 rounded-full">
              LEAD HARVESTER &amp; ENRICHMENT
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-sans">
            Web Scraping &amp; Local Lead Enrichment
          </h1>
          <p className="text-xs sm:text-sm text-[#8E94B8] mt-1 font-sans">
            Directory lead capture, enrichment and sync into the Brain and Kanban. No crawler or directory
            provider is connected to this build yet.
          </p>
        </div>

        <button
          onClick={handleRunPlaywrightScraper}
          className="px-5 py-2.5 bg-[#20B2AA] hover:bg-[#1CA29A] text-black font-bold rounded-xl text-xs flex items-center gap-2 transition shadow-lg shadow-[#20B2AA]/20"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Execute Scraper Pipeline</span>
        </button>
      </div>

      {scraperNotice && (
        <div
          data-testid="scraper-not-configured-notice"
          className="flex items-start gap-3 rounded-2xl border border-[#7E8BB5]/25 bg-[#7E8BB5]/[0.06] px-4 py-3 text-[11px] leading-relaxed text-[#9C97B4]"
        >
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#7E8BB5]" />
          <span>{scraperNotice}</span>
        </div>
      )}

      {/* Scraper Query & Parameters Bar */}
      <div className="bg-[#090B18] border border-[#1A1D34] rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-[#20B2AA]" />
            Scraper Targeting Parameters
          </span>
          <span className="text-[10px] font-bold text-[#7E8BB5]">NO SCRAPER BACKEND CONFIGURED</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-[#8E94B8]">Search Keyword</label>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full bg-[#05060C] border border-[#1A1D34] text-white px-3 py-2 rounded-xl text-xs font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-[#8E94B8]">Target City</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full bg-[#05060C] border border-[#1A1D34] text-white px-3 py-2 rounded-xl text-xs font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-[#8E94B8]">State / Region</label>
            <input
              type="text"
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="w-full bg-[#05060C] border border-[#1A1D34] text-white px-3 py-2 rounded-xl text-xs font-mono"
            />
          </div>
        </div>
      </div>

      {/* Scraped Leads Table */}
      <div className="bg-[#090B18] border border-[#1A1D34] rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">
            Enriched Directory Leads ({leads.length})
          </h2>
          <span className="text-xs font-bold text-[#7E8BB5] bg-[#7E8BB5]/10 px-2.5 py-0.5 rounded-full border border-[#7E8BB5]/30">
            {leads.length > 0 ? 'MANUALLY ENTERED' : 'NO SOURCE CONNECTED'}
          </span>
        </div>

        {leads.length === 0 && (
          <div
            data-testid="leads-empty-state"
            className="rounded-2xl border border-dashed border-[#1A1D34] bg-[#05060C] px-5 py-8 text-center"
          >
            <p className="text-xs font-bold uppercase tracking-wider text-[#7E8BB5]">No leads — UNKNOWN</p>
            <p className="mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-[#6A7196]">
              No crawler, directory API or enrichment provider is connected, so this build has harvested
              nothing. This table stays empty until a real source is configured.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {leads.map((lead) => (
            <div 
              key={lead.id}
              className="p-5 bg-[#05060C] rounded-2xl border border-[#161828] hover:border-[#282E54] transition space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    {lead.name}
                    <span className="text-xs text-[#F59E0B] flex items-center gap-0.5 font-normal">
                      <Star className="w-3 h-3 fill-[#F59E0B]" />
                      {lead.rating} ({lead.reviewsCount})
                    </span>
                  </h3>
                  <div className="flex items-center gap-3 text-xs text-[#7A82A6] mt-0.5">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-[#20B2AA]" />
                      {lead.address}
                    </span>
                    <span className="flex items-center gap-1 text-[#38BDF8]">
                      <Phone className="w-3 h-3" />
                      {lead.phone}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSyncToObsidian(lead)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition border ${
                      lead.syncedToObsidian || syncedLeadIds.has(lead.id)
                        ? 'bg-[#8B5CF6]/20 text-[#8B5CF6] border-[#8B5CF6]/40'
                        : 'bg-[#121426] hover:bg-[#1B1E38] text-white border-[#242A4C]'
                    }`}
                  >
                    <Database className="w-3 h-3" />
                    <span>{lead.syncedToObsidian || syncedLeadIds.has(lead.id) ? 'Synced to Vault' : 'Sync to Obsidian'}</span>
                  </button>

                  <button
                    onClick={() => handlePushToKanban(lead)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition border ${
                      lead.syncedToKanban
                        ? 'bg-[#00D26A]/20 text-[#00D26A] border-[#00D26A]/40'
                        : 'bg-[#121426] hover:bg-[#1B1E38] text-white border-[#242A4C]'
                    }`}
                  >
                    <Layers className="w-3 h-3" />
                    <span>{lead.syncedToKanban ? 'In Kanban' : 'Push to Kanban'}</span>
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t border-[#121422] flex items-center justify-between text-xs text-[#6A7196]">
                <span>Specialty: <strong className="text-[#E2E8F0]">{lead.specialty}</strong></span>
                <div className="flex items-center gap-3">
                  <a href={lead.website} target="_blank" rel="noreferrer" className="text-[#38BDF8] hover:underline flex items-center gap-1">
                    <span>{lead.website}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  {lead.instagramHandle && (
                    <span className="text-[#EC4899]">{lead.instagramHandle}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
