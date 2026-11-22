import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QualityBulkDialog } from '@/features/operations/quality-bulk-dialog';
import { BulkConfirmDialog } from '@/features/critical-assets/critical-assets-dialogs';

afterEach(cleanup);

const headers = (region: HTMLElement) => within(region).getAllByRole('columnheader').map((cell) => cell.textContent);
const cells = (region: HTMLElement) => within(region).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent));

describe('bulk result tables on the shared DataTable', () => {
  it('quality bulk results keep their styling hook, headers and per-finding badges', () => {
    render(<QualityBulkDialog action="ACKNOWLEDGE" count={2} assignees={[]} running={false} close={vi.fn()} run={vi.fn()}
      outcome={{ action: 'ACKNOWLEDGE', succeeded: 1, failed: 1, items: [{ id: 'f1', title: 'Sem dono', ok: true, message: 'Reconhecido' }, { id: 'f2', title: 'Serial duplicado', ok: false, message: 'Sem permissão neste Site' }] }} />);
    const region = screen.getByRole('region', { name: 'Resultado por finding' });
    expect(region).toHaveClass('ip-table-wrap');
    expect(region.closest('.quality-bulk-results')).not.toBeNull();
    expect(headers(region)).toEqual(['Finding', 'Resultado']);
    expect(cells(region)).toEqual([['Sem dono', 'Reconhecido'], ['Serial duplicado', 'Sem permissão neste Site']]);
    expect(within(region).getByText('Sem permissão neste Site').closest('.state-badge')).toHaveClass('excluded');
  });

  it('critical-asset bulk review keeps its table class and shows pending, then recorded, states', () => {
    const items = [{ key: 'a', attestationId: 't1', assetName: 'Core-SW-01', weekStart: '2026-11-16' }, { key: 'b', attestationId: 't2', assetName: 'FW-02', weekStart: '2026-11-16' }];
    const props = { selectedCount: 2, olderCount: 0, items, running: false, formatDate: (value?: string | null) => `d:${value}`, close: vi.fn(), run: vi.fn() };
    const { rerender } = render(<BulkConfirmDialog {...props} results={null} />);
    const region = screen.getByRole('region', { name: 'Revisões a confirmar' });
    expect(within(region).getByRole('table')).toHaveClass('ip-table', 'critical-assets-bulk-table');
    expect(headers(region)).toEqual(['Equipamento', 'Semana', 'Estado']);
    expect(cells(region)).toEqual([['Core-SW-01', 'd:2026-11-16', 'Por registar'], ['FW-02', 'd:2026-11-16', 'Por registar']]);
    rerender(<BulkConfirmDialog {...props} results={{ a: { key: 'a', state: 'recorded' }, b: { key: 'b', state: 'failed', message: 'Sem acesso' } }} />);
    const after = screen.getByRole('region', { name: 'Revisões a confirmar' });
    expect(within(after).getByText('Sem acesso')).toBeInTheDocument();
    expect(after.querySelectorAll('.state-badge')).toHaveLength(2);
  });
});
