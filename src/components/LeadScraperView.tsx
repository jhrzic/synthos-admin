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
  const [isScraping, setIsScraping] = useState(false);
  const [syncedLeadIds, setSyncedLeadIds] = useState<Set<string>>(new Set());

  // Scraped Leads State
  const [leads, setLeads] = useState<ScrapedNurseryLead[]>([
    {
      id: 'lead-1',
      name: 'Urban Garden Center NYC',
      website: 'https://urbangardennyc.com',
      phone: '(646) 941-9454',
      address: '1640 Park Ave, New York, NY 10035',
      city: 'New York',
      state: 'NY',
      instagramHandle: '@urbangardennyc',
      email: 'contact@urbangardennyc.com',
      rating: 4.8,
      reviewsCount: 342,
      specialty: 'Rare Aroids, Terrariums & Tropical Foliage',
      syncedToObsidian: true,
      syncedToKanban: true,
    },
    {
      id: 'lead-2',
      name: 'Dahing Plants Chinatown',
      website: 'https://dahingplants.com',
      phone: '(212) 226-9078',
      address: '289 Grand St, New York, NY 10002',
      city: 'New York',
      state: 'NY',
      instagramHandle: '@dahingplants',
      email: 'hello@dahingplants.com',
      rating: 4.9,
      reviewsCount: 512,
      specialty: 'Bonsai Trees, Monsteras, Exotic Succulents',
      syncedToObsidian: true,
      syncedToKanban: false,
    },
    {
      id: 'lead-3',
      name: 'The Sill Upper West Side',
      website: 'https://thesill.com',
      phone: '(646) 895-9292',
      address: '448 Amsterdam Ave, New York, NY 10024',
      city: 'New York',
      state: 'NY',
      instagramHandle: '@thesill',
      email: 'care@thesill.com',
      rating: 4.7,
      reviewsCount: 890,
      specialty: 'Direct-to-Consumer Potted Houseplants & Workshops',
      syncedToObsidian: false,
      syncedToKanban: false,
    },
    {
      id: 'lead-4',
      name: 'Greenery Unlimited Brooklyn',
      website: 'https://greeneryunlimited.co',
      phone: '(718) 782-0108',
      address: '91 Franklin St, Brooklyn, NY 11222',
      city: 'Brooklyn',
      state: 'NY',
      instagramHandle: '@greeneryunlimited',
      email: 'design@greeneryunlimited.co',
      rating: 4.9,
      reviewsCount: 280,
      specialty: 'Biophilic Design, Living Walls & Botanical Art',
      syncedToObsidian: false,
      syncedToKanban: false,
    },
  ]);

  const handleRunPlaywrightScraper = () => {
    setIsScraping(true);
    setTimeout(() => {
      const newLead: ScrapedNurseryLead = {
        id: `lead-${Date.now()}`,
        name: `${city} Botanics & Flora Co.`,
        website: `https://${city.toLowerCase().replace(/\s+/g, '')}botanics.com`,
        phone: '(646) 941-9454',
        address: `120 Broadway Suite 400, ${city}, ${state}`,
        city: city,
        state: state,
        instagramHandle: `@${city.toLowerCase().replace(/\s+/g, '')}plants`,
        email: `info@${city.toLowerCase().replace(/\s+/g, '')}botanics.com`,
        rating: 4.9,
        reviewsCount: 178,
        specialty: 'Custom Botanical Installations & Rare Cultivars',
        syncedToObsidian: false,
        syncedToKanban: false,
      };

      setLeads(prev => [newLead, ...prev]);
      setIsScraping(false);
      if (onLogEvent) {
        onLogEvent('success', 'Playwright-Scraper', `Harvested new lead: ${newLead.name} in ${city}, ${state}`);
      }
    }, 1500);
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
            Automated Google Maps crawler parsing botanical nurseries, contact phone numbers (<span className="text-[#38BDF8] font-bold">646-941-9454</span>), and syncing into Obsidian &amp; Kanban.
          </p>
        </div>

        <button
          onClick={handleRunPlaywrightScraper}
          disabled={isScraping}
          className="px-5 py-2.5 bg-[#20B2AA] hover:bg-[#1CA29A] text-black font-bold rounded-xl text-xs flex items-center gap-2 transition shadow-lg shadow-[#20B2AA]/20 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isScraping ? 'animate-spin' : ''}`} />
          <span>{isScraping ? 'Crawling Maps...' : 'Execute Scraper Pipeline'}</span>
        </button>
      </div>

      {/* Scraper Query & Parameters Bar */}
      <div className="bg-[#090B18] border border-[#1A1D34] rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-[#20B2AA]" />
            Scraper Targeting Parameters (scripts/nurseryScraper.ts)
          </span>
          <span className="text-[10px] text-[#6A7196]">Headless Chromium Driver</span>
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
          <span className="text-xs text-[#00D26A] bg-[#00D26A]/10 px-2.5 py-0.5 rounded-full border border-[#00D26A]/30">
            AUTO-ENRICHED
          </span>
        </div>

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
