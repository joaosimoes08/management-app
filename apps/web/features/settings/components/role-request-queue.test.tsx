import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api/errors';
import type { RoleRequestItem, RoleRequestPage } from '../api';
import { RoleRequestQueue } from './role-request-queue';

const mocks = vi.hoisted(() => ({ listRoleRequests: vi.fn(), decideRoleRequest: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../api', () => ({ listRoleRequests: mocks.listRoleRequests, decideRoleRequest: mocks.decideRoleRequest }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'pt-PT', t: (key: string, fallback?: string) => ({ 'role.NETWORK_OPERATOR': 'Operador de rede' } as Record<string, string>)[key] ?? fallback ?? key }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const request = (overrides: Partial<RoleRequestItem> = {}): RoleRequestItem => ({
  id: 'rr-1', requestedRoles: ['NETWORK_OPERATOR'], status: 'PENDING', createdAt: '2026-11-20T10:00:00.000Z', processingAt: null, decidedAt: null,
  user: { id: 'u-1', username: 'ana', displayName: 'Ana Silva', email: 'ana@example.test' }, reviewer: null,
  ...({ futureField: 1 } as object),
  ...overrides,
});
const page = (items: RoleRequestItem[], overrides: Partial<RoleRequestPage> = {}): RoleRequestPage => ({ items, page: 1, pageSize: 20, total: items.length, totalPages: 1, pendingTotal: items.length, ...overrides });

describe('RoleRequestQueue', () => {
  it('lists pending requests by default and approves one', async () => {
    mocks.listRoleRequests.mockResolvedValue(page([request(), request({ id: 'rr-2', status: 'PROCESSING', user: { id: 'u-2', username: 'rui' } })]));
    mocks.decideRoleRequest.mockResolvedValue({});
    const onDecided = vi.fn();
    render(<RoleRequestQueue onDecided={onDecided} />);
    const table = await screen.findByRole('region', { name: 'Pedidos de roles' });
    expect(mocks.listRoleRequests).toHaveBeenCalledWith({ status: 'PENDING,PROCESSING', page: 1, pageSize: 20 });
    expect(within(table).getByText('Ana Silva')).toBeInTheDocument();
    expect(within(table).getAllByText('Operador de rede')).toHaveLength(2);
    expect(screen.getByText('2 pedidos por decidir')).toBeInTheDocument();
    // A PROCESSING request can only be finished.
    expect(screen.getByRole('button', { name: 'Concluir pedido de rui' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Rejeitar pedido de rui' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar pedido de Ana Silva' }));
    await waitFor(() => expect(mocks.decideRoleRequest).toHaveBeenCalledWith('rr-1', 'APPROVE'));
    await waitFor(() => expect(onDecided).toHaveBeenCalled());
    expect(mocks.success).toHaveBeenCalledWith('Pedidos de roles', 'Pedido de Ana Silva aprovado.');
  });

  it('asks for confirmation before rejecting and shows the API message on conflict', async () => {
    mocks.listRoleRequests.mockResolvedValue(page([request()]));
    mocks.decideRoleRequest.mockRejectedValue(new ApiRequestError('O pedido já foi processado.', 409, { code: 'ROLE_REQUEST_NOT_PENDING', message: 'O pedido já foi processado.' }));
    render(<RoleRequestQueue onDecided={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rejeitar pedido de Ana Silva' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Rejeitar pedido' });
    expect(dialog).toHaveTextContent('Rejeitar o pedido de roles de Ana Silva?');
    expect(mocks.decideRoleRequest).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rejeitar' }));
    await waitFor(() => expect(mocks.decideRoleRequest).toHaveBeenCalledWith('rr-1', 'REJECT'));
    expect(await screen.findByRole('alert')).toHaveTextContent('O pedido já foi processado.');
  });

  it('filters by status, shows decided requests and unknown statuses, and pages', async () => {
    mocks.listRoleRequests.mockResolvedValueOnce(page([request()]));
    render(<RoleRequestQueue onDecided={vi.fn()} />);
    await screen.findByText('Ana Silva');

    mocks.listRoleRequests.mockResolvedValue(page([
      request({ status: 'APPROVED', decidedAt: '2026-11-20T11:00:00.000Z', reviewer: { id: 'admin', username: 'admin', displayName: 'Admin' } }),
      request({ id: 'rr-3', status: 'ESCALATED' }),
    ], { total: 25, totalPages: 2, pendingTotal: 0 }));
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'PENDING,PROCESSING,APPROVED,REJECTED' } });
    await waitFor(() => expect(mocks.listRoleRequests).toHaveBeenLastCalledWith({ status: 'PENDING,PROCESSING,APPROVED,REJECTED', page: 1, pageSize: 20 }));
    expect(await screen.findByText('Aprovado')).toBeInTheDocument();
    expect(screen.getByText('ESCALATED')).toBeInTheDocument();
    expect(screen.getByText(/· Admin$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aprovar pedido/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Página seguinte' }));
    await waitFor(() => expect(mocks.listRoleRequests).toHaveBeenLastCalledWith({ status: 'PENDING,PROCESSING,APPROVED,REJECTED', page: 2, pageSize: 20 }));
  });

  it('shows the API message for an invalid filter (400) and the empty state', async () => {
    mocks.listRoleRequests.mockRejectedValueOnce(new ApiRequestError('status deve ser PENDING, PROCESSING, APPROVED ou REJECTED.', 400, { code: 'ROLE_REQUEST_STATUS_INVALID', message: 'status deve ser PENDING, PROCESSING, APPROVED ou REJECTED.' }));
    render(<RoleRequestQueue onDecided={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('status deve ser PENDING, PROCESSING, APPROVED ou REJECTED.');
    mocks.listRoleRequests.mockResolvedValue(page([]));
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(await screen.findByText('Não há pedidos de roles pendentes.')).toBeInTheDocument();
  });
});
