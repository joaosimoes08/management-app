import { AuthGate } from '@/components/layout/auth-gate';
import { AppShellFrame } from '@/components/layout/app-shell';

/**
 * Every signed-in page: sign-in and setup checks, then the app chrome, rendered once and kept mounted while the
 * user moves between pages. Pages pass their title, tabs, toolbar and actions through <PageShell>.
 */
export default function AuthenticatedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AuthGate><AppShellFrame>{children}</AppShellFrame></AuthGate>;
}
