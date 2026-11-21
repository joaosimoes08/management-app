'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Eye, Upload, X } from 'lucide-react';
import { ApiRequestError } from '@/lib/api/errors';
import { getRipeImport, importRipe, listRipeImports, listVrfs, previewRipe } from '../api';
import type { NetworkMapVlan, RipeDiffItem, RipeDiffReason, RipeDiffStatus, RipeImportRecord, RipeImportResult, RipePreview, RipePreviewInput, RipeQueryType, RipeSubnetRef, Vrf } from '../types';
import { Empty, IpamModal } from './ipam-modal';

const statusLabel: Record<RipeDiffStatus, string> = { new: 'Novo', changed: 'Alterado', exists: 'Já existe', conflict: 'Conflito' };
const statusBadge: Record<RipeDiffStatus, string> = { new: 'free', changed: 'reserved', exists: 'occupied', conflict: 'excluded' };
const reasonLabel: Record<RipeDiffReason, string> = {
  NEW: 'Prefixo novo: será criado como subnet.',
  NEW_OVERLAPS_OTHER_SCOPE: 'Prefixo novo: sobrepõe subnets de outro Site ou VRF, o que é permitido.',
  EXISTS_SAME: 'Já existe neste Site com os mesmos atributos.',
  EXISTS_DIFFERENT_ATTRIBUTES: 'Já existe neste Site com atributos diferentes; a importação não altera subnets existentes.',
  OVERLAP: 'Sobrepõe uma subnet existente no mesmo Site/VRF.',
  EXISTS_OUTSIDE_SITE: 'Já existe noutro Site ou sem Site; os CIDR são únicos na aplicação.',
};
const fieldLabel: Record<string, string> = { vrfId: 'VRF', purpose: 'Finalidade', environment: 'Ambiente' };
const importStatusLabel: Record<string, string> = { PREVIEW: 'Pré-visualização', IMPORTED: 'Importado', PARTIAL: 'Parcial', FAILED: 'Falhou' };
const importStatusBadge: Record<string, string> = { PREVIEW: '', IMPORTED: 'occupied', PARTIAL: 'reserved', FAILED: 'excluded' };
const queryTypeLabel: Record<string, string> = { asn: 'ASN', prefix: 'Prefixo', organisation: 'Organização', paste: 'Lista colada' };

export interface RipeViewProps {
  siteId: string;
  search: string;
  vlans: NetworkMapVlan[];
  canPreview: boolean;
  canImport: boolean;
  success: (operation: string, message: string) => void;
  toastError: (operation: string, message: string) => void;
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Operação falhou.');
const formatDate = (value: string) => new Date(value).toLocaleString('pt-PT');
/** The server diff is tied to the target Site + VRF; changing either makes it stale. */
const targetKey = (siteId: string, vrfId: string) => `${siteId}|${vrfId}`;

const subnetLabel = (ref?: RipeSubnetRef) => (!ref ? '' : ref.hidden ? 'uma subnet sem acesso de leitura' : ref.cidr);

/** Extra detail for a diff row: the colliding subnet, the overlaps or the attribute differences. */
export function ripeDiffDetail(item: RipeDiffItem, vrfs: Vrf[] = []): string[] {
  const vrfName = (id: string | null) => (id ? vrfs.find((vrf) => vrf.id === id)?.name ?? id : 'sem VRF');
  const value = (field: string, raw: string | null) => (field === 'vrfId' ? vrfName(raw) : raw || '—');
  const lines: string[] = [];
  if (item.existing && item.reason !== 'EXISTS_SAME') lines.push(`Subnet existente: ${subnetLabel(item.existing)}`);
  for (const change of item.changes ?? []) lines.push(`${fieldLabel[change.field] ?? change.field}: ${value(change.field, change.current)} → ${value(change.field, change.proposed)}`);
  for (const overlap of item.overlaps ?? []) lines.push(`${overlap.relation === 'within' ? 'Dentro de' : 'Contém'} ${subnetLabel(overlap.subnet)}${overlap.sameScope ? '' : ' (outro Site/VRF)'}`);
  return lines;
}

function DiffBadge({ status }: { status: RipeDiffStatus }) {
  return <span className={`state-badge ${statusBadge[status]}`}><i />{statusLabel[status]}</span>;
}

function ImportStatusBadge({ status }: { status: string }) {
  return <span className={`state-badge ${importStatusBadge[status] ?? ''}`.trim()}><i />{importStatusLabel[status] ?? status}</span>;
}

/** RIPE import: RIPEstat lookup or pasted/uploaded list → server diff against the Site/VRF → confirm import; plus import history. */
export function RipeView({ siteId, search, vlans, canPreview, canImport, success, toastError }: RipeViewProps) {
  const queryClient = useQueryClient();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [queryType, setQueryType] = useState<RipeQueryType | ''>('');
  const [pasted, setPasted] = useState('');
  const [fileName, setFileName] = useState('');
  const [vrfId, setVrfId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [environment, setEnvironment] = useState('');
  const [vlanId, setVlanId] = useState('');
  const [preview, setPreview] = useState<RipePreview | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [lastResult, setLastResult] = useState<RipeImportResult | null>(null);
  const [detailId, setDetailId] = useState('');

  const { data: vrfs } = useQuery({ queryKey: ['ipam', 'vrfs', siteId], queryFn: () => listVrfs(siteId), enabled: Boolean(siteId) && canPreview });
  const { data: history, isLoading: loadingHistory, error: historyError } = useQuery({ queryKey: ['ipam', 'ripe-imports'], queryFn: listRipeImports, enabled: canPreview });
  const { data: detail } = useQuery({ queryKey: ['ipam', 'ripe-import', detailId], queryFn: () => getRipeImport(detailId), enabled: Boolean(detailId) });

  const stale = Boolean(preview) && previewKey !== targetKey(siteId, vrfId);
  const diff = preview?.diff ?? [];
  const importable = new Set(diff.filter((item) => item.importable).map((item) => item.prefix));
  const chosen = stale ? [] : selected.filter((prefix) => importable.has(prefix));
  const summary = preview?.summary;
  const term = search.trim().toLowerCase();
  const visibleHistory = (history ?? []).filter((item) => !term || `${item.query} ${item.queryType} ${item.status}`.toLowerCase().includes(term));

  if (!canPreview) return <Empty title="Importação RIPE" text="A pré-visualização e importação RIPE estão disponíveis apenas para ADMIN e NETWORK_OPERATOR." />;

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPasted(await file.text());
    setFileName(file.name);
  };

  const runPreview = async (event: FormEvent, source: 'ripestat' | 'paste') => {
    event.preventDefault();
    const target = { siteId, ...(vrfId ? { vrfId } : {}) };
    const body: RipePreviewInput = source === 'paste'
      ? { ...target, prefixes: [pasted], ...(fileName ? { query: `Ficheiro ${fileName}`.slice(0, 160) } : {}) }
      : { ...target, query: query.trim(), ...(queryType ? { queryType } : {}) };
    setPreviewing(true);
    setPreviewError('');
    setLastResult(null);
    try {
      const result = await previewRipe(body);
      setPreview(result);
      setPreviewKey(targetKey(siteId, vrfId));
      setSelected((result.diff ?? []).filter((item) => item.importable).map((item) => item.prefix));
      setPasteOpen(false);
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
    if (!preview || stale || !chosen.length) return;
    if (!confirm(`Importar ${chosen.length} prefixo(s) como subnets deste Site?`)) return;
    const target = preview.target ?? { siteId, vrfId: vrfId || null };
    setImporting(true);
    try {
      const result = await importRipe({ importId: preview.id, prefixes: chosen, siteId: target.siteId, vrfId: target.vrfId ?? undefined, vlanId: vlanId || undefined, purpose: purpose.trim() || undefined, environment: environment.trim() || undefined });
      setLastResult(result);
      setPreview(null);
      setSelected([]);
      if (result.status === 'FAILED') toastError('Importação RIPE', `Nenhum prefixo foi importado (${result.skipped.length} ignorado(s)).`);
      else success('Importação RIPE', `${result.created.length} subnet(s) criada(s)${result.skipped.length ? `, ${result.skipped.length} ignorada(s)` : ''}.`);
      await queryClient.invalidateQueries({ queryKey: ['ipam'] });
    } catch (cause) {
      // A stale diff (target changed) cannot be imported: drop it so the user previews again.
      if (cause instanceof ApiRequestError && cause.code === 'RIPE_PREVIEW_TARGET_MISMATCH') { setPreview(null); setSelected([]); setPreviewError(message(cause)); }
      toastError('Importação RIPE', message(cause));
    } finally {
      setImporting(false);
    }
  };

  const toggle = (prefix: string, checked: boolean) => setSelected((current) => (checked ? [...new Set([...current, prefix])] : current.filter((item) => item !== prefix)));

  const vrfSelect = <label>VRF de destino<select value={vrfId} onChange={(event) => setVrfId(event.target.value)}><option value="">Sem VRF</option>{(vrfs ?? []).map((vrf) => <option key={vrf.id} value={vrf.id}>{vrf.name}</option>)}</select><small>As diferenças são calculadas para este Site e VRF.</small></label>;

  return <>
    <section className="ipam-card calculator-panel">
      <div className="panel-heading"><div><span className="section-kicker">RIPE</span><h2>Importar prefixos RIPE</h2><p className="panel-description">Consulta o RIPEstat ou cola uma lista de prefixos, revê as diferenças calculadas pelo servidor e confirma a importação.</p></div><button className="secondary-button" onClick={() => { setPreviewError(''); setPasteOpen(true); }}><ClipboardList size={14} /> Colar ou carregar lista</button></div>
      <form className="calculator-form" onSubmit={(event) => void runPreview(event, 'ripestat')}>
        <label>Consulta RIPEstat<input required minLength={2} maxLength={160} placeholder="AS3243, 193.136.0.0/15 ou organização" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label>Tipo<select value={queryType} onChange={(event) => setQueryType(event.target.value as RipeQueryType | '')}><option value="">Detetar automaticamente</option><option value="asn">ASN</option><option value="prefix">Prefixo</option><option value="organisation">Organização</option></select></label>
        {vrfSelect}
        <button className="primary-button" disabled={previewing}><Eye size={14} /> {previewing ? 'A pré-visualizar…' : 'Pré-visualizar'}</button>
      </form>
      {previewError && !pasteOpen && <div className="ipam-alert error" role="alert"><X size={15} />{previewError}</div>}
      {lastResult && <div className="usage-summary" role="status"><strong>{`${lastResult.created.length} subnet(s) criada(s)`}</strong><span>{`${lastResult.skipped.length} ignorada(s) · ${importStatusLabel[lastResult.status] ?? lastResult.status}`}</span>{lastResult.skipped.map((item) => <span key={item.cidr} className="mono">{item.cidr}: {item.reason}</span>)}</div>}
    </section>

    {preview && stale && <p className="ipam-scope-note" role="status">O Site ou o VRF de destino mudou depois da pré-visualização. Pré-visualiza novamente para atualizar as diferenças antes de importar.</p>}

    {preview && !stale && <section className="ipam-card">
      <div className="panel-heading"><div><span className="section-kicker">{`PRÉ-VISUALIZAÇÃO · ${queryTypeLabel[preview.queryType] ?? preview.queryType}`}</span><h2>{preview.query}</h2></div></div>
      {summary && <div className="usage-summary" aria-label="Resumo das diferenças"><strong>{`${summary.importable} importáveis`}</strong><span>{`${summary.new} novos · ${summary.changed} alterados · ${summary.exists} já existem · ${summary.conflict} em conflito`}</span><span>{`${summary.invalid} inválidos · ${summary.duplicates} duplicados`}</span></div>}
      {diff.length || preview.invalid?.length ? <div className="ip-table-wrap" role="region" aria-label="Diferenças RIPE" tabIndex={0}><table className="ip-table">
        <thead><tr><th>Importar</th><th>Prefixo</th><th>Resultado</th><th>Detalhe</th></tr></thead>
        <tbody>
          {diff.map((item) => <tr key={item.prefix}>
            <td><input type="checkbox" aria-label={`Importar ${item.prefix}`} disabled={!item.importable || !canImport} checked={chosen.includes(item.prefix)} onChange={(event) => toggle(item.prefix, event.target.checked)} /></td>
            <td className="mono">{item.prefix}{item.input !== item.prefix && <small>{`Introduzido: ${item.input}`}</small>}</td>
            <td><DiffBadge status={item.status} /></td>
            <td>{reasonLabel[item.reason] ?? item.message}{ripeDiffDetail(item, vrfs).map((line) => <small key={line}>{line}</small>)}</td>
          </tr>)}
          {(preview.invalid ?? []).map((item) => <tr key={`invalid-${item.input}`}>
            <td><input type="checkbox" aria-label={`Importar ${item.input}`} disabled checked={false} readOnly /></td>
            <td className="mono">{item.input}</td>
            <td><span className="state-badge excluded"><i />Inválido</span></td>
            <td>{item.reason === 'MISSING_PREFIX_LENGTH' ? 'Falta o comprimento do prefixo (por exemplo /24).' : 'Não é um prefixo IPv4/IPv6 válido em notação CIDR.'}</td>
          </tr>)}
        </tbody>
      </table></div> : <Empty title="Sem prefixos" text="A consulta não devolveu prefixos." />}
      {Boolean(preview.duplicates?.length) && <p className="ipam-scope-note">{`Duplicados ignorados: ${(preview.duplicates ?? []).join(', ')}`}</p>}
      {canImport ? diff.length > 0 && <form className="calculator-form" onSubmit={(event) => void runImport(event)}>
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
          <td><ImportStatusBadge status={item.status} /></td>
          <td>{item.result?.prefixes?.length ?? 0}</td>
          <td>{item.status === 'PREVIEW' ? '—' : `${item.result?.created?.length ?? 0} / ${item.result?.skipped?.length ?? 0}`}</td>
          <td className="table-actions"><button className="icon-button subtle" title={`Ver importação ${item.query}`} aria-label={`Ver importação ${item.query}`} onClick={() => setDetailId(item.id)}><Eye size={14} /></button></td>
        </tr>)}</tbody>
      </table></div>
      {!loadingHistory && !historyError && !visibleHistory.length && <Empty title={term ? 'Sem importações correspondentes' : 'Ainda não existem importações RIPE'} text={term ? 'Experimenta outra pesquisa.' : 'As pré-visualizações e importações aparecem aqui.'} />}
    </section>

    {pasteOpen && <IpamModal title="Colar ou carregar prefixos" close={() => setPasteOpen(false)}><form className="modal-form" onSubmit={(event) => void runPreview(event, 'paste')}>
      {previewError && <div className="ipam-alert error" role="alert"><X size={15} />{previewError}</div>}
      <label>Prefixos<textarea required rows={8} maxLength={20000} placeholder={'193.0.0.0/21\n2001:db8::/32'} aria-describedby="ripe-paste-help" value={pasted} onChange={(event) => { setPasted(event.target.value); setFileName(''); }} /><small id="ripe-paste-help">Um ou mais prefixos CIDR separados por linhas, espaços, vírgulas ou ponto e vírgula. Máximo 500.</small></label>
      <label>Ficheiro .txt ou .csv<input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(event) => void readFile(event)} />{fileName && <small>{`Carregado: ${fileName}`}</small>}</label>
      {vrfSelect}
      <button className="primary-button" disabled={previewing || !pasted.trim()}><Eye size={14} /> {previewing ? 'A pré-visualizar…' : 'Pré-visualizar'}</button>
    </form></IpamModal>}

    {detailId && <RipeImportPanel item={detail ?? null} vrfs={vrfs ?? []} close={() => setDetailId('')} />}
  </>;
}

function RipeImportPanel({ item, vrfs, close }: { item: RipeImportRecord | null; vrfs: Vrf[]; close: () => void }) {
  const prefixes = item?.result?.prefixes ?? [];
  const selectedPrefixes = new Set(item?.result?.selected ?? []);
  const skipped = item?.result?.skipped ?? [];
  const diffByPrefix = new Map((item?.result?.diff ?? []).map((entry) => [entry.prefix, entry]));
  return <aside className="host-panel" aria-label="Detalhe da importação RIPE">
    <div className="host-panel-head"><div><span className="section-kicker">IMPORTAÇÃO RIPE</span><h2>{item?.query ?? '…'}</h2><span>{item ? formatDate(item.createdAt) : ''}</span></div><button className="icon-button" onClick={close} aria-label="Fechar"><X size={18} /></button></div>
    {!item ? <div className="content-skeleton ip-table-skeleton-line" aria-label="A carregar importação" aria-busy="true" /> : <>
      <div className="host-detail-grid">
        <div><span>Tipo</span><strong>{queryTypeLabel[item.queryType] ?? item.queryType}</strong></div>
        <div><span>Estado</span><strong><ImportStatusBadge status={item.status} /></strong></div>
        <div><span>Prefixos</span><strong>{prefixes.length}</strong></div>
        <div><span>Selecionados</span><strong>{selectedPrefixes.size}</strong></div>
        <div><span>Subnets criadas</span><strong>{item.result?.created?.length ?? 0}</strong></div>
        <div><span>Ignorados</span><strong>{skipped.length}</strong></div>
      </div>
      {skipped.length > 0 && <section className="host-section"><h3>Prefixos ignorados</h3>{skipped.map((entry) => <article className="host-relation" key={entry.cidr}><div><strong className="mono">{entry.cidr}</strong><span>{entry.reason}</span></div></article>)}</section>}
      <section className="host-section"><h3>Prefixos</h3>{prefixes.map((cidr) => { const entry = diffByPrefix.get(cidr); return <article className="host-relation" key={cidr}><div><strong className="mono">{cidr}</strong><span>{selectedPrefixes.has(cidr) ? 'Selecionado para importação' : 'Não selecionado'}{entry ? ` · ${reasonLabel[entry.reason] ?? entry.message}` : ''}</span>{entry && ripeDiffDetail(entry, vrfs).map((line) => <span key={line}>{line}</span>)}</div>{entry && <DiffBadge status={entry.status} />}</article>; })}{!prefixes.length && <p className="panel-description">Sem prefixos nesta consulta.</p>}</section>
      {Boolean(item.result?.invalid?.length) && <section className="host-section"><h3>Entradas inválidas</h3>{(item.result?.invalid ?? []).map((entry) => <article className="host-relation" key={entry.input}><div><strong className="mono">{entry.input}</strong><span>{entry.reason === 'MISSING_PREFIX_LENGTH' ? 'Falta o comprimento do prefixo (por exemplo /24).' : 'Não é um prefixo IPv4/IPv6 válido em notação CIDR.'}</span></div></article>)}</section>}
    </>}
  </aside>;
}
