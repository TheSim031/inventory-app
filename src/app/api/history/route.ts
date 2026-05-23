import { getSheets, getSheetNames } from '@/lib/googleSheets';
import { NextResponse, type NextRequest } from 'next/server';
import { sendLineNotification } from '@/lib/lineNotify';

type HistoryType = 'IN' | 'OUT';

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
};

export async function GET() {
  const { sheets, spreadsheetId } = getSheets();
  const { SHEET_HISTORY } = getSheetNames();

  if (!sheets || !spreadsheetId) {
    return NextResponse.json([]);
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_HISTORY}!A:I`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return NextResponse.json([]);

    const entries: HistoryEntry[] = rows.slice(1).map((row) => ({
      date: row[0] || '',
      type: (row[1] === 'IN' ? 'IN' : 'OUT') as HistoryType,
      itemCode: row[2] || '',
      itemName: row[3] || '',
      quantity: parseInt(row[4] || '0', 10),
      recorder: row[5] || '',
      department: row[6] || '',
      purpose: row[7] || '',
      poRef: row[8] || '',
    }));

    // newest first
    return NextResponse.json(entries.reverse());
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

  // Validation
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
      { status: 400 }
    );
  }
  if (type === 'IN' && !poRef?.trim()) {
    return NextResponse.json({ error: 'การรับเข้า (IN) ต้องระบุรหัส PO/PX' }, { status: 400 });
  }

  for (const it of items) {
    if (!it.code || !it.name || !Number.isFinite(it.quantity) || it.quantity <= 0) {
      return NextResponse.json(
        { error: `รายการไม่ถูกต้อง: ${JSON.stringify(it)}` },
        { status: 400 }
      );
    }
  }

  try {
    // 1) อ่าน stock sheet เพื่อหา row index + ตรวจ stock
    const itemsRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_ITEMS}!A:E`,
    });
    const itemsRows = itemsRes.data.values || [];

    // index by code → { rowNumber (1-based for sheet), currentStock }
    const stockIndex = new Map<string, { rowNumber: number; currentStock: number }>();
    for (let i = 1; i < itemsRows.length; i++) {
      const code = itemsRows[i][0];
      if (code) {
        const stock = parseInt(itemsRows[i][3] || '0', 10);
        stockIndex.set(code, { rowNumber: i + 1, currentStock: stock });
      }
    }

    // 2) Validate ทั้ง batch ก่อน mutate (ลด partial-write risk)
    const stockChanges = new Map<string, number>(); // code → new stock
    for (const it of items) {
      const entry = stockIndex.get(it.code);
      if (!entry) {
        const message = `ไม่พบรหัสสินค้า "${it.code}" (${it.name}) ในสต็อก`;
        sendLineNotification('OUT_OF_STOCK', { recorder, message }).catch(console.error);
        return NextResponse.json({ error: message }, { status: 400 });
      }
      // ใช้ค่าจาก stockChanges ถ้ารายการเดียวกันถูกอ้างซ้ำใน batch
      const baseStock = stockChanges.get(it.code) ?? entry.currentStock;
      const newStock = type === 'OUT' ? baseStock - it.quantity : baseStock + it.quantity;
      if (type === 'OUT' && newStock < 0) {
        const message = `สินค้า "${it.name}" (${it.code}) มีไม่พอ (คงเหลือ ${baseStock} ต้องการ ${it.quantity})`;
        sendLineNotification('OUT_OF_STOCK', { recorder, message }).catch(console.error);
        return NextResponse.json({ error: message }, { status: 400 });
      }
      stockChanges.set(it.code, newStock);
    }

    // 3) Update stock cells (col D)
    await Promise.all(
      Array.from(stockChanges.entries()).map(([code, newStock]) => {
        const rowNumber = stockIndex.get(code)!.rowNumber;
        return sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${SHEET_ITEMS}!D${rowNumber}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[newStock]] },
        });
      })
    );

    // 4) Append history rows
    const now = new Date().toISOString();
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
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_HISTORY}!A:I`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: historyValues },
    });

    // 5) LINE notification (fire & forget)
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

    return NextResponse.json({ success: true, count: items.length }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error recording history:', message);
    return NextResponse.json(
      { error: `เกิดข้อผิดพลาด: ${message}` },
      { status: 500 }
    );
  }
}
