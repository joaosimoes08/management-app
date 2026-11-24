'use client';

import { useQueries } from '@tanstack/react-query';

/**
 * Chip counts for a server-paginated list: one small total-only request per
 * chip value (page size 1), run in parallel and cached with the list's other
 * filters in the key. A count stays undefined while loading or on error, so
 * the chip shows "…" instead of a wrong number.
 */
export function useServerChipCounts(values: readonly string[], keyBase: readonly unknown[], fetchTotal: (value: string) => Promise<number>, enabled = true): Record<string, number | undefined> {
  const results = useQueries({
    queries: values.map((value) => ({
      queryKey: [...keyBase, 'chip-count', value],
      queryFn: () => fetchTotal(value),
      enabled,
      retry: false,
      staleTime: 15_000,
    })),
  });
  const counts: Record<string, number | undefined> = {};
  values.forEach((value, index) => { counts[value] = results[index]?.data; });
  return counts;
}
