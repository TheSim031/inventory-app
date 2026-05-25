import { NextResponse, type NextRequest } from 'next/server';
import { requireRoles } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * DEPRECATED — V7 architecture change (May 2026).
 *
 * The per-requisition approve/reject endpoint is gone. Stock writes are
 * forbidden (Sheet 1 col D is a formula now) and Sheet 2 lost its
 * status / requisitionId columns, so the previous CONFIRM_PICK / REJECT
 * actions can't be expressed against the new data model.
 *
 * Returns 410 Gone so any stale client UI gets a clear signal.
 */
export async function PATCH(request: NextRequest) {
  const denied = requireRoles(request, ['WAREHOUSE']);
  if (denied) return denied;

  return NextResponse.json(
    {
      deprecated: true,
      message:
        'ระบบอนุมัติใบเบิกถูกถอดออก — คำขอเบิก (OUT) จะถูกบันทึกลงประวัติทันทีที่ผู้ใช้กดส่ง',
    },
    { status: 410 },
  );
}
