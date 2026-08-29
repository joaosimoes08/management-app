'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, MapPin, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { AppLocale, useI18n } from '@/lib/i18n';
import { apiFetch } from '@/lib/api/client';

type SetupStatus = { setupCompleted: boolean; organizationName?: string | null; organizationCode?: string | null; locale?: AppLocale; siteCount: number; hasSite: boolean };
type SetupForm = { organizationName: string; organizationCode: string; timezone: string; locale: AppLocale; siteName: string; siteCode: string; address: string; city: string; region: string; country: string; buildingName: string; roomName: string; rackName: string };

const initialForm: SetupForm = { organizationName: '', organizationCode: '', timezone: 'Europe/Lisbon', locale: 'pt-PT', siteName: '', siteCode: '', address: '', city: '', region: '', country: 'Portugal', buildingName: '', roomName: '', rackName: '' };

export default function SetupPage() {
  const { hasRole } = useAuth();
  const { t, setLocale } = useI18n();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<SetupStatus>('/api/v1/setup/status').then((current) => {
      setStatus(current);
      if (current.setupCompleted) window.location.replace('/');
      if (current.locale) setLocale(current.locale);
      setForm((value) => ({ ...value, organizationName: current.organizationName ?? '', organizationCode: current.organizationCode ?? '', locale: current.locale ?? value.locale }));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o setup.')).finally(() => setBusy(false));
  }, [apiFetch]);

  const update = (field: keyof SetupForm, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const saveOrganization = async () => {
    setSaving(true); setError(null);
    try { await apiFetch('/api/v1/setup/organization', { method: 'POST', body: JSON.stringify({ name: form.organizationName, code: form.organizationCode || undefined, timezone: form.timezone, locale: form.locale }) }); setStep(2); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível guardar a organização.'); }
    finally { setSaving(false); }
  };
  const saveSite = async () => {
    setSaving(true); setError(null);
    try { await apiFetch('/api/v1/setup/site', { method: 'POST', body: JSON.stringify({ name: form.siteName, code: form.siteCode, address: form.address || undefined, city: form.city || undefined, region: form.region || undefined, country: form.country || undefined, buildingName: form.buildingName || undefined, roomName: form.roomName || undefined, rackName: form.rackName || undefined }) }); setStatus((value) => value ? { ...value, hasSite: true, siteCount: value.siteCount + 1 } : value); setStep(3); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar o site.'); }
    finally { setSaving(false); }
  };
  const complete = async () => {
    setSaving(true); setError(null);
    try { await apiFetch('/api/v1/setup/complete', { method: 'POST' }); window.location.replace('/'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível concluir o setup.'); setSaving(false); }
  };

  if (busy) return <div className="auth-loading"><div className="auth-spinner" /><span>{t('setup.preparing')}</span></div>;
  if (!hasRole('ADMIN')) return <main className="auth-screen"><div className="auth-card"><div className="auth-logo error"><ShieldCheck size={26} /></div><span className="section-kicker">{t('shell.setup').toUpperCase()}</span><h1>{t('setup.adminTitle')}</h1><p>{t('setup.adminDescription')}</p></div></main>;

  const fields = (field: keyof SetupForm, label: string, placeholder: string, required = false) => <label className="setup-field">{label}{required && <b> *</b>}<input value={form[field]} onChange={(event) => update(field, event.target.value)} placeholder={placeholder} /></label>;

  return <main className="setup-page">
    <section className="setup-shell">
      <aside className="setup-aside"><div className="brand-mark"><ShieldCheck size={17} /></div><span className="section-kicker">COCIBER MANAGEMENT</span><h1>{t('setup.welcome')}</h1><p>{t('setup.asideDescription')}</p><div className="setup-steps">{[t('setup.welcomeStep'), t('setup.organization'), t('setup.firstSite'), t('setup.finish')].map((label, index) => <div className={index === step ? 'setup-step active' : index < step ? 'setup-step done' : 'setup-step'} key={label}><span>{index < step ? <Check size={13} /> : index + 1}</span>{label}</div>)}</div></aside>
      <div className="setup-content">
        {error && <div className="setup-error">{error}</div>}
        {step === 0 && <div className="setup-panel"><Sparkles size={28} /><span className="section-kicker">{t('setup.firstRun')}</span><h2>{t('setup.welcomeTitle')}</h2><p>{t('setup.welcomeDescription')}</p><button className="primary-button" onClick={() => setStep(1)}>{t('setup.start')} <ArrowRight size={16} /></button></div>}
        {step === 1 && <div className="setup-panel"><span className="section-kicker">{t('setup.step1')}</span><h2>{t('setup.orgQuestion')}</h2><p>{t('setup.orgDescription')}</p><label className="setup-field">{t('setup.language')}<select value={form.locale} onChange={(event) => { const next = event.target.value as AppLocale; update('locale', next); setLocale(next); }}><option value="pt-PT">Português (Portugal)</option><option value="en-US">English (United States)</option></select></label>{fields('organizationName', t('setup.orgName'), t('setup.orgNameExample'), true)}{fields('organizationCode', t('setup.shortCode'), t('setup.shortCodeExample')) }<label className="setup-field">{t('setup.timezone')}<select value={form.timezone} onChange={(event) => update('timezone', event.target.value)}><option>Europe/Lisbon</option><option>UTC</option><option>Europe/London</option><option>Europe/Madrid</option></select></label><div className="setup-actions"><button className="secondary-button" onClick={() => setStep(0)}><ArrowLeft size={15} /> {t('setup.back')}</button><button className="primary-button" disabled={!form.organizationName.trim() || saving} onClick={() => void saveOrganization()}>{saving ? t('setup.saving') : <>{t('setup.continue')} <ArrowRight size={15} /></>}</button></div></div>}
        {step === 2 && <div className="setup-panel"><span className="section-kicker">{t('setup.step2')}</span><h2>{t('setup.siteTitle')}</h2><p>{t('setup.siteDescription')}</p><div className="form-row">{fields('siteName', t('setup.siteName'), t('setup.siteNameExample'), true)}{fields('siteCode', t('setup.siteCode'), t('setup.siteCodeExample'), true)}</div><div className="form-row">{fields('address', t('setup.address'), t('setup.addressExample'))}{fields('city', t('setup.city'), t('setup.city'))}</div><div className="form-row">{fields('region', t('setup.region'), t('setup.region'))}{fields('country', t('setup.country'), t('setup.country'))}</div><div className="setup-location"><MapPin size={16} /><strong>{t('setup.optionalHierarchy')}</strong><div className="form-row">{fields('buildingName', t('setup.building'), t('setup.buildingExample'))}{fields('roomName', t('setup.room'), t('setup.roomExample'))}</div>{fields('rackName', t('setup.rack'), t('setup.rackExample'))}</div><div className="setup-actions"><button className="secondary-button" onClick={() => setStep(1)}><ArrowLeft size={15} /> {t('setup.back')}</button><button className="primary-button" disabled={!form.siteName.trim() || !form.siteCode.trim() || saving} onClick={() => void saveSite()}>{saving ? t('setup.creating') : <>{t('setup.createSite')} <ArrowRight size={15} /></>}</button></div></div>}
        {step === 3 && <div className="setup-panel"><div className="setup-success"><Check size={25} /></div><span className="section-kicker">{t('setup.step3')}</span><h2>{t('setup.ready')}</h2><p>{t('setup.readyDescription').replace('{organization}', form.organizationName).replace('{site}', form.siteName).replace('{code}', form.siteCode.toUpperCase())}</p><button className="primary-button" disabled={saving} onClick={() => void complete()}>{saving ? t('setup.finishing') : <>{t('setup.enter')} <ArrowRight size={16} /></>}</button></div>}
      </div>
    </section>
  </main>;
}
