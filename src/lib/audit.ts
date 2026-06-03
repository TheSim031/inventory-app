/**
 * Thin wrapper over appendAuditLog that pulls the actor + role from the
 * request session, so route handlers can log "who did what" in one line.
 *
 * Best-effort and non-blocking: recordAudit returns immediately and the write
 * happens in the background — an audit failure must never break a user action.
 */
import type { NextRequest } from 'next/server';
import { getSessionContext } from './auth';
import { appendAuditLog } from './googleSheets';

export type AuditAction =
  | 'IN_RECORDED'
  | 'OUT_RECORDED'
  | 'REQ_SUBMITTED'
  | 'PICK_COMPLETE'
  | 'REQ_REJECTED'
  | 'THRESHOLD_UPDATE'
  | 'NOTIF_GROUP_UPDATE'
  | 'NOTIF_USER_UPDATE'
  | 'INSPECT_DELETE';

export function recordAudit(
  request: NextRequest,
  action: AuditAction,
  opts: { target?: string; detail?: string } = {},
): void {
  const ctx = getSessionContext(request);
  const actor =
    ctx.displayName ||
    (ctx.isCreator ? 'Creator' : ctx.isAdmin ? 'Staff/Admin' : 'ไม่ทราบ');
  const role =
    ctx.role || (ctx.isCreator ? 'CREATOR' : ctx.isAdmin ? 'ADMIN' : '');

  void appendAuditLog({
    actor,
    role,
    action,
    target: opts.target,
    detail: opts.detail,
  }).catch((err) => console.error('recordAudit failed:', err));
}
