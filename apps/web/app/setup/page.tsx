'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, MapPin, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../../lib/auth';

type SetupStatus = { setupCompleted: boolean; organizationName?: string | null; organizationCode?: string | null; siteCount: number; hasSite: boolean };
type SetupForm = { organizationName: string; organizationCode: string; timezone: string; siteName: string; siteCode: string; address: string; city: string; region: string; country: string; buildingName: string; roomName: string; rackName: string };

const initialForm: SetupForm = { organizationName: '', organizationCode: '', timezone: 'Europe/Lisbon', siteName: '', siteCode: '', address: '', city: '', region: '', country: 'Portugal', buildingName: '', roomName: '', rackName: '' };

export default function SetupPage() {
  const { apiFetch, hasRole } = useAuth();
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
      if (current.organizationName) setForm((value) => ({ ...value, organizationName: current.organizationName ?? '', organizationCode: current.organizationCode ?? '' }));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o setup.')).finally(() => setBusy(false));
  }, [apiFetch]);

  const update = (field: keyof SetupForm, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const saveOrganization = async () => {
    setSaving(true); setError(null);
    try { await apiFetch('/api/v1/setup/organization', { method: 'POST', body: JSON.stringify({ name: form.organizationName, code: form.organizationCode || undefined, timezone: form.timezone }) }); setStep(2); }
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

  if (busy) return <div className="auth-loading"><div className="auth-spinner" /><span>A preparar a configuração inicial...</span></div>;
  if (!hasRole('ADMIN')) return <main className="auth-screen"><div className="auth-card"><div className="auth-logo error"><ShieldCheck size={26} /></div><span className="section-kicker">CONFIGURAÇÃO INICIAL</span><h1>É necessária intervenção de um administrador.</h1><p>A primeira configuração desta instalação só pode ser concluída por um utilizador com a role ADMIN.</p></div></main>;

  const fields = (field: keyof SetupForm, label: string, placeholder: string, required = false) => <label className="setup-field">{label}{required && <b> *</b>}<input value={form[field]} onChange={(event) => update(field, event.target.value)} placeholder={placeholder} /></label>;

  return <main className="setup-page">
    <section className="setup-shell">
      <aside className="setup-aside"><div className="brand-mark"><ShieldCheck size={17} /></div><span className="section-kicker">COCIBER MANAGEMENT</span><h1>Vamos preparar o teu espaço de trabalho.</h1><p>Antes de gerir infraestrutura, precisamos de saber a que organização e localizações pertence este inventário.</p><div className="setup-steps">{['Boas-vindas', 'Organização', 'Primeiro site', 'Concluir'].map((label, index) => <div className={index === step ? 'setup-step active' : index < step ? 'setup-step done' : 'setup-step'} key={label}><span>{index < step ? <Check size={13} /> : index + 1}</span>{label}</div>)}</div></aside>
      <div className="setup-content">
        {error && <div className="setup-error">{error}</div>}
        {step === 0 && <div className="setup-panel"><Sparkles size={28} /><span className="section-kicker">PRIMEIRA EXECUÇÃO</span><h2>Bem-vindo ao COCiber Management.</h2><p>Este assistente cria a configuração mínima da aplicação sem inventar equipamentos, redes ou dados. Poderás completar o inventário mais tarde.</p><button className="primary-button" onClick={() => setStep(1)}>Começar <ArrowRight size={16} /></button></div>}
        {step === 1 && <div className="setup-panel"><span className="section-kicker">PASSO 1 DE 3</span><h2>Como se chama a organização?</h2><p>Este nome será usado no cabeçalho e no contexto operacional da aplicação.</p>{fields('organizationName', 'Nome da organização', 'Ex.: Centro de Operações de Cibersegurança', true)}{fields('organizationCode', 'Código curto', 'Ex.: COCIBER') }<label className="setup-field">Fuso horário<select value={form.timezone} onChange={(event) => update('timezone', event.target.value)}><option>Europe/Lisbon</option><option>UTC</option><option>Europe/London</option><option>Europe/Madrid</option></select></label><div className="setup-actions"><button className="secondary-button" onClick={() => setStep(0)}><ArrowLeft size={15} /> Voltar</button><button className="primary-button" disabled={!form.organizationName.trim() || saving} onClick={() => void saveOrganization()}>{saving ? 'A guardar...' : <>Continuar <ArrowRight size={15} /></>}</button></div></div>}
        {step === 2 && <div className="setup-panel"><span className="section-kicker">PASSO 2 DE 3</span><h2>Regista o primeiro site.</h2><p>Um site representa uma localização operacional. O edifício, sala e bastidor são opcionais e podem ser preenchidos agora ou mais tarde.</p><div className="form-row">{fields('siteName', 'Nome do site', 'Ex.: Sede Lisboa', true)}{fields('siteCode', 'Código do site', 'Ex.: LIS-01', true)}</div><div className="form-row">{fields('address', 'Morada', 'Rua, número')}{fields('city', 'Cidade', 'Lisboa')}</div><div className="form-row">{fields('region', 'Região', 'Lisboa')}{fields('country', 'País', 'Portugal')}</div><div className="setup-location"><MapPin size={16} /><strong>Hierarquia física opcional</strong><div className="form-row">{fields('buildingName', 'Edifício', 'Ex.: Edifício principal')}{fields('roomName', 'Sala', 'Ex.: Sala técnica')}</div>{fields('rackName', 'Primeiro bastidor', 'Ex.: RACK-01')}</div><div className="setup-actions"><button className="secondary-button" onClick={() => setStep(1)}><ArrowLeft size={15} /> Voltar</button><button className="primary-button" disabled={!form.siteName.trim() || !form.siteCode.trim() || saving} onClick={() => void saveSite()}>{saving ? 'A criar...' : <>Criar site <ArrowRight size={15} /></>}</button></div></div>}
        {step === 3 && <div className="setup-panel"><div className="setup-success"><Check size={25} /></div><span className="section-kicker">PASSO 3 DE 3</span><h2>A base está pronta.</h2><p>{form.organizationName} tem agora o site {form.siteName} ({form.siteCode.toUpperCase()}). A partir daqui podes começar a registar VLANs, subnets, equipamentos e links.</p><button className="primary-button" disabled={saving} onClick={() => void complete()}>{saving ? 'A concluir...' : <>Entrar na aplicação <ArrowRight size={16} /></>}</button></div>}
      </div>
    </section>
  </main>;
}
