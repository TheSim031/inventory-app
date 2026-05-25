import { NextResponse, type NextRequest } from 'next/server';
import {
  readUsersSheet,
  updateUserRole,
  updateUserCustomMenus,
} from '@/lib/googleSheets';
import { isUserRole } from '@/lib/userRole';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function requireCreator(request: NextRequest): boolean {
  return request.cookies.get('creator_session')?.value === 'authenticated';
}

/**
 * List every user who has logged in. Creator-only.
 */
export async function GET(request: NextRequest) {
  if (!requireCreator(request)) {
    return NextResponse.json({ error: 'Creator session required' }, { status: 403 });
  }
  try {
    const rows = await readUsersSheet();
    if (rows === null) {
      return NextResponse.json({ error: 'อ่านตารางผู้ใช้งานไม่ได้' }, { status: 500 });
    }
    return NextResponse.json({ users: rows });
  } catch (err) {
    console.error('Google Sheets Error (GET /api/admin/users):', err);
    return NextResponse.json({ error: 'อ่านตารางผู้ใช้งานไม่ได้' }, { status: 500 });
  }
}

type PatchBody = {
  lineUserId?: string;
  role?: string;
  customMenus?: string[];
};

/**
 * Update a user's role and/or custom-menu override. Creator-only.
 */
export async function PATCH(request: NextRequest) {
  if (!requireCreator(request)) {
    return NextResponse.json({ error: 'Creator session required' }, { status: 403 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { lineUserId, role, customMenus } = body;
  if (!lineUserId || typeof lineUserId !== 'string') {
    return NextResponse.json({ error: 'lineUserId required' }, { status: 400 });
  }

  // Role: allow empty string to clear, otherwise must be a valid role.
  if (role !== undefined && role !== '' && !isUserRole(role)) {
    return NextResponse.json({ error: `Invalid role "${role}"` }, { status: 400 });
  }
  if (
    customMenus !== undefined &&
    (!Array.isArray(customMenus) || customMenus.some((x) => typeof x !== 'string'))
  ) {
    return NextResponse.json(
      { error: 'customMenus must be string[]' },
      { status: 400 },
    );
  }

  try {
    if (role !== undefined) {
      await updateUserRole(lineUserId, role);
    }
    if (customMenus !== undefined) {
      const ok = await updateUserCustomMenus(lineUserId, customMenus);
      if (!ok) {
        return NextResponse.json(
          { error: 'อัปเดต customMenus ไม่สำเร็จ' },
          { status: 500 },
        );
      }
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Google Sheets Error (PATCH /api/admin/users):', err);
    return NextResponse.json({ error: 'อัปเดตข้อมูลผู้ใช้ไม่สำเร็จ' }, { status: 500 });
  }
}
