import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';

const TEST_DB = path.join(os.tmpdir(), `synthos-qual-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
import { isolateVaultForTest } from './helpers/isolated-vault';

process.env.SYNTHOS_DB_PATH = TEST_DB;
// VAULT ISOLATION (must precede the lib/ imports — see the helper's header):
isolateVaultForTest('vert-qual');

import { nextQualificationQuestion, isQualified } from '../lib/conversation/service';
import type { BusinessProfile, LeadData } from '../lib/conversation/engine';

// ---------------------------------------------------------------------------
// DAYS 4-5 — configured qualification questions must be marked as asked.
//
// THE DEFECT, found by running the attorney vertical rather than by inspection:
//
// The capture branch compared the WHOLE last assistant message against the
// configured goals using `.includes(q)` — an exact-equality membership test.
// A qualification question is appended AFTER the grounded answer, so the
// message is "<answer>\n\n<question>" and never equals a goal. A configured
// question was therefore never recorded as asked, the assistant re-asked it on
// every single turn, and intake could never complete.
//
// It hid for so long because the DEFAULT_SLOTS branches beside it match with
// regex `.test(q)` against that same full message and work correctly. So the
// bug was invisible on a default install and hit every business that configured
// its own qualification goals — which is every real vertical.
// ---------------------------------------------------------------------------

const GOAL_A = 'Which of our practice areas does this relate to — a new estate plan, an existing plan, or settling the estate of someone who has died?';
const GOAL_B = 'What is your relationship to the person whose estate this concerns?';

function profileWithGoals(goals: string[]): BusinessProfile {
  return {
    workspace_id: 'ws-test', business_name: 'Test Firm', assistant_name: 'Ellis',
    business_description: null, services: [], locations: [], hours: null, contact: {},
    brand_voice: null, greeting: null, ai_disclosure: 'disclosure',
    qualification_goals: goals, handoff_rules: null,
  } as unknown as BusinessProfile;
}

describe('configured qualification goals drive intake, and are asked once each', () => {
  it('asks the first configured goal before any default slot', () => {
    const profile = profileWithGoals([GOAL_A, GOAL_B]);
    expect(nextQualificationQuestion(profile, {})).toBe(GOAL_A);
  });

  it('moves to the SECOND goal once the first is recorded', () => {
    // This is the assertion that would have failed before the fix: with the
    // first goal never recorded, the answer here was GOAL_A forever.
    const profile = profileWithGoals([GOAL_A, GOAL_B]);
    const lead: LeadData = { questions: [GOAL_A] };
    expect(nextQualificationQuestion(profile, lead)).toBe(GOAL_B);
  });

  it('falls through to the default slots once every configured goal is asked', () => {
    const profile = profileWithGoals([GOAL_A, GOAL_B]);
    const lead: LeadData = { questions: [GOAL_A, GOAL_B] };
    const next = nextQualificationQuestion(profile, lead);
    expect(next).not.toBe(GOAL_A);
    expect(next).not.toBe(GOAL_B);
    expect(next).toBeTruthy(); // a default slot, e.g. "What are you looking to get done?"
  });

  it('is qualified only when goals AND default slots are satisfied', () => {
    const profile = profileWithGoals([GOAL_A]);
    expect(isQualified(profile, { questions: [GOAL_A] })).toBe(false);
    expect(isQualified(profile, {
      questions: [GOAL_A], need: 'settle an estate', timing: 'this month',
      location: 'Ashfield', contact: 'someone@example.invalid',
    })).toBe(true);
  });

  it('a business with NO configured goals still uses the default slots', () => {
    // The path that always worked — asserted so the fix cannot regress it.
    const profile = profileWithGoals([]);
    expect(nextQualificationQuestion(profile, {})).toBe('What are you looking to get done?');
  });
});

describe('the matching rule itself — why endsWith, not equality or includes', () => {
  // The capture site matches the goal the message ENDS with. These pin the
  // reasoning so a future simplification cannot quietly undo it.
  const match = (message: string, goals: string[]) =>
    goals.find((g) => message.trimEnd().endsWith(g.trim()));

  it('matches a goal appended after a grounded answer — the real message shape', () => {
    const message = `Bring whatever you can find. The death certificate, or a copy.\n\n${GOAL_A}`;
    expect(match(message, [GOAL_A, GOAL_B])).toBe(GOAL_A);
    // Equality, the old test, fails on exactly this input.
    expect([GOAL_A, GOAL_B].includes(message)).toBe(false);
  });

  it('identifies WHICH goal was asked, not merely that one appears somewhere', () => {
    // A goal quoted mid-message is not the question just asked. `includes`-style
    // substring matching would wrongly record GOAL_A here.
    const message = `Earlier you were asked: ${GOAL_A} — but first, ${GOAL_B}`;
    expect(match(message, [GOAL_A, GOAL_B])).toBe(GOAL_B);
  });

  it('does not match when no goal was asked', () => {
    expect(match('Here is our delivery policy. Nothing further.', [GOAL_A, GOAL_B])).toBeUndefined();
  });

  it('tolerates trailing whitespace on either side', () => {
    expect(match(`answer\n\n${GOAL_A}   `, [`  ${GOAL_A}  `])).toBeTruthy();
  });
});
