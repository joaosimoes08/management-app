import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LifecycleDates } from './lifecycle-dates';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch }));
vi.mock('@/features/operations/api', () => ({ getInventoryQualityAssignees: vi.fn() }));
vi.mock('../api', () => ({ listInfrastructureGroups: vi.fn() }));

const date = new Date();
const dueDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-15`;
const lifecycleItem = {
  id: 'lifecycle-1', deviceId: 'device-1',
  device: { id: 'device-1', name: 'Core switch', type: 'SWITCH', siteId: 'site-1' },
  kind: 'WARRANTY', dueDate, reminderDays: [30, 7, 0],
  responsibleUserId: null, responsibleGroupId: null,
  site: { id: 'site-1', name: 'Main site' },
};

function renderCalendar(canEdit: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><LifecycleDates siteId="site-1" devices={[{ id: 'device-1', name: 'Core switch', type: 'SWITCH', status: 'ACTIVE' }]} canEdit={canEdit} /></QueryClientProvider>);
}

describe('LifecycleDates read-only access', () => {
  beforeEach(() => apiFetch.mockReset().mockResolvedValue({ items: [lifecycleItem] }));
  afterEach(cleanup);

  it('lets read-only users view a calendar event and reminders without edit or delete controls', async () => {
    renderCalendar(false);
    const event = await screen.findByRole('button', { name: /Garantia: Core switch/ });
    fireEvent.click(event);

    expect(await screen.findByRole('dialog', { name: 'Detalhe da cobertura' })).toBeInTheDocument();
    expect(screen.getByText('30 dias antes, 7 dias antes, Na data')).toBeInTheDocument();
    expect(screen.queryByLabelText('Data de fim')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog').querySelector('footer button')).toHaveTextContent('Fechar');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0]).toContain('/api/v1/lifecycle-dates?');
  });

  it('lets read-only users open a list row as details without edit actions', async () => {
    renderCalendar(false);
    fireEvent.click(screen.getByRole('button', { name: 'Lista' }));
    fireEvent.click(await screen.findByRole('button', { name: /Core switch/ }));

    expect(await screen.findByRole('dialog', { name: 'Detalhe da cobertura' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover' })).not.toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('does not offer create controls to read-only users', async () => {
    renderCalendar(false);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Nova data' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Adicionar data em/ })).not.toBeInTheDocument();
  });
});
