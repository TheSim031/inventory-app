import { NextResponse, type NextRequest } from 'next/server';
import {
  readHistorySheet,
  readItemsSheet,
  readLimitStockSheet,
  readRequisitionsSheet,
  readInspectionsSheet,
  LIMIT_STOCK_DEFAULT_THRESHOLD,
} from '@/lib/googleSheets';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

export type MovementBucket = {
  inCount: number;
  outCount: number;
  inQty: number;
  outQty: number;
};
export type TopItem = { code: string; name: string; qty: number };
export type RecentMovement = {
  date: string;
  type: string;
  code: string;
  name: string;
  quantity: number;
  recorder: string;
};

export type DashboardResponse = {
  stock: { total: number; low: number; zero: number; off: number };
  pending: { requisitions: number; inspections: number };
  movement: { last7: MovementBucket; last30: MovementBucket };
  topOut: TopItem[];
  recent: RecentMovement[];
  generatedAt: string;
};

const emptyBucket = (): MovementBucket => ({
  inCount: 0,
  outCount: 0,
  inQty: 0,
  outQty: 0,
});

/**
 * Server-side aggregation for the /dashboard screen. Reads the raw sheets and
 * returns only summary numbers, so dashboard-only roles (e.g. EXECUTIVE) get
 * the overview without direct access to the full stock / limit-stock list.
 */
export async function GET(request: NextRequest) {
  const denied = requireAuth(request);
  if (denied) return denied;

  try {
    const [history, items, thresholds, requisitions, inspections] =
      await Promise.all([
        readHistorySheet(),
        readItemsSheet(),
        readLimitStockSheet(),
        readRequisitionsSheet(),
        readInspectionsSheet(),
      ]);

    // ── Stock health ──
    const thresholdByCode = new Map(
      (thresholds ?? []).map((t) => [t.code, t.threshold]),
    );
    let total = 0;
    let low = 0;
    let zero = 0;
    let off = 0;
    for (const r of items?.rows ?? []) {
      total += 1;
      const threshold = thresholdByCode.get(r.code) ?? LIMIT_STOCK_DEFAULT_THRESHOLD;
      if (threshold <= 0) off += 1;
      else if (r.stock <= 0) zero += 1;
      else if (r.stock <= threshold) low += 1;
    }

    // ── Movement buckets (last 7 / 30 days) + top OUT items ──
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const last7 = emptyBucket();
    const last30 = emptyBucket();
    const outQtyByCode = new Map<string, { name: string; qty: number }>();

    for (const h of history ?? []) {
      if (h.type !== 'IN' && h.type !== 'OUT') continue; // skip OPEN balances
      const t = Date.parse(h.date);
      if (Number.isNaN(t)) continue;
      const age = now - t;
      const within30 = age <= 30 * DAY;
      const within7 = age <= 7 * DAY;
      if (!within30) continue;

      const apply = (b: MovementBucket) => {
        if (h.type === 'IN') {
          b.inCount += 1;
          b.inQty += h.quantity;
        } else {
          b.outCount += 1;
          b.outQty += h.quantity;
        }
      };
      apply(last30);
      if (within7) apply(last7);

      if (h.type === 'OUT') {
        const cur = outQtyByCode.get(h.code) ?? { name: h.name, qty: 0 };
        cur.qty += h.quantity;
        cur.name = cur.name || h.name;
        outQtyByCode.set(h.code, cur);
      }
    }

    const topOut: TopItem[] = Array.from(outQtyByCode.entries())
      .map(([code, v]) => ({ code, name: v.name, qty: v.qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    // ── Recent activity (last 10 movements, newest first) ──
    const movements = (history ?? []).filter(
      (h) => h.type === 'IN' || h.type === 'OUT',
    );
    const recent: RecentMovement[] = movements
      .slice(-10)
      .reverse()
      .map((h) => ({
        date: h.date,
        type: h.type,
        code: h.code,
        name: h.name,
        quantity: h.quantity,
        recorder: h.recorder,
      }));

    // ── Pending queues ──
    const pendingRequisitions = (requisitions ?? []).filter(
      (r) => r.status === 'PENDING',
    ).length;
    const pendingInspections = (inspections ?? []).filter(
      (r) => r.status === 'PENDING',
    ).length;

    const body: DashboardResponse = {
      stock: { total, low, zero, off },
      pending: {
        requisitions: pendingRequisitions,
        inspections: pendingInspections,
      },
      movement: { last7, last30 },
      topOut,
      recent,
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error('GET /api/dashboard failed:', err);
    return NextResponse.json(
      { error: 'สรุปข้อมูลแดชบอร์ดไม่สำเร็จ' },
      { status: 500 },
    );
  }
}
