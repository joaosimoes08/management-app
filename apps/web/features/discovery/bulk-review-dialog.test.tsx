import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api/errors';
import { BULK_REVIEW_MAX, BulkReviewDialog, bulkItemErrorMessage } from './bulk-review-dialog';

afterEach(cleanup);
const items = [{ id: 'a', label: '10.0.0.1', detail: 'host-a' }, { id: 'b', label: '10.0.0.2' }];

describe('BulkReviewDialog', () => {
  it('runs once and lists the per-item outcome, including unknown codes and extra fields', async () => {
    const run = vi.fn().mockResolvedValue({ status: 'APPROVED', total: 2, succeeded: 1, failed: 1, futureField: 'x', items: [
      { id: 'a', ok: true, status: 'APPROVED', addedLater: 1 },
      { id: 'b', ok: false, error: { statusCode: 409, code: 'SOMETHING_NEW', message: 'Já foi revisto por outra pessoa.' } },
    ] });
    const onDone = vi.fn();
    render(<BulkReviewDialog title="Aprovar resultados selecionados" actionLabel="Aprovar" noun="resultados" items={items} run={run} onDone={onDone} close={vi.fn()} />);
    expect(screen.getByText(/2 resultados selecionados/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar 2' }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 de 2 aplicados.');
    const rows = within(screen.getByRole('region', { name: 'Itens da revisão em massa' })).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Aplicado · APPROVED');
    expect(rows[1]).toHaveTextContent('Falhou');
    expect(rows[1]).toHaveTextContent('Já foi revisto por outra pessoa.');
    expect(run).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Aprovar 2' })).not.toBeInTheDocument();
  });

  it('shows the API message when the whole request fails (e.g. 400) and allows a retry', async () => {
    const run = vi.fn().mockRejectedValueOnce(new ApiRequestError('ids must contain at most 200 elements', 400, { code: 'VALIDATION_ERROR' })).mockResolvedValue({ items: [{ id: 'a', ok: true }, { id: 'b', ok: true }] });
    render(<BulkReviewDialog title="Ignorar" actionLabel="Ignorar" noun="resultados" items={items} run={run} close={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ignorar 2' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ids must contain at most 200 elements');
    fireEvent.click(screen.getByRole('button', { name: 'Ignorar 2' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 de 2 aplicados.'));
  });

  it('blocks more than the API maximum', () => {
    const many = Array.from({ length: BULK_REVIEW_MAX + 1 }, (_, index) => ({ id: `id-${index}`, label: `item ${index}` }));
    render(<BulkReviewDialog title="Aprovar" actionLabel="Aprovar" noun="resultados" items={many} run={vi.fn()} close={vi.fn()} />);
    expect(screen.getByRole('note')).toHaveTextContent('no máximo 200');
    expect(screen.getByRole('button', { name: `Aprovar ${BULK_REVIEW_MAX + 1}` })).toBeDisabled();
  });

  it('falls back from message to code to a generic text', () => {
    expect(bulkItemErrorMessage({ id: 'x', ok: false, error: { message: ['a', 'b'] } }, 'fallback')).toBe('a b');
    expect(bulkItemErrorMessage({ id: 'x', ok: false, error: { code: 'NEW_CODE' } }, 'fallback')).toBe('NEW_CODE');
    expect(bulkItemErrorMessage({ id: 'x', ok: false }, 'fallback')).toBe('fallback');
  });
});
