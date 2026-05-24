import { getSheets, getSheetNames } from '@/lib/googleSheets';
import { NextResponse } from 'next/server';

type RequisitionStatus = 'PENDING' | 'COMPLETED' | 'REJECTED';

export type RequisitionItem = {
  code: string;
  name: string;
  quantity: number;
};

export type Requisition = {
  id: string;
  date: string;
  recorder: string;
  department: string;
  purpose: string;
  status: RequisitionStatus;
  items: RequisitionItem[];
};

function normalizeStatus(raw: string): RequisitionStatus {
  const v = raw.trim().toUpperCase();
  if (v === 'PENDING' || v === 'COMPLETED' || v === 'REJECTED') return v;
  // Empty status on an OUT row = legacy entry that pre-dates the approval flow
  // — treat as already completed so it doesn't reappear in the pending queue.
  return 'COMPLETED';
}

/**
 * Return all OUT requisitions grouped by requisitionId, newest first.
 * Rows in the history sheet are flat (one row per item); we re-group them
 * back into a requisition shape for the warehouse approval UI.
 */
export async function GET() {
  const { sheets, spreadsheetId } = getSheets();
  const { SHEET_HISTORY } = getSheetNames();

  if (!sheets || !spreadsheetId) {
    return NextResponse.json([]);
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_HISTORY}!A:K`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return NextResponse.json([]);

    const groups = new Map<string, Requisition>();
    const order: string[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      if (row[1] !== 'OUT') continue;

      const id = String(row[9] ?? '').trim() || `legacy-${row[0] ?? i}`;
      const date = String(row[0] ?? '');
      const code = String(row[2] ?? '');
      const name = String(row[3] ?? '');
      const quantity = parseInt(String(row[4] ?? '0'), 10) || 0;
      const recorder = String(row[5] ?? '');
      const department = String(row[6] ?? '');
      const purpose = String(row[7] ?? '');
      const status = normalizeStatus(String(row[10] ?? ''));

      let group = groups.get(id);
      if (!group) {
        group = { id, date, recorder, department, purpose, status, items: [] };
        groups.set(id, group);
        order.push(id);
      }
      group.items.push({ code, name, quantity });
    }

    // Newest first (order is the natural sheet order; reverse it).
    const result = order.reverse().map((id) => groups.get(id)!);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching requisitions:', error);
    return NextResponse.json([]);
  }
}
