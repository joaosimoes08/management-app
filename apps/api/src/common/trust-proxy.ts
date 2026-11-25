/**
 * TRUST_PROXY_HOPS: how many reverse proxies sit in front of the API.
 *
 * 0 (default) ignores X-Forwarded-For, so request.ip is the TCP peer. Use it whenever clients reach the API
 * directly, because otherwise any client could pick its own rate-limit key by sending the header.
 * 1 is the bundled nginx (docker-compose.proxy.yml): request.ip becomes the right-most X-Forwarded-For entry,
 * the address nginx itself appended, so extra entries a client adds on the left are ignored.
 * The value is passed to Fastify as an exact hop count (see trustFirstHops); `true` (trust everything) is never used.
 */
export function trustProxyHops(raw: string | undefined = process.env.TRUST_PROXY_HOPS): number {
  const value = (raw ?? '').trim();
  if (value === '') return 0;
  if (!/^\d+$/.test(value)) throw new Error(`TRUST_PROXY_HOPS must be a non-negative integer, got "${raw}".`);
  return Number(value);
}

/**
 * Trusts the first `hops` addresses of the chain (the TCP peer is hop 0, then X-Forwarded-For right to left).
 * This is exactly what Fastify up to 5.11 did for a numeric `trustProxy` (`(a, i) => i < tp`). Fastify 5.12
 * no longer accepts a number in its types and, at runtime, treats one as "trust nothing", so the hop count is
 * passed as this function instead.
 */
export function trustFirstHops(hops: number): (address: string, hop: number) => boolean {
  return (_address, hop) => hop < hops;
}

/** Fastify adapter options for the hop count: nothing at 0, a first-N-hops trust function above it. */
export function trustProxyOptions(hops: number): { trustProxy?: (address: string, hop: number) => boolean } {
  return hops > 0 ? { trustProxy: trustFirstHops(hops) } : {};
}
