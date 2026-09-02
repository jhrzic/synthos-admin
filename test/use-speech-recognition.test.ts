// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useSpeechRecognition,
  isSpeechRecognitionSupported,
  checkMicrophonePermissionState,
} from '../src/hooks/useSpeechRecognition';

// ---------------------------------------------------------------------------
// Pass IX / Workstream AA19 — real tests against the shared microphone/
// speech-recognition hook, using a real mocked browser SpeechRecognition
// constructor (not a stubbed-out hook) so onstart/onresult/onerror/onend
// drive the hook's state exactly as a real browser would. This is the
// first frontend/jsdom test in this suite — scoped to this one file via
// the @vitest-environment pragma above, not a global config change.
// ---------------------------------------------------------------------------

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: (() => void) | null = null;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => { this.onstart?.(); });
  stop = vi.fn(() => { this.onend?.(); });
  abort = vi.fn(() => { /* real browsers fire no event on abort() */ });
}

let lastInstance: MockSpeechRecognition | null = null;
let instances: MockSpeechRecognition[] = [];

function installMockSpeechRecognition() {
  instances = [];
  // `new SpeechRecognition()` in the hook requires a real constructible
  // function — an arrow-function mockImplementation is never constructible
  // in JS, so this uses a real `function` constructor (vi.fn() wraps it
  // but preserves its constructibility).
  (window as any).SpeechRecognition = vi.fn(function (this: any) {
    const instance = new MockSpeechRecognition();
    instances.push(instance);
    lastInstance = instance;
    return instance;
  });
}

function uninstallMockSpeechRecognition() {
  delete (window as any).SpeechRecognition;
  delete (window as any).webkitSpeechRecognition;
  lastInstance = null;
  instances = [];
}

function resultEvent(finalText: string | null, interimText: string | null = null) {
  const results: any[] = [];
  if (interimText !== null) results.push([{ transcript: interimText }]);
  if (finalText !== null) results.push(Object.assign([{ transcript: finalText }], { isFinal: true }));
  (results as any).isFinal = undefined;
  // Build a results-like array where each entry itself carries isFinal.
  const built = results.map((r: any) => Object.assign(r, { isFinal: !!(r as any).isFinal || (finalText !== null && r[0].transcript === finalText) }));
  return { resultIndex: 0, results: built };
}

describe('AA1/AA2: capability detection is real, never assumed', () => {
  afterEach(uninstallMockSpeechRecognition);

  it('reports unsupported when no browser SpeechRecognition constructor exists', () => {
    uninstallMockSpeechRecognition();
    expect(isSpeechRecognitionSupported()).toBe(false);
  });

  it('reports supported when the browser constructor exists', () => {
    installMockSpeechRecognition();
    expect(isSpeechRecognitionSupported()).toBe(true);
  });

  it('checkMicrophonePermissionState() returns "unknown" honestly when the Permissions API is unavailable, never a fabricated state', async () => {
    const original = (navigator as any).permissions;
    delete (navigator as any).permissions;
    try {
      const state = await checkMicrophonePermissionState();
      expect(state).toBe('unknown');
    } finally {
      (navigator as any).permissions = original;
    }
  });
});

describe('AA3/AA7: hook reports UNSUPPORTED state and never claims listening without real capture', () => {
  afterEach(uninstallMockSpeechRecognition);

  it('micState starts "unsupported" and startListening() returns false when the browser has no API', () => {
    uninstallMockSpeechRecognition();
    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    expect(result.current.micState).toBe('unsupported');

    let started: boolean = true;
    act(() => { started = result.current.startListening(); });
    expect(started).toBe(false);
    expect(result.current.isListening).toBe(false);
  });
});

describe('AA7: listening state is driven by real onstart/onend/onerror events', () => {
  beforeEach(installMockSpeechRecognition);
  afterEach(uninstallMockSpeechRecognition);

  it('real start -> isListening true, micState "listening"', () => {
    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => { result.current.startListening(); });
    expect(result.current.isListening).toBe(true);
    expect(result.current.micState).toBe('listening');
  });

  it('onend -> isListening false', () => {
    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => { result.current.startListening(); });
    expect(result.current.isListening).toBe(true);
    act(() => { lastInstance!.onend?.(); });
    expect(result.current.isListening).toBe(false);
  });

  it('a real error -> isListening false, and the error is surfaced (never swallowed)', () => {
    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => { result.current.startListening(); });
    act(() => { lastInstance!.onerror?.({ error: 'network' }); });
    expect(result.current.isListening).toBe(false);
    expect(result.current.error?.code).toBe('network');
    expect(result.current.error?.message).toBeTruthy();
  });

  it('AA11: "not-allowed" maps to permission-denied, not a generic error', () => {
    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => { result.current.startListening(); });
    act(() => { lastInstance!.onerror?.({ error: 'not-allowed' }); });
    expect(result.current.micState).toBe('permission-denied');
  });

  it('AA12: "audio-capture" (no hardware) maps to no-device, distinct from permission-denied', () => {
    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => { result.current.startListening(); });
    act(() => { lastInstance!.onerror?.({ error: 'audio-capture' }); });
    expect(result.current.micState).toBe('no-device');
  });

  it('"no-speech" is not treated as a hard error — recognition keeps its listening state', () => {
    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => { result.current.startListening(); });
    act(() => { lastInstance!.onerror?.({ error: 'no-speech' }); });
    expect(result.current.isListening).toBe(true);
    expect(result.current.error).toBeNull();
  });
});

describe('AA10: transcript handling — no empty submission, no duplicate final submission', () => {
  beforeEach(installMockSpeechRecognition);
  afterEach(uninstallMockSpeechRecognition);

  it('an empty/whitespace-only final transcript is never submitted', () => {
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition(onFinal));
    act(() => { result.current.startListening(); });
    act(() => { lastInstance!.onresult?.(resultEvent('   ')); });
    expect(onFinal).not.toHaveBeenCalled();
  });

  it('a real final transcript is trimmed and submitted exactly once', () => {
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition(onFinal));
    act(() => { result.current.startListening(); });
    act(() => { lastInstance!.onresult?.(resultEvent('  book a meeting  ')); });
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith('book a meeting');
  });

  it('the same final transcript firing twice in rapid succession is only submitted once', () => {
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition(onFinal));
    act(() => { result.current.startListening(); });
    act(() => { lastInstance!.onresult?.(resultEvent('run the audit')); });
    act(() => { lastInstance!.onresult?.(resultEvent('run the audit')); });
    expect(onFinal).toHaveBeenCalledTimes(1);
  });

  it('two different consecutive utterances (continuous mode) both submit', () => {
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition(onFinal));
    act(() => { result.current.startListening(); });
    act(() => { lastInstance!.onresult?.(resultEvent('first command')); });
    act(() => { lastInstance!.onresult?.(resultEvent('second command')); });
    expect(onFinal).toHaveBeenCalledTimes(2);
    expect(onFinal).toHaveBeenNthCalledWith(1, 'first command');
    expect(onFinal).toHaveBeenNthCalledWith(2, 'second command');
  });
});

describe('AA8: cleanup — no orphan capture on unmount', () => {
  beforeEach(installMockSpeechRecognition);
  afterEach(uninstallMockSpeechRecognition);

  it('unmounting while listening aborts the real recognizer', () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => { result.current.startListening(); });
    const instance = lastInstance!;
    unmount();
    expect(instance.abort).toHaveBeenCalled();
  });
});

describe('AA9: only one assistant recognizer is ever active at a time', () => {
  beforeEach(installMockSpeechRecognition);
  afterEach(uninstallMockSpeechRecognition);

  it('starting a second hook instance (e.g. Apollo) stops the first (e.g. Jarvis)', () => {
    const jarvis = renderHook(() => useSpeechRecognition(() => {}));
    act(() => { jarvis.result.current.startListening(); });
    expect(jarvis.result.current.isListening).toBe(true);
    const jarvisInstance = lastInstance!;

    const apollo = renderHook(() => useSpeechRecognition(() => {}));
    act(() => { apollo.result.current.startListening(); });

    // The Jarvis recognizer's real stop() was called as a side effect of
    // Apollo starting — not just a state flip on Jarvis's side.
    expect(jarvisInstance.stop).toHaveBeenCalled();
    expect(apollo.result.current.isListening).toBe(true);
  });
});
