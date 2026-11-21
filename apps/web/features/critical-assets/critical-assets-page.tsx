'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck, Users, X } from 'lucide-react';
import { AppShell, PageToolbarPortal } from '@/components/layout/app-shell';
import { apiFetch } from '@/lib/api/client';
import { ApiRequestError } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth';
import { useSiteContext } from '@/lib/site-context';
import { Empty } from '@/features/ipam/components/ipam-modal';
import { BulkConfirmDialog, OwnerDialog, ReviewDialog, type BulkItem, type BulkResult } from './critical-assets-dialogs';
import {
  assetTypes, buildRows, countRows, dueLabels, dueTone, emptyFilters, filterRows, hasActiveFilters, NO_OUTCOME, NO_OWNER, outcomeLabel, outcomeTone, withRecordedAttestation, currentCycle, hasOlderPending,
  type AssetRow, type Attestation, type CriticalAssetsResult, type Filters, type Group, type Outcome,
} from './workbench';

const reviewerRoles = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR'];
const errorText = (cause: unknown, fallback: string) => (cause instanceof Error && cause.message ? cause.message : fallback);
const isAlreadyRecorded = (cause: unknown) => cause instanceof ApiRequestError && (cause.code === 'CRITICAL_ASSET_ATTESTATION_ALREADY_RECORDED' || cause.status === 409);

type Review = { asset: AssetRow; attestation: Attestation; outcome: Outcome };
type Notice = { tone: 'success' | 'error'; text: string } | null;

const noGroups: Group[] = [];

export function CriticalAssetsPage() {
  const { siteId } = useSiteContext();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');
  const canReview = reviewerRoles.some(hasRole);
  const queryClient = useQueryClient();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [ownerType, setOwnerType] = useState<string | null>(null);
  const [bulkPlan, setBulkPlan] = useState<{ selectedCount: number; olderCount: number; items: BulkItem[] } | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResults, setBulkResults] = useState<Record<string, BulkResult> | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const queryKey = ['critical-assets', siteId];
  const { data: queryData, error: queryError, isLoading } = useQuery({ queryKey, queryFn: () => apiFetch<CriticalAssetsResult>(`/api/v1/critical-assets?siteId=${encodeURIComponent(siteId)}`), enabled: Boolean(siteId) });
  const { data: queryGroups } = useQuery({ queryKey: ['critical-asset-groups', siteId], queryFn: () => apiFetch<Group[]>(`/api/v1/settings/access-groups?siteId=${encodeURIComponent(siteId)}`), enabled: Boolean(siteId) && isAdmin });
  const data = hydrated ? queryData : undefined;
  // The server render has no query data, so it is always "loading" until hydration finishes.
  const loading = hydrated ? isLoading : true;
  const error = hydrated ? queryError : null;
  const groups = (hydrated && queryGroups) || noGroups;
  const locale = hydrated && window.localStorage.getItem('cociber.locale') === 'en-US' ? 'en-US' : 'pt-PT';
  const formatDate = useCallback((value?: string | null, withTime = false) => {
    if (!value) return '—';
    const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
    return withTime ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date) : new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(date);
  }, [locale]);

  const rows = useMemo(() => buildRows(data), [data]);
  const counts = useMemo(() => countRows(rows), [rows]);
  const visible = useMemo(() => filterRows(rows, search, filters), [rows, search, filters]);
  const owners = useMemo(() => {
    const byId = new Map<string, Group>();
    for (const group of [...(data?.mappings.map((mapping) => mapping.group) ?? []), ...groups]) byId.set(group.id, group);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data?.mappings, groups]);
  const eligible = (row: AssetRow) => canReview && row.pending.length > 0;
  const visibleEligible = visible.filter(eligible);
  const selectedRows = rows.filter((row) => selected.has(row.id) && eligible(row));
  const bulkItems: BulkItem[] = selectedRows.flatMap((row) => { const attestation = currentCycle(row); return attestation ? [{ key: attestation.id, attestationId: attestation.id, assetName: row.name, weekStart: attestation.weekStart }] : []; });
  const bulkOlder = selectedRows.filter(hasOlderPending).length;
  const detail = rows.find((row) => row.id === detailId) ?? null;
  const filtering = hasActiveFilters(search, filters);

  // Drop selections that are no longer reviewable (e.g. recorded elsewhere).
  useEffect(() => {
    setSelected((current) => {
      const next = new Set([...current].filter((id) => rows.some((row) => row.id === id && row.pending.length > 0)));
      return next.size === current.size ? current : next;
    });
  }, [rows]);

  const remember = () => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; };
  const restoreFocus = () => { const target = returnFocus.current; returnFocus.current = null; window.setTimeout(() => target?.isConnected && target.focus(), 0); };
  const openDetail = (row: AssetRow) => { remember(); setDetailId(row.id); };
  const closeDetail = () => { setDetailId(''); restoreFocus(); };
  const openReview = (asset: AssetRow, attestation: Attestation, outcome: Outcome) => { if (!detailId) remember(); setReview({ asset, attestation, outcome }); };
  const closeReview = () => { setReview(null); if (!detailId) restoreFocus(); };
  const openOwner = (type: string) => { if (!detailId) remember(); setOwnerType(type); };
  const closeOwner = () => { setOwnerType(null); if (!detailId) restoreFocus(); };
  const closeBulk = () => { if (bulkRunning) return; setBulkPlan(null); setBulkResults(null); restoreFocus(); };

  const closeTopmost = useRef<() => void>(() => undefined);
  closeTopmost.current = () => {
    if (review) closeReview();
    else if (ownerType !== null) closeOwner();
    else if (bulkPlan) closeBulk();
    else if (detailId) closeDetail();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeTopmost.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const panelClose = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (detailId) panelClose.current?.focus(); }, [detailId]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['critical-assets'] });
  const applySaved = (saved: Attestation) => queryClient.setQueriesData<CriticalAssetsResult>({ queryKey: ['critical-assets'] }, (current) => withRecordedAttestation(current, saved));
  const postReview = (attestationId: string, outcome: Outcome, notes?: string) => apiFetch<Attestation>(`/api/v1/critical-assets/${attestationId}/confirm`, { method: 'POST', body: JSON.stringify({ outcome, notes: notes || undefined }) });

  /** Single review. Returns an error text for the dialog, or null on success. */
  const record = async (asset: AssetRow, attestation: Attestation, outcome: Outcome, notes?: string): Promise<string | null> => {
    setNotice(null);
    try {
      const saved = await postReview(attestation.id, outcome, notes);
      applySaved({ ...saved, id: attestation.id });
      setNotice({ tone: 'success', text: outcome === 'CONFIRMED' ? `${asset.name}: confirmação registada.` : `${asset.name}: pedido de correção registado.` });
      void refresh();
      return null;
    } catch (cause) {
      const text = errorText(cause, 'Não foi possível registar a revisão.');
      if (isAlreadyRecorded(cause)) { setNotice({ tone: 'error', text }); void refresh(); return null; }
      setNotice({ tone: 'error', text });
      return text;
    }
  };
  const quickConfirm = (asset: AssetRow) => { const attestation = asset.pending[0]; if (attestation) void record(asset, attestation, 'CONFIRMED'); };
  const submitReview = async (outcome: Outcome, notes: string) => {
    if (!review) return null;
    const failure = await record(review.asset, review.attestation, outcome, notes);
    if (!failure) closeReview();
    return failure;
  };

  const runBulk = async () => {
    if (!bulkPlan) return;
    setBulkRunning(true);
    const results: Record<string, BulkResult> = {};
    setBulkResults({});
    for (const item of bulkPlan.items) {
      try {
        const saved = await postReview(item.attestationId, 'CONFIRMED');
        applySaved({ ...saved, id: item.attestationId });
        results[item.key] = { key: item.key, state: 'recorded' };
      } catch (cause) {
        results[item.key] = isAlreadyRecorded(cause)
          ? { key: item.key, state: 'already', message: errorText(cause, 'Esta revisão já tinha sido registada.') }
          : { key: item.key, state: 'failed', message: errorText(cause, 'Não foi possível registar a revisão.') };
      }
      setBulkResults({ ...results });
    }
    setBulkRunning(false);
    setSelected(new Set());
    void refresh();
  };

  const saveOwner = async (input: { assetType: string; groupId: string; timezone: string }) => {
    try {
      await apiFetch(`/api/v1/critical-assets/mapping?siteId=${encodeURIComponent(siteId)}`, { method: 'POST', body: JSON.stringify(input) });
      setNotice({ tone: 'success', text: `Responsável por ${input.assetType} guardado.` });
      setOwnerType(null);
      if (!detailId) restoreFocus();
      await refresh();
      return null;
    } catch (cause) {
      return errorText(cause, 'Não foi possível guardar.');
    }
  };

  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allVisibleSelected = visibleEligible.length > 0 && visibleEligible.every((row) => selected.has(row.id));
  const toggleAll = () => setSelected((current) => {
    const next = new Set(current);
    for (const row of visibleEligible) if (allVisibleSelected) next.delete(row.id); else next.add(row.id);
    return next;
  });
  const setFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const toggleCountFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: current[key] === value ? '' : value }));
  const clearFilters = () => { setSearch(''); setFilters(emptyFilters); };

  const countButtons: Array<{ label: string; value: number; key: keyof Filters; filter: string }> = [
    { label: 'Em atraso', value: counts.overdue, key: 'due', filter: 'overdue' },
    { label: 'Para esta semana', value: counts.dueThisWeek, key: 'due', filter: 'due_this_week' },
    { label: 'Correção pedida', value: counts.needsCorrection, key: 'outcome', filter: 'CORRECTION_NEEDED' },
    { label: 'Sem responsável', value: counts.noOwner, key: 'owner', filter: NO_OWNER },
  ];

  const actions = <>
    {isAdmin && <button className="secondary-button" onClick={() => openOwner(assetTypes[0])}><Users size={14} /> Responsáveis</button>}
    {canReview && <button className="primary-button" disabled={!selectedRows.length} onClick={() => { remember(); setBulkResults(null); setBulkPlan({ selectedCount: selectedRows.length, olderCount: bulkOlder, items: bulkItems }); }}><ShieldCheck size={14} /> {`Confirmar selecionados (${selectedRows.length})`}</button>}
  </>;

  return <AppShell section="Ativos críticos" search={{ value: search, onChange: setSearch, placeholder: 'Pesquisar nome, hostname, IP, série ou etiqueta…', ariaLabel: 'Pesquisar ativos críticos' }} actions={actions}>
    <PageToolbarPortal><div className="interface-toolbar-controls critical-assets-filters">
      <label>Tipo<select aria-label="Filtrar por tipo" value={filters.type} onChange={(event) => setFilter('type', event.target.value)}><option value="">Todos</option>{assetTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
      <label>Responsável<select aria-label="Filtrar por grupo responsável" value={filters.owner} onChange={(event) => setFilter('owner', event.target.value)}><option value="">Todos</option><option value={NO_OWNER}>Sem responsável</option>{owners.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label>Último resultado<select aria-label="Filtrar por último resultado" value={filters.outcome} onChange={(event) => setFilter('outcome', event.target.value)}><option value="">Todos</option><option value="CONFIRMED">Confirmado</option><option value="CORRECTION_NEEDED">Correção pedida</option><option value={NO_OUTCOME}>Sem revisão</option></select></label>
      <label>Prazo<select aria-label="Filtrar por prazo" value={filters.due} onChange={(event) => setFilter('due', event.target.value)}><option value="">Todos</option>{(Object.keys(dueLabels) as Array<keyof typeof dueLabels>).map((state) => <option key={state} value={state}>{dueLabels[state]}</option>)}</select></label>
      {filtering && <button className="secondary-button" onClick={clearFilters}><X size={14} /> Limpar filtros</button>}
    </div></PageToolbarPortal>
    <main className="module-page aligned-workspace"><section className="ipam-card page-primary-card critical-assets-card">
      <div className="panel-heading"><div><h1>Ativos críticos</h1><p className="panel-description">Revisão semanal dos dados de inventário dos ativos críticos do Site.</p></div></div>
      {error && <div className="ipam-alert error" role="alert"><X size={15} />Não foi possível carregar os ativos críticos.</div>}
      {notice && <div className={`ipam-alert ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.tone === 'success' ? <CheckCircle2 size={15} /> : <X size={15} />}{notice.text}</div>}

      <div className="summary-stats settings-audit-stats critical-assets-counts" role="group" aria-label="Resumo e filtros rápidos">
        {countButtons.map((item) => <button key={item.label} type="button" aria-pressed={filters[item.key] === item.filter} className={filters[item.key] === item.filter ? 'active' : ''} onClick={() => toggleCountFilter(item.key, item.filter)}><strong>{item.value}</strong><span>{item.label}</span></button>)}
      </div>

      <h2 className="critical-assets-count" aria-live="polite">{filtering ? `${visible.length} de ${rows.length} ativos` : `${rows.length} ativos críticos`}</h2>
      <div className="ip-table-wrap" role="region" aria-label="Ativos críticos" aria-busy={loading} tabIndex={0}><table className="ip-table critical-assets-table">
        <thead><tr>
          <th scope="col">{canReview ? <input type="checkbox" aria-label="Selecionar todos os ativos com revisão pendente" checked={allVisibleSelected} disabled={!visibleEligible.length} onChange={toggleAll} /> : null}</th>
          <th scope="col">Equipamento</th><th scope="col">Tipo</th><th scope="col">Grupo responsável</th><th scope="col">Último resultado</th><th scope="col">Prazo</th><th scope="col">Ações</th>
        </tr></thead>
        <tbody>{visible.map((row) => <tr key={row.id}>
          <td>{canReview && <input type="checkbox" aria-label={eligible(row) ? `Selecionar ativo ${row.name}` : `${row.name} sem revisão pendente`} disabled={!eligible(row)} checked={selected.has(row.id)} onChange={() => toggle(row.id)} />}</td>
          <td><button className="link-button" aria-label={`Abrir histórico de ${row.name}`} onClick={() => openDetail(row)}>{row.name}</button><small className="mono">{[row.hostname, row.managementIp].filter(Boolean).join(' · ') || '—'}</small></td>
          <td>{row.type}</td>
          <td>{row.owner ? row.owner.name : <span className="state-badge excluded"><i />Sem responsável</span>}</td>
          <td>{row.latestOutcome ? <><span className={`state-badge ${outcomeTone(row.latestOutcome)}`}><i />{outcomeLabel(row.latestOutcome)}</span><small>{formatDate(row.latestConfirmedAt, true)}{row.latestReviewer ? ` · ${row.latestReviewer}` : ''}</small></> : <span className="muted-cell">Sem revisão</span>}</td>
          <td><span className={`state-badge ${dueTone[row.dueState]}`}><i />{dueLabels[row.dueState]}</span>{row.dueDate && <small>{row.dueState === 'up_to_date' || row.dueState === 'unscheduled' ? 'Próximo prazo' : 'Prazo'}: {formatDate(row.dueDate, true)}</small>}{!row.owner && row.pendingCount > 0 ? <small>{`${row.pendingCount} pendentes, sem responsável`}</small> : row.pendingCount > 1 && <small>{`${row.pendingCount} semanas pendentes`}</small>}</td>
          <td className="table-actions">
            {eligible(row) && <><button className="secondary-button" aria-label={`Confirmar revisão de ${row.name}`} onClick={() => quickConfirm(row)}>Confirmar</button><button className="secondary-button" aria-label={`Pedir correção de ${row.name}`} onClick={() => openReview(row, row.pending[0], 'CORRECTION_NEEDED')}>Pedir correção</button></>}
            {isAdmin && !row.owner && <button className="secondary-button" aria-label={`Atribuir responsável a ${row.name}`} onClick={() => openOwner(row.type)}>Atribuir responsável</button>}
          </td>
        </tr>)}</tbody>
      </table></div>
      {!loading && !error && !visible.length && <Empty title={filtering ? 'Sem ativos correspondentes' : 'Ainda não existem ativos críticos'} text={filtering ? 'Muda a pesquisa ou limpa os filtros.' : 'Marca equipamentos como críticos no inventário para os rever aqui.'} />}
    </section></main>

    {detail && <aside className="host-panel critical-assets-panel" aria-label={`Histórico de ${detail.name}`}>
      <div className="host-panel-head"><div><span className="section-kicker">ATIVO CRÍTICO</span><h2>{detail.name}</h2><span>{detail.type} · {detail.owner?.name ?? 'Sem responsável'}</span></div><button ref={panelClose} className="icon-button" onClick={closeDetail} aria-label="Fechar"><X size={18} /></button></div>
      <div className="host-status-line">
        <span>Prazo: <strong>{dueLabels[detail.dueState]}</strong></span>
        <span>Último resultado: <strong>{detail.latestOutcome ? outcomeLabel(detail.latestOutcome) : 'Sem revisão'}</strong></span>
        <span>Pendentes: <strong>{detail.pendingCount}</strong></span>
      </div>
      <div className="host-detail-grid">
        <div><span>Hostname</span><strong>{detail.hostname || '—'}</strong></div>
        <div><span>IP de gestão</span><strong className="mono">{detail.managementIp || '—'}</strong></div>
        <div><span>Número de série</span><strong>{detail.serialNumber || '—'}</strong></div>
        <div><span>Etiqueta</span><strong>{detail.assetTag || '—'}</strong></div>
        <div><span>Estado</span><strong>{detail.status}</strong></div>
        <div><span>Grupo responsável</span><strong>{detail.owner?.name ?? 'Sem responsável'}</strong></div>
      </div>
      {isAdmin && <div className="form-actions"><button className="secondary-button" onClick={() => openOwner(detail.type)}><Users size={14} /> {detail.owner ? 'Alterar responsável' : 'Atribuir responsável'}</button></div>}
      <section className="host-section">
        <h3>{`Histórico de revisões (${detail.attestations.length})`}</h3>
        {detail.attestations.map((attestation) => <article className="host-relation" key={attestation.id}>
          <div>
            <strong>Semana de {formatDate(attestation.weekStart)}</strong>
            <span><span className={`state-badge ${outcomeTone(attestation.outcome)}`}><i />{outcomeLabel(attestation.outcome)}</span>{attestation.outcome && <span>{` · ${formatDate(attestation.confirmedAt, true)} · `}{attestation.confirmedByName ?? 'Revisor desconhecido'}</span>}</span>
            {attestation.notes && <small>Notas: {attestation.notes}</small>}
          </div>
          {!attestation.outcome && canReview && <div className="table-actions">
            <button className="secondary-button" onClick={() => openReview(detail, attestation, 'CONFIRMED')}>Confirmar</button>
            <button className="secondary-button" onClick={() => openReview(detail, attestation, 'CORRECTION_NEEDED')}>Pedir correção</button>
          </div>}
        </article>)}
        {!detail.attestations.length && <p className="panel-description">Ainda não existem revisões para este ativo.</p>}
      </section>
    </aside>}

    {review && <ReviewDialog key={review.attestation.id} asset={review.asset} attestation={review.attestation} initialOutcome={review.outcome} formatDate={formatDate} close={closeReview} submit={submitReview} />}
    {ownerType !== null && <OwnerDialog initialType={ownerType} mappings={data?.mappings ?? []} groups={groups} timezone={data?.timezone ?? 'Europe/Lisbon'} close={closeOwner} save={saveOwner} />}
    {bulkPlan && <BulkConfirmDialog selectedCount={bulkPlan.selectedCount} olderCount={bulkPlan.olderCount} items={bulkPlan.items} results={bulkResults} running={bulkRunning} formatDate={formatDate} close={closeBulk} run={() => void runBulk()} />}
  </AppShell>;
}
