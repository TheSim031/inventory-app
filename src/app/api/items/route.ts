import { getSheets, getSheetNames } from '@/lib/googleSheets';
import { NextResponse } from 'next/server';

export type Item = {
  id: string;
  code: string;
  name: string;
  category: string;
  stock: number;
  status: string;
};

export async function GET() {
  const { sheets, spreadsheetId } = getSheets();
  const { SHEET_ITEMS } = getSheetNames();

  if (!sheets || !spreadsheetId) {
    return NextResponse.json([]);
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_ITEMS}!A:E`,
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) {
      return NextResponse.json([]);
    }

    const items: Item[] = rows.slice(1).map((row, index) => ({
      id: row[0] || (index + 1).toString(),
      code: row[0] || '',
      name: row[1] || '',
      category: row[2] || '',
      stock: parseInt(row[3] || '0', 10),
      status: row[4] || '',
    }));

    return NextResponse.json(items);
  } catch (error) {
    console.error('Error fetching items from Google Sheets:', error);
    return NextResponse.json([]);
  }
}
