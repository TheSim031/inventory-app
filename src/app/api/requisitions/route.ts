import { NextResponse, type NextRequest } from 'next/server';
import { requireRoles } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * DEPRECATED — V7 architecture change (May 2026).
 *
 * The per-row approval flow (PENDING → COMPLETED/REJECTED) was removed
 * when Sheet 2 was reshaped to 9 columns (A–I). The internal cols J/K/L
 * (requisitionId / status / lineUserId) no longer exist, so we can't
 * group rows by requisition or track status anymore.
 *
 * /request now writes an OUT row directly to Sheet 2; the formula in
 * Sheet 1 col D recomputes the running balance immediately. There is
 * no separate "warehouse approval" step.
 *
 * This route is kept as a 410 Gone so any client still polling it gets
 * a clear signal rather than confusing data.
 */
export async function GET(request: NextRequest) {
  const denied = requireRoles(request, ['WAREHOUSE']);
  if (denied) return denied;

  return NextResponse.json(
    {
      deprecated: true,
      message:
        'ระบบอนุมัติใบเบิกถูกถอดออก — คำขอเบิก (OUT) จะถูกบันทึกลงประวัติทันที',
    },
    { status: 410 },
  );
}
