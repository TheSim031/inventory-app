import { google, type sheets_v4 } from 'googleapis';

// Shared scopes: spreadsheets (read/write Sheets) + drive.file (manage only
// files this app creates — required for inspection image uploads).
const GOOGLE_AUTH_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

export function getGoogleAuth(): InstanceType<typeof google.auth.GoogleAuth> | null {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) return null;
  return new google.auth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: GOOGLE_AUTH_SCOPES,
  });
}

// Lazy-initialize the Sheets client so env vars are always read at request time
// (not at module load time, which can be before .env.local is processed)
function getSheetsClient() {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || '';
  const auth = getGoogleAuth();
  if (!auth || !spreadsheetId) {
    return { sheets: null as sheets_v4.Sheets | null, spreadsheetId: '' };
  }
  return { sheets: google.sheets({ version: 'v4', auth }), spreadsheetId };
}

export function getSheets() {
  return getSheetsClient();
}

// Sheet tab names — override in .env.local if your tabs have different names
export function getSheetNames() {
  return {
    SHEET_ITEMS: process.env.GOOGLE_SHEET_ITEMS || 'สต็อกสินค้า',
    SHEET_HISTORY: process.env.GOOGLE_SHEET_HISTORY || 'ประวัติเข้า-ออก',
  };
}

// Fallback tab names to try when the configured GOOGLE_SHEET_* env var points
// to a tab that doesn't exist. Lets the app self-heal when env config drifts.
const FALLBACK_ITEMS_TABS = ['สต็อกสินค้า', 'Items', 'Stock', 'Inventory'];
const FALLBACK_HISTORY_TABS = ['ประวัติเข้า-ออก', 'บันทึกเข้า-ออก', 'History'];
const USERS_SHEET_NAME = 'ผู้ใช้งาน';
const FALLBACK_USERS_TABS = ['ผู้ใช้งาน', 'Users', 'LineUsers'];

// Cached list of actual sheet tabs in the spreadsheet — persists across warm
// Lambda invocations on Vercel. A cold start (or redeploy) refreshes it.
let actualTabsCache: string[] | null = null;

async function getActualSheetTabs(): Promise<string[] | null> {
  if (actualTabsCache) return actualTabsCache;
  const { sheets, spreadsheetId } = getSheetsClient();
  if (!sheets || !spreadsheetId) return null;
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title',
    });
    actualTabsCache = (meta.data.sheets || [])
      .map((s) => s.properties?.title || '')
      .filter(Boolean);
    return actualTabsCache;
  } catch (error) {
    console.error('Google Sheets Error (getActualSheetTabs):', error);
    return null;
  }
}

/**
 * Resolve a configured tab name to one that actually exists in the spreadsheet.
 * If the configured name exists, use it. Otherwise try the fallback list.
 * Returns null only if none match. Errors out on a noisy log so deployments
 * with misconfigured env vars are visible in Vercel logs.
 */
async function resolveSheetTab(
  configured: string,
  fallbacks: string[],
): Promise<string | null> {
  const tabs = await getActualSheetTabs();
  // If we can't enumerate (auth issue), fall through to optimistic use of the
  // configured name — the actual values.get call will produce a clearer error.
  if (!tabs) return configured;
  if (tabs.includes(configured)) return configured;
  for (const f of fallbacks) {
    if (tabs.includes(f)) {
      console.warn(
        `Sheet tab "${configured}" not found; using existing "${f}" instead. ` +
          `Update GOOGLE_SHEET_* env var to silence this warning.`,
      );
      return f;
    }
  }
  console.error(
    `Google Sheets Error: no matching sheet tab for "${configured}". ` +
      `Available tabs: ${tabs.join(', ')}`,
  );
  return null;
}

export async function resolveItemsSheetName(): Promise<string | null> {
  return resolveSheetTab(getSheetNames().SHEET_ITEMS, FALLBACK_ITEMS_TABS);
}

export async function resolveHistorySheetName(): Promise<string | null> {
  return resolveSheetTab(getSheetNames().SHEET_HISTORY, FALLBACK_HISTORY_TABS);
}

/**
 * Lazily ensure the "ผู้ใช้งาน" (Users) tab exists. If missing, create it
 * with a header row and return its name. This keeps the user-tracking
 * feature zero-setup — admins don't have to manually add a tab.
 */
async function ensureUsersSheet(): Promise<string | null> {
  const tabs = await getActualSheetTabs();
  if (tabs) {
    for (const f of FALLBACK_USERS_TABS) {
      if (tabs.includes(f)) return f;
    }
  }

  const { sheets, spreadsheetId } = getSheetsClient();
  if (!sheets || !spreadsheetId) return null;

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: USERS_SHEET_NAME } } },
        ],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${USERS_SHEET_NAME}!A1:G2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['PIONEER — ทะเบียนผู้ใช้งานระบบ'],
          [
            'LINE User ID',
            'ชื่อแสดงผล',
            'กลุ่ม (Role)',
            'เข้าใช้ครั้งแรก',
            'เข้าใช้ล่าสุด',
            'เมนูที่กำหนดเอง (JSON)',
            'หมายเหตุ',
          ],
        ],
      },
    });
    // Bust the cached tab list so subsequent reads see the new tab.
    actualTabsCache = null;
    return USERS_SHEET_NAME;
  } catch (error) {
    console.error('Google Sheets Error (ensureUsersSheet):', error);
    return null;
  }
}

export type UserRow = {
  sheetRow: number;
  lineUserId: string;
  displayName: string;
  role: string;          // raw — may be empty for users who haven't picked yet
  firstLogin: string;
  lastLogin: string;
  customMenus: string[]; // parsed from JSON column (empty array = no override)
  notes: string;
};

const USERS_HEADER_ROW_INDEX = 1; // row 2 (sheet 1-based)
const USERS_DATA_START_INDEX = 2; // row 3

function parseCustomMenus(raw: string): string[] {
  const trimmed = (raw || '').trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
      return parsed as string[];
    }
  } catch {
    // Fall through — malformed JSON treated as empty
  }
  return [];
}

export async function readUsersSheet(): Promise<UserRow[] | null> {
  const { sheets, spreadsheetId } = getSheetsClient();
  if (!sheets || !spreadsheetId) return null;
  const tab = await ensureUsersSheet();
  if (!tab) return null;

  let rawRows: unknown[][] = [];
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A:G`,
    });
    rawRows = (response.data.values as unknown[][]) || [];
  } catch (error) {
    console.error('Google Sheets Error (readUsersSheet):', error);
    return null;
  }

  if (rawRows.length <= USERS_HEADER_ROW_INDEX) return [];

  const result: UserRow[] = [];
  for (let i = USERS_DATA_START_INDEX; i < rawRows.length; i++) {
    const row = rawRows[i] || [];
    const lineUserId = String(row[0] ?? '').trim();
    if (!lineUserId) continue;
    result.push({
      sheetRow: i + 1,
      lineUserId,
      displayName: String(row[1] ?? '').trim(),
      role: String(row[2] ?? '').trim(),
      firstLogin: String(row[3] ?? '').trim(),
      lastLogin: String(row[4] ?? '').trim(),
      customMenus: parseCustomMenus(String(row[5] ?? '')),
      notes: String(row[6] ?? '').trim(),
    });
  }
  return result;
}

/**
 * Find a user by LINE userId. Returns null if the sheet can't be read,
 * or undefined if the user simply isn't recorded yet.
 */
export async function findUserRow(
  lineUserId: string,
): Promise<UserRow | null | undefined> {
  const rows = await readUsersSheet();
  if (rows === null) return null;
  return rows.find((r) => r.lineUserId === lineUserId);
}

/**
 * Insert a new user record OR refresh an existing one's displayName +
 * lastLogin. Called on every LINE Login callback so the user-history
 * view stays up to date.
 */
export async function upsertUser(args: {
  lineUserId: string;
  displayName: string;
}): Promise<void> {
  const { sheets, spreadsheetId } = getSheetsClient();
  if (!sheets || !spreadsheetId) return;
  const tab = await ensureUsersSheet();
  if (!tab) return;

  const now = new Date().toISOString();
  const existing = await findUserRow(args.lineUserId);

  try {
    if (existing) {
      // Update displayName (in case it changed) + lastLogin.
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab}!B${existing.sheetRow}:B${existing.sheetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[args.displayName]] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab}!E${existing.sheetRow}:E${existing.sheetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[now]] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${tab}!A:G`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [
            [args.lineUserId, args.displayName, '', now, now, '', ''],
          ],
        },
      });
    }
  } catch (error) {
    console.error('Google Sheets Error (upsertUser):', error);
  }
}

export async function updateUserRole(
  lineUserId: string,
  role: string,
): Promise<void> {
  const { sheets, spreadsheetId } = getSheetsClient();
  if (!sheets || !spreadsheetId) return;
  const tab = await ensureUsersSheet();
  if (!tab) return;
  const existing = await findUserRow(lineUserId);
  if (!existing) return;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!C${existing.sheetRow}:C${existing.sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[role]] },
    });
  } catch (error) {
    console.error('Google Sheets Error (updateUserRole):', error);
  }
}

export async function updateUserCustomMenus(
  lineUserId: string,
  customMenus: string[],
): Promise<boolean> {
  const { sheets, spreadsheetId } = getSheetsClient();
  if (!sheets || !spreadsheetId) return false;
  const tab = await ensureUsersSheet();
  if (!tab) return false;
  const existing = await findUserRow(lineUserId);
  if (!existing) return false;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!F${existing.sheetRow}:F${existing.sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[customMenus.length ? JSON.stringify(customMenus) : '']],
      },
    });
    return true;
  } catch (error) {
    console.error('Google Sheets Error (updateUserCustomMenus):', error);
    return false;
  }
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
 *
 * Sheet layout (PIONEER stock sheet):
 *   Row 1  — merged title cell ("PIONEER — ระบบจัดการสต็อกสินค้า"), skipped
 *   Row 2  — header row: รหัส | ชื่อรายการ | หมวดหมู่ | คงเหลือ | สถานะ
 *   Row 3+ — item data
 *
 * Header matching falls back to positional A:E if a header name can't be
 * located, so a future tweak to column names won't silently break reads.
 */
const HEADER_ROW_INDEX = 1; // zero-based → sheet row 2
const DATA_START_INDEX = 2; // zero-based → sheet row 3

export async function readItemsSheet(): Promise<ItemsSheetSchema | null> {
  const { sheets, spreadsheetId } = getSheetsClient();
  if (!sheets || !spreadsheetId) {
    console.error('Google Sheets Error: missing credentials or spreadsheet id');
    return null;
  }
  const SHEET_ITEMS = await resolveItemsSheetName();
  if (!SHEET_ITEMS) return null;

  let rawRows: unknown[][] = [];
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_ITEMS}!A:Z`,
    });
    rawRows = (response.data.values as unknown[][]) || [];
  } catch (error) {
    console.error('Google Sheets Error (readItemsSheet):', error);
    return null;
  }

  if (rawRows.length <= HEADER_ROW_INDEX) {
    return { rows: [], stockColLetter: 'D' };
  }

  const headers = (rawRows[HEADER_ROW_INDEX] || []).map((h) => String(h ?? ''));

  const codeIdx = findHeaderIndex(headers, ['รหัส', 'รหัสสินค้า', 'code', 'item code', 'sku', 'id']);
  const nameIdx = findHeaderIndex(headers, ['ชื่อรายการ', 'ชื่อสินค้า', 'ชื่อ', 'name', 'item name', 'description']);
  const catIdx = findHeaderIndex(headers, ['หมวดหมู่', 'หมวด', 'ประเภท', 'category', 'type']);
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

  // Parse stock: strip thousands separators, treat plain "-" / blank as 0,
  // clamp negatives to 0 (the sheet uses "-" to mean "no stock recorded").
  const parseStock = (v: unknown): number => {
    const raw = String(v ?? '').trim();
    if (raw === '' || raw === '-') return 0;
    const cleaned = raw.replace(/,/g, '');
    const n = parseInt(cleaned, 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
  };

  // A row is a "category separator" (e.g. "▌ BUSH" in col A, other cells blank)
  // when its display fields are empty or start with the ▌ marker. Skip those
  // so they never appear as searchable items.
  const isSeparatorRow = (code: string, name: string, category: string): boolean => {
    if (code.startsWith('▌')) return true;
    if (!name && !category) return true; // pure section header
    if (name.startsWith('▌')) return true;
    if (category.startsWith('▌')) return true;
    return false;
  };

  const items: SheetItemRow[] = [];
  for (let i = DATA_START_INDEX; i < rawRows.length; i++) {
    const row = rawRows[i] || [];
    const code = String(row[cIdx] ?? '').trim();
    const name = String(row[nIdx] ?? '').trim();
    const category = String(row[ctIdx] ?? '').trim();
    if (!code) continue;
    if (isSeparatorRow(code, name, category)) continue;
    items.push({
      rowNumber: i + 1, // 1-based sheet row
      code,
      name,
      category,
      stock: parseStock(row[sIdx]),
      status: String(row[stIdx] ?? '').trim(),
    });
  }

  return {
    rows: items,
    stockColLetter: colIndexToLetter(sIdx),
  };
}

/* ─── History sheet helpers ─── */

/**
 * History sheet ("ประวัติเข้า-ออก") layout:
 *   Row 1   — title row, skipped
 *   Row 2   — headers: วันที่ | ประเภท | รหัสรายการ | ชื่อรายการ | จำนวน |
 *             ชื่อผู้บันทึก | แผนก (OUT) | วัตถุประสงค์ (OUT) | รหัส PO/PX (IN)
 *             plus internal cols J=requisitionId, K=status, L=lineUserId
 *             (J/K/L are used by the approval flow — feel free to label
 *             them in the sheet)
 *   Row 3+  — entries
 *
 * Note: column L (lineUserId) was added when LINE Login was wired up.
 * Legacy rows have it blank, which is fine — push falls back to broadcast.
 */
const HISTORY_HEADER_ROW_INDEX = 1; // sheet row 2
const HISTORY_DATA_START_INDEX = 2; // sheet row 3
export const HISTORY_RANGE = 'A:L';
export const HISTORY_STATUS_COL = 'K';
export const HISTORY_LINE_USER_COL = 'L';

export type HistoryRow = {
  sheetRow: number; // 1-based
  date: string;
  type: 'IN' | 'OUT';
  code: string;
  name: string;
  quantity: number;
  recorder: string;
  department: string;
  purpose: string;
  poRef: string;
  requisitionId: string;
  status: string; // raw value — callers may normalize
  lineUserId: string; // optional — empty for legacy rows
};

export async function readHistorySheet(): Promise<HistoryRow[] | null> {
  const { sheets, spreadsheetId } = getSheetsClient();
  if (!sheets || !spreadsheetId) {
    console.error('Google Sheets Error: missing credentials or spreadsheet id');
    return null;
  }
  const SHEET_HISTORY = await resolveHistorySheetName();
  if (!SHEET_HISTORY) return null;

  let rawRows: unknown[][] = [];
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_HISTORY}!${HISTORY_RANGE}`,
    });
    rawRows = (response.data.values as unknown[][]) || [];
  } catch (error) {
    console.error('Google Sheets Error (readHistorySheet):', error);
    return null;
  }

  if (rawRows.length <= HISTORY_HEADER_ROW_INDEX) return [];

  const result: HistoryRow[] = [];
  for (let i = HISTORY_DATA_START_INDEX; i < rawRows.length; i++) {
    const row = rawRows[i] || [];
    const date = String(row[0] ?? '').trim();
    if (!date) continue; // skip blank rows
    result.push({
      sheetRow: i + 1,
      date,
      type: row[1] === 'IN' ? 'IN' : 'OUT',
      code: String(row[2] ?? ''),
      name: String(row[3] ?? ''),
      quantity: parseInt(String(row[4] ?? '0'), 10) || 0,
      recorder: String(row[5] ?? ''),
      department: String(row[6] ?? ''),
      purpose: String(row[7] ?? ''),
      poRef: String(row[8] ?? ''),
      requisitionId: String(row[9] ?? ''),
      status: String(row[10] ?? ''),
      lineUserId: String(row[11] ?? '').trim(),
    });
  }
  return result;
}

/* ─── Inspections sheet helpers ─── */

const INSPECTIONS_SHEET_NAME = 'รอตรวจสอบ';
const FALLBACK_INSPECTIONS_TABS = ['รอตรวจสอบ', 'Inspections', 'QC'];

export type InspectionStatus = 'PENDING' | 'COMPLETED';
export type InspectionItem = { code: string; name: string; quantity: number };
export type InspectionImage = { fileId: string; url: string; name?: string };
export type InspectionImages = {
  bill: InspectionImage[];
  po: InspectionImage[];
  items: InspectionImage[];
};
export type InspectionQcImagesByCode = Record<string, InspectionImage[]>;

export type InspectionRow = {
  sheetRow: number;
  id: string;
  receivedAt: string;
  company: string;
  poRef: string;
  items: InspectionItem[];
  warehouseImages: InspectionImages;
  qcImages: InspectionQcImagesByCode;
  status: InspectionStatus;
  inspector: string;
  inspectedAt: string;
};

// Columns:
//   A id | B วันที่รับ | C ชื่อบริษัท | D PO/PX |
//   E รายการของ (JSON) | F รูปคลัง (JSON) | G รูปตรวจสอบ (JSON) |
//   H สถานะ | I ผู้ตรวจ | J วันที่ตรวจ
const INSPECTIONS_RANGE = 'A:J';
const INSPECTIONS_HEADER_ROW_INDEX = 1; // sheet row 2
const INSPECTIONS_DATA_START_INDEX = 2; // sheet row 3

async function ensureInspectionsSheet(): Promise<string | null> {
  const tabs = await getActualSheetTabs();
  if (tabs) {
    for (const f of FALLBACK_INSPECTIONS_TABS) {
      if (tabs.includes(f)) return f;
    }
  }

  const { sheets, spreadsheetId } = getSheetsClient();
  if (!sheets || !spreadsheetId) return null;

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: INSPECTIONS_SHEET_NAME } } },
        ],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${INSPECTIONS_SHEET_NAME}!A1:J2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['PIONEER — รายการรอตรวจสอบ (QC)'],
          [
            'รหัส',
            'วันที่รับ',
            'ชื่อบริษัท',
            'PO/PX',
            'รายการของ (JSON)',
            'รูปคลัง (JSON)',
            'รูปตรวจสอบ (JSON)',
            'สถานะ',
            'ผู้ตรวจ',
            'วันที่ตรวจ',
          ],
        ],
      },
    });
    actualTabsCache = null;
    return INSPECTIONS_SHEET_NAME;
  } catch (error) {
    console.error('Google Sheets Error (ensureInspectionsSheet):', error);
    return null;
  }
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  const trimmed = (raw || '').trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return fallback;
  }
}

function normalizeInspectionStatus(raw: string): InspectionStatus {
  const v = (raw || '').trim().toUpperCase();
  return v === 'COMPLETED' ? 'COMPLETED' : 'PENDING';
}

function normalizeImages(raw: string): InspectionImages {
  const parsed = safeJsonParse<Partial<InspectionImages>>(raw, {});
  return {
    bill: Array.isArray(parsed.bill) ? parsed.bill : [],
    po: Array.isArray(parsed.po) ? parsed.po : [],
    items: Array.isArray(parsed.items) ? parsed.items : [],
  };
}

export async function readInspectionsSheet(): Promise<InspectionRow[] | null> {
  const { sheets, spreadsheetId } = getSheetsClient();
  if (!sheets || !spreadsheetId) return null;
  const tab = await ensureInspectionsSheet();
  if (!tab) return null;

  let rawRows: unknown[][] = [];
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!${INSPECTIONS_RANGE}`,
    });
    rawRows = (response.data.values as unknown[][]) || [];
  } catch (error) {
    console.error('Google Sheets Error (readInspectionsSheet):', error);
    return null;
  }

  if (rawRows.length <= INSPECTIONS_HEADER_ROW_INDEX) return [];

  const result: InspectionRow[] = [];
  for (let i = INSPECTIONS_DATA_START_INDEX; i < rawRows.length; i++) {
    const row = rawRows[i] || [];
    const id = String(row[0] ?? '').trim();
    if (!id) continue;
    result.push({
      sheetRow: i + 1,
      id,
      receivedAt: String(row[1] ?? '').trim(),
      company: String(row[2] ?? '').trim(),
      poRef: String(row[3] ?? '').trim(),
      items: safeJsonParse<InspectionItem[]>(String(row[4] ?? ''), []),
      warehouseImages: normalizeImages(String(row[5] ?? '')),
      qcImages: safeJsonParse<InspectionQcImagesByCode>(String(row[6] ?? ''), {}),
      status: normalizeInspectionStatus(String(row[7] ?? '')),
      inspector: String(row[8] ?? '').trim(),
      inspectedAt: String(row[9] ?? '').trim(),
    });
  }
  return result;
}

export async function appendInspectionRow(args: {
  id: string;
  receivedAt: string;
  company: string;
  poRef: string;
  items: InspectionItem[];
  warehouseImages: InspectionImages;
}): Promise<boolean> {
  const { sheets, spreadsheetId } = getSheetsClient();
  if (!sheets || !spreadsheetId) return false;
  const tab = await ensureInspectionsSheet();
  if (!tab) return false;

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tab}!${INSPECTIONS_RANGE}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [
          [
            args.id,
            args.receivedAt,
            args.company,
            args.poRef,
            JSON.stringify(args.items),
            JSON.stringify(args.warehouseImages),
            JSON.stringify({}),
            'PENDING',
            '',
            '',
          ],
        ],
      },
    });
    return true;
  } catch (error) {
    console.error('Google Sheets Error (appendInspectionRow):', error);
    return false;
  }
}

/**
 * Hard-delete rows in 'รอตรวจสอบ' by id. Uses a single batchUpdate so we
 * don't have to worry about the indices shifting while we remove rows
 * one-by-one. Returns the list of ids that were actually deleted.
 */
export async function deleteInspectionRows(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { sheets, spreadsheetId } = getSheetsClient();
  if (!sheets || !spreadsheetId) return [];
  const tab = await ensureInspectionsSheet();
  if (!tab) return [];

  // Need the sheet's internal sheetId for batchUpdate DimensionRange.
  let sheetId: number | null = null;
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title)',
    });
    const found = (meta.data.sheets || []).find(
      (s) => s.properties?.title === tab,
    );
    sheetId = found?.properties?.sheetId ?? null;
  } catch (error) {
    console.error('Google Sheets Error (deleteInspectionRows: meta):', error);
    return [];
  }
  if (sheetId === null) return [];

  const rows = await readInspectionsSheet();
  if (!rows) return [];
  const idSet = new Set(ids);
  const matching = rows.filter((r) => idSet.has(r.id));
  if (matching.length === 0) return [];

  // Delete from bottom to top so row numbers stay valid as we go.
  const requests = matching
    .map((r) => r.sheetRow - 1) // batchUpdate uses 0-based indices
    .sort((a, b) => b - a)
    .map((startIdx) => ({
      deleteDimension: {
        range: {
          sheetId: sheetId!,
          dimension: 'ROWS' as const,
          startIndex: startIdx,
          endIndex: startIdx + 1,
        },
      },
    }));

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
    return matching.map((r) => r.id);
  } catch (error) {
    console.error('Google Sheets Error (deleteInspectionRows):', error);
    return [];
  }
}

export type CompleteInspectionResult =
  | 'UPDATED'
  | 'NOT_FOUND'
  | 'ALREADY_COMPLETED'
  | 'ERROR';

export async function completeInspectionRow(args: {
  id: string;
  qcImages: InspectionQcImagesByCode;
  inspector: string;
}): Promise<CompleteInspectionResult> {
  const { sheets, spreadsheetId } = getSheetsClient();
  if (!sheets || !spreadsheetId) return 'ERROR';
  const tab = await ensureInspectionsSheet();
  if (!tab) return 'ERROR';

  const rows = await readInspectionsSheet();
  if (!rows) return 'ERROR';
  const target = rows.find((r) => r.id === args.id);
  if (!target) return 'NOT_FOUND';

  let sheetId: number;
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title)',
    });
    const found = (meta.data.sheets || []).find((s) => s.properties?.title === tab);
    if (typeof found?.properties?.sheetId !== 'number') return 'ERROR';
    sheetId = found.properties.sheetId;
  } catch (error) {
    console.error('Google Sheets Error (completeInspectionRow: meta):', error);
    return 'ERROR';
  }

  // Atomic-ish claim: replace status PENDING -> COMPLETED on the single status
  // cell first. If another QC already claimed/completed it, occurrencesChanged
  // will be 0 and we can fail fast with ALREADY_COMPLETED.
  try {
    const claim = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            findReplace: {
              range: {
                sheetId,
                startRowIndex: target.sheetRow - 1,
                endRowIndex: target.sheetRow,
                startColumnIndex: 7, // H = status
                endColumnIndex: 8,
              },
              find: 'PENDING',
              replacement: 'COMPLETED',
              matchCase: true,
              matchEntireCell: true,
            },
          },
        ],
      },
    });
    const changed =
      claim.data.replies?.[0]?.findReplace?.occurrencesChanged ?? 0;
    if (changed === 0) return 'ALREADY_COMPLETED';
  } catch (error) {
    console.error('Google Sheets Error (completeInspectionRow: claim):', error);
    return 'ERROR';
  }

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!G${target.sheetRow}:J${target.sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [
            JSON.stringify(args.qcImages),
            'COMPLETED',
            args.inspector,
            new Date().toISOString(),
          ],
        ],
      },
    });
    return 'UPDATED';
  } catch (error) {
    console.error('Google Sheets Error (completeInspectionRow):', error);
    return 'ERROR';
  }
}
