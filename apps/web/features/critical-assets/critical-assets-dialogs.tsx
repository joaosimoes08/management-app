'use client';

import { useState, type FormEvent } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { IpamModal } from '@/features/ipam/components/ipam-modal';
import { assetTypes, type AssetRow, type Attestation, type Group, type Mapping, type Outcome } from './workbench';

export type DateFormatter = (value?: string | null, withTime?: boolean) => string;

/** Review one pending cycle: outcome + notes. Replaces the old window.prompt. */
export function ReviewDialog({ asset, attestation, initialOutcome, formatDate, close, submit }: {
  asset: AssetRow;
  attestation: Attestation;
  initialOutcome: Outcome;
  formatDate: DateFormatter;
  close: () => void;
  submit: (outcome: Outcome, notes: string) => Promise<string | null>;
}) {
  const [outcome, setOutcome] = useState<Outcome>(initialOutcome);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (outcome === 'NEEDS_CORRECTION' && !notes.trim()) { setError('Indica os dados a corrigir.'); return; }
    setSaving(true);
    setError('');
    const failure = await submit(outcome, notes.trim());
    setSaving(false);
    if (failure) setError(failure);
  };
  return <IpamModal title={`Rever ${asset.name}`} close={close}><form className="modal-form" onSubmit={(event) => void onSubmit(event)}>
    <p className="panel-description">{`Semana de ${formatDate(attestation.weekStart)}. Confirma nome, tipo, hostname, IP de gestão, número de série, etiqueta e estado. Nada é alterado automaticamente no inventário.`}</p>
    {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}
    <div className="settings-methods" role="radiogroup" aria-label="Resultado da revisão">
      <label><input type="radio" name="critical-asset-outcome" value="CONFIRMED" checked={outcome === 'CONFIRMED'} onChange={() => setOutcome('CONFIRMED')} />Dados corretos</label>
      <label><input type="radio" name="critical-asset-outcome" value="NEEDS_CORRECTION" checked={outcome === 'NEEDS_CORRECTION'} onChange={() => setOutcome('NEEDS_CORRECTION')} />Pedir correção</label>
    </div>
    <label>{outcome === 'NEEDS_CORRECTION' ? 'Dados a corrigir (obrigatório)' : 'Notas (opcional)'}<textarea autoFocus rows={4} maxLength={1000} required={outcome === 'NEEDS_CORRECTION'} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? 'A guardar…' : outcome === 'NEEDS_CORRECTION' ? 'Registar pedido de correção' : 'Registar confirmação'}</button></div>
  </form></IpamModal>;
}

export type BulkItem = { key: string; attestationId: string; assetName: string; weekStart: string };
export type BulkResult = { key: string; state: 'recorded' | 'already' | 'failed'; message?: string };
const bulkResultLabel: Record<BulkResult['state'], string> = { recorded: 'Registado', already: 'Já registado', failed: 'Falha ao registar' };
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
  const done = results !== null && !running;
  const recorded = Object.values(results ?? {}).filter((result) => result.state === 'recorded').length;
  return <IpamModal title="Confirmar selecionados" close={running ? () => undefined : close}><div className="modal-form">
    <p className="panel-description">{`${selectedCount} ativos selecionados · ${items.length} revisões da semana atual. Cada revisão é registada como “Dados corretos”, sem notas.`}</p>
    {olderCount > 0 && <div className="ipam-alert warning" role="note">{olderCount === 1 ? '1 ativo tem semanas anteriores por rever. Revê-as individualmente no histórico.' : `${olderCount} ativos têm semanas anteriores por rever. Revê-as individualmente no histórico.`}</div>}
    {done && <div className={`ipam-alert ${recorded === items.length ? 'success' : 'error'}`} role="status">{recorded === items.length ? <CheckCircle2 size={15} /> : <X size={15} />}{`${recorded} de ${items.length} registadas.`}</div>}
    <div className="ip-table-wrap" role="region" aria-label="Revisões a confirmar" tabIndex={0}><table className="ip-table critical-assets-bulk-table">
      <thead><tr><th>Equipamento</th><th>Semana</th><th>Estado</th></tr></thead>
      <tbody>{items.map((item) => {
        const result = results?.[item.key];
        return <tr key={item.key}><td><strong>{item.assetName}</strong>{result?.message && <small>{result.message}</small>}</td><td>{formatDate(item.weekStart)}</td><td>{result ? <span className={`state-badge ${bulkResultTone[result.state]}`}><i />{bulkResultLabel[result.state]}</span> : <span className="muted-cell">{running ? 'A registar…' : 'Por registar'}</span>}</td></tr>;
      })}</tbody>
    </table></div>
    <div className="modal-actions">{done ? <button type="button" className="primary-button" onClick={close}>Fechar</button> : <><button type="button" className="secondary-button" disabled={running} onClick={close}>Cancelar</button><button type="button" className="primary-button" disabled={running || !items.length} onClick={run}>{running ? 'A registar…' : `Confirmar ${items.length} revisões`}</button></>}</div>
  </div></IpamModal>;
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
  return <IpamModal title="Atribuir responsável" close={close}><form className="modal-form" onSubmit={(event) => void onSubmit(event)}>
    <p className="panel-description">O grupo fica responsável pela revisão semanal de todos os ativos críticos deste tipo no Site.</p>
    {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}
    <label>Tipo de ativo<select value={assetType} onChange={(event) => { setAssetType(event.target.value); setGroupId(currentGroup(event.target.value)); }}>{assetTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
    <label>Grupo responsável<select required autoFocus value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Seleciona um grupo</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    <label>Fuso horário do Site<input required value={zone} onChange={(event) => setZone(event.target.value)} placeholder="Europe/Lisbon" /></label>
    <div className="host-detail-grid">{assetTypes.map((type) => <div key={type}><span>{type}</span><strong>{mappings.find((mapping) => mapping.assetType === type)?.group.name ?? 'Sem responsável'}</strong></div>)}</div>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button className="primary-button" disabled={!groupId || saving}>{saving ? 'A guardar…' : 'Guardar responsável'}</button></div>
  </form></IpamModal>;
}
