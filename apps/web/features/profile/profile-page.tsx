'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Clock3, RefreshCw, ShieldCheck, User, X } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { getMyRoleRequests, submitRoleRequest } from './api';
import { NotificationsPanel } from './notifications-panel';
import styles from './notifications-panel.module.css';

const requestableRoles = ['NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR'] as const;
type RequestableRole = typeof requestableRoles[number];

export default function ProfilePage() {
  const { user, profile } = useAuth();
  const { t, formatDate } = useI18n();
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'profile' | 'roles' | 'notifications'>('profile');
  const [requestId, setRequestId] = useState('');
  const [selected, setSelected] = useState<RequestableRole[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const { data, refetch, isPending: loading, error: queryError } = useQuery({ queryKey: ['profile', 'role-requests', requestId], queryFn: () => getMyRoleRequests(requestId), enabled: tab !== 'notifications' });
  const load = () => void refetch();
  const queryErrorMessage = queryError instanceof Error ? queryError.message : '';
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const requested = query.get('tab');
    if (requested === 'roles' || requested === 'notifications') setTab(requested);
    const target = query.get('requestId');
    if (requested === 'roles' && target && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(target)) setRequestId(target);
  }, []);
  useEffect(() => {
    if (tab !== 'roles' || !requestId || !data?.history.some((item) => item.id === requestId)) return;
    const target = document.getElementById(`role-request-${requestId}`);
    target?.focus();
  }, [tab, requestId, data]);
  const selectTab = (next: typeof tab) => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    url.searchParams.delete('requestId');
    window.history.replaceState(null, '', url);
    setRequestId('');
    setTab(next);
  };
  const current = useMemo(() => new Set(data?.currentRoles ?? user?.roles ?? []), [data?.currentRoles, user?.roles]);
  const eligible = requestableRoles.filter((role) => (data?.eligibleRoles ?? requestableRoles).includes(role));
  const roleLabel = (role: string) => t(`role.${role}`, role);
  const submit = async () => {
    if (!selected.length) return;
    setSaving(true); setSubmitError('');
    try { await submitRoleRequest(selected); setSelected([]); success(t('profile.roles'), t('profile.requestSent')); await queryClient.invalidateQueries({ queryKey: ['profile', 'role-requests'] }); }
    catch (reason) { const message = reason instanceof Error ? reason.message : t('profile.submitError'); setSubmitError(message); toastError(t('profile.roles'), message); }
    finally { setSaving(false); }
  };
  const error = tab === 'notifications' ? '' : queryErrorMessage || submitError;
  return <AppShell section={t('profile.title')} showSectionTitle={false} toolbarKey={tab} context={[t(`profile.tabs.${tab}`)]} actions={tab !== 'notifications' && <div className="profile-toolbar-actions"><button className="secondary-button" onClick={load}><RefreshCw size={14} />{t('common.refresh')}</button>{tab === 'roles' && <button className="primary-button" disabled={saving || !selected.length || Boolean(data?.pendingRequest)} onClick={() => void submit()}><ShieldCheck size={14} />{saving ? t('common.loading') : t('profile.submit')}</button>}</div>} moduleTabs={<nav className={`settings-tabs ${styles.profileTabs}`} aria-label={t('profile.title')}><button className={tab === 'profile' ? 'active' : ''} aria-current={tab === 'profile' ? 'page' : undefined} onClick={() => selectTab('profile')}><User size={15}/>{t('profile.tabs.profile')}</button><button className={tab === 'roles' ? 'active' : ''} aria-current={tab === 'roles' ? 'page' : undefined} onClick={() => selectTab('roles')}><ShieldCheck size={15}/>{t('profile.tabs.roles')}</button><button className={tab === 'notifications' ? 'active' : ''} aria-current={tab === 'notifications' ? 'page' : undefined} onClick={() => selectTab('notifications')}><Bell size={15}/>{t('profile.tabs.notifications')}</button></nav>}><main className="profile-workspace settings-workspace"><header className="workspace-head"><div><span className="section-kicker">{t('profile.kicker')}</span><h1>{t('profile.title')}</h1></div></header>{error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}{tab === 'notifications' && user ? <NotificationsPanel key={user.id} userId={user.id} /> : tab === 'profile' ? <section className="ipam-card settings-panel profile-card"><div className="profile-summary"><div className="profile-avatar large">{(profile?.firstName || user?.username || '?').charAt(0).toUpperCase()}</div><div><h2>{profile?.firstName || user?.username}</h2><p>{user?.username}{profile?.email ? ` · ${profile.email}` : ''}</p></div></div><div className="detail-grid"><div><span>{t('profile.username')}</span><strong>{user?.username ?? '—'}</strong></div><div><span>{t('profile.roles')}</span><strong>{(data?.currentRoles ?? user?.roles ?? []).map(roleLabel).join(', ') || '—'}</strong></div></div></section> : <section className="ipam-card settings-panel"><div className="panel-heading"><div><span className="section-kicker">{t('profile.roles').toUpperCase()}</span><h2>{t('profile.rolesTitle')}</h2><p className="panel-description">{t('profile.rolesDescription')}</p></div></div>{loading ? <div className="profile-role-loading" aria-label={t('common.loading')} aria-busy="true"><i className="content-skeleton"/><i className="content-skeleton"/><i className="content-skeleton"/><i className="content-skeleton"/></div> : <><div className="settings-role-picker profile-role-picker">{eligible.map((role) => { const assigned = current.has(role); return <label className={assigned ? 'assigned' : ''} key={role}><input type="checkbox" disabled={assigned || Boolean(data?.pendingRequest)} checked={selected.includes(role)} onChange={(event) => setSelected(event.target.checked ? [...selected, role] : selected.filter((item) => item !== role))} /><strong>{roleLabel(role)}</strong></label>; })}</div>{data?.pendingRequest && <div className="profile-request-status"><Clock3 size={15} /><span><strong>{t(data.pendingRequest.status === 'PROCESSING' ? 'profile.processing' : 'profile.pending')}</strong><small>{data.pendingRequest.requestedRoles.map(roleLabel).join(', ')} · {formatDate(data.pendingRequest.createdAt)}</small></span></div>}<div className="profile-history"><h3>{t('profile.history')}</h3>{data?.history?.length ? data.history.map((item) => <div className="profile-history-row" key={item.id} id={`role-request-${item.id}`} tabIndex={-1}><span><strong>{item.requestedRoles.map(roleLabel).join(', ')}</strong><small>{formatDate(item.createdAt)}</small></span><span className={`state-badge ${item.status.toLowerCase()}`}>{t(`profile.status.${item.status}`, item.status)}</span></div>) : <p className="panel-description">{t('profile.noHistory')}</p>}</div></>}</section>}</main></AppShell>;
}
