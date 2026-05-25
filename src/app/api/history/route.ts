import {
  getSheets,
  readItemsSheet,
  readHistorySheet,
  resolveItemsSheetName,
  resolveHistorySheetName,
  HISTORY_RANGE,
  compareAndSetStockCells,
  type StockCellChange,
} from '@/lib/googleSheets';
import { NextResponse, type NextRequest } from 'next/server';
import { sendLineNotification } from '@/lib/lineNotify';
import { requireAuth, requireRoles } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
  // Filled automatically from LINE session cookie when present — do not
  // trust client-supplied values here, the server overrides from cookie.
  lineUserId?: string;
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

export async function GET(request: NextRequest) {
  const denied = requireAuth(request);
  if (denied) return denied;

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
    console.error('Google Sheets Error (GET /api/history):', error);
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
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

  const denied =
    type === 'IN'
      ? requireRoles(request, ['WAREHOUSE'])
      : requireRoles(request, ['WAREHOUSE', 'PURCHASING', 'ASSEMBLY']);
  if (denied) return denied;

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

      const stockChanges = new Map<
        string,
        StockCellChange & { currentBaseStock: number }
      >();
      for (const it of items) {
        const entry = stockIndex.get(it.code);
        if (!entry) {
          const message = `ไม่พบรหัสสินค้า "${it.code}" (${it.name}) ในสต็อก`;
          sendLineNotification('OUT_OF_STOCK', { recorder, message })
            .then((delivery) => {
              if (!delivery.ok) console.error('LINE delivery failed (OUT_OF_STOCK):', delivery);
            })
            .catch(console.error);
          return NextResponse.json({ error: message }, { status: 400 });
        }
        const existing = stockChanges.get(it.code);
        const baseStock = existing?.currentBaseStock ?? entry.currentStock;
        stockChanges.set(it.code, {
          code: it.code,
          name: it.name,
          rowNumber: entry.rowNumber,
          expectedStock: entry.currentStock,
          currentBaseStock: baseStock + it.quantity,
          nextStock: baseStock + it.quantity,
        });
      }

      const stockResult = await compareAndSetStockCells({
        sheetName: SHEET_ITEMS,
        stockColLetter: schema.stockColLetter,
        changes: Array.from(stockChanges.values()).map((change) => ({
          code: change.code,
          name: change.name,
          rowNumber: change.rowNumber,
          expectedStock: change.expectedStock,
          nextStock: change.nextStock,
        })),
      });
      if (!stockResult.ok) {
        return NextResponse.json({ error: stockResult.error }, { status: stockResult.status });
      }
    }

    // Read lineUserId from the LINE session cookie (server-trusted) so the
    // requester can be push-notified later when their pick is done.
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

    // Append history rows. Columns:
    //   A วันที่ | B ประเภท | C รหัสรายการ | D ชื่อรายการ | E จำนวน |
    //   F ชื่อผู้บันทึก | G แผนก | H วัตถุประสงค์ | I รหัส PO/PX |
    //   J requisitionId | K status | L lineUserId   (J/K/L are system cols)
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
      lineUserId,
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
        items: items.map((it) => ({
          name: it.name,
          quantity: it.quantity,
          code: it.code,
        })),
        recipientLineUserId: lineUserId || undefined,
      })
        .then((delivery) => {
          if (!delivery.ok) console.error('LINE delivery failed (OUT_RECORDED):', delivery);
        })
        .catch(console.error);
    } else {
      sendLineNotification('IN_RECORDED', {
        recorder: recorder.trim(),
        poRef: (poRef || '').trim(),
        itemsCount: items.length,
      })
        .then((delivery) => {
          if (!delivery.ok) console.error('LINE delivery failed (IN_RECORDED):', delivery);
        })
        .catch(console.error);
    }

    return NextResponse.json(
      { success: true, count: items.length, requisitionId, status },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Google Sheets Error (POST /api/history):', err);
    return NextResponse.json({ error: `เกิดข้อผิดพลาด: ${message}` }, { status: 500 });
  }
}
