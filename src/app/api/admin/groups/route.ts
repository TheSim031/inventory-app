import { NextResponse, type NextRequest } from 'next/server';
import {
  appendCustomGroup,
  readCustomGroupsSheet,
  type CustomGroupRow,
} from '@/lib/googleSheets';
import { isUserRole } from '@/lib/userRole';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function requireAdminOrCreator(request: NextRequest): boolean {
  const isCreator =
    request.cookies.get('creator_session')?.value === 'authenticated';
  const isAdmin = request.cookies.get('auth_session')?.value === 'authenticated';
  return isCreator || isAdmin;
}

/** Anyone signed in can read the list — used by /role-select on first login. */
function requireAnyAuth(request: NextRequest): boolean {
  if (requireAdminOrCreator(request)) return true;
  return !!request.cookies.get('line_user')?.value;
}

export async function GET(request: NextRequest) {
  if (!requireAnyAuth(request)) {
    return NextResponse.json({ error: 'Sign-in required' }, { status: 401 });
  }
  try {
    const rows = await readCustomGroupsSheet();
    if (rows === null) {
      return NextResponse.json({ error: 'อ่านกลุ่มไม่ได้' }, { status: 500 });
    }
    const groups = rows.map(
      ({ sheetRow: _sr, ...rest }: CustomGroupRow) => rest,
    );
    return NextResponse.json({ groups });
  } catch (err) {
    console.error('GET /api/admin/groups failed:', err);
    return NextResponse.json({ error: 'อ่านกลุ่มไม่ได้' }, { status: 500 });
  }
}

type PostBody = {
  name?: string;
  icon?: string;
  menuIds?: string[];
  baseRole?: string;
};

export async function POST(request: NextRequest) {
  if (!requireAdminOrCreator(request)) {
    return NextResponse.json(
      { error: 'Admin or Creator session required' },
      { status: 403 },
    );
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = (body.name || '').trim();
  const icon = (body.icon || '').trim() || '👥';
  const menuIds = Array.isArray(body.menuIds)
    ? body.menuIds.filter((s) => typeof s === 'string' && s.trim())
    : [];
  const baseRole = (body.baseRole || '').trim();

  if (!name) {
    return NextResponse.json({ error: 'กรุณาระบุชื่อกลุ่ม' }, { status: 400 });
  }
  if (menuIds.length === 0) {
    return NextResponse.json(
      { error: 'กรุณาเลือกเมนูที่กลุ่มนี้เข้าถึงได้อย่างน้อย 1 รายการ' },
      { status: 400 },
    );
  }
  if (baseRole && !isUserRole(baseRole)) {
    return NextResponse.json(
      { error: 'baseRole ไม่ถูกต้อง' },
      { status: 400 },
    );
  }

  // Slugify name → id. Falls back to a random suffix to prevent collisions.
  const idBase =
    name
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'group';
  const id = `CG_${idBase}_${Math.random().toString(36).slice(2, 6)}`;

  const ok = await appendCustomGroup({
    id,
    name,
    icon,
    menuIds,
    baseRole: baseRole || 'ASSEMBLY',
    createdBy: 'admin',
  });
  if (!ok) {
    return NextResponse.json({ error: 'สร้างกลุ่มไม่สำเร็จ' }, { status: 500 });
  }

  return NextResponse.json({ id, name, icon, menuIds, baseRole }, { status: 201 });
}
