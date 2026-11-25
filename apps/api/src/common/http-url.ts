import { isURL, ValidateBy, ValidationOptions, buildMessage } from 'class-validator';

/** Schemes a user-supplied link may use. Anything else (javascript:, data:, vbscript:, file:, ...) is refused. */
export const HTTP_URL_PROTOCOLS = ['http:', 'https:'] as const;

/**
 * True only for an absolute http: or https: URL with a host. The scheme is read the way a browser
 * reads it (WHATWG URL), so `JaVaScRiPt:`, leading spaces or control characters cannot slip past.
 */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return false;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return false; }
  return (HTTP_URL_PROTOCOLS as readonly string[]).includes(parsed.protocol) && Boolean(parsed.hostname);
}

export const IS_HTTP_URL = 'isHttpUrl';

/**
 * A link URL a user types: only http: or https:, otherwise the request is a 400. It also keeps the
 * format check the DTOs used before (`@IsUrl` with a required http/https protocol), so URLs that were
 * accepted until now still are.
 */
export function IsHttpUrl(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy({
    name: IS_HTTP_URL,
    validator: {
      validate: (value: unknown) => isHttpUrl(value) && isURL(value, { protocols: ['http', 'https'], require_protocol: true }),
      defaultMessage: buildMessage((prefix) => `${prefix}$property must be an http:// or https:// URL`, validationOptions),
    },
  }, validationOptions);
}
