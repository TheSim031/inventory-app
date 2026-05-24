/**
 * LINE Messaging API Integration
 *
 * Two delivery modes:
 *  - sendLineNotification(type, data) — legacy typed broadcast/push
 *  - sendLineToRoles(roles, text, images?) — multicast to every user in
 *    the Users sheet whose role matches.
 *
 * Setup: create a LINE Official Account, get a Channel Access Token,
 * set LINE_CHANNEL_ACCESS_TOKEN in env.
 */
import { readUsersSheet } from './googleSheets';
import { isUserRole, type UserRole } from './userRole';

const LINE_CHANNEL_ACCESS_TOKEN =
  process.env.LINE_CHANNEL_ACCESS_TOKEN ||
  process.env.LINE_ACCESS_TOKEN ||
  '';

export type NotificationType =
  | 'OUT_RECORDED'
  | 'IN_RECORDED'
  | 'OUT_OF_STOCK'
  | 'PICK_COMPLETE'
  | 'REQUISITION_REJECTED';

type ItemEntry = { name: string; quantity: number; code?: string };

export type NotificationPayload =
  | {
      type: 'OUT_RECORDED';
      data: {
        recorder: string;
        department: string;
        purpose: string;
        itemsCount: number;
        items: ItemEntry[];
        // Optional LINE userId of the requester for personalised push.
        recipientLineUserId?: string;
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
        pickedItems: ItemEntry[];
        outOfStockItems: ItemEntry[];
        recipientLineUserId?: string;
      };
    }
  | {
      type: 'REQUISITION_REJECTED';
      data: {
        recorder: string;
        requisitionId: string;
        reason: string;
        items: ItemEntry[];
        recipientLineUserId?: string;
      };
    };

type LineMessage =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      originalContentUrl: string;
      previewImageUrl: string;
    };

/**
 * Drive `uc?id=` URLs sometimes redirect to HTML on first hit, which LINE
 * rejects. The `lh3.googleusercontent.com/d/<id>` form serves the raw image
 * bytes directly and is what we want for LINE image messages.
 */
function toLineImageUrl(url: string): string {
  const match = url.match(/[?&]id=([^&]+)/);
  if (match) return `https://lh3.googleusercontent.com/d/${match[1]}`;
  return url;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function callLine(endpoint: string, body: unknown): Promise<boolean> {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.log('[LINE Stub] missing token, would call', endpoint);
    return false;
  }
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('LINE error', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('LINE fetch error', err);
    return false;
  }
}

/** Push a list of messages to a single LINE userId. */
async function pushToUser(
  userId: string,
  messages: LineMessage[],
): Promise<void> {
  if (!userId || messages.length === 0) return;
  // LINE accepts up to 5 messages per push call.
  for (const slice of chunk(messages, 5)) {
    await callLine('https://api.line.me/v2/bot/message/push', {
      to: userId,
      messages: slice,
    });
  }
}

/** Multicast a list of messages to up to 500 userIds (LINE limit). */
async function multicast(
  userIds: string[],
  messages: LineMessage[],
): Promise<void> {
  if (userIds.length === 0 || messages.length === 0) return;
  // LINE multicast: 500 ids per call, 5 messages per call.
  for (const idSlice of chunk(userIds, 500)) {
    for (const msgSlice of chunk(messages, 5)) {
      await callLine('https://api.line.me/v2/bot/message/multicast', {
        to: idSlice,
        messages: msgSlice,
      });
    }
  }
}

async function resolveRoleRecipients(roles: UserRole[]): Promise<string[]> {
  const users = await readUsersSheet();
  if (!users) return [];
  const wanted = new Set(roles);
  const ids = new Set<string>();
  for (const u of users) {
    if (!u.lineUserId) continue;
    if (isUserRole(u.role) && wanted.has(u.role)) ids.add(u.lineUserId);
  }
  return Array.from(ids);
}

/**
 * Hard ceiling on how many image messages we'll ever attach to a single
 * notification. LINE caps each push/multicast at 5 messages, so 30 images
 * = up to 6 API calls per recipient batch. Keeps the door open for "send
 * all warehouse photos" flows without letting a runaway caller flood the
 * channel.
 */
const MAX_IMAGES_PER_NOTIFICATION = 30;

export type RoleNotifyOptions = {
  /** Optional image URLs (Drive). Chunked into LINE's 5-per-call limit. */
  images?: string[];
  /** Suppress images even if provided — for text-only recipients like QC. */
  textOnly?: boolean;
  /**
   * Cap number of image messages to send. Defaults to 5 (legacy behavior).
   * Pass a higher number — up to MAX_IMAGES_PER_NOTIFICATION — to forward
   * the full set of attachments (e.g. all warehouse photos at receiving).
   */
  maxImages?: number;
};

/**
 * Send a notification to every user with one of the given roles. If LINE is
 * not configured, logs the payload and returns. Errors are swallowed so
 * notification failures never block the main request.
 */
export async function sendLineToRoles(
  roles: UserRole[],
  text: string,
  options: RoleNotifyOptions = {},
): Promise<void> {
  const recipients = await resolveRoleRecipients(roles);
  if (recipients.length === 0) {
    console.log(
      `[LINE] no recipients found for roles ${roles.join(', ')} — message dropped`,
    );
    return;
  }
  const messages: LineMessage[] = [{ type: 'text', text }];
  if (!options.textOnly && options.images && options.images.length > 0) {
    const cap = Math.min(options.maxImages ?? 5, MAX_IMAGES_PER_NOTIFICATION);
    const imgs = options.images.slice(0, cap);
    for (const url of imgs) {
      const lineUrl = toLineImageUrl(url);
      messages.push({
        type: 'image',
        originalContentUrl: lineUrl,
        previewImageUrl: lineUrl,
      });
    }
  }
  await multicast(recipients, messages);
}

/** Push a personal notification (text + optional images) to a userId. */
export async function sendLineToUser(
  userId: string,
  text: string,
  options: RoleNotifyOptions = {},
): Promise<void> {
  if (!userId) return;
  const messages: LineMessage[] = [{ type: 'text', text }];
  if (!options.textOnly && options.images && options.images.length > 0) {
    const cap = Math.min(options.maxImages ?? 5, MAX_IMAGES_PER_NOTIFICATION);
    for (const url of options.images.slice(0, cap)) {
      const lineUrl = toLineImageUrl(url);
      messages.push({
        type: 'image',
        originalContentUrl: lineUrl,
        previewImageUrl: lineUrl,
      });
    }
  }
  await pushToUser(userId, messages);
}

function formatItemList(items: ItemEntry[]): string {
  if (items.length === 0) return '- ไม่มี -';
  return items.map((it) => `• ${it.name} ×${it.quantity}`).join('\n');
}

/**
 * Legacy entry point retained for back-compat with existing call sites.
 * Routes each notification type to the right recipients:
 *  - OUT_RECORDED  → WAREHOUSE roles + the requester (push)
 *  - IN_RECORDED   → WAREHOUSE roles (broadcast-style)
 *  - PICK_COMPLETE → requester (push)
 *  - REQUISITION_REJECTED → requester (push)
 *  - OUT_OF_STOCK  → WAREHOUSE roles
 */
export async function sendLineNotification<T extends NotificationType>(
  type: T,
  data: Extract<NotificationPayload, { type: T }>['data'],
): Promise<void> {
  switch (type) {
    case 'OUT_RECORDED': {
      const d = data as Extract<NotificationPayload, { type: 'OUT_RECORDED' }>['data'];
      const text = `📤 บันทึกการเบิกออก\nผู้เบิก: ${d.recorder}\nแผนก: ${d.department}\nวัตถุประสงค์: ${d.purpose}\nจำนวนรายการ: ${d.itemsCount}\n\nรายการที่เบิก:\n${formatItemList(d.items)}`;
      await sendLineToRoles(['WAREHOUSE'], text);
      if (d.recipientLineUserId) {
        const personal = `📝 ยืนยันคำขอเบิกของคุณ\nผู้เบิก: ${d.recorder}\nแผนก: ${d.department}\n\nรายการที่ขอเบิก:\n${formatItemList(d.items)}\n\nรอคลังจัดของให้ครับ 🙏`;
        await sendLineToUser(d.recipientLineUserId, personal);
      }
      return;
    }
    case 'IN_RECORDED': {
      const d = data as Extract<NotificationPayload, { type: 'IN_RECORDED' }>['data'];
      const text = `📥 บันทึกการรับเข้า\nผู้รับ: ${d.recorder}\nPO/PX: ${d.poRef}\nจำนวนรายการ: ${d.itemsCount}`;
      await sendLineToRoles(['WAREHOUSE'], text);
      return;
    }
    case 'OUT_OF_STOCK': {
      const d = data as Extract<NotificationPayload, { type: 'OUT_OF_STOCK' }>['data'];
      const text = `❌ บันทึกการเบิกไม่สำเร็จ (โดย ${d.recorder})\n${d.message}`;
      await sendLineToRoles(['WAREHOUSE'], text);
      return;
    }
    case 'PICK_COMPLETE': {
      const d = data as Extract<NotificationPayload, { type: 'PICK_COMPLETE' }>['data'];
      const picked = formatItemList(d.pickedItems);
      const outOfStock = d.outOfStockItems.length
        ? `\n\n⚠ พัสดุหมด (ยังไม่ได้จ่าย):\n${formatItemList(d.outOfStockItems)}`
        : '';
      const text = `📦 พัสดุของคุณจัดเสร็จแล้ว มารับได้ที่ห้องคลังสินค้า\n\nใบเบิก: ${d.requisitionId}\nผู้เบิก: ${d.recorder}\n\nรายการที่จัดเสร็จ:\n${picked}${outOfStock}`;
      if (d.recipientLineUserId) {
        await sendLineToUser(d.recipientLineUserId, text);
      } else {
        await sendLineToRoles(['WAREHOUSE'], text);
      }
      return;
    }
    case 'REQUISITION_REJECTED': {
      const d = data as Extract<NotificationPayload, { type: 'REQUISITION_REJECTED' }>['data'];
      const text = `❌ ใบเบิกของคุณถูกยกเลิก\n\nใบเบิก: ${d.requisitionId}\nผู้เบิก: ${d.recorder}\n\n📝 เหตุผล:\n${d.reason}\n\nรายการที่ขอเบิก:\n${formatItemList(d.items)}`;
      if (d.recipientLineUserId) {
        await sendLineToUser(d.recipientLineUserId, text);
      } else {
        await sendLineToRoles(['WAREHOUSE'], text);
      }
      return;
    }
  }
}
