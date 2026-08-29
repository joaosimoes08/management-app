'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit3, Trash2 } from 'lucide-react';
import { listSites } from '@/features/infrastructure/api';
import { listPermissionGroups, updateGroupSitePermissions } from '../api';
import type { IpamAction, IpamPermissionGroup } from '../types';

const actions: IpamAction[] = ['READ', 'CREATE', 'UPDATE', 'DELETE', 'DISCOVER', 'IMPORT'];

export function CentralIpamPermissions({ siteId }: { siteId: string }) {
  const [groupId, setGroupId] = useState('');
  const [siteSelection, setSiteSelection] = useState(siteId);
  const [localPermissions, setLocalPermissions] = useState<Record<string, IpamAction[]>>({});
  const groupsQuery = useQuery({ queryKey: ['ipam', 'permissions', 'groups', siteSelection], queryFn: () => listPermissionGroups(siteSelection !== '__all__' ? siteSelection : undefined), enabled: Boolean(siteSelection) });
  const sitesQuery = useQuery({ queryKey: ['ipam', 'permissions', 'sites'], queryFn: listSites });
  const sites = sitesQuery.data?.items ?? [];
  const mutation = useMutation({
    mutationFn: ({ targetGroupId, permissions, targetSites }: { targetGroupId: string; permissions: IpamAction[]; targetSites: string[] }) => Promise.all(targetSites.map((targetSite) => updateGroupSitePermissions(targetGroupId, targetSite, permissions))),
    onSuccess: () => undefined,
    onError: (_reason, variables) => {
      setLocalPermissions((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !(variables.targetSites.some((targetSite) => key === `${variables.targetGroupId}:${targetSite}`)))));
    },
  });
  useEffect(() => { setGroupId(''); setSiteSelection(siteId); }, [siteId]);
  const groups = groupsQuery.data ?? [];
  const selectedGroup = groups.find((group) => group.id === groupId);
  const selectedSiteIds = siteSelection === '__all__' ? sites.map((site) => site.id) : [siteSelection];
  const permissionsFor = (group: IpamPermissionGroup, targetSite: string) => localPermissions[`${group.id}:${targetSite}`] ?? group.siteAssignments.find((item) => item.siteId === targetSite)?.permissions.map((item) => item.permission) ?? [];
  const selected = selectedGroup && selectedSiteIds.length ? actions.filter((action) => selectedSiteIds.every((targetSite) => permissionsFor(selectedGroup, targetSite).includes(action))) : [];
  const fullControl = actions.every((action) => selected.includes(action));
  const error = groupsQuery.error || mutation.error;
  const save = (permissions: IpamAction[]) => {
    if (!groupId || !selectedSiteIds.length) return;
    setLocalPermissions((current) => Object.fromEntries([...Object.entries(current), ...selectedSiteIds.map((targetSite) => [`${groupId}:${targetSite}`, permissions])]));
    mutation.mutate({ targetGroupId: groupId, permissions, targetSites: selectedSiteIds });
  };
  const clear = (targetGroupId: string) => { if (!window.confirm('Apagar todas as permissões IPAM deste grupo nos Sites selecionados?')) return; setLocalPermissions((current) => Object.fromEntries([...Object.entries(current), ...selectedSiteIds.map((targetSite) => [`${targetGroupId}:${targetSite}`, []])])); mutation.mutate({ targetGroupId, permissions: [], targetSites: selectedSiteIds }); };

  return <section className="ipam-card permissions-panel">
    <div className="panel-heading"><div><span className="section-kicker">IPAM · SITE</span><h2>Permissões dos grupos</h2><p className="panel-description">Seleciona o grupo e ativa as ações necessárias. FULL CONTROL equivale a todas as permissões.</p></div></div>
    {error && <div className="ipam-alert error">{error instanceof Error ? error.message : 'Não foi possível carregar as permissões.'}</div>}
    <div className="permission-scope-picker ipam-scope-picker"><select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Escolher grupo…</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><select value={siteSelection} onChange={(event) => setSiteSelection(event.target.value)}><option value="">Escolher Site…</option><option value="__all__">Todos os sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></div>
    <div className="permission-checkboxes ipam-permission-checkboxes"><label className="full-control"><input type="checkbox" disabled={!groupId || mutation.isPending} checked={Boolean(groupId) && fullControl} onChange={(event) => save(event.target.checked ? actions : [])} /><span><strong>FULL CONTROL</strong><small>Todas as permissões</small></span></label>{actions.map((action) => <label key={action}><input type="checkbox" disabled={!groupId || mutation.isPending} checked={Boolean(groupId) && selected.includes(action)} onChange={(event) => save(event.target.checked ? [...new Set([...selected, action])] : selected.filter((item) => item !== action))} /><span>{action}</span></label>)}</div>
    {groupId && selected.length > 0 && <div className="permission-editor-actions"><button className="danger-button" disabled={mutation.isPending} onClick={() => clear(groupId)}><Trash2 size={14} /> Limpar permissões</button></div>}
    <div><span className="section-kicker">REGRAS ATUAIS</span><div className="permission-rule-list">{selectedGroup && selected.length > 0 && <article className="permission-rule-row" key={selectedGroup.id}><span><strong>{selectedGroup.name}</strong><small>{siteSelection === '__all__' ? 'Todos os sites · ' : `${sites.find((site) => site.id === siteSelection)?.name ?? 'Site selecionado'} · `}{selected.join(' · ')}</small></span><div className="row-actions"><button title="Editar permissões" onClick={() => setGroupId(selectedGroup.id)}><Edit3 size={14} /></button><button title="Apagar permissões" className="danger" onClick={() => clear(selectedGroup.id)}><Trash2 size={14} /></button></div></article>}</div>{!groupsQuery.isLoading && (!selectedGroup || !selected.length) && <div className="no-data">Ainda não existem permissões IPAM no âmbito selecionado.</div>}</div>
  </section>;
}
