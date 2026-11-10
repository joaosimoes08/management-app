import { isIP } from 'node:net';

export type CapacityAddress = { address: string; state: string };
export type CapacityPoint = {
  sampledAt: Date;
  version: number;
  usableCapacity: number | null;
  trackedAddresses: number;
  occupiedAddresses: number;
  reservedAddresses: number;
  allocatedAddresses: number;
  freeAddresses: number | null;
  utilizationPercent: number | null;
};

function ipv4Number(address: string) {
  return address.split('.').reduce((value, part) => value * 256 + Number(part), 0);
}

export function calculateSubnetCapacity(cidr: string, gateway: string | null | undefined, addresses: CapacityAddress[], sampledAt = new Date()): CapacityPoint {
  const [networkText, prefixText] = cidr.split('/');
  const version = isIP(networkText);
  const prefix = Number(prefixText);
  if (!version || !Number.isInteger(prefix) || prefix < 0 || prefix > (version === 4 ? 32 : 128)) throw new Error(`Invalid subnet CIDR: ${cidr}`);

  if (version === 6) {
    const tracked = new Set(addresses.filter((item) => isIP(item.address) === 6).map((item) => item.address)).size;
    const occupied = addresses.filter((item) => isIP(item.address) === 6 && (item.state === 'OCCUPIED' || item.state === 'UNKNOWN')).length;
    const reserved = addresses.filter((item) => isIP(item.address) === 6 && item.state === 'RESERVED').length;
    return { sampledAt, version, usableCapacity: null, trackedAddresses: tracked, occupiedAddresses: occupied, reservedAddresses: reserved, allocatedAddresses: occupied + reserved + addresses.filter((item) => isIP(item.address) === 6 && item.state === 'EXCLUDED').length, freeAddresses: null, utilizationPercent: null };
  }

  const addressNumber = ipv4Number(networkText);
  const blockSize = 2 ** (32 - prefix);
  const network = Math.floor(addressNumber / blockSize) * blockSize;
  const broadcast = network + blockSize - 1;
  const first = prefix <= 30 ? network + 1 : network;
  const last = prefix <= 30 ? broadcast - 1 : broadcast;
  const gatewayNumber = gateway && isIP(gateway) === 4 ? ipv4Number(gateway) : null;
  const gatewayConsumesSlot = gatewayNumber !== null && gatewayNumber >= first && gatewayNumber <= last;
  const capacity = Math.max(0, last - first + 1 - (gatewayConsumesSlot ? 1 : 0));
  const usable = addresses.filter((item) => {
    if (isIP(item.address) !== 4) return false;
    const value = ipv4Number(item.address);
    return value >= first && value <= last && value !== gatewayNumber;
  });
  const unique = new Map(usable.map((item) => [item.address, item]));
  const trackedAddresses = unique.size;
  const occupiedAddresses = [...unique.values()].filter((item) => item.state === 'OCCUPIED' || item.state === 'UNKNOWN').length;
  const reservedAddresses = [...unique.values()].filter((item) => item.state === 'RESERVED').length;
  const allocatedAddresses = [...unique.values()].filter((item) => item.state !== 'FREE').length;
  return {
    sampledAt,
    version,
    usableCapacity: capacity,
    trackedAddresses,
    occupiedAddresses,
    reservedAddresses,
    allocatedAddresses,
    freeAddresses: Math.max(0, capacity - allocatedAddresses),
    utilizationPercent: capacity ? Math.round((allocatedAddresses / capacity) * 10000) / 100 : 0,
  };
}

export function forecastSubnetCapacity(points: CapacityPoint[]) {
  const latest = points.at(-1);
  if (!latest || latest.version === 6 || latest.usableCapacity === null) return { status: 'TRACKING_ONLY' as const, daysUntilFull: null, projectedFullAt: null, dailyGrowth: null };
  const history = points.filter((point) => point.version === 4 && point.usableCapacity === latest.usableCapacity && point.usableCapacity !== null).slice(-30);
  if (history.length < 3) return { status: 'INSUFFICIENT_HISTORY' as const, daysUntilFull: null, projectedFullAt: null, dailyGrowth: null };
  const start = history[0].sampledAt.getTime();
  const spanDays = (history.at(-1)!.sampledAt.getTime() - start) / 86_400_000;
  if (spanDays < 7) return { status: 'INSUFFICIENT_HISTORY' as const, daysUntilFull: null, projectedFullAt: null, dailyGrowth: null };
  const values = history.map((point) => ({ x: (point.sampledAt.getTime() - start) / 86_400_000, y: point.allocatedAddresses }));
  const meanX = values.reduce((sum, item) => sum + item.x, 0) / values.length;
  const meanY = values.reduce((sum, item) => sum + item.y, 0) / values.length;
  const covariance = values.reduce((sum, item) => sum + (item.x - meanX) * (item.y - meanY), 0);
  const varianceX = values.reduce((sum, item) => sum + (item.x - meanX) ** 2, 0);
  const slope = varianceX ? covariance / varianceX : 0;
  if (slope <= 0) return { status: 'NO_GROWTH' as const, daysUntilFull: null, projectedFullAt: null, dailyGrowth: 0 };
  const intercept = meanY - slope * meanX;
  const residual = values.reduce((sum, item) => sum + (item.y - (intercept + slope * item.x)) ** 2, 0);
  const total = values.reduce((sum, item) => sum + (item.y - meanY) ** 2, 0);
  const rSquared = total ? 1 - residual / total : 0;
  if (rSquared < 0.5) return { status: 'LOW_CONFIDENCE' as const, daysUntilFull: null, projectedFullAt: null, dailyGrowth: Math.round(slope * 100) / 100 };
  const remaining = Math.max(0, latest.usableCapacity - latest.allocatedAddresses);
  if (remaining === 0) return { status: 'AT_CAPACITY' as const, daysUntilFull: 0, projectedFullAt: latest.sampledAt, dailyGrowth: Math.round(slope * 100) / 100 };
  const daysUntilFull = remaining / slope;
  if (daysUntilFull > 365) return { status: 'BEYOND_FORECAST_WINDOW' as const, daysUntilFull: null, projectedFullAt: null, dailyGrowth: Math.round(slope * 100) / 100 };
  return { status: 'AVAILABLE' as const, daysUntilFull: Math.ceil(daysUntilFull), projectedFullAt: new Date(latest.sampledAt.getTime() + daysUntilFull * 86_400_000), dailyGrowth: Math.round(slope * 100) / 100 };
}
