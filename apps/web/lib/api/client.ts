import { ApiRequestError, apiErrorMessage, clientErrorMessage, type ApiErrorPayload, type ApiLocale } from './errors';
import { getPublicRuntimeConfig } from '@/lib/runtime-config';
import { STORAGE_KEYS, getLocalItem } from '@/lib/storage-keys';
import { isAppLocale } from '@/lib/i18n/locales/catalog';
import type { AppLocale } from '@/lib/i18n/i18n';

type TokenProvider = () => Promise<string>;

/** The stored app locale (any supported language), or pt-PT when none is stored or it is not supported. */
const storedAppLocale = (): AppLocale => {
  const stored = typeof window !== 'undefined' ? getLocalItem(STORAGE_KEYS.locale) : null;
  return isAppLocale(stored) ? stored : 'pt-PT';
};

/** API errors exist in Portuguese and English; every other language gets the English text. */
const activeLocale = (): ApiLocale => (storedAppLocale() === 'pt-PT' ? 'pt-PT' : 'en-US');

let tokenProvider: TokenProvider | null = null;
let onUnauthorized: (() => void) | null = null;

/**
 * Registered by AuthProvider. Keeps HTTP transport decoupled from
 * Keycloak: this module only asks for a token, it never touches
 * the Keycloak adapter itself.
 */
export function setApiTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider;
}

export function setApiUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/**
 * Typed fetch against the backend API. The response type is the
 * caller's contract: domain API wrappers pass the concrete entity type.
 */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  if (!tokenProvider) throw new Error(clientErrorMessage('notInitialized', activeLocale()));
  const accessToken = await tokenProvider();
  const headers = {
    ...init.headers,
    Authorization: `Bearer ${accessToken}`,
    'Accept-Language': storedAppLocale(),
    ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  };
  const response = await fetch(`${getPublicRuntimeConfig().apiUrl}${path}`, {
    ...init,
    headers,
  });
  if (response.status === 401) {
    onUnauthorized?.();
    throw new Error(clientErrorMessage('sessionExpired', activeLocale()));
  }
  if (!response.ok) {
    let detail = '';
    let payload: ApiErrorPayload | undefined;
    try {
      payload = await response.json() as ApiErrorPayload;
      detail = apiErrorMessage(payload, activeLocale());
    } catch {
      // Keep the status as a useful fallback when the API did not return JSON.
    }
    throw new ApiRequestError(detail || clientErrorMessage('requestFailed', activeLocale(), response.status), response.status, payload);
  }
  const responseText = await response.text();
  return (responseText ? JSON.parse(responseText) : undefined) as T;
}

/** Downloads a file from the API; resolves with the response headers (e.g. export row counts). */
export async function apiDownload(path: string, filename: string): Promise<Headers> {
  if (!tokenProvider) throw new Error(clientErrorMessage('notInitialized', activeLocale()));
  const accessToken = await tokenProvider();
  const response = await fetch(`${getPublicRuntimeConfig().apiUrl}${path}`, { headers: { Authorization: `Bearer ${accessToken}`, 'Accept-Language': storedAppLocale() } });
  if (!response.ok) throw new Error(clientErrorMessage('exportFailed', activeLocale(), response.status));
  const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  // Some browsers start the download after the click returns: keep the URL alive for a moment.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return response.headers;
}
