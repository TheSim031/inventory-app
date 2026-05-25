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
import { sendLineToRoles, type LineDeliveryResult } from './lineNotify';

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

/** Compose + send the daily 09:00 summary. Returns null if nothing to send. */
export async function sendDailyLowStockSummary(): Promise<{
  delivery: LineDeliveryResult | null;
  report: LowStockReport;
} | null> {
  const report = await buildLowStockReport();
  if (!report) return null;

  if (report.items.length === 0) {
    return { delivery: null, report };
  }

  const head =
    `[แจ้งเตือนจัดซื้อ: สต็อกสินค้าต่ำกว่าเกณฑ์]\n` +
    `🗓 รายงานประจำวัน — พบ ${report.items.length} รายการที่ต้องสั่งซื้อเพิ่ม`;
  const sections: string[] = [head];

  if (report.zeroStock.length > 0) {
    sections.push(
      `\n‼ หมดคลังทันที (${report.zeroStock.length} รายการ)\n` +
        report.zeroStock.map(formatItemLine).join('\n'),
    );
  }
  if (report.belowThreshold.length > 0) {
    sections.push(
      `\n⚠ ต่ำกว่าเกณฑ์ (${report.belowThreshold.length} รายการ)\n` +
        report.belowThreshold.map(formatItemLine).join('\n'),
    );
  }
  sections.push(`\n👉 เปิดใบสั่งซื้อให้เรียบร้อยก่อนของหมดสต็อกครับ`);

  const text = sections.join('\n');
  const delivery = await sendLineToRoles(['PURCHASING'], text);
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
    if (row.stock <= 0) {
      zeroed.push({
        code: row.code,
        name: row.name,
        category: row.category,
        stock: row.stock,
        threshold: tMap.get(row.code) ?? LIMIT_STOCK_DEFAULT_THRESHOLD,
        status: row.status,
      });
    }
  }

  if (zeroed.length === 0) return { delivery: null, items: [] };

  const text =
    `[ด่วนที่สุด: สินค้าหมดคลัง!]\n` +
    `🚨 พบ ${zeroed.length} รายการที่ยอดคงเหลือเหลือ 0 ทันที — โปรดเปิด PO ด่วน\n\n` +
    zeroed.map(formatItemLine).join('\n');

  const delivery = await sendLineToRoles(['PURCHASING'], text);
  return { delivery, items: zeroed };
}
