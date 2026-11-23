import { useEffect, useState } from 'react';

/** Re-renders every intervalMs while active, so time-based views (the credential test UI limit) update without new data. */
export function useRenderTick(active: boolean, intervalMs = 2_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setTick((value) => value + 1), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
}
