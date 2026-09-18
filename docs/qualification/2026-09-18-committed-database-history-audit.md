# Committed-database history audit (2026-09-18)

Read-only. Nothing was rewritten, deleted, rotated or re-scoped, and no GitHub exception was requested. The scan
printed no secret or personal values: only categories, counts, paths, commits and fingerprint prefixes. Each historical
database version was extracted to a scratch directory outside the repository with `git show`.

**The repository is PUBLIC** (`gh repo view`: `jhrzic/synthos-admin`, visibility `PUBLIC`). Anything in its history can
be downloaded by anyone.

## Result

| | |
|---|---|
| Database files ever committed | one path: `data/synthos-admin.db` (no `.sqlite`, `.sqlite3`, `-wal` or `-shm`) |
| In the current tree | **no** |
| Credentials, tokens, passwords, sessions, private keys **inside the database** | **none** |
| Emails, phone numbers, IP addresses, home paths **inside the database** | **none** |
| Provider responses **inside the database** | none: only `model`, `outputLength` and `usage` counts, plus public Gemini `503 high demand` error text |
| Customer / PII data | none. All 16 tasks are synthetic engineering test tasks ("Zero-Trust State Machine Test", "Tamper Detection Test", …) |
| **Real credential found elsewhere in the same history** | **yes: the old receipt-signing Ed25519 private key.** See below. It is retired and not trusted by the code, so severity is **LOW–MEDIUM** |

## The database, commit by commit

The file was added on 2026-09-01 and deleted the same night by `2bc5d79` ("chore: sanitize repository secrets and clear
transient data").

| Commit | Date (-04:00) | Change | Bytes | Tables (rows) |
|---|---|---|---|---|
| `4bac7dc` | 2026-09-01 01:59 | added | 36,864 | tasks 1, task_status_history 4, activity_events 5, artifacts 1, sqlite_sequence 1 |
| `65035d5` | 02:04 | modified | 36,864 | tasks 2, history 8, activity 10, artifacts 2 |
| `fe5daf2` | 02:12 | modified | 53,248 | tasks 9, history 36, activity 36, artifacts 6, quality_reviews 0 |
| `07b1765` | 02:19 | modified | 61,440 | tasks 14, history 57, activity 56, artifacts 8, quality_reviews 1 |
| `0e09586` | 02:26 | modified | 90,112 | tasks 15, history 63, activity 64, artifacts 9, quality_reviews 2, receipts 1 |
| `e2fd065` | 02:32 | modified | 98,304 | tasks 16, history 69, activity 72, artifacts 10, quality_reviews 3, receipts 2 |
| `7b07203` | 02:37 | modified | 98,304 | same as `e2fd065` |
| `2bc5d79` | 02:42 | **deleted** | 0 | — |

- **Schema:** tasks, task_status_history, activity_events, artifacts, quality_reviews, receipts and sqlite_sequence.
- **Free pages:** every version has 0, so no deleted-row residue.
- **What was scanned:** both the live rows and the raw file bytes.
- **Artifact rows:** hold paths only (`/app/applet/vault/Startup…`), not content.
- **Receipt rows:** hold a public key and a signature. They are not secret.

**Categories scanned** (live rows and raw bytes of every version):
- **Provider and service keys:** OpenAI, Anthropic, GitHub, AWS, Google, Slack, Stripe and Telegram;
- **Tokens and key material:** JWTs, bearer headers, private-key blocks, and password or secret assignments;
- **Sessions and accounts:** scrypt hashes and session cookies;
- **Personal data and paths:** emails, phone numbers, IPv4 addresses and home-directory paths;
- **Provider responses:** response markers.

**Result:** 0 for every category except `-----BEGIN PUBLIC KEY-----`, found 1× in `0e09586` and 2× in `e2fd065` and `7b07203`. Those are receipt public keys and are not secret.

A first pass matched `sk-…` 11–261 times per version. Every one was the `…sk-` inside task IDs such as `task-pkg-…`.
With a word boundary the count is 0. This was checked by viewing masked context, not assumed.

**Where it is reachable:**
- **Remote branches:** `main`, `checkpoint/synthos-autonomous-runtime-2026-09-17`, `fix/p0-jarvis-voice-and-knowledge-mesh` and `fix/p0-openai-antigravity-integration`.
- **Local only:** `backup/claude-hermes-pre-sync`, `safety/push1-working-tree-2026-09-14`, and the tags `safety/ag-integration-pre-reword` and `safety/pre-ag-integration-2026-09-17`.

## The real credential: `data/keys/ed25519_private.pem`

It was committed in `0e09586` (2026-09-01 02:26 -04:00) and deleted in `2bc5d79` at 02:42. It is still in the public
history, on the same four remote branches.

| Fact | Evidence |
|---|---|
| It is a real Ed25519 private key | parsed with Node `crypto` (`asymmetricKeyType: ed25519`); the value was not printed |
| Its public key | SPKI SHA-256 prefix `7adbc0bb09b99bf9` (same as the committed `ed25519_public.pem`) |
| **It is not the current signing key** | the current key in `data/keys/` has public-key prefix `998cf62e7388ae38` |
| **No production receipt was signed with it** | all 52 production receipts (2026-09-08 → 2026-09-18) carry the `998cf62e…` key |
| **The code does not trust it** | `verifyReceipt` (lib/persistence.ts:2964) requires the receipt's public key to equal the *currently configured* trusted key, so a receipt forged with the leaked key fails verification |
| What it did sign | the 2 synthetic receipts inside the historic test database |

**Exposure:** anyone can sign data with the leaked key. That matters only to something that trusts public key
`7adbc0bb…`. Nothing in this code base does.

Other key or secret-like paths ever in history:
- **`.env.example`:** every version holds placeholder values only. The three long values are Fish Audio voice IDs and a public WebSocket URL, not credentials.
- **`scripts/secret-scan.mjs`:** code, not a secret.

## Remediation plan: for John to decide; **nothing below has been executed**

1. **Declare the key compromised, permanently.** Record public key `7adbc0bb09b99bf9…` as REVOKED and add a code-level
   denylist so it can never be configured as the trusted signing key again. This is a small change. It was not made
   here because the instruction was to stop after reporting.
2. **Check that nothing outside this repository trusts `7adbc0bb…`.** That includes the website, any external verifier,
   documentation, or a copy of the old `data/keys` on another machine or VPS.
3. **GitHub:** check Security → Secret scanning for an alert on `data/keys/ed25519_private.pem`. Close it as *revoked*
   after step 1. No exception was requested.
4. **Visibility:** decide whether the repository should stay public. Visibility was not changed.
5. **History rewrite: not recommended.** Purging the file would mean force-pushing four remote branches and rewriting
   local tags. Clones, forks and GitHub's caches would keep the key anyway, and the key is already retired and untrusted.
   Revocation (step 1) is what makes it harmless. Nothing was rewritten.
6. **The historic database needs no remediation.** It holds only synthetic test data.

No credential needs rotating: the exposed key was replaced before the first production receipt.
