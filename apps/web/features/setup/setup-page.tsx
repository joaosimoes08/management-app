'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Building2, Check, Flag, MapPin, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { currentSearch, designPreviewStep, isDesignPreview } from '@/lib/design-preview';
import { AppLocale, useI18n } from '@/lib/i18n';
import { getConfiguredLocale, resolveOrganizationLocale } from '@/lib/runtime-config';
import { completeSetup, createSetupOrganization, createSetupSite, getSetupStatus, type SetupStatus } from './api';

type SetupForm = { organizationName: string; organizationCode: string; timezone: string; locale: AppLocale; siteName: string; siteCode: string; address: string; city: string; region: string; country: string; buildingName: string; roomName: string; rackName: string };

const SETUP_STEP_ICONS: LucideIcon[] = [Sparkles, Building2, MapPin, Flag];

function ProgressRing({ current, total, label }: { current: number; total: number; label: string }) {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  return <div className="onboarding-ring" role="img" aria-label={label}>
    <svg viewBox="0 0 60 60" aria-hidden="true"><circle className="onboarding-ring-track" cx="30" cy="30" r={radius} /><circle className="onboarding-ring-value" cx="30" cy="30" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - current / total)} /></svg>
    <span aria-hidden="true">{current}/{total}</span>
  </div>;
}

const initialForm: SetupForm = { organizationName: '', organizationCode: '', timezone: 'Europe/Lisbon', locale: 'pt-PT', siteName: '', siteCode: '', address: '', city: '', region: '', country: 'Portugal', buildingName: '', roomName: '', rackName: '' };

export default function SetupPage() {
  const { hasRole } = useAuth();
  const { t, setLocale } = useI18n();
  const queryClient = useQueryClient();
  // Dev-only, admin-only design preview (/setup?preview=1&step=N): no redirect, no API writes.
  const [search] = useState(currentSearch);
  const preview = isDesignPreview(search, { isAdmin: hasRole('ADMIN') });
  const [step, setStep] = useState(() => (preview ? designPreviewStep(search, 3) : 0));
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: status, isPending: busy } = useQuery({ queryKey: ['setup', 'status'], queryFn: getSetupStatus });

  useEffect(() => {
    if (!status) return;
    if (status.setupCompleted && !preview) window.location.replace('/');
    const locale = resolveOrganizationLocale(status, getConfiguredLocale());
    setLocale(locale);
    setForm((value) => ({ ...value, organizationName: status.organizationName ?? '', organizationCode: status.organizationCode ?? '', locale }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, preview]);

  const update = (field: keyof SetupForm, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const saveOrganization = async () => {
    if (preview) { setStep(2); return; }
    setSaving(true); setError(null);
    try { await createSetupOrganization({ name: form.organizationName, code: form.organizationCode || undefined, timezone: form.timezone, locale: form.locale }); setStep(2); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível guardar a organização.'); }
    finally { setSaving(false); }
  };
  const saveSite = async () => {
    if (preview) { setStep(3); return; }
    setSaving(true); setError(null);
    try {
      await createSetupSite({ name: form.siteName, code: form.siteCode, address: form.address || undefined, city: form.city || undefined, region: form.region || undefined, country: form.country || undefined, buildingName: form.buildingName || undefined, roomName: form.roomName || undefined, rackName: form.rackName || undefined });
      queryClient.setQueryData<SetupStatus>(['setup', 'status'], (value) => (value ? { ...value, hasSite: true, siteCount: value.siteCount + 1 } : value));
      setStep(3);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar o site.'); }
    finally { setSaving(false); }
  };
  const complete = async () => {
    if (preview) { window.location.replace('/'); return; }
    setSaving(true); setError(null);
    try { await completeSetup(); window.location.replace('/'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível concluir o setup.'); setSaving(false); }
  };

  if (busy) return <div className="auth-loading"><div className="auth-spinner" /><span>{t('setup.preparing')}</span></div>;
  if (!hasRole('ADMIN')) return <main className="auth-screen"><div className="auth-card"><div className="auth-logo error"><ShieldCheck size={26} /></div><span className="section-kicker">{t('shell.setup').toUpperCase()}</span><h1>{t('setup.adminTitle')}</h1><p>{t('setup.adminDescription')}</p></div></main>;

  const fields = (field: keyof SetupForm, label: string, placeholder: string, required = false) => <label className="setup-field">{label}{required && <b> *</b>}<input value={form[field]} onChange={(event) => update(field, event.target.value)} placeholder={placeholder} /></label>;

  const stepLabels = [t('setup.welcomeStep'), t('setup.organization'), t('setup.firstSite'), t('setup.finish')];
  const backButton = (target: number) => <button type="button" className="onboarding-back" aria-label={t('setup.back')} title={t('setup.back')} onClick={() => setStep(target)}><ArrowLeft size={17} /></button>;

  return <main className="setup-page onboarding-page">
    <section className="onboarding-card" aria-labelledby="onboarding-title">
      <aside className="onboarding-nav">
        <header className="onboarding-head">
          <div><h1 id="onboarding-title">{t('setup.onboardingTitle')}</h1><p>{t('setup.onboardingSubtitle')}</p></div>
          <ProgressRing current={step + 1} total={stepLabels.length} label={t('setup.progress', undefined, { current: step + 1, total: stepLabels.length })} />
        </header>
        <ol className="onboarding-steps">{stepLabels.map((label, index) => {
          const Icon = SETUP_STEP_ICONS[index];
          const state = index === step ? 'current' : index < step ? 'done' : 'upcoming';
          return <li className={`onboarding-step ${state}`} key={label} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="onboarding-step-icon">{state === 'done' ? <Check size={16} strokeWidth={2.4} /> : <Icon size={16} />}</span>
            <span className="onboarding-step-label">{label}</span>
            {state === 'current' && <ArrowRight className="onboarding-step-arrow" size={16} aria-hidden="true" />}
          </li>;
        })}</ol>
      </aside>
      <div className="onboarding-content">
        {preview && <span className="onboarding-preview-badge" role="status">{t('setup.previewBadge')}</span>}
        {error && <div className="setup-error" role="alert">{error}</div>}
        {step === 0 && <div className="onboarding-panel"><div className="onboarding-body"><h2>{t('setup.welcomeTitle')}</h2><p>{t('setup.welcomeDescription')}</p></div><div className="onboarding-actions"><button className="onboarding-primary" onClick={() => setStep(1)}>{t('setup.start')} <ArrowRight size={16} /></button></div></div>}
        {step === 1 && <div className="onboarding-panel"><div className="onboarding-body"><h2>{t('setup.orgQuestion')}</h2><p>{t('setup.orgDescription')}</p><label className="setup-field">{t('setup.language')}<select value={form.locale} onChange={(event) => { const next = event.target.value as AppLocale; update('locale', next); setLocale(next); }}><option value="pt-PT">Português (Portugal)</option><option value="en-US">English (United States)</option></select></label>{fields('organizationName', t('setup.orgName'), t('setup.orgNameExample'), true)}{fields('organizationCode', t('setup.shortCode'), t('setup.shortCodeExample'))}<label className="setup-field">{t('setup.timezone')}<select value={form.timezone} onChange={(event) => update('timezone', event.target.value)}><option>Europe/Lisbon</option><option>UTC</option><option>Europe/London</option><option>Europe/Madrid</option></select></label></div><div className="onboarding-actions">{backButton(0)}<button className="onboarding-primary" disabled={!form.organizationName.trim() || saving} onClick={() => void saveOrganization()}>{saving ? t('setup.saving') : <>{t('setup.continue')} <ArrowRight size={16} /></>}</button></div></div>}
        {step === 2 && <div className="onboarding-panel"><div className="onboarding-body"><h2>{t('setup.siteTitle')}</h2><p>{t('setup.siteDescription')}</p><div className="form-row">{fields('siteName', t('setup.siteName'), t('setup.siteNameExample'), true)}{fields('siteCode', t('setup.siteCode'), t('setup.siteCodeExample'), true)}</div><div className="form-row">{fields('address', t('setup.address'), t('setup.addressExample'))}{fields('city', t('setup.city'), t('setup.city'))}</div><div className="form-row">{fields('region', t('setup.region'), t('setup.region'))}{fields('country', t('setup.country'), t('setup.country'))}</div><div className="setup-location"><MapPin size={16} /><strong>{t('setup.optionalHierarchy')}</strong><div className="form-row">{fields('buildingName', t('setup.building'), t('setup.buildingExample'))}{fields('roomName', t('setup.room'), t('setup.roomExample'))}</div>{fields('rackName', t('setup.rack'), t('setup.rackExample'))}</div></div><div className="onboarding-actions">{backButton(1)}<button className="onboarding-primary" disabled={!form.siteName.trim() || !form.siteCode.trim() || saving} onClick={() => void saveSite()}>{saving ? t('setup.creating') : <>{t('setup.createSite')} <ArrowRight size={16} /></>}</button></div></div>}
        {step === 3 && <div className="onboarding-panel"><div className="onboarding-body"><div className="setup-success"><Check size={25} /></div><h2>{t('setup.ready')}</h2><p>{t('setup.readyDescription').replace('{organization}', form.organizationName).replace('{site}', form.siteName).replace('{code}', form.siteCode.toUpperCase())}</p></div><div className="onboarding-actions"><button className="onboarding-primary" disabled={saving} onClick={() => void complete()}>{saving ? t('setup.finishing') : <>{t('setup.enter')} <ArrowRight size={16} /></>}</button></div></div>}
      </div>
    </section>
  </main>;
}
