import { getSheets, getSheetNames, readItemsSheet } from '@/lib/googleSheets';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Diagnostic endpoint — safe to expose: never returns credential values,
 * only boolean presence flags and metadata about which sheets the service
 * account can actually see. Helpful when "ดึงข้อมูลไม่ขึ้น" on a deployed
 * environment to narrow down whether it's env config, sheet name, or row
 * structure.
 */
export async function GET() {
  const env = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY: !!process.env.GOOGLE_PRIVATE_KEY,
    GOOGLE_PRIVATE_KEY_length: process.env.GOOGLE_PRIVATE_KEY?.length ?? 0,
    GOOGLE_PRIVATE_KEY_starts_with_pem:
      (process.env.GOOGLE_PRIVATE_KEY || '').includes('BEGIN PRIVATE KEY'),
    GOOGLE_SPREADSHEET_ID: !!process.env.GOOGLE_SPREADSHEET_ID,
    GOOGLE_SHEET_ITEMS: process.env.GOOGLE_SHEET_ITEMS || '(using default)',
    GOOGLE_SHEET_HISTORY: process.env.GOOGLE_SHEET_HISTORY || '(using default)',
  };

  const expected = getSheetNames();
  const { sheets, spreadsheetId } = getSheets();

  if (!sheets || !spreadsheetId) {
    return NextResponse.json({
      ok: false,
      reason: 'Missing required env vars — sheets client not initialized',
      env,
      expectedSheetNames: expected,
    });
  }

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const actualSheets = (meta.data.sheets || [])
      .map((s) => s.properties?.title || '')
      .filter(Boolean);

    const itemsTabFound = actualSheets.includes(expected.SHEET_ITEMS);
    const historyTabFound = actualSheets.includes(expected.SHEET_HISTORY);

    let itemsSample: unknown = null;
    let itemsError: string | null = null;
    try {
      const schema = await readItemsSheet();
      itemsSample = {
        totalItems: schema?.rows.length ?? 0,
        stockColLetter: schema?.stockColLetter ?? null,
        first3: schema?.rows.slice(0, 3) ?? [],
      };
    } catch (e) {
      itemsError = e instanceof Error ? e.message : String(e);
    }

    return NextResponse.json({
      ok: itemsTabFound && historyTabFound,
      env,
      expectedSheetNames: expected,
      actualSheetTabs: actualSheets,
      tabsMatch: {
        items: itemsTabFound,
        history: historyTabFound,
      },
      itemsSample,
      itemsError,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      ok: false,
      reason: 'Google Sheets API call failed',
      error: message,
      env,
      expectedSheetNames: expected,
    });
  }
}
