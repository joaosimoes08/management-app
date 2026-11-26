'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react';
import { DataTable, sortByColumns, type DataTableColumn, type SortState } from '@/components/data-table';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format/date';
import { useI18n } from '@/lib/i18n';
import { decideRoleRequest, listRoleRequests, type RoleRequestItem, type RoleRequestPage } from '../api';
import { useUiText } from '@/components/ui/use-ui-text';

const PAGE_SIZE = 20;

/** Filter value → API `status` list. Pending covers PROCESSING too (a decision that failed half-way). */
export const ROLE_REQUEST_FILTERS = [
  { value: 'PENDING,PROCESSING', label: 'Pendentes' },
  { value: 'APPROVED', label: 'Aprovados' },
  { value: 'REJECTED', label: 'Rejeitados' },
  { value: 'PENDING,PROCESSING,APPROVED,REJECTED', label: 'Todos' },
] as const;

const STATUS: Record<string, { label: string; badge: string }> = {
  PENDING: { label: 'Pendente', badge: 'pending' },
  PROCESSING: { label: 'Em processamento', badge: 'processing' },
  APPROVED: { label: 'Aprovado', badge: 'approved' },
  REJECTED: { label: 'Rejeitado', badge: 'rejected' },
};

const emptyPage: RoleRequestPage = { items: [], page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 };
const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const personName = (person?: RoleRequestItem['user']) => person?.displayName?.trim() || person?.username || '—';

export interface RoleRequestQueueProps {
  /** Called after a decision so the user list (roles, pending badge) reloads. */
  onDecided: () => void;
  /** Any change (e.g. the user list object) reloads the queue, so decisions taken in the user list show up here. */
  reloadToken?: unknown;
}

/** Definições → Utilizadores: queue of role requests, pending first, with approve / reject. */
export function RoleRequestQueue({ onDecided, reloadToken }: RoleRequestQueueProps) {
  const ui = useUiText();
  const { t } = useI18n();
  const { success, error: toastError } = useToast();
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const [status, setStatus] = useState<string>(ROLE_REQUEST_FILTERS[0].value);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RoleRequestPage>(emptyPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** Decision failures stay visible across the reload that follows them. */
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [refresh, setRefresh] = useState(0);
  const defaultSort: SortState = { column: 'createdAt', direction: status === ROLE_REQUEST_FILTERS[0].value ? 'asc' : 'desc' };
  const [sort, setSort] = useState<SortState>(defaultSort);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listRoleRequests({ status, page, pageSize: PAGE_SIZE })
      .then((next) => {
        if (!active) return;
        const items = Array.isArray(next.items) ? next.items : [];
        // The last item of the last page was decided: step back instead of showing an empty page.
        if (!items.length && page > 1) { setPage(page - 1); return; }
        setData({ ...emptyPage, ...next, items });
        setError('');
      })
      .catch((reason: unknown) => { if (active) { setData(emptyPage); setError(messageOf(reason, 'Não foi possível carregar os pedidos de roles.')); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [status, page, refresh, reloadToken]);

  const roleLabels = (roles: string[]) => (roles.length ? roles.map((role) => t(`role.${role}`, role)).join(', ') : '—');

  const decide = async (item: RoleRequestItem, decision: 'APPROVE' | 'REJECT') => {
    const name = personName(item.user);
    if (decision === 'REJECT' && !(await askConfirm({ title: 'Rejeitar pedido', message: ui('settings.roleQueue.rejectConfirm', undefined, { name }), confirmLabel: 'Rejeitar', destructive: true }))) return;
    setBusyId(item.id);
    setActionError('');
    try {
      await decideRoleRequest(item.id, decision);
      success('Pedidos de roles', decision === 'APPROVE' ? ui('settings.roleQueue.approved', undefined, { name }) : ui('settings.roleQueue.rejected', undefined, { name }));
      setRefresh((value) => value + 1);
      onDecided();
    } catch (reason) {
      const message = messageOf(reason, 'Não foi possível decidir o pedido.');
      setActionError(message);
      toastError('Pedidos de roles', message);
      // 409 "already processed": reload so the row shows its real state.
      setRefresh((value) => value + 1);
    } finally {
      setBusyId('');
    }
  };

  const columns: DataTableColumn<RoleRequestItem>[] = [
    { id: 'user', header: 'Utilizador', cell: (item) => <span className="settings-user-identity"><strong>{personName(item.user)}</strong><small>{item.user?.username ?? ''}{item.user?.email ? ` · ${item.user.email}` : ''}</small></span>, sortValue: (item) => personName(item.user) },
    { id: 'roles', header: 'Roles pedidos', cell: (item) => roleLabels(item.requestedRoles ?? []) },
    { id: 'status', header: 'Estado', cell: (item) => { const known = STATUS[item.status]; return <span className={`state-badge ${known?.badge ?? ''}`.trim()} data-status={item.status}><i />{known?.label ?? item.status}</span>; }, sortValue: (item) => item.status },
    { id: 'createdAt', header: 'Pedido em', cell: (item) => formatDateTime(item.createdAt), sortValue: (item) => item.createdAt },
    { id: 'decidedAt', header: 'Decisão', cell: (item) => (item.decidedAt ? `${formatDateTime(item.decidedAt)}${item.reviewer ? ` · ${personName(item.reviewer)}` : ''}` : '—'), sortValue: (item) => item.decidedAt ?? null },
    {
      id: 'actions', header: 'Ações', className: 'table-actions', cell: (item) => {
        if (item.status !== 'PENDING' && item.status !== 'PROCESSING') return null;
        const name = personName(item.user);
        const processing = item.status === 'PROCESSING';
        const busy = busyId === item.id;
        return <div className="role-request-actions"><div>
          <button type="button" className="secondary-button" disabled={Boolean(busyId)} aria-label={ui(processing ? 'settings.roleQueue.finishRequest' : 'settings.roleQueue.approveRequest', undefined, { name })} onClick={() => void decide(item, 'APPROVE')}><Check size={13} />{processing ? 'Concluir' : 'Aprovar'}</button>
          {/* A PROCESSING request already had its roles granted half-way: it can only be finished. */}
          <button type="button" className="danger-button" disabled={Boolean(busyId) || processing} aria-label={ui('settings.roleQueue.rejectRequest', undefined, { name })} onClick={() => void decide(item, 'REJECT')}><X size={13} />Rejeitar</button>
          {busy && <span className="muted-cell">A guardar…</span>}
        </div></div>;
      },
    },
  ];

  const pending = data.pendingTotal;
  return <section className="ipam-card settings-panel" aria-labelledby="role-request-queue-title" data-testid="role-request-queue">
    <div className="panel-heading">
      <div><h2 id="role-request-queue-title">Pedidos de roles</h2>{typeof pending === 'number' && <p className="panel-description">{ui('settings.roleQueue.pendingCount', undefined, { count: pending })}</p>}</div>
      <div className="table-actions">
        <label className="role-request-status-filter">Estado <select className="context-toolbar-selector" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); setActionError(''); setSort({ column: 'createdAt', direction: event.target.value === ROLE_REQUEST_FILTERS[0].value ? 'asc' : 'desc' }); }}>{ROLE_REQUEST_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select></label>
        <button type="button" className="secondary-button" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14} />Atualizar</button>
      </div>
    </div>
    {(error || actionError) && <div role="alert" className="ipam-alert error"><X size={15} />{error || actionError}</div>}
    {!loading && !error && !data.items.length && <div className="ipam-alert">{status === ROLE_REQUEST_FILTERS[0].value ? 'Não há pedidos de roles pendentes.' : 'Não há pedidos de roles neste estado.'}</div>}
    {data.items.length > 0 && <DataTable rows={sortByColumns(data.items, columns, sort)} columns={columns} rowKey={(item) => item.id} label="Pedidos de roles" sort={sort} onSortChange={setSort} defaultSort={defaultSort} />}
    {data.totalPages > 1 && <div className="settings-pagination"><span>{ui('settings.roleQueue.total', undefined, { count: data.total })}</span><div><button type="button" aria-label={ui('ui.previousPage')} disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /></button><b>{data.page} / {data.totalPages}</b><button type="button" aria-label={ui('ui.nextPage')} disabled={page >= data.totalPages || loading} onClick={() => setPage(page + 1)}><ChevronRight size={14} /></button></div></div>}
    {confirmDialog}
  </section>;
}
