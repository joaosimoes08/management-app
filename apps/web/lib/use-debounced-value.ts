'use client';

import { useEffect, useState } from 'react';

/** The value once it has stopped changing for `delay` ms (e.g. search text sent to the server when typing pauses). */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setCurrent(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return current;
}
