import { NextResponse, type NextRequest } from 'next/server';
import { sendDailyLowStockSummary } from '@/lib/limitStockNotify';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

/**
 * Daily low-stock summary cron. vercel.json schedules this for
 * `0 2 * * *` (02:00 UTC = 09:00 ICT, every day).
 *
 * Auth model mirrors monthly-cleanup-notify: production requires
 * `Authorization: Bearer ${CRON_SECRET}`; local development is open unless
 * CRON_SECRET happens to be set.
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
    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await sendDailyLowStockSummary();
    if (!result) {
      return NextResponse.json(
        { notified: false, error: 'failed to read stock sheet' },
        { status: 500 },
      );
    }
    if (result.report.items.length === 0) {
      return NextResponse.json({ notified: false, lowStockCount: 0 });
    }
    if (!result.delivery?.ok) {
      console.error('Daily low-stock LINE dispatch failed:', result.delivery);
      return NextResponse.json(
        {
          notified: false,
          lowStockCount: result.report.items.length,
          error: 'line failed',
          delivery: result.delivery,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      notified: true,
      lowStockCount: result.report.items.length,
      zeroStockCount: result.report.zeroStock.length,
    });
  } catch (err) {
    console.error('Daily low-stock cron failed:', err);
    return NextResponse.json(
      { notified: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
