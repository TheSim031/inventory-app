import { sheets, spreadsheetId, SHEET_REQUISITIONS, SHEET_REQUISITION_ITEMS } from '@/lib/googleSheets';
import { NextResponse } from 'next/server';
import { sendLineNotification } from '@/lib/lineNotify';

type RequisitionItemInput = {
  item_name?: string;
  id?: string;
  quantity: number;
};

type CreateRequisitionBody = {
  department: string;
  requester_name: string;
  purpose: string;
  items: RequisitionItemInput[];
};

export async function GET() {
  if (!sheets || !spreadsheetId) {
    return NextResponse.json([]);
  }

  try {
    const [reqResponse, reqItemsResponse] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: `${SHEET_REQUISITIONS}!A:F` }).catch(() => null),
      sheets.spreadsheets.values.get({ spreadsheetId, range: `${SHEET_REQUISITION_ITEMS}!A:C` }).catch(() => null)
    ]);

    const reqRows = reqResponse?.data.values || [];
    const reqItemsRows = reqItemsResponse?.data.values || [];

    if (reqRows.length <= 1) return NextResponse.json([]);

    // Map items (skip header)
    // RequisitionItems schema: ReqID, ItemName, Quantity
    const reqItemsMap: Record<string, Array<{ item_name: string; quantity: number }>> = {};
    if (reqItemsRows.length > 1) {
      reqItemsRows.slice(1).forEach((row) => {
        const reqId = row[0];
        if (!reqItemsMap[reqId]) reqItemsMap[reqId] = [];
        reqItemsMap[reqId].push({
          item_name: row[1] || '',
          quantity: parseInt(row[2] || '0', 10),
        });
      });
    }

    // Map requisitions (skip header)
    // Requisitions schema: ID, Date, Requester, Dept, Purpose, Status
    const requisitions = reqRows.slice(1).map((row) => {
      const id = row[0];
      return {
        id,
        created_at: row[1] || new Date().toISOString(),
        requester_name: row[2] || '',
        department: row[3] || '',
        purpose: row[4] || '',
        status: row[5] || 'PENDING',
        items: reqItemsMap[id] || []
      };
    });

    // Reverse to show newest first
    return NextResponse.json(requisitions.reverse());
  } catch (error) {
    console.error('Error fetching requisitions from Google Sheets:', error);
    return NextResponse.json([]);
  }
}

export async function POST(request: Request) {
  if (!sheets || !spreadsheetId) {
    return NextResponse.json({ error: 'Google Sheets API not configured' }, { status: 503 });
  }

  try {
    const body = (await request.json()) as Partial<CreateRequisitionBody>;
    const { department, requester_name, purpose, items } = body;

    if (!department || !requester_name || !purpose || !items || items.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const newReqId = `REQ-${Date.now()}`;
    const createdAt = new Date().toISOString();

    // 1. Add to Requisitions sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_REQUISITIONS}!A:F`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [newReqId, createdAt, requester_name, department, purpose, 'PENDING']
        ]
      }
    });

    // 2. Add to RequisitionItems sheet
    const itemsValues = items.map((item) => [
      newReqId,
      item.item_name || item.id, // we might receive item_name if we change the frontend
      item.quantity,
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_REQUISITION_ITEMS}!A:C`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: itemsValues
      }
    });

    // Send LINE Notification
    sendLineNotification('NEW_REQUISITION', {
      id: newReqId,
      department,
      requester_name,
      purpose,
      itemsCount: items.length
    }).catch(console.error);

    return NextResponse.json({ success: true, id: newReqId }, { status: 201 });
  } catch (error) {
    console.error('Error creating requisition:', error);
    return NextResponse.json({ error: 'Failed to create requisition' }, { status: 500 });
  }
}
