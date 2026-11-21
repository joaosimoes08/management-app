'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Server } from 'lucide-react';
import { listMissingConfigDevices, type MissingConfigDevice } from '../../api';
import { EquipmentTypeIcon } from '../equipment-type-icon';

const PAGE_SIZE = 50;

function modelLabel(model: MissingConfigDevice['model']): string {
  if (!model) return 'Sem modelo';
  return typeof model === 'string' ? model : `${model.manufacturer ?? ''} ${model.model ?? ''}`.trim() || 'Sem modelo';
}

/**
 * Cross-site list behind a bell alert that spans several Sites (`?missingConfig=…&allSites=1`). Reads
 * GET /devices/missing-config without a siteId, so its total is the bell's count. Each row opens the device's own link,
 * which switches to its Site and opens the editor on the missing tab.
 */
export function CrossSiteMissingConfigList({ config, label }: { config: string; label: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['infrastructure', 'devices', 'missing-config', config, page],
    queryFn: () => listMissingConfigDevices(config, page, PAGE_SIZE),
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const siteCount = data?.siteCount ?? new Set(items.map((item) => item.siteId)).size;
  const heading = `${total} equipamento${total === 1 ? '' : 's'} em falta · ${siteCount} Site${siteCount === 1 ? '' : 's'}`;

  return <section className="ipam-card cross-site-missing-config" aria-labelledby="cross-site-missing-config-heading">
    <div className="panel-heading"><div><span className="section-kicker">TODOS OS SITES · {label.toUpperCase()}</span><h2 id="cross-site-missing-config-heading">{isLoading ? 'A carregar…' : heading}</h2></div></div>
    {isError && <div role="status" className="ipam-alert error">Não foi possível carregar os equipamentos em falta.</div>}
    {items.map((item) => <a key={item.id} className="host-row infra-device-row cross-site-missing-config-row" href={item.href}>
      <span className="host-icon equipment-type-icon-frame"><EquipmentTypeIcon type={item.type} /></span>
      <span><strong>{item.name}</strong><small>{item.type} · {modelLabel(item.model)} · {item.rackName ? `${item.rackName} / ${item.rackUnitStart ?? '?'}U` : 'Por localizar'}</small></span>
      <span className="cross-site-missing-config-site">{item.siteName ?? 'Sem Site'}</span>
      <em className="status-active">{item.status}</em>
    </a>)}
    {!isLoading && !isError && !items.length && <div className="empty-context"><Server size={26} /><strong>Nenhum equipamento em falta</strong></div>}
    {totalPages > 1 && <div className="ip-history-pagination"><button type="button" className="secondary-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>{page} / {totalPages}</span><button type="button" className="secondary-button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Seguinte</button></div>}
  </section>;
}
