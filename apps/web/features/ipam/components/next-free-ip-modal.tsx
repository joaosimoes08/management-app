'use client';

import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IpamModal } from './ipam-modal';
import { DataTable } from '@/components/data-table/data-table';
import { getNextFreeIps, reserveNextIps } from '../api';
import type { NextFreeIpsQuery, ReserveNextIpsResult, Subnet } from '../types';
import { ApiRequestError } from '@/lib/api/errors';

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
        ? `Não há IPs livres suficientes neste intervalo. Disponíveis: ${available}.`
        : cause.message;
    }
    if (cause.code === 'IP_RANGE_CHANGED') return 'Os IPs livres mudaram entretanto. A lista foi atualizada; revê-a e tenta novamente.';
    if (cause.code === 'IP_RANGE_UNSUPPORTED') return 'A reserva automática só está disponível para subnets IPv4.';
    return cause.message;
  }
  return cause instanceof Error && cause.message ? cause.message : 'Não foi possível reservar IPs nesta subnet.';
}

/** "Próximo IP livre": looks up the next free addresses and, for writers, reserves them atomically. */
export function NextFreeIpModal({ subnet, canReserve, close, reserved }: Props) {
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
      setFormError(`Indica uma quantidade entre 1 e ${NEXT_FREE_MAX_COUNT}.`);
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
      setReserveError('Escolhe uma duração entre 1 hora e 30 dias.');
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

  return <IpamModal title={`Próximo IP livre · ${subnet.cidr}`} close={pending ? () => undefined : close}>
    <form className="modal-form" onSubmit={search} aria-label="Procurar IPs livres">
      <p className="panel-description">Procura os próximos endereços livres da subnet. Indica um intervalo para limitar a pesquisa.</p>
      <label>Quantidade<input type="number" min="1" max={NEXT_FREE_MAX_COUNT} step="1" required value={count} onChange={(event) => setCount(event.target.value)} /></label>
      <label>A partir de<input value={from} maxLength={45} placeholder="ex.: 10.0.0.10" onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Até<input value={to} maxLength={45} placeholder="ex.: 10.0.0.50" onChange={(event) => setTo(event.target.value)} /></label>
      {formError && <p className="ipam-alert error" role="alert">{formError}</p>}
      <div className="modal-actions"><button type="submit" className="secondary-button" disabled={lookup.isFetching}>{lookup.isFetching ? 'A procurar…' : 'Procurar'}</button></div>
    </form>
    <div className="modal-form" aria-live="polite">
      {lookup.isError && <p className="ipam-alert error" role="alert">{lookup.error instanceof Error ? lookup.error.message : 'Não foi possível procurar IPs livres.'}</p>}
      {result && result.supported === false && <p className="ipam-alert warning" role="status">{result.message || 'A pesquisa de IPs livres não é suportada nesta subnet.'}</p>}
      {result && result.supported !== false && !available.length && <p className="ipam-alert warning" role="status">{result.message || 'Não há IPs livres neste intervalo.'}</p>}
      {result && result.supported !== false && available.length > 0 && result.exhausted && available.length < result.requested && <p className="ipam-alert warning" role="status">{`Encontrados ${available.length} de ${result.requested} IPs pedidos: o intervalo não tem mais livres.`}</p>}
      {available.length > 0 && <DataTable rows={available} rowKey={(item) => item.address} label="IPs livres encontrados" columns={[
        { id: 'ip', header: 'IP', className: 'mono', cell: (item) => item.address },
        { id: 'tracked', header: 'Registo IPAM', cell: (item) => (item.tracked ? 'Registado como livre' : 'Ainda não registado') },
      ]} />}
    </div>
    {canReserve && !unsupported && available.length > 0 && <form className="modal-form" onSubmit={reserve} aria-label="Reservar IPs livres">
      <p className="reservation-hint">A reserva é feita no servidor: se os IPs mudarem entretanto, nada é reservado e a lista é atualizada.</p>
      <label>Duração<select value={duration} onChange={(event) => setDuration(event.target.value)}>
        <option value="4">4 horas</option><option value="24">24 horas (predefinição)</option><option value="72">3 dias</option><option value="168">7 dias</option><option value="custom">Personalizada</option>
      </select></label>
      {isCustom && <label>Duração personalizada em horas<input type="number" min="1" max="720" step="1" required value={customHours} onChange={(event) => setCustomHours(event.target.value)} /></label>}
      <label>Motivo<textarea required maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {reserveError && <p className="ipam-alert error" role="alert">{reserveError}</p>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={close} disabled={pending}>Cancelar</button><button type="submit" className="primary-button" disabled={pending || !reason.trim()}>{pending ? 'A reservar…' : `Reservar ${query.count ?? 1} IP(s)`}</button></div>
    </form>}
    {canReserve && unsupported && <p className="ipam-alert warning" role="note">A reserva automática só está disponível para subnets IPv4.</p>}
  </IpamModal>;
}
