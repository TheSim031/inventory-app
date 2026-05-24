import { readItemsSheet } from '@/lib/googleSheets';
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
  try {
    const schema = await readItemsSheet();
    if (!schema) {
      return NextResponse.json([]);
    }
    const items: Item[] = schema.rows.map((r) => ({
      id: r.code,
      code: r.code,
      name: r.name,
      category: r.category,
      stock: r.stock,
      status: r.status,
    }));
    return NextResponse.json(items);
  } catch (error) {
    console.error('Error fetching items from Google Sheets:', error);
    return NextResponse.json([]);
  }
}
