import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { LocaleDocumentTitle } from '@/components/layout/locale-document-title';
import { ToastProvider } from '@/components/ui/toast';
import { I18nProvider } from '@/lib/i18n';
import { QueryProvider } from '@/lib/query/query-provider';
import { SiteProvider } from '@/lib/site-context';
import { AppearanceSync } from '@/components/theme/appearance-sync';
import { appearanceBootScript } from '@/lib/theme/appearance-core';
import { themeCss } from '@/lib/theme/themes';

// No static title: LocaleDocumentTitle sets it from the app locale (a static one overrode it after hydration).
export const metadata: Metadata = {
  description: 'Centro de operações para infraestrutura e ciberdefesa.',
};

// QueryProvider and SiteProvider sit above AuthGate, which the route groups render: (authenticated)/layout.tsx
// for app pages and (public)/setup/layout.tsx for setup; the (public) unsubscribe page has none. The site list
// starts loading as soon as Keycloak reports a session (in parallel with the identity check), and the query cache
// survives gate state changes. SiteProvider only fetches when authenticated; AuthGate still decides what renders.
// The per-request CSP nonce (proxy.ts) goes on the inline theme boot script; reading it renders
// pages per request, which is what lets Next.js put the same nonce on its own inline scripts.
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // The boot script sets data-theme/data-mode before first paint, so the server markup can differ.
    // Browsers hide a script's nonce attribute once it runs, so the boot script's nonce never matches on hydration.
    // runtime-config.js is a plain blocking same-origin script (allowed by script-src 'self'): next/script's
    // beforeInteractive wrapper is an inline script whose hidden nonce fails hydration the same way.
    <html lang="pt-PT" data-theme="default" data-mode="light" suppressHydrationWarning>
      <head>
        <style id="app-themes" dangerouslySetInnerHTML={{ __html: themeCss() }} />
        <script id="app-theme-boot" nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: appearanceBootScript }} />
        {/* Must run before any app code reads window.__CIVERNODE_CONFIG__, as beforeInteractive did. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/runtime-config.js" />
      </head>
      <body><AuthProvider><AppearanceSync /><I18nProvider><LocaleDocumentTitle /><ToastProvider><QueryProvider><SiteProvider>{children}</SiteProvider></QueryProvider></ToastProvider></I18nProvider></AuthProvider></body>
    </html>
  );
}
