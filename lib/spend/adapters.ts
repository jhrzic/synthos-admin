// ---------------------------------------------------------------------------
// Thin guard wrappers for call sites that talk to a provider SDK directly.
//
// Each wrapper runs exactly one paid request under lib/spend/guard.ts and
// converts a refusal into SpendBlockedError, so an existing try/catch at the
// call site reports "BLOCKED_BUDGET (...)" instead of a provider error. None of
// them retries, and none falls back to another model.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { guardedPaidCall, SpendBlockedError, normalizeGeminiUsage, contentChars, type PaidCallRequest } from './guard';
import { getSpendPolicy, type PaidProvider } from './policy';
import { geminiTermination } from '../fabric/output-contract';

export interface SpendContext {
  callSite: string;
  workspaceId?: string | null;
  taskId?: string | null;
  correlationId?: string | null;
  /** Defaults to a fresh key: one HTTP request / one human action = one logical execution. */
  idempotencyKey?: string;
  approvalId?: string | null;
  maxOutputTokens?: number;
}

export function requestKey(callSite: string): string {
  return `${callSite}:${crypto.randomUUID()}`;
}

/** The output ceiling a call sends to the provider: the caller's, or the policy's. */
export function outputCeiling(ctx: SpendContext): number {
  return ctx.maxOutputTokens ?? getSpendPolicy().task.maxOutputTokens;
}

/**
 * One guarded Gemini generateContent call. `args` is what the SDK takes; the
 * output ceiling is written into config.maxOutputTokens so the bound is sent
 * to the provider, not just assumed.
 */
export async function guardedGeminiGenerate(ai: any, args: { model: string; contents: any; config?: any }, ctx: SpendContext): Promise<any> {
  const maxOutputTokens = Math.min(args.config?.maxOutputTokens ?? outputCeiling(ctx), outputCeiling(ctx));
  const req: PaidCallRequest = {
    provider: 'gemini', model: args.model, callSite: ctx.callSite,
    workspaceId: ctx.workspaceId ?? null, taskId: ctx.taskId ?? null, correlationId: ctx.correlationId ?? null,
    idempotencyKey: ctx.idempotencyKey || requestKey(ctx.callSite),
    inputChars: contentChars(args.contents) + contentChars(args.config?.systemInstruction ?? ''),
    maxOutputTokens, approvalId: ctx.approvalId ?? null,
  };
  const r = await guardedPaidCall(req, async () => {
    const response = await ai.models.generateContent({ ...args, config: { ...(args.config || {}), maxOutputTokens } });
    const text = typeof response?.text === 'string' ? response.text : '';
    const t = geminiTermination(response, maxOutputTokens);
    return { ok: !!text.trim(), value: response, usage: normalizeGeminiUsage(response?.usageMetadata, response?.responseId ?? null), termination: `${t.status}${t.providerStatus ? `:${t.providerStatus}` : ''}${t.reason ? `:${t.reason}` : ''}` };
  });
  if (!r.permitted) throw new SpendBlockedError(r.code, r.reason);
  return r.outcome.value;
}

/**
 * One guarded speech-synthesis request. Priced per character (configure the
 * provider:model entry with unit "chars"). `send` performs the single fetch.
 */
export async function guardedSpeech(provider: Extract<PaidProvider, 'openai_tts' | 'elevenlabs' | 'fish_audio'>, model: string, text: string, ctx: SpendContext, send: () => Promise<Response>): Promise<Response> {
  const r = await guardedPaidCall<Response>({
    provider, model, callSite: ctx.callSite, workspaceId: ctx.workspaceId ?? null,
    idempotencyKey: ctx.idempotencyKey || requestKey(ctx.callSite), inputChars: text.length,
  }, async () => {
    const res = await send();
    return { ok: res.ok, value: res };
  });
  if (!r.permitted) throw new SpendBlockedError(r.code, r.reason);
  return r.outcome.value!;
}
