import { describe, it, expect } from 'vitest';
import { buildCsv, csvDateStamp } from './csv';

describe('buildCsv', () => {
  it('joins headers and rows with CRLF', () => {
    const csv = buildCsv(['a', 'b'], [['1', '2'], ['3', '4']]);
    expect(csv).toBe('a,b\r\n1,2\r\n3,4');
  });

  it('quotes fields containing commas, quotes, or newlines', () => {
    const csv = buildCsv(
      ['name', 'note'],
      [['สมชาย, ใจดี', 'line1\nline2'], ['quote "x"', 'ok']],
    );
    expect(csv).toBe(
      'name,note\r\n"สมชาย, ใจดี","line1\nline2"\r\n"quote ""x""",ok',
    );
  });

  it('renders null/undefined as empty strings', () => {
    const csv = buildCsv(['a', 'b', 'c'], [[null, undefined, 0]]);
    expect(csv).toBe('a,b,c\r\n,,0');
  });
});

describe('csvDateStamp', () => {
  it('formats a date as YYYY-MM-DD in Bangkok time', () => {
    // 2026-06-03T18:00:00Z → 2026-06-04 01:00 in Bangkok (+7)
    const stamp = csvDateStamp(new Date('2026-06-03T18:00:00Z'));
    expect(stamp).toBe('2026-06-04');
  });

  it('keeps the same day before the +7 rollover', () => {
    const stamp = csvDateStamp(new Date('2026-06-03T10:00:00Z'));
    expect(stamp).toBe('2026-06-03');
  });
});
