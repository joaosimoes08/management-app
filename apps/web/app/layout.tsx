import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { AuthGate } from '@/components/layout/auth-gate';
import { ToastProvider } from '@/components/ui/toast';
import { I18nProvider } from '@/lib/i18n';
import { QueryProvider } from '@/lib/query/query-provider';
import { SiteProvider } from '@/lib/site-context';

export const metadata: Metadata = {
  title: 'COCiber · Gestão de Infraestrutura',
  description: 'Centro de operações para infraestrutura e ciberdefesa.',
};

// QueryProvider and SiteProvider sit above AuthGate: the accessible-site list starts loading as soon
// as Keycloak reports a session (in parallel with the identity check), and the query cache survives
// gate state changes. SiteProvider only fetches when authenticated; AuthGate still decides what renders.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-PT">
      <body><Script src="/runtime-config.js" strategy="beforeInteractive" /><AuthProvider><I18nProvider><ToastProvider><QueryProvider><SiteProvider><AuthGate>{children}</AuthGate></SiteProvider></QueryProvider></ToastProvider></I18nProvider></AuthProvider></body>
    </html>
  );
}
