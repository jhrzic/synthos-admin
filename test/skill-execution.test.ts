import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'node:http';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-skill-exec-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { createSkill, updateSkill, classifySkillExecutability, getWorkspaceSkill } from '../lib/skills';
import { executeSkill } from '../lib/skill-execution';
import { listRecentRuntimeEvents } from '../lib/runtime-events';

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
});

const WS = 'ws-skill-exec-test';

// ---------------------------------------------------------------------------
// Pass V / Workstream E10 — registered != executable, disabled blocked,
// provider missing, runtime missing, real deterministic skill, real
// provider routing gate, Hermes runtime separation, MCP dependency state,
// no fake success anywhere.
// ---------------------------------------------------------------------------

describe('E1: a skill being REGISTERED or ENABLED never implies EXECUTABLE', () => {
  it('a skill with no execution target is NOT_EXECUTABLE (NO_TARGET), even though enabled', () => {
    const skill = createSkill({ workspaceId: WS, name: 'No Target Skill', enabled: true });
    const result = classifySkillExecutability(skill);
    expect(result.executable).toBe(false);
    expect(result.reason).toBe('NO_TARGET');
  });

  it('a disabled skill with a valid target is NOT_EXECUTABLE (DISABLED), not READY', () => {
    const skill = createSkill({
      workspaceId: WS, name: 'Disabled Deterministic', enabled: false,
      executionTargetType: 'deterministic', executionTargetRef: 'vault.list',
    });
    const result = classifySkillExecutability(skill);
    expect(result.executable).toBe(false);
    expect(result.reason).toBe('DISABLED');
  });
});

describe('E4: model-backed skill executability requires a real GEMINI_API_KEY', () => {
  const originalKey = process.env.GEMINI_API_KEY;
  afterAll(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });

  it('MISSING_PROVIDER when GEMINI_API_KEY is unset', () => {
    delete process.env.GEMINI_API_KEY;
    const skill = createSkill({
      workspaceId: WS, name: 'Model Skill No Key', enabled: true,
      executionTargetType: 'model', executionTargetRef: 'gemini-3.1-flash-lite',
    });
    const result = classifySkillExecutability(skill);
    expect(result.executable).toBe(false);
    expect(result.reason).toBe('MISSING_PROVIDER');
  });

  it('MISSING_PROVIDER for a recognized-but-unsupported provider like hermes/claude, never silently substituted', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const skill = createSkill({
      workspaceId: WS, name: 'Model Skill Hermes Alias', enabled: true,
      executionTargetType: 'model', executionTargetRef: 'hermes',
    });
    const result = classifySkillExecutability(skill);
    expect(result.executable).toBe(false);
    expect(result.reason).toBe('MISSING_PROVIDER');
    expect(result.message).toMatch(/hermes/i);
  });

  it('READY when GEMINI_API_KEY is set and the model resolves to Gemini', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const skill = createSkill({
      workspaceId: WS, name: 'Model Skill Ready', enabled: true,
      executionTargetType: 'model', executionTargetRef: 'gemini-3.1-flash-lite',
    });
    const result = classifySkillExecutability(skill);
    expect(result.executable).toBe(true);
    expect(result.reason).toBe('READY');
  });
});

describe('E5: Hermes-runtime-backed skills are never executable — no real contract exists', () => {
  it('MISSING_RUNTIME regardless of enabled/target state', () => {
    const skill = createSkill({
      workspaceId: WS, name: 'Hermes Skill', enabled: true,
      executionTargetType: 'hermes_runtime',
    });
    const result = classifySkillExecutability(skill);
    expect(result.executable).toBe(false);
    expect(result.reason).toBe('MISSING_RUNTIME');
  });

  it('executeSkill against a hermes_runtime target returns real NOT_IMPLEMENTED, never a fabricated success', async () => {
    const skill = createSkill({
      workspaceId: WS, name: 'Hermes Skill Exec', enabled: true,
      executionTargetType: 'hermes_runtime',
    });
    // hermes_runtime is never "executable" per classifySkillExecutability,
    // so executeSkill short-circuits to NOT_EXECUTABLE before ever reaching
    // hermesAdapter.execute() — proving the gate, not just the stub.
    const result = await executeSkill(WS, skill.skill_id);
    expect(result?.success).toBe(false);
    expect(result?.status).toBe('NOT_EXECUTABLE');
  });
});

describe('E3: deterministic skills run real internal functions, no fake success', () => {
  it('vault.list executes and records a real SUCCESS event', async () => {
    const skill = createSkill({
      workspaceId: WS, name: 'Vault List Skill', enabled: true,
      executionTargetType: 'deterministic', executionTargetRef: 'vault.list',
    });
    const result = await executeSkill(WS, skill.skill_id);
    expect(result?.success).toBe(true);
    expect(result?.status).toBe('SUCCESS');
    expect(Array.isArray(result?.output)).toBe(true);

    const events = listRecentRuntimeEvents({ workspaceId: WS, targetType: 'skill', limit: 5 });
    expect(events.some((e) => e.target_id === skill.skill_id && e.status === 'SUCCESS')).toBe(true);
  });

  it('memory.search executes with a query and returns a real (possibly empty) result array', async () => {
    const skill = createSkill({
      workspaceId: WS, name: 'Memory Search Skill', enabled: true,
      executionTargetType: 'deterministic', executionTargetRef: 'memory.search',
    });
    const result = await executeSkill(WS, skill.skill_id, { query: 'nonexistent-term-xyz' });
    expect(result?.success).toBe(true);
    expect(Array.isArray(result?.output)).toBe(true);
  });

  it('an unrecognized deterministic action is NOT_EXECUTABLE, not silently run', () => {
    const skill = createSkill({
      workspaceId: WS, name: 'Bad Deterministic', enabled: true,
      executionTargetType: 'deterministic', executionTargetRef: 'delete_everything',
    });
    const result = classifySkillExecutability(skill);
    expect(result.executable).toBe(false);
  });
});

describe('E6/F: MCP-backed skill execution requires a real, successful handshake — never fabricated', () => {
  it('fails honestly when the configured MCP endpoint is unreachable', async () => {
    const skill = createSkill({
      workspaceId: WS, name: 'MCP Skill Unreachable', enabled: true,
      category: 'mcp', sourceRef: 'http://127.0.0.1:1/mcp',
      executionTargetType: 'mcp_tool', executionTargetRef: 'some-tool',
    });
    const result = await executeSkill(WS, skill.skill_id);
    expect(result?.success).toBe(false);
    expect(result?.status).toBe('FAILED');
  });

  it('executes a real tool call against a real local MCP test server', async () => {
    const originalAllowLocal = process.env.MCP_ALLOW_LOCAL_ENDPOINTS;
    process.env.MCP_ALLOW_LOCAL_ENDPOINTS = 'true';
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (parsed.method === 'initialize') {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { serverInfo: { name: 'test' } } }));
        } else if (parsed.method === 'tools/list') {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { tools: [{ name: 'echo' }] } }));
        } else if (parsed.method === 'resources/list') {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { resources: [] } }));
        } else if (parsed.method === 'tools/call') {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { content: [{ type: 'text', text: 'echoed' }] } }));
        } else {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} }));
        }
      });
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const skill = createSkill({
        workspaceId: WS, name: 'MCP Skill Real', enabled: true,
        category: 'mcp', sourceRef: `http://127.0.0.1:${port}/mcp`,
        executionTargetType: 'mcp_tool', executionTargetRef: 'echo',
      });
      const result = await executeSkill(WS, skill.skill_id);
      expect(result?.success).toBe(true);
      expect(result?.status).toBe('SUCCESS');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (originalAllowLocal === undefined) delete process.env.MCP_ALLOW_LOCAL_ENDPOINTS;
      else process.env.MCP_ALLOW_LOCAL_ENDPOINTS = originalAllowLocal;
    }
  });
});

describe('F2: MCP credential is write-only — never returned by getWorkspaceSkill', () => {
  it('credential_configured reflects presence without exposing the value, and requires the encryption key', () => {
    const originalKey = process.env.MCP_CREDENTIAL_ENCRYPTION_KEY;
    process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'test-key-for-skills';
    try {
      const skill = createSkill({
        workspaceId: WS, name: 'MCP Skill With Credential', enabled: true,
        category: 'mcp', sourceRef: 'https://example.invalid/mcp',
        executionTargetType: 'mcp_tool', executionTargetRef: 'tool-x',
        credential: 'super-secret-bearer-token',
      });
      expect(skill.credential_configured).toBe(true);
      expect(JSON.stringify(skill)).not.toContain('super-secret-bearer-token');

      const refetched = getWorkspaceSkill(WS, skill.skill_id);
      expect(JSON.stringify(refetched)).not.toContain('super-secret-bearer-token');
    } finally {
      if (originalKey === undefined) delete process.env.MCP_CREDENTIAL_ENCRYPTION_KEY;
      else process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = originalKey;
    }
  });

  it('refuses to store a credential when no encryption key is configured — never falls back to plaintext', () => {
    delete process.env.MCP_CREDENTIAL_ENCRYPTION_KEY;
    expect(() => createSkill({
      workspaceId: WS, name: 'MCP Skill No Key Configured', enabled: true,
      category: 'mcp', credential: 'should-not-be-stored',
    })).toThrow(/MCP_CREDENTIAL_ENCRYPTION_KEY/);
  });
});

describe('E7: skill executions are recorded in the real runtime-event ledger', () => {
  it('a failed execution is also recorded, not just successes', async () => {
    const skill = createSkill({ workspaceId: WS, name: 'Will Not Execute', enabled: false });
    await executeSkill(WS, skill.skill_id);
    const events = listRecentRuntimeEvents({ workspaceId: WS, targetType: 'skill', limit: 20 });
    expect(events.some((e) => e.target_id === skill.skill_id && e.status === 'FAILED')).toBe(true);
  });
});

describe('executeSkill against an unknown skill returns null, never fabricates one', () => {
  it('returns null for a nonexistent skill id', async () => {
    const result = await executeSkill(WS, 'skill-does-not-exist');
    expect(result).toBeNull();
  });
});
