import React, { useEffect, useState } from 'react';
import { Layers, Check, HelpCircle, Ban, Info } from 'lucide-react';

// ---------------------------------------------------------------------------
// PROVIDER → MODELS.
//
// The Admin used to present one card per provider with the model version baked
// into its title, so "Claude" and "Claude 3.7 Sonnet" were the same thing and a
// provider could only ever have one model. This renders the real shape: a
// provider, the models it exposes, which one the router defaults to, and each
// model's actual availability.
//
// Every value comes from GET /api/models/catalog. Nothing is hardcoded here —
// UI is never the authority on what models exist.
// ---------------------------------------------------------------------------

type Availability =
  | 'LIVE_VERIFIED' | 'CONFIGURED' | 'NOT_CONFIGURED'
  | 'UNAVAILABLE' | 'DEPRECATED' | 'UNKNOWN';

interface CatalogModelView {
  modelId: string;
  displayName: string;
  family: string;
  capabilityTags: string[];
  modalities: string[];
  isProviderDefault: boolean;
  deprecated: boolean;
  availability: Availability;
  routesToRouterProvider: boolean;
}

interface CatalogProviderView {
  providerId: string;
  displayName: string;
  family: string;
  execution: 'EXECUTABLE' | 'RECOGNIZED';
  routerProvider: string | null;
  credentialEnvVar: string | null;
  credentialPresent: boolean;
  providerState: string;
  providerReason: string;
  lastVerifiedAt: string | null;
  acceptsUncataloguedIds: boolean;
  note: string;
  defaultModelId: string | null;
  modelCount: number;
  models: CatalogModelView[];
}

/** Only a real successful call earns the success colour. */
const AVAILABILITY_STYLE: Record<Availability, { fg: string; bg: string; label: string }> = {
  LIVE_VERIFIED:  { fg: '#00D26A', bg: '#00D26A', label: 'LIVE VERIFIED' },
  CONFIGURED:     { fg: '#E8A845', bg: '#E8A845', label: 'CONFIGURED' },
  NOT_CONFIGURED: { fg: '#7E8BB5', bg: '#7E8BB5', label: 'NOT CONFIGURED' },
  UNAVAILABLE:    { fg: '#7E8BB5', bg: '#7E8BB5', label: 'UNAVAILABLE' },
  DEPRECATED:     { fg: '#E8A845', bg: '#E8A845', label: 'DEPRECATED' },
  UNKNOWN:        { fg: '#7E8BB5', bg: '#7E8BB5', label: 'UNKNOWN' },
};

function AvailabilityChip({ availability }: { availability: Availability }) {
  const style = AVAILABILITY_STYLE[availability] ?? AVAILABILITY_STYLE.UNKNOWN;
  const Icon = availability === 'LIVE_VERIFIED' ? Check : availability === 'UNAVAILABLE' ? Ban : HelpCircle;
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono font-bold border"
      style={{ color: style.fg, borderColor: `${style.bg}4D`, backgroundColor: `${style.bg}1A` }}
    >
      <Icon className="h-2.5 w-2.5" />
      {style.label}
    </span>
  );
}

export const ProviderModelCatalog: React.FC<{
  workspaceId: string;
  /** Show only this provider's block. Omit to show every provider. */
  providerId?: string;
}> = ({ workspaceId, providerId }) => {
  const [providers, setProviders] = useState<CatalogProviderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/models/catalog?workspaceId=${encodeURIComponent(workspaceId)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data?.success) throw new Error(data?.error || `Request failed (${res.status})`);
        setProviders(data.providers as CatalogProviderView[]);
      } catch (err: any) {
        if (!cancelled) setError(String(err?.message ?? err));
      } finally {
        if (!cancelled) setAttempted(true);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  const shown = providers?.filter((p) => !providerId || p.providerId === providerId) ?? null;

  return (
    <div data-testid="provider-model-catalog" className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-mono font-bold uppercase text-white">
          <Layers className="h-3.5 w-3.5 text-[#615EFF]" />
          Provider Model Catalog
        </span>
        <span className="text-[10px] font-mono text-[#7E8BB5]">
          {/* "—" before the fetch resolves; a count only once it has. */}
          {shown === null ? '—' : `${shown.length} provider(s)`}
        </span>
      </div>

      {shown === null && !attempted && (
        <div className="rounded-xl border border-[#1A1D34] bg-[#05060C] px-4 py-5 text-[11px] font-mono text-[#7E8BB5]">
          Loading catalog…
        </div>
      )}

      {error && attempted && (
        <div className="rounded-xl border border-[#E8A845]/30 bg-[#E8A845]/[0.06] px-4 py-3 text-[11px] leading-relaxed text-[#E8A845]">
          Could not read the model catalog: {error}
        </div>
      )}

      {shown?.map((provider) => (
        <div key={provider.providerId} className="rounded-xl border border-[#1A1D34] bg-[#05060C] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">{provider.displayName}</span>
                <span className="text-[9px] font-mono text-[#7E8BB5] uppercase">{provider.family}</span>
                {provider.execution === 'RECOGNIZED' && (
                  <span className="rounded border border-[#7E8BB5]/40 bg-[#7E8BB5]/10 px-1.5 py-0.5 text-[9px] font-mono font-bold text-[#7E8BB5]">
                    NO EXECUTION MAPPING
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[10px] font-mono text-[#6A7196]">
                Provider state: <strong className="text-[#9C97B4]">{provider.providerState}</strong>
                {provider.credentialEnvVar && (
                  <> · credential {provider.credentialPresent ? 'present' : 'absent'} ({provider.credentialEnvVar})</>
                )}
              </div>
            </div>
            <span className="text-[10px] font-mono text-[#7E8BB5]">
              {provider.modelCount} model{provider.modelCount === 1 ? '' : 's'}
            </span>
          </div>

          {provider.note && (
            <p className="flex items-start gap-2 text-[10px] leading-relaxed text-[#6A7196]">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-[#7E8BB5]" />
              {provider.note}
            </p>
          )}

          {provider.models.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#1A1D34] px-3 py-4 text-center">
              <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#7E8BB5]">
                No catalogued models
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[10px] leading-relaxed text-[#6A7196]">
                This build has no execution mapping for {provider.displayName}, so no model is listed. Naming
                one here would claim a model that cannot be dispatched.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {provider.models.map((model) => (
                <div
                  key={model.modelId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#161828] bg-[#090B18] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-bold text-white">{model.modelId}</span>
                      {model.isProviderDefault && (
                        <span className="rounded border border-[#615EFF]/40 bg-[#615EFF]/15 px-1.5 py-0.5 text-[9px] font-mono font-bold text-[#A5A2FF]">
                          ROUTED DEFAULT
                        </span>
                      )}
                      {model.deprecated && (
                        <span className="rounded border border-[#E8A845]/40 bg-[#E8A845]/10 px-1.5 py-0.5 text-[9px] font-mono font-bold text-[#E8A845]">
                          DEPRECATED
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[9px] font-mono text-[#6A7196]">
                      {model.displayName !== model.modelId && <>{model.displayName} · </>}
                      {model.capabilityTags.join(' · ') || 'no capability tags'}
                    </div>
                  </div>
                  <AvailabilityChip availability={model.availability} />
                </div>
              ))}

              {provider.acceptsUncataloguedIds && (
                <p className="pt-1 text-[10px] leading-relaxed text-[#6A7196]">
                  The router accepts other {provider.displayName} model ids beyond those listed, so this list is
                  not exhaustive. An id it does not recognise is answered by {provider.displayName} at call time.
                </p>
              )}
            </div>
          )}
        </div>
      ))}

      {shown?.length === 0 && attempted && !error && (
        <div className="rounded-xl border border-dashed border-[#1A1D34] bg-[#05060C] px-4 py-5 text-center text-[11px] font-mono text-[#7E8BB5]">
          No provider matched.
        </div>
      )}
    </div>
  );
};
