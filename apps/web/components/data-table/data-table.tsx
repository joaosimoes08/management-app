'use client';

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from 'lucide-react';
import { csvFileName, downloadCsv, toCsv, type CsvColumn, type CsvOptions } from './csv';
import { nextSort, sortRows, type SortState, type SortValue } from './table-state';

export type DataTableColumn<Row> = {
  /** Stable id; also the URL value when the column is sorted. */
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Makes the header a sort button. Return a number, date or text; empty values sort last. */
  sortValue?: (row: Row) => SortValue;
  /** Fields this column contributes to the CSV export (a column can export several, or none). */
  csv?: readonly CsvColumn<Row>[];
  className?: string;
};

export type DataTableSelection<Row> = {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Rows that cannot be selected show a disabled checkbox. Default: every row. */
  isSelectable?: (row: Row) => boolean;
  /** Accessible name of each row checkbox. */
  rowLabel: (row: Row, selectable: boolean) => string;
  /** Accessible name of the header "select all visible" checkbox. */
  allLabel: string;
};

export type DataTableProps<Row> = {
  /** The rows to show, already filtered and sorted (see `sortByColumns`). */
  rows: readonly Row[];
  columns: readonly DataTableColumn<Row>[];
  rowKey: (row: Row) => string;
  /** Accessible name of the scrollable table region. */
  label: string;
  className?: string;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /** Order to return to on the third header click. */
  defaultSort?: SortState;
  selection?: DataTableSelection<Row>;
  loading?: boolean;
  /** Shown under the table when it has no rows and is not loading. */
  empty?: ReactNode;
};

/** Sorts rows by a column's `sortValue`; unknown or unsortable columns keep the incoming order. */
export function sortByColumns<Row>(rows: readonly Row[], columns: readonly DataTableColumn<Row>[], sort: SortState): Row[] {
  const column = sort ? columns.find((item) => item.id === sort.column && item.sortValue) : undefined;
  if (!column?.sortValue) return [...rows];
  const valueOf = column.sortValue;
  return sortRows(rows, sort, (row) => valueOf(row));
}

/** Every CSV field declared by the columns, in column order. */
export const csvColumnsOf = <Row,>(columns: readonly DataTableColumn<Row>[]): CsvColumn<Row>[] => columns.flatMap((column) => column.csv ?? []);

const ariaSort = (sort: SortState | undefined, id: string) => (sort?.column === id ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined);

/**
 * The app's dense table (`ip-table-wrap` / `ip-table`) with sortable headers
 * and optional row selection. Presentational: state lives in the page, usually
 * via `useTableUrlState`.
 */
export function DataTable<Row>({ rows, columns, rowKey, label, className, sort, onSortChange, defaultSort = null, selection, loading = false, empty }: DataTableProps<Row>) {
  const selectable = (row: Row) => selection?.isSelectable?.(row) ?? true;
  const selectableKeys = selection ? rows.filter(selectable).map(rowKey) : [];
  const selectedVisible = selection ? selectableKeys.filter((key) => selection.selected.has(key)).length : 0;
  const allSelected = selectableKeys.length > 0 && selectedVisible === selectableKeys.length;
  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    for (const key of selectableKeys) if (allSelected) next.delete(key); else next.add(key);
    selection.onChange(next);
  };
  const toggle = (key: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    selection.onChange(next);
  };

  return <>
    <div className="ip-table-wrap" role="region" aria-label={label} aria-busy={loading} tabIndex={0}>
      <table className={['ip-table', className].filter(Boolean).join(' ')}>
        <thead><tr>
          {selection && <th scope="col"><input
            type="checkbox"
            aria-label={selection.allLabel}
            checked={allSelected}
            ref={(input) => { if (input) input.indeterminate = selectedVisible > 0 && !allSelected; }}
            disabled={!selectableKeys.length}
            onChange={toggleAll}
          /></th>}
          {columns.map((column) => {
            const direction = ariaSort(sort, column.id);
            if (!column.sortValue || !onSortChange) return <th key={column.id} scope="col">{column.header}</th>;
            const Icon = direction === 'ascending' ? ArrowUp : direction === 'descending' ? ArrowDown : ArrowUpDown;
            return <th key={column.id} scope="col" aria-sort={direction}>
              <button type="button" className="data-table-sort" onClick={() => onSortChange(nextSort(sort ?? null, column.id, defaultSort))}>
                {column.header}
                <Icon size={11} aria-hidden="true" />
                {direction && <span className="topology-sr-only">{direction === 'ascending' ? 'ordem crescente' : 'ordem decrescente'}</span>}
              </button>
            </th>;
          })}
        </tr></thead>
        <tbody>{rows.map((row) => {
          const key = rowKey(row);
          const canSelect = selectable(row);
          return <tr key={key}>
            {selection && <td><input type="checkbox" aria-label={selection.rowLabel(row, canSelect)} disabled={!canSelect} checked={selection.selected.has(key)} onChange={() => toggle(key)} /></td>}
            {columns.map((column) => <td key={column.id} className={column.className}>{column.cell(row)}</td>)}
          </tr>;
        })}</tbody>
      </table>
    </div>
    {!loading && !rows.length && empty}
  </>;
}

export type CsvExportButtonProps<Row> = {
  rows: readonly Row[];
  columns: readonly CsvColumn<Row>[];
  /** File name without date or extension, e.g. `ativos-criticos`. */
  fileName: string;
  options?: CsvOptions;
  label?: string;
};

/** Downloads exactly the rows passed in (the filtered, sorted view). */
export function CsvExportButton<Row>({ rows, columns, fileName, options, label = 'Exportar CSV' }: CsvExportButtonProps<Row>) {
  return <button type="button" className="secondary-button" disabled={!rows.length} onClick={() => downloadCsv(csvFileName(fileName), toCsv(rows, columns, options))}>
    <Download size={14} /> {label}
  </button>;
}
