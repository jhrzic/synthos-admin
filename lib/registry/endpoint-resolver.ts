// Thin bridge so adapters can resolve an endpoint by provider id without
// importing the whole registry facade.
import { ensureRegistry } from './install';
import { getProviderBody } from './store';
import { resolveProviderEndpoint, type EndpointResolution } from './endpoints';

export function resolveRegistryEndpoint(providerId: string): EndpointResolution {
  ensureRegistry();
  const body = getProviderBody(providerId);
  if (!body) return { ok: false, envVar: null, reason: `provider "${providerId}" is not installed in the registry` };
  return resolveProviderEndpoint(body);
}
