import { ApiRequestError, apiErrorMessage, clientErrorMessage, type ApiErrorPayload, type ApiLocale } from './errors';
import { getPublicRuntimeConfig } from '@/lib/runtime-config';
import { STORAGE_KEYS, getLocalItem } from '@/lib/storage-keys';
import { isAppLocale } from '@/lib/i18n/locales/catalog';
import { localizeServerTextFor } from '@/lib/i18n/server-text';
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
export type ApiFetchInit = RequestInit & {
  /**
   * When false, a 401 rejects with an ApiRequestError (status 401) instead of calling the
   * unauthorized handler. Used by the sign-in identity load, where a rejected identity must
   * show the sign-in screen rather than restart the Keycloak login (which could loop).
   */
  redirectOnUnauthorized?: boolean;
};

/** A fresh access token from the registered provider, asked for on every request. */
async function currentToken(): Promise<string> {
  if (!tokenProvider) throw new Error(clientErrorMessage('notInitialized', activeLocale()));
  return tokenProvider();
}

export async function apiFetch<T = unknown>(path: string, { redirectOnUnauthorized = true, ...init }: ApiFetchInit = {}): Promise<T> {
  const accessToken = await currentToken();
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
    if (!redirectOnUnauthorized) throw new ApiRequestError(clientErrorMessage('sessionExpired', activeLocale()), 401);
    onUnauthorized?.();
    throw new Error(clientErrorMessage('sessionExpired', activeLocale()));
  }
  if (!response.ok) {
    let detail = '';
    let payload: ApiErrorPayload | undefined;
    try {
      payload = await response.json() as ApiErrorPayload;
      // A code the web knows is already localized; the API's own Portuguese message is shown in the active language.
      detail = localizeServerTextFor(storedAppLocale(), apiErrorMessage(payload, activeLocale()));
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
  const accessToken = await currentToken();
  const response = await fetch(`${getPublicRuntimeConfig().apiUrl}${path}`, { headers: { Authorization: `Bearer ${accessToken}`, 'Accept-Language': storedAppLocale() } });
  if (!response.ok) throw new Error(clientErrorMessage('exportFailed', activeLocale(), response.status));
  const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  // Some browsers start the download after the click returns: keep the URL alive for a moment.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return response.headers;
}

/**
 * Fetches binary content (asset images and the like) from the API as a Blob.
 * Rejects with an ApiRequestError carrying the HTTP status when the API answers with an error.
 */
export async function apiBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const accessToken = await currentToken();
  const response = await fetch(`${getPublicRuntimeConfig().apiUrl}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}`, 'Accept-Language': storedAppLocale() },
  });
  if (!response.ok) throw new ApiRequestError(clientErrorMessage('requestFailed', activeLocale(), response.status), response.status);
  return response.blob();
}

/**
 * Opens an authorized server-sent event stream and resolves with the response once it is up
 * (status ok and a readable body). The token is asked for on every call, so a caller that
 * reconnects after the stream dropped always sends a fresh token, never the one the stream
 * was first opened with. Rejects with an ApiRequestError carrying the status otherwise.
 */
export async function apiEventStream(path: string, init: RequestInit = {}): Promise<Response & { body: ReadableStream<Uint8Array> }> {
  const accessToken = await currentToken();
  const response = await fetch(`${getPublicRuntimeConfig().apiUrl}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}`, Accept: 'text/event-stream', 'Accept-Language': storedAppLocale() },
    cache: 'no-store',
  });
  if (!response.ok || !response.body) throw new ApiRequestError(clientErrorMessage('requestFailed', activeLocale(), response.status), response.status);
  return response as Response & { body: ReadableStream<Uint8Array> };
}
