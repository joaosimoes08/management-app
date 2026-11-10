'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/app-shell';
import { apiFetch } from '@/lib/api/client';
import { useAuth } from '@/lib/auth';
import { useSiteContext } from '@/lib/site-context';

type Group = { id: string; name: string };
type Attestation = { id: string; weekStart: string; outcome?: string | null; notes?: string | null; confirmedAt?: string | null; confirmedBy?: string | null };
type DeviceRow = { id: string; name: string; type: string; hostname?: string | null; managementIp?: string | null; serialNumber?: string | null; assetTag?: string | null; status: string; assignedGroup?: Group | null; attestations: Attestation[] };
type Result = { timezone: string; assets: DeviceRow[]; unassigned: DeviceRow[]; mappings: Array<{ id: string; assetType: string; group: Group }> };
const types = ['SWITCH', 'ROUTER', 'FIREWALL', 'SERVER', 'STORAGE', 'OTHER'];

export function CriticalAssetsPage() {
  const { siteId } = useSiteContext();
  const { hasRole } = useAuth();
  const canReview = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR'].some(hasRole);
  const queryClient = useQueryClient();
  const [assetType, setAssetType] = useState('SWITCH');
  const [groupId, setGroupId] = useState('');
  const [timezone, setTimezone] = useState('Europe/Lisbon');
  const [notice, setNotice] = useState('');
  const [savedAttestations, setSavedAttestations] = useState<Record<string, Attestation>>({});
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const { data: queryData, error: queryError } = useQuery({ queryKey: ['critical-assets', siteId], queryFn: () => apiFetch<Result>(`/api/v1/critical-assets?siteId=${encodeURIComponent(siteId)}`), enabled: Boolean(siteId) });
  const { data: queryGroups = [] } = useQuery({ queryKey: ['critical-asset-groups', siteId], queryFn: () => apiFetch<Group[]>(`/api/v1/settings/access-groups?siteId=${encodeURIComponent(siteId)}`), enabled: Boolean(siteId) && hasRole('ADMIN') });
  const data = hydrated ? queryData : undefined;
  const error = hydrated ? queryError : null;
  const groups = hydrated ? queryGroups : [];
  const assignedAssets = (data?.assets ?? [])
    .map((asset) => ({ ...asset, assignedGroup: data?.mappings.find((mapping) => mapping.assetType === asset.type)?.group ?? null }))
    .filter((asset) => asset.assignedGroup !== null);
  useEffect(() => { if (data?.timezone) setTimezone(data.timezone); }, [data?.timezone]);
  const saveMapping = async (event: React.FormEvent) => {
    event.preventDefault(); setNotice('');
    try { await apiFetch(`/api/v1/critical-assets/mapping?siteId=${encodeURIComponent(siteId)}`, { method: 'POST', body: JSON.stringify({ assetType, groupId, timezone }) }); setNotice('Mapeamento guardado.'); await queryClient.invalidateQueries({ queryKey: ['critical-assets', siteId] }); }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Não foi possível guardar.'); }
  };
  const confirm = async (row: Attestation, outcome: string) => {
    const notes = outcome === 'CORRECTION_NEEDED' ? window.prompt('Indica os dados a corrigir. Nada será alterado automaticamente:') : '';
    if (outcome === 'CORRECTION_NEEDED' && notes === null) return;
    try {
      const saved = await apiFetch<Attestation>(`/api/v1/critical-assets/${row.id}/confirm`, { method: 'POST', body: JSON.stringify({ outcome, notes: notes || undefined }) });
      setSavedAttestations((current) => ({ ...current, [row.id]: { ...current[row.id], ...saved, id: row.id } }));
      queryClient.setQueriesData<Result>({ queryKey: ['critical-assets'] }, (current) => current ? {
        ...current,
        assets: current.assets.map((device) => ({ ...device, attestations: device.attestations.map((item) => item.id === row.id ? { ...item, ...saved, id: row.id } : item) })),
        unassigned: current.unassigned.map((device) => ({ ...device, attestations: device.attestations.map((item) => item.id === row.id ? { ...item, ...saved, id: row.id } : item) })),
      } : current);
    }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Não foi possível registar a revisão.'); }
  };
  const renderAttestation = (row: Attestation) => {
    const displayedRow = { ...row, ...savedAttestations[row.id] };
    return <span key={displayedRow.id} className="button-row"><small><span>{new Date(displayedRow.weekStart).toLocaleDateString('pt-PT')}</span><span> · </span><span>{displayedRow.outcome ?? 'Pendente'}</span>{displayedRow.notes ? <span>{` · ${displayedRow.notes}`}</span> : null}</small>{canReview && !displayedRow.outcome && <><button className="secondary-button" onClick={() => void confirm(displayedRow, 'CONFIRMED')}>Confirmar</button><button className="secondary-button" onClick={() => void confirm(displayedRow, 'CORRECTION_NEEDED')}>Pedir correção</button></>}</span>;
  };
  return <AppShell section="Ativos críticos"><main className="module-page"><div className="module-hero"><span className="section-kicker">INVENTÁRIO E CONTROLO</span><h1>Ativos críticos</h1><p>Confirmação semanal dos dados; pedidos de correção ficam registados sem alterar o inventário.</p></div>
    {error && <p role="alert">Não foi possível carregar os ativos críticos.</p>}{notice && <p role="status">{notice}</p>}
    {hasRole('ADMIN') && <section className="panel"><div className="panel-heading"><div><span className="section-kicker">RESPONSABILIDADES</span><h2>Mapear grupo por tipo</h2></div></div><form className="modal-form" onSubmit={saveMapping}><label>Tipo de ativo<select value={assetType} onChange={(e) => setAssetType(e.target.value)}>{types.map((type) => <option key={type}>{type}</option>)}</select></label><label>Grupo responsável<select required value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">Seleciona um grupo</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>Fuso horário do Site<input required value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Europe/Lisbon" /></label><button className="primary-button" disabled={!groupId}>Guardar mapeamento</button></form></section>}
    {data?.unassigned.length ? <section className="panel"><div className="panel-heading"><div><span className="section-kicker">AÇÃO NECESSÁRIA</span><h2>Fila sem grupo atribuído ({data.unassigned.length})</h2></div></div><div className="audit-list">{data.unassigned.map((device) => <div className="audit-row" key={device.id}><strong>{device.name}</strong><span>{device.type}</span><span>Sem grupo para revisão semanal</span></div>)}</div></section> : null}
    <section className="panel"><div className="panel-heading"><div><span className="section-kicker">REVISÃO SEMANAL</span><h2 aria-label={`${assignedAssets.length} ativos atribuídos`}><span>{assignedAssets.length}</span><span> ativos atribuídos</span></h2></div></div><div className="audit-list">{assignedAssets.map((device) => <div className="audit-row" key={device.id}><span><strong>{device.name}</strong><small>{device.type} · {device.assignedGroup?.name ?? 'Sem grupo'}</small><small>Hostname: {device.hostname || '—'} · IP: {device.managementIp || '—'}</small><small>Série: {device.serialNumber || '—'} · Etiqueta: {device.assetTag || '—'} · Estado: {device.status}</small></span><span>{device.attestations.slice(0, 4).map(renderAttestation)}</span></div>)}</div></section>
  </main></AppShell>;
}
