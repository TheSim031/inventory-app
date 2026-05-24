import { getSheets, getSheetNames, readItemsSheet } from '@/lib/googleSheets';
import { NextResponse, type NextRequest } from 'next/server';
import { sendLineNotification } from '@/lib/lineNotify';

type Action = 'APPROVE' | 'REJECT';

type PatchBody = { action: Action };

const HISTORY_RANGE = 'A:K';
const STATUS_COL = 'K';

/**
 * Approve or reject a pending requisition.
 *
 * - APPROVE: validate aggregate stock across all rows of the requisition,
 *   deduct stock from the items sheet, then flip every matching history
 *   row to status=COMPLETED. Validation is done up-front so we never
 *   half-apply a deduction.
 * - REJECT: just mark every matching history row as REJECTED; stock
 *   is untouched.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { sheets, spreadsheetId } = getSheets();
  const { SHEET_ITEMS, SHEET_HISTORY } = getSheetNames();

  if (!sheets || !spreadsheetId) {
    return NextResponse.json({ error: 'Google Sheets API not configured' }, { status: 503 });
  }

  let body: Partial<PatchBody>;
  try {
    body = (await request.json()) as Partial<PatchBody>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'APPROVE' && action !== 'REJECT') {
    return NextResponse.json({ error: 'action ต้องเป็น APPROVE หรือ REJECT' }, { status: 400 });
  }

  try {
    const historyRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_HISTORY}!${HISTORY_RANGE}`,
    });
    const historyRows = historyRes.data.values || [];
    if (historyRows.length <= 1) {
      return NextResponse.json({ error: 'ไม่พบใบเบิก' }, { status: 404 });
    }

    type MatchedRow = {
      sheetRow: number; // 1-based
      code: string;
      name: string;
      quantity: number;
      status: string;
      recorder: string;
      department: string;
    };

    const matched: MatchedRow[] = [];
    for (let i = 1; i < historyRows.length; i++) {
      const row = historyRows[i] || [];
      const rowReqId = String(row[9] ?? '').trim();
      const rowType = row[1];
      if (rowType !== 'OUT' || rowReqId !== id) continue;
      matched.push({
        sheetRow: i + 1,
        code: String(row[2] ?? ''),
        name: String(row[3] ?? ''),
        quantity: parseInt(String(row[4] ?? '0'), 10) || 0,
        status: String(row[10] ?? '').trim().toUpperCase(),
        recorder: String(row[5] ?? ''),
        department: String(row[6] ?? ''),
      });
    }

    if (matched.length === 0) {
      return NextResponse.json({ error: `ไม่พบใบเบิก ${id}` }, { status: 404 });
    }

    const allPending = matched.every((r) => r.status === 'PENDING');
    if (!allPending) {
      return NextResponse.json(
        { error: 'ใบเบิกนี้ถูกประมวลผลไปแล้ว ไม่สามารถดำเนินการซ้ำได้' },
        { status: 409 },
      );
    }

    const recorder = matched[0].recorder;
    const department = matched[0].department;

    if (action === 'APPROVE') {
      const schema = await readItemsSheet();
      if (!schema) {
        return NextResponse.json({ error: 'อ่านตารางสต็อกไม่ได้' }, { status: 500 });
      }
      const stockIndex = new Map<string, { rowNumber: number; currentStock: number }>();
      for (const r of schema.rows) {
        stockIndex.set(r.code, { rowNumber: r.rowNumber, currentStock: r.stock });
      }

      // Validate aggregate quantities across all rows before mutating anything.
      const stockChanges = new Map<string, number>();
      for (const m of matched) {
        const entry = stockIndex.get(m.code);
        if (!entry) {
          const message = `ไม่พบรหัสสินค้า "${m.code}" (${m.name}) ในสต็อก`;
          sendLineNotification('OUT_OF_STOCK', { recorder, message }).catch(console.error);
          return NextResponse.json({ error: message }, { status: 400 });
        }
        const baseStock = stockChanges.get(m.code) ?? entry.currentStock;
        const newStock = baseStock - m.quantity;
        if (newStock < 0) {
          const message = `สินค้า "${m.name}" (${m.code}) มีไม่พอ (คงเหลือ ${baseStock} ต้องการ ${m.quantity})`;
          sendLineNotification('OUT_OF_STOCK', { recorder, message }).catch(console.error);
          return NextResponse.json({ error: message }, { status: 400 });
        }
        stockChanges.set(m.code, newStock);
      }

      // Apply stock deductions
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

      // Mark every matched history row as COMPLETED
      await Promise.all(
        matched.map((m) =>
          sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${SHEET_HISTORY}!${STATUS_COL}${m.sheetRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['COMPLETED']] },
          }),
        ),
      );

      sendLineNotification('OUT_RECORDED', {
        recorder,
        department,
        purpose: `อนุมัติใบเบิก ${id}`,
        itemsCount: matched.length,
      }).catch(console.error);

      return NextResponse.json({ success: true, action, itemsCount: matched.length });
    }

    // REJECT
    await Promise.all(
      matched.map((m) =>
        sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${SHEET_HISTORY}!${STATUS_COL}${m.sheetRow}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [['REJECTED']] },
        }),
      ),
    );

    return NextResponse.json({ success: true, action, itemsCount: matched.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error processing requisition:', message);
    return NextResponse.json({ error: `เกิดข้อผิดพลาด: ${message}` }, { status: 500 });
  }
}
