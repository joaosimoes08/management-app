'use client';

import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

type SeedState = { key: string; at: number; since: number; armed: boolean };

/**
 * Copies a settings query into its form only when the person asked for it: the first load of `key`
 * (a cached copy, then the fresh one fetched on mount), and the load that follows `reload()`.
 * A background refetch (reconnect, another component's invalidation) never overwrites unsaved edits.
 * Saves update the form from their own response, as before React Query.
 */
export function useSeedOnLoad<T>(query: UseQueryResult<T>, key: string, seed: (data: T) => void) {
  const [state, setState] = useState<SeedState>({ key, at: 0, since: 0, armed: true });
  let current = state;
  // A new Site, role set or similar is a new first load.
  if (current.key !== key) current = { key, at: 0, since: 0, armed: true };
  if (current.armed && query.data !== undefined && query.dataUpdatedAt !== current.at && query.dataUpdatedAt >= current.since) {
    seed(query.data);
    // Stay armed while the mount fetch that follows a cached copy is still running.
    current = { ...current, at: query.dataUpdatedAt, armed: query.isFetching };
  }
  // A cached copy was seeded and the fetch on mount then failed: the form now belongs to the person, so a later
  // background refetch must not overwrite it. (A failed reload is handled by reload() itself; a first load that
  // failed before anything was seeded stays armed so the form is filled once data arrives.)
  if (current.armed && current.since === 0 && current.at !== 0 && !query.isFetching && query.isError) current = { ...current, armed: false };
  if (current !== state) setState(current);
  const reload = () => {
    setState((previous) => ({ ...previous, key, since: Date.now(), armed: true }));
    // A failed reload leaves the form alone, and so does any later background refetch.
    return query.refetch().then((result) => { if (result.isError) setState((previous) => ({ ...previous, armed: false })); return result; });
  };
  return reload;
}
