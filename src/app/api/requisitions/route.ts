import { NextResponse, type NextRequest } from 'next/server';
import {
  appendRequisitionRow,
  readRequisitionsSheet,
  type RequisitionItem,
} from '@/lib/googleSheets';
import { sendLineNotification } from '@/lib/lineNotify';
import { requireRoles } from '@/lib/auth';
import { isoForPickedDate } from '@/lib/dateTime';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type CreateBody = {
  requester?: string;
  department?: string;
  purpose?: string;
  items?: RequisitionItem[];
  /** YYYY-MM-DD picked by the user on the request form. */
  requestedDate?: string;
};

export async function GET(request: NextRequest) {
  const denied = requireRoles(request, ['WAREHOUSE']);
  if (denied) return denied;

  try {
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get('status');
    const rows = await readRequisitionsSheet();
    if (!rows) return NextResponse.json([]);
    const filtered =
      statusFilter === 'PENDING' ||
      statusFilter === 'COMPLETED' ||
      statusFilter === 'REJECTED'
        ? rows.filter((r) => r.status === statusFilter)
        : rows;
    return NextResponse.json(
      filtered.map(({ sheetRow: _sr, ...rest }) => rest).reverse(),
    );
  } catch (error) {
    console.error('Google Sheets Error (GET /api/requisitions):', error);
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
  const denied = requireRoles(request, ['WAREHOUSE', 'PURCHASING', 'ASSEMBLY']);
  if (denied) return denied;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const requester = (body.requester || '').trim();
  const department = (body.department || '').trim();
  const purpose = (body.purpose || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];

  if (!requester) {
    return NextResponse.json({ error: 'กรุณาระบุชื่อผู้ขอเบิก' }, { status: 400 });
  }
  if (!department) {
    return NextResponse.json({ error: 'กรุณาระบุแผนก' }, { status: 400 });
  }
  if (!purpose) {
    return NextResponse.json({ error: 'กรุณาระบุวัตถุประสงค์' }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: 'ต้องมีรายการอย่างน้อย 1 รายการ' }, { status: 400 });
  }
  for (const it of items) {
    if (!it.code || !it.name || !Number.isFinite(it.quantity) || it.quantity <= 0) {
      return NextResponse.json(
        { error: `รายการไม่ถูกต้อง: ${JSON.stringify(it)}` },
        { status: 400 },
      );
    }
  }

  const sanitizedItems = items.map((it) => ({
    code: String(it.code).trim(),
    name: String(it.name).trim(),
    quantity: Math.floor(it.quantity),
  }));

  const lineUserId = (() => {
    const raw = request.cookies.get('line_user')?.value;
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw) as { userId?: string };
      return (parsed.userId || '').trim();
    } catch {
      return '';
    }
  })();

  const id = `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const requestedAt = isoForPickedDate(body.requestedDate);
  const ok = await appendRequisitionRow({
    id,
    requestedAt,
    requester,
    department,
    purpose,
    items: sanitizedItems,
    lineUserId,
  });

  if (!ok) {
    return NextResponse.json({ error: 'บันทึกคำขอเบิกไม่สำเร็จ' }, { status: 500 });
  }

  sendLineNotification('REQ_SUBMITTED', {
    id,
    requester,
    department,
    purpose,
    itemsCount: sanitizedItems.length,
    items: sanitizedItems,
  })
    .then((delivery) => {
      if (!delivery.ok) console.error('LINE delivery failed (REQ_SUBMITTED):', delivery);
    })
    .catch(console.error);

  return NextResponse.json({ id, status: 'PENDING' }, { status: 201 });
}
