import { NextResponse } from 'next/server';
import { ROLE_COOKIE } from '@/lib/userRole';

export const dynamic = 'force-dynamic';

/**
 * Explicit logout — the only way to clear the persistent LINE session.
 * Wipes the session, role, and any leftover OAuth-state crumbs so the
 * next visit starts a fresh login.
 */
export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete('line_user');
  // Clearing role on logout means the next sign-in always lands on
  // /role-select — same UX for everyone.
  response.cookies.delete(ROLE_COOKIE);
  // Best-effort cleanup of mid-flight OAuth crumbs in case logout
  // happens while a login round-trip is open in another tab.
  response.cookies.delete('line_oauth_state');
  response.cookies.delete('line_oauth_next');
  return response;
}
