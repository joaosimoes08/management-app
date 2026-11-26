'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Edit3, Plus, Trash2, Users } from 'lucide-react';
import type { Site } from '@/features/infrastructure/types';
import { listAccessGroups, listAccessGroupUsers, mutateSettings, settingsKeys } from '../api';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useUiText } from '@/components/ui/use-ui-text';

const emptyForm = { id: '', name: '', description: '', siteSelection: '' };
const membersPerPage = 8;

export function AccessGroupsSettings({ sites }: { sites: Site[] }) {
  const ui = useUiText();
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [expandedGroupId, setExpandedGroupId] = useState('');
  const [addingGroupId, setAddingGroupId] = useState('');
  const [memberPages, setMemberPages] = useState<Record<string, number>>({});
  const groupsQuery = useQuery({ queryKey: settingsKeys.groups, queryFn: () => listAccessGroups() });
  const usersQuery = useQuery({ queryKey: settingsKeys.users, queryFn: listAccessGroupUsers });
  const mutation = useMutation({ mutationFn: mutateSettings, onSuccess: async () => { setForm(emptyForm); await Promise.all([queryClient.invalidateQueries({ queryKey: settingsKeys.groups }), queryClient.invalidateQueries({ queryKey: ['ipam', 'permissions'] }), queryClient.invalidateQueries({ queryKey: ['infrastructure', 'permissions'] })]); } });
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
  const users = usersQuery.data ?? [];
  const queryError = groupsQuery.error || usersQuery.error || mutation.error;
  const error = queryError instanceof Error ? queryError.message : '';
  const saving = mutation.isPending;
  const mutate = (path: string, method: string, body?: unknown) => mutation.mutate({ path, method, body });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (form.id) {
      mutate(`/api/v1/settings/access-groups/${form.id}`, 'PATCH', { name: form.name, description: form.description || undefined });
      return;
    }
    const siteIds = form.siteSelection === '__all__' ? sites.map((site) => site.id) : [form.siteSelection];
    mutate('/api/v1/settings/access-groups', 'POST', { name: form.name, description: form.description || undefined, siteIds });
  };

  const toggleSite = async (groupId: string, siteId: string, assigned: boolean) => {
    if (assigned && !(await askConfirm({ title: ui('settings.groups.removeSiteTitle'), message: ui('settings.groups.removeSiteMessage'), confirmLabel: ui('settings.groups.remove'), destructive: true }))) return;
    mutate(`/api/v1/settings/access-groups/${groupId}/sites/${siteId}`, assigned ? 'DELETE' : 'PUT', assigned ? undefined : { permissions: [] });
  };

  const setMemberPage = (groupId: string, page: number) => setMemberPages((current) => ({ ...current, [groupId]: page }));

  return <>{confirmDialog}<section className="ipam-card settings-panel permissions-panel">
    <div className="panel-heading"><div><h2>{ui('settings.groups.title')}</h2><p className="panel-description">{ui('settings.groups.description')}</p></div></div>
    {error && <div className="ipam-alert error">{error}</div>}
    <form className="inline-create group-create-form" id="settings-access-groups-form" onSubmit={submit}>
      <input required placeholder={ui('settings.groups.name')} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      <input placeholder={ui('settings.groups.descriptionField')} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
      {!form.id && <select required value={form.siteSelection} onChange={(event) => setForm({ ...form, siteSelection: event.target.value })}><option value="">{ui('settings.groups.assignSite')}</option><option value="__all__">{ui('settings.groups.allSites')}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select>}

      {form.id && <button type="button" className="secondary-button" onClick={() => setForm(emptyForm)}>{ui('settings.groups.cancel')}</button>}
    </form>
    <PageToolbarPortal><button type="submit" form="settings-access-groups-form" className="primary-button" disabled={saving}><Check size={14} />{form.id ? ui('settings.groups.save') : ui('settings.groups.create')}</button></PageToolbarPortal>

    <div className="group-accordion" aria-busy={groupsQuery.isLoading}>
      {groupsQuery.isLoading
        ? <div className="settings-group-skeletons" aria-label={ui('settings.groups.loading')}>{[0, 1, 2].map((item) => <div className="content-skeleton settings-group-skeleton" key={item}><i/><span><i/><i/></span><i/></div>)}</div>
        : groups.map((group) => {
        const expanded = expandedGroupId === group.id;
        const availableUsers = users.filter((user) => !group.members.some((member) => member.userId === user.id));
        const pageCount = Math.max(1, Math.ceil(group.members.length / membersPerPage));
        const page = Math.min(memberPages[group.id] ?? 0, pageCount - 1);
        const visibleMembers = group.members.slice(page * membersPerPage, (page + 1) * membersPerPage);
        return <article className={`group-accordion-item ${expanded ? 'open' : ''}`} key={group.id}>
          <button type="button" className="group-accordion-trigger" aria-expanded={expanded} onClick={() => { setExpandedGroupId(expanded ? '' : group.id); setAddingGroupId(''); }}><span><ChevronRight size={16} className={expanded ? 'expanded' : ''} /><strong>{group.name}</strong></span><span>{ui('settings.groups.memberCount', undefined, { count: group.members.length })}</span></button>
          {expanded && <div className="group-accordion-content">
            <div className="group-detail-head"><div><small>{ui('settings.groups.descriptionField')}</small><p>{group.description || ui('settings.groups.noDescription')}</p></div><div className="row-actions"><button title={ui('settings.groups.edit')} onClick={() => setForm({ id: group.id, name: group.name, description: group.description || '', siteSelection: '' })}><Edit3 size={14} /></button><button title={ui('settings.groups.delete')} className="danger" onClick={() => void askConfirm({ message: ui('settings.groups.deleteConfirm', undefined, { name: group.name }), destructive: true }).then((confirmed) => { if (confirmed) mutate(`/api/v1/settings/access-groups/${group.id}`, 'DELETE'); })}><Trash2 size={14} /></button></div></div>
            <div className="group-sites"><small>{ui('settings.groups.sites')}</small><div className="permission-matrix">{sites.map((site) => { const assigned = group.siteAssignments.some((item) => item.siteId === site.id); return <label className={`permission-chip site-toggle ${assigned ? 'assigned' : ''}`} key={site.id}><input type="checkbox" checked={assigned} disabled={saving} onChange={() => toggleSite(group.id, site.id, assigned)} />{site.name}</label>; })}</div></div>
            <div className="group-members-head"><small>{ui('settings.groups.members')}</small><button type="button" className="icon-button group-add-member" title={ui('settings.groups.addMember')} aria-label={ui('settings.groups.addMemberTo', undefined, { name: group.name })} onClick={() => setAddingGroupId(addingGroupId === group.id ? '' : group.id)}><Plus size={15} /></button></div>
            {addingGroupId === group.id && <div className="group-member-picker">{availableUsers.map((user) => <button type="button" key={user.id} disabled={saving} onClick={() => { setAddingGroupId(''); mutate(`/api/v1/settings/access-groups/${group.id}/members`, 'POST', { userId: user.id }); }}><span className="user-status-icon"><Users size={13} /></span><span><strong>{user.displayName || user.username}</strong><small>{user.username}{user.email ? ` · ${user.email}` : ''}</small></span></button>)}{!availableUsers.length && <span>{ui('settings.groups.noMoreUsers')}</span>}</div>}
            <div className="group-member-grid">{visibleMembers.map((member) => <div className="group-member-card" key={member.userId}><span className="user-status-icon"><Users size={13} /></span><span><strong>{member.user.displayName || member.user.username}</strong><small>{member.user.username}</small></span><button type="button" aria-label={ui('settings.groups.removeMember', undefined, { name: member.user.username })} disabled={saving} onClick={() => mutate(`/api/v1/settings/access-groups/${group.id}/members/${member.userId}`, 'DELETE')}>×</button></div>)}{!group.members.length && <div className="group-members-empty">{ui('settings.groups.noMembers')}</div>}</div>
            {pageCount > 1 && <div className="group-member-pagination"><button type="button" aria-label={ui('ui.previousPage')} disabled={page === 0} onClick={() => setMemberPage(group.id, page - 1)}><ChevronLeft size={15} /></button><span>{page + 1} / {pageCount}</span><button type="button" aria-label={ui('ui.nextPage')} disabled={page >= pageCount - 1} onClick={() => setMemberPage(group.id, page + 1)}><ChevronRight size={15} /></button></div>}
          </div>}
        </article>;
      })}
      {!groups.length && !groupsQuery.isLoading && <div className="empty-context"><Users size={22} /><strong>{ui('settings.groups.empty')}</strong></div>}
    </div>
  </section></>;
}
