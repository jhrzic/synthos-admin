import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// SynthOS Execution Fabric — Phase 0 (F1/F2/F3).
//
// Three separate, real fabrications removed from the actual repo (this repo
// has no document named "SynthOS Execution Fabric — Consolidated Spec,
// Revision 2" anywhere — docs/, vault/, and the broader ~/synthos tree were
// all searched; Phase 0's F1/F2/F3 requirements were given inline and are
// self-contained, so they did not depend on that missing document):
//
// F1 — server.ts's /api/execute-agent-task set toolCalls to a hardcoded,
//      role-specific literal array (e.g. ["web_search_grounding",
//      "rss_parser", "dom_inspector"] for "scout") naming tools that never
//      actually ran. No ctx.invoke (or any per-tool invocation mechanism)
//      exists anywhere in this codebase — confirmed by grep before this
//      change. toolCalls must stay [] until one does.
//
// F2 — src/App.tsx's handleAddNoteToVault() defaulted `tools`, `sources`,
//      `verification`, `decision`, `lesson`, and `provenance` to specific,
//      real-sounding fabrications (worst: "Passed Aegis Verification
//      (Score: 94/100)" and "SynthOS Client Node -> Local Obsidian
//      Storage") for a function that only ever calls setNotes() into React
//      state — no real Aegis review, no durable write. Defaults now state
//      the honest NOT_IMPLEMENTED/NOT_AVAILABLE/NOT_VERIFIED reality.
//
// F3 — src/services/hermesAdapter.ts (imported by both server.ts and,
//      through src/, the Vite client bundle) read HERMES_ADAPTER_TOKEN — a
//      server-to-server bearer secret per ADR-001 Decision 3 ("Never in
//      the repo") — from VITE_HERMES_ADAPTER_TOKEN as a browser fallback.
//      A VITE_-prefixed var is inlined into the client bundle at build
//      time and readable via devtools. Removed, with no replacement
//      client-side path.
// ---------------------------------------------------------------------------

const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
const appContent = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
const hermesAdapterContent = fs.readFileSync(path.resolve(process.cwd(), 'src/services/hermesAdapter.ts'), 'utf-8');
// STEP 1b relocated /api/execute-agent-task's logic out of server.ts into
// lib/fabric/kernel.ts (server.ts is now a thin adapter around it) — F1's
// logic-level assertions below read the kernel now. This file is not
// re-litigating that move (see test/fabric-characterization.test.ts and the
// Step 1b commit for that); it only updates F1's own assertions to point at
// where the logic actually lives today.
const kernelContent = fs.readFileSync(path.resolve(process.cwd(), 'lib/fabric/kernel.ts'), 'utf-8');

function executeAgentTaskRouteSlice(): string {
  const idx = serverContent.indexOf('app.post("/api/execute-agent-task"');
  expect(idx).toBeGreaterThan(-1);
  const nextRoute = serverContent.indexOf('\n  app.', idx + 10);
  return serverContent.slice(idx, nextRoute);
}

describe('F1: /api/execute-agent-task never claims a tool ran (originally server.ts:1452, now lib/fabric/kernel.ts post-Step-1b)', () => {
  it('SUPERSEDED BY STEP 1b, not re-broken: toolCalls is no longer a permanently-fixed empty array — it is derived from real ctx.invoke() observations, which is the honest mechanism F1\'s own comment said did not exist yet ("no real per-tool invocation mechanism... until one exists, this must never claim a tool ran"). One now exists, scoped to exactly one real call site.', () => {
    expect(kernelContent).toContain('toolCalls: ctx.getInvocations().map((r) => r.name),');
    // The historical Phase 0 literal is gone from the kernel — replaced by
    // the ctx.invoke-derived line above, not reintroduced as a second
    // fabrication.
    expect(kernelContent).not.toContain('const toolCalls: string[] = [];');
  });

  it('none of the seven previously-hardcoded fabricated tool names remain anywhere in the kernel', () => {
    const fabricatedToolNames = [
      'web_search_grounding', 'rss_parser', 'dom_inspector',
      'typescript_compiler', 'docker_sandbox_runner', 'latency_benchmarker',
      'distribution_modeler', 'viral_hook_generator', 'seo_aeo_indexer',
      'sql_telemetry_aggregator', 'token_economics_calculator', 'tam_matrix',
      'obsidian_vault_writer', 'wikilinks_mesh_generator', 'markdown_compiler',
      'guardian_aegis_auditor', 'cryptographic_signer', 'board_db_committer',
    ];
    for (const name of fabricatedToolNames) {
      expect(kernelContent).not.toContain(`"${name}"`);
    }
  });

  it('the real read_package_metadata() call is untouched — F1 removed a false claim, not a real capability, and Step 1b moved but did not alter it', () => {
    expect(kernelContent).toContain('const packageMetadataResult = read_package_metadata();');
  });

  it('the real ctx.invoke() call site in the kernel wraps the real existing Gemini retry loop, named "model.gemini" — not a fabricated or per-role tool name', () => {
    expect(kernelContent).toContain('await ctx.invoke("model.gemini", async () => {');
    // The wrapped block still contains the real, unchanged retry loop —
    // ctx.invoke() did not replace it with a different mechanism.
    const invokeIdx = kernelContent.indexOf('await ctx.invoke("model.gemini"');
    const wrappedBlock = kernelContent.slice(invokeIdx, invokeIdx + 8000);
    expect(wrappedBlock).toContain('for (const m of modelsToTry) {');
    expect(wrappedBlock).toContain('ai.models.generateContent({');
  });

  it('the thin route wrapper in server.ts contains no toolCalls logic of its own — it only maps the kernel\'s {status, body} onto the HTTP response', () => {
    const slice = executeAgentTaskRouteSlice();
    expect(slice).not.toContain('toolCalls');
    expect(slice).toContain('executeAgentTask(req.body, resolvedWorkspaceId, ctx)');
  });
});

describe('F2: handleAddNoteToVault never fabricates verification, tools, sources, or save provenance (src/App.tsx)', () => {
  function handleAddNoteToVaultSlice(): string {
    const idx = appContent.indexOf('const handleAddNoteToVault');
    expect(idx).toBeGreaterThan(-1);
    const end = appContent.indexOf('const handleUpdateNote', idx);
    return appContent.slice(idx, end);
  }

  it('no fabricated Aegis score or pass claim remains', () => {
    const slice = handleAddNoteToVaultSlice();
    expect(slice).not.toContain('Passed Aegis Verification');
    expect(slice).not.toMatch(/Score:\s*94\/100/);
    expect(slice).toContain("verification: provenanceMeta?.verification || 'NOT_VERIFIED — no Aegis review has run on this note'");
  });

  it('no fabricated tool/source names remain — defaults are empty arrays, real callers can still supply real ones', () => {
    const slice = handleAddNoteToVaultSlice();
    expect(slice).not.toContain('Web-Discovery');
    expect(slice).not.toContain('Aegis-Validator');
    expect(slice).not.toContain('YouTube Ingestion Feed');
    expect(slice).toContain('tools: provenanceMeta?.tools || []');
    expect(slice).toContain('sources: provenanceMeta?.sources || []');
  });

  it('does not claim a fake save success — provenance default is honest about being unpersisted', () => {
    const slice = handleAddNoteToVaultSlice();
    expect(slice).not.toContain('SynthOS Client Node -> Local Obsidian Storage');
    expect(slice).toMatch(/provenance:\s*provenanceMeta\?\.provenance \|\| 'NOT_IMPLEMENTED/);
  });

  it('a real caller-supplied provenanceMeta is still used as-is (F2 only changes the fabricated defaults)', () => {
    const slice = handleAddNoteToVaultSlice();
    // The ?? / || pattern means explicit caller values always win — this
    // asserts the mechanism (caller value on the left) is unchanged.
    expect(slice).toMatch(/agent:\s*provenanceMeta\?\.agent \|\|/);
    expect(slice).toMatch(/model:\s*provenanceMeta\?\.model \|\|/);
  });

  it('this function still only writes to React state — confirms F2 fixed the claim, not a real persistence layer that does not exist yet', () => {
    const idx = appContent.indexOf('const handleAddNoteToVault');
    const end = appContent.indexOf('const handleUpdateNote', idx);
    const fullFnBody = appContent.slice(idx, end);
    expect(fullFnBody).toContain('setNotes(prev => [newNote, ...prev])');
    expect(fullFnBody).not.toMatch(/fetch\(/);
  });
});

describe('F3: HERMES_ADAPTER_TOKEN has no client-side (VITE_-prefixed) fallback (src/services/hermesAdapter.ts)', () => {
  it('VITE_HERMES_ADAPTER_TOKEN is not read anywhere in this file', () => {
    expect(hermesAdapterContent).not.toContain('VITE_HERMES_ADAPTER_TOKEN');
  });

  it('the token can only ever come from a real Node process environment', () => {
    expect(hermesAdapterContent).toContain(
      "const envToken = typeof process !== 'undefined' && process.env ? process.env.HERMES_ADAPTER_TOKEN : undefined;"
    );
  });

  it('no other file in this repo reads VITE_HERMES_ADAPTER_TOKEN either (no replacement client-side path was added elsewhere)', () => {
    // A repo-wide guard, not just this one file: F3 requires "no
    // replacement client-side secret path", not just removal at this
    // specific call site.
    const srcDir = path.resolve(process.cwd(), 'src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const content = fs.readFileSync(full, 'utf-8');
          if (content.includes('VITE_HERMES_ADAPTER_TOKEN')) offenders.push(full);
        }
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });

  it('VITE_HERMES_ADAPTER_BASE_URL (not a secret, out of F3 scope) is untouched — F3 only removes the token path', () => {
    expect(hermesAdapterContent).toContain('VITE_HERMES_ADAPTER_BASE_URL');
  });
});
