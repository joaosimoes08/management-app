'use client';

import { useEscapeClose } from '@/components/ui/use-escape-close';
import { useDialogFocusRef } from '@/components/ui/use-dialog-focus';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, MapPin, Plus, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useMutation } from '@tanstack/react-query';
import { createSetupSite, type SetupSitePayload } from '@/features/setup/api';
import { useI18n } from '@/lib/i18n';
import { useSiteContext } from '@/lib/site-context';
import { usePathname } from 'next/navigation';
import { useUiText } from '@/components/ui/use-ui-text';

type Site = { id: string; name: string; code: string };
type SiteForm = { name: string; code: string; address: string; city: string; region: string; country: string; buildingName: string; roomName: string; rackName: string };

const emptyForm: SiteForm = { name: '', code: '', address: '', city: '', region: '', country: 'Portugal', buildingName: '', roomName: '', rackName: '' };

export function SiteSwitcher() {
  const ui = useUiText();
  const { hasRole, setupStatus } = useAuth();
  // The organization's own name, from its saved settings; never a hardcoded brand.
  const organizationName = setupStatus?.organizationName?.trim();
  const pathname = usePathname();
  const { t } = useI18n();
  const { sites, siteId, activeSite, activateSite, reloadSites } = useSiteContext();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const supportsAggregate = ['/', '/portal', '/auditoria', '/definicoes', '/ajuda', '/perfil'].some((path) => pathname === path || (path !== '/' && pathname.startsWith(`${path}/`)));

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', escape); };
  }, [open]);

  const activate = (nextSiteId: string) => {
    setOpen(false);
    activateSite(nextSiteId);
  };

  return <>
    <div className="site-switcher-root" ref={rootRef} onMouseLeave={() => setOpen(false)}>
      <button className="workspace-switcher" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu">
        {/* Civernode brand mark (same image as the favicon), on a light tile so its dark nodes stay visible on the dark
            topbar. Inline style keeps globals.css untouched. Decorative: the button name stays the site text. */}
        <img className="workspace-switcher-shield" src="/brand/civernode-mark.png" width={22} height={22} alt="" aria-hidden="true" style={{ boxSizing: 'border-box', padding: 2, borderRadius: 6, background: '#f5efe3' }} />
        <span className="workspace-switcher-copy" key={siteId || 'all-sites'}><small>{organizationName ? ui('siteSwitcher.activeSiteOf', undefined, { organization: organizationName.toLocaleUpperCase() }) : ui('siteSwitcher.activeSite')}</small><strong><MapPin size={12} aria-hidden="true" />{activeSite?.name ?? t('shell.allSites')}</strong></span>
        <ChevronDown className="workspace-switcher-chevron" size={15} aria-hidden="true" />
      </button>
      {open && <div className="site-switcher-menu" role="menu" aria-label={ui('ui.selectSite')}>
        {sites.length > 1 && supportsAggregate && <button className={!siteId ? 'active' : ''} role="menuitemradio" aria-checked={!siteId} onClick={() => activate('')}><span className="site-option-mark">T</span><span><strong>{t('shell.allSites')}</strong><small>{t('shell.globalView')}</small></span>{!siteId && <Check size={14} />}</button>}
        {sites.map((site) => <button className={site.id === siteId ? 'active' : ''} role="menuitemradio" aria-checked={site.id === siteId} key={site.id} onClick={() => activate(site.id)}><span className="site-option-mark">{site.code.charAt(0)}</span><span><strong>{site.name}</strong><small>{site.code}</small></span>{site.id === siteId && <Check size={14} />}</button>)}
        {hasRole('ADMIN') && <><div className="site-switcher-divider"/><button className="site-create-trigger" role="menuitem" onClick={() => { setOpen(false); setCreating(true); }}><span className="site-option-mark"><Plus size={14}/></span><span><strong>{t('shell.createSite')}</strong><small>{t('shell.addLocation')}</small></span></button></>}
      </div>}
    </div>
    {creating && <SiteWalkthrough onClose={() => setCreating(false)} onCreated={() => { void reloadSites(); }} onActivate={activate}/>}
  </>;
}

function SiteWalkthrough({ onClose, onCreated, onActivate }: { onClose: () => void; onCreated: (site: Site) => void; onActivate: (siteId: string) => void }) {
  const ui = useUiText();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<SiteForm>(emptyForm);
  const [created, setCreated] = useState<Site | null>(null);
  const [error, setError] = useState('');
  const createSite = useMutation({ mutationFn: (payload: SetupSitePayload) => createSetupSite(payload) });
  const saving = createSite.isPending;
  const update = (field: keyof SiteForm, value: string) => setForm((current) => ({ ...current, [field]: value }));
  useEscapeClose(() => { if (!saving) onClose(); });
  const dialogRef = useDialogFocusRef<HTMLElement>();
  const field = (name: keyof SiteForm, label: string, placeholder: string, required = false) => <label className="setup-field">{label}{required && <b> *</b>}<input autoFocus={name === 'name' && step === 0} required={required} value={form[name]} onChange={(event) => update(name, event.target.value)} placeholder={placeholder}/></label>;
  const create = async () => {
    setError('');
    try {
      // Blank fields are left out; name and code are required by the form.
      const site = await createSite.mutateAsync(Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim() || undefined])) as unknown as SetupSitePayload);
      setCreated(site); onCreated(site); setStep(3);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar o Site.'); }
  };
  return <div className="site-walkthrough-backdrop" role="presentation" onMouseDown={() => { if (!saving) onClose(); }}><section ref={dialogRef} className="site-walkthrough" role="dialog" aria-modal="true" aria-labelledby="site-walkthrough-title" onMouseDown={(event) => event.stopPropagation()}>
    <aside className="site-walkthrough-aside"><h2 id="site-walkthrough-title">Adicionar localização</h2><p>Cria a base do Site e, se quiseres, a primeira hierarquia física.</p><div className="setup-steps">{['Identificação', 'Localização', 'Confirmar', 'Concluído'].map((label, index) => <div className={index === step ? 'setup-step active' : index < step ? 'setup-step done' : 'setup-step'} key={label}><span>{index < step ? <Check size={13}/> : index + 1}</span>{label}</div>)}</div></aside>
    <div className="site-walkthrough-content"><button className="site-walkthrough-close" type="button" onClick={onClose} disabled={saving} aria-label={ui('ui.close')}><X size={16}/></button>{error && <div className="setup-error">{error}</div>}
      {step === 0 && <div className="setup-panel"><h2>Como identificamos este Site?</h2><p>O nome é apresentado na navegação. O código curto distingue o Site em listas e integrações.</p><div className="form-row">{field('name', 'Nome do Site', 'Ex.: Sede Lisboa', true)}{field('code', 'Código curto', 'Ex.: LIS-01', true)}</div><div className="form-row">{field('address', 'Morada', 'Rua, número')}{field('city', 'Cidade', 'Lisboa')}</div><div className="form-row">{field('region', 'Região', 'Lisboa')}{field('country', 'País', 'Portugal')}</div><div className="setup-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="button" disabled={!form.name.trim() || !form.code.trim()} onClick={() => setStep(1)}>Continuar <ArrowRight size={15}/></button></div></div>}
      {step === 1 && <div className="setup-panel"><h2>Queres criar a hierarquia física?</h2><p>Estes campos são opcionais. Podes adicionar edifícios, salas e bastidores mais tarde em Infraestrutura.</p><div className="setup-location"><MapPin size={16}/><strong>Hierarquia física opcional</strong><div className="form-row">{field('buildingName', 'Edifício', 'Ex.: Edifício principal')}{field('roomName', 'Sala', 'Ex.: Sala técnica')}</div>{field('rackName', 'Primeiro bastidor', 'Ex.: RACK-01')}</div><div className="setup-actions"><button className="secondary-button" type="button" onClick={() => setStep(0)}><ArrowLeft size={15}/> Voltar</button><button className="primary-button" type="button" onClick={() => setStep(2)}>Rever <ArrowRight size={15}/></button></div></div>}
      {step === 2 && <div className="setup-panel"><h2>Confirmar novo Site</h2><p>Confirma os dados antes de criar a localização.</p><dl className="site-review"><div><dt>Site</dt><dd>{form.name}</dd></div><div><dt>Código</dt><dd>{form.code.toUpperCase()}</dd></div><div><dt>Localização</dt><dd>{[form.city, form.region, form.country].filter(Boolean).join(' · ') || 'Não indicada'}</dd></div><div><dt>Hierarquia</dt><dd>{[form.buildingName, form.roomName, form.rackName].filter(Boolean).join(' → ') || 'Criar mais tarde'}</dd></div></dl><div className="setup-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => setStep(1)}><ArrowLeft size={15}/> Voltar</button><button className="primary-button" type="button" disabled={saving} onClick={() => void create()}>{saving ? 'A criar…' : <><Check size={15}/> Criar Site</>}</button></div></div>}
      {step === 3 && created && <div className="setup-panel"><div className="setup-success"><Check size={25}/></div><h2>{ui('siteSwitcher.ready', undefined, { name: created.name })}</h2><p>O Site foi adicionado à organização e já pode ser usado como contexto ativo.</p><button className="primary-button" type="button" onClick={() => onActivate(created.id)}>Mudar para este Site <ArrowRight size={15}/></button></div>}
    </div>
  </section></div>;
}
