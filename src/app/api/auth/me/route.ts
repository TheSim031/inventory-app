import { NextResponse, type NextRequest } from 'next/server';
import { decodeLineSession, getLineLoginConfig } from '@/lib/lineAuth';
import { isUserRole, ROLE_COOKIE, type UserRole } from '@/lib/userRole';
import { findUserRow } from '@/lib/googleSheets';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Returns the currently signed-in user's session state. Used by the
 * client-side MainNav + role pages to decide which menus to render.
 *
 * Three forms of authentication coexist:
 *   - LINE Login (line_user cookie)
 *   - Admin/staff username+password (auth_session cookie) — legacy
 *   - Creator/super-admin (creator_session cookie) — secret button
 */
export async function GET(request: NextRequest) {
  const lineUser = decodeLineSession(request.cookies.get('line_user')?.value);
  const adminAuth = request.cookies.get('auth_session')?.value === 'authenticated';
  const isCreator =
    request.cookies.get('creator_session')?.value === 'authenticated';
  const cfg = getLineLoginConfig(request);

  const rawRole = request.cookies.get(ROLE_COOKIE)?.value;
  const role: UserRole | null = isUserRole(rawRole) ? rawRole : null;

  // Look up per-user custom menu overrides from the Users sheet. Falls
  // back to null if the sheet isn't reachable — MainNav then uses the
  // role-default visibility, which is the right behavior.
  let customMenus: string[] | null = null;
  if (lineUser?.userId) {
    try {
      const row = await findUserRow(lineUser.userId);
      if (row && row.customMenus.length > 0) {
        customMenus = row.customMenus;
      }
    } catch (err) {
      console.error('findUserRow failed in /api/auth/me:', err);
    }
  }

  return NextResponse.json({
    user: lineUser,
    adminAuth,
    isCreator,
    isAuthenticated: !!lineUser || adminAuth || isCreator,
    role,
    customMenus,
    lineLoginEnabled: !!cfg,
    oaBasicId: cfg?.oaBasicId || '',
  });
}
