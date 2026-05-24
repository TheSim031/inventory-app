import { google, type sheets_v4 } from 'googleapis';

// Lazy-initialize the Sheets client so env vars are always read at request time
// (not at module load time, which can be before .env.local is processed)
function getSheetsClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || '';

  if (!clientEmail || !privateKey || !spreadsheetId) {
    return { sheets: null as sheets_v4.Sheets | null, spreadsheetId: '' };
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return {
    sheets: google.sheets({ version: 'v4', auth }),
    spreadsheetId,
  };
}

export function getSheets() {
  return getSheetsClient();
}

// Sheet tab names — override in .env.local if your tabs have different names
export function getSheetNames() {
  return {
    SHEET_ITEMS: process.env.GOOGLE_SHEET_ITEMS || 'สต็อกสินค้า',
    SHEET_HISTORY: process.env.GOOGLE_SHEET_HISTORY || 'บันทึกเข้า-ออก',
  };
}

/* ─── Items sheet helpers ─── */

export type SheetItemRow = {
  rowNumber: number; // 1-based sheet row (includes header)
  code: string;
  name: string;
  category: string;
  stock: number;
  status: string;
};

export type ItemsSheetSchema = {
  rows: SheetItemRow[];
  stockColLetter: string; // e.g. 'D' — used when writing stock updates back
};

function colIndexToLetter(idx: number): string {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function findHeaderIndex(headers: string[], candidates: string[]): number {
  const lowered = headers.map((h) => h.trim().toLowerCase());
  // exact match first
  for (let i = 0; i < lowered.length; i++) {
    if (candidates.some((c) => lowered[i] === c.toLowerCase())) return i;
  }
  // partial match (contains)
  for (let i = 0; i < lowered.length; i++) {
    if (candidates.some((c) => lowered[i].includes(c.toLowerCase()))) return i;
  }
  return -1;
}

/**
 * Read the items sheet with header-aware column mapping.
 * Falls back to positional A:E layout if no headers are detected.
 */
export async function readItemsSheet(): Promise<ItemsSheetSchema | null> {
  const { sheets, spreadsheetId } = getSheetsClient();
  const { SHEET_ITEMS } = getSheetNames();
  if (!sheets || !spreadsheetId) return null;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_ITEMS}!A:Z`,
  });

  const rawRows = response.data.values || [];
  if (rawRows.length === 0) {
    return { rows: [], stockColLetter: 'D' };
  }

  const headers = (rawRows[0] || []).map((h) => String(h ?? ''));

  const codeIdx = findHeaderIndex(headers, ['รหัสสินค้า', 'รหัส', 'code', 'item code', 'sku', 'id']);
  const nameIdx = findHeaderIndex(headers, ['ชื่อสินค้า', 'ชื่อ', 'name', 'item name', 'description']);
  const catIdx = findHeaderIndex(headers, ['ประเภท', 'หมวดหมู่', 'หมวด', 'category', 'type']);
  const stockIdx = findHeaderIndex(headers, [
    'คงเหลือ',
    'สต็อก',
    'สต๊อก',
    'จำนวนคงเหลือ',
    'จำนวน',
    'stock',
    'qty',
    'quantity',
  ]);
  const statusIdx = findHeaderIndex(headers, ['สถานะ', 'status', 'state']);

  // Fallbacks: positional A=0, B=1, C=2, D=3, E=4
  const cIdx = codeIdx >= 0 ? codeIdx : 0;
  const nIdx = nameIdx >= 0 ? nameIdx : 1;
  const ctIdx = catIdx >= 0 ? catIdx : 2;
  const sIdx = stockIdx >= 0 ? stockIdx : 3;
  const stIdx = statusIdx >= 0 ? statusIdx : 4;

  const parseStock = (v: unknown): number => {
    const s = String(v ?? '').replace(/[^\d.\-]/g, '');
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  };

  const items: SheetItemRow[] = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i] || [];
    const code = String(row[cIdx] ?? '').trim();
    if (!code) continue; // skip rows without a code
    items.push({
      rowNumber: i + 1,
      code,
      name: String(row[nIdx] ?? '').trim(),
      category: String(row[ctIdx] ?? '').trim(),
      stock: parseStock(row[sIdx]),
      status: String(row[stIdx] ?? '').trim(),
    });
  }

  return {
    rows: items,
    stockColLetter: colIndexToLetter(sIdx),
  };
}
