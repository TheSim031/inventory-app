import { readItemsSheet } from '@/lib/googleSheets';
import { NextResponse } from 'next/server';

// Force every request to hit Google Sheets fresh — never cache the response
// on Vercel's Data Cache. Stock changes need to be visible immediately.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
      console.error('Google Sheets Error: readItemsSheet returned null (check /api/debug)');
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
    console.error('Google Sheets Error (GET /api/items):', error);
    return NextResponse.json([]);
  }
}
