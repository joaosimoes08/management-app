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
