import { BadRequestException } from '@nestjs/common';
import { isIP } from 'node:net';
import { calculateSubnetCapacity, CapacityAddress } from './subnet-capacity';

export const UTILIZATION_WARNING_PERCENT = 80;
export const UTILIZATION_CRITICAL_PERCENT = 90;
export type UtilizationBand = 'OK' | 'WARNING' | 'CRITICAL' | 'UNTRACKED';

export function utilizationBand(percent: number | null): UtilizationBand {
  if (percent === null) return 'UNTRACKED';
  if (percent >= UTILIZATION_CRITICAL_PERCENT) return 'CRITICAL';
  if (percent >= UTILIZATION_WARNING_PERCENT) return 'WARNING';
  return 'OK';
}

/** Compact utilisation block attached to each subnet list item (same maths as GET subnets/:id/usage). */
export function subnetUtilization(cidr: string, gateway: string | null | undefined, addresses: CapacityAddress[]) {
  try {
    const point = calculateSubnetCapacity(cidr, gateway, addresses);
    return {
      usableCapacity: point.usableCapacity,
      allocated: point.allocatedAddresses,
      occupied: point.occupiedAddresses,
      reserved: point.reservedAddresses,
      free: point.freeAddresses,
      utilizationPercent: point.utilizationPercent,
      band: utilizationBand(point.utilizationPercent),
    };
  } catch {
    return { usableCapacity: null, allocated: 0, occupied: 0, reserved: 0, free: null, utilizationPercent: null, band: 'UNTRACKED' as UtilizationBand };
  }
}

export type SubnetListOptions = { band?: UtilizationBand[]; minUtilization?: number; sort?: { by: 'utilization' | 'cidr'; direction: 'asc' | 'desc' } };

export function parseSubnetListOptions(input: { band?: string; minUtilization?: string; sort?: string }): SubnetListOptions {
  const options: SubnetListOptions = {};
  if (input.band) {
    const bands = [...new Set(input.band.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean))];
    if (!bands.length || bands.some((value) => !['OK', 'WARNING', 'CRITICAL', 'UNTRACKED'].includes(value))) throw new BadRequestException({ code: 'SUBNET_BAND_FILTER_INVALID', message: 'band deve ser OK, WARNING, CRITICAL ou UNTRACKED.' });
    options.band = bands as UtilizationBand[];
  }
  if (input.minUtilization !== undefined && input.minUtilization !== '') {
    const value = Number(input.minUtilization);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new BadRequestException({ code: 'SUBNET_UTILIZATION_FILTER_INVALID', message: 'minUtilization deve estar entre 0 e 100.' });
    options.minUtilization = value;
  }
  if (input.sort) {
    const [by, direction] = input.sort.trim().toLowerCase().split(':');
    if ((by !== 'utilization' && by !== 'cidr') || (direction !== undefined && direction !== 'asc' && direction !== 'desc')) throw new BadRequestException({ code: 'SUBNET_SORT_INVALID', message: 'sort deve ser utilization, utilization:asc, cidr ou cidr:desc.' });
    options.sort = { by, direction: (direction as 'asc' | 'desc' | undefined) ?? (by === 'utilization' ? 'desc' : 'asc') };
  }
  return options;
}

function ipv4Number(address: string) { return address.split('.').reduce((value, part) => value * 256 + Number(part), 0); }
function ipv4Address(value: number) { return [Math.floor(value / 16777216) % 256, Math.floor(value / 65536) % 256, Math.floor(value / 256) % 256, value % 256].join('.'); }

export function ipv4Range(cidr: string, gateway?: string | null) {
  const [networkText, prefixText] = cidr.split('/');
  const prefix = Number(prefixText);
  if (isIP(networkText) !== 4 || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const blockSize = 2 ** (32 - prefix);
  const network = Math.floor(ipv4Number(networkText) / blockSize) * blockSize;
  const broadcast = network + blockSize - 1;
  const first = prefix <= 30 ? network + 1 : network;
  const last = prefix <= 30 ? broadcast - 1 : broadcast;
  const gatewayNumber = gateway && isIP(gateway) === 4 ? ipv4Number(gateway) : null;
  return { network, broadcast, first, last, gatewayNumber };
}

/**
 * Lowest `count` usable IPv4 addresses inside [from, to] (defaults: whole usable range) that are not in
 * `blocked`. Network, broadcast and gateway are always skipped.
 */
export function findFreeIpv4(cidr: string, gateway: string | null | undefined, blocked: Set<string>, count: number, from?: string, to?: string) {
  const range = ipv4Range(cidr, gateway);
  if (!range) return { supported: false as const, addresses: [] as string[] };
  let start = range.first; let end = range.last;
  if (from) {
    if (isIP(from) !== 4) throw new BadRequestException({ code: 'IP_RANGE_INVALID', message: 'from deve ser um IPv4.' });
    const value = ipv4Number(from); if (value < range.network || value > range.broadcast) throw new BadRequestException({ code: 'IP_RANGE_INVALID', message: 'from está fora da subnet.' });
    start = Math.max(start, value);
  }
  if (to) {
    if (isIP(to) !== 4) throw new BadRequestException({ code: 'IP_RANGE_INVALID', message: 'to deve ser um IPv4.' });
    const value = ipv4Number(to); if (value < range.network || value > range.broadcast) throw new BadRequestException({ code: 'IP_RANGE_INVALID', message: 'to está fora da subnet.' });
    end = Math.min(end, value);
  }
  if (start > end) throw new BadRequestException({ code: 'IP_RANGE_INVALID', message: 'from tem de ser anterior a to.' });
  const addresses: string[] = [];
  for (let value = start; value <= end && addresses.length < count; value++) {
    if (value === range.gatewayNumber) continue;
    const address = ipv4Address(value);
    if (!blocked.has(address)) addresses.push(address);
  }
  return { supported: true as const, addresses };
}

export function discoveryJobDurationMs(job: { startedAt: Date | null; completedAt: Date | null }) {
  return job.startedAt && job.completedAt ? Math.max(0, job.completedAt.getTime() - job.startedAt.getTime()) : null;
}
