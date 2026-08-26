import * as net from 'node:net';

export const DEFAULT_DISCOVERY_ALLOWED_CIDRS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'];
export const MAX_DISCOVERY_PORTS = 64;

const FORBIDDEN_CIDRS = [
  '0.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '192.0.0.0/24',
  '192.0.2.0/24', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24',
  '224.0.0.0/4', '240.0.0.0/4', '::/128', '::1/128', 'fe80::/10', 'ff00::/8',
];

type Network = { version: 4 | 6; prefix: number; first: bigint; last: bigint; cidr: string };

export class DiscoveryPolicyError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

function ipv4Value(address: string) {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) throw new Error('IPv4 inválido');
  return parts.reduce((value, part) => (value << 8n) + BigInt(Number(part)), 0n);
}

function ipv6Value(address: string) {
  const normalized = address.toLowerCase();
  const [left = '', right = ''] = normalized.split('::');
  if (normalized.split('::').length > 2) throw new Error('IPv6 inválido');
  const expand = (side: string) => side ? side.split(':').flatMap((part) => {
    if (part.includes('.')) { const value = ipv4Value(part); return [Number((value >> 16n) & 0xffffn).toString(16), Number(value & 0xffffn).toString(16)]; }
    return [part];
  }) : [];
  const leftParts = expand(left); const rightParts = expand(right);
  const missing = 8 - leftParts.length - rightParts.length;
  if (missing < 0 || (!normalized.includes('::') && missing !== 0)) throw new Error('IPv6 inválido');
  const parts = [...leftParts, ...Array(missing).fill('0'), ...rightParts];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) throw new Error('IPv6 inválido');
  return parts.reduce((value, part) => (value << 16n) + BigInt(parseInt(part, 16)), 0n);
}

export function parseNetwork(input: string): Network {
  const [address, prefixText] = input.trim().split('/');
  const version = net.isIP(address);
  if (version !== 4 && version !== 6) throw new DiscoveryPolicyError('DISCOVERY_CIDR_INVALID', 'O destino de Discovery não é um CIDR válido.');
  const maxBits = version === 4 ? 32 : 128; const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxBits) throw new DiscoveryPolicyError('DISCOVERY_CIDR_INVALID', 'O destino de Discovery não é um CIDR válido.');
  const value = version === 4 ? ipv4Value(address) : ipv6Value(address);
  const hostBits = BigInt(maxBits - prefix); const mask = hostBits === BigInt(maxBits) ? 0n : ((1n << BigInt(maxBits)) - 1n) ^ ((1n << hostBits) - 1n);
  const first = value & mask; const last = first + (1n << hostBits) - 1n;
  return { version, prefix, first, last, cidr: input.trim() };
}

function overlaps(left: Network, right: Network) { return left.version === right.version && left.first <= right.last && right.first <= left.last; }
function contained(target: Network, parent: Network) { return target.version === parent.version && target.first >= parent.first && target.last <= parent.last; }

export function normalizeAllowedCidrs(value: unknown) {
  const items = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : DEFAULT_DISCOVERY_ALLOWED_CIDRS;
  return [...new Set(items.map((item) => item.trim()).filter(Boolean).map((item) => parseNetwork(item).cidr))];
}

export function assertDiscoveryAllowed(targetCidr: string, allowedInput: unknown) {
  const target = parseNetwork(targetCidr);
  if (FORBIDDEN_CIDRS.map(parseNetwork).some((blocked) => overlaps(target, blocked))) {
    throw new DiscoveryPolicyError('DISCOVERY_TARGET_FORBIDDEN', 'O destino pertence ou sobrepõe uma rede especial bloqueada.');
  }
  const allowed = normalizeAllowedCidrs(allowedInput).map(parseNetwork);
  if (!allowed.some((entry) => contained(target, entry))) {
    throw new DiscoveryPolicyError('DISCOVERY_TARGET_NOT_ALLOWED', 'A subnet não está abrangida pela allowlist de Discovery.');
  }
  return target;
}

export function normalizeDiscoveryPorts(value: unknown) {
  if (!Array.isArray(value)) return [];
  const ports = [...new Set(value.filter((port): port is number => Number.isInteger(port) && port >= 1 && port <= 65535))].sort((a, b) => a - b);
  if (ports.length > MAX_DISCOVERY_PORTS) throw new DiscoveryPolicyError('DISCOVERY_PORT_LIMIT', `Discovery aceita no máximo ${MAX_DISCOVERY_PORTS} portas por execução.`);
  return ports;
}
