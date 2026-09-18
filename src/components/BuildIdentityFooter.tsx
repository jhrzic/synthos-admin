import React, { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// BUILD IDENTITY — a restrained footer line: which commit, built when, which
// environment and deployment this Admin is. Read ONCE from /api/ready (the
// same authority as Diagnostics, lib/build-info.ts); no polling. Anything
// not stamped reads UNKNOWN, never a guessed version.
// ---------------------------------------------------------------------------

export interface BuildIdentity { commit: string; buildTime: string; environment?: string; deployment?: string; tree?: string }

export const BuildIdentityFooter: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const [v, setV] = useState<BuildIdentity | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch('/api/ready').then((r) => r.json()).then((j) => { if (live) { if (j?.version) setV(j.version); else setFailed(true); } }).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, []);
  const short = v && /^[0-9a-f]{40}$/.test(v.commit) ? v.commit.slice(0, 7) : 'UNKNOWN';
  const title = v ? `commit ${v.commit}\nbuilt ${v.buildTime}\nenvironment ${v.environment ?? 'UNKNOWN'}\ndeployment ${v.deployment ?? 'UNKNOWN'}\ntree ${v.tree ?? 'UNKNOWN'}` : failed ? 'build identity UNKNOWN (could not read /api/ready)' : 'reading build identity…';
  if (compact) return <span className="font-mono text-[9px] text-[#6C7293]" title={title} data-testid="build-identity">{short}</span>;
  return (
    <span className="font-mono text-[9px] text-[#6C7293] leading-tight block truncate" title={title} data-testid="build-identity">
      {v ? `${short} · ${v.environment ?? 'UNKNOWN'} · ${v.deployment ?? 'UNKNOWN'} · ${v.buildTime === 'UNKNOWN' ? 'built UNKNOWN' : v.buildTime.slice(0, 16).replace('T', ' ')}Z` : failed ? 'build UNKNOWN' : '…'}
    </span>
  );
};
