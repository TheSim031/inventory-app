import { NextResponse, type NextRequest } from 'next/server';
import {
  appendHistoryOutRows,
  completeRequisitionRow,
  readRequisitionsSheet,
  rejectRequisitionRow,
} from '@/lib/googleSheets';
import { sendLineNotification } from '@/lib/lineNotify';
import { sendUrgentZeroStockAlert } from '@/lib/limitStockNotify';
import { getSessionContext, requireRoles } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PatchBody = {
  action?: 'CONFIRM' | 'REJECT';
  picker?: string;
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
  if (action !== 'CONFIRM' && action !== 'REJECT') {
    return NextResponse.json(
      { error: 'action ต้องเป็น CONFIRM หรือ REJECT' },
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
      recipientLineUserId: target.lineUserId || undefined,
    })
      .then((d) => {
        if (!d.ok) console.error('LINE delivery failed (REQ_REJECTED):', d);
      })
      .catch(console.error);

    return NextResponse.json({ id, status: 'REJECTED' });
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

  const history = await appendHistoryOutRows({
    recorder: target.requester,
    department: target.department,
    purpose: target.purpose,
    items: target.items,
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

  sendLineNotification('PICK_COMPLETE', {
    id,
    requester: target.requester,
    department: target.department,
    purpose: target.purpose,
    itemsCount: target.items.length,
    items: target.items,
    recipientLineUserId: target.lineUserId || undefined,
  })
    .then((d) => {
      if (!d.ok) console.error('LINE delivery failed (PICK_COMPLETE):', d);
    })
    .catch(console.error);

  sendUrgentZeroStockAlert(target.items.map((it) => it.code))
    .then((res) => {
      if (res?.delivery && !res.delivery.ok) {
        console.error('Urgent zero-stock LINE dispatch failed:', res.delivery);
      }
    })
    .catch((err) => console.error('Urgent zero-stock check failed:', err));

  return NextResponse.json({ id, status: 'COMPLETED', historyCount: history.count });
}
