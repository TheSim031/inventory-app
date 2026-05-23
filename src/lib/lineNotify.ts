/**
 * LINE Messaging API Integration Stub
 * 
 * To use this, the user needs to create a LINE Official Account and get a Channel Access Token.
 * Provide the token in an environment variable `LINE_CHANNEL_ACCESS_TOKEN`.
 */

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

export type NotificationType = 'OUT_RECORDED' | 'IN_RECORDED' | 'OUT_OF_STOCK';

export type NotificationPayload =
  | {
      type: 'OUT_RECORDED';
      data: {
        recorder: string;
        department: string;
        purpose: string;
        itemsCount: number;
      };
    }
  | {
      type: 'IN_RECORDED';
      data: {
        recorder: string;
        poRef: string;
        itemsCount: number;
      };
    }
  | {
      type: 'OUT_OF_STOCK';
      data: { recorder: string; message: string };
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
    case 'OUT_RECORDED': {
      const d = data as Extract<NotificationPayload, { type: 'OUT_RECORDED' }>['data'];
      message = `📤 บันทึกการเบิกออก\nผู้เบิก: ${d.recorder}\nแผนก: ${d.department}\nวัตถุประสงค์: ${d.purpose}\nจำนวนรายการ: ${d.itemsCount}`;
      break;
    }
    case 'IN_RECORDED': {
      const d = data as Extract<NotificationPayload, { type: 'IN_RECORDED' }>['data'];
      message = `📥 บันทึกการรับเข้า\nผู้รับ: ${d.recorder}\nPO/PX: ${d.poRef}\nจำนวนรายการ: ${d.itemsCount}`;
      break;
    }
    case 'OUT_OF_STOCK': {
      const d = data as Extract<NotificationPayload, { type: 'OUT_OF_STOCK' }>['data'];
      message = `❌ ไม่สามารถบันทึกการเบิกได้ (โดย ${d.recorder}): ${d.message}`;
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
