import { NextResponse, type NextRequest } from 'next/server';
import { decodeLineSession, getLineLoginConfig } from '@/lib/lineAuth';
import { isUserRole, ROLE_COOKIE, type UserRole } from '@/lib/userRole';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Return the currently signed-in user's session + role choice + the LINE
 * config flags the client needs to render the login screen.
 *
 * Both sign-in mechanisms are surfaced:
 *   - LINE Login (line_user cookie)
 *   - Admin username/password (auth_session cookie)
 * Either one (or both) being present means the user is authenticated.
 */
export function GET(request: NextRequest) {
  const lineUser = decodeLineSession(request.cookies.get('line_user')?.value);
  const adminAuth = request.cookies.get('auth_session')?.value === 'authenticated';
  const cfg = getLineLoginConfig(request);

  const rawRole = request.cookies.get(ROLE_COOKIE)?.value;
  const role: UserRole | null = isUserRole(rawRole) ? rawRole : null;

  return NextResponse.json({
    user: lineUser,
    adminAuth,
    isAuthenticated: !!lineUser || adminAuth,
    role,
    lineLoginEnabled: !!cfg,
    oaBasicId: cfg?.oaBasicId || '',
  });
}
