// Authority record API. Workspace comes from verified membership
// (requireWorkspaceMember), never from trusting the request body.
//
//   GET  /api/authority/record?workspaceId=…     → exportable bundle (verify offline
//                                                  with tools/verify-authority-record.mjs)
//   GET  /api/authority/audit?workspaceId=…      → server-side integrity check
//   POST /api/authority/checkpoint {workspaceId} → sign the chain head (admins)
//   POST /api/authority/outcome {workspaceId, receiptId, label, detail?} → attach a result
//   GET  /api/authority/summary?workspaceId=…    → what the Admin panel shows
// Daily checkpoints are signed by authorityTickForScheduler() on the scheduler's timer.

import type { Express } from 'express';
import { authorizedWorkspaceId, fromBody, fromQuery, requireWorkspaceAdmin, requireWorkspaceMember, type AuthedRequest } from './authorization';
import {
  auditWorkspace, backfillLedger, exportAuthorityRecord, recordOutcome, signCheckpoint, summarizeAuthority,
} from './authority-ledger';

export function registerAuthorityRoutes(app: Express): void {
  app.get('/api/authority/summary', requireWorkspaceMember(fromQuery), (req, res) => {
    backfillLedger();
    res.json({ success: true, summary: summarizeAuthority(authorizedWorkspaceId(req)!) });
  });

  app.post('/api/authority/outcome', requireWorkspaceMember(fromBody), (req, res) => {
    try {
      const user = (req as AuthedRequest).authUser;
      const entry = recordOutcome({
        workspaceId: authorizedWorkspaceId(req)!,
        receiptId: String(req.body?.receiptId || ''),
        label: String(req.body?.label || ''),
        detail: typeof req.body?.detail === 'string' ? req.body.detail : undefined,
        recordedBy: user?.user_id ?? 'unknown',
      });
      res.json({ success: true, entry });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || 'Could not record the result.' });
    }
  });

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
