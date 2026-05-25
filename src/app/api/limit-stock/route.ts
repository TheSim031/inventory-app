import { NextResponse, type NextRequest } from 'next/server';
import {
  readItemsSheet,
  readLimitStockSheet,
  upsertLimitStockThresholds,
  LIMIT_STOCK_DEFAULT_THRESHOLD,
  type ThresholdUpdate,
} from '@/lib/googleSheets';
import { getSessionContext, requireRoles } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export type LimitStockItem = {
  code: string;
  name: string;
  category: string;
  stock: number;
  status: string;
  threshold: number;
  /** True when threshold was customised (a row exists in the config tab). */
  custom: boolean;
  updatedAt: string;
  updatedBy: string;
};

export type LimitStockGetResponse = {
  defaultThreshold: number;
  items: LimitStockItem[];
};

export async function GET(request: NextRequest) {
  const denied = requireRoles(request, ['WAREHOUSE', 'PURCHASING']);
  if (denied) return denied;

  try {
    const [schema, thresholds] = await Promise.all([
      readItemsSheet(),
      readLimitStockSheet(),
    ]);
    if (!schema) {
      return NextResponse.json(
        { error: 'อ่านสต็อกสินค้าไม่สำเร็จ' },
        { status: 500 },
      );
    }
    const byCode = new Map((thresholds ?? []).map((t) => [t.code, t]));
    const items: LimitStockItem[] = schema.rows.map((r) => {
      const cfg = byCode.get(r.code);
      return {
        code: r.code,
        name: r.name,
        category: r.category,
        stock: r.stock,
        status: r.status,
        threshold: cfg ? cfg.threshold : LIMIT_STOCK_DEFAULT_THRESHOLD,
        custom: !!cfg,
        updatedAt: cfg?.updatedAt ?? '',
        updatedBy: cfg?.updatedBy ?? '',
      };
    });
    const body: LimitStockGetResponse = {
      defaultThreshold: LIMIT_STOCK_DEFAULT_THRESHOLD,
      items,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error('GET /api/limit-stock failed:', error);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด' }, { status: 500 });
  }
}

type PutBody = { updates?: ThresholdUpdate[] };

export async function PUT(request: NextRequest) {
  const denied = requireRoles(request, ['WAREHOUSE', 'PURCHASING']);
  if (denied) return denied;

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates = Array.isArray(body.updates) ? body.updates : [];
  if (updates.length === 0) {
    return NextResponse.json({ error: 'ไม่มีรายการที่ต้องอัปเดต' }, { status: 400 });
  }
  for (const u of updates) {
    if (!u.code || typeof u.code !== 'string') {
      return NextResponse.json({ error: 'updates.code ต้องเป็น string' }, { status: 400 });
    }
    if (!Number.isFinite(u.threshold) || u.threshold < 0) {
      return NextResponse.json(
        { error: `เกณฑ์ของ ${u.code} ต้องเป็นจำนวนเต็ม >= 0` },
        { status: 400 },
      );
    }
  }

  const ctx = getSessionContext(request);
  const author = ctx.displayName || (ctx.isCreator ? 'creator' : 'unknown');

  const result = await upsertLimitStockThresholds({ updates, updatedBy: author });
  if (!result) {
    return NextResponse.json(
      { error: 'บันทึกเกณฑ์ไม่สำเร็จ — ตรวจการเชื่อมต่อ Google Sheets' },
      { status: 503 },
    );
  }
  return NextResponse.json({ success: true, ...result });
}
