/**
 * TRUST_PROXY_HOPS: how many reverse proxies sit in front of the API.
 *
 * 0 (default) ignores X-Forwarded-For, so request.ip is the TCP peer. Use it whenever clients reach the API
 * directly, because otherwise any client could pick its own rate-limit key by sending the header.
 * 1 is the bundled nginx (docker-compose.proxy.yml): request.ip becomes the right-most X-Forwarded-For entry,
 * the address nginx itself appended, so extra entries a client adds on the left are ignored.
 * The value is passed to Fastify as an exact hop count; `true` (trust everything) is never used.
 */
export function trustProxyHops(raw: string | undefined = process.env.TRUST_PROXY_HOPS): number {
  const value = (raw ?? '').trim();
  if (value === '') return 0;
  if (!/^\d+$/.test(value)) throw new Error(`TRUST_PROXY_HOPS must be a non-negative integer, got "${raw}".`);
  return Number(value);
}

/** Fastify adapter options for the hop count: nothing at 0, `{ trustProxy: n }` above it. */
export function trustProxyOptions(hops: number): { trustProxy?: number } {
  return hops > 0 ? { trustProxy: hops } : {};
}
