import { afterEach, describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatNumber, getFormatLocale, isLocalDateTime, setFormatLocale } from './date';

const iso = '2026-03-05T14:07:09Z';

afterEach(() => setFormatLocale('pt-PT'));

describe('shared formatters', () => {
  it('defaults to pt-PT with output identical to the old hard-coded calls', () => {
    expect(getFormatLocale()).toBe('pt-PT');
    expect(formatDateTime(iso)).toBe(new Date(iso).toLocaleString('pt-PT'));
    expect(formatDateTime(iso, { dateStyle: 'medium', timeStyle: 'short' })).toBe(new Date(iso).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }));
    expect(formatDate(iso)).toBe(new Date(iso).toLocaleDateString('pt-PT'));
    expect(formatDate(new Date(2026, 2, 1), { month: 'long', year: 'numeric' })).toBe(new Date(2026, 2, 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' }));
    expect(formatDateTime(iso, { day: '2-digit', month: 'short', timeZone: 'UTC' })).toBe(new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(iso)));
    expect(formatNumber(1234567.891, { maximumFractionDigits: 2 })).toBe(new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 }).format(1234567.891));
  });

  it('follows the app language once it is set', () => {
    setFormatLocale('en-US');
    expect(formatDateTime(iso, { timeZone: 'UTC' })).toBe('3/5/2026, 2:07:09 PM');
    expect(formatDate(iso, { timeZone: 'UTC' })).toBe('3/5/2026');
    expect(formatNumber(1234.5)).toBe('1,234.5');
  });

  it('accepts an explicit time zone and locale', () => {
    expect(formatDateTime(iso, { timeZone: 'UTC' })).toBe('05/03/2026, 14:07:09');
    expect(formatDateTime(iso, { timeZone: 'Asia/Tokyo' })).toBe('05/03/2026, 23:07:09');
    expect(formatDateTime(iso, { locale: 'en-US', timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })).toBe('Mar 5, 2026, 2:07 PM');
  });
});

describe('isLocalDateTime', () => {
  it.each(['2026-11-21T00:00', '2026-11-21T23:59'])('accepts %s', (value) => {
    expect(isLocalDateTime(value)).toBe(true);
  });

  it.each(['', 'T17:00', '2026-11-21T', '2026-11-21T24:00', '2026-11-21T13:60', '2026-11-21T1:05', '2026-11-21T13:00Z'])('rejects %s', (value) => {
    expect(isLocalDateTime(value)).toBe(false);
  });
});
