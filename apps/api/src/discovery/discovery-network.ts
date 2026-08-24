export const MAX_DISCOVERY_HOSTS = 4096;

function ipv4ToNumber(ip: string) {
  return ip.split('.').reduce((value, part) => (value * 256) + Number(part), 0) >>> 0;
}

function numberToIpv4(value: number) {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

export function hostsFor(cidr: string) {
  const [address, bitsText] = cidr.trim().split('/');
  const bits = Number(bitsText);
  const octets = address?.split('.') ?? [];

  if (
    octets.length !== 4
    || octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)
    || !Number.isInteger(bits)
    || bits < 0
    || bits > 32
  ) {
    throw new Error('CIDR IPv4 inválido');
  }

  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  // Bitwise operators return signed 32-bit values in JavaScript. Converting the
  // result back to unsigned is required for networks whose first octet is >= 128.
  const network = (ipv4ToNumber(address) & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const first = bits >= 31 ? network : network + 1;
  const last = bits >= 31 ? broadcast : broadcast - 1;
  const count = last >= first ? last - first + 1 : 0;

  if (count > MAX_DISCOVERY_HOSTS) {
    throw new Error(`Discovery limitado a ${MAX_DISCOVERY_HOSTS} hosts`);
  }

  return Array.from({ length: count }, (_, index) => numberToIpv4(first + index));
}
