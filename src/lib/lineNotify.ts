/**
 * LINE Messaging API Integration Stub
 * 
 * To use this, the user needs to create a LINE Official Account and get a Channel Access Token.
 * Provide the token in an environment variable `LINE_CHANNEL_ACCESS_TOKEN`.
 */

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

export type NotificationType = 'NEW_REQUISITION' | 'COMPLETED' | 'OUT_OF_STOCK';

export async function sendLineNotification(type: NotificationType, data: any) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.log('[LINE Notify Stub] Missing Token. Would have sent:', type, data);
    return;
  }

  let message = '';

  switch (type) {
    case 'NEW_REQUISITION':
      message = `📦 มีคำขอเบิกพัสดุใหม่ (ID: ${data.id})\nชื่อ: ${data.requester_name}\nแผนก: ${data.department}\nวัตถุประสงค์: ${data.purpose}\nจำนวนรายการ: ${data.itemsCount}`;
      break;
    case 'COMPLETED':
      message = `✅ คำขอเบิกพัสดุ (ID: ${data.id}) ของคุณ ${data.requester_name} (${data.department}) จัดเตรียมเสร็จสิ้นแล้ว สามารถมารับได้เลยครับ`;
      break;
    case 'OUT_OF_STOCK':
      message = `❌ คำขอเบิกพัสดุ (ID: ${data.id}) ไม่สามารถดำเนินการได้: ${data.message}`;
      break;
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
