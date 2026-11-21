import { lookup as dnsLookup, LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

/** Per-link budget (DNS + connect + response headers). */
export const LINK_PROBE_TIMEOUT_MS = 3_000;

export type LinkProbeOutcome = {
  available: boolean;
  httpStatus: number | null;
  responseMs: number | null;
  /** BLOCKED: the URL (or its redirect target) resolves to a loopback, private, link-local or CGNAT address. */
  code?: 'BLOCKED' | 'INVALID_URL' | 'UNREACHABLE';
};

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const BLOCKED_V6: Array<[string, number]> = [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b:1::', 48]];

function buildBlockList(entries: Array<[string, number, 'ipv4' | 'ipv6']>) {
  const list = new BlockList();
  for (const [address, prefix, type] of entries) list.addSubnet(address, prefix, type);
  return list;
}
const BLOCKED = buildBlockList([...BLOCKED_V4.map(([a, p]) => [a, p, 'ipv4'] as [string, number, 'ipv4']), ...BLOCKED_V6.map(([a, p]) => [a, p, 'ipv6'] as [string, number, 'ipv6'])]);

/**
 * Operator allowlist for internal portals, e.g. `APPLICATION_LINK_CHECK_ALLOWED_CIDRS=10.20.0.0/16,192.168.5.10/32`.
 * Empty by default: every blocked range stays blocked.
 */
function allowedList(raw = process.env.APPLICATION_LINK_CHECK_ALLOWED_CIDRS ?? '') {
  const list = new BlockList();
  for (const entry of raw.split(',').map((value) => value.trim()).filter(Boolean)) {
    const [address, prefixText] = entry.split('/');
    const type = isIP(address);
    if (!type) continue;
    const prefix = prefixText === undefined ? (type === 4 ? 32 : 128) : Number(prefixText);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > (type === 4 ? 32 : 128)) continue;
    list.addSubnet(address, prefix, type === 4 ? 'ipv4' : 'ipv6');
  }
  return list;
}

/** Expands an IPv6 literal to its 8 hextets, or null. */
function ipv6Hextets(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  let text = address.toLowerCase();
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) text = text.slice(0, v4.index) + (((+v4[1] << 8) | +v4[2]).toString(16)) + ':' + (((+v4[3] << 8) | +v4[4]).toString(16));
  const [head, tail] = text.includes('::') ? text.split('::') : [text, null];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const parts = tail === null ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return parts.length === 8 ? parts.map((part) => parseInt(part, 16)) : null;
}

/**
 * IPv4 embedded in an IPv6 address that a gateway would translate to that IPv4: IPv4-mapped (::ffff:a.b.c.d),
 * NAT64 well-known prefix (64:ff9b::/96, RFC 6052) and 6to4 (2002:AABB:CCDD::/16, RFC 3056). These are checked
 * against the IPv4 rules so e.g. 64:ff9b::7f00:1 or 2002:7f00:1:: cannot reach loopback.
 */
function embeddedIpv4(address: string): string | null {
  const h = ipv6Hextets(address);
  if (!h) return null;
  const v4 = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return v4(h[6], h[7]);
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return v4(h[6], h[7]);
  if (h[0] === 0x2002) return v4(h[1], h[2]);
  return null;
}

/**
 * True when the probe must not connect to this address. IPv6 forms that embed an IPv4 (mapped, NAT64
 * 64:ff9b::/96, 6to4 2002::/16) are checked as that IPv4; the local-use NAT64 prefix 64:ff9b:1::/48 is blocked.
 */
export function isBlockedAddress(address: string, allowed = allowedList()): boolean {
  const bare = address.replace(/^\[|\]$/g, '').split('%')[0];
  const value = embeddedIpv4(bare) ?? bare;
  const type = isIP(value);
  if (!type) return true;
  const family = type === 4 ? 'ipv4' : 'ipv6';
  if (allowed.check(value, family)) return false;
  return BLOCKED.check(value, family);
}

class BlockedAddressError extends Error {}

/** DNS lookup used for the actual connection: every resolved address is checked, so a rebinding answer can't slip past a separate pre-check. */
function guardedLookup(allowed: BlockList) {
  return (hostname: string, options: object, callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, '');
      const list = addresses as LookupAddress[];
      if (!list.length || list.some((item) => isBlockedAddress(item.address, allowed))) return callback(new BlockedAddressError(`${hostname} resolves to a blocked address`), '');
      if ((options as { all?: boolean }).all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

async function resolvesToBlocked(hostname: string, allowed: BlockList): Promise<boolean> {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return isBlockedAddress(bare, allowed);
  return new Promise((resolve) => dnsLookup(bare, { all: true }, (error, addresses) => resolve(Boolean(error) || !addresses.length || addresses.some((item) => isBlockedAddress(item.address, allowed)))));
}

/**
 * HEAD probe for an application link. Redirects are never followed; a redirect whose target resolves to a
 * blocked address is reported as BLOCKED. The whole probe (DNS included) is bounded by `timeoutMs`.
 */
export async function probeLink(rawUrl: string, timeoutMs = LINK_PROBE_TIMEOUT_MS): Promise<LinkProbeOutcome> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return { available: false, httpStatus: null, responseMs: null, code: 'INVALID_URL' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { available: false, httpStatus: null, responseMs: null, code: 'INVALID_URL' };
  const allowed = allowedList();
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal) && isBlockedAddress(literal, allowed)) return { available: false, httpStatus: null, responseMs: null, code: 'BLOCKED' };
  const started = Date.now();
  const deadline = started + timeoutMs;
  const { outcome: result, location } = await new Promise<{ outcome: LinkProbeOutcome; location?: string }>((resolve) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, { method: 'HEAD', lookup: guardedLookup(allowed) as never, timeout: timeoutMs, headers: { 'user-agent': 'management-app-link-check' } }, (response) => {
      response.resume();
      const status = response.statusCode ?? 0;
      resolve({ outcome: { available: status >= 200 && status < 400, httpStatus: response.statusCode ?? null, responseMs: Date.now() - started }, location: response.headers.location });
    });
    const timer = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs);
    req.on('error', (error) => resolve({ outcome: { available: false, httpStatus: null, responseMs: null, code: error instanceof BlockedAddressError ? 'BLOCKED' : 'UNREACHABLE' } }));
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
  if (location && result.httpStatus && result.httpStatus >= 300 && result.httpStatus < 400) {
    let target: URL | null = null;
    try { target = new URL(location, url); } catch { target = null; }
    const remaining = deadline - Date.now();
    if (target && (target.protocol === 'http:' || target.protocol === 'https:')) {
      const blocked = remaining <= 0 ? true : await Promise.race([resolvesToBlocked(target.hostname, allowed), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), remaining))]);
      if (blocked) return { available: false, httpStatus: result.httpStatus, responseMs: result.responseMs, code: 'BLOCKED' };
    }
  }
  return result;
}
