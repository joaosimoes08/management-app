'use client';

import { useSyncExternalStore } from 'react';
import { AuthLayout } from '@/components/layout/auth-gate';
import { getPublicOrganizationName } from '@/lib/runtime-config';
import { ReportUnsubscribe } from './report-unsubscribe';

const subscribe = () => () => {};

/**
 * Public screen behind the email's unsubscribe link: no session, no app shell. Its token is the credential.
 * Rendered after hydration only, because the organization name comes from the browser's runtime config.
 */
export function ReportUnsubscribeScreen({ token }: { token: string | null }) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  if (!hydrated) return null;
  return <AuthLayout organizationName={getPublicOrganizationName()}><ReportUnsubscribe token={token} /></AuthLayout>;
}
