'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock3, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { getMyRoleRequests, markNotificationsRead, submitRoleRequest } from './api';

const requestableRoles = ['NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR'] as const;
type RequestableRole = typeof requestableRoles[number];

export default function ProfilePage() {
  const { user, profile } = useAuth();
  const { t, formatDate } = useI18n();
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'profile' | 'roles'>('profile');
  const [selected, setSelected] = useState<RequestableRole[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const { data, refetch, isPending: loading, error: queryError } = useQuery({ queryKey: ['profile', 'role-requests'], queryFn: getMyRoleRequests });
  const load = () => void refetch();
  const queryErrorMessage = queryError instanceof Error ? queryError.message : '';
  useEffect(() => { const requested = new URLSearchParams(window.location.search).get('tab'); if (requested === 'roles') setTab('roles'); }, []);
  // Opening the roles tab from a notification link clears the notification badge once.
  useEffect(() => { if (new URLSearchParams(window.location.search).get('tab') === 'roles') void markNotificationsRead().catch(() => undefined); }, []);
  useEffect(() => { const query = new URLSearchParams(window.location.search); query.set('tab', tab); window.history.replaceState({}, '', `/perfil?${query}`); }, [tab]);
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
  const error = queryErrorMessage || submitError;
  return <AppShell section={t('profile.title')} context={[t(`profile.tabs.${tab}`)]} actions={<button className="topbar-action secondary-button" onClick={load}><RefreshCw size={14} />{t('common.refresh')}</button>}><main className="profile-workspace settings-workspace"><header className="workspace-head"><div><span className="section-kicker">{t('profile.kicker')}</span><h1>{t('profile.title')}</h1></div></header>{error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}<nav className="settings-tabs" aria-label={t('profile.title')}><button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>{t('profile.tabs.profile')}</button><button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>{t('profile.tabs.roles')}</button></nav>{tab === 'profile' ? <section className="ipam-card settings-panel profile-card"><div className="profile-summary"><div className="profile-avatar large">{(profile?.firstName || user?.username || '?').charAt(0).toUpperCase()}</div><div><h2>{profile?.firstName || user?.username}</h2><p>{user?.username}{profile?.email ? ` · ${profile.email}` : ''}</p></div></div><div className="detail-grid"><div><span>{t('profile.username')}</span><strong>{user?.username ?? '—'}</strong></div><div><span>{t('profile.roles')}</span><strong>{(data?.currentRoles ?? user?.roles ?? []).map(roleLabel).join(', ') || '—'}</strong></div></div></section> : <section className="ipam-card settings-panel"><div className="panel-heading"><div><span className="section-kicker">{t('profile.roles').toUpperCase()}</span><h2>{t('profile.rolesTitle')}</h2><p className="panel-description">{t('profile.rolesDescription')}</p></div></div>{loading ? <div className="empty-context"><RefreshCw size={20} className="spin" /><span>{t('common.loading')}</span></div> : <><div className="settings-role-picker profile-role-picker">{eligible.map((role) => { const assigned = current.has(role); return <label className={assigned ? 'assigned' : ''} key={role}><input type="checkbox" disabled={assigned || Boolean(data?.pendingRequest)} checked={selected.includes(role)} onChange={(event) => setSelected(event.target.checked ? [...selected, role] : selected.filter((item) => item !== role))} /><strong>{roleLabel(role)}</strong></label>; })}</div>{data?.pendingRequest && <div className="profile-request-status"><Clock3 size={15} /><span><strong>{t(data.pendingRequest.status === 'PROCESSING' ? 'profile.processing' : 'profile.pending')}</strong><small>{data.pendingRequest.requestedRoles.map(roleLabel).join(', ')} · {formatDate(data.pendingRequest.createdAt)}</small></span></div>}<button className="primary-button" disabled={saving || !selected.length || Boolean(data?.pendingRequest)} onClick={() => void submit()}><ShieldCheck size={14} />{saving ? t('common.loading') : t('profile.submit')}</button><div className="profile-history"><h3>{t('profile.history')}</h3>{data?.history?.length ? data.history.map((item) => <div className="profile-history-row" key={item.id}><span><strong>{item.requestedRoles.map(roleLabel).join(', ')}</strong><small>{formatDate(item.createdAt)}</small></span><span className={`state-badge ${item.status.toLowerCase()}`}>{t(`profile.status.${item.status}`, item.status)}</span></div>) : <p className="panel-description">{t('profile.noHistory')}</p>}</div></>}</section>}</main></AppShell>;
}
