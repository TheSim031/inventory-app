import { NextResponse, type NextRequest } from 'next/server';
import { readInspectionsSheet } from '@/lib/googleSheets';
import { sendLineToRoles } from '@/lib/lineNotify';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

/**
 * Vercel-cron entry for the monthly cleanup reminder. vercel.json schedules
 * this for `0 2 1 * *` (1st of every month at 02:00 UTC = 09:00 ICT).
 *
 * Behavior:
 *   - In production, requires `Authorization: Bearer ${CRON_SECRET}` — set
 *     CRON_SECRET in the Vercel project env so random callers can't drain
 *     LINE quota by spamming this endpoint.
 *   - Locally (NODE_ENV !== 'production'), skips the auth check so devs can
 *     curl the route to verify the wiring end-to-end.
 *   - If there are no COMPLETED inspections to clean, returns 200 without
 *     sending a LINE message — saves quota and avoids "0 รายการ" noise.
 */
export async function GET(request: NextRequest) {
  const isProd = process.env.NODE_ENV === 'production';
  const secret = process.env.CRON_SECRET;

  if (isProd) {
    if (!secret) {
      return NextResponse.json(
        { error: 'CRON_SECRET not configured in production' },
        { status: 503 },
      );
    }
    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  } else if (secret) {
    // Honour the secret in dev too when it's been set, so test calls match
    // the real flow.
    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  let rows: Awaited<ReturnType<typeof readInspectionsSheet>> = null;
  try {
    rows = await readInspectionsSheet();
  } catch (err) {
    console.error('Cron readInspectionsSheet failed:', err);
  }
  const completed = (rows ?? []).filter((r) => r.status === 'COMPLETED');

  if (completed.length === 0) {
    return NextResponse.json({ notified: false, pendingCount: 0 });
  }

  const text =
    `🗓 วันที่ 1 ของเดือนแล้ว — ถึงเวลาลบประวัติตรวจสอบ\n\n` +
    `มีประวัติตรวจสอบทั้งหมด ${completed.length} รายการ ที่สามารถลบเพื่อรักษาพื้นที่จัดเก็บข้อมูล\n\n` +
    `👉 เข้าเมนู "ประวัติตรวจสอบ" เพื่อเลือกรายการที่จะลบ`;

  try {
    const delivery = await sendLineToRoles(['WAREHOUSE'], text);
    if (!delivery.ok) {
      console.error('Cron LINE dispatch failed:', delivery);
      return NextResponse.json(
        { notified: false, error: 'line failed', delivery },
        { status: 502 },
      );
    }
  } catch (err) {
    console.error('Cron LINE dispatch failed:', err);
    return NextResponse.json(
      { notified: false, error: 'line failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({ notified: true, pendingCount: completed.length });
}
