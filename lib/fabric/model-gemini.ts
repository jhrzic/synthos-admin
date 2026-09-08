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

export interface GenerateViaGeminiParams {
  apiKey: string;
  contents: string;
  candidateModels: string[];
}

export interface GenerateViaGeminiResult {
  output: string;
  modelUsed: string | null;
  providerUsageMetadata: any;
  hadProviderError: boolean;
  lastProviderError: string | null;
}

export async function generateViaGemini(params: GenerateViaGeminiParams): Promise<GenerateViaGeminiResult> {
  const { apiKey, contents, candidateModels } = params;
  let output = '';
  let modelUsed: string | null = null;
  let providerUsageMetadata: any = null;
  let hadProviderError = false;
  let lastProviderError: string | null = null;

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });

    for (const m of candidateModels) {
      try {
        const resp = await ai.models.generateContent({
          model: m,
          contents,
          config: { temperature: 0.2 },
        });
        if (resp?.text && resp.text.trim().length > 0) {
          output = resp.text;
          modelUsed = m;
          if (resp.usageMetadata) {
            providerUsageMetadata = resp.usageMetadata;
          }
          break;
        }
      } catch (e: any) {
        hadProviderError = true;
        lastProviderError = e?.message || String(e);
        console.warn(`[Agent Model Router] '${m}' failover:`, lastProviderError);
      }
    }
  } catch (genErr: any) {
    hadProviderError = true;
    lastProviderError = genErr?.message || String(genErr);
    console.warn("[Agent Task GenAI Error]:", lastProviderError);
  }

  return { output, modelUsed, providerUsageMetadata, hadProviderError, lastProviderError };
}
