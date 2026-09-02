import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import { createSkill, getWorkspaceSkill, isValidMcpEndpointRef, testSkill } from '../lib/skills';

afterAll(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* best effort */ }
});

// ---------------------------------------------------------------------------
// Workstream F — MCP registry.
//
// F1 traced this repo: there is no separate "MCP Servers" concept anywhere
// distinct from the real Skills registry built in Pass II
// (lib/skills.ts) — a skill with category:'mcp' already has exactly the
// fields F2 asks for (id, workspace_id, name, source_type/source_ref as
// transport+endpoint, enabled, status, timestamps), is already real and
// persisted (not invented here), and its status is already never anything
// but NOT_CONFIGURED/NOT_IMPLEMENTED — CONFIGURED is never conflated with
// CONNECTED, because no live connection check exists to justify CONNECTED.
// This file adds the one genuinely missing, safely-scoped piece: URL shape
// validation for an HTTP(S) MCP endpoint reference (F2's "if HTTP/SSE
// transport exists: validate URLs"). A live network probe against a
// caller-supplied URL is deliberately NOT implemented — this deployment
// has no SSRF-safe proxy boundary for it yet (see ADR-001 §6, which itself
// treats the MCP proxy path as unverified/deferred), so building one now
// would be inventing infrastructure ahead of the documented plan.
// ---------------------------------------------------------------------------

const WORKSPACE = 'ws-mcp-registry';

describe('MCP registry (skills category:mcp): no invented servers, real persistence (1, 2)', () => {
  it('an mcp-category skill is a real, persisted record — not sample/invented data', () => {
    const skill = createSkill({
      workspaceId: WORKSPACE,
      name: 'real_mcp_server',
      category: 'mcp',
      sourceType: 'http',
      sourceRef: 'https://mcp.example.com/sse',
    });
    const fetched = getWorkspaceSkill(WORKSPACE, skill.skill_id);
    expect(fetched?.category).toBe('mcp');
    expect(fetched?.source_ref).toBe('https://mcp.example.com/sse');
  });
});

describe('MCP registry: secrets are never persisted in a UI-readable field (F2)', () => {
  it('the skill schema has no field for a token/API key/secret', () => {
    const skill = createSkill({ workspaceId: WORKSPACE, name: 'no_secret_field', category: 'mcp', sourceRef: 'https://mcp.example.com' });
    const keys = Object.keys(skill);
    expect(keys.some((k) => /secret|token|apikey|api_key|password/i.test(k))).toBe(false);
  });
});

describe('MCP registry: HTTP(S) endpoint URL validation (F2, invalid endpoint rejection)', () => {
  it('accepts a well-formed https URL', () => {
    expect(isValidMcpEndpointRef('https://mcp.example.com/sse')).toBe(true);
  });

  it('accepts a well-formed http URL', () => {
    expect(isValidMcpEndpointRef('http://localhost:8080/mcp')).toBe(true);
  });

  it('rejects a malformed http(s) URL', () => {
    expect(isValidMcpEndpointRef('https://')).toBe(false);
    expect(isValidMcpEndpointRef('http://')).toBe(false);
  });

  it('a non-URL sourceRef (e.g. a stdio command string) is left unvalidated — different transport shape', () => {
    expect(isValidMcpEndpointRef('npx some-mcp-server --stdio')).toBe(true);
  });
});

describe('MCP registry: CONFIGURED is never conflated with CONNECTED (F3)', () => {
  it('a newly created mcp skill has status NOT_CONFIGURED, never CONNECTED', () => {
    const skill = createSkill({ workspaceId: WORKSPACE, name: 'status_check', category: 'mcp', sourceRef: 'https://mcp.example.com' });
    expect(skill.status).toBe('NOT_CONFIGURED');
    expect(skill.status).not.toBe('CONNECTED');
  });

  it('testing an mcp skill never returns CONNECTED — no live probe exists, so it is honestly NOT_IMPLEMENTED', () => {
    const skill = createSkill({ workspaceId: WORKSPACE, name: 'probe_check', category: 'mcp', sourceRef: 'https://mcp.example.com' });
    const result = testSkill(WORKSPACE, skill.skill_id);
    expect(result?.status).toBe('NOT_IMPLEMENTED');
    expect(result?.message).not.toMatch(/connected/i);
  });
});

describe('MCP registry: workspace isolation applies exactly as it does for every other skill (F5)', () => {
  it('an mcp skill created in one workspace is invisible in another', () => {
    const skill = createSkill({ workspaceId: WORKSPACE, name: 'iso_check', category: 'mcp' });
    expect(getWorkspaceSkill('ws-mcp-other', skill.skill_id)).toBeNull();
  });
});
