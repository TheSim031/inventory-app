import {
  getSheets,
  getSheetNames,
  readItemsSheet,
  readHistorySheet,
  HISTORY_RANGE,
} from '@/lib/googleSheets';
import { NextResponse, type NextRequest } from 'next/server';
import { sendLineNotification } from '@/lib/lineNotify';

type HistoryType = 'IN' | 'OUT';
type HistoryStatus = 'PENDING' | 'COMPLETED' | 'REJECTED';

type HistoryItemInput = {
  code: string;
  name: string;
  quantity: number;
};

type HistoryPostBody = {
  type: HistoryType;
  recorder: string;
  department?: string;
  purpose?: string;
  poRef?: string;
  items: HistoryItemInput[];
};

export type HistoryEntry = {
  date: string;
  type: HistoryType;
  itemCode: string;
  itemName: string;
  quantity: number;
  recorder: string;
  department: string;
  purpose: string;
  poRef: string;
  requisitionId: string;
  status: HistoryStatus;
};

function normalizeStatus(raw: string): HistoryStatus {
  const v = raw.trim().toUpperCase();
  if (v === 'PENDING' || v === 'COMPLETED' || v === 'REJECTED') return v;
  // Legacy/blank rows: assume they were already completed under the previous
  // auto-deduct logic so they don't reappear in the pending queue.
  return 'COMPLETED';
}

export async function GET() {
  try {
    const rows = await readHistorySheet();
    if (!rows) return NextResponse.json([]);

    const entries: HistoryEntry[] = rows.map((r) => ({
      date: r.date,
      type: r.type,
      itemCode: r.code,
      itemName: r.name,
      quantity: r.quantity,
      recorder: r.recorder,
      department: r.department,
      purpose: r.purpose,
      poRef: r.poRef,
      requisitionId: r.requisitionId,
      status: normalizeStatus(r.status),
    }));

    return NextResponse.json(entries.reverse()); // newest first
  } catch (error) {
    console.error('Error fetching history from Google Sheets:', error);
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
  const { sheets, spreadsheetId } = getSheets();
  const { SHEET_ITEMS, SHEET_HISTORY } = getSheetNames();

  if (!sheets || !spreadsheetId) {
    return NextResponse.json({ error: 'Google Sheets API not configured' }, { status: 503 });
  }

  let body: Partial<HistoryPostBody>;
  try {
    body = (await request.json()) as Partial<HistoryPostBody>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { type, recorder, department, purpose, poRef, items } = body;

  if (type !== 'IN' && type !== 'OUT') {
    return NextResponse.json({ error: 'type ต้องเป็น IN หรือ OUT' }, { status: 400 });
  }
  if (!recorder || !recorder.trim()) {
    return NextResponse.json({ error: 'กรุณาระบุชื่อผู้บันทึก' }, { status: 400 });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'ต้องมีรายการอย่างน้อย 1 รายการ' }, { status: 400 });
  }
  if (type === 'OUT' && (!department?.trim() || !purpose?.trim())) {
    return NextResponse.json(
      { error: 'การเบิก (OUT) ต้องระบุแผนกและวัตถุประสงค์' },
      { status: 400 },
    );
  }
  if (type === 'IN' && !poRef?.trim()) {
    return NextResponse.json({ error: 'การรับเข้า (IN) ต้องระบุรหัส PO/PX' }, { status: 400 });
  }

  for (const it of items) {
    if (!it.code || !it.name || !Number.isFinite(it.quantity) || it.quantity <= 0) {
      return NextResponse.json(
        { error: `รายการไม่ถูกต้อง: ${JSON.stringify(it)}` },
        { status: 400 },
      );
    }
  }

  try {
    const now = new Date().toISOString();
    const requisitionId =
      type === 'OUT' ? `REQ-${Date.now()}` : `IN-${Date.now()}`;
    const status: HistoryStatus = type === 'IN' ? 'COMPLETED' : 'PENDING';

    // IN (Receive Goods) → validate items + add stock immediately.
    // OUT (requisition) → DO NOT touch stock; warehouse approval handles deduction.
    if (type === 'IN') {
      const schema = await readItemsSheet();
      if (!schema) {
        return NextResponse.json({ error: 'อ่านตารางสต็อกไม่ได้' }, { status: 500 });
      }
      const stockIndex = new Map<string, { rowNumber: number; currentStock: number }>();
      for (const r of schema.rows) {
        stockIndex.set(r.code, { rowNumber: r.rowNumber, currentStock: r.stock });
      }

      const stockChanges = new Map<string, number>();
      for (const it of items) {
        const entry = stockIndex.get(it.code);
        if (!entry) {
          const message = `ไม่พบรหัสสินค้า "${it.code}" (${it.name}) ในสต็อก`;
          sendLineNotification('OUT_OF_STOCK', { recorder, message }).catch(console.error);
          return NextResponse.json({ error: message }, { status: 400 });
        }
        const baseStock = stockChanges.get(it.code) ?? entry.currentStock;
        stockChanges.set(it.code, baseStock + it.quantity);
      }

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
    }

    // Append history rows. Columns:
    //   A วันที่ | B ประเภท | C รหัสรายการ | D ชื่อรายการ | E จำนวน |
    //   F ชื่อผู้บันทึก | G แผนก | H วัตถุประสงค์ | I รหัส PO/PX |
    //   J requisitionId | K status   (J, K are system columns)
    const historyValues = items.map((it) => [
      now,
      type,
      it.code,
      it.name,
      it.quantity,
      recorder.trim(),
      type === 'OUT' ? (department || '').trim() : '',
      type === 'OUT' ? (purpose || '').trim() : '',
      type === 'IN' ? (poRef || '').trim() : '',
      requisitionId,
      status,
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_HISTORY}!${HISTORY_RANGE}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: historyValues },
    });

    if (type === 'OUT') {
      sendLineNotification('OUT_RECORDED', {
        recorder: recorder.trim(),
        department: (department || '').trim(),
        purpose: (purpose || '').trim(),
        itemsCount: items.length,
      }).catch(console.error);
    } else {
      sendLineNotification('IN_RECORDED', {
        recorder: recorder.trim(),
        poRef: (poRef || '').trim(),
        itemsCount: items.length,
      }).catch(console.error);
    }

    return NextResponse.json(
      { success: true, count: items.length, requisitionId, status },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error recording history:', message);
    return NextResponse.json({ error: `เกิดข้อผิดพลาด: ${message}` }, { status: 500 });
  }
}
