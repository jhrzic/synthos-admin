import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-intent-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;
delete process.env.GEMINI_API_KEY;
delete process.env.WINDMILL_BASE_URL;

import { classifyIntent } from '../lib/fabric/intent';

// ---------------------------------------------------------------------------
// STEP 5 — intent classifier tests. Every prompt below is one of the exact
// required examples. This file is the direct proof that the classifier
// distinguishes "research the latest AI task-automation repos" (an action
// requiring live data) from "show me my tasks" (an internal READ) — the
// literal keyword-collision bug this step exists to fix in
// /api/jarvis/command's `lower.includes("task")` routing (server.ts). This
// file does NOT wire into that route — Step 6 does.
// ---------------------------------------------------------------------------

describe('CONVERSATIONAL_QUERY / internal READ: "show me my tasks"', () => {
  it('maps to an internal READ capability, never an external action', async () => {
    const result = await classifyIntent('show me my tasks');
    expect(['CONVERSATIONAL_QUERY', 'ACTION_REQUEST']).toContain(result.intentType);
    expect(result.capability).toBe('task.read');
    expect(result.requiresLiveData).toBe(false);
  });
});

describe('the keyword-collision fix: "research the latest AI task-automation repos"', () => {
  it('is ACTION_REQUEST with requiresLiveData=true, and does NOT route to task.read', async () => {
    const result = await classifyIntent('research the latest AI task-automation repos');
    expect(result.intentType).toBe('ACTION_REQUEST');
    expect(result.requiresLiveData).toBe(true);
    expect(result.capability).not.toBe('task.read');
  });

  it('a genuine task-read request with a similar surface word does not falsely match either', async () => {
    const taskRead = await classifyIntent('list my tasks');
    expect(taskRead.capability).toBe('task.read');
    const research = await classifyIntent('research the latest task-automation tooling');
    expect(research.capability).not.toBe('task.read');
  });
});

describe('"save this to the Vault" -> ACTION_REQUEST + vault.write', () => {
  it('classifies correctly', async () => {
    const result = await classifyIntent('save this to the Vault');
    expect(result.intentType).toBe('ACTION_REQUEST');
    expect(result.capability).toBe('vault.write');
  });
});

describe('"publish this" -> APPROVAL_REQUIRED_ACTION', () => {
  it('classifies as requiring approval', async () => {
    const result = await classifyIntent('publish this');
    expect(result.intentType).toBe('APPROVAL_REQUIRED_ACTION');
  });
});

describe('"delete production data" -> BLOCKED_ACTION', () => {
  it('classifies as blocked, per canonical Guardian-equivalent policy', async () => {
    const result = await classifyIntent('delete production data');
    expect(result.intentType).toBe('BLOCKED_ACTION');
    expect(result.riskTier).toBe('CRITICAL');
  });
});

describe('"what is a transformer?" -> CONVERSATIONAL_QUERY', () => {
  it('classifies as plain conversation, no live-data requirement', async () => {
    const result = await classifyIntent('what is a transformer?');
    expect(result.intentType).toBe('CONVERSATIONAL_QUERY');
    expect(result.requiresLiveData).toBe(false);
  });
});

describe('"what are the latest transformer repos?" -> requiresLiveData, BLOCKED given no real research capability', () => {
  it('classifies requiresLiveData=true and refuses rather than answering from static knowledge', async () => {
    const result = await classifyIntent('what are the latest transformer repos?');
    expect(result.requiresLiveData).toBe(true);
    expect(result.intentType).toBe('BLOCKED_ACTION');
  });
});

describe('"schedule this for tomorrow" -> ACTION_REQUEST mapped to schedule (real as of Step 7)', () => {
  it('classifies as an action request against the schedule capability', async () => {
    const result = await classifyIntent('schedule this for tomorrow');
    expect(result.intentType).toBe('ACTION_REQUEST');
    expect(result.capability).toBe('schedule');
    expect(result.parameters.when).toBe('tomorrow');
  });
});

describe('bounded riskTier and confidence vocabulary', () => {
  it('riskTier is always one of the 5 allowed values', async () => {
    const prompts = ['what is a transformer?', 'delete production data', 'publish this', 'save this to the Vault', 'show me my tasks'];
    const allowed = new Set(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    for (const p of prompts) {
      const r = await classifyIntent(p);
      expect(allowed.has(r.riskTier), `"${p}" produced unrecognized riskTier "${r.riskTier}"`).toBe(true);
    }
  });

  it('confidence is always one of LOW/MEDIUM/HIGH', async () => {
    const prompts = ['what is a transformer?', 'asdkjaslkdj random gibberish text', 'schedule this for tomorrow'];
    const allowed = new Set(['LOW', 'MEDIUM', 'HIGH']);
    for (const p of prompts) {
      const r = await classifyIntent(p);
      expect(allowed.has(r.confidence)).toBe(true);
    }
  });

  it('intentType is always one of the 4 allowed values', async () => {
    const prompts = ['what is a transformer?', 'delete production data', 'publish this', 'save this to the Vault', 'show me my tasks', 'gibberish nonsense text here'];
    const allowed = new Set(['CONVERSATIONAL_QUERY', 'ACTION_REQUEST', 'APPROVAL_REQUIRED_ACTION', 'BLOCKED_ACTION']);
    for (const p of prompts) {
      const r = await classifyIntent(p);
      expect(allowed.has(r.intentType), `"${p}" produced unrecognized intentType "${r.intentType}"`).toBe(true);
    }
  });
});

describe('empty/degenerate input never fabricates an action', () => {
  it('empty string is a safe CONVERSATIONAL_QUERY, not an action', async () => {
    const result = await classifyIntent('');
    expect(result.intentType).toBe('CONVERSATIONAL_QUERY');
    expect(result.capability).toBeNull();
  });
});
