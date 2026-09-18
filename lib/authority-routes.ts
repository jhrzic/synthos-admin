// Authority record API. Workspace comes from verified membership
// (requireWorkspaceMember), never from trusting the request body.
//
//   GET  /api/authority/record?workspaceId=…     → exportable bundle (verify offline
//                                                  with tools/verify-authority-record.mjs)
//   GET  /api/authority/audit?workspaceId=…      → server-side integrity check
//   POST /api/authority/checkpoint {workspaceId} → sign the chain head (admins)

import type { Express } from 'express';
import { authorizedWorkspaceId, fromBody, fromQuery, requireWorkspaceAdmin, requireWorkspaceMember } from './authorization';
import { auditWorkspace, backfillLedger, exportAuthorityRecord, signCheckpoint } from './authority-ledger';

export function registerAuthorityRoutes(app: Express): void {
  app.get('/api/authority/record', requireWorkspaceMember(fromQuery), (req, res) => {
    const workspaceId = authorizedWorkspaceId(req)!;
    const bundle = exportAuthorityRecord(workspaceId);
    res.setHeader('Content-Disposition', `attachment; filename="authority-record-${workspaceId}.json"`);
    res.json(bundle);
  });

  app.get('/api/authority/audit', requireWorkspaceMember(fromQuery), (req, res) => {
    res.json({ success: true, ...auditWorkspace(authorizedWorkspaceId(req)!) });
  });

  app.post('/api/authority/checkpoint', requireWorkspaceAdmin(fromBody), (req, res) => {
    backfillLedger();
    const cp = signCheckpoint(authorizedWorkspaceId(req)!);
    if (!cp) return res.status(404).json({ success: false, error: 'No actions are on record for this workspace yet.' });
    res.json({ success: true, checkpoint: cp });
  });
}
