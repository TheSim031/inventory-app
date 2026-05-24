import {
  getSheets,
  readItemsSheet,
  readHistorySheet,
  resolveItemsSheetName,
  resolveHistorySheetName,
  HISTORY_STATUS_COL,
} from '@/lib/googleSheets';
import { NextResponse, type NextRequest } from 'next/server';
import { sendLineNotification } from '@/lib/lineNotify';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Action = 'CONFIRM_PICK' | 'REJECT';
type ItemStatus = 'PICKED' | 'OUT_OF_STOCK';
type PatchBody = {
  action: Action;
  // Required for CONFIRM_PICK — same order as items returned by GET /api/requisitions
  itemStatuses?: ItemStatus[];
  // Required for REJECT — sent to the requester via LINE.
  reason?: string;
};

/**
 * Confirm pick (deduct stock) or reject a pending requisition.
 *
 * CONFIRM_PICK: body.itemStatuses is an array aligned 1:1 with the OUT history
 * rows for this requisition (in sheet order). For each row:
 *   - PICKED       → mark row COMPLETED, deduct quantity from stock
 *   - OUT_OF_STOCK → mark row REJECTED, no stock change
 * Aggregate stock validation runs up-front so a partial failure can't
 * half-apply a deduction.
 *
 * REJECT: mark every OUT row of this requisition REJECTED; stock untouched.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { sheets, spreadsheetId } = getSheets();

  if (!sheets || !spreadsheetId) {
    return NextResponse.json({ error: 'Google Sheets API not configured' }, { status: 503 });
  }

  const SHEET_ITEMS = await resolveItemsSheetName();
  const SHEET_HISTORY = await resolveHistorySheetName();
  if (!SHEET_ITEMS || !SHEET_HISTORY) {
    return NextResponse.json(
      { error: 'ไม่พบ tab ที่ตรงในสเปรดชีต — ตรวจ env GOOGLE_SHEET_ITEMS / GOOGLE_SHEET_HISTORY' },
      { status: 500 },
    );
  }

  let body: Partial<PatchBody>;
  try {
    body = (await request.json()) as Partial<PatchBody>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'CONFIRM_PICK' && action !== 'REJECT') {
    return NextResponse.json(
      { error: 'action ต้องเป็น CONFIRM_PICK หรือ REJECT' },
      { status: 400 },
    );
  }

  try {
    const historyRows = await readHistorySheet();
    if (!historyRows) {
      return NextResponse.json({ error: 'อ่านตารางประวัติไม่ได้' }, { status: 500 });
    }

    const matched = historyRows.filter(
      (r) => r.type === 'OUT' && r.requisitionId.trim() === id,
    );

    if (matched.length === 0) {
      return NextResponse.json({ error: `ไม่พบใบเบิก ${id}` }, { status: 404 });
    }

    const allPending = matched.every((r) => r.status.trim().toUpperCase() === 'PENDING');
    if (!allPending) {
      return NextResponse.json(
        { error: 'ใบเบิกนี้ถูกประมวลผลไปแล้ว ไม่สามารถดำเนินการซ้ำได้' },
        { status: 409 },
      );
    }

    const recorder = matched[0].recorder;
    const department = matched[0].department;
    const purpose = matched[0].purpose;

    if (action === 'CONFIRM_PICK') {
      const itemStatuses = body.itemStatuses;
      if (!Array.isArray(itemStatuses) || itemStatuses.length !== matched.length) {
        return NextResponse.json(
          { error: `จำนวน itemStatuses (${itemStatuses?.length ?? 0}) ต้องเท่ากับจำนวนรายการ (${matched.length})` },
          { status: 400 },
        );
      }
      for (const s of itemStatuses) {
        if (s !== 'PICKED' && s !== 'OUT_OF_STOCK') {
          return NextResponse.json(
            { error: `itemStatuses ต้องเป็น PICKED หรือ OUT_OF_STOCK เท่านั้น (พบ "${s}")` },
            { status: 400 },
          );
        }
      }

      const schema = await readItemsSheet();
      if (!schema) {
        return NextResponse.json({ error: 'อ่านตารางสต็อกไม่ได้' }, { status: 500 });
      }
      const stockIndex = new Map<string, { rowNumber: number; currentStock: number }>();
      for (const r of schema.rows) {
        stockIndex.set(r.code, { rowNumber: r.rowNumber, currentStock: r.stock });
      }

      const pickedItems: Array<{ name: string; quantity: number }> = [];
      const outOfStockItems: Array<{ name: string; quantity: number }> = [];

      // Validate stock for PICKED items aggregate before mutating anything.
      const stockChanges = new Map<string, number>();
      for (let i = 0; i < matched.length; i++) {
        const m = matched[i];
        if (itemStatuses[i] === 'OUT_OF_STOCK') {
          outOfStockItems.push({ name: m.name, quantity: m.quantity });
          continue;
        }
        const entry = stockIndex.get(m.code);
        if (!entry) {
          return NextResponse.json(
            { error: `ไม่พบรหัสสินค้า "${m.code}" (${m.name}) ในสต็อก` },
            { status: 400 },
          );
        }
        const baseStock = stockChanges.get(m.code) ?? entry.currentStock;
        const newStock = baseStock - m.quantity;
        if (newStock < 0) {
          return NextResponse.json(
            { error: `สินค้า "${m.name}" (${m.code}) มีไม่พอ (คงเหลือ ${baseStock} ต้องการ ${m.quantity}) — ทำเครื่องหมาย "พัสดุหมด" แทน` },
            { status: 400 },
          );
        }
        stockChanges.set(m.code, newStock);
        pickedItems.push({ name: m.name, quantity: m.quantity });
      }

      // Deduct stock for PICKED items.
      await Promise.all(
        Array.from(stockChanges.entries()).map(([code, newStock]) => {
          const rowNumber = stockIndex.get(code)!.rowNumber;
          return sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${SHEET_ITEMS}!${schema.stockColLetter}${rowNumber}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[newStock]] },
          });
        }),
      );

      // Mark each history row with its individual status.
      await Promise.all(
        matched.map((m, i) =>
          sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${SHEET_HISTORY}!${HISTORY_STATUS_COL}${m.sheetRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [[itemStatuses[i] === 'PICKED' ? 'COMPLETED' : 'REJECTED']],
            },
          }),
        ),
      );

      // Notify the requester directly via LINE if we captured their userId
      // when they submitted the requisition; otherwise broadcast to OA
      // followers as a fallback.
      const requesterLineUserId =
        matched.find((m) => m.lineUserId)?.lineUserId || undefined;

      sendLineNotification('PICK_COMPLETE', {
        recorder,
        requisitionId: id,
        pickedItems,
        outOfStockItems,
        recipientLineUserId: requesterLineUserId,
      }).catch(console.error);

      return NextResponse.json({
        success: true,
        action,
        pickedCount: pickedItems.length,
        outOfStockCount: outOfStockItems.length,
        recorder,
        department,
        purpose,
      });
    }

    // REJECT — mark every row REJECTED, no stock change. The reason
    // is required so the warehouse can never void a requisition silently;
    // it gets pushed to the requester via LINE.
    const reason = (body.reason || '').trim();
    if (!reason) {
      return NextResponse.json(
        { error: 'กรุณาระบุเหตุผลที่ยกเลิก' },
        { status: 400 },
      );
    }

    await Promise.all(
      matched.map((m) =>
        sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${SHEET_HISTORY}!${HISTORY_STATUS_COL}${m.sheetRow}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [['REJECTED']] },
        }),
      ),
    );

    // Notify the requester that their requisition was voided, with the
    // warehouse-supplied reason. Falls back to broadcast for legacy rows
    // without a stored lineUserId.
    const requesterLineUserIdForReject =
      matched.find((m) => m.lineUserId)?.lineUserId || undefined;

    sendLineNotification('REQUISITION_REJECTED', {
      recorder,
      requisitionId: id,
      reason,
      items: matched.map((m) => ({ name: m.name, quantity: m.quantity })),
      recipientLineUserId: requesterLineUserIdForReject,
    }).catch(console.error);

    return NextResponse.json({ success: true, action, itemsCount: matched.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Google Sheets Error (PATCH /api/requisitions/[id]):', err);
    return NextResponse.json({ error: `เกิดข้อผิดพลาด: ${message}` }, { status: 500 });
  }
}
