'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { IpamModal } from './ipam-modal';
import type { IpAddressRow } from '../types';

type Props = { ip: IpAddressRow; close: () => void; submit: (durationHours: number, reason: string) => Promise<void> };

export function IpReservationModal({ ip, close, submit }: Props) {
  const [duration, setDuration] = useState('24');
  const [customHours, setCustomHours] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const durationRef = useRef<HTMLSelectElement>(null);
  const pendingRef = useRef(false);
  pendingRef.current = pending;
  const isCustom = duration === 'custom';

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    durationRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pendingRef.current) close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [close]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const hours = isCustom ? Number(customHours) : Number(duration);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
      setError('Escolhe uma duração entre 1 hora e 30 dias.');
      return;
    }
    setPending(true);
    setError('');
    try { await submit(hours, reason.trim()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível reservar este endereço.'); }
    finally { setPending(false); }
  };

  return <IpamModal title={`Reservar ${ip.address}`} close={close}>
    <form className="modal-form" onSubmit={save}>
      <p className="reservation-hint">Reserva este IP para uma intervenção gerida pelo operador. A duração predefinida é 24 horas.</p>
      <label>Duração<select ref={durationRef} value={duration} onChange={(event) => setDuration(event.target.value)}>
        <option value="4">4 horas</option><option value="24">24 horas (predefinição)</option><option value="72">3 dias</option><option value="168">7 dias</option><option value="custom">Personalizada</option>
      </select></label>
      {isCustom && <label>Duração personalizada em horas<input type="number" min="1" max="720" step="1" required value={customHours} onChange={(event) => setCustomHours(event.target.value)} aria-describedby="reservation-duration-help" /><small id="reservation-duration-help">Indica 1–720 horas (até 30 dias).</small></label>}
      <label>Motivo<textarea required maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {error && <p className="ipam-alert error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={close} disabled={pending}>Cancelar</button><button className="primary-button" disabled={pending || !reason.trim()}>{pending ? 'A reservar…' : 'Reservar IP'}</button></div>
    </form>
  </IpamModal>;
}
