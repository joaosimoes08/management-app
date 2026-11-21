/**
 * CSV export of the rows a table currently shows.
 *
 * Defaults are chosen for Excel in a pt-PT locale: `;` as separator (Excel's
 * list separator when the decimal mark is a comma), CRLF line ends and a UTF-8
 * byte-order mark so accents (ç, ã, é) open correctly.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;
export type CsvColumn<Row> = { header: string; value: (row: Row) => CsvValue };
export type CsvOptions = { delimiter?: string; bom?: boolean };

export const CSV_BOM = '﻿';

/** Text cells starting with these could run as a formula in a spreadsheet (CSV injection). */
const formulaStart = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue, delimiter = ';'): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && formulaStart.test(text)) text = `'${text}`;
  const needsQuotes = text.includes(delimiter) || /["\r\n]/.test(text) || text !== text.trim();
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[], options: CsvOptions = {}): string {
  const delimiter = options.delimiter ?? ';';
  const lines = [columns.map((column) => csvCell(column.header, delimiter)).join(delimiter)];
  for (const row of rows) lines.push(columns.map((column) => csvCell(column.value(row), delimiter)).join(delimiter));
  return `${options.bom === false ? '' : CSV_BOM}${lines.join('\r\n')}\r\n`;
}

/** `ativos-criticos-2026-11-21.csv` — the date is the local calendar day of the export. */
export function csvFileName(base: string, now = new Date()): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `${base}-${day}.csv`;
}

export function downloadCsv(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
