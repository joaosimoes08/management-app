'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Edit3, Plus, Trash2, Users } from 'lucide-react';
import type { Site } from '@/features/infrastructure/types';
import { listAccessGroups, listAccessGroupUsers, mutateSettings, settingsKeys } from '../api';

const emptyForm = { id: '', name: '', description: '', siteSelection: '' };
const membersPerPage = 8;

export function AccessGroupsSettings({ sites }: { sites: Site[] }) {
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

  const toggleSite = (groupId: string, siteId: string, assigned: boolean) => {
    if (assigned && !window.confirm('Remover este grupo do Site? As permissões IPAM desse Site também serão removidas.')) return;
    mutate(`/api/v1/settings/access-groups/${groupId}/sites/${siteId}`, assigned ? 'DELETE' : 'PUT', assigned ? undefined : { permissions: [] });
  };

  const setMemberPage = (groupId: string, page: number) => setMemberPages((current) => ({ ...current, [groupId]: page }));

  return <section className="ipam-card settings-panel permissions-panel">
    <div className="panel-heading"><div><span className="section-kicker">ORGANIZAÇÃO</span><h2>Grupos de acesso</h2><p className="panel-description">Cria os grupos, define os membros e associa-os aos Sites. As permissões são configuradas nas tabs Permissões do IPAM e da Infraestrutura.</p></div></div>
    {error && <div className="ipam-alert error">{error}</div>}
    <form className="inline-create group-create-form" onSubmit={submit}>
      <input required placeholder="Nome do grupo" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      <input placeholder="Descrição" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
      {!form.id && <select required value={form.siteSelection} onChange={(event) => setForm({ ...form, siteSelection: event.target.value })}><option value="">Associar ao Site…</option><option value="__all__">Todos os sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select>}
      <button className="primary-button" disabled={saving}><Check size={14} />{form.id ? 'Guardar' : 'Criar grupo'}</button>
      {form.id && <button type="button" className="secondary-button" onClick={() => setForm(emptyForm)}>Cancelar</button>}
    </form>

    <div className="group-accordion">
      {groups.map((group) => {
        const expanded = expandedGroupId === group.id;
        const availableUsers = users.filter((user) => !group.members.some((member) => member.userId === user.id));
        const pageCount = Math.max(1, Math.ceil(group.members.length / membersPerPage));
        const page = Math.min(memberPages[group.id] ?? 0, pageCount - 1);
        const visibleMembers = group.members.slice(page * membersPerPage, (page + 1) * membersPerPage);
        return <article className={`group-accordion-item ${expanded ? 'open' : ''}`} key={group.id}>
          <button type="button" className="group-accordion-trigger" aria-expanded={expanded} onClick={() => { setExpandedGroupId(expanded ? '' : group.id); setAddingGroupId(''); }}><span><ChevronRight size={16} className={expanded ? 'expanded' : ''} /><strong>{group.name}</strong></span><span>{group.members.length} {group.members.length === 1 ? 'membro' : 'membros'}</span></button>
          {expanded && <div className="group-accordion-content">
            <div className="group-detail-head"><div><small>Descrição</small><p>{group.description || 'Sem descrição'}</p></div><div className="row-actions"><button title="Editar grupo" onClick={() => setForm({ id: group.id, name: group.name, description: group.description || '', siteSelection: '' })}><Edit3 size={14} /></button><button title="Eliminar grupo" className="danger" onClick={() => window.confirm(`Eliminar o grupo ${group.name}?`) && mutate(`/api/v1/settings/access-groups/${group.id}`, 'DELETE')}><Trash2 size={14} /></button></div></div>
            <div className="group-sites"><small>Sites</small><div className="permission-matrix">{sites.map((site) => { const assigned = group.siteAssignments.some((item) => item.siteId === site.id); return <label className={`permission-chip site-toggle ${assigned ? 'assigned' : ''}`} key={site.id}><input type="checkbox" checked={assigned} disabled={saving} onChange={() => toggleSite(group.id, site.id, assigned)} />{site.name}</label>; })}</div></div>
            <div className="group-members-head"><small>Membros</small><button type="button" className="icon-button group-add-member" title="Adicionar membro" aria-label={`Adicionar membro a ${group.name}`} onClick={() => setAddingGroupId(addingGroupId === group.id ? '' : group.id)}><Plus size={15} /></button></div>
            {addingGroupId === group.id && <div className="group-member-picker">{availableUsers.map((user) => <button type="button" key={user.id} disabled={saving} onClick={() => { setAddingGroupId(''); mutate(`/api/v1/settings/access-groups/${group.id}/members`, 'POST', { userId: user.id }); }}><span className="user-status-icon"><Users size={13} /></span><span><strong>{user.displayName || user.username}</strong><small>{user.username}{user.email ? ` · ${user.email}` : ''}</small></span></button>)}{!availableUsers.length && <span>Não existem mais utilizadores disponíveis.</span>}</div>}
            <div className="group-member-grid">{visibleMembers.map((member) => <div className="group-member-card" key={member.userId}><span className="user-status-icon"><Users size={13} /></span><span><strong>{member.user.displayName || member.user.username}</strong><small>{member.user.username}</small></span><button type="button" aria-label={`Remover ${member.user.username}`} disabled={saving} onClick={() => mutate(`/api/v1/settings/access-groups/${group.id}/members/${member.userId}`, 'DELETE')}>×</button></div>)}{!group.members.length && <div className="group-members-empty">Este grupo ainda não tem membros.</div>}</div>
            {pageCount > 1 && <div className="group-member-pagination"><button type="button" aria-label="Página anterior" disabled={page === 0} onClick={() => setMemberPage(group.id, page - 1)}><ChevronLeft size={15} /></button><span>{page + 1} / {pageCount}</span><button type="button" aria-label="Página seguinte" disabled={page >= pageCount - 1} onClick={() => setMemberPage(group.id, page + 1)}><ChevronRight size={15} /></button></div>}
          </div>}
        </article>;
      })}
      {!groups.length && !groupsQuery.isLoading && <div className="empty-context"><Users size={22} /><strong>Ainda não existem grupos</strong></div>}
    </div>
  </section>;
}
