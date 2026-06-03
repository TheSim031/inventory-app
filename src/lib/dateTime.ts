export const APP_TIME_ZONE = 'Asia/Bangkok';
export const APP_LOCALE = 'th-TH';

export function formatThaiDateTime(value: string | number | Date | null | undefined): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function getBangkokMonthKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const month = parts.find((p) => p.type === 'month')?.value ?? '00';
  return `${year}-${month}`;
}

export function getBangkokDayOfMonth(date = new Date()): number {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    day: 'numeric',
  }).format(date);
  return Number(day);
}

/**
 * Today's date in YYYY-MM-DD (Bangkok). Used as the default value of the
 * date-picker inputs on the request / internal-pick forms.
 */
export function bangkokTodayISO(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

/**
 * Compose an ISO timestamp anchored to a user-picked date (YYYY-MM-DD).
 * The date portion is preserved when rendered in Bangkok TZ; the time-of-day
 * comes from the current Bangkok clock. This keeps "วันที่" stable on the
 * sheet even when admin back-dates an entry, while still sorting correctly.
 *
 * Falls back to `now` when pickedDate is missing or malformed.
 */
export function isoForPickedDate(
  pickedDate: string | null | undefined,
  now = new Date(),
): string {
  if (!pickedDate || !/^\d{4}-\d{2}-\d{2}$/.test(pickedDate)) {
    return now.toISOString();
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '12';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const ss = parts.find((p) => p.type === 'second')?.value ?? '00';
  // Bangkok offset is +07:00 (no DST in Thailand).
  const candidate = new Date(`${pickedDate}T${hh}:${mm}:${ss}+07:00`);
  if (Number.isNaN(candidate.getTime())) return now.toISOString();
  return candidate.toISOString();
}
