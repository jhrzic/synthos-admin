// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';

import { ProviderModelCatalog } from '../src/components/ProviderModelCatalog';
import { RegistryModelSelect } from '../src/components/registry/RegistryModelSelect';
import { KanbanView } from '../src/components/KanbanView';
import { INITIAL_AGENTS } from '../src/data/mockData';

// ---------------------------------------------------------------------------
// THE REGISTRY-DRIVEN MODEL UI.
//
// The Admin catalog and every selector render GET /api/registry/models — the
// persisted local registry. These tests feed it SYNTHETIC providers and models
// (no production model name anywhere in this file's fixtures) and assert the
// rendered DOM: many models per provider, availability and its real reason per
// model, unavailable models disabled rather than hidden, and a failed read
// reported as a failure. The components hold no model list of their own.
// ---------------------------------------------------------------------------

const cap = (id: string) => ({ id, supported: true, verification: 'ADMIN_ASSERTED', source: 'fixture' });
const model = (providerId: string, modelId: string, over: Record<string, unknown> = {}) => ({
  providerId, providerDisplayName: providerId === 'synthetic-alpha' ? 'Synthetic Alpha' : 'Synthetic Beta',
  modelId, displayName: `${modelId} display`, aliases: [], lifecycle: 'ACTIVE',
  limits: { contextTokens: null, outputTokens: null }, modalities: { input: ['text'], output: ['text'] },
  capabilities: [cap('text.input'), cap('text.output')], outputContracts: ['NARRATIVE', 'LITERAL', 'JSON_OBJECT'],
  protocol: 'openai.responses', source: 'SIGNED_IMPORT', manifestVersion: 'fx-1', adminState: 'ENABLED',
  availability: 'AVAILABLE', executable: true, blockers: [],
  pricing: { state: 'CURRENT', current: { rates: { input: 1, output: 2, cachedInput: null }, unit: 'tokens', currency: 'USD', staleAfter: '2099-01-01T00:00:00Z', source: 'fixture' }, versionKey: 'registry:x' },
  paid: true, ...over,
});
const provider = (providerId: string, displayName: string, over: Record<string, unknown> = {}) => ({
  providerId, displayName, protocol: 'openai.responses', adapterDispatch: 'MODEL_CALL', manifestVersion: 'fx-1', source: 'SIGNED_IMPORT',
  approvedHosts: ['api.synthetic.example'], endpoint: { ok: true, host: 'api.synthetic.example', overridden: false, reason: null },
  credential: { ready: true, source: 'environment' }, billing: 'METERED', modelCount: 0, executableCount: 0, health: 'UNKNOWN', ...over,
});

const PAYLOAD = {
  success: true, workspaceId: 'ws-test', source: 'LOCAL_REGISTRY', providerCallsMade: 0,
  states: ['AVAILABLE', 'UNQUALIFIED', 'UNSUPPORTED_BY_ADAPTER', 'PRICING_REQUIRED'],
  providers: [
    provider('synthetic-alpha', 'Synthetic Alpha', { modelCount: 3, executableCount: 1 }),
    provider('synthetic-beta', 'Synthetic Beta', { protocol: 'anthropic.messages', adapterDispatch: 'NONE', modelCount: 1, executableCount: 0 }),
  ],
  models: [
    model('synthetic-alpha', 'syn-one'),
    model('synthetic-alpha', 'syn-two', { availability: 'UNQUALIFIED', executable: false, adminState: 'INSTALLED', blockers: [{ state: 'UNQUALIFIED', reason: 'not yet qualified by an operator' }] }),
    model('synthetic-alpha', 'syn-three', { availability: 'PRICING_REQUIRED', executable: false, blockers: [{ state: 'PRICING_REQUIRED', reason: 'the manifest carries no pricing' }], pricing: { state: 'MISSING', current: null, versionKey: null },
      capabilities: [cap('text.output'), cap('x.synthetic-alpha.brand_new_feature')] }),
    model('synthetic-beta', 'syn-four', { protocol: 'anthropic.messages', availability: 'UNSUPPORTED_BY_ADAPTER', executable: false, blockers: [{ state: 'UNSUPPORTED_BY_ADAPTER', reason: 'this build has no dispatch adapter for the anthropic.messages protocol' }] }),
  ],
  workspacePolicy: { mode: 'INHERIT', allowed: [], denied: [] },
  manualDiscoveryEnabled: false,
};

let calls: string[] = [];
beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    if (String(url).startsWith('/api/registry/admin')) return { ok: false, status: 403, json: async () => ({ success: false }) };
    return { ok: true, status: 200, json: async () => PAYLOAD };
  }) as any);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Admin model registry: providers → many models, from the registry only', () => {
  it('renders every registered model under its provider, including ones that cannot run', async () => {
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    await waitFor(() => expect(screen.getByText('syn-one display')).toBeTruthy());
    for (const id of ['syn-two', 'syn-three', 'syn-four']) expect(screen.getByText(`${id} display`)).toBeTruthy();
    expect(screen.getAllByTestId('registry-model-row')).toHaveLength(4);
    // Only the registry endpoints were read — no provider, no catalog poll.
    expect(calls.every((u) => u.startsWith('/api/registry/'))).toBe(true);
  });

  it('shows each model\'s own availability and the registry\'s reason — never inferred from the provider', async () => {
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    await waitFor(() => expect(screen.getByText('syn-two display')).toBeTruthy());
    const text = document.body.textContent || '';
    expect(text).toContain('AVAILABLE');
    expect(text).toContain('UNQUALIFIED: not yet qualified by an operator');
    expect(text).toContain('PRICING_REQUIRED: the manifest carries no pricing');
    expect(text).toContain('UNSUPPORTED_BY_ADAPTER: this build has no dispatch adapter for the anthropic.messages protocol');
    expect(text).toContain('1 of 4 registered models can execute now');
  });

  it('a namespaced, not-yet-normalized capability is shown, not dropped', async () => {
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    await waitFor(() => expect(screen.getAllByText('x.synthetic-alpha.brand_new_feature').length).toBeGreaterThan(0));
  });

  it('non-admins see the catalog but not the qualify / enable actions', async () => {
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    await waitFor(() => expect(screen.getByText('syn-one display')).toBeTruthy());
    await waitFor(() => expect(document.body.textContent).toContain('platform-admin actions'));
    expect(screen.queryAllByText('Qualify')).toHaveLength(0);
  });

  it('a failed registry read is reported as a failure, not as an empty catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ success: false, error: 'boom' }) })) as any);
    render(<ProviderModelCatalog workspaceId="ws-test" />);
    await waitFor(() => expect(document.body.textContent).toContain('Registry unavailable: boom'));
  });
});

describe('the shared selector', () => {
  it('lists every model grouped by provider; unavailable ones are disabled with their reason', async () => {
    const onChange = vi.fn();
    render(<RegistryModelSelect workspaceId="ws-test" value="" onChange={onChange} />);
    await waitFor(() => expect(screen.getByText(/syn-one display/)).toBeTruthy());
    const options = Array.from(document.querySelectorAll('option')).filter((o) => (o as HTMLOptionElement).value);
    const byValue = Object.fromEntries(options.map((o) => [(o as HTMLOptionElement).value, o as HTMLOptionElement]));
    expect(Object.keys(byValue).sort()).toEqual(['synthetic-alpha/syn-one', 'synthetic-alpha/syn-three', 'synthetic-alpha/syn-two', 'synthetic-beta/syn-four']);
    expect(byValue['synthetic-alpha/syn-one'].disabled).toBe(false);
    expect(byValue['synthetic-alpha/syn-two'].disabled).toBe(true);
    expect(byValue['synthetic-alpha/syn-two'].textContent).toContain('not yet qualified');
    expect(byValue['synthetic-beta/syn-four'].disabled).toBe(true);
    expect(Array.from(document.querySelectorAll('optgroup')).map((g) => g.getAttribute('label'))).toEqual(['Synthetic Alpha (1/3 executable)', 'Synthetic Beta (0/1 executable)']);
    fireEvent.change(document.querySelector('select')!, { target: { value: 'synthetic-alpha/syn-one' } });
    expect(onChange).toHaveBeenCalledWith('synthetic-alpha/syn-one', expect.objectContaining({ modelId: 'syn-one' }));
  });

  it('opening the selector reads only the local registry', async () => {
    render(<RegistryModelSelect workspaceId="ws-test" value="" onChange={() => {}} showFilters />);
    await waitFor(() => expect(screen.getByText(/syn-one display/)).toBeTruthy());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^\/api\/registry\/models\?workspaceId=ws-test/);
  });

  it('filters by availability without a hardcoded list', async () => {
    render(<RegistryModelSelect workspaceId="ws-test" value="" onChange={() => {}} showFilters />);
    await waitFor(() => expect(screen.getByText(/syn-one display/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Availability'), { target: { value: 'EXECUTABLE' } });
    const values = Array.from(document.querySelectorAll('select#undefined, select')).pop()!;
    const opts = Array.from((values as HTMLSelectElement).querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value).filter(Boolean);
    expect(opts).toEqual(['synthetic-alpha/syn-one']);
  });
});

describe('no production model name lives in a reusable model UI component', () => {
  const PRODUCTION = /\b(claude|gpt-|gemini-|deepseek-|o[1-9]-|sonnet|opus|haiku|llama|mistral|grok)/i;
  for (const f of [
    'src/components/registry/RegistryModelSelect.tsx',
    'src/components/registry/useModelRegistry.ts',
    'src/components/registry/EvaluationRequestPanel.tsx',
    'src/components/ProviderModelCatalog.tsx',
  ]) {
    it(f, () => {
      const code = fs.readFileSync(path.join(process.cwd(), f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(code).not.toMatch(PRODUCTION);
    });
  }

  it('the task-creation, task-detail and graph-node selectors are the registry selector', () => {
    const kanban = fs.readFileSync(path.join(process.cwd(), 'src/components/KanbanView.tsx'), 'utf8');
    expect(kanban).toContain('<RegistryModelSelect');
    expect(kanban).not.toMatch(/<option value="[^"]*">[^<]*(Claude|ChatGPT|DeepSeek|Gemini|Perplexity Sonar|Nous Hermes)/);
    const graph = fs.readFileSync(path.join(process.cwd(), 'src/components/GraphBuilderView.tsx'), 'utf8');
    expect(graph).toContain('<RegistryModelSelect');
    expect(graph).not.toMatch(/<option value="[^"]*">[^<]*(Claude|DeepSeek|Gemini|OpenRouter|Llama)/);
    const data = fs.readFileSync(path.join(process.cwd(), 'src/data/mockData.ts'), 'utf8');
    expect(data).not.toContain('export const INITIAL_MODELS');
  });
});


describe('the task board makes no provider call to open, refresh or show a DONE task', () => {
  it('rendering and re-rendering the board (a DONE task included) only reads the local registry', async () => {
    const noop = () => {};
    const task: any = {
      id: 'task-ui-1', title: 'A finished task', description: 'd', column: 'done', assignedAgent: 'scribe', assignedModel: 'synthetic-alpha/syn-one',
      priority: 'medium', tags: [], obsidianWikilinks: [], subtasks: [], dependencies: [], createdAt: 'now', updatedAt: 'now',
      executedModel: { providerId: 'synthetic-alpha', modelId: 'syn-one', reportedModel: 'syn-one' },
      verificationOutcome: { taskStatus: 'DONE', receiptOutcome: 'COMPLETED', receiptId: 'rcpt-1' },
    };
    const props: any = { tasks: [task], agents: INITIAL_AGENTS, models: {}, onAddTask: noop, onUpdateTask: noop, onDeleteTask: noop, onExecuteTask: async () => {}, onPushTaskToObsidian: noop, onSelectAgent: noop, activeWorkspaceId: 'ws-test' };
    const { rerender } = render(<KanbanView {...props} />);
    await new Promise((r) => setTimeout(r, 30));
    rerender(<KanbanView {...props} tasks={[{ ...task }]} />);
    await new Promise((r) => setTimeout(r, 30));
    // The card states what actually ran, from the receipt.
    expect(document.body.textContent).toContain('Ran: synthetic-alpha/syn-one');
    // No generation, execution, evaluation or provider endpoint was touched.
    expect(calls.filter((u) => !u.startsWith('/api/registry/'))).toEqual([]);
  });
});
