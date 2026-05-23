import { sheets, spreadsheetId, SHEET_REQUISITIONS, SHEET_ITEMS } from '@/lib/googleSheets';
import { NextResponse } from 'next/server';
import { sendLineNotification } from '@/lib/lineNotify';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!sheets || !spreadsheetId) {
    return NextResponse.json({ error: 'Google Sheets API not configured' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { status } = body;

    if (!status || !['COMPLETED', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    // 1. Fetch requisitions to find the row to update
    const reqRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_REQUISITIONS}!A:F`
    });
    const reqRows = reqRes.data.values || [];
    
    // Find row index (0-based array, but sheets are 1-based, plus header)
    let rowIndex = -1;
    let currentReq = null;
    for (let i = 1; i < reqRows.length; i++) {
      if (reqRows[i][0] === id) {
        rowIndex = i + 1; // Google sheets row number
        currentReq = {
          id: reqRows[i][0],
          requester_name: reqRows[i][2],
          department: reqRows[i][3],
          status: reqRows[i][5]
        };
        break;
      }
    }

    if (!currentReq) return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
    if (currentReq.status === 'COMPLETED') return NextResponse.json({ error: 'Already completed' }, { status: 400 });

    // 2. If COMPLETED, deduct stock in Items sheet
    if (status === 'COMPLETED') {
      const itemsBody = body.items || []; // Need the frontend to pass items to deduct
      
      const itemsRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_ITEMS}!A:D`
      });
      const itemsRows = itemsRes.data.values || [];

      // We'll prepare updates for Google Sheets
      const updates = [];

      for (const reqItem of itemsBody) {
        let itemRowIndex = -1;
        let currentStock = 0;
        
        // Find the item row
        for (let i = 1; i < itemsRows.length; i++) {
          if (itemsRows[i][1] === reqItem.item_name) { // Match by name
            itemRowIndex = i + 1;
            currentStock = parseInt(itemsRows[i][3] || '0', 10);
            break;
          }
        }

        if (itemRowIndex === -1) {
          throw new Error(`ไม่พบสินค้า: ${reqItem.item_name} ในสต๊อก`);
        }

        const newStock = currentStock - reqItem.quantity;
        if (newStock < 0) {
          throw new Error(`สินค้า ${reqItem.item_name} มีไม่พอ (คงเหลือ: ${currentStock})`);
        }

        // Prepare update for this cell (Column D)
        updates.push({
          range: `${SHEET_ITEMS}!D${itemRowIndex}`,
          values: [[newStock.toString()]]
        });
      }

      // Execute all stock updates sequentially (batchUpdate is complex with values)
      for (const update of updates) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: update.range,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: update.values }
        });
      }
    }

    // 3. Update Status in Requisitions sheet (Column F)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_REQUISITIONS}!F${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[status]]
      }
    });

    if (status === 'COMPLETED') {
      sendLineNotification('COMPLETED', {
        id,
        requester_name: currentReq.requester_name,
        department: currentReq.department
      }).catch(console.error);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error updating requisition:', message);

    if (message.includes('มีไม่พอ') || message.includes('ไม่พบสินค้า')) {
      sendLineNotification('OUT_OF_STOCK', { id, message }).catch(console.error);
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to update requisition' }, { status: 500 });
  }
}
