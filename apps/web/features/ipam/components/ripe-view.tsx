'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Eye, Upload, X } from 'lucide-react';
import { ApiRequestError } from '@/lib/api/errors';
import { getRipeImport, importRipe, listRipeImports, listVrfs, previewRipe } from '../api';
import type { NetworkMapVlan, RipeDiffItem, RipeOverlap, RipeDiffReason, RipeDiffStatus, RipeImportRecord, RipeImportResult, RipePreview, RipePreviewInput, RipeQueryType, RipeSubnetRef, Vrf } from '../types';
import { Empty } from './ipam-modal';
import { CompactModal } from '@/components/ui/compact-modal';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatDateTime } from '@/lib/format/date';
import { useUiText } from '@/components/ui/use-ui-text';
import { ipamText } from '../i18n';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';

const statusLabel: Record<RipeDiffStatus, string> = { get new() { return ipamText('ipam.ripeView.status.new'); }, get changed() { return ipamText('ipam.ripeView.status.changed'); }, get exists() { return ipamText('ipam.ripeView.status.exists'); }, get conflict() { return ipamText('ipam.ripeView.status.conflict'); } };
const statusBadge: Record<RipeDiffStatus, string> = { new: 'free', changed: 'reserved', exists: 'occupied', conflict: 'excluded' };
const reasonLabel: Record<RipeDiffReason, string> = {
  get NEW() { return ipamText('ipam.ripeView.reason.NEW'); },
  get NEW_OVERLAPS_OTHER_SCOPE() { return ipamText('ipam.ripeView.reason.NEW_OVERLAPS_OTHER_SCOPE'); },
  get EXISTS_SAME() { return ipamText('ipam.ripeView.reason.EXISTS_SAME'); },
  get EXISTS_DIFFERENT_ATTRIBUTES() { return ipamText('ipam.ripeView.reason.EXISTS_DIFFERENT_ATTRIBUTES'); },
  get OVERLAP() { return ipamText('ipam.ripeView.reason.OVERLAP'); },
  get EXISTS_OUTSIDE_SITE() { return ipamText('ipam.ripeView.reason.EXISTS_OUTSIDE_SITE'); },
};
const fieldLabel: Record<string, string> = { vrfId: 'VRF', purpose: 'Finalidade', environment: 'Ambiente' };
const importStatusLabel: Record<string, string> = { get PREVIEW() { return ipamText('ipam.ripe.importStatus.PREVIEW'); }, get IMPORTED() { return ipamText('ipam.ripe.importStatus.IMPORTED'); }, get PARTIAL() { return ipamText('ipam.ripe.importStatus.PARTIAL'); }, get FAILED() { return ipamText('ipam.ripe.importStatus.FAILED'); } };
const importStatusBadge: Record<string, string> = { PREVIEW: '', IMPORTED: 'occupied', PARTIAL: 'reserved', FAILED: 'excluded' };
const queryTypeLabel: Record<string, string> = { asn: 'ASN', get prefix() { return ipamText('ipam.ripeView.prefix'); }, get organisation() { return ipamText('ipam.ripeView.organisation'); }, get paste() { return ipamText('ipam.ripeView.pastedList'); } };

export interface RipeViewProps {
  siteId: string;
  search: string;
  vlans: NetworkMapVlan[];
  canPreview: boolean;
  canImport: boolean;
  success: (operation: string, message: string) => void;
  toastError: (operation: string, message: string) => void;
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : ipamText('ipam.common.operationFailed'));
const formatDate = (value: string) => formatDateTime(value);
/** The server diff is tied to the target Site + VRF; changing either makes it stale. */
const targetKey = (siteId: string, vrfId: string) => `${siteId}|${vrfId}`;

const subnetLabel = (ref?: RipeSubnetRef) => (!ref || ref.hidden || !ref.cidr ? ipamText('ipam.ripe.hiddenSubnet') : ref.cidr);
const fieldText = (field: string) => (field === 'purpose' || field === 'environment' ? ipamText(`ipam.ripe.field.${field}`) : fieldLabel[field] ?? field);
const overlapLine = (overlap: RipeOverlap) => {
  if (overlap.source === 'paste') return ipamText('ipam.ripe.overlapPaste', { prefix: overlap.prefix ?? '' });
  return ipamText(`ipam.ripe.${overlap.relation === 'within' ? 'within' : 'contains'}${overlap.sameScope ? '' : 'OtherScope'}`, { subnet: subnetLabel(overlap.subnet) });
};
/** An OVERLAP caused only by earlier prefixes of the same paste is not about the inventory. */
const pasteOnlyOverlap = (item: RipeDiffItem) => item.reason === 'OVERLAP' && Boolean(item.overlaps?.length) && (item.overlaps ?? []).every((overlap) => overlap.source === 'paste');
const reasonText = (item: RipeDiffItem) => (pasteOnlyOverlap(item) ? ipamText('ipam.ripeView.pasteOverlap') : reasonLabel[item.reason] ?? item.message);

/** Extra detail for a diff row: the colliding subnet, the overlaps or the attribute differences. */
export function ripeDiffDetail(item: RipeDiffItem, vrfs: Vrf[] = []): string[] {
  const vrfName = (id: string | null) => (id ? vrfs.find((vrf) => vrf.id === id)?.name ?? id : ipamText('ipam.ripe.noVrf'));
  const value = (field: string, raw: string | null) => (field === 'vrfId' ? vrfName(raw) : raw || '—');
  const lines: string[] = [];
  if (item.existing && item.reason !== 'EXISTS_SAME') lines.push(ipamText('ipam.ripe.existing', { subnet: subnetLabel(item.existing) }));
  const changes = Array.isArray(item.changes) ? item.changes : [];
  for (const change of changes) lines.push(ipamText('ipam.ripe.change', { field: fieldText(change.field), from: value(change.field, change.current), to: value(change.field, change.proposed) }));
  if (item.status === 'changed' && !changes.length) lines.push(ipamText('ipam.ripeView.hiddenValues'));
  for (const overlap of Array.isArray(item.overlaps) ? item.overlaps : []) lines.push(overlapLine(overlap));
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
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const ui = useUiText();
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
  const historyColumns: DataTableColumn<RipeImportRecord>[] = [
    { id: 'date', header: ui('ipam.ripe.col.date'), cell: (item) => formatDate(item.createdAt) },
    { id: 'query', header: ui('ipam.ripeView.col.query'), className: 'mono', cell: (item) => item.query },
    { id: 'type', header: ui('ipam.common.type'), cell: (item) => queryTypeLabel[item.queryType] ?? item.queryType },
    { id: 'status', header: ui('ipam.common.status'), cell: (item) => <ImportStatusBadge status={item.status} /> },
    { id: 'prefixes', header: ui('ipam.ripeView.prefixes'), cell: (item) => item.result?.prefixes?.length ?? 0 },
    { id: 'outcome', header: ui('ipam.ripeView.col.outcome'), cell: (item) => (item.status === 'PREVIEW' ? '—' : `${item.result?.created?.length ?? 0} / ${item.result?.skipped?.length ?? 0}`) },
    { id: 'actions', header: ui('ipam.common.actions'), className: 'table-actions', cell: (item) => <button className="icon-button subtle" title={ui('ipam.ripe.viewImport', undefined, { query: item.query })} aria-label={ui('ipam.ripe.viewImport', undefined, { query: item.query })} onClick={() => setDetailId(item.id)}><Eye size={14} /></button> },
  ];

  if (!canPreview) return <Empty title={ui('ipam.ripeView.title')} text={ui('ipam.ripeView.notAllowed')} />;

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
    if (!(await askConfirm({ title: ui('ipam.ripeView.importTitle'), message: ui('ipam.ripe.importConfirm', undefined, { prefixes: chosen.length }), confirmLabel: ui('ipam.ripeView.import') }))) return;
    const target = preview.target ?? { siteId, vrfId: vrfId || null };
    setImporting(true);
    try {
      const result = await importRipe({ importId: preview.id, prefixes: chosen, siteId: target.siteId, vrfId: target.vrfId ?? undefined, vlanId: vlanId || undefined, purpose: purpose.trim() || undefined, environment: environment.trim() || undefined });
      setLastResult(result);
      setPreview(null);
      setSelected([]);
      if (result.status === 'FAILED') toastError(ui('ipam.ripeView.title'), ui('ipam.ripe.nothingImported', undefined, { skipped: result.skipped.length }));
      else success(ui('ipam.ripeView.title'), result.skipped.length ? ui('ipam.ripe.importedSkipped', undefined, { created: result.created.length, skipped: result.skipped.length }) : ui('ipam.ripe.imported', undefined, { created: result.created.length }));
      await queryClient.invalidateQueries({ queryKey: ['ipam'] });
    } catch (cause) {
      // A stale diff (target changed) cannot be imported: drop it so the user previews again.
      if (cause instanceof ApiRequestError && cause.code === 'RIPE_PREVIEW_TARGET_MISMATCH') { setPreview(null); setSelected([]); setPreviewError(message(cause)); }
      toastError(ui('ipam.ripeView.title'), message(cause));
    } finally {
      setImporting(false);
    }
  };

  const toggle = (prefix: string, checked: boolean) => setSelected((current) => (checked ? [...new Set([...current, prefix])] : current.filter((item) => item !== prefix)));

  const vrfSelect = <label>{ui('ipam.ripeView.targetVrf')}<select value={vrfId} onChange={(event) => setVrfId(event.target.value)}><option value="">{ui('ipam.common.noVrf')}</option>{(vrfs ?? []).map((vrf) => <option key={vrf.id} value={vrf.id}>{vrf.name}</option>)}</select><small>{ui('ipam.ripeView.targetHint')}</small></label>;

  return <>{confirmDialog}<>
    <section className="ipam-card calculator-panel">
      <div className="panel-heading"><div><h2>{ui('ipam.ripeView.importTitle')}</h2><p className="panel-description">{ui('ipam.ripeView.description')}</p></div><button className="secondary-button" onClick={() => { setPreviewError(''); setPasteOpen(true); }}><ClipboardList size={14} /> {ui('ipam.ripeView.pasteButton')}</button></div>
      <form className="calculator-form" onSubmit={(event) => void runPreview(event, 'ripestat')}>
        <label>{ui('ipam.ripeView.ripestatQuery')}<input required minLength={2} maxLength={160} placeholder={ui('ipam.ripe.queryPlaceholder')} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label>{ui('ipam.common.type')}<select value={queryType} onChange={(event) => setQueryType(event.target.value as RipeQueryType | '')}><option value="">{ui('ipam.ripeView.autoDetect')}</option><option value="asn">ASN</option><option value="prefix">{ui('ipam.ripeView.prefix')}</option><option value="organisation">{ui('ipam.ripeView.organisation')}</option></select></label>
        {vrfSelect}
        <button className="primary-button" disabled={previewing}><Eye size={14} /> {previewing ? ui('ipam.ripeView.previewing') : ui('ipam.ripeView.preview')}</button>
      </form>
      {previewError && !pasteOpen && <div className="ipam-alert error" role="alert"><X size={15} />{previewError}</div>}
      {lastResult && <div className="usage-summary" role="status"><strong>{ui('ipam.ripe.createdCount', undefined, { created: lastResult.created.length })}</strong><span>{ui('ipam.ripe.skippedStatus', undefined, { skipped: lastResult.skipped.length, status: importStatusLabel[lastResult.status] ?? lastResult.status })}</span>{lastResult.skipped.map((item) => <span key={item.cidr} className="mono">{item.cidr}: {item.reason}</span>)}</div>}
    </section>

    {preview && stale && <p className="ipam-scope-note" role="status">{ui('ipam.ripeView.stale')}</p>}

    {preview && !stale && <section className="ipam-card">
      <div className="panel-heading"><div><h2>{preview.query}</h2></div></div>
      {summary && <div className="usage-summary" aria-label={ui('ipam.ripe.summaryLabel')}><strong>{ui('ipam.ripe.importable', undefined, { importable: summary.importable })}</strong><span>{ui('ipam.ripe.summaryCounts', undefined, { new: summary.new, changed: summary.changed, exists: summary.exists, conflict: summary.conflict })}</span><span>{ui('ipam.ripe.summaryInvalid', undefined, { invalid: summary.invalid, duplicates: summary.duplicates })}</span></div>}
      {diff.length || preview.invalid?.length ? <div className="ip-table-wrap" role="region" aria-label={ui('ipam.ripe.diffLabel')} tabIndex={0}><table className="ip-table">
        <thead><tr><th>{ui('ipam.ripeView.import')}</th><th>{ui('ipam.ripeView.prefix')}</th><th>{ui('ipam.ripeView.col.result')}</th><th>{ui('ipam.ripeView.col.detail')}</th></tr></thead>
        <tbody>
          {diff.map((item) => <tr key={item.prefix}>
            <td><input type="checkbox" aria-label={ui('ipam.ripe.importPrefix', undefined, { prefix: item.prefix })} disabled={!item.importable || !canImport} checked={chosen.includes(item.prefix)} onChange={(event) => toggle(item.prefix, event.target.checked)} /></td>
            <td className="mono">{item.prefix}{item.input !== item.prefix && <small>{ui('ipam.ripe.input', undefined, { input: item.input })}</small>}</td>
            <td><DiffBadge status={item.status} /></td>
            <td>{reasonText(item)}{ripeDiffDetail(item, vrfs).map((line) => <small key={line}>{line}</small>)}</td>
          </tr>)}
          {(preview.invalid ?? []).map((item) => <tr key={`invalid-${item.input}`}>
            <td><input type="checkbox" aria-label={ui('ipam.ripe.importPrefix', undefined, { prefix: item.input })} disabled checked={false} readOnly /></td>
            <td className="mono">{item.input}</td>
            <td><span className="state-badge excluded"><i />{ui('ipam.ripeView.invalidBadge')}</span></td>
            <td>{item.reason === 'MISSING_PREFIX_LENGTH' ? ui('ipam.ripeView.invalid.missingLength') : ui('ipam.ripeView.invalid.notCidr')}</td>
          </tr>)}
        </tbody>
      </table></div> : <Empty title={ui('ipam.ripeView.noPrefixes')} text={ui('ipam.ripeView.noPrefixesText')} />}
      {Boolean(preview.duplicates?.length) && <p className="ipam-scope-note">{ui('ipam.ripe.duplicates', undefined, { prefixes: (preview.duplicates ?? []).join(', ') })}</p>}
      {canImport ? diff.length > 0 && <form className="calculator-form" onSubmit={(event) => void runImport(event)}>
        <label>VLAN<select value={vlanId} onChange={(event) => setVlanId(event.target.value)}><option value="">{ui('ipam.common.noVlan')}</option>{vlans.map((vlan) => <option key={vlan.id} value={vlan.id}>VLAN {vlan.vlanId} · {vlan.name}</option>)}</select></label>
        <label>{ui('ipam.ripe.field.purpose')}<input maxLength={100} value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label>
        <label>{ui('ipam.ripe.field.environment')}<input maxLength={50} value={environment} onChange={(event) => setEnvironment(event.target.value)} /></label>
        <button className="primary-button" disabled={importing || !chosen.length}><Upload size={14} /> {importing ? ui('ipam.ripeView.importing') : ui('ipam.ripe.importButton', undefined, { prefixes: chosen.length })}</button>
      </form> : <p className="ipam-scope-note">{ui('ipam.ripeView.noImportPermission')}</p>}
    </section>}

    <section className="ipam-card">
      <div className="panel-heading"><div><h2>{ui('ipam.ripeView.history.title')}</h2><p className="panel-description">{ui('ipam.ripeView.history.description')}</p></div></div>
      {historyError && <div className="ipam-alert error"><X size={15} />{message(historyError)}</div>}
      <DataTable rows={visibleHistory} columns={historyColumns} rowKey={(item) => item.id} label={ui('ipam.ripeView.history.label')} loading={loadingHistory} skeletonRows={3} empty={!historyError && <Empty title={term ? ui('ipam.ripeView.history.noMatch') : ui('ipam.ripeView.history.empty')} text={term ? ui('ipam.subnets.tryAnotherSearch') : ui('ipam.ripeView.history.emptyText')} />} />
    </section>

    {pasteOpen && <CompactModal title={ui('ipam.ripeView.pasteTitle')} close={() => setPasteOpen(false)}><form className="modal-form" onSubmit={(event) => void runPreview(event, 'paste')}>
      {previewError && <div className="ipam-alert error" role="alert"><X size={15} />{previewError}</div>}
      <label>{ui('ipam.ripeView.prefixes')}<textarea required rows={8} maxLength={20000} placeholder={'193.0.0.0/21\n2001:db8::/32'} aria-describedby="ripe-paste-help" value={pasted} onChange={(event) => { setPasted(event.target.value); setFileName(''); }} /><small id="ripe-paste-help">{ui('ipam.ripeView.pasteHelp')}</small></label>
      <label>{ui('ipam.ripeView.fileLabel')}<input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(event) => void readFile(event)} />{fileName && <small>{ui('ipam.ripe.loaded', undefined, { file: fileName })}</small>}</label>
      {vrfSelect}
      <button className="primary-button" disabled={previewing || !pasted.trim()}><Eye size={14} /> {previewing ? ui('ipam.ripeView.previewing') : ui('ipam.ripeView.preview')}</button>
    </form></CompactModal>}

    {detailId && <RipeImportPanel item={detail ?? null} vrfs={vrfs ?? []} close={() => setDetailId('')} />}
  </></>;
}

function RipeImportPanel({ item, vrfs, close }: { item: RipeImportRecord | null; vrfs: Vrf[]; close: () => void }) {
  const prefixes = item?.result?.prefixes ?? [];
  const selectedPrefixes = new Set(item?.result?.selected ?? []);
  const skipped = item?.result?.skipped ?? [];
  const diffByPrefix = new Map((item?.result?.diff ?? []).map((entry) => [entry.prefix, entry]));
  const ui = useUiText();
  return <aside className="host-panel" aria-label={ui('ipam.ripe.detailLabel')}>
    <div className="host-panel-head"><div><h2>{item?.query ?? '…'}</h2><span>{item ? formatDate(item.createdAt) : ''}</span></div><button className="icon-button" onClick={close} aria-label={ui('ipam.common.close')}><X size={18} /></button></div>
    {!item ? <div className="content-skeleton ip-table-skeleton-line" aria-label={ui('ipam.ripe.loadingImport')} aria-busy="true" /> : <>
      <div className="host-detail-grid">
        <div><span>{ui('ipam.common.type')}</span><strong>{queryTypeLabel[item.queryType] ?? item.queryType}</strong></div>
        <div><span>{ui('ipam.common.status')}</span><strong><ImportStatusBadge status={item.status} /></strong></div>
        <div><span>{ui('ipam.ripeView.prefixes')}</span><strong>{prefixes.length}</strong></div>
        <div><span>{ui('ipam.ripeView.detail.selected')}</span><strong>{selectedPrefixes.size}</strong></div>
        <div><span>{ui('ipam.ripeView.detail.created')}</span><strong>{item.result?.created?.length ?? 0}</strong></div>
        <div><span>{ui('ipam.ripeView.detail.skipped')}</span><strong>{skipped.length}</strong></div>
      </div>
      {skipped.length > 0 && <section className="host-section"><h3>{ui('ipam.ripeView.detail.skippedPrefixes')}</h3>{skipped.map((entry) => <article className="host-relation" key={entry.cidr}><div><strong className="mono">{entry.cidr}</strong><span>{entry.reason}</span></div></article>)}</section>}
      <section className="host-section"><h3>{ui('ipam.ripeView.prefixes')}</h3>{prefixes.map((cidr) => { const entry = diffByPrefix.get(cidr); return <article className="host-relation" key={cidr}><div><strong className="mono">{cidr}</strong><span>{selectedPrefixes.has(cidr) ? ui('ipam.ripeView.detail.selectedPrefix') : ui('ipam.ripeView.detail.notSelected')}{entry ? ` · ${reasonText(entry)}` : ''}</span>{entry && ripeDiffDetail(entry, vrfs).map((line) => <span key={line}>{line}</span>)}</div>{entry && <DiffBadge status={entry.status} />}</article>; })}{!prefixes.length && <p className="panel-description">{ui('ipam.ripeView.detail.noPrefixes')}</p>}</section>
      {Boolean(item.result?.invalid?.length) && <section className="host-section"><h3>{ui('ipam.ripeView.detail.invalidEntries')}</h3>{(item.result?.invalid ?? []).map((entry) => <article className="host-relation" key={entry.input}><div><strong className="mono">{entry.input}</strong><span>{entry.reason === 'MISSING_PREFIX_LENGTH' ? ui('ipam.ripeView.invalid.missingLength') : ui('ipam.ripeView.invalid.notCidr')}</span></div></article>)}</section>}
    </>}
  </aside>;
}
