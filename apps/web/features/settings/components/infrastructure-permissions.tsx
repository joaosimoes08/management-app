'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import type { BuildingWithRooms } from '@/features/infrastructure/types';

type AccessGroupSummary = { id: string; name: string };
type InfrastructurePermissionItem = {
  id: string;
  scopeType: 'SITE' | 'BUILDING' | 'ROOM' | string;
  scopeId: string;
  permission: string;
  group?: AccessGroupSummary;
};

interface RoomWithBuilding {
  id: string;
  name: string;
  building: BuildingWithRooms;
}

export function InfrastructurePermissions({ siteId, buildings }: { siteId: string; buildings: BuildingWithRooms[] }) {
  const [groups, setGroups] = useState<AccessGroupSummary[]>([]);
  const [permissions, setPermissions] = useState<InfrastructurePermissionItem[]>([]);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ groupId: '', scopeType: 'SITE', scopeId: siteId, permission: 'READ' });

  const rooms = buildings.flatMap((building): RoomWithBuilding[] => (building.rooms ?? []).map((room) => ({ ...room, building })));

  const load = async () => {
    try {
      const [groupItems, permissionItems] = await Promise.all([
        apiFetch<AccessGroupSummary[]>(`/api/v1/settings/access-groups?siteId=${siteId}`),
        apiFetch<InfrastructurePermissionItem[]>(`/api/v1/infrastructure/permissions?siteId=${siteId}`),
      ]);
      setGroups(groupItems);
      setPermissions(permissionItems);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as permissões.');
    }
  };

  useEffect(() => { void load(); }, [siteId]);
  useEffect(() => { setDraft((current) => ({ ...current, groupId: '', scopeType: 'SITE', scopeId: siteId })); }, [siteId]);

  const mutate = async (path: string, method: string, body?: unknown) => {
    try {
      await apiFetch(path, { method, body: body ? JSON.stringify(body) : undefined });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Operação falhou.');
    }
  };

  const resources: { id: string; label: string }[] = draft.scopeType === 'SITE'
    ? [{ id: siteId, label: 'Todo o Site' }]
    : draft.scopeType === 'BUILDING'
      ? buildings.map((building) => ({ id: building.id, label: building.name }))
      : rooms.map((room) => ({ id: room.id, label: `${room.building.name} · ${room.name}` }));

  const labelFor = (item: InfrastructurePermissionItem) => {
    if (item.scopeType === 'SITE') return 'Todo o Site';
    if (item.scopeType === 'BUILDING') {
      const building = buildings.find((candidate) => candidate.id === item.scopeId);
      return building?.name || item.scopeId;
    }
    const room = rooms.find((candidate) => candidate.id === item.scopeId);
    return room ? `${room.building.name} · ${room.name}` : item.scopeId;
  };

  return <section className="ipam-card permissions-panel"><div className="panel-heading"><div><span className="section-kicker">INFRAESTRUTURA</span><h2>Edifícios e salas</h2><p className="panel-description">Site é o default; edifício substitui o Site; uma sala com regras próprias substitui integralmente a matriz do edifício.</p></div></div>{error && <div className="ipam-alert error">{error}</div>}<div className="permission-add"><select value={draft.groupId} onChange={(event) => setDraft({ ...draft, groupId: event.target.value })}><option value="">Escolher grupo…</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><select value={draft.scopeType} onChange={(event) => { const scopeType = event.target.value; setDraft({ ...draft, scopeType, scopeId: scopeType === 'SITE' ? siteId : '' }); }}><option value="SITE">Site</option><option value="BUILDING">Edifício</option><option value="ROOM">Sala</option></select><select value={draft.scopeId} onChange={(event) => setDraft({ ...draft, scopeId: event.target.value })}><option value="">Escolher scope…</option>{resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.label}</option>)}</select><select value={draft.permission} onChange={(event) => setDraft({ ...draft, permission: event.target.value })}>{['READ', 'CREATE', 'UPDATE', 'DELETE'].map((permission) => <option key={permission}>{permission}</option>)}</select><button className="primary-button" disabled={!draft.groupId || !draft.scopeId} onClick={() => void mutate('/api/v1/infrastructure/permissions', 'POST', draft)}><Plus size={14} /> Permissão</button></div><div className="permission-matrix">{permissions.map((item) => <span className="permission-chip" key={item.id}>{item.group?.name} · {item.scopeType} · {labelFor(item)} · {item.permission}<button onClick={() => void mutate(`/api/v1/infrastructure/permissions/${item.id}`, 'DELETE')}>×</button></span>)}</div>{!permissions.length && <div className="no-data">Ainda não existem permissões de Infraestrutura neste Site.</div>}</section>;
}
