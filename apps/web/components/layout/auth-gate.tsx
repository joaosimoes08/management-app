'use client';

import { AlertTriangle, LogIn, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useUiText } from '@/components/ui/use-ui-text';
import { getPublicOrganizationName, getPublicRuntimeConfig } from '@/lib/runtime-config';
import { PUBLIC_UNSUBSCRIBE_PATH, ReportUnsubscribe } from '@/features/reports/report-unsubscribe';
import { AUTH_SCENE_IMAGE, BRAND_MARK_IMAGE } from '@/lib/brand';
import styles from './auth-visual.module.css';

function AuthVisual({ organizationName, tagline, error }: { organizationName: string; tagline: string; error: boolean }) {
  return <div className={`${styles.visual} ${error ? styles.error : ''}`} aria-hidden="true">
    {/* Decorative scene; swap the artwork by changing AUTH_SCENE_IMAGE in lib/brand.ts. */}
    <img className={styles.scene} src={AUTH_SCENE_IMAGE} alt="" />
    <div className={styles.copy}><img className={styles.mark} src={BRAND_MARK_IMAGE} width={36} height={36} alt="" /><span className={styles.organization}>{organizationName.toLocaleUpperCase()}</span><strong className={styles.tagline}>{tagline}</strong></div>
  </div>;
}

function AuthLayout({ children, error = false, organizationName }: { children: React.ReactNode; error?: boolean; organizationName: string }) {
  const ui = useUiText();
  return <main className="auth-screen"><div className={`auth-card auth-layout ${error ? 'auth-layout-error' : ''}`}><AuthVisual organizationName={organizationName} tagline={ui('authGate.tagline')} error={error} /><section className="auth-panel">{children}</section></div></main>;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { loading, authError, authenticated, setupStatus, setupStatusError, login, retry } = useAuth();
  const ui = useUiText();
  const organizationName = getPublicOrganizationName();
  const realm = getPublicRuntimeConfig().keycloakRealm;
  const isSetupPage = typeof window !== 'undefined' && window.location.pathname === '/setup';
  // The email unsubscribe link works without a session: its token is the credential, so nothing below runs for it.
  const isUnsubscribePage = typeof window !== 'undefined' && window.location.pathname === PUBLIC_UNSUBSCRIBE_PATH;

  // The setup status arrives with the identity (AuthProvider), so this gate decides once and
  // the app below mounts once, instead of rendering, flipping to a spinner and mounting again.
  const setupIncomplete = authenticated && !isSetupPage && !isUnsubscribePage && setupStatus !== null && !setupStatus.setupCompleted;
  useEffect(() => {
    if (setupIncomplete) window.location.replace('/setup');
  }, [setupIncomplete]);
  if (isUnsubscribePage) return <AuthLayout organizationName={organizationName}><ReportUnsubscribe token={new URLSearchParams(window.location.search).get('token')} /></AuthLayout>;
  if (loading) return <div className="auth-loading"><div className="auth-spinner" /><span>{ui('authGate.connecting', undefined, { organization: organizationName })}</span></div>;
  if (authError) return <AuthLayout error organizationName={organizationName}><div className="auth-panel-icon error"><AlertTriangle size={21} /></div><h1>{ui('authGate.connectFailed')}</h1><p>{authError} {ui('authGate.connectHint', undefined, { client: 'simoes-web', realm })}</p><div className="auth-actions"><button className="secondary-button" onClick={retry}><RefreshCw size={15} /> {ui('authGate.retry')}</button><button className="primary-button" onClick={() => void login()}><LogIn size={16} /> {ui('authGate.signIn')}</button></div></AuthLayout>;
  if (!authenticated) return <AuthLayout organizationName={organizationName}><h1>{ui('authGate.welcome', undefined, { organization: organizationName })}</h1><p>{ui('authGate.intro', undefined, { organization: organizationName })}</p><button className="primary-button auth-login" onClick={() => void login()}><LogIn size={16} /> {ui('authGate.continueKeycloak')}</button><div className="auth-panel-note"><ShieldCheck size={14} /><span>{ui('authGate.secure', undefined, { realm })}</span></div></AuthLayout>;
  if (setupIncomplete) return <div className="auth-loading"><div className="auth-spinner" /><span>{ui('authGate.validatingSetup')}</span></div>;
  if (setupStatusError && !isSetupPage) return <main className="auth-screen"><div className="auth-card"><div className="auth-logo error"><AlertTriangle size={26} /></div><h1>{ui('authGate.setupFailed')}</h1><p>{setupStatusError}</p><button className="primary-button auth-login" onClick={() => window.location.reload()}><RefreshCw size={16} /> {ui('authGate.retry')}</button></div></main>;
  return <>{children}</>;
}
