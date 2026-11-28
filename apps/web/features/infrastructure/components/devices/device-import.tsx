'use client';

import { useEscapeClose } from '@/components/ui/use-escape-close';
import { useDialogFocusRef } from '@/components/ui/use-dialog-focus';
import { useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import type { DeviceModel } from '../../types';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useUiText } from '@/components/ui/use-ui-text';

export const deviceImportFields = ['name', 'type', 'hostname', 'managementIp', 'serialNumber', 'assetTag', 'status', 'modelId', 'rackId', 'rackUnitStart', 'rackUnitSize', 'notes'] as const;
type Field = typeof deviceImportFields[number];
type Preview = { total: number; valid: number; invalid: number; rows: { rowNumber: number; data: Record<string, unknown>; valid: boolean; errors: string[] }[] };

export function parseDeviceCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], value = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { value += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(value.trim()); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[index + 1] === '\n') index++; row.push(value.trim()); if (row.some(Boolean)) rows.push(row); row = []; value = ''; }
    else value += char;
  }
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function detectDeviceImportMapping(headers: string[]): Partial<Record<Field, number>> {
  const mapping: Partial<Record<Field, number>> = {};
  for (const [index, header] of headers.entries()) {
    const key = header.trim().toLowerCase().replace(/[\s_-]/g, '');
    const field = deviceImportFields.find((item) => item.toLowerCase() === key);
    if (field) mapping[field] = index;
  }
  return mapping;
}

export function mapDeviceImportRows(values: string[][], mapping: Partial<Record<Field, number>>, models: DeviceModel[]) {
  return values.slice(1).map((line) => Object.fromEntries(Object.entries(mapping).flatMap(([field, column]) => {
    if (column === undefined || !line[column]) return [];
    let value = line[column];
    if (field === 'type' || field === 'status') value = value.toUpperCase();
    if (field === 'modelId') value = models.find((model) => model.id === value || `${model.manufacturer} ${model.model}`.toLocaleLowerCase() === value.toLocaleLowerCase())?.id ?? value;
    return [[field, value]];
  })));
}

export function DeviceImport({ siteId, models, close, onComplete }: { siteId: string; models: DeviceModel[]; close: () => void; onComplete: () => void }) {
  const ui = useUiText();
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const [fileName, setFileName] = useState('');
  const [columns, setColumns] = useState<string[]>([]);
  const [values, setValues] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Partial<Record<Field, number>>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mappedRows = useMemo(() => mapDeviceImportRows(values, mapping, models), [values, mapping, models]);
  useEscapeClose(close);
  const dialogRef = useDialogFocusRef<HTMLElement>();

  async function readFile(file?: File) {
    if (!file) return;
    try {
      const parsed = parseDeviceCsv(await file.text());
      if (parsed.length < 2) throw new Error(ui('infrastructure.deviceImport.theCsvMustIncludeHeaders'));
      setFileName(file.name); setColumns(parsed[0]); setValues(parsed); setPreview(null); setError('');
      setMapping(detectDeviceImportMapping(parsed[0]));
    } catch (cause) { setError(cause instanceof Error ? cause.message : ui('infrastructure.deviceImport.couldNotReadTheFile')); }
  }
  async function validate() {
    setBusy(true); setError('');
    try { setPreview(await apiFetch<Preview>('/api/v1/devices/import/preview', { method: 'POST', body: JSON.stringify({ siteId, rows: mappedRows }) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : ui('infrastructure.deviceImport.couldNotValidateTheCsv')); }
    finally { setBusy(false); }
  }
  async function confirmImport() {
    if (!preview || preview.invalid || !(await askConfirm({ title: ui('infrastructure.deviceImport.importDevices'), message: ui('infrastructure.deviceImport.confirmImport', undefined, { count: preview.valid }), confirmLabel: ui('infrastructure.deviceImport.import') }))) return;
    setBusy(true); setError('');
    try { await apiFetch('/api/v1/devices/import', { method: 'POST', body: JSON.stringify({ siteId, rows: mappedRows }) }); onComplete(); close(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : ui('infrastructure.deviceImport.theImportFailedValidateThe')); setPreview(null); }
    finally { setBusy(false); }
  }
  return <>{confirmDialog}<div className="modal-backdrop" role="presentation"><section ref={dialogRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="device-import-title"><header className="modal-header"><div><h2 id="device-import-title">{ui('infrastructure.deviceImport.importDevicesFromCsv')}</h2></div><button className="icon-button" onClick={close} aria-label={ui('infrastructure.deviceImport.close')}>×</button></header>
    <label>{ui('infrastructure.deviceImport.csvFile')}<input type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event.target.files?.[0])} /></label>{fileName && <p>{fileName} · {Math.max(0, values.length - 1)} linhas</p>}
    {columns.length > 0 && <fieldset><legend>{ui('infrastructure.deviceImport.mapColumns')}</legend>{deviceImportFields.map((field) => <label key={field} style={{ display: 'inline-flex', gap: 8, margin: 6 }}>{field}<select value={mapping[field] ?? ''} onChange={(event) => { setMapping({ ...mapping, [field]: event.target.value ? Number(event.target.value) : undefined }); setPreview(null); }}><option value="">{ui('infrastructure.deviceImport.ignore')}</option>{columns.map((column, index) => <option key={index} value={index}>{column}</option>)}</select></label>)}</fieldset>}
    {mapping.modelId !== undefined && <p>{ui('infrastructure.deviceImport.theModelCanBeIdentified')}</p>}
    {error && <div className="ipam-alert error">{error}</div>}{preview && <><p>{ui('infra.import.summary', undefined, { valid: preview.valid, invalid: preview.invalid })}</p><div style={{ maxHeight: 260, overflow: 'auto' }}>{preview.rows.map((item) => <div key={item.rowNumber} className={`host-row ${item.valid ? '' : 'error'}`}><strong>{ui('infra.import.row', undefined, { row: item.rowNumber })}</strong><span>{String(item.data.name ?? ui('infra.import.noName'))}</span>{item.errors.length > 0 && <small>{item.errors.join(' · ')}</small>}</div>)}</div></>}
    <footer className="modal-actions"><button className="secondary-button" onClick={close}>{ui('infrastructure.deviceImport.cancel')}</button><button className="secondary-button" disabled={!values.length || busy} onClick={() => void validate()}>{busy ? ui('infrastructure.deviceImport.validating') : ui('infrastructure.deviceImport.previewAndValidate')}</button>{preview && <button className="primary-button" disabled={busy || preview.invalid > 0 || preview.valid === 0} onClick={() => void confirmImport()}>{busy ? ui('infra.import.importing') : ui('infra.import.confirm', undefined, { count: preview.valid })}</button>}</footer>
  </section></div></>;
}
