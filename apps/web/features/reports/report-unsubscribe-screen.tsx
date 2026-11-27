'use client';

import { useSyncExternalStore } from 'react';
import { AuthLayout } from '@/components/layout/auth-gate';
import { useUiText } from '@/components/ui/use-ui-text';
import { getPublicOrganizationName } from '@/lib/runtime-config';
import { ReportUnsubscribe } from './report-unsubscribe';

const subscribe = () => () => {};

/**
 * Public screen behind the email's unsubscribe link: no session, no app shell. Its token is the credential.
 * The card renders after hydration only, because the organization name comes from the browser's runtime config;
 * until then it shows the same "connecting" spinner the app gate shows (as before the route groups).
 */
export function ReportUnsubscribeScreen({ token }: { token: string | null }) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const ui = useUiText();
  if (!hydrated) return <div className="auth-loading"><div className="auth-spinner" /><span>{ui('authGate.connecting', undefined, { organization: getPublicOrganizationName() })}</span></div>;
  return <AuthLayout organizationName={getPublicOrganizationName()}><ReportUnsubscribe token={token} /></AuthLayout>;
}
