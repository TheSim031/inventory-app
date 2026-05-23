import { getSheets, getSheetNames } from '@/lib/googleSheets';
import { NextResponse, type NextRequest } from 'next/server';

export async function GET() {
  const { sheets, spreadsheetId } = getSheets();
  const { SHEET_ITEMS } = getSheetNames();

  if (!sheets || !spreadsheetId) {
    return NextResponse.json([]);
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_ITEMS}!A:D`,
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) {
      return NextResponse.json([]);
    }

    const items = rows.slice(1).map((row, index) => ({
      id: row[0] || (index + 1).toString(),
      code: row[0] || '',
      name: row[1] || '',
      category: row[2] || '',
      stock: parseInt(row[3] || '0', 10),
    }));

    return NextResponse.json(items);
  } catch (error) {
    console.error('Error fetching items from Google Sheets:', error);
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
  const { sheets, spreadsheetId } = getSheets();
  const { SHEET_ITEMS } = getSheetNames();

  if (!sheets || !spreadsheetId) {
    return NextResponse.json(
      { error: 'Google Sheets API not configured. Check GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SPREADSHEET_ID in .env.local' },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { name, code, category, stock } = body ?? {};

    if (!name || !code) {
      return NextResponse.json(
        { error: 'กรุณากรอกรหัสสินค้าและชื่อสินค้า' },
        { status: 400 }
      );
    }

    const stockNum = Number.isFinite(Number(stock)) ? Number(stock) : 0;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_ITEMS}!A:D`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[code, name, category || '', stockNum]],
      },
    });

    return NextResponse.json({ success: true, id: code }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error adding item:', message);
    return NextResponse.json(
      { error: `Failed to add item: ${message}. Ensure the "${getSheetNames().SHEET_ITEMS}" sheet tab exists.` },
      { status: 500 }
    );
  }
}
