import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PortalPage from './portal-page';
import type { ApplicationLink } from './api';

const mocks = vi.hoisted(() => ({ listApplicationLinks: vi.fn(), updateApplicationLink: vi.fn(), removeApplicationLink: vi.fn() }));

vi.mock('./api', () => ({
  listApplicationLinks: mocks.listApplicationLinks, updateApplicationLink: mocks.updateApplicationLink, removeApplicationLink: mocks.removeApplicationLink,
  createApplicationLink: vi.fn(), checkApplicationLink: vi.fn(),
}));
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: () => true }) }));

const link: ApplicationLink = { id: 'link-1', name: 'Zabbix', url: 'https://zabbix.interno', icon: 'Activity', description: 'Monitorização', category: 'Operações', sortOrder: 0, isActive: true, checkAvailability: false, roles: [{ role: 'AUDITOR' }] };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PortalPage /></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PortalPage role chips', () => {
  it('edits authorised roles with chips from the API role list instead of free text', async () => {
    mocks.listApplicationLinks.mockResolvedValue([link]);
    mocks.updateApplicationLink.mockResolvedValue(link);
    renderPage();
    fireEvent.click(await screen.findByTitle('Editar'));

    const group = screen.getByRole('group', { name: 'Roles autorizadas · sem seleção, visível para todos' });
    const chips = within(group).getAllByRole('checkbox');
    expect(chips.map((chip) => chip.closest('label')?.textContent?.trim())).toEqual(['Administrador', 'Operador de rede', 'Operador de sistemas', 'Auditor', 'Apenas leitura']);
    expect(within(group).getByRole('checkbox', { name: 'Auditor' })).toBeChecked();
    expect(screen.queryByPlaceholderText('ADMIN, NETWORK_OPERATOR')).not.toBeInTheDocument();

    fireEvent.click(within(group).getByRole('checkbox', { name: 'Auditor' }));
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Apenas leitura' }));
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Administrador' }));
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(mocks.updateApplicationLink).toHaveBeenCalledWith('link-1', expect.objectContaining({ roles: ['ADMIN', 'READ_ONLY'] })));
  });

  it('asks in the confirm dialog before removing an application', async () => {
    mocks.listApplicationLinks.mockResolvedValue([link]);
    mocks.removeApplicationLink.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByTitle('Remover'));
    const dialog = screen.getByRole('alertdialog', { name: 'Remover aplicação' });
    expect(mocks.removeApplicationLink).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(mocks.removeApplicationLink).toHaveBeenCalledWith('link-1'));
  });
});
