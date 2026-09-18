// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { DevelopmentView } from '../src/components/DevelopmentView';
import { ModelProviderCredentialsCard } from '../src/components/ModelProviderCredentialsCard';
import { NAV_DESTINATIONS, NAV_GROUP_ORDER } from '../src/navigation/canonical-nav';

// ---------------------------------------------------------------------------
// PUSH 2C — the production Development workspace.
//
// These tests exist to stop the screen lying. A surface over an autonomous
// loop is dangerous in a specific way: it is trivial to render VERIFIED, a
// green Brain tick or a spinning progress bar from nothing, and an operator
// cannot tell the difference. So the assertions here are mostly negative —
// what the component must REFUSE to display when the backend has not said it.
//
// Every fixture below is a real backend response shape. The component is
// given no props it would not have in production.
// ---------------------------------------------------------------------------

const WS = 'ws-devview-alpha';

/** Real-shaped rows, matching what /api/development/tasks actually returns. */
function task(overrides: Record<string, unknown> = {}) {
  return {
    dev_task_id: 'dev-1', workspace_id: WS, task_id: null,
    title: 'Add the durable sweep', instruction: 'Do the thing.',
    state: 'WAITING_FOR_REVIEW', state_reason: null,
    requires_review: 1, requires_approval: 1,
    review_provider: null, review_model: null, review_text: null, review_at: null,
    approved_by_user_id: null, approved_at: null,
    execution_id: null, result_artifact_id: null, result_receipt_id: null,
    aegis_decision: null, task_kind: 'CODING', evidence_json: null,
    created_at: '2026-09-14T10:00:00.000Z', updated_at: '2026-09-14T10:00:00.000Z',
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

/** Routes fetch the way the real server does, so the component's URLs are themselves under test. */
function mockBackend(handlers: Record<string, unknown>) {
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    for (const [pattern, body] of Object.entries(handlers)) {
      if (u.includes(pattern)) {
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any;
      }
    }
    return { ok: true, status: 200, json: async () => ({ success: true }), text: async () => '{}' } as any;
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  // EventSource does not exist in jsdom. A no-op stand-in proves the component
  // opens the REAL stream URL without inventing connectivity: nothing calls
  // onmessage, so the indicator must stay DISCONNECTED throughout.
  class NoopEventSource {
    url: string;
    onerror: ((e: unknown) => void) | null = null;
    constructor(url: string) { this.url = url; (NoopEventSource as any).lastUrl = url; }
    addEventListener() { /* never fires: no event is simulated */ }
    close() { /* no-op */ }
  }
  vi.stubGlobal('EventSource', NoopEventSource as unknown as typeof EventSource);
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('1. NAVIGATION and SHELL integration — no second Admin', () => {
  it('Development is registered in the existing ActiveTab union', () => {
    const types = fs.readFileSync(path.resolve(process.cwd(), 'src/types/index.ts'), 'utf8');
    expect(types).toContain("| 'development'");
  });

  it('it lives in the existing BUILD group of the existing SidebarNav, not a new nav group', () => {
    // The sidebar renders the canonical navigation definition.
    const nav = fs.readFileSync(path.resolve(process.cwd(), 'src/components/SidebarNav.tsx'), 'utf8');
    expect(nav).toContain('navGroupsFor({ platformRole })');
    expect(NAV_DESTINATIONS.find((d) => d.tabId === 'development')?.group).toBe('BUILD');
    // The canonical groups are all still there.
    for (const g of ['OPERATIONS', 'WORKSPACES', 'BUILD', 'KNOWLEDGE', 'GOVERNANCE', 'SYSTEM']) {
      expect(NAV_GROUP_ORDER).toContain(g);
    }
  });

  it('it is mounted inside the existing App shell, next to the other views', () => {
    const app = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toContain("activeTab === 'development'");
    expect(app).toContain('<DevelopmentView activeWorkspaceId={activeWorkspaceId} />');
  });
});

describe('2. TASK QUEUE renders real backend state', () => {
  it('renders tasks returned by the real route, with their real states', async () => {
    mockBackend({
      '/api/development/tasks': {
        success: true,
        tasks: [task(), task({ dev_task_id: 'dev-2', title: 'Second task', state: 'VERIFIED' })],
      },
    });
    render(<DevelopmentView activeWorkspaceId={WS} />);

    await waitFor(() => expect(screen.getByText('Add the durable sweep')).toBeTruthy());
    expect(screen.getByText('Second task')).toBeTruthy();
    expect(screen.getByText('WAITING_FOR_REVIEW')).toBeTruthy();
    expect(screen.getAllByText('VERIFIED').length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes(`/api/development/tasks?workspaceId=${WS}`))).toBe(true);
  });

  it('an empty queue is an honest empty state — no seeded example tasks', async () => {
    mockBackend({ '/api/development/tasks': { success: true, tasks: [] } });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    await waitFor(() => expect(screen.getByText(/No development tasks in this workspace/i)).toBeTruthy());
  });

  it('with no workspace it refuses to render a queue rather than inventing scope', () => {
    mockBackend({});
    render(<DevelopmentView activeWorkspaceId={undefined} />);
    expect(screen.getByText(/No active workspace/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creating a task posts to the real create route with the workspace attached', async () => {
    mockBackend({ '/api/development/tasks': { success: true, tasks: [], task: task() } });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    await waitFor(() => expect(screen.getByText(/New Task/i)).toBeTruthy());

    fireEvent.click(screen.getByText(/New Task/i));
    fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'A real task' } });
    fireEvent.change(screen.getByPlaceholderText(/Instruction the runtime will execute/i), { target: { value: 'Do a real thing.' } });
    fireEvent.click(screen.getByText('Create Task'));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST' && String(c[0]).endsWith('/api/development/tasks'));
      expect(post).toBeTruthy();
      const body = JSON.parse(post![1].body);
      expect(body.workspaceId).toBe(WS);
      expect(body.title).toBe('A real task');
      expect(body.kind).toBe('CODING');
    });
  });
});

describe('3. CHATGPT REVIEW panel — NOT_CONFIGURED is truthful, and no substitution', () => {
  it('a task with no review shows nothing recorded rather than a placeholder review', async () => {
    mockBackend({ '/api/development/tasks': { success: true, tasks: [task()] } });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));

    expect(await screen.findByText(/No review has been recorded for this task/i)).toBeTruthy();
    expect(screen.queryByText(/Gemini/i)).toBeNull();
  });

  it('requesting a review with no key surfaces NOT_CONFIGURED and names the variable, never Gemini', async () => {
    mockBackend({
      '/api/development/tasks?': { success: true, tasks: [task()] },
      '/review': {
        success: false,
        review: {
          outcome: 'NOT_CONFIGURED', provider: 'openai', model: null, reviewText: null, contextItems: 0,
          reason: 'No OpenAI credential is configured — neither OPENAI_API_KEY nor an encrypted server-side credential row is present. The task keeps its current state; no other provider was substituted.',
        },
        task: task(),
      },
    });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));
    fireEvent.click(screen.getByText('Request Review'));

    expect(await screen.findByText(/OpenAI NOT_CONFIGURED/i)).toBeTruthy();
    expect(screen.getByText(/OPENAI_API_KEY/)).toBeTruthy();
    expect(screen.getByText(/No other provider is substituted/i)).toBeTruthy();
  });

  it('a completed review renders the real provider, real model and the real body', async () => {
    mockBackend({
      '/api/development/tasks': {
        success: true,
        tasks: [task({ review_provider: 'openai', review_model: 'gpt-5.6-terra-2026-08-01', review_text: 'Verdict — PROCEED, the task is bounded.', review_at: '2026-09-14T11:00:00.000Z', state: 'WAITING_FOR_APPROVAL' })],
      },
    });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));

    expect(await screen.findByText('gpt-5.6-terra-2026-08-01')).toBeTruthy();
    expect(screen.getByText(/Verdict — PROCEED/)).toBeTruthy();
  });
});

describe('4. GUARDIAN — the approval gate appears only when the backend says so', () => {
  it('Approve is offered only while the task is WAITING_FOR_APPROVAL', async () => {
    mockBackend({ '/api/development/tasks': { success: true, tasks: [task({ state: 'WAITING_FOR_APPROVAL' })] } });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));
    expect(await screen.findByText('Approve')).toBeTruthy();
  });

  it('Approve is absent while the task is still waiting for review', async () => {
    mockBackend({ '/api/development/tasks': { success: true, tasks: [task()] } });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));
    await waitFor(() => expect(screen.getByText(/Review required/i)).toBeTruthy());
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText(/Dispatch to Antigravity/i)).toBeNull();
  });

  it('a BLOCKED task shows the Guardian reason, and offers no dispatch', async () => {
    mockBackend({
      '/api/development/tasks': {
        success: true,
        tasks: [task({ state: 'BLOCKED', state_reason: 'Guardian refused this instruction before dispatch (BLOCKED, risk FATAL): Catastrophic filesystem destruction detected.' })],
      },
    });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));

    expect(await screen.findByText(/Blocked by Guardian/i)).toBeTruthy();
    // Appears twice on purpose: once as the card's state_reason preview in the
    // queue, and once in full in the Guardian panel. An operator scanning the
    // queue should see why a task stopped without having to select it.
    expect(screen.getAllByText(/Catastrophic filesystem destruction/i).length).toBe(2);
    expect(screen.queryByText(/Dispatch to Antigravity/i)).toBeNull();
  });
});

describe('5. ANTIGRAVITY panel — real execution state, no manual polling, no working cancel', () => {
  const runningTask = task({ state: 'RUNNING', execution_id: 'agex-1', review_at: '2026-09-14T11:00:00.000Z', approved_at: '2026-09-14T11:05:00.000Z' });
  const runningExec = {
    success: true,
    execution: {
      id: 'agex-1', runtime: 'antigravity', remote_job_id: 'v1_RealInteractionId', remote_path: 'antigravity-preview-05-2026',
      status: 'RUNNING', poll_attempts: 3, next_poll_at: '2026-09-14T11:10:00.000Z', correlation_id: 'devtask:dev-1',
      submitted_at: '2026-09-14T11:06:00.000Z', completed_at: null, error_code: null, error_message_safe: null, task_id: null,
    },
  };

  it('shows the real interaction id, runtime and poll state', async () => {
    mockBackend({ '/api/development/tasks': { success: true, tasks: [runningTask] }, '/api/external-executions/': runningExec });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));

    expect(await screen.findByText('v1_RealInteractionId')).toBeTruthy();
    expect(screen.getByText('antigravity')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('states plainly that the scheduler advances it — and offers NO refresh/poll control', async () => {
    mockBackend({ '/api/development/tasks': { success: true, tasks: [runningTask] }, '/api/external-executions/': runningExec });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));

    expect(await screen.findByText(/scheduler is advancing this automatically/i)).toBeTruthy();
    expect(screen.queryByText(/^Refresh$/i)).toBeNull();
    expect(screen.queryByText(/Poll now/i)).toBeNull();
  });

  it('Cancel is rendered visibly disabled and labelled unavailable, never as a working control', async () => {
    mockBackend({ '/api/development/tasks': { success: true, tasks: [runningTask] }, '/api/external-executions/': runningExec });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));

    const cancel = await screen.findByText(/Cancel — unavailable/i);
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
  });

  it('no progress percentage or fabricated completion figure is rendered anywhere', async () => {
    mockBackend({ '/api/development/tasks': { success: true, tasks: [runningTask] }, '/api/external-executions/': runningExec });
    const { container } = render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));
    await screen.findByText('v1_RealInteractionId');
    expect(container.textContent).not.toMatch(/\d+%/);
  });

  it('coding evidence the runtime did not return is shown as absent, not as blank fields', async () => {
    mockBackend({ '/api/development/tasks': { success: true, tasks: [runningTask] }, '/api/external-executions/': runningExec });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));
    expect(await screen.findByText(/did not return a structured evidence block/i)).toBeTruthy();
  });

  it('real returned evidence is rendered field by field', async () => {
    const withEvidence = task({
      state: 'VERIFIED', execution_id: 'agex-1',
      evidence_json: JSON.stringify({ summary: 'Added the sweep.', filesChanged: ['lib/a.ts'], testResult: 'PASS', typecheckResult: 'PASS', buildResult: 'NOT_RUN', commitSha: 'abc1234' }),
    });
    mockBackend({ '/api/development/tasks': { success: true, tasks: [withEvidence] }, '/api/external-executions/': runningExec });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));

    expect(await screen.findByText('Added the sweep.')).toBeTruthy();
    expect(screen.getByText('lib/a.ts')).toBeTruthy();
    expect(screen.getByText('abc1234')).toBeTruthy();
    expect(screen.getByText('NOT_RUN')).toBeTruthy();
  });
});

describe('6. AEGIS, RECEIPT and BRAIN WRITEBACK derive strictly from backend evidence', () => {
  it('VERIFIED shows the real Aegis decision, receipt and cycle writeback', async () => {
    mockBackend({
      '/api/development/tasks': {
        success: true,
        tasks: [task({ state: 'VERIFIED', task_id: 'agext-1', aegis_decision: 'VERIFIED', result_receipt_id: 'rcpt-real-1', result_artifact_id: 'art-real-1', execution_id: 'agex-1' })],
      },
    });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));

    expect(await screen.findByText('rcpt-real-1')).toBeTruthy();
    expect(screen.getByText('art-real-1')).toBeTruthy();
    expect(screen.getByText(/Artifact written and indexed/i)).toBeTruthy();
    expect(screen.getByText(/Signed receipt issued/i)).toBeTruthy();
    expect(screen.getByText(/DEVELOPMENT_CYCLE_COMPLETED recorded to activity/i)).toBeTruthy();
  });

  it('with no receipt it says so — it never claims the Brain was updated on its own authority', async () => {
    mockBackend({ '/api/development/tasks': { success: true, tasks: [task({ state: 'FAILED', state_reason: 'Execution completed but was not verified.' })] } });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));

    expect(await screen.findByText(/No receipt issued/i)).toBeTruthy();
    expect(screen.getByText(/No artifact recorded/i)).toBeTruthy();
    expect(screen.getByText(/Cycle not yet completed/i)).toBeTruthy();
    expect(screen.queryByText(/Brain updated/i)).toBeNull();
  });
});

describe('7. NEXT TASK is gated on real completion', () => {
  it('the selector is disabled until the current task is VERIFIED', async () => {
    mockBackend({ '/api/development/tasks': { success: true, tasks: [task()] } });
    const { container } = render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));
    await screen.findByText(/Available once the selected task reaches VERIFIED/i);
    expect((container.querySelector('select') as HTMLSelectElement).disabled).toBe(true);
  });

  it('once VERIFIED the operator may choose the next task — continuation stays a human decision', async () => {
    mockBackend({
      '/api/development/tasks': {
        success: true,
        tasks: [
          task({ state: 'VERIFIED', aegis_decision: 'VERIFIED', result_receipt_id: 'r1' }),
          task({ dev_task_id: 'dev-2', title: 'Queued next', state: 'WAITING_FOR_REVIEW' }),
        ],
      },
    });
    const { container } = render(<DevelopmentView activeWorkspaceId={WS} />);
    fireEvent.click(await screen.findByText('Add the durable sweep'));
    await screen.findByText(/continuation stays a human decision/i);
    expect((container.querySelector('select') as HTMLSelectElement).disabled).toBe(false);
  });
});

describe('8. REAL-TIME — the indicator reflects the real stream, and never animates a fiction', () => {
  it('it opens the existing SSE route and stays DISCONNECTED until a real frame arrives', async () => {
    mockBackend({ '/api/development/tasks': { success: true, tasks: [task()] } });
    render(<DevelopmentView activeWorkspaceId={WS} />);
    await screen.findByText('Add the durable sweep');

    expect((globalThis as any).EventSource.lastUrl).toContain('/api/development/events');
    expect((globalThis as any).EventSource.lastUrl).toContain(WS);
    // No event was delivered by the stand-in, so the component must not claim liveness.
    expect(screen.getByText('DISCONNECTED')).toBeTruthy();
    expect(screen.queryByText('LIVE')).toBeNull();
  });
});

describe('9. CREDENTIAL SURFACE never renders a secret', () => {
  it('shows provider state from the real route and no key value', async () => {
    mockBackend({
      '/api/platform/model-credentials': {
        success: true,
        providers: [
          { provider: 'openai', state: 'NOT_CONFIGURED', configured: false, envVar: 'OPENAI_API_KEY', storedRowPresent: false, overriddenByEnvironment: false, updatedAt: null },
          { provider: 'gemini', state: 'STORED', configured: true, envVar: 'GEMINI_API_KEY', storedRowPresent: true, overriddenByEnvironment: false, updatedAt: '2026-09-14T09:00:00.000Z' },
        ],
      },
    });
    const { container } = render(<ModelProviderCredentialsCard activeWorkspaceId={WS} />);

    expect(await screen.findByText('NOT_CONFIGURED')).toBeTruthy();
    expect(screen.getByText('STORED')).toBeTruthy();
    // The API never returns a value, so nothing key-shaped can appear.
    expect(container.textContent).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    expect(container.textContent).not.toMatch(/AIza[A-Za-z0-9]{8,}/);
  });

  it('an environment-supplied key offers no replace/remove control — that is deployment configuration', async () => {
    mockBackend({
      '/api/platform/model-credentials': {
        success: true,
        providers: [{ provider: 'openai', state: 'ENVIRONMENT', configured: true, envVar: 'OPENAI_API_KEY', storedRowPresent: false, overriddenByEnvironment: false, updatedAt: null }],
      },
    });
    render(<ModelProviderCredentialsCard activeWorkspaceId={WS} />);
    await screen.findByText('ENVIRONMENT');
    expect(screen.queryByPlaceholderText(/Paste the API key/i)).toBeNull();
    expect(screen.queryByText(/Remove stored key/i)).toBeNull();
    expect(screen.getByText(/cannot be replaced or removed from here/i)).toBeTruthy();
  });

  it('a stored key overridden by the environment explains itself rather than looking broken', async () => {
    mockBackend({
      '/api/platform/model-credentials': {
        success: true,
        providers: [{ provider: 'openai', state: 'ENVIRONMENT', configured: true, envVar: 'OPENAI_API_KEY', storedRowPresent: true, overriddenByEnvironment: true, updatedAt: '2026-09-14T09:00:00.000Z' }],
      },
    });
    render(<ModelProviderCredentialsCard activeWorkspaceId={WS} />);
    expect(await screen.findByText(/takes\s+precedence/i)).toBeTruthy();
  });

  it('the typed key is sent to the server and cleared from the input, never left in the DOM', async () => {
    mockBackend({
      '/api/platform/model-credentials': {
        success: true,
        providers: [{ provider: 'openai', state: 'NOT_CONFIGURED', configured: false, envVar: 'OPENAI_API_KEY', storedRowPresent: false, overriddenByEnvironment: false, updatedAt: null }],
        status: { provider: 'openai', state: 'STORED', configured: true, envVar: 'OPENAI_API_KEY', storedRowPresent: true, overriddenByEnvironment: false, updatedAt: null },
      },
    });
    const { container } = render(<ModelProviderCredentialsCard activeWorkspaceId={WS} />);
    const input = await screen.findByPlaceholderText(/Paste the API key/i);
    fireEvent.change(input, { target: { value: 'sk-typed-by-the-operator' } });
    fireEvent.click(screen.getByText('Save & Verify'));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(post![1].body).apiKey).toBe('sk-typed-by-the-operator');
    });
    await waitFor(() => expect(container.textContent).not.toContain('sk-typed-by-the-operator'));
    expect((input as HTMLInputElement).value).toBe('');
  });
});
