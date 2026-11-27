import { AuthGate } from '@/components/layout/auth-gate';

/** /setup still needs an administrator session, but it must render while setup is incomplete and has no app shell. */
export default function SetupLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AuthGate requireCompletedSetup={false}>{children}</AuthGate>;
}
