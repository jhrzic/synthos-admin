import React, { useState, useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// SYNTHOS — minimal, real authentication gate (Pass III / A6, extended
// Pass IV / D3-D4, G1-G4).
//
// Deliberately bare, not "a fancy login page" — the backend truth (real
// scrypt password hashing, real server-side sessions, real workspace
// membership) is what these passes are about. This is the thin client
// surface needed so the app remains usable once every real API route
// requires a real session.
//
// Real states, never a generic fake success (G1): loading, setup-required,
// login (with real invalid-credentials / disabled-account messages from
// the server), account-setup (second-user onboarding), authenticated,
// server-unavailable.
// ---------------------------------------------------------------------------

interface AuthUser {
  user_id: string;
  email: string;
  display_name: string;
  platform_role: 'platform_admin' | 'standard';
}

interface Membership {
  workspace_id: string;
  workspace_name: string;
  role: 'admin' | 'member';
}

type GateState = 'loading' | 'setup' | 'login' | 'account-setup' | 'authenticated' | 'error';

const inputClass = 'w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2.5 text-xs text-white placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]';
const labelClass = 'text-[11px] font-mono text-[#8E94B8] uppercase block mb-1';
const buttonClass = 'w-full py-2.5 bg-[#615EFF] hover:bg-[#5653d9] disabled:opacity-50 text-white text-xs font-bold rounded-lg transition cursor-pointer';

/** Extracts a bare setup token from either a full pasted URL or a bare token string. */
function extractSetupToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/setup\/([a-f0-9]{40,})/i);
  if (match) return match[1];
  if (/^[a-f0-9]{40,}$/i.test(trimmed)) return trimmed;
  return null;
}

export const AuthGate: React.FC<{ children: (ctx: { user: AuthUser; workspaces: Membership[]; onLogout: () => void }) => React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<GateState>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [workspaces, setWorkspaces] = useState<Membership[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [showRedeemSetup, setShowRedeemSetup] = useState(false);
  const [setupLinkInput, setSetupLinkInput] = useState('');
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [setupEmail, setSetupEmail] = useState<string | null>(null);
  const [setupPassword, setSetupPassword] = useState('');

  const checkStatus = async () => {
    try {
      const meRes = await fetch('/api/auth/me');
      const meData = await meRes.json();
      if (meData.authenticated) {
        setUser(meData.user);
        setWorkspaces(meData.workspaces || []);
        setState('authenticated');
        return;
      }
      const setupRes = await fetch('/api/auth/setup-required');
      const setupData = await setupRes.json();
      setState(setupData.setupRequired ? 'setup' : 'login');
    } catch (err: any) {
      setError(err?.message || 'Could not reach the server.');
      setState('error');
    }
  };

  // D3/D4 — if this page was reached via a real one-time setup link
  // (/setup/<token>, served by the SPA fallback like any other client
  // route), validate the token before anything else.
  useEffect(() => {
    const pathMatch = window.location.pathname.match(/^\/setup\/([a-f0-9]{40,})$/i);
    if (pathMatch) {
      const token = pathMatch[1];
      fetch(`/api/auth/setup-token/${encodeURIComponent(token)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setSetupToken(token);
            setSetupEmail(data.email);
            setState('account-setup');
          } else {
            setError(data.error || 'This setup link is invalid or has expired.');
            checkStatus();
          }
        })
        .catch(() => checkStatus());
    } else {
      checkStatus();
    }
  }, []);

  // G3 — session expiry handling. If any real API call anywhere in the app
  // returns 401 (session revoked/expired server-side), transition cleanly
  // back to the auth gate instead of leaving stale panels on screen. A
  // single fetch wrapper, installed once, rather than threading this
  // through every component.
  const recheckingRef = useRef(false);
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || '';
      if (response.status === 401 && url.startsWith('/api/') && !url.startsWith('/api/auth/') && !recheckingRef.current) {
        recheckingRef.current = true;
        checkStatus().finally(() => { recheckingRef.current = false; });
      }
      return response;
    };
    return () => { window.fetch = originalFetch; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const endpoint = state === 'setup' ? '/api/auth/setup' : '/api/auth/login';
      const body = state === 'setup' ? { email, password, displayName } : { email, password };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setError(data.error || 'Something went wrong.');
        return;
      }
      setUser(data.user);
      setWorkspaces(data.workspaces || []);
      setState('authenticated');
    } catch (err: any) {
      setError(err?.message || 'Network error / server unavailable.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRedeemSetupLink = () => {
    const token = extractSetupToken(setupLinkInput);
    if (!token) {
      setError('That does not look like a valid setup link or code.');
      return;
    }
    setError(null);
    fetch(`/api/auth/setup-token/${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setSetupToken(token);
          setSetupEmail(data.email);
          setState('account-setup');
        } else {
          setError(data.error || 'This setup link is invalid or has expired.');
        }
      })
      .catch((err) => setError(err?.message || 'Network error.'));
  };

  const handleCompleteAccountSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/setup-token/${encodeURIComponent(setupToken)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: setupPassword }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setError(data.error || 'Could not complete setup.');
        return;
      }
      window.history.replaceState({}, '', '/');
      setUser(data.user);
      setWorkspaces(data.workspaces || []);
      setState('authenticated');
    } catch (err: any) {
      setError(err?.message || 'Network error.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setWorkspaces([]);
      setEmail('');
      setPassword('');
      setState('loading');
      checkStatus();
    }
  };

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-[#06070B] flex items-center justify-center text-[#8E94B8] text-xs font-mono">
        Loading…
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen bg-[#06070B] flex items-center justify-center text-[#FF5E8E] text-xs font-mono p-6 text-center">
        {error || 'Could not reach the server.'}
      </div>
    );
  }

  if (state === 'authenticated' && user) {
    return (
      <div>
        <div className="fixed top-2 right-2 z-[999] flex items-center gap-2 bg-[#0D0E1A] border border-[#1E2238] rounded-full px-3 py-1.5 text-[10px] font-mono text-[#8E94B8] shadow-lg">
          <span className="text-white font-bold">{user.display_name}</span>
          <span className="text-[#5F6589]">{user.email}</span>
          {user.platform_role === 'platform_admin' && (
            <span className="px-1.5 py-0.5 rounded bg-[#615EFF]/20 text-[#A5A2FF] font-bold">PLATFORM ADMIN</span>
          )}
          <button onClick={handleLogout} className="text-[#FF5E8E] hover:underline cursor-pointer">Logout</button>
        </div>
        {children({ user, workspaces, onLogout: handleLogout })}
      </div>
    );
  }

  if (state === 'account-setup') {
    return (
      <div className="min-h-screen bg-[#06070B] flex items-center justify-center p-4 font-mono">
        <div className="w-full max-w-sm bg-[#0D0E1A] border border-[#1E2238] rounded-2xl p-6 space-y-4 shadow-2xl">
          <div>
            <h1 className="text-lg font-bold text-white">Complete Account Setup</h1>
            <p className="text-xs text-[#8E94B8] mt-1">
              {setupEmail ? <>Choose a password for <strong className="text-white">{setupEmail}</strong>.</> : 'Choose a password to activate your account.'}
            </p>
          </div>
          {error && (
            <div className="p-2.5 bg-[#FF5E8E]/10 border border-[#FF5E8E]/30 rounded-lg text-[11px] text-[#FF5E8E]">{error}</div>
          )}
          <form onSubmit={handleCompleteAccountSetup} className="space-y-3">
            <div>
              <label className={labelClass}>New Password</label>
              <input type="password" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} required minLength={10} className={inputClass} placeholder="At least 10 characters" autoComplete="new-password" />
            </div>
            <button type="submit" disabled={submitting} className={buttonClass}>
              {submitting ? 'Please wait…' : 'Activate Account'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#06070B] flex items-center justify-center p-4 font-mono">
      <div className="w-full max-w-sm bg-[#0D0E1A] border border-[#1E2238] rounded-2xl p-6 space-y-4 shadow-2xl">
        <div>
          <h1 className="text-lg font-bold text-white">{state === 'setup' ? 'Set Up SynthOS' : 'Sign In'}</h1>
          <p className="text-xs text-[#8E94B8] mt-1">
            {state === 'setup'
              ? 'No account exists yet. Create the first account — it becomes the platform administrator.'
              : 'Sign in with your SynthOS account.'}
          </p>
        </div>

        {error && (
          <div className="p-2.5 bg-[#FF5E8E]/10 border border-[#FF5E8E]/30 rounded-lg text-[11px] text-[#FF5E8E]">
            {error}
          </div>
        )}

        {!showRedeemSetup ? (
          <>
            <form onSubmit={handleSubmit} className="space-y-3">
              {state === 'setup' && (
                <div>
                  <label className={labelClass}>Display Name</label>
                  <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required className={inputClass} placeholder="Your name" />
                </div>
              )}
              <div>
                <label className={labelClass}>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} placeholder="you@example.com" autoComplete="username" />
              </div>
              <div>
                <label className={labelClass}>Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={state === 'setup' ? 10 : undefined} className={inputClass} placeholder={state === 'setup' ? 'At least 10 characters' : 'Password'} autoComplete={state === 'setup' ? 'new-password' : 'current-password'} />
              </div>
              <button type="submit" disabled={submitting} className={buttonClass}>
                {submitting ? 'Please wait…' : state === 'setup' ? 'Create Account' : 'Sign In'}
              </button>
            </form>
            {state === 'login' && (
              <button onClick={() => { setShowRedeemSetup(true); setError(null); }} className="text-[10px] text-[#8E94B8] hover:text-white underline cursor-pointer">
                Have a setup link or code from your platform admin?
              </button>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-[#8E94B8]">Paste the setup link or code your platform admin gave you.</p>
            <input type="text" value={setupLinkInput} onChange={(e) => setSetupLinkInput(e.target.value)} className={inputClass} placeholder="Setup link or code" />
            <button onClick={handleRedeemSetupLink} className={buttonClass}>Continue</button>
            <button onClick={() => { setShowRedeemSetup(false); setError(null); }} className="text-[10px] text-[#8E94B8] hover:text-white underline cursor-pointer">
              Back to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
