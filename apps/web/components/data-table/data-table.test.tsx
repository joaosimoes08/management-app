import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CsvExportButton, DataTable, csvColumnsOf, sortByColumns, type DataTableColumn } from './data-table';
import { useTableUrlState } from './use-table-url-state';
import type { TableStateConfig } from './table-state';

type Row = { id: string; name: string; size: number | null; locked?: boolean };
const rows: Row[] = [{ id: 'r1', name: 'Bravo', size: 2 }, { id: 'r2', name: 'alfa', size: null, locked: true }, { id: 'r3', name: 'Charlie', size: 10 }];
const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Nome', cell: (row) => row.name, sortValue: (row) => row.name, csv: [{ header: 'Nome', value: (row) => row.name }] },
  { id: 'size', header: 'Tamanho', cell: (row) => row.size ?? '—', sortValue: (row) => row.size, csv: [{ header: 'Tamanho', value: (row) => row.size }, { header: 'Bloqueado', value: (row) => (row.locked ? 'sim' : 'não') }] },
  { id: 'actions', header: 'Ações', cell: () => <button>Abrir</button>, className: 'table-actions' },
];
const config: TableStateConfig<{ kind: string }> = { filters: { kind: '' }, sortable: ['name', 'size'] };

function Harness({ selectable = true }: { selectable?: boolean }) {
  const table = useTableUrlState(config);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const visible = rows.filter((row) => !table.search || row.name.toLowerCase().includes(table.search.toLowerCase())).filter((row) => !table.filters.kind || (table.filters.kind === 'locked') === Boolean(row.locked));
  const sorted = sortByColumns(visible, columns, table.sort);
  return <>
    <input aria-label="Pesquisa" value={table.search} onChange={(event) => table.setSearch(event.target.value)} />
    <select aria-label="Tipo" value={table.filters.kind} onChange={(event) => table.setFilter('kind', event.target.value)}><option value="">Todos</option><option value="locked">Bloqueados</option></select>
    {table.filtering && <button onClick={table.clearFilters}>Limpar filtros</button>}
    <CsvExportButton rows={sorted} columns={csvColumnsOf(columns)} fileName="teste" />
    <output aria-label="Selecionados">{[...selected].join(',')}</output>
    <DataTable
      rows={sorted} columns={columns} rowKey={(row) => row.id} label="Tabela de teste" className="extra"
      sort={table.sort} onSortChange={table.setSort} defaultSort={table.defaultSort}
      selection={selectable ? { selected, onChange: setSelected, isSelectable: (row) => !row.locked, rowLabel: (row, ok) => (ok ? `Selecionar ${row.name}` : `${row.name} bloqueado`), allLabel: 'Selecionar todos' } : undefined}
      empty={<p>Sem linhas</p>}
    />
  </>;
}

const names = () => [...document.querySelectorAll('tbody tr')].map((row) => row.querySelectorAll('td')[1]?.textContent);
const header = (name: RegExp) => screen.getByRole('columnheader', { name });

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', '/pagina?siteId=s1'));

describe('DataTable', () => {
  it('renders the existing table classes, a keyboard-reachable region and plain headers for unsortable columns', () => {
    render(<Harness />);
    const region = screen.getByRole('region', { name: 'Tabela de teste' });
    expect(region).toHaveClass('ip-table-wrap');
    expect(region).toHaveAttribute('tabindex', '0');
    expect(within(region).getByRole('table')).toHaveClass('ip-table', 'extra');
    expect(within(header(/Ações/)).queryByRole('button')).not.toBeInTheDocument();
    expect(header(/Ações/)).not.toHaveAttribute('aria-sort');
    expect(document.querySelector('td.table-actions')).toBeInTheDocument();
  });

  it('sorts from the header with aria-sort and a text status, and stores the sort in the URL', () => {
    render(<Harness />);
    expect(names()).toEqual(['Bravo', 'alfa', 'Charlie']);
    const nameButton = within(header(/Nome/)).getByRole('button');
    fireEvent.click(nameButton);
    expect(header(/Nome/)).toHaveAttribute('aria-sort', 'ascending');
    expect(nameButton).toHaveTextContent('ordem crescente');
    expect(names()).toEqual(['alfa', 'Bravo', 'Charlie']);
    expect(window.location.search).toBe('?siteId=s1&sort=name');
    fireEvent.click(nameButton);
    expect(header(/Nome/)).toHaveAttribute('aria-sort', 'descending');
    expect(nameButton).toHaveTextContent('ordem decrescente');
    expect(names()).toEqual(['Charlie', 'Bravo', 'alfa']);
    expect(window.location.search).toBe('?siteId=s1&sort=-name');
    fireEvent.click(nameButton);
    expect(header(/Nome/)).not.toHaveAttribute('aria-sort');
    expect(names()).toEqual(['Bravo', 'alfa', 'Charlie']);
    expect(window.location.search).toBe('?siteId=s1');
    // Empty sizes go last in both directions.
    fireEvent.click(within(header(/Tamanho/)).getByRole('button'));
    expect(names()).toEqual(['Bravo', 'Charlie', 'alfa']);
    fireEvent.click(within(header(/Tamanho/)).getByRole('button'));
    expect(names()).toEqual(['Charlie', 'Bravo', 'alfa']);
  });

  it('restores filters and sort from a shared URL, and back/forward step through changes', () => {
    window.history.replaceState(null, '', '/pagina?siteId=s1&kind=locked&sort=-name');
    render(<Harness />);
    expect(screen.getByLabelText('Tipo')).toHaveValue('locked');
    expect(header(/Nome/)).toHaveAttribute('aria-sort', 'descending');
    expect(names()).toEqual(['alfa']);
    const before = window.history.length;
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: '' } });
    expect(window.history.length).toBe(before + 1);
    expect(window.location.search).toBe('?siteId=s1&sort=-name');
    expect(names()).toEqual(['Charlie', 'Bravo', 'alfa']);
    // Simulate the back button: the browser restores the previous address and fires popstate.
    act(() => { window.history.replaceState(null, '', '/pagina?siteId=s1&kind=locked&sort=-name'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.getByLabelText('Tipo')).toHaveValue('locked');
    expect(names()).toEqual(['alfa']);
  });

  it('keeps typing in one history entry and clears search and filters but not the sort', () => {
    render(<Harness />);
    fireEvent.click(within(header(/Nome/)).getByRole('button'));
    const before = window.history.length;
    fireEvent.change(screen.getByLabelText('Pesquisa'), { target: { value: 'b' } });
    fireEvent.change(screen.getByLabelText('Pesquisa'), { target: { value: 'br' } });
    expect(window.history.length).toBe(before);
    expect(new URLSearchParams(window.location.search).get('q')).toBe('br');
    expect(names()).toEqual(['Bravo']);
    fireEvent.change(screen.getByLabelText('Pesquisa'), { target: { value: 'zzz' } });
    expect(screen.getByText('Sem linhas')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(window.location.search).toBe('?siteId=s1&sort=name');
    expect(names()).toEqual(['alfa', 'Bravo', 'Charlie']);
  });

  it('selects all visible selectable rows, shows a mixed state and skips locked rows', () => {
    render(<Harness />);
    const all = screen.getByRole('checkbox', { name: 'Selecionar todos' }) as HTMLInputElement;
    expect(screen.getByRole('checkbox', { name: 'alfa bloqueado' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Bravo' }));
    expect(all.indeterminate).toBe(true);
    expect(all).not.toBeChecked();
    fireEvent.click(all);
    expect(screen.getByLabelText('Selecionados')).toHaveTextContent('r1,r3');
    expect(all).toBeChecked();
    expect(all.indeterminate).toBe(false);
    // Hidden rows keep their selection when "select all" is cleared for the visible ones.
    fireEvent.change(screen.getByLabelText('Pesquisa'), { target: { value: 'char' } });
    fireEvent.click(all);
    expect(screen.getByLabelText('Selecionados')).toHaveTextContent('r1');
  });

  it('has no checkbox column without a selection', () => {
    render(<Harness selectable={false} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
  });

  it('exports exactly the filtered, sorted rows as CSV with a BOM', async () => {
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:test'; });
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toMatch(/^teste-\d{4}-\d{2}-\d{2}\.csv$/); });
    render(<Harness />);
    fireEvent.click(within(header(/Tamanho/)).getByRole('button'));
    fireEvent.click(within(header(/Tamanho/)).getByRole('button'));
    fireEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(blobs[0].type).toBe('text/csv;charset=utf-8');
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('Nome;Tamanho;Bloqueado\r\nCharlie;10;não\r\nBravo;2;não\r\nalfa;;sim\r\n');
    fireEvent.change(screen.getByLabelText('Pesquisa'), { target: { value: 'zzz' } });
    expect(screen.getByRole('button', { name: /Exportar CSV/ })).toBeDisabled();
    click.mockRestore();
  });
});
