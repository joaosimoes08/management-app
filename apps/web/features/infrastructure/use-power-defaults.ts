'use client';

import { useQuery } from '@tanstack/react-query';
import { getPowerDefaults } from './api';
import type { PowerDefaults } from './power';

export const POWER_DEFAULTS_QUERY_KEY = ['infrastructure', 'power-defaults'] as const;

/**
 * The API's power defaults (outlets, budget, plugs, watts by type, thresholds), fetched once and cached for the
 * session. `null` while loading or if the request fails: callers then show no default rather than a guessed one.
 */
export function usePowerDefaults(): PowerDefaults | null {
  const { data } = useQuery({ queryKey: POWER_DEFAULTS_QUERY_KEY, queryFn: getPowerDefaults, staleTime: Infinity, gcTime: Infinity, retry: 1 });
  return data ?? null;
}
