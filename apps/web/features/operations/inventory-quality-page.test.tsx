import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { InventoryQualityPage } from './inventory-quality-page';

vi.mock('@/components/layout/app-shell', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/layout/app-shell')>(),
  AppShell: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => <><div data-testid="toolbar-actions">{actions}</div>{children}</>,
}));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1' }) }));
const roles = vi.hoisted(() => ({ current: ['ADMIN'] as string[] }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => roles.current.includes(role), user: { id: 'u-me' } }) }));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));

const item = (id: string, rule: string, extra: Record<string, unknown> = {}) => ({ id, siteId: 'site-1', rule, entityType: 'Device', entityId: `d-${id}`, actionHref: `/infraestrutura?deviceId=d-${id}`, suggestedCorrection: 'Corrigir', severity: 'HIGH', status: 'OPEN', title: `Finding ${id}`, detail: 'Detalhe', lastDetectedAt: '2026-11-20T10:00:00.000Z', assignedTo: null, ...extra });
const findings = [item('1', 'DEVICE_MISSING_SITE'), item('2', 'DEVICE_MISSING_MODEL', { severity: 'INFO' }), item('3', 'DEVICE_MISSING_SITE', { assignedTo: { id: 'u-ana', username: 'ana', displayName: 'Ana' } })];
const facets = { total: 5, byStatus: { OPEN: 3, RESOLVED: 2 }, bySeverity: { HIGH: 2, INFO: 1 }, byRule: [{ rule: 'DEVICE_MISSING_SITE', total: 2, byStatus: { OPEN: 2 } }, { rule: 'DEVICE_MISSING_MODEL', total: 1, byStatus: { OPEN: 1 } }], byAssignee: [{ userId: null, total: 2 }, { userId: 'u-me', username: 'me', total: 0 }, { userId: 'u-ana', username: 'ana', displayName: 'Ana', total: 1 }] };
const people = [{ id: 'u-ana', username: 'ana', displayName: 'Ana' }, { id: 'u-me', username: 'me' }];
let bulkResponse: unknown;
const mock = vi.mocked(apiFetch);

beforeEach(() => {
  window.history.replaceState(null, '', '/qualidade-inventario');
  roles.current = ['ADMIN'];
  bulkResponse = { action: 'SNOOZE', succeeded: 1, failed: 1, snoozedUntil: '2026-11-24T10:00:00.000Z', results: [{ id: '1', ok: true }, { id: '2', ok: false, code: 'FORBIDDEN' }] };
  mock.mockImplementation(async (path: string) => {
    if (path.includes('/findings/bulk')) return bulkResponse;
    if (path.includes('/facets')) return facets;
    if (path.includes('/assignees')) return people;
    if (path.includes('/findings?')) return { items: findings, total: 3, page: 1, pageSize: 100 };
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => { cleanup(); mock.mockReset(); });

const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><InventoryQualityPage /></QueryClientProvider>);
const calls = (part: string) => mock.mock.calls.map(([path]) => String(path)).filter((path) => path.includes(part));

describe('InventoryQualityPage', () => {
  it('opens on open findings with status counts and asks facets without the status tab', async () => {
    renderPage();
    await screen.findByText('Finding 1');
    expect(calls('/findings?')[0]).toContain('status=OPEN');
    expect(calls('/facets')[0]).not.toContain('status=');
    const tabs = within(screen.getByRole('group', { name: 'Findings por estado' }));
    expect(tabs.getByRole('button', { name: /3\s*Abertos/ })).toHaveAttribute('aria-pressed', 'true');
    expect(tabs.getByRole('button', { name: /5\s*Todos/ })).toBeInTheDocument();
    fireEvent.click(tabs.getByRole('button', { name: /2\s*Resolvidos/ }));
    await waitFor(() => expect(calls('/findings?').some((path) => path.includes('status=RESOLVED'))).toBe(true));
    expect(window.location.search).toContain('status=RESOLVED');
  });

  it('filters by assignee (me / unassigned / user) with counts and sends it to the API', async () => {
    renderPage();
    await screen.findByText('Finding 1');
    const select = screen.getByRole('combobox', { name: 'Filtrar por responsável' });
    expect(within(select).getByRole('option', { name: 'Atribuídos a mim (0)' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Sem responsável (2)' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Ana (1)' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'unassigned' } });
    await waitFor(() => expect(calls('/findings?').some((path) => path.includes('assignee=unassigned'))).toBe(true));
  });

  it('groups by rule into one table per rule', async () => {
    window.history.replaceState(null, '', '/qualidade-inventario?group=rule');
    renderPage();
    expect(await screen.findByRole('region', { name: 'Findings da regra Equipamento sem Site' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Findings da regra Equipamento sem Site' })).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('region', { name: 'Findings da regra Equipamento sem modelo' })).toBeInTheDocument();
  });

  it('snoozes the selected visible findings for the chosen length and shows per-item results', async () => {
    renderPage();
    await screen.findByText('Finding 1');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Finding 1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Finding 2' }));
    fireEvent.click(screen.getByRole('button', { name: /Adiar… \(2\)/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Adiar durante' }), { target: { value: '72' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adiar 2' }));
    await within(dialog).findByText('1 de 2 aplicados.', { exact: false });
    const body = JSON.parse(String(mock.mock.calls.find(([path]) => String(path).includes('/bulk'))?.[1]?.body));
    expect(body).toEqual({ action: 'SNOOZE', ids: ['1', '2'], durationHours: 72 });
    expect(within(dialog).getByText('Aplicado')).toBeInTheDocument();
    expect(within(dialog).getByText('Sem permissão neste Site')).toBeInTheDocument();
  });

  it('assigns to nobody, and acknowledges only after confirming', async () => {
    bulkResponse = { action: 'ASSIGN', succeeded: 1, failed: 0, results: [{ id: '3', ok: true }] };
    renderPage();
    await screen.findByText('Finding 3');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Finding 3' }));
    fireEvent.click(screen.getByRole('button', { name: /Atribuir… \(1\)/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Atribuir 1' }));
    await within(dialog).findByText('1 de 1 aplicados.', { exact: false });
    expect(JSON.parse(String(mock.mock.calls.find(([path]) => String(path).includes('/bulk'))?.[1]?.body))).toEqual({ action: 'ASSIGN', ids: ['3'], userId: null });
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Fechar' }).at(-1)!);

    bulkResponse = { action: 'ACKNOWLEDGE', succeeded: 1, failed: 0, results: [{ id: '1', ok: true }] };
    mock.mockClear();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar Finding 1' }));
    fireEvent.click(screen.getByRole('button', { name: /Reconhecer \(/ }));
    const confirm = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog'));
    expect(calls('/bulk')).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole('button', { name: /^Reconhecer \d/ }));
    await waitFor(() => expect(calls('/bulk')).toHaveLength(1));
  });

  it('acts on one finding from its row without selecting it, and reports an ERROR result', async () => {
    bulkResponse = { action: 'ACKNOWLEDGE', succeeded: 0, failed: 1, results: [{ id: '2', ok: false, code: 'ERROR', message: 'boom' }] };
    renderPage();
    await screen.findByText('Finding 2');
    fireEvent.click(screen.getByRole('button', { name: 'Reconhecer Finding 2' }));
    await waitFor(() => expect(calls('/bulk')).toHaveLength(1));
    expect(JSON.parse(String(mock.mock.calls.find(([path]) => String(path).includes('/bulk'))?.[1]?.body))).toEqual({ action: 'ACKNOWLEDGE', ids: ['2'] });
    expect(await screen.findByRole('alert')).toHaveTextContent('Finding 2: Erro inesperado');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // The row dialog acts on that row only, even with other findings selected.
    bulkResponse = { action: 'SNOOZE', succeeded: 0, failed: 1, results: [{ id: '3', ok: false, code: 'SOMETHING_NEW', message: 'Novo motivo' }] };
    mock.mockClear();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Finding 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adiar Finding 3' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Adiar finding')).toBeInTheDocument();
    expect(within(dialog).getByText('Finding: Finding 3')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adiar' }));
    await within(dialog).findByText('0 de 1 aplicados.', { exact: false });
    expect(JSON.parse(String(mock.mock.calls.find(([path]) => String(path).includes('/bulk'))?.[1]?.body))).toEqual({ action: 'SNOOZE', ids: ['3'], durationHours: 24 });
    expect(within(dialog).getByText('Novo motivo')).toBeInTheDocument();
  });

  it('disables row acknowledge on acknowledged findings and shows no row actions on resolved ones', async () => {
    mock.mockImplementation(async (path: string) => {
      if (path.includes('/facets')) return facets;
      if (path.includes('/assignees')) return people;
      if (path.includes('/findings?')) return { items: [item('4', 'DEVICE_MISSING_SITE', { status: 'ACKNOWLEDGED' }), item('5', 'DEVICE_MISSING_SITE', { status: 'RESOLVED' })], total: 2, page: 1, pageSize: 100 };
      throw new Error(`unexpected ${path}`);
    });
    renderPage();
    await screen.findByText('Finding 4');
    expect(screen.getByRole('button', { name: 'Reconhecer Finding 4' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Atribuir Finding 4' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Adiar Finding 5' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir registo de Finding 5' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir equipamento de Finding 5' })).toHaveAttribute('href', '/infraestrutura/equipamentos/d-5?siteId=site-1');
  });

  it('hides selection and bulk actions from read-only roles', async () => {
    roles.current = ['VIEWER'];
    renderPage();
    await screen.findByText('Finding 1');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reconhecer/ })).not.toBeInTheDocument();
  });
});
