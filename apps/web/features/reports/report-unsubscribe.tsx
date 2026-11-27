'use client';

import { CheckCircle2, MailX } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { getPublicRuntimeConfig } from '@/lib/runtime-config';
import { isRecord, isString } from '@/lib/data-guards';

export const PUBLIC_UNSUBSCRIBE_PATH = '/relatorios/cancelar-subscricao';

type State = { kind: 'loading' } | { kind: 'invalid' } | { kind: 'ready'; name: string; subscribed: boolean } | { kind: 'working'; name: string } | { kind: 'done'; name: string } | { kind: 'error'; name: string };

type UnsubscribeLookup = { reportName: string; subscribed: boolean };

/** The public token lookup; any other shape is treated like an invalid link. */
export function parseUnsubscribeLookup(value: unknown): UnsubscribeLookup | null {
  return isRecord(value) && isString(value.reportName) && typeof value.subscribed === 'boolean' ? { reportName: value.reportName, subscribed: value.subscribed } : null;
}

const endpoint = () => `${getPublicRuntimeConfig().apiUrl}/api/v1/reports/unsubscribe`;

/**
 * The page behind the email's unsubscribe link. Opening the link only reads the token (mail scanners follow links);
 * the subscription changes only when the person presses the button. No session needed: the token is the credential.
 */
export function ReportUnsubscribe({ token }: { token: string | null }) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!token) { setState({ kind: 'invalid' }); return; }
    let active = true;
    fetch(`${endpoint()}?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const data = parseUnsubscribeLookup(await response.json() as unknown);
        if (!data) throw new Error('Unexpected response');
        if (active) setState(data.subscribed ? { kind: 'ready', name: data.reportName, subscribed: true } : { kind: 'done', name: data.reportName });
      })
      .catch(() => { if (active) setState({ kind: 'invalid' }); });
    return () => { active = false; };
  }, [token]);

  const confirm = async (name: string) => {
    setState({ kind: 'working', name });
    try {
      const response = await fetch(endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      if (response.status === 404) { setState({ kind: 'invalid' }); return; }
      if (!response.ok) throw new Error(String(response.status));
      setState({ kind: 'done', name });
    } catch { setState({ kind: 'error', name }); }
  };

  return <div aria-live="polite">
    <div className="auth-panel-icon">{state.kind === 'done' ? <CheckCircle2 size={21} /> : <MailX size={21} />}</div>
    <h1>{t('reports.unsubscribe.title')}</h1>
    {state.kind === 'loading' && <p role="status">{t('reports.unsubscribe.loading')}</p>}
    {state.kind === 'invalid' && <p className="ipam-alert error" role="alert">{t('reports.unsubscribe.invalid')}</p>}
    {(state.kind === 'ready' || state.kind === 'working' || state.kind === 'error') && <>
      <p>{t('reports.unsubscribe.question', undefined, { name: state.name })}</p>
      {state.kind === 'error' && <p className="ipam-alert error" role="alert">{t('reports.unsubscribe.error')}</p>}
      <div className="auth-actions"><button type="button" className="primary-button" disabled={state.kind === 'working'} onClick={() => void confirm(state.name)}>{state.kind === 'working' ? t('reports.unsubscribe.working') : t('reports.unsubscribe.confirm')}</button></div>
    </>}
    {state.kind === 'done' && <p role="status">{t('reports.unsubscribe.done', undefined, { name: state.name })}</p>}
    <p><Link href="/">{t('reports.unsubscribe.back')}</Link></p>
  </div>;
}
