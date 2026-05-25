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
