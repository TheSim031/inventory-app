/**
 * LINE Messaging API Integration Stub
 * 
 * To use this, the user needs to create a LINE Official Account and get a Channel Access Token.
 * Provide the token in an environment variable `LINE_CHANNEL_ACCESS_TOKEN`.
 */

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

export type NotificationType =
  | 'OUT_RECORDED'
  | 'IN_RECORDED'
  | 'OUT_OF_STOCK'
  | 'PICK_COMPLETE';

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
    }
  | {
      type: 'PICK_COMPLETE';
      data: {
        recorder: string;
        requisitionId: string;
        pickedItems: Array<{ name: string; quantity: number }>;
        outOfStockItems: Array<{ name: string; quantity: number }>;
        // Optional: LINE userId of the requester for push (Phase 4).
        // When omitted, falls back to broadcast.
        recipientLineUserId?: string;
      };
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
  // recipientLineUserId triggers a per-user push instead of broadcast (Phase 4).
  let recipientLineUserId: string | undefined;

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
    case 'PICK_COMPLETE': {
      const d = data as Extract<NotificationPayload, { type: 'PICK_COMPLETE' }>['data'];
      recipientLineUserId = d.recipientLineUserId;
      const pickedList = d.pickedItems
        .map((it) => `• ${it.name} ×${it.quantity}`)
        .join('\n');
      const outList = d.outOfStockItems.length
        ? `\n\n⚠ พัสดุหมด (ยังไม่ได้จ่าย):\n${d.outOfStockItems
            .map((it) => `• ${it.name} ×${it.quantity}`)
            .join('\n')}`
        : '';
      message = `📦 พัสดุของคุณจัดเสร็จเรียบร้อยแล้ว มารับได้ที่ห้องคลังสินค้า\n\nใบเบิก: ${d.requisitionId}\nผู้เบิก: ${d.recorder}\n\nรายการที่จัดเสร็จ:\n${pickedList || '- ไม่มี -'}${outList}`;
      break;
    }
  }

  // If we have a specific recipient (Phase 4 user mapping), push to them.
  // Otherwise fall back to broadcast so it reaches the OA's followers.
  const endpoint = recipientLineUserId
    ? 'https://api.line.me/v2/bot/message/push'
    : 'https://api.line.me/v2/bot/message/broadcast';

  const body = recipientLineUserId
    ? { to: recipientLineUserId, messages: [{ type: 'text', text: message }] }
    : { messages: [{ type: 'text', text: message }] };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error('Failed to send LINE notification:', await response.text());
    } else {
      console.log(`Successfully sent LINE notification (${recipientLineUserId ? 'push' : 'broadcast'})`);
    }
  } catch (error) {
    console.error('Error sending LINE notification:', error);
  }
}
