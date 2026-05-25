import { NextResponse, type NextRequest } from 'next/server';
import {
  appendHistoryOutRows,
  completeRequisitionRow,
  readItemsSheet,
  readRequisitionsSheet,
  rejectRequisitionRow,
  type RequisitionItem,
} from '@/lib/googleSheets';
import { sendLineNotification } from '@/lib/lineNotify';
import { sendUrgentZeroStockAlert } from '@/lib/limitStockNotify';
import { getSessionContext, requireRoles } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ItemPickStatus = 'PICKED' | 'OUT_OF_STOCK';

/** V7: Sheet 1 col D is a formula — OUT rows in history drive the deduction. */
async function validatePickedStock(items: RequisitionItem[]): Promise<string | null> {
  if (items.length === 0) return null;
  const schema = await readItemsSheet();
  if (!schema) return 'อ่านตารางสต็อกไม่ได้';
  const stockByCode = new Map(schema.rows.map((r) => [r.code, r.stock]));
  const needByCode = new Map<string, { name: string; qty: number }>();
  for (const it of items) {
    const cur = needByCode.get(it.code);
    needByCode.set(it.code, {
      name: it.name,
      qty: (cur?.qty ?? 0) + it.quantity,
    });
  }
  for (const [code, { name, qty }] of needByCode) {
    const stock = stockByCode.get(code);
    if (stock == null) {
      return `ไม่พบรหัส "${code}" (${name}) ในสต็อก`;
    }
    if (stock < qty) {
      return `"${name}" (${code}) คงเหลือ ${stock} ไม่พอ (ต้องการ ${qty}) — ทำเครื่องหมาย "พัสดุหมด" แทน`;
    }
  }
  return null;
}

type PatchBody = {
  action?: 'CONFIRM' | 'CONFIRM_PICK' | 'REJECT';
  picker?: string;
  reason?: string;
  itemStatuses?: ItemPickStatus[];
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = requireRoles(request, ['WAREHOUSE']);
  if (denied) return denied;

  const { id } = await context.params;
  const rows = await readRequisitionsSheet();
  if (!rows) {
    return NextResponse.json({ error: 'ไม่สามารถอ่านข้อมูลได้' }, { status: 500 });
  }
  const row = rows.find((r) => r.id === id);
  if (!row) {
    return NextResponse.json({ error: 'ไม่พบใบเบิก' }, { status: 404 });
  }
  const { sheetRow: _sr, ...rest } = row;
  return NextResponse.json(rest);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = requireRoles(request, ['WAREHOUSE']);
  if (denied) return denied;

  const { id } = await context.params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = body.action;
  const isConfirm =
    action === 'CONFIRM' || action === 'CONFIRM_PICK';
  if (!isConfirm && action !== 'REJECT') {
    return NextResponse.json(
      { error: 'action ต้องเป็น CONFIRM, CONFIRM_PICK หรือ REJECT' },
      { status: 400 },
    );
  }

  const rows = await readRequisitionsSheet();
  if (!rows) {
    return NextResponse.json({ error: 'ไม่สามารถอ่านข้อมูลได้' }, { status: 500 });
  }
  const target = rows.find((r) => r.id === id);
  if (!target) {
    return NextResponse.json({ error: 'ไม่พบใบเบิก' }, { status: 404 });
  }
  if (target.status !== 'PENDING') {
    return NextResponse.json(
      { error: 'ใบเบิกนี้ถูกดำเนินการแล้ว' },
      { status: 409 },
    );
  }

  const session = getSessionContext(request);
  const picker =
    (body.picker || '').trim() ||
    session.displayName ||
    (session.isAdmin ? 'ผู้ดูแลระบบ' : 'คลังสินค้า');

  if (action === 'REJECT') {
    const reason = (body.reason || '').trim();
    if (!reason) {
      return NextResponse.json({ error: 'กรุณาระบุเหตุผลในการยกเลิก' }, { status: 400 });
    }
    const result = await rejectRequisitionRow({ id, picker });
    if (result === 'NOT_FOUND') {
      return NextResponse.json({ error: 'ไม่พบใบเบิก' }, { status: 404 });
    }
    if (result === 'ALREADY_HANDLED') {
      return NextResponse.json({ error: 'ใบเบิกนี้ถูกดำเนินการแล้ว' }, { status: 409 });
    }
    if (result !== 'UPDATED') {
      return NextResponse.json({ error: 'ปฏิเสธใบเบิกไม่สำเร็จ' }, { status: 500 });
    }

    sendLineNotification('REQ_REJECTED', {
      id,
      requester: target.requester,
      department: target.department,
      reason,
      recipientLineUserId: target.lineUserId || undefined,
    })
      .then((d) => {
        if (!d.ok) console.error('LINE delivery failed (REQ_REJECTED):', d);
      })
      .catch(console.error);

    return NextResponse.json({ id, status: 'REJECTED' });
  }

  let itemsToIssue = target.items;
  let outOfStockItems: RequisitionItem[] = [];

  if (action === 'CONFIRM_PICK') {
    const statuses = Array.isArray(body.itemStatuses) ? body.itemStatuses : [];
    if (statuses.length !== target.items.length) {
      return NextResponse.json(
        { error: 'itemStatuses ต้องมีจำนวนเท่ากับรายการในใบเบิก' },
        { status: 400 },
      );
    }
    for (const s of statuses) {
      if (s !== 'PICKED' && s !== 'OUT_OF_STOCK') {
        return NextResponse.json(
          { error: 'itemStatuses ต้องเป็น PICKED หรือ OUT_OF_STOCK' },
          { status: 400 },
        );
      }
    }
    itemsToIssue = target.items.filter((_, i) => statuses[i] === 'PICKED');
    outOfStockItems = target.items.filter((_, i) => statuses[i] === 'OUT_OF_STOCK');

    const stockErr = await validatePickedStock(itemsToIssue);
    if (stockErr) {
      return NextResponse.json({ error: stockErr }, { status: 400 });
    }
  }

  const claimResult = await completeRequisitionRow({ id, picker });
  if (claimResult === 'NOT_FOUND') {
    return NextResponse.json({ error: 'ไม่พบใบเบิก' }, { status: 404 });
  }
  if (claimResult === 'ALREADY_HANDLED') {
    return NextResponse.json({ error: 'ใบเบิกนี้ถูกดำเนินการแล้ว' }, { status: 409 });
  }
  if (claimResult !== 'UPDATED') {
    return NextResponse.json({ error: 'ยืนยันจัดของไม่สำเร็จ' }, { status: 500 });
  }

  let history = { ok: true, count: 0 };
  if (itemsToIssue.length > 0) {
    history = await appendHistoryOutRows({
      recorder: target.requester,
      department: target.department,
      purpose: target.purpose,
      items: itemsToIssue,
    });
    if (!history.ok) {
      return NextResponse.json(
        {
          error:
            'อัปเดตสถานะแล้ว แต่บันทึกประวัติเบิกออกไม่สำเร็จ — ตรวจสอบ Sheet ประวัติ',
        },
        { status: 500 },
      );
    }
  }

  sendLineNotification('PICK_COMPLETE', {
    id,
    requester: target.requester,
    department: target.department,
    purpose: target.purpose,
    itemsCount: itemsToIssue.length,
    items: itemsToIssue,
    outOfStockItems,
    recipientLineUserId: target.lineUserId || undefined,
  })
    .then((d) => {
      if (!d.ok) console.error('LINE delivery failed (PICK_COMPLETE):', d);
    })
    .catch(console.error);

  sendUrgentZeroStockAlert(itemsToIssue.map((it) => it.code))
    .then((res) => {
      if (res?.delivery && !res.delivery.ok) {
        console.error('Urgent zero-stock LINE dispatch failed:', res.delivery);
      }
    })
    .catch((err) => console.error('Urgent zero-stock check failed:', err));

  return NextResponse.json({ id, status: 'COMPLETED', historyCount: history.count });
}
