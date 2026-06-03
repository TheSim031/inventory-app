import {
  getSheets,
  readHistorySheet,
  resolveHistorySheetName,
  HISTORY_RANGE,
  type HistoryType,
} from '@/lib/googleSheets';
import { NextResponse, type NextRequest } from 'next/server';
import { sendLineNotification } from '@/lib/lineNotify';
import { sendUrgentZeroStockAlert } from '@/lib/limitStockNotify';
import { requireAuth, requireRoles } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    }));

    return NextResponse.json(entries.reverse()); // newest first
  } catch (error) {
    console.error('Google Sheets Error (GET /api/history):', error);
    return NextResponse.json([]);
  }
}

/**
 * Append a movement row to the history sheet. NEVER writes to the stock
 * sheet — Sheet 1 column D is a SUMIFS formula that recomputes itself
 * whenever a new row lands here.
 *
 * - type=IN  → warehouse received goods (must be WAREHOUSE role)
 * - type=OUT → user requested issue (WAREHOUSE / PURCHASING / ASSEMBLY)
 *
 * The OPEN type is reserved for the human-seeded opening balances in the
 * sheet and is not exposed through this endpoint.
 */
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

  const SHEET_HISTORY = await resolveHistorySheetName();
  if (!SHEET_HISTORY) {
    return NextResponse.json(
      { error: 'ไม่พบ tab ประวัติเข้า-ออก — ตรวจ env GOOGLE_SHEET_HISTORY' },
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

    // 9-column row matching Sheet 2 headers:
    //   A วันที่ | B ประเภท | C รหัส | D ชื่อ | E จำนวน |
    //   F ผู้บันทึก | G แผนก (OUT) | H วัตถุประสงค์ (OUT) | I PO/PX (IN)
    const historyValues = items.map((it) => [
      now,
      type,
      String(it.code).trim(),
      String(it.name).trim(),
      Math.floor(it.quantity),
      recorder.trim(),
      type === 'OUT' ? (department || '').trim() : '',
      type === 'OUT' ? (purpose || '').trim() : '',
      type === 'IN' ? (poRef || '').trim() : '',
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_HISTORY}!${HISTORY_RANGE}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: historyValues },
    });

    recordAudit(request, type === 'IN' ? 'IN_RECORDED' : 'OUT_RECORDED', {
      target: type === 'IN' ? (poRef || '').trim() : (department || '').trim(),
      detail: `${recorder.trim()} · ${items.length} รายการ`,
    });

    // lineUserId is read from the session cookie at notification time only —
    // it is no longer persisted in the sheet (the column was removed in V7).
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

    // Urgent low-stock check: any item touched by this movement that now
    // sits at 0 in Sheet 1 triggers an immediate PURCHASING alert. Runs for
    // both IN and OUT because IN could be a tiny topup that still leaves
    // the formula's net at 0. Don't await — never block the user response.
    sendUrgentZeroStockAlert(items.map((it) => it.code))
      .then((res) => {
        if (res && res.delivery && !res.delivery.ok) {
          console.error('Urgent zero-stock LINE dispatch failed:', res.delivery);
        }
      })
      .catch((err) => console.error('Urgent zero-stock check failed:', err));

    return NextResponse.json(
      { success: true, count: items.length, type },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Google Sheets Error (POST /api/history):', err);
    return NextResponse.json({ error: `เกิดข้อผิดพลาด: ${message}` }, { status: 500 });
  }
}
