// ---------------------------------------------------------------------------
// BUNDLED PROVIDER PLUGINS.
//
// A plugin is a versioned manifest (data, in ./manifests) that names one of the
// shared protocol adapters in ../protocols.ts. This list is the plugin install
// set — adding a provider that speaks an existing protocol means adding its
// manifest here, and nothing in the router, task system, spend guard,
// Guardian, ledger, receipts or UI. (It can also arrive as a signed JSON import
// or an Admin registration without any file here at all.)
//
// Installing a plugin never qualifies or enables a model.
// ---------------------------------------------------------------------------

import openai from './manifests/openai.json';
import gemini from './manifests/gemini.json';
import antigravity from './manifests/antigravity.json';
import anthropic from './manifests/anthropic.json';
import deepseek from './manifests/deepseek.json';
import perplexity from './manifests/perplexity.json';
import openrouter from './manifests/openrouter.json';

export interface BundledPlugin {
  providerId: string;
  manifest: unknown;
}

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = Object.freeze([
  { providerId: 'openai', manifest: openai },
  { providerId: 'gemini', manifest: gemini },
  { providerId: 'antigravity', manifest: antigravity },
  { providerId: 'anthropic', manifest: anthropic },
  { providerId: 'deepseek', manifest: deepseek },
  { providerId: 'perplexity', manifest: perplexity },
  { providerId: 'openrouter', manifest: openrouter },
]);
