# First-Customer Runbook — Business Conversation AI

What to do, in order, to put this in front of a paying business. Nothing here is
aspirational: every step has been run end to end on this install.

---

## 0. Before you start

| You need | Why |
|---|---|
| A server reachable over **HTTPS** | Browsers block an http widget on an https website. This is the one hard requirement. |
| The business's own published material | The assistant can only say what the business has published. No material, no product. |
| *(optional)* A Gemini API key | Natural phrasing. Without it replies are accurate quotes that read like documents. |
| *(optional)* Fish Audio credit | Spoken replies. **The current account's paid balance is exhausted** — see step 8. |

---

## 1. Deploy

The deployment path already exists — do not invent a new one.

```bash
cp .env.example .env          # fill in real values, never commit it
docker compose up -d --build
curl http://localhost:3000/health
```

Put Caddy in front for TLS (`docs/deploy/Caddyfile.example` is ready to copy), then start
the app with:

```
TRUST_PROXY_HOPS=1
PUBLIC_BASE_URL=https://your-real-domain.example
```

**`PUBLIC_BASE_URL` is the one that matters most.** Behind a TLS-terminating proxy the app
receives plain HTTP, so without it the embed snippet is handed to the business as
`http://…` and their browser blocks it as mixed content — silently. The readiness panel
warns when this is wrong; do not ignore it.

---

## 2. Create the workspace

Master Admin → Workspaces → create one per business, then add yourself as a member.
One workspace = one business. This is what keeps two customers' knowledge apart.

---

## 3. Configure the assistant

**Business Assistant** in the nav. Fill in:

- Business name, assistant name
- What the business does (one or two sentences)
- Services, areas served, hours, contact
- Opening line
- Who gets told when a customer asks for a person

The AI disclosure is filled in for you and shown to every visitor before the first message.

---

## 4. Add the knowledge

Paste anything a customer might ask about: guarantees, process, pricing, policies,
what's included. Each document is stored in the workspace Vault and indexed.

**The assistant can only quote these documents and the profile fields above.** If a
question is not covered, it says so. That is the behaviour you are selling — do not try
to work around it by writing vague documents.

One document is enough to start. It is tested at exactly that size.

---

## 5. Publish and authorize the website

1. **Publish** → mints a permanent public link.
2. **Add the business's website** under *Put it on your website*.

Publishing and embedding are separate on purpose: a newly published assistant has an
empty allowlist, so the link works and nobody can frame it. Add the exact origin —
`https://example.com` and `https://www.example.com` are **different origins**, so list
both if the site serves both.

---

## 6. Install on their site

Copy the snippet and have them paste it before `</body>`:

```html
<script src="https://your-domain.example/a/embed.js"
        data-assistant="<their key>"
        data-label="Chat with <business>"
        async></script>
```

Then check it on the real site. An unauthorized origin shows a blank frame — that is the
allowlist working, not a bug.

---

## 7. Turn on natural phrasing (optional)

*Natural phrasing* → paste a Gemini API key → **Save and verify**. It makes a real call
and tells you whether the provider accepted it.

The key is encrypted on the server and never sent to a browser. An environment variable,
if set, always wins over one saved here.

This changes **wording only**. The model gets the same approved passages the extractive
mode would have quoted, it never runs when there is nothing approved to answer from, and
any reply asserting a price, booking or guarantee the material does not contain is
discarded rather than shown.

---

## 8. Turn on voice (optional)

Voice **input** needs nothing — it runs in the visitor's browser where supported, and no
audio ever reaches the server.

Voice **output** needs Fish Audio credit. **Current state on this install:
`FREE_TIER_ONLY`** — the paid API balance is exhausted and replies are falling back to the
free tier, which is rate-limited and can be withdrawn. Top up at
<https://fish.audio/app/developers> before a paying customer relies on it. The readiness
panel shows the real state, observed from actual calls.

Voice output can be switched off per business.

---

## 9. Test it as a customer

Open the public link and ask:

1. something the material answers → should quote it
2. something it does not → should say it doesn't know and offer a person
3. "can someone call me Tuesday?" → should say it **cannot book** and raise a follow-up
4. "can I speak to a real person?" → should hand off

If step 3 ever says anything resembling "booked", stop and report it. That is the single
worst failure this product can have.

---

## 10. Running it

- **Conversations** — every transcript, with how each answer was produced.
- **Questions you haven't answered** — the most useful panel. Each row is a real customer
  asking something the site is silent on. Answer it and the assistant handles it from
  then on. You write the answer; the assistant never promotes its own guess, and never
  learns a fact because a customer asserted one.
- **Follow-up requests and handoffs** land in the Task Board assigned to `human`. Nobody
  is contacted automatically — a person does the contacting.
- **Signed summary** — writes a deterministic transcript summary to the Vault, Aegis
  verified and Ed25519 signed. Use it if a customer ever disputes what was said.

---

## Known limitations — say these out loud when selling

| Limitation | Detail |
|---|---|
| **Cannot book** | No calendar is connected. Scheduling requests become follow-up requests for a person. |
| **No phone, no SMS** | No carrier line or messaging provider. Web only. |
| **No mobile app** | The HTTP contract is channel-agnostic; no app exists. |
| **Embedding needs HTTPS** | Enforced. `http://` origins are refused except localhost. |
| **Answers only from published material** | A feature, but set expectations: thin material means frequent refusals. |
| **Free-tier voice** | Until the Fish Audio account is topped up. |
| **One model provider** | Gemini is what this build executes. |

---

## What happens to customer data

Truthful, not aspirational.

| Data | Where it goes | Retention |
|---|---|---|
| Chat messages | `business_conversation_messages` in the app's SQLite database | Kept indefinitely. **No automatic deletion and no owner-facing delete exists yet.** |
| Name / email / phone a customer types | `business_conversations.lead_json`, and copied into the follow-up task description | Same — kept indefinitely |
| Voice input audio | **Never leaves the visitor's browser.** Recognition is done by the browser; only the text is submitted | No audio is received or stored by this server |
| Generated speech | Streamed to the visitor and not written to disk | Not stored |
| Follow-up / handoff tasks | The normal `tasks` table | Normal task retention |
| Conversation summary | A Vault artifact with an Ed25519 receipt | Permanent by design — it is evidence |
| Unanswered questions | `business_unanswered_questions` | Until answered or dismissed |

**Gaps to close before a customer with real privacy obligations:** no retention window, no
per-conversation delete, no data-export endpoint, and no cookie/consent surface beyond the
AI disclosure. Fine for a first design partner who is told this; not sufficient for a
regulated client.

Note the browser localStorage key `assistant-speak` (the visitor's "speak replies"
preference) is the only thing this product stores in a visitor's browser. No cookies are
set on the public surface.
