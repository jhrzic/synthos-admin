import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('SYNTHOS GLOBAL SHELL INVARIANT: Jarvis Non-Removable Architecture Rule', () => {
  const appFileContent = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
  const airbyteHeaderContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AirbyteHeader.tsx'), 'utf-8');
  const globalVoiceOverlayContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/GlobalVoiceOverlay.tsx'), 'utf-8');
  const apolloVoiceContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ApolloVoiceView.tsx'), 'utf-8');
  const serverContent = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');

  it('1. App.tsx mounts JarvisOverlayHUD at the global shell level outside workspace switcher', () => {
    // Invariant: JarvisOverlayHUD must be mounted at global shell level
    expect(appFileContent).toContain('<JarvisOverlayHUD');
    
    // Invariant: JarvisOverlayHUD must be mounted outside the <main> tags
    const mainStartIndex = appFileContent.indexOf('<main');
    const mainEndIndex = appFileContent.indexOf('</main>');
    const jarvisOverlayIndex = appFileContent.indexOf('<JarvisOverlayHUD');
    
    expect(mainStartIndex).toBeGreaterThan(-1);
    expect(mainEndIndex).toBeGreaterThan(-1);
    expect(jarvisOverlayIndex).toBeGreaterThan(mainEndIndex);
  });

  it('2. App.tsx mounts GlobalVoiceOverlay at the global shell level outside workspace switcher', () => {
    expect(appFileContent).toContain('<GlobalVoiceOverlay');
    const mainEndIndex = appFileContent.indexOf('</main>');
    const globalVoiceIndex = appFileContent.indexOf('<GlobalVoiceOverlay');
    
    expect(globalVoiceIndex).toBeGreaterThan(mainEndIndex);
  });

  it('3. AirbyteHeader provides global Jarvis Orb and Command Palette triggers across all workspaces', () => {
    expect(airbyteHeaderContent).toContain('id="header-jarvis-orb"');
    expect(airbyteHeaderContent).toContain('id="header-search"');
  });

  it('4. Workspaces (Hermes, Gemini, Claude, Codex, Cursor, Antigravity, OpenClaw, Orchestrator) switch inside <main> without unmounting global Jarvis shell components', () => {
    const majorWorkspaces = [
      'hermes',
      'gemini',
      'claude',
      'codex',
      'cursor',
      'antigravity',
      'openclaw',
      'orchestrator'
    ];

    // Invariant: getWorkspaceFromTab maps all 8 major workspaces
    majorWorkspaces.forEach((ws) => {
      expect(appFileContent).toContain(`return '${ws}'`);
    });

    // Invariant: WorkspaceTopNav renders conditionally inside the shell
    expect(appFileContent).toContain('<WorkspaceTopNav');

    // Verify only a single JarvisOverlayHUD exists at shell level
    const hudMatches = appFileContent.match(/<JarvisOverlayHUD/g);
    expect(hudMatches?.length).toBe(1);

    // Verify only a single GlobalVoiceOverlay exists at shell level
    const voiceMatches = appFileContent.match(/<GlobalVoiceOverlay/g);
    expect(voiceMatches?.length).toBe(1);
  });

  it('5. Apollo is isolated to Hermes workspace and separate from Global Jarvis Engine', () => {
    // Invariant: ApolloVoiceView is only mounted for Hermes Apollo tab
    expect(appFileContent).toContain("activeTab === 'hermes-apollo'");
    expect(appFileContent).toContain('<ApolloVoiceView');
    
    // Apollo is NOT mounted at global shell level
    const mainEndIndex = appFileContent.indexOf('</main>');
    const apolloViewIndex = appFileContent.indexOf('<ApolloVoiceView');
    expect(apolloViewIndex).toBeLessThan(mainEndIndex);

    // Server-side segregation: Apollo endpoints are /api/apollo/* while Jarvis endpoints are /api/jarvis/*
    expect(serverContent).toContain('/api/jarvis/command');
    expect(serverContent).toContain('/api/apollo/command');
    expect(serverContent).toContain('/api/apollo/status');
  });

  it('6. Backend provides dedicated global Jarvis command endpoint', () => {
    expect(serverContent).toContain('app.post("/api/jarvis/command"');
    expect(serverContent).toContain('app.post(["/api/voice/tts", "/api/tts"]');
  });

  it('7. GLOBAL_JARVIS_ENTRYPOINT routes to activeTab "jarvis" and NOT "hermes-apollo"', () => {
    // Assert JarvisOverlayHUD onOpenFullJarvis routes to jarvis
    expect(appFileContent).toContain("onOpenFullJarvis={() => setActiveTab('jarvis')}");
    
    // Explicitly fail if misrouted to hermes-apollo
    expect(appFileContent).not.toContain("onOpenFullJarvis={() => setActiveTab('hermes-apollo')}");

    // Assert GlobalVoiceOverlay onOpenFullJarvis routes to jarvis
    expect(appFileContent).toContain("setActiveTab('jarvis')");

    // Assert JarvisView is mounted when activeTab === 'jarvis'
    expect(appFileContent).toContain("activeTab === 'jarvis'");
    expect(appFileContent).toContain('<JarvisView');

    // Assert SidebarNav includes jarvis entrypoint in SYSTEM
    const sidebarContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/SidebarNav.tsx'), 'utf-8');
    expect(sidebarContent).toContain("id: 'jarvis'");

    // Assert CommandPalette includes global jarvis entrypoint
    const commandPaletteContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/CommandPalette.tsx'), 'utf-8');
    expect(commandPaletteContent).toContain("id: 'jarvis'");
  });

  it('8. Explicit Assert: Triggering the HUD routes the user to the correct "jarvis" tab and not "hermes-apollo"', () => {
    // Read the current JarvisOverlayHUD implementation to verify it invokes setActiveTab with 'jarvis'
    const hudFileContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/JarvisOverlayHUD.tsx'), 'utf-8');
    expect(hudFileContent).toContain("setActiveTab('jarvis')");
    
    // Explicitly verify the App.tsx handler also resolves to 'jarvis'
    expect(appFileContent).toContain("onOpenFullJarvis={() => setActiveTab('jarvis')}");
    expect(appFileContent).not.toContain("onOpenFullJarvis={() => setActiveTab('hermes-apollo')}");
  });
});
