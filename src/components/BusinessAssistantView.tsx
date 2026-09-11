import React, { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare, Globe, Loader2, AlertTriangle, CheckCircle2, BookOpen,
  ExternalLink, Copy, User, Bot, ShieldAlert, RefreshCw, FileCheck, HelpCircle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// BUSINESS CONVERSATION AI — the owner's surface.
//
// The customer never sees this screen; they see /a/<key>. This is where a
// business configures what its assistant may say, publishes it, and reads what
// its customers actually asked.
//
// Three things this screen must never do, each of which is a way the product
// would lie to the person paying for it:
//
//   1. Report an appointment as booked. There is no calendar connected. A
//      scheduling request becomes a FOLLOW-UP REQUEST and renders as one.
//   2. Invent a metric. Conversion rate, lead score and revenue influenced
//      have no data source here, so they are not shown — the counts below are
//      counts of rows that exist.
//   3. Imply the assistant is generative when no model is configured. The
//      answering mode is stated at the top of the screen, in the owner's own
//      terms, before they put it in front of a customer.
// ---------------------------------------------------------------------------

interface Profile {
  profile_id: string;
  business_name: string;
  assistant_name: string;
  business_description: string | null;
  services: string[];
  locations: string[];
  hours: string | null;
  contact: Record<string, string>;
  greeting: string | null;
  ai_disclosure: string;
  escalation_contacts: string[];
  public_key: string | null;
  published: boolean;
}

interface Answering { mode: string; detail: string; }

interface ConversationRow {
  conversationId: string;
  channel: string;
  status: 'ACTIVE' | 'HANDOFF_REQUESTED' | 'CLOSED';
  lead: { name?: string; contact?: string; need?: string; timing?: string; location?: string };
  summaryArtifactId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Message {
  message_id: string;
  role: 'customer' | 'assistant' | 'system';
  content: string;
  response_mode: string | null;
  sources: { title: string; path: string }[];
  created_at: string;
}

interface Analytics {
  conversations: { total: number; active: number; handoffRequested: number; closed: number };
  answering: { assistantTurns: number; grounded: number; llm: number; noKnowledge: number };
  knowledgeGaps: string[];
  appointmentsBooked: string;
  callsHandled: string;
  smsHandled: string;
  revenueInfluenced: string;
}

const CARD = 'rounded-xl border border-white/10 bg-white/[0.03] p-5';
const LABEL = 'text-[10px] font-mono uppercase tracking-wider text-slate-500';
const INPUT = 'w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-violet-400/50 focus:outline-none';

export function BusinessAssistantView({ activeWorkspaceId }: { activeWorkspaceId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [answering, setAnswering] = useState<Answering | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [selected, setSelected] = useState<{ row: ConversationRow; messages: Message[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [form, setForm] = useState({
    businessName: '', assistantName: '', businessDescription: '',
    services: '', locations: '', hours: '', contactEmail: '', contactPhone: '',
    greeting: '', escalationContacts: '',
  });
  const [knowledge, setKnowledge] = useState({ title: '', content: '' });

  const refresh = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true); setError(null);
    try {
      const ws = encodeURIComponent(activeWorkspaceId);
      const [p, c, a] = await Promise.all([
        fetch(`/api/business/profile?workspaceId=${ws}`).then((r) => r.json()),
        fetch(`/api/business/conversations?workspaceId=${ws}`).then((r) => r.json()),
        fetch(`/api/business/analytics?workspaceId=${ws}`).then((r) => r.json()),
      ]);
      if (p.success) {
        setProfile(p.profile); setAnswering(p.answering); setPublicUrl(p.publicUrl);
        if (p.profile) {
          setForm({
            businessName: p.profile.business_name || '',
            assistantName: p.profile.assistant_name || '',
            businessDescription: p.profile.business_description || '',
            services: (p.profile.services || []).join('\n'),
            locations: (p.profile.locations || []).join('\n'),
            hours: p.profile.hours || '',
            contactEmail: p.profile.contact?.email || '',
            contactPhone: p.profile.contact?.phone || '',
            greeting: p.profile.greeting || '',
            escalationContacts: (p.profile.escalation_contacts || []).join('\n'),
          });
        }
      } else setError(p.error || 'Could not load the assistant profile.');
      if (c.success) setConversations(c.conversations);
      if (a.success) setAnalytics(a);
    } catch (e: any) {
      setError(e?.message || 'Could not reach the server.');
    } finally { setLoading(false); }
  }, [activeWorkspaceId]);

  useEffect(() => { refresh(); }, [refresh]);

  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

  const saveProfile = async () => {
    setBusy('profile'); setError(null); setNotice(null);
    try {
      const contact: Record<string, string> = {};
      if (form.contactEmail.trim()) contact.email = form.contactEmail.trim();
      if (form.contactPhone.trim()) contact.phone = form.contactPhone.trim();
      const r = await fetch('/api/business/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          businessName: form.businessName, assistantName: form.assistantName,
          businessDescription: form.businessDescription,
          services: lines(form.services), locations: lines(form.locations),
          hours: form.hours, contact, greeting: form.greeting,
          escalationContacts: lines(form.escalationContacts),
        }),
      }).then((x) => x.json());
      if (!r.success) setError(r.error || 'Save failed.');
      else { setNotice('Assistant profile saved.'); await refresh(); }
    } catch (e: any) { setError(e?.message || 'Save failed.'); }
    finally { setBusy(null); }
  };

  const addKnowledge = async () => {
    setBusy('knowledge'); setError(null); setNotice(null);
    try {
      const r = await fetch('/api/business/knowledge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: activeWorkspaceId, ...knowledge }),
      }).then((x) => x.json());
      if (!r.success) setError(r.error || 'Could not add the document.');
      else { setNotice(`Added and indexed: ${r.path}`); setKnowledge({ title: '', content: '' }); }
    } catch (e: any) { setError(e?.message || 'Could not add the document.'); }
    finally { setBusy(null); }
  };

  const togglePublish = async () => {
    setBusy('publish'); setError(null); setNotice(null);
    try {
      const r = await fetch('/api/business/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: activeWorkspaceId, published: !profile?.published }),
      }).then((x) => x.json());
      if (!r.success) setError(r.error || 'Could not change publication.');
      else { setNotice(r.published ? 'Assistant is live.' : 'Assistant is offline — the link now returns nothing.'); await refresh(); }
    } catch (e: any) { setError(e?.message || 'Could not change publication.'); }
    finally { setBusy(null); }
  };

  const openConversation = async (row: ConversationRow) => {
    const ws = encodeURIComponent(activeWorkspaceId);
    const r = await fetch(`/api/business/conversations/${encodeURIComponent(row.conversationId)}?workspaceId=${ws}`).then((x) => x.json());
    if (r.success) setSelected({ row: r.conversation, messages: r.messages });
  };

  const writeSummary = async (conversationId: string) => {
    setBusy('summary');
    try {
      const r = await fetch(`/api/business/conversations/${encodeURIComponent(conversationId)}/summary`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: activeWorkspaceId }),
      }).then((x) => x.json());
      if (r.success) setNotice(`Summary written to ${r.path} — Aegis ${r.aegisDecision}${r.receiptId ? `, receipt ${r.receiptId}` : ''}.`);
      else setError(r.error || 'Could not write the summary.');
      await refresh();
    } finally { setBusy(null); }
  };

  if (loading) {
    return <div className="flex items-center gap-2 p-8 text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading assistant…</div>;
  }

  const modeIsExtractive = answering?.mode === 'GROUNDED_EXTRACTIVE';

  return (
    <div className="space-y-5 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-100">
            <MessageSquare className="h-5 w-5 text-violet-300" /> Business Assistant
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            A customer-facing assistant that answers from your own published material, qualifies
            enquiries, and hands real work to a person. It is not a panel inside this app — it has
            its own public page.
          </p>
        </div>
        <button onClick={refresh} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
        </div>
      )}

      {/* How it answers — stated before anything else, because it decides what
          the owner can honestly promise their customers. */}
      {answering && (
        <div className={`${CARD} ${modeIsExtractive ? 'border-amber-400/30 bg-amber-400/[0.06]' : ''}`}>
          <div className={LABEL}>How your assistant answers right now</div>
          <div className="mt-2 flex items-start gap-2">
            {modeIsExtractive ? <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />}
            <div>
              <div className="font-mono text-xs text-slate-200">{answering.mode}</div>
              <p className="mt-1 text-sm text-slate-400">{answering.detail}</p>
              {modeIsExtractive && (
                <p className="mt-2 text-sm text-slate-400">
                  This is a real limit, not a placeholder: the assistant quotes your documents rather
                  than writing prose. It cannot invent a price, a promise or an availability — and if
                  nothing you published answers a question, it says so and offers a person.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Publication */}
      <div className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className={LABEL}>Public page</div>
            {publicUrl ? (
              <div className="mt-2 flex items-center gap-2">
                <a href={publicUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-mono text-sm text-violet-300 hover:underline">
                  {window.location.origin}{publicUrl} <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <button
                  onClick={() => navigator.clipboard?.writeText(`${window.location.origin}${publicUrl}`)}
                  className="rounded border border-white/10 p-1 text-slate-400 hover:bg-white/5" title="Copy link"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-400">Not published. Nothing is reachable by a customer.</p>
            )}
          </div>
          <button
            onClick={togglePublish} disabled={busy === 'publish' || !profile}
            className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40 ${
              profile?.published ? 'border border-white/10 text-slate-300 hover:bg-white/5' : 'bg-violet-500/90 text-white hover:bg-violet-500'
            }`}
          >
            {busy === 'publish' ? 'Working…' : profile?.published ? 'Take offline' : 'Publish assistant'}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          The link is the only way in — a customer cannot reach your workspace any other way.
          Taking it offline stops it answering immediately; republishing restores the same link.
          Embedding it in an iframe on your own site is <span className="font-mono">NOT_IMPLEMENTED</span> today.
        </p>
      </div>

      {/* Analytics — counts of real rows only. */}
      {analytics && (
        <div className={CARD}>
          <div className={LABEL}>What actually happened</div>
          <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              ['Conversations', analytics.conversations.total],
              ['Waiting on a person', analytics.conversations.handoffRequested],
              ['Answered from your material', analytics.answering.grounded],
              ["Couldn't answer", analytics.answering.noKnowledge],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <div className="font-mono text-2xl text-slate-100">{String(value)}</div>
                <div className="mt-0.5 text-xs text-slate-500">{label}</div>
              </div>
            ))}
          </div>

          {analytics.knowledgeGaps.length > 0 && (
            <div className="mt-5 border-t border-white/5 pt-4">
              <div className={LABEL}>Questions your material does not answer</div>
              <p className="mt-1 text-xs text-slate-500">
                Each one is a real customer asking something your published material is silent on.
                Answering it here fixes it for every future visitor.
              </p>
              <ul className="mt-2 space-y-1">
                {analytics.knowledgeGaps.slice(0, 8).map((q, i) => (
                  <li key={i} className="text-sm text-slate-300">— {q}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 border-t border-white/5 pt-4">
            <div className={LABEL}>Not measured</div>
            <div className="mt-2 flex flex-wrap gap-3 font-mono text-[11px] text-slate-500">
              <span>appointments booked: {analytics.appointmentsBooked}</span>
              <span>calls: {analytics.callsHandled}</span>
              <span>SMS: {analytics.smsHandled}</span>
              <span>revenue influenced: {analytics.revenueInfluenced}</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              These have no data source on this install, so no number is shown. The assistant cannot
              book appointments and no phone line is connected.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Profile */}
        <div className={CARD}>
          <div className={LABEL}>What your assistant knows about you</div>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-xs text-slate-500">Business name</div>
                <input className={INPUT} value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-500">Assistant name</div>
                <input className={INPUT} value={form.assistantName} onChange={(e) => setForm({ ...form, assistantName: e.target.value })} />
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-500">What you do (one or two sentences)</div>
              <textarea rows={2} className={INPUT} value={form.businessDescription} onChange={(e) => setForm({ ...form, businessDescription: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-xs text-slate-500">Services (one per line)</div>
                <textarea rows={4} className={INPUT} value={form.services} onChange={(e) => setForm({ ...form, services: e.target.value })} />
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-500">Areas served (one per line)</div>
                <textarea rows={4} className={INPUT} value={form.locations} onChange={(e) => setForm({ ...form, locations: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="mb-1 text-xs text-slate-500">Hours</div>
                <input className={INPUT} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-500">Email</div>
                <input className={INPUT} value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-500">Phone</div>
                <input className={INPUT} value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-500">Opening line</div>
              <input className={INPUT} value={form.greeting} onChange={(e) => setForm({ ...form, greeting: e.target.value })} />
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-500">Who gets told when a customer asks for a person (one per line)</div>
              <textarea rows={2} className={INPUT} value={form.escalationContacts} onChange={(e) => setForm({ ...form, escalationContacts: e.target.value })} />
            </div>
            <button onClick={saveProfile} disabled={busy === 'profile'} className="rounded-lg bg-violet-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-40">
              {busy === 'profile' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* Knowledge */}
        <div className={CARD}>
          <div className={`${LABEL} flex items-center gap-1.5`}><BookOpen className="h-3.5 w-3.5" /> What it is allowed to say</div>
          <p className="mt-2 text-sm text-slate-400">
            Paste anything a customer might ask about — guarantees, process, pricing, policies. The
            assistant quotes these documents and nothing else. If it is not in here or in the
            details on the left, it will say it does not know.
          </p>
          <div className="mt-3 space-y-3">
            <input className={INPUT} placeholder="Title, e.g. Guarantee and warranty" value={knowledge.title} onChange={(e) => setKnowledge({ ...knowledge, title: e.target.value })} />
            <textarea rows={8} className={INPUT} placeholder="Paste the real text a customer should get…" value={knowledge.content} onChange={(e) => setKnowledge({ ...knowledge, content: e.target.value })} />
            <button onClick={addKnowledge} disabled={busy === 'knowledge'} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-40">
              {busy === 'knowledge' ? 'Adding…' : 'Add document'}
            </button>
            <p className="text-xs text-slate-500">
              Each document is stored in your Vault and indexed. You can open it, search it and
              check exactly what the assistant is quoting — the answer to "why did it say that" is
              always a document you can read.
            </p>
          </div>
        </div>
      </div>

      {/* Conversations */}
      <div className={CARD}>
        <div className={LABEL}>Conversations</div>
        {conversations.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No conversations yet.</p>
        ) : (
          <div className="mt-3 divide-y divide-white/5">
            {conversations.map((c) => (
              <button key={c.conversationId} onClick={() => openConversation(c)}
                className="flex w-full items-center justify-between gap-4 py-2.5 text-left hover:bg-white/[0.02]">
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-200">
                    {c.lead.name || 'Website visitor'}
                    {c.lead.contact && <span className="ml-2 font-mono text-xs text-slate-500">{c.lead.contact}</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">{c.lead.need || '—'}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {c.status === 'HANDOFF_REQUESTED' && (
                    <span className="flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] text-amber-200">
                      <ShieldAlert className="h-3 w-3" /> NEEDS A PERSON
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-slate-600">{c.channel}</span>
                  <span className="font-mono text-[10px] text-slate-600">{new Date(c.updatedAt).toLocaleString()}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Transcript */}
      {selected && (
        <div className={CARD}>
          <div className="flex items-center justify-between">
            <div className={LABEL}>Transcript — {selected.row.conversationId}</div>
            <div className="flex gap-2">
              <button onClick={() => writeSummary(selected.row.conversationId)} disabled={busy === 'summary'}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40">
                <FileCheck className="h-3.5 w-3.5" /> {busy === 'summary' ? 'Writing…' : 'Write signed summary'}
              </button>
              <button onClick={() => setSelected(null)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5">Close</button>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {selected.messages.map((m) => (
              <div key={m.message_id} className="flex gap-3">
                <div className="mt-0.5 shrink-0">
                  {m.role === 'customer'
                    ? <User className="h-4 w-4 text-slate-400" />
                    : <Bot className="h-4 w-4 text-violet-300" />}
                </div>
                <div className="min-w-0">
                  <div className="whitespace-pre-wrap text-sm text-slate-200">{m.content}</div>
                  {m.role === 'assistant' && m.response_mode && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-600">
                      <span className={m.response_mode === 'NO_KNOWLEDGE' ? 'text-amber-300/70' : ''}>{m.response_mode}</span>
                      {m.sources.map((s, i) => <span key={i} className="text-slate-500">· {s.title}</span>)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
