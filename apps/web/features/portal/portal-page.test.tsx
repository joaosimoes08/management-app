import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api/errors';
import PortalPage from './portal-page';
import type { ApplicationLink } from './api';

const mocks = vi.hoisted(() => ({ listApplicationLinks: vi.fn(), updateApplicationLink: vi.fn(), removeApplicationLink: vi.fn(), listFavoriteApplicationLinks: vi.fn(), addFavoriteApplicationLink: vi.fn(), removeFavoriteApplicationLink: vi.fn(), checkAllApplicationLinks: vi.fn() }));

vi.mock('./api', async (importOriginal) => ({
  // nextCheckAllCursor stays real: the paging loop is part of what is tested.
  nextCheckAllCursor: (await importOriginal<typeof import('./api')>()).nextCheckAllCursor,
  listApplicationLinks: mocks.listApplicationLinks, updateApplicationLink: mocks.updateApplicationLink, removeApplicationLink: mocks.removeApplicationLink,
  createApplicationLink: vi.fn(), checkApplicationLink: vi.fn(),
  listFavoriteApplicationLinks: mocks.listFavoriteApplicationLinks, addFavoriteApplicationLink: mocks.addFavoriteApplicationLink, removeFavoriteApplicationLink: mocks.removeFavoriteApplicationLink,
  checkAllApplicationLinks: mocks.checkAllApplicationLinks,
}));
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => <>{actions}{children}</> }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: () => true }) }));

const link: ApplicationLink = { id: 'link-1', name: 'Zabbix', url: 'https://zabbix.interno', icon: 'Activity', description: 'Monitorização', category: 'Operações', sortOrder: 0, isActive: true, checkAvailability: false, roles: [{ role: 'AUDITOR' }] };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PortalPage /></QueryClientProvider>);
}

beforeEach(() => { mocks.listFavoriteApplicationLinks.mockResolvedValue({ items: [] }); });
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

describe('PortalPage favourites', () => {
  const grafana: ApplicationLink = { ...link, id: 'link-2', name: 'Grafana', category: 'Monitorização', isFavorite: true };

  it('shows the favourites first, in the user order, and toggles a favourite with PUT / DELETE', async () => {
    mocks.listApplicationLinks.mockResolvedValue([{ ...link, isFavorite: false }, grafana]);
    mocks.listFavoriteApplicationLinks.mockResolvedValue({ items: [{ ...grafana, isFavorite: true, favoriteSortOrder: 0, futureField: 1 }] });
    mocks.addFavoriteApplicationLink.mockResolvedValue({ linkId: 'link-1', isFavorite: true, sortOrder: 1 });
    mocks.removeFavoriteApplicationLink.mockResolvedValue({ linkId: 'link-2', isFavorite: false });
    renderPage();
    const favorites = await screen.findByTestId('portal-favorites');
    expect(within(favorites).getByRole('heading', { name: 'Grafana' })).toBeInTheDocument();
    expect(within(favorites).queryByRole('heading', { name: 'Zabbix' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Zabbix aos favoritos' }));
    await waitFor(() => expect(mocks.addFavoriteApplicationLink).toHaveBeenCalledWith('link-1'));
    await waitFor(() => expect(mocks.listFavoriteApplicationLinks).toHaveBeenCalledTimes(2));

    fireEvent.click(within(favorites).getByRole('button', { name: 'Remover Grafana dos favoritos' }));
    await waitFor(() => expect(mocks.removeFavoriteApplicationLink).toHaveBeenCalledWith('link-2'));
  });

  it('shows the API message when a favourite cannot be saved', async () => {
    mocks.listApplicationLinks.mockResolvedValue([link]);
    mocks.addFavoriteApplicationLink.mockRejectedValue(new ApiRequestError('Aplicação não encontrada.', 404, { code: 'APPLICATION_LINK_NOT_FOUND', message: 'Aplicação não encontrada.' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar Zabbix aos favoritos' }));
    expect(await screen.findByText('Aplicação não encontrada.')).toBeInTheDocument();
  });
});

describe('PortalPage check-all', () => {
  it('pages through every batch and shows per-link results, including BLOCKED and unknown codes', async () => {
    const intranet = { ...link, id: 'b', name: 'Intranet', checkAvailability: true };
    mocks.listApplicationLinks.mockResolvedValueOnce([link, intranet]).mockResolvedValue([
      link, { ...intranet, isAvailable: false, lastCheckedAt: '2026-11-20T10:00:00.000Z' },
    ]);
    mocks.checkAllApplicationLinks
      .mockResolvedValueOnce({ checked: 2, total: 3, offset: 0, nextOffset: 2, items: [
        { id: 'a', name: 'Zabbix', available: true, httpStatus: 200, responseMs: 42, checkedAt: '2026-11-20T10:00:00.000Z' },
        { id: 'b', name: 'Intranet', available: false, httpStatus: null, responseMs: null, code: 'BLOCKED', checkedAt: '2026-11-20T10:00:00.000Z' },
      ], newTopLevelField: true })
      .mockResolvedValueOnce({ checked: 1, total: 3, offset: 2, nextOffset: null, items: [
        { id: 'c', name: 'Legacy', available: false, httpStatus: 418, responseMs: 5, code: 'TEAPOT_LIMIT', extra: { nested: true } },
      ] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Verificar todas/ }));
    const panel = screen.getByTestId('portal-check-all');
    fireEvent.change(within(panel).getByRole('combobox'), { target: { value: 'all' } });
    fireEvent.click(within(panel).getByRole('button', { name: /Iniciar verificação/ }));

    await waitFor(() => expect(within(panel).getByText('3 de 3 verificadas')).toBeInTheDocument());
    expect(mocks.checkAllApplicationLinks).toHaveBeenNthCalledWith(1, true, {});
    expect(mocks.checkAllApplicationLinks).toHaveBeenNthCalledWith(2, true, { offset: 2 });
    expect(mocks.checkAllApplicationLinks).toHaveBeenCalledTimes(2);
    const table = within(panel).getByRole('region', { name: 'Resultados da verificação' });
    expect(within(table).getByText('Bloqueado')).toHaveAttribute('data-code', 'BLOCKED');
    expect(within(table).getByText('O endereço de destino pertence a uma rede restrita.')).toBeInTheDocument();
    const card = screen.getByRole('heading', { name: 'Intranet' }).closest('article')!;
    await waitFor(() => expect(within(card).getByText('Bloqueado')).toBeInTheDocument());
    expect(within(table).getByText('TEAPOT_LIMIT')).toBeInTheDocument();
    expect(within(table).getByText('Disponível')).toBeInTheDocument();
    expect(within(panel).getByTestId('portal-check-all-counts')).toHaveTextContent('Bloqueado: 1');
    expect(mocks.listApplicationLinks).toHaveBeenCalledTimes(2);
  });

  it('stops when the API makes no progress and shows a 400 message', async () => {
    mocks.listApplicationLinks.mockResolvedValue([link]);
    mocks.checkAllApplicationLinks.mockRejectedValueOnce(new ApiRequestError('offset tem de ser um inteiro ≥ 0.', 400, { code: 'CHECK_ALL_OFFSET_INVALID', message: 'offset tem de ser um inteiro ≥ 0.' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Verificar todas/ }));
    fireEvent.click(screen.getByRole('button', { name: /Iniciar verificação/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('offset tem de ser um inteiro ≥ 0.');

    mocks.checkAllApplicationLinks.mockResolvedValue({ items: [{ id: 'a', name: 'Zabbix', available: true }], page: 1, totalPages: 1 });
    fireEvent.click(screen.getByRole('button', { name: /Iniciar verificação/ }));
    await waitFor(() => expect(screen.getByText('1 verificadas')).toBeInTheDocument());
    expect(mocks.checkAllApplicationLinks).toHaveBeenCalledTimes(2);
    expect(mocks.checkAllApplicationLinks).toHaveBeenLastCalledWith(false, {});
  });
});

describe('PortalPage link URL schemes', () => {
  it('renders a stored non-http(s) URL as plain text instead of a link', async () => {
    const unsafe: ApplicationLink = { ...link, id: 'link-2', name: 'Legacy', description: 'Antiga', url: 'javascript:alert(document.cookie)' };
    mocks.listApplicationLinks.mockResolvedValue([link, unsafe]);
    renderPage();
    expect(await screen.findByTestId('portal-unsafe-url')).toHaveTextContent('javascript:alert(document.cookie)');
    const links = screen.getAllByRole('link', { name: /Abrir aplicação/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://zabbix.interno');
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('shows a form error and does not save when the URL is not http or https', async () => {
    mocks.listApplicationLinks.mockResolvedValue([link]);
    mocks.updateApplicationLink.mockResolvedValue(link);
    renderPage();
    fireEvent.click(await screen.findByTitle('Editar'));
    const input = screen.getByPlaceholderText('https://zabbix.interno');
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O URL tem de começar por http:// ou https://.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'portal-url-error');
    expect(mocks.updateApplicationLink).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'https://zabbix.interno/novo' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(mocks.updateApplicationLink).toHaveBeenCalledWith('link-1', expect.objectContaining({ url: 'https://zabbix.interno/novo' })));
  });
});
