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
  | 'REQ_SUBMITTED'
  | 'PICK_COMPLETE'
  | 'REQ_REJECTED';

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
      type: 'REQ_SUBMITTED';
      data: {
        id: string;
        requester: string;
        department: string;
        purpose: string;
        itemsCount: number;
        items: ItemEntry[];
      };
    }
  | {
      type: 'PICK_COMPLETE';
      data: {
        id: string;
        requester: string;
        department: string;
        purpose: string;
        itemsCount: number;
        items: ItemEntry[];
        outOfStockItems?: ItemEntry[];
        recipientLineUserId?: string;
      };
    }
  | {
      type: 'REQ_REJECTED';
      data: {
        id: string;
        requester: string;
        department: string;
        reason?: string;
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

export type LineDeliveryResult = {
  ok: boolean;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
};

function emptyDeliveryResult(): LineDeliveryResult {
  return { ok: true, attempted: 0, sent: 0, failed: 0, skipped: 0, errors: [] };
}

function combineDeliveryResults(results: LineDeliveryResult[]): LineDeliveryResult {
  const combined = emptyDeliveryResult();
  for (const result of results) {
    combined.attempted += result.attempted;
    combined.sent += result.sent;
    combined.failed += result.failed;
    combined.skipped += result.skipped;
    combined.errors.push(...result.errors);
  }
  combined.ok = combined.failed === 0 && combined.sent > 0;
  return combined;
}

function extractDriveFileId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const queryId = parsed.searchParams.get('id');
    if (queryId) return queryId;

    const filePathMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
    if (filePathMatch) return decodeURIComponent(filePathMatch[1]);

    const lh3PathMatch = parsed.pathname.match(/^\/d\/([^/]+)/);
    if (parsed.hostname === 'lh3.googleusercontent.com' && lh3PathMatch) {
      return decodeURIComponent(lh3PathMatch[1]);
    }
  } catch {
    const queryMatch = url.match(/[?&]id=([^&]+)/);
    if (queryMatch) return decodeURIComponent(queryMatch[1]);
    const filePathMatch = url.match(/\/file\/d\/([^/]+)/);
    if (filePathMatch) return decodeURIComponent(filePathMatch[1]);
  }
  return null;
}

/**
 * Drive preview/share URLs can redirect to HTML, which LINE rejects. Convert
 * known Drive file URL shapes to a stable raw-image endpoint and log unknown
 * Google Drive shapes so notification image failures don't stay silent.
 */
function toLineImageUrl(url: string): string {
  const fileId = extractDriveFileId(url);
  if (fileId) return `https://lh3.googleusercontent.com/d/${fileId}`;
  if (url.includes('drive.google.com') || url.includes('googleusercontent.com')) {
    console.warn('[LINE] Could not extract Drive file id from image URL:', url);
  }
  return url;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function callLine(endpoint: string, body: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.warn('[LINE] LINE_CHANNEL_ACCESS_TOKEN missing — would have called', endpoint);
    return { ok: false, error: 'LINE_CHANNEL_ACCESS_TOKEN missing' };
  }
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) return { ok: true };

      const text = await res.text();
      lastError = `LINE ${res.status}: ${text}`;
      console.error('LINE error', { endpoint, attempt, status: res.status, body: text });
      // Token/config errors are not transient; fail fast so logs are clear.
      if (res.status === 401 || res.status === 403 || res.status === 400) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error('LINE fetch error', { endpoint, attempt, error: lastError });
    }
    if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { ok: false, error: lastError || 'LINE request failed' };
}

/** Push a list of messages to a single LINE userId. */
async function pushToUser(
  userId: string,
  messages: LineMessage[],
): Promise<LineDeliveryResult> {
  const result = emptyDeliveryResult();
  if (!userId || messages.length === 0) {
    result.skipped += 1;
    result.ok = false;
    if (!userId) result.errors.push('missing LINE userId');
    return result;
  }
  // LINE accepts up to 5 messages per push call.
  for (const slice of chunk(messages, 5)) {
    result.attempted += 1;
    const delivery = await callLine('https://api.line.me/v2/bot/message/push', {
      to: userId,
      messages: slice,
    });
    if (delivery.ok) result.sent += 1;
    else {
      result.failed += 1;
      result.errors.push(delivery.error);
    }
  }
  result.ok = result.failed === 0 && result.sent > 0;
  return result;
}

/** Multicast a list of messages to up to 500 userIds (LINE limit). */
async function multicast(
  userIds: string[],
  messages: LineMessage[],
): Promise<LineDeliveryResult> {
  const result = emptyDeliveryResult();
  if (userIds.length === 0 || messages.length === 0) {
    result.skipped += 1;
    result.ok = false;
    if (userIds.length === 0) result.errors.push('no LINE recipients');
    return result;
  }
  // LINE multicast: 500 ids per call, 5 messages per call.
  for (const idSlice of chunk(userIds, 500)) {
    for (const msgSlice of chunk(messages, 5)) {
      result.attempted += 1;
      const delivery = await callLine('https://api.line.me/v2/bot/message/multicast', {
        to: idSlice,
        messages: msgSlice,
      });
      if (delivery.ok) result.sent += 1;
      else {
        result.failed += 1;
        result.errors.push(delivery.error);
      }
    }
  }
  result.ok = result.failed === 0 && result.sent > 0;
  return result;
}

async function resolveRoleRecipients(
  roles: UserRole[],
): Promise<{ ids: string[]; missingLineUserId: number }> {
  const users = await readUsersSheet();
  if (!users) return { ids: [], missingLineUserId: 0 };
  const wanted = new Set(roles);
  const ids = new Set<string>();
  let missingLineUserId = 0;
  for (const u of users) {
    if (!isUserRole(u.role) || !wanted.has(u.role)) continue;
    if (!u.lineUserId) {
      missingLineUserId += 1;
      continue;
    }
    ids.add(u.lineUserId);
  }
  return { ids: Array.from(ids), missingLineUserId };
}

/**
 * Keep each notification to one LINE API message batch: 1 text + up to 4
 * image previews. Full image sets remain available in the web app/Drive.
 */
const MAX_IMAGES_PER_NOTIFICATION = 4;

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
): Promise<LineDeliveryResult> {
  const recipients = await resolveRoleRecipients(roles);
  const result = emptyDeliveryResult();
  result.skipped += recipients.missingLineUserId;
  if (recipients.missingLineUserId > 0) {
    console.warn(
      `[LINE] ${recipients.missingLineUserId} ${roles.join('/')} user(s) have no lineUserId; cannot notify them`,
    );
  }
  if (recipients.ids.length === 0) {
    const message =
      `[LINE] no recipients found for roles ${roles.join(', ')} — message dropped`;
    console.warn(message);
    result.ok = false;
    result.errors.push(message);
    return result;
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
  const delivery = await multicast(recipients.ids, messages);
  return {
    ...delivery,
    skipped: delivery.skipped + result.skipped,
    errors: [...result.errors, ...delivery.errors],
  };
}

/** Push a personal notification (text + optional images) to a userId. */
export async function sendLineToUser(
  userId: string,
  text: string,
  options: RoleNotifyOptions = {},
): Promise<LineDeliveryResult> {
  if (!userId) {
    return {
      ok: false,
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 1,
      errors: ['missing LINE userId'],
    };
  }
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
  return pushToUser(userId, messages);
}

function formatItemList(items: ItemEntry[]): string {
  if (items.length === 0) return '- ไม่มี -';
  return items.map((it) => `• ${it.name} ×${it.quantity}`).join('\n');
}

/**
 * Routes each notification type to the right recipients:
 *  - REQ_SUBMITTED  → WAREHOUSE (new pick queue item)
 *  - PICK_COMPLETE  → requester push
 *  - REQ_REJECTED   → requester push
 *  - OUT_RECORDED   → WAREHOUSE + requester (direct OUT, legacy path)
 *  - IN_RECORDED    → WAREHOUSE
 */
export async function sendLineNotification<T extends NotificationType>(
  type: T,
  data: Extract<NotificationPayload, { type: T }>['data'],
): Promise<LineDeliveryResult> {
  switch (type) {
    case 'REQ_SUBMITTED': {
      const d = data as Extract<NotificationPayload, { type: 'REQ_SUBMITTED' }>['data'];
      const text = `📋 ใบเบิกใหม่รอจัดของ\nรหัส: ${d.id}\nผู้ขอ: ${d.requester}\nแผนก: ${d.department}\nวัตถุประสงค์: ${d.purpose}\nจำนวนรายการ: ${d.itemsCount}\n\nรายการ:\n${formatItemList(d.items)}\n\n👉 เข้าเมนู "จัดของ" (/out) เพื่อยืนยัน`;
      return sendLineToRoles(['WAREHOUSE'], text);
    }
    case 'PICK_COMPLETE': {
      const d = data as Extract<NotificationPayload, { type: 'PICK_COMPLETE' }>['data'];
      if (!d.recipientLineUserId) {
        return emptyDeliveryResult();
      }
      const outBlock =
        d.outOfStockItems && d.outOfStockItems.length > 0
          ? `\n\nไม่จัด (พัสดุหมด):\n${formatItemList(d.outOfStockItems)}`
          : '';
      const pickedBlock =
        d.items.length > 0
          ? `รายการที่จัดให้:\n${formatItemList(d.items)}`
          : 'ไม่มีรายการที่ตัดสต็อก (ทุกรายการพัสดุหมด)';
      const text = `✅ จัดของเสร็จแล้ว\nรหัส: ${d.id}\nแผนก: ${d.department}\nวัตถุประสงค์: ${d.purpose}\n\n${pickedBlock}${outBlock}`;
      return sendLineToUser(d.recipientLineUserId, text);
    }
    case 'REQ_REJECTED': {
      const d = data as Extract<NotificationPayload, { type: 'REQ_REJECTED' }>['data'];
      if (!d.recipientLineUserId) {
        return emptyDeliveryResult();
      }
      const reasonBlock = d.reason ? `\nเหตุผล: ${d.reason}` : '';
      const text = `❌ ใบเบิกถูกปฏิเสธ\nรหัส: ${d.id}\nแผนก: ${d.department}${reasonBlock}\n\nกรุณาติดต่อคลังสินค้าหากมีข้อสงสัย`;
      return sendLineToUser(d.recipientLineUserId, text);
    }
    case 'OUT_RECORDED': {
      const d = data as Extract<NotificationPayload, { type: 'OUT_RECORDED' }>['data'];
      const text = `📤 บันทึกการเบิกออก\nผู้เบิก: ${d.recorder}\nแผนก: ${d.department}\nวัตถุประสงค์: ${d.purpose}\nจำนวนรายการ: ${d.itemsCount}\n\nรายการที่เบิก:\n${formatItemList(d.items)}`;
      const results: LineDeliveryResult[] = [await sendLineToRoles(['WAREHOUSE'], text)];
      if (d.recipientLineUserId) {
        const personal = `📝 ยืนยันคำขอเบิกของคุณ\nผู้เบิก: ${d.recorder}\nแผนก: ${d.department}\n\nรายการที่ขอเบิก:\n${formatItemList(d.items)}`;
        results.push(await sendLineToUser(d.recipientLineUserId, personal));
      }
      return combineDeliveryResults(results);
    }
    case 'IN_RECORDED': {
      const d = data as Extract<NotificationPayload, { type: 'IN_RECORDED' }>['data'];
      const text = `📥 บันทึกการรับเข้า\nผู้รับ: ${d.recorder}\nPO/PX: ${d.poRef}\nจำนวนรายการ: ${d.itemsCount}`;
      return sendLineToRoles(['WAREHOUSE'], text);
    }
  }
}
