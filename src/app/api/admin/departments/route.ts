import { NextResponse, type NextRequest } from 'next/server';
import {
  appendDepartment,
  readDepartmentsSheet,
  updateDepartment,
} from '@/lib/googleSheets';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function requireAdminOrCreator(request: NextRequest): boolean {
  const isCreator =
    request.cookies.get('creator_session')?.value === 'authenticated';
  const isAdmin = request.cookies.get('auth_session')?.value === 'authenticated';
  return isCreator || isAdmin;
}

/** Any signed-in user can read the list — /request needs it on first paint. */
function requireAnyAuth(request: NextRequest): boolean {
  if (requireAdminOrCreator(request)) return true;
  return !!request.cookies.get('line_user')?.value;
}

export async function GET(request: NextRequest) {
  if (!requireAnyAuth(request)) {
    return NextResponse.json({ error: 'Sign-in required' }, { status: 401 });
  }
  try {
    const rows = await readDepartmentsSheet();
    if (rows === null) {
      return NextResponse.json({ error: 'อ่านแผนกไม่ได้' }, { status: 500 });
    }
    return NextResponse.json({
      departments: rows.map((r) => ({ sheetRow: r.sheetRow, name: r.name })),
    });
  } catch (err) {
    console.error('GET /api/admin/departments failed:', err);
    return NextResponse.json({ error: 'อ่านแผนกไม่ได้' }, { status: 500 });
  }
}

type PostBody = { name?: string };

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
  if (!name) {
    return NextResponse.json({ error: 'กรุณาระบุชื่อแผนก' }, { status: 400 });
  }
  const existing = await readDepartmentsSheet();
  if (existing?.some((d) => d.name === name)) {
    return NextResponse.json({ error: 'มีชื่อแผนกนี้อยู่แล้ว' }, { status: 409 });
  }
  const ok = await appendDepartment(name);
  if (!ok) {
    return NextResponse.json({ error: 'เพิ่มแผนกไม่สำเร็จ' }, { status: 500 });
  }
  return NextResponse.json({ name }, { status: 201 });
}

type PatchBody = { sheetRow?: number; name?: string };

export async function PATCH(request: NextRequest) {
  if (!requireAdminOrCreator(request)) {
    return NextResponse.json(
      { error: 'Admin or Creator session required' },
      { status: 403 },
    );
  }
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const sheetRow = Number(body.sheetRow);
  const name = (body.name || '').trim();
  if (!Number.isFinite(sheetRow) || sheetRow < 3) {
    return NextResponse.json({ error: 'sheetRow ไม่ถูกต้อง' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: 'กรุณาระบุชื่อแผนก' }, { status: 400 });
  }
  const ok = await updateDepartment(sheetRow, name);
  if (!ok) {
    return NextResponse.json({ error: 'แก้ไขแผนกไม่สำเร็จ' }, { status: 500 });
  }
  return NextResponse.json({ sheetRow, name });
}
