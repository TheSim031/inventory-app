import { NextResponse, type NextRequest } from 'next/server';
import { isUserRole, ROLE_COOKIE, ROLE_HOME } from '@/lib/userRole';
import { decodeLineSession } from '@/lib/lineAuth';
import { findUserRow, updateUserRole } from '@/lib/googleSheets';

export const dynamic = 'force-dynamic';

/**
 * Set the current session's user role.
 *
 * Authorization rules (mirrors the spec — users cannot change their own
 * group once it's bound):
 *
 *   - Caller must be signed in (admin / LINE Login / creator).
 *   - Creator session can set any role for the current session (super-admin
 *     bypass — used when impersonating during support).
 *   - For a regular LINE user, the role is bound permanently to the LINE
 *     userId on first selection. A subsequent self-POST with a *different*
 *     role is rejected with 403. The only way to change a bound group is
 *     through the admin panel (/api/admin/users PATCH).
 *
 * The role cookie is httpOnly and server-trusted; clients can't forge it.
 */
export async function POST(request: NextRequest) {
  const hasAdmin = request.cookies.get('auth_session')?.value === 'authenticated';
  const isCreator =
    request.cookies.get('creator_session')?.value === 'authenticated';
  const lineUser = decodeLineSession(request.cookies.get('line_user')?.value);
  const hasLineUser = !!lineUser;

  if (!hasAdmin && !hasLineUser && !isCreator) {
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

  // Enforce one-time binding for regular LINE users. Creators are exempt.
  if (lineUser?.userId && !isCreator) {
    try {
      const row = await findUserRow(lineUser.userId);
      if (row && row.role && isUserRole(row.role) && row.role !== role) {
        return NextResponse.json(
          {
            error:
              'ไม่สามารถเปลี่ยนกลุ่มได้ด้วยตัวเอง — กรุณาติดต่อผู้ดูแลระบบ',
          },
          { status: 403 },
        );
      }
    } catch (err) {
      console.error('findUserRow on POST /api/auth/role failed:', err);
      // Fall through — if Sheets is unreachable we let the user proceed so
      // they aren't locked out indefinitely.
    }
  }

  // Mirror the role choice into the Users sheet so it survives logout /
  // cookie wipe / device switch. Fire and forget — cookie is still set.
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
