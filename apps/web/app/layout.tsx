import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/auth';
import { AuthGate } from '../components/auth-gate';
import { ToastProvider } from '../components/toast-provider';
import { I18nProvider } from '../lib/i18n';

export const metadata: Metadata = {
  title: 'COCiber · Gestão de Infraestrutura',
  description: 'Centro de operações para infraestrutura e ciberdefesa.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-PT">
      <body><AuthProvider><I18nProvider><ToastProvider><AuthGate>{children}</AuthGate></ToastProvider></I18nProvider></AuthProvider></body>
    </html>
  );
}
