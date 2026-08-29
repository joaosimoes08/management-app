'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Edit3, Link2, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import type { BuildingWithRooms, Site } from '@/features/infrastructure/types';
import { InfrastructurePermissions } from './infrastructure-permissions';

type AccessGroupUser = { id: string; username: string; displayName?: string | null; email?: string | null };
type AccessGroupMember = { userId: string; user: AccessGroupUser };
type AccessGroupSiteAssignment = { siteId: string; permissions: { permission: string }[] };
type AccessGroup = {
  id: string;
  name: string;
  description?: string | null;
  siteAssignments: AccessGroupSiteAssignment[];
  members: AccessGroupMember[];
  infrastructurePermissions: unknown[];
};

const emptyForm = { id: '', name: '', description: '' };
const ipamActions = ['READ', 'CREATE', 'UPDATE', 'DELETE', 'DISCOVER', 'IMPORT'];

export function AccessGroupsSettings({ sites }: { sites: Site[] }) {
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [users, setUsers] = useState<AccessGroupUser[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [siteId, setSiteId] = useState('');
  const [buildings, setBuildings] = useState<BuildingWithRooms[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [groupItems, userItems] = await Promise.all([
        apiFetch<AccessGroup[]>('/api/v1/settings/access-groups'),
        apiFetch<AccessGroupUser[]>('/api/v1/settings/access-group-users'),
      ]);
      setGroups(groupItems);
      setUsers(userItems);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os grupos.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!siteId) {
      setBuildings([]);
      return;
    }
    void apiFetch<BuildingWithRooms[]>(`/api/v1/sites/${siteId}/buildings`).then(setBuildings).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a Infraestrutura do Site.'));
  }, [siteId]);

  const mutate = async (path: string, method: string, body?: unknown) => {
    setSaving(true);
    try {
      await apiFetch(path, { method, body: body ? JSON.stringify(body) : undefined });
      setForm(emptyForm);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Operação falhou.');
    } finally {
      setSaving(false);
    }
  };

  const selectedSite = sites.find((site) => site.id === siteId);
  const assigned = useMemo(() => groups.filter((group) => group.siteAssignments.some((item) => item.siteId === siteId)), [groups, siteId]);
  const assignment = (group: AccessGroup) => group.siteAssignments.find((item) => item.siteId === siteId);
  const setIpamAction = (group: AccessGroup, action: string, enabled: boolean) => {
    const current = assignment(group)?.permissions.map((item) => item.permission) ?? [];
    const permissions = enabled ? [...new Set([...current, action])] : current.filter((item) => item !== action);
    void mutate(`/api/v1/settings/access-groups/${group.id}/sites/${siteId}`, 'PUT', { permissions });
  };

  return <div className="settings-access-layers">
    <section className="ipam-card settings-panel permissions-panel"><div className="panel-heading"><div><span className="section-kicker">ORGANIZAÇÃO</span><h2>Grupos e membros</h2><p className="panel-description">O grupo existe uma vez na Organização e pode ser associado a vários Sites.</p></div></div>{error && <div className="ipam-alert error">{error}</div>}
      <form className="inline-create" onSubmit={(event) => { event.preventDefault(); void mutate(form.id ? `/api/v1/settings/access-groups/${form.id}` : '/api/v1/settings/access-groups', form.id ? 'PATCH' : 'POST', { name: form.name, description: form.description || undefined }); }}><input required placeholder="Nome do grupo" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><input placeholder="Descrição" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><button className="primary-button" disabled={saving}><Check size={14} />{form.id ? 'Guardar' : 'Criar grupo'}</button>{form.id && <button type="button" className="secondary-button" onClick={() => setForm(emptyForm)}>Cancelar</button>}</form>
      {groups.map((group) => <article className="permission-group" key={group.id}><div className="permission-group-head"><div><strong>{group.name}</strong><span>{group.siteAssignments.length} Site(s) · {group.infrastructurePermissions.length} regras de Infraestrutura</span>{group.description && <small>{group.description}</small>}</div><div className="row-actions"><button title="Editar" onClick={() => setForm({ id: group.id, name: group.name, description: group.description || '' })}><Edit3 size={14} /></button><button title="Eliminar" className="danger" onClick={() => window.confirm(`Eliminar o grupo ${group.name}?`) && void mutate(`/api/v1/settings/access-groups/${group.id}`, 'DELETE')}><Trash2 size={14} /></button></div></div><div className="permission-members"><strong>Membros</strong>{group.members.map((member) => <span className="permission-chip" key={member.userId}>{member.user.displayName || member.user.username}<button onClick={() => void mutate(`/api/v1/settings/access-groups/${group.id}/members/${member.userId}`, 'DELETE')}>×</button></span>)}<select value="" onChange={(event) => event.target.value && void mutate(`/api/v1/settings/access-groups/${group.id}/members`, 'POST', { userId: event.target.value })}><option value="">Adicionar utilizador…</option>{users.filter((user) => !group.members.some((member) => member.userId === user.id)).map((user) => <option key={user.id} value={user.id}>{user.displayName || user.username}</option>)}</select></div></article>)}
    </section>
    <section className="ipam-card settings-panel permissions-panel"><div className="panel-heading"><div><span className="section-kicker">SITE</span><h2>Acesso por Site</h2><p className="panel-description">O IPAM é gerido ao nível do Site. Edifícios e salas pertencem à Infraestrutura e são configurados abaixo.</p></div></div><label>Site<select value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">Selecionar Site…</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
      {siteId && groups.map((group) => { const link = assignment(group); const selectedActions = link?.permissions.map((item) => item.permission) ?? []; return <article className="permission-group" key={`${siteId}-${group.id}`}><div className="permission-group-head"><div><strong>{group.name}</strong><span>{link ? `Associado a ${selectedSite?.name}` : 'Não associado a este Site'}</span></div>{link ? <button className="secondary-button danger-button" onClick={() => void mutate(`/api/v1/settings/access-groups/${group.id}/sites/${siteId}`, 'DELETE')}>Remover do Site</button> : <button className="secondary-button" onClick={() => void mutate(`/api/v1/settings/access-groups/${group.id}/sites/${siteId}`, 'PUT', { permissions: [] })}><Link2 size={14} /> Associar</button>}</div>{link && <div className="settings-methods"><strong>Permissões IPAM</strong>{ipamActions.map((action) => <label key={action}><input type="checkbox" checked={selectedActions.includes(action)} onChange={(event) => setIpamAction(group, action, event.target.checked)} />{action}</label>)}</div>}</article>; })}
      {siteId && !assigned.length && <div className="empty-context"><strong>Sem grupos associados</strong><span>Associa pelo menos um grupo para dar acesso a este Site.</span></div>}
    </section>
    {siteId && <InfrastructurePermissions siteId={siteId} buildings={buildings} />}
  </div>;
}
