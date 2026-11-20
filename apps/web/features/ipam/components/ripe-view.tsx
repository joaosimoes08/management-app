'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Upload, X } from 'lucide-react';
import { getRipeImport, importRipe, listRipeImports, listVrfs, previewRipe } from '../api';
import type { NetworkMapVlan, RipeImportRecord, RipeImportResult, RipePreview, RipeQueryType, Subnet } from '../types';
import { cidrsOverlap, sameCidr } from '../utils';
import { Empty } from './ipam-modal';

export type RipeDiffKind = 'new' | 'exists' | 'conflict';
export interface RipeDiffRow { cidr: string; kind: RipeDiffKind; against?: string }

const kindLabel: Record<RipeDiffKind, string> = { new: 'Novo', exists: 'Já existe', conflict: 'Conflito' };
const kindBadge: Record<RipeDiffKind, string> = { new: 'free', exists: 'occupied', conflict: 'excluded' };
const statusLabel: Record<string, string> = { PREVIEW: 'Pré-visualização', IMPORTED: 'Importado', PARTIAL: 'Parcial', FAILED: 'Falhou' };
const statusBadge: Record<string, string> = { PREVIEW: '', IMPORTED: 'occupied', PARTIAL: 'reserved', FAILED: 'excluded' };
const queryTypeLabel: Record<string, string> = { asn: 'ASN', prefix: 'Prefixo', organisation: 'Organização' };

/**
 * Compares RIPE prefixes with the Site's subnets the same way the API's createSubnet does:
 * an identical CIDR already exists (CIDRs are unique), an overlap in the same Site/VRF is a conflict.
 */
export function classifyRipePrefixes(prefixes: string[], subnets: Subnet[], vrfId = ''): RipeDiffRow[] {
  return prefixes.map((cidr) => {
    const existing = subnets.find((subnet) => sameCidr(subnet.cidr, cidr));
    if (existing) return { cidr, kind: 'exists', against: existing.cidr };
    const overlap = subnets.find((subnet) => (subnet.vrfId ?? '') === vrfId && cidrsOverlap(subnet.cidr, cidr));
    if (overlap) return { cidr, kind: 'conflict', against: overlap.cidr };
    return { cidr, kind: 'new' };
  });
}

export interface RipeViewProps {
  siteId: string;
  search: string;
  subnets: Subnet[];
  vlans: NetworkMapVlan[];
  canPreview: boolean;
  canImport: boolean;
  success: (operation: string, message: string) => void;
  toastError: (operation: string, message: string) => void;
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Operação falhou.');
const formatDate = (value: string) => new Date(value).toLocaleString('pt-PT');

function StatusBadge({ status }: { status: string }) {
  return <span className={`state-badge ${statusBadge[status] ?? ''}`.trim()}><i />{statusLabel[status] ?? status}</span>;
}

/** RIPE import: query RIPEstat → preview diff against the Site → confirm import; plus import history. */
export function RipeView({ siteId, search, subnets, vlans, canPreview, canImport, success, toastError }: RipeViewProps) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [queryType, setQueryType] = useState<RipeQueryType | ''>('');
  const [vrfId, setVrfId] = useState('');
  const [vlanId, setVlanId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [environment, setEnvironment] = useState('');
  const [preview, setPreview] = useState<RipePreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [lastResult, setLastResult] = useState<RipeImportResult | null>(null);
  const [detailId, setDetailId] = useState('');

  const { data: vrfs } = useQuery({ queryKey: ['ipam', 'vrfs', siteId], queryFn: () => listVrfs(siteId), enabled: Boolean(siteId) && canPreview });
  const { data: history, isLoading: loadingHistory, error: historyError } = useQuery({ queryKey: ['ipam', 'ripe-imports'], queryFn: listRipeImports, enabled: canPreview });
  const { data: detail } = useQuery({ queryKey: ['ipam', 'ripe-import', detailId], queryFn: () => getRipeImport(detailId), enabled: Boolean(detailId) });

  const diff = useMemo(() => (preview ? classifyRipePrefixes(preview.prefixes, subnets, vrfId) : []), [preview, subnets, vrfId]);
  const counts = { new: diff.filter((row) => row.kind === 'new').length, exists: diff.filter((row) => row.kind === 'exists').length, conflict: diff.filter((row) => row.kind === 'conflict').length };
  const selectable = new Set(diff.filter((row) => row.kind === 'new').map((row) => row.cidr));
  const chosen = selected.filter((cidr) => selectable.has(cidr));
  const term = search.trim().toLowerCase();
  const visibleHistory = (history ?? []).filter((item) => !term || `${item.query} ${item.queryType} ${item.status}`.toLowerCase().includes(term));

  if (!canPreview) return <Empty title="Importação RIPE" text="A pré-visualização e importação RIPE estão disponíveis apenas para ADMIN e NETWORK_OPERATOR." />;

  const runPreview = async (event: FormEvent) => {
    event.preventDefault();
    setPreviewing(true);
    setPreviewError('');
    setLastResult(null);
    try {
      const result = await previewRipe(query.trim(), queryType || undefined);
      setPreview(result);
      setSelected(classifyRipePrefixes(result.prefixes, subnets, vrfId).filter((row) => row.kind === 'new').map((row) => row.cidr));
      await queryClient.invalidateQueries({ queryKey: ['ipam', 'ripe-imports'] });
    } catch (cause) {
      setPreview(null);
      setPreviewError(message(cause));
    } finally {
      setPreviewing(false);
    }
  };

  const runImport = async (event: FormEvent) => {
    event.preventDefault();
    if (!preview || !chosen.length) return;
    if (!confirm(`Importar ${chosen.length} prefixo(s) como subnets deste Site?`)) return;
    setImporting(true);
    try {
      const result = await importRipe({ importId: preview.id, prefixes: chosen, siteId, vrfId: vrfId || undefined, vlanId: vlanId || undefined, purpose: purpose.trim() || undefined, environment: environment.trim() || undefined });
      setLastResult(result);
      setPreview(null);
      setSelected([]);
      if (result.status === 'FAILED') toastError('Importação RIPE', `Nenhum prefixo foi importado (${result.skipped.length} ignorado(s)).`);
      else success('Importação RIPE', `${result.created.length} subnet(s) criada(s)${result.skipped.length ? `, ${result.skipped.length} ignorada(s)` : ''}.`);
      await queryClient.invalidateQueries({ queryKey: ['ipam'] });
    } catch (cause) {
      toastError('Importação RIPE', message(cause));
    } finally {
      setImporting(false);
    }
  };

  const toggle = (cidr: string, checked: boolean) => setSelected((current) => (checked ? [...new Set([...current, cidr])] : current.filter((item) => item !== cidr)));

  return <>
    <section className="ipam-card calculator-panel">
      <div className="panel-heading"><div><span className="section-kicker">RIPESTAT</span><h2>Importar prefixos RIPE</h2><p className="panel-description">Consulta um ASN, prefixo ou organização, revê as diferenças com as subnets deste Site e confirma a importação.</p></div><Upload size={18} /></div>
      <form className="calculator-form" onSubmit={(event) => void runPreview(event)}>
        <label>Consulta<input required minLength={2} maxLength={160} placeholder="AS3243, 193.136.0.0/15 ou organização" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label>Tipo<select value={queryType} onChange={(event) => setQueryType(event.target.value as RipeQueryType | '')}><option value="">Detetar automaticamente</option><option value="asn">ASN</option><option value="prefix">Prefixo</option><option value="organisation">Organização</option></select></label>
        <label>VRF de destino<select value={vrfId} onChange={(event) => setVrfId(event.target.value)}><option value="">Sem VRF</option>{(vrfs ?? []).map((vrf) => <option key={vrf.id} value={vrf.id}>{vrf.name}</option>)}</select><small>Os conflitos são verificados neste VRF.</small></label>
        <button className="primary-button" disabled={previewing}><Eye size={14} /> {previewing ? 'A consultar…' : 'Pré-visualizar'}</button>
      </form>
      {previewError && <div className="ipam-alert error" role="alert"><X size={15} />{previewError}</div>}
      {lastResult && <div className="usage-summary" role="status"><strong>{lastResult.created.length} subnet(s) criada(s)</strong><span>{lastResult.skipped.length} ignorada(s) · {statusLabel[lastResult.status] ?? lastResult.status}</span>{lastResult.skipped.map((item) => <span key={item.cidr} className="mono">{item.cidr}: {item.reason}</span>)}</div>}
    </section>

    {preview && <section className="ipam-card">
      <div className="panel-heading"><div><span className="section-kicker">PRÉ-VISUALIZAÇÃO · {queryTypeLabel[preview.queryType] ?? preview.queryType}</span><h2>{preview.query}</h2></div></div>
      <div className="usage-summary" aria-label="Resumo das diferenças"><strong>{counts.new} novos</strong><span>{counts.exists} já existem · {counts.conflict} em conflito</span><span>{preview.prefixes.length} prefixos devolvidos pelo RIPE</span></div>
      {preview.prefixes.length ? <div className="ip-table-wrap" role="region" aria-label="Diferenças RIPE" tabIndex={0}><table className="ip-table">
        <thead><tr><th>Importar</th><th>Prefixo</th><th>Resultado</th><th>Detalhe</th></tr></thead>
        <tbody>{diff.map((row) => <tr key={row.cidr}>
          <td><input type="checkbox" aria-label={`Importar ${row.cidr}`} disabled={row.kind !== 'new' || !canImport} checked={chosen.includes(row.cidr)} onChange={(event) => toggle(row.cidr, event.target.checked)} /></td>
          <td className="mono">{row.cidr}</td>
          <td><span className={`state-badge ${kindBadge[row.kind]}`}><i />{kindLabel[row.kind]}</span></td>
          <td>{row.kind === 'exists' ? `Já registada como ${row.against}` : row.kind === 'conflict' ? `Sobrepõe ${row.against} no mesmo Site/VRF` : 'Será criada como subnet'}</td>
        </tr>)}</tbody>
      </table></div> : <Empty title="Sem prefixos" text="O RIPE não devolveu prefixos para esta consulta." />}
      {canImport ? preview.prefixes.length > 0 && <form className="calculator-form" onSubmit={(event) => void runImport(event)}>
        <label>VLAN<select value={vlanId} onChange={(event) => setVlanId(event.target.value)}><option value="">Sem VLAN</option>{vlans.map((vlan) => <option key={vlan.id} value={vlan.id}>VLAN {vlan.vlanId} · {vlan.name}</option>)}</select></label>
        <label>Finalidade<input maxLength={100} value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label>
        <label>Ambiente<input maxLength={50} value={environment} onChange={(event) => setEnvironment(event.target.value)} /></label>
        <button className="primary-button" disabled={importing || !chosen.length}><Upload size={14} /> {importing ? 'A importar…' : `Importar ${chosen.length} prefixo(s)`}</button>
      </form> : <p className="ipam-scope-note">Não tens permissão IMPORT neste Site: podes rever a pré-visualização, mas não importar.</p>}
    </section>}

    <section className="ipam-card">
      <div className="panel-heading"><div><h2>Histórico de importações</h2><p className="panel-description">As 50 consultas e importações RIPE mais recentes.</p></div></div>
      {historyError && <div className="ipam-alert error"><X size={15} />{message(historyError)}</div>}
      <div className="ip-table-wrap" role="region" aria-label="Histórico de importações RIPE" aria-busy={loadingHistory} tabIndex={0}><table className="ip-table">
        <thead><tr><th>Data</th><th>Consulta</th><th>Tipo</th><th>Estado</th><th>Prefixos</th><th>Criadas / ignoradas</th><th>Ações</th></tr></thead>
        <tbody>{loadingHistory ? [0, 1, 2].map((item) => <tr className="ip-table-skeleton-row" aria-hidden="true" key={item}><td colSpan={7}><span className="content-skeleton ip-table-skeleton-line" /></td></tr>) : visibleHistory.map((item) => <tr key={item.id}>
          <td>{formatDate(item.createdAt)}</td>
          <td className="mono">{item.query}</td>
          <td>{queryTypeLabel[item.queryType] ?? item.queryType}</td>
          <td><StatusBadge status={item.status} /></td>
          <td>{item.result?.prefixes?.length ?? 0}</td>
          <td>{item.status === 'PREVIEW' ? '—' : `${item.result?.created?.length ?? 0} / ${item.result?.skipped?.length ?? 0}`}</td>
          <td className="table-actions"><button className="icon-button subtle" title={`Ver importação ${item.query}`} aria-label={`Ver importação ${item.query}`} onClick={() => setDetailId(item.id)}><Eye size={14} /></button></td>
        </tr>)}</tbody>
      </table></div>
      {!loadingHistory && !historyError && !visibleHistory.length && <Empty title={term ? 'Sem importações correspondentes' : 'Ainda não existem importações RIPE'} text={term ? 'Experimenta outra pesquisa.' : 'As pré-visualizações e importações aparecem aqui.'} />}
    </section>

    {detailId && <RipeImportPanel item={detail ?? null} close={() => setDetailId('')} />}
  </>;
}

function RipeImportPanel({ item, close }: { item: RipeImportRecord | null; close: () => void }) {
  const prefixes = item?.result?.prefixes ?? [];
  const selectedPrefixes = new Set(item?.result?.selected ?? []);
  const skipped = item?.result?.skipped ?? [];
  return <aside className="host-panel" aria-label="Detalhe da importação RIPE">
    <div className="host-panel-head"><div><span className="section-kicker">IMPORTAÇÃO RIPE</span><h2>{item?.query ?? '…'}</h2><span>{item ? formatDate(item.createdAt) : ''}</span></div><button className="icon-button" onClick={close} aria-label="Fechar"><X size={18} /></button></div>
    {!item ? <div className="content-skeleton ip-table-skeleton-line" aria-label="A carregar importação" aria-busy="true" /> : <>
      <div className="host-detail-grid">
        <div><span>Tipo</span><strong>{queryTypeLabel[item.queryType] ?? item.queryType}</strong></div>
        <div><span>Estado</span><strong><StatusBadge status={item.status} /></strong></div>
        <div><span>Prefixos devolvidos</span><strong>{prefixes.length}</strong></div>
        <div><span>Selecionados</span><strong>{selectedPrefixes.size}</strong></div>
        <div><span>Subnets criadas</span><strong>{item.result?.created?.length ?? 0}</strong></div>
        <div><span>Ignorados</span><strong>{skipped.length}</strong></div>
      </div>
      {skipped.length > 0 && <section className="host-section"><h3>Prefixos ignorados</h3>{skipped.map((entry) => <article className="host-relation" key={entry.cidr}><div><strong className="mono">{entry.cidr}</strong><span>{entry.reason}</span></div></article>)}</section>}
      <section className="host-section"><h3>Prefixos</h3>{prefixes.map((cidr) => <article className="host-relation" key={cidr}><div><strong className="mono">{cidr}</strong><span>{selectedPrefixes.has(cidr) ? 'Selecionado para importação' : 'Não selecionado'}</span></div></article>)}{!prefixes.length && <p className="panel-description">Sem prefixos nesta consulta.</p>}</section>
    </>}
  </aside>;
}
