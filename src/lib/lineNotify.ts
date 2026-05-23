/**
 * LINE Messaging API Integration Stub
 * 
 * To use this, the user needs to create a LINE Official Account and get a Channel Access Token.
 * Provide the token in an environment variable `LINE_CHANNEL_ACCESS_TOKEN`.
 */

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

export type NotificationType = 'NEW_REQUISITION' | 'COMPLETED' | 'OUT_OF_STOCK';

export type NotificationPayload =
  | {
      type: 'NEW_REQUISITION';
      data: {
        id: string;
        requester_name: string;
        department: string;
        purpose: string;
        itemsCount: number;
      };
    }
  | {
      type: 'COMPLETED';
      data: { id: string; requester_name: string; department: string };
    }
  | {
      type: 'OUT_OF_STOCK';
      data: { id: string; message: string };
    };

export async function sendLineNotification<T extends NotificationType>(
  type: T,
  data: Extract<NotificationPayload, { type: T }>['data']
) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.log('[LINE Notify Stub] Missing Token. Would have sent:', type, data);
    return;
  }

  let message = '';

  switch (type) {
    case 'NEW_REQUISITION': {
      const d = data as Extract<NotificationPayload, { type: 'NEW_REQUISITION' }>['data'];
      message = `📦 มีคำขอเบิกพัสดุใหม่ (ID: ${d.id})\nชื่อ: ${d.requester_name}\nแผนก: ${d.department}\nวัตถุประสงค์: ${d.purpose}\nจำนวนรายการ: ${d.itemsCount}`;
      break;
    }
    case 'COMPLETED': {
      const d = data as Extract<NotificationPayload, { type: 'COMPLETED' }>['data'];
      message = `✅ คำขอเบิกพัสดุ (ID: ${d.id}) ของคุณ ${d.requester_name} (${d.department}) จัดเตรียมเสร็จสิ้นแล้ว สามารถมารับได้เลยครับ`;
      break;
    }
    case 'OUT_OF_STOCK': {
      const d = data as Extract<NotificationPayload, { type: 'OUT_OF_STOCK' }>['data'];
      message = `❌ คำขอเบิกพัสดุ (ID: ${d.id}) ไม่สามารถดำเนินการได้: ${d.message}`;
      break;
    }
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        messages: [
          {
            type: 'text',
            text: message
          }
        ]
      })
    });

    if (!response.ok) {
      console.error('Failed to send LINE notification:', await response.text());
    } else {
      console.log('Successfully sent LINE notification');
    }
  } catch (error) {
    console.error('Error sending LINE notification:', error);
  }
}
