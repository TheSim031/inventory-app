/**
 * Tiny client-side CSV builder + downloader. No dependency — we generate the
 * text, prepend a UTF-8 BOM so Excel opens Thai correctly, and trigger a
 * browser download via an object URL.
 */

/** Quote a single field per RFC 4180 (wrap + double any embedded quotes). */
function escapeField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build CSV text from a header row + data rows. */
export function buildCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeField).join(','));
  return lines.join('\r\n');
}

/**
 * Build a CSV and prompt the browser to download it. `filename` should include
 * the `.csv` extension; a timestamp is not added automatically.
 */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<unknown>>,
): void {
  if (typeof document === 'undefined') return;
  const csv = buildCsv(headers, rows);
  // ﻿ = UTF-8 BOM, required for Excel to detect Thai (UTF-8) correctly.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** A date stamp like 2026-06-03 for filenames, in Bangkok time. */
export function csvDateStamp(d: Date = new Date()): string {
  const bkk = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return bkk.toISOString().slice(0, 10);
}
