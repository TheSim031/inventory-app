import { describe, it, expect } from 'vitest';
import {
  bangkokTodayISO,
  getBangkokMonthKey,
  getBangkokDayOfMonth,
  isoForPickedDate,
  formatThaiDateTime,
} from './dateTime';

describe('bangkokTodayISO', () => {
  it('returns the Bangkok calendar date (rolls over with +7 offset)', () => {
    expect(bangkokTodayISO(new Date('2026-06-03T18:00:00Z'))).toBe('2026-06-04');
    expect(bangkokTodayISO(new Date('2026-06-03T10:00:00Z'))).toBe('2026-06-03');
  });
});

describe('getBangkokMonthKey', () => {
  it('returns YYYY-MM in Bangkok time', () => {
    expect(getBangkokMonthKey(new Date('2026-06-30T18:00:00Z'))).toBe('2026-07');
  });
});

describe('getBangkokDayOfMonth', () => {
  it('returns the day number in Bangkok time', () => {
    expect(getBangkokDayOfMonth(new Date('2026-06-03T18:00:00Z'))).toBe(4);
  });
});

describe('isoForPickedDate', () => {
  it('falls back to now for missing or malformed input', () => {
    const now = new Date('2026-06-03T05:00:00Z');
    expect(isoForPickedDate(undefined, now)).toBe(now.toISOString());
    expect(isoForPickedDate('not-a-date', now)).toBe(now.toISOString());
  });

  it('anchors to the picked Bangkok date', () => {
    const now = new Date('2026-06-03T05:00:00Z'); // 12:00 Bangkok
    const iso = isoForPickedDate('2026-01-15', now);
    // Same Bangkok day should be preserved when rendered in Bangkok tz.
    expect(bangkokTodayISO(new Date(iso))).toBe('2026-01-15');
  });
});

describe('formatThaiDateTime', () => {
  it('returns a dash for empty/invalid values', () => {
    expect(formatThaiDateTime(null)).toBe('-');
    expect(formatThaiDateTime('')).toBe('-');
    expect(formatThaiDateTime('garbage')).toBe('-');
  });

  it('formats a valid date to a non-empty Thai string', () => {
    const out = formatThaiDateTime('2026-06-03T05:00:00Z');
    expect(out).not.toBe('-');
    expect(out.length).toBeGreaterThan(0);
  });
});
