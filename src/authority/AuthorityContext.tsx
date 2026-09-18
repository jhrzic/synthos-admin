import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// AUTHORITY CONTEXT — which control plane the Admin is showing, and whether
// it is reachable right now. Every operational view renders inside it:
// when the canonical control plane cannot be reached the views are replaced
// by an UNAVAILABLE panel, so an outage never reads as an empty system
// (zero tasks, zero skills, zero qualifications).
//
// Source: GET /api/authority (lib/control-plane-authority.ts). Checked on
// load, every 30 s, and when the window regains focus. Nothing is cached:
// data shown is either CANONICAL (fetched live) or UNAVAILABLE.
// ---------------------------------------------------------------------------

export type AuthorityStatus = 'CHECKING' | 'CONNECTED' | 'UNREACHABLE';

export interface AuthorityInfo {
  role: string;
  deployment: string;
  environment: string;
  commit: string;
  tree: string;
  database: { name: string; schemaVersion: number | string; supported: number | string; fingerprint: string };
}

export interface AuthorityState {
  status: AuthorityStatus;
  info: AuthorityInfo | null;
  access: { path: 'GATEWAY' | 'DIRECT'; gateway?: string } | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  recheck: () => void;
}

const Ctx = createContext<AuthorityState>({ status: 'CHECKING', info: null, access: null, lastVerifiedAt: null, lastError: null, recheck: () => {} });
export const useAuthority = () => useContext(Ctx);

export const AuthorityProvider: React.FC<{ children: React.ReactNode; intervalMs?: number }> = ({ children, intervalMs = 30_000 }) => {
  const [state, setState] = useState<Omit<AuthorityState, 'recheck'>>({ status: 'CHECKING', info: null, access: null, lastVerifiedAt: null, lastError: null });
  const live = useRef(true);
  const check = useCallback(() => {
    fetch('/api/authority', { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!live.current) return;
        if (!r.ok || !j?.success || !j.controlPlane) {
          setState((s) => ({ ...s, status: 'UNREACHABLE', lastError: j?.controlPlane === 'UNREACHABLE' ? 'the gateway cannot reach the control plane' : (j?.error || `HTTP ${r.status}`) }));
          return;
        }
        setState({ status: 'CONNECTED', info: j.controlPlane, access: j.access ?? null, lastVerifiedAt: j.verifiedAt ?? new Date().toISOString(), lastError: null });
      })
      .catch((e) => live.current && setState((s) => ({ ...s, status: 'UNREACHABLE', lastError: String(e?.message || e) })));
  }, []);
  useEffect(() => {
    live.current = true;
    check();
    const t = setInterval(check, intervalMs);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => { live.current = false; clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [check, intervalMs]);
  return <Ctx.Provider value={{ ...state, recheck: check }}>{children}</Ctx.Provider>;
};

const short = (sha: string | undefined) => (sha && /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : 'UNKNOWN');

/** One-line authority banner shown above every operational view. */
export const AuthorityBanner: React.FC = () => {
  const a = useAuthority();
  const tone = a.status === 'CONNECTED' ? 'border-[#1C2038] text-[#8E94B8]' : a.status === 'UNREACHABLE' ? 'border-[#FF6B6B]/50 text-[#FF6B6B] bg-[#FF6B6B]/5' : 'border-[#1C2038] text-[#6A7097]';
  return (
    <div className={`px-3 sm:px-6 py-1 border-b font-mono text-[10px] flex flex-wrap gap-x-3 gap-y-0.5 ${tone}`} data-testid="authority-banner" data-authority-status={a.status}>
      <span className="font-bold" data-testid="authority-state">
        {a.status === 'CONNECTED' ? 'CANONICAL CONTROL PLANE · CONNECTED' : a.status === 'UNREACHABLE' ? 'CONTROL PLANE UNREACHABLE' : 'CHECKING CONTROL PLANE…'}
      </span>
      {a.info && <span>{a.info.deployment} · {a.info.environment}</span>}
      {a.access && <span>access {a.access.path === 'GATEWAY' ? `via gateway ${a.access.gateway ?? ''}` : 'direct'}</span>}
      {a.info && <span>db {a.info.database.name} · schema v{a.info.database.schemaVersion}/{a.info.database.supported} · {String(a.info.database.fingerprint).slice(0, 15)}</span>}
      {a.info && <span>runtime {short(a.info.commit)}{a.info.tree !== 'CLEAN' ? ` (${a.info.tree})` : ''}</span>}
      <span>last verified {a.lastVerifiedAt ?? 'never'}</span>
      <span data-testid="authority-rw">{a.status === 'CONNECTED' ? 'read/write available · data CANONICAL' : a.status === 'UNREACHABLE' ? 'read/write UNAVAILABLE · data UNAVAILABLE' : 'data not yet verified'}</span>
      {a.lastError && <span>({a.lastError})</span>}
    </div>
  );
};

/**
 * Renders operational views only while the canonical control plane is
 * reachable. Otherwise: an explicit UNAVAILABLE panel, never empty data.
 */
export const RequireCanonical: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const a = useAuthority();
  if (a.status === 'UNREACHABLE') {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center" data-testid="control-plane-unavailable">
        <div className="text-[#FF6B6B] font-mono font-bold tracking-wide">CONTROL PLANE UNREACHABLE</div>
        <p className="text-sm text-[#C9CCE6] mt-2">The canonical SynthOS control plane cannot be reached, so nothing is shown here: not zero tasks, not an empty registry — no data.</p>
        <p className="text-xs text-[#8E94B8] mt-1">Last verified connection: {a.lastVerifiedAt ?? 'never'}{a.lastError ? ` · ${a.lastError}` : ''}</p>
        <button className="mt-3 px-3 py-1.5 text-xs font-mono rounded-lg border border-[#2D3352] text-[#C9CCE6]" onClick={a.recheck}>Check again</button>
      </div>
    );
  }
  return <>{children}</>;
};
