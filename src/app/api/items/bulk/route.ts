import { sheets, spreadsheetId, SHEET_ITEMS } from '@/lib/googleSheets';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  if (!sheets || !spreadsheetId) {
    return NextResponse.json({ error: 'Google Sheets API not configured' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { items } = body; // Expected to be an array of objects

    if (!items || !Array.isArray(items)) {
      return NextResponse.json({ error: 'Invalid data format' }, { status: 400 });
    }

    // Convert items into 2D array for Google Sheets
    const values = items.map((item: any, index: number) => [
      item.code || `ITEM-${Date.now()}-${index}`,
      item.name || 'Unknown',
      item.category || '',
      item.stock || 0
    ]);

    // To bulk upload, we can append all at once
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_ITEMS}!A:D`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values
      }
    });

    return NextResponse.json({ success: true, count: items.length });
  } catch (err: any) {
    console.error('Error bulk uploading items:', err.message);
    return NextResponse.json({ error: 'Failed to bulk upload items' }, { status: 500 });
  }
}
