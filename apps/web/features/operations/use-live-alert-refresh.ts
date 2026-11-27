'use client';
import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOperationalEvents } from './use-operational-events';
import { operationsKeys } from './api';

/**
 * Refreshes every operations query when an alert changes (SSE, or the 30 s poll when the stream
 * is down). Events arriving in a burst are folded into one refresh.
 */
export function useLiveAlertRefresh(queryKeys: ReadonlyArray<readonly unknown[]> = [operationsKeys.all]) {
  const queryClient = useQueryClient();
  const timer = useRef<number | undefined>(undefined);
  const keys = useRef(queryKeys); keys.current = queryKeys;
  const refresh = useCallback(() => Promise.all(keys.current.map((queryKey) => queryClient.invalidateQueries({ queryKey }))), [queryClient]);
  const schedule = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = undefined; void refresh(); }, 300);
  }, [refresh]);
  useEffect(() => () => { if (timer.current !== undefined) window.clearTimeout(timer.current); }, []);
  return useOperationalEvents({ fallback: refresh, onEvent: (event) => { if (event.event !== 'heartbeat') schedule(); } });
}

