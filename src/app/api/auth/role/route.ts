import { NextResponse, type NextRequest } from 'next/server';
import { isUserRole, ROLE_COOKIE, ROLE_HOME, type UserRole } from '@/lib/userRole';
import { decodeLineSession } from '@/lib/lineAuth';
import {
  findUserRow,
  readCustomGroupsSheet,
  updateUserCustomMenus,
  updateUserRole,
} from '@/lib/googleSheets';

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

  let body: { role?: string; customGroupId?: string };
  try {
    body = (await request.json()) as { role?: string; customGroupId?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let role: UserRole;
  let customGroupMenus: string[] | null = null;
  let customGroupId: string | null = null;

  if (body.customGroupId) {
    // Custom group path — resolve the group to a baseRole + menuIds, then
    // store both. The menuIds are written to the user's customMenus column
    // so MainNav + HomeMenu render only the ticked items.
    const groups = await readCustomGroupsSheet();
    if (!groups) {
      return NextResponse.json({ error: 'อ่านกลุ่มไม่ได้' }, { status: 500 });
    }
    const group = groups.find((g) => g.id === body.customGroupId);
    if (!group) {
      return NextResponse.json({ error: 'ไม่พบกลุ่มที่เลือก' }, { status: 404 });
    }
    if (!isUserRole(group.baseRole)) {
      return NextResponse.json(
        { error: `กลุ่มนี้มี baseRole ที่ไม่ถูกต้อง: ${group.baseRole}` },
        { status: 500 },
      );
    }
    role = group.baseRole;
    customGroupMenus = group.menuIds;
    customGroupId = group.id;
  } else {
    if (!isUserRole(body.role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    role = body.role;
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
    if (customGroupMenus) {
      updateUserCustomMenus(lineUser.userId, customGroupMenus).catch((err) =>
        console.error('updateUserCustomMenus (custom group) failed:', err),
      );
    }
  }

  const response = NextResponse.json({
    success: true,
    role,
    home: ROLE_HOME[role],
    customGroupId,
  });
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
