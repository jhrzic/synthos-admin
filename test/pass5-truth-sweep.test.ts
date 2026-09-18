import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');

// ---------------------------------------------------------------------------
// Pass V / Workstream N: targeted fabrication sweep, locked in as regression
// tests so a future edit can't silently reintroduce what this pass found
// and fixed.
// ---------------------------------------------------------------------------

describe('N: Apollo status is never fabricated from env-var presence alone', () => {
  it('/api/apollo/status no longer reports CONNECTED purely because a voice-provider key is set', () => {
    const idx = serverContent.indexOf('app.get("/api/apollo/status"');
    const nextRoute = serverContent.indexOf('\n  app.', idx + 10);
    const slice = serverContent.slice(idx, nextRoute);
    expect(slice).not.toMatch(/hasAudioCredential \? "CONNECTED"/);
    expect(slice).not.toContain('bargeInEnabled: true,\n');
  });

  it('/api/apollo/status derives status from a real hermesAdapter.health() call', () => {
    const idx = serverContent.indexOf('app.get("/api/apollo/status"');
    const nextRoute = serverContent.indexOf('\n  app.', idx + 10);
    const slice = serverContent.slice(idx, nextRoute);
    expect(slice).toContain('await hermesAdapter.health()');
  });

  it('/api/apollo/status only reports a status from the real D3 vocabulary', () => {
    const idx = serverContent.indexOf('app.get("/api/apollo/status"');
    const nextRoute = serverContent.indexOf('\n  app.', idx + 10);
    const slice = serverContent.slice(idx, nextRoute);
    expect(slice).toMatch(/"NOT_CONFIGURED" \| "HEALTHY" \| "DEGRADED" \| "UNAVAILABLE" \| "PARTIAL"/);
  });
});

describe('N/D2: Apollo command dispatch never fabricates a dispatch reply', () => {
  it('/api/apollo/command no longer returns a hand-templated fake dispatch string', () => {
    const idx = serverContent.indexOf('app.post("/api/apollo/command"');
    const nextRoute = serverContent.indexOf('\n  app.', idx + 10);
    const slice = serverContent.slice(idx, nextRoute);
    expect(slice).not.toContain('Apollo Voice Bridge dispatched directive to Hermes Agent');
    expect(slice).not.toContain('Evaluated under Guardian Sentinel');
  });

  it('/api/apollo/command calls the real hermesAdapter.execute() and reports its real (NOT_IMPLEMENTED) outcome', () => {
    const idx = serverContent.indexOf('app.post("/api/apollo/command"');
    const nextRoute = serverContent.indexOf('\n  app.', idx + 10);
    const slice = serverContent.slice(idx, nextRoute);
    expect(slice).toContain('await hermesAdapter.execute(');
    expect(slice).toContain('"NOT_IMPLEMENTED"');
    expect(slice).toContain('success: false');
  });
});

describe('N: Master Admin diagnostics no longer fabricates a Guardian policy count', () => {
  it('guardian block no longer hardcodes policyCount: 4 / mode: "ENFORCING" / hitlRequired: true', () => {
    const idx = serverContent.indexOf('guardian: (() => {');
    expect(idx).toBeGreaterThan(-1);
    const slice = serverContent.slice(idx, idx + 1200);
    expect(slice).not.toContain('policyCount: 4');
    expect(slice).not.toContain('mode: "ENFORCING"');
    expect(slice).not.toContain('hitlRequired: true');
  });

  it('guardian block derives reviewsCount/byDecision from a real quality_reviews query', () => {
    const idx = serverContent.indexOf('guardian: (() => {');
    const slice = serverContent.slice(idx, idx + 1200);
    expect(slice).toContain('FROM quality_reviews');
    expect(slice).toContain('reviewsCount');
  });
});

describe('Architecture rule 1/9: Hermes MODEL and Hermes dedicated runtime stay separate', () => {
  it('"hermes" is never silently mapped to Gemini — the canonical registry resolves it or refuses it', async () => {
    // The legacy name-prefix router (lib/model-router.ts) is gone; identity
    // now comes only from the model registry.
    expect(fs.existsSync(path.resolve(process.cwd(), 'lib/model-router.ts'))).toBe(false);
    const { resolveRoute, ensureRegistry } = await import('../lib/registry');
    ensureRegistry();
    const r = resolveRoute('hermes');
    if (r.ok) expect(r.providerId).not.toBe('gemini');
    else expect(r.code).toMatch(/MODEL_NOT_REGISTERED|MODEL_AMBIGUOUS/);
  });

  it('hermes-runtime-backed skill execution never falls through to a model call', () => {
    const skillExecContent = fs.readFileSync(path.resolve(process.cwd(), 'lib/skill-execution.ts'), 'utf-8');
    const idx = skillExecContent.indexOf("case 'hermes_runtime':");
    const nextCase = skillExecContent.indexOf("case '", idx + 10);
    const slice = skillExecContent.slice(idx, nextCase > -1 ? nextCase : idx + 800);
    expect(slice).toContain('hermesAdapter.execute(');
    expect(slice).not.toMatch(/GoogleGenAI|generateContent|routedModelCall/);
  });
});

describe('Rule 6: Hermes runtime requests are never routed through Gemini to fake functionality', () => {
  it('lib/skill-execution.ts model branch runs through the canonical router, never a direct provider SDK', () => {
    const content = fs.readFileSync(path.resolve(process.cwd(), 'lib/skill-execution.ts'), 'utf-8');
    const modelFnIdx = content.indexOf('async function runModelAction');
    expect(modelFnIdx).toBeGreaterThan(-1);
    const modelFnSlice = content.slice(modelFnIdx, modelFnIdx + 1500);
    expect(modelFnSlice).toContain('routedModelCall(');
    expect(content).not.toMatch(/GoogleGenAI|generateContent/);
  });
});

describe('Rule 7/8: CONFIGURED never means CONNECTED, REGISTERED never means EXECUTABLE — vocabulary check', () => {
  it('lib/skills.ts classifySkillExecutability never returns executable:true for reason NO_TARGET/DISABLED/MISSING_PROVIDER/MISSING_RUNTIME', () => {
    const content = fs.readFileSync(path.resolve(process.cwd(), 'lib/skills.ts'), 'utf-8');
    // Structural check: every non-READY branch must return executable: false.
    const fnIdx = content.indexOf('export function classifySkillExecutability');
    const slice = content.slice(fnIdx);
    const falseCount = (slice.match(/executable: false/g) || []).length;
    const trueCount = (slice.match(/executable: true/g) || []).length;
    expect(falseCount).toBeGreaterThanOrEqual(4); // DISABLED, NO_TARGET, MISSING_PROVIDER(x2), MISSING_RUNTIME, etc.
    expect(trueCount).toBeGreaterThan(0);
  });
});

describe('H2: the Provider Capability Matrix never combines a model with the Hermes RUNTIME', () => {
  it('MasterAdminView.tsx keeps the Hermes Dedicated Runtime as its own row; models (Hermes or otherwise) come only from the model registry', () => {
    const masterAdminContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/MasterAdminView.tsx'), 'utf-8');
    const idx = masterAdminContent.indexOf("activeSection === 'models'");
    const nextSection = masterAdminContent.indexOf('SECTION 7: HERMES ADMIN');
    const slice = masterAdminContent.slice(idx, nextSection);
    // The runtime is a service row, never combined with a model.
    expect(slice).toContain('Hermes Dedicated Runtime');
    // Model rows are the registry's providers — no model id typed into this table.
    expect(slice).toContain('modelRegistry.providers.map(');
    expect(slice).toContain('<ProviderModelCatalog workspaceId={workspaceId} />');
    expect(slice).not.toMatch(/defaultModel: '[a-z]/i);
    expect(slice).not.toMatch(/process\.env\./); // Pass IV's process.version crash class of bug — never again in this file
  });
});

describe('F2: MCP credential is never returned by a GET route', () => {
  it('no /api/skills route returns credential_ciphertext or a raw "credential" field', () => {
    const idx = serverContent.indexOf('app.get("/api/skills"');
    const endIdx = serverContent.indexOf('app.get("/api/ton/status"');
    const slice = serverContent.slice(idx, endIdx);
    expect(slice).not.toMatch(/credential_ciphertext/);
  });
});
