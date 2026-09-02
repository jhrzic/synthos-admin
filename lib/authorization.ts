// ---------------------------------------------------------------------------
// SYNTHOS — reusable, server-side authorization helpers (Pass III / B3).
//
// Three separate questions, never conflated:
//   Authentication — WHO is this caller?          (requireAuth)
//   Authorization  — WHAT may this caller do?      (requirePlatformAdmin,
//                                                    requireWorkspaceAdmin)
//   Workspace isolation — WHICH tenant data may     (requireWorkspaceMember,
//                          this caller access?       still backed by the
//                                                     existing resolveWorkspaceId
//                                                     scoping, now gated by
//                                                     real membership)
//
// A client-supplied `workspaceId` (body/query/activeWorkspaceId) is NEVER
// treated as authorization proof here — it is only ever a *requested*
// workspace, checked against the authenticated caller's real,
// server-side membership row before anything is granted.
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from 'express';
import { resolveSessionUser, parseCookies, SESSION_COOKIE_NAME, UserRecord } from './auth';
import { hasWorkspaceAccess, MembershipRecord } from './workspaces';
import { resolveWorkspaceId } from './persistence';

export interface AuthedRequest extends Request {
  authUser?: UserRecord;
  authWorkspaceId?: string;
  authMembership?: MembershipRecord;
}

export function getRequestUser(req: Request): UserRecord | null {
  const cookies = parseCookies(req.headers.cookie);
  return resolveSessionUser(cookies[SESSION_COOKIE_NAME]);
}

function unauthorized(res: Response, message = 'Authentication required.') {
  return res.status(401).json({ success: false, error: message });
}

function forbidden(res: Response, message = 'Not authorized.') {
  return res.status(403).json({ success: false, error: message });
}

/** Authentication only — proves WHO the caller is, nothing about what they may do. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getRequestUser(req);
  if (!user) return unauthorized(res);
  (req as AuthedRequest).authUser = user;
  next();
}

/** Extracts a caller-requested workspace id from the usual places — never itself proof of access. */
export const fromBody = (req: Request) => (req.body as any)?.workspaceId;
export const fromQuery = (req: Request) => req.query?.workspaceId;
export const fromBodyOrQuery = (req: Request) => (req.body as any)?.workspaceId ?? req.query?.workspaceId;

/**
 * Requires a real, active membership row for the requested workspace.
 * Self-contained (re-resolves the session itself) so route wiring can't
 * silently skip authentication by forgetting to chain requireAuth first.
 */
export function requireWorkspaceMember(extractWorkspaceId: (req: Request) => unknown) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = getRequestUser(req);
    if (!user) return unauthorized(res);

    const resolved = resolveWorkspaceId(extractWorkspaceId(req));
    if ('error' in resolved) return res.status(400).json({ success: false, error: resolved.error });

    const membership = hasWorkspaceAccess(user.user_id, resolved.workspaceId);
    if (!membership) return forbidden(res, 'Not authorized for this workspace.');

    const authedReq = req as AuthedRequest;
    authedReq.authUser = user;
    authedReq.authWorkspaceId = resolved.workspaceId;
    authedReq.authMembership = membership;
    next();
  };
}

/** Same as requireWorkspaceMember, but the membership must carry the 'admin' workspace role. */
export function requireWorkspaceAdmin(extractWorkspaceId: (req: Request) => unknown) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = getRequestUser(req);
    if (!user) return unauthorized(res);

    const resolved = resolveWorkspaceId(extractWorkspaceId(req));
    if ('error' in resolved) return res.status(400).json({ success: false, error: resolved.error });

    const membership = hasWorkspaceAccess(user.user_id, resolved.workspaceId);
    if (!membership || membership.role !== 'admin') return forbidden(res, 'Workspace admin role required.');

    const authedReq = req as AuthedRequest;
    authedReq.authUser = user;
    authedReq.authWorkspaceId = resolved.workspaceId;
    authedReq.authMembership = membership;
    next();
  };
}

/**
 * Platform-level authority only — deliberately does NOT imply workspace
 * membership anywhere. A platform_admin who wants a specific workspace's
 * ordinary data still needs a real membership row like anyone else; this
 * guard exists only for the explicitly platform-scoped surface (Master
 * Admin, backup). See ADR-003 — no accidental cross-tenant bypass.
 */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  const user = getRequestUser(req);
  if (!user) return unauthorized(res);
  if (user.platform_role !== 'platform_admin') return forbidden(res, 'Platform administrator role required.');
  (req as AuthedRequest).authUser = user;
  next();
}

/**
 * CSRF defense-in-depth (E5) for cookie-authenticated, state-changing
 * requests. SameSite=Lax on the session cookie is the primary defense
 * (blocks the cookie on cross-site POST/PUT/PATCH/DELETE from another
 * origin in every modern browser); this adds an explicit Origin check as a
 * second, independent layer. A request with no Origin header (same-origin
 * navigations, most non-browser API clients) is allowed through — this is
 * a browser-CSRF mitigation, not a general API allowlist.
 */
export function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    const originHost = new URL(origin).host;
    if (originHost === req.headers.host) return next();
  } catch {
    // Malformed Origin header — fall through to rejection below.
  }
  return res.status(403).json({ success: false, error: 'Cross-origin request rejected.' });
}
