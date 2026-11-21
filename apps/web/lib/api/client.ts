import { ApiRequestError, apiErrorMessage, type ApiErrorPayload } from './errors';
import { getPublicRuntimeConfig } from '@/lib/runtime-config';

type TokenProvider = () => Promise<string>;

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

declare global {
  interface Window {
    __cociberApiFetch?: typeof apiFetch;
  }
}

/**
 * Typed fetch against the backend API. The response type is the
 * caller's contract: domain API wrappers pass the concrete entity type.
 */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  if (typeof window !== 'undefined') window.__cociberApiFetch = apiFetch;
  if (!tokenProvider) throw new Error('O cliente da API não está inicializado.');
  const accessToken = await tokenProvider();
  const headers = {
    ...init.headers,
    Authorization: `Bearer ${accessToken}`,
    'Accept-Language': typeof window !== 'undefined' ? (window.localStorage.getItem('cociber.locale') ?? 'pt-PT') : 'pt-PT',
    ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  };
  const response = await fetch(`${getPublicRuntimeConfig().apiUrl}${path}`, {
    ...init,
    headers,
  });
  if (response.status === 401) {
    onUnauthorized?.();
    throw new Error('Sessão expirada');
  }
  if (!response.ok) {
    let detail = '';
    let payload: ApiErrorPayload | undefined;
    try {
      payload = await response.json() as ApiErrorPayload;
      const locale = window.localStorage.getItem('cociber.locale') === 'en-US' ? 'en-US' : 'pt-PT';
      detail = apiErrorMessage(payload, locale);
    } catch {
      // Keep the status as a useful fallback when the API did not return JSON.
    }
    throw new ApiRequestError(detail || `Pedido falhou (${response.status})`, response.status, payload);
  }
  const responseText = await response.text();
  return (responseText ? JSON.parse(responseText) : undefined) as T;
}

/** Downloads a file from the API; resolves with the response headers (e.g. export row counts). */
export async function apiDownload(path: string, filename: string): Promise<Headers> {
  if (!tokenProvider) throw new Error('O cliente da API não está inicializado.');
  const accessToken = await tokenProvider();
  const response = await fetch(`${getPublicRuntimeConfig().apiUrl}${path}`, { headers: { Authorization: `Bearer ${accessToken}`, 'Accept-Language': window.localStorage.getItem('cociber.locale') ?? 'pt-PT' } });
  if (!response.ok) throw new Error(`Export falhou (${response.status})`);
  const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  // Some browsers start the download after the click returns: keep the URL alive for a moment.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return response.headers;
}
