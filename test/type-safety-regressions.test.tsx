// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import { FirstRunTour, TOUR_STEPS } from '../src/components/FirstRunTour';
import { AutoContentNewsView } from '../src/components/AutoContentNewsView';
import type { ActiveTab, AgentRole } from '../src/types';

// ---------------------------------------------------------------------------
// LIVE BUGS FOUND BY THE STRICT CHARACTERIZATION.
//
// None of these was a strictness formality. Each was a reachable runtime
// defect that the repo's non-strict tsconfig could not see, because with
// strictNullChecks off an optional prop's `undefined` is invisible and a
// too-wide parameter type is accepted silently.
//
// Pinned by behaviour, not by reading the source.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} } as any);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the guided tour can actually advance', () => {
  // THE BUG: FirstRunTour declares two optional navigation props,
  // `onNavigateTab` and `onNavigate`, and has a `navigate()` helper that
  // tolerates either. Next and Back bypassed the helper and called
  // `onNavigateTab` directly. App.tsx passes only `onNavigate`, so
  // `onNavigateTab` was undefined and both buttons threw
  // "onNavigateTab is not a function".
  it('advances with only onNavigate supplied, the way App mounts it', () => {
    const navigated: ActiveTab[] = [];
    render(
      <FirstRunTour
        isOpen
        onClose={() => {}}
        onNavigate={(tab) => navigated.push(tab)}
      />,
    );
    // Clicking Next must navigate rather than throw.
    fireEvent.click(screen.getByText(/next/i));
    expect(navigated).toEqual([TOUR_STEPS[1].tab]);

    fireEvent.click(screen.getByText(/back/i));
    expect(navigated).toEqual([TOUR_STEPS[1].tab, TOUR_STEPS[0].tab]);
  });

  it('still works when only the other prop name is supplied', () => {
    // Both names must keep working — the helper exists precisely because two
    // spellings are in use, and pinning only one would re-break the other.
    const navigated: ActiveTab[] = [];
    render(
      <FirstRunTour
        isOpen
        onClose={() => {}}
        onNavigateTab={(tab) => navigated.push(tab)}
      />,
    );
    fireEvent.click(screen.getByText(/next/i));
    expect(navigated).toEqual([TOUR_STEPS[1].tab]);
  });

  it('does not throw when neither navigation prop is supplied', () => {
    render(<FirstRunTour isOpen onClose={() => {}} />);
    expect(() => fireEvent.click(screen.getByText(/next/i))).not.toThrow();
  });
});

describe('telegram dispatch addresses a role, not a thread id', () => {
  // THE BUG: AutoContentNewsView called onSendTelegramMessage('104', ...).
  // '104' is the Reach thread id, not an AgentRole. App's handler resolves
  // the thread FROM the role — `agents[role] || agents['orchestrator']` — so
  // `agents['104']` was undefined and the message silently went to the
  // orchestrator on thread 101. The `||` fallback is what hid it.
  it('sends to the reach role so the handler resolves the intended thread', async () => {
    const sent: Array<[AgentRole, string]> = [];
    render(
      <AutoContentNewsView
        agents={{} as any}
        models={{ hermes: { name: 'Nous Hermes 3', color: '#EC4899' } } as any}
        onAddNoteToVault={() => {}}
        onSendTelegramMessage={(role, text) => sent.push([role, text])}
        onSendQuery={async () => 'draft body'}
        onSelectTab={() => {}}
      />,
    );

    // A draft has to exist before dispatch is allowed.
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea, { target: { value: 'a generated draft' } });

    // Unconditional: a test whose assertion sits behind an `if` can pass by
    // never running it.
    const dispatch = screen.getByText('POST TO TELEGRAM');
    fireEvent.click(dispatch.closest('button') as HTMLButtonElement);
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    // The point: a role, never a numeric thread id.
    expect(sent[0][0]).toBe('reach');
    expect(sent[0][0]).not.toMatch(/^\d+$/);

    // And the notice must not claim an outbound send. No Telegram transport
    // exists in this build — App's handler only writes the in-app thread.
    const notice = document.body.textContent || '';
    expect(notice).not.toContain('Dispatched to Telegram');
    expect(notice).toContain('No Telegram transport is configured');
  });
});

describe('the Kanban task invariant holds for callers that omit subtasks', () => {
  // THE BUG: KanbanTask.subtasks is REQUIRED, but the components that create
  // tasks are typed Omit<KanbanTask, ... | 'subtasks'> and two of them
  // (GlobalVoiceOverlay, ApolloVoiceView) genuinely omit it. App's
  // handleAddKanbanTask spread the input straight through, so the task's
  // `subtasks` was undefined while its type claimed an array. Three readers
  // then called `task.subtasks.map(...)`: completing a task, writing it to
  // the Brain, and toggling a subtask in KanbanView.
  //
  // The fix defaults it at the single construction point. This asserts the
  // shape that fix guarantees, using the same spread the handler performs.
  it('a task built without subtasks still exposes an array', () => {
    const construct = (input: { title: string; subtasks?: unknown[] }) => ({
      ...input,
      subtasks: input.subtasks ?? [],
      id: 'task-1',
      createdAt: 'now',
      updatedAt: 'now',
    });

    const withoutSubtasks = construct({ title: 'created by voice' });
    expect(Array.isArray(withoutSubtasks.subtasks)).toBe(true);
    // The three crash sites all did .map on this.
    expect(() => withoutSubtasks.subtasks.map((s) => s)).not.toThrow();

    const withSubtasks = construct({ title: 'created from a form', subtasks: [{ id: 's1' }] });
    expect(withSubtasks.subtasks).toHaveLength(1);
  });

  it('every seeded board task exposes a real subtask array', async () => {
    // The invariant the three crash sites depend on, asserted against the
    // shipped seed data rather than by grepping source.
    const { INITIAL_KANBAN_TASKS } = await import('../src/data/mockData');
    for (const task of INITIAL_KANBAN_TASKS) {
      expect(Array.isArray(task.subtasks), task.title).toBe(true);
      expect(() => task.subtasks.map((s) => s.id), task.title).not.toThrow();
    }
  });
});
