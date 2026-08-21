'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowUpRight, BookOpen, Check, ChevronDown, ExternalLink, FileText, Link as LinkIcon, Loader2, MessageCircle, Network, Plus, Search, Server, ShieldCheck, Trash2, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { AppShell } from '../../components/app-shell';

type ApplicationLink = {
  id: string;
  name: string;
  url: string;
  icon: string;
  description?: string | null;
  category: string;
  sortOrder: number;
  isActive: boolean;
  checkAvailability: boolean;
  lastCheckedAt?: string | null;
  isAvailable?: boolean | null;
  roles: { role: string }[];
};

type LinkForm = { id?: string; name: string; url: string; icon: string; description: string; category: string; sortOrder: string; isActive: boolean; checkAvailability: boolean; roles: string };
const emptyForm: LinkForm = { name: '', url: '', icon: 'LinkIcon', description: '', category: 'Operações', sortOrder: '0', isActive: true, checkAvailability: false, roles: '' };
const roleOptions = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR', 'AUDITOR', 'READ_ONLY'];
const icons = { Activity, BookOpen, FileText, LinkIcon, MessageCircle, Network, Server, ShieldCheck };
const resolveIcon = (name: string) => icons[name as keyof typeof icons] ?? LinkIcon;

export default function PortalPage() {
  const { apiFetch, hasRole } = useAuth();
  const admin = hasRole('ADMIN');
  const [links, setLinks] = useState<ApplicationLink[]>([]);
  const [form, setForm] = useState<LinkForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState<string>();
  const [error, setError] = useState<string>();

  const loadLinks = useCallback(async () => {
    setLoading(true); setError(undefined);
    try { setLinks(await apiFetch<ApplicationLink[]>(`/api/v1/application-links${admin ? '?includeInactive=true' : ''}`)); }
    catch { setError('Não foi possível carregar as aplicações.'); }
    finally { setLoading(false); }
  }, [admin, apiFetch]);

  useEffect(() => { void loadLinks(); }, [loadLinks]);
  const categories = useMemo(() => Array.from(new Set(links.map((link) => link.category))), [links]);

  function openCreate() { setForm(emptyForm); setShowForm(true); }
  function openEdit(link: ApplicationLink) { setForm({ id: link.id, name: link.name, url: link.url, icon: link.icon, description: link.description ?? '', category: link.category, sortOrder: String(link.sortOrder), isActive: link.isActive, checkAvailability: link.checkAvailability, roles: link.roles.map((item) => item.role).join(', ') }); setShowForm(true); }
  function updateForm<K extends keyof LinkForm>(key: K, value: LinkForm[K]) { setForm((current) => ({ ...current, [key]: value })); }

  async function saveLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(undefined);
    const payload = { name: form.name, url: form.url, icon: form.icon || 'LinkIcon', description: form.description || undefined, category: form.category || 'Operações', sortOrder: Number(form.sortOrder) || 0, isActive: form.isActive, checkAvailability: form.checkAvailability, roles: form.roles.split(',').map((role) => role.trim()).filter(Boolean) };
    try { await apiFetch<ApplicationLink>(form.id ? `/api/v1/application-links/${form.id}` : '/api/v1/application-links', { method: form.id ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); setShowForm(false); setForm(emptyForm); await loadLinks(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível guardar a aplicação.'); }
    finally { setSaving(false); }
  }

  async function removeLink(id: string) { if (!window.confirm('Remover esta aplicação do portal?')) return; try { await apiFetch(`/api/v1/application-links/${id}`, { method: 'DELETE' }); await loadLinks(); } catch { setError('Não foi possível remover a aplicação.'); } }
  async function checkLink(id: string) { setChecking(id); try { const updated = await apiFetch<ApplicationLink>(`/api/v1/application-links/${id}/check`, { method: 'POST' }); setLinks((current) => current.map((link) => link.id === id ? updated : link)); } catch { setError('Não foi possível verificar a disponibilidade.'); } finally { setChecking(undefined); } }

  return <AppShell section="Portal interno"><main className="portal-page">
    <div className="portal-topline"><div><span className="section-kicker">COCIBER / APLICAÇÕES</span><h1>Aplicações chave</h1><p>Acesso rápido às ferramentas que suportam as operações do Centro.</p></div>{admin && <div className="portal-actions"><button className="secondary-button" onClick={() => void loadLinks()}><Activity size={15} /> Atualizar</button><button className="primary-button" onClick={openCreate}><Plus size={15} /> Nova aplicação</button></div>}</div>
    {showForm && admin && <form className="portal-form" onSubmit={saveLink}><div className="form-title"><div><span className="section-kicker">ADMINISTRAÇÃO</span><h2>{form.id ? 'Editar aplicação' : 'Nova aplicação'}</h2></div><button type="button" className="icon-button subtle" onClick={() => setShowForm(false)} aria-label="Fechar"><X size={16} /></button></div><div className="form-row"><label>Nome<input required value={form.name} onChange={(event) => updateForm('name', event.target.value)} placeholder="Ex.: Zabbix" /></label><label>Categoria<input required value={form.category} onChange={(event) => updateForm('category', event.target.value)} placeholder="Monitorização" /></label></div><label>URL<input required type="url" value={form.url} onChange={(event) => updateForm('url', event.target.value)} placeholder="https://zabbix.interno" /></label><div className="form-row"><label>Descrição<input value={form.description} onChange={(event) => updateForm('description', event.target.value)} placeholder="Monitorização e alertas" /></label><label>Ícone<select value={form.icon} onChange={(event) => updateForm('icon', event.target.value)}>{Object.keys(icons).map((icon) => <option key={icon}>{icon}</option>)}</select></label></div><div className="form-row"><label>Ordem<input type="number" min="0" value={form.sortOrder} onChange={(event) => updateForm('sortOrder', event.target.value)} /></label><label>Roles autorizadas<input value={form.roles} onChange={(event) => updateForm('roles', event.target.value)} placeholder="ADMIN, NETWORK_OPERATOR" /></label></div><div className="form-checks"><label><input type="checkbox" checked={form.isActive} onChange={(event) => updateForm('isActive', event.target.checked)} /> Ativa</label><label><input type="checkbox" checked={form.checkAvailability} onChange={(event) => updateForm('checkAvailability', event.target.checked)} /> Verificar disponibilidade</label></div><button className="primary-button" disabled={saving}>{saving ? <Loader2 className="spin" size={15} /> : <Check size={15} />} Guardar</button></form>}
    {error && <div className="portal-error"><X size={15} /> {error}</div>}
    {loading ? <div className="portal-loading"><Loader2 className="spin" size={20} /> A carregar aplicações...</div> : links.length === 0 ? <div className="portal-empty"><LinkIcon size={27} /><h2>Ainda não existem aplicações</h2><p>{admin ? 'Adiciona a primeira aplicação chave ao catálogo.' : 'Ainda não existem aplicações disponíveis para o teu perfil.'}</p></div> : categories.map((category) => <section className="portal-category" key={category}><div className="portal-category-head"><div><span className="section-kicker">CATÁLOGO</span><h2>{category}</h2></div><span>{links.filter((link) => link.category === category).length} aplicações</span></div><div className="portal-grid">{links.filter((link) => link.category === category).map((link) => { const Icon = resolveIcon(link.icon); return <article className={`portal-card ${!link.isActive ? 'inactive-card' : ''}`} key={link.id}><div className="portal-card-head"><span className="portal-icon"><Icon size={21} /></span><span className={`availability ${link.isAvailable === false ? 'unavailable' : ''}`}>{link.checkAvailability && <><i />{link.isAvailable === false ? 'Indisponível' : link.isAvailable === true ? 'Disponível' : 'Não verificado'}</>}</span></div><h3>{link.name}</h3><p>{link.description || link.url}</p><div className="portal-card-foot"><a href={link.url} target="_blank" rel="noreferrer">Abrir aplicação <ArrowUpRight size={14} /></a>{admin && <div className="portal-admin-actions"><button title="Editar" onClick={() => openEdit(link)}><FileText size={14} /></button>{link.checkAvailability && <button title="Verificar disponibilidade" onClick={() => void checkLink(link.id)} disabled={checking === link.id}>{checking === link.id ? <Loader2 className="spin" size={14} /> : <Search size={14} />}</button>}<button className="danger" title="Remover" onClick={() => void removeLink(link.id)}><Trash2 size={14} /></button></div>}{!admin && <ExternalLink size={14} className="muted-icon" />}</div></article>; })}</div></section>)}
  </main></AppShell>;
}
