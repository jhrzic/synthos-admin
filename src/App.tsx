import React, { useState, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
import { useModelRegistry, modelKey, type RegistryState } from './components/registry/useModelRegistry';
import { 
  ActiveTab, AIModelInfo, ObsidianNote, ObsidianVault, 
  BotTask, JarvisSettings, AgentInfo, KanbanTask, ModelRouterRule, AgentRole,
  TelegramMessage, CronScheduleJob, IntakeItem, IdeaItem, SystemAuditCheck, SynthOSRun,
  KanbanColumnId
} from './types';
import { 
  INITIAL_VAULTS, INITIAL_NOTES, 
  INITIAL_BOT_TASKS, INITIAL_JARVIS_SETTINGS,
  INITIAL_AGENTS, INITIAL_KANBAN_TASKS, INITIAL_ROUTER_RULES,
  INITIAL_TELEGRAM_MESSAGES, INITIAL_CRON_JOBS, INITIAL_GUIDE_STEPS,
  INITIAL_INTAKE_ITEMS, INITIAL_IDEAS, INITIAL_SYSTEM_AUDIT_CHECKS,
  GuideStep
} from './data/mockData';
import { AGENT_DEFINITIONS } from './data/agentDefinitions';
import { AirbyteHeader } from './components/AirbyteHeader';
import { SidebarNav } from './components/SidebarNav';
import { WorkspaceTopNav, WorkspaceType } from './components/WorkspaceTopNav';
import { HermesCoreView } from './components/HermesCoreView';
import { HermesChatView } from './components/HermesChatView';
import { HermesTerminalView } from './components/HermesTerminalView';
import { ApolloVoiceView } from './components/ApolloVoiceView';
import { HermesManageView } from './components/HermesManageView';
import { ObsidianView } from './components/ObsidianView';
import { BotModeView } from './components/BotModeView';
import { JarvisView } from './components/JarvisView';
import { ModelDashboardView } from './components/ModelDashboardView';
// Pass VIII / Workstream W — lazy-loaded: each is only ever rendered when
// its own tab is active (see the `{activeTab === '...' && <X/>}` pattern
// below), so deferring its download until then is a safe, standard code-
// split with no behavior change — these are consistently the heaviest
// view files in src/components (>1000 lines each), the real driver of the
// >500KB initial-chunk warning.
const SettingsView = lazy(() => import('./components/SettingsView').then((m) => ({ default: m.SettingsView })));
import { CommandPalette } from './components/CommandPalette';
import { JarvisOverlayHUD } from './components/JarvisOverlayHUD';
import { GlobalVoiceOverlay } from './components/GlobalVoiceOverlay';
const KanbanView = lazy(() => import('./components/KanbanView').then((m) => ({ default: m.KanbanView })));
import { ModelRouterView } from './components/ModelRouterView';
import { AgentView } from './components/AgentView';
import { OverviewOfficeView } from './components/OverviewOfficeView';
import { TelegramChatView } from './components/TelegramChatView';
import { ContentLibraryView } from './components/ContentLibraryView';
import { ScheduleCronView } from './components/ScheduleCronView';
import { AgentDrawer } from './components/AgentDrawer';
import { AgentFleetView } from './components/AgentFleetView';
const StartupIdeaGeneratorView = lazy(() => import('./components/StartupIdeaGeneratorView').then((m) => ({ default: m.StartupIdeaGeneratorView })));
import { HermesOracleView } from './components/HermesOracleView';
import { AutoContentNewsView } from './components/AutoContentNewsView';
import { StudioLeadGenView } from './components/StudioLeadGenView';
import { ModelStackingView } from './components/ModelStackingView';
import { AgentMemoryView } from './components/AgentMemoryView';
import { MessageBridgeView } from './components/MessageBridgeView';
import { ClaudeArtifactsView } from './components/ClaudeArtifactsView';
import { LeadScraperView } from './components/LeadScraperView';
import { EcosystemReposView } from './components/EcosystemReposView';
import { IntakeTriageView } from './components/IntakeTriageView';
import { MasterOperationsView } from './components/MasterOperationsView';
import { IdeaStrategyHubView } from './components/IdeaStrategyHubView';
import { SkillRegistryView } from './components/SkillRegistryView';
import { SystemAuditView } from './components/SystemAuditView';
import { ActivityLedgerView } from './components/ActivityLedgerView';
import { ReceiptsView } from './components/ReceiptsView';
import { CanonicalReceiptsView } from './components/CanonicalReceiptsView';
import { SchedulerView } from './components/SchedulerView';
import { ExternalExecutionsView } from './components/ExternalExecutionsView';
import { DevelopmentView } from './components/DevelopmentView';
import { AeoAuditView } from './components/AeoAuditView';
import { BusinessAssistantView } from './components/BusinessAssistantView';
import { GuardianAegisControlView } from './components/GuardianAegisControlView';
import { WorkspacesView } from './components/WorkspacesView';
import { KanbanDependencyDAG } from './components/KanbanDependencyDAG';
const GraphBuilderView = lazy(() => import('./components/GraphBuilderView').then((m) => ({ default: m.GraphBuilderView })));
import { GraphRunsView } from './components/GraphRunsView';
import { GuideWalkthroughView } from './components/GuideWalkthroughView';
import { synthosControl } from './services/synthosControlService';
import { speakWithFishAudio, playBrowserSpeechFallback } from './services/fishAudio';
import { TONNetworkView } from './components/products/TONNetworkView';
import { TwinsConciergeView } from './components/products/TwinsConciergeView';
import { FrontendDemosView } from './components/products/FrontendDemosView';
import { UpstreamCapabilityRegistry } from './components/UpstreamCapabilityRegistry';
import { ToolRegistryView } from './components/ToolRegistryView';
import { ApprovalQueueView } from './components/ApprovalQueueView';
import { PageHelpDrawer } from './components/PageHelpDrawer';
import { FirstRunTour } from './components/FirstRunTour';
import { RightActivityPane } from './components/RightActivityPane';
import { RunDetailModal } from './components/RunDetailModal';
import { JulianGoldieAuditRunner } from './components/JulianGoldieAuditRunner';
const MasterAdminView = lazy(() => import('./components/MasterAdminView').then((m) => ({ default: m.MasterAdminView })));
import { GitMerge } from 'lucide-react';

interface AppProps {
  currentUser?: { user_id: string; email: string; display_name: string; platform_role: 'platform_admin' | 'standard' };
  authorizedWorkspaces?: Array<{ workspace_id: string; workspace_name: string; role: 'admin' | 'member' }>;
  onLogout?: () => void;
}

const LAST_WORKSPACE_STORAGE_KEY = 'synthos_last_workspace_id';

export default function App({ currentUser, authorizedWorkspaces = [], onLogout }: AppProps = {}) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  // E1/E3: the switcher's real options are the caller's own authorized
  // workspaces (from /api/auth/me via AuthGate) — never a hardcoded
  // sample list. Initial selection: a previously-selected workspace IF it
  // is still in the real authorized list (never trusted on its own — see
  // ADR-003 §7), else the first authorized workspace, else the historical
  // default as a last-resort fallback (e.g. before the auth wiring above
  // this component has resolved on first paint).
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(LAST_WORKSPACE_STORAGE_KEY);
      if (saved && authorizedWorkspaces.some((w) => w.workspace_id === saved)) return saved;
    } catch { /* localStorage unavailable — fall through */ }
    // Prefer the primary workspace over "whichever came back first".
    // authorizedWorkspaces[0] was the Isolation Test Workspace on this
    // install, so a first-time load landed on an empty test workspace and
    // every counter read 0 — correct for that workspace, and indistinguishable
    // from a broken dashboard.
    if (authorizedWorkspaces.some((w) => w.workspace_id === 'ws-synthos-primary')) return 'ws-synthos-primary';
    return authorizedWorkspaces[0]?.workspace_id || 'ws-synthos-primary';
  });

  // MODELS — from the persisted local model registry only. No UI-only model
  // list; a model installed by a plugin, signed manifest or Admin registration
  // appears everywhere this map is used, with no client change.
  const modelRegistry = useModelRegistry(activeWorkspaceId);
  const models = useMemo(() => registryModelInfo(modelRegistry), [modelRegistry.models, modelRegistry.providers]);

  useEffect(() => {
    try { localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, activeWorkspaceId); } catch { /* best effort */ }
  }, [activeWorkspaceId]);

  // E3: re-validates on every authorizedWorkspaces change, not just at
  // mount — covers a user switching accounts within the same browser tab
  // (logout, then a different user logs in) without a full page reload,
  // where this component instance persists across the identity change.
  useEffect(() => {
    if (authorizedWorkspaces.length === 0) return;
    if (!authorizedWorkspaces.some((w) => w.workspace_id === activeWorkspaceId)) {
      setActiveWorkspaceId(authorizedWorkspaces[0].workspace_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorizedWorkspaces]);
  const [agents, setAgents] = useState<Record<string, AgentInfo>>(AGENT_DEFINITIONS);
  const [kanbanTasks, setKanbanTasks] = useState<KanbanTask[]>(() => {
    try {
      const saved = localStorage.getItem('hermes_board_tasks');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Could not restore tasks from localStorage:', e);
    }
    return INITIAL_KANBAN_TASKS;
  });
  const [routerRules, setRouterRules] = useState<ModelRouterRule[]>(INITIAL_ROUTER_RULES);
  const [vaults, setVaults] = useState<ObsidianVault[]>(INITIAL_VAULTS);
  const [notes, setNotes] = useState<ObsidianNote[]>(() => {
    try {
      const saved = localStorage.getItem('hermes_obsidian_notes');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Could not restore notes from localStorage:', e);
    }
    return INITIAL_NOTES;
  });
  const [botTasks, setBotTasks] = useState<BotTask[]>(INITIAL_BOT_TASKS);
  const [jarvisSettings, setJarvisSettings] = useState<JarvisSettings>(() => {
    try {
      const saved = localStorage.getItem('hermes_jarvis_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        const voiceId = parsed.FISH_AUDIO_DEFAULT_VOICE_ID || parsed.fishAudioConfig?.voiceId || INITIAL_JARVIS_SETTINGS.FISH_AUDIO_DEFAULT_VOICE_ID || '05b36da8574341d0803391491850db20';
        const apiKey = parsed.FISH_AUDIO_API_KEY || parsed.fishAudioConfig?.apiKey || parsed.customApiKeys?.fish_audio || INITIAL_JARVIS_SETTINGS.FISH_AUDIO_API_KEY || '';
        return {
          ...INITIAL_JARVIS_SETTINGS,
          ...parsed,
          FISH_AUDIO_API_KEY: apiKey,
          FISH_AUDIO_DEFAULT_VOICE_ID: voiceId,
          fishAudioConfig: {
            ...INITIAL_JARVIS_SETTINGS.fishAudioConfig,
            ...(parsed.fishAudioConfig || {}),
            apiKey,
            voiceId,
          },
          customApiKeys: {
            ...INITIAL_JARVIS_SETTINGS.customApiKeys,
            ...(parsed.customApiKeys || {}),
            fish_audio: apiKey,
          }
        };
      }
    } catch (e) {
      console.warn('Could not restore settings from localStorage:', e);
    }
    return INITIAL_JARVIS_SETTINGS;
  });

  // Save settings changes to localStorage.
  //
  // P0 voice fix: the Fish Audio API key is deliberately STRIPPED before
  // writing. It now lives only in the server-side encrypted credential store
  // (lib/voice-credentials.ts). Persisting it here is what created two
  // competing browser copies of the secret — Jarvis read the store it was not
  // saved in, sent an empty key, and fell back to the robot voice.
  //
  // PUSH 2F extends the same rule to every provider key the browser has no
  // business holding. A credential is only kept here if browser code really
  // uses it:
  //   fish_audio — server-side store owns it (/api/voice/credentials).
  //   openai     — server-side encrypted store owns it (Model Providers).
  //   the rest   — no server execution mapping exists, so a key stored here
  //                would sit in localStorage being read by nothing.
  //
  // elevenlabs is deliberately NOT in this list: JarvisView really does send
  // it as an xi-api-key header from the browser, so dropping it would break a
  // working feature. Preserved exactly because it is genuinely used.
  //
  // Setting each to undefined removes it on the next save, so a key an earlier
  // build collected stops being stored. It is never read, and never migrated
  // anywhere — a credential the server never saw is not ours to move.
  useEffect(() => {
    try {
      const { FISH_AUDIO_API_KEY, ...safeSettings } = jarvisSettings as any;
      const redacted = {
        ...safeSettings,
        fishAudioConfig: safeSettings.fishAudioConfig
          ? { ...safeSettings.fishAudioConfig, apiKey: undefined }
          : safeSettings.fishAudioConfig,
        // Only fish_audio was stripped here, so every OTHER provider key typed
        // into Settings was still written to browser storage in plaintext —
        // including openai, which the server never received. The browser then
        // displayed a configured key while the server reported NOT_CONFIGURED.
        //
        // Stripped by an allowlist of NON-secret fields rather than a blocklist
        // of secret ones: a blocklist silently leaks the next provider anyone
        // adds, which is exactly how openai slipped through.
        customApiKeys: safeSettings.customApiKeys
          ? Object.fromEntries(
              Object.entries(safeSettings.customApiKeys).map(([provider, value]) => [
                provider,
                value === 'SERVER_MANAGED_KEY' ? value : undefined,
              ]),
            )
          : safeSettings.customApiKeys,
      };
      localStorage.setItem('hermes_jarvis_settings', JSON.stringify(redacted));
    } catch (e) {
      console.warn('Could not persist settings to localStorage:', e);
    }
  }, [jarvisSettings]);

  // ---------------------------------------------------------------------
  // One-time migration of a Fish Audio key that an earlier build saved into
  // browser storage. It is handed to the server's encrypted store and then
  // erased from localStorage, so an existing install keeps working without
  // the owner re-typing the key, and the browser stops holding the secret.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const MIGRATION_FLAG = 'synthos_voice_credential_migrated';
    if (localStorage.getItem(MIGRATION_FLAG) === 'done') return;

    const scrub = () => {
      for (const storeKey of ['hermes_jarvis_settings', 'hermes_voice_config']) {
        try {
          const raw = localStorage.getItem(storeKey);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          delete parsed.apiKey;
          delete parsed.FISH_AUDIO_API_KEY;
          if (parsed.fishAudioConfig) delete parsed.fishAudioConfig.apiKey;
          if (parsed.customApiKeys) delete parsed.customApiKeys.fish_audio;
          localStorage.setItem(storeKey, JSON.stringify(parsed));
        } catch { /* best effort */ }
      }
      localStorage.setItem(MIGRATION_FLAG, 'done');
    };

    let foundKey = '';
    let foundVoiceId = '';
    for (const storeKey of ['hermes_voice_config', 'hermes_jarvis_settings']) {
      try {
        const raw = localStorage.getItem(storeKey);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        foundKey = foundKey || parsed.apiKey || parsed.FISH_AUDIO_API_KEY || parsed.fishAudioConfig?.apiKey || parsed.customApiKeys?.fish_audio || '';
        foundVoiceId = foundVoiceId || parsed.voiceId || parsed.FISH_AUDIO_DEFAULT_VOICE_ID || parsed.fishAudioConfig?.voiceId || '';
      } catch { /* ignore */ }
    }

    if (!foundKey && !foundVoiceId) {
      localStorage.setItem(MIGRATION_FLAG, 'done');
      return;
    }

    fetch('/api/voice/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(foundKey ? { apiKey: foundKey } : {}),
        ...(foundVoiceId ? { referenceId: foundVoiceId } : {}),
      }),
    })
      .then((res) => { if (res.ok) scrub(); })
      .catch(() => { /* retried on next load */ });
  }, []);

  // ---------------------------------------------------------------------
  // One-time migration of a MODEL-PROVIDER key that an earlier build saved
  // into browser storage. Same shape as the Fish Audio migration above, and
  // for the same reason: the browser must never be an authority on a
  // credential the server is the one that has to use.
  //
  // Only providers the router can execute are migrated. A key for a provider
  // with no execution mapping is scrubbed rather than stored, because keeping
  // it would preserve the ambiguity this migration exists to remove — and
  // storing it would imply a capability that does not exist.
  //
  // The scrub happens only after the server confirms the save, so a failed
  // request leaves the value in place to retry on the next load rather than
  // destroying the only copy.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const MIGRATION_FLAG = 'synthos_model_credential_migrated';
    if (localStorage.getItem(MIGRATION_FLAG) === 'done') return;

    const MIGRATABLE = ['openai', 'gemini'];
    const STORE_KEY = 'hermes_jarvis_settings';

    const scrubModelKeys = () => {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.customApiKeys) {
            for (const provider of Object.keys(parsed.customApiKeys)) {
              if (parsed.customApiKeys[provider] !== 'SERVER_MANAGED_KEY') {
                delete parsed.customApiKeys[provider];
              }
            }
          }
          localStorage.setItem(STORE_KEY, JSON.stringify(parsed));
        }
      } catch { /* best effort */ }
      localStorage.setItem(MIGRATION_FLAG, 'done');
    };

    let found: Array<{ provider: string; apiKey: string }> = [];
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const keys = parsed?.customApiKeys || {};
      found = MIGRATABLE
        .map((provider) => ({ provider, apiKey: String(keys[provider] || '').trim() }))
        .filter((e) => e.apiKey && e.apiKey !== 'SERVER_MANAGED_KEY');
    } catch { /* ignore */ }

    if (found.length === 0) {
      // Nothing to migrate. Still scrub, so a non-migratable provider's key
      // does not sit in browser storage forever.
      scrubModelKeys();
      return;
    }

    Promise.all(
      found.map((entry) =>
        fetch('/api/business/model-credential', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId: activeWorkspaceId,
            provider: entry.provider,
            apiKey: entry.apiKey,
          }),
        }).then((res) => res.ok),
      ),
    )
      .then((results) => { if (results.every(Boolean)) scrubModelKeys(); })
      .catch(() => { /* retried on next load */ });
  }, [activeWorkspaceId]);

  // DAYS 2-3 PART B — voice configuration is SERVER state, not browser state.
  //
  // This used to initialise from localStorage['hermes_voice_config'] and write
  // back to it, which is precisely what produced the CLI-vs-dashboard mismatch:
  // the dashboard showed a per-browser preference the server had never heard
  // of, defaulting to 'web_speech', while the runtime resolved its provider,
  // voice and model from the server-side store. Two browsers disagreed with
  // each other and both disagreed with the runtime.
  //
  // The server is now authoritative (GET/PUT /api/voice/runtime-config). This
  // state is a CACHE of that, hydrated on load — never the source. `speed` is
  // the one genuinely client-side value (it is a playback preference, not
  // runtime configuration) and remains local.
  const [voiceConfig, setVoiceConfig] = useState<any>({
    provider: 'web_speech',
    voiceId: '',
    model: '',
    speed: 1.0,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/voice/runtime-config', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.success) return;
        const c = d.config;
        setVoiceConfig((prev: any) => ({
          ...prev,
          provider: c.provider,
          voiceId: c.providerVoiceId || '',
          model: c.ttsModel || '',
          agentDisplayName: c.agentDisplayName,
          voiceProfileName: c.voiceProfileName,
          ready: c.ready,
          reason: c.reason,
          loaded: true,
        }));
      })
      .catch(() => { /* the UI keeps the honest web_speech default */ });
    return () => { cancelled = true; };
  }, []);

  const handleUpdateVoiceConfig = (newConfig: any) => {
    // Optimistic locally, authoritative on the server: the response replaces
    // local state, so what is displayed is always what the server resolved —
    // including a provider that was rejected or is not ready.
    setVoiceConfig((prev: any) => ({ ...prev, ...newConfig }));
    fetch('/api/voice/runtime-config', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: newConfig.provider,
        agentDisplayName: newConfig.agentDisplayName,
        voiceProfileName: newConfig.voiceProfileName,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.success) return;
        const c = d.config;
        setVoiceConfig((prev: any) => ({
          ...prev,
          provider: c.provider,
          voiceId: c.providerVoiceId || '',
          model: c.ttsModel || '',
          agentDisplayName: c.agentDisplayName,
          voiceProfileName: c.voiceProfileName,
          ready: c.ready,
          reason: c.reason,
          loaded: true,
        }));
      })
      .catch(() => { /* leave the optimistic value; the next load re-reads truth */ });
  };
  
  // Mission Control Specialized State with local persistence
  const [telegramMessages, setTelegramMessages] = useState<Record<string, TelegramMessage[]>>(() => {
    try {
      const saved = localStorage.getItem('hermes_telegram_messages');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Could not restore telegram messages from localStorage:', e);
    }
    return INITIAL_TELEGRAM_MESSAGES;
  });
  const [cronJobs, setCronJobs] = useState<CronScheduleJob[]>(INITIAL_CRON_JOBS);
  const [guideSteps, setGuideSteps] = useState<GuideStep[]>(() => {
    try {
      const saved = localStorage.getItem('hermes_guide_steps');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Could not restore guide steps from localStorage:', e);
    }
    return INITIAL_GUIDE_STEPS;
  });
  const [drawerAgentRole, setDrawerAgentRole] = useState<AgentRole | null>(null);
  const [isSidebarVisible, setIsSidebarVisible] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('hermes_sidebar_visible');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('hermes_sidebar_visible', JSON.stringify(isSidebarVisible));
    } catch (e) {
      console.warn('Could not save sidebar visibility:', e);
    }
  }, [isSidebarVisible]);

  // Persistence Effects for board tasks, notes, messages, and guide steps
  useEffect(() => {
    try {
      localStorage.setItem('hermes_board_tasks', JSON.stringify(kanbanTasks));
    } catch (e) {
      console.warn('Could not save tasks:', e);
    }
  }, [kanbanTasks]);

  useEffect(() => {
    try {
      localStorage.setItem('hermes_obsidian_notes', JSON.stringify(notes));
    } catch (e) {
      console.warn('Could not save notes:', e);
    }
  }, [notes]);

  useEffect(() => {
    try {
      localStorage.setItem('hermes_telegram_messages', JSON.stringify(telegramMessages));
    } catch (e) {
      console.warn('Could not save telegram messages:', e);
    }
  }, [telegramMessages]);

  useEffect(() => {
    try {
      localStorage.setItem('hermes_guide_steps', JSON.stringify(guideSteps));
    } catch (e) {
      console.warn('Could not save guide steps:', e);
    }
  }, [guideSteps]);

  // Hermes AgentOS Specialized Modules State
  const [intakeItems, setIntakeItems] = useState<IntakeItem[]>(INITIAL_INTAKE_ITEMS);
  const [ideaItems, setIdeaItems] = useState<IdeaItem[]>(INITIAL_IDEAS);
  const [systemAuditChecks, setSystemAuditChecks] = useState<SystemAuditCheck[]>(INITIAL_SYSTEM_AUDIT_CHECKS);

  // Voice Feedback Streamer Helper (Fish Audio with Web Speech Fallback)
  const handlePlayVoiceFeedback = async (text: string) => {
    const apiKey = jarvisSettings.FISH_AUDIO_API_KEY || jarvisSettings.fishAudioConfig?.apiKey;
    const voiceId = jarvisSettings.FISH_AUDIO_DEFAULT_VOICE_ID || jarvisSettings.fishAudioConfig?.voiceId || '05b36da8574341d0803391491850db20';
    try {
      await speakWithFishAudio(text, apiKey, voiceId);
    } catch {
      await playBrowserSpeechFallback(text);
    }
  };

  // Modals & Palettes & Help Drawers
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isGlobalVoiceOpen, setIsGlobalVoiceOpen] = useState(false);
  const [isHelpDrawerOpen, setIsHelpDrawerOpen] = useState(false);
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [isActivityPaneOpen, setIsActivityPaneOpen] = useState(false);
  const [selectedRunModal, setSelectedRunModal] = useState<SynthOSRun | null>(null);
  const [isJulianAuditOpen, setIsJulianAuditOpen] = useState<boolean>(false);

  // Global Key Listener for Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Execute Query via Server-Side API (/api/generate)
  const handleSendQuery = async (query: string, targetModel: string, systemInstruction?: string): Promise<string> => {
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: query,
          model: targetModel,
          systemInstruction,
          temperature: 0.7,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      if (data.success === false) {
        return `[STATUS: DEGRADED - MODEL_RUNTIME_UNAVAILABLE]\nFailed to process request: ${data.error || 'Server reported execution failure'}\nProvider: ${data.model || targetModel}`;
      }

      // /api/generate's success branch always returns a real, non-empty `reply` (it only
      // sets success:true after a candidate model actually produced text) — so this used to
      // be dead code, but dead code that fabricated a fake "Executed and synchronized with
      // the Knowledge Graph" completion message if it were ever reached. Fail honestly instead.
      return data.reply || `[STATUS: DEGRADED - EMPTY_RESPONSE]\nThe model returned no content.\nProvider: ${data.model || targetModel}`;
    } catch (err: any) {
      console.warn('API fetch warning:', err);
      return `[STATUS: DEGRADED - MODEL_RUNTIME_UNAVAILABLE]\nReason: ${err.message || 'Network error / API gateway unreachable'}`;
    }
  };

  // Real, workspace-scoped Jarvis conversation session. Lazily created on
  // the first directive of a session and reset whenever the active
  // workspace changes (a session belongs to one workspace, same as every
  // other Jarvis admin query) or the user explicitly starts a new chat.
  const [jarvisSessionId, setJarvisSessionId] = useState<string | null>(null);
  useEffect(() => { setJarvisSessionId(null); }, [activeWorkspaceId]);
  const handleNewJarvisSession = () => setJarvisSessionId(null);

  // STEP 6 corrective pass (B2) — the one real in-flight guard shared by
  // BOTH Jarvis surfaces (JarvisView's typed submission and
  // GlobalVoiceOverlay's voice dispatch both call this same function),
  // so "voice and typed input share the same guard" holds structurally
  // rather than by convention. A ref, not state: state updates are
  // batched/async, so two calls fired in the same synchronous tick (a
  // real double-click, or a click racing a voice callback) would both
  // still read a stale `false` before either commit — a ref is read/set
  // synchronously and closes that race. This is a real guard, not a
  // debounce: a duplicate call while one is in flight is rejected
  // outright (returns null), never queued or delayed.
  const jarvisInFlightRef = useRef(false);
  const [jarvisRequestInFlight, setJarvisRequestInFlight] = useState(false);

  // Real, workspace-scoped Jarvis admin-command dispatcher. Jarvis's own
  // text/voice submission uses this instead of handleSendQuery — the
  // backend route itself decides whether the directive is a supported admin
  // query (tasks/graphs/receipts) or ordinary conversation, and answers
  // accordingly. Only Jarvis calls this; every other onSendQuery consumer
  // (Hermes chat, Twins, Skills test, etc.) is unaffected.
  //
  // Every real directive and its real reply is also persisted to a
  // workspace-scoped Jarvis session (lib/jarvis-sessions.ts) — a real
  // conversation history that survives reload, not just React state. A
  // persistence failure here never blocks the directive itself from
  // returning a reply.
  //
  // Returns null (never throws, never fabricates a response) when a
  // request is already in flight — the guard's real rejection signal,
  // which every caller must treat as "ignored," not "failed."
  const handleJarvisCommand = async (command: string, messageType: 'text' | 'voice_transcript' = 'text'): Promise<{ reply: string; spokenSummary: string | null } | null> => {
    if (jarvisInFlightRef.current) {
      return null;
    }
    jarvisInFlightRef.current = true;
    setJarvisRequestInFlight(true);
    try {
      return await dispatchJarvisCommand(command, messageType);
    } finally {
      // B2 — the guard clears on every real outcome: success, failure,
      // blocked/degraded result, or network error. dispatchJarvisCommand
      // below never throws (every branch is caught internally), so this
      // finally is the one real clear point.
      jarvisInFlightRef.current = false;
      setJarvisRequestInFlight(false);
    }
  };

  const dispatchJarvisCommand = async (command: string, messageType: 'text' | 'voice_transcript' = 'text'): Promise<{ reply: string; spokenSummary: string | null }> => {
    let sessionId = jarvisSessionId;
    try {
      if (!sessionId) {
        const sessionRes = await fetch('/api/jarvis/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId: activeWorkspaceId }),
        });
        const sessionData = await sessionRes.json();
        if (sessionRes.ok && sessionData.success !== false) {
          sessionId = sessionData.session.session_id;
          setJarvisSessionId(sessionId);
        }
      }
      if (sessionId) {
        fetch(`/api/jarvis/sessions/${encodeURIComponent(sessionId)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId: activeWorkspaceId, role: 'user', content: command, messageType }),
        }).catch(() => { /* real network failure — the directive below still runs */ });
      }
    } catch {
      // Session bootstrap failed — proceed without persistence rather than
      // blocking the directive itself.
    }

    let reply: string;
    // TTS/speech separation (P3) — the concise, spoken-safe text, distinct
    // from `reply` (the full text that goes to the transcript and vault).
    // /api/jarvis/command now returns this alongside `reply`; a network-
    // level failure (never reaches the server) gets a short honest
    // client-side one instead of the raw error text.
    let spokenSummary: string | null;
    try {
      // Jarvis conversation memory task — sessionId is now passed through
      // so the server can retrieve this exact conversation's own real,
      // bounded prior history (lib/jarvis-sessions.ts) and inject it into
      // reasoning. Previously omitted entirely — every request reasoned
      // with zero awareness of what was said earlier in the same session,
      // even though that history was already being persisted above.
      // B2 — one real key per logical submission attempt, generated here
      // (inside the already-guarded dispatchJarvisCommand, reachable only
      // once at a time) so the server can reuse the canonical task-table
      // idempotency check if this exact request is ever resubmitted.
      const idempotencyKey = `jarvis-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await fetch('/api/jarvis/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, workspaceId: activeWorkspaceId, sessionId: sessionId || null, idempotencyKey }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        reply = `[STATUS: DEGRADED - JARVIS_COMMAND_UNAVAILABLE]\n${data.error || `HTTP ${res.status}`}`;
        spokenSummary = typeof data.spokenSummary === 'string' && data.spokenSummary.trim()
          ? data.spokenSummary.trim()
          : "I can't process that right now.";
      } else {
        reply = data.reply || 'Directive acknowledged.';
        spokenSummary = typeof data.spokenSummary === 'string' && data.spokenSummary.trim()
          ? data.spokenSummary.trim()
          : null;
      }
    } catch (err: any) {
      reply = `[STATUS: DEGRADED - JARVIS_COMMAND_UNAVAILABLE]\nReason: ${err?.message || 'Network error / API gateway unreachable'}`;
      spokenSummary = "I can't reach SynthOS right now.";
    }

    if (sessionId) {
      fetch(`/api/jarvis/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: activeWorkspaceId, role: 'assistant', content: reply }),
      }).catch(() => { /* real network failure — the reply is still returned to the caller */ });
    }

    return { reply, spokenSummary };
  };

  // Add Note to Obsidian Vault with full Workspace Memory Provenance
  const handleAddNoteToVault = (
    title: string, 
    content: string, 
    tags: string[] = ['hermes', 'obsidian'], 
    folder: string = 'Startup-Theses',
    provenanceMeta?: Partial<Pick<ObsidianNote, 
      'workspace' | 'objective' | 'task' | 'agent' | 'model' | 'tools' | 'sources' | 'artifact' | 'decision' | 'verification' | 'lesson' | 'error' | 'timestamp' | 'provenance'
    >>
  ) => {
    const timestampStr = new Date().toISOString();
    const cleanTitle = title.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 50);

    // F2 (SynthOS Execution Fabric, Phase 0) — this function has no real
    // persistence path: below, it only calls setNotes() into React state
    // (see also the real, separate, GET-only /api/vault routes in
    // server.ts, and the real fs.writeFileSync vault writer used only by
    // Windmill external-execution results — neither is called here). Every
    // default below used to name a specific tool, source, or Aegis score
    // that never ran/existed for a plain client-side note. None of these
    // are guesses about what SHOULD be true — they are honest statements
    // of what actually happened: nothing was verified, no tool ran, and
    // this is not durably saved. Real values still flow through untouched
    // whenever a caller actually supplies provenanceMeta.
    const defaultProvenance = {
      workspace: folder || 'SynthOS-Shared-Workspace',
      objective: provenanceMeta?.objective || 'System Curation / Research Task',
      task: provenanceMeta?.task || title,
      agent: provenanceMeta?.agent || 'NOT_AVAILABLE',
      model: provenanceMeta?.model || 'NOT_AVAILABLE',
      tools: provenanceMeta?.tools || [],
      sources: provenanceMeta?.sources || [],
      artifact: `${folder}/${cleanTitle}.md`,
      decision: provenanceMeta?.decision || 'NOT_IMPLEMENTED — no automated commit executed',
      verification: provenanceMeta?.verification || 'NOT_VERIFIED — no Aegis review has run on this note',
      lesson: provenanceMeta?.lesson || 'NOT_AVAILABLE',
      error: provenanceMeta?.error || 'None',
      timestamp: timestampStr,
      provenance: provenanceMeta?.provenance || 'NOT_IMPLEMENTED — held in browser session state only; not written to a real Vault or filesystem'
    };

    const finalMeta = { ...defaultProvenance, ...provenanceMeta };

    // Inject YAML-style frontmatter onto the Markdown document itself
    const frontmatter = `---
workspace: "${finalMeta.workspace}"
objective: "${finalMeta.objective}"
task: "${finalMeta.task}"
agent: "${finalMeta.agent}"
model: "${finalMeta.model}"
tools: ${JSON.stringify(finalMeta.tools)}
sources: ${JSON.stringify(finalMeta.sources)}
artifact: "${finalMeta.artifact}"
decision: "${finalMeta.decision}"
verification: "${finalMeta.verification}"
lesson: "${finalMeta.lesson}"
error: "${finalMeta.error}"
timestamp: "${finalMeta.timestamp}"
provenance: "${finalMeta.provenance}"
---

`;

    const finalContent = content.startsWith('---') ? content : frontmatter + content;
    const localId = `note-${Date.now()}`;

    const newNote: ObsidianNote = {
      id: localId,
      title,
      path: `${folder}/${cleanTitle}.md`,
      folder,
      content: finalContent,
      tags,
      wikilinks: ['Hermes-Knowledge-Mesh', 'Obsidian-Knowledge-Graph'],
      updatedAt: 'Just now',
      createdAt: timestampStr.slice(0, 10),
      ...finalMeta
    };

    // Optimistic local echo — same immediate UI update as before, so every
    // existing caller (still a synchronous, fire-and-forget void callback;
    // ~28 call sites across this file, unchanged) keeps working exactly as
    // it did. What's new is the real write below and the honest patch once
    // it resolves — this function no longer pretends that showing the note
    // locally IS the save.
    setNotes(prev => [newNote, ...prev]);
    setVaults(prev => prev.map(v => v.id === 'vault-1' ? { ...v, notesCount: v.notesCount + 1 } : v));

    // STEP 2 — the real, server-backed write (lib/vault.ts
    // writeWorkspaceArtifact via POST /api/vault/notes). No fabricated
    // success: the optimistic note above is patched with the real
    // server-confirmed path/hash on success, or an honest failure state on
    // failure — never silently left claiming a save that did not happen.
    fetch('/api/vault/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: activeWorkspaceId, title, content: finalContent, tags, folder }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          const reason = data?.error || `HTTP ${res.status}`;
          setNotes(prev => prev.map(n => n.id === localId ? {
            ...n,
            verification: `SAVE_FAILED — ${reason}`,
            provenance: 'NOT_IMPLEMENTED — real save attempted and failed; this note exists only in this browser session',
          } : n));
          return;
        }
        setNotes(prev => prev.map(n => n.id === localId ? {
          ...n,
          path: data.artifact.relativePath,
          artifact: data.artifact.relativePath,
          verification: `SAVED — real Vault artifact ${data.artifact.id} (sha256 ${String(data.artifact.contentHash).slice(0, 19)}…)`,
          provenance: `Server-backed write via POST /api/vault/notes -> lib/vault.ts writeWorkspaceArtifact (workspace ${data.workspaceId})`,
        } : n));
      })
      .catch((err: any) => {
        setNotes(prev => prev.map(n => n.id === localId ? {
          ...n,
          verification: `SAVE_FAILED — ${err?.message || 'network error'}`,
          provenance: 'NOT_IMPLEMENTED — real save attempted and failed; this note exists only in this browser session',
        } : n));
      });
  };

  const handleUpdateNote = (id: string, updates: Partial<ObsidianNote>) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...updates, updatedAt: 'Just now' } : n));
  };

  const handleDeleteNote = (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
  };

  // Kanban Task Operations
  // `subtasks` is REQUIRED on KanbanTask, but the components that call this
  // are typed Omit<KanbanTask, ... | 'subtasks'> and two of them —
  // GlobalVoiceOverlay and ApolloVoiceView — genuinely do not pass it. The
  // spread then produced a task whose `subtasks` was `undefined` while the
  // type insisted it was an array, and three call sites read it unguarded:
  // handleCompleteTask (task.subtasks.map), the Brain note builder
  // (task.subtasks.map) and KanbanView's subtask toggle. Creating a task by
  // voice and then completing it threw a TypeError.
  //
  // Defaulted here, at the one place every task is constructed, so the
  // invariant the type promises is actually true. This also makes the prop
  // signatures agree.
  const handleAddKanbanTask = (
    task: Omit<KanbanTask, 'id' | 'createdAt' | 'updatedAt' | 'subtasks'> & { subtasks?: KanbanTask['subtasks'] },
  ) => {
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const newTask: KanbanTask = {
      ...task,
      subtasks: task.subtasks ?? [],
      id: `task-kanban-${Date.now()}`,
      createdAt: now,
      updatedAt: now,
    };
    setKanbanTasks(prev => [newTask, ...prev]);

    // Log to SynthOS Activity Ledger
    synthosControl.logEvent({
      taskId: newTask.id,
      eventType: 'TASK_CREATED',
      actorRole: task.assignedAgent,
      actorModel: task.assignedModel,
      summary: `Created task "${newTask.title}" assigned to ${task.assignedAgent.toUpperCase()} (${task.assignedModel}).`,
      payload: { title: newTask.title, priority: newTask.priority, category: newTask.category },
      isSimulated: false
    });
    
    // update agent active count
    setAgents(prev => {
      const ag = prev[task.assignedAgent];
      if (ag) {
        return {
          ...prev,
          [task.assignedAgent]: {
            ...ag,
            activeTasksCount: ag.activeTasksCount + 1
          }
        };
      }
      return prev;
    });
  };

  const handleUpdateKanbanTask = (id: string, updates: Partial<KanbanTask>) => {
    setKanbanTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates, updatedAt: 'Just now' } : t));
  };

  const handleDeleteKanbanTask = (id: string) => {
    setKanbanTasks(prev => prev.filter(t => t.id !== id));
  };

  const handleExecuteKanbanTask = async (taskId: string) => {
    const task = kanbanTasks.find(t => t.id === taskId);
    if (!task) return;

    const agent = agents[task.assignedAgent];
    const systemPrompt = agent?.systemPrompt || 'You are an autonomous Hermes AgentOS Specialist.';

    // 1. Pre-execution Guardian Policy Evaluation
    const guardianCheck = synthosControl.evaluateGuardianPolicy(task, task.assignedAgent);
    if (!guardianCheck.approved) {
      handleUpdateKanbanTask(taskId, {
        column: 'blocked',
        outputLog: `[Guardian Policy Sentinel]: Execution blocked. Reason: ${guardianCheck.reason}`,
      });
      return;
    }

    // 2. Dispatch Task to Runtime (Mark RUNNING)
    handleUpdateKanbanTask(taskId, { 
      column: 'running',
      claimedBy: agent?.name || task.assignedAgent.toUpperCase(),
      updatedAt: 'Just now (Running)'
    });

    synthosControl.logEvent({
      taskId: task.id,
      eventType: 'TASK_DISPATCHED',
      actorRole: task.assignedAgent,
      actorModel: task.assignedModel,
      summary: `Task "${task.title}" dispatched to ${task.assignedAgent.toUpperCase()} sandbox runtime.`,
      payload: { model: task.assignedModel },
      isSimulated: false
    });

    const startTime = Date.now();

    try {
      // ONE dispatch to the canonical execution endpoint. Its decision is final.
      try {
        const execRes = await fetch('/api/execute-agent-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: task.id,
            taskTitle: task.title,
            title: task.title,
            description: task.description,
            assignedAgent: task.assignedAgent,
            assignedModel: task.assignedModel,
            stage: task.stage,
            dependencies: task.dependencies
          })
        });

        // Read the body whatever the HTTP status: a canonical decision can
        // arrive as 200 (INCOMPLETE / VERIFICATION_FAILED) or 4xx (refused).
        const execData = await execRes.json().catch(() => null);
        const verificationOutcome = execData && typeof execData.taskId === 'string' && typeof execData.status === 'string'
          ? {
              taskStatus: execData.status,
              scopes: execData.review?.evidence?.verificationScopes,
              scopeStatement: execData.review?.evidence?.scopeStatement ?? null,
              outputContract: execData.review?.evidence?.outputContract,
              receiptOutcome: execData.receipt?.payload?.outcome ?? null,
              receiptId: execData.receipt?.receiptId ?? null,
              retrieval: execData.artifact?.retrieval ?? null,
            }
          : undefined;
        // The canonical fabric DECIDED this task and did not complete it. That
        // decision is final: no fallback model call, no judge call, no vault
        // note. Before this, a 200 with success:false silently re-ran the task
        // through /api/generate and wrote the result into memory — a duplicate
        // paid call that bypassed scoped verification and quarantine.
        // CONTINUITY — a 202 means the task is PAUSED (awaiting budget,
        // capacity, a qualified route or approval) or RECONCILING an unknown
        // outcome. Not failed; nothing else is run in its place. The server's
        // continuity sweep resumes it; the Routing & Continuity tab says why.
        if (execRes.status === 202 && verificationOutcome) {
          handleUpdateKanbanTask(taskId, {
            column: 'blocked',
            verificationOutcome,
            outputLog: `[Router]: ${verificationOutcome.taskStatus} — not failed. ${execData.error ?? ''}`,
            updatedAt: `Just now (${verificationOutcome.taskStatus})`,
          });
          synthosControl.logEvent({
            taskId: task.id,
            eventType: execData.status === 'RECONCILING_UNKNOWN_EXECUTION' ? 'RECONCILIATION_REQUIRED' : 'TASK_PAUSED',
            actorRole: 'orchestrator',
            actorModel: task.assignedModel,
            summary: `"${task.title}" is ${execData.status} (not failed): ${execData.error ?? 'see Routing & Continuity'}. No other model was substituted.`,
            payload: { taskId: execData.taskId, status: execData.status, routingDecisionId: execData.routingDecision?.decisionId ?? null },
            isSimulated: false,
          });
          return;
        }
        if (verificationOutcome && !execData.success) {
          handleUpdateKanbanTask(taskId, {
            column: 'blocked',
            verificationOutcome,
            outputLog: `[Aegis]: ${verificationOutcome.taskStatus}${verificationOutcome.scopeStatement ? ` — ${verificationOutcome.scopeStatement}` : ''}${execData.error ? ` — ${execData.error}` : ''}`,
            updatedAt: `Just now (${verificationOutcome.taskStatus})`,
          });
          synthosControl.logEvent({
            taskId: task.id,
            eventType: verificationOutcome.taskStatus === 'INCOMPLETE' ? 'AEGIS_INCOMPLETE' : verificationOutcome.taskStatus === 'VERIFICATION_FAILED' ? 'AEGIS_INSTRUCTION_FAILED' : 'CANONICAL_EXECUTION_FAILED',
            actorRole: 'orchestrator',
            actorModel: task.assignedModel,
            summary: `Canonical execution ended ${verificationOutcome.taskStatus} for "${task.title}". No fallback was run.`,
            payload: { taskId: execData.taskId, status: verificationOutcome.taskStatus, receiptOutcome: verificationOutcome.receiptOutcome },
            isSimulated: false,
          });
          return;
        }
        if (!execRes.ok || !execData || !execData.success || !execData.artifact) {
          // The canonical endpoint did not return a decision (unreachable,
          // non-JSON, or an unexpected shape). NOTHING else is run in its
          // place: no chat fallback, no second model, no judge.
          handleUpdateKanbanTask(taskId, {
            column: 'blocked',
            outputLog: `[Execution]: the canonical execution endpoint returned no decision (HTTP ${execRes.status}). Nothing was run in its place.`,
            updatedAt: 'Just now (Blocked)',
          });
          return;
        }

        // SUCCESS is the canonical fabric's own verdict: scoped Aegis passed in
        // every required scope and a signed receipt exists. That is the success
        // gate. Reaching DONE triggers NO further model call — the legacy
        // "Aegis Judge" second call (and its local score, local receipt and
        // duplicate vault note) is gone. A model-based evaluation is still
        // possible, but only as its own explicitly requested, separately
        // guarded, separately receipted execution (Request evaluation).
        const receiptPayload = execData.receipt?.payload || {};
        const executedModel = {
          providerId: receiptPayload.registryProviderId ?? null,
          modelId: receiptPayload.canonicalModelId ?? null,
          reportedModel: execData.modelUsed ?? null,
        };
        const done = execData.status === 'DONE';
        handleUpdateKanbanTask(taskId, {
          column: done ? 'done' : 'blocked',
          verificationOutcome,
          executedModel,
          outputs: execData.artifact.content,
          toolCalls: execData.artifact.toolsUsed || execData.toolCalls || [],
          outputLog: `[Aegis]: ${execData.status}${verificationOutcome?.scopeStatement ? ` — ${verificationOutcome.scopeStatement}` : ''}`,
          executionLogs: [
            `[Runtime]: ${task.assignedAgent.toUpperCase()} → ${executedModel.providerId ?? 'UNKNOWN'}/${executedModel.modelId ?? 'UNKNOWN'} (provider reported ${executedModel.reportedModel ?? 'UNKNOWN'})`,
            `[Aegis]: ${execData.review?.decision ?? 'UNKNOWN'} — receipt ${execData.receipt?.receiptId ?? 'none'} (${receiptPayload.outcome ?? 'outcome not stated'})`,
          ],
          verificationReceipt: execData.receipt ? {
            id: execData.receipt.receiptId,
            score: typeof execData.review?.score === 'number' ? execData.review.score : 0,
            signature: execData.receipt.signature,
            status: execData.receipt.verified ? 'VERIFIED' : 'SIGNATURE_FAILED',
            verifiedAt: execData.receipt.createdAt,
          } : undefined,
          subtasks: done ? task.subtasks.map(s => ({ ...s, completed: true })) : task.subtasks,
          updatedAt: `Just now (${execData.status})`,
        });
        synthosControl.logEvent({
          taskId: task.id,
          eventType: done ? 'AEGIS_VERIFIED' : 'CANONICAL_EXECUTION_FAILED',
          actorRole: 'orchestrator',
          actorModel: `${executedModel.providerId ?? 'UNKNOWN'}/${executedModel.modelId ?? 'UNKNOWN'}`,
          summary: `Canonical execution of "${task.title}" ended ${execData.status}. Receipt ${execData.receipt?.receiptId ?? 'none'}. No second model call was made.`,
          payload: { taskId: execData.taskId, status: execData.status, receiptId: execData.receipt?.receiptId ?? null, latencyMs: Date.now() - startTime },
          isSimulated: false,
        });

        if (done) {
          setKanbanTasks(prevTasks => prevTasks.map(t => {
            if (t.column === 'todo' && t.dependencies?.includes(taskId)) {
              const allDepsDone = (t.dependencies || []).every(depId => depId === taskId || prevTasks.find(pt => pt.id === depId)?.column === 'done');
              if (allDepsDone) return { ...t, column: 'ready' as KanbanColumnId, updatedAt: 'Just now (Dependencies Met)' };
            }
            return t;
          }));
        }
      } catch (fetchErr: any) {
        // Network failure reaching the canonical endpoint. No fallback.
        handleUpdateKanbanTask(taskId, {
          column: 'blocked',
          outputLog: `[Execution]: could not reach the canonical execution endpoint (${fetchErr?.message || 'network error'}). Nothing was run in its place.`,
          updatedAt: 'Just now (Blocked)',
        });
      }
    } catch (err: any) {
      console.error('Task execution error:', err);
      synthosControl.logEvent({
        taskId: task.id,
        eventType: 'EXECUTION_FAILED',
        actorRole: task.assignedAgent,
        actorModel: task.assignedModel,
        summary: `Execution failed for task "${task.title}": ${err?.message || err}`,
        payload: { error: String(err) },
        isSimulated: false
      });

      handleUpdateKanbanTask(taskId, {
        column: 'blocked',
        outputLog: `[Execution Error]: ${err?.message || err}`,
        updatedAt: 'Just now (Blocked)'
      });
    }
  };

  const handlePushTaskToObsidian = (task: KanbanTask) => {
    const title = `Kanban-Deliverable-${task.title.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 35)}`;
    const content = `# ${task.title}\n\n**Assigned Agent**: ${task.assignedAgent.toUpperCase()}\n**Primary Model**: ${task.assignedModel}\n**Priority**: ${task.priority.toUpperCase()}\n**Status**: ${task.column.toUpperCase()}\n\n## Description\n${task.description}\n\n## Subtasks\n${task.subtasks.map(s => `- [${s.completed ? 'x' : ' '}] ${s.title}`).join('\n')}\n\n## Output Synthesis\n${task.outputLog || 'Completed successfully according to Hermes AGENTS.md mission control protocol.'}\n\n## Wikilinks\n${task.obsidianWikilinks.map(w => `- [[${w}]]`).join('\n')}\n- [[Hermes-Knowledge-Mesh]]\n\n#hermes #kanban #startup-curation #${task.assignedAgent}`;

    handleAddNoteToVault(title, content, ['hermes', 'kanban', task.assignedAgent], 'Startup-Theses');
  };

  // Telegram Messaging Operations
  const handleSendTelegramMessage = async (role: AgentRole, text: string) => {
    const agent = agents[role] || agents['orchestrator'];
    const threadId = agent.telegramThreadId || 101;

    // 1. Add User Message
    const userMsg: TelegramMessage = {
      id: `msg-${Date.now()}-u`,
      agentRole: role,
      senderName: 'Owner (Telegram)',
      senderType: 'user',
      threadId,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setTelegramMessages(prev => ({
      ...prev,
      [role]: [...(prev[role] || []), userMsg]
    }));

    // 2. Query Agent Response
    try {
      const replyText = await handleSendQuery(text, agent.assignedModel || 'hermes', agent.systemPrompt);

      const agentMsg: TelegramMessage = {
        id: `msg-${Date.now()}-a`,
        agentRole: role,
        senderName: agent.name,
        senderType: 'agent',
        threadId,
        text: replyText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelUsed: agent.assignedModel || 'hermes',
        // `tokensUsed: 240` was a fixed number on every message. No usage
        // figure reaches this handler, so none is reported.
      };

      setTelegramMessages(prev => ({
        ...prev,
        [role]: [...(prev[role] || []), agentMsg]
      }));
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleResetTelegramChannel = (role: AgentRole) => {
    const agent = agents[role] || agents['orchestrator'];
    const threadId = agent.telegramThreadId || 101;
    const resetMsg: TelegramMessage = {
      id: `reset-${Date.now()}`,
      agentRole: role,
      senderName: 'Hermes System',
      senderType: 'system',
      threadId,
      text: `[Channel Reset]: Context buffer cleared for ${agent.name}. Multi-agent routing plugin initialized.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setTelegramMessages(prev => ({
      ...prev,
      [role]: [resetMsg]
    }));
  };

  // Cron Job execution
  const handleRunCronJob = async (jobId: string) => {
    const job = cronJobs.find(j => j.id === jobId);
    if (!job) return;

    const agent = agents[job.agentRole];
    try {
      const res = await handleSendQuery(
        `Execute Hermes Scheduled Cron Job: "${job.name}" - ${job.description}`,
        job.model,
        agent?.systemPrompt
      );

      // Create obsidian note
      handleAddNoteToVault(
        `Cron-Output-${job.name.replace(/[^a-zA-Z0-9-]/g, '')}`,
        `# Scheduled Cron Execution: ${job.name}\n\n**Category**: ${job.category.toUpperCase()}\n**Agent**: ${job.agentRole.toUpperCase()}\n**Model**: ${job.model}\n**Timestamp**: ${new Date().toISOString()}\n\n## Synthesis Output\n${res}\n\n#cron #hermes #${job.agentRole}`,
        ['cron', 'scheduled', job.agentRole],
        'Cron-Outputs'
      );

      setCronJobs(prev => prev.map(j => j.id === jobId ? {
        ...j,
        lastRun: 'Just now',
        runCount: j.runCount + 1,
      } : j));
    } catch (err: any) {
      console.error(err);
    }
  };

  // Guide Toggle
  const handleToggleGuideStep = (stepId: string) => {
    setGuideSteps(prev => prev.map(s => s.id === stepId ? { ...s, completed: !s.completed } : s));
  };

  const handleResetGuideProgress = () => {
    setGuideSteps(prev => prev.map(s => ({ ...s, completed: false })));
  };

  // Model Router Operations
  const handleUpdateRouterRule = (id: string, updates: Partial<ModelRouterRule>) => {
    setRouterRules(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const handleAddRouterRule = (rule: Omit<ModelRouterRule, 'id'>) => {
    const newRule: ModelRouterRule = {
      ...rule,
      id: `rule-${Date.now()}`,
    };
    setRouterRules(prev => [...prev, newRule]);
  };

  const handleDeleteRouterRule = (id: string) => {
    setRouterRules(prev => prev.filter(r => r.id !== id));
  };

  // Bot Swarm Actions
  const handleToggleBotTask = (taskId: string) => {
    setBotTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          status: t.status === 'running' ? 'paused' : 'running',
        };
      }
      return t;
    }));
  };

  const handleRunBotTaskNow = (taskId: string) => {
    setBotTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          lastRun: 'Just now',
          actionsCount: t.actionsCount + 1,
        };
      }
      return t;
    }));
  };

  const handleAddBotTask = (task: Omit<BotTask, 'id' | 'lastRun' | 'actionsCount'>) => {
    const newTask: BotTask = {
      ...task,
      id: `task-${Date.now()}`,
      lastRun: 'Never',
      actionsCount: 0,
    };
    setBotTasks(prev => [newTask, ...prev]);
  };

  const handleDeleteBotTask = (taskId: string) => {
    setBotTasks(prev => prev.filter(t => t.id !== taskId));
  };

  // Update Jarvis settings
  const handleUpdateJarvisSettings = (newSettings: Partial<JarvisSettings>) => {
    setJarvisSettings(prev => ({
      ...prev,
      ...newSettings,
    }));
  };

  // Update Agent Capabilities, Prompts, Rules, Models, etc.
  const handleUpdateAgent = (role: AgentRole, updates: Partial<AgentInfo>) => {
    setAgents(prev => {
      const existing = prev[role];
      if (!existing) return prev;
      return {
        ...prev,
        [role]: {
          ...existing,
          ...updates,
          lastActive: 'Just now'
        }
      };
    });
  };

  // Execute Agent Directive Sandbox Run
  const handleExecuteAgentDirective = async (role: string, customPrompt?: string) => {
    const agent = agents[role] || agents['orchestrator'];
    const prompt = customPrompt || `Execute primary operational scan for ${agent.name}: "${agent.description}"`;
    const model = agent.assignedModel || 'claude';
    const systemPrompt = agent.systemPrompt || 'You are an autonomous Hermes AgentOS Specialist.';

    try {
      const reply = await handleSendQuery(prompt, model, systemPrompt);
      setAgents(prev => {
        const ag = prev[role];
        if (!ag) return prev;
        return {
          ...prev,
          [role]: {
            ...ag,
            completedTasksCount: (ag.completedTasksCount || 0) + 1,
            lastActive: 'Just now'
          }
        };
      });
    } catch (err) {
      console.error('Directive execution error:', err);
    }
  };

  // Hermes OS Intake & Triage Handlers
  const handleOptimizeToTask = (intakeId: string) => {
    const item = intakeItems.find(i => i.id === intakeId);
    if (!item) return;

    const newTaskId = `task-${Date.now()}`;
    const draft = item.optimizedTaskDraft;
    const newTask: KanbanTask = {
      id: newTaskId,
      task_id: `HERMES-${Math.floor(100 + Math.random() * 900)}`,
      title: draft?.title || item.deliverableSpec?.objective || 'Intake Directive Task',
      description: draft?.description || item.rawInput,
      assignedAgent: draft?.assignedAgent || item.recommendedAgent || 'scout',
      assignedModel: draft?.assignedModel || item.recommendedModel || 'claude',
      model_tier: item.recommendedModelTier || 'FRONTIER_REASONING',
      priority: draft?.priority || 'high',
      origin: item.origin,
      column: 'triage',
      tags: draft?.tags || ['intake-triaged', item.origin.toLowerCase()],
      obsidianWikilinks: draft?.obsidianWikilinks || ['Startup-Theses/General-Intake'],
      category: draft?.category || 'research',
      subtasks: draft?.subtasks || [
        { id: `sub-1`, title: 'Execute primary cognitive workload', completed: false },
        { id: `sub-2`, title: 'Synthesize deliverables into Obsidian vault', completed: false }
      ],
      createdAt: 'Just now',
      updatedAt: 'Just now',
      estimatedHours: draft?.estimatedHours || '1.5h'
    };

    setKanbanTasks(prev => [newTask, ...prev]);
    setIntakeItems(prev => prev.map(i => i.id === intakeId ? { ...i, status: 'dispatched' } : i));
    handlePlayVoiceFeedback(`Intake directive triaged and dispatched to ${newTask.assignedAgent} agent queue.`);
  };

  const handleAddIntakeItem = (item: Omit<IntakeItem, 'id' | 'timestamp'>) => {
    const newItem: IntakeItem = {
      ...item,
      id: `intake-${Date.now()}`,
      timestamp: 'Just now'
    };
    setIntakeItems(prev => [newItem, ...prev]);
  };

  const handleUpdateIntakeItem = (id: string, updates: Partial<IntakeItem>) => {
    setIntakeItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
  };

  const handleDeleteIntakeItem = (id: string) => {
    setIntakeItems(prev => prev.filter(i => i.id !== id));
  };

  // Idea Strategy Hub Handlers
  const handleConvertIdeaToTask = (idea: IdeaItem) => {
    const newTaskId = `task-${Date.now()}`;
    const newTask: KanbanTask = {
      id: newTaskId,
      task_id: `HERMES-IDEA-${Math.floor(100 + Math.random() * 900)}`,
      title: `[Strategy] ${idea.title}`,
      description: `${idea.summary}\n\n**Potential Impact:** ${idea.potentialImpact}\n**Effort Estimate:** ${idea.effortEstimate}\n**Domain:** ${idea.domain}`,
      assignedAgent: idea.authorAgent || 'reach',
      assignedModel: 'chatgpt',
      model_tier: 'FRONTIER_REASONING',
      priority: 'high',
      column: 'todo',
      tags: ['idea-strategy', ...idea.tags],
      obsidianWikilinks: idea.wikilinks.length > 0 ? idea.wikilinks : [`Startup-Theses/${idea.title.replace(/\s+/g, '-')}`],
      category: 'startup-curation',
      subtasks: [
        { id: `sub-1`, title: 'Draft comprehensive Obsidian PRD & investment thesis', completed: false },
        { id: `sub-2`, title: 'Dev agent prototype POC architecture', completed: false },
        { id: `sub-3`, title: 'Reach agent growth loop model validation', completed: false }
      ],
      createdAt: 'Just now',
      updatedAt: 'Just now',
      estimatedHours: '2.5h'
    };

    setKanbanTasks(prev => [newTask, ...prev]);
    setIdeaItems(prev => prev.map(i => i.id === idea.id ? { ...i, status: 'converted_to_task', updatedAt: 'Just now' } : i));
    handlePlayVoiceFeedback(`Idea "${idea.title}" converted to active task for ${newTask.assignedAgent} agent.`);
  };

  const handleAddIdea = (idea: Omit<IdeaItem, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newIdea: IdeaItem = {
      ...idea,
      id: `idea-${Date.now()}`,
      createdAt: 'Just now',
      updatedAt: 'Just now'
    };
    setIdeaItems(prev => [newIdea, ...prev]);
  };

  const handleUpdateIdea = (id: string, updates: Partial<IdeaItem>) => {
    setIdeaItems(prev => prev.map(i => i.id === id ? { ...i, ...updates, updatedAt: 'Just now' } : i));
  };

  const handleDeleteIdea = (id: string) => {
    setIdeaItems(prev => prev.filter(i => i.id !== id));
  };

  // Skill Registry: SkillRegistryView is now fully self-contained against
  // the real /api/skills backend (see lib/skills.ts) — no App.tsx-level
  // state or handlers needed here any more.

  // System Audit & Diagnostics Handlers
  // "Run Audit" used to wait 600ms and then mark every check `passed`, with a
  // latency invented as Math.floor(18 + Math.random() * 32) and a trace log
  // reading "Status: 200 OK | SLA Target: Met | Jitter Buffer: Nominal (0
  // packet drop)". No component was contacted. The one screen whose entire
  // job is to report system health reported perfect health unconditionally.
  //
  // There is no diagnostic runner in this build, so this reports that
  // instead of inventing a result. Checks stay UNKNOWN until something real
  // measures them.
  const handleRunAudit = async (): Promise<void> => {
    setSystemAuditChecks(prev => prev.map(c => ({
      ...c,
      status: 'unknown',
      latencyMs: 0,
      lastTested: 'NEVER',
      traceLog: 'No diagnostic runner is implemented for this component. Nothing was executed, so no result is reported.',
    })));
  };

  const handleTriggerFleetStandup = async (): Promise<void> => {
    const activeTasks = kanbanTasks.filter(t => t.column === 'running' || t.column === 'ready');
    const standupPrompt = `Generate the Daily Chief of Staff Fleet Standup Briefing across 6 specialist agents:
- Active Tasks: ${activeTasks.map(t => `${t.title} (${t.assignedAgent})`).join(', ')}
- Total Tasks in Board: ${kanbanTasks.length}
- Notes Synced: ${notes.length}
Highlight blockades, priority targets, and today's GTM sprints.`;

    const standupSummary = await handleSendQuery(standupPrompt, 'hermes', 'You are the Hermes Orchestrator and Chief of Staff.');
    handleAddNoteToVault(`Daily-Fleet-Standup-${new Date().toISOString().split('T')[0]}`, standupSummary, ['standup', 'chief-of-staff', 'fleet-sync'], 'Master-Standups');
    handlePlayVoiceFeedback(`Fleet standup compiled and vectorized to Obsidian vault.`);
  };

  const isModelTab = (tab: ActiveTab): boolean => {
    return [
      'hermes', 'claude', 'claudecode', 'kimi3', 'kimi', 
      'deepseek', 'chatgpt', 'codex', 'cursor', 'antigravity', 
      'perplexity', 'elevenlabs', 'el', 'gemini', 'openclaw'
    ].includes(tab);
  };

  const isAgentTab = (tab: ActiveTab): boolean => {
    return tab.startsWith('agent-') && tab !== 'agent-fleet' && tab !== 'agent-memory';
  };

  const getAgentRoleFromTab = (tab: ActiveTab): AgentRole => {
    if (tab.startsWith('agent-')) {
      return tab.replace('agent-', '') as AgentRole;
    }
    return 'orchestrator';
  };

  const getWorkspaceFromTab = (tab: ActiveTab): WorkspaceType | null => {
    if (tab.startsWith('hermes') || tab === 'hermes') return 'hermes';
    if (tab === 'agent-claude' || tab === 'claude' || tab === 'claudecode') return 'claude';
    if (tab === 'agent-gemini' || tab === 'gemini') return 'gemini';
    if (tab === 'agent-codex' || tab === 'codex') return 'codex';
    if (tab === 'agent-cursor' || tab === 'cursor') return 'cursor';
    if (tab === 'agent-antigravity' || tab === 'antigravity') return 'antigravity';
    if (tab === 'agent-openclaw' || tab === 'openclaw') return 'openclaw';
    if (tab === 'agent-orchestrator') return 'orchestrator';
    return null;
  };

  const activeWorkspaceType = getWorkspaceFromTab(activeTab);

  return (
    <div className="min-h-screen bg-[#08090b] text-[#f7f8f8] flex flex-col selection:bg-[#7170ff]/50 selection:text-white font-sans">
      {/* Airbyte / Hermes Mission Control Header */}
      <AirbyteHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeWorkspaceName={authorizedWorkspaces.find((w) => w.workspace_id === activeWorkspaceId)?.workspace_name}
        obsidianSyncStatus="ONLINE (4 VAULTS)"
        botModeActive={botTasks.some(t => t.status === 'running')}
        onOpenQuickPrompt={() => setIsCommandPaletteOpen(true)}
        isSidebarVisible={isSidebarVisible}
        onToggleSidebar={() => setIsSidebarVisible(!isSidebarVisible)}
        onOpenTour={() => setIsTourOpen(true)}
        onToggleVoice={() => {
          setIsGlobalVoiceOpen(true);
        }}
        activeAgentsCount={Object.keys(agents).length}
        activeWorkspaceId={activeWorkspaceId}
      />

      {/* Main Expansive Body with Far-Left Sidebar & Dot Matrix Grid */}
      <div className="flex-1 flex w-full bg-grid-dots min-h-0 relative">
        <SidebarNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          models={models}
          agents={agents}
          notesCount={notes.length}
          botTaskCount={botTasks.length}
          kanbanTaskCount={kanbanTasks.length}
          isVisible={isSidebarVisible}
          onToggleVisible={() => setIsSidebarVisible(!isSidebarVisible)}
          onOpenHelp={() => setIsHelpDrawerOpen(true)}
          activeWorkspaceId={activeWorkspaceId}
          onSwitchWorkspace={setActiveWorkspaceId}
          authorizedWorkspaces={authorizedWorkspaces.map((w) => ({ workspace_id: w.workspace_id, workspace_name: w.workspace_name }))}
        />

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Workspace Contextual Top Navigation (rendered when any of the 8 workspaces is active) */}
          {activeWorkspaceType && (
            <WorkspaceTopNav 
              activeTab={activeTab} 
              setActiveTab={setActiveTab} 
              activeWorkspace={activeWorkspaceType}
            />
          )}

          <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto overflow-x-hidden bg-radial-vignette">
          {/* Pass VIII / Workstream W — one Suspense boundary around the
              whole tab-content area. Only ever one {activeTab === 'x' &&
              <X/>} block renders at a time, so this is a standard, safe
              route-level code-split: a lazy view (KanbanView,
              GraphBuilderView, MasterAdminView, SettingsView,
              StartupIdeaGeneratorView — see their lazy() imports above)
              shows this fallback for the brief moment its chunk downloads;
              every already-eager view underneath is completely unaffected
              (Suspense only ever engages when something below it actually
              suspends). */}
          <Suspense fallback={<div className="flex items-center justify-center h-full w-full text-[#9C97B4] text-sm font-mono">Loading…</div>}>
          {/* Intake & Triage Engine (Voice, Directives, Webhooks) */}
          {activeTab === 'intake-triage' && (
            <IntakeTriageView
              intakeItems={intakeItems}
              agents={agents}
              models={models}
              onAddIntakeItem={handleAddIntakeItem}
              onUpdateIntakeItem={handleUpdateIntakeItem}
              onDeleteIntakeItem={handleDeleteIntakeItem}
              onOptimizeToTask={handleOptimizeToTask}
              onExecutePrompt={handleSendQuery}
            />
          )}

          {/* Master Operations & Chief of Staff Command Center */}
          {activeTab === 'master-ops' && (
            <MasterOperationsView
              agents={agents}
              models={models}
              tasks={kanbanTasks}
              messages={Object.values(telegramMessages).flat()}
              auditChecks={systemAuditChecks}
              onNavigate={setActiveTab}
              onExecutePrompt={handleSendQuery}
              onTriggerFleetStandup={handleTriggerFleetStandup}
              onRunAudit={handleRunAudit}
              onPlayVoiceFeedback={handlePlayVoiceFeedback}
            />
          )}

          {/* Idea Strategy Hub & Backlog */}
          {activeTab === 'idea-strategy' && (
            <IdeaStrategyHubView
              ideas={ideaItems}
              onAddIdea={handleAddIdea}
              onUpdateIdea={handleUpdateIdea}
              onDeleteIdea={handleDeleteIdea}
              onConvertToTask={handleConvertIdeaToTask}
            />
          )}

          {/* Skill Registry & Model Context Protocol (MCP) Manager */}
          {activeTab === 'skill-registry' && (
            <SkillRegistryView activeWorkspaceId={activeWorkspaceId} />
          )}

          {/* TOOL PACK 1 — production tools exposed through the Execution Fabric */}
          {activeTab === 'tool-registry' && (
            <ToolRegistryView activeWorkspaceId={activeWorkspaceId} />
          )}

          {/* APPROVAL FOUNDATION — the human decision queue for external actions */}
          {activeTab === 'approval-queue' && (
            <ApprovalQueueView activeWorkspaceId={activeWorkspaceId} />
          )}

          {/* System Audit & Diagnostics Telemetry */}
          {(activeTab === 'system-diagnostics' || activeTab === 'system-audit') && (
            <SystemAuditView
              auditChecks={systemAuditChecks}
              onRunAudit={handleRunAudit}
              onPlayVoiceFeedback={handlePlayVoiceFeedback}
            />
          )}

          {/* TON Network Workspace */}
          {activeTab === 'ton' && (
            <TONNetworkView activeWorkspaceId={activeWorkspaceId} />
          )}

          {/* Twins Concierge Workspace */}
          {activeTab === 'twins' && (
            <TwinsConciergeView
              onSendQuery={handleSendQuery}
              onAddNoteToVault={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder || 'Content-Drafts')}
              onOpenVoiceService={() => setIsGlobalVoiceOpen(true)}
              onOpenApollo={() => setActiveTab('hermes-apollo')}
            />
          )}

          {/* Frontend Demos Launcher */}
          {activeTab === 'demos' && (
            <FrontendDemosView onSelectTab={setActiveTab} />
          )}

          {/* Mission Control Overview & 3D Isometric Office */}
          {activeTab === 'overview' && (
            <OverviewOfficeView
              agents={agents}
              tasks={kanbanTasks}
              notes={notes}
              models={models}
              activeWorkspaceId={activeWorkspaceId}
              onSelectTab={setActiveTab}
              onOpenAgentDrawer={(role) => setDrawerAgentRole(role as AgentRole)}
              onOpenGraphBuilder={() => setActiveTab('graph-builder')}
              onOpenHermesChat={() => setActiveTab('hermes-chat')}
            />
          )}

          {/* Startup Idea Generator (Deep Research Scrape, Scout & Analytics, Obsidian) */}
          {activeTab === 'startup-generator' && (
            <StartupIdeaGeneratorView
              agents={agents}
              models={models}
              onAddNoteToVault={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder || 'Startup-Theses')}
              onAddTaskToKanban={handleAddKanbanTask}
              onSendTelegramMessage={handleSendTelegramMessage}
              onSendQuery={handleSendQuery}
              onSelectTab={setActiveTab}
            />
          )}

          {/* Hermes Oracle (Signals, Telemetry, Memory Matrix) */}
          {activeTab === 'hermes-oracle' && (
            <HermesOracleView
              agents={agents}
              models={models}
              notes={notes}
              tasks={kanbanTasks}
              onSelectTab={setActiveTab}
              onSendQuery={handleSendQuery}
              onAddNoteToVault={(title, content, tags) => handleAddNoteToVault(title, content, tags, 'Oracle-Signals')}
            />
          )}

          {/* Auto-Content & News Harvester */}
          {activeTab === 'auto-content' && (
            <AutoContentNewsView
              agents={agents}
              models={models}
              onAddNoteToVault={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder || 'Auto-Content')}
              onSendTelegramMessage={handleSendTelegramMessage}
              onSendQuery={handleSendQuery}
              onSelectTab={setActiveTab}
            />
          )}

          {/* Studio & Lead Gen Engine */}
          {activeTab === 'studio-leadgen' && (
            <StudioLeadGenView
              agents={agents}
              models={models}
              onAddNoteToVault={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder || 'Lead-Gen-SOW')}
              onAddTaskToKanban={handleAddKanbanTask}
              onSendTelegramMessage={handleSendTelegramMessage}
              onSendQuery={handleSendQuery}
              onSelectTab={setActiveTab}
            />
          )}

          {/* Stacking AI Models Pipeline */}
          {activeTab === 'model-stacking' && (
            <ModelStackingView
              agents={agents}
              models={models}
              onAddNoteToVault={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder || 'Pipeline-Runs')}
              onSendQuery={handleSendQuery}
              onSelectTab={setActiveTab}
            />
          )}

          {/* Long-Term Agent Memory Subsystem */}
          {activeTab === 'agent-memory' && (
            <AgentMemoryView
              agents={agents}
              models={models}
              notes={notes}
              onAddNoteToVault={(title, content, tags) => handleAddNoteToVault(title, content, tags, 'Agent-Memories')}
              onSendQuery={handleSendQuery}
              onSelectTab={setActiveTab}
              activeWorkspaceId={activeWorkspaceId}
            />
          )}

          {/* Kanban Board (board.db) & Startup Curation Pipeline */}
          {activeTab === 'kanban' && (
            <KanbanView
              tasks={kanbanTasks}
              agents={agents}
              models={models}
              onAddTask={handleAddKanbanTask}
              onUpdateTask={handleUpdateKanbanTask}
              onDeleteTask={handleDeleteKanbanTask}
              onExecuteTask={handleExecuteKanbanTask}
              onPushTaskToObsidian={handlePushTaskToObsidian}
              onSelectAgent={(agentRole) => setDrawerAgentRole(agentRole)}
              onOpenJulianAudit={() => setIsJulianAuditOpen(true)}
              activeWorkspaceId={activeWorkspaceId}
            />
          )}

          {/* Graph Engine & Interactive Workflow Graph Builder */}
          {activeTab === 'graph-builder' && (
            <GraphBuilderView
              agents={agents}
              models={models}
              onSelectTab={setActiveTab}
              onExecutePrompt={handleSendQuery}
              onAddNoteToVault={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder || 'Pipeline-Runs')}
              activeWorkspaceId={activeWorkspaceId}
            />
          )}

          {/* Graph Execution Runs & History */}
          {activeTab === 'graph-runs' && (
            <GraphRunsView
              onSelectTab={setActiveTab}
              activeWorkspaceId={activeWorkspaceId}
            />
          )}

          {/* SynthOS Activity & Governance Ledger */}
          {activeTab === 'activity-ledger' && (
            <ActivityLedgerView
              events={synthosControl.getLedger()}
            />
          )}

          {/* Canonical, Ed25519-signed execution receipts. This nav slot used to
              render ReceiptsView — the legacy Kanban board's LOCAL/DEMO
              receipts (a client-side rolling hash, no key material) — while the
              real signed receipts had no UI at all. */}
          {activeTab === 'receipts' && (
            <CanonicalReceiptsView activeWorkspaceId={activeWorkspaceId} />
          )}

          {/* Canonical scheduler management over /api/schedules*. No second
              scheduling engine — every control calls the server's own route. */}
          {activeTab === 'scheduler' && (
            <SchedulerView activeWorkspaceId={activeWorkspaceId} />
          )}

          {/* External execution history over the existing Windmill control
              plane (ADR-006). No second execution mechanism. */}
          {activeTab === 'external-executions' && (
            <ExternalExecutionsView activeWorkspaceId={activeWorkspaceId} />
          )}

          {/* Development — the production surface over the existing
              development-loop backend (/api/development/*). It owns no state
              machine and no execution mechanism: the task queue, review,
              approval, Antigravity execution and evidence are all real server
              rows, and the scheduler advances execution without a poll button. */}
          {activeTab === 'development' && (
            <DevelopmentView activeWorkspaceId={activeWorkspaceId} />
          )}

          {/* Real crawl-based SEO/AEO/GEO audit. No demo mode — see
              lib/aeo/crawler.ts. GEO degrades to UNKNOWN when no AI/search
              provider is configured rather than asserting AI visibility. */}
          {activeTab === 'aeo-audit' && (
            <AeoAuditView activeWorkspaceId={activeWorkspaceId} />
          )}

          {/* Business Conversation AI — the OWNER's surface. The customer-facing
              assistant is a separate public page at /a/<key>, deliberately not
              a panel inside Admin. */}
          {activeTab === 'business-assistant' && (
            <BusinessAssistantView activeWorkspaceId={activeWorkspaceId} />
          )}

          {/* Legacy Kanban demo receipts, kept for developer reference only.
              Deliberately absent from product navigation: it is not the
              canonical receipt pipeline and must never be presented as one. */}
          {activeTab === 'dev-kanban-receipts' && (
            <ReceiptsView
              receipts={synthosControl.getReceipts()}
            />
          )}

          {/* Guardian & Aegis Policy Governance */}
          {activeTab === 'guardian-aegis' && (
            <GuardianAegisControlView />
          )}

          {/* Multi-Tenant Workspaces & Fleet Boundaries */}
          {activeTab === 'workspaces' && (
            <WorkspacesView activeWorkspaceId={activeWorkspaceId} onSwitchWorkspace={setActiveWorkspaceId} />
          )}

          {/* Telegram Router Mesh */}
          {activeTab === 'telegram-chat' && (
            <TelegramChatView
              agents={agents}
              messages={telegramMessages}
              onSendMessage={handleSendTelegramMessage}
              onResetChannel={handleResetTelegramChannel}
            />
          )}

          {/* Content Library & Startup Theses */}
          {activeTab === 'content-library' && (
            <ContentLibraryView
              notes={notes}
              vaults={vaults}
              onAddNote={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder)}
              onUpdateNote={handleUpdateNote}
              onDeleteNote={handleDeleteNote}
              onSelectTab={setActiveTab}
            />
          )}

          {/* Hermes Cron Scheduler */}
          {activeTab === 'schedule-cron' && (
            <ScheduleCronView
              cronJobs={cronJobs}
              onRunCronJob={handleRunCronJob}
              onSelectTab={setActiveTab}
            />
          )}

          {/* Unified iMessage & WhatsApp Bridge Connector View */}
          {activeTab === 'message-bridge' && (
            <MessageBridgeView
              models={models}
              onSendQuery={handleSendQuery}
              onLogEvent={(level, source, message) => {
                console.log(`[${level.toUpperCase()}] ${source}: ${message}`);
              }}
            />
          )}

          {/* Claude-Style Artifacts, Side Panels & Agent Modals View */}
          {activeTab === 'claude-artifacts' && (
            <ClaudeArtifactsView
              models={models}
              onSendQuery={handleSendQuery}
              activeWorkspaceId={activeWorkspaceId}
            />
          )}

          {/* Web Scraping & Local Lead Enrichment View */}
          {activeTab === 'lead-scraper' && (
            <LeadScraperView
              models={models}
              onAddNoteToVault={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder || 'Directory-Leads')}
              onAddTaskToKanban={(title, desc, agent, model) => handleAddKanbanTask({
                title,
                description: desc,
                assignedAgent: agent,
                assignedModel: model,
                priority: 'high',
                column: 'todo',
                tags: ['lead-gen', 'outreach', 'directory'],
                subtasks: [
                  { id: `st-1`, title: 'Verify business credentials & phone', completed: false },
                  { id: `st-2`, title: 'Dispatch Reach agent WhatsApp introductory message', completed: false }
                ],
                obsidianWikilinks: ['Directory-Leads', 'Outreach-Templates']
              })}
              onLogEvent={(level, source, message) => {
                console.log(`[${level.toUpperCase()}] ${source}: ${message}`);
              }}
            />
          )}

          {/* Hermes Ecosystem Repositories & Infrastructure Atlas View */}
          {activeTab === 'ecosystem-repos' && (
            <EcosystemReposView
              models={models}
            />
          )}

          {/* Hermes Chat & Operational TUI View */}
          {activeTab === 'hermes-chat' && (
            <HermesChatView
              agents={agents}
              models={models}
              tasks={kanbanTasks}
              notes={notes}
              onSelectTab={setActiveTab}
              onAddNoteToVault={(title, content, tags) => handleAddNoteToVault(title, content, tags, 'Startup-Theses')}
              onAddTaskToKanban={handleAddKanbanTask}
              onOpenAgentDrawer={(role) => setDrawerAgentRole(role as AgentRole)}
            />
          )}

          {/* Hermes Real Shell Terminal View */}
          {(activeTab === 'hermes-terminal' || activeTab === 'hermes-sessions') && (
            <HermesTerminalView
              agents={agents}
              models={models}
              tasks={kanbanTasks}
              notes={notes}
              onSelectTab={setActiveTab}
              onAddTaskToKanban={handleAddKanbanTask}
              onAddNoteToVault={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder || 'Artifacts')}
              onLogActivity={(event, details) => {
                console.log(`[TERMINAL EVENT] ${event}`, details);
              }}
            />
          )}

          {/* Hermes Bot Mode */}
          {activeTab === 'hermes-bot-mode' && (
            <BotModeView
              tasks={botTasks}
              models={models}
              onToggleTaskStatus={handleToggleBotTask}
              onRunTaskNow={handleRunBotTaskNow}
              onAddTask={handleAddBotTask}
              onDeleteTask={handleDeleteBotTask}
            />
          )}

          {/* Hermes Kanban Board */}
          {activeTab === 'hermes-kanban' && (
            <KanbanView
              tasks={kanbanTasks}
              agents={agents}
              models={models}
              onAddTask={handleAddKanbanTask}
              onUpdateTask={handleUpdateKanbanTask}
              onDeleteTask={handleDeleteKanbanTask}
              onExecuteTask={handleExecuteKanbanTask}
              onPushTaskToObsidian={handlePushTaskToObsidian}
              onSelectAgent={(agentRole) => setDrawerAgentRole(agentRole)}
              onOpenJulianAudit={() => setIsJulianAuditOpen(true)}
              activeWorkspaceId={activeWorkspaceId}
            />
          )}

          {/* Hermes Sub-Route Aliases */}
          {activeTab === 'hermes-agents' && (
            <AgentFleetView
              agents={agents}
              tasks={kanbanTasks}
              models={models}
              onSelectTab={setActiveTab}
              onOpenDrawer={(role) => setDrawerAgentRole(role as AgentRole)}
              onExecuteAgentDirective={handleExecuteAgentDirective}
              onAddTask={handleAddKanbanTask}
              onUpdateAgent={handleUpdateAgent}
              onAddNoteToVault={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder || 'Startup-Theses')}
            />
          )}

          {(activeTab === 'hermes-skills' || activeTab === 'hermes-mcps' || activeTab === 'hermes-tools') && (
            <SkillRegistryView activeWorkspaceId={activeWorkspaceId} />
          )}

          {activeTab === 'hermes-cron' && (
            <ScheduleCronView
              cronJobs={cronJobs}
              onRunCronJob={handleRunCronJob}
              onSelectTab={setActiveTab}
            />
          )}

          {activeTab === 'hermes-channels' && (
            <TelegramChatView
              agents={agents}
              messages={telegramMessages}
              onSendMessage={handleSendTelegramMessage}
              onResetChannel={handleResetTelegramChannel}
            />
          )}

          {activeTab === 'hermes-memory' && (
            <AgentMemoryView
              agents={agents}
              models={models}
              notes={notes}
              onAddNoteToVault={(title, content, tags) => handleAddNoteToVault(title, content, tags, 'Agent-Memories')}
              onSendQuery={handleSendQuery}
              onSelectTab={setActiveTab}
              activeWorkspaceId={activeWorkspaceId}
            />
          )}

          {activeTab === 'hermes-files' && (
            <ClaudeArtifactsView
              models={models}
              onSendQuery={handleSendQuery}
              activeWorkspaceId={activeWorkspaceId}
            />
          )}

          {activeTab === 'hermes-usage' && (
            <HermesOracleView
              agents={agents}
              models={models}
              notes={notes}
              tasks={kanbanTasks}
              onSelectTab={setActiveTab}
              onSendQuery={handleSendQuery}
              onAddNoteToVault={(title, content, tags) => handleAddNoteToVault(title, content, tags, 'Oracle-Signals')}
            />
          )}

          {activeTab === 'hermes-approvals' && (
            <GuardianAegisControlView />
          )}

          {activeTab === 'hermes-activity' && (
            <ActivityLedgerView
              events={synthosControl.getLedger()}
            />
          )}

          {activeTab === 'hermes-gateway' && (
            <SystemAuditView
              auditChecks={systemAuditChecks}
              onRunAudit={handleRunAudit}
              onPlayVoiceFeedback={handlePlayVoiceFeedback}
            />
          )}

          {activeTab === 'hermes-analytics' && (
            <HermesOracleView
              agents={agents}
              models={models}
              notes={notes}
              tasks={kanbanTasks}
              onSelectTab={setActiveTab}
              onSendQuery={handleSendQuery}
              onAddNoteToVault={(title, content, tags) => handleAddNoteToVault(title, content, tags, 'Oracle-Signals')}
            />
          )}

          {activeTab === 'hermes-logs' && (
            <ActivityLedgerView
              events={synthosControl.getLedger()}
            />
          )}

          {activeTab === 'hermes-updates' && (
            <UpstreamCapabilityRegistry
              onSendQuery={handleSendQuery}
              onAddNoteToVault={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder || 'System-Audits')}
            />
          )}

          {/* Hermes Master Core OS / Overview */}
          {(activeTab === 'hermes-core' || activeTab === 'hermes' || activeTab === 'hermes-overview') && (
            <HermesCoreView
              models={models}
              vaults={vaults}
              notes={notes}
              agents={agents}
              kanbanTasks={kanbanTasks}
              onSelectTab={setActiveTab}
              onSendQuery={handleSendQuery}
              onAddNoteToVault={(title, content, tags) => handleAddNoteToVault(title, content, tags, 'Startup-Theses')}
            />
          )}

          {/* Apollo Realtime Voice Command View */}
          {activeTab === 'hermes-apollo' && (
            <ApolloVoiceView
              agents={agents}
              kanbanTasks={kanbanTasks}
              onAddKanbanTask={handleAddKanbanTask}
              onExecuteTask={handleExecuteKanbanTask}
              onAddNoteToVault={(title, content, tags) => handleAddNoteToVault(title, content, tags, 'Startup-Theses')}
              voiceConfig={voiceConfig}
              onUpdateVoiceConfig={handleUpdateVoiceConfig}
            />
          )}

          {/* Hermes Swarm Management Panel */}
          {activeTab === 'hermes-manage' && (
            <HermesManageView
              voiceConfig={voiceConfig}
              onUpdateVoiceConfig={handleUpdateVoiceConfig}
              systemKeys={{}}
              onUpdateSystemKeys={() => {}}
            />
          )}

          {/* Agent Fleet Overview & Interactive Sandbox Dashboard */}
          {activeTab === 'agent-fleet' && (
            <AgentFleetView
              agents={agents}
              tasks={kanbanTasks}
              models={models}
              onSelectTab={setActiveTab}
              onOpenDrawer={(role) => setDrawerAgentRole(role as AgentRole)}
              onExecuteAgentDirective={handleExecuteAgentDirective}
              onAddTask={handleAddKanbanTask}
              onUpdateAgent={handleUpdateAgent}
              onAddNoteToVault={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder || 'Startup-Theses')}
            />
          )}

          {/* 32-Step Mission Control Guide Walkthrough */}
          {activeTab === 'guide-walkthrough' && (
            <GuideWalkthroughView
              steps={guideSteps}
              onToggleStep={handleToggleGuideStep}
              onResetProgress={handleResetGuideProgress}
              onSelectTab={setActiveTab}
            />
          )}

          {/* Model Router & OpenRouter Hub View */}
          {activeTab === 'model-router' && (
            <ModelRouterView
              workspaceId={activeWorkspaceId}
              models={models}
              rules={routerRules}
              onUpdateRule={handleUpdateRouterRule}
              onAddRule={handleAddRouterRule}
              onDeleteRule={handleDeleteRouterRule}
              onSendQuery={handleSendQuery}
              onSelectTab={setActiveTab}
            />
          )}

          {/* Upstream Agent Capability Registry Watcher */}
          {activeTab === 'upstream-registry' && (
            <UpstreamCapabilityRegistry
              onSendQuery={handleSendQuery}
              onAddNoteToVault={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder || 'System-Audits')}
            />
          )}

          {/* Individual Specialized Agent Views */}
          {isAgentTab(activeTab) && (
            agents[getAgentRoleFromTab(activeTab)] ? (
              <AgentView
                agent={agents[getAgentRoleFromTab(activeTab)]}
                tasks={kanbanTasks}
                models={models}
                onSendQuery={handleSendQuery}
                onAddTask={handleAddKanbanTask}
                onUpdateTask={handleUpdateKanbanTask}
                onPushNoteToObsidian={(title, content, tags) => handleAddNoteToVault(title, content, tags, 'Agent-Syntheses')}
                onUpdateAgent={handleUpdateAgent}
              />
            ) : (
              <div className="p-8 text-sm text-[#8E94B8]">
                <p className="text-[#F3F4F9] font-semibold mb-1">Agent not configured</p>
                <p>No roster entry exists for "{getAgentRoleFromTab(activeTab)}". This workspace has a navigation entry but no matching AGENT_DEFINITIONS record, so there is nothing real to show yet.</p>
              </div>
            )
          )}

          {/* Obsidian Knowledge Mesh & Vaults */}
          {activeTab === 'obsidian' && (
            <ObsidianView
              vaults={vaults}
              notes={notes}
              models={models}
              onAddNote={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder)}
              onUpdateNote={handleUpdateNote}
              onDeleteNote={handleDeleteNote}
              onSendToModel={(content, modelId) => {
                setActiveTab(modelId as ActiveTab);
              }}
              activeWorkspaceId={activeWorkspaceId}
            />
          )}

          {/* Bot Mode Swarm & Autonomous Engine */}
          {activeTab === 'bot-mode' && (
            <BotModeView
              tasks={botTasks}
              models={models}
              onToggleTaskStatus={handleToggleBotTask}
              onRunTaskNow={handleRunBotTaskNow}
              onAddTask={handleAddBotTask}
              onDeleteTask={handleDeleteBotTask}
            />
          )}

          {/* Jarvis Executive Assistant & Settings */}
          {activeTab === 'jarvis' && (
            <JarvisView
              settings={jarvisSettings}
              onUpdateSettings={handleUpdateJarvisSettings}
              onAddNoteToVault={(title, content, tags) => handleAddNoteToVault(title, content, tags, 'Jarvis-Directives')}
              onSendQuery={handleSendQuery}
              onJarvisCommand={handleJarvisCommand}
              activeWorkspaceId={activeWorkspaceId}
              onNewJarvisSession={handleNewJarvisSession}
            />
          )}

          {/* Individual Model Dashboards */}
          {isModelTab(activeTab) && (
            <ModelDashboardView
              model={seatInfo(activeTab, modelRegistry)}
              workspaceId={activeWorkspaceId}
              onSendQuery={handleSendQuery}
              onAddNoteToVault={(title, content, tags) => handleAddNoteToVault(title, content, tags, 'Model-Syntheses')}
            />
          )}

          {/* Master Admin Control Plane (All 15 Sub-Routes & Setup Walkthrough) */}
          {(activeTab.startsWith('master-admin') || activeTab === 'master-admin') && (
            <MasterAdminView
              initialSubTab={activeTab}
              agents={agents}
              models={models}
              tasks={kanbanTasks}
              notes={notes}
              activeWorkspaceId={activeWorkspaceId}
              auditChecks={systemAuditChecks}
              voiceConfig={voiceConfig}
              onUpdateVoiceConfig={handleUpdateVoiceConfig}
              onSelectTab={setActiveTab}
              onRunAudit={handleRunAudit}
              onExecutePrompt={handleSendQuery}
            />
          )}

          {/* Users & Roles View */}
          {activeTab === 'users-roles' && (
            <WorkspacesView activeWorkspaceId={activeWorkspaceId} onSwitchWorkspace={setActiveWorkspaceId} />
          )}

          {/* System Settings & Connectors */}
          {activeTab === 'settings' && (
            <SettingsView
              settings={jarvisSettings}
              onUpdateSettings={handleUpdateJarvisSettings}
              activeWorkspaceId={activeWorkspaceId}
            />
          )}
          </Suspense>
          </main>
        </div>
      </div>

      {/* Slide-over Agent Profile Drawer */}
      {drawerAgentRole && (
        <AgentDrawer
          agent={agents[drawerAgentRole]}
          isOpen={Boolean(drawerAgentRole)}
          onClose={() => setDrawerAgentRole(null)}
          onSelectTab={(tab) => {
            setDrawerAgentRole(null);
            setActiveTab(tab);
          }}
          models={models}
          onSendQuery={handleSendQuery}
          onAddTask={handleAddKanbanTask}
          onAddNoteToVault={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder || 'Startup-Theses')}
          onUpdateAgent={handleUpdateAgent}
        />
      )}

      {/* Floating Jarvis Overlay HUD */}
      <JarvisOverlayHUD
        settings={jarvisSettings}
        onTriggerVoice={() => {
          setIsGlobalVoiceOpen(true);
        }}
        onOpenFullJarvis={() => setActiveTab('jarvis')}
        setActiveTab={setActiveTab}
      />

      {/* Global Shared SynthOS Voice Overlay */}
      <GlobalVoiceOverlay
        isOpen={isGlobalVoiceOpen}
        onClose={() => setIsGlobalVoiceOpen(false)}
        workspaceContext={activeTab}
        activeWorkspaceId={activeWorkspaceId}
        settings={jarvisSettings}
        onUpdateSettings={(newSettings) => setJarvisSettings((prev) => ({ ...prev, ...newSettings }))}
        onSendQuery={handleSendQuery}
        onJarvisCommand={handleJarvisCommand}
        onAddKanbanTask={handleAddKanbanTask}
        onAddNoteToVault={(title, content, tags, folder) => handleAddNoteToVault(title, content, tags, folder || 'Voice-Directives')}
        onOpenFullJarvis={() => {
          setIsGlobalVoiceOpen(false);
          setActiveTab('jarvis');
        }}
      />

      {/* Command Palette (Cmd + K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectTab={setActiveTab}
        notes={notes}
      />

      {/* Page Help Drawer */}
      <PageHelpDrawer
        isOpen={isHelpDrawerOpen}
        onClose={() => setIsHelpDrawerOpen(false)}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
      />

      {/* First Run Guided Tour */}
      <FirstRunTour
        isOpen={isTourOpen}
        onClose={() => setIsTourOpen(false)}
        onNavigate={(tab) => setActiveTab(tab)}
      />

      {/* Collapsible Right Activity & Telemetry Pane */}
      <RightActivityPane
        isOpen={isActivityPaneOpen}
        onToggle={() => setIsActivityPaneOpen(!isActivityPaneOpen)}
        onSelectTab={setActiveTab}
        onOpenRunModal={(run) => setSelectedRunModal(run)}
      />

      {/* Canonical Run Object Detail Modal */}
      <RunDetailModal
        isOpen={!!selectedRunModal}
        onClose={() => setSelectedRunModal(null)}
        run={selectedRunModal}
      />

      {/* Julian Goldie YouTube 4-Day Intelligence Audit Runner Modal */}
      <JulianGoldieAuditRunner
        isOpen={isJulianAuditOpen}
        onClose={() => setIsJulianAuditOpen(false)}
        onAddTasksToKanban={(tasks) => setKanbanTasks((prev) => [...tasks, ...prev])}
        onAddNoteToObsidian={(note) => setNotes((prev) => [note, ...prev])}
      />
    </div>
  );
}


// ---------------------------------------------------------------------------
// Registry → the AIModelInfo shape existing views consume. Truthful fields
// only: no latency, throughput or pricing is invented; unknowns say UNKNOWN.
// ---------------------------------------------------------------------------
function registryModelInfo(reg: Pick<RegistryState, 'models' | 'providers'>): Record<string, AIModelInfo> {
  const out: Record<string, AIModelInfo> = {};
  for (const m of reg.models) {
    const p = m.pricing.current;
    out[modelKey(m)] = {
      id: modelKey(m),
      name: m.displayName,
      provider: m.providerDisplayName,
      version: m.modelId,
      status: m.executable ? 'active' : m.availability === 'NOT_CONFIGURED' ? 'requires_key' : 'unconfigured',
      latency: 0,
      tokensPerSec: 0,
      contextWindow: m.limits.contextTokens ? `${m.limits.contextTokens} tokens` : 'UNKNOWN',
      specialty: m.capabilities.filter((c) => c.supported).map((c) => c.id).join(', ') || 'No capabilities declared',
      description: m.executable ? `${m.availability} in the model registry.` : `${m.availability}: ${m.blockers[0]?.reason ?? ''}`,
      color: m.executable ? '#00D26A' : '#7E8BB5',
      iconName: 'Layers',
      pricing: p ? { prompt: `${p.rates.input} ${p.currency} / 1M ${p.unit}`, completion: `${p.rates.output} ${p.currency} / 1M ${p.unit}` } : undefined,
    };
  }
  return out;
}

/** Seat dashboard (a nav tab) → its registry provider, or an honest "not installed". */
const SEAT_PROVIDER: Record<string, string> = {
  chatgpt: 'openai', codex: 'openai', gemini: 'gemini', antigravity: 'antigravity',
  claude: 'anthropic', claudecode: 'anthropic', deepseek: 'deepseek', perplexity: 'perplexity',
};
function seatInfo(seat: string, reg: Pick<RegistryState, 'models' | 'providers'>): AIModelInfo {
  const providerId = SEAT_PROVIDER[seat];
  const p = providerId ? reg.providers.find((x) => x.providerId === providerId) : undefined;
  return {
    id: seat,
    name: p?.displayName ?? seat,
    provider: p?.displayName ?? 'Not in the model registry',
    version: p ? `${p.modelCount} registered · ${p.executableCount} executable` : 'No provider plugin installed',
    status: p ? (p.executableCount > 0 ? 'active' : p.credential.ready ? 'partial' : 'requires_key') : 'unconfigured',
    latency: 0,
    tokensPerSec: 0,
    contextWindow: 'UNKNOWN',
    specialty: p ? `${p.protocol} · ${p.adapterDispatch}` : 'UNKNOWN',
    description: p ? `Registry provider ${p.providerId}; endpoint ${p.endpoint.ok ? p.endpoint.host : 'REFUSED'}; credential ${p.credential.ready ? 'ready' : 'not configured'}.` : 'This seat has no provider plugin in the model registry.',
    color: '#7E8BB5',
    iconName: 'Layers',
  };
}
