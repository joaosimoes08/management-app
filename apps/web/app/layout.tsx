import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { AuthGate } from '@/components/layout/auth-gate';
import { ToastProvider } from '@/components/ui/toast';
import { I18nProvider } from '@/lib/i18n';
import { QueryProvider } from '@/lib/query/query-provider';
import { SiteProvider } from '@/lib/site-context';
import { AppearanceSync } from '@/components/theme/appearance-sync';
import { appearanceBootScript } from '@/lib/theme/appearance-core';
import { themeCss } from '@/lib/theme/themes';

export const metadata: Metadata = {
  title: 'COCiber · Gestão de Infraestrutura',
  description: 'Centro de operações para infraestrutura e ciberdefesa.',
};

// QueryProvider and SiteProvider sit above AuthGate: the accessible-site list starts loading as soon
// as Keycloak reports a session (in parallel with the identity check), and the query cache survives
// gate state changes. SiteProvider only fetches when authenticated; AuthGate still decides what renders.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The boot script sets data-theme/data-mode before first paint, so the server markup can differ.
    <html lang="pt-PT" data-theme="default" data-mode="light" suppressHydrationWarning>
      <head><style id="app-themes" dangerouslySetInnerHTML={{ __html: themeCss() }} /><script id="app-theme-boot" dangerouslySetInnerHTML={{ __html: appearanceBootScript }} /></head>
      <body><Script src="/runtime-config.js" strategy="beforeInteractive" /><AuthProvider><AppearanceSync /><I18nProvider><ToastProvider><QueryProvider><SiteProvider><AuthGate>{children}</AuthGate></SiteProvider></QueryProvider></ToastProvider></I18nProvider></AuthProvider></body>
    </html>
  );
}
