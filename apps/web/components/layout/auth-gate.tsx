'use client';

import { AlertTriangle, LogIn, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { apiFetch } from '@/lib/api/client';
import { getPublicOrganizationName, getPublicRuntimeConfig } from '@/lib/runtime-config';

function AuthVisual({ organizationName }: { organizationName: string }) {
  return <div className="auth-visual" aria-hidden="true">
    <div className="auth-visual-grid" />
    <div className="auth-visual-copy"><div className="auth-visual-mark"><ShieldCheck size={18} /></div><span>{organizationName.toLocaleUpperCase()}</span><strong>Infrastructure<br />management</strong></div>
    <div className="auth-scene">
      <div className="auth-orbit auth-orbit-one" /><div className="auth-orbit auth-orbit-two" />
      <div className="auth-monitor"><div className="auth-monitor-top"><i /><i /><i /></div><div className="auth-monitor-screen"><ShieldCheck size={33} /><span>SECURE OPERATIONS</span><b>● ONLINE</b></div></div>
      <div className="auth-server auth-server-one"><i /><i /><i /></div><div className="auth-server auth-server-two"><i /><i /><i /></div>
      <div className="auth-node auth-node-one" /><div className="auth-node auth-node-two" /><div className="auth-node auth-node-three" />
    </div>
    <div className="auth-visual-foot"><span>SECURE INFRASTRUCTURE</span><span>01 / 01</span></div>
  </div>;
}

function AuthLayout({ children, error = false, organizationName }: { children: React.ReactNode; error?: boolean; organizationName: string }) {
  return <main className="auth-screen"><div className={`auth-card auth-layout ${error ? 'auth-layout-error' : ''}`}><AuthVisual organizationName={organizationName} /><section className="auth-panel">{children}</section></div></main>;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { loading, authError, authenticated, login, retry } = useAuth();
  const { locale } = useI18n();
  const organizationName = getPublicOrganizationName();
  const realm = getPublicRuntimeConfig().keycloakRealm;
  const [checkingSetup, setCheckingSetup] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const isSetupPage = typeof window !== 'undefined' && window.location.pathname === '/setup';

  useEffect(() => {
    if (!authenticated || isSetupPage) return;
    let active = true;
    setCheckingSetup(true);
    void apiFetch<{ setupCompleted: boolean }>('/api/v1/setup/status')
      .then((status) => {
        if (active && !status.setupCompleted) window.location.replace('/setup');
      })
      .catch((error) => { if (active) setSetupError(error instanceof Error ? error.message : 'Não foi possível validar o setup inicial.'); })
      .finally(() => { if (active) setCheckingSetup(false); });
    return () => { active = false; };
  }, [authenticated, apiFetch, isSetupPage]);
  if (loading) return <div className="auth-loading"><div className="auth-spinner" /><span>{locale === 'en-US' ? `Connecting to ${organizationName}…` : `A ligar a ${organizationName}...`}</span></div>;
  if (authError) return <AuthLayout error organizationName={organizationName}><div className="auth-panel-icon error"><AlertTriangle size={21} /></div><span className="section-kicker">{organizationName.toLocaleUpperCase()}</span><h1>Não foi possível ligar.</h1><p>{authError} Confirma se o Keycloak está ativo e se o client <code>simoes-web</code> existe no realm <code>{realm}</code>.</p><div className="auth-actions"><button className="secondary-button" onClick={retry}><RefreshCw size={15} /> Tentar novamente</button><button className="primary-button" onClick={() => void login()}><LogIn size={16} /> Iniciar sessão</button></div></AuthLayout>;
  if (!authenticated) return <AuthLayout organizationName={organizationName}><span className="section-kicker">{locale === 'en-US' ? 'SECURE ACCESS' : 'ACESSO SEGURO'}</span><h1>{locale === 'en-US' ? `Welcome to ${organizationName}.` : `Bem-vindo ao ${organizationName}.`}</h1><p>{locale === 'en-US' ? `Sign in to the infrastructure and cyber defence management center for ${organizationName}.` : `Entra no centro de gestão de infraestrutura e ciberdefesa de ${organizationName}.`}</p><button className="primary-button auth-login" onClick={() => void login()}><LogIn size={16} /> {locale === 'en-US' ? 'Continue with Keycloak' : 'Continuar com Keycloak'}</button><div className="auth-panel-note"><ShieldCheck size={14} /><span>{locale === 'en-US' ? 'Secure authentication' : 'Autenticação segura'} · Realm {realm}</span></div></AuthLayout>;
  if (checkingSetup && !isSetupPage) return <div className="auth-loading"><div className="auth-spinner" /><span>A validar a configuração inicial...</span></div>;
  if (setupError && !isSetupPage) return <main className="auth-screen"><div className="auth-card"><div className="auth-logo error"><AlertTriangle size={26} /></div><span className="section-kicker">CONFIGURAÇÃO INICIAL</span><h1>Não foi possível validar o setup.</h1><p>{setupError}</p><button className="primary-button auth-login" onClick={() => window.location.reload()}><RefreshCw size={16} /> Tentar novamente</button></div></main>;
  return <>{children}</>;
}
