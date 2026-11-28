'use client';

import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CompactModal } from '@/components/ui/compact-modal';
import { DataTable } from '@/components/data-table/data-table';
import { getNextFreeIps, reserveNextIps } from '../api';
import type { NextFreeIpsQuery, ReserveNextIpsResult, Subnet } from '../types';
import { ApiRequestError } from '@/lib/api/errors';
import { useUiText } from '@/components/ui/use-ui-text';
import { ipamText } from '../i18n';

type Props = {
  subnet: Subnet;
  /** ADMIN / NETWORK_OPERATOR with IPAM UPDATE on the site. Readers only see the lookup. */
  canReserve: boolean;
  close: () => void;
  reserved: (result: ReserveNextIpsResult) => void;
};

export const NEXT_FREE_MAX_COUNT = 32;

/** Message for a failed reserve-next. Known conflict codes get a specific hint; anything else shows the API message. */
export function reserveNextErrorMessage(cause: unknown): string {
  if (cause instanceof ApiRequestError) {
    if (cause.code === 'IP_RANGE_EXHAUSTED') {
      const available = cause.payload?.details?.available;
      return typeof available === 'number'
        ? ipamText('ipam.nextFree.exhausted', { available })
        : cause.message;
    }
    if (cause.code === 'IP_RANGE_CHANGED') return ipamText('ipam.nextFreeModal.rangeChanged');
    if (cause.code === 'IP_RANGE_UNSUPPORTED') return ipamText('ipam.nextFreeModal.ipv4Only');
    return cause.message;
  }
  return cause instanceof Error && cause.message ? cause.message : ipamText('ipam.nextFreeModal.reserveError');
}

/** "Próximo IP livre": looks up the next free addresses and, for writers, reserves them atomically. */
export function NextFreeIpModal({ subnet, canReserve, close, reserved }: Props) {
  const ui = useUiText();
  const [count, setCount] = useState('1');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState<NextFreeIpsQuery>({ count: 1 });
  const [formError, setFormError] = useState('');
  const [duration, setDuration] = useState('24');
  const [customHours, setCustomHours] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [reserveError, setReserveError] = useState('');
  const isCustom = duration === 'custom';

  const lookup = useQuery({
    queryKey: ['ipam', 'next-free', subnet.id, query],
    queryFn: () => getNextFreeIps(subnet.id, query),
    retry: false,
  });
  const result = lookup.data;
  const unsupported = subnet.version === 6 || result?.supported === false;
  const available = result?.items ?? [];

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(count);
    if (!Number.isInteger(value) || value < 1 || value > NEXT_FREE_MAX_COUNT) {
      setFormError(ui('ipam.nextFree.countRange', undefined, { max: NEXT_FREE_MAX_COUNT }));
      return;
    }
    setFormError('');
    setReserveError('');
    setQuery({ count: value, from: from.trim() || undefined, to: to.trim() || undefined });
  };

  const reserve = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const hours = isCustom ? Number(customHours) : Number(duration);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
      setReserveError(ui('ipam.reserveForm.durationRange'));
      return;
    }
    setPending(true);
    setReserveError('');
    try {
      const response = await reserveNextIps(subnet.id, { count: query.count ?? 1, from: query.from, to: query.to, durationHours: hours, reason: reason.trim() });
      reserved(response);
    } catch (cause) {
      setReserveError(reserveNextErrorMessage(cause));
      if (cause instanceof ApiRequestError && (cause.code === 'IP_RANGE_CHANGED' || cause.code === 'IP_RANGE_EXHAUSTED')) void lookup.refetch();
    } finally {
      setPending(false);
    }
  };

  return <CompactModal title={ui('ipam.nextFree.title', undefined, { cidr: subnet.cidr })} close={pending ? () => undefined : close}>
    <form className="modal-form" onSubmit={search} aria-label={ui('ipam.nextFreeModal.searchLabel')}>
      <p className="panel-description">{ui('ipam.nextFreeModal.description')}</p>
      <label>{ui('ipam.nextFreeModal.count')}<input type="number" min="1" max={NEXT_FREE_MAX_COUNT} step="1" required value={count} onChange={(event) => setCount(event.target.value)} /></label>
      <label>{ui('ipam.nextFreeModal.from')}<input value={from} maxLength={45} placeholder={ui('ipam.nextFree.example', undefined, { address: '10.0.0.10' })} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>{ui('ipam.nextFreeModal.to')}<input value={to} maxLength={45} placeholder={ui('ipam.nextFree.example', undefined, { address: '10.0.0.50' })} onChange={(event) => setTo(event.target.value)} /></label>
      {formError && <p className="ipam-alert error" role="alert">{formError}</p>}
      <div className="modal-actions"><button type="submit" className="secondary-button" disabled={lookup.isFetching}>{lookup.isFetching ? ui('ipam.nextFreeModal.searching') : ui('ipam.nextFreeModal.search')}</button></div>
    </form>
    <div className="modal-form" aria-live="polite">
      {lookup.isError && <p className="ipam-alert error" role="alert">{lookup.error instanceof Error ? lookup.error.message : ui('ipam.nextFreeModal.searchError')}</p>}
      {result && result.supported === false && <p className="ipam-alert warning" role="status">{result.message || ui('ipam.nextFreeModal.unsupported')}</p>}
      {result && result.supported !== false && !available.length && <p className="ipam-alert warning" role="status">{result.message || ui('ipam.nextFreeModal.none')}</p>}
      {result && result.supported !== false && available.length > 0 && result.exhausted && available.length < result.requested && <p className="ipam-alert warning" role="status">{ui('ipam.nextFree.partial', undefined, { found: available.length, requested: result.requested })}</p>}
      {available.length > 0 && <DataTable rows={available} rowKey={(item) => item.address} label={ui('ipam.nextFreeModal.foundLabel')} columns={[
        { id: 'ip', header: 'IP', className: 'mono', cell: (item) => item.address },
        { id: 'tracked', header: ui('ipam.nextFreeModal.col.tracked'), cell: (item) => (item.tracked ? ui('ipam.nextFreeModal.tracked') : ui('ipam.nextFreeModal.untracked')) },
      ]} />}
    </div>
    {canReserve && !unsupported && available.length > 0 && <form className="modal-form" onSubmit={reserve} aria-label={ui('ipam.nextFreeModal.reserveLabel')}>
      <p className="reservation-hint">{ui('ipam.nextFreeModal.reserveHint')}</p>
      <label>{ui('ipam.reserveForm.duration')}<select value={duration} onChange={(event) => setDuration(event.target.value)}>
        <option value="4">{ui('ipam.reserveForm.hours4')}</option><option value="24">{ui('ipam.reserveForm.hours24')}</option><option value="72">{ui('ipam.reserveForm.days3')}</option><option value="168">{ui('ipam.reserveForm.days7')}</option><option value="custom">{ui('ipam.reserveForm.custom')}</option>
      </select></label>
      {isCustom && <label>{ui('ipam.reserveForm.customHours')}<input type="number" min="1" max="720" step="1" required value={customHours} onChange={(event) => setCustomHours(event.target.value)} /></label>}
      <label>{ui('ipam.reserveForm.reason')}<textarea required maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {reserveError && <p className="ipam-alert error" role="alert">{reserveError}</p>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={close} disabled={pending}>{ui('ipam.reserveForm.cancel')}</button><button type="submit" className="primary-button" disabled={pending || !reason.trim()}>{pending ? ui('ipam.reserveForm.reserving') : ui('ipam.nextFree.reserveCount', undefined, { ips: query.count ?? 1 })}</button></div>
    </form>}
    {canReserve && unsupported && <p className="ipam-alert warning" role="note">{ui('ipam.nextFreeModal.ipv4Only')}</p>}
  </CompactModal>;
}
