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
  header {
    padding: 14px 18px calc(14px + env(safe-area-inset-top)); border-bottom: 1px solid var(--line);
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  }
  header h1 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -.01em; }
  header span { font-size: 13px; color: var(--muted); }
  #disclosure {
    margin: 0; padding: 10px 18px; font-size: 12.5px; color: var(--warn-ink);
    background: var(--warn-bg); border-bottom: 1px solid var(--warn-line);
  }
  main { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 14px; }
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
  footer { border-top: 1px solid var(--line); padding: 12px 18px calc(12px + env(safe-area-inset-bottom)); }
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
  .fineprint { margin: 8px 0 0; font-size: 11.5px; color: var(--muted); }
  @media (max-width: 480px) { main { padding: 14px; } .bubble { max-width: 92%; } }
</style>
</head>
<body data-key="${esc(publicKey)}">
  <header>
    <h1>${esc(businessName)}</h1>
    <span>You're chatting with ${esc(assistantName)}</span>
  </header>
  <p id="disclosure">${esc(aiDisclosure)}</p>
  <main id="thread" aria-live="polite"></main>
  <footer>
    <form id="composer">
      <label for="input" class="sr-only" hidden>Your message</label>
      <textarea id="input" rows="1" placeholder="Ask a question…" autocomplete="off"></textarea>
      <button type="submit" id="send">Send</button>
    </form>
    <p class="fineprint" id="fineprint">This assistant cannot book appointments. It can pass you to a person.</p>
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
        bubble('them', d.reply.content, describe(d.responseMode, d.sources));
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

  start();
})();
`;
