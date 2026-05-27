import { NextResponse, type NextRequest } from 'next/server';
import { appendHistoryOutRows, readItemsSheet } from '@/lib/googleSheets';
import { sendUrgentZeroStockAlert } from '@/lib/limitStockNotify';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function requireAdminOrCreator(request: NextRequest): boolean {
  const isCreator =
    request.cookies.get('creator_session')?.value === 'authenticated';
  const isAdmin = request.cookies.get('auth_session')?.value === 'authenticated';
  return isCreator || isAdmin;
}

type Slip = {
  requester?: string;
  purpose?: string;
  items?: { code?: string; name?: string; quantity?: number }[];
};

type PostBody = { slips?: Slip[] };

/**
 * Admin-only silent withdrawal endpoint. Each slip appends OUT rows to the
 * history sheet WITHOUT firing a LINE notification — this is for testing
 * and ad-hoc internal use. Stock is still validated against Sheet 1.
 */
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

  const slips = Array.isArray(body.slips) ? body.slips : [];
  if (slips.length === 0) {
    return NextResponse.json(
      { error: 'ต้องมีใบเบิกอย่างน้อย 1 ใบ' },
      { status: 400 },
    );
  }

  // Validate every slip first so we don't partially apply.
  const sanitized: {
    requester: string;
    purpose: string;
    items: { code: string; name: string; quantity: number }[];
  }[] = [];
  for (let i = 0; i < slips.length; i++) {
    const slip = slips[i];
    const requester = String(slip.requester || '').trim();
    const purpose = String(slip.purpose || '').trim();
    const items = Array.isArray(slip.items) ? slip.items : [];
    if (!requester) {
      return NextResponse.json(
        { error: `ใบที่ ${i + 1}: ต้องระบุชื่อผู้เบิก` },
        { status: 400 },
      );
    }
    if (!purpose) {
      return NextResponse.json(
        { error: `ใบที่ ${i + 1}: ต้องระบุวัตถุประสงค์` },
        { status: 400 },
      );
    }
    if (items.length === 0) {
      return NextResponse.json(
        { error: `ใบที่ ${i + 1}: ต้องมีรายการสินค้าอย่างน้อย 1 รายการ` },
        { status: 400 },
      );
    }
    const cleanItems: { code: string; name: string; quantity: number }[] = [];
    for (const it of items) {
      const code = String(it.code || '').trim();
      const name = String(it.name || '').trim();
      const qty = Math.floor(Number(it.quantity) || 0);
      if (!code || !name || !Number.isFinite(qty) || qty <= 0) {
        return NextResponse.json(
          { error: `ใบที่ ${i + 1}: รายการไม่ถูกต้อง ${JSON.stringify(it)}` },
          { status: 400 },
        );
      }
      cleanItems.push({ code, name, quantity: qty });
    }
    sanitized.push({ requester, purpose, items: cleanItems });
  }

  // Aggregate stock requirements across all slips so we fail fast.
  const need = new Map<string, { name: string; qty: number }>();
  for (const slip of sanitized) {
    for (const it of slip.items) {
      const cur = need.get(it.code);
      need.set(it.code, {
        name: it.name,
        qty: (cur?.qty ?? 0) + it.quantity,
      });
    }
  }

  const schema = await readItemsSheet();
  if (!schema) {
    return NextResponse.json({ error: 'อ่านสต็อกไม่ได้' }, { status: 500 });
  }
  const stockByCode = new Map(schema.rows.map((r) => [r.code, r.stock]));
  for (const [code, { name, qty }] of need) {
    const stock = stockByCode.get(code);
    if (stock == null) {
      return NextResponse.json(
        { error: `ไม่พบรหัส "${code}" (${name}) ในสต็อก` },
        { status: 400 },
      );
    }
    if (stock < qty) {
      return NextResponse.json(
        {
          error: `"${name}" (${code}) คงเหลือ ${stock} ไม่พอ (รวมต้องการ ${qty})`,
        },
        { status: 400 },
      );
    }
  }

  // Append OUT rows for each slip. We use a department label that flags the
  // entry as an internal admin withdrawal.
  let totalRows = 0;
  for (const slip of sanitized) {
    const result = await appendHistoryOutRows({
      recorder: slip.requester,
      department: 'เบิกภายใน (Admin)',
      purpose: slip.purpose,
      items: slip.items,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: 'บันทึก OUT ไม่สำเร็จระหว่างทาง' },
        { status: 500 },
      );
    }
    totalRows += result.count;
  }

  // Urgent low-stock alert still fires (this protects purchasing whether the
  // OUT was admin-initiated or user-initiated). LINE notification to the
  // requester is intentionally skipped per spec.
  sendUrgentZeroStockAlert(Array.from(need.keys()))
    .then((res) => {
      if (res?.delivery && !res.delivery.ok) {
        console.error('Urgent zero-stock alert failed:', res.delivery);
      }
    })
    .catch((err) => console.error('Urgent zero-stock check failed:', err));

  return NextResponse.json(
    {
      success: true,
      slipCount: sanitized.length,
      totalRows,
    },
    { status: 201 },
  );
}
