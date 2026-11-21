/**
 * HTTP caching for GET /assets/:id/file. An asset's bytes never change after upload (there is no update route and each
 * upload gets a new random storage key), so a response can be cached for a year. The route needs a Bearer token, so the
 * response is `private`: browsers keep it, shared proxies do not.
 */
export const ASSET_CACHE_CONTROL = 'private, max-age=31536000, immutable';

/** The asset image route gets its own budget: one rack page can show dozens of images. Other routes keep 100/min. */
export const ASSET_FILE_THROTTLE = { default: { limit: 1200, ttl: 60_000 } };

export function assetEtag(asset: { id: string; sizeBytes?: number | null }): string {
  return `"${asset.id}-${asset.sizeBytes ?? 0}"`;
}
