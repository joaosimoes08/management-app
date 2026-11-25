/**
 * The URL to put in an `href` for a link someone typed (portal applications, the impact panel), or
 * undefined when it is not an absolute http: or https: URL. Callers render undefined as plain text,
 * so a stored `javascript:` or `data:` URL can never run when clicked. The scheme is read with the
 * browser's own URL parser, the same check the API makes on create and update (apps/api/src/common/http-url.ts).
 */
export function isHttpUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url || url !== url.trim() || /[\u0000-\u001f\u007f]/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function safeHref(url: string | null | undefined): string | undefined {
  return isHttpUrl(url) ? url : undefined;
}
