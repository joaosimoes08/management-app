/** Dotted-quad mask for an IPv4 prefix length. */
export function ipv4Mask(prefix: number): string {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [mask >>> 24, (mask >>> 16) & 255, (mask >>> 8) & 255, mask & 255].join('.');
}

export function isValidIpv4(address: string): boolean {
  const parts = address.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

export function isValidIpAddress(address: string): boolean {
  return isValidIpv4(address) || isValidIpv6(address);
}

export function isValidIpv6(address: string): boolean {
  if (!address || address.includes('%') || address.includes(':::') || (address.match(/::/g)?.length ?? 0) > 1) return false;
  let value = address;
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    if (!isValidIpv4(value.slice(lastColon + 1))) return false;
    value = `${value.slice(0, lastColon)}:0:0`;
  }
  const compressed = value.includes('::');
  const groups = value.split(':').filter(Boolean);
  if (groups.some((group) => !/^[\da-f]{1,4}$/i.test(group))) return false;
  return compressed ? groups.length < 8 : groups.length === 8;
}

export function isValidCidr(cidr: string): boolean {
  const parts = cidr.trim().split('/');
  if (parts.length !== 2 || !/^\d+$/.test(parts[1])) return false;
  const maxPrefix = isValidIpv4(parts[0]) ? 32 : isValidIpv6(parts[0]) ? 128 : -1;
  const prefix = Number(parts[1]);
  return maxPrefix >= 0 && Number.isInteger(prefix) && prefix >= 0 && prefix <= maxPrefix;
}

function ipToBigInt(address: string): { version: 4 | 6; value: bigint } | null {
  if (isValidIpv4(address)) return { version: 4, value: address.split('.').reduce((total, part) => (total << BigInt(8)) + BigInt(Number(part)), BigInt(0)) };
  if (!isValidIpv6(address)) return null;
  let value = address;
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const v4 = value.slice(lastColon + 1).split('.').map(Number);
    value = `${value.slice(0, lastColon)}:${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const [head, tail] = value.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail !== undefined && tail ? tail.split(':') : [];
  const groups = value.includes('::') ? [...headGroups, ...Array(8 - headGroups.length - tailGroups.length).fill('0'), ...tailGroups] : headGroups;
  return { version: 6, value: groups.reduce((total, group) => (total << BigInt(16)) + BigInt(parseInt(group, 16)), BigInt(0)) };
}

/** Inclusive address range of a CIDR, or null when it is not a valid CIDR. */
export function cidrRange(cidr: string): { version: 4 | 6; start: bigint; end: bigint } | null {
  if (!isValidCidr(cidr)) return null;
  const [address, prefixText] = cidr.trim().split('/');
  const parsed = ipToBigInt(address);
  if (!parsed) return null;
  const bits = parsed.version === 4 ? BigInt(32) : BigInt(128);
  const hostBits = bits - BigInt(Number(prefixText));
  const size = BigInt(1) << hostBits;
  const start = (parsed.value >> hostBits) << hostBits;
  return { version: parsed.version, start, end: start + size - BigInt(1) };
}

/** True when two CIDRs of the same IP version share any address. */
export function cidrsOverlap(left: string, right: string): boolean {
  const a = cidrRange(left);
  const b = cidrRange(right);
  return Boolean(a && b && a.version === b.version && a.start <= b.end && b.start <= a.end);
}

/** Canonical network/prefix form so "10.0.0.1/24" and "10.0.0.0/24" compare equal. */
export function sameCidr(left: string, right: string): boolean {
  const a = cidrRange(left);
  const b = cidrRange(right);
  return Boolean(a && b && a.version === b.version && a.start === b.start && a.end === b.end);
}
