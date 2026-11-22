'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiRequestError } from '@/lib/api/errors';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // One retry for network and server errors only. A 4xx (including 429 from the
        // API rate limiter) would otherwise be re-sent immediately and deepen the limit.
        retry: (failureCount, error) => failureCount < 1 && !(error instanceof ApiRequestError && error.status < 500),
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  }));

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
