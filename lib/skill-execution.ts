// ---------------------------------------------------------------------------
// Pass V / Workstream E — real skill execution.
//
// This is deliberately NOT a generic "magic executor" (E2). Every branch
// below dispatches to a concrete, real target: the existing model-router
// identity + a real Gemini call, one of a tiny explicit deterministic
// whitelist, a real MCP tool call, or the honestly-unimplemented Hermes
// runtime. No branch ever fabricates a result — a failure at any target
// returns a real failure, never a fake success.
//
// SKILLS_RECEIPT_INTEGRATION: NO — by design, not oversight. The existing
// task/artifact/Aegis/receipt spine (/api/execute-agent-task) is shaped for
// a specific product concept (an autonomous agent persona that writes a
// Vault artifact). Forcing every skill call — including a read-only
// "search memory" deterministic action — through that spine would be a
// worse architectural fit than the one it replaces. Every skill execution
// IS still recorded, in lib/runtime-events.ts's `runtime_events` ledger,
// so nothing is untracked — see docs/adr-005-runtime-provider-boundaries.md.
// ---------------------------------------------------------------------------

import { GoogleGenAI } from '@google/genai';
import { getWorkspaceSkill, classifySkillExecutability, getRawCredentialCiphertext, DeterministicAction } from './skills';
import { classifyModelRequest } from './model-router';
import { decryptCredential, probeMcpServer, readBoundedText } from './mcp-client';
import { searchWorkspaceMemory } from './memory-index';
import { listWorkspaceVaultEntries } from './vault';
import { recordRuntimeEvent } from './runtime-events';
import { hermesAdapter } from '../src/services/hermesAdapter';
import { submitAndAwaitExternalExecution } from './external-executions';

export interface SkillExecutionResult {
  success: boolean;
  status: 'SUCCESS' | 'FAILED' | 'NOT_EXECUTABLE' | 'NOT_IMPLEMENTED';
  targetType: string | null;
  output?: unknown;
  error?: string;
  latencyMs: number;
}

const EXECUTE_TIMEOUT_MS = 15000;

export async function executeSkill(
  workspaceId: string,
  skillId: string,
  input: { prompt?: string; query?: string; windmillInput?: Record<string, unknown> } = {},
  actorUserId: string = 'unknown'
): Promise<SkillExecutionResult | null> {
  const skill = getWorkspaceSkill(workspaceId, skillId);
  if (!skill) return null;

  const startedAt = Date.now();
  const executability = classifySkillExecutability(skill);
  if (!executability.executable) {
    const result: SkillExecutionResult = {
      success: false,
      status: 'NOT_EXECUTABLE',
      targetType: skill.execution_target_type,
      error: executability.message,
      latencyMs: Date.now() - startedAt,
    };
    recordRuntimeEvent({
      workspaceId, eventType: 'SKILL_EXECUTION', targetType: 'skill', targetId: skillId,
      status: 'FAILED', latencyMs: result.latencyMs,
      detail: { reason: executability.reason, targetType: skill.execution_target_type },
    });
    return result;
  }

  try {
    switch (skill.execution_target_type) {
      case 'deterministic':
        return await runDeterministicAction(workspaceId, skillId, skill.execution_target_ref as DeterministicAction, input, startedAt);
      case 'model':
        return await runModelAction(workspaceId, skillId, skill.execution_target_ref, input, startedAt);
      case 'mcp_tool':
        return await runMcpToolAction(workspaceId, skillId, skill.source_ref!, skill.execution_target_ref!, startedAt);
      case 'windmill':
        return await runWindmillAction(workspaceId, skillId, skill.execution_target_ref!, input.windmillInput || {}, actorUserId, startedAt);
      case 'hermes_runtime': {
        // Always honestly NOT_IMPLEMENTED — hermesAdapter.execute() is a
        // real stub, never a fake success (E5).
        const hermesResult = await hermesAdapter.execute({} as any);
        const result: SkillExecutionResult = {
          success: false,
          status: 'NOT_IMPLEMENTED',
          targetType: 'hermes_runtime',
          error: (hermesResult as any)?.error || 'Hermes runtime execute() is not implemented.',
          latencyMs: Date.now() - startedAt,
        };
        recordRuntimeEvent({
          workspaceId, eventType: 'SKILL_EXECUTION', targetType: 'skill', targetId: skillId,
          status: 'NOT_IMPLEMENTED', latencyMs: result.latencyMs, detail: { targetType: 'hermes_runtime' },
        });
        return result;
      }
      default:
        return {
          success: false, status: 'NOT_EXECUTABLE', targetType: skill.execution_target_type,
          error: 'Unrecognized execution target type.', latencyMs: Date.now() - startedAt,
        };
    }
  } catch (err: any) {
    const result: SkillExecutionResult = {
      success: false,
      status: 'FAILED',
      targetType: skill.execution_target_type,
      error: err?.message || 'Unknown execution error.',
      latencyMs: Date.now() - startedAt,
    };
    recordRuntimeEvent({
      workspaceId, eventType: 'SKILL_EXECUTION', targetType: 'skill', targetId: skillId,
      status: 'FAILED', latencyMs: result.latencyMs,
      detail: { targetType: skill.execution_target_type, error: result.error },
    });
    return result;
  }
}

async function runDeterministicAction(
  workspaceId: string, skillId: string, action: DeterministicAction,
  input: { query?: string }, startedAt: number
): Promise<SkillExecutionResult> {
  let output: unknown;
  switch (action) {
    case 'vault.list':
      output = listWorkspaceVaultEntries(workspaceId, 50);
      break;
    case 'memory.search':
      output = searchWorkspaceMemory(workspaceId, input.query || '', 20);
      break;
    default:
      throw new Error(`Unrecognized deterministic action "${action}".`);
  }
  const result: SkillExecutionResult = {
    success: true, status: 'SUCCESS', targetType: 'deterministic', output, latencyMs: Date.now() - startedAt,
  };
  recordRuntimeEvent({
    workspaceId, eventType: 'SKILL_EXECUTION', targetType: 'skill', targetId: skillId,
    status: 'SUCCESS', latencyMs: result.latencyMs, detail: { targetType: 'deterministic', action },
  });
  return result;
}

/**
 * Model-backed execution. A single, real Gemini call via the GoogleGenAI
 * SDK — no candidate-model failover list (that's server.ts's
 * `/api/generate` UX choice for a chat surface; a skill's declared target
 * is explicit, so a failure here is reported honestly rather than silently
 * substituting a different model than the one configured). Provider
 * identity is preserved: classifyModelRequest must have already resolved
 * to GEMINI (checked by classifySkillExecutability before this runs).
 */
async function runModelAction(
  workspaceId: string, skillId: string, modelRef: string | null,
  input: { prompt?: string }, startedAt: number
): Promise<SkillExecutionResult> {
  const prompt = input.prompt || '';
  if (!prompt.trim()) {
    throw new Error('A "prompt" is required to execute a model-backed skill.');
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');

  const classification = classifyModelRequest(modelRef || undefined);
  if (classification.provider !== 'GEMINI') {
    throw new Error(classification.message);
  }
  const model = classification.resolvedModel;
  const ai = new GoogleGenAI({ apiKey });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXECUTE_TIMEOUT_MS);
  let text = '';
  try {
    const response = await ai.models.generateContent({ model, contents: prompt });
    text = response.text || '';
  } finally {
    clearTimeout(timer);
  }

  if (!text.trim()) {
    throw new Error(`Model "${model}" returned an empty response.`);
  }

  const result: SkillExecutionResult = {
    success: true, status: 'SUCCESS', targetType: 'model', output: { model, text }, latencyMs: Date.now() - startedAt,
  };
  recordRuntimeEvent({
    workspaceId, eventType: 'SKILL_EXECUTION', targetType: 'skill', targetId: skillId,
    status: 'SUCCESS', latencyMs: result.latencyMs, detail: { targetType: 'model', model },
  });
  return result;
}

async function runMcpToolAction(
  workspaceId: string, skillId: string, endpointUrl: string, toolName: string, startedAt: number
): Promise<SkillExecutionResult> {
  const ciphertext = getRawCredentialCiphertext(workspaceId, skillId);
  const credential = ciphertext ? decryptCredential(ciphertext) : null;

  const probe = await probeMcpServer(endpointUrl, credential);
  if (probe.status !== 'CONNECTED') {
    const result: SkillExecutionResult = {
      success: false, status: 'FAILED', targetType: 'mcp_tool',
      error: probe.error || `MCP probe returned ${probe.status}.`, latencyMs: Date.now() - startedAt,
    };
    recordRuntimeEvent({
      workspaceId, eventType: 'SKILL_EXECUTION', targetType: 'skill', targetId: skillId,
      status: 'FAILED', latencyMs: result.latencyMs, detail: { targetType: 'mcp_tool', probeStatus: probe.status },
    });
    return result;
  }

  const toolExists = (probe.tools || []).some((t) => t.name === toolName);
  if (!toolExists) {
    const result: SkillExecutionResult = {
      success: false, status: 'FAILED', targetType: 'mcp_tool',
      error: `Tool "${toolName}" was not found among the ${probe.tools?.length || 0} tools this server reported.`,
      latencyMs: Date.now() - startedAt,
    };
    recordRuntimeEvent({
      workspaceId, eventType: 'SKILL_EXECUTION', targetType: 'skill', targetId: skillId,
      status: 'FAILED', latencyMs: result.latencyMs, detail: { targetType: 'mcp_tool', reason: 'TOOL_NOT_FOUND' },
    });
    return result;
  }

  // Real tools/call — connection already proven above; a real, minimal
  // JSON-RPC call for the confirmed tool.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXECUTE_TIMEOUT_MS);
  let body: any;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (credential) headers.Authorization = `Bearer ${credential}`;
    const res = await fetch(endpointUrl, {
      method: 'POST', headers, signal: controller.signal, redirect: 'error',
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: toolName, arguments: {} } }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // P — same response-size bound as every other MCP boundary call (see
    // lib/mcp-client.ts's readBoundedText).
    body = JSON.parse(await readBoundedText(res));
  } finally {
    clearTimeout(timer);
  }

  if (body?.error) {
    const result: SkillExecutionResult = {
      success: false, status: 'FAILED', targetType: 'mcp_tool',
      error: `tools/call: ${body.error.message}`, latencyMs: Date.now() - startedAt,
    };
    recordRuntimeEvent({
      workspaceId, eventType: 'SKILL_EXECUTION', targetType: 'skill', targetId: skillId,
      status: 'FAILED', latencyMs: result.latencyMs, detail: { targetType: 'mcp_tool' },
    });
    return result;
  }

  const result: SkillExecutionResult = {
    success: true, status: 'SUCCESS', targetType: 'mcp_tool', output: body?.result, latencyMs: Date.now() - startedAt,
  };
  recordRuntimeEvent({
    workspaceId, eventType: 'SKILL_EXECUTION', targetType: 'skill', targetId: skillId,
    status: 'SUCCESS', latencyMs: result.latencyMs, detail: { targetType: 'mcp_tool', tool: toolName },
  });
  return result;
}

/**
 * ADR-006 / H — a Windmill-targeted skill submits a real external job and
 * bounded-waits for it within this one request (E2 — no background poll).
 * Unlike every other branch in this file, a successful Windmill skill
 * execution DOES flow through the full task/Aegis/receipt pipeline (see
 * lib/external-executions.ts ingestExternalExecutionResult) — the prior
 * "skills never get a receipt" decision was about forcing a role-prompt
 * agent spine onto deterministic/MCP calls that don't fit it; an external
 * job that already produces a real artifact is exactly the shape that
 * spine exists for.
 */
async function runWindmillAction(
  workspaceId: string, skillId: string, targetId: string, windmillInput: Record<string, unknown>,
  actorUserId: string, startedAt: number
): Promise<SkillExecutionResult> {
  const execution = await submitAndAwaitExternalExecution({
    workspaceId, createdByUserId: actorUserId, targetId, input: windmillInput,
    skillId, idempotencyKey: `skill:${skillId}:${Date.now()}`,
  });

  if (execution.status !== 'SUCCEEDED') {
    const result: SkillExecutionResult = {
      success: false, status: 'FAILED', targetType: 'windmill',
      error: execution.error_message_safe || `Windmill execution ended in status "${execution.status}".`,
      latencyMs: Date.now() - startedAt,
    };
    recordRuntimeEvent({
      workspaceId, eventType: 'SKILL_EXECUTION', targetType: 'skill', targetId: skillId,
      status: 'FAILED', latencyMs: result.latencyMs, detail: { targetType: 'windmill', executionId: execution.id, remoteStatus: execution.status },
    });
    return result;
  }

  const verified = !!execution.result_receipt_id;
  const result: SkillExecutionResult = {
    success: verified, status: verified ? 'SUCCESS' : 'FAILED', targetType: 'windmill',
    output: { executionId: execution.id, taskId: execution.task_id, artifactId: execution.result_artifact_id, receiptId: execution.result_receipt_id, verified },
    error: verified ? undefined : 'Windmill job succeeded but SynthOS verification (Aegis) did not pass — no receipt was issued.',
    latencyMs: Date.now() - startedAt,
  };
  recordRuntimeEvent({
    workspaceId, eventType: 'SKILL_EXECUTION', targetType: 'skill', targetId: skillId,
    status: verified ? 'SUCCESS' : 'FAILED', latencyMs: result.latencyMs, detail: { targetType: 'windmill', executionId: execution.id, verified },
  });
  return result;
}
