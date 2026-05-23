import { sheets, spreadsheetId, SHEET_ITEMS } from '@/lib/googleSheets';
import { NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';

export async function POST(request: Request) {
  if (!sheets || !spreadsheetId) {
    return NextResponse.json({ error: 'Google Sheets API not configured' }, { status: 503 });
  }

  let parser: PDFParse | null = null;
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const data = new Uint8Array(await file.arrayBuffer());
    parser = new PDFParse({ data });
    const pdfData = await parser.getText();
    const text = pdfData.text;

    // --- Parse the raw text into rows ---
    // Strategy: look for lines that contain digits (likely stock rows)
    // Expected format each line: "CODE  ชื่อสินค้า  ประเภท  จำนวน"
    // We try to be flexible and extract any line that has at least 2 tokens,
    // last one being a number (stock quantity).
    const lines = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    const items: { code: string; name: string; category: string; stock: number }[] = [];

    for (const line of lines) {
      // Split by 2+ whitespace or tab
      const tokens = line.split(/\s{2,}|\t/).map(t => t.trim()).filter(Boolean);

      if (tokens.length < 2) continue;

      const lastToken = tokens[tokens.length - 1];
      const stockNum = parseInt(lastToken, 10);
      if (isNaN(stockNum)) continue; // skip lines where last column isn't a number

      if (tokens.length === 2) {
        // Only name + stock
        items.push({ code: `PDF-${Date.now()}-${items.length}`, name: tokens[0], category: '', stock: stockNum });
      } else if (tokens.length === 3) {
        // code + name + stock
        items.push({ code: tokens[0], name: tokens[1], category: '', stock: stockNum });
      } else {
        // code + name + category + stock (or more)
        items.push({ code: tokens[0], name: tokens[1], category: tokens.slice(2, -1).join(' '), stock: stockNum });
      }
    }

    if (items.length === 0) {
      return NextResponse.json({
        error: 'ไม่พบข้อมูลสินค้าในไฟล์ PDF กรุณาตรวจสอบรูปแบบไฟล์ (แต่ละแถวควรมี: รหัส ชื่อ ประเภท จำนวน คั่นด้วย Tab หรือช่องว่าง 2+ ตัว)',
        rawText: text.substring(0, 500), // First 500 chars for debugging
      }, { status: 422 });
    }

    const values = items.map(item => [item.code, item.name, item.category, item.stock]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_ITEMS}!A:D`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });

    return NextResponse.json({ success: true, count: items.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error processing PDF:', message);
    return NextResponse.json({ error: `เกิดข้อผิดพลาด: ${message}` }, { status: 500 });
  } finally {
    await parser?.destroy().catch(() => {});
  }
}
