'use client';

import { RouteError } from '@/components/layout/route-status';

/** Catches errors from any signed-in page and shows them inside the app shell (the root error.tsx covers the rest). */
export default function AuthenticatedError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} />;
}
