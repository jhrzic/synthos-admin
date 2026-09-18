// ---------------------------------------------------------------------------
// Public "Are you visible in AI answers?" check — the free top of the audit
// funnel (free snapshot → $99 micro-audit → $995 full audit → managed service,
// per marketing-aeo-geo-directory-listing/synthos_us_pricing_benchmarks).
//
// Anonymous, so it is deliberately small and capped:
//   - 3 grounded Gemini questions per check, each spend-guarded;
//   - per-IP: 3 checks a day; global: PUBLIC_CHECK_DAILY_CAP (default 150);
//   - no website crawl, no stored personal data; the result is not persisted.
// Same truth rules as the analyzer: frequencies from queries that ran, never a
// rank, never a claim without a query.
// ---------------------------------------------------------------------------

import type { Express, Request, Response, RequestHandler } from 'express';
import { previewRoutedCall } from '../fabric/routed-call';
import { GEO_PINNED_MODEL, askGrounded, isSourceHost, runGeoProbe } from './geo-probe';

const PER_IP_PER_DAY = 3;
const QUESTIONS = 3;

const used = new Map<string, { day: string; n: number }>();
let global = { day: '', n: 0 };

const today = () => new Date().toISOString().slice(0, 10);

/** Pure: per-IP and global daily caps. Returns the reason a check is refused, or null. */
export function capReason(ip: string, dailyCap: number): string | null {
  const d = today();
  if (global.day !== d) global = { day: d, n: 0 };
  if (global.n >= dailyCap) return 'The free check is busy today. Try again tomorrow.';
  const u = used.get(ip);
  if (u && u.day === d && u.n >= PER_IP_PER_DAY) return 'You have used today’s free checks. Try again tomorrow.';
  return null;
}

function consume(ip: string): void {
  const d = today();
  global.n++;
  const u = used.get(ip);
  used.set(ip, u && u.day === d ? { day: d, n: u.n + 1 } : { day: d, n: 1 });
}

export function resetPublicCheckCaps(): void {
  used.clear();
  global = { day: '', n: 0 };
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function registerPublicVisibilityCheck(
  app: Express,
  limiter: RequestHandler,
  ipOf: (req: Request) => string,
): void {
  app.get('/check', (_req: Request, res: Response) => {
    res.type('html').send(PAGE);
  });

  app.post('/api/public/visibility-check', limiter, async (req: Request, res: Response) => {
    const businessName = clean(req.body?.businessName, 80);
    const location = clean(req.body?.location, 80);
    const service = clean(req.body?.service, 60);
    const website = clean(req.body?.website, 120);
    if (!businessName || !location || !service) {
      return res.status(400).json({ success: false, error: 'Business name, town or city, and what you sell are all needed.' });
    }
    // A routing preview before anything is consumed or spent: with no
    // qualified web-search route the check is simply not available.
    const route = previewRoutedCall({ callSite: 'aeo.public_check', workspaceId: null, model: GEO_PINNED_MODEL, tools: ['web_search'] });
    if (!route.ok) return res.status(503).json({ success: false, error: 'The free check is not switched on yet.' });
    const ip = ipOf(req);
    const refused = capReason(ip, Number(process.env.PUBLIC_CHECK_DAILY_CAP) || 150);
    if (refused) return res.status(429).json({ success: false, error: refused });
    consume(ip);

    const geo = await runGeoProbe(
      { businessName, domain: website || businessName, location, targetService: service },
      (query) => askGrounded(query, { callSite: 'aeo.public_check', workspaceId: null, maxOutputTokens: 900 }),
    );
    const queries = geo.queries.slice(0, QUESTIONS);
    if (geo.providerStatus !== 'USED' || queries.length === 0) {
      return res.status(502).json({ success: false, error: 'The AI engine could not be reached just now. Nothing was measured.' });
    }
    const count = (hosts: string[][]) => {
      const m = new Map<string, number>();
      for (const hs of hosts) for (const h of new Set(hs)) m.set(h, (m.get(h) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([host, n]) => ({ host, n }));
    };
    return res.json({
      success: true,
      asked: queries.length,
      appeared: queries.filter((q) => q.brandAppeared).length,
      questions: queries.map((q) => ({ question: q.query, appeared: q.brandAppeared })),
      competitors: count(queries.map((q) => q.competitorsSeen)).slice(0, 8),
      sources: count(queries.map((q) => q.citedSources.filter((s) => isSourceHost(s)))).slice(0, 8),
      method: geo.providerDetail,
      ctaUrl: process.env.PUBLIC_CHECK_CTA_URL || null,
    });
  });
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Are you visible in AI answers?</title>
<style>
:root{--bg:#0b0d10;--s:#14171c;--l:rgba(255,255,255,.1);--t:#eceef1;--m:#9aa1ab;--a:#4f8cff;--g:#3ddc97;--r:#ff6b5a}
@media (prefers-color-scheme:light){:root{--bg:#f6f7f9;--s:#fff;--l:rgba(0,0,0,.1);--t:#14171c;--m:#5b6470}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:16px/1.55 system-ui,-apple-system,sans-serif}
main{max-width:680px;margin:0 auto;padding:48px 16px 64px}h1{font-size:clamp(28px,5vw,40px);line-height:1.1;margin:0 0 12px}
p.lede{color:var(--m);margin:0 0 28px}form{display:grid;gap:12px;background:var(--s);border:1px solid var(--l);border-radius:14px;padding:18px}
label{display:grid;gap:4px;font-size:14px;color:var(--m)}input{font:inherit;padding:11px 12px;border-radius:10px;border:1px solid var(--l);background:var(--bg);color:var(--t)}
button{font:600 16px system-ui;padding:12px;border:0;border-radius:10px;background:var(--a);color:#fff;cursor:pointer}button:disabled{opacity:.6}
.card{background:var(--s);border:1px solid var(--l);border-radius:14px;padding:18px;margin-top:18px}.big{font-size:44px;font-weight:700}
.q{display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--l)}.q b{min-width:70px}.yes{color:var(--g)}.no{color:var(--r)}
.fine{color:var(--m);font-size:13px}ul{padding-left:18px}.err{color:var(--r)}
</style></head><body><main>
<h1>Are you visible when people ask AI for a recommendation?</h1>
<p class="lede">We ask an AI search engine three questions a local customer would ask, and show whether it names your business, and who it names instead. Free, about 30 seconds, nothing stored.</p>
<form id="f"><label>Business name<input name="businessName" required maxlength="80" autocomplete="organization"></label>
<label>Town or city<input name="location" required maxlength="80" placeholder="Milford, CT"></label>
<label>What you sell<input name="service" required maxlength="60" placeholder="mattress store"></label>
<label>Website (optional)<input name="website" maxlength="120" placeholder="yourstore.com"></label>
<button id="b">Run the free check</button></form>
<div id="out" aria-live="polite"></div>
<p class="fine">One engine (Gemini with Google Search), one sample. AI answers vary from day to day, so this is a snapshot, not a ranking.</p>
</main><script>
const f=document.getElementById('f'),b=document.getElementById('b'),out=document.getElementById('out');
const esc=s=>String(s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
f.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;b.textContent='Asking the AI…';out.innerHTML='';
try{const r=await fetch('/api/public/visibility-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(f)))});
const d=await r.json();if(!d.success){out.innerHTML='<p class="card err">'+esc(d.error)+'</p>';return}
const name=esc(new FormData(f).get('businessName'));
out.innerHTML='<div class="card"><div class="big">'+d.appeared+' of '+d.asked+'</div><p>AI answers that named <b>'+name+'</b>.</p>'+
d.questions.map(q=>'<div class="q"><b class="'+(q.appeared?'yes">Named':'no">Missing')+'</b><span>'+esc(q.question)+'</span></div>').join('')+'</div>'+
(d.competitors.length?'<div class="card"><b>Businesses the AI pointed to</b><ul>'+d.competitors.map(c=>'<li>'+esc(c.host)+' — in '+c.n+' of '+d.asked+'</li>').join('')+'</ul></div>':'')+
(d.sources.length?'<div class="card"><b>Where the AI got its information</b><p class="fine">Review sites and directories it relied on. Being listed and reviewed on these is usually the first fix.</p><ul>'+d.sources.map(c=>'<li>'+esc(c.host)+'</li>').join('')+'</ul></div>':'')+
'<div class="card"><b>What next</b><p>A full audit checks your Google profile, website, reviews and more AI engines, and gives you a prioritised fix list.</p>'+(d.ctaUrl?'<p><a href="'+esc(d.ctaUrl)+'">Get the full audit</a></p>':'')+'<p class="fine">'+esc(d.method)+'</p></div>';
}catch(err){out.innerHTML='<p class="card err">Something went wrong. Try again.</p>'}finally{b.disabled=false;b.textContent='Run the free check'}});
</script></body></html>`;
