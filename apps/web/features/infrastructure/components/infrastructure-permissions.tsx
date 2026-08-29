'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit3, Trash2 } from 'lucide-react';
import { createInfrastructurePermission, deleteInfrastructurePermission, listInfrastructureGroups, listInfrastructurePermissions } from '../api';
import type { BuildingWithRooms, InfrastructureAction, InfrastructurePermission } from '../types';

const actions: InfrastructureAction[] = ['READ', 'CREATE', 'UPDATE', 'DELETE'];
type PermissionDraft = { groupId: string; scopeType: string; scopeId: string };
type PermissionChange = { create: (PermissionDraft & { permission: InfrastructureAction })[]; deleteIds: string[] };

export function InfrastructurePermissions({ siteId, buildings }: { siteId: string; buildings: BuildingWithRooms[] }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PermissionDraft>({ groupId: '', scopeType: 'SITE', scopeId: siteId });
  const rooms = buildings.flatMap((building) => (building.rooms ?? []).map((room) => ({ ...room, building })));
  const groupsQuery = useQuery({ queryKey: ['infrastructure', 'permissions', 'groups', siteId], queryFn: () => listInfrastructureGroups(siteId) });
  const permissionsQuery = useQuery({ queryKey: ['infrastructure', 'permissions', siteId], queryFn: () => listInfrastructurePermissions(siteId) });
  const mutation = useMutation({
    mutationFn: async (change: PermissionChange) => {
      await Promise.all([
        ...change.create.map((permission) => createInfrastructurePermission(permission)),
        ...change.deleteIds.map((id) => deleteInfrastructurePermission(id)),
      ]);
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['infrastructure', 'permissions', siteId] }); },
  });
  useEffect(() => { setDraft({ groupId: '', scopeType: 'SITE', scopeId: siteId }); }, [siteId]);
  const error = groupsQuery.error || permissionsQuery.error || mutation.error;
  const permissions = permissionsQuery.data ?? [];
  const selectedRules = permissions.filter((item) => item.group?.id === draft.groupId && item.scopeType === draft.scopeType && item.scopeId === draft.scopeId);
  const selectedActions = selectedRules.map((item) => item.permission);
  const fullControl = actions.every((action) => selectedActions.includes(action));
  const resources = draft.scopeType === 'SITE' ? [{ id: siteId, label: 'Todo o Site' }] : draft.scopeType === 'BUILDING' ? buildings.map((building) => ({ id: building.id, label: building.name })) : rooms.map((room) => ({ id: room.id, label: `${room.building.name} · ${room.name}` }));
  const labelFor = (item: InfrastructurePermission) => item.scopeType === 'SITE' ? 'Todo o Site' : item.scopeType === 'BUILDING' ? buildings.find((candidate) => candidate.id === item.scopeId)?.name ?? item.scopeId : (() => { const room = rooms.find((candidate) => candidate.id === item.scopeId); return room ? `${room.building.name} · ${room.name}` : item.scopeId; })();
  const ready = Boolean(draft.groupId && draft.scopeId);

  const toggleAction = (action: InfrastructureAction, enabled: boolean) => {
    if (!ready) return;
    const existing = selectedRules.find((item) => item.permission === action);
    mutation.mutate({
      create: enabled && !existing ? [{ ...draft, permission: action }] : [],
      deleteIds: !enabled && existing ? [existing.id] : [],
    });
  };

  const toggleFullControl = (enabled: boolean) => {
    if (!ready) return;
    mutation.mutate({
      create: enabled ? actions.filter((action) => !selectedActions.includes(action)).map((permission) => ({ ...draft, permission })) : [],
      deleteIds: enabled ? [] : selectedRules.map((item) => item.id),
    });
  };

  const editRule = (item: InfrastructurePermission) => setDraft({ groupId: item.group?.id ?? '', scopeType: item.scopeType, scopeId: item.scopeId });
  const clearSelected = () => {
    if (!selectedRules.length || !window.confirm('Apagar todas as permissões deste grupo no âmbito selecionado?')) return;
    mutation.mutate({ create: [], deleteIds: selectedRules.map((item) => item.id) });
  };

  return <section className="ipam-card permissions-panel">
    <div className="panel-heading"><div><span className="section-kicker">INFRAESTRUTURA</span><h2>Permissões dos grupos</h2><p className="panel-description">Seleciona o grupo e o âmbito, depois ativa as ações necessárias. FULL CONTROL equivale a todas as permissões.</p></div></div>
    {error && <div className="ipam-alert error">{error instanceof Error ? error.message : 'Não foi possível carregar as permissões.'}</div>}
    <div className="permission-scope-picker"><select value={draft.groupId} onChange={(event) => setDraft({ ...draft, groupId: event.target.value })}><option value="">Escolher grupo…</option>{(groupsQuery.data ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><select value={draft.scopeType} onChange={(event) => { const scopeType = event.target.value; setDraft({ ...draft, scopeType, scopeId: scopeType === 'SITE' ? siteId : '' }); }}><option value="SITE">Site</option><option value="BUILDING">Edifício</option><option value="ROOM">Sala</option></select><select value={draft.scopeId} onChange={(event) => setDraft({ ...draft, scopeId: event.target.value })}><option value="">Escolher âmbito…</option>{resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.label}</option>)}</select></div>
    <div className="permission-checkboxes"><label className="full-control"><input type="checkbox" disabled={!ready || mutation.isPending} checked={ready && fullControl} onChange={(event) => toggleFullControl(event.target.checked)} /><span><strong>FULL CONTROL</strong><small>Todas as permissões</small></span></label>{actions.map((action) => <label key={action}><input type="checkbox" disabled={!ready || mutation.isPending} checked={ready && selectedActions.includes(action)} onChange={(event) => toggleAction(action, event.target.checked)} /><span>{action}</span></label>)}</div>
    {selectedRules.length > 0 && <div className="permission-editor-actions"><button className="danger-button" disabled={mutation.isPending} onClick={clearSelected}><Trash2 size={14} /> Limpar permissões</button></div>}
    <div><span className="section-kicker">REGRAS ATUAIS</span><div className="permission-rule-list">{permissions.map((item) => <article className="permission-rule-row" key={item.id}><span><strong>{item.group?.name} · {item.scopeType} · {labelFor(item)}</strong><small>{item.permission}</small></span><div className="row-actions"><button title="Editar permissão" onClick={() => editRule(item)}><Edit3 size={14} /></button><button title="Apagar permissão" className="danger" disabled={mutation.isPending} onClick={() => mutation.mutate({ create: [], deleteIds: [item.id] })}><Trash2 size={14} /></button></div></article>)}</div>{!permissionsQuery.isLoading && !permissions.length && <div className="no-data">Ainda não existem permissões de Infraestrutura neste Site.</div>}</div>
  </section>;
}
