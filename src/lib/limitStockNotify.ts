/**
 * Low-stock evaluation + LINE dispatch to ฝ่ายจัดซื้อ (PURCHASING).
 *
 * Two entry points:
 *   - sendDailyLowStockSummary()   — runs from the 09:00 cron
 *   - sendUrgentZeroStockAlert()   — runs from /api/history after IN/OUT
 *
 * Both read the same source of truth (Sheet 1 stock vs the threshold tab),
 * so the per-item logic stays in one place.
 */
import {
  readItemsSheet,
  readLimitStockSheet,
  LIMIT_STOCK_DEFAULT_THRESHOLD,
  type SheetItemRow,
} from './googleSheets';
import {
  sendLineToRoles,
  sendLineTextsToRoles,
  type LineDeliveryResult,
} from './lineNotify';

export type LowStockItem = {
  code: string;
  name: string;
  category: string;
  stock: number;
  threshold: number;
  status: string;
};

export type LowStockReport = {
  items: LowStockItem[];
  zeroStock: LowStockItem[];
  belowThreshold: LowStockItem[];
};

export async function buildLowStockReport(): Promise<LowStockReport | null> {
  const [schema, thresholds] = await Promise.all([
    readItemsSheet(),
    readLimitStockSheet(),
  ]);
  if (!schema) return null;
  const byCode = new Map((thresholds ?? []).map((t) => [t.code, t.threshold]));

  const items: LowStockItem[] = [];
  for (const row of schema.rows) {
    const threshold = byCode.get(row.code) ?? LIMIT_STOCK_DEFAULT_THRESHOLD;
    // เกณฑ์ = 0 หมายถึงปิดแจ้งเตือนสต็อกต่ำสำหรับสินค้านี้โดยเด็ดขาด
    if (threshold <= 0) continue;
    if (row.stock > threshold) continue;
    items.push({
      code: row.code,
      name: row.name,
      category: row.category,
      stock: row.stock,
      threshold,
      status: row.status,
    });
  }
  return {
    items,
    zeroStock: items.filter((i) => i.stock <= 0),
    belowThreshold: items.filter((i) => i.stock > 0 && i.stock <= i.threshold),
  };
}

function formatItemLine(it: LowStockItem): string {
  const detail = it.category ? ` [${it.category}]` : '';
  return `• <${it.code}> ${it.name}${detail}\n   คงเหลือ ${it.stock} / เกณฑ์ ${it.threshold}`;
}

// LINE Notify ตัดข้อความที่ ~1,000 ตัวอักษร (Messaging API จำกัด 5,000) — กันไว้ที่
// 900 แล้วตัดแบ่งเป็นหลายข้อความ เพื่อให้รายการต่ำกว่าเกณฑ์ส่งออกครบทุกชิ้นแน่นอน
const CHUNK_CHAR_BUDGET = 900;
const CHUNK_MAX_ITEMS = 15;

/**
 * Split the low-stock list into one or more LINE messages, each kept under
 * ~900 chars and CHUNK_MAX_ITEMS items. Items are grouped by category first; a
 * category that is still too long just continues into the next numbered chunk.
 * When everything fits in a single message, no "ชุดที่ N" header is added.
 */
function buildLowStockMessages(report: LowStockReport): string[] {
  const byCategory = new Map<string, LowStockItem[]>();
  for (const it of report.items) {
    const key = it.category?.trim() || 'ไม่ระบุหมวดหมู่';
    const list = byCategory.get(key) ?? [];
    list.push(it);
    byCategory.set(key, list);
  }

  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;
  let currentCount = 0;
  let lastCategory = '';

  const flush = () => {
    if (current.length === 0) return;
    chunks.push(current);
    current = [];
    currentLen = 0;
    currentCount = 0;
    lastCategory = '';
  };

  for (const [category, catItems] of byCategory) {
    for (const it of catItems) {
      const line = formatItemLine(it);
      const headerCost = category !== lastCategory ? category.length + 4 : 0;
      const lineCost = line.length + 1;
      if (
        current.length > 0 &&
        (currentLen + headerCost + lineCost > CHUNK_CHAR_BUDGET ||
          currentCount >= CHUNK_MAX_ITEMS)
      ) {
        flush();
      }
      if (category !== lastCategory) {
        current.push(`📂 ${category}`);
        currentLen += category.length + 4;
        lastCategory = category;
      }
      current.push(line);
      currentLen += lineCost;
      currentCount += 1;
    }
  }
  flush();

  const total = chunks.length;
  return chunks.map((lines, idx) => {
    const header =
      total > 1
        ? `[แจ้งเตือนสต็อกต่ำ - ชุดที่ ${idx + 1}/${total}]`
        : `[แจ้งเตือนจัดซื้อ: สต็อกสินค้าต่ำกว่าเกณฑ์]`;
    const parts: string[] = [header];
    if (idx === 0) {
      parts.push(
        `🗓 พบ ${report.items.length} รายการที่ต้องสั่งซื้อเพิ่ม` +
          (report.zeroStock.length ? ` (หมดคลัง ${report.zeroStock.length})` : ''),
      );
    }
    parts.push('', lines.join('\n'));
    if (idx === total - 1) {
      parts.push('', '👉 เปิดใบสั่งซื้อให้เรียบร้อยก่อนของหมดสต็อกครับ');
    }
    return parts.join('\n');
  });
}

export type DailyLowStockOptions = {
  /**
   * When nothing is below threshold, still send a "ทุกอย่างปกติ" message to
   * PURCHASING instead of silently sending nothing. Used by the manual
   * "ตรวจสอบและแจ้งเตือนทันที" button so the operator always gets feedback in
   * LINE. The 09:00 cron leaves this off to avoid a daily all-clear spam.
   */
  announceAllClear?: boolean;
};

/** Compose + send the daily 09:00 summary. Returns null if the sheet read fails. */
export async function sendDailyLowStockSummary(
  options: DailyLowStockOptions = {},
): Promise<{
  delivery: LineDeliveryResult | null;
  report: LowStockReport;
} | null> {
  const report = await buildLowStockReport();
  if (!report) return null;

  if (report.items.length === 0) {
    if (!options.announceAllClear) {
      return { delivery: null, report };
    }
    // ห้ามส่งข้อความว่างให้ LINE — แจ้งว่าสต็อกปกติแทน
    const allClearText =
      `[ตรวจสอบสต็อกสินค้า]\n` +
      `✅ ระบบตรวจสอบสต็อกเสร็จสิ้น: ปัจจุบันสินค้าทุกรายการอยู่ในเกณฑ์ปกติ ` +
      `ไม่มีสินค้าสต็อกต่ำกว่าเกณฑ์`;
    const delivery = await sendLineToRoles(['PURCHASING'], allClearText, {
      notificationType: 'LOW_STOCK_DAILY',
    });
    return { delivery, report };
  }

  // เกิน 900 ตัวอักษรจะถูกตัดแบ่งเป็นหลายข้อความอัตโนมัติ (buildLowStockMessages)
  const texts = buildLowStockMessages(report);
  const delivery = await sendLineTextsToRoles(['PURCHASING'], texts, {
    notificationType: 'LOW_STOCK_DAILY',
  });
  return { delivery, report };
}

/**
 * Fire an urgent alert IMMEDIATELY when an IN/OUT movement drops stock to 0
 * for one or more items. Only items in `affectedCodes` are checked so an
 * unrelated long-zero item never produces a re-spam on every movement.
 */
export async function sendUrgentZeroStockAlert(
  affectedCodes: string[],
): Promise<{ delivery: LineDeliveryResult | null; items: LowStockItem[] } | null> {
  if (affectedCodes.length === 0) return null;
  const schema = await readItemsSheet();
  if (!schema) return null;

  const codeSet = new Set(affectedCodes.map((c) => c.trim()).filter(Boolean));
  if (codeSet.size === 0) return null;

  const thresholds = await readLimitStockSheet();
  const tMap = new Map((thresholds ?? []).map((t) => [t.code, t.threshold]));

  const zeroed: LowStockItem[] = [];
  for (const row of schema.rows as SheetItemRow[]) {
    if (!codeSet.has(row.code)) continue;
    const threshold = tMap.get(row.code) ?? LIMIT_STOCK_DEFAULT_THRESHOLD;
    // เกณฑ์ = 0 หมายถึงปิดแจ้งเตือน — ไม่ยิงแม้สต็อกจะเหลือ 0 หรือติดลบ
    if (threshold <= 0) continue;
    if (row.stock <= 0) {
      zeroed.push({
        code: row.code,
        name: row.name,
        category: row.category,
        stock: row.stock,
        threshold,
        status: row.status,
      });
    }
  }

  if (zeroed.length === 0) return { delivery: null, items: [] };

  const text =
    `[ด่วนที่สุด: สินค้าหมดคลัง!]\n` +
    `🚨 พบ ${zeroed.length} รายการที่ยอดคงเหลือเหลือ 0 ทันที — โปรดเปิด PO ด่วน\n\n` +
    zeroed.map(formatItemLine).join('\n');

  const delivery = await sendLineToRoles(['PURCHASING'], text, {
    notificationType: 'LOW_STOCK_URGENT',
  });
  return { delivery, items: zeroed };
}
