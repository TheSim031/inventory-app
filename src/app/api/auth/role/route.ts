import { NextResponse, type NextRequest } from 'next/server';
import { isUserRole, ROLE_COOKIE, ROLE_HOME } from '@/lib/userRole';
import { decodeLineSession } from '@/lib/lineAuth';
import { updateUserRole } from '@/lib/googleSheets';

export const dynamic = 'force-dynamic';

/**
 * Set the current session's user role. Caller must be authenticated (either
 * admin or LINE Login) — otherwise we refuse so an unauthenticated visitor
 * can't drop a role cookie and pretend to be a warehouse user.
 */
export async function POST(request: NextRequest) {
  // Require some form of session
  const hasAdmin = request.cookies.get('auth_session')?.value === 'authenticated';
  const hasLineUser = !!request.cookies.get('line_user')?.value;
  if (!hasAdmin && !hasLineUser) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { role?: string };
  try {
    body = (await request.json()) as { role?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const role = body.role;
  if (!isUserRole(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  // If the user signed in via LINE, mirror their role choice into the
  // Users sheet so the admin panel can show / edit it later.
  const lineUser = decodeLineSession(request.cookies.get('line_user')?.value);
  if (lineUser?.userId) {
    updateUserRole(lineUser.userId, role).catch((err) =>
      console.error('updateUserRole failed:', err),
    );
  }

  const response = NextResponse.json({ success: true, role, home: ROLE_HOME[role] });
  response.cookies.set(ROLE_COOKIE, role, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(ROLE_COOKIE);
  return response;
}
