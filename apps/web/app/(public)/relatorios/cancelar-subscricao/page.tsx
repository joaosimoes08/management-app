import { ReportUnsubscribeScreen } from '@/features/reports/report-unsubscribe-screen';

/** Public route (no AuthGate): the unsubscribe token in the email link is the credential. */
export default async function ReportUnsubscribeRoute({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <ReportUnsubscribeScreen token={typeof token === 'string' ? token : null} />;
}
