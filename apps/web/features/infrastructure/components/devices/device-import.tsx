'use client';

import { useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import type { DeviceModel } from '../../types';

const fields = ['name', 'type', 'hostname', 'managementIp', 'serialNumber', 'assetTag', 'status', 'modelId', 'rackId', 'notes'] as const;
type Field = typeof fields[number];
type Preview = { total: number; valid: number; invalid: number; rows: { rowNumber: number; data: Record<string, string>; valid: boolean; errors: string[] }[] };

function parseCsv(text: string) {
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

export function DeviceImport({ siteId, models, close, onComplete }: { siteId: string; models: DeviceModel[]; close: () => void; onComplete: () => void }) {
  const [fileName, setFileName] = useState('');
  const [columns, setColumns] = useState<string[]>([]);
  const [values, setValues] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Partial<Record<Field, number>>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mappedRows = useMemo(() => values.slice(1).map((line) => Object.fromEntries(Object.entries(mapping).flatMap(([field, column]) => {
    if (column === undefined || !line[column]) return [];
    let value = line[column];
    if (field === 'type' || field === 'status') value = value.toUpperCase();
    if (field === 'modelId') value = models.find((model) => model.id === value || `${model.manufacturer} ${model.model}`.toLocaleLowerCase() === value.toLocaleLowerCase())?.id ?? value;
    return [[field, value]];
  }))), [values, mapping, models]);
  async function readFile(file?: File) {
    if (!file) return;
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2) throw new Error('O CSV deve incluir cabeçalhos e pelo menos uma linha.');
      setFileName(file.name); setColumns(parsed[0]); setValues(parsed); setPreview(null); setError('');
      const detected: Partial<Record<Field, number>> = {};
      for (const [index, header] of parsed[0].entries()) { const key = header.trim().toLowerCase().replace(/[\s_-]/g, ''); const field = fields.find((item) => item.toLowerCase() === key); if (field) detected[field] = index; }
      setMapping(detected);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível ler o ficheiro.'); }
  }
  async function validate() {
    setBusy(true); setError('');
    try { setPreview(await apiFetch<Preview>('/api/v1/devices/import/preview', { method: 'POST', body: JSON.stringify({ siteId, rows: mappedRows }) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao validar o CSV.'); }
    finally { setBusy(false); }
  }
  async function confirmImport() {
    if (!preview || preview.invalid || !window.confirm(`Importar ${preview.valid} equipamentos para este Site?`)) return;
    setBusy(true); setError('');
    try { await apiFetch('/api/v1/devices/import', { method: 'POST', body: JSON.stringify({ siteId, rows: mappedRows }) }); onComplete(); close(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'A importação falhou. Valida novamente o ficheiro.'); setPreview(null); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" role="presentation"><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="device-import-title"><header className="modal-header"><div><span className="section-kicker">IMPORTAÇÃO COM VALIDAÇÃO</span><h2 id="device-import-title">Importar equipamentos CSV</h2></div><button className="icon-button" onClick={close} aria-label="Fechar">×</button></header>
    <label>Ficheiro CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event.target.files?.[0])} /></label>{fileName && <p>{fileName} · {Math.max(0, values.length - 1)} linhas</p>}
    {columns.length > 0 && <fieldset><legend>Associar colunas</legend>{fields.map((field) => <label key={field} style={{ display: 'inline-flex', gap: 8, margin: 6 }}>{field}<select value={mapping[field] ?? ''} onChange={(event) => { setMapping({ ...mapping, [field]: event.target.value ? Number(event.target.value) : undefined }); setPreview(null); }}><option value="">Ignorar</option>{columns.map((column, index) => <option key={index} value={index}>{column}</option>)}</select></label>)}</fieldset>}
    {mapping.modelId !== undefined && <p>O modelo pode ser identificado pelo nome e fabricante, ou pelo ID.</p>}
    {error && <div className="ipam-alert error">{error}</div>}{preview && <><p>{preview.valid} válidas · {preview.invalid} com erros</p><div style={{ maxHeight: 260, overflow: 'auto' }}>{preview.rows.map((item) => <div key={item.rowNumber} className={`host-row ${item.valid ? '' : 'error'}`}><strong>Linha {item.rowNumber}</strong><span>{String(item.data.name ?? '(sem nome)')}</span>{item.errors.length > 0 && <small>{item.errors.join(' · ')}</small>}</div>)}</div></>}
    <footer className="modal-actions"><button className="secondary-button" onClick={close}>Cancelar</button><button className="secondary-button" disabled={!values.length || busy} onClick={() => void validate()}>{busy ? 'A validar…' : 'Pré-visualizar e validar'}</button>{preview && <button className="primary-button" disabled={busy || preview.invalid > 0 || preview.valid === 0} onClick={() => void confirmImport()}>{busy ? 'A importar…' : `Confirmar importação (${preview.valid})`}</button>}</footer>
  </section></div>;
}
