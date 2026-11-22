'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { IpamModal } from '@/features/ipam/components/ipam-modal';
import { formatDateTime } from '@/lib/format/date';
import { createRackUnitReservation, listRackUnitReservations, releaseRackUnitReservation, type RackUnitReservation } from '../../api';

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

/** "U10–U13" or "U10" for a one-unit reservation. */
export function reservationUnits(item: Pick<RackUnitReservation, 'startUnit' | 'size'>) {
  return item.size > 1 ? `U${item.startUnit}–U${item.startUnit + item.size - 1}` : `U${item.startUnit}`;
}

/**
 * Round 2 #18: U-space reserved for planned installs. Plain state rather than React Query, like the power summary:
 * the rack view renders without a QueryClient. Reserving and releasing need rack edit rights; the server re-checks.
 */
export function RackUnitReservations({ rackId, rackUnits, canEdit }: { rackId: string; rackUnits: number; canEdit: boolean }) {
  const { confirm, confirmDialog } = useConfirm();
  const [items, setItems] = useState<RackUnitReservation[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    try { setItems(await listRackUnitReservations(rackId)); setError(''); }
    catch (cause) { setError(errorMessage(cause, 'Não foi possível carregar as reservas de U.')); }
  }, [rackId]);
  useEffect(() => { void load(); }, [load]);

  const release = async (item: RackUnitReservation) => {
    if (!(await confirm({ title: 'Libertar reserva', message: `Libertar ${reservationUnits(item)} (${item.reason})? O espaço deixa de contar como ocupado na previsão de capacidade.`, confirmLabel: 'Libertar', cancelLabel: 'Voltar', destructive: true }))) return;
    setBusyId(item.id);
    try { await releaseRackUnitReservation(rackId, item.id); await load(); }
    catch (cause) { setError(errorMessage(cause, 'Não foi possível libertar a reserva.')); }
    finally { setBusyId(''); }
  };

  if (!canEdit && !items.length && !error) return null;
  return <section className="rack-unit-reservations" aria-label="Reservas de U">{confirmDialog}
    <div className="panel-heading"><div><span className="section-kicker">RESERVAS DE U</span><p className="panel-description">Espaço guardado para instalações planeadas. Conta como ocupado na previsão de capacidade.</p></div>
      {canEdit && <div className="button-row"><button type="button" className="secondary-button" onClick={() => setCreating(true)}><Plus size={13} /> Reservar U</button></div>}</div>
    {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}
    {items.map((item) => <div className="result-row" key={item.id}><span><strong>{reservationUnits(item)}</strong><small>{item.reason}{item.expiresAt ? ` · até ${formatDateTime(item.expiresAt)}` : ''}{item.createdBy ? ` · ${item.createdBy.displayName || item.createdBy.username}` : ''}</small></span>
      {canEdit && <span className="result-actions"><button type="button" className="secondary-button" disabled={busyId === item.id} onClick={() => void release(item)}>Libertar</button></span>}</div>)}
    {!items.length && !error && <div className="no-data">Sem reservas de U.</div>}
    {creating && <RackUnitReservationModal rackId={rackId} rackUnits={rackUnits} close={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }} />}
  </section>;
}

function RackUnitReservationModal({ rackId, rackUnits, close, onSaved }: { rackId: string; rackUnits: number; close: () => void; onSaved: () => void }) {
  const [startUnit, setStartUnit] = useState('');
  const [size, setSize] = useState('1');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const start = Number(startUnit);
    const units = Number(size);
    if (!Number.isInteger(start) || !Number.isInteger(units) || start < 1 || units < 1 || start + units - 1 > rackUnits) { setError(`A reserva tem de caber entre U1 e U${rackUnits}.`); return; }
    setSaving(true);
    try {
      await createRackUnitReservation(rackId, { startUnit: start, size: units, reason: reason.trim(), ...(expiresAt ? { expiresAt: new Date(`${expiresAt}T23:59:59`).toISOString() } : {}) });
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Não foi possível reservar as unidades.'));
    } finally { setSaving(false); }
  };

  return <IpamModal title="Reservar U" close={close}>
    <form className="modal-form" onSubmit={submit}>
      {error && <div className="ipam-alert error" role="alert">{error}</div>}
      <label>U inicial<input type="number" min={1} max={rackUnits} required value={startUnit} onChange={(event) => setStartUnit(event.target.value)} /></label>
      <label>Número de U<input type="number" min={1} max={rackUnits} required value={size} onChange={(event) => setSize(event.target.value)} /></label>
      <label>Motivo<input type="text" minLength={3} maxLength={500} required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <label>Válida até (opcional)<input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
      <div className="modal-actions">
        <button type="button" className="secondary-button" disabled={saving} onClick={close}>Cancelar</button>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? 'A guardar…' : 'Reservar'}</button>
      </div>
    </form>
  </IpamModal>;
}
