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

export interface GenerateViaGeminiParams {
  apiKey: string;
  contents: string;
  candidateModels: string[];
  /** SPEND GUARD — required. Every Gemini generation is a paid call; see lib/spend/guard.ts. */
  spend: SpendContext;
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

  if (!m) return { output, modelUsed, providerUsageMetadata, hadProviderError: true, lastProviderError: 'No model was selected for this Gemini call.' };

  try {
    // GEMINI_BASE_URL — optional gateway / test-double override, same contract
    // as OPENAI_BASE_URL. lib/spend/network-guard.ts treats its host as paid,
    // so an override can never route around the spend guard.
    const baseUrl = (process.env.GEMINI_BASE_URL || '').trim();
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" }, ...(baseUrl ? { baseUrl } : {}) },
    });
    const resp = await guardedGeminiGenerate(ai, { model: m, contents, config: { temperature: 0.2 } }, params.spend);
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

  return { output, modelUsed, providerUsageMetadata, hadProviderError, lastProviderError, spendBlockedCode, termination };
}
