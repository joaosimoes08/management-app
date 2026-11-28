'use client';

import { useState, type FormEvent } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { CompactModal } from '@/components/ui/compact-modal';
import { DataTable } from '@/components/data-table/data-table';
import { assetTypes, type AssetRow, type Attestation, type Group, type Mapping } from './workbench';
import { useUiText } from '@/components/ui/use-ui-text';

export type DateFormatter = (value?: string | null, withTime?: boolean) => string;

/** Confirm one pending cycle: the data is correct; notes are optional. A correction request has its own dialog. */
export function ReviewDialog({ asset, attestation, formatDate, close, submit }: {
  asset: AssetRow;
  attestation: Attestation;
  formatDate: DateFormatter;
  close: () => void;
  submit: (notes: string) => Promise<string | null>;
}) {
  const tx = useUiText();
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    const failure = await submit(notes.trim());
    setSaving(false);
    if (failure) setError(failure);
  };
  return <CompactModal title={tx('criticalAssets.review.title', undefined, { name: asset.name })} close={close}><form className="modal-form" onSubmit={(event) => void onSubmit(event)}>
    <p className="panel-description">{tx('criticalAssets.review.description', undefined, { date: formatDate(attestation.weekStart) })}</p>
    {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}
    <label>{tx('criticalAssets.review.notes')}<textarea autoFocus rows={4} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>{tx('criticalAssets.cancel')}</button><button className="primary-button" disabled={saving}>{saving ? tx('criticalAssets.saving') : tx('criticalAssets.review.submit')}</button></div>
  </form></CompactModal>;
}

/** Request a correction for one pending cycle: the description of what to fix is required. */
export function CorrectionRequestDialog({ asset, attestation, formatDate, close, submit }: {
  asset: AssetRow;
  attestation: Attestation;
  formatDate: DateFormatter;
  close: () => void;
  submit: (description: string) => Promise<string | null>;
}) {
  const tx = useUiText();
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!description.trim()) { setError(tx('criticalAssets.request.required')); return; }
    setSaving(true);
    setError('');
    const failure = await submit(description.trim());
    setSaving(false);
    if (failure) setError(failure);
  };
  return <CompactModal title={tx('criticalAssets.request.title', undefined, { name: asset.name })} close={close}><form className="modal-form" onSubmit={(event) => void onSubmit(event)}>
    <p className="panel-description">{tx('groupB.assets.requestCorrectionWeek', undefined, { date: formatDate(attestation.weekStart) })}</p>
    {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}
    <label>{tx('criticalAssets.request.label')}<textarea autoFocus rows={4} maxLength={1000} required value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>{tx('criticalAssets.cancel')}</button><button className="primary-button" disabled={saving}>{saving ? tx('criticalAssets.saving') : tx('criticalAssets.request.submit')}</button></div>
  </form></CompactModal>;
}

export type BulkItem = { key: string; attestationId: string; assetName: string; weekStart: string };
export type BulkResult = { key: string; state: 'recorded' | 'already' | 'failed'; message?: string };
const bulkResultTone: Record<BulkResult['state'], string> = { recorded: 'occupied', already: 'reserved', failed: 'excluded' };

/** Bulk confirm: shows the counts, asks first, then reports one line per review. */
export function BulkConfirmDialog({ selectedCount, olderCount, items, results, running, formatDate, close, run }: {
  selectedCount: number;
  /** Selected assets that also have older pending weeks, which bulk never records. */
  olderCount: number;
  items: BulkItem[];
  results: Record<string, BulkResult> | null;
  running: boolean;
  formatDate: DateFormatter;
  close: () => void;
  run: () => void;
}) {
  const tx = useUiText();
  const done = results !== null && !running;
  const recorded = Object.values(results ?? {}).filter((result) => result.state === 'recorded').length;
  return <CompactModal title={tx('criticalAssets.bulk.title')} close={running ? () => undefined : close}><div className="modal-form">
    <p className="panel-description">{tx('groupB.assets.bulkDescription', undefined, { selected: selectedCount, reviews: items.length })}</p>
    {olderCount > 0 && <div className="ipam-alert warning" role="note">{tx('groupB.assets.olderWeeks', undefined, { count: olderCount })}</div>}
    {done && <div className={`ipam-alert ${recorded === items.length ? 'success' : 'error'}`} role="status">{recorded === items.length ? <CheckCircle2 size={15} /> : <X size={15} />}{tx('groupB.assets.recorded', undefined, { recorded, total: items.length })}</div>}
    <DataTable rows={items} rowKey={(item) => item.key} label={tx('criticalAssets.bulk.tableLabel')} className="critical-assets-bulk-table" columns={[
      { id: 'asset', header: tx('criticalAssets.column.asset'), cell: (item) => { const result = results?.[item.key]; return <><strong>{item.assetName}</strong>{result?.message && <small>{result.message}</small>}</>; } },
      { id: 'week', header: tx('criticalAssets.column.week'), cell: (item) => formatDate(item.weekStart) },
      { id: 'state', header: tx('criticalAssets.column.status'), cell: (item) => { const result = results?.[item.key]; return result ? <span className={`state-badge ${bulkResultTone[result.state]}`}><i />{tx(`criticalAssets.bulk.state.${result.state}`)}</span> : <span className="muted-cell">{running ? tx('criticalAssets.bulk.running') : tx('criticalAssets.bulk.pending')}</span>; } },
    ]} />
    <div className="modal-actions">{done ? <button type="button" className="primary-button" onClick={close}>{tx('criticalAssets.close')}</button> : <><button type="button" className="secondary-button" disabled={running} onClick={close}>{tx('criticalAssets.cancel')}</button><button type="button" className="primary-button" disabled={running || !items.length} onClick={run}>{running ? tx('criticalAssets.bulk.running') : tx('criticalAssets.bulk.confirm', undefined, { count: items.length })}</button></>}</div>
  </div></CompactModal>;
}

/** Owner assignment: maps an asset type to the group that reviews it (existing mapping API). */
export function OwnerDialog({ initialType, mappings, groups, timezone, close, save }: {
  initialType: string;
  mappings: Mapping[];
  groups: Group[];
  timezone: string;
  close: () => void;
  save: (input: { assetType: string; groupId: string; timezone: string }) => Promise<string | null>;
}) {
  const tx = useUiText();
  const [assetType, setAssetType] = useState(initialType);
  const currentGroup = (type: string) => mappings.find((mapping) => mapping.assetType === type)?.group.id ?? '';
  const [groupId, setGroupId] = useState(currentGroup(initialType));
  const [zone, setZone] = useState(timezone);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    const failure = await save({ assetType, groupId, timezone: zone });
    setSaving(false);
    if (failure) setError(failure);
  };
  return <CompactModal title={tx('criticalAssets.owner.assign')} close={close}><form className="modal-form" onSubmit={(event) => void onSubmit(event)}>
    <p className="panel-description">{tx('criticalAssets.owner.description')}</p>
    {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}
    <label>{tx('criticalAssets.owner.assetType')}<select value={assetType} onChange={(event) => { setAssetType(event.target.value); setGroupId(currentGroup(event.target.value)); }}>{assetTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
    <label>{tx('criticalAssets.column.owner')}<select required autoFocus value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">{tx('criticalAssets.owner.selectGroup')}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    <label>{tx('criticalAssets.owner.timezone')}<input required value={zone} onChange={(event) => setZone(event.target.value)} placeholder="Europe/Lisbon" /></label>
    <div className="host-detail-grid">{assetTypes.map((type) => <div key={type}><span>{type}</span><strong>{mappings.find((mapping) => mapping.assetType === type)?.group.name ?? tx('criticalAssets.noOwner')}</strong></div>)}</div>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>{tx('criticalAssets.cancel')}</button><button className="primary-button" disabled={!groupId || saving}>{saving ? tx('criticalAssets.saving') : tx('criticalAssets.owner.save')}</button></div>
  </form></CompactModal>;
}

/** Closes an open correction: resolved needs the change made, rejected needs the reason. Replaces free-text notes for these outcomes. */
export function CorrectionCloseDialog({ assetName, description, outcome, close, submit }: {
  assetName: string;
  description: string;
  outcome: 'RESOLVED' | 'REJECTED';
  close: () => void;
  submit: (value: string) => Promise<string | null>;
}) {
  const tx = useUiText();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const resolved = outcome === 'RESOLVED';
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) { setError(resolved ? tx('criticalAssets.closeCorrection.changeRequired') : tx('criticalAssets.closeCorrection.reasonRequired')); return; }
    setSaving(true);
    setError('');
    const failure = await submit(value.trim());
    setSaving(false);
    if (failure) setError(failure);
  };
  return <CompactModal title={tx(resolved ? 'groupB.assets.resolveCorrection' : 'groupB.assets.rejectCorrection', undefined, { name: assetName })} close={close}><form className="modal-form" onSubmit={(event) => void onSubmit(event)}>
    <p className="panel-description">{tx('criticalAssets.closeCorrection.request', undefined, { description })}</p>
    {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}
    <label>{resolved ? tx('criticalAssets.closeCorrection.changeLabel') : tx('criticalAssets.closeCorrection.reasonLabel')}<textarea autoFocus rows={3} maxLength={1000} required value={value} onChange={(event) => setValue(event.target.value)} /></label>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>{tx('criticalAssets.cancel')}</button><button className="primary-button" disabled={saving}>{saving ? tx('criticalAssets.saving') : resolved ? tx('criticalAssets.closeCorrection.resolve') : tx('criticalAssets.closeCorrection.reject')}</button></div>
  </form></CompactModal>;
}
