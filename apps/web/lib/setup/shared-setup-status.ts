import { apiFetch } from '@/lib/api/client';

export type SharedSetupStatus = { setupCompleted: boolean; organizationName?: string | null };

const REUSE_MS = 10_000;
let cached: { value: Promise<SharedSetupStatus>; at: number } | null = null;

/**
 * One /setup/status request for the page load. The auth gate and the locale provider both
 * ask on sign-in; sharing the answer for a few seconds removes the duplicate call. A failed
 * request is not kept, so the next caller retries.
 */
export function getSharedSetupStatus(): Promise<SharedSetupStatus> {
  if (cached && Date.now() - cached.at < REUSE_MS) return cached.value;
  const value = apiFetch<SharedSetupStatus>('/api/v1/setup/status').catch((error: unknown) => {
    cached = null;
    throw error;
  });
  cached = { value, at: Date.now() };
  return value;
}
