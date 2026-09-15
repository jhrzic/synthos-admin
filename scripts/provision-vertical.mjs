#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Provision one vertical into a running SynthOS instance.
//
// Everything here goes through the REAL HTTP API — the same routes an operator
// uses. Nothing writes to the database directly. That is the point of the
// exercise: if a vertical can be stood up without touching code or schema, then
// "same Concierge, different configuration" is demonstrated rather than
// asserted.
//
//   node scripts/provision-vertical.mjs <baseUrl> <cookieJarValue> <packDir> [workspaceId]
//
// Prints the resulting public key so a caller can immediately hold a real
// conversation against it.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

const [, , baseUrl, cookie, packDir, workspaceIdArg] = process.argv;
if (!baseUrl || !cookie || !packDir) {
  console.error('usage: provision-vertical.mjs <baseUrl> <cookie> <packDir> [workspaceId]');
  process.exit(2);
}

async function api(method, route, body) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON is an error below */ }
  if (!res.ok || !json?.success) {
    throw new Error(`${method} ${route} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return json;
}

const profile = JSON.parse(fs.readFileSync(path.join(packDir, 'profile.json'), 'utf8'));

// 1. Workspace. Reuse one if given, otherwise create a real new one.
let workspaceId = workspaceIdArg;
if (!workspaceId) {
  const created = await api('POST', '/api/master-admin/workspaces', { name: profile.businessName });
  workspaceId = created.workspace.workspace_id;
  console.log(`workspace   ${workspaceId}`);

  // Membership is granted EXPLICITLY, because creating a workspace does not
  // confer access to it and platform-admin does not silently bypass ordinary
  // workspace membership checks (ADR-003). Discovering that here, as a real
  // 403, is the authorization model working — not an obstacle to route around.
  const me = await api('GET', '/api/auth/me');
  await api('POST', `/api/master-admin/workspaces/${workspaceId}/members`, {
    userId: me.user.user_id, role: 'admin',
  });
  console.log(`membership  ${me.user.email} -> admin`);
}

// 2. The profile — this is where a vertical's identity, tone, intake fields,
//    handoff rules and permitted actions actually live. All configuration.
await api('POST', '/api/business/profile', { workspaceId, ...profile });
console.log(`profile     ${profile.businessName} / ${profile.assistantName}`);

// 3. Approved knowledge. Each file becomes a real Vault artifact and is
//    FTS5-indexed, exactly as an operator pasting it into the UI would produce.
const knowledgeDir = path.join(packDir, 'knowledge');
const files = fs.readdirSync(knowledgeDir).filter((f) => f.endsWith('.md')).sort();
for (const file of files) {
  const content = fs.readFileSync(path.join(knowledgeDir, file), 'utf8');
  // The H1 is the human title; fall back to the filename if there is none.
  const h1 = content.match(/^#\s+(.+)$/m);
  const title = h1 ? h1[1].trim() : file.replace(/\.md$/, '');
  const r = await api('POST', '/api/business/knowledge', { workspaceId, title, content });
  console.log(`knowledge   ${title}  (indexed=${r.indexed})`);
}

// 4. Publish, and authorise the business's own website for embedding.
const published = await api('POST', '/api/business/publish', { workspaceId, published: true });
if (profile.contact?.website) {
  const origin = new URL(profile.contact.website).origin;
  const o = await api('POST', '/api/business/allowed-origins', { workspaceId, origins: [origin] });
  console.log(`origins     accepted=${JSON.stringify(o.accepted)} rejected=${o.rejected.length}`);
}

console.log(`publicKey   ${published.publicKey}`);
console.log(`workspaceId ${workspaceId}`);
