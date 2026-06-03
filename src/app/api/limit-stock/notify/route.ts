import { NextResponse, type NextRequest } from 'next/server';
import { sendDailyLowStockSummary } from '@/lib/limitStockNotify';
import { requireRoles } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

export type LimitStockNotifyResponse = {
  notified: boolean;
  allClear: boolean;
  lowStockCount: number;
  zeroStockCount: number;
  message: string;
  error?: string;
  detail?: string;
};

/**
 * Manual "ตรวจสอบและแจ้งเตือนทันที" trigger from the Limit Stock page.
 * Runs the same scan as the 09:00 cron and fires LINE to PURCHASING right
 * away, so admins don't have to wait for the scheduled run after editing.
 */
export async function POST(request: NextRequest) {
  const denied = requireRoles(request, ['WAREHOUSE', 'PURCHASING']);
  if (denied) return denied;

  try {
    // announceAllClear: even when nothing is low, send a "stock normal" LINE
    // message so the operator always gets confirmation (never an empty send).
    const result = await sendDailyLowStockSummary({ announceAllClear: true });
    if (!result) {
      return NextResponse.json(
        { error: 'อ่านสต็อกสินค้าไม่สำเร็จ' },
        { status: 500 },
      );
    }

    const { report, delivery } = result;
    const lowStockCount = report.items.length;
    const zeroStockCount = report.zeroStock.length;
    const allClear = lowStockCount === 0;

    if (!delivery?.ok) {
      console.error('Instant low-stock LINE dispatch failed:', delivery);
      const failed: LimitStockNotifyResponse = {
        notified: false,
        allClear,
        lowStockCount,
        zeroStockCount,
        message: 'ส่งข้อความเข้า LINE ไม่สำเร็จ',
        error: 'ส่งข้อความเข้า LINE ไม่สำเร็จ',
        detail: delivery?.errors.join(' | ') || undefined,
      };
      return NextResponse.json(failed, { status: 502 });
    }

    const ok: LimitStockNotifyResponse = {
      notified: true,
      allClear,
      lowStockCount,
      zeroStockCount,
      message: allClear
        ? 'ตรวจสอบและส่งการแจ้งเตือนเรียบร้อยแล้ว — สินค้าทุกรายการอยู่ในเกณฑ์ปกติ'
        : `ตรวจสอบและส่งการแจ้งเตือนเรียบร้อยแล้ว — แจ้งเตือน ${lowStockCount} รายการต่ำกว่าเกณฑ์` +
          (zeroStockCount ? ` (หมดคลัง ${zeroStockCount})` : ''),
    };
    return NextResponse.json(ok);
  } catch (err) {
    console.error('POST /api/limit-stock/notify failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'เกิดข้อผิดพลาด' },
      { status: 500 },
    );
  }
}
