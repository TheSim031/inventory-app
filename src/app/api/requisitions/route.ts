import { readHistorySheet } from '@/lib/googleSheets';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
  department?: string;
  purpose?: string;
  poPx?: string;
  status: RequisitionStatus;
  items: RequisitionItem[];
};

function normalizeStatus(raw: string): RequisitionStatus {
  const v = raw.trim().toUpperCase();
  if (v === 'PENDING' || v === 'COMPLETED' || v === 'REJECTED') return v;
  // Empty status on an OUT row = legacy entry pre-dating the approval flow;
  // treat as already completed so it doesn't reappear in the pending queue.
  return 'COMPLETED';
}

/**
 * Group OUT history rows by requisitionId, newest first.
 * Rows are stored flat in the history sheet (one row per item); we re-group
 * them back into a requisition shape for the warehouse approval UI.
 */
export async function GET() {
  try {
    const rows = await readHistorySheet();
    if (!rows) return NextResponse.json([]);

    const groups = new Map<string, Requisition>();
    const order: string[] = [];

    for (const r of rows) {
      if (r.type !== 'OUT') continue;
      const id = r.requisitionId.trim() || `legacy-${r.date || r.sheetRow}`;
      let group = groups.get(id);
      if (!group) {
        group = {
          id,
          date: r.date,
          recorder: r.recorder,
          department: r.department.trim() || undefined,
          purpose: r.purpose.trim() || undefined,
          poPx: r.poRef.trim() || undefined,
          status: normalizeStatus(r.status),
          items: [],
        };
        groups.set(id, group);
        order.push(id);
      }
      group.items.push({ code: r.code, name: r.name, quantity: r.quantity });
    }

    const result = order.reverse().map((id) => groups.get(id)!);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Google Sheets Error (GET /api/requisitions):', error);
    return NextResponse.json([]);
  }
}
