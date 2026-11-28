'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowUpRight, BookOpen, Check, ExternalLink, FileText, Link as LinkIcon, ListChecks, Loader2, MessageCircle, Network, Plus, Search, Server, ShieldCheck, Star, Trash2, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { PageShell } from '@/components/layout/app-shell';
import type { ApplicationLink, CheckAllItem } from './api';
import { addFavoriteApplicationLink, checkApplicationLink, createApplicationLink, listApplicationLinks, listFavoriteApplicationLinks, removeApplicationLink, removeFavoriteApplicationLink, updateApplicationLink } from './api';
import { CheckAllPanel } from './check-all-panel';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { translateMessage, useOptionalI18n } from '@/lib/i18n';
import { isHttpUrl, safeHref } from '@/lib/safe-href';


type LinkForm = { id?: string; name: string; url: string; icon: string; description: string; category: string; sortOrder: string; isActive: boolean; checkAvailability: boolean; roles: string[] };
const emptyForm: LinkForm = { name: '', url: '', icon: 'LinkIcon', description: '', category: 'Operações', sortOrder: '0', isActive: true, checkAvailability: false, roles: [] };
/** Same list the API accepts (apps/api/src/auth/roles.ts APPLICATION_ROLES). */
const roleOptions = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY'] as const;
const roleLabelKeys: Record<(typeof roleOptions)[number], string> = { ADMIN: 'portal.role.admin', NETWORK_OPERATOR: 'portal.role.networkOperator', SYSTEMS_OPERATOR: 'portal.role.systemsOperator', AUDITOR: 'portal.role.auditor', READ_ONLY: 'portal.role.readOnly' };
const icons = { Activity, BookOpen, FileText, LinkIcon, MessageCircle, Network, Server, ShieldCheck };
const resolveIcon = (name: string) => icons[name as keyof typeof icons] ?? LinkIcon;

export default function PortalPage() {
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const i18n = useOptionalI18n();
  const t = (key: string, params?: Record<string, string | number>) => i18n ? i18n.t(key, undefined, params) : translateMessage('pt-PT', key, undefined, params);
  const { hasRole } = useAuth();
  const queryClient = useQueryClient();
  const admin = hasRole('ADMIN');
  const [form, setForm] = useState<LinkForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState<string>();
  const [error, setError] = useState<string>();
  // Only http: and https: links are saved (the API refuses the rest with a 400); shown under the URL field.
  const [urlError, setUrlError] = useState<string>();
  const [searchQuery, setSearchQuery] = useState('');
  const [showCheckAll, setShowCheckAll] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState<string>();

  // The API stores availability and timestamp. Match the reason to that exact check.
  const [checkResults, setCheckResults] = useState<Record<string, Pick<CheckAllItem, 'code' | 'checkedAt'>>>({});
  const rememberChecks = (items: ReadonlyArray<Pick<CheckAllItem, 'id' | 'code' | 'checkedAt'>>) => {
    setCheckResults((current) => {
      const next = { ...current };
      for (const { id, code, checkedAt } of items) {
        if (checkedAt && checkedAt >= (next[id]?.checkedAt ?? '')) next[id] = { code, checkedAt };
      }
      return next;
    });
  };

  const { data: links = [], isLoading: loading, refetch } = useQuery({ queryKey: ['portal', 'links', admin], queryFn: () => listApplicationLinks(admin) });
  const loadLinks = () => void refetch();
  const visibleLinks = useMemo(() => { const query = searchQuery.trim().toLowerCase(); return query ? links.filter((link) => `${link.name} ${link.category} ${link.description ?? ''}`.toLowerCase().includes(query)) : links; }, [links, searchQuery]);
  const categories = useMemo(() => Array.from(new Set(visibleLinks.map((link) => link.category))), [visibleLinks]);
  const { data: favoriteData } = useQuery({ queryKey: ['portal', 'favorites'], queryFn: listFavoriteApplicationLinks });
  // Favourites in the user's order; the list's isFavorite covers the moment before the favourites load.
  const favoriteIds = useMemo(() => new Set(favoriteData ? favoriteData.items.map((item) => item.id) : links.filter((link) => link.isFavorite).map((link) => link.id)), [favoriteData, links]);
  const favoriteLinks = useMemo(() => {
    const visible = new Map(visibleLinks.map((link) => [link.id, link]));
    const ordered = favoriteData ? favoriteData.items.map((item) => item.id) : visibleLinks.filter((link) => link.isFavorite).map((link) => link.id);
    return ordered.map((id) => visible.get(id)).filter((link): link is ApplicationLink => Boolean(link));
  }, [favoriteData, visibleLinks]);

  function openCreate() { setForm(emptyForm); setUrlError(undefined); setShowForm(true); }
  function openEdit(link: ApplicationLink) { setUrlError(undefined); setForm({ id: link.id, name: link.name, url: link.url, icon: link.icon, description: link.description ?? '', category: link.category, sortOrder: String(link.sortOrder), isActive: link.isActive, checkAvailability: link.checkAvailability, roles: link.roles.map((item) => item.role) }); setShowForm(true); }
  function toggleRole(role: string, checked: boolean) { setForm((current) => ({ ...current, roles: checked ? [...current.roles.filter((item) => item !== role), role] : current.roles.filter((item) => item !== role) })); }
  function updateForm<K extends keyof LinkForm>(key: K, value: LinkForm[K]) { if (key === 'url') setUrlError(undefined); setForm((current) => ({ ...current, [key]: value })); }

  async function saveLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(undefined);
    if (!isHttpUrl(form.url.trim())) { setUrlError(t('portal.urlScheme')); return; }
    setUrlError(undefined); setSaving(true);
    const payload = { name: form.name, url: form.url.trim(), icon: form.icon || 'LinkIcon', description: form.description || undefined, category: form.category || 'Operações', sortOrder: Number(form.sortOrder) || 0, isActive: form.isActive, checkAvailability: form.checkAvailability, roles: roleOptions.filter((role) => form.roles.includes(role)) };
    try { if (form.id) await updateApplicationLink(form.id, payload); else await createApplicationLink(payload); setShowForm(false); setForm(emptyForm); await queryClient.invalidateQueries({ queryKey: ['portal', 'links'] }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('portal.saveError')); }
    finally { setSaving(false); }
  }

  async function removeLink(id: string) { if (!(await askConfirm({ title: t('portal.remove.title'), message: t('portal.remove.message'), confirmLabel: t('portal.remove.action'), destructive: true }))) return; try { await removeApplicationLink(id); await queryClient.invalidateQueries({ queryKey: ['portal', 'links'] }); } catch { setError(t('portal.remove.error')); } }
  async function toggleFavorite(link: ApplicationLink) {
    const favorite = favoriteIds.has(link.id);
    setFavoriteBusy(link.id); setError(undefined);
    try {
      if (favorite) await removeFavoriteApplicationLink(link.id); else await addFavoriteApplicationLink(link.id);
      queryClient.setQueryData<ApplicationLink[]>(['portal', 'links', admin], (current) => current?.map((item) => item.id === link.id ? { ...item, isFavorite: !favorite } : item));
      await queryClient.invalidateQueries({ queryKey: ['portal', 'favorites'] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('portal.favorite.error')); }
    finally { setFavoriteBusy(undefined); }
  }
  async function checkLink(id: string) {
    setChecking(id);
    try {
      const updated = await checkApplicationLink(id);
      rememberChecks([{ id, checkedAt: updated.lastCheckedAt ?? undefined, code: updated.code }]);
      queryClient.setQueryData<ApplicationLink[]>(['portal', 'links', admin], (current) => current?.map((link) => (
        link.id === id && (updated.lastCheckedAt ?? '') >= (link.lastCheckedAt ?? '') ? updated : link
      )));
    } catch {
      setError(t('portal.checkError'));
    } finally {
      setChecking(undefined);
    }
  }

  const renderCard = (link: ApplicationLink) => { const Icon = resolveIcon(link.icon); const check = checkResults[link.id]; const blocked = check?.code === 'BLOCKED' && check.checkedAt === link.lastCheckedAt; const href = safeHref(link.url); return <article className={`portal-card ${!link.isActive ? 'inactive-card' : ''}`} key={link.id}><div className="portal-card-head"><span className="portal-icon"><Icon size={21} /></span><div className="table-actions"><span className={`availability ${link.isAvailable === false ? 'unavailable' : ''}`}>{(link.checkAvailability || blocked) && <><i />{blocked ? t('portal.outcome.blocked') : link.isAvailable === false ? t('portal.outcome.unavailable') : link.isAvailable === true ? t('portal.outcome.available') : t('portal.outcome.unchecked')}</>}</span><button type="button" className="icon-button subtle" disabled={favoriteBusy === link.id} aria-pressed={favoriteIds.has(link.id)} aria-label={favoriteIds.has(link.id) ? t('portal.favorite.removeNamed', { name: link.name }) : t('portal.favorite.addNamed', { name: link.name })} title={favoriteIds.has(link.id) ? t('portal.favorite.remove') : t('portal.favorite.add')} onClick={() => void toggleFavorite(link)}><Star size={14} fill={favoriteIds.has(link.id) ? 'currentColor' : 'none'} /></button></div></div><h3>{link.name}</h3><p>{link.description || link.url}</p><div className="portal-card-foot">{href ? <a href={href} target="_blank" rel="noreferrer">{t('portal.open')} <ArrowUpRight size={14} /></a> : <span className="portal-unsafe-url" data-testid="portal-unsafe-url">{link.url}</span>}{admin && <div className="portal-admin-actions"><button title={t('portal.edit')} onClick={() => openEdit(link)}><FileText size={14} /></button>{link.checkAvailability && <button title={t('portal.checkAvailability')} onClick={() => void checkLink(link.id)} disabled={checking === link.id}>{checking === link.id ? <Loader2 className="spin" size={14} /> : <Search size={14} />}</button>}<button className="danger" title={t('portal.remove.action')} onClick={() => void removeLink(link.id)}><Trash2 size={14} /></button></div>}{!admin && href && <ExternalLink size={14} className="muted-icon" />}</div></article>; };

  return <>{confirmDialog}<PageShell section={t('portal.section')} search={{ value: searchQuery, onChange: setSearchQuery, placeholder: t('portal.search.placeholder'), scopeLabel: t('portal.search.scope') }} actions={admin && <><button className="topbar-action secondary-button" onClick={() => void loadLinks()}><Activity size={14} /> {t('portal.refresh')}</button><button className="secondary-button" onClick={() => setShowCheckAll(true)}><ListChecks size={14} /> {t('portal.checkAllButton')}</button><button className="primary-button" onClick={openCreate}><Plus size={15} /> {t('portal.new')}</button></>}><div className="portal-page aligned-workspace">
    <section className="ipam-card page-primary-card"><div className="panel-heading"><div><h1>{t('portal.title')}</h1></div></div><div className="page-primary-content">
    {showForm && admin && <form className="portal-form ipam-card" onSubmit={saveLink}><div className="form-title panel-heading"><div><h2>{form.id ? t('portal.form.edit') : t('portal.new')}</h2></div><button type="button" className="icon-button subtle" onClick={() => setShowForm(false)} aria-label={t('portal.close')}><X size={16} /></button></div><div className="form-row"><label>{t('portal.form.name')}<input required value={form.name} onChange={(event) => updateForm('name', event.target.value)} placeholder={t('portal.form.namePlaceholder')} /></label><label>{t('portal.form.category')}<input required value={form.category} onChange={(event) => updateForm('category', event.target.value)} placeholder={t('portal.form.categoryPlaceholder')} /></label></div><label>URL<input required type="url" value={form.url} onChange={(event) => updateForm('url', event.target.value)} placeholder="https://zabbix.interno" aria-invalid={urlError ? true : undefined} aria-describedby={urlError ? 'portal-url-error' : undefined} />{urlError && <span id="portal-url-error" className="form-error" role="alert">{urlError}</span>}</label><div className="form-row"><label>{t('portal.form.description')}<input value={form.description} onChange={(event) => updateForm('description', event.target.value)} placeholder={t('portal.form.descriptionPlaceholder')} /></label><label>{t('portal.form.icon')}<select value={form.icon} onChange={(event) => updateForm('icon', event.target.value)}>{Object.keys(icons).map((icon) => <option key={icon}>{icon}</option>)}</select></label></div><div className="form-row"><label>{t('portal.form.order')}<input type="number" min="0" value={form.sortOrder} onChange={(event) => updateForm('sortOrder', event.target.value)} /></label></div><label id="portal-roles-label">{t('portal.form.roles')}</label><div className="form-checks" role="group" aria-labelledby="portal-roles-label">{roleOptions.map((role) => <label key={role}><input type="checkbox" checked={form.roles.includes(role)} onChange={(event) => toggleRole(role, event.target.checked)} /> {t(roleLabelKeys[role])}</label>)}</div><div className="form-checks"><label><input type="checkbox" checked={form.isActive} onChange={(event) => updateForm('isActive', event.target.checked)} /> {t('portal.form.active')}</label><label><input type="checkbox" checked={form.checkAvailability} onChange={(event) => updateForm('checkAvailability', event.target.checked)} /> {t('portal.checkAvailability')}</label></div><button className="primary-button" disabled={saving}>{saving ? <Loader2 className="spin" size={15} /> : <Check size={15} />} {t('portal.form.save')}</button></form>}
    {showCheckAll && admin && <CheckAllPanel onBatch={rememberChecks} close={() => setShowCheckAll(false)} onFinished={() => void queryClient.invalidateQueries({ queryKey: ['portal', 'links'] })} />}
    {error && <div className="portal-error"><X size={15} /> {error}</div>}
    {loading ? <div className="portal-loading"><Loader2 className="spin" size={20} /> {t('portal.loading')}</div> : visibleLinks.length === 0 ? <div className="portal-empty"><LinkIcon size={27} /><h2>{searchQuery ? t('portal.empty.noMatches') : t('portal.empty.none')}</h2><p>{searchQuery ? t('portal.empty.tryAnother') : admin ? t('portal.empty.adminHint') : t('portal.empty.userHint')}</p></div> : <>{favoriteLinks.length > 0 && <section className="portal-category ipam-card" data-testid="portal-favorites"><div className="portal-category-head panel-heading"><div><h2>{t('portal.favorites.title')}</h2></div><span>{t('portal.appCount', { count: favoriteLinks.length })}</span></div><div className="portal-grid">{favoriteLinks.map(renderCard)}</div></section>}{categories.map((category) => <section className="portal-category ipam-card" key={category}><div className="portal-category-head panel-heading"><div><h2>{category}</h2></div><span>{t('portal.appCount', { count: visibleLinks.filter((link) => link.category === category).length })}</span></div><div className="portal-grid">{visibleLinks.filter((link) => link.category === category).map(renderCard)}</div></section>)}</>}
  </div></section></div></PageShell></>;
}
