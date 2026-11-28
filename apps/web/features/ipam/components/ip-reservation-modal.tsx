'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CompactModal } from '@/components/ui/compact-modal';
import type { IpAddressRow } from '../types';
import { useUiText } from '@/components/ui/use-ui-text';

type Props = { ip: IpAddressRow; close: () => void; submit: (durationHours: number, reason: string) => Promise<void> };

export function IpReservationModal({ ip, close, submit }: Props) {
  const ui = useUiText();
  const [duration, setDuration] = useState('24');
  const [customHours, setCustomHours] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const durationRef = useRef<HTMLSelectElement>(null);
  const isCustom = duration === 'custom';

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    durationRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const hours = isCustom ? Number(customHours) : Number(duration);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
      setError(ui('ipam.reserveForm.durationRange'));
      return;
    }
    setPending(true);
    setError('');
    try { await submit(hours, reason.trim()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : ui('ipam.reservation.error')); }
    finally { setPending(false); }
  };

  return <CompactModal title={ui('ipam.reservation.title', undefined, { address: ip.address })} close={() => { if (!pending) close(); }}>
    <form className="modal-form" onSubmit={save}>
      <p className="reservation-hint">{ui('ipam.reservation.hint')}</p>
      <label>{ui('ipam.reserveForm.duration')}<select ref={durationRef} value={duration} onChange={(event) => setDuration(event.target.value)}>
        <option value="4">{ui('ipam.reserveForm.hours4')}</option><option value="24">{ui('ipam.reserveForm.hours24')}</option><option value="72">{ui('ipam.reserveForm.days3')}</option><option value="168">{ui('ipam.reserveForm.days7')}</option><option value="custom">{ui('ipam.reserveForm.custom')}</option>
      </select></label>
      {isCustom && <label>{ui('ipam.reserveForm.customHours')}<input type="number" min="1" max="720" step="1" required value={customHours} onChange={(event) => setCustomHours(event.target.value)} aria-describedby="reservation-duration-help" /><small id="reservation-duration-help">{ui('ipam.reservation.durationHelp')}</small></label>}
      <label>{ui('ipam.reserveForm.reason')}<textarea required maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {error && <p className="ipam-alert error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={close} disabled={pending}>{ui('ipam.reserveForm.cancel')}</button><button className="primary-button" disabled={pending || !reason.trim()}>{pending ? ui('ipam.reserveForm.reserving') : ui('ipam.reservation.submit')}</button></div>
    </form>
  </CompactModal>;
}
