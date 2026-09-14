import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';

const TEST_DB_PATH = path.join(os.tmpdir(), `synthos-evidence-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SYNTHOS_DB_PATH = TEST_DB_PATH;

import {
  createDevelopmentTask, buildExecutionInstruction, parseCodingEvidence,
  CODING_EVIDENCE_INSTRUCTION,
} from '../lib/development-loop';
import { getDatabase } from '../lib/persistence';

// ---------------------------------------------------------------------------
// PUSH 2C — the coding evidence contract.
//
// Push 2B recorded an honest gap: the runtime returns prose, so a diff/test
// panel had nothing structured to render, and writing a parser for text that
// might contain no diff would have been fabrication.
//
// The fix is to ASK rather than to infer. That makes the risk different, and
// these tests target the new one: that a field the agent never sent could
// still end up on screen. Every assertion below is about refusing to invent.
// ---------------------------------------------------------------------------

const WS = 'ws-evidence';

beforeAll(() => { getDatabase(); });

function make(kind: 'CODING' | 'GENERAL') {
  return createDevelopmentTask({
    workspaceId: WS, createdByUserId: 'evidence-actor',
    title: `${kind} task`, instruction: 'Change the parser and run the tests.',
    kind, requiresReview: false, requiresApproval: false,
  });
}

describe('1. THE INSTRUCTION CONTRACT — asking is the only change', () => {
  it('a CODING task carries the evidence request', () => {
    const built = buildExecutionInstruction(make('CODING'));
    expect(built).toContain('Change the parser and run the tests.');
    expect(built).toContain('synthos_evidence');
    expect(built).toContain('"typecheckResult"');
  });

  it('a GENERAL task is sent verbatim — the contract is opt-in, not global', () => {
    const task = make('GENERAL');
    expect(buildExecutionInstruction(task)).toBe(task.instruction);
    expect(buildExecutionInstruction(task)).not.toContain('synthos_evidence');
  });

  it('the request asks for paths, and explicitly forbids diffs and raw command output', () => {
    // The boundary that keeps unreviewed remote file content out of the Vault.
    expect(CODING_EVIDENCE_INSTRUCTION).toContain('paths only');
    expect(CODING_EVIDENCE_INSTRUCTION).toMatch(/Do not include file contents, diffs or raw command output/i);
  });

  it('it tells the agent to report NOT_RUN rather than guess — honesty is requested, not assumed', () => {
    expect(CODING_EVIDENCE_INSTRUCTION).toContain('NOT_RUN');
    expect(CODING_EVIDENCE_INSTRUCTION).toMatch(/rather than guessing/i);
  });
});

describe('2. PARSING — only what the runtime really returned', () => {
  const full = [
    'Here is what I did.',
    '',
    '```json',
    JSON.stringify({
      synthos_evidence: {
        summary: 'Rewrote the parser and added two cases.',
        filesChanged: ['lib/parser.ts', 'test/parser.test.ts'],
        testsRun: 'npx vitest run test/parser.test.ts',
        testResult: 'PASS (12/12)',
        typecheckResult: 'PASS',
        buildResult: 'NOT_RUN',
        commitSha: 'a1b2c3d',
        blockers: [],
      },
    }),
    '```',
  ].join('\n');

  it('extracts every field the agent really reported', () => {
    const e = parseCodingEvidence(full)!;
    expect(e.summary).toBe('Rewrote the parser and added two cases.');
    expect(e.filesChanged).toEqual(['lib/parser.ts', 'test/parser.test.ts']);
    expect(e.testResult).toBe('PASS (12/12)');
    expect(e.typecheckResult).toBe('PASS');
    expect(e.buildResult).toBe('NOT_RUN');
    expect(e.commitSha).toBe('a1b2c3d');
  });

  it('an empty array is not a value — blockers:[] means "none reported", not "no blockers proven"', () => {
    // Rendering an empty list as a positive finding would overstate it.
    expect(parseCodingEvidence(full)!.blockers).toBeUndefined();
  });

  it('output with NO evidence block returns null, so the surface can say "none returned"', () => {
    expect(parseCodingEvidence('I created the file and read it back. All good.')).toBeNull();
    expect(parseCodingEvidence('')).toBeNull();
  });

  it('a json block that is not OUR block is ignored — an agent printing config is not evidence', () => {
    expect(parseCodingEvidence('```json\n{"some":"other","payload":true}\n```')).toBeNull();
  });

  it('it finds the block even when it is not the first fenced section', () => {
    const multi = [
      '```text', 'file contents the agent echoed', '```',
      '```bash', 'npx vitest run', '```',
      '```json', JSON.stringify({ synthos_evidence: { summary: 'Found last.' } }), '```',
    ].join('\n');
    expect(parseCodingEvidence(multi)!.summary).toBe('Found last.');
  });

  it('malformed JSON is null rather than a crash — a broken block must not fail a verified task', () => {
    expect(parseCodingEvidence('```json\n{ synthos_evidence: NOT VALID }\n```')).toBeNull();
  });

  it('missing fields stay MISSING — they are never defaulted to empty strings', () => {
    const partial = parseCodingEvidence('```json' + '\n' + JSON.stringify({ synthos_evidence: { summary: 'Only a summary.' } }) + '\n```')!;
    expect(partial.summary).toBe('Only a summary.');
    expect(Object.prototype.hasOwnProperty.call(partial, 'testResult')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(partial, 'buildResult')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(partial, 'commitSha')).toBe(false);
  });

  it('a block whose every field is blank yields null, not an object of empty values', () => {
    const blank = parseCodingEvidence('```json\n' + JSON.stringify({ synthos_evidence: { summary: '   ', filesChanged: [], commitSha: '' } }) + '\n```');
    expect(blank).toBeNull();
  });

  it('non-string junk in a list is discarded rather than rendered', () => {
    const messy = parseCodingEvidence('```json\n' + JSON.stringify({ synthos_evidence: { filesChanged: ['a.ts', 42, null, '', 'b.ts'] } }) + '\n```')!;
    expect(messy.filesChanged).toEqual(['a.ts', 'b.ts']);
  });
});

describe('3. PERSISTENCE — evidence is null until it genuinely exists', () => {
  it('a newly created coding task carries no evidence', () => {
    const task = make('CODING');
    expect(task.task_kind).toBe('CODING');
    expect(task.evidence_json).toBeNull();
  });

  it('task kind defaults to GENERAL rather than silently opting every task into the contract', () => {
    const task = createDevelopmentTask({
      workspaceId: WS, createdByUserId: 'a', title: 'Unspecified kind',
      instruction: 'Do something.', requiresReview: false, requiresApproval: false,
    });
    expect(task.task_kind).toBe('GENERAL');
  });
});
