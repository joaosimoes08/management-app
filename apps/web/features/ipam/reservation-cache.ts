import type { QueryClient } from '@tanstack/react-query';
import type { IpAddressRow, IpReservation } from './types';

type IpAddressPage = { items: IpAddressRow[] };
export type IpReservationOverrides = Record<string, IpReservation | null>;
export type IpReservationOverrideEpochs = Record<string, number>;
export type IpReservationOverrideState = {
  values: IpReservationOverrides;
  epochs: IpReservationOverrideEpochs;
};

export function applyIpReservationOverride(ip: IpAddressRow, reservation: IpReservation | null): IpAddressRow {
  return { ...ip, state: reservation ? 'RESERVED' : 'FREE', reservation, reservations: reservation ? [reservation] : [] };
}

export function applyIpReservationOverrides(ips: IpAddressRow[], overrides: IpReservationOverrides): IpAddressRow[] {
  return ips.map((ip) => Object.prototype.hasOwnProperty.call(overrides, ip.id)
    ? applyIpReservationOverride(ip, overrides[ip.id])
    : ip);
}

export function serverRowMatchesReservation(ip: IpAddressRow, reservation: IpReservation | null): boolean {
  const activeReservation = ip.reservation ?? ip.reservations?.find((item) => item.status === 'ACTIVE') ?? null;
  return reservation
    ? activeReservation?.id === reservation.id
    : !activeReservation && ip.state === 'FREE';
}

/** Only reconcile from a list request that began after the mutation response. */
export function reconcileIpReservationOverrides(
  rows: IpAddressRow[],
  state: IpReservationOverrideState,
  requestEpoch: number,
): IpReservationOverrideState {
  let next: IpReservationOverrideState | undefined;
  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(state.values, row.id)) continue;
    const overrideEpoch = state.epochs[row.id];
    if (overrideEpoch === undefined || requestEpoch < overrideEpoch || !serverRowMatchesReservation(row, state.values[row.id])) continue;
    next ??= { values: { ...state.values }, epochs: { ...state.epochs } };
    delete next.values[row.id];
    delete next.epochs[row.id];
  }
  return next ?? state;
}

/** Update every cached search result containing this IP before the background refetch. */
export function setCachedIpReservation(queryClient: QueryClient, ipAddressId: string, reservation: IpReservation | null): void {
  queryClient.setQueriesData<IpAddressPage>({ queryKey: ['ipam', 'ips'] }, (page) => {
    if (!page) return page;
    return {
      ...page,
      items: page.items.map((ip) => ip.id === ipAddressId
        ? applyIpReservationOverride(ip, reservation)
        : ip),
    };
  });
}

/** Keep the mutation result authoritative if the invalidation refetch returns an older row. */
export async function syncIpReservationCache(
  queryClient: QueryClient,
  ipAddressId: string,
  reservation: IpReservation | null,
  refresh: () => Promise<unknown>,
): Promise<void> {
  // Publish the mutation result synchronously so mounted rows update as soon as
  // the mutation resolves. Then cancel any list request that could overwrite it.
  setCachedIpReservation(queryClient, ipAddressId, reservation);
  await queryClient.cancelQueries({ queryKey: ['ipam', 'ips'] });
  // Cancellation can restore a request's previous snapshot, so reapply the
  // authoritative mutation result before starting background refreshes.
  setCachedIpReservation(queryClient, ipAddressId, reservation);
  await refresh();
  setCachedIpReservation(queryClient, ipAddressId, reservation);
}
