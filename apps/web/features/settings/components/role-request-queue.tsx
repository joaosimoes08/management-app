'use client';

import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react';
import { DataTable, sortByColumns, type DataTableColumn, type SortState } from '@/components/data-table';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format/date';
import { useI18n } from '@/lib/i18n';
import { decideRoleRequest, listRoleRequests, settingsKeys, settingsQueryOptions, type RoleRequestItem, type RoleRequestPage } from '../api';
import { useUiText } from '@/components/ui/use-ui-text';

const PAGE_SIZE = 20;

/** Filter value → API `status` list. Pending covers PROCESSING too (a decision that failed half-way). */
export const ROLE_REQUEST_FILTERS = [
  { value: 'PENDING,PROCESSING', labelKey: 'settings.requests.filter.pending' },
  { value: 'APPROVED', labelKey: 'settings.requests.filter.approved' },
  { value: 'REJECTED', labelKey: 'settings.requests.filter.rejected' },
  { value: 'PENDING,PROCESSING,APPROVED,REJECTED', labelKey: 'settings.requests.filter.all' },
] as const;

/** Known statuses: badge class; the label is `settings.requests.status.<STATUS>`. */
const STATUS: Record<string, { badge: string }> = {
  PENDING: { badge: 'pending' },
  PROCESSING: { badge: 'processing' },
  APPROVED: { badge: 'approved' },
  REJECTED: { badge: 'rejected' },
};

const emptyPage: RoleRequestPage = { items: [], page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 };
const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const personName = (person?: RoleRequestItem['user']) => person?.displayName?.trim() || person?.username || '—';

export interface RoleRequestQueueProps {
  /** Called after a decision so the user list (roles, pending badge) reloads. */
  onDecided: () => void;
  /** Any change (the user list's load time) reloads the queue, so decisions taken in the user list show up here. */
  reloadToken?: number;
}

/** Definições → Utilizadores: queue of role requests, pending first, with approve / reject. */
export function RoleRequestQueue({ onDecided, reloadToken }: RoleRequestQueueProps) {
  const ui = useUiText();
  const { t } = useI18n();
  const { success, error: toastError } = useToast();
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>(ROLE_REQUEST_FILTERS[0].value);
  const [page, setPage] = useState(1);
  /** Decision failures stay visible across the reload that follows them. */
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState('');
  const defaultSort: SortState = { column: 'createdAt', direction: status === ROLE_REQUEST_FILTERS[0].value ? 'asc' : 'desc' };
  const [sort, setSort] = useState<SortState>(defaultSort);

  // The previous page stays on screen while the next one loads, as before. reloadToken is part of the key, so a new token loads the queue again.
  const query = useQuery({ queryKey: settingsKeys.roleRequests(status, page, reloadToken ?? 0), queryFn: () => listRoleRequests({ status, page, pageSize: PAGE_SIZE }), placeholderData: keepPreviousData, ...settingsQueryOptions });
  const decisionMutation = useMutation({ mutationFn: ({ id, decision: value }: { id: string; decision: 'APPROVE' | 'REJECT' }) => decideRoleRequest(id, value) });
  const reload = () => queryClient.invalidateQueries({ queryKey: settingsKeys.roleRequestsAll });
  const fetched = query.data && !query.isPlaceholderData ? query.data : undefined;
  const fetchedItems = fetched && Array.isArray(fetched.items) ? fetched.items : [];
  // The last item of the last page was decided: step back instead of showing an empty page.
  const stepBack = Boolean(fetched && !fetchedItems.length && page > 1);
  if (stepBack) setPage(page - 1);
  const loading = query.isFetching || stepBack;
  const error = query.isError ? messageOf(query.error, ui('settings.requests.loadError')) : '';
  const data: RoleRequestPage = query.isError || !query.data || stepBack ? emptyPage : { ...emptyPage, ...query.data, items: Array.isArray(query.data.items) ? query.data.items : [] };

  const roleLabels = (roles: string[]) => (roles.length ? roles.map((role) => t(`role.${role}`, role)).join(', ') : '—');

  const decide = async (item: RoleRequestItem, value: 'APPROVE' | 'REJECT') => {
    const name = personName(item.user);
    if (value === 'REJECT' && !(await askConfirm({ title: ui('settings.requests.rejectTitle'), message: ui('settings.roleQueue.rejectConfirm', undefined, { name }), confirmLabel: ui('settings.requests.reject'), destructive: true }))) return;
    setBusyId(item.id);
    setActionError('');
    try {
      await decisionMutation.mutateAsync({ id: item.id, decision: value });
      success(ui('settings.requests.title'), value === 'APPROVE' ? ui('settings.roleQueue.approved', undefined, { name }) : ui('settings.roleQueue.rejected', undefined, { name }));
      void reload();
      onDecided();
    } catch (reason) {
      const message = messageOf(reason, ui('settings.requests.decideError'));
      setActionError(message);
      toastError(ui('settings.requests.title'), message);
      // 409 "already processed": reload so the row shows its real state.
      void reload();
    } finally {
      setBusyId('');
    }
  };

  const columns: DataTableColumn<RoleRequestItem>[] = [
    { id: 'user', header: ui('settings.requests.column.user'), cell: (item) => <span className="settings-user-identity"><strong>{personName(item.user)}</strong><small>{item.user?.username ?? ''}{item.user?.email ? ` · ${item.user.email}` : ''}</small></span>, sortValue: (item) => personName(item.user) },
    { id: 'roles', header: ui('settings.requests.column.roles'), cell: (item) => roleLabels(item.requestedRoles ?? []) },
    { id: 'status', header: ui('settings.requests.column.status'), cell: (item) => { const known = STATUS[item.status]; return <span className={`state-badge ${known?.badge ?? ''}`.trim()} data-status={item.status}><i />{known ? ui(`settings.requests.status.${item.status}`) : item.status}</span>; }, sortValue: (item) => item.status },
    { id: 'createdAt', header: ui('settings.requests.column.createdAt'), cell: (item) => formatDateTime(item.createdAt), sortValue: (item) => item.createdAt },
    { id: 'decidedAt', header: ui('settings.requests.column.decidedAt'), cell: (item) => (item.decidedAt ? `${formatDateTime(item.decidedAt)}${item.reviewer ? ` · ${personName(item.reviewer)}` : ''}` : '—'), sortValue: (item) => item.decidedAt ?? null },
    {
      id: 'actions', header: ui('settings.requests.column.actions'), className: 'table-actions', cell: (item) => {
        if (item.status !== 'PENDING' && item.status !== 'PROCESSING') return null;
        const name = personName(item.user);
        const processing = item.status === 'PROCESSING';
        const busy = busyId === item.id;
        return <div className="role-request-actions"><div>
          <button type="button" className="secondary-button" disabled={Boolean(busyId)} aria-label={ui(processing ? 'settings.roleQueue.finishRequest' : 'settings.roleQueue.approveRequest', undefined, { name })} onClick={() => void decide(item, 'APPROVE')}><Check size={13} />{processing ? ui('settings.requests.finish') : ui('settings.requests.approve')}</button>
          {/* A PROCESSING request already had its roles granted half-way: it can only be finished. */}
          <button type="button" className="danger-button" disabled={Boolean(busyId) || processing} aria-label={ui('settings.roleQueue.rejectRequest', undefined, { name })} onClick={() => void decide(item, 'REJECT')}><X size={13} />{ui('settings.requests.reject')}</button>
          {busy && <span className="muted-cell">{ui('settings.requests.saving')}</span>}
        </div></div>;
      },
    },
  ];

  const pending = data.pendingTotal;
  return <section className="ipam-card settings-panel" aria-labelledby="role-request-queue-title" data-testid="role-request-queue">
    <div className="panel-heading">
      <div><h2 id="role-request-queue-title">{ui('settings.requests.title')}</h2>{typeof pending === 'number' && <p className="panel-description">{ui('settings.roleQueue.pendingCount', undefined, { count: pending })}</p>}</div>
      <div className="table-actions">
        <label className="role-request-status-filter">{ui('settings.requests.statusFilter')} <select className="context-toolbar-selector" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); setActionError(''); setSort({ column: 'createdAt', direction: event.target.value === ROLE_REQUEST_FILTERS[0].value ? 'asc' : 'desc' }); }}>{ROLE_REQUEST_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{ui(filter.labelKey)}</option>)}</select></label>
        <button type="button" className="secondary-button" onClick={() => void reload()}><RefreshCw size={14} />{ui('settings.requests.refresh')}</button>
      </div>
    </div>
    {(error || actionError) && <div role="alert" className="ipam-alert error"><X size={15} />{error || actionError}</div>}
    {!loading && !error && !data.items.length && <div className="ipam-alert">{status === ROLE_REQUEST_FILTERS[0].value ? ui('settings.requests.emptyPending') : ui('settings.requests.empty')}</div>}
    {data.items.length > 0 && <DataTable rows={sortByColumns(data.items, columns, sort)} columns={columns} rowKey={(item) => item.id} label={ui('settings.requests.title')} sort={sort} onSortChange={setSort} defaultSort={defaultSort} />}
    {data.totalPages > 1 && <div className="settings-pagination"><span>{ui('settings.roleQueue.total', undefined, { count: data.total })}</span><div><button type="button" aria-label={ui('ui.previousPage')} disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /></button><b>{data.page} / {data.totalPages}</b><button type="button" aria-label={ui('ui.nextPage')} disabled={page >= data.totalPages || loading} onClick={() => setPage(page + 1)}><ChevronRight size={14} /></button></div></div>}
    {confirmDialog}
  </section>;
}
