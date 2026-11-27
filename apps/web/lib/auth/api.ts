import { apiFetch } from '@/lib/api/client';
import type { ApiUser } from './types';

const isString = (value: unknown): value is string => typeof value === 'string';

/**
 * Checks the GET /api/v1/auth/me body against the ApiUser contract. The identity decides
 * application access and roles, so a body of another shape is rejected instead of cast.
 */
export function parseApiUser(value: unknown): ApiUser {
  if (typeof value !== 'object' || value === null) throw new Error('Identidade inválida devolvida pela API.');
  const { id, externalId, username, roles } = value as Record<string, unknown>;
  if (!isString(id) || !isString(externalId) || !isString(username) || !Array.isArray(roles) || !roles.every(isString)) {
    throw new Error('Identidade inválida devolvida pela API.');
  }
  return { id, externalId, username, roles };
}

/**
 * Loads the signed-in user's API identity through the API client (which adds the token).
 * A 401 rejects instead of restarting the Keycloak login: the caller shows the sign-in screen.
 */
export async function fetchCurrentUser(): Promise<ApiUser> {
  return parseApiUser(await apiFetch<unknown>('/api/v1/auth/me', { cache: 'no-store', redirectOnUnauthorized: false }));
}
