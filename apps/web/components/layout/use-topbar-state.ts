'use client';

import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardKeys, getTopbarState } from '@/features/dashboard/api';
import { useOperationalEvents } from '@/features/operations/use-operational-events';
import { NOTIFICATIONS_CHANGED } from '@/features/profile/api';
import { unavailableTopbarState, type TopbarState } from './topbar-state';

export interface UseTopbarStateOptions {
  /** Called with the alert id an operational event carries, before the state is reloaded. */
  onAlertEvent?: (alertId: string) => void;
}

/**
 * Topbar state (alerts, notifications, running processes) for the header bell. Loads on mount and refreshes
 * every 30 s, on window focus, when notifications change and on each operational event (polling when the
 * event stream is down). A failed request yields the unavailable state rather than an error.
 */
export function useTopbarState({ onAlertEvent }: UseTopbarStateOptions = {}): TopbarState {
  // Loads on mount; a failed request shows the unavailable state rather than an error. No retry, as before.
  const topbar = useQuery({ queryKey: dashboardKeys.topbarState, queryFn: () => getTopbarState().catch(unavailableTopbarState), retry: false, staleTime: 0, refetchOnReconnect: false });
  const { refetch } = topbar;
  // Mount, the 30 s timer, focus and the events fallback poll can all ask at once (on page load the
  // fallback poll and the mount effect did); they share one request in flight. An operational event
  // passes fresh=true, because a request that started before the event may predate the change.
  // The older request is cancelled first: React Query alone would reuse it while there is no data yet.
  const queryClient = useQueryClient();
  const loadTopbarState = useCallback(async (fresh = false) => {
    if (fresh) await queryClient.cancelQueries({ queryKey: dashboardKeys.topbarState, exact: true });
    return (await refetch({ cancelRefetch: fresh })).data ?? unavailableTopbarState();
  }, [queryClient, refetch]);
  useOperationalEvents({ fallback: () => loadTopbarState(), onEvent: (event) => { const alertId = (event.data as { alertId?: string } | null)?.alertId; if (alertId) onAlertEvent?.(alertId); void loadTopbarState(true); } });
  useEffect(() => {
    const interval = window.setInterval(() => void loadTopbarState(), 30_000);
    const onFocus = () => loadTopbarState();
    window.addEventListener('focus', onFocus);
    window.addEventListener(NOTIFICATIONS_CHANGED, onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onFocus);
    };
  }, [loadTopbarState]);

  return topbar.data ?? unavailableTopbarState();
}
