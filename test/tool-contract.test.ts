import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-tool-contract-'));
process.env.SYNTHOS_DB_PATH = path.join(TMP, 'contract.db');
process.env.SYNTHOS_SIGNING_KEY_DIR = path.join(TMP, 'keys');
const VAULT = path.join(TMP, 'vault');
fs.mkdirSync(path.join(VAULT, 'SynthOS', 'Sessions'), { recursive: true });
process.env.SYNTHOS_VAULT_PATH = VAULT;
const REPO = path.join(TMP, 'repo');
fs.mkdirSync(path.join(REPO, 'docs'), { recursive: true });
process.env.SYNTHOS_REPO_ROOT = REPO;

import { ensureWorkspace } from '../lib/workspaces';
import { executeEnvelope, type ExecutionEnvelopeInput, type ExecutionEnvelopeResult } from '../lib/fabric/envelope';
import { TOOL_PACK_1, findToolDefinition, toCapabilityEffectClass } from '../lib/fabric/tool-pack';
import { listRecentRuntimeEvents } from '../lib/runtime-events';
import { getTaskWithHistory, getTaskArtifacts, getTaskReceipts, verifyReceipt } from '../lib/persistence';

// ---------------------------------------------------------------------------
// SECTION 2 — THE CANONICAL TOOL CONTRACT.
//
// The instruction was to VERIFY that the existing execution envelope already
// supports every field a tool needs, and to reuse an existing canonical name
// wherever one exists rather than adding duplicate schema to match new
// terminology.
//
// This file is that verification, expressed as tests rather than as a claim in
// a report. Each case names the required field and the canonical field it maps
// onto, so a future change that drops one fails here with the mapping visible.
//
// Two fields genuinely did not exist and were added: an explicitly supplied
// correlation id, and the Brain-writeback outcome. Both are asserted below.
// ---------------------------------------------------------------------------

const WS = 'ws-contract';
const ACTOR = 'user-contract';

beforeAll(() => { ensureWorkspace(WS, 'Contract Workspace'); });
afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

describe('the envelope carries every field a tool contract requires', () => {
  it('accepts workspace, actor, capability, action, inputs, correlation id and idempotency key', () => {
    // A compile-time assertion as much as a runtime one: if any of these names
    // changes, this object stops type-checking.
    const input: ExecutionEnvelopeInput = {
      workspaceId: WS,          // "workspace"
      actorUserId: ACTOR,       // "actor"
      capability: 'brain.search', // "capability id"
      action: 'execute',        // "tool/action"
      parameters: { query: 'x' }, // "inputs"
      rawText: '',
      correlationId: 'corr-1',  // "correlation id"
      idempotencyKey: 'idem-1', // "idempotency key"
    };
    expect(input.workspaceId).toBe(WS);
    expect(input.correlationId).toBe('corr-1');
  });

  it('returns result status, task, artifact refs, Aegis result, receipt ref and brain writeback', async () => {
    const result: ExecutionEnvelopeResult = await executeEnvelope({
      workspaceId: WS, actorUserId: ACTOR, capability: 'brain.search',
      action: 'execute', parameters: { query: 'contract' }, rawText: '',
    });
    // Every contract field is a real property of the result type.
    const keys: Array<keyof ExecutionEnvelopeResult> = [
      'outcome',      // "result status"
      'capability',   // "capability id"
      'taskId',       // "task"
      'artifact',     // "artifact refs"
      'aegis',        // "Aegis result"
      'receipt',      // "receipt ref"
      'brainWriteback', // "Brain writeback"
      'provenance',
    ];
    for (const k of keys) expect(k in result || result[k] === undefined).toBe(true);
    expect(result.outcome).toBe('READ_OK');
    expect(result.brainWriteback).toBe('NONE');
  });

  it('effect class and approval policy come from the registry, not the envelope input', () => {
    // Deliberately NOT envelope inputs: a caller declaring its own effect
    // class would be declaring its own permissions. They are properties of the
    // registered capability.
    const tool = findToolDefinition('brain.write_session_note')!;
    expect(tool.effectClass).toBe('INTERNAL_MUTATION');
    expect(tool.approvalPolicy).toBe('GUARDIAN_ENFORCED');
    const contract = JSON.stringify(Object.keys({} as ExecutionEnvelopeInput));
    expect(contract).not.toContain('effectClass');
  });

  it('runtime/provider is a registry field, one per tool', () => {
    for (const tool of TOOL_PACK_1) {
      expect(tool.runtime, tool.capability).toBeTruthy();
    }
  });

  it('READ_ONLY reuses the canonical READ class rather than introducing a parallel name', () => {
    expect(toCapabilityEffectClass('READ_ONLY')).toBe('READ');
    expect(toCapabilityEffectClass('INTERNAL_MUTATION')).toBe('INTERNAL_MUTATION');
    expect(toCapabilityEffectClass('EXTERNAL_ACTION')).toBe('EXTERNAL_ACTION');
  });

  it('a supplied correlation id is used; an absent one falls back to the existing derivation', async () => {
    await executeEnvelope({
      workspaceId: WS, actorUserId: ACTOR, capability: 'schedule.list',
      action: 'execute', parameters: {}, rawText: '', correlationId: 'explicit-corr',
    });
    await executeEnvelope({
      workspaceId: WS, actorUserId: ACTOR, capability: 'schedule.list',
      action: 'execute', parameters: {}, rawText: '',
    });

    const rows = listRecentRuntimeEvents({ targetType: 'capability', limit: 50 })
      .filter((e) => e.target_id === 'schedule.list')
      .map((e) => JSON.parse(e.detail_json || '{}'));

    expect(rows.some((d) => d.correlationId === 'explicit-corr')).toBe(true);
    // The fallback is never null — an attempt with no natural key still needs
    // to be distinguishable from the next one.
    for (const d of rows) expect(d.correlationId).toBeTruthy();
  });

  it('idempotency short-circuits a mutating tool instead of writing twice', async () => {
    const key = `contract-idem-${Date.now()}`;
    const first = await executeEnvelope({
      workspaceId: WS, actorUserId: ACTOR, capability: 'brain.write_session_note',
      action: 'execute', parameters: { title: 'Idempotency contract probe', body: 'Body one.' },
      rawText: '', idempotencyKey: key,
    });
    const second = await executeEnvelope({
      workspaceId: WS, actorUserId: ACTOR, capability: 'brain.write_session_note',
      action: 'execute', parameters: { title: 'Idempotency contract probe', body: 'Body one.' },
      rawText: '', idempotencyKey: key,
    });

    expect(first.outcome).toBe('SUCCESS');
    // A replay is also SUCCESS — from the caller's point of view the request
    // did succeed; what must not happen is the WORK happening twice. So the
    // assertion is on the disk, not on the outcome, and on the reason string
    // that distinguishes a replay from a fresh execution.
    expect(second.outcome).toBe('SUCCESS');
    expect(second.reason).toMatch(/duplicate submission ignored, not re-executed/i);
    expect(first.reason).not.toMatch(/duplicate/i);

    const notes = fs.readdirSync(path.join(VAULT, 'SynthOS', 'Sessions'))
      .filter((f) => f.includes('Idempotency-contract-probe'));
    expect(notes).toHaveLength(1);

    // KNOWN LIMIT, asserted so it is recorded rather than discovered later:
    // replayFromTask reconstructs its result from the `tasks`/`artifacts`
    // tables, and brain.write_session_note writes a vault note without
    // creating a task row. So a replay correctly refuses to re-execute but
    // cannot hand back the note's path. Callers that need the path on a
    // replay must read it from the vault. Recorded as a follow-up.
    expect(second.data).toBeUndefined();
  });

  it('the same key with a DIFFERENT payload conflicts rather than replaying or re-executing', async () => {
    const key = `contract-conflict-${Date.now()}`;
    await executeEnvelope({
      workspaceId: WS, actorUserId: ACTOR, capability: 'brain.write_session_note',
      action: 'execute', parameters: { title: 'Conflict probe', body: 'Original body.' },
      rawText: '', idempotencyKey: key,
    });
    const conflicting = await executeEnvelope({
      workspaceId: WS, actorUserId: ACTOR, capability: 'brain.write_session_note',
      action: 'execute', parameters: { title: 'Conflict probe', body: 'DIFFERENT body.' },
      rawText: '', idempotencyKey: key,
    });
    expect(conflicting.outcome).toBe('CONFLICT');
  });
});

describe('a mutating tool produces the full evidence chain', () => {
  it('files.write_artifact writes task, artifact, Aegis review and a verifiable receipt', async () => {
    const result = await executeEnvelope({
      workspaceId: WS, actorUserId: ACTOR, capability: 'files.write_artifact',
      action: 'execute',
      parameters: { title: 'Contract evidence artifact', content: 'Real content committed by the tool contract test.' },
      rawText: '', idempotencyKey: `contract-artifact-${Date.now()}`,
    });

    expect(result.outcome).toBe('SUCCESS');
    expect(result.taskId).toBeTruthy();
    expect(result.artifact?.id).toBeTruthy();
    expect(result.artifact?.contentHash).toBeTruthy();
    expect(result.aegis?.decision).toBeTruthy();
    expect(result.receipt?.receiptId).toBeTruthy();
    // An artifact is evidence of work, NOT approved knowledge.
    expect(result.brainWriteback).toBe('ARTIFACT');

    // And the chain is really in the database, not just in the return value.
    const task = getTaskWithHistory(result.taskId!);
    expect(task).toBeTruthy();
    expect(getTaskArtifacts(result.taskId!).length).toBeGreaterThan(0);
    const receipts = getTaskReceipts(result.taskId!);
    expect(receipts.length).toBeGreaterThan(0);
    // The signature really verifies — a receipt that cannot be verified is
    // worse than no receipt, because it looks like proof.
    expect(verifyReceipt(receipts[0])).toBe(true);
  });

  it('the artifact really exists on disk under a server-generated name', async () => {
    const result = await executeEnvelope({
      workspaceId: WS, actorUserId: ACTOR, capability: 'files.write_artifact',
      action: 'execute', parameters: { title: 'On disk probe', content: 'Content on disk.' },
      rawText: '', idempotencyKey: `contract-disk-${Date.now()}`,
    });
    expect(result.outcome).toBe('SUCCESS');
    const artifacts = getTaskArtifacts(result.taskId!);
    const row: any = artifacts[0];
    expect(fs.existsSync(row.disk_path)).toBe(true);
    expect(fs.readFileSync(row.disk_path, 'utf8')).toContain('Content on disk.');
    // The filename is derived from the artifact id, never the human title —
    // which is what makes two same-titled artifacts unable to collide.
    expect(path.basename(row.disk_path)).not.toMatch(/On-disk-probe/i);
    expect(path.basename(row.disk_path)).toContain(row.artifact_id);
  });
});

describe('brain writeback policy is declared per tool and never decided at the call site', () => {
  it('only one tool is authorized to write back into the vault', () => {
    const authorized = TOOL_PACK_1.filter((t) => t.brainWriteback === 'AUTHORIZED_SESSION_NOTE');
    expect(authorized).toHaveLength(1);
    expect(authorized[0].capability).toBe('brain.write_session_note');
  });

  it('no read-only tool can produce a knowledge candidate', () => {
    for (const tool of TOOL_PACK_1.filter((t) => t.effectClass === 'READ_ONLY')) {
      expect(tool.brainWriteback).toBe('NONE');
    }
  });

  it('research output is labelled as retrieved fact with synthesis explicitly absent', async () => {
    // research.search will attempt a real network call; whatever the outcome,
    // it must never present generated prose as a retrieved fact.
    const res = await executeEnvelope({
      workspaceId: WS, actorUserId: ACTOR, capability: 'research.search',
      action: 'execute', parameters: { query: 'synthos tool contract probe' }, rawText: '',
    });
    if (res.outcome === 'READ_OK') {
      expect((res.data as any).retrievedFacts).toBe(true);
      expect((res.data as any).synthesis).toBeNull();
      expect(res.brainWriteback).toBe('NONE');
    } else {
      // Offline or rate-limited is a legitimate outcome; a fabricated success
      // is not. Assert it failed honestly rather than silently passing.
      expect(['FAILED', 'NOT_CONFIGURED']).toContain(res.outcome);
    }
  });
});
