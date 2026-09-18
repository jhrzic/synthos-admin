// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Step 4: the one real Gemini call mechanics
// (candidate-model retry loop), extracted out of lib/fabric/kernel.ts so
// both the native /api/execute-agent-task kernel and graph execution's
// native COMPUTE nodes (server.ts POST /api/graphs/execute) share exactly
// one implementation instead of two.
//
// Deliberately narrow: no task/artifact/Aegis/receipt writes happen here,
// and nothing here knows about agent personas, graphs, or Jarvis — it only
// makes the real provider call against an already-built prompt and reports
// what happened. Callers wrap this in ctx.invoke("model.gemini", ...); this
// function itself never throws (every per-candidate and outer error is
// caught and reported via hadProviderError/lastProviderError), matching
// kernel.ts's pre-existing behavior byte-for-byte.
// ---------------------------------------------------------------------------

import { GoogleGenAI } from '@google/genai';
import { guardedGeminiGenerate, outputCeiling, type SpendContext } from '../spend/adapters';
import { geminiTermination, type ProviderTermination } from './output-contract';
import { SpendBlockedError } from '../spend/guard';
import { resolveRegistryEndpoint } from '../registry/endpoint-resolver';

/** Manifest base URLs carry the version path (…/v1beta); the SDK wants the origin. */
function sdkBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/v1(beta|alpha)?\/?$/, '');
}

export interface GenerateViaGeminiParams {
  apiKey: string;
  /** A prompt, or role-separated turns ({ role: 'user' | 'model', parts }). */
  contents: string | Array<{ role: string; parts: Array<{ text: string }> }>;
  /** systemInstruction / responseMimeType / tools, from the protocol adapter. */
  config?: Record<string, unknown>;
  candidateModels: string[];
  /** SPEND GUARD — required. Every Gemini generation is a paid call; see lib/spend/guard.ts. */
  spend: SpendContext;
  /** Registry-resolved base URL. Absent → resolved for the spend context's provider (default `gemini`). */
  baseUrl?: string;
}

export interface GenerateViaGeminiResult {
  output: string;
  modelUsed: string | null;
  providerUsageMetadata: any;
  hadProviderError: boolean;
  lastProviderError: string | null;
  /** Set when the spend guard refused the call; nothing was sent. */
  spendBlockedCode?: string | null;
  /** How the provider says the response ended (candidates[0].finishReason). */
  termination?: ProviderTermination;
  /** The provider payload (grounding metadata). Never placed in a prompt. */
  raw?: unknown;
}

export async function generateViaGemini(params: GenerateViaGeminiParams): Promise<GenerateViaGeminiResult> {
  const { apiKey, contents } = params;
  // NO_PAID_FALLBACK: one model per logical call (the first candidate).
  const m = params.candidateModels[0];
  let output = '';
  let modelUsed: string | null = null;
  let providerUsageMetadata: any = null;
  let hadProviderError = false;
  let lastProviderError: string | null = null;
  let spendBlockedCode: string | null = null;
  let termination: ProviderTermination = { status: 'NOT_REPORTED', providerStatus: null, reason: null };
  let raw: unknown = null;

  if (!m) return { output, modelUsed, providerUsageMetadata, hadProviderError: true, lastProviderError: 'No model was selected for this Gemini call.' };

  try {
    // Base URL from the ONE endpoint authority (lib/registry/endpoints.ts):
    // GEMINI_BASE_URL is honoured only for an approved/allow-listed host or an
    // authorized loopback test double, and an invalid override fails closed
    // here — before the credential is handed to the SDK.
    let baseUrl = params.baseUrl;
    if (!baseUrl) {
      const ep = resolveRegistryEndpoint(params.spend.providerId || 'gemini');
      if (!ep.ok) {
        return { output, modelUsed, providerUsageMetadata, hadProviderError: true, lastProviderError: `ENDPOINT_NOT_APPROVED: ${ep.reason}`, termination };
      }
      baseUrl = ep.baseUrl;
    }
    const ai = new GoogleGenAI({
      apiKey,
      // The SDK appends its own API version path to the host.
      httpOptions: { headers: { "User-Agent": "aistudio-build" }, baseUrl: sdkBaseUrl(baseUrl) },
    });
    const resp = await guardedGeminiGenerate(ai, { model: m, contents, config: { temperature: 0.2, ...(params.config || {}) } }, params.spend);
    raw = resp;
    termination = geminiTermination(resp, outputCeiling(params.spend));
    if (resp?.text && resp.text.trim().length > 0) {
      output = resp.text;
      modelUsed = m;
      if (resp.usageMetadata) providerUsageMetadata = resp.usageMetadata;
    } else {
      hadProviderError = true;
      lastProviderError = `Gemini model "${m}" returned no text.`;
    }
  } catch (e: any) {
    hadProviderError = true;
    lastProviderError = e?.message || String(e);
    if (e instanceof SpendBlockedError) spendBlockedCode = e.code;
    console.warn(`[Gemini] '${m}':`, lastProviderError);
  }

  return { output, modelUsed, providerUsageMetadata, hadProviderError, lastProviderError, spendBlockedCode, termination, raw };
}
