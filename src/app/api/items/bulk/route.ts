import { sheets, spreadsheetId, SHEET_ITEMS } from '@/lib/googleSheets';
import { NextResponse } from 'next/server';

type BulkItem = {
  code?: string;
  name?: string;
  category?: string;
  stock?: number | string;
};

export async function POST(request: Request) {
  if (!sheets || !spreadsheetId) {
    return NextResponse.json({ error: 'Google Sheets API not configured' }, { status: 503 });
  }

  try {
    const body = (await request.json()) as { items?: BulkItem[] };
    const { items } = body;

    if (!items || !Array.isArray(items)) {
      return NextResponse.json({ error: 'Invalid data format' }, { status: 400 });
    }

    // Convert items into 2D array for Google Sheets
    const values = items.map((item, index) => [
      item.code || `ITEM-${Date.now()}-${index}`,
      item.name || 'Unknown',
      item.category || '',
      item.stock ?? 0,
    ]);

    // To bulk upload, we can append all at once
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_ITEMS}!A:D`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });

    return NextResponse.json({ success: true, count: items.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error bulk uploading items:', message);
    return NextResponse.json({ error: 'Failed to bulk upload items' }, { status: 500 });
  }
}
