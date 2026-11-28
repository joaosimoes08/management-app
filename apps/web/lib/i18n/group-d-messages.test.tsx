import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientErrorMessage } from '@/lib/api/errors';
import { translateMessage } from './i18n';

// Shared UI follows the active language through useOptionalI18n; render it in English here.
vi.mock('@/lib/i18n/i18n', async (importOriginal) => {
  const real = await importOriginal<typeof import('./i18n')>();
  return { ...real, useOptionalI18n: () => ({ locale: 'en-US', t: (key: string, fallback?: string, params?: Record<string, string | number>) => real.translateMessage('en-US', key, fallback, params) }) };
});

afterEach(cleanup);

describe('i18n group D (shell-wide, app, lib)', () => {
  it('has English text for the app, help, portal, setup and bulk-review keys', () => {
    expect(translateMessage('en-US', 'app.error.title')).toBe('Something went wrong.');
    expect(translateMessage('en-US', 'app.notFound.back')).toBe('Back to the dashboard');
    expect(translateMessage('en-US', 'help.back')).toBe('Back to help');
    expect(translateMessage('en-US', 'setup.error.site')).toBe('Could not create the site.');
    expect(translateMessage('en-US', 'portal.appCount', undefined, { count: 1 })).toBe('1 application');
    expect(translateMessage('en-US', 'portal.appCount', undefined, { count: 3 })).toBe('3 applications');
    expect(translateMessage('pt-PT', 'portal.appCount', undefined, { count: 1 })).toBe('1 aplicação');
    expect(translateMessage('pt-PT', 'portal.appCount', undefined, { count: 3 })).toBe('3 aplicações');
    expect(translateMessage('en-US', 'portal.checkAll.progress', undefined, { done: 2, total: 5 })).toBe('2 of 5 checked');
    expect(translateMessage('en-US', 'ui.bulk.selected', undefined, { count: 2, noun: 'resultados' })).toMatch(/^2 items selected\./);
    expect(translateMessage('pt-PT', 'ui.bulk.selected', undefined, { count: 2, noun: 'resultados' })).toMatch(/^2 resultados selecionados\./);
    expect(translateMessage('pt-PT', 'ui.bulk.selected', undefined, { count: 1, noun: 'resultados' })).toMatch(/^1 item selecionado\./);
  });

  it('localizes the errors the API client raises itself', () => {
    expect(clientErrorMessage('sessionExpired', 'en-US')).toBe('Session expired');
    expect(clientErrorMessage('requestFailed', 'en-US', 502)).toBe('Request failed (502)');
    expect(clientErrorMessage('requestFailed', 'pt-PT', 502)).toBe('Pedido falhou (502)');
    expect(clientErrorMessage('exportFailed', 'en-US', 403)).toBe('Export failed (403)');
  });


  it('renders the bulk review dialog in English', async () => {
    const { BulkReviewDialog } = await import('@/features/discovery/bulk-review-dialog');
    const run = vi.fn().mockResolvedValue({ total: 2, succeeded: 1, items: [{ id: 'a', ok: true, status: 'APPROVED' }, { id: 'b', ok: false }] });
    render(<BulkReviewDialog title="Approve" actionLabel="Approve" noun="results" items={[{ id: 'a', label: '10.0.0.1' }, { id: 'b', label: '10.0.0.2' }]} run={run} close={vi.fn()} />);
    expect(screen.getByText(/2 items selected\. Each item is checked separately/)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Result' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2' }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 of 2 applied.');
    expect(screen.getByText('Applied · APPROVED')).toBeInTheDocument();
    expect(screen.getByText('Could not apply the review to this item.')).toBeInTheDocument();
    // The dialog's header X (CompactModal) and its footer button.
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(2);
  });
});
