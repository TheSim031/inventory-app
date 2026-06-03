import { NextResponse, type NextRequest } from 'next/server';
import { readAuditLog } from '@/lib/googleSheets';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

function requireAdminOrCreator(request: NextRequest): boolean {
  const isCreator =
    request.cookies.get('creator_session')?.value === 'authenticated';
  const isAdmin = request.cookies.get('auth_session')?.value === 'authenticated';
  return isCreator || isAdmin;
}

/** Read the recent audit log for the admin viewer. */
export async function GET(request: NextRequest) {
  if (!requireAdminOrCreator(request)) {
    return NextResponse.json(
      { error: 'Admin or Creator session required' },
      { status: 403 },
    );
  }
  try {
    const rows = await readAuditLog(500);
    if (rows === null) {
      return NextResponse.json(
        { error: 'อ่านบันทึกการใช้งานไม่สำเร็จ' },
        { status: 500 },
      );
    }
    return NextResponse.json({ rows });
  } catch (err) {
    console.error('GET /api/admin/audit failed:', err);
    return NextResponse.json({ error: 'อ่านข้อมูลไม่สำเร็จ' }, { status: 500 });
  }
}
