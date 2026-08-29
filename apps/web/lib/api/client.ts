import { localizedApiErrors, type ApiErrorPayload } from './errors';

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

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

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
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers,
  });
  if (response.status === 401) {
    onUnauthorized?.();
    throw new Error('Sessão expirada');
  }
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json() as ApiErrorPayload;
      const locale = window.localStorage.getItem('cociber.locale') === 'en-US' ? 'en-US' : 'pt-PT';
      detail = (payload.code && localizedApiErrors[locale][payload.code]) || (Array.isArray(payload.message) ? payload.message.join(', ') : payload.message ?? payload.error ?? '');
    } catch {
      // Keep the status as a useful fallback when the API did not return JSON.
    }
    throw new Error(detail || `Pedido falhou (${response.status})`);
  }
  const responseText = await response.text();
  return (responseText ? JSON.parse(responseText) : undefined) as T;
}
