// ---------------------------------------------------------------------------
// The public business assistant page.
//
// This is the revenue surface: the thing a business puts in front of its own
// customers. It is deliberately NOT a panel inside SynthOS Admin — a customer
// never sees SynthOS, never logs in, and never learns which workspace answered
// them.
//
// Design constraints that are not negotiable here:
//  * WHITE-LABEL. Neutral surface, the business's name at the top. Neither
//    glass-orbit (the platform's language) nor the marketing site's amber.
//  * NO FRAMEWORK, NO BUILD STEP. One HTML document and one script served by
//    the same Express process, identical in dev and production.
//  * CSP-CLEAN. The app's own Content-Security-Policy is script-src 'self',
//    so the script is a separate served file, not an inline <script>.
//  * AI DISCLOSURE IS VISIBLE BEFORE THE FIRST MESSAGE, not in a footer.
//  * The answer's provenance is shown to the customer. When the assistant is
//    quoting the business's published material it says so; when it does not
//    know, that reads as an honest limit rather than a failure.
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function renderAssistantPage(params: {
  publicKey: string; businessName: string; assistantName: string; aiDisclosure: string;
  voiceEnabled: boolean; embedded: boolean;
}): string {
  const { publicKey, businessName, assistantName, aiDisclosure } = params;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(businessName)} — Ask ${esc(assistantName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&display=swap">
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --panel: #f6f6f7; --ink: #16161a; --muted: #6b6b76;
    --line: rgba(0,0,0,.10); --me: #16161a; --me-ink: #ffffff;
    --note: #5b5b66; --warn-bg: #fff8e8; --warn-line: #e8c98a; --warn-ink: #6b5320;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #101013; --panel: #1a1a1f; --ink: #f2f2f4; --muted: #9a9aa6;
      --line: rgba(255,255,255,.12); --me: #f2f2f4; --me-ink: #101013;
      --note: #a8a8b4; --warn-bg: #241f12; --warn-line: #5c4a22; --warn-ink: #e8cd92;
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.55 Archivo, system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex; flex-direction: column;
  }
  /* One centred column on desktop, full width on a phone. Without this the
     conversation clings to the left edge of a wide monitor and reads as a
     debug console rather than a business's front door. */
  .wrap { width: 100%; max-width: 760px; margin: 0 auto; padding: 0 18px; }
  header {
    padding: 16px 0 calc(16px + env(safe-area-inset-top)); border-bottom: 1px solid var(--line);
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  }
  header.bar, #disclosure.bar, footer.bar { width: 100%; }
  header h1 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -.01em; }
  header span { font-size: 13px; color: var(--muted); }
  #disclosure {
    margin: 0; font-size: 12.5px; color: var(--warn-ink);
    background: var(--warn-bg); border-bottom: 1px solid var(--warn-line);
  }
  #disclosure .wrap { padding-block: 10px; }
  main { flex: 1; overflow-y: auto; }
  main .wrap { padding-block: 20px; display: flex; flex-direction: column; gap: 16px; }
  .row { display: flex; }
  .row.me { justify-content: flex-end; }
  .bubble {
    max-width: min(680px, 86%); padding: 11px 14px; border-radius: 14px;
    background: var(--panel); border: 1px solid var(--line); white-space: pre-wrap; word-wrap: break-word;
  }
  .row.me .bubble { background: var(--me); color: var(--me-ink); border-color: transparent; }
  .meta { margin-top: 7px; font-size: 11.5px; color: var(--muted); display: flex; gap: 8px; flex-wrap: wrap; }
  .tag { border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; }
  .notice { font-size: 12.5px; color: var(--note); border-left: 2px solid var(--line); padding-left: 10px; }
  footer { border-top: 1px solid var(--line); background: var(--bg); }
  footer .wrap { padding-block: 14px; padding-bottom: calc(14px + env(safe-area-inset-bottom)); }
  form { display: flex; gap: 10px; align-items: flex-end; }
  textarea {
    flex: 1; resize: none; font: inherit; color: inherit; background: var(--panel);
    border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; min-height: 44px; max-height: 160px;
  }
  button {
    font: inherit; font-weight: 600; padding: 11px 18px; border-radius: 12px; cursor: pointer;
    background: var(--me); color: var(--me-ink); border: 1px solid transparent;
  }
  button[disabled] { opacity: .45; cursor: not-allowed; }
  .fineprint {
    margin: 8px 0 0; font-size: 11.5px; color: var(--muted);
    display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  }
  .fineprint label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap; }
  .icon {
    flex: 0 0 auto; width: 44px; height: 44px; padding: 0; border-radius: 12px;
    background: var(--panel); color: var(--ink); border: 1px solid var(--line);
    display: inline-flex; align-items: center; justify-content: center;
  }
  .icon:hover { border-color: var(--muted); }
  /* Real listening state, driven by the browser's own recognition events —
     never a decorative animation that runs whether or not a mic is live. */
  .icon.listening { background: #d92d20; border-color: #d92d20; color: #fff; animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(217,45,32,.45); } 50% { box-shadow: 0 0 0 7px rgba(217,45,32,0); } }
  .micstate { margin-top: 7px; font-size: 12px; color: var(--note); }
  .micstate.error { color: #d92d20; }
  .speaking { display: inline-flex; align-items: center; gap: 6px; margin-top: 7px; font-size: 11.5px; color: var(--muted); }
  .speaking button { font: inherit; padding: 2px 9px; border-radius: 999px; background: transparent;
    color: var(--muted); border: 1px solid var(--line); cursor: pointer; }
  @media (max-width: 480px) { .wrap { padding: 0 14px; } .bubble { max-width: 92%; } }
</style>
</head>
<body data-key="${esc(publicKey)}" data-voice="${params.voiceEnabled ? '1' : '0'}" data-embed="${params.embedded ? '1' : '0'}">
  <header class="bar">
    <div class="wrap" style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
      <h1>${esc(businessName)}</h1>
      <span>You're chatting with ${esc(assistantName)}</span>
    </div>
  </header>
  <div id="disclosure" class="bar"><div class="wrap">${esc(aiDisclosure)}</div></div>
  <main class="bar"><div class="wrap" id="thread" aria-live="polite"></div></main>
  <footer class="bar">
   <div class="wrap">
    <form id="composer">
      <label for="input" class="sr-only" hidden>Your message</label>
      <button type="button" id="mic" class="icon" aria-label="Speak your question" title="Speak your question" hidden>
        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z"/><path fill="currentColor" d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V19H8.5a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2H13v-2.09A6 6 0 0 0 18 11Z"/></svg>
      </button>
      <textarea id="input" rows="1" placeholder="Ask a question…" autocomplete="off"></textarea>
      <button type="submit" id="send">Send</button>
    </form>
    <div class="fineprint">
      <span id="fineprint">This assistant cannot book appointments. It can pass you to a person.</span>
      <label id="speaktoggle" hidden><input type="checkbox" id="speak"> Speak replies</label>
    </div>
    <div id="micstate" class="micstate" hidden></div>
   </div>
  </footer>
  <script src="/a/assistant.js"></script>
</body>
</html>`;
}

/**
 * The page script. Served as a file (not inlined) so the app-wide
 * `script-src 'self'` policy applies to it unchanged.
 */
export const ASSISTANT_SCRIPT = `(function () {
  var key = document.body.getAttribute('data-key');
  var thread = document.getElementById('thread');
  var form = document.getElementById('composer');
  var input = document.getElementById('input');
  var send = document.getElementById('send');
  var conversationId = null;
  var busy = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function bubble(who, text, meta) {
    var row = el('div', 'row' + (who === 'me' ? ' me' : ''));
    var b = el('div', 'bubble');
    b.appendChild(el('div', null, text));
    if (meta && meta.length) {
      var m = el('div', 'meta');
      for (var i = 0; i < meta.length; i++) m.appendChild(el('span', 'tag', meta[i]));
      b.appendChild(m);
    }
    row.appendChild(b);
    thread.appendChild(row);
    thread.scrollTop = thread.scrollHeight;
    return row;
  }

  function notice(text) {
    var n = el('div', 'notice', text);
    thread.appendChild(n);
    thread.scrollTop = thread.scrollHeight;
  }

  // How an answer was produced, stated plainly to the person reading it.
  function describe(mode, sources) {
    var tags = [];
    if (mode === 'GROUNDED_EXTRACTIVE') {
      tags.push(sources && sources.length ? 'From published material' : 'From business information');
    } else if (mode === 'NO_KNOWLEDGE') {
      tags.push('No verified answer available');
    } else if (mode === 'LLM') {
      tags.push('AI-written from published material');
    }
    if (sources) for (var i = 0; i < sources.length && i < 3; i++) {
      if (sources[i] && sources[i].title) tags.push(sources[i].title);
    }
    return tags;
  }

  function setBusy(v) {
    busy = v;
    send.disabled = v;
    send.textContent = v ? 'Sending…' : 'Send';
  }

  function start() {
    fetch('/api/public/assistant/' + encodeURIComponent(key) + '/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.success) { notice('This assistant is not available right now.'); setBusy(true); return; }
        conversationId = d.conversationId;
        bubble('them', d.greeting.content, []);
      })
      .catch(function () { notice('Could not reach the assistant. Please try again.'); });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy || !conversationId) return;
    var text = input.value.trim();
    if (!text) return;
    bubble('me', text, null);
    input.value = '';
    input.style.height = 'auto';
    setBusy(true);

    fetch('/api/public/assistant/' + encodeURIComponent(key) + '/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: conversationId, text: text })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        setBusy(false);
        if (!d || !d.success) { notice(d && d.error ? d.error : 'Something went wrong. Please try again.'); return; }
        var row = bubble('them', d.reply.content, describe(d.responseMode, d.sources));
        speak(d.reply.messageId, row.firstChild);
        // The outcome is reported exactly as it is. A follow-up request is
        // never displayed as a confirmed booking.
        if (d.actionDetail) notice(d.actionDetail);
      })
      .catch(function () { setBusy(false); notice('Could not reach the assistant. Please try again.'); });
  });

  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.dispatchEvent(new Event('submit', { cancelable: true })); }
  });

  // -------------------------------------------------------------------------
  // VOICE INPUT — the browser's own speech recognition.
  //
  // Same approach as the rest of SynthOS (src/hooks/useSpeechRecognition.ts):
  // real capability detection, real permission events, honestly mapped errors.
  // No audio is recorded, uploaded or stored by this page: the browser does the
  // recognition and this code only ever sees the resulting text.
  //
  // The transcript lands in the text box rather than being sent — a customer
  // gets to read and correct what the browser heard before the business does.
  // -------------------------------------------------------------------------
  var micBtn = document.getElementById('mic');
  var micState = document.getElementById('micstate');
  var recognition = null;
  var listening = false;

  var MIC_ERRORS = {
    'not-allowed': 'Microphone access was blocked. Allow it in your browser to speak your question.',
    'service-not-allowed': 'Speech recognition is blocked by this browser or device.',
    'audio-capture': 'No microphone was found.',
    'network': 'The connection dropped during voice input. Please try again.',
    'aborted': ''
  };

  function speechSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function setMicNote(text, isError) {
    if (!text) { micstateHide(); return; }
    micState.textContent = text;
    micState.className = 'micstate' + (isError ? ' error' : '');
    micState.hidden = false;
  }
  function micstateHide() { micState.hidden = true; micState.textContent = ''; }

  function stopListening() {
    if (recognition) { try { recognition.stop(); } catch (e) {} }
    listening = false;
    micBtn.classList.remove('listening');
    micBtn.setAttribute('aria-label', 'Speak your question');
  }

  function startListening() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try {
      recognition = new SR();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = navigator.language || 'en-US';

      recognition.onstart = function () {
        listening = true;
        micBtn.classList.add('listening');
        micBtn.setAttribute('aria-label', 'Stop listening');
        setMicNote('Listening… speak now.', false);
      };
      recognition.onresult = function (event) {
        var text = '';
        for (var i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
        input.value = text;
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 160) + 'px';
        // The final transcript is shown for review, never auto-submitted.
        if (event.results[event.results.length - 1].isFinal) {
          setMicNote('Check it reads right, then send.', false);
        }
      };
      recognition.onerror = function (event) {
        var code = (event && event.error) || 'unknown';
        // Silence between words is expected, not a failure.
        if (code === 'no-speech') { setMicNote("I didn't catch that — try again.", false); return; }
        stopListening();
        var msg = MIC_ERRORS[code];
        if (msg === undefined) msg = 'Voice input stopped unexpectedly.';
        if (msg) setMicNote(msg, true); else micstateHide();
      };
      recognition.onend = function () {
        listening = false;
        micBtn.classList.remove('listening');
      };
      recognition.start();
    } catch (e) {
      stopListening();
      setMicNote('Voice input could not be started.', true);
    }
  }

  if (speechSupported()) {
    micBtn.hidden = false;
    micBtn.addEventListener('click', function () {
      if (listening) { stopListening(); micstateHide(); } else { startListening(); }
    });
  } else {
    // Stated, not hidden: text chat is fully functional either way.
    micBtn.hidden = true;
  }

  // -------------------------------------------------------------------------
  // VOICE OUTPUT — the business's own configured voice, generated server-side.
  //
  // Only ever asks the server to speak a message the server already sent, by
  // id. Nothing typed here can be turned into audio.
  //
  // The browser's own built-in voice is deliberately NOT used as a fallback:
  // a business that configured a cloned voice would get a generic robotic one
  // instead, with nothing saying so. A failure reads as a failure.
  // -------------------------------------------------------------------------
  var speakToggle = document.getElementById('speak');
  var speakWrap = document.getElementById('speaktoggle');
  var voiceAllowed = document.body.getAttribute('data-voice') === '1';
  var audio = null;

  if (voiceAllowed) {
    speakWrap.hidden = false;
    try {
      if (localStorage.getItem('assistant-speak') === '1') speakToggle.checked = true;
    } catch (e) {}
    speakToggle.addEventListener('change', function () {
      try { localStorage.setItem('assistant-speak', speakToggle.checked ? '1' : '0'); } catch (e) {}
      if (!speakToggle.checked) stopAudio();
    });
  }

  function stopAudio() {
    if (audio) { try { audio.pause(); } catch (e) {} audio = null; }
    var c = document.getElementById('speaking-row');
    if (c) c.remove();
  }

  function speak(messageId, row) {
    if (!voiceAllowed || !speakToggle.checked || !messageId) return;
    stopAudio();
    fetch('/api/public/assistant/' + encodeURIComponent(key) + '/speak', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: conversationId, messageId: messageId })
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error((d && d.error) || 'unavailable'); });
        return r.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        audio = new Audio(url);
        var bar = el('div', 'speaking');
        bar.id = 'speaking-row';
        bar.appendChild(el('span', null, 'Speaking'));
        var stopBtn = el('button', null, 'Stop');
        stopBtn.type = 'button';
        stopBtn.addEventListener('click', stopAudio);
        bar.appendChild(stopBtn);
        row.appendChild(bar);
        audio.addEventListener('ended', function () { URL.revokeObjectURL(url); stopAudio(); });
        audio.play().catch(function () {
          // Autoplay policy, usually. The written answer is untouched.
          stopAudio();
          notice('Your browser blocked the spoken reply. The written answer is above.');
        });
      })
      .catch(function () {
        // A voice failure must never turn a good text answer into a failure.
        stopAudio();
        notice('The spoken reply is unavailable right now. The written answer is above.');
      });
  }

  start();
})();
`;

// ---------------------------------------------------------------------------
// THE EMBED LOADER
//
// One small script a business drops into its own website. It creates a
// launcher button and, on first open, an <iframe> pointing back at this
// server's assistant page.
//
// WHY AN IFRAME AND NOT AN INLINE WIDGET
//
// An inline widget would inherit the host page's CSS, share its DOM and its
// JavaScript globals, and — the part that actually matters — would have to
// talk to this server cross-origin, which means loosening the site-wide Origin
// check that currently protects every state-changing route in SynthOS.
//
// With an iframe the widget document is served from THIS origin, so its
// fetches are same-origin and every existing API protection stays exactly as
// it is. The only thing that has to be relaxed is `frame-ancestors`, scoped to
// one route and driven by the business's own allowlist. A host page cannot
// read inside the frame, and the frame cannot read the host page.
//
// The loader deliberately does almost nothing: no analytics, no cookies, no
// third-party requests, and no reading of the host page.
// ---------------------------------------------------------------------------

export const EMBED_LOADER_SCRIPT = `(function () {
  var current = document.currentScript;
  if (!current) return;
  var key = current.getAttribute('data-assistant');
  if (!key || !/^[a-f0-9]{32,64}$/.test(key)) {
    console.error('[assistant] data-assistant is missing or not a valid assistant key.');
    return;
  }
  // The origin the script itself was loaded from — never a value taken from
  // the host page, so a misconfigured site cannot point the widget elsewhere.
  var base;
  try { base = new URL(current.src).origin; } catch (e) { return; }

  var label = current.getAttribute('data-label') || 'Chat with us';
  var accent = current.getAttribute('data-accent') || '#16161a';
  var side = current.getAttribute('data-position') === 'left' ? 'left' : 'right';
  if (!/^#[0-9a-fA-F]{3,8}$/.test(accent)) accent = '#16161a';

  if (document.getElementById('synthos-assistant-root')) return;

  var root = document.createElement('div');
  root.id = 'synthos-assistant-root';
  // Shadow DOM so the host page's CSS cannot reshape the launcher, and the
  // launcher's CSS cannot leak into the host page. Deliberately OPEN: the real
  // isolation boundary is the iframe, not the shadow mode, and a closed root
  // buys nothing against a host page that already runs the loader — while
  // making the widget harder to inspect, test and support.
  var shadow = root.attachShadow ? root.attachShadow({ mode: 'open' }) : root;

  var style = document.createElement('style');
  style.textContent = [
    ':host, .layer { all: initial; }',
    '.layer { position: fixed; bottom: 20px; ' + side + ': 20px; z-index: 2147483000;',
    '  font: 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }',
    '.launcher { display: inline-flex; align-items: center; gap: 8px; cursor: pointer;',
    '  background: ' + accent + '; color: #fff; border: 0; border-radius: 999px;',
    '  padding: 13px 20px; font: inherit; font-weight: 600;',
    '  box-shadow: 0 6px 24px rgba(0,0,0,.22); }',
    '.launcher:hover { filter: brightness(1.12); }',
    '.panel { position: fixed; bottom: 20px; ' + side + ': 20px; width: 400px; height: 620px;',
    '  max-width: calc(100vw - 32px); max-height: calc(100vh - 40px);',
    '  border: 0; border-radius: 16px; overflow: hidden; background: #fff;',
    '  box-shadow: 0 18px 60px rgba(0,0,0,.30); z-index: 2147483000; }',
    '.hidden { display: none !important; }',
    '.close { position: fixed; bottom: 648px; ' + side + ': 26px; width: 30px; height: 30px;',
    '  border-radius: 999px; border: 0; cursor: pointer; background: ' + accent + '; color: #fff;',
    '  font: 600 16px/1 system-ui; z-index: 2147483001; }',
    '@media (max-width: 480px) {',
    '  .panel { width: 100vw; height: 100vh; max-width: 100vw; max-height: 100vh;',
    '    bottom: 0; ' + side + ': 0; border-radius: 0; }',
    '  .close { bottom: auto; top: 10px; ' + side + ': 12px; }',
    '}'
  ].join('\\n');

  var layer = document.createElement('div');
  layer.className = 'layer';

  var launcher = document.createElement('button');
  launcher.className = 'launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', label);
  launcher.textContent = label;

  var frame = null;
  var closeBtn = null;

  function open() {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'panel';
      frame.title = label;
      frame.src = base + '/a/' + encodeURIComponent(key) + '?embed=1';
      // Microphone is delegated explicitly so voice input can work inside the
      // frame. Nothing else is granted.
      frame.setAttribute('allow', 'microphone; autoplay');
      // The frame is same-origin with the assistant server, never with the
      // host page, so it can never script the page it sits on.
      frame.setAttribute('referrerpolicy', 'strict-origin');
      shadow.appendChild(frame);

      closeBtn = document.createElement('button');
      closeBtn.className = 'close';
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.textContent = '\\u00d7';
      closeBtn.addEventListener('click', close);
      shadow.appendChild(closeBtn);
    }
    frame.classList.remove('hidden');
    if (closeBtn) closeBtn.classList.remove('hidden');
    launcher.classList.add('hidden');
  }

  function close() {
    if (frame) frame.classList.add('hidden');
    if (closeBtn) closeBtn.classList.add('hidden');
    launcher.classList.remove('hidden');
  }

  launcher.addEventListener('click', open);
  layer.appendChild(launcher);
  shadow.appendChild(style);
  shadow.appendChild(layer);
  document.body.appendChild(root);
})();
`;

/** The snippet a business pastes into its website, shown verbatim in the owner UI. */
export function embedSnippet(origin: string, publicKey: string, businessName: string): string {
  return `<script src="${origin}/a/embed.js"\n        data-assistant="${publicKey}"\n        data-label="Chat with ${businessName}"\n        async></script>`;
}
