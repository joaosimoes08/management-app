import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSV_BOM, CSV_URL_REVOKE_DELAY_MS, csvCell, csvFileName, downloadCsv, toCsv } from './csv';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('CSV export', () => {
  it('escapes separators, quotes, line breaks and edge spaces', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line 1\nline 2')).toBe('"line 1\nline 2"');
    expect(csvCell('cr\r')).toBe('"cr\r"');
    expect(csvCell(' padded ')).toBe('" padded "');
    expect(csvCell('a,b')).toBe('a,b');
    expect(csvCell('a,b', ',')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(new Date('2026-11-21T10:00:00.000Z'))).toBe('2026-11-21T10:00:00.000Z');
  });

  it('neutralises text that a spreadsheet would run as a formula, but not numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+351')).toBe("'+351");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell(-1)).toBe('-1');
  });

  it('starts with a UTF-8 BOM, uses CRLF and keeps pt-PT accents', () => {
    const rows = [{ name: 'Comutação núcleo', site: 'Évora; Sé' }, { name: 'Router', site: null }];
    const csv = toCsv(rows, [{ header: 'Equipamento', value: (row) => row.name }, { header: 'Localização', value: (row) => row.site }]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1)).toBe('Equipamento;Localização\r\nComutação núcleo;"Évora; Sé"\r\nRouter;\r\n');
    expect(toCsv(rows, [{ header: 'n', value: (row) => row.name }], { bom: false, delimiter: ',' })).toBe('n\r\nComutação núcleo\r\nRouter\r\n');
  });

  it('names the file after the local export day', () => {
    expect(csvFileName('ativos-criticos', new Date(2026, 0, 5, 23, 30))).toBe('ativos-criticos-2026-01-05.csv');
  });

  it('keeps the blob URL alive for a moment after the click so the download can start', () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:csv'), revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadCsv('ativos.csv', 'a;b');
    expect(click).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CSV_URL_REVOKE_DELAY_MS - 1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith('blob:csv');
    expect(CSV_URL_REVOKE_DELAY_MS).toBeGreaterThanOrEqual(1000);
  });
});
